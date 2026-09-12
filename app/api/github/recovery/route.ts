import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { getGitHubAppConfig, verifyGitHubWebhook } from '@/lib/github';
import {
  backfillGitHubProject,
  diagnoseGitHubProject,
  runGitHubProjectRecovery,
  runGitHubRecovery,
} from '@/lib/github-recovery';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  if (!user || !projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    { diagnostics: await diagnoseGitHubProject(projectId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const app = getGitHubAppConfig();
  if (request.headers.get('x-kanby-scheduled') === '1' && app) {
    const raw = await request.text();
    const valid = await verifyGitHubWebhook(
      raw,
      request.headers.get('x-kanby-signature'),
      app.webhookSecret,
    );
    if (!valid || raw !== 'kanby-recovery-v1')
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    return Response.json(await runGitHubRecovery());
  }

  const auth = getAuthConfig();
  const user = await getSessionUser(request);
  if (!auth || !user || !isSameOriginMutation(request, auth))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!isJsonContentType(request))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const parsed = await readJsonObjectWithLimit(request);
  if (!parsed.ok)
    return Response.json(
      {
        error:
          parsed.reason === 'too_large' ? 'Payload too large' : 'Invalid JSON',
      },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  const body = parsed.body;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const action = body.action;
  if (!projectId || !['recover', 'backfill'].includes(String(action)))
    return Response.json(
      { error: 'Invalid recovery request' },
      { status: 400 },
    );
  if ((await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json({ error: 'Owner required' }, { status: 403 });
  const result =
    action === 'backfill'
      ? await backfillGitHubProject(projectId)
      : await runGitHubProjectRecovery(projectId);
  return Response.json({ ok: true, result });
}
