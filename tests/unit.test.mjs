/**
 * Unit tests for src/geometry.js — pure logic, no DOM, no OpenCV.
 * Run: node --test tests/unit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blurKernelSize,
  clampRect,
  padRect,
  meanAbsDiffInRect,
  meanAbsDiffOutsideRects,
} from '../src/geometry.js';

test('blurKernelSize: odd, at least 3, grows with face width and strength', () => {
  assert.equal(blurKernelSize(200, 0.6) % 2, 1);
  assert.ok(blurKernelSize(200, 0.6) >= 3);
  assert.ok(blurKernelSize(200, 1) > blurKernelSize(200, 0));
  assert.ok(blurKernelSize(400, 0.6) > blurKernelSize(100, 0.6));
  // Tiny face at zero strength still gets the minimum kernel.
  assert.equal(blurKernelSize(10, 0), 3);
  // Strength is clamped to [0, 1].
  assert.equal(blurKernelSize(200, 2), blurKernelSize(200, 1));
  assert.equal(blurKernelSize(200, -1), blurKernelSize(200, 0));
  // Hand-computed: 200 * (0.05 + 0.4*0.6) = 58 -> even -> 59.
  assert.equal(blurKernelSize(200, 0.6), 59);
});

test('clampRect: rectangle already inside is unchanged; outside is clipped', () => {
  assert.deepEqual(clampRect({ x: 10, y: 10, width: 50, height: 50 }, 512, 512),
    { x: 10, y: 10, width: 50, height: 50 });
  assert.deepEqual(clampRect({ x: -20, y: -10, width: 100, height: 100 }, 512, 512),
    { x: 0, y: 0, width: 80, height: 90 });
  assert.deepEqual(clampRect({ x: 500, y: 500, width: 100, height: 100 }, 512, 512),
    { x: 500, y: 500, width: 12, height: 12 });
});

test('padRect: expands by the padding fraction and clamps at the edges', () => {
  // 100x100 face at (100,100), 10% padding -> 10 px each side.
  assert.deepEqual(padRect({ x: 100, y: 100, width: 100, height: 100 }, 0.1, 512, 512),
    { x: 90, y: 90, width: 120, height: 120 });
  // Face in the corner: padding is cut off by the image edge.
  assert.deepEqual(padRect({ x: 0, y: 0, width: 100, height: 100 }, 0.1, 512, 512),
    { x: 0, y: 0, width: 110, height: 110 });
  // Zero padding leaves the rectangle unchanged.
  assert.deepEqual(padRect({ x: 100, y: 100, width: 100, height: 100 }, 0, 512, 512),
    { x: 100, y: 100, width: 100, height: 100 });
});

test('meanAbsDiffInRect: identical images give 0; known shift gives exact value', () => {
  // 2x2 RGBA image, all channels 10; second image has R=20 in one pixel.
  const a = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255,
                                   10, 10, 10, 255, 10, 10, 10, 255]);
  const b = new Uint8ClampedArray([20, 10, 10, 255, 10, 10, 10, 255,
                                   10, 10, 10, 255, 10, 10, 10, 255]);
  assert.equal(meanAbsDiffInRect(a, a, 2, { x: 0, y: 0, width: 2, height: 2 }), 0);
  // One channel differs by 10 out of 12 channel values: 10/12.
  assert.equal(meanAbsDiffInRect(a, b, 2, { x: 0, y: 0, width: 2, height: 2 }), 10 / 12);
  // Restricting the rect to the unchanged pixel gives 0.
  assert.equal(meanAbsDiffInRect(a, b, 2, { x: 1, y: 0, width: 1, height: 1 }), 0);
});

test('meanAbsDiffOutsideRects: ignores the rect, measures the rest', () => {
  const a = new Uint8ClampedArray(16).fill(10);
  const b = new Uint8ClampedArray(16).fill(10);
  b[0] = 110; // pixel (0,0) R channel differs by 100 — inside the rect
  const rect = { x: 0, y: 0, width: 1, height: 1 };
  assert.equal(meanAbsDiffOutsideRects(a, b, 2, 2, [rect]), 0);
  assert.ok(meanAbsDiffOutsideRects(a, b, 2, 2, []) > 0);
});
