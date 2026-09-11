import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  agentTokenLabel,
  MAX_AGENT_TOKEN_NAME_LENGTH,
  normalizeAgentTokenName,
} from '@/lib/agent-token-policy';

describe('Agent Token naming policy', () => {
  it('accepts only trimmed, non-control names within the public boundary', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (rawName) => {
        const normalized = normalizeAgentTokenName(rawName);
        if (normalized === null) return;
        expect(normalized).toBe(rawName.trim());
        expect(normalized.length).toBeGreaterThanOrEqual(1);
        expect(normalized.length).toBeLessThanOrEqual(
          MAX_AGENT_TOKEN_NAME_LENGTH,
        );
        expect(
          Array.from(normalized).some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 31 || codePoint === 127;
          }),
        ).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects a control character at every generated position', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }),
        fc.integer({ min: 0, max: 31 }),
        fc.string({ maxLength: 20 }),
        (prefix, controlCode, suffix) => {
          expect(
            normalizeAgentTokenName(
              `${prefix}${String.fromCharCode(controlCode)}${suffix}`,
            ),
          ).toBeNull();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('always derives the visible label from the authenticated login', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,38}$/),
        fc.stringMatching(/^[A-Za-z0-9_-]{1,48}$/),
        (login, tokenName) => {
          expect(agentTokenLabel(login, tokenName)).toBe(
            `${login}_${tokenName}`,
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
