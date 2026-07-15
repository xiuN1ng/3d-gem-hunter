import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CI_SOFTWARE_WEBGL_BUDGETS,
  MOBILE_PERFORMANCE_BUDGETS,
  evaluatePerformance,
  summarizeFrameTimes
} from '../src/performanceDiagnostics.js';

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

test('software WebGL CI baseline does not weaken the real mobile budget', () => {
  assert.equal(MOBILE_PERFORMANCE_BUDGETS.minAverageFps, 30);
  assert.equal(CI_SOFTWARE_WEBGL_BUDGETS.minAverageFps, 0);
  const result = evaluatePerformance({
    averageFps: 3.9,
    p95FrameMs: 850,
    prepareMs: 800,
    cutMs: 5000,
    maxLongTaskMs: 2600,
    geometries: 16,
    textures: 4,
    contextLost: false,
    completed: true
  }, CI_SOFTWARE_WEBGL_BUDGETS);
  assert.equal(result.passed, true);
});
