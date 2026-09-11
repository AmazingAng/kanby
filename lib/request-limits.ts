export type LimitedTextBody =
  | { ok: true; text: string }
  | { ok: false; reason: 'too_large' | 'unreadable' };

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
  return { ok: true, text: new TextDecoder().decode(body) };
}
