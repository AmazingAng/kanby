'use client';

/* oxlint-disable next/no-html-link-for-pages -- vinext RSC Link navigation is unstable on the Worker runtime; force document navigation. */

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderKanban,
  GitBranch,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Save,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppHeader, type AppUser } from '@/components/kanby-shell';
import {
  resolveSettingsProject,
  settingsProjectPath,
} from '@/lib/settings-project';
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

type ProjectMember = AppUser & { role: 'owner' | 'member'; pending?: boolean };

type GitHubRepository = {
  id: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  selected: boolean;
};

type GitHubActivity = {
  id: string;
  kind: string;
  action: string;
  title: string;
  summary: string;
  url: string | null;
  actorLogin: string;
  actorAvatarUrl: string | null;
  createdAt: number;
};

type GitHubAutomation = {
  issueTaskCreation: boolean;
  autoLinkPullRequests: boolean;
  pullRequestOpenStatus: 'ideas' | 'building' | 'shipped' | null;
  completionStatus: 'ideas' | 'building' | 'shipped' | null;
  showCiFailures: boolean;
};

type GitHubConnection = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  installationUrl: string | null;
  repositories: GitHubRepository[];
  events: GitHubActivity[];
  automation: GitHubAutomation;
};

type GitHubDiagnostics = {
  health:
    | 'healthy'
    | 'degraded'
    | 'suspended'
    | 'unreachable'
    | 'misconfigured'
    | 'disconnected';
  message: string;
  backlog: number;
  failures: Array<{
    id: string;
    event: string;
    attempts: number;
    error: string | null;
    updatedAt: number;
  }>;
  lastSync: {
    status: string;
    itemCount: number;
    error: string | null;
    finishedAt: number | null;
  } | null;
};

type AgentToken = {
  id: string;
  name: string;
  label: string;
  user: AppUser;
  canRevoke: boolean;
  prefix: string;
  scopes: string[];
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export function SettingsApp() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [githubConnection, setGithubConnection] =
    useState<GitHubConnection | null>(null);
  const [githubDiagnostics, setGithubDiagnostics] =
    useState<GitHubDiagnostics | null>(null);
  const [githubRecovering, setGithubRecovering] = useState(false);
  const [agentTokens, setAgentTokens] = useState<AgentToken[]>([]);
  const [agentName, setAgentName] = useState('Codex');
  const [agentExpiry, setAgentExpiry] = useState('90');
  const [generatedToken, setGeneratedToken] = useState('');
  const [githubSelection, setGithubSelection] = useState<Set<string>>(
    new Set(),
  );
  const [githubAutomation, setGithubAutomation] =
    useState<GitHubAutomation | null>(null);
  const [projectName, setProjectName] = useState('');
  const [identity, setIdentity] = useState('');
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubSaving, setGithubSaving] = useState(false);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentSaving, setAgentSaving] = useState(false);
  const [agentCopied, setAgentCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/auth/session', { cache: 'no-store' }),
      fetch('/api/projects', { cache: 'no-store' }),
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
          const selected = resolveSettingsProject(
            payload.projects,
            window.location.search,
          );
          setSelectedId(selected?.id ?? '');
          setProjectName(selected?.name ?? '');
          if (selected) {
            const nextPath = settingsProjectPath(
              window.location.href,
              selected.id,
            );
            const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            if (nextPath !== currentPath)
              window.history.replaceState(window.history.state, '', nextPath);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('设置暂时无法加载，请刷新重试。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/members?projectId=${encodeURIComponent(selectedId)}`, {
        cache: 'no-store',
      }),
      fetch(`/api/github?projectId=${encodeURIComponent(selectedId)}`, {
        cache: 'no-store',
      }),
      fetch(`/api/agent-tokens?projectId=${encodeURIComponent(selectedId)}`, {
        cache: 'no-store',
      }),
      fetch(
        `/api/github/recovery?projectId=${encodeURIComponent(selectedId)}`,
        {
          cache: 'no-store',
        },
      ),
    ])
      .then(
        async ([
          membersResponse,
          githubResponse,
          agentResponse,
          diagnosticsResponse,
        ]) => {
          if (!membersResponse.ok || !githubResponse.ok || !agentResponse.ok)
            throw new Error('settings');
          const memberPayload = (await membersResponse.json()) as {
            members: ProjectMember[];
          };
          const githubPayload = (await githubResponse.json()) as {
            configured: boolean;
            connection: GitHubConnection | null;
          };
          const agentPayload = (await agentResponse.json()) as {
            tokens: AgentToken[];
          };
          const diagnosticsPayload = diagnosticsResponse.ok
            ? ((await diagnosticsResponse.json()) as {
                diagnostics: GitHubDiagnostics;
              })
            : null;
          if (!cancelled) {
            setMembers(memberPayload.members);
            setGithubConfigured(githubPayload.configured);
            setGithubConnection(githubPayload.connection);
            setGithubAutomation(githubPayload.connection?.automation ?? null);
            setGithubSelection(
              new Set(
                githubPayload.connection?.repositories
                  .filter((repository) => repository.selected)
                  .map((repository) => repository.id) ?? [],
              ),
            );
            setAgentTokens(agentPayload.tokens);
            setGeneratedToken('');
            setGithubDiagnostics(diagnosticsPayload?.diagnostics ?? null);
          }
        },
      )
      .catch(() => {
        if (!cancelled) setError('项目设置加载失败。');
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
          setGithubLoading(false);
          setAgentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function renameProject(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedProject ||
      selectedProject.role !== 'owner' ||
      !projectName.trim()
    )
      return;
    setSaving(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          name: projectName.trim(),
        }),
      });
      if (!response.ok) throw new Error('rename');
      const payload = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(payload.projects);
    } catch {
      setError('项目名称保存失败。');
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject || !identity.trim()) return;
    try {
      const response = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          identity: identity.trim(),
        }),
      });
      if (!response.ok) throw new Error('invite');
      const payload = (await response.json()) as { members: ProjectMember[] };
      setMembers(payload.members);
      setProjects((current) =>
        current.map((project) =>
          project.id === selectedProject.id
            ? { ...project, memberCount: payload.members.length }
            : project,
        ),
      );
      setIdentity('');
    } catch {
      setError('成员添加失败，请检查 GitHub 用户名或邮箱。');
    }
  }

  async function removeMember(memberId: string) {
    if (!selectedProject) return;
    try {
      const response = await fetch('/api/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, memberId }),
      });
      if (!response.ok) throw new Error('remove');
      const payload = (await response.json()) as { members: ProjectMember[] };
      setMembers(payload.members);
      setProjects((current) =>
        current.map((project) =>
          project.id === selectedProject.id
            ? { ...project, memberCount: payload.members.length }
            : project,
        ),
      );
    } catch {
      setError('成员移除失败。');
    }
  }

  async function copyBoardLink() {
    if (!selectedProject) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/${encodeURIComponent(selectedProject.slug)}/board`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('看板链接复制失败，请手动复制。');
    }
  }

  async function saveGitHubRepositories() {
    if (!selectedProject || selectedProject.role !== 'owner') return;
    setGithubSaving(true);
    try {
      const response = await fetch('/api/github', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          repositoryIds: [...githubSelection],
        }),
      });
      if (!response.ok) throw new Error('github');
      const payload = (await response.json()) as {
        connection: GitHubConnection;
      };
      setGithubConnection(payload.connection);
      setGithubSelection(
        new Set(
          payload.connection.repositories
            .filter((repository) => repository.selected)
            .map((repository) => repository.id),
        ),
      );
    } catch {
      setError('GitHub 仓库设置保存失败。');
    } finally {
      setGithubSaving(false);
    }
  }

  async function runGitHubOperation(action: 'recover' | 'backfill') {
    if (!selectedProject || selectedProject.role !== 'owner') return;
    setGithubRecovering(true);
    setError('');
    try {
      const response = await fetch('/api/github/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, action }),
      });
      if (!response.ok) throw new Error('recovery');
      const diagnosticsResponse = await fetch(
        `/api/github/recovery?projectId=${encodeURIComponent(selectedProject.id)}`,
        { cache: 'no-store' },
      );
      if (diagnosticsResponse.ok) {
        const payload = (await diagnosticsResponse.json()) as {
          diagnostics: GitHubDiagnostics;
        };
        setGithubDiagnostics(payload.diagnostics);
      }
    } catch {
      setError(
        action === 'backfill'
          ? 'GitHub 历史补同步失败。'
          : 'GitHub 事件恢复失败。',
      );
    } finally {
      setGithubRecovering(false);
    }
  }

  async function saveGitHubAutomation() {
    if (
      !selectedProject ||
      selectedProject.role !== 'owner' ||
      !githubAutomation
    )
      return;
    setGithubSaving(true);
    try {
      const response = await fetch('/api/github', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          automation: githubAutomation,
        }),
      });
      if (!response.ok) throw new Error('github automation');
      const payload = (await response.json()) as {
        connection: GitHubConnection;
      };
      setGithubConnection(payload.connection);
      setGithubAutomation(payload.connection.automation);
    } catch {
      setError('GitHub 自动化规则保存失败。');
    } finally {
      setGithubSaving(false);
    }
  }

  async function createAgentAccess(
    event: React.SyntheticEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selectedProject || !agentName.trim()) return;
    setAgentSaving(true);
    setGeneratedToken('');
    try {
      const response = await fetch('/api/agent-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          name: agentName.trim(),
          expiresInDays: agentExpiry === 'never' ? null : Number(agentExpiry),
        }),
      });
      if (!response.ok) throw new Error('agent');
      const payload = (await response.json()) as {
        token: string;
        record: AgentToken;
      };
      setAgentTokens((current) => [payload.record, ...current]);
      setGeneratedToken(payload.token);
    } catch {
      setError('Agent Token 创建失败。');
    } finally {
      setAgentSaving(false);
    }
  }

  async function revokeAgentAccess(tokenId: string) {
    if (!selectedProject) return;
    try {
      const response = await fetch('/api/agent-tokens', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, tokenId }),
      });
      if (!response.ok) throw new Error('agent');
      const payload = (await response.json()) as { tokens: AgentToken[] };
      setAgentTokens(payload.tokens);
    } catch {
      setError('Agent Token 撤销失败。');
    }
  }

  async function copyAgentToken() {
    if (!generatedToken) return;
    try {
      await navigator.clipboard.writeText(generatedToken);
      setAgentCopied(true);
      window.setTimeout(() => setAgentCopied(false), 1600);
    } catch {
      setError('Token 复制失败，请手动复制。');
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
        <section className="w-full max-w-md rounded-[24px] border border-ink/10 bg-card p-7 text-center">
          <LockKeyhole className="mx-auto size-6" />
          <h1 className="mt-4 text-2xl font-semibold">登录后管理设置</h1>
          <a
            href="/api/auth/github?returnTo=%2Fsettings"
            className={cn(
              buttonVariants(),
              'mt-6 h-11 w-full rounded-full bg-ink text-background',
            )}
          >
            使用 GitHub 登录 <ArrowRight />
          </a>
        </section>
      </main>
    );

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <AppHeader user={user} active="settings" />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Settings
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">
            工作区设置
          </h1>
          <p className="mt-3 text-sm text-ink-subtle">
            管理身份、项目信息和协作者。
          </p>
        </div>
        {error && (
          <button
            onClick={() => setError('')}
            className="mt-6 flex w-full items-center justify-between rounded-2xl border border-[#c94032]/20 bg-[#c94032]/5 px-4 py-3 text-left text-xs text-[#9d3026]"
          >
            <span>{error}</span>
            <X className="size-3.5" />
          </button>
        )}

        <div className="mt-8 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <section className="rounded-[22px] border border-ink/10 bg-card p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                GitHub 账号
              </p>
              <div className="mt-4 flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="bg-acid font-semibold">
                    {user.name.slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-xs text-ink-faint">
                    @{user.login}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-canvas px-3 py-2 text-[11px] text-ink-subtle">
                <GitBranch className="size-3.5" /> 由 GitHub 安全登录
              </div>
            </section>
            <section className="rounded-[22px] border border-ink/10 bg-card p-3">
              <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                选择项目
              </p>
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    if (project.id === selectedId) return;
                    setMembersLoading(true);
                    setGithubLoading(true);
                    setAgentLoading(true);
                    setGeneratedToken('');
                    setSelectedId(project.id);
                    setProjectName(project.name);
                    window.history.replaceState(
                      window.history.state,
                      '',
                      settingsProjectPath(window.location.href, project.id),
                    );
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-ink/5',
                    selectedId === project.id &&
                      'bg-ink text-background hover:bg-ink',
                  )}
                >
                  <span className="truncate">{project.name}</span>
                  <span
                    className={cn(
                      'text-[10px]',
                      selectedId === project.id
                        ? 'text-background/60'
                        : 'text-ink-faint',
                    )}
                  >
                    {project.memberCount} 人
                  </span>
                </button>
              ))}
              {projects.length === 0 && (
                <p className="px-2 py-4 text-xs text-ink-faint">还没有项目。</p>
              )}
            </section>
            {selectedProject && (
              <nav
                aria-label="设置章节"
                className="flex flex-wrap gap-1 rounded-2xl border border-ink/10 bg-card p-2 lg:flex-col"
              >
                {[
                  ['project-info', '项目信息'],
                  ['github-integration', 'GitHub 仓库'],
                  ['agent-access', 'Agent Token'],
                  ['team-members', '团队成员'],
                ].map(([id, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="rounded-xl px-3 py-2.5 text-xs font-medium text-ink-subtle transition-colors hover:bg-ink/5 hover:text-ink"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            )}
          </aside>

          <div className="space-y-5">
            {selectedProject ? (
              <>
                <section
                  id="project-info"
                  className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs text-ink-faint">项目信息</p>
                      <h2 className="mt-1 text-xl font-semibold">
                        名称与看板地址
                      </h2>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full border-ink/10 bg-canvas text-[9px]"
                    >
                      {selectedProject.role === 'owner' ? 'OWNER' : 'MEMBER'}
                    </Badge>
                  </div>
                  <form onSubmit={renameProject} className="mt-6">
                    <label
                      className="text-xs font-medium"
                      htmlFor="project-setting-name"
                    >
                      项目名称
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        id="project-setting-name"
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        disabled={selectedProject.role !== 'owner'}
                        maxLength={80}
                        className="h-11 rounded-xl border-ink/15 px-3 focus-visible:ring-0"
                      />
                      <Button
                        type="submit"
                        disabled={
                          saving ||
                          selectedProject.role !== 'owner' ||
                          !projectName.trim() ||
                          projectName.trim() === selectedProject.name
                        }
                        className="h-11 rounded-xl bg-ink px-4 text-background"
                      >
                        <Save /> 保存
                      </Button>
                    </div>
                    <p className="mt-2 text-[11px] text-ink-faint">
                      修改名称不会改变已经分享的 slug 地址。
                    </p>
                  </form>
                  <div className="mt-5">
                    <p className="text-xs font-medium">看板链接</p>
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink/10 bg-canvas p-2 pl-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-subtle">
                        /{selectedProject.slug}/board
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-lg"
                        onClick={() => void copyBoardLink()}
                      >
                        {copied ? <Check /> : <Copy />}
                        {copied ? '已复制' : '复制'}
                      </Button>
                      <a
                        href={`/${encodeURIComponent(selectedProject.slug)}/board`}
                        className={cn(
                          buttonVariants({ size: 'sm' }),
                          'rounded-lg bg-ink text-background',
                        )}
                      >
                        打开 <ArrowRight />
                      </a>
                    </div>
                  </div>
                </section>

                <section
                  id="github-integration"
                  className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-ink-faint">
                        Repository activity
                      </p>
                      <h2 className="mt-1 text-xl font-semibold">
                        GitHub 仓库联动
                      </h2>
                    </div>
                    <GitBranch className="size-5 text-ink-faint" />
                  </div>
                  {githubLoading ? (
                    <div className="grid place-items-center py-12">
                      <LoaderCircle className="size-4 animate-spin text-ink-faint" />
                    </div>
                  ) : !githubConfigured ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-ink/15 bg-canvas p-5">
                      <p className="text-sm font-medium">GitHub App 尚未配置</p>
                      <p className="mt-2 text-xs leading-5 text-ink-subtle">
                        部署者需要设置 App ID、slug、私钥和 Webhook
                        secret。配置完成后，团队可授权公开与私有仓库。
                      </p>
                    </div>
                  ) : !githubConnection ? (
                    <div className="mt-5 rounded-2xl bg-ink p-5 text-background">
                      <p className="text-sm font-semibold">连接项目仓库</p>
                      <p className="mt-2 max-w-xl text-xs leading-5 text-background/65">
                        通过 GitHub App 选择组织或个人仓库。Kanby
                        只读取你安装时授权的仓库，并使用短期访问令牌。
                      </p>
                      {selectedProject.role === 'owner' ? (
                        <a
                          href={`/api/github/connect?projectId=${encodeURIComponent(selectedProject.id)}`}
                          className={cn(
                            buttonVariants(),
                            'mt-5 rounded-full bg-acid text-ink hover:bg-acid/85',
                          )}
                        >
                          安装 GitHub App <ArrowRight />
                        </a>
                      ) : (
                        <p className="mt-4 text-xs text-background/60">
                          请让项目所有者完成连接。
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-5">
                      <div className="flex flex-col gap-3 rounded-2xl bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            {githubConnection.accountLogin}
                          </p>
                          <p className="mt-1 text-[11px] text-ink-faint">
                            已授权 {githubConnection.repositories.length} 个仓库
                            ·{' '}
                            {
                              githubConnection.repositories.filter(
                                (repository) => repository.private,
                              ).length
                            }{' '}
                            个私有仓库
                          </p>
                        </div>
                        <a
                          href={`/api/github/connect?projectId=${encodeURIComponent(selectedProject.id)}`}
                          className={cn(
                            buttonVariants({ variant: 'outline', size: 'sm' }),
                            'rounded-full border-ink/15 bg-card',
                          )}
                        >
                          调整授权 <ExternalLink />
                        </a>
                      </div>
                      {githubDiagnostics && (
                        <div
                          className={cn(
                            'mt-3 rounded-2xl border p-4',
                            githubDiagnostics.health === 'healthy'
                              ? 'border-acid/40 bg-acid/10'
                              : 'border-[#c94032]/25 bg-[#c94032]/5',
                          )}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-2.5">
                              {githubDiagnostics.health === 'healthy' ? (
                                <Check className="mt-0.5 size-4 shrink-0" />
                              ) : (
                                <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#9d3026]" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold">
                                  {githubDiagnostics.message}
                                </p>
                                <p className="mt-1 text-[11px] text-ink-faint">
                                  待重试 {githubDiagnostics.backlog} 条
                                  {githubDiagnostics.lastSync
                                    ? ` · 上次补同步 ${githubDiagnostics.lastSync.itemCount} 条`
                                    : ' · 尚未补同步历史'}
                                </p>
                              </div>
                            </div>
                            {selectedProject.role === 'owner' && (
                              <div className="flex shrink-0 gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={githubRecovering}
                                  onClick={() =>
                                    void runGitHubOperation('recover')
                                  }
                                  className="rounded-full bg-card"
                                >
                                  <RefreshCw
                                    className={cn(
                                      githubRecovering && 'animate-spin',
                                    )}
                                  />
                                  恢复事件
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={githubRecovering}
                                  onClick={() =>
                                    void runGitHubOperation('backfill')
                                  }
                                  className="rounded-full bg-ink text-background"
                                >
                                  补同步历史
                                </Button>
                              </div>
                            )}
                          </div>
                          {githubDiagnostics.failures.length > 0 && (
                            <p className="mt-3 truncate border-t border-ink/10 pt-3 text-[10px] text-[#9d3026]">
                              最近失败：{githubDiagnostics.failures[0].event} ·
                              尝试 {githubDiagnostics.failures[0].attempts} 次 ·{' '}
                              {githubDiagnostics.failures[0].error ??
                                '等待重试'}
                            </p>
                          )}
                        </div>
                      )}
                      <div className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-ink/10 p-2">
                        {githubConnection.repositories.map((repository) => (
                          <label
                            key={repository.id}
                            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink/[0.03]"
                          >
                            <input
                              type="checkbox"
                              checked={githubSelection.has(repository.id)}
                              disabled={selectedProject.role !== 'owner'}
                              onChange={(event) =>
                                setGithubSelection((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked)
                                    next.add(repository.id);
                                  else next.delete(repository.id);
                                  return next;
                                })
                              }
                              className="size-4 accent-[#1c1c18]"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {repository.fullName}
                            </span>
                            {repository.private && (
                              <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                                <LockKeyhole className="size-3" /> PRIVATE
                              </span>
                            )}
                          </label>
                        ))}
                        {githubConnection.repositories.length === 0 && (
                          <p className="px-3 py-6 text-center text-xs text-ink-faint">
                            安装中尚未授权仓库。
                          </p>
                        )}
                      </div>
                      {selectedProject.role === 'owner' && (
                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-[11px] text-ink-faint">
                            选中的仓库会出现在任务关联和动态流中。
                          </p>
                          <Button
                            type="button"
                            disabled={githubSaving}
                            onClick={() => void saveGitHubRepositories()}
                            className="rounded-full bg-ink text-background"
                          >
                            {githubSaving ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <Save />
                            )}
                            保存仓库
                          </Button>
                        </div>
                      )}
                      {githubAutomation && (
                        <fieldset
                          disabled={selectedProject.role !== 'owner'}
                          className="mt-6 border-t border-ink/10 pt-5 disabled:opacity-60"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold">
                                自动化规则
                              </p>
                              <p className="mt-1 text-xs leading-5 text-ink-faint">
                                每个项目独立生效。关闭移动规则后仍会保留 GitHub
                                动态。
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-ink/10 bg-canvas text-[9px]"
                            >
                              PROJECT
                            </Badge>
                          </div>
                          <div className="mt-4 divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-canvas px-4">
                            <label
                              htmlFor="github-rule-issue-import"
                              aria-label="Issue 一键创建任务"
                              className="flex cursor-pointer items-center justify-between gap-4 py-3.5"
                            >
                              <span>
                                <span className="block text-sm font-medium">
                                  Issue 一键创建任务
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-faint">
                                  在看板的 Issue 动态上显示创建按钮
                                </span>
                              </span>
                              <input
                                id="github-rule-issue-import"
                                type="checkbox"
                                checked={githubAutomation.issueTaskCreation}
                                onChange={(event) =>
                                  setGithubAutomation((current) =>
                                    current
                                      ? {
                                          ...current,
                                          issueTaskCreation:
                                            event.target.checked,
                                        }
                                      : current,
                                  )
                                }
                                className="size-4 shrink-0 accent-[#1c1c18]"
                              />
                            </label>
                            <label
                              htmlFor="github-rule-auto-link"
                              aria-label="自动关联 Agent PR"
                              className="flex cursor-pointer items-center justify-between gap-4 py-3.5"
                            >
                              <span>
                                <span className="block text-sm font-medium">
                                  自动关联 Agent PR
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-faint">
                                  识别 PR 中的 Kanby-Task 标记
                                </span>
                              </span>
                              <input
                                id="github-rule-auto-link"
                                type="checkbox"
                                checked={githubAutomation.autoLinkPullRequests}
                                onChange={(event) =>
                                  setGithubAutomation((current) =>
                                    current
                                      ? {
                                          ...current,
                                          autoLinkPullRequests:
                                            event.target.checked,
                                        }
                                      : current,
                                  )
                                }
                                className="size-4 shrink-0 accent-[#1c1c18]"
                              />
                            </label>
                            <label
                              htmlFor="github-rule-pr-open"
                              aria-label="PR 打开后的任务状态"
                              className="flex items-center justify-between gap-4 py-3.5"
                            >
                              <span>
                                <span className="block text-sm font-medium">
                                  PR 打开后
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-faint">
                                  已完成的任务不会被移回
                                </span>
                              </span>
                              <select
                                id="github-rule-pr-open"
                                value={
                                  githubAutomation.pullRequestOpenStatus ??
                                  'off'
                                }
                                onChange={(event) =>
                                  setGithubAutomation((current) =>
                                    current
                                      ? {
                                          ...current,
                                          pullRequestOpenStatus:
                                            event.target.value === 'off'
                                              ? null
                                              : (event.target
                                                  .value as GitHubAutomation['pullRequestOpenStatus']),
                                        }
                                      : current,
                                  )
                                }
                                className="h-9 shrink-0 rounded-xl border border-ink/15 bg-card px-3 text-sm outline-none"
                              >
                                <option value="off">只记录</option>
                                <option value="ideas">待开始</option>
                                <option value="building">进行中</option>
                                <option value="shipped">已完成</option>
                              </select>
                            </label>
                            <label
                              htmlFor="github-rule-completion"
                              aria-label="PR 合并或 Issue 关闭后的任务状态"
                              className="flex items-center justify-between gap-4 py-3.5"
                            >
                              <span>
                                <span className="block text-sm font-medium">
                                  PR 合并 / Issue 关闭后
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-faint">
                                  未合并的关闭 PR 不触发
                                </span>
                              </span>
                              <select
                                id="github-rule-completion"
                                value={
                                  githubAutomation.completionStatus ?? 'off'
                                }
                                onChange={(event) =>
                                  setGithubAutomation((current) =>
                                    current
                                      ? {
                                          ...current,
                                          completionStatus:
                                            event.target.value === 'off'
                                              ? null
                                              : (event.target
                                                  .value as GitHubAutomation['completionStatus']),
                                        }
                                      : current,
                                  )
                                }
                                className="h-9 shrink-0 rounded-xl border border-ink/15 bg-card px-3 text-sm outline-none"
                              >
                                <option value="off">只记录</option>
                                <option value="ideas">待开始</option>
                                <option value="building">进行中</option>
                                <option value="shipped">已完成</option>
                              </select>
                            </label>
                            <label
                              htmlFor="github-rule-ci-warning"
                              aria-label="卡片显示 CI 失败"
                              className="flex cursor-pointer items-center justify-between gap-4 py-3.5"
                            >
                              <span>
                                <span className="block text-sm font-medium">
                                  卡片显示 CI 失败
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-faint">
                                  仅提示，不改变任务状态
                                </span>
                              </span>
                              <input
                                id="github-rule-ci-warning"
                                type="checkbox"
                                checked={githubAutomation.showCiFailures}
                                onChange={(event) =>
                                  setGithubAutomation((current) =>
                                    current
                                      ? {
                                          ...current,
                                          showCiFailures: event.target.checked,
                                        }
                                      : current,
                                  )
                                }
                                className="size-4 shrink-0 accent-[#1c1c18]"
                              />
                            </label>
                          </div>
                          {selectedProject.role === 'owner' && (
                            <div className="mt-3 flex justify-end">
                              <Button
                                type="button"
                                disabled={githubSaving}
                                onClick={() => void saveGitHubAutomation()}
                                className="rounded-full bg-ink text-background"
                              >
                                {githubSaving ? (
                                  <LoaderCircle className="animate-spin" />
                                ) : (
                                  <Save />
                                )}
                                保存规则
                              </Button>
                            </div>
                          )}
                        </fieldset>
                      )}
                      {githubConnection.events.length > 0 && (
                        <div className="mt-6 border-t border-ink/10 pt-5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                            最近动态
                          </p>
                          <div className="mt-3 space-y-2">
                            {githubConnection.events
                              .slice(0, 5)
                              .map((activity) => (
                                <a
                                  key={activity.id}
                                  href={activity.url ?? '#'}
                                  target={activity.url ? '_blank' : undefined}
                                  rel="noreferrer"
                                  className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-ink/[0.03]"
                                >
                                  <Avatar size="sm">
                                    <AvatarImage
                                      src={activity.actorAvatarUrl ?? undefined}
                                      alt=""
                                    />
                                    <AvatarFallback>
                                      {activity.actorLogin
                                        .slice(0, 1)
                                        .toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium">
                                      {activity.title}
                                    </p>
                                    <p className="mt-1 truncate text-[10px] text-ink-faint">
                                      {activity.summary}
                                    </p>
                                  </div>
                                </a>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section
                  id="agent-access"
                  className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs text-ink-faint">Agent access</p>
                      <h2 className="mt-1 text-xl font-semibold">
                        CLI 与 Coding Agent
                      </h2>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-ink-subtle">
                        每位成员都可以签发自己的 Token，让 Codex
                        或脚本领取任务、汇报进度并关联 GitHub PR。
                      </p>
                    </div>
                    <Bot className="size-5 text-ink-faint" />
                  </div>
                  <form
                    onSubmit={createAgentAccess}
                    className="mt-5 grid gap-2 sm:grid-cols-[1fr_140px_auto]"
                  >
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                      <Input
                        value={agentName}
                        onChange={(event) => setAgentName(event.target.value)}
                        maxLength={48}
                        placeholder="Token 名称"
                        className="h-11 rounded-xl border-ink/15 pl-9 focus-visible:ring-0"
                      />
                    </div>
                    <select
                      value={agentExpiry}
                      onChange={(event) => setAgentExpiry(event.target.value)}
                      className="h-11 rounded-xl border border-ink/15 bg-card px-3 text-sm outline-none"
                    >
                      <option value="30">30 天</option>
                      <option value="90">90 天</option>
                      <option value="365">1 年</option>
                      <option value="never">永不过期</option>
                    </select>
                    <Button
                      type="submit"
                      disabled={agentSaving || !agentName.trim()}
                      className="h-11 rounded-xl bg-acid px-4 text-ink hover:bg-acid/80"
                    >
                      {agentSaving ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <KeyRound />
                      )}
                      创建 Token
                    </Button>
                  </form>
                  <p className="mt-2 text-[11px] text-ink-faint">
                    Token 标识：
                    <code className="ml-1 font-mono text-ink-subtle">
                      {user.login}_{agentName.trim() || 'tokenname'}
                    </code>
                    {selectedProject.role === 'owner'
                      ? ' · 你可以管理项目内全部 Token'
                      : ' · 你只能查看和撤销自己的 Token'}
                  </p>
                  {generatedToken && (
                    <div className="mt-4 rounded-2xl bg-ink p-4 text-background">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">
                            现在复制 Token
                          </p>
                          <p className="mt-1 text-xs text-background/60">
                            离开本页后不会再次显示。
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void copyAgentToken()}
                          className="rounded-full bg-acid text-ink hover:bg-acid/85"
                        >
                          {agentCopied ? <Check /> : <Copy />}
                          {agentCopied ? '已复制' : '复制'}
                        </Button>
                      </div>
                      <code className="mt-4 block overflow-x-auto rounded-xl bg-black/25 p-3 text-xs text-acid">
                        {generatedToken}
                      </code>
                      <p className="mt-3 font-mono text-[11px] text-background/60">
                        export KANBY_TOKEN=&apos;…&apos; &amp;&amp; kanby auth
                        status
                      </p>
                    </div>
                  )}
                  <div className="mt-5 space-y-2">
                    {agentLoading ? (
                      <div className="grid place-items-center py-8">
                        <LoaderCircle className="size-4 animate-spin text-ink-faint" />
                      </div>
                    ) : agentTokens.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-ink/15 px-4 py-7 text-center text-sm text-ink-faint">
                        还没有 Agent Token。
                      </div>
                    ) : (
                      agentTokens.map((token) => (
                        <div
                          key={token.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold">
                                {token.label}
                              </p>
                              {token.revokedAt && (
                                <Badge
                                  variant="outline"
                                  className="rounded-full text-[9px]"
                                >
                                  已撤销
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">
                              {token.prefix}… ·{' '}
                              {token.lastUsedAt
                                ? `最近使用 ${new Date(token.lastUsedAt).toLocaleDateString()}`
                                : '尚未使用'}{' '}
                              ·{' '}
                              {token.expiresAt
                                ? `${new Date(token.expiresAt).toLocaleDateString()} 到期`
                                : '永不过期'}
                            </p>
                          </div>
                          {token.canRevoke && !token.revokedAt && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void revokeAgentAccess(token.id)}
                              className="shrink-0 rounded-full text-ink-faint hover:text-[#9d3026]"
                              aria-label={`撤销 ${token.label}`}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section
                  id="team-members"
                  className="scroll-mt-20 rounded-[22px] border border-ink/10 bg-card p-5 sm:p-6"
                >
                  <div>
                    <p className="text-xs text-ink-faint">Collaborators</p>
                    <h2 className="mt-1 text-xl font-semibold">团队成员</h2>
                  </div>
                  {selectedProject.role === 'owner' && (
                    <form onSubmit={inviteMember} className="mt-5 flex gap-2">
                      <div className="relative flex-1">
                        <UserPlus className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                        <Input
                          value={identity}
                          onChange={(event) => setIdentity(event.target.value)}
                          placeholder="GitHub 用户名或邮箱"
                          className="h-11 rounded-xl border-ink/15 pl-9 focus-visible:ring-0"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={!identity.trim()}
                        className="h-11 rounded-xl bg-acid px-4 text-ink hover:bg-acid/80"
                      >
                        邀请
                      </Button>
                    </form>
                  )}
                  <div className="mt-5 space-y-1">
                    {membersLoading ? (
                      <div className="grid place-items-center py-10">
                        <LoaderCircle className="size-4 animate-spin text-ink-faint" />
                      </div>
                    ) : (
                      members.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-xl px-2 py-2.5 hover:bg-ink/[0.03]"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar size="sm">
                              <AvatarImage
                                src={
                                  member.pending
                                    ? undefined
                                    : (member.avatarUrl ?? undefined)
                                }
                                alt=""
                              />
                              <AvatarFallback className="bg-acid font-semibold">
                                {member.pending
                                  ? '?'
                                  : member.name.slice(0, 1).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {member.pending ? member.login : member.name}
                              </p>
                              <p className="truncate text-[11px] text-ink-faint">
                                {member.pending
                                  ? '等待首次 GitHub 登录'
                                  : `@${member.login}`}{' '}
                                · {member.role === 'owner' ? '所有者' : '成员'}
                              </p>
                            </div>
                          </div>
                          {selectedProject.role === 'owner' &&
                            member.role !== 'owner' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="rounded-full text-ink-faint hover:text-[#9d3026]"
                                onClick={() => void removeMember(member.id)}
                                aria-label={`移除 ${member.login}`}
                              >
                                <X />
                              </Button>
                            )}
                        </div>
                      ))
                    )}
                  </div>
                  <p className="mt-4 border-t border-ink/10 pt-4 text-[11px] leading-5 text-ink-faint">
                    邀请会在对方使用对应 GitHub
                    用户名或已验证邮箱登录时自动生效。
                  </p>
                </section>
              </>
            ) : (
              <section className="grid min-h-80 place-items-center rounded-[22px] border border-dashed border-ink/15 bg-card/40 p-8 text-center">
                <div>
                  <FolderKanban className="mx-auto size-6 text-ink-faint" />
                  <h2 className="mt-4 text-lg font-semibold">
                    没有可设置的项目
                  </h2>
                  <a
                    href="/app"
                    className={cn(
                      buttonVariants(),
                      'mt-5 rounded-full bg-ink text-background',
                    )}
                  >
                    返回项目页
                  </a>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
