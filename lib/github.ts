import { env } from 'cloudflare:workers';

type GitHubBindings = {
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
};

export const GITHUB_APP_STATE_COOKIE = 'kanby_github_app_state';

export type GitHubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
};

export type GitHubInstallation = {
  id: number;
  account: { id: number; login: string; type: string };
  repository_selection: string;
  html_url?: string;
  suspended_at?: string | null;
  suspended_by?: { login?: string } | null;
};

export type GitHubAppDelivery = {
  id: number;
  guid: string;
  event: string;
  status: string;
  delivered_at: string;
  redelivery: boolean;
};

export type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
};

export type GitHubLinkedItem = {
  kind: 'issue' | 'pull_request';
  number: number;
  title: string;
  state: string;
  url: string;
  branch: string | null;
  merged: boolean;
};

const encoder = new TextEncoder();

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const runtime = env as unknown as GitHubBindings;
  const appId = runtime.GITHUB_APP_ID?.trim();
  const slug = runtime.GITHUB_APP_SLUG?.trim();
  const privateKey = runtime.GITHUB_APP_PRIVATE_KEY?.trim();
  const webhookSecret = runtime.GITHUB_WEBHOOK_SECRET?.trim();
  if (!appId || !slug || !privateKey || !webhookSecret) return null;
  return {
    appId,
    slug,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    webhookSecret,
  };
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodePem(pem: string) {
  const body = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, '');
  const binary = atob(body);
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}

function derLength(length: number) {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, value: Uint8Array) {
  const length = derLength(value.length);
  const output = new Uint8Array(1 + length.length + value.length);
  output[0] = tag;
  output.set(length, 1);
  output.set(value, 1 + length.length);
  return output;
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function toPkcs8(pem: string) {
  const raw = decodePem(pem);
  if (pem.includes('BEGIN PRIVATE KEY')) return raw;
  if (!pem.includes('BEGIN RSA PRIVATE KEY'))
    throw new Error('Unsupported GitHub App private key');
  const rsaAlgorithm = Uint8Array.of(
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
  );
  return der(
    0x30,
    concat(Uint8Array.of(0x02, 0x01, 0x00), rsaAlgorithm, der(0x04, raw)),
  );
}

async function githubAppJwt(config: GitHubAppConfig) {
  const header = base64Url(
    encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    toPkcs8(config.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

export function githubApiRequest(
  path: string,
  token: string,
  init: RequestInit = {},
) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
    throw new Error('Invalid GitHub API path');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('User-Agent', 'kanby-github-app');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  return new Request(new URL(path, 'https://api.github.com'), {
    ...init,
    headers,
    redirect: 'manual',
  });
}

async function githubFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(githubApiRequest(path, token, init));
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getGitHubInstallation(
  config: GitHubAppConfig,
  installationId: string,
) {
  return githubFetch<GitHubInstallation>(
    `/app/installations/${encodeURIComponent(installationId)}`,
    await githubAppJwt(config),
  );
}

export async function createInstallationToken(
  config: GitHubAppConfig,
  installationId: string,
) {
  const result = await githubFetch<{ token: string }>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    await githubAppJwt(config),
    { method: 'POST' },
  );
  return result.token;
}

export async function listInstallationRepositories(
  config: GitHubAppConfig,
  installationId: string,
) {
  const token = await createInstallationToken(config, installationId);
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await githubFetch<{ repositories: GitHubRepository[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    repositories.push(...result.repositories);
    if (result.repositories.length < 100) break;
  }
  return repositories;
}

export async function listGitHubAppDeliveries(config: GitHubAppConfig) {
  const token = await githubAppJwt(config);
  const deliveries: GitHubAppDelivery[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const pageItems = await githubFetch<GitHubAppDelivery[]>(
      `/app/hook/deliveries?per_page=100&page=${page}`,
      token,
    );
    deliveries.push(...pageItems);
    if (pageItems.length < 100) break;
  }
  return deliveries;
}

export async function redeliverGitHubAppDelivery(
  config: GitHubAppConfig,
  deliveryId: number,
) {
  await githubFetch<unknown>(
    `/app/hook/deliveries/${deliveryId}/attempts`,
    await githubAppJwt(config),
    { method: 'POST' },
  );
}

export async function listPullRequestCommitMessages(
  config: GitHubAppConfig,
  installationId: string,
  fullName: string,
  pullNumber: number,
) {
  const token = await createInstallationToken(config, installationId);
  const commits = await githubFetch<Array<{ commit?: { message?: string } }>>(
    `/repos/${fullName}/pulls/${pullNumber}/commits?per_page=100`,
    token,
  );
  return commits.map((item) => item.commit?.message ?? '').filter(Boolean);
}

export type GitHubHistoryItem = {
  id: string;
  kind: 'issues' | 'pull_request' | 'push';
  action: string;
  number: number | null;
  title: string;
  body: string;
  url: string;
  state: string;
  branch: string;
  merged: boolean;
  actorLogin: string;
  actorAvatarUrl: string | null;
  createdAt: number;
};

export async function listRepositoryHistory(
  config: GitHubAppConfig,
  installationId: string,
  fullName: string,
) {
  const token = await createInstallationToken(config, installationId);
  const [issues, pulls, commits] = await Promise.all([
    githubFetch<
      Array<{
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        html_url: string;
        updated_at: string;
        pull_request?: unknown;
        user?: { login?: string; avatar_url?: string };
      }>
    >(
      `/repos/${fullName}/issues?state=all&sort=updated&direction=desc&per_page=50`,
      token,
    ),
    githubFetch<
      Array<{
        id: number;
        number: number;
        title: string;
        body: string | null;
        state: string;
        merged_at: string | null;
        html_url: string;
        updated_at: string;
        head?: { ref?: string };
        user?: { login?: string; avatar_url?: string };
      }>
    >(
      `/repos/${fullName}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
      token,
    ),
    githubFetch<
      Array<{
        sha: string;
        html_url: string;
        commit?: { message?: string; committer?: { date?: string } };
        author?: { login?: string; avatar_url?: string };
      }>
    >(`/repos/${fullName}/commits?per_page=50`, token),
  ]);
  const issueItems: GitHubHistoryItem[] = issues
    .filter((item) => !item.pull_request)
    .map((item) => ({
      id: `issue:${item.id}:${item.updated_at}`,
      kind: 'issues',
      action: item.state === 'closed' ? 'closed' : 'opened',
      number: item.number,
      title: item.title,
      body: item.body ?? '',
      url: item.html_url,
      state: item.state,
      branch: '',
      merged: false,
      actorLogin: item.user?.login ?? 'github',
      actorAvatarUrl: item.user?.avatar_url ?? null,
      createdAt: Date.parse(item.updated_at),
    }));
  const pullItems: GitHubHistoryItem[] = pulls.map((item) => ({
    id: `pull:${item.id}:${item.updated_at}`,
    kind: 'pull_request',
    action: item.merged_at
      ? 'closed'
      : item.state === 'open'
        ? 'opened'
        : 'closed',
    number: item.number,
    title: item.title,
    body: item.body ?? '',
    url: item.html_url,
    state: item.merged_at ? 'merged' : item.state,
    branch: item.head?.ref ?? '',
    merged: Boolean(item.merged_at),
    actorLogin: item.user?.login ?? 'github',
    actorAvatarUrl: item.user?.avatar_url ?? null,
    createdAt: Date.parse(item.updated_at),
  }));
  const commitItems: GitHubHistoryItem[] = commits.map((item) => ({
    id: `commit:${item.sha}`,
    kind: 'push',
    action: 'pushed',
    number: null,
    title: (item.commit?.message ?? 'Commit').split('\n')[0].slice(0, 160),
    body: item.commit?.message ?? '',
    url: item.html_url,
    state: '',
    branch: '',
    merged: false,
    actorLogin: item.author?.login ?? 'github',
    actorAvatarUrl: item.author?.avatar_url ?? null,
    createdAt: Date.parse(item.commit?.committer?.date ?? '') || Date.now(),
  }));
  return [...issueItems, ...pullItems, ...commitItems].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
}

export async function getGitHubLinkedItem(
  config: GitHubAppConfig,
  installationId: string,
  fullName: string,
  kind: 'issue' | 'pull_request',
  number: number,
): Promise<GitHubLinkedItem> {
  const token = await createInstallationToken(config, installationId);
  if (kind === 'pull_request') {
    const item = await githubFetch<{
      number: number;
      title: string;
      state: string;
      html_url: string;
      merged: boolean;
      head: { ref: string };
    }>(`/repos/${fullName}/pulls/${number}`, token);
    return {
      kind,
      number: item.number,
      title: item.title,
      state: item.merged ? 'merged' : item.state,
      url: item.html_url,
      branch: item.head.ref,
      merged: item.merged,
    };
  }
  const item = await githubFetch<{
    number: number;
    title: string;
    state: string;
    html_url: string;
  }>(`/repos/${fullName}/issues/${number}`, token);
  return {
    kind,
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    branch: null,
    merged: false,
  };
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

export async function verifyGitHubWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) {
  const signature = signatureHeader?.startsWith('sha256=')
    ? hexBytes(signatureHeader.slice(7))
    : null;
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(rawBody));
}

export function parseGitHubItemUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const [, owner, repo, kindSegment, numberSegment] = url.pathname.split('/');
    const number = Number(numberSegment);
    if (!owner || !repo || !Number.isSafeInteger(number) || number < 1)
      return null;
    const kind =
      kindSegment === 'pull'
        ? 'pull_request'
        : kindSegment === 'issues'
          ? 'issue'
          : null;
    if (!kind) return null;
    return { fullName: `${owner}/${repo}`, kind, number } as const;
  } catch {
    return null;
  }
}
