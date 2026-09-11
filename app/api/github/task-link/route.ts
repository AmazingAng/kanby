import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole, taskBelongsToProject } from '@/lib/db';
import {
  deleteGitHubTaskLink,
  getGitHubTaskLink,
  saveGitHubTaskLink,
  selectedGitHubRepository,
} from '@/lib/github-db';
import {
  getGitHubAppConfig,
  getGitHubLinkedItem,
  parseGitHubItemUrl,
} from '@/lib/github';

export const dynamic = 'force-dynamic';

async function authorized(request: Request, projectId: string, taskId: string) {
  const user = await getSessionUser(request);
  return Boolean(
    user &&
    projectId &&
    taskId &&
    (await getProjectRole(projectId, user.id)) &&
    (await taskBelongsToProject(taskId, projectId)),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  const taskId = url.searchParams.get('taskId') ?? '';
  if (!(await authorized(request, projectId, taskId)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    { link: await getGitHubTaskLink(projectId, taskId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = getAuthConfig();
  const app = getGitHubAppConfig();
  const user = await getSessionUser(request);
  if (!auth || !app || !user || !isSameOriginMutation(request, auth))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as {
    projectId?: unknown;
    taskId?: unknown;
    url?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  const parsed =
    typeof body.url === 'string' && body.url.length <= 500
      ? parseGitHubItemUrl(body.url)
      : null;
  if (
    !parsed ||
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Invalid link' }, { status: 400 });
  const repository = await selectedGitHubRepository(projectId, parsed.fullName);
  if (!repository)
    return Response.json(
      { error: 'Repository is not enabled for this project' },
      { status: 400 },
    );
  try {
    const item = await getGitHubLinkedItem(
      app,
      repository.installation_id,
      parsed.fullName,
      parsed.kind,
      parsed.number,
    );
    return Response.json(
      {
        link: await saveGitHubTaskLink(projectId, taskId, repository.id, item),
      },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: 'GitHub item is unavailable' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = getAuthConfig();
  const user = await getSessionUser(request);
  if (!auth || !user || !isSameOriginMutation(request, auth))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const body = (await request.json()) as {
    projectId?: unknown;
    taskId?: unknown;
  };
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (
    !(await getProjectRole(projectId, user.id)) ||
    !(await taskBelongsToProject(taskId, projectId))
  )
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  await deleteGitHubTaskLink(projectId, taskId);
  return Response.json({ ok: true });
}
