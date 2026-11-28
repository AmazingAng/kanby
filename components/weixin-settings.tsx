'use client';
import Link from 'next/link';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Account = {
  status: 'pending' | 'active' | 'expired';
  activatedAt: number | null;
  lastError: string | null;
};

type Progress =
  | 'wait'
  | 'scaned'
  | 'need_verifycode'
  | 'expired'
  | 'blocked'
  | 'already_bound'
  | 'confirmed';

const progressText: Record<Progress, string> = {
  wait: '请用微信扫码',
  scaned: '已扫码，请在手机上确认',
  need_verifycode: '请输入微信显示的验证码',
  expired: '二维码已过期，请重新获取',
  blocked: '验证码错误次数过多，请稍后重试',
  already_bound: '这个微信已绑定到其他机器人，请先在微信里解除',
  confirmed: '已绑定',
};

async function post(body: Record<string, unknown>) {
  const response = await fetch('/api/weixin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok && response.status !== 409)
    throw new Error(
      typeof payload?.error === 'string' ? payload.error : '请求失败',
    );
  return payload ?? {};
}

/**
 * Bind the member's own WeChat (hosted iLink bot) for notifications. Kanby
 * stores the bot credentials encrypted; this page never sees them.
 */
export function WeixinSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [login, setLogin] = useState<{ id: string; svg: string } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const polling = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/weixin', { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as {
          enabled: boolean;
          account: Account | null;
        };
        if (!cancelled) {
          setEnabled(payload.enabled);
          setAccount(payload.account);
        }
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
      polling.current = false;
    };
  }, []);

  async function poll(loginId: string, code?: string) {
    polling.current = true;
    while (polling.current) {
      const payload = await post({
        action: 'check',
        loginId,
        verifyCode: code,
      }).catch(() => null);
      code = undefined;
      if (!payload) {
        setMessage('网络错误，请重试。');
        break;
      }
      const next = payload.progress as Progress;
      setProgress(next);
      if (next === 'confirmed') {
        setAccount(payload.account as Account);
        setLogin(null);
        break;
      }
      if (next !== 'wait' && next !== 'scaned') break;
    }
    polling.current = false;
  }

  async function start() {
    setBusy(true);
    setMessage('');
    try {
      const payload = await post({ action: 'start' });
      const id = payload.loginId as string;
      setLogin({ id, svg: payload.qrcodeSvg as string });
      setProgress('wait');
      void poll(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '获取二维码失败');
    } finally {
      setBusy(false);
    }
  }

  async function run(action: 'sync' | 'test') {
    setBusy(true);
    setMessage('');
    try {
      const payload = await post({ action });
      if (payload.account) setAccount(payload.account as Account);
      if (action === 'sync')
        setMessage(
          (payload.account as Account | null)?.status === 'active'
            ? '已激活。'
            : '还没收到你的消息，发一句话给机器人后再试。',
        );
      else
        setMessage(
          payload.ok
            ? '测试消息已发送。'
            : `发送失败：${String(payload.error)}`,
        );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    setBusy(true);
    polling.current = false;
    await fetch('/api/weixin', { method: 'DELETE' });
    setAccount(null);
    setLogin(null);
    setProgress(null);
    setBusy(false);
  }

  return (
    <section
      id="weixin"
      className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
    >
      <div>
        <p className="text-xs text-ink-faint">WeChat</p>
        <h2 className="mt-1 text-xl font-semibold">微信通知（首选）</h2>
        <p className="mt-2 text-xs leading-5 text-ink-subtle">
          绑定你自己的微信。卡片轮到你或你的 agent、你被
          @、验收被打回时，优先发到微信；
          微信不可用时才改用下面的飞书/企业微信机器人。凭证由 Kanby
          加密保存，可随时解绑。
        </p>
      </div>
      <Link href="/mini" className="mt-3 inline-block text-xs underline">
        管理微信小程序登录绑定
      </Link>
      {enabled === false && (
        <p className="mt-4 text-xs text-ink-faint">
          服务器尚未配置微信托管（WEIXIN_CREDENTIAL_KEY），请联系管理员。
        </p>
      )}
      {enabled && (
        <div className="mt-4 space-y-3 text-xs">
          {account && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-canvas px-3 py-2.5">
              <MessageCircle className="size-3.5 text-ink-subtle" />
              <span className="font-medium">
                {account.status === 'active'
                  ? '已连接'
                  : account.status === 'pending'
                    ? '已绑定，待激活'
                    : '已失效，请重新绑定'}
              </span>
              {account.lastError && (
                <span className="text-ink-faint">
                  最近错误：{account.lastError}
                </span>
              )}
            </div>
          )}
          {account?.status === 'pending' && (
            <p className="leading-5 text-ink-subtle">
              用微信给刚绑定的机器人随便发一句话（例如「你好」），然后点「我已发送」。
              微信要求先由你发起对话，Kanby 才能给你发通知。
            </p>
          )}
          {login && (
            <div className="space-y-2">
              <div
                className="size-48 rounded-xl bg-white p-2"
                aria-label="微信登录二维码"
                // SVG is generated server-side by uqr from the iLink login link.
                dangerouslySetInnerHTML={{ __html: login.svg }}
              />
              {progress && (
                <p className="text-ink-subtle">{progressText[progress]}</p>
              )}
              {progress === 'need_verifycode' && (
                <div className="flex gap-2">
                  <Input
                    value={verifyCode}
                    onChange={(event) => setVerifyCode(event.target.value)}
                    inputMode="numeric"
                    placeholder="验证码"
                    className="h-9 w-32 rounded-xl text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void poll(login.id, verifyCode)}
                    className="rounded-xl"
                  >
                    提交
                  </Button>
                </div>
              )}
            </div>
          )}
          {!login && progress && progress !== 'confirmed' && (
            <p className="text-ink-subtle">{progressText[progress]}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {(!account || account.status === 'expired') && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void start()}
                className="rounded-xl bg-ink text-background"
              >
                {busy && <LoaderCircle className="animate-spin" />}
                {login ? '重新获取二维码' : '绑定微信'}
              </Button>
            )}
            {account?.status === 'pending' && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void run('sync')}
                className="rounded-xl bg-ink text-background"
              >
                我已发送
              </Button>
            )}
            {account?.status === 'active' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run('test')}
                className="rounded-xl"
              >
                发送测试消息
              </Button>
            )}
            {account && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void unbind()}
                className="rounded-xl text-ink-subtle"
              >
                解绑
              </Button>
            )}
          </div>
          {message && <p className="text-ink-subtle">{message}</p>}
        </div>
      )}
    </section>
  );
}
