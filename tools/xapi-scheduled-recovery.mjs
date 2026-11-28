const encoder = new TextEncoder();
const deny = () => Response.json({ error: 'Forbidden' }, { status: 403 });
export async function scheduledRecovery(request, env, context, application) {
  if (request.method !== 'POST' || !env.GITHUB_WEBHOOK_SECRET) return deny();
  const reader = request.body?.getReader();
  if (!reader) return deny();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      return deny();
    }
    chunks.push(value);
  }
  const bytesIn = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytesIn.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytesIn);
  let signature;
  let timestamp;
  try {
    ({ signature, timestamp } = JSON.parse(text) ?? {});
  } catch {
    return deny();
  }
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return deny();
  // A static schedule body (the old constant `kanby-recovery-v1` signature) is
  // replayable forever, so only fresh timestamped signatures are accepted.
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > 5 * 60 * 1000
  )
    return deny();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.GITHUB_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const bytes = Uint8Array.from(signature.slice(7).match(/../g), (part) =>
    Number.parseInt(part, 16),
  );
  const body = `kanby-recovery-v2:${timestamp}`;
  if (!(await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(body))))
    return deny();
  return application.fetch(
    new Request('https://kanby.internal/api/github/recovery', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-kanby-scheduled': '1',
        'x-kanby-signature': signature,
      },
      body,
    }),
    env,
    context,
  );
}
