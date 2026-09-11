#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_URL = 'https://kanby.0xaa.workers.dev';
const VERSION = '0.2.0';
const configPath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'kanby',
  'config.json',
);
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function has(name) {
  return args.includes(`--${name}`);
}

function positional() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      if (args[index + 1] && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
}

async function credentials() {
  const config = await readConfig();
  return {
    url: String(process.env.KANBY_URL || config.url || DEFAULT_URL).replace(
      /\/$/,
      '',
    ),
    token: process.env.KANBY_TOKEN || config.token || '',
  };
}

async function api(path, init = {}, credentialOverride) {
  const { url, token } = credentialOverride ?? (await credentials());
  if (!token) {
    const error = new Error(
      'Not authenticated. Set KANBY_TOKEN or run: kanby auth login --token <TOKEN>',
    );
    error.status = 401;
    throw error;
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${url}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `Kanby API returned ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload?.data;
}

function out(data, formatter) {
  if (has('json')) console.log(JSON.stringify(data, null, 2));
  else console.log(formatter(data));
}

function date(value) {
  return value ? new Date(value).toLocaleString() : 'never';
}

function taskLine(task) {
  const ownerLogins = (task.owners?.length ? task.owners : [task.owner])
    .filter((owner) => owner?.login)
    .map((owner) => `@${owner.login}`);
  const owner = ownerLogins.length ? ownerLogins.join(', ') : 'unassigned';
  return `${task.ref}\t${task.status.padEnd(8)}\t${owner.padEnd(18)}\t${task.title}`;
}

function checklistLines(criteria = []) {
  return criteria.length
    ? criteria
        .map(
          (criterion, index) =>
            `${index + 1}. [${criterion.completed ? 'x' : ' '}] ${criterion.body}\t${criterion.id.slice(0, 8)}`,
        )
        .join('\n')
    : 'No acceptance criteria';
}

function resolveCriterion(criteria, reference) {
  if (/^[1-9]\d*$/.test(reference)) {
    const criterion = criteria[Number(reference) - 1];
    if (!criterion)
      throw new Error(`Checklist item ${reference} is out of range`);
    return criterion;
  }
  const matches = criteria.filter(
    (criterion) =>
      criterion.id === reference || criterion.id.startsWith(reference),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Checklist item prefix ${reference} is ambiguous`
        : `Checklist item ${reference} was not found`,
    );
  return matches[0];
}

function usage() {
  return `Kanby CLI

Usage:
  kanby auth login --token <TOKEN> [--url <URL>]
  kanby auth status [--json]
  kanby project list [--json]
  kanby task list [--status ideas|building|shipped] [--json]
  kanby task get <ref> [--json]
  kanby task checklist <ref> [--json]
  kanby task checklist add <ref> <criterion>
  kanby task checklist edit <ref> <item-number-or-id> <criterion>
  kanby task checklist check|uncheck|remove <ref> <item-number-or-id>
  kanby task create <title> [--status <status>] [--note <text>]
  kanby task update <ref> [--title <title>] [--note <text>] [--status <status>] [--due <date>] [--tag <tag>]
  kanby task split <ref> <title> [<title> ...]
  kanby task claim <ref> [--lease 15]
  kanby task heartbeat <ref> [--lease 15]
  kanby task progress <ref> <message>
  kanby task link <ref> <github-issue-or-pr-url>
  kanby task complete <ref> [--message <summary>]
  kanby task release <ref>

Environment: KANBY_TOKEN, KANBY_URL`;
}

async function mutate(id, action, extra = {}, operation = action) {
  return api('/api/v1/tasks', {
    method: 'PATCH',
    headers: {
      'Idempotency-Key': String(
        option('idempotency-key', `${operation}-${randomUUID()}`),
      ),
    },
    body: JSON.stringify({ id, action, ...extra }),
  });
}

async function main() {
  const [group, command, first, ...rest] = positional();
  if (has('version')) {
    console.log(VERSION);
    return;
  }
  if (!group || has('help') || group === 'help') {
    console.log(usage());
    return;
  }

  if (group === 'auth' && command === 'login') {
    const token = String(option('token', process.env.KANBY_TOKEN || ''));
    const url = String(
      option('url', process.env.KANBY_URL || DEFAULT_URL),
    ).replace(/\/$/, '');
    if (!token.startsWith('kby_'))
      throw new Error('Pass a Kanby Agent Token with --token or KANBY_TOKEN');
    const project = (await api('/api/v1/projects', {}, { token, url }))[0];
    if (!project) throw new Error('The Agent Token does not have a project');
    const current = await readConfig();
    await saveConfig({ ...current, token, url });
    console.log(`Authenticated for ${project.name} (${project.slug})`);
    return;
  }
  if (group === 'auth' && command === 'status') {
    const project = (await api('/api/v1/projects'))[0];
    const { url } = await credentials();
    out(
      { authenticated: true, url, project },
      (value) =>
        `Authenticated\nProject: ${value.project.name}\nURL: ${value.url}`,
    );
    return;
  }
  if (group === 'project' && command === 'list') {
    const projects = await api('/api/v1/projects');
    out(projects, (items) =>
      items
        .map((project) => `${project.id}\t${project.slug}\t${project.name}`)
        .join('\n'),
    );
    return;
  }
  if (group !== 'task')
    throw new Error(`Unknown command: ${group} ${command || ''}`.trim());

  if (command === 'list') {
    const status = option('status', '');
    const tasks = await api(
      `/api/v1/tasks${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    );
    out(tasks, (items) =>
      items.length ? items.map(taskLine).join('\n') : 'No tasks',
    );
    return;
  }
  if (command === 'get') {
    if (!first) throw new Error('Task ref is required');
    const task = await api(`/api/v1/tasks?id=${encodeURIComponent(first)}`);
    out(task, (item) =>
      [
        taskLine(item),
        '',
        item.note || '(no notes)',
        item.acceptanceCriteria?.length
          ? `\nAcceptance criteria:\n${item.acceptanceCriteria
              .map(
                (criterion) =>
                  `- [${criterion.completed ? 'x' : ' '}] ${criterion.body}`,
              )
              .join('\n')}`
          : '',
        item.claim
          ? `\nClaimed by ${item.claim.agentName} until ${date(item.claim.leaseExpiresAt)}`
          : '',
        item.githubLink ? `\nGitHub: ${item.githubLink.url}` : '',
        item.updates?.length
          ? `\nActivity:\n${item.updates.map((update) => `- ${update.agentName}: ${update.message}`).join('\n')}`
          : '',
      ].join('\n'),
    );
    return;
  }
  if (command === 'create') {
    if (!first) throw new Error('Task title is required');
    const data = await api('/api/v1/tasks', {
      method: 'POST',
      headers: {
        'Idempotency-Key': String(
          option('idempotency-key', `create-${randomUUID()}`),
        ),
      },
      body: JSON.stringify({
        title: [first, ...rest].join(' '),
        status: option('status', 'ideas'),
        note: option('note', ''),
      }),
    });
    out(data, (item) => `Created ${taskLine(item)}`);
    return;
  }
  if (command === 'checklist') {
    const operations = new Set(['add', 'edit', 'check', 'uncheck', 'remove']);
    if (!first) throw new Error('Task ref is required');
    if (!operations.has(first)) {
      const task = await api(`/api/v1/tasks?id=${encodeURIComponent(first)}`);
      out(task.acceptanceCriteria ?? [], checklistLines);
      return;
    }
    const reference = rest[0];
    if (!reference) throw new Error('Task ref is required');
    if (first === 'add') {
      const body = rest.slice(1).join(' ').trim();
      if (!body) throw new Error('Acceptance criterion is required');
      const data = await mutate(reference, 'checklist.add', { body });
      out(data.acceptanceCriteria ?? [], checklistLines);
      return;
    }
    const itemReference = rest[1];
    if (!itemReference)
      throw new Error('Checklist item number or id is required');
    const task = await api(`/api/v1/tasks?id=${encodeURIComponent(reference)}`);
    const criterion = resolveCriterion(
      task.acceptanceCriteria ?? [],
      itemReference,
    );
    const extra = { criterionId: criterion.id };
    if (first === 'edit') {
      const body = rest.slice(2).join(' ').trim();
      if (!body) throw new Error('Acceptance criterion is required');
      extra.body = body;
    }
    const data = await mutate(reference, `checklist.${first}`, extra);
    out(data.acceptanceCriteria ?? [], checklistLines);
    return;
  }
  if (!first) throw new Error('Task ref is required');

  if (command === 'update') {
    const fields = {};
    for (const name of ['title', 'note', 'status', 'due', 'tag', 'ownerId']) {
      const value = option(name, undefined);
      if (value !== undefined) fields[name] = value;
    }
    if (!Object.keys(fields).length)
      throw new Error('Pass at least one field to update');
    const data = await mutate(first, 'update', fields);
    out(data, (item) => `Updated ${taskLine(item)}`);
    return;
  }
  if (command === 'claim' || command === 'heartbeat') {
    const data = await mutate(first, command, {
      leaseMinutes: Number(option('lease', 15)),
    });
    out(
      data,
      (item) =>
        `${command === 'claim' ? 'Claimed' : 'Renewed'} ${item.task.ref} until ${date(item.claim.leaseExpiresAt)}`,
    );
    return;
  }
  if (command === 'progress') {
    const message = rest.length
      ? rest.join(' ')
      : String(option('message', ''));
    if (!message) throw new Error('Progress message is required');
    const data = await mutate(first, 'progress', { message });
    out(data, (item) => `Progress recorded at ${date(item.createdAt)}`);
    return;
  }
  if (command === 'split') {
    const titles = rest.map((title) => title.trim()).filter(Boolean);
    if (!titles.length)
      throw new Error(
        'At least one subtask title is required; quote titles containing spaces',
      );
    const data = await mutate(first, 'split', { titles });
    out(
      data,
      (result) =>
        `Created ${result.tasks.length} subtasks\n${result.tasks.map(taskLine).join('\n')}`,
    );
    return;
  }
  if (command === 'link') {
    const url = rest[0] || option('url', '');
    if (!url) throw new Error('GitHub issue or pull request URL is required');
    const data = await mutate(first, 'link', { url });
    out(
      data,
      (item) => `Linked ${item.repository}#${item.number}: ${item.url}`,
    );
    return;
  }
  if (command === 'complete') {
    const data = await mutate(first, 'complete', {
      message: option('message', ''),
    });
    out(data, (item) => `Completed ${taskLine(item)}`);
    return;
  }
  if (command === 'release') {
    const data = await mutate(first, 'release');
    out(data, (item) => `Released ${taskLine(item)}`);
    return;
  }
  throw new Error(`Unknown task command: ${command || ''}`);
}

main().catch((error) => {
  if (has('json'))
    console.error(
      JSON.stringify({
        ok: false,
        error: { message: error.message, status: error.status || 1 },
      }),
    );
  else console.error(`kanby: ${error.message}`);
  process.exitCode = error.status === 401 ? 2 : error.status === 409 ? 3 : 1;
});
