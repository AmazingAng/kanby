import { database } from '@/lib/db';
import {
  claimDueGitHubDeliveries,
  failGitHubDelivery,
  finishGitHubDelivery,
  finishGitHubSyncRun,
  githubReliabilitySummary,
  projectGitHubInstallation,
  releaseGitHubRedelivery,
  reserveGitHubRedelivery,
  selectedGitHubRepositoriesForProject,
  startGitHubSyncRun,
} from '@/lib/github-db';
import {
  getGitHubAppConfig,
  getGitHubInstallation,
  listGitHubAppDeliveries,
  listRepositoryHistory,
  redeliverGitHubAppDelivery,
} from '@/lib/github';
import { processGitHubWebhook } from '@/lib/github-webhook';

export async function retryLocalGitHubDeliveries(limit = 10) {
  const deliveries = await claimDueGitHubDeliveries(limit);
  let recovered = 0;
  for (const delivery of deliveries) {
    try {
      await processGitHubWebhook(delivery.event, delivery.id, delivery.payload);
      await finishGitHubDelivery(delivery.id);
      recovered += 1;
    } catch (error) {
      await failGitHubDelivery(delivery.id, error);
    }
  }
  return { claimed: deliveries.length, recovered };
}

export async function recoverGitHubAppDeliveries() {
  const config = getGitHubAppConfig();
  if (!config) return { inspected: 0, requested: 0 };
  const deliveries = await listGitHubAppDeliveries(config);
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const failed = deliveries.filter(
    (delivery) =>
      delivery.status.toLowerCase() !== 'ok' &&
      Date.parse(delivery.delivered_at) >= cutoff,
  );
  let requested = 0;
  for (const delivery of failed.slice(0, 20)) {
    if (!(await reserveGitHubRedelivery(delivery.id, delivery.guid))) continue;
    try {
      await redeliverGitHubAppDelivery(config, delivery.id);
      requested += 1;
    } catch (error) {
      await releaseGitHubRedelivery(delivery.id);
      throw error;
    }
  }
  return { inspected: deliveries.length, requested };
}

export async function runGitHubRecovery() {
  const local = await retryLocalGitHubDeliveries();
  let remote = { inspected: 0, requested: 0 };
  let remoteError: string | null = null;
  try {
    remote = await recoverGitHubAppDeliveries();
  } catch (error) {
    remoteError =
      error instanceof Error
        ? error.message.slice(0, 200)
        : 'GitHub recovery failed';
  }
  return { local, remote, remoteError };
}

export async function diagnoseGitHubProject(projectId: string) {
  const [stored, reliability] = await Promise.all([
    projectGitHubInstallation(projectId),
    githubReliabilitySummary(projectId),
  ]);
  const config = getGitHubAppConfig();
  if (!config)
    return {
      health: 'misconfigured',
      message: 'GitHub App 环境变量不完整',
      ...reliability,
    };
  if (!stored)
    return {
      health: 'disconnected',
      message: '项目尚未安装 GitHub App',
      ...reliability,
    };
  try {
    const installation = await getGitHubInstallation(
      config,
      stored.installation_id,
    );
    if (installation.suspended_at)
      return {
        health: 'suspended',
        message: 'GitHub App 安装已暂停',
        ...reliability,
      };
    return {
      health: reliability.backlog > 0 ? 'degraded' : 'healthy',
      message:
        reliability.backlog > 0 ? '有事件等待重试' : '安装与事件处理正常',
      ...reliability,
    };
  } catch {
    return {
      health: 'unreachable',
      message: '无法读取 GitHub App 安装，可能已卸载或权限变化',
      ...reliability,
    };
  }
}

export async function backfillGitHubProject(projectId: string) {
  const config = getGitHubAppConfig();
  if (!config) throw new Error('GitHub App unavailable');
  const repositories = await selectedGitHubRepositoriesForProject(projectId);
  const runId = await startGitHubSyncRun(projectId, 'history');
  let count = 0;
  try {
    for (const repository of repositories) {
      const history = await listRepositoryHistory(
        config,
        repository.installation_id,
        repository.full_name,
      );
      for (const item of history.slice(0, 60)) {
        const deliveryId = `backfill:${repository.id}:${item.id}`;
        const exists = await database()
          .prepare('SELECT 1 AS found FROM github_events WHERE id = ? LIMIT 1')
          .bind(`${deliveryId}:${projectId}`)
          .first<{ found: number }>();
        if (exists) continue;
        const raw = JSON.stringify({
          action: item.action,
          installation: { id: Number(repository.installation_id) },
          repository: {
            id: Number(repository.id),
            full_name: repository.full_name,
          },
          sender: { login: item.actorLogin, avatar_url: item.actorAvatarUrl },
          ref: `refs/heads/${item.branch || repository.default_branch}`,
          commits: item.kind === 'push' ? [{ message: item.body }] : undefined,
          head_commit:
            item.kind === 'push'
              ? { message: item.body, url: item.url }
              : undefined,
          issue:
            item.kind === 'issues'
              ? {
                  number: item.number,
                  title: item.title,
                  body: item.body,
                  html_url: item.url,
                  state: item.state,
                }
              : undefined,
          pull_request:
            item.kind === 'pull_request'
              ? {
                  number: item.number,
                  title: item.title,
                  body: item.body,
                  html_url: item.url,
                  state: item.state,
                  merged: item.merged,
                  head: {
                    ref: item.branch,
                    repo: { id: Number(repository.id) },
                  },
                }
              : undefined,
        });
        await processGitHubWebhook(item.kind, deliveryId, raw, projectId);
        count += 1;
      }
    }
    await finishGitHubSyncRun(runId, count);
    return { count };
  } catch (error) {
    await finishGitHubSyncRun(runId, count, error);
    throw error;
  }
}
