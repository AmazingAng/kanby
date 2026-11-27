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

function mapChannel(row: ChannelRow): NotificationChannelRecord {
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
  return result.results.map(mapChannel);
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
      input.webhookUrl,
      input.secret,
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
      redirect: 'error',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return deliveryError(channel.kind, response.status, body);
  } catch (error) {
    return error instanceof Error ? error.name : 'fetch failed';
  }
}

async function recordDelivery(
  channel: { id: string; kind: string },
  event: TaskNotification,
  error: string | null,
) {
  if (error)
    // Never log the webhook URL: it embeds the bot key.
    console.error(
      `Kanby notification ${channel.kind} channel ${channel.id} failed: ${error}`,
    );
  await database()
    .prepare(
      `INSERT INTO notification_deliveries (id, project_id, channel_id, task_id, event_kind, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      event.projectId,
      channel.id,
      event.taskId,
      event.kind,
      error ? 'failed' : 'sent',
      error,
      Date.now(),
    )
    .run();
}

export async function sendTaskNotification(event: TaskNotification) {
  if (recoverySnapshot() || event.recipients.length === 0) return;
  await ensureSchema();
  const recipientIds = [
    ...new Set(event.recipients.map((item) => item.userId)),
  ];
  // WeChat (hosted iLink binding) is each member's preferred channel; their
  // personal Feishu/WeCom bots are only a fallback when WeChat cannot deliver.
  const { activeWeixinUsers, sendWeixinText } = await import('@/lib/weixin');
  const weixinUsers = await activeWeixinUsers(recipientIds);
  const deliveredByWeixin = new Set<string>();
  await Promise.all(
    [...weixinUsers].map(async (userId) => {
      const names = event.recipients
        .filter((recipient) => recipient.userId === userId)
        .map((recipient) => recipient.name);
      const error = await sendWeixinText(
        userId,
        notificationText(event, names),
      );
      if (!error) deliveredByWeixin.add(userId);
      await recordDelivery(
        { id: `weixin:${userId}`, kind: 'weixin' },
        event,
        error,
      ).catch((logError: unknown) =>
        console.error('Kanby notification log failed', logError),
      );
    }),
  );
  const channels = await database()
    .prepare(
      `SELECT id, project_id, user_id, kind, webhook_url, secret, enabled, updated_at
       FROM notification_channels
       WHERE project_id = ? AND enabled = 1
         AND (user_id IS NULL OR user_id IN (${recipientIds.map(() => '?').join(', ')}))`,
    )
    .bind(event.projectId, ...recipientIds)
    .all<ChannelRow>();
  await Promise.all(
    channels.results
      .filter(
        (channel) =>
          !channel.user_id || !deliveredByWeixin.has(channel.user_id),
      )
      .map(async (channel) => {
        const names = channel.user_id
          ? event.recipients
              .filter((recipient) => recipient.userId === channel.user_id)
              .map((recipient) => recipient.name)
          : event.recipients.map((recipient) => recipient.name);
        const error = await deliver(channel, notificationText(event, names));
        await recordDelivery(channel, event, error).catch((logError: unknown) =>
          console.error('Kanby notification log failed', logError),
        );
      }),
  );
}

/** Best effort: never throws and, when the runtime allows, runs after the response. */
export async function notifyTaskEvent(event: TaskNotification) {
  const task = sendTaskNotification(event).catch((error: unknown) =>
    console.error('Kanby notification dispatch failed', error),
  );
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
