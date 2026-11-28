import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('drizzle migration journal', () => {
  it('orders migrations by strictly increasing timestamps', () => {
    // drizzle's migrator skips entries whose `when` is not newer than the
    // last applied migration.
    const journal = JSON.parse(
      readFileSync('drizzle/meta/_journal.json', 'utf8'),
    ) as { entries: { idx: number; when: number }[] };
    for (const [index, entry] of journal.entries.entries()) {
      expect(entry.idx).toBe(index);
      if (index > 0)
        expect(entry.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });
});
