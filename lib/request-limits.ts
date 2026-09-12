export type LimitedTextBody =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable' };

export type LimitedJsonObject =
  | { ok: true; body: Record<string, unknown>; text: string }
  | {
      ok: false;
      reason: 'too_large' | 'unreadable' | 'invalid_json' | 'invalid_shape';
    };

export const DEFAULT_JSON_BODY_LIMIT = 64 * 1024;

export function isJsonContentType(request: Request): boolean {
  const value = request.headers.get('content-type');
  return Boolean(value && /^application\/json(?:\s*;|\s*$)/i.test(value));
}

export function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readTextBodyWithLimit(
  request: Request,
  maximumBytes: number,
): Promise<LimitedTextBody> {
  const declared = parseContentLength(request.headers.get('content-length'));
  if (declared !== null && declared > maximumBytes)
    return { ok: false, reason: 'too_large' };
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      text: new TextDecoder('utf-8', { fatal: true }).decode(body),
    };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export async function readJsonObjectWithLimit(
  request: Request,
  maximumBytes = DEFAULT_JSON_BODY_LIMIT,
): Promise<LimitedJsonObject> {
  const raw = await readTextBodyWithLimit(request, maximumBytes);
  if (!raw.ok) return raw;
  let body: unknown;
  try {
    body = JSON.parse(raw.text) as unknown;
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, reason: 'invalid_shape' };
  return { ok: true, body: body as Record<string, unknown>, text: raw.text };
}
