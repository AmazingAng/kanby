import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import {
  projectGitHubSettings,
  setGitHubDeliveryRepository,
  setProjectGitHubRepositories,
} from '@/lib/github-db';
import {
  parseGitHubAutomationSettings,
  setProjectGitHubAutomation,
} from '@/lib/github-automation';
import { getGitHubAppConfig } from '@/lib/github';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  if (!projectId || !(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const config = getGitHubAppConfig();
  if (!config)
    return Response.json(
      { configured: false, connection: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  return Response.json(
    { configured: true, connection: await projectGitHubSettings(projectId) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(request: Request) {
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
  const repositoryIds =
    Array.isArray(body.repositoryIds) &&
    body.repositoryIds.every((id) => typeof id === 'string' && id.length < 40)
      ? (body.repositoryIds as string[])
      : null;
  const hasAutomation = body.automation !== undefined;
  const deliveryRepositoryId = body.deliveryRepositoryId;
  const automation = hasAutomation
    ? parseGitHubAutomationSettings(body.automation)
    : null;
  if (
    !projectId ||
    (body.repositoryIds !== undefined && !repositoryIds) ||
    (repositoryIds?.length ?? 0) > 500 ||
    (hasAutomation && !automation) ||
    (deliveryRepositoryId !== undefined &&
      deliveryRepositoryId !== null &&
      (typeof deliveryRepositoryId !== 'string' ||
        !/^\d{1,39}$/.test(deliveryRepositoryId))) ||
    (body.repositoryIds === undefined &&
      !hasAutomation &&
      deliveryRepositoryId === undefined) ||
    (deliveryRepositoryId !== undefined &&
      (body.repositoryIds !== undefined || hasAutomation))
  )
    return Response.json({ error: 'Invalid GitHub settings' }, { status: 400 });
  if ((await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json({ error: 'Owner required' }, { status: 403 });
  if (
    repositoryIds &&
    !(await setProjectGitHubRepositories(projectId, repositoryIds))
  )
    return Response.json({ error: 'Invalid repositories' }, { status: 400 });
  if (automation)
    await setProjectGitHubAutomation(projectId, user.id, automation);
  if (
    deliveryRepositoryId !== undefined &&
    !(await setGitHubDeliveryRepository(
      projectId,
      deliveryRepositoryId as string | null,
    ))
  )
    return Response.json(
      { error: 'Select a connected repository first' },
      { status: 400 },
    );
  return Response.json({
    configured: true,
    connection: await projectGitHubSettings(projectId),
  });
}
