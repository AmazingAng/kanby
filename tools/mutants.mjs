import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const mutations = [
  {
    name: 'OAuth return target same-origin boundary',
    file: 'lib/auth.ts',
    from: 'if (target.origin !== base.origin) return',
    to: 'if (target.origin === base.origin) return',
    test: 'tests/auth-security.test.ts',
  },
  {
    name: 'session signing secret minimum length',
    file: 'lib/auth.ts',
    from: 'encoder.encode(sessionSecret).byteLength < 32',
    to: 'encoder.encode(sessionSecret).byteLength < 31',
    test: 'tests/auth-security.test.ts',
  },
  {
    name: 'signed session exact segment count',
    file: 'lib/auth.ts',
    from: 'if (segments.length !== 2) return null;',
    to: 'if (segments.length < 2) return null;',
    test: 'tests/auth-security.test.ts',
  },
  {
    name: 'sensitive authorization freshness boundary',
    file: 'lib/auth.ts',
    from: 'ageSeconds <= SENSITIVE_AUTH_MAX_AGE_SECONDS',
    to: 'ageSeconds > SENSITIVE_AUTH_MAX_AGE_SECONDS',
    test: 'tests/auth-security.test.ts',
  },
  {
    name: 'JSON media type exactness',
    file: 'lib/request-limits.ts',
    from: '/^application\\/json(?:\\s*;|\\s*$)/i.test(value)',
    to: '/^application\\/json/i.test(value)',
    test: 'tests/request-limits.test.ts',
  },
  {
    name: 'GitHub API redirect rejection',
    file: 'lib/github.ts',
    from: "redirect: 'manual',",
    to: "redirect: 'follow',",
    test: 'tests/github-security.test.ts',
  },
  {
    name: 'OAuth token exchange redirect rejection',
    file: 'app/api/auth/github/callback/route.ts',
    from: "redirect: 'manual',\n    },\n  );\n  const tokenPayload",
    to: "redirect: 'follow',\n    },\n  );\n  const tokenPayload",
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'OAuth redirect non-JSON response handling',
    file: 'app/api/auth/github/callback/route.ts',
    from: 'tokenResponse.json().catch(() => ({}))',
    to: 'tokenResponse.json()',
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'OAuth profile redirect non-JSON response handling',
    file: 'app/api/auth/github/callback/route.ts',
    from: 'profileResponse\n    .json()\n    .catch(() => ({}))',
    to: 'profileResponse.json()',
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'existing project member OAuth authorization',
    file: 'app/api/auth/github/callback/route.ts',
    from: 'hasActiveProjectMembership(String(profile.id)),',
    to: 'Promise.resolve(false),',
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'OAuth project membership fail-closed boundary',
    file: 'app/api/auth/github/callback/route.ts',
    from: '      existingMember ||\n      invited,',
    to: '      existingMember ||\n      true ||\n      invited,',
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'active project membership versus historical user',
    file: 'lib/db.ts',
    from: ".prepare('SELECT 1 AS found FROM project_members WHERE user_id = ? LIMIT 1')\n    .bind(userId)",
    to: ".prepare('SELECT 1 AS found FROM users WHERE id = ? LIMIT 1')\n    .bind(userId)",
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'pending invitation excludes accepted history',
    file: 'lib/db.ts',
    from: '`SELECT 1 AS found FROM project_invitations WHERE accepted_at IS NULL AND identity IN (${placeholders}) LIMIT 1`',
    to: '`SELECT 1 AS found FROM project_invitations WHERE accepted_at IS NOT NULL AND identity IN (${placeholders}) LIMIT 1`',
    test: 'tests/github-oauth-callback.test.ts',
  },
  {
    name: 'project-scoped GitHub retry selection',
    file: 'lib/github-db.ts',
    from: 'const projectScope = projectId\n    ?',
    to: 'const projectScope = !projectId\n    ?',
    test: 'tests/github-reliability.test.ts',
  },
  {
    name: 'CLI non-loopback HTTPS enforcement',
    file: 'packages/cli/bin/kanby.js',
    from: "url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)",
    to: "url.protocol === 'https:' && !(url.protocol === 'http:' && loopback)",
    test: 'tests/cli.test.ts',
  },
  {
    name: 'CLI authenticated redirect rejection',
    file: 'packages/cli/bin/kanby.js',
    from: "redirect: 'error',",
    to: "redirect: 'follow',",
    test: 'tests/cli.test.ts',
  },
  {
    name: 'GitHub installation account comparison',
    file: 'lib/github-access.ts',
    from: 'accountId === user.id',
    to: 'accountId !== user.id',
    test: 'tests/github-security.test.ts',
  },
  {
    name: 'idempotency request fingerprint comparison',
    file: 'lib/agent.ts',
    from: 'stored.requestHash !== requestHash',
    to: 'stored.requestHash === requestHash',
    test: 'tests/agent-concurrency.test.ts',
  },
  {
    name: 'agent claim ownership comparison',
    file: 'lib/agent.ts',
    from: 'claim.token_id === identity.tokenId',
    to: 'claim.token_id !== identity.tokenId',
    test: 'tests/agent-concurrency.test.ts',
  },
  {
    name: 'editor-close saved fingerprint comparison',
    file: 'lib/task-sync.ts',
    from: 'input.currentFingerprint === input.savedFingerprint',
    to: 'input.currentFingerprint !== input.savedFingerprint',
    test: 'tests/task-sync.test.ts',
  },
  {
    name: 'request exact-limit boundary',
    file: 'lib/request-limits.ts',
    from: 'declared > maximumBytes',
    to: 'declared >= maximumBytes',
    test: 'tests/request-limits.test.ts',
  },
  {
    name: 'optimistic task revision comparison',
    file: 'lib/db.ts',
    from: 'WHERE id = ? AND project_id = ? AND updated_at = ? AND archived_at IS NULL',
    to: 'WHERE id = ? AND project_id = ? AND updated_at != ? AND archived_at IS NULL',
    test: 'tests/task-revision.test.ts',
  },
  {
    name: 'active versus archived task selection',
    file: 'lib/db.ts',
    from: "archived ? 'NOT NULL' : 'NULL'",
    to: "archived ? 'NULL' : 'NOT NULL'",
    test: 'tests/task-lifecycle.test.ts',
  },
  {
    name: 'activity cursor equal-timestamp direction',
    file: 'lib/task-activity.ts',
    from: 'created_at = ? AND id < ?',
    to: 'created_at = ? AND id > ?',
    test: 'tests/task-activity.test.ts',
  },
  {
    name: 'active Agent lease comparison',
    file: 'lib/task-activity.ts',
    from: 'c.lease_expires_at > ?',
    to: 'c.lease_expires_at < ?',
    test: 'tests/task-activity.test.ts',
  },
  {
    name: 'GitHub CI event status specificity',
    file: 'lib/github-db.ts',
    from: 'kind: `github.ci.${status}`',
    to: "kind: 'github.ci'",
    test: 'tests/github-security.test.ts',
  },
  {
    name: 'GitHub PR marker exact trailer',
    file: 'lib/github-automation.ts',
    from: 'Kanby-Task:',
    to: 'Kanby_Task:',
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'existing Issue link import reuse',
    file: 'lib/github-automation.ts',
    from: 'if (linked) {',
    to: 'if (false && linked) {',
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'project PR auto-link rule enforcement',
    file: 'lib/github-automation.ts',
    from: 'COALESCE(gas.auto_link_pull_requests, 1) = 1',
    to: 'COALESCE(gas.auto_link_pull_requests, 1) = 0',
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'completed task backward-move protection',
    file: 'lib/github-db.ts',
    from: "link.status === 'shipped'",
    to: "link.status !== 'shipped'",
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'CI warning project rule enforcement',
    file: 'lib/github-db.ts',
    from: 'if (!automation.get(link.project_id)?.showCiFailures) return [];',
    to: 'if (automation.get(link.project_id)?.showCiFailures) return [];',
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'closed Issue completion trigger',
    file: 'lib/github-webhook.ts',
    from: "kind === 'issue' && action === 'closed'",
    to: "kind === 'issue' && action === 'opened'",
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'same-repository PR auto-link boundary',
    file: 'lib/github-webhook.ts',
    from: 'headRepositoryId === repositoryId',
    to: 'headRepositoryId !== repositoryId',
    test: 'tests/github-automation.test.ts',
  },
  {
    name: 'subtask progress parent boundary',
    file: 'lib/task-subtasks.ts',
    from: 'task.parent?.id === parentId',
    to: 'task.parent?.id !== parentId',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'one-level subtask hierarchy guard',
    file: 'lib/db.ts',
    from: 'if (parent.parent_task_id) throw new TaskHierarchyError();',
    to: 'if (!parent.parent_task_id) throw new TaskHierarchyError();',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'parent deletion promotes direct children',
    file: 'lib/db.ts',
    from: 'WHERE project_id = ? AND parent_task_id = ? AND ${guard}',
    to: 'WHERE project_id = ? AND parent_task_id != ? AND ${guard}',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'delete response returns authoritative promoted revisions',
    file: 'app/api/tasks/route.ts',
    from: 'promotedTasks.length > 0',
    to: 'promotedTasks.length < 0',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'Agent split claim ownership enforcement',
    file: 'app/api/v1/tasks/route.ts',
    from: "['update', 'progress', 'link', 'complete', 'split', 'archive']",
    to: "['update', 'progress', 'link', 'complete', 'archive']",
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'acceptance criterion create length boundary',
    file: 'app/api/task-checklist/route.ts',
    from: 'body.length > 240\n  )',
    to: 'body.length > 241\n  )',
    test: 'tests/task-checklist.test.ts',
  },
  {
    name: 'acceptance checklist item limit',
    file: 'lib/db.ts',
    from: ') < 20`,',
    to: ') <= 20`,',
    test: 'tests/task-checklist.test.ts',
  },
  {
    name: 'starter task note placeholder comparison',
    file: 'lib/task-subtasks.ts',
    from: "note === STARTER_TASK_NOTE ? '' : note",
    to: "note !== STARTER_TASK_NOTE ? '' : note",
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'same-column child grouping boundary',
    file: 'lib/task-subtasks.ts',
    from: 'if (task.parent && taskIds.has(task.parent.id)) continue;',
    to: 'if (task.parent && !taskIds.has(task.parent.id)) continue;',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'empty acceptance checklist completion state',
    file: 'lib/task-subtasks.ts',
    from: 'complete: total > 0 && done === total',
    to: 'complete: total >= 0 && done === total',
    test: 'tests/task-subtasks.test.ts',
  },
  {
    name: 'multi-assignee maximum boundary',
    file: 'lib/db.ts',
    from: 'requestedOwnerIds.length > 3',
    to: 'requestedOwnerIds.length > 4',
    test: 'tests/task-assignees.test.ts',
  },
  {
    name: 'multi-assignee concurrent write identity',
    file: 'lib/db.ts',
    from: 'const assigneeRevision = crypto.randomUUID();',
    to: "const assigneeRevision = 'shared';",
    test: 'tests/task-assignees.test.ts',
  },
  {
    name: 'secondary assignee member filtering',
    file: 'lib/task-assignees.ts',
    from: 'taskOwners(task).some((owner) => owner.id === memberId)',
    to: 'task.owner.id === memberId',
    test: 'tests/task-assignee-ui.test.ts',
  },
  {
    name: 'member Agent Token active limit boundary',
    file: 'lib/agent.ts',
    from: '       ) < ?`,',
    to: '       ) <= ?`,',
    test: 'tests/agent-token-self-service.test.ts',
  },
  {
    name: 'member Agent Token list ownership',
    file: 'lib/agent.ts',
    from: '         AND (? = 1 OR at.user_id = ?)',
    to: '         AND (? = 1 OR at.user_id != ?)',
    test: 'tests/agent-token-self-service.test.ts',
  },
  {
    name: 'member Agent Token revoke ownership',
    file: 'lib/agent.ts',
    from: '         AND (? = 1 OR user_id = ?)`,',
    to: '         AND (? = 1 OR user_id != ?)`,',
    test: 'tests/agent-token-self-service.test.ts',
  },
  {
    name: 'Agent Token raw control character rejection',
    file: 'lib/agent-token-policy.ts',
    from: 'for (const character of value) {',
    to: 'for (const character of value.trim()) {',
    test: 'tests/agent-token-policy.test.ts',
  },
  {
    name: 'Agent Token visible label separator',
    file: 'lib/agent-token-policy.ts',
    from: 'return `${userLogin}_${tokenName}`;',
    to: 'return `${userLogin}-${tokenName}`;',
    test: 'tests/agent-token-policy.test.ts',
  },
  {
    name: 'Agent checklist one-based item lookup',
    file: 'packages/cli/bin/kanby.js',
    from: 'criteria[Number(reference) - 1]',
    to: 'criteria[Number(reference)]',
    test: 'tests/cli.test.ts',
  },
  {
    name: 'CLI invalid task tag rejection',
    file: 'packages/cli/bin/kanby.js',
    from: 'fields.tag !== undefined && !TASK_TAGS.includes(fields.tag)',
    to: 'fields.tag !== undefined && false',
    test: 'tests/cli.test.ts',
  },
  {
    name: 'Agent archive active-claim enforcement',
    file: 'app/api/v1/tasks/route.ts',
    from: "['update', 'progress', 'link', 'complete', 'split', 'archive'].includes(",
    to: "['update', 'progress', 'link', 'complete', 'split'].includes(",
    test: 'tests/agent-archive.test.ts',
  },
  {
    name: 'Agent archive idempotent replay lookup',
    file: 'app/api/v1/tasks/route.ts',
    from: "action === 'archive',\n  );",
    to: 'false,\n  );',
    test: 'tests/agent-archive.test.ts',
  },
  {
    name: 'Agent archive activity source',
    file: 'lib/db.ts',
    from: "source,\n          kind: archived ? 'task.archived' : 'task.restored',",
    to: "source: 'user',\n          kind: archived ? 'task.archived' : 'task.restored',",
    test: 'tests/agent-archive.test.ts',
  },
  {
    name: 'Agent archive releases its claim',
    file: 'lib/db.ts',
    from: '...(archived\n      ? [\n          db\n            .prepare(\n              `DELETE FROM task_agent_claims WHERE task_id = ? AND project_id = ?',
    to: '...(false\n      ? [\n          db\n            .prepare(\n              `DELETE FROM task_agent_claims WHERE task_id = ? AND project_id = ?',
    test: 'tests/agent-archive.test.ts',
  },
  {
    name: 'Agent checklist claim enforcement',
    file: 'app/api/v1/tasks/route.ts',
    from: 'checklistActions.has(action)) &&',
    to: 'false) &&',
    test: 'tests/agent-checklist.test.ts',
  },
  {
    name: 'Agent acceptance activity source',
    file: 'lib/db.ts',
    from: "kind: 'acceptance.created',\n        ...actor,\n        source: actor.source ?? 'user',",
    to: "kind: 'acceptance.created',\n        ...actor,\n        source: 'user',",
    test: 'tests/agent-checklist.test.ts',
  },
  {
    name: 'public release Git history scan',
    file: 'tools/check-secrets.mjs',
    from: 'for (const finding of findings(history)) {',
    to: 'for (const finding of []) {',
    test: 'tests/public-release.test.ts',
  },
  {
    name: 'public release secret redaction',
    file: 'tools/check-secrets.mjs',
    from: 'detected.push(`Git history (${finding.name})`);',
    to: 'detected.push(history);',
    test: 'tests/public-release.test.ts',
  },
  {
    name: 'public release repository boundary',
    file: 'tools/check-secrets.mjs',
    from: "source = readFileSync(resolve(repo, file), 'utf8');",
    to: "source = readFileSync(resolve(process.cwd(), file), 'utf8');",
    test: 'tests/public-release.test.ts',
  },
];

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

for (const mutation of mutations) {
  const original = readFileSync(mutation.file, 'utf8');
  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${mutation.name}: expected exactly one mutation target, found ${occurrences}`,
    );
  }
  const originalHash = hash(original);
  writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
  let result;
  try {
    result = spawnSync('npx', ['vitest', 'run', mutation.test], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } finally {
    writeFileSync(mutation.file, original);
  }
  if (hash(readFileSync(mutation.file, 'utf8')) !== originalHash) {
    throw new Error(`${mutation.name}: source restoration failed`);
  }
  if (result.status === 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${mutation.name}: mutant survived`);
  }
  process.stdout.write(`KILLED: ${mutation.name}\n`);
}

process.stdout.write(
  `Mutation gate passed: ${mutations.length}/${mutations.length} killed.\n`,
);
