#!/usr/bin/env node

import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionCommand } from './session.js';

const DEFAULT_URL = 'https://kanby.dev';
const TASK_TAGS = ['产品', '设计', '代码', '增长'];
const TURN_REASONS = [
  'developing',
  'awaiting_acceptance',
  'awaiting_decision',
  'blocked',
  'awaiting_review',
];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
};
const VERSION = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const configPath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'kanby',
  'config.json',
);
const args = process.argv.slice(2);

function normalizeServerUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('Kanby URL must be an absolute HTTPS origin');
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Kanby URL must be an HTTPS origin (HTTP is allowed only on loopback)',
    );
  return url.origin;
}

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value !== undefined && !value.startsWith('--') ? value : true;
}

function has(name) {
  return args.includes(`--${name}`);
}

function positional() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) {
      if (args[index + 1] !== undefined && !args[index + 1].startsWith('--'))
        index += 1;
      continue;
    }
    values.push(args[index]);
  }
  return values;
}

async function readConfig() {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return { servers: {} };
  }
  if (!config || typeof config !== 'object') return { servers: {} };
  // Tokens are stored per server origin. Older configs kept one token next to
  // one URL; read them as a token for that URL only.
  const servers =
    config.servers && typeof config.servers === 'object' ? config.servers : {};
  if (typeof config.token === 'string' && config.token) {
    try {
      const legacyUrl = normalizeServerUrl(config.url || DEFAULT_URL);
      servers[legacyUrl] ??= { token: config.token };
    } catch {
      // An invalid legacy URL never receives the legacy token.
    }
  }
  return { url: config.url, servers };
}

async function saveConfig(config) {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(
    configPath,
    `${JSON.stringify({ version: 2, url: config.url, servers: config.servers }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(configPath, 0o600);
}

async function credentials() {
  const config = await readConfig();
  const url = normalizeServerUrl(
    process.env.KANBY_URL || config.url || DEFAULT_URL,
  );
  return {
    url,
    // A saved token is only ever sent to the origin it was saved for, so a
    // KANBY_URL override cannot leak another server's token.
    token: process.env.KANBY_TOKEN || config.servers[url]?.token || '',
  };
}

async function readStdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    value += chunk;
    if (value.length > 4096) break;
  }
  return value.trim();
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    process.stderr.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Cancelled'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b')
          value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on('data', onData);
  });
}

/** --token (discouraged), KANBY_TOKEN, piped stdin, or a hidden prompt. */
async function loginToken() {
  const flag = option('token', undefined);
  if (flag !== undefined) {
    console.error(
      'Warning: --token exposes the token in shell history and process lists. Prefer piping it on stdin or entering it at the prompt.',
    );
    return String(flag);
  }
  if (process.env.KANBY_TOKEN) return process.env.KANBY_TOKEN;
  if (!process.stdin.isTTY) return readStdin();
  return promptHidden('Kanby Agent Token: ');
}

function apiError(status, payload) {
  const message =
    payload?.error?.message || payload?.error || `Kanby API returned ${status}`;
  const error = new Error(message);
  error.status = status;
  return error;
}

async function request(path, init = {}, credentialOverride) {
  const { url, token } = credentialOverride ?? (await credentials());
  if (!token) {
    const error = new Error(
      'Not authenticated. Set KANBY_TOKEN or run: kanby auth login',
    );
    error.status = 401;
    throw error;
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string')
    headers.set('Content-Type', 'application/json');
  return fetch(`${url}${path}`, {
    ...init,
    headers,
    redirect: 'error',
  });
}

async function api(path, init = {}, credentialOverride) {
  const response = await request(path, init, credentialOverride);
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false)
    throw apiError(response.status, payload);
  return payload?.data;
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentLine(attachment) {
  return `${attachment.id}\t${size(attachment.size).padStart(9)}\t${attachment.contentType}\t${attachment.name}`;
}

function dispositionFileName(header) {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the ASCII filename.
    }
  }
  return /filename="([^"]*)"/i.exec(header ?? '')?.[1] ?? '';
}

function safeLocalName(name) {
  const cleaned = basename(String(name).replace(/\\/g, '/'))
    .replace(/\p{Cc}/gu, '_')
    .trim();
  return cleaned && cleaned !== '.' && cleaned !== '..'
    ? cleaned
    : 'attachment';
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

function waited(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function turnLine(turn) {
  if (!turn) return 'Turn: nobody';
  return `Turn: ${turn.label} · ${turn.reasonLabel} (${turn.reason}) since ${date(turn.since)}${turn.note ? `\n  ${turn.note}` : ''}`;
}

function eventLine(event) {
  const who =
    event.source === 'agent' && event.actor?.login
      ? `${event.actor.login}/${event.actor.name}`
      : event.actor?.name || event.source;
  const body = event.body ? `\n    ${event.body.replace(/\n/g, '\n    ')}` : '';
  return `- ${new Date(event.createdAt).toISOString()} ${who}: ${event.summary}${body}`;
}

function nextLines(data) {
  const lines = [`${data.agent.label}`];
  lines.push(
    data.turns.length ? '\nYour turn:' : '\nYour turn: nothing waiting',
  );
  for (const item of data.turns)
    lines.push(
      `${item.ref}\t${item.turn?.reasonLabel ?? ''}\t${item.turn?.label ?? ''}\twaiting ${waited(item.waitingMs)}\t${item.unreadCount ? `${item.unreadCount} new` : ''}\t${item.title}${item.turn?.note ? `\n  ${item.turn.note}` : ''}`,
    );
  lines.push(data.mentions.length ? '\nMentions:' : '\nMentions: none open');
  for (const item of data.mentions)
    lines.push(
      `${item.ref}\t@ by ${item.mention.by}\twaiting ${waited(item.waitingMs)}\t${item.title}${item.mention.body ? `\n  ${item.mention.body}` : ''}`,
    );
  if (data.turns.length || data.mentions.length)
    lines.push(
      '\nRead each card with: kanby task get <ref> (repeat while it says more unread remain)',
    );
  return lines.join('\n');
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
  kanby auth login [--url <URL>]   (token from stdin, the prompt or KANBY_TOKEN)
  kanby auth status [--json]
  kanby project list [--json]
  kanby report --from YYYY-MM-DD --to YYYY-MM-DD [--timezone Asia/Shanghai] [--json]
  kanby activity [--task <ref>] [--cursor <cursor>] [--limit 1..50] [--json]
  kanby session start --client <name> [--id <uuid>] [--task <ref>] [--context <label>] [--json]
  kanby session get|events <session-id> [--json]
  kanby session list [--task <ref>] [--member <id>] [--cursor <cursor>] [--json]
  kanby session prompt|note|heartbeat|pause|resume <session-id> [--event-id <uuid>] [--json]
  kanby session wait <session-id> --reason input|review|approval|acceptance [--json]
  kanby session reply <session-id> --request <wait-id> --decision continue|accept|changes|defer [--json]
  kanby session end <session-id> --outcome completed|handed-off|cancelled|failed [--json]
  kanby session report --from YYYY-MM-DD --to YYYY-MM-DD [--timezone Asia/Shanghai] [--json]
  kanby session run --client <name> [--task <ref>] -- <command> [args...]
  kanby next [--json]
  kanby task list [--status ideas|building|shipped] [--json]
  kanby task get <ref> [--no-mark-read] [--unread-limit 1..50] [--after <cursor>]
                 [--thread-cursor <cursor>] [--thread-limit 1..50] [--json]
  kanby task comment <ref> <text>            (@login or @login/agent mentions notify)
  kanby task mention <ref> @login[/agent] [<text>]
  kanby task handoff <ref> --to @login|@login/agent|@login/<agent>|owner|self|none
                     [--reason developing|awaiting_acceptance|awaiting_decision|blocked|awaiting_review]
                     [--note <what to check>] [--keep-claim]
  kanby task checklist <ref> [--json]
  kanby task checklist add <ref> <criterion>
  kanby task checklist edit <ref> <item-number-or-id> <criterion>
  kanby task checklist check|uncheck|remove <ref> <item-number-or-id>
  kanby task create <title> [--status <status>] [--note <text>] [--due YYYY-MM-DD]
  kanby task update <ref> [--title <title>] [--note <text>] [--status <status>] [--due <date>] [--tag 产品|设计|代码|增长]
  kanby task split <ref> <title> [<title> ...]
  kanby task claim <ref> [--lease 15]
  kanby task heartbeat <ref> [--lease 15]
  kanby task progress <ref> <message>
  kanby task link <ref> <github-issue-or-pr-url>
  kanby task attach <ref> <file> [--name <name>] [--type <mime>]  (10 MB/file, 10 per task)
  kanby task attachments <ref> [--json]
  kanby task download <attachment-id> [--output <path>] [--force]
  kanby task complete <ref> [--message <summary>]
  kanby task archive <ref>
  kanby task release <ref>

Environment: KANBY_TOKEN, KANBY_URL (default: https://kanby.dev)`;
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
  const separator = args.indexOf('--');
  const ownArgs = separator < 0 ? args : args.slice(0, separator);
  if (group === 'session' && !ownArgs.includes('--help')) {
    await sessionCommand(args.slice(1), api);
    return;
  }
  if (has('version')) {
    console.log(VERSION);
    return;
  }
  if (!group || has('help') || group === 'help') {
    console.log(usage());
    return;
  }

  if (group === 'report') {
    const from = option('from', ''),
      to = option('to', ''),
      timezone = option('timezone', 'UTC');
    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      typeof timezone !== 'string'
    )
      throw new Error(
        'report requires --from YYYY-MM-DD --to YYYY-MM-DD and an optional --timezone',
      );
    const data = await api(
      `/api/v1/metrics?${new URLSearchParams({ from, to, timezone })}`,
    );
    out(data, (r) =>
      [
        `${r.period.from} – ${r.period.to} (${r.period.timeZone})`,
        `History: ${r.coverage.complete ? 'complete' : 'incomplete'}${r.period.provisional ? ' · provisional' : ''}`,
        `Observed top-level throughput: ${r.team.throughput}`,
        `Planned completion: ${r.team.plannedCompleted}/${r.team.planned} (${r.team.completionRate === null ? 'unavailable' : (100 * r.team.completionRate).toFixed(1) + '%'})`,
        `Member equivalents: ${r.team.memberEquivalents.toFixed(2)}`,
        `Tasks per member equivalent: ${r.team.perMemberThroughput === null ? 'unavailable' : r.team.perMemberThroughput.toFixed(2)}`,
        'Task counts are not a productivity ranking or proof of deployment.',
        ...r.people.map(
          (p) =>
            `${p.name}\tcredit ${p.completionCredit.toFixed(2)}\tmember equivalent ${p.memberEquivalent.toFixed(2)}`,
        ),
      ].join('\n'),
    );
    return;
  }
  if (group === 'activity') {
    const params = new URLSearchParams();
    for (const key of ['task', 'cursor', 'limit']) {
      const value = option(key, undefined);
      if (value === true) throw new Error(`--${key} requires a value`);
      if (value !== undefined) params.set(key, value);
    }
    const data = await api(`/api/v1/activity?${params}`);
    out(data, (page) =>
      [
        ...page.events.map(
          (e) =>
            `${new Date(e.createdAt).toISOString()}\t${e.taskId}\t${e.source}\t${e.summary}${e.body ? '\n' + e.body : ''}`,
        ),
        page.nextCursor ? `Next cursor: ${page.nextCursor}` : 'End of history',
      ].join('\n'),
    );
    return;
  }
  if (group === 'next') {
    const data = await api('/api/v1/next');
    out(data, nextLines);
    return;
  }
  if (group === 'auth' && command === 'login') {
    const url = normalizeServerUrl(
      option('url', process.env.KANBY_URL || DEFAULT_URL),
    );
    const token = await loginToken();
    if (!token.startsWith('kby_'))
      throw new Error(
        'Pass a Kanby Agent Token on stdin, at the prompt, or with KANBY_TOKEN',
      );
    const project = (await api('/api/v1/projects', {}, { token, url }))[0];
    if (!project) throw new Error('The Agent Token does not have a project');
    const current = await readConfig();
    await saveConfig({
      url,
      servers: { ...current.servers, [url]: { token } },
    });
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
    const params = new URLSearchParams({ id: first });
    if (has('no-mark-read')) params.set('markRead', '0');
    for (const [flag, key] of [
      ['unread-limit', 'unreadLimit'],
      ['after', 'after'],
      ['thread-cursor', 'threadCursor'],
      ['thread-limit', 'threadLimit'],
    ]) {
      const value = option(flag, undefined);
      if (value === true) throw new Error(`--${flag} requires a value`);
      if (value !== undefined) params.set(key, value);
    }
    const task = await api(`/api/v1/tasks?${params}`);
    out(task, (item) =>
      [
        taskLine(item),
        turnLine(item.turn),
        item.unread?.length
          ? `\nNew since your last read (${item.unread.length}${item.unreadHasMore ? ', more remain' : ''}):\n${item.unread.map(eventLine).join('\n')}`
          : '\nNo new conversation since your last read',
        item.unreadHasMore
          ? has('no-mark-read')
            ? `More unread: kanby task get ${first} --no-mark-read --after ${item.unreadNextCursor}`
            : `More unread: run kanby task get ${first} again (only shown entries were marked read)`
          : '',
        item.threadNextCursor
          ? `Older thread: kanby task get ${first} --no-mark-read --thread-cursor ${item.threadNextCursor}`
          : '',
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
  if (
    ['create', 'update'].includes(command) &&
    option('due', undefined) === true
  )
    throw new Error(
      '--due requires a date (YYYY-MM-DD); use --due "" to leave it unset or clear it',
    );

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
        due: option('due', undefined),
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
  if (command === 'download') {
    if (!first) throw new Error('Attachment id is required');
    const response = await request(
      `/api/v1/attachments?id=${encodeURIComponent(first)}`,
    );
    if (!response.ok)
      throw apiError(response.status, await response.json().catch(() => null));
    const output = option('output', undefined);
    if (output === true) throw new Error('--output requires a path');
    const target =
      output ??
      safeLocalName(
        dispositionFileName(response.headers.get('content-disposition')),
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    try {
      await writeFile(target, bytes, { flag: has('force') ? 'w' : 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST')
        throw new Error(`${target} already exists; pass --force to overwrite`);
      throw error;
    }
    out(
      { path: target, size: bytes.byteLength },
      (item) => `Saved ${item.path} (${size(item.size)})`,
    );
    return;
  }
  if (!first) throw new Error('Task ref is required');

  if (command === 'attachments') {
    const attachments = await api(
      `/api/v1/attachments?task=${encodeURIComponent(first)}`,
    );
    out(attachments, (items) =>
      items.length ? items.map(attachmentLine).join('\n') : 'No attachments',
    );
    return;
  }
  if (command === 'attach') {
    const path = rest[0];
    if (!path) throw new Error('File path is required');
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`${path} is not a readable file`);
    if (info.size === 0) throw new Error(`${path} is empty`);
    if (info.size > MAX_ATTACHMENT_BYTES)
      throw new Error(`${path} exceeds the 10 MB attachment limit`);
    const name = option('name', basename(path));
    const type = option(
      'type',
      CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    );
    if (name === true || type === true)
      throw new Error('--name and --type require a value');
    const form = new FormData();
    form.set('task', first);
    form.set('file', new File([await readFile(path)], name, { type }));
    const data = await api('/api/v1/attachments', {
      method: 'POST',
      headers: {
        'Idempotency-Key': String(
          option('idempotency-key', `attach-${randomUUID()}`),
        ),
      },
      body: form,
    });
    out(data, (item) => `Attached ${attachmentLine(item)}`);
    return;
  }
  if (command === 'update') {
    const fields = {};
    for (const name of ['title', 'note', 'status', 'due', 'tag', 'ownerId']) {
      const value = option(name, undefined);
      if (value !== undefined) fields[name] = value;
    }
    if (!Object.keys(fields).length)
      throw new Error('Pass at least one field to update');
    if (fields.tag !== undefined && !TASK_TAGS.includes(fields.tag))
      throw new Error(`Tag must be one of: ${TASK_TAGS.join(', ')}`);
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
  if (command === 'comment' || command === 'mention') {
    const text = rest.join(' ').trim();
    if (command === 'mention' && !/^@?[A-Za-z0-9]/.test(rest[0] ?? ''))
      throw new Error('mention requires @login or @login/agent');
    const body =
      command === 'mention'
        ? `${rest[0].startsWith('@') ? '' : '@'}${text}`
        : text || String(option('message', ''));
    if (!body) throw new Error('Comment text is required');
    const data = await mutate(first, 'comment', { body });
    out(
      data,
      (item) =>
        `Commented on ${first}${item.mentions.length ? ` and notified ${item.mentions.map((mention) => `@${mention.login}${mention.kind === 'agent' ? '/agent' : ''}`).join(', ')}` : ''}`,
    );
    return;
  }
  if (command === 'handoff') {
    const to = option('to', undefined);
    if (typeof to !== 'string')
      throw new Error(
        'handoff requires --to @login, @login/agent, @login/<agent>, owner, self, or none',
      );
    const reason = option('reason', to === 'none' ? undefined : 'developing');
    if (reason !== undefined && !TURN_REASONS.includes(reason))
      throw new Error(`Reason must be one of: ${TURN_REASONS.join(', ')}`);
    const note = option('note', undefined);
    if (note === true) throw new Error('--note requires text');
    const data = await mutate(first, 'handoff', {
      to,
      reason,
      note,
      release: !has('keep-claim'),
    });
    out(
      data,
      (item) =>
        `${item.turn ? `${item.rejected ? 'Rejected acceptance; handed' : 'Handed'} ${item.task.ref} to ${item.turn.label} · ${item.turn.reasonLabel}` : `Cleared the turn on ${item.task.ref}`}${item.released ? ' (claim released)' : ''}`,
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
  if (command === 'archive') {
    const data = await mutate(first, 'archive');
    out(data, (item) => `Archived ${taskLine(item)}`);
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
