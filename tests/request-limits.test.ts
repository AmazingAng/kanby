import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  isJsonContentType,
  parseContentLength,
  readJsonObjectWithLimit,
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

  it('accepts only the JSON media type and optional parameters', () => {
    for (const contentType of [
      'application/json',
      'application/json; charset=utf-8',
      'Application/JSON ; Charset=UTF-8',
    ]) {
      expect(
        isJsonContentType(
          new Request('https://kanby.test', {
            headers: { 'Content-Type': contentType },
          }),
        ),
      ).toBe(true);
    }
    for (const contentType of [
      'application/json-patch+json',
      'application/jsonp',
      'text/json',
      '',
    ]) {
      expect(
        isJsonContentType(
          new Request('https://kanby.test', {
            headers: contentType ? { 'Content-Type': contentType } : {},
          }),
        ),
      ).toBe(false);
    }
  });

  it('parses exactly one bounded JSON object and classifies invalid input', async () => {
    const parse = (body: string, maximumBytes = 32) =>
      readJsonObjectWithLimit(
        new Request('https://kanby.test', { method: 'POST', body }),
        maximumBytes,
      );

    await expect(parse('{"ok":true}')).resolves.toEqual({
      ok: true,
      body: { ok: true },
      text: '{"ok":true}',
    });
    await expect(parse('{')).resolves.toEqual({
      ok: false,
      reason: 'invalid_json',
    });
    await expect(parse('[]')).resolves.toEqual({
      ok: false,
      reason: 'invalid_shape',
    });
    await expect(parse('"scalar"')).resolves.toEqual({
      ok: false,
      reason: 'invalid_shape',
    });
    await expect(
      parse('{"padding":"xxxxxxxxxxxxxxxxxxxxxxxx"}', 16),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
  });
});
