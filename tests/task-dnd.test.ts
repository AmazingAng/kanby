import { describe, expect, it } from 'vitest';

import {
  columnAtPoint,
  keyboardInsertAfter,
  projectTaskDrop,
  shouldInsertAfter,
  type PositionedTask,
} from '@/lib/task-dnd';

function task(
  id: string,
  status: PositionedTask['status'],
  position: number,
): PositionedTask & { title: string } {
  return { id, status, position, title: id.toUpperCase() };
}

function ids(tasks: PositionedTask[], status: PositionedTask['status']) {
  return tasks
    .filter((item) => item.status === status)
    .sort((a, b) => a.position - b.position)
    .map((item) => item.id);
}

describe('task drag projection', () => {
  const tasks = [
    task('a', 'ideas', 0),
    task('b', 'ideas', 1),
    task('c', 'ideas', 2),
    task('d', 'building', 0),
    task('e', 'building', 1),
  ];

  it('uses the hovered card half for same-column ordering', () => {
    expect(ids(projectTaskDrop(tasks, 'a', 'b', false), 'ideas')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(ids(projectTaskDrop(tasks, 'a', 'b', true), 'ideas')).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(ids(projectTaskDrop(tasks, 'c', 'b', false), 'ideas')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('moves a card to the end when dropped on its column', () => {
    expect(ids(projectTaskDrop(tasks, 'a', 'ideas'), 'ideas')).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('projects cross-column drops without losing task data', () => {
    const before = projectTaskDrop(tasks, 'a', 'e', false);
    expect(ids(before, 'ideas')).toEqual(['b', 'c']);
    expect(ids(before, 'building')).toEqual(['d', 'a', 'e']);
    expect(
      (before as Array<PositionedTask & { title: string }>).find(
        (item) => item.id === 'a',
      )?.title,
    ).toBe('A');

    const after = projectTaskDrop(tasks, 'a', 'e', true);
    expect(ids(after, 'building')).toEqual(['d', 'e', 'a']);
  });

  it('compares card centers rather than their top edges', () => {
    const over = { top: 200, height: 100 };
    expect(shouldInsertAfter({ top: 180, height: 160 }, over)).toBe(true);
    expect(shouldInsertAfter({ top: 140, height: 160 }, over)).toBe(false);
    expect(shouldInsertAfter(null, over)).toBe(false);
  });

  it('preserves keyboard direction when card centers align', () => {
    expect(keyboardInsertAfter(tasks, 'a', 'b')).toBe(true);
    expect(keyboardInsertAfter(tasks, 'c', 'b')).toBe(false);
    expect(keyboardInsertAfter(tasks, 'a', 'd')).toBeNull();
  });

  it('selects the pointer column instead of a nearer card in another column', () => {
    const columns = [
      {
        id: 'ideas',
        rect: { left: 0, right: 299, top: 0, bottom: 600 },
      },
      {
        id: 'building',
        rect: { left: 300, right: 599, top: 0, bottom: 600 },
      },
      {
        id: 'shipped',
        rect: { left: 600, right: 899, top: 0, bottom: 600 },
      },
    ];

    expect(columnAtPoint(columns, { x: 740, y: 220 })).toBe('shipped');
    expect(columnAtPoint(columns, { x: 450, y: 220 })).toBe('building');
    expect(columnAtPoint(columns, { x: 940, y: 220 })).toBeNull();
  });
});
