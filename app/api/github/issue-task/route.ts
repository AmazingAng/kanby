import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import {
  getProjectGitHubAutomation,
  importGitHubIssueSnapshot,
  importGitHubIssueTask,
} from '@/lib/github-automation';
import { selectedGitHubRepository } from '@/lib/github-db';
import {
  getGitHubAppConfig,
  getGitHubLinkedItem,
  parseGitHubItemUrl,
} from '@/lib/github';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
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
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const url = typeof body.url === 'string' ? body.url : '';
  const item = url && url.length <= 500 ? parseGitHubItemUrl(url) : null;
  if (
    !projectId ||
    projectId.length > 80 ||
    eventId.length > 180 ||
    (body.url === undefined ? !eventId : eventId || item?.kind !== 'issue')
  )
    return Response.json({ error: 'Invalid Issue import' }, { status: 400 });
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = item
    ? await importIssueByUrl(projectId, item.fullName, item.number, user)
    : await importGitHubIssueTask(projectId, eventId, user);
  if (result === 'disabled')
    return Response.json(
      { error: 'GitHub Issue import is disabled' },
      { status: 409 },
    );
  if (!result)
    return Response.json(
      { error: 'GitHub Issue is unavailable' },
      { status: 404 },
    );
  return Response.json(
    { task: result.task, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}

async function importIssueByUrl(
  projectId: string,
  fullName: string,
  number: number,
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
) {
  if (!(await getProjectGitHubAutomation(projectId)).issueTaskCreation)
    return 'disabled';
  const app = getGitHubAppConfig();
  const repository = await selectedGitHubRepository(projectId, fullName);
  if (!app || !repository) return null;
  const issue = await getGitHubLinkedItem(
    app,
    repository.installation_id,
    fullName,
    'issue',
    number,
  ).catch(() => null);
  if (!issue || issue.number !== number) return null;
  return importGitHubIssueSnapshot(
    projectId,
    {
      repository_id: repository.id,
      item_number: issue.number,
      title: issue.title,
      url: issue.url,
      action: issue.state,
    },
    user,
  );
}
