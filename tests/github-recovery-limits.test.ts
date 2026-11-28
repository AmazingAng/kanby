import { generateKeyPairSync } from 'node:crypto';

import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as recoveryPOST } from '@/app/api/github/recovery/route';
import {
  claimDueGitHubDeliveries,
  failGitHubDelivery,
  githubReliabilitySummary,
  MAX_GITHUB_DELIVERY_ATTEMPTS,
  MAX_GITHUB_REDELIVERY_ATTEMPTS,
  releaseGitHubRedelivery,
  reserveGitHubRedelivery,
  startGitHubDelivery,
} from '@/lib/github-db';
import { listGitHubAppDeliveries, nextDeliveryCursor } from '@/lib/github';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  linkGitHubRepository,
  origin,
  seedProject,
} from './support/fixtures';

async function sign(body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-webhook-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );
  return `sha256=${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function scheduled(body: string) {
  return recoveryPOST(
    new Request(`${origin}/api/github/recovery`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-kanby-scheduled': '1',
        'x-kanby-signature': await sign(body),
      },
      body,
    }),
  );
}

describe('GitHub recovery limits', () => {
  let database: TestD1Database;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    database.close();
  });

  it('abandons a delivery after the final attempt instead of retrying forever', async () => {
    linkGitHubRepository(database, 'repo-1');
    await startGitHubDelivery('d-1', 'issues', '{}', {
      installationId: 'installation-repo-1',
      repositoryId: 'repo-1',
    });
    database.sqlite
      .prepare('UPDATE github_deliveries SET attempt_count = ?')
      .run(MAX_GITHUB_DELIVERY_ATTEMPTS);
    await failGitHubDelivery('d-1', 'still broken');

    expect(
      database.sqlite
        .prepare('SELECT status, next_retry_at FROM github_deliveries')
        .get(),
    ).toEqual({ status: 'abandoned', next_retry_at: null });
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60 * 1000 });
    expect(await claimDueGitHubDeliveries()).toEqual([]);
    const summary = await githubReliabilitySummary('project-1');
    expect(summary.backlog).toBe(0);
    expect(summary.failures[0]).toMatchObject({
      abandoned: true,
      attempts: MAX_GITHUB_DELIVERY_ATTEMPTS,
    });
  });

  it('abandons an expired lease on the final attempt', async () => {
    await startGitHubDelivery('d-2', 'issues', '{}');
    database.sqlite
      .prepare(
        'UPDATE github_deliveries SET attempt_count = ?, lease_expires_at = 1',
      )
      .run(MAX_GITHUB_DELIVERY_ATTEMPTS);
    expect(await claimDueGitHubDeliveries()).toEqual([]);
    expect(
      database.sqlite.prepare('SELECT status FROM github_deliveries').get(),
    ).toEqual({ status: 'abandoned' });
  });

  it('caps GitHub-side redeliveries per GUID across new delivery ids', async () => {
    expect(await reserveGitHubRedelivery(1, 'guid-1')).toBe(true);
    // Within 15 minutes nothing is requested again, even for a new id.
    expect(await reserveGitHubRedelivery(2, 'guid-1')).toBe(false);
    let now = Date.now();
    for (
      let attempt = 2;
      attempt <= MAX_GITHUB_REDELIVERY_ATTEMPTS;
      attempt++
    ) {
      now += 16 * 60 * 1000;
      vi.useFakeTimers({ now });
      expect(await reserveGitHubRedelivery(attempt + 10, 'guid-1')).toBe(true);
    }
    now += 16 * 60 * 1000;
    vi.useFakeTimers({ now });
    expect(await reserveGitHubRedelivery(99, 'guid-1')).toBe(false);

    // A request that could not be sent gives its attempt back.
    await releaseGitHubRedelivery('guid-1');
    expect(await reserveGitHubRedelivery(100, 'guid-1')).toBe(true);

    // Once the delivery arrived locally, it is never redelivered.
    await startGitHubDelivery('guid-2', 'issues');
    expect(await reserveGitHubRedelivery(200, 'guid-2')).toBe(false);
  });

  it('accepts only fresh timestamped scheduled recovery signatures', async () => {
    expect((await scheduled('kanby-recovery-v1')).status).toBe(403);
    expect(
      (await scheduled(`kanby-recovery-v2:${Date.now() - 10 * 60 * 1000}`))
        .status,
    ).toBe(403);
    expect((await scheduled('kanby-recovery-v2:soon')).status).toBe(403);
    const response = await scheduled(`kanby-recovery-v2:${Date.now()}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      local: { claimed: 0, recovered: 0 },
    });
  });

  it('follows the Link cursor when listing App deliveries', async () => {
    expect(
      nextDeliveryCursor(
        '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=v1_2>; rel="next", <https://api.github.com/app/hook/deliveries?per_page=100>; rel="prev"',
      ),
    ).toBe('v1_2');
    expect(nextDeliveryCursor(null)).toBeNull();
    expect(nextDeliveryCursor('<not a url>; rel="next"')).toBeNull();

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(env, {
      GITHUB_APP_PRIVATE_KEY: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        urls.push(request.url);
        const cursor = new URL(request.url).searchParams.get('cursor');
        return Response.json([{ id: urls.length }], {
          headers:
            cursor === 'c2'
              ? {}
              : {
                  Link: `<https://api.github.com/app/hook/deliveries?cursor=${cursor ? 'c2' : 'c1'}>; rel="next"`,
                },
        });
      }),
    );
    const { getGitHubAppConfig } = await import('@/lib/github');
    const deliveries = await listGitHubAppDeliveries(getGitHubAppConfig()!);
    expect(deliveries.map((delivery) => delivery.id)).toEqual([1, 2, 3]);
    expect(urls.map((url) => new URL(url).searchParams.get('cursor'))).toEqual([
      null,
      'c1',
      'c2',
    ]);
  });
});
