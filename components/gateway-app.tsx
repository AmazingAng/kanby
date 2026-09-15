'use client';

/* oxlint-disable next/no-html-link-for-pages -- vinext RSC Link navigation is unstable on the Worker runtime; force document navigation. */

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  FolderKanban,
  FolderPlus,
  LoaderCircle,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react';

import { appPath } from '@/lib/app-path';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppHeader, type AppUser } from '@/components/kanby-shell';
import { cn } from '@/lib/utils';

type ProjectSummary = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'member';
  memberCount: number;
  taskCount: number;
  shippedCount: number;
  updatedAt: number;
};

function boardPath(project: ProjectSummary) {
  return appPath(`/${encodeURIComponent(project.slug)}/board`);
}

export function GatewayApp() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(appPath('/api/auth/session'), { cache: 'no-store' }),
      fetch(appPath('/api/projects'), { cache: 'no-store' }),
    ])
      .then(async ([sessionResponse, projectResponse]) => {
        const session = sessionResponse.ok
          ? ((await sessionResponse.json()) as { user: AppUser | null })
          : { user: null };
        const payload = projectResponse.ok
          ? ((await projectResponse.json()) as { projects: ProjectSummary[] })
          : { projects: [] };
        if (!cancelled) {
          setUser(session.user);
          setProjects(payload.projects);
        }
      })
      .catch(() => {
        if (!cancelled) setError('工作台暂时无法加载，请刷新重试。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(
    () =>
      projects.reduce(
        (result, project) => ({
          tasks: result.tasks + project.taskCount,
          shipped: result.shipped + project.shippedCount,
          members: Math.max(result.members, project.memberCount),
        }),
        { tasks: 0, shipped: 0, members: 0 },
      ),
    [projects],
  );

  async function createProject(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const response = await fetch(appPath('/api/projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('create');
      const payload = (await response.json()) as { project: ProjectSummary };
      window.location.assign(boardPath(payload.project));
    } catch {
      setError('项目创建失败，请重试。');
      setCreating(false);
    }
  }

  if (loading)
    return (
      <main className="grid min-h-dvh place-items-center bg-background">
        <LoaderCircle className="size-5 animate-spin text-ink-faint" />
      </main>
    );
  if (!user)
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-5">
        <section className="w-full max-w-md rounded-[24px] border border-ink/10 bg-card p-7 text-center shadow-[0_24px_80px_rgba(20,20,15,0.08)]">
          <FolderKanban className="mx-auto size-7" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            登录后进入工作台
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-subtle">
            项目、任务和团队设置会安全地保存在你的 Kanby 空间。
          </p>
          <a
            href={appPath('/api/auth/github?returnTo=%2Fapp')}
            className={cn(
              buttonVariants(),
              'mt-6 h-11 w-full rounded-full bg-ink text-background',
            )}
          >
            使用 GitHub 登录 <ArrowRight />
          </a>
          <a
            href={appPath('/')}
            className="mt-4 block text-xs text-ink-faint hover:text-ink"
          >
            返回首页
          </a>
        </section>
      </main>
    );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <AppHeader user={user} active="gateway" />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              我的工作区
            </p>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              欢迎回来，{user.name.split(' ')[0]}。
            </h1>
            <p className="mt-3 text-sm text-ink-subtle">
              选择一个项目，继续把事情做出来。
            </p>
          </div>
          <Button
            onClick={() => setComposerOpen(true)}
            className="h-11 self-start rounded-full bg-acid px-5 text-ink hover:bg-acid/80 sm:self-auto"
          >
            <Plus /> 新建项目
          </Button>
        </section>

        {error && (
          <button
            onClick={() => setError('')}
            className="mt-6 flex w-full items-center justify-between rounded-2xl border border-[#c94032]/20 bg-[#c94032]/5 px-4 py-3 text-left text-xs text-[#9d3026]"
          >
            <span>{error}</span>
            <X className="size-3.5" />
          </button>
        )}

        <section
          className="mt-8 grid grid-cols-3 gap-2 sm:gap-3"
          aria-label="工作区概览"
        >
          {[
            ['项目', projects.length],
            ['任务', totals.tasks],
            ['已交付', totals.shipped],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-ink/10 bg-card p-4 sm:p-5"
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">你的项目</h2>
            <a
              href={appPath('/settings')}
              className="flex items-center gap-1.5 text-xs text-ink-subtle hover:text-ink"
            >
              <Settings className="size-3.5" /> 管理设置
            </a>
          </div>
          {projects.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => {
                const progress = project.taskCount
                  ? Math.round((project.shippedCount / project.taskCount) * 100)
                  : 0;
                return (
                  <a
                    key={project.id}
                    href={boardPath(project)}
                    className="group rounded-[22px] border border-ink/10 bg-card p-5 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-[0_18px_50px_rgba(20,20,15,0.08)]"
                  >
                    <div className="flex items-start justify-between">
                      <div className="grid size-10 place-items-center rounded-xl bg-ink text-background">
                        <FolderKanban className="size-4" />
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-full border-ink/10 bg-canvas text-[9px] text-ink-faint"
                      >
                        {project.role === 'owner' ? 'OWNER' : 'MEMBER'}
                      </Badge>
                    </div>
                    <h3 className="mt-5 truncate text-xl font-semibold tracking-tight">
                      {project.name}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[10px] text-ink-faint">
                      /{project.slug}/board
                    </p>
                    <div className="mt-6">
                      <div className="mb-2 flex items-center justify-between text-[10px] text-ink-subtle">
                        <span>
                          {project.shippedCount}/{project.taskCount} 已完成
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                        <div
                          className="h-full rounded-full bg-acid transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-[11px] text-ink-faint">
                      <span className="flex items-center gap-1">
                        <Users className="size-3" /> {project.memberCount}{' '}
                        位成员
                      </span>
                      <span className="flex items-center gap-1 font-medium text-ink-subtle group-hover:text-ink">
                        打开看板 <ArrowRight className="size-3" />
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-ink/15 bg-card/40 px-6 py-14 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-card shadow-sm">
                <FolderPlus className="size-5 text-ink-subtle" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">创建第一个项目</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-subtle">
                一个项目对应一块独立看板，可以邀请伙伴、上传附件并实时同步。
              </p>
              <Button
                onClick={() => setComposerOpen(true)}
                className="mt-5 rounded-full bg-ink px-5 text-background"
              >
                <FolderPlus /> 新建项目
              </Button>
            </div>
          )}
        </section>
      </div>

      {composerOpen && (
        <dialog
          open
          aria-labelledby="create-project-title"
          className="fixed inset-0 z-50 m-0 grid size-full max-h-none max-w-none items-end border-0 bg-ink/20 p-0 backdrop-blur-[2px] sm:place-items-center sm:p-4"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            onClick={() => setComposerOpen(false)}
            aria-label="关闭创建项目窗口"
          />
          <form
            onSubmit={createProject}
            className="relative z-10 w-full max-w-md rounded-t-[28px] border border-ink/10 bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-[0_24px_80px_rgba(20,20,15,0.18)] sm:rounded-[24px]"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-faint">新的工作空间</p>
                <h2
                  id="create-project-title"
                  className="mt-1 text-xl font-semibold"
                >
                  创建项目
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setComposerOpen(false)}
                aria-label="关闭创建项目"
              >
                <X />
              </Button>
            </div>
            <Input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              maxLength={80}
              aria-label="项目名称"
              placeholder="例如：Kanby v1"
              className="h-12 rounded-xl border-ink/15 px-4 text-base focus-visible:ring-0"
            />
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-ink-faint">将自动生成独立看板地址</p>
              <Button
                type="submit"
                disabled={creating || !projectName.trim()}
                className="rounded-full bg-acid px-5 text-ink hover:bg-acid/80"
              >
                {creating && <LoaderCircle className="animate-spin" />}
                {creating ? '创建中' : '创建并打开'} <ArrowRight />
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </main>
  );
}
