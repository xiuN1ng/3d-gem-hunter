import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePerformance, summarizeFrameTimes } from '../src/performanceDiagnostics.js';

test('frame summary reports average FPS and a stable P95', () => {
  const summary = summarizeFrameTimes([16, 17, 16, 18, 40]);
  assert.ok(summary.averageFps > 40 && summary.averageFps < 50);
  assert.equal(summary.p95FrameMs, 40);
});

test('performance evaluation reports every exceeded budget', () => {
  const result = evaluatePerformance({
    averageFps: 25,
    p95FrameMs: 70,
    prepareMs: 3000,
    cutMs: 9000,
    maxLongTaskMs: 1200,
    geometries: 30,
    textures: 15,
    contextLost: true,
    completed: false
  });
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 9);
});
