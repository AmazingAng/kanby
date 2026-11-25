import {
  abortIdempotentRequest,
  authenticateAgent,
  beginIdempotentRequest,
  canMutateTask,
  completeIdempotentRequest,
  recordAgentUpdate,
  resolveAgentTask,
} from '@/lib/agent';
import {
  attachmentDownloadResponse,
  attachmentFile,
  MAX_ATTACHMENT_FILE_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  readAttachmentForm,
  storeTaskAttachment,
} from '@/lib/attachments';
import {
  getTaskAttachment,
  listTaskAttachments,
  taskBelongsToProject,
  type TaskAttachmentRecord,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

function fail(code: string, message: string, status: number) {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: noStore },
  );
}

const formErrors = {
  form_required: [
    'form_data_required',
    'Content-Type must be multipart/form-data',
    415,
  ],
  length_required: [
    'content_length_required',
    'Content-Length is required',
    411,
  ],
  too_large: [
    'file_too_large',
    `Attachments must be at most ${MAX_ATTACHMENT_FILE_SIZE / 1024 / 1024} MB`,
    413,
  ],
  invalid: ['invalid_form', 'Request body must be valid form data', 400],
} as const;

function formFailure(reason: keyof typeof formErrors) {
  const [code, message, status] = formErrors[reason];
  return fail(code, message, status);
}

/** Agent-facing attachment shape: downloads go through the token-authenticated route. */
function agentAttachment(attachment: TaskAttachmentRecord) {
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    url: `/api/v1/attachments?id=${encodeURIComponent(attachment.id)}`,
  };
}

function idempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim() ?? '';
  return value.length >= 8 && value.length <= 128 ? value : null;
}

async function fileDigest(file: File) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function GET(request: Request) {
  const auth = await authenticateAgent(request, 'task:read');
  if (!auth)
    return fail(
      'unauthorized',
      'Invalid, expired, or insufficiently scoped Agent Token',
      401,
    );
  const params = new URL(request.url).searchParams;
  const attachmentId = params.get('id')?.trim() ?? '';
  if (attachmentId) {
    const attachment = await getTaskAttachment(attachmentId);
    if (!attachment || attachment.projectId !== auth.projectId)
      return fail('not_found', 'Attachment was not found', 404);
    return (
      (await attachmentDownloadResponse(attachment)) ??
      fail('not_found', 'Attachment content was not found', 404)
    );
  }
  const reference = params.get('task')?.trim() ?? '';
  if (!reference)
    return fail('invalid_request', 'Pass task=<ref> or id=<attachment>', 400);
  const taskId = await resolveAgentTask(auth.projectId, reference);
  if (!taskId)
    return fail(
      'not_found',
      'Task reference was not found or is ambiguous',
      404,
    );
  const attachments = await listTaskAttachments(taskId, auth.projectId);
  return Response.json(
    { ok: true, data: attachments.map(agentAttachment) },
    { headers: noStore },
  );
}

export async function POST(request: Request) {
  const auth = await authenticateAgent(request, 'task:write');
  if (!auth)
    return fail(
      'unauthorized',
      'Invalid, expired, or insufficiently scoped Agent Token',
      401,
    );
  const parsed = await readAttachmentForm(request);
  if (!parsed.ok) return formFailure(parsed.reason);
  const taskValue = parsed.form.get('task');
  const reference = typeof taskValue === 'string' ? taskValue.trim() : '';
  if (!reference) return fail('invalid_task', 'Task ref is required', 400);
  const file = attachmentFile(parsed.form.get('file'));
  if (!file.ok)
    return file.reason === 'too_large'
      ? formFailure('too_large')
      : fail(
          'invalid_attachment',
          'A non-empty file with a name of at most 240 characters is required',
          400,
        );
  const taskId = await resolveAgentTask(auth.projectId, reference);
  if (!taskId || !(await taskBelongsToProject(taskId, auth.projectId)))
    return fail(
      'not_found',
      'Task reference was not found, is ambiguous, or is archived',
      404,
    );
  if (!(await canMutateTask(auth, taskId)))
    return fail(
      'claimed_by_another_agent',
      'Task is actively claimed by another Agent Token',
      409,
    );

  const key = idempotencyKey(request);
  const idempotency = key
    ? await beginIdempotentRequest(
        auth.tokenId,
        key,
        'attachment:upload',
        JSON.stringify({
          taskId,
          name: file.file.name,
          type: file.file.type,
          size: file.file.size,
          sha256: await fileDigest(file.file),
        }),
      )
    : ({ kind: 'none' } as const);
  if (idempotency.kind === 'cached')
    return Response.json(idempotency.response, {
      status: idempotency.status,
      headers: noStore,
    });
  if (idempotency.kind === 'conflict')
    return fail(
      'idempotency_conflict',
      'Idempotency key was used for another operation or payload',
      409,
    );
  if (idempotency.kind === 'in_progress')
    return fail(
      'idempotency_in_progress',
      'A request with this idempotency key is still in progress',
      409,
    );

  let attachment: TaskAttachmentRecord | null;
  try {
    attachment = await storeTaskAttachment({
      projectId: auth.projectId,
      taskId,
      file: file.file,
      createdBy: auth.userId,
      metadata: { agentTokenId: auth.tokenId },
    });
  } catch (error) {
    if (idempotency.kind === 'acquired')
      await abortIdempotentRequest(idempotency.reservation);
    throw error;
  }
  if (!attachment) {
    if (idempotency.kind === 'acquired')
      await abortIdempotentRequest(idempotency.reservation);
    return fail(
      'attachment_limit',
      `A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments`,
      409,
    );
  }
  await recordAgentUpdate(
    auth,
    taskId,
    'attached',
    `上传附件 ${attachment.name}`,
    {
      attachmentId: attachment.id,
      name: attachment.name,
      size: attachment.size,
      contentType: attachment.contentType,
    },
  );
  const response = { ok: true, data: agentAttachment(attachment) };
  if (idempotency.kind === 'acquired')
    await completeIdempotentRequest(idempotency.reservation, response, 201);
  return Response.json(response, { status: 201, headers: noStore });
}
