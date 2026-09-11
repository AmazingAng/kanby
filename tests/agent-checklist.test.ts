import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATCH } from '@/app/api/v1/tasks/route';

import { createMigratedDatabase, type TestD1Database } from './support/d1';
import {
  agentRequest,
  configureEnvironment,
  seedAgentToken,
  seedProject,
  seedTask,
} from './support/fixtures';

describe('Agent acceptance checklist API', () => {
  let database: TestD1Database;
  let token: string;

  beforeEach(() => {
    database = createMigratedDatabase();
    configureEnvironment(database);
    seedProject(database);
    seedTask(database);
    token = seedAgentToken(
      database,
      '55555555-5555-4555-8555-555555555555',
      'c'.repeat(48),
      'Alice / Codex',
    );
  });

  afterEach(() => database.close());

  it('creates, edits, checks, reopens, and removes structured criteria', async () => {
    const addedResponse = await PATCH(
      agentRequest(
        token,
        { id: 'task-00000001', action: 'checklist.add', body: 'Tests pass' },
        'checklist-add-one',
      ),
    );
    expect(addedResponse.status).toBe(200);
    const added = (await addedResponse.json()) as {
      data: {
        acceptanceCriteria: Array<{
          id: string;
          body: string;
          completed: boolean;
        }>;
      };
    };
    expect(added.data.acceptanceCriteria).toHaveLength(1);
    const criterionId = added.data.acceptanceCriteria[0]!.id;

    for (const [action, body, completed] of [
      ['checklist.edit', 'All tests pass', false],
      ['checklist.check', undefined, true],
      ['checklist.uncheck', undefined, false],
    ] as const) {
      const response = await PATCH(
        agentRequest(
          token,
          { id: 'task-00000001', action, criterionId, body },
          `key-${action}`,
        ),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as typeof added;
      expect(payload.data.acceptanceCriteria[0]).toMatchObject({
        body: action === 'checklist.edit' ? 'All tests pass' : 'All tests pass',
        completed,
      });
    }

    const removedResponse = await PATCH(
      agentRequest(
        token,
        {
          id: 'task-00000001',
          action: 'checklist.remove',
          criterionId,
        },
        'checklist-remove-one',
      ),
    );
    expect(removedResponse.status).toBe(200);
    expect(await removedResponse.json()).toMatchObject({
      data: { acceptanceCriteria: [] },
    });

    const events = database.sqlite
      .prepare(
        "SELECT source, actor_id, kind FROM task_events WHERE kind LIKE 'acceptance.%' ORDER BY created_at, rowid",
      )
      .all() as Array<{ source: string; actor_id: string; kind: string }>;
    expect(events).toHaveLength(5);
    expect(events.every((event) => event.source === 'agent')).toBe(true);
    expect(
      events.every(
        (event) => event.actor_id === '55555555-5555-4555-8555-555555555555',
      ),
    ).toBe(true);
  });

  it('rejects checklist writes while another token owns the claim', async () => {
    const otherToken = seedAgentToken(
      database,
      '66666666-6666-4666-8666-666666666666',
      'd'.repeat(48),
      'Bob / Codex',
    );
    expect(
      (
        await PATCH(
          agentRequest(
            otherToken,
            { id: 'task-00000001', action: 'claim', leaseMinutes: 15 },
            'other-agent-claim',
          ),
        )
      ).status,
    ).toBe(200);

    const response = await PATCH(
      agentRequest(
        token,
        { id: 'task-00000001', action: 'checklist.add', body: 'Forbidden' },
        'blocked-checklist-write',
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'claimed_by_another_agent' },
    });
  });
});
