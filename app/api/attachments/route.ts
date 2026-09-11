import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  countTaskAttachments,
  createTaskAttachment,
  deleteTaskAttachment,
  getProjectRole,
  getTaskAttachment,
  taskBelongsToProject,
} from '@/lib/db';
import { attachmentStorage } from '@/lib/storage';
import { parseContentLength } from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_TASK = 10;

function contentDisposition(fileName: string, contentType: string) {
  const fallback =
    fileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 120) || 'attachment';
  const safeInlineTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
  ]);
  const behavior = safeInlineTypes.has(contentType.toLowerCase())
    ? 'inline'
    : 'attachment';
  return `${behavior}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!user || !id)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const attachment = await getTaskAttachment(id);
  if (!attachment || !(await getProjectRole(attachment.projectId, user.id)))
    return Response.json({ error: 'Not found' }, { status: 404 });
  const object = await attachmentStorage().get(attachment.objectKey);
  if (!object?.body)
    return Response.json({ error: 'Not found' }, { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': contentDisposition(
        attachment.name,
        attachment.contentType,
      ),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const contentLength = parseContentLength(
    request.headers.get('content-length'),
  );
  if (contentLength === null)
    return Response.json({ error: 'Content-Length required' }, { status: 411 });
  if (contentLength > MAX_FILE_SIZE + 1024 * 1024)
    return Response.json({ error: 'File too large' }, { status: 413 });
  const form = await request.formData();
  const projectValue = form.get('projectId');
  const taskValue = form.get('taskId');
  const projectId = typeof projectValue === 'string' ? projectValue.trim() : '';
  const taskId = typeof taskValue === 'string' ? taskValue.trim() : '';
  const file = form.get('file');
  if (
    !projectId ||
    !taskId ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > MAX_FILE_SIZE ||
    file.name.length > 240
  ) {
    return Response.json(
      { error: 'Invalid attachment' },
      { status: file instanceof File && file.size > MAX_FILE_SIZE ? 413 : 400 },
    );
  }
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (
    (await countTaskAttachments(taskId, projectId)) >= MAX_ATTACHMENTS_PER_TASK
  )
    return Response.json(
      { error: 'Attachment limit reached' },
      { status: 409 },
    );

  const objectKey = `${projectId}/${taskId}/${crypto.randomUUID()}`;
  const contentType = file.type || 'application/octet-stream';
  const bucket = attachmentStorage();
  await bucket.put(objectKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { taskId, uploadedBy: user.id },
  });
  try {
    const attachment = await createTaskAttachment({
      projectId,
      taskId,
      objectKey,
      fileName: file.name,
      contentType,
      size: file.size,
      createdBy: user.id,
    });
    if (!attachment) {
      await bucket.delete(objectKey);
      return Response.json(
        { error: 'Attachment limit reached' },
        { status: 409 },
      );
    }
    return Response.json({ attachment }, { status: 201 });
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as { projectId?: unknown; id?: unknown };
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
