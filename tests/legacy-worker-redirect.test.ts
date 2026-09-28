import { afterEach, describe, expect, it, vi } from 'vitest';
import legacy from '../tools/legacy-worker-redirect.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('legacy Worker cutover', () => {
  it('moves browser navigation and sign-in to the canonical origin', async () => {
    for (const path of [
      '/app?project=one',
      '/api/auth/github?returnTo=%2Fapp',
      '//example.com/path',
    ]) {
      const response = await legacy.fetch(
        new Request(`https://kanby.0xaa.workers.dev${path}`),
      );
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).origin).toBe(
        'https://kanby.dev',
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('preserves API credentials and webhook bytes without following redirects', async () => {
    const proxy = vi.fn(async (request: Request) => {
      expect(request.url).toBe(
        'https://kanby.dev/api/github/webhook?delivery=one',
      );
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer test-only');
      expect(request.headers.get('x-hub-signature-256')).toBe('test-signature');
      expect(request.headers.has('host')).toBe(false);
      expect(request.redirect).toBe('manual');
      expect(await request.text()).toBe('{"test":true}');
      return new Response('upstream', { status: 202 });
    });
    vi.stubGlobal('fetch', proxy);
    const response = await legacy.fetch(
      new Request(
        'https://kanby.0xaa.workers.dev/api/github/webhook?delivery=one',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer test-only',
            'x-hub-signature-256': 'test-signature',
            host: 'kanby.0xaa.workers.dev',
          },
          body: '{"test":true}',
        },
      ),
    );
    expect(response.status).toBe(202);
    expect(proxy).toHaveBeenCalledOnce();
  });
});
