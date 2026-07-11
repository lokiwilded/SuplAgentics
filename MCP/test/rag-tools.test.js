// Basic unit tests for RAG tools - cosine, blobToVec
// Run with: node --test test/rag-tools.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function cosine(a, b) {
  if (a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

describe('cosine', () => {
  it('returns 1 for identical vectors', () => {
    assert.ok(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1) < 1e-6);
  });
  it('returns 0 for orthogonal vectors', () => {
    assert.ok(Math.abs(cosine([1, 0, 0], [0, 1, 0])) < 1e-6);
  });
  it('returns -1 for opposite vectors', () => {
    assert.ok(Math.abs(cosine([1, 0], [-1, 0]) - (-1)) < 1e-6);
  });
  it('returns -1 for mismatched dimensions (guard)', () => {
    assert.equal(cosine([1, 0, 0], [1, 0]), -1);
  });
});

function blobToVec(b) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const copy = Buffer.alloc(buf.length);
  buf.copy(copy);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

describe('blobToVec', () => {
  it('roundtrips a Float32Array through a Buffer', () => {
    const original = new Float32Array([1.0, 2.5, -3.14, 0.0]);
    const blob = Buffer.from(original.buffer, original.byteOffset, original.byteLength);
    const restored = blobToVec(blob);
    assert.deepEqual(Array.from(restored), Array.from(original));
  });
  it('handles sliced buffer with non-4-aligned offset (C-1 fix)', () => {
    const pool = Buffer.alloc(100);
    pool.writeFloatLE(1.5, 0);
    pool.writeFloatLE(2.5, 4);
    const sliced = pool.subarray(3, 12);
    const restored = blobToVec(sliced);
    assert.ok(restored instanceof Float32Array);
  });
  it('handles a standalone buffer', () => {
    const arr = new Float32Array([0.1, 0.2, 0.3]);
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const result = blobToVec(buf);
    assert.ok(Math.abs(result[0] - 0.1) < 0.001);
  });
});
