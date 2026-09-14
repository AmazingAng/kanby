'use client';

/* oxlint-disable next/no-html-link-for-pages -- vinext RSC Link navigation is unstable on the Worker runtime; force document navigation. */

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  GitBranch,
  ImageIcon,
  Paperclip,
  RefreshCw,
  Users,
} from 'lucide-react';

import { appPath } from '@/lib/app-path';
import { buttonVariants } from '@/components/ui/button';
import { KanbyMark, type AppUser } from '@/components/kanby-shell';
import { cn } from '@/lib/utils';

type PreviewCardProps = {
  title: string;
  label: string;
  assignee: string;
  accent?: boolean;
  done?: boolean;
  attachment?: boolean;
};

function PreviewCard({
  title,
  label,
  assignee,
  accent,
  done,
  attachment,
}: PreviewCardProps) {
  return (
    <article
      className={cn(
        'rounded-[15px] border border-ink/10 bg-card p-3 shadow-[0_1px_0_rgba(29,30,25,0.04)]',
        accent && 'border-acid/70 bg-acid-wash',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-ink-faint">
          {label}
        </span>
        {done && (
          <span className="grid size-4 place-items-center rounded-full bg-ink text-background">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] font-semibold leading-[1.35] tracking-[-0.01em]">
        {title}
      </p>
      <div className="mt-4 flex items-center justify-between">
        <span className="grid size-5 place-items-center rounded-full bg-ink text-[8px] font-bold text-background">
          {assignee}
        </span>
        {attachment && (
          <span className="flex items-center gap-1 text-[9px] text-ink-faint">
            <Paperclip className="size-2.5" /> 2
          </span>
        )}
      </div>
    </article>
  );
}

export function HomePage() {
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(appPath('/api/auth/session'), { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { user?: AppUser | null })
          : null,
      )
      .then((payload: { user?: AppUser | null } | null) => {
        if (!cancelled) setUser(payload?.user ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const primaryHref = appPath(
    user ? '/app' : '/api/auth/github?returnTo=%2Fapp',
  );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <KanbyMark href="/" />
          <div className="flex items-center gap-1 sm:gap-3">
            <a
              href={appPath('/demo')}
              className="hidden rounded-full px-4 py-2 text-xs font-medium text-ink-subtle transition-colors hover:text-ink sm:block"
            >
              查看 Demo
            </a>
            <a
              href={primaryHref}
              className={cn(
                buttonVariants(),
                'h-10 rounded-full bg-ink px-4 text-xs text-background hover:bg-ink/85 sm:px-5',
              )}
            >
              {user ? '进入工作台' : 'GitHub 登录'} <ArrowRight />
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[56%] bg-[radial-gradient(circle_at_50%_48%,rgba(200,242,70,0.13),transparent_55%)] lg:block" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[minmax(440px,0.86fr)_minmax(0,1.14fr)] lg:items-center lg:gap-16 lg:py-20 xl:gap-24 xl:py-24">
          <div className="max-w-[590px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-card px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              <span className="size-1.5 rounded-full bg-acid ring-2 ring-acid/25" />
              Built for 1–3 person teams
            </div>
            <h1 className="mt-6 text-[clamp(3.35rem,5.35vw,5.35rem)] font-semibold leading-[0.92] tracking-[-0.07em]">
              <span className="block whitespace-nowrap">想法很快，</span>
              <span className="block whitespace-nowrap">交付更快。</span>
            </h1>
            <p className="mt-7 max-w-[510px] text-base leading-7 text-ink-subtle sm:text-[17px]">
              为 vibe coding
              小团队准备的任务墙。把刚冒出来的点子拖进流程，让每个人都清楚下一步。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={primaryHref}
                className={cn(
                  buttonVariants(),
                  'h-12 rounded-full bg-acid px-6 text-sm font-semibold text-ink shadow-[0_8px_24px_rgba(160,197,45,0.18)] hover:bg-acid/80',
                )}
              >
                {user ? '打开我的项目' : '使用 GitHub 开始'} <ArrowRight />
              </a>
              <a
                href={appPath('/demo')}
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'h-12 rounded-full border-ink/15 bg-transparent px-6 text-sm hover:bg-card',
                )}
              >
                体验示例看板
              </a>
            </div>
            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-faint">
              <span className="flex items-center gap-1.5">
                <Check className="size-3 text-ink" /> GitHub 一键登录
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3 text-ink" /> 无需复杂配置
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="size-3 text-ink" /> 数秒内团队同步
              </span>
            </div>
          </div>

          <figure
            className="relative mx-auto w-full max-w-[700px]"
            aria-label="Kanby 看板界面预览"
          >
            <div className="absolute -inset-6 -z-10 rounded-[40px] bg-card/70 blur-2xl" />
            <div className="overflow-hidden rounded-[26px] border border-ink/10 bg-card shadow-[0_30px_90px_rgba(29,30,25,0.12)]">
              <div className="flex items-center justify-between border-b border-ink/10 px-4 py-4 sm:px-5">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-xl bg-ink text-[10px] font-bold text-background">
                    K
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">Launch v1</p>
                    <p className="mt-0.5 text-[9px] text-ink-faint">
                      产品上线 · 3 位成员
                    </p>
                  </div>
                </div>
                <div className="flex -space-x-1.5">
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-[#f3b59f] text-[9px] font-bold">
                    L
                  </span>
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-[#b8d7ff] text-[9px] font-bold">
                    M
                  </span>
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-acid text-[9px] font-bold">
                    Y
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto p-3 sm:p-4">
                <div className="grid min-w-[570px] grid-cols-3 gap-2.5">
                  <section className="rounded-[18px] bg-canvas p-2.5">
                    <div className="mb-2.5 flex items-center justify-between px-1">
                      <span className="text-[10px] font-semibold">待开始</span>
                      <span className="text-[9px] text-ink-faint">3</span>
                    </div>
                    <div className="space-y-2">
                      <PreviewCard
                        label="Product"
                        title="定稿首页信息架构"
                        assignee="L"
                      />
                      <PreviewCard
                        label="Growth"
                        title="邀请首批体验用户"
                        assignee="Y"
                        attachment
                      />
                    </div>
                  </section>
                  <section className="rounded-[18px] bg-canvas p-2.5">
                    <div className="mb-2.5 flex items-center justify-between px-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold">
                        <span className="size-1.5 rounded-full bg-acid" />{' '}
                        进行中
                      </span>
                      <span className="text-[9px] text-ink-faint">2</span>
                    </div>
                    <div className="space-y-2">
                      <PreviewCard
                        label="Code"
                        title="完成 GitHub 登录"
                        assignee="M"
                        accent
                      />
                      <PreviewCard
                        label="Design"
                        title="优化移动端看板"
                        assignee="L"
                      />
                    </div>
                  </section>
                  <section className="rounded-[18px] bg-canvas p-2.5">
                    <div className="mb-2.5 flex items-center justify-between px-1">
                      <span className="text-[10px] font-semibold">已完成</span>
                      <span className="text-[9px] text-ink-faint">2</span>
                    </div>
                    <div className="space-y-2">
                      <PreviewCard
                        label="Ship"
                        title="首个可用版本"
                        assignee="Y"
                        done
                      />
                      <PreviewCard
                        label="Infra"
                        title="部署到 Worker"
                        assignee="M"
                        done
                      />
                    </div>
                  </section>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 left-5 hidden items-center gap-2 rounded-full border border-ink/10 bg-card px-3.5 py-2 text-[10px] font-medium shadow-[0_12px_30px_rgba(29,30,25,0.12)] sm:flex">
              <span className="grid size-4 place-items-center rounded-full bg-acid">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              刚刚同步 · 所有人已看到
            </div>
          </figure>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 sm:pb-20 lg:pt-10">
        <div className="mb-6 flex items-end justify-between border-b border-ink/10 pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Everything in context
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
              小团队需要的，刚刚好。
            </h2>
          </div>
          <p className="hidden text-[11px] text-ink-faint sm:block">
            从想法到上线，不离开同一块任务墙
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              icon: RefreshCw,
              index: '01',
              title: '团队同步',
              text: '任务、负责人和成员变化会在数秒内同步，不再互相追问最新状态。',
            },
            {
              icon: ImageIcon,
              index: '02',
              title: '附件即上下文',
              text: '直接拖入文件；图片成为卡片封面，需求和实现始终放在一起。',
            },
            {
              icon: Users,
              index: '03',
              title: '轻量协作',
              text: '用 GitHub 身份邀请伙伴，项目和权限足够清楚，但没有多余流程。',
            },
          ].map((item) => (
            <article
              key={item.title}
              className="group rounded-[20px] border border-ink/10 bg-card p-5 transition-transform hover:-translate-y-0.5 sm:p-6"
            >
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-xl bg-canvas">
                  <item.icon className="size-4" />
                </span>
                <span className="font-mono text-[10px] text-ink-faint">
                  {item.index}
                </span>
              </div>
              <h3 className="mt-6 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-ink-subtle">
                {item.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-7 text-[11px] text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Kanby · Build less. Ship more.</p>
          <p className="flex items-center gap-1.5">
            <GitBranch className="size-3" /> GitHub identity · Cloudflare
            infrastructure
          </p>
        </div>
      </footer>
    </main>
  );
}
