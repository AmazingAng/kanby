export type SubtaskShape = {
  id: string;
  status: 'ideas' | 'building' | 'shipped';
  parent?: { id: string };
};

export const STARTER_TASK_NOTE = '刚刚创建，补充一点上下文吧';

export function clearStarterTaskNote(note: string) {
  return note === STARTER_TASK_NOTE ? '' : note;
}

export type TaskHierarchyKind = 'standalone' | 'parent' | 'subtask';

export function taskHierarchyKind(
  task: Pick<SubtaskShape, 'parent'>,
  progress?: { total: number },
): TaskHierarchyKind {
  if (task.parent) return 'subtask';
  return progress && progress.total > 0 ? 'parent' : 'standalone';
}

export function subtaskProgress(tasks: SubtaskShape[], parentId: string) {
  const children = tasks.filter((task) => task.parent?.id === parentId);
  const done = children.filter((task) => task.status === 'shipped').length;
  return {
    done,
    total: children.length,
    percent: children.length ? Math.round((done / children.length) * 100) : 0,
  };
}

export function acceptanceProgress(
  items: Array<{ completed: boolean }> | null | undefined,
) {
  const total = items?.length ?? 0;
  const done = items?.filter((item) => item.completed).length ?? 0;
  return { done, total, complete: total > 0 && done === total };
}

export function groupSameColumnTaskFamilies<
  T extends SubtaskShape & { position: number },
>(tasks: T[], status: SubtaskShape['status']) {
  const inColumn = tasks
    .filter((task) => task.status === status)
    .sort((left, right) => left.position - right.position);
  const taskIds = new Set(inColumn.map((task) => task.id));
  const children = new Map<string, T[]>();
  for (const task of inColumn) {
    if (!task.parent || !taskIds.has(task.parent.id)) continue;
    const siblings = children.get(task.parent.id) ?? [];
    siblings.push(task);
    children.set(task.parent.id, siblings);
  }
  const grouped: T[] = [];
  const emitted = new Set<string>();
  for (const task of inColumn) {
    if (task.parent && taskIds.has(task.parent.id)) continue;
    grouped.push(task);
    emitted.add(task.id);
    for (const child of children.get(task.id) ?? []) {
      grouped.push(child);
      emitted.add(child.id);
    }
  }
  for (const task of inColumn) {
    if (!emitted.has(task.id)) grouped.push(task);
  }
  return grouped;
}
