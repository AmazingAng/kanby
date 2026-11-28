'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
type MiniSession = { id: number; createdAt: number; expiresAt: number };
type AccountState = {
  linked: boolean;
  linkedAt?: number | null;
  fingerprint?: string | null;
  lastLoginAt?: number | null;
  sessions?: MiniSession[];
  user?: { login: string; name: string };
  error?: string;
};
function formatTime(value: number | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}
async function loadAccount(): Promise<AccountState> {
  const response = await fetch('/api/mini/account', { cache: 'no-store' });
  const data = (await response.json()) as AccountState;
  if (!response.ok) throw new Error(data.error || '无法读取绑定状态');
  return data;
}
export function MiniAccount() {
  const [state, setState] = useState<AccountState | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAccount()
      .then((data) => {
        if (active) setState(data);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : '无法读取绑定状态');
      });
    return () => {
      active = false;
    };
  }, []);
  async function request(method: 'POST' | 'DELETE', body?: unknown) {
    const response = await fetch('/api/mini/account', {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json()) as AccountState & {
      fingerprint?: string;
    };
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  async function run(action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (await action()) setState(await loadAccount());
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  function bind() {
    void run(async () => {
      const pairingCode = code.trim();
      // Show which WeChat the code belongs to before anything is bound.
      const preview = await request('POST', { pairingCode, preview: true });
      if (
        !window.confirm(
          `这个绑定码来自微信识别码 ${preview.fingerprint}。\n请确认它与你自己小程序里显示的识别码一致，再绑定到 @${state?.user?.login}。不要使用他人提供的绑定码。`,
        )
      )
        return false;
      await request('POST', { pairingCode });
      setCode('');
      return true;
    });
  }
  function unlink() {
    if (!window.confirm('确认解除微信小程序登录？所有小程序会话将立即失效。'))
      return;
    void run(async () => {
      await request('DELETE');
      return true;
    });
  }
  function revokeSession(sessionId: number) {
    if (!window.confirm('确认让这个小程序会话退出登录？')) return;
    void run(async () => {
      await request('DELETE', { sessionId });
      return true;
    });
  }
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <Link href="/" className="text-sm underline">
        返回 Kanby
      </Link>
      <h1 className="mt-8 text-2xl font-semibold">微信小程序登录</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        绑定已有 Kanby
        账号，在微信小程序中查看待办、评论和验收卡片。微信通知绑定与此项分别管理。
      </p>
      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      <button
        type="button"
        className="mt-4 inline-block underline"
        onClick={() =>
          window.location.assign('/api/auth/github?returnTo=%2Fmini')
        }
      >
        通过 GitHub 登录 / 重新验证身份
      </button>
      {state && (
        <section className="mt-8 space-y-4">
          <p>
            当前账号：{state.user?.name}（@{state.user?.login}）
          </p>
          {state.linked ? (
            <>
              <p>已绑定微信小程序登录。</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">微信识别码</dt>
                <dd className="font-mono">{state.fingerprint ?? '—'}</dd>
                <dt className="text-muted-foreground">绑定时间</dt>
                <dd>{formatTime(state.linkedAt)}</dd>
                <dt className="text-muted-foreground">最近登录</dt>
                <dd>{formatTime(state.lastLoginAt)}</dd>
              </dl>
              <p className="text-sm text-muted-foreground">
                识别码应与你自己小程序里显示的一致；不一致或不是你本人绑定，请立即解除绑定。
              </p>
              {state.sessions && state.sessions.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {state.sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <span>
                        登录于 {formatTime(session.createdAt)}，
                        {formatTime(session.expiresAt)} 过期
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => revokeSession(session.id)}
                        className="shrink-0 underline"
                      >
                        退出此会话
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                disabled={busy}
                onClick={unlink}
                className="rounded-xl border px-5 py-3"
              >
                解除绑定
              </button>
            </>
          ) : (
            <>
              <p className="text-sm">
                在小程序点击微信登录，复制你自己的绑定码到这里。绑定码有效期为 5
                分钟；绑定成功后返回小程序重新登录。
              </p>
              <label className="block" htmlFor="mini-pair">
                绑定码
              </label>
              <input
                id="mini-pair"
                autoComplete="off"
                spellCheck={false}
                maxLength={43}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-xl border p-3 font-mono"
              />
              <button
                disabled={busy || code.trim().length !== 43}
                onClick={bind}
                className="rounded-xl bg-foreground px-5 py-3 text-background disabled:opacity-50"
              >
                确认绑定到当前账号
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}
