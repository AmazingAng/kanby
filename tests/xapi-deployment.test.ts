import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthConfig } from '@/lib/auth';
import { migrationFetch } from '../tools/xapi-migration.mjs';
import { scheduledRecovery } from '../tools/xapi-scheduled-recovery.mjs';

const token = 't'.repeat(64);
const runtime = env as Record<string, unknown>;
const credentials = () => ({
  KANBY_MIGRATION_TOKEN: token,
  KANBY_MIGRATION_EXPIRES: String(Date.now() + 60000),
});
function request(body: unknown, authorization = `Bearer ${token}`) {
  return new Request('https://preview.test/__kanby_migration', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function database(existing: unknown = null) {
  const run = vi.fn().mockResolvedValue({ success: true });
  const first = vi.fn().mockResolvedValue(existing);
  const all = vi.fn().mockResolvedValue({ results: [{ n: 1 }] });
  const bind = vi.fn();
  const statement = { run, first, all, bind };
  bind.mockReturnValue(statement);
  return {
    prepare: vi.fn().mockReturnValue(statement),
    batch: vi.fn().mockResolvedValue([]),
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('xAPI deployment boundaries', () => {
  it('uses the public build origin only when the runtime origin is absent', () => {
    Object.assign(runtime, {
      GITHUB_CLIENT_ID: 'client',
      GITHUB_CLIENT_SECRET: 'secret',
      SESSION_SECRET: token,
    });
    delete runtime.PUBLIC_APP_ORIGIN;
    vi.stubEnv('KANBY_PUBLIC_ORIGIN', 'https://kanby.dev');
    expect(getAuthConfig()?.origin).toBe('https://kanby.dev');
    runtime.PUBLIC_APP_ORIGIN = 'https://existing.test';
    expect(getAuthConfig()?.origin).toBe('https://existing.test');
    runtime.PUBLIC_APP_ORIGIN = 'http://unsafe.test';
    expect(getAuthConfig()).toBeNull();
    delete runtime.PUBLIC_APP_ORIGIN;
    vi.stubEnv('KANBY_PUBLIC_ORIGIN', '');
    expect(getAuthConfig()).toBeNull();
  });
  it('rejects missing, wrong and expired migration credentials before database access', async () => {
    const db = database();
    for (const settings of [
      {},
      { ...credentials(), KANBY_MIGRATION_TOKEN: 'short' },
      { ...credentials(), KANBY_MIGRATION_EXPIRES: 'bad' },
      { ...credentials(), KANBY_MIGRATION_EXPIRES: '1' },
    ]) {
      const r = await migrationFetch(request({}), {
        ...settings,
        DB: db,
      });
      expect(r.status).toBe(403);
    }
    expect(
      (
        await migrationFetch(request({}, 'Bearer wrong'), {
          ...credentials(),
          DB: db,
        })
      ).status,
    ).toBe(403);
    expect(db.prepare).not.toHaveBeenCalled();
  });
  it('rejects malformed or excessive SQL batches before DB writes', async () => {
    const db = database();
    for (const body of [
      {},
      { id: 'one', statements: [] },
      { id: 'one', statements: [''] },
      { id: 'one', statements: Array(41).fill('SELECT 1') },
    ]) {
      expect(
        (await migrationFetch(request(body), { ...credentials(), DB: db }))
          .status,
      ).toBe(400);
    }
    expect(db.batch).not.toHaveBeenCalled();
  });
  it('commits SQL and the idempotency marker together and deduplicates retries', async () => {
    const db = database();
    const body = {
      id: 'batch-1',
      statements: [
        'CREATE TABLE test (id TEXT)',
        "INSERT INTO test VALUES ('one')",
      ],
    };
    expect(
      (await migrationFetch(request(body), { ...credentials(), DB: db }))
        .status,
    ).toBe(200);
    expect(db.batch).toHaveBeenCalledOnce();
    expect(db.batch.mock.calls[0][0]).toHaveLength(3);
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(body.statements)),
        ),
      ),
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const done = database({ digest });
    expect(
      (await migrationFetch(request(body), { ...credentials(), DB: done }))
        .status,
    ).toBe(200);
    expect(done.batch).not.toHaveBeenCalled();
    expect(
      (
        await migrationFetch(request(body), {
          ...credentials(),
          DB: database({ digest: 'different' }),
        })
      ).status,
    ).toBe(409);
  });
  it('returns failure when the atomic import fails, without a separate marker write', async () => {
    const db = database();
    db.batch.mockRejectedValue(new Error('database rejected import'));
    expect(
      (
        await migrationFetch(
          request({ id: 'failed', statements: ['invalid SQL'] }),
          { ...credentials(), DB: db },
        )
      ).status,
    ).toBe(500);
    expect(db.batch).toHaveBeenCalledOnce();
  });
  it('allows authenticated SELECT verification and rejects writable query input', async () => {
    const db = database();
    expect(
      (
        await migrationFetch(
          request({ query: 'SELECT COUNT(*) AS n FROM test' }),
          { ...credentials(), DB: db },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await migrationFetch(request({ query: 'DELETE FROM test' }), {
          ...credentials(),
          DB: db,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await migrationFetch(request({ query: 'SELECT 1; DELETE FROM test' }), {
          ...credentials(),
          DB: db,
        })
      ).status,
    ).toBe(400);
  });
  it('rejects requests larger than the import limit or with the wrong method', async () => {
    expect(
      (
        await migrationFetch(
          new Request('https://preview.test/__kanby_migration'),
          credentials(),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await migrationFetch(
          request({ text: 'a'.repeat(1048577) }),
          credentials(),
        )
      ).status,
    ).toBe(413);
  });
  it('authenticates scheduled recovery before forwarding the fixed signed request', async () => {
    const secret = 'webhook-secret';
    const application = {
      fetch: vi.fn().mockResolvedValue(new Response('ok')),
    };
    expect(
      (
        await scheduledRecovery(
          request({ signature: 'bad' }),
          { GITHUB_WEBHOOK_SECRET: secret },
          {},
          application,
        )
      ).status,
    ).toBe(403);
    expect(application.fetch).not.toHaveBeenCalled();
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode('kanby-recovery-v1'),
      ),
    );
    const signature =
      'sha256=' +
      [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
    const r = await scheduledRecovery(
      request({ signature }),
      { GITHUB_WEBHOOK_SECRET: secret },
      {},
      application,
    );
    expect(r.status).toBe(200);
    expect(application.fetch).toHaveBeenCalledOnce();
    const forwarded = application.fetch.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('x-kanby-signature')).toBe(signature);
    expect(await forwarded.text()).toBe('kanby-recovery-v1');
  });
  it('handles absent bodies, malformed JSON and query failure without leaking data', async () => {
    const url = 'https://preview.test/__kanby_migration';
    const headers = { authorization: `Bearer ${token}` };
    for (const body of [undefined, '{', 'null', '[]']) {
      expect(
        (
          await migrationFetch(
            new Request(url, { method: 'POST', headers, body }),
            credentials(),
          )
        ).status,
      ).toBe(400);
    }
    const db = database();
    db.prepare().all.mockRejectedValue(new Error('private row'));
    const r = await migrationFetch(request({ query: 'SELECT 1' }), {
      ...credentials(),
      DB: db,
    });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('private row');
  });
  it('denies malformed, oversized and cryptographically invalid recovery requests', async () => {
    const application = { fetch: vi.fn() };
    const settings = { GITHUB_WEBHOOK_SECRET: 'secret' };
    const url = 'https://preview.test/__kanby_recovery';
    for (const r of [
      new Request(url),
      new Request(url, { method: 'POST' }),
      new Request(url, { method: 'POST', body: '{' }),
      request({ signature: 'sha256=' + '0'.repeat(64) }),
      request({ text: 'a'.repeat(1025) }),
    ]) {
      expect(
        (await scheduledRecovery(r, settings, {}, application)).status,
      ).toBe(403);
    }
    expect(
      (await scheduledRecovery(request({}), {}, {}, application)).status,
    ).toBe(403);
    expect(application.fetch).not.toHaveBeenCalled();
  });
});
