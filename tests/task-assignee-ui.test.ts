import { describe, expect, it } from 'vitest';

import {
  taskMatchesMember,
  taskOwners,
  toggleTaskOwnerIds,
} from '@/lib/task-assignees';

const alice = { id: 'alice', login: 'alice', name: 'Alice', avatarUrl: null };
const bob = { id: 'bob', login: 'bob', name: 'Bob', avatarUrl: null };
describe('multi-assignee card behavior', () => {
  it('returns every ordered owner and falls back to the legacy owner', () => {
    expect(taskOwners({ owner: alice, owners: [alice, bob] })).toEqual([
      alice,
      bob,
    ]);
    expect(taskOwners({ owner: alice })).toEqual([alice]);
  });

  it('matches a member who is not the primary owner', () => {
    expect(
      taskMatchesMember({ owner: alice, owners: [alice, bob] }, 'bob'),
    ).toBe(true);
    expect(
      taskMatchesMember({ owner: alice, owners: [alice, bob] }, 'cara'),
    ).toBe(false);
  });

  it('adds up to three owners and never removes the final owner', () => {
    expect(toggleTaskOwnerIds(['alice'], 'bob')).toEqual(['alice', 'bob']);
    expect(toggleTaskOwnerIds(['alice', 'bob'], 'alice')).toEqual(['bob']);
    expect(toggleTaskOwnerIds(['alice'], 'alice')).toEqual(['alice']);
    expect(toggleTaskOwnerIds(['alice', 'bob', 'cara'], 'dana')).toEqual([
      'alice',
      'bob',
      'cara',
    ]);
  });
});
