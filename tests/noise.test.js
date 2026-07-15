import test from 'node:test';
import assert from 'node:assert/strict';
import { cellularNoise, domainWarp3, gradientNoise, ridgedFbm } from '../src/volume/noise.js';

test('gradient noise is deterministic and spatially continuous', () => {
  const a = gradientNoise(.27, 1.14, -.82, 713);
  const b = gradientNoise(.2701, 1.1401, -.8199, 713);
  assert.equal(a, gradientNoise(.27, 1.14, -.82, 713));
  assert.ok(Math.abs(a - b) < .01);
});

test('warped, ridged, and cellular fields remain finite and normalized', () => {
  const warp = domainWarp3(.3, -.7, 1.2, 91);
  for (const value of [warp.x, warp.y, warp.z]) assert.ok(Number.isFinite(value));
  const fields = [ridgedFbm(warp.x, warp.y, warp.z, 91), cellularNoise(warp.x, warp.y, warp.z, 91)];
  for (const value of fields) assert.ok(value >= 0 && value <= 1);
});
