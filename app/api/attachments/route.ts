import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  deleteTaskAttachment,
  getProjectRole,
  getTaskAttachment,
  taskBelongsToProject,
} from '@/lib/db';
import {
  attachmentDownloadResponse,
  attachmentFile,
  readAttachmentForm,
  storeTaskAttachment,
} from '@/lib/attachments';
import { attachmentStorage } from '@/lib/storage';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

const formErrors = {
  form_required: { error: 'Form data required', status: 415 },
  length_required: { error: 'Content-Length required', status: 411 },
  too_large: { error: 'File too large', status: 413 },
  invalid: { error: 'Invalid form data', status: 400 },
} as const;

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!user || !id)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const attachment = await getTaskAttachment(id);
  if (!attachment || !(await getProjectRole(attachment.projectId, user.id)))
    return Response.json({ error: 'Not found' }, { status: 404 });
  return (
    (await attachmentDownloadResponse(attachment)) ??
    Response.json({ error: 'Not found' }, { status: 404 })
  );
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = await readAttachmentForm(request);
  if (!parsed.ok) {
    const failure = formErrors[parsed.reason];
    return Response.json({ error: failure.error }, { status: failure.status });
  }
  const form = parsed.form;
  const projectValue = form.get('projectId');
  const taskValue = form.get('taskId');
  const projectId = typeof projectValue === 'string' ? projectValue.trim() : '';
  const taskId = typeof taskValue === 'string' ? taskValue.trim() : '';
  const file = attachmentFile(form.get('file'));
  if (!projectId || !taskId || !file.ok) {
    return Response.json(
      { error: 'Invalid attachment' },
      { status: !file.ok && file.reason === 'too_large' ? 413 : 400 },
    );
  }
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const attachment = await storeTaskAttachment({
    projectId,
    taskId,
    file: file.file,
    createdBy: user.id,
  });
  if (!attachment)
    return Response.json(
      { error: 'Attachment limit reached' },
      { status: 409 },
    );
  return Response.json({ attachment }, { status: 201 });
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!isJsonContentType(request))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const parsed = await readJsonObjectWithLimit(request);
  if (!parsed.ok)
    return Response.json(
      {
        error:
          parsed.reason === 'too_large' ? 'Payload too large' : 'Invalid JSON',
      },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  const body = parsed.body;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!projectId || !id || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const attachment = await deleteTaskAttachment(id, projectId);
  if (!attachment)
    return Response.json({ error: 'Not found' }, { status: 404 });
  await attachmentStorage().delete(attachment.objectKey);
  return Response.json({ ok: true });
}
