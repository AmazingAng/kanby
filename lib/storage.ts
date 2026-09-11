import { env } from 'cloudflare:workers';

type StorageBindings = { ATTACHMENTS?: R2Bucket };

export function attachmentStorage(): R2Bucket {
  const bucket = (env as unknown as StorageBindings).ATTACHMENTS;
  if (!bucket) throw new Error('R2 binding ATTACHMENTS is unavailable');
  return bucket;
}
