import * as THREE from 'three';
import { mulberry32, fbm, valueNoise, hash3 } from './noise.js';

/**
 * JadeVolume – procedural internal volume representation for jade.
 *
 * Hybrid architecture:
 * - Outer shell continues to use the existing deformed mesh.
 * - Internal properties (water, color, cotton, crack) are queried via SDF-style sampling.
 *
 * This class is the foundation of Phase 1 visual upgrade.
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
  }

  /**
   * Sample volume properties at a world/local position.
   * @param {THREE.Vector3} position
   * @returns {{ density: number, water: number, color: number, cotton: number, crack: number }}
   */
  sample(position) {
    const x = position.x;
    const y = position.y;
    const z = position.z;
    const seed = this.seed;
    const p = this.profile;

    // --- Base density (inside the approximate rock shape) ---
    // We use a soft sphere deformed by low-frequency noise to roughly match the shell.
    const r = Math.sqrt(x * x + y * y + z * z);
    const n = fbm(x * 0.9, y * 0.9, z * 0.9, seed + 11, 4);
    const surface = 1.75 + n * 0.55;
    const density = THREE.MathUtils.smoothstep(surface + 0.18, surface - 0.25, r);

    if (density < 0.01) {
      return { density: 0, water: 0, color: 0, cotton: 0, crack: 0 };
    }

    // --- Water (种水) – higher near center, modulated by noise ---
    const radial = 1 - THREE.MathUtils.clamp(r / 2.1, 0, 1);
    const waterNoise = fbm(x * 1.4, y * 1.4, z * 1.4, seed + 41, 4);
    let water = p.water * (0.55 + radial * 0.45) * (0.7 + waterNoise * 0.55);
    water = THREE.MathUtils.clamp(water, 0, 1);

    // --- Color – concentrated around color roots ---
    let color = p.color * 0.25; // base tint
    for (const root of this.colorRoots) {
      const d = position.distanceTo(root.center);
      const influence = Math.exp(-(d * d) / (root.radius * root.radius)) * root.strength;
      color += influence * p.color;
    }
    const colorNoise = fbm(x * 2.1, y * 2.1, z * 2.1, seed + 77, 3);
    color = THREE.MathUtils.clamp(color * (0.75 + colorNoise * 0.4), 0, 1);

    // --- Cotton (棉) – mid/high frequency ---
    const cottonNoise = fbm(x * 3.8, y * 3.8, z * 3.8, seed + 103, 4);
    let cotton = p.cotton * (0.35 + cottonNoise * 0.9);
    cotton = THREE.MathUtils.clamp(cotton, 0, 1);

    // --- Crack – distance to nearest crack segment ---
    let crack = 0;
    for (const c of this.cracks) {
      const toPoint = position.clone().sub(c.origin);
      const t = THREE.MathUtils.clamp(toPoint.dot(c.dir), 0, c.length);
      const closest = c.origin.clone().addScaledVector(c.dir, t);
      const dist = position.distanceTo(closest);
      const influence = Math.exp(-(dist * dist) / (c.width * c.width * 4));
      crack = Math.max(crack, influence);
    }
    crack *= p.crack; // scale by overall crack risk
    crack = THREE.MathUtils.clamp(crack, 0, 1);

    return { density, water, color, cotton, crack };
  }

  /**
   * Generate a cut-face texture by sampling the volume on a plane.
   * @param {THREE.Vector3} normal
   * @param {THREE.Vector3} center
   * @param {number} [size=512]
   * @param {number} [extent=2.4]  world-space half-size of the sampling square
   * @returns {THREE.CanvasTexture}
   */
  generateCutTexture(normal, center, size = 512, extent = 2.4) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);

    // Build orthonormal basis on the cut plane
    const n = normal.clone().normalize();
    let up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(up, n).normalize();
    const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();

    const pos = new THREE.Vector3();

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const u = (i / (size - 1) - 0.5) * 2 * extent;
        const v = (j / (size - 1) - 0.5) * 2 * extent;

        pos.copy(center)
          .addScaledVector(tangent, u)
          .addScaledVector(bitangent, v);

        const s = this.sample(pos);
        const idx = (j * size + i) * 4;

        if (s.density < 0.05) {
          // Outside – transparent / dark
          img.data[idx] = 8;
          img.data[idx + 1] = 14;
          img.data[idx + 2] = 12;
          img.data[idx + 3] = 0;
          continue;
        }

        // Base jade color driven by water + color
        const hue = 145 + s.color * 28;
        const sat = 55 + s.color * 30;
        const light = 14 + s.water * 38 - s.cotton * 12;

        // Simple HSL → RGB (lightweight)
        const rgb = hslToRgb(hue / 360, sat / 100, light / 100);

        // Darken by crack
        const crackDark = 1 - s.crack * 0.72;
        img.data[idx] = Math.round(rgb.r * 255 * crackDark);
        img.data[idx + 1] = Math.round(rgb.g * 255 * crackDark);
        img.data[idx + 2] = Math.round(rgb.b * 255 * crackDark);
        img.data[idx + 3] = Math.round(220 + s.water * 35);

        // Add subtle cotton veil
        if (s.cotton > 0.35) {
          const veil = (s.cotton - 0.35) * 0.45;
          img.data[idx] = Math.min(255, img.data[idx] + veil * 40);
          img.data[idx + 1] = Math.min(255, img.data[idx + 1] + veil * 55);
          img.data[idx + 2] = Math.min(255, img.data[idx + 2] + veil * 35);
        }
      }
    }

    ctx.putImageData(img, 0, 0);

    // Optional: draw soft crack lines for extra clarity
    this._drawCrackLines(ctx, size, extent, tangent, bitangent, center, n);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  /** @private */
  _drawCrackLines(ctx, size, extent, tangent, bitangent, center, normal) {
    ctx.globalCompositeOperation = 'source-over';
    for (const c of this.cracks) {
      // Project crack segment onto the cut plane (approximate)
      const mid = c.origin.clone().addScaledVector(c.dir, c.length * 0.5);
      const toMid = mid.clone().sub(center);
      const distToPlane = toMid.dot(normal);
      if (Math.abs(distToPlane) > 0.35) continue; // far from this cut

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
}

/** Minimal HSL → RGB helper */
function hslToRgb(h, s, l) {
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
  return { r, g, b };
}
