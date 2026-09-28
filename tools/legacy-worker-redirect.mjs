const canonicalOrigin = 'https://kanby.dev';

const legacyWorker = {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(canonicalOrigin);
    target.pathname = url.pathname;
    target.search = url.search;
    if (
      url.pathname.startsWith('/api/') &&
      !url.pathname.startsWith('/api/auth/')
    ) {
      const headers = new Headers(request.headers);
      headers.delete('host');
      // Preserve Agent authorization and webhook bodies. Never follow a redirect
      // with those credentials; return it to the caller instead.
      return fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: ['GET', 'HEAD'].includes(request.method)
            ? undefined
            : request.body,
          redirect: 'manual',
          duplex: 'half',
        }),
      );
    }
    return new Response(null, {
      status: 307,
      headers: { location: target.href, 'cache-control': 'no-store' },
    });
  },
  // Only the canonical xAPI environment runs recovery jobs after cutover.
  scheduled() {},
};

export default legacyWorker;
