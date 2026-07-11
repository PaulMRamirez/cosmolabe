// The manifest primitives: sha256Hex is a deterministic 64-hex-char digest and matches a
// known NIST vector; canonicalJson sorts object keys at every depth so the same logical
// value always serializes to identical bytes regardless of insertion order.
// (STK_PARITY_SPEC, SDK.)

import { describe, it, expect } from 'vitest';
import { canonicalJson, sha256Hex } from './manifest.ts';

describe('manifest sha256Hex', () => {
  it('hashes the empty input to the known SHA-256 vector', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc" to the known SHA-256 vector', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable across calls', async () => {
    const bytes = new TextEncoder().encode('the quick brown fox');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes));
  });
});

describe('manifest canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2], 0)).toBe('[3,1,2]\n');
  });
});
