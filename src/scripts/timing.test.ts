// Run with `npm test` (Node's built-in test runner; Node 24 strips the types).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backwardPath, easeInOut, forwardPath, poseCleared } from './curl.ts';
import { classifyRenderer, refreshFromTimestamps, summarizeFrames } from './perf.ts';

test('Mac GPUs classify as gpu, software rasterisers as flat', () => {
  for (const renderer of [
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
    'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)',
    'ANGLE (Intel, ANGLE Metal Renderer: Intel(R) UHD Graphics 630, Unspecified Version)',
    'ANGLE (ATI Technologies Inc., AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ]) {
    assert.equal(classifyRenderer(renderer), 'gpu', renderer);
  }
  for (const renderer of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ]) {
    assert.equal(classifyRenderer(renderer), 'flat', renderer);
  }
  assert.equal(classifyRenderer(null), 'flat');
});

test('refresh rate is measured, not assumed', () => {
  const at120 = Array.from({ length: 40 }, (_, i) => i * (1000 / 120));
  at120.splice(20, 0, at120[19] + 40); // one late frame does not move the median much
  assert.ok(Math.abs(refreshFromTimestamps(at120.sort((a, b) => a - b)) - 1000 / 120) < 0.5);
  const at60 = Array.from({ length: 40 }, (_, i) => i * (1000 / 60));
  assert.ok(Math.abs(refreshFromTimestamps(at60) - 1000 / 60) < 0.5);
});

const run = (hz: number, ms: number, hitchAt?: number, hitch = 0) => {
  const out: number[] = [];
  let t = 0;
  while (t <= ms) {
    out.push(t);
    t += 1000 / hz + (hitchAt !== undefined && Math.abs(t - hitchAt) < 1000 / hz / 2 ? hitch : 0);
  }
  return out;
};

test('a smooth 120 Hz turn has no slow frames; 60 Hz pacing on a 120 Hz screen is all slow', () => {
  const smooth = summarizeFrames(run(120, 900), 1000 / 120, 0, 900);
  assert.equal(smooth.slow, 0);
  assert.ok(Math.abs(smooth.medianMs - 8.3) < 0.1);
  const halfRate = summarizeFrames(run(60, 900), 1000 / 120, 0, 900);
  assert.equal(halfRate.slow, halfRate.frames);
  assert.ok(halfRate.dropped >= halfRate.frames - 1);
});

test('slow frames are attributed to start, middle, end or after the commit', () => {
  const stats = summarizeFrames(run(120, 1200, 860, 30), 1000 / 120, 0, 900);
  assert.equal(stats.slowByPhase.end, 1);
  const after = summarizeFrames(run(120, 1200, 1000, 30), 1000 / 120, 0, 900);
  assert.equal(after.slowByPhase.after, 1);
  assert.equal(after.slowByPhase.end, 0);
  const start = summarizeFrames(run(120, 1200, 50, 30), 1000 / 120, 0, 900);
  assert.equal(start.slowByPhase.start, 1);
});

test('a key turn clears at the same time at 60 and 120 Hz (time-based easing)', () => {
  const AUTO_MS = 980;
  for (const [width, height] of [[1480, 1391], [1480, 1030], [1280, 1500], [390, 700]]) {
    const clearedAt = (hz: number, path = forwardPath) => {
      for (let now = 0; now <= AUTO_MS + 100; now += 1000 / hz) {
        const t = Math.min(1, now / AUTO_MS);
        if (poseCleared(width, height, path(easeInOut(t), width, height)) || t >= 1) return now;
      }
      return Infinity;
    };
    const a = clearedAt(60);
    const b = clearedAt(120);
    assert.ok(Math.abs(a - b) <= 1000 / 60, `${a} vs ${b}`);
    assert.ok(a < AUTO_MS, `the page leaves before the clock runs out (${width}x${height})`);
    assert.ok(clearedAt(120, backwardPath) < AUTO_MS, `backward turn clears too (${width}x${height})`);
  }
});
