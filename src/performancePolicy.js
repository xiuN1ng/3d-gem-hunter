export function detectMobileQuality({
  coarsePointer = false,
  width = Number.POSITIVE_INFINITY,
  height = Number.POSITIVE_INFINITY,
  deviceMemory = 8
} = {}) {
  return coarsePointer || Math.min(width, height) < 760 || deviceMemory <= 4;
}

export function createRenderProfile(mobile) {
  return mobile
    ? {
        pixelRatio: 1,
        cutTextureSize: 256,
        rockTextureSize: 128,
        rockGeometryDetail: 4,
        studioSegments: 48,
        particleCount: 160,
        transmissionScale: .5,
        transmissionFactor: .45,
        targetFps: 60
      }
    : {
        pixelRatio: 1.5,
        cutTextureSize: 384,
        rockTextureSize: 256,
        rockGeometryDetail: 5,
        studioSegments: 72,
        particleCount: 360,
        transmissionScale: .75,
        transmissionFactor: 1,
        targetFps: 60
      };
}

export function timelineProgress(time, startedAt, durationMs) {
  if (durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, (time - startedAt) / durationMs));
}

export class AdaptiveFrameBudget {
  constructor({ targetFps = 60, fallbackFps = 30, slowFrameMs = 22, slowFrameLimit = 45 } = {}) {
    this.targetFps = targetFps;
    this.fallbackFps = fallbackFps;
    this.slowFrameMs = slowFrameMs;
    this.slowFrameLimit = slowFrameLimit;
    this.slowFrames = 0;
  }

  shouldRender(time, lastRenderedAt) {
    return time - lastRenderedAt >= 1000 / this.targetFps - 1;
  }

  observe(frameMs) {
    if (this.targetFps === this.fallbackFps) return this.targetFps;
    this.slowFrames = frameMs > this.slowFrameMs
      ? this.slowFrames + 1
      : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > this.slowFrameLimit) this.targetFps = this.fallbackFps;
    return this.targetFps;
  }
}
