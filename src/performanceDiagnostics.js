export const MOBILE_PERFORMANCE_BUDGETS = Object.freeze({
  minAverageFps: 30,
  maxP95FrameMs: 50,
  maxPrepareMs: 2500,
  maxCutMs: 8500,
  maxLongTaskMs: 1000,
  maxGeometries: 24,
  maxTextures: 12
});

export const CI_SOFTWARE_WEBGL_BUDGETS = Object.freeze({
  ...MOBILE_PERFORMANCE_BUDGETS,
  minAverageFps: 0,
  maxP95FrameMs: Number.POSITIVE_INFINITY,
  maxLongTaskMs: Number.POSITIVE_INFINITY
});

export function summarizeFrameTimes(frameTimes) {
  const samples = frameTimes.filter((value) => Number.isFinite(value) && value > 0);
  if (!samples.length) return { averageFps: 0, p95FrameMs: Number.POSITIVE_INFINITY };
  const averageFrameMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const ordered = [...samples].sort((a, b) => a - b);
  const p95Index = Math.min(ordered.length - 1, Math.ceil(ordered.length * .95) - 1);
  return {
    averageFps: 1000 / averageFrameMs,
    p95FrameMs: ordered[p95Index]
  };
}

export function evaluatePerformance(metrics, budgets = MOBILE_PERFORMANCE_BUDGETS) {
  const failures = [];
  const requireAtLeast = (metricKey, budgetKey, label) => {
    if (metrics[metricKey] < budgets[budgetKey]) {
      failures.push(`${label}: ${metrics[metricKey]} < ${budgets[budgetKey]}`);
    }
  };
  const requireAtMost = (metricKey, budgetKey, label) => {
    if (metrics[metricKey] > budgets[budgetKey]) {
      failures.push(`${label}: ${metrics[metricKey]} > ${budgets[budgetKey]}`);
    }
  };

  requireAtLeast('averageFps', 'minAverageFps', 'average FPS');
  requireAtMost('p95FrameMs', 'maxP95FrameMs', 'P95 frame time');
  requireAtMost('prepareMs', 'maxPrepareMs', 'cut preparation');
  requireAtMost('cutMs', 'maxCutMs', 'full cut');
  requireAtMost('maxLongTaskMs', 'maxLongTaskMs', 'long task');
  requireAtMost('geometries', 'maxGeometries', 'GPU geometries');
  requireAtMost('textures', 'maxTextures', 'GPU textures');
  if (metrics.contextLost) failures.push('WebGL context lost');
  if (!metrics.completed) failures.push('cut flow did not complete');
  return { passed: failures.length === 0, failures };
}
