import { describe, it, expect } from 'vitest';
import { KEYMAP, resolveAction, isEditableTarget } from './keymap.ts';

describe('@bessel/ui keymap', () => {
  it('binds the required keys uniquely', () => {
    const keys = KEYMAP.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'c', '?']));
  });
  it('resolves keys to actions and unbound keys to null', () => {
    expect(resolveAction(' ')).toEqual({ type: 'playToggle' });
    expect(resolveAction('ArrowRight')).toEqual({ type: 'scrub', direction: 1 });
    expect(resolveAction('z')).toBeNull();
  });
  it('treats non-element targets as non-editable without throwing', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});
