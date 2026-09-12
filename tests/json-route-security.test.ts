import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as createProject } from '@/app/api/projects/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  configureEnvironment,
  origin,
  sessionSecret,
} from './support/fixtures';

describe('browser JSON mutation limits', () => {
  let database: TestD1Database;
  let session: string;

  beforeAll(async () => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    session = await createSessionToken(
      {
        id: 'user-1',
        login: 'alice',
        name: 'Alice',
        avatarUrl: null,
      },
      sessionSecret,
    );
  });

  afterAll(() => database.close());

  function request(body: string, contentType = 'application/json') {
    return new Request(`${origin}/api/projects`, {
      method: 'POST',
      headers: {
        Cookie: `${SESSION_COOKIE}=${session}`,
        Origin: origin,
        'Content-Type': contentType,
      },
      body,
    });
  }

  it('rejects malformed, oversized, and lookalike JSON before a write', async () => {
    expect((await createProject(request('{'))).status).toBe(400);
    expect(
      (
        await createProject(
          request(JSON.stringify({ padding: 'x'.repeat(65 * 1024) })),
        )
      ).status,
    ).toBe(413);
    expect(
      (await createProject(request('{"name":"Nope"}', 'application/jsonp')))
        .status,
    ).toBe(415);

    const count = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM projects')
      .get() as { count: number };
    expect(Number(count.count)).toBe(0);
  });
});
