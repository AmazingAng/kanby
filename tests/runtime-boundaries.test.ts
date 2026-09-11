import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as webhook } from '@/app/api/github/webhook/route';
import { proxy } from '@/proxy';

import { TestD1Database } from './support/d1';
import { configureEnvironment } from './support/fixtures';

describe('Worker runtime boundaries', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not issue schema DDL during runtime initialization', async () => {
    vi.resetModules();
    const cloudflare = await import('cloudflare:workers');
    const database = new TestD1Database();
    (cloudflare.env as unknown as Record<string, unknown>).DB = database;
    const { ensureSchema } = await import('@/lib/db');

    await ensureSchema();

    expect(
      database.queries.some((query) =>
        /^\s*(CREATE|ALTER|DROP)\b/i.test(query),
      ),
    ).toBe(false);
    database.close();
  });

  it('rejects an oversized webhook before signature verification', async () => {
    const database = new TestD1Database();
    configureEnvironment(database);
    const response = await webhook(
      new Request('https://kanby.test/api/github/webhook', {
        method: 'POST',
        headers: {
          'Content-Length': String(1024 * 1024 + 1),
          'X-Hub-Signature-256': 'sha256=invalid',
        },
        body: '{}',
      }),
    );

    expect(response.status).toBe(413);
    database.close();
  });

  it('defines the complete browser security-header policy', () => {
    const proxyPath = fileURLToPath(new URL('../proxy.ts', import.meta.url));
    expect(existsSync(proxyPath)).toBe(true);
    const source = readFileSync(proxyPath, 'utf8').toLowerCase();
    for (const header of [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
    ]) {
      expect(source).toContain(header);
    }
    expect(source).toContain("frame-ancestors 'none'");

    const response = proxy();
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('strict-transport-security')).toContain(
      'max-age=31536000',
    );
  });
});
