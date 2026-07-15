import * as THREE from 'three';
import { cellularNoise, domainWarp3, fbm, gradientFbm, mulberry32, ridgedFbm } from './noise.js';

/**
 * JadeVolume – procedural internal volume representation for jade.
 *
 * Hybrid architecture:
 * - Outer shell continues to use the existing deformed mesh.
 * - Internal properties (water, color, cotton, crack) are queried via SDF-style sampling.
 *
 * Performance notes (Phase 1.1 hotfix):
 * - sample() reuses vectors and uses fewer octaves
 * - generateCutTexture caches results and supports a fast low-res path
 */
export class JadeVolume {
  /**
   * @param {object} profile  - stone profile from makeStoneProfile()
   * @param {object} [options]
   * @param {number} [options.bounds=2.6]  - sampling bounds (should cover the rock)
   */
  constructor(profile, options = {}) {
    this.profile = profile;
    this.seed = profile.seed;
    this.bounds = options.bounds ?? 2.6;

    // Texture cache: key -> THREE.CanvasTexture
    this._texCache = new Map();
    this._maxCache = 6;

    // Pre-generate a few stable random helpers for this stone
    const rng = mulberry32(this.seed + 9173);

    // Color roots (centers of green concentration)
    this.colorRoots = [];
    const rootCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < rootCount; i++) {
      this.colorRoots.push({
        center: new THREE.Vector3(
          (rng() - 0.5) * 1.8,
          (rng() - 0.5) * 1.6,
          (rng() - 0.5) * 1.8
        ),
        radius: 0.55 + rng() * 0.9,
        strength: 0.45 + rng() * 0.55
      });
    }

    // Crack planes / lines (simple distance-to-segment representation)
    this.cracks = [];
    const crackCount = Math.floor(profile.crack * 5.5);
    for (let i = 0; i < crackCount; i++) {
      const origin = new THREE.Vector3(
        (rng() - 0.5) * 2.2,
        (rng() - 0.5) * 2.0,
        (rng() - 0.5) * 2.2
      );
      const dir = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      this.cracks.push({
        origin,
        dir,
        length: 0.8 + rng() * 1.8,
        width: 0.012 + rng() * 0.035
      });
    }

    // Reusable vectors for sample() hot path
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._sampleResult = { density: 0, water: 0, color: 0, cotton: 0, crack: 0, cloud: 0, vein: 0, mineral: 0, grain: 0 };
    this._rgbResult = { r: 0, g: 0, b: 0 };
    this._warpResult = { x: 0, y: 0, z: 0 };
  }

  /**
   * Sample volume properties at a local position.
   * Optimized: no allocations in the common path.
   * @param {THREE.Vector3} position
   * @param {boolean} [fast=false]  fewer noise octaves for preview
   * @returns {{ density: number, water: number, color: number, cotton: number, crack: number }}
   */
  sample(position, fast = false, target = null) {
    const result = target ?? { density: 0, water: 0, color: 0, cotton: 0, crack: 0, cloud: 0, vein: 0, mineral: 0, grain: 0 };
    const x = position.x;
    const y = position.y;
    const z = position.z;
    const seed = this.seed;
    const p = this.profile;
    const oct = fast ? 2 : 3;

    // --- Base density (soft deformed sphere) ---
    const r = Math.sqrt(x * x + y * y + z * z);
    const n = fbm(x * 0.9, y * 0.9, z * 0.9, seed + 11, oct);
    const surface = 1.75 + n * 0.55;
    const density = 1 - THREE.MathUtils.smoothstep(r, surface - 0.25, surface + 0.18);

    if (density < 0.01) {
      result.density = result.water = result.color = result.cotton = result.crack = 0;
      result.cloud = result.vein = result.mineral = result.grain = 0;
      return result;
    }

    // A shared, continuous 3D warped domain keeps both cut halves registered.
    const warp = domainWarp3(x * .72, y * .72, z * .72, seed + 211, .7, fast ? 1 : 2, this._warpResult);
    const cloud = gradientFbm(warp.x * .78, warp.y * .78, warp.z * .78, seed + 227, fast ? 2 : 3);
    const grain = gradientFbm(warp.x * 5.6, warp.y * 5.6, warp.z * 5.6, seed + 263, 2);
    const ridge = ridgedFbm(warp.x * 1.7, warp.y * 1.2, warp.z * 2.1, seed + 311, fast ? 2 : 3);
    const vein = Math.pow(THREE.MathUtils.clamp((ridge - .58) / .42, 0, 1), 2.4);
    const mineralDistance = cellularNoise(warp.x * 1.35, warp.y * 1.35, warp.z * 1.35, seed + 349);
    const mineral = 1 - THREE.MathUtils.smoothstep(mineralDistance, .18, .72);

    // --- Water ---
    const radial = 1 - THREE.MathUtils.clamp(r / 2.1, 0, 1);
    let water = p.water * (0.55 + radial * 0.45) * (0.72 + cloud * 0.5 + mineral * .09);
    water = THREE.MathUtils.clamp(water, 0, 1);

    // --- Color – concentrated around color roots ---
    let color = p.color * 0.25;
    for (let i = 0; i < this.colorRoots.length; i++) {
      const root = this.colorRoots[i];
      const dx = x - root.center.x;
      const dy = y - root.center.y;
      const dz = z - root.center.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const invR2 = 1 / (root.radius * root.radius);
      const influence = Math.exp(-d2 * invR2) * root.strength;
      color += influence * p.color;
    }
    color = THREE.MathUtils.clamp(color * (0.69 + cloud * .48 + vein * .18), 0, 1);

    // --- Cotton ---
    const cottonNoise = gradientFbm(warp.x * 2.7, warp.y * 2.7, warp.z * 2.7, seed + 383, fast ? 2 : 3);
    let cotton = p.cotton * (.18 + cottonNoise * .72 + vein * .36);
    cotton = THREE.MathUtils.clamp(cotton, 0, 1);

    // --- Crack (no allocations) ---
    let crack = 0;
    const tmp = this._tmp;
    const tmp2 = this._tmp2;
    for (let i = 0; i < this.cracks.length; i++) {
      const c = this.cracks[i];
      tmp.copy(position).sub(c.origin);
      const t = THREE.MathUtils.clamp(tmp.dot(c.dir), 0, c.length);
      tmp2.copy(c.origin).addScaledVector(c.dir, t);
      const dist = position.distanceTo(tmp2);
      const w2 = c.width * c.width * 4;
      const influence = Math.exp(-(dist * dist) / w2);
      if (influence > crack) crack = influence;
    }
    crack = THREE.MathUtils.clamp(crack * p.crack, 0, 1);

    result.density = density;
    result.water = water;
    result.color = color;
    result.cotton = cotton;
    result.crack = crack;
    result.cloud = cloud;
    result.vein = vein;
    result.mineral = mineral;
    result.grain = grain;
    return result;
  }

  /**
   * Generate raw RGBA pixels without touching DOM/canvas APIs. This method is
   * worker-safe and avoids allocating result/color objects for every pixel.
   */
  generateCutTextureData(normal, center, size = 256, extent = 2.4, opts = {}) {
    const fast = opts.fast === true;
    const data = new Uint8Array(size * size * 4);
    const n = normal.clone().normalize();
    const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(up, n).normalize();
    const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();
    const pos = new THREE.Vector3();
    const sample = this._sampleResult;
    const rgb = this._rgbResult;
    const invSize = 1 / (size - 1);

    for (let j = 0; j < size; j++) {
      const v = (j * invSize - 0.5) * 2 * extent;
      for (let i = 0; i < size; i++) {
        const u = (i * invSize - 0.5) * 2 * extent;
        pos.copy(center).addScaledVector(tangent, u).addScaledVector(bitangent, v);
        this.sample(pos, fast, sample);
        const idx = (j * size + i) * 4;

        if (sample.density < 0.05) {
          data[idx] = 8;
          data[idx + 1] = 14;
          data[idx + 2] = 12;
          data[idx + 3] = 0;
          continue;
        }

        const hue = 143 + sample.color * 26 + (sample.cloud - .5) * 7;
        const sat = 48 + sample.color * 34 - sample.cotton * 10;
        const crystalLift = sample.mineral * (3 + sample.water * 7);
        const microGrain = (sample.grain - .5) * 7;
        const veinLift = sample.vein * (sample.cotton * 15 + 4);
        const light = 17 + sample.water * 35 + (sample.cloud - .5) * 12 + crystalLift + microGrain + veinLift - sample.cotton * 8;
        hslToRgb(hue / 360, sat / 100, light / 100, rgb);
        const crackDark = 1 - sample.crack * 0.72;
        data[idx] = Math.round(rgb.r * 255 * crackDark);
        data[idx + 1] = Math.round(rgb.g * 255 * crackDark);
        data[idx + 2] = Math.round(rgb.b * 255 * crackDark);
        data[idx + 3] = 255;

        if (sample.cotton > 0.35) {
          const veil = (sample.cotton - 0.35) * 0.38;
          data[idx] = Math.min(255, data[idx] + veil * 40);
          data[idx + 1] = Math.min(255, data[idx + 1] + veil * 55);
          data[idx + 2] = Math.min(255, data[idx + 2] + veil * 35);
        }
      }
    }

    return { data, tangent, bitangent, normal: n };
  }

  /**
   * Generate a cut-face texture by sampling the volume on a plane.
   * @param {THREE.Vector3} normal
   * @param {THREE.Vector3} center
   * @param {number} [size=512]
   * @param {number} [extent=2.4]
   * @param {object} [opts]
   * @param {boolean} [opts.fast=false]  use fewer octaves (for preview)
   * @returns {THREE.CanvasTexture}
   */
  generateCutTexture(normal, center, size = 512, extent = 2.4, opts = {}) {
    const fast = opts.fast === true;
    const key = [
      size,
      fast ? 1 : 0,
      normal.x.toFixed(3), normal.y.toFixed(3), normal.z.toFixed(3),
      center.x.toFixed(3), center.y.toFixed(3), center.z.toFixed(3)
    ].join('|');

    if (this._texCache.has(key)) {
      return this._texCache.get(key);
    }

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const generated = this.generateCutTextureData(normal, center, size, extent, { fast });
    const img = new ImageData(new Uint8ClampedArray(generated.data.buffer), size, size);

    ctx.putImageData(img, 0, 0);

    // Crack lines only for high-quality final texture
    if (!fast) {
      this._drawCrackLines(ctx, size, extent, generated.tangent, generated.bitangent, center, generated.normal);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // Simple LRU-ish cache
    if (this._texCache.size >= this._maxCache) {
      const firstKey = this._texCache.keys().next().value;
      const old = this._texCache.get(firstKey);
      old?.dispose?.();
      this._texCache.delete(firstKey);
    }
    this._texCache.set(key, texture);

    return texture;
  }

  /** @private */
  _drawCrackLines(ctx, size, extent, tangent, bitangent, center, normal) {
    ctx.globalCompositeOperation = 'source-over';
    for (const c of this.cracks) {
      const mid = c.origin.clone().addScaledVector(c.dir, c.length * 0.5);
      const toMid = mid.clone().sub(center);
      const distToPlane = toMid.dot(normal);
      if (Math.abs(distToPlane) > 0.35) continue;

      const onPlane = mid.clone().addScaledVector(normal, -distToPlane);
      const local = onPlane.clone().sub(center);
      const u = local.dot(tangent);
      const v = local.dot(bitangent);

      const px = ((u / extent) * 0.5 + 0.5) * size;
      const py = ((v / extent) * 0.5 + 0.5) * size;

      if (px < -20 || px > size + 20 || py < -20 || py > size + 20) continue;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(12, 6, 3, ${0.45 + c.width * 8})`;
      ctx.lineWidth = 1.2 + c.width * 40;
      ctx.moveTo(px - 18, py - 9);
      ctx.lineTo(px + 22, py + 14);
      ctx.stroke();
    }
  }

  dispose() {
    for (const tex of this._texCache.values()) {
      tex.dispose?.();
    }
    this._texCache.clear();
  }
}

/** Minimal HSL → RGB helper */
function hslToRgb(h, s, l, target = { r: 0, g: 0, b: 0 }) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  target.r = r;
  target.g = g;
  target.b = b;
  return target;
}
