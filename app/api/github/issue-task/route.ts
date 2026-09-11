import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { importGitHubIssueTask } from '@/lib/github-automation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as Record<string, unknown>;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  if (!projectId || projectId.length > 80 || !eventId || eventId.length > 180)
    return Response.json({ error: 'Invalid Issue import' }, { status: 400 });
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await importGitHubIssueTask(projectId, eventId, user);
  if (result === 'disabled')
    return Response.json(
      { error: 'GitHub Issue import is disabled' },
      { status: 409 },
    );
  if (!result)
    return Response.json({ error: 'Issue event not found' }, { status: 404 });
  return Response.json(
    { task: result.task, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}
