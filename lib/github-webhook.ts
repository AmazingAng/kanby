import {
  projectsForGitHubRepository,
  recordGitHubEvent,
  recordLinkedTaskPush,
  updateLinkedTaskCi,
  updateLinkedTasksFromGitHub,
} from '@/lib/github-db';
import {
  autoLinkPullRequest,
  recordReferencedPush,
} from '@/lib/github-automation';
import {
  getGitHubAppConfig,
  listPullRequestCommitMessages,
} from '@/lib/github';

type WebhookPayload = Record<string, unknown> & {
  action?: string;
  installation?: { id?: number };
  repository?: { id?: number; full_name?: string };
  sender?: { login?: string; avatar_url?: string };
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
function number(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

export async function processGitHubWebhook(
  event: string,
  deliveryId: string,
  raw: string,
  onlyProjectId?: string,
) {
  const payload = JSON.parse(raw) as WebhookPayload;
  const installationId = String(payload.installation?.id ?? '');
  const repositoryId = String(payload.repository?.id ?? '');
  if (!installationId || !repositoryId) return { ignored: true };
  const connectedProjects = await projectsForGitHubRepository(
    installationId,
    repositoryId,
  );
  const projects = onlyProjectId
    ? connectedProjects.filter((projectId) => projectId === onlyProjectId)
    : connectedProjects;
  if (projects.length === 0) return { ignored: true };
  const action = text(payload.action, event === 'push' ? 'pushed' : 'updated');
  const actorLogin = payload.sender?.login ?? 'github';
  const actorAvatarUrl = payload.sender?.avatar_url ?? null;
  const repoName = payload.repository?.full_name ?? 'repository';
  let title = repoName;
  let summary = `${actorLogin} updated ${repoName}`;
  let targetUrl: string | null = null;
  let itemNumber: number | null = null;

  if (event === 'issues' || event === 'pull_request') {
    const item = object(payload[event === 'issues' ? 'issue' : 'pull_request']);
    const kind =
      event === 'issues' ? ('issue' as const) : ('pull_request' as const);
    itemNumber = number(item.number);
    title = text(item.title, repoName);
    targetUrl = text(item.html_url) || null;
    summary = `${repoName} #${itemNumber} · ${action}`;
    if (itemNumber > 0 && targetUrl) {
      const head = kind === 'pull_request' ? object(item.head) : {};
      const branch = text(head.ref);
      const headRepositoryId = String(number(object(head.repo).id));
      if (
        kind === 'pull_request' &&
        ['opened', 'reopened'].includes(action) &&
        headRepositoryId === repositoryId
      ) {
        const config = getGitHubAppConfig();
        const commits =
          config && repoName !== 'repository'
            ? await listPullRequestCommitMessages(
                config,
                installationId,
                repoName,
                itemNumber,
              ).catch(() => [])
            : [];
        await autoLinkPullRequest({
          repositoryId,
          number: itemNumber,
          title,
          state: item.merged === true ? 'merged' : text(item.state, action),
          url: targetUrl,
          branch,
          body: text(item.body),
          commits,
          deliveryId,
          actorLogin,
          actorAvatarUrl,
        });
      }
      const automationTrigger =
        kind === 'pull_request' &&
        ['opened', 'reopened', 'ready_for_review'].includes(action)
          ? ('pull_request_opened' as const)
          : (kind === 'issue' && action === 'closed') ||
              (kind === 'pull_request' &&
                action === 'closed' &&
                item.merged === true)
            ? ('completed' as const)
            : undefined;
      await updateLinkedTasksFromGitHub({
        repositoryId,
        kind,
        number: itemNumber,
        title,
        state: item.merged === true ? 'merged' : text(item.state, action),
        url: targetUrl,
        branch: branch || null,
        automationTrigger,
        activity: { deliveryId, action, actorLogin, actorAvatarUrl, summary },
      });
    }
  } else if (event === 'workflow_run') {
    const run = object(payload.workflow_run);
    title = text(run.name, 'GitHub Actions');
    const branch = text(run.head_branch);
    const status = text(run.conclusion) || text(run.status, 'updated');
    targetUrl = text(run.html_url) || null;
    summary = `${repoName} · ${branch || 'workflow'} · ${status}`;
    if (branch)
      await updateLinkedTaskCi(repositoryId, branch, status, {
        deliveryId,
        action,
        actorLogin,
        actorAvatarUrl,
        summary,
      });
  } else if (event === 'push') {
    const commits = Array.isArray(payload.commits)
      ? payload.commits
          .map((value) => text(object(value).message))
          .filter(Boolean)
      : [];
    const commit = object(payload.head_commit);
    const headMessage = text(commit.message);
    if (headMessage && !commits.includes(headMessage))
      commits.unshift(headMessage);
    title = (headMessage || 'New push').split('\n')[0].slice(0, 160);
    targetUrl = text(commit.url) || text(payload.compare) || null;
    const branch = text(payload.ref).replace('refs/heads/', '');
    summary = `${repoName} · ${branch || 'push'}`;
    if (branch) {
      await recordLinkedTaskPush(repositoryId, branch, {
        deliveryId,
        action,
        actorLogin,
        actorAvatarUrl,
        summary,
      });
      await recordReferencedPush({
        repositoryId,
        branch,
        commits,
        deliveryId,
        actorLogin,
        actorAvatarUrl,
        url: targetUrl,
      });
    }
  }

  if (['issues', 'pull_request', 'workflow_run', 'push'].includes(event)) {
    await Promise.all(
      projects.map((projectId) =>
        recordGitHubEvent({
          id: `${deliveryId}:${projectId}`,
          projectId,
          repositoryId,
          kind: event,
          action,
          itemNumber,
          title,
          summary,
          url: targetUrl,
          actorLogin,
          actorAvatarUrl,
          createdAt: Date.now(),
        }),
      ),
    );
  }
  return { ignored: false };
}
