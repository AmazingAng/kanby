import fc from 'fast-check';
import { afterEach, expect, it, vi } from 'vitest';

import { requestLoginQrcode, sendText } from '@/lib/weixin-ilink';

afterEach(() => vi.unstubAllGlobals());

it('generates a QR using Worker-supported fetch semantics', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.redirect === 'error')
        throw new TypeError('Invalid redirect value: error');
      return Response.json({
        qrcode: 'handle',
        qrcode_img_content: 'qr-content',
      });
    }),
  );
  await expect(requestLoginQrcode()).resolves.toEqual({
    qrcode: 'handle',
    content: 'qr-content',
  });
});

it.each([301, 302, 303, 307, 308])(
  'rejects HTTP %i without forwarding credentials to arbitrary destinations',
  async (status) => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), async (destination) => {
        let forwarded = false;
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.redirect === 'error')
            throw new TypeError('Invalid redirect value: error');
          if (init?.redirect !== 'manual') {
            forwarded = true;
            return Response.json({ ret: 0 });
          }
          return new Response('{"ret":0}', {
            status,
            headers: { Location: destination },
          });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(
          sendText({
            baseUrl: 'https://ilinkai.weixin.qq.com',
            token: 'test-only-bot-token',
            to: 'test-user',
            contextToken: 'test-context',
            text: 'test',
          }),
        ).rejects.toThrow(`iLink HTTP ${status}`);
        expect(forwarded).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 20, seed: 20261128 },
    );
  },
);
