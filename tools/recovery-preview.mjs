const readPaths = new Set([
  '/api/attachments',
  '/api/members',
  '/api/task-checklist',
  '/api/sessions',
  '/api/agent-tokens',
  '/api/projects',
  '/api/auth/session',
  '/api/auth/github',
  '/api/auth/github/callback',
  '/api/task-events',
  '/api/tasks',
  '/api/metrics',
  '/api/v1/sessions',
  '/api/v1/projects',
  '/api/v1/activity',
  '/api/v1/tasks',
  '/api/v1/metrics',
]);

export function recoveryPreviewResponse(request, snapshot) {
  if (!snapshot) return null;
  const path = new URL(request.url).pathname;
  if (path === '/api/auth/logout' && request.method === 'POST') return null;
  if (
    ['GET', 'HEAD'].includes(request.method) &&
    (!path.startsWith('/api/') || readPaths.has(path))
  )
    return null;
  return Response.json(
    {
      ok: false,
      error: {
        code: 'RECOVERY_READ_ONLY',
        message: `当前为 ${snapshot} 的只读恢复预览，暂不接受修改或同步。`,
      },
    },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  );
}
