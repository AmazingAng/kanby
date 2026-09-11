export function mergePolledTasks<T extends { id: string }>(
  current: T[],
  incoming: T[],
  editingTaskId: string | null,
): T[] {
  if (!editingTaskId) return incoming;
  const local = current.find((item) => item.id === editingTaskId);
  if (!local) return incoming;
  const merged = incoming.map((item) =>
    item.id === editingTaskId ? local : item,
  );
  return merged.some((item) => item.id === editingTaskId)
    ? merged
    : [local, ...merged];
}

export function shouldCloseTaskEditor(input: {
  saveSucceeded: boolean;
  savedTaskId: string;
  savedFingerprint: string;
  currentTaskId: string | null;
  currentFingerprint: string | null;
}) {
  return (
    input.saveSucceeded &&
    input.currentTaskId === input.savedTaskId &&
    input.currentFingerprint === input.savedFingerprint
  );
}
