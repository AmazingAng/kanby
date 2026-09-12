import {
  cookieHeader,
  getAuthConfig,
  getSessionUser,
  hasFreshAuthorizationClaims,
  randomToken,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import { createGitHubConnectionState } from '@/lib/github-db';
import { GITHUB_APP_STATE_COOKIE, getGitHubAppConfig } from '@/lib/github';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const auth = getAuthConfig();
  const app = getGitHubAppConfig();
  const projectId = new URL(request.url).searchParams.get('projectId') ?? '';
  if (!user || !auth)
    return new Response(null, {
      status: 302,
      headers: { Location: '/api/auth/github?returnTo=%2Fsettings' },
    });
  if (!app)
    return new Response(null, {
      status: 302,
      headers: { Location: '/settings?github=not-configured' },
    });
  if (!projectId || (await getProjectRole(projectId, user.id)) !== 'owner')
    return Response.json({ error: 'Owner required' }, { status: 403 });
  if (!hasFreshAuthorizationClaims(user)) {
    const returnTo = `/api/github/connect?projectId=${encodeURIComponent(projectId)}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
  }

  const state = randomToken(32);
  await createGitHubConnectionState(projectId, user.id, state);
  const secure = auth.origin.startsWith('https://');
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}`,
      'Set-Cookie': cookieHeader(GITHUB_APP_STATE_COOKIE, state, {
        maxAge: 10 * 60,
        secure,
      }),
    },
  });
}
