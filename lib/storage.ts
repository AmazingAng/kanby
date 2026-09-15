import { env } from 'cloudflare:workers';

type StorageBindings = {
  ATTACHMENTS_APAC?: R2Bucket;
  ATTACHMENTS?: R2Bucket;
};

export function attachmentStorage(): R2Bucket {
  const bindings = env as unknown as StorageBindings;
  const bucket = bindings.ATTACHMENTS_APAC ?? bindings.ATTACHMENTS;
  if (!bucket) {
    throw new Error('R2 binding ATTACHMENTS_APAC or ATTACHMENTS is unavailable');
  }
  return bucket;
}
