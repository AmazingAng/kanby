import { env } from 'cloudflare:workers';

export const SESSION_COOKIE = 'tinyship_session';
export const OAUTH_STATE_COOKIE = 'tinyship_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'tinyship_oauth_verifier';
export const OAUTH_RETURN_TO_COOKIE = 'tinyship_oauth_return_to';

export type AuthUser = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
  githubAdminAccountIds?: string[];
};

export type SessionUser = AuthUser & {
  authenticatedAt: number;
};

type AuthBindings = {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_APP_ORIGIN?: string;
  PUBLIC_APP_BASE_PATH?: string;
  ALLOWED_GITHUB_LOGINS?: string;
  ALLOWED_GITHUB_ORGS?: string;
  ALLOWED_GITHUB_TEAMS?: string;
};

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  origin: string;
  basePath: string;
  publicBaseUrl: string;
  allowedIdentities: Set<string>;
  allowedOrganizations: Set<string>;
  allowedTeams: Set<string>;
};

const encoder = new TextEncoder();
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
export const SENSITIVE_AUTH_MAX_AGE_SECONDS = 15 * 60;

function bindings(): AuthBindings {
  return env as unknown as AuthBindings;
}

function commaSeparatedSet(value?: string): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getAuthConfig(): AuthConfig | null {
  const runtime = bindings();
  const clientId = runtime.GITHUB_CLIENT_ID?.trim();
  const clientSecret = runtime.GITHUB_CLIENT_SECRET?.trim();
  const sessionSecret = runtime.SESSION_SECRET?.trim();
  const rawOrigin = runtime.PUBLIC_APP_ORIGIN?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !sessionSecret ||
    encoder.encode(sessionSecret).byteLength < 32 ||
    !rawOrigin
  )
    return null;

  let origin: string;
  try {
    const parsed = new URL(rawOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !loopback) return null;
    if (
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '/' && parsed.pathname !== '') ||
      parsed.search ||
      parsed.hash
    )
      return null;
    origin = parsed.origin;
  } catch {
    return null;
  }

  const rawBasePath = runtime.PUBLIC_APP_BASE_PATH?.trim() ?? '';
  if (
    rawBasePath &&
    (!rawBasePath.startsWith('/') ||
      rawBasePath.startsWith('//') ||
      rawBasePath.includes('\\') ||
      rawBasePath.includes('?') ||
      rawBasePath.includes('#'))
  )
    return null;
  const basePath = rawBasePath.replace(/\/$/, '');

  return {
    clientId,
    clientSecret,
    sessionSecret,
    origin,
    basePath,
    publicBaseUrl: `${origin}${basePath}`,
    allowedIdentities: commaSeparatedSet(runtime.ALLOWED_GITHUB_LOGINS),
    allowedOrganizations: commaSeparatedSet(runtime.ALLOWED_GITHUB_ORGS),
    allowedTeams: commaSeparatedSet(runtime.ALLOWED_GITHUB_TEAMS),
  };
}

export function githubOAuthScopes(config: AuthConfig): string[] {
  void config;
  return ['read:user', 'user:email', 'read:org'];
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(parts.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.includes('\\')) return '/';
  try {
    const base = new URL('https://kanby-return.invalid');
    const target = new URL(value, base);
    if (target.origin !== base.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

export function publicAuthUser(
  user: AuthUser,
): Omit<AuthUser, 'githubAdminAccountIds'> {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export function hasFreshAuthorizationClaims(
  user: Pick<SessionUser, 'authenticatedAt'>,
  now = Date.now(),
) {
  const ageSeconds = Math.floor(now / 1000) - user.authenticatedAt;
  return (
    ageSeconds >= -MAX_CLOCK_SKEW_SECONDS &&
    ageSeconds <= SENSITIVE_AUTH_MAX_AGE_SECONDS
  );
}

export function cookieHeader(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean; path?: string },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || '/'}`,
    'HttpOnly',
    'SameSite=Lax',
    options.secure ? 'Secure' : '',
    `Max-Age=${options.maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookieHeader(
  name: string,
  secure: boolean,
  path?: string,
): string {
  return cookieHeader(name, '', { maxAge: 0, secure, path });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return encodeBase64Url(value);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionToken(
  user: AuthUser,
  secret: string,
): Promise<string> {
  const payload = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        ...user,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(payload),
  );
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function getSessionUser(
  request: Request,
): Promise<SessionUser | null> {
  const config = getAuthConfig();
  const token = readCookie(request, SESSION_COOKIE);
  if (!config || !token) return null;
  const segments = token.split('.');
  if (segments.length !== 2) return null;
  const [payload, signature] = segments;
  if (!payload || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(config.sessionSecret),
      decodeBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const parsed = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as AuthUser & { iat: number; exp: number };
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof parsed.id !== 'string' ||
      !parsed.id ||
      typeof parsed.login !== 'string' ||
      !parsed.login ||
      !Number.isSafeInteger(parsed.iat) ||
      parsed.iat < 1 ||
      parsed.iat > now + MAX_CLOCK_SKEW_SECONDS ||
      !Number.isSafeInteger(parsed.exp) ||
      parsed.exp > parsed.iat + SESSION_LIFETIME_SECONDS ||
      !parsed.exp ||
      parsed.exp <= now
    )
      return null;
    const githubAdminAccountIds = Array.isArray(parsed.githubAdminAccountIds)
      ? parsed.githubAdminAccountIds
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 250)
      : undefined;
    return {
      id: parsed.id,
      login: parsed.login,
      name:
        typeof parsed.name === 'string' && parsed.name
          ? parsed.name
          : parsed.login,
      avatarUrl:
        typeof parsed.avatarUrl === 'string' && parsed.avatarUrl
          ? parsed.avatarUrl
          : null,
      githubAdminAccountIds,
      authenticatedAt: parsed.iat,
    };
  } catch {
    return null;
  }
}

export function isSameOriginMutation(
  request: Request,
  config: AuthConfig,
): boolean {
  return request.headers.get('origin') === config.origin;
}
