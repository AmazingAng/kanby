export type GitHubInstallationAccount = {
  account: { id: number; type: string };
};

export function canUserManageGitHubInstallation(
  user: { id: string; githubAdminAccountIds?: string[] },
  installation: GitHubInstallationAccount,
): boolean {
  const accountId = String(installation.account.id);
  if (installation.account.type.toLowerCase() === 'user') {
    return accountId === user.id;
  }
  return Boolean(user.githubAdminAccountIds?.includes(accountId));
}
