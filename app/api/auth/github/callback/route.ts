import {
  clearCookieHeader,
  cookieHeader,
  createSessionToken,
  getAuthConfig,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  readCookie,
  safeReturnTo,
  SESSION_COOKIE,
  type AuthUser,
} from '@/lib/auth';
import {
  hasActiveProjectMembership,
  hasPendingProjectInvitation,
  registerUserAndAcceptInvitations,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

type GitHubUser = {
  id?: number;
  login?: string;
  name?: string | null;
  avatar_url?: string | null;
};
type GitHubEmail = { email?: string; verified?: boolean };
type GitHubOrganizationMembership = {
  state?: string;
  role?: string;
  organization?: { id?: number; login?: string };
};
type GitHubTeam = { slug?: string; organization?: { login?: string } };

const githubHeaders = (accessToken: string) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${accessToken}`,
  'User-Agent': 'kanby-app',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function githubList<T>(path: string, accessToken: string): Promise<T[]> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(accessToken),
    redirect: 'manual',
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload) ? (payload as T[]) : [];
}

async function githubUserAccess(
  profile: GitHubUser,
  accessToken: string,
  config: NonNullable<ReturnType<typeof getAuthConfig>>,
): Promise<{
  allowed: boolean;
  verifiedEmails: string[];
  githubAdminAccountIds: string[];
}> {
  const username = profile.login?.toLowerCase();
  if (!username || !profile.id)
    return { allowed: false, verifiedEmails: [], githubAdminAccountIds: [] };

  const hasRules =
    config.allowedIdentities.size > 0 ||
    config.allowedOrganizations.size > 0 ||
    config.allowedTeams.size > 0;
  const allowedEmails = new Set(
    [...config.allowedIdentities].filter((identity) => identity.includes('@')),
  );
  const [emails, memberships, teams, existingMember] = await Promise.all([
    githubList<GitHubEmail>('/user/emails?per_page=100', accessToken),
    githubList<GitHubOrganizationMembership>(
      '/user/memberships/orgs?state=active&per_page=100',
      accessToken,
    ),
    config.allowedTeams.size > 0
      ? githubList<GitHubTeam>('/user/teams?per_page=100', accessToken)
      : Promise.resolve([]),
    hasActiveProjectMembership(String(profile.id)),
  ]);
  const verifiedEmails = emails
    .filter((entry) => entry.verified && entry.email)
    .map((entry) => entry.email!.toLowerCase());

  const matchesEmail = verifiedEmails.some((email) => allowedEmails.has(email));
  const matchesOrganization = memberships.some((membership) => {
    const organization = membership.organization?.login?.toLowerCase();
    return (
      membership.state === 'active' &&
      Boolean(organization && config.allowedOrganizations.has(organization))
    );
  });
  const matchesTeam = teams.some((team) => {
    const organization = team.organization?.login?.toLowerCase();
    const slug = team.slug?.toLowerCase();
    return Boolean(
      organization &&
      slug &&
      config.allowedTeams.has(`${organization}/${slug}`),
    );
  });
  const invited = await hasPendingProjectInvitation(username, verifiedEmails);
  const githubAdminAccountIds = [
    String(profile.id),
    ...memberships
      .filter(
        (membership) =>
          membership.state === 'active' &&
          membership.role === 'admin' &&
          membership.organization?.id,
      )
      .map((membership) => String(membership.organization!.id)),
  ];
  return {
    allowed:
      !hasRules ||
      config.allowedIdentities.has(username) ||
      matchesEmail ||
      matchesOrganization ||
      matchesTeam ||
      existingMember ||
      invited,
    verifiedEmails,
    githubAdminAccountIds,
  };
}

export async function GET(request: Request) {
  const config = getAuthConfig();
  if (!config) return new Response('GitHub 登录尚未配置。', { status: 503 });
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const verifier = readCookie(request, OAUTH_VERIFIER_COOKIE);
  const requestedReturnTo = readCookie(request, OAUTH_RETURN_TO_COOKIE) ?? '/';
  const returnTo = safeReturnTo(requestedReturnTo);
  if (
    !code ||
    !state ||
    !expectedState ||
    !verifier ||
    state !== expectedState
  ) {
    return new Response('登录校验失败，请返回重试。', { status: 400 });
  }

  const tokenResponse = await fetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: `${config.origin}/api/auth/github/callback`,
        code_verifier: verifier,
      }),
      redirect: 'manual',
    },
  );
  const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return new Response(
      `GitHub 授权失败：${tokenPayload.error ?? 'unknown_error'}`,
      { status: 400 },
    );
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: githubHeaders(tokenPayload.access_token),
    redirect: 'manual',
  });
  const profile = (await profileResponse
    .json()
    .catch(() => ({}))) as GitHubUser;
  if (!profileResponse.ok || !profile.id || !profile.login) {
    return new Response('无法读取 GitHub 用户资料。', { status: 400 });
  }
  const access = await githubUserAccess(
    profile,
    tokenPayload.access_token,
    config,
  );
  if (!access.allowed) {
    return new Response('此 GitHub 账号不在 Kanby 团队名单中。', {
      status: 403,
    });
  }

  const user: AuthUser = {
    id: String(profile.id),
    login: profile.login,
    name: profile.name?.trim() || profile.login,
    avatarUrl: profile.avatar_url || null,
    githubAdminAccountIds: access.githubAdminAccountIds,
  };
  await registerUserAndAcceptInvitations(user, access.verifiedEmails);
  const session = await createSessionToken(user, config.sessionSecret);
  const secure = config.origin.startsWith('https://');
  const headers = new Headers({
    Location: `${config.origin}${returnTo === '/' ? '' : returnTo}`,
    'Cache-Control': 'no-store',
  });
  headers.append(
    'Set-Cookie',
    cookieHeader(SESSION_COOKIE, session, {
      maxAge: 60 * 60 * 24 * 30,
      secure,
    }),
  );
  headers.append('Set-Cookie', clearCookieHeader(OAUTH_STATE_COOKIE, secure));
  headers.append(
    'Set-Cookie',
    clearCookieHeader(OAUTH_VERIFIER_COOKIE, secure),
  );
  headers.append(
    'Set-Cookie',
    clearCookieHeader(OAUTH_RETURN_TO_COOKIE, secure),
  );
  return new Response(null, { status: 302, headers });
}
