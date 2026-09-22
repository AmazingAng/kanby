const encoder = new TextEncoder();
const LIMIT = 1024 * 1024;
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hash = async (text) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

export async function migrationFetch(request, env) {
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);
  const secret = env.KANBY_MIGRATION_TOKEN;
  const expires = Number(env.KANBY_MIGRATION_EXPIRES);
  if (
    typeof secret !== 'string' ||
    secret.length < 64 ||
    !Number.isFinite(expires) ||
    expires <= Date.now()
  )
    return json({ error: 'Forbidden' }, 403);
  const supplied = request.headers.get('authorization') || '';
  const left = await hash(`Bearer ${secret}`);
  const right = await hash(supplied);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  if (difference) return json({ error: 'Forbidden' }, 403);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'JSON required' }, 400);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMIT) {
      await reader.cancel();
      return json({ error: 'Payload too large' }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json({ error: 'Invalid input' }, 400);
  if (typeof body.query === 'string') {
    if (!/^SELECT\s/i.test(body.query) || body.query.includes(';'))
      return json({ error: 'Single SELECT required' }, 400);
    try {
      return json({
        results: (await env.DB.prepare(body.query).all()).results,
      });
    } catch {
      return json({ error: 'Verification query failed' }, 500);
    }
  }
  if (
    typeof body.id !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,120}$/.test(body.id) ||
    !Array.isArray(body.statements) ||
    !body.statements.length ||
    body.statements.length > 40 ||
    body.statements.some((s) => typeof s !== 'string' || !s.trim())
  )
    return json({ error: 'Invalid import batch' }, 400);
  const digest = [...(await hash(JSON.stringify(body.statements)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS __kanby_imports (id TEXT PRIMARY KEY, digest TEXT NOT NULL)',
    ).run();
    const existing = await env.DB.prepare(
      'SELECT digest FROM __kanby_imports WHERE id = ?',
    )
      .bind(body.id)
      .first();
    if (existing)
      return json(
        existing.digest === digest
          ? { ok: true, replay: true }
          : { error: 'Import ID conflict' },
        existing.digest === digest ? 200 : 409,
      );
    await env.DB.batch([
      ...body.statements.map((sql) => env.DB.prepare(sql)),
      env.DB.prepare(
        'INSERT INTO __kanby_imports (id, digest) VALUES (?, ?)',
      ).bind(body.id, digest),
    ]);
    return json({ ok: true, count: body.statements.length });
  } catch {
    return json({ error: 'Migration batch failed' }, 500);
  }
}
