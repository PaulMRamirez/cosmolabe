// safeKernelPathSegment reduces a kernel name (a URL tail or plugin-manifest value)
// to a single OPFS path segment, so '../evil' cannot escape the /kernels directory
// when the bytes are persisted.

import { describe, it, expect } from 'vitest';
import { safeKernelPathSegment } from './engine.ts';

describe('safeKernelPathSegment', () => {
  it('keeps a plain kernel filename unchanged', () => {
    expect(safeKernelPathSegment('cassini.bsp')).toBe('cassini.bsp');
    expect(safeKernelPathSegment('naif0012.tls')).toBe('naif0012.tls');
  });

  it('strips any directory portion so a traversal name cannot escape', () => {
    const seg = safeKernelPathSegment('../evil');
    expect(seg).not.toContain('/');
    expect(seg).not.toContain('..');
    expect(`/kernels/${seg}`.startsWith('/kernels/')).toBe(true);
    expect(`/kernels/${seg}`).not.toContain('/kernels/../');
    // The final component of '../evil' is 'evil'.
    expect(seg).toBe('evil');
  });

  it('handles deep and backslash traversal, keeping only the final component', () => {
    expect(safeKernelPathSegment('../../etc/passwd')).toBe('passwd');
    expect(safeKernelPathSegment('..\\..\\windows\\evil.bsp')).toBe('evil.bsp');
  });

  it('replaces unsafe characters in the final component', () => {
    const seg = safeKernelPathSegment('we ird:name?.bsp');
    expect(seg).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('hashes a name that reduces to nothing usable to a stable fallback', () => {
    const a = safeKernelPathSegment('..');
    const b = safeKernelPathSegment('../');
    expect(a).toMatch(/^kernel-[0-9a-f]+$/);
    expect(b).toMatch(/^kernel-[0-9a-f]+$/);
    expect(a).not.toContain('.');
    // Deterministic for a given input.
    expect(safeKernelPathSegment('..')).toBe(a);
  });
});
