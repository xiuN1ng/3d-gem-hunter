/**
 * Shared procedural noise utilities for volume generation.
 * Deterministic, seed-based, matching the original main.js implementation.
 */

export function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x, y, z, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 0.137) * 43758.5453123;
  return s - Math.floor(s);
}

const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function hashInt3(x, y, z, seed) {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(z, 0x6c8e9cf5) ^ Math.imul(seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

function gradientDot(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

export function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);

  const h000 = hash3(xi, yi, zi, seed);
  const h100 = hash3(xi + 1, yi, zi, seed);
  const h010 = hash3(xi, yi + 1, zi, seed);
  const h110 = hash3(xi + 1, yi + 1, zi, seed);
  const h001 = hash3(xi, yi, zi + 1, seed);
  const h101 = hash3(xi + 1, yi, zi + 1, seed);
  const h011 = hash3(xi, yi + 1, zi + 1, seed);
  const h111 = hash3(xi + 1, yi + 1, zi + 1, seed);

  const x00 = mix(h000, h100, xf);
  const x10 = mix(h010, h110, xf);
  const x01 = mix(h001, h101, xf);
  const x11 = mix(h011, h111, xf);

  return mix(mix(x00, x10, yf), mix(x01, x11, yf), zf);
}

export function fbm(x, y, z, seed, octaves = 5) {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency, z * frequency, seed + i * 19) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return value;
}

/** Quintic-interpolated 3D gradient noise, normalized to approximately 0..1. */
export function gradientNoise(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = quintic(xf);
  const v = quintic(yf);
  const w = quintic(zf);

  const n000 = gradientDot(hashInt3(xi, yi, zi, seed), xf, yf, zf);
  const n100 = gradientDot(hashInt3(xi + 1, yi, zi, seed), xf - 1, yf, zf);
  const n010 = gradientDot(hashInt3(xi, yi + 1, zi, seed), xf, yf - 1, zf);
  const n110 = gradientDot(hashInt3(xi + 1, yi + 1, zi, seed), xf - 1, yf - 1, zf);
  const n001 = gradientDot(hashInt3(xi, yi, zi + 1, seed), xf, yf, zf - 1);
  const n101 = gradientDot(hashInt3(xi + 1, yi, zi + 1, seed), xf - 1, yf, zf - 1);
  const n011 = gradientDot(hashInt3(xi, yi + 1, zi + 1, seed), xf, yf - 1, zf - 1);
  const n111 = gradientDot(hashInt3(xi + 1, yi + 1, zi + 1, seed), xf - 1, yf - 1, zf - 1);

  const nx00 = mix(n000, n100, u);
  const nx10 = mix(n010, n110, u);
  const nx01 = mix(n001, n101, u);
  const nx11 = mix(n011, n111, u);
  return Math.max(0, Math.min(1, mix(mix(nx00, nx10, v), mix(nx01, nx11, v), w) * 0.5 + 0.5));
}

export function gradientFbm(x, y, z, seed, octaves = 4) {
  let value = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += gradientNoise(x * frequency, y * frequency, z * frequency, seed + i * 101) * amplitude;
    total += amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return value / total;
}

export function ridgedFbm(x, y, z, seed, octaves = 3) {
  let value = 0;
  let amplitude = 0.58;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const ridge = 1 - Math.abs(gradientNoise(x * frequency, y * frequency, z * frequency, seed + i * 131) * 2 - 1);
    value += ridge * ridge * amplitude;
    total += amplitude;
    frequency *= 2.07;
    amplitude *= 0.46;
  }
  return value / total;
}

/** Nearest-feature cellular field. Low values form mineral grain centres. */
export function cellularNoise(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let nearest = 3;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const h = hashInt3(cx, cy, cz, seed);
        const hx = (h & 1023) / 1023;
        const hy = ((h >>> 10) & 1023) / 1023;
        const hz = ((h >>> 20) & 1023) / 1023;
        const px = cx + hx - x;
        const py = cy + hy - y;
        const pz = cz + hz - z;
        nearest = Math.min(nearest, px * px + py * py + pz * pz);
      }
    }
  }
  return Math.min(1, Math.sqrt(nearest) / 1.15);
}

/** Reusable-target domain warp for breaking obvious octave bands. */
export function domainWarp3(x, y, z, seed, strength = 0.72, octaves = 2, target = {}) {
  const qx = gradientFbm(x, y, z, seed + 17, octaves) * 2 - 1;
  const qy = gradientFbm(x + 5.2, y + 1.3, z + 7.1, seed + 53, octaves) * 2 - 1;
  const qz = gradientFbm(x + 8.3, y + 2.8, z + 3.4, seed + 97, octaves) * 2 - 1;
  target.x = x + qx * strength;
  target.y = y + qy * strength;
  target.z = z + qz * strength;
  return target;
}
