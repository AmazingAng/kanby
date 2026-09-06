import { env } from 'cloudflare:workers';

export const SESSION_COOKIE = 'tinyship_session';
export const OAUTH_STATE_COOKIE = 'tinyship_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'tinyship_oauth_verifier';

export type AuthUser = {
  id: string;
  login: string;
  name: string;
  avatarUrl: string | null;
};

type AuthBindings = {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_APP_ORIGIN?: string;
  ALLOWED_GITHUB_LOGINS?: string;
};

export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  origin: string;
  allowedLogins: Set<string>;
};

const encoder = new TextEncoder();

function bindings(): AuthBindings {
  return env as unknown as AuthBindings;
}

export function getAuthConfig(): AuthConfig | null {
  const runtime = bindings();
  const clientId = runtime.GITHUB_CLIENT_ID?.trim();
  const clientSecret = runtime.GITHUB_CLIENT_SECRET?.trim();
  const sessionSecret = runtime.SESSION_SECRET?.trim();
  const rawOrigin = runtime.PUBLIC_APP_ORIGIN?.trim();
  if (!clientId || !clientSecret || !sessionSecret || !rawOrigin) return null;

  let origin: string;
  try {
    const parsed = new URL(rawOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    origin = parsed.origin;
  } catch {
    return null;
  }

  return {
    clientId,
    clientSecret,
    sessionSecret,
    origin,
    allowedLogins: new Set(
      (runtime.ALLOWED_GITHUB_LOGINS ?? '')
        .split(',')
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const item of cookie.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

export function cookieHeader(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    options.secure ? 'Secure' : '',
    `Max-Age=${options.maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookieHeader(name: string, secure: boolean): string {
  return cookieHeader(name, '', { maxAge: 0, secure });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSessionToken(user: AuthUser, secret: string): Promise<string> {
  const payload = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        ...user,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      }),
    ),
  );
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const config = getAuthConfig();
  const token = readCookie(request, SESSION_COOKIE);
  if (!config || !token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(config.sessionSecret),
      decodeBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as AuthUser & { exp: number };
    if (!parsed.id || !parsed.login || !parsed.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: String(parsed.id), login: parsed.login, name: parsed.name || parsed.login, avatarUrl: parsed.avatarUrl || null };
  } catch {
    return null;
  }
}

export function isSameOriginMutation(request: Request, config: AuthConfig): boolean {
  return request.headers.get('origin') === config.origin;
}
