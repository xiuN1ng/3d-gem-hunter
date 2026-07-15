import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JadeVolume } from '../src/volume/JadeVolume.js';

const profile = { seed: 713, water: .68, color: .57, cotton: .31, crack: .42 };

test('sample can reuse a caller-owned result object', () => {
  const volume = new JadeVolume(profile);
  const target = { density: 0, water: 0, color: 0, cotton: 0, crack: 0 };
  const result = volume.sample(new THREE.Vector3(.2, -.1, .35), true, target);
  assert.equal(result, target);
  assert.ok(result.density > 0);
});

test('worker-safe cut generation returns a packed RGBA buffer', () => {
  const volume = new JadeVolume(profile);
  const size = 64;
  const generated = volume.generateCutTextureData(
    new THREE.Vector3(.2, -.1, .97).normalize(),
    new THREE.Vector3(.05, 0, .2),
    size,
    2.4,
    { fast: true }
  );
  assert.equal(generated.data.length, size * size * 4);
  assert.ok(generated.data.some((value) => value > 0));
  assert.ok(Math.abs(generated.normal.length() - 1) < 1e-10);
});
