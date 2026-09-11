import { describe, expect, it } from 'vitest';

import {
  parseTaskDueDate,
  serializeTaskDueDate,
  taskDueLabel,
} from '@/lib/task-due';

describe('task due date', () => {
  it('round-trips a local calendar date without a timezone shift', () => {
    const date = parseTaskDueDate('2026-09-12');
    expect(date).toBeDefined();
    expect(serializeTaskDueDate(date!)).toBe('2026-09-12');
    expect(taskDueLabel('2026-09-12')).toBe('2026年9月12日');
  });

  it('rejects impossible or non-calendar values', () => {
    expect(parseTaskDueDate('2026-02-30')).toBeUndefined();
    expect(parseTaskDueDate('周五')).toBeUndefined();
  });

  it('keeps legacy text readable and labels an empty date', () => {
    expect(taskDueLabel('周五')).toBe('周五');
    expect(taskDueLabel('')).toBe('选择截止日期');
  });
});
