import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import {
  createNotificationChannel,
  deleteNotificationChannel,
  isNotificationKind,
  listNotificationChannels,
  validateWebhookUrl,
} from '@/lib/notifications';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId =
    new URL(request.url).searchParams.get('projectId')?.trim() ?? '';
  const role =
    user && projectId ? await getProjectRole(projectId, user.id) : null;
  if (!user || !role)
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json(
    {
      channels: await listNotificationChannels(projectId, user.id),
      canManageProjectChannels: role === 'owner',
    },
    { headers: noStore },
  );
}

/**
 * Project channels (`scope: "project"`) are group bots and need the project
 * owner; member channels are a member's own bot. Webhook URLs are write-only.
 */
export async function POST(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (!isJsonContentType(request))
    return Response.json({ error: 'JSON required' }, { status: 415 });
  const parsed = await readJsonObjectWithLimit(request, 8 * 1024);
  if (!parsed.ok)
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  const body = parsed.body;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const scope = body.scope === 'project' ? 'project' : 'member';
  const kind = body.kind;
  const secret =
    typeof body.secret === 'string' && body.secret.trim()
      ? body.secret.trim()
      : null;
  const webhookUrl =
    isNotificationKind(kind) && typeof body.webhookUrl === 'string'
      ? validateWebhookUrl(kind, body.webhookUrl)
      : null;
  if (
    !projectId ||
    !isNotificationKind(kind) ||
    !webhookUrl ||
    (secret && (kind !== 'feishu' || secret.length > 128))
  )
    return Response.json(
      {
        error:
          'Provide a Feishu (open.feishu.cn / open.larksuite.com) or WeCom (qyapi.weixin.qq.com) bot webhook URL',
      },
      { status: 400 },
    );
  const role = await getProjectRole(projectId, user.id);
  if (!role || (scope === 'project' && role !== 'owner'))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const channel = await createNotificationChannel({
    projectId,
    userId: scope === 'project' ? null : user.id,
    kind,
    webhookUrl,
    secret,
    createdBy: user.id,
  });
  if (!channel)
    return Response.json(
      { error: 'At most 3 channels per scope' },
      { status: 409 },
    );
  return Response.json({ channel }, { status: 201, headers: noStore });
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const user = await getSessionUser(request);
  if (!config || !user || !isSameOriginMutation(request, config))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const projectId = params.get('projectId')?.trim() ?? '';
  const channelId = params.get('id')?.trim() ?? '';
  const role = projectId ? await getProjectRole(projectId, user.id) : null;
  if (!role || !channelId)
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const deleted = await deleteNotificationChannel({
    projectId,
    channelId,
    userId: user.id,
    isOwner: role === 'owner',
  });
  return deleted
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'Not found' }, { status: 404 });
}
