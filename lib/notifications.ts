import { env } from 'cloudflare:workers';

import { database, ensureSchema } from '@/lib/db';
import { recoverySnapshot } from '@/lib/recovery';

export type NotificationKind = 'feishu' | 'wecom';
export type NotificationEventKind =
  | 'turn.changed'
  | 'turn.rejected'
  | 'mention';

export type NotificationChannelRecord = {
  id: string;
  scope: 'project' | 'member';
  userId: string | null;
  kind: NotificationKind;
  target: string;
  signed: boolean;
  enabled: boolean;
  updatedAt: number;
  /** Stored with another key (e.g. after rotation): never sent, only deletable. */
  unreadable?: boolean;
};

type ChannelRow = {
  id: string;
  project_id: string;
  user_id: string | null;
  kind: NotificationKind;
  webhook_url: string;
  secret: string | null;
  enabled: number;
  updated_at: number;
};

const WEBHOOK_TIMEOUT_MS = 4_000;
const ALLOWED_HOSTS: Record<NotificationKind, string[]> = {
  feishu: ['open.feishu.cn', 'open.larksuite.com'],
  wecom: ['qyapi.weixin.qq.com'],
};
const ALLOWED_PATHS: Record<NotificationKind, RegExp> = {
  feishu: /^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,128}$/,
  wecom: /^\/cgi-bin\/webhook\/send$/,
};

export function isNotificationKind(value: unknown): value is NotificationKind {
  return value === 'feishu' || value === 'wecom';
}

/** Only official bot endpoints are accepted, so a webhook cannot be used for SSRF. */
export function validateWebhookUrl(kind: NotificationKind, value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !ALLOWED_HOSTS[kind].includes(url.hostname) ||
    !ALLOWED_PATHS[kind].test(url.pathname)
  )
    return null;
  if (kind === 'wecom') {
    const key = url.searchParams.get('key') ?? '';
    if (
      !/^[A-Za-z0-9-]{8,128}$/.test(key) ||
      [...url.searchParams].length !== 1
    )
      return null;
  } else if (url.search) return null;
  return url.toString();
}

/** A recognizable but non-secret description of a webhook. */
export function maskWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    const secretPart =
      url.searchParams.get('key') ?? url.pathname.split('/').at(-1) ?? '';
    return `${url.hostname} …${secretPart.slice(-4)}`;
  } catch {
    return 'invalid webhook';
  }
}

// --- Secrets at rest -----------------------------------------------------------

const SEALED = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const sealContext = (channelId: string) => `notification-channel:${channelId}`;

/**
 * Bot webhook URLs embed their bot key, and Feishu signing secrets are
 * credentials, so both are sealed with the same AES-GCM key as the hosted
 * WeChat credentials (WEIXIN_CREDENTIAL_KEY), bound to the channel id and
 * field. Without that key (self-hosting), values stay in plaintext.
 */
async function sealChannelField(
  channelId: string,
  field: 'webhook_url' | 'secret',
  value: string,
) {
  const { sealCredential, weixinCredentialsConfigured } =
    await import('@/lib/weixin-crypto');
  return weixinCredentialsConfigured()
    ? sealCredential(sealContext(channelId), field, value)
    : value;
}

async function openChannelField(
  channelId: string,
  field: 'webhook_url' | 'secret',
  value: string | null,
) {
  if (value === null || !SEALED.test(value)) return value;
  const { openCredential } = await import('@/lib/weixin-crypto');
  return openCredential(sealContext(channelId), field, value);
}

/**
 * Decrypts stored channels. Rows still in plaintext (created before
 * encryption) are re-sealed in place when the key is configured; a row that
 * cannot be decrypted (wrong or missing key) is skipped, never sent.
 */
async function openChannels(rows: ChannelRow[]): Promise<ChannelRow[]> {
  return (await openChannelsWithFailures(rows)).filter(
    (row): row is ChannelRow => !('unreadable' in row),
  );
}

async function openChannelsWithFailures(
  rows: ChannelRow[],
): Promise<(ChannelRow | (ChannelRow & { unreadable: true }))[]> {
  return Promise.all(
    rows.map(async (row) => {
      try {
        const channel = {
          ...row,
          webhook_url: (await openChannelField(
            row.id,
            'webhook_url',
            row.webhook_url,
          ))!,
          secret: await openChannelField(row.id, 'secret', row.secret),
        };
        if (!SEALED.test(row.webhook_url))
          await resealChannel(row, channel).catch((error: unknown) =>
            console.error('Kanby channel re-encryption failed', error),
          );
        return channel;
      } catch {
        console.error(`Kanby channel ${row.id} could not be decrypted`);
        return { ...row, unreadable: true as const };
      }
    }),
  );
}

async function resealChannel(stored: ChannelRow, plain: ChannelRow) {
  const webhookUrl = await sealChannelField(
    plain.id,
    'webhook_url',
    plain.webhook_url,
  );
  if (webhookUrl === plain.webhook_url) return;
  const secret =
    plain.secret === null
      ? null
      : await sealChannelField(plain.id, 'secret', plain.secret);
  await database()
    .prepare(
      'UPDATE notification_channels SET webhook_url = ?, secret = ? WHERE id = ? AND webhook_url = ? AND secret IS ?',
    )
    .bind(webhookUrl, secret, stored.id, stored.webhook_url, stored.secret)
    .run();
}

function mapChannel(
  row: ChannelRow & { unreadable?: true },
): NotificationChannelRecord {
  if (row.unreadable)
    return {
      id: row.id,
      scope: row.user_id ? 'member' : 'project',
      userId: row.user_id,
      kind: row.kind,
      target: '无法读取，请删除后重新添加',
      signed: false,
      enabled: false,
      updatedAt: Number(row.updated_at),
      unreadable: true,
    };
  return {
    id: row.id,
    scope: row.user_id ? 'member' : 'project',
    userId: row.user_id,
    kind: row.kind,
    target: maskWebhookUrl(row.webhook_url),
    signed: Boolean(row.secret),
    enabled: Boolean(row.enabled),
    updatedAt: Number(row.updated_at),
  };
}

export async function listNotificationChannels(
  projectId: string,
  viewerUserId: string,
) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `SELECT id, project_id, user_id, kind, webhook_url, secret, enabled, updated_at
       FROM notification_channels
       WHERE project_id = ? AND (user_id IS NULL OR user_id = ?)
       ORDER BY user_id IS NOT NULL, created_at`,
    )
    .bind(projectId, viewerUserId)
    .all<ChannelRow>();
  // Unreadable channels are listed (and still count toward the per-scope
  // limit) so they can be deleted and the bot added again.
  return (await openChannelsWithFailures(result.results)).map(mapChannel);
}

const MAX_CHANNELS_PER_SCOPE = 3;

export async function createNotificationChannel(input: {
  projectId: string;
  userId: string | null;
  kind: NotificationKind;
  webhookUrl: string;
  secret: string | null;
  createdBy: string;
}) {
  await ensureSchema();
  const id = crypto.randomUUID();
  const now = Date.now();
  const inserted = await database()
    .prepare(
      `INSERT INTO notification_channels (id, project_id, user_id, kind, webhook_url, secret, enabled, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM notification_channels WHERE project_id = ? AND user_id IS ?) < ?`,
    )
    .bind(
      id,
      input.projectId,
      input.userId,
      input.kind,
      await sealChannelField(id, 'webhook_url', input.webhookUrl),
      input.secret === null
        ? null
        : await sealChannelField(id, 'secret', input.secret),
      input.createdBy,
      now,
      now,
      input.projectId,
      input.userId,
      MAX_CHANNELS_PER_SCOPE,
    )
    .run();
  if (Number(inserted.meta.changes ?? 0) === 0) return null;
  return mapChannel({
    id,
    project_id: input.projectId,
    user_id: input.userId,
    kind: input.kind,
    webhook_url: input.webhookUrl,
    secret: input.secret,
    enabled: 1,
    updated_at: now,
  });
}

/** Members delete their own channel; project owners also delete project channels. */
export async function deleteNotificationChannel(input: {
  projectId: string;
  channelId: string;
  userId: string;
  isOwner: boolean;
}) {
  await ensureSchema();
  const result = await database()
    .prepare(
      `DELETE FROM notification_channels
       WHERE id = ? AND project_id = ? AND (user_id = ? OR (user_id IS NULL AND ? = 1))`,
    )
    .bind(input.channelId, input.projectId, input.userId, input.isOwner ? 1 : 0)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

// --- Message formatting ------------------------------------------------------

export type TaskNotification = {
  projectId: string;
  projectSlug: string | null;
  taskId: string;
  taskRef: string;
  taskTitle: string;
  kind: NotificationEventKind;
  actorName: string;
  /** Member who caused the event (the token's member for agents). */
  actorId?: string;
  recipients: { userId: string; name: string }[];
  reasonLabel: string | null;
  note: string | null;
};

function publicOrigin() {
  const runtime = env as unknown as { PUBLIC_APP_ORIGIN?: string };
  const value = (
    runtime.PUBLIC_APP_ORIGIN ??
    process.env.KANBY_PUBLIC_ORIGIN ??
    ''
  ).trim();
  try {
    return value ? new URL(value).origin : 'https://kanby.dev';
  } catch {
    return 'https://kanby.dev';
  }
}

export function taskLink(
  event: Pick<TaskNotification, 'projectSlug' | 'taskRef'>,
) {
  if (!event.projectSlug) return publicOrigin();
  return `${publicOrigin()}/${encodeURIComponent(event.projectSlug)}/board?task=${encodeURIComponent(event.taskRef)}`;
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function notificationText(
  event: TaskNotification,
  recipientNames: string[],
) {
  const who = recipientNames.join('、');
  const headline =
    event.kind === 'mention'
      ? `${event.actorName} 在 ${event.taskRef} 提到了 ${who}`
      : event.kind === 'turn.rejected'
        ? `${event.taskRef} 验收被 ${event.actorName} 打回，轮到 ${who}`
        : `${event.taskRef} 轮到 ${who}${event.reasonLabel ? `（${event.reasonLabel}）` : ''}`;
  return [
    `[Kanby] ${headline}`,
    `任务：${clip(event.taskTitle, 120)}`,
    event.kind !== 'mention' ? `来自：${event.actorName}` : '',
    event.note ? `说明：${clip(event.note, 300)}` : '',
    `打开：${taskLink(event)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function feishuSignature(secret: string, timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${timestamp}\n${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new Uint8Array());
  let binary = '';
  for (const byte of new Uint8Array(signature))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function webhookPayload(
  kind: NotificationKind,
  text: string,
  secret: string | null,
  now = Date.now(),
) {
  if (kind === 'wecom') return { msgtype: 'text', text: { content: text } };
  const payload: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };
  if (secret) {
    const timestamp = Math.floor(now / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = await feishuSignature(secret, timestamp);
  }
  return payload;
}

function deliveryError(kind: NotificationKind, status: number, body: unknown) {
  if (status < 200 || status >= 300) return `HTTP ${status}`;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const code =
      kind === 'wecom' ? record.errcode : (record.code ?? record.StatusCode);
    if (code !== undefined && Number(code) !== 0) {
      const message = record.errmsg ?? record.msg;
      return `code ${Number(code)}: ${typeof message === 'string' ? message.slice(0, 120) : ''}`;
    }
  }
  return null;
}

async function deliver(channel: ChannelRow, text: string) {
  try {
    const response = await fetch(channel.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        await webhookPayload(channel.kind, text, channel.secret),
      ),
      // Workers rejects redirect:error; deliveryError rejects manual 3xx.
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return deliveryError(channel.kind, response.status, body);
  } catch (error) {
    return error instanceof Error ? error.name : 'fetch failed';
  }
}

type DeliveryOutcome =
  | { status: 'sent' }
  | { status: 'failed'; error: string }
  | { status: 'suppressed'; reason: SuppressionReason };

async function recordDelivery(
  channel: { id: string; kind: string },
  event: {
    projectId: string;
    taskId: string | null;
    kind: string;
    actorId?: string;
  },
  recipientKey: string,
  outcome: DeliveryOutcome,
) {
  if (outcome.status === 'failed')
    // Never log the webhook URL: it embeds the bot key.
    console.error(
      `Kanby notification ${channel.kind} channel ${channel.id} failed: ${outcome.error}`,
    );
  await database()
    .prepare(
      `INSERT INTO notification_deliveries (id, project_id, channel_id, task_id, event_kind, status, error, recipient_key, sender_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.projectId,
      channel.id,
      event.taskId,
      event.kind,
      outcome.status,
      outcome.status === 'failed'
        ? outcome.error
        : outcome.status === 'suppressed'
          ? outcome.reason
          : null,
      recipientKey,
      event.actorId ?? null,
      Date.now(),
    )
    .run()
    .catch((logError: unknown) =>
      console.error('Kanby notification log failed', logError),
    );
}

function outcomeOf(error: string | null): DeliveryOutcome {
  return error ? { status: 'failed', error } : { status: 'sent' };
}

// --- Rate limiting -----------------------------------------------------------

/**
 * A repeat of the same kind of notification about the same card to the same
 * recipient within this window collapses into one (a mention followed by a
 * handoff is not a repeat).
 */
export const NOTIFICATION_COALESCE_MS = 2 * 60_000;
/**
 * @-mentions from one sender in one project reach one member at most this
 * many times per rolling hour. Caps are counted per sender, project and kind
 * (mentions and turn changes separately), so nobody can use up the budget
 * that other senders' or other kinds of notifications need. Account notices
 * are never capped.
 */
export const NOTIFICATION_HOURLY_CAP = 20;
/**
 * Turn changes (assignment/handoff) are part of normal work, so their cap is
 * looser; it only stops one sender bouncing cards at a member in a loop.
 */
export const NOTIFICATION_TURN_HOURLY_CAP = 60;
/** Project bot channels are shared, so they get their own, higher caps. */
export const NOTIFICATION_CHANNEL_HOURLY_CAP = 60;
export const NOTIFICATION_TURN_CHANNEL_HOURLY_CAP = 180;

const isTurnKind = (kind: string) => kind.startsWith('turn.');

export type SuppressionReason = 'coalesced' | 'hourly_cap';

/**
 * Decides, before anything is sent, which recipients may be notified about
 * this event now. Only successful deliveries in this project count.
 * Suppressed decisions are logged as `suppressed` deliveries.
 */
export async function throttleRecipients(
  recipientKeys: string[],
  event: Pick<TaskNotification, 'projectId' | 'taskId' | 'kind'> & {
    senderKey: string | null;
  },
  now = Date.now(),
) {
  const decisions = new Map<string, SuppressionReason | null>();
  if (recipientKeys.length === 0) return decisions;
  const recent = await database()
    .prepare(
      `SELECT recipient_key, task_id, event_kind, sender_key, created_at FROM notification_deliveries
       WHERE recipient_key IN (SELECT value FROM json_each(?))
         AND project_id = ? AND status = 'sent' AND created_at > ?`,
    )
    .bind(JSON.stringify(recipientKeys), event.projectId, now - 60 * 60_000)
    .all<{
      recipient_key: string;
      task_id: string | null;
      event_kind: string;
      sender_key: string | null;
      created_at: number;
    }>();
  for (const key of recipientKeys) {
    const rows = recent.results.filter((row) => row.recipient_key === key);
    const coalesced = rows.some(
      (row) =>
        row.task_id === event.taskId &&
        row.event_kind === event.kind &&
        Number(row.created_at) > now - NOTIFICATION_COALESCE_MS,
    );
    const turn = isTurnKind(event.kind);
    const channel = key.startsWith('channel:');
    const cap = turn
      ? channel
        ? NOTIFICATION_TURN_CHANNEL_HOURLY_CAP
        : NOTIFICATION_TURN_HOURLY_CAP
      : channel
        ? NOTIFICATION_CHANNEL_HOURLY_CAP
        : NOTIFICATION_HOURLY_CAP;
    const capped =
      rows.filter(
        (row) =>
          isTurnKind(row.event_kind) === turn &&
          row.sender_key === event.senderKey,
      ).length >= cap;
    decisions.set(key, coalesced ? 'coalesced' : capped ? 'hourly_cap' : null);
  }
  return decisions;
}

const userKey = (userId: string) => `user:${userId}`;
const channelKey = (channel: Pick<ChannelRow, 'id' | 'user_id'>) =>
  channel.user_id ? userKey(channel.user_id) : `channel:${channel.id}`;

export async function sendTaskNotification(event: TaskNotification) {
  if (recoverySnapshot() || event.recipients.length === 0) return;
  await ensureSchema();
  const recipientIds = [
    ...new Set(event.recipients.map((item) => item.userId)),
  ];
  // WeChat (hosted iLink binding) is each member's preferred channel; their
  // personal Feishu/WeCom bots are only a fallback when WeChat cannot deliver.
  const { activeWeixinUsers, sendWeixinText } = await import('@/lib/weixin');
  const [weixinUsers, channels] = await Promise.all([
    activeWeixinUsers(recipientIds),
    database()
      .prepare(
        `SELECT id, project_id, user_id, kind, webhook_url, secret, enabled, updated_at
       FROM notification_channels
       WHERE project_id = ? AND enabled = 1
         AND (user_id IS NULL OR user_id IN (SELECT value FROM json_each(?)))`,
      )
      .bind(event.projectId, JSON.stringify(recipientIds))
      .all<ChannelRow>()
      .then((result) => openChannels(result.results)),
  ]);
  const throttled = await throttleRecipients(
    [
      ...new Set([
        ...[...weixinUsers].map(userKey),
        ...channels.map(channelKey),
      ]),
    ],
    { ...event, senderKey: event.actorId ?? null },
  );
  const suppressed = new Set<string>();
  const suppress = async (
    channel: { id: string; kind: string },
    key: string,
  ) => {
    const reason = throttled.get(key);
    if (!reason) return false;
    if (!suppressed.has(key)) {
      suppressed.add(key);
      await recordDelivery(channel, event, key, {
        status: 'suppressed',
        reason,
      });
    }
    return true;
  };
  const deliveredByWeixin = new Set<string>();
  await Promise.all(
    [...weixinUsers].map(async (userId) => {
      const channel = { id: `weixin:${userId}`, kind: 'weixin' };
      if (await suppress(channel, userKey(userId))) {
        deliveredByWeixin.add(userId);
        return;
      }
      const names = event.recipients
        .filter((recipient) => recipient.userId === userId)
        .map((recipient) => recipient.name);
      const error = await sendWeixinText(
        userId,
        notificationText(event, names),
      );
      if (!error) deliveredByWeixin.add(userId);
      await recordDelivery(channel, event, userKey(userId), outcomeOf(error));
    }),
  );
  await Promise.all(
    channels
      .filter(
        (channel) =>
          !channel.user_id || !deliveredByWeixin.has(channel.user_id),
      )
      .map(async (channel) => {
        if (await suppress(channel, channelKey(channel))) return;
        const names = channel.user_id
          ? event.recipients
              .filter((recipient) => recipient.userId === channel.user_id)
              .map((recipient) => recipient.name)
          : event.recipients.map((recipient) => recipient.name);
        const error = await deliver(channel, notificationText(event, names));
        await recordDelivery(
          channel,
          event,
          channelKey(channel),
          outcomeOf(error),
        );
      }),
  );
}

/**
 * Sends an account/security notice to one member: WeChat first, otherwise
 * each of their personal bots (in any project). Never rate limited.
 */
export async function sendMemberNotice(
  userId: string,
  kind: string,
  text: string,
) {
  if (recoverySnapshot()) return;
  await ensureSchema();
  const { activeWeixinUsers, sendWeixinText } = await import('@/lib/weixin');
  const key = userKey(userId);
  if ((await activeWeixinUsers([userId])).has(userId)) {
    const error = await sendWeixinText(userId, text);
    await recordDelivery(
      { id: `weixin:${userId}`, kind: 'weixin' },
      { projectId: '', taskId: null, kind },
      key,
      outcomeOf(error),
    );
    if (!error) return;
  }
  const channels = await database()
    .prepare(
      `SELECT id, project_id, user_id, kind, webhook_url, secret, enabled, updated_at
       FROM notification_channels WHERE user_id = ? AND enabled = 1
       ORDER BY created_at`,
    )
    .bind(userId)
    .all<ChannelRow>()
    .then((result) => openChannels(result.results));
  const seen = new Set<string>();
  await Promise.all(
    channels
      .filter((channel) => {
        if (seen.has(channel.webhook_url)) return false;
        seen.add(channel.webhook_url);
        return true;
      })
      .map(async (channel) => {
        const error = await deliver(channel, text);
        await recordDelivery(
          channel,
          { projectId: channel.project_id, taskId: null, kind },
          key,
          outcomeOf(error),
        );
      }),
  );
}

async function inBackground(task: Promise<unknown>) {
  const runtime = (await import('cloudflare:workers')) as {
    waitUntil?: (promise: Promise<unknown>) => void;
  };
  if (typeof runtime.waitUntil === 'function') {
    try {
      runtime.waitUntil(task);
      return;
    } catch {
      // Outside a request context; fall through and wait inline.
    }
  }
  await task;
}

/** Best effort: never throws and, when the runtime allows, runs after the response. */
export async function notifyMember(userId: string, kind: string, text: string) {
  await inBackground(
    sendMemberNotice(userId, kind, text).catch((error: unknown) =>
      console.error('Kanby member notice failed', error),
    ),
  );
}

/** Best effort: never throws and, when the runtime allows, runs after the response. */
export async function notifyTaskEvent(event: TaskNotification) {
  await inBackground(
    sendTaskNotification(event).catch((error: unknown) =>
      console.error('Kanby notification dispatch failed', error),
    ),
  );
}
