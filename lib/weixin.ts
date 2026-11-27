import { database, ensureSchema } from '@/lib/db';
import {
  openCredential,
  sealCredential,
  weixinCredentialsConfigured,
} from '@/lib/weixin-crypto';
import {
  getUpdates,
  ILINK_DEFAULT_BASE_URL,
  ILINK_SESSION_EXPIRED,
  ILinkError,
  pollLoginStatus,
  requestLoginQrcode,
  sendText,
} from '@/lib/weixin-ilink';

/**
 * Hosted WeChat (iLink) binding for one member. Life cycle:
 * QR login → `pending` (no context token yet) → member messages the bot →
 * `active` → `expired` when iLink rejects the bot token.
 */
export type WeixinStatus = 'pending' | 'active' | 'expired';

export type WeixinAccountView = {
  status: WeixinStatus;
  activatedAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
};

type AccountRow = {
  user_id: string;
  ilink_bot_id: string;
  ilink_user_enc: string;
  bot_token_enc: string;
  context_token_enc: string | null;
  base_url: string;
  updates_buf: string | null;
  status: WeixinStatus;
  last_error: string | null;
  activated_at: number | null;
  last_synced_at: number | null;
};

const LOGIN_TTL_MS = 5 * 60_000;

export class WeixinUnavailableError extends Error {
  constructor() {
    super('WeChat hosting is not configured on this server');
  }
}

function requireConfigured() {
  if (!weixinCredentialsConfigured()) throw new WeixinUnavailableError();
}

async function accountRow(userId: string) {
  await ensureSchema();
  return database()
    .prepare(
      `SELECT user_id, ilink_bot_id, ilink_user_enc, bot_token_enc, context_token_enc, base_url, updates_buf,
              status, last_error, activated_at, last_synced_at
       FROM weixin_accounts WHERE user_id = ?`,
    )
    .bind(userId)
    .first<AccountRow>();
}

function view(row: AccountRow | null): WeixinAccountView | null {
  return row
    ? {
        status: row.status,
        activatedAt: row.activated_at,
        lastSyncedAt: row.last_synced_at,
        lastError: row.last_error,
      }
    : null;
}

export async function getWeixinAccount(userId: string) {
  return view(await accountRow(userId));
}

export function weixinEnabled() {
  return weixinCredentialsConfigured();
}

// --- Binding -----------------------------------------------------------------

export async function startWeixinLogin(userId: string) {
  requireConfigured();
  await ensureSchema();
  const { qrcode, content } = await requestLoginQrcode();
  const id = crypto.randomUUID();
  const db = database();
  await db.batch([
    db
      .prepare('DELETE FROM weixin_logins WHERE user_id = ? OR expires_at < ?')
      .bind(userId, Date.now()),
    db
      .prepare(
        'INSERT INTO weixin_logins (id, user_id, qrcode, base_url, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        userId,
        qrcode,
        ILINK_DEFAULT_BASE_URL,
        Date.now() + LOGIN_TTL_MS,
      ),
  ]);
  return { loginId: id, qrcodeContent: content };
}

export type LoginProgress =
  | 'wait'
  | 'scaned'
  | 'need_verifycode'
  | 'expired'
  | 'blocked'
  | 'already_bound'
  | 'confirmed';

export async function checkWeixinLogin(
  userId: string,
  loginId: string,
  verifyCode?: string,
  timeoutMs?: number,
): Promise<LoginProgress> {
  requireConfigured();
  await ensureSchema();
  const db = database();
  const login = await db
    .prepare(
      'SELECT qrcode, base_url, expires_at FROM weixin_logins WHERE id = ? AND user_id = ?',
    )
    .bind(loginId, userId)
    .first<{ qrcode: string; base_url: string; expires_at: number }>();
  if (!login || login.expires_at < Date.now()) return 'expired';
  const result = await pollLoginStatus(
    login.base_url,
    login.qrcode,
    verifyCode,
    timeoutMs,
  );
  switch (result.status) {
    case 'redirect':
      await db
        .prepare('UPDATE weixin_logins SET base_url = ? WHERE id = ?')
        .bind(result.baseUrl, loginId)
        .run();
      return 'scaned';
    case 'verify_code_blocked':
      return 'blocked';
    case 'binded_redirect':
      return 'already_bound';
    case 'expired':
      await db
        .prepare('DELETE FROM weixin_logins WHERE id = ?')
        .bind(loginId)
        .run();
      return 'expired';
    case 'confirmed': {
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            `INSERT INTO weixin_accounts (user_id, ilink_bot_id, ilink_user_enc, bot_token_enc, context_token_enc, base_url, updates_buf, status, last_error, activated_at, last_synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, NULL, ?, NULL, 'pending', NULL, NULL, NULL, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               ilink_bot_id = excluded.ilink_bot_id, ilink_user_enc = excluded.ilink_user_enc,
               bot_token_enc = excluded.bot_token_enc, context_token_enc = NULL,
               base_url = excluded.base_url, updates_buf = NULL, status = 'pending',
               last_error = NULL, activated_at = NULL, last_synced_at = NULL, updated_at = excluded.updated_at`,
          )
          .bind(
            userId,
            result.botId,
            await sealCredential(userId, 'ilink_user', result.ilinkUserId),
            await sealCredential(userId, 'bot_token', result.botToken),
            result.baseUrl,
            now,
            now,
          ),
        db.prepare('DELETE FROM weixin_logins WHERE user_id = ?').bind(userId),
      ]);
      return 'confirmed';
    }
    default:
      return result.status;
  }
}

export async function unbindWeixin(userId: string) {
  await ensureSchema();
  const db = database();
  await db.batch([
    db.prepare('DELETE FROM weixin_accounts WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM weixin_logins WHERE user_id = ?').bind(userId),
  ]);
}

// --- Sync and send -----------------------------------------------------------

function errorText(error: unknown) {
  if (error instanceof ILinkError) return error.message;
  if (error instanceof Error) return error.name;
  return 'unknown error';
}

async function markFailure(userId: string, error: unknown) {
  const expired =
    error instanceof ILinkError && error.code === ILINK_SESSION_EXPIRED;
  await database()
    .prepare(
      `UPDATE weixin_accounts SET last_error = ?, status = CASE WHEN ? = 1 THEN 'expired' ELSE status END, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(errorText(error).slice(0, 200), expired ? 1 : 0, Date.now(), userId)
    .run();
}

/**
 * Pull pending messages from the member's bot. Messages from the member keep
 * the conversation's context token fresh, which iLink requires for sending.
 */
export async function syncWeixin(userId: string, timeoutMs = 10_000) {
  requireConfigured();
  const row = await accountRow(userId);
  if (!row || row.status === 'expired') return view(row);
  const [token, ilinkUserId] = await Promise.all([
    openCredential(userId, 'bot_token', row.bot_token_enc),
    openCredential(userId, 'ilink_user', row.ilink_user_enc),
  ]);
  try {
    const updates = await getUpdates({
      baseUrl: row.base_url,
      token,
      cursor: row.updates_buf,
      timeoutMs,
    });
    const latest = updates.messages
      .filter(
        (message) => message.fromUserId === ilinkUserId && message.contextToken,
      )
      .at(-1);
    const now = Date.now();
    await database()
      .prepare(
        `UPDATE weixin_accounts SET updates_buf = ?, last_synced_at = ?, last_error = NULL, updated_at = ?,
           context_token_enc = COALESCE(?, context_token_enc),
           status = CASE WHEN ? IS NOT NULL THEN 'active' ELSE status END,
           activated_at = CASE WHEN ? IS NOT NULL AND activated_at IS NULL THEN ? ELSE activated_at END
         WHERE user_id = ?`,
      )
      .bind(
        updates.cursor,
        now,
        now,
        latest?.contextToken
          ? await sealCredential(userId, 'context_token', latest.contextToken)
          : null,
        latest?.contextToken ?? null,
        latest?.contextToken ?? null,
        now,
        userId,
      )
      .run();
  } catch (error) {
    await markFailure(userId, error);
  }
  return getWeixinAccount(userId);
}

/** Send a text to the member's own WeChat. Returns null on success, else an error. */
export async function sendWeixinText(userId: string, text: string) {
  if (!weixinCredentialsConfigured()) return 'not configured';
  const row = await accountRow(userId);
  if (!row || row.status !== 'active' || !row.context_token_enc)
    return 'not active';
  try {
    const [token, ilinkUserId, contextToken] = await Promise.all([
      openCredential(userId, 'bot_token', row.bot_token_enc),
      openCredential(userId, 'ilink_user', row.ilink_user_enc),
      openCredential(userId, 'context_token', row.context_token_enc),
    ]);
    await sendText({
      baseUrl: row.base_url,
      token,
      to: ilinkUserId,
      contextToken,
      text,
    });
    return null;
  } catch (error) {
    await markFailure(userId, error);
    return errorText(error);
  }
}

/** Members whose WeChat binding can currently receive messages. */
export async function activeWeixinUsers(userIds: string[]) {
  if (!weixinCredentialsConfigured() || userIds.length === 0)
    return new Set<string>();
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT user_id FROM weixin_accounts WHERE status = 'active' AND context_token_enc IS NOT NULL
       AND user_id IN (${userIds.map(() => '?').join(', ')})`,
    )
    .bind(...userIds)
    .all<{ user_id: string }>();
  return new Set(result.results.map((row) => row.user_id));
}
