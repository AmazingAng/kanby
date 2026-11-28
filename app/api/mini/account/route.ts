import {
  getAuthConfig,
  getSessionUser,
  hasFreshAuthorizationClaims,
  isSameOriginMutation,
  sha256Base64Url,
} from '@/lib/auth';
import { database } from '@/lib/db';
import { notifyMember } from '@/lib/notifications';
import {
  MiniError,
  miniBody,
  miniFingerprint,
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
    const db = database();
    const row = await db
      .prepare(
        'SELECT id, subject_hash, created_at FROM mini_identities WHERE app_id=? AND user_id=?',
      )
      .bind(appId, user.id)
      .first<{ id: string; subject_hash: string; created_at: number }>();
    const sessions = row
      ? (
          await db
            .prepare(
              'SELECT rowid AS id, created_at, expires_at FROM mini_sessions WHERE identity_id=? AND expires_at>? ORDER BY created_at DESC, rowid DESC',
            )
            .bind(row.id, Date.now())
            .all<{ id: number; created_at: number; expires_at: number }>()
        ).results
      : [];
    return miniJson({
      linked: !!row,
      linkedAt: row?.created_at ?? null,
      fingerprint: row ? miniFingerprint(row.subject_hash) : null,
      lastLoginAt: sessions[0]?.created_at ?? null,
      sessions: sessions.map((session) => ({
        id: Number(session.id),
        createdAt: session.created_at,
        expiresAt: session.expires_at,
      })),
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
    const now = Date.now();
    if (body.preview === true) {
      // Lets the member compare the code's WeChat label with the one their
      // own mini program shows before anything is bound.
      const pair = await db
        .prepare(
          'SELECT subject_hash, expires_at FROM mini_pairs WHERE code_hash=? AND app_id=? AND expires_at>?',
        )
        .bind(hash, appId, now)
        .first<{ subject_hash: string; expires_at: number }>();
      if (!pair) throw new MiniError(409, '绑定码已失效，请在小程序重新获取');
      return miniJson({
        fingerprint: miniFingerprint(pair.subject_hash),
        expiresAt: pair.expires_at,
      });
    }
    const bound = await db
      .prepare(`INSERT OR IGNORE INTO mini_identities(id,app_id,subject_hash,user_id,created_at)
      SELECT ?,app_id,subject_hash,?,? FROM mini_pairs WHERE code_hash=? AND app_id=? AND expires_at>?
      RETURNING subject_hash`)
      .bind(crypto.randomUUID(), user.id, now, hash, appId, now)
      .first<{ subject_hash: string }>();
    if (!bound)
      throw new MiniError(409, '绑定码已失效或账号已绑定；请检查账号后重试');
    await db
      .prepare('DELETE FROM mini_pairs WHERE code_hash=?')
      .bind(hash)
      .run();
    const fingerprint = miniFingerprint(bound.subject_hash);
    await notifyMember(
      user.id,
      'account.mini_linked',
      [
        `[Kanby] 你的账号 @${user.login} 刚刚绑定了微信小程序登录（微信识别码 ${fingerprint}）。`,
        '如果不是你本人操作，请立即打开 Kanby 网页 /mini 解除绑定。',
      ].join('\n'),
    );
    return miniJson({ linked: true, fingerprint });
  });
}
export async function DELETE(request: Request) {
  return miniBoundary(async () => {
    const user = await browserUser(request, true);
    const { appId } = miniConfig();
    const db = database();
    const hasBody = Boolean((await request.clone().text()).trim());
    if (hasBody) {
      const body = await miniBody(request);
      if (!Number.isSafeInteger(body.sessionId) || Number(body.sessionId) < 1)
        throw new MiniError(400, '无效的请求参数');
      // Signs out one mini program session; the binding stays.
      await db
        .prepare(
          'DELETE FROM mini_sessions WHERE rowid=? AND identity_id IN (SELECT id FROM mini_identities WHERE app_id=? AND user_id=?)',
        )
        .bind(Number(body.sessionId), appId, user.id)
        .run();
      return miniJson({ linked: true });
    }
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
