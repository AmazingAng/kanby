import { env } from 'cloudflare:workers';
import { randomToken, sha256Base64Url, type AuthUser } from '@/lib/auth';
import { database } from '@/lib/db';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export class MiniError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function miniConfig() {
  const bindings = env as unknown as {
    WEIXIN_MINI_APP_ID?: string;
    WEIXIN_MINI_APP_SECRET?: string;
  };
  const appId = bindings.WEIXIN_MINI_APP_ID?.trim();
  const secret = bindings.WEIXIN_MINI_APP_SECRET?.trim();
  if (!appId || !/^wx[a-fA-F0-9]{16}$/.test(appId) || !secret)
    throw new MiniError(503, '微信小程序尚未配置');
  return { appId, secret };
}
/**
 * A short, non-secret label for one WeChat identity (derived from the salted
 * subject hash). The mini program shows it next to the pairing code and the
 * browser shows it before confirming, so a member can tell whether a code
 * really comes from their own WeChat.
 */
export function miniFingerprint(subjectHash: string) {
  const value = subjectHash
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}
export function miniJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function miniBoundary(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    return miniJson(
      {
        error:
          error instanceof MiniError
            ? error.message
            : '小程序请求失败，请稍后重试',
      },
      error instanceof MiniError ? error.status : 500,
    );
  }
}
export async function miniBody(request: Request) {
  if (!isJsonContentType(request)) throw new MiniError(415, '需要 JSON 请求');
  const parsed = await readJsonObjectWithLimit(request, 8192);
  if (!parsed.ok)
    throw new MiniError(
      parsed.reason === 'too_large' ? 413 : 400,
      '无效的请求内容',
    );
  return parsed.body;
}
export function miniString(value: unknown, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new MiniError(400, '无效的请求参数');
  return value.trim();
}
export async function miniRateLimit(
  key: string,
  maximum: number,
  window = 60000,
) {
  const now = Date.now();
  const bucket = await sha256Base64Url(key);
  await database()
    .prepare('DELETE FROM mini_limits WHERE expires_at <= ?')
    .bind(now)
    .run();
  const row = await database()
    .prepare(`INSERT INTO mini_limits(bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`)
    .bind(bucket, now + window)
    .first<{ attempts: number }>();
  if (!row || row.attempts > maximum)
    throw new MiniError(429, '操作过于频繁，请稍后重试');
}
export async function miniLogin(request: Request, code: string) {
  const { appId, secret } = miniConfig();
  await miniRateLimit(
    `login:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`,
    10,
  );
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({
    appid: appId,
    secret,
    js_code: code,
    grant_type: 'authorization_code',
  }).toString();
  let identity: Record<string, unknown>;
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Provider status');
    const parsed = await readJsonObjectWithLimit(
      new Request('https://mini-response.invalid', {
        method: 'POST',
        body: response.body,
        duplex: 'half',
      } as RequestInit),
      8192,
    );
    if (!parsed.ok) throw new Error('Provider JSON');
    identity = parsed.body;
    if (
      (identity.errcode !== undefined && identity.errcode !== 0) ||
      typeof identity.openid !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(identity.openid)
    )
      throw new Error('Provider identity');
  } catch {
    throw new MiniError(502, '微信登录失败，请重新登录');
  }
  const subject = await sha256Base64Url(`${appId}:${identity.openid}`);
  await miniRateLimit(`identity:${subject}`, 10);
  const db = database();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM mini_pairs WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM mini_sessions WHERE expires_at <= ?').bind(now),
  ]);
  const linked = await db
    .prepare('SELECT id FROM mini_identities WHERE app_id=? AND subject_hash=?')
    .bind(appId, subject)
    .first<{ id: string }>();
  if (!linked) {
    const pairingCode = randomToken();
    const expiresAt = now + 5 * 60000;
    await db
      .prepare(`INSERT INTO mini_pairs(code_hash,app_id,subject_hash,expires_at) VALUES (?,?,?,?)
      ON CONFLICT(app_id,subject_hash) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at`)
      .bind(await sha256Base64Url(pairingCode), appId, subject, expiresAt)
      .run();
    return miniJson({
      status: 'unlinked',
      pairingCode,
      expiresAt,
      fingerprint: miniFingerprint(subject),
    });
  }
  const token = `km_${randomToken()}`;
  const expiresAt = now + 7 * 86400000;
  // Sessions reference a binding generation: unlink/relink cannot resurrect them.
  const issued = await db.batch([
    db
      .prepare(`DELETE FROM mini_sessions WHERE identity_id=? AND token_hash NOT IN
      (SELECT token_hash FROM mini_sessions WHERE identity_id=? ORDER BY created_at DESC, rowid DESC LIMIT 4)`)
      .bind(linked.id, linked.id),
    db
      .prepare(`INSERT INTO mini_sessions(token_hash,identity_id,created_at,expires_at)
      SELECT ?,id,?,? FROM mini_identities WHERE id=?`)
      .bind(await sha256Base64Url(token), now, expiresAt, linked.id),
  ]);
  if (issued[1].meta.changes !== 1)
    throw new MiniError(409, '绑定已变化，请重新登录');
  return miniJson({ status: 'linked', token, expiresAt });
}
export function miniBearer(request: Request) {
  const value = request.headers.get('Authorization') ?? '';
  if (!/^Bearer km_[A-Za-z0-9_-]{43}$/.test(value))
    throw new MiniError(401, '请重新登录小程序');
  return value.slice(7);
}
export async function miniUser(request: Request): Promise<AuthUser> {
  const { appId } = miniConfig();
  const hash = await sha256Base64Url(miniBearer(request));
  const user = await database()
    .prepare(`SELECT u.id,u.login,u.name,u.avatar_url AS avatarUrl
    FROM mini_sessions s JOIN mini_identities i ON i.id=s.identity_id JOIN users u ON u.id=i.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND i.app_id=?`)
    .bind(hash, Date.now(), appId)
    .first<AuthUser>();
  if (!user) throw new MiniError(401, '登录已过期或解绑，请重新登录');
  return user;
}
export async function miniLogout(request: Request) {
  await database()
    .prepare('DELETE FROM mini_sessions WHERE token_hash=?')
    .bind(await sha256Base64Url(miniBearer(request)))
    .run();
  return miniJson({ ok: true });
}
