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

function redirect(
  publicBaseUrl: string,
  suffix: string,
  secure: boolean,
  cookiePath?: string,
) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${publicBaseUrl}/settings${suffix}`,
      'Set-Cookie': clearCookieHeader(
        GITHUB_APP_STATE_COOKIE,
        secure,
        cookiePath,
      ),
    },
  });
}

export async function GET(request: Request) {
  const auth = getAuthConfig();
  const app = getGitHubAppConfig();
  const user = await getSessionUser(request);
  const publicBaseUrl = auth?.publicBaseUrl ?? new URL(request.url).origin;
  const secure = publicBaseUrl.startsWith('https://');
  const cookiePath = auth?.basePath;
  if (!auth || !app || !user)
    return redirect(publicBaseUrl, '?github=unauthorized', secure, cookiePath);

  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const installationId = url.searchParams.get('installation_id') ?? '';
  if (
    !state ||
    state !== readCookie(request, GITHUB_APP_STATE_COOKIE) ||
    !/^\d+$/.test(installationId)
  ) {
    return redirect(publicBaseUrl, '?github=invalid-state', secure, cookiePath);
  }
  const projectId = await consumeGitHubConnectionState(state, user.id);
  if (!projectId || (await getProjectRole(projectId, user.id)) !== 'owner')
    return redirect(publicBaseUrl, '?github=invalid-state', secure, cookiePath);

  try {
    const installation = await getGitHubInstallation(app, installationId);
    if (String(installation.id) !== installationId)
      throw new Error('Installation mismatch');
    if (!canUserManageGitHubInstallation(user, installation)) {
      return redirect(
        publicBaseUrl,
        `?github=forbidden-installation&project=${encodeURIComponent(projectId)}`,
        secure,
        cookiePath,
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
      publicBaseUrl,
      `?github=connected&project=${encodeURIComponent(projectId)}`,
      secure,
      cookiePath,
    );
  } catch {
    return redirect(
      publicBaseUrl,
      `?github=failed&project=${encodeURIComponent(projectId)}`,
      secure,
      cookiePath,
    );
  }
}
