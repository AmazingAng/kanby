import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  createProject,
  getProjectRole,
  listProjects,
  registerUserAndAcceptInvitations,
  renameProject,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await registerUserAndAcceptInvitations(user);
  return Response.json(
    { projects: await listProjects(user.id) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80)
    return Response.json({ error: 'Invalid project' }, { status: 400 });
  return Response.json(
    { project: await createProject(user, name) },
    { status: 201 },
  );
}

export async function PATCH(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as {
    projectId?: unknown;
    name?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!projectId || !name || name.length > 80)
    return Response.json({ error: 'Invalid project' }, { status: 400 });
  if ((await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json({ error: 'Owner required' }, { status: 403 });
  await renameProject(projectId, name);
  return Response.json({ projects: await listProjects(user.id) });
}
