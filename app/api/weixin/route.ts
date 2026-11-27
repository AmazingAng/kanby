import { renderSVG } from 'uqr';

import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';
import {
  checkWeixinLogin,
  getWeixinAccount,
  sendWeixinText,
  startWeixinLogin,
  syncWeixin,
  unbindWeixin,
  weixinEnabled,
  WeixinUnavailableError,
} from '@/lib/weixin';
import { ILinkError } from '@/lib/weixin-ilink';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

/** The signed-in member's own WeChat binding; credentials are never returned. */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(
    { enabled: weixinEnabled(), account: await getWeixinAccount(user.id) },
    { headers: noStore },
  );
}

async function mutatingUser(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  return config && user && isSameOriginMutation(request, config) ? user : null;
}

export async function POST(request: Request) {
  const user = await mutatingUser(request);
  if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!isJsonContentType(request))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const parsed = await readJsonObjectWithLimit(request, 4 * 1024);
  if (!parsed.ok)
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  const body = parsed.body;
  try {
    if (body.action === 'start') {
      const login = await startWeixinLogin(user.id);
      return Response.json(
        {
          loginId: login.loginId,
          qrcodeSvg: renderSVG(login.qrcodeContent, { border: 2 }),
        },
        { headers: noStore },
      );
    }
    if (body.action === 'check') {
      const loginId = typeof body.loginId === 'string' ? body.loginId : '';
      const verifyCode =
        typeof body.verifyCode === 'string' && /^\d{4,8}$/.test(body.verifyCode)
          ? body.verifyCode
          : undefined;
      if (!loginId || loginId.length > 80)
        return Response.json({ error: 'Invalid login' }, { status: 400 });
      const progress = await checkWeixinLogin(user.id, loginId, verifyCode);
      return Response.json(
        { progress, account: await getWeixinAccount(user.id) },
        { headers: noStore },
      );
    }
    if (body.action === 'sync')
      return Response.json(
        { account: await syncWeixin(user.id) },
        { headers: noStore },
      );
    if (body.action === 'test') {
      const error = await sendWeixinText(
        user.id,
        `[Kanby] 微信通知已连接。卡片轮到你、你被 @、验收被打回时会发到这里。`,
      );
      return Response.json(
        { ok: !error, error, account: await getWeixinAccount(user.id) },
        { status: error ? 409 : 200, headers: noStore },
      );
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof WeixinUnavailableError)
      return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof ILinkError)
      return Response.json(
        { error: '微信服务暂时不可用，请稍后重试' },
        { status: 502 },
      );
    throw error;
  }
}

export async function DELETE(request: Request) {
  const user = await mutatingUser(request);
  if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 });
  await unbindWeixin(user.id);
  return new Response(null, { status: 204 });
}
