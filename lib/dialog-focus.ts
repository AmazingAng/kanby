export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should move focus inside a modal so it never leaves it: wraps
 * from the last element to the first (and back with Shift). Returns null
 * when the browser's default move stays inside, and the dialog itself when
 * nothing inside is focusable.
 */
export function trappedFocusTarget<T>(
  focusable: T[],
  active: T | null,
  shiftKey: boolean,
  dialog: T,
): T | null {
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) return dialog;
  if (active === dialog || !focusable.includes(active as T))
    return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

export type DialogEscapeAction = 'ignore' | 'leave-field' | 'close';

/**
 * What Escape does inside the task editor. A field that handled Escape itself
 * (defaultPrevented) or an open popover keeps it; Escape in a text field only
 * leaves the field (so an unsent comment or a half-typed checklist item is
 * not closed away); otherwise it closes the dialog.
 */
export function dialogEscapeAction(input: {
  defaultPrevented: boolean;
  popoverOpen: boolean;
  inTextField: boolean;
}): DialogEscapeAction {
  if (input.defaultPrevented || input.popoverOpen) return 'ignore';
  return input.inTextField ? 'leave-field' : 'close';
}
