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
