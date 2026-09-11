import {
  clearCookieHeader,
  getAuthConfig,
  getSessionUser,
  readCookie,
} from '@/lib/auth';
import { getProjectRole } from '@/lib/db';
import {
  consumeGitHubConnectionState,
  saveGitHubInstallation,
} from '@/lib/github-db';
import { canUserManageGitHubInstallation } from '@/lib/github-access';
import {
  GITHUB_APP_STATE_COOKIE,
  getGitHubAppConfig,
  getGitHubInstallation,
  listInstallationRepositories,
} from '@/lib/github';

export const dynamic = 'force-dynamic';

function redirect(origin: string, suffix: string, secure: boolean) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/settings${suffix}`,
      'Set-Cookie': clearCookieHeader(GITHUB_APP_STATE_COOKIE, secure),
    },
  });
}

export async function GET(request: Request) {
  const auth = getAuthConfig();
  const app = getGitHubAppConfig();
  const user = await getSessionUser(request);
  const origin = auth?.origin ?? new URL(request.url).origin;
  const secure = origin.startsWith('https://');
  if (!auth || !app || !user)
    return redirect(origin, '?github=unauthorized', secure);

  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const installationId = url.searchParams.get('installation_id') ?? '';
  if (
    !state ||
    state !== readCookie(request, GITHUB_APP_STATE_COOKIE) ||
    !/^\d+$/.test(installationId)
  ) {
    return redirect(origin, '?github=invalid-state', secure);
  }
  const projectId = await consumeGitHubConnectionState(state, user.id);
  if (!projectId || (await getProjectRole(projectId, user.id)) !== 'owner')
    return redirect(origin, '?github=invalid-state', secure);

  try {
    const installation = await getGitHubInstallation(app, installationId);
    if (String(installation.id) !== installationId)
      throw new Error('Installation mismatch');
    if (!canUserManageGitHubInstallation(user, installation)) {
      return redirect(
        origin,
        `?github=forbidden-installation&project=${encodeURIComponent(projectId)}`,
        secure,
      );
    }
    const repositories = await listInstallationRepositories(
      app,
      installationId,
    );
    await saveGitHubInstallation(
      projectId,
      user.id,
      installation,
      repositories,
    );
    return redirect(
      origin,
      `?github=connected&project=${encodeURIComponent(projectId)}`,
      secure,
    );
  } catch {
    return redirect(
      origin,
      `?github=failed&project=${encodeURIComponent(projectId)}`,
      secure,
    );
  }
}
