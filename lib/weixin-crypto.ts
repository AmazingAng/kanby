import { env } from 'cloudflare:workers';

/**
 * Hosted WeChat credentials are sealed with AES-256-GCM. The key lives only in
 * the Worker secret WEIXIN_CREDENTIAL_KEY (32 random bytes, base64); the
 * additional data binds each ciphertext to its member and field, so a sealed
 * value cannot be replayed under another member.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = 'v1';

function base64UrlEncode(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function rawKey(): Uint8Array<ArrayBuffer> | null {
  const value = (
    env as unknown as { WEIXIN_CREDENTIAL_KEY?: string }
  ).WEIXIN_CREDENTIAL_KEY?.trim();
  if (!value) return null;
  try {
    const bytes = base64Decode(value);
    return bytes.byteLength === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function weixinCredentialsConfigured() {
  return rawKey() !== null;
}

async function key(usage: 'encrypt' | 'decrypt') {
  const bytes = rawKey();
  if (!bytes) throw new Error('WEIXIN_CREDENTIAL_KEY is not configured');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    usage,
  ]);
}

function additionalData(userId: string, field: string) {
  return encoder.encode(`kanby-weixin:${userId}:${field}`);
}

export async function sealCredential(
  userId: string,
  field: string,
  plaintext: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(userId, field) },
    await key('encrypt'),
    encoder.encode(plaintext),
  );
  return `${VERSION}.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

export async function openCredential(
  userId: string,
  field: string,
  sealed: string,
) {
  const [version, iv, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !ciphertext)
    throw new Error('Unsupported credential format');
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64Decode(iv),
      additionalData: additionalData(userId, field),
    },
    await key('decrypt'),
    base64Decode(ciphertext),
  );
  return decoder.decode(plaintext);
}
