import {
  countTaskAttachments,
  createTaskAttachment,
  MAX_ATTACHMENTS_PER_TASK,
  type StoredTaskAttachment,
  type TaskAttachmentRecord,
} from '@/lib/db';
import { parseContentLength } from '@/lib/request-limits';
import { attachmentStorage } from '@/lib/storage';

export { MAX_ATTACHMENTS_PER_TASK };
export const MAX_ATTACHMENT_FILE_SIZE = 10 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 240;
const SAFE_INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
]);

export function normalizedContentType(value: string) {
  const contentType = value.trim().toLowerCase();
  return contentType.length <= 120 &&
    /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
    ? contentType
    : 'application/octet-stream';
}

export function attachmentContentDisposition(
  fileName: string,
  contentType: string,
) {
  const fallback =
    fileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 120) || 'attachment';
  const behavior = SAFE_INLINE_TYPES.has(contentType.toLowerCase())
    ? 'inline'
    : 'attachment';
  return `${behavior}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export type AttachmentFormResult =
  | { ok: true; form: FormData }
  | {
      ok: false;
      reason: 'form_required' | 'length_required' | 'too_large' | 'invalid';
    };

/** Validates the multipart envelope shared by every attachment upload route. */
export async function readAttachmentForm(
  request: Request,
): Promise<AttachmentFormResult> {
  if (
    !/^multipart\/form-data(?:\s*;|\s*$)/i.test(
      request.headers.get('content-type') ?? '',
    )
  )
    return { ok: false, reason: 'form_required' };
  const contentLength = parseContentLength(
    request.headers.get('content-length'),
  );
  if (contentLength === null) return { ok: false, reason: 'length_required' };
  if (contentLength > MAX_ATTACHMENT_FILE_SIZE + MAX_MULTIPART_OVERHEAD)
    return { ok: false, reason: 'too_large' };
  try {
    return { ok: true, form: await request.formData() };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export type AttachmentFileResult =
  | { ok: true; file: File }
  | { ok: false; reason: 'invalid' | 'too_large' };

export function attachmentFile(
  value: FormDataEntryValue | null,
): AttachmentFileResult {
  if (!(value instanceof File) || value.size === 0)
    return { ok: false, reason: 'invalid' };
  if (value.size > MAX_ATTACHMENT_FILE_SIZE)
    return { ok: false, reason: 'too_large' };
  if (!value.name || value.name.length > MAX_FILE_NAME_LENGTH)
    return { ok: false, reason: 'invalid' };
  return { ok: true, file: value };
}

/**
 * Stores the object and its database row. Returns null when the task already
 * holds the maximum number of attachments; the object is removed in that case.
 */
export async function storeTaskAttachment(input: {
  projectId: string;
  taskId: string;
  file: File;
  createdBy: string;
  metadata?: Record<string, string>;
}): Promise<TaskAttachmentRecord | null> {
  if (
    (await countTaskAttachments(input.taskId, input.projectId)) >=
    MAX_ATTACHMENTS_PER_TASK
  )
    return null;
  const objectKey = `${input.projectId}/${input.taskId}/${crypto.randomUUID()}`;
  const contentType = normalizedContentType(input.file.type);
  const bucket = attachmentStorage();
  await bucket.put(objectKey, input.file.stream(), {
    httpMetadata: { contentType },
    customMetadata: {
      ...input.metadata,
      taskId: input.taskId,
      uploadedBy: input.createdBy,
    },
  });
  try {
    const attachment = await createTaskAttachment({
      projectId: input.projectId,
      taskId: input.taskId,
      objectKey,
      fileName: input.file.name,
      contentType,
      size: input.file.size,
      createdBy: input.createdBy,
    });
    if (!attachment) await bucket.delete(objectKey);
    return attachment;
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
}

export async function attachmentDownloadResponse(
  attachment: StoredTaskAttachment,
): Promise<Response | null> {
  const object = await attachmentStorage().get(attachment.objectKey);
  if (!object?.body) return null;
  return new Response(object.body, {
    headers: {
      'Content-Type': attachment.contentType || 'application/octet-stream',
      'Content-Length': String(object.size),
      'Content-Disposition': attachmentContentDisposition(
        attachment.name,
        attachment.contentType,
      ),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
