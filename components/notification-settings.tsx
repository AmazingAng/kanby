'use client';

import { useEffect, useState } from 'react';
import { BellRing, LoaderCircle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Channel = {
  id: string;
  scope: 'project' | 'member';
  kind: 'feishu' | 'wecom';
  target: string;
  signed: boolean;
  enabled: boolean;
  unreadable?: boolean;
};

const kindLabel = { feishu: '飞书', wecom: '企业微信' } as const;

/**
 * Feishu / WeCom bot webhooks for turn handoffs, rejections and @mentions.
 * URLs are write-only: the API only ever returns host and last 4 characters.
 */
export function NotificationSettings({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [scope, setScope] = useState<'member' | 'project'>('member');
  const [kind, setKind] = useState<'feishu' | 'wecom'>('feishu');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/notification-channels?projectId=${encodeURIComponent(projectId)}`,
      {
        cache: 'no-store',
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('channels');
        const payload = (await response.json()) as { channels: Channel[] };
        if (!cancelled) setChannels(payload.channels);
      })
      .catch(() => {
        if (!cancelled) setError('通知设置加载失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function add(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!webhookUrl.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/notification-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          scope,
          kind,
          webhookUrl: webhookUrl.trim(),
          secret:
            kind === 'feishu' && secret.trim() ? secret.trim() : undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        channel?: Channel;
        error?: string;
      } | null;
      if (!response.ok || !payload?.channel)
        throw new Error(payload?.error ?? '保存失败');
      setChannels((current) => [...current, payload.channel!]);
      setWebhookUrl('');
      setSecret('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function remove(channelId: string) {
    const response = await fetch(
      `/api/notification-channels?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(channelId)}`,
      { method: 'DELETE' },
    );
    if (response.ok)
      setChannels((current) => current.filter((item) => item.id !== channelId));
    else setError('删除失败，请重试。');
  }

  return (
    <section
      id="notifications"
      className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
    >
      <div>
        <p className="text-xs text-ink-faint">Notifications</p>
        <h2 className="mt-1 text-xl font-semibold">机器人通知</h2>
        <p className="mt-2 text-xs leading-5 text-ink-subtle">
          卡片交给你（或你的 agent）、你被
          @、验收被打回时推送到飞书或企业微信群机器人。
          个人机器人只收发给你的提醒；项目群机器人（仅 owner
          可配置）收到所有提醒。
        </p>
      </div>
      <div className="mt-4 space-y-2">
        {channels.map((channel) => (
          <div
            key={channel.id}
            className="flex items-center gap-3 rounded-xl bg-canvas px-3 py-2.5 text-xs"
          >
            <BellRing className="size-3.5 shrink-0 text-ink-subtle" />
            <span className="font-medium">
              {channel.scope === 'project' ? '项目群' : '我的'} ·{' '}
              {kindLabel[channel.kind]}
            </span>
            <span
              className={
                channel.unreadable
                  ? 'truncate text-[#9d3026]'
                  : 'truncate text-ink-subtle'
              }
            >
              {channel.target}
              {channel.signed ? ' · 已签名' : ''}
            </span>
            {(channel.scope === 'member' || isOwner) && (
              <button
                type="button"
                onClick={() => void remove(channel.id)}
                className="ml-auto grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-ink/5 hover:text-ink"
                aria-label="删除通知渠道"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        ))}
        {channels.length === 0 && (
          <p className="text-xs text-ink-faint">还没有配置机器人。</p>
        )}
      </div>
      <form onSubmit={add} className="mt-4 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="范围"
            value={scope}
            onChange={(event) =>
              setScope(event.target.value as 'member' | 'project')
            }
            className="h-10 rounded-xl border border-ink/15 bg-card px-2 text-xs"
          >
            <option value="member">我的机器人</option>
            {isOwner && <option value="project">项目群机器人</option>}
          </select>
          <select
            aria-label="类型"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as 'feishu' | 'wecom')
            }
            className="h-10 rounded-xl border border-ink/15 bg-card px-2 text-xs"
          >
            <option value="feishu">飞书</option>
            <option value="wecom">企业微信</option>
          </select>
        </div>
        <Input
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder={
            kind === 'feishu'
              ? 'https://open.feishu.cn/open-apis/bot/v2/hook/…'
              : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…'
          }
          autoComplete="off"
          className="h-10 rounded-xl border-ink/15 text-xs focus-visible:ring-0"
        />
        {kind === 'feishu' && (
          <Input
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="签名校验密钥（可选）"
            type="password"
            autoComplete="off"
            className="h-10 rounded-xl border-ink/15 text-xs focus-visible:ring-0"
          />
        )}
        <Button
          type="submit"
          size="sm"
          disabled={saving || !webhookUrl.trim()}
          className="rounded-xl bg-ink text-background"
        >
          {saving && <LoaderCircle className="animate-spin" />}
          添加机器人
        </Button>
        {error && <p className="text-xs text-[#9d3026]">{error}</p>}
      </form>
    </section>
  );
}
