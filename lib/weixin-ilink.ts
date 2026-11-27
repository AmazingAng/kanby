/**
 * Minimal client for WeChat's iLink Bot HTTP protocol (the protocol behind
 * Tencent's official openclaw-weixin channel): QR login, long-poll updates and
 * text messages. Every host is restricted to weixin.qq.com.
 */
export const ILINK_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_APP_ID = 'bot';
const ILINK_BOT_TYPE = '3';
// iLink-App-ClientVersion is 0x00MMNNPP; this matches the protocol revision
// implemented here (official channel 2.4.x).
const ILINK_CLIENT_VERSION = (2 << 16) | (4 << 8) | 10;
const BASE_INFO = { channel_version: 'kanby-1', bot_agent: 'Kanby/1.0' };

export const ILINK_SESSION_EXPIRED = -14;

export class ILinkError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

/** Only HTTPS hosts under weixin.qq.com may receive a bot token. */
export function safeILinkBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !(
        url.hostname === 'weixin.qq.com' ||
        url.hostname.endsWith('.weixin.qq.com')
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function randomUin() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return btoa(String(value));
}

function headers(token?: string) {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_CLIENT_VERSION),
  };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function call<T>(
  baseUrl: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; token?: string },
  timeoutMs: number,
): Promise<T> {
  const origin = safeILinkBaseUrl(baseUrl);
  if (!origin) throw new ILinkError('Untrusted iLink host');
  const response = await fetch(`${origin}/${path}`, {
    method: init.method,
    headers: headers(init.token),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new ILinkError(`iLink HTTP ${response.status}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ILinkError('iLink returned invalid JSON');
  }
}

function isTimeout(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export async function requestLoginQrcode(baseUrl = ILINK_DEFAULT_BASE_URL) {
  const response = await call<{ qrcode?: string; qrcode_img_content?: string }>(
    baseUrl,
    `ilink/bot/get_bot_qrcode?bot_type=${ILINK_BOT_TYPE}`,
    { method: 'POST', body: { local_token_list: [] } },
    15_000,
  );
  if (!response.qrcode || !response.qrcode_img_content)
    throw new ILinkError('iLink did not return a QR code');
  return { qrcode: response.qrcode, content: response.qrcode_img_content };
}

export type LoginStatus =
  | {
      status:
        | 'wait'
        | 'scaned'
        | 'expired'
        | 'need_verifycode'
        | 'verify_code_blocked'
        | 'binded_redirect';
    }
  | { status: 'redirect'; baseUrl: string }
  | {
      status: 'confirmed';
      botToken: string;
      botId: string;
      ilinkUserId: string;
      baseUrl: string;
    };

export async function pollLoginStatus(
  baseUrl: string,
  qrcode: string,
  verifyCode?: string,
  timeoutMs = 20_000,
): Promise<LoginStatus> {
  let response: {
    status?: string;
    bot_token?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
    baseurl?: string;
    redirect_host?: string;
  };
  try {
    response = await call(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : ''}`,
      { method: 'GET' },
      timeoutMs,
    );
  } catch (error) {
    if (isTimeout(error)) return { status: 'wait' };
    throw error;
  }
  switch (response.status) {
    case 'confirmed': {
      if (
        !response.bot_token ||
        !response.ilink_bot_id ||
        !response.ilink_user_id
      )
        throw new ILinkError('iLink confirmed login without credentials');
      return {
        status: 'confirmed',
        botToken: response.bot_token,
        botId: response.ilink_bot_id,
        ilinkUserId: response.ilink_user_id,
        baseUrl: safeILinkBaseUrl(response.baseurl) ?? baseUrl,
      };
    }
    case 'scaned_but_redirect': {
      const redirected = safeILinkBaseUrl(response.redirect_host);
      return redirected
        ? { status: 'redirect', baseUrl: redirected }
        : { status: 'scaned' };
    }
    case 'scaned':
    case 'expired':
    case 'need_verifycode':
    case 'verify_code_blocked':
    case 'binded_redirect':
      return { status: response.status };
    default:
      return { status: 'wait' };
  }
}

export type ILinkInbound = {
  fromUserId: string;
  contextToken: string | null;
  text: string;
  createdAt: number;
};

export async function getUpdates(input: {
  baseUrl: string;
  token: string;
  cursor: string | null;
  timeoutMs: number;
}) {
  let response: {
    ret?: number;
    errcode?: number;
    errmsg?: string;
    get_updates_buf?: string;
    msgs?: Array<{
      from_user_id?: string;
      context_token?: string;
      message_type?: number;
      create_time_ms?: number;
      item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
    }>;
  };
  try {
    response = await call(
      input.baseUrl,
      'ilink/bot/getupdates',
      {
        method: 'POST',
        token: input.token,
        body: { get_updates_buf: input.cursor ?? '', base_info: BASE_INFO },
      },
      input.timeoutMs,
    );
  } catch (error) {
    if (isTimeout(error)) return { cursor: input.cursor, messages: [] };
    throw error;
  }
  const code =
    response.errcode ?? (response.ret && response.ret !== 0 ? response.ret : 0);
  if (code) throw new ILinkError(`getupdates failed (${code})`, code);
  return {
    cursor: response.get_updates_buf ?? input.cursor,
    messages: (response.msgs ?? [])
      // message_type 1 = sent by the WeChat user, 2 = sent by the bot.
      .filter((message) => message.message_type !== 2 && message.from_user_id)
      .map(
        (message): ILinkInbound => ({
          fromUserId: message.from_user_id!,
          contextToken: message.context_token ?? null,
          text: (message.item_list ?? [])
            .map((item) =>
              item.type === 1 ? (item.text_item?.text ?? '') : '',
            )
            .join('')
            .trim(),
          createdAt: Number(message.create_time_ms ?? Date.now()),
        }),
      ),
  };
}

export async function sendText(input: {
  baseUrl: string;
  token: string;
  to: string;
  contextToken: string | null;
  text: string;
}) {
  const response = await call<{
    ret?: number;
    errcode?: number;
    errmsg?: string;
  }>(
    input.baseUrl,
    'ilink/bot/sendmessage',
    {
      method: 'POST',
      token: input.token,
      body: {
        msg: {
          from_user_id: '',
          to_user_id: input.to,
          client_id: `kanby-${crypto.randomUUID()}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: input.text } }],
          context_token: input.contextToken ?? undefined,
        },
        base_info: BASE_INFO,
      },
    },
    15_000,
  );
  const code =
    response.errcode ?? (response.ret && response.ret !== 0 ? response.ret : 0);
  if (code) throw new ILinkError(`sendmessage failed (${code})`, code);
}
