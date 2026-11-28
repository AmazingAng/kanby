import {
  getAuthConfig,
  getSessionUser,
  hasFreshAuthorizationClaims,
  isSameOriginMutation,
  sha256Base64Url,
} from '@/lib/auth';
import { database } from '@/lib/db';
import {
  MiniError,
  miniBody,
  miniBoundary,
  miniConfig,
  miniJson,
  miniRateLimit,
  miniString,
} from '@/lib/weixin-mini';
export const dynamic = 'force-dynamic';
async function browserUser(request: Request, mutation = false) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (
    !config ||
    !user ||
    (mutation &&
      (!isSameOriginMutation(request, config) ||
        !hasFreshAuthorizationClaims(user)))
  )
    throw new MiniError(403, '请先在网页重新通过 GitHub 登录，再确认绑定');
  return user;
}
export async function GET(request: Request) {
  return miniBoundary(async () => {
    const user = await browserUser(request);
    const { appId } = miniConfig();
    const row = await database()
      .prepare(
        'SELECT created_at FROM mini_identities WHERE app_id=? AND user_id=?',
      )
      .bind(appId, user.id)
      .first<{ created_at: number }>();
    return miniJson({
      linked: !!row,
      linkedAt: row?.created_at ?? null,
      user: { login: user.login, name: user.name },
    });
  });
}
export async function POST(request: Request) {
  return miniBoundary(async () => {
    const user = await browserUser(request, true);
    const { appId } = miniConfig();
    const body = await miniBody(request);
    const code = miniString(body.pairingCode, 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(code))
      throw new MiniError(400, '无效的绑定码');
    await miniRateLimit(`bind:${user.id}`, 10);
    const hash = await sha256Base64Url(code);
    const db = database();
    const result = await db
      .prepare(`INSERT OR IGNORE INTO mini_identities(id,app_id,subject_hash,user_id,created_at)
      SELECT ?,app_id,subject_hash,?,? FROM mini_pairs WHERE code_hash=? AND app_id=? AND expires_at>?`)
      .bind(crypto.randomUUID(), user.id, Date.now(), hash, appId, Date.now())
      .run();
    if (!result.meta.changes)
      throw new MiniError(409, '绑定码已失效或账号已绑定；请检查账号后重试');
    await db
      .prepare('DELETE FROM mini_pairs WHERE code_hash=?')
      .bind(hash)
      .run();
    return miniJson({ linked: true });
  });
}
export async function DELETE(request: Request) {
  return miniBoundary(async () => {
    const user = await browserUser(request, true);
    const { appId } = miniConfig();
    const db = database();
    await db.batch([
      db
        .prepare(
          'DELETE FROM mini_sessions WHERE identity_id IN (SELECT id FROM mini_identities WHERE app_id=? AND user_id=?)',
        )
        .bind(appId, user.id),
      db
        .prepare(
          'DELETE FROM mini_pairs WHERE app_id=? AND subject_hash IN (SELECT subject_hash FROM mini_identities WHERE app_id=? AND user_id=?)',
        )
        .bind(appId, appId, user.id),
      db
        .prepare('DELETE FROM mini_identities WHERE app_id=? AND user_id=?')
        .bind(appId, user.id),
    ]);
    return miniJson({ linked: false });
  });
}
