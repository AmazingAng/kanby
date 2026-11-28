'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
type AccountState = {
  linked: boolean;
  user?: { login: string; name: string };
  error?: string;
};
async function loadAccount(): Promise<AccountState> {
  const response = await fetch('/api/mini/account', { cache: 'no-store' });
  const data = (await response.json()) as AccountState;
  if (!response.ok) throw new Error(data.error || '无法读取绑定状态');
  return data;
}
export function MiniAccount() {
  const [state, setState] = useState<{
    linked: boolean;
    user?: { login: string; name: string };
  } | null>(null);
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
  async function change(method: 'POST' | 'DELETE') {
    if (busy) return;
    if (
      !window.confirm(
        method === 'POST'
          ? `确认将你自己小程序中的微信绑定到 @${state?.user?.login}？不要使用他人提供的绑定码。`
          : '确认解除微信小程序登录？所有小程序会话将立即失效。',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/mini/account', {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST'
          ? { body: JSON.stringify({ pairingCode: code.trim() }) }
          : {}),
      });
      const data = (await response.json()) as AccountState;
      if (!response.ok) throw new Error(data.error);
      setCode('');
      setState(await loadAccount());
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
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
              <button
                disabled={busy}
                onClick={() => void change('DELETE')}
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
                onClick={() => void change('POST')}
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
