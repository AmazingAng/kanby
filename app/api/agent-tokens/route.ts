import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from '@/lib/agent';
import {
  getAuthConfig,
  getSessionUser,
  isSameOriginMutation,
} from '@/lib/auth';
import { normalizeAgentTokenName } from '@/lib/agent-token-policy';
import { getProjectRole } from '@/lib/db';
import {
  isJsonContentType,
  readJsonObjectWithLimit,
} from '@/lib/request-limits';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  const role =
    user && projectId ? await getProjectRole(projectId, user.id) : null;
  if (!user || !projectId || !role) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const tokens = await listAgentTokens(projectId, user.id, role === 'owner');
  return Response.json(
    { tokens: tokens.map((token) => ({ ...token, canRevoke: true })) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

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
  const name = normalizeAgentTokenName(body.name);
  const expiresInDays =
    body.expiresInDays === null ? null : Number(body.expiresInDays);
  if (
    !projectId ||
    !name ||
    (expiresInDays !== null &&
      (!Number.isInteger(expiresInDays) ||
        expiresInDays < 1 ||
        expiresInDays > 365))
  ) {
    return Response.json({ error: 'Invalid token request' }, { status: 400 });
  }
  if (!(await getProjectRole(projectId, user.id)))
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await createAgentToken({
    projectId,
    user,
    name,
    expiresAt:
      expiresInDays === null ? null : Date.now() + expiresInDays * 86_400_000,
  });
  if (!result) {
    if (!(await getProjectRole(projectId, user.id)))
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    return Response.json(
      { error: 'Active token limit reached' },
      { status: 409 },
    );
  }
  return Response.json(
    { ...result, record: { ...result.record, canRevoke: true } },
    {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function DELETE(request: Request) {
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
  const tokenId = typeof body.tokenId === 'string' ? body.tokenId : '';
  if (!projectId || !tokenId)
    return Response.json({ error: 'Invalid token' }, { status: 400 });
  const role = await getProjectRole(projectId, user.id);
  if (!role) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const revoked = await revokeAgentToken(
    projectId,
    tokenId,
    user.id,
    role === 'owner',
  );
  if (!revoked)
    return Response.json({ error: 'Token not found' }, { status: 404 });
  const tokens = await listAgentTokens(projectId, user.id, role === 'owner');
  return Response.json({
    tokens: tokens.map((token) => ({ ...token, canRevoke: true })),
  });
}
