import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  parseContentLength,
  readTextBodyWithLimit,
} from '@/lib/request-limits';

describe('bounded request bodies', () => {
  it('parses exactly the safe nonnegative decimal content lengths', () => {
    fc.assert(
      fc.property(fc.nat({ max: Number.MAX_SAFE_INTEGER }), (value) => {
        expect(parseContentLength(String(value))).toBe(value);
      }),
      { numRuns: 200, seed: 20260908 },
    );

    fc.assert(
      fc.property(
        fc.string().filter((value) => !/^\d+$/.test(value)),
        (value) => {
          expect(parseContentLength(value)).toBeNull();
        },
      ),
      { numRuns: 200, seed: 20260909 },
    );
  });

  it('accepts the exact byte limit and rejects the next byte', async () => {
    const accepted = await readTextBodyWithLimit(
      new Request('https://kanby.test', {
        method: 'POST',
        headers: { 'Content-Length': '4' },
        body: '1234',
      }),
      4,
    );
    const rejected = await readTextBodyWithLimit(
      new Request('https://kanby.test', {
        method: 'POST',
        body: '12345',
      }),
      4,
    );

    expect(accepted).toEqual({ ok: true, text: '1234' });
    expect(rejected).toEqual({ ok: false, reason: 'too_large' });
  });
});
