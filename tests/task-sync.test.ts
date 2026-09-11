import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { mergePolledTasks, shouldCloseTaskEditor } from '@/lib/task-sync';

describe('task editor synchronization', () => {
  it('keeps the local card while that card is being edited', () => {
    const current = [
      { id: 'editing', title: 'local draft backing row' },
      { id: 'other', title: 'old other' },
    ];
    const incoming = [
      { id: 'editing', title: 'remote polling copy' },
      { id: 'other', title: 'new other' },
    ];

    expect(mergePolledTasks(current, incoming, 'editing')).toEqual([
      current[0],
      incoming[1],
    ]);
    expect(mergePolledTasks(current, incoming, null)).toEqual(incoming);
  });

  it('closes only after the exact visible draft saves successfully', () => {
    const base = {
      savedTaskId: 'task-1',
      savedFingerprint: 'revision-a',
      currentTaskId: 'task-1',
      currentFingerprint: 'revision-a',
    };

    expect(shouldCloseTaskEditor({ ...base, saveSucceeded: true })).toBe(true);
    expect(shouldCloseTaskEditor({ ...base, saveSucceeded: false })).toBe(
      false,
    );
    expect(
      shouldCloseTaskEditor({
        ...base,
        saveSucceeded: true,
        currentFingerprint: 'revision-b',
      }),
    ).toBe(false);
    expect(
      shouldCloseTaskEditor({
        ...base,
        saveSucceeded: true,
        currentTaskId: 'task-2',
      }),
    ).toBe(false);
  });

  it('preserves the edited item for generated unique task collections', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 16 }),
            value: fc.integer(),
          }),
          { minLength: 1, maxLength: 30, selector: (item) => item.id },
        ),
        fc.integer(),
        (incoming, localValue) => {
          const editing = incoming[0];
          const local = { ...editing, value: localValue };
          const merged = mergePolledTasks(
            [local, ...incoming.slice(1)],
            incoming,
            editing.id,
          );
          expect(merged.find((item) => item.id === editing.id)).toEqual(local);
          expect(new Set(merged.map((item) => item.id)).size).toBe(
            merged.length,
          );
        },
      ),
      { numRuns: 200, seed: 20260908 },
    );
  });
});
