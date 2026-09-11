export type BoardColumnId = 'ideas' | 'building' | 'shipped';

export type PositionedTask = {
  id: string;
  status: BoardColumnId;
  position: number;
};

export type RectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const columnIds = new Set<BoardColumnId>(['ideas', 'building', 'shipped']);

export function orderedColumnTasks<T extends PositionedTask>(
  tasks: T[],
  status: BoardColumnId,
) {
  return tasks
    .filter((task) => task.status === status)
    .sort((a, b) => a.position - b.position);
}

function applyColumnOrder<T extends PositionedTask>(
  tasks: T[],
  status: BoardColumnId,
  ordered: T[],
) {
  const updates = new Map(
    ordered.map((task, position) => [task.id, { ...task, status, position }]),
  );
  return tasks.map((task) => updates.get(task.id) ?? task);
}

export function projectTaskDrop<T extends PositionedTask>(
  tasks: T[],
  activeId: string,
  overId: string,
  insertAfter = false,
) {
  const activeTask = tasks.find((task) => task.id === activeId);
  if (!activeTask) return tasks;

  const overTask = tasks.find((task) => task.id === overId);
  const targetStatus = columnIds.has(overId as BoardColumnId)
    ? (overId as BoardColumnId)
    : overTask?.status;
  if (!targetStatus || overTask?.id === activeId) return tasks;

  const sourceTasks = orderedColumnTasks(tasks, activeTask.status);
  const nextSource = sourceTasks.filter((task) => task.id !== activeId);
  const targetTasks =
    activeTask.status === targetStatus
      ? nextSource
      : orderedColumnTasks(tasks, targetStatus);
  const overIndex = overTask
    ? targetTasks.findIndex((task) => task.id === overTask.id)
    : -1;
  const targetIndex =
    overIndex < 0
      ? targetTasks.length
      : Math.min(targetTasks.length, overIndex + (insertAfter ? 1 : 0));
  const nextTarget = [...targetTasks];
  nextTarget.splice(targetIndex, 0, { ...activeTask, status: targetStatus });

  if (activeTask.status === targetStatus)
    return applyColumnOrder(tasks, targetStatus, nextTarget);
  return applyColumnOrder(
    applyColumnOrder(tasks, activeTask.status, nextSource),
    targetStatus,
    nextTarget,
  );
}

export function shouldInsertAfter(
  activeRect: { top: number; height: number } | null | undefined,
  overRect: { top: number; height: number },
) {
  if (!activeRect) return false;
  return (
    activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2
  );
}

export function keyboardInsertAfter<T extends PositionedTask>(
  tasks: T[],
  activeId: string,
  overId: string,
): boolean | null {
  const active = tasks.find((task) => task.id === activeId);
  const over = tasks.find((task) => task.id === overId);
  if (!active || !over || active.status !== over.status) return null;
  const ordered = orderedColumnTasks(tasks, active.status);
  return (
    ordered.findIndex((task) => task.id === activeId) <
    ordered.findIndex((task) => task.id === overId)
  );
}

export function columnAtPoint<T extends string>(
  columns: Array<{ id: T; rect: RectLike }>,
  point: { x: number; y: number },
): T | null {
  return (
    columns.find(
      ({ rect }) =>
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom,
    )?.id ?? null
  );
}
