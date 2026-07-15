import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveFrameBudget, createRenderProfile, detectMobileQuality, timelineProgress } from '../src/performancePolicy.js';

test('quality detection includes viewport, pointer and memory pressure', () => {
  assert.equal(detectMobileQuality({ width: 1200, height: 800, deviceMemory: 8 }), false);
  assert.equal(detectMobileQuality({ width: 390, height: 844, deviceMemory: 8 }), true);
  assert.equal(detectMobileQuality({ width: 1200, height: 800, deviceMemory: 4 }), true);
  assert.equal(detectMobileQuality({ width: 1200, height: 800, deviceMemory: 8, coarsePointer: true }), true);
});

test('mobile profile lowers geometry, texture and effect budgets', () => {
  const mobile = createRenderProfile(true);
  const desktop = createRenderProfile(false);
  assert.ok(mobile.rockGeometryDetail < desktop.rockGeometryDetail);
  assert.ok(mobile.rockTextureSize < desktop.rockTextureSize);
  assert.ok(mobile.particleCount < desktop.particleCount);
  assert.ok(mobile.transmissionFactor < desktop.transmissionFactor);
});

test('adaptive frame budget degrades only after sustained slow frames', () => {
  const budget = new AdaptiveFrameBudget({ slowFrameLimit: 3 });
  budget.observe(24);
  budget.observe(24);
  budget.observe(16);
  assert.equal(budget.targetFps, 60);
  for (let i = 0; i < 5; i++) budget.observe(24);
  assert.equal(budget.targetFps, 30);
  assert.equal(budget.shouldRender(20, 0), false);
  assert.equal(budget.shouldRender(34, 0), true);
});

test('cut timeline progress is independent from rendered frame count', () => {
  assert.equal(timelineProgress(1000, 1000, 3700), 0);
  assert.equal(timelineProgress(2850, 1000, 3700), .5);
  assert.equal(timelineProgress(8000, 1000, 3700), 1);
});
