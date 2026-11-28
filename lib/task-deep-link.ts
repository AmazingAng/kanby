/** Local board destination used by the GitHub sign-in link. */
export function taskLoginReturnTo(
  projectSlug: string | undefined,
  reference: string | null,
) {
  const board = projectSlug ? `/${encodeURIComponent(projectSlug)}/board` : '/';
  return reference
    ? `${board}?${new URLSearchParams({ task: reference })}`
    : board;
}
