import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import {
  getProjectRole,
  inviteProjectMember,
  listProjectMembers,
  removeProjectMember,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

function projectIdFrom(request: Request): string {
  return new URL(request.url).searchParams.get('projectId')?.trim() ?? '';
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId = projectIdFrom(request);
  if (!user || !projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    { members: await listProjectMembers(projectId) },
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
  const body = (await request.json()) as {
    projectId?: unknown;
    identity?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const identity =
    typeof body.identity === 'string' ? body.identity.trim() : '';
  const normalizedIdentity = identity.replace(/^@/, '');
  const isUsername = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(
    normalizedIdentity,
  );
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedIdentity);
  if (
    !projectId ||
    !identity ||
    identity.length > 254 ||
    (!isUsername && !isEmail)
  ) {
    return Response.json({ error: 'Invalid member' }, { status: 400 });
  }
  if ((await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json({ error: 'Owner required' }, { status: 403 });
  await inviteProjectMember(projectId, user.id, identity);
  return Response.json(
    { members: await listProjectMembers(projectId) },
    { status: 201 },
  );
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = (await request.json()) as {
    projectId?: unknown;
    memberId?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  if (
    !projectId ||
    !memberId ||
    (await getProjectRole(projectId, user.id)) !== 'owner'
  )
    return Response.json({ error: 'Owner required' }, { status: 403 });
  await removeProjectMember(projectId, memberId);
  return Response.json({ members: await listProjectMembers(projectId) });
}
