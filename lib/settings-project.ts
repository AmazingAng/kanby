export function resolveSettingsProject<T extends { id: string }>(
  projects: T[],
  search: string,
): T | null {
  const requestedId = new URLSearchParams(search).get('project');
  return (
    projects.find((project) => project.id === requestedId) ??
    projects[0] ??
    null
  );
}

export function settingsProjectPath(
  currentHref: string,
  projectId: string,
): string {
  const url = new URL(currentHref);
  url.searchParams.set('project', projectId);
  return `${url.pathname}${url.search}${url.hash}`;
}
