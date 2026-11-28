import { describe, expect, it } from 'vitest';

import { trappedFocusTarget } from '@/lib/dialog-focus';

describe('modal focus trap', () => {
  const items = ['a', 'b', 'c'];

  it('wraps Tab from the last element and Shift+Tab from the first', () => {
    expect(trappedFocusTarget(items, 'c', false, 'dialog')).toBe('a');
    expect(trappedFocusTarget(items, 'a', true, 'dialog')).toBe('c');
  });

  it('leaves moves inside the dialog to the browser', () => {
    expect(trappedFocusTarget(items, 'a', false, 'dialog')).toBeNull();
    expect(trappedFocusTarget(items, 'c', true, 'dialog')).toBeNull();
  });

  it('pulls focus back in from the dialog itself or from outside', () => {
    expect(trappedFocusTarget(items, 'dialog', false, 'dialog')).toBe('a');
    expect(trappedFocusTarget(items, 'outside', true, 'dialog')).toBe('c');
    expect(trappedFocusTarget([], 'dialog', false, 'dialog')).toBe('dialog');
  });
});
