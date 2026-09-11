const failingCiStatuses = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
]);

export function isFailingCiStatus(status: string | null | undefined) {
  return failingCiStatuses.has(status?.toLowerCase() ?? '');
}
