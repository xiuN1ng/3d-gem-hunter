import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRockShape, makeStoneProfile } from '../src/game/stoneProfile.js';

test('rock silhouettes are deterministic and materially varied across supplier seeds', () => {
  const seeds = [713, 10720, 18639, 26558, 34477, 42396];
  const first = seeds.map((seed) => makeRockShape(seed));
  const second = seeds.map((seed) => makeRockShape(seed));
  assert.deepEqual(first, second);
  assert.ok(Math.max(...first.map((shape) => shape.size)) - Math.min(...first.map((shape) => shape.size)) > .2);
  assert.ok(new Set(first.map((shape) => shape.shapeName)).size >= 3);
  assert.ok(Math.max(...first.map((shape) => shape.aspect)) - Math.min(...first.map((shape) => shape.aspect)) > .08);
});

test('stone weight carries the generated silhouette volume', () => {
  const profiles = [713, 10720, 18639, 26558].map(makeStoneProfile);
  const volumes = profiles.map((profile) => makeRockShape(profile.seed).volumeScale);
  const weights = profiles.map((profile) => profile.weight);
  const volumeOrder = [...volumes].sort((a, b) => a - b);
  const weightOrder = [...weights].sort((a, b) => a - b);
  assert.ok(volumeOrder[0] < volumeOrder.at(-1));
  assert.ok(weightOrder[0] < weightOrder.at(-1));
});
