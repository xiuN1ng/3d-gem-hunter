import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyPlanarCutUVs, computeCutPresentation, intersectGeometryWithPlane, reverseTriangleWinding, setWorldPlaneFromLocal } from '../src/cutGeometry.js';

function pointSegmentDistanceSquared(point, a, b) {
  const edge = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(edge) / edge.lengthSq(), 0, 1);
  return point.distanceToSquared(a.clone().addScaledVector(edge, t));
}

test('cut contour follows actual triangle-plane intersections', () => {
  const geometry = new THREE.IcosahedronGeometry(2, 3);
  const positions = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    const direction = vertex.clone().normalize();
    const radius = 1.8 + Math.sin(direction.x * 7 + direction.y * 5) * .16 + Math.cos(direction.z * 9) * .09;
    positions.setXYZ(i, direction.x * radius * 1.03, direction.y * radius * .91, direction.z * radius * 1.08);
  }

  const normal = new THREE.Vector3(.27, -.16, .95).normalize();
  const center = normal.clone().multiplyScalar(.31);
  const cut = intersectGeometryWithPlane(geometry, normal, center);
  assert.ok(cut);
  assert.ok(cut.points.length > 40);

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
  const edges = [];
  const index = geometry.index;
  const triangleCount = (index ? index.count : positions.count) / 3;
  const read = (triangle, corner) => {
    const i = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
    return new THREE.Vector3().fromBufferAttribute(positions, i);
  };
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const vertices = [read(triangle, 0), read(triangle, 1), read(triangle, 2)];
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge];
      const b = vertices[(edge + 1) % 3];
      if (plane.distanceToPoint(a) * plane.distanceToPoint(b) <= 0) edges.push([a, b]);
    }
  }

  for (const point of cut.points) {
    const reconstructed = new THREE.Vector3(point.x, point.y, 0).applyQuaternion(cut.quaternion).add(center);
    assert.ok(Math.abs(plane.distanceToPoint(reconstructed)) < 1e-6);
    const nearestEdge = edges.reduce((minimum, [a, b]) => Math.min(minimum, pointSegmentDistanceSquared(reconstructed, a, b)), Infinity);
    assert.ok(nearestEdge < 2e-7);
  }
});

test('local clipping plane stays aligned after object rotation and translation', () => {
  const object = new THREE.Group();
  object.position.set(1.4, -.3, 2.1);
  object.rotation.set(.2, 1.17, -.12);
  const localNormal = new THREE.Vector3(.31, -.08, .947).normalize();
  const localPoint = localNormal.clone().multiplyScalar(.42);
  const worldPlane = setWorldPlaneFromLocal(new THREE.Plane(), localNormal, localPoint, object);
  const worldPoint = object.localToWorld(localPoint.clone());
  const worldNormal = localNormal.clone().transformDirection(object.matrixWorld);

  assert.ok(Math.abs(worldPlane.distanceToPoint(worldPoint)) < 1e-10);
  assert.ok(1 - worldPlane.normal.dot(worldNormal) < 1e-10);
});

test('desktop cut presentation separates both faces inside the cut plane', () => {
  const normal = new THREE.Vector3(.2, -.1, .97).normalize();
  const presentation = computeCutPresentation(normal, 2, 1, 1, false);
  assert.ok(Math.abs(presentation.tangent.dot(normal)) < 1e-10);
  assert.ok(presentation.halfA.distanceTo(presentation.halfB) > 3.6);
  assert.ok(presentation.halfA.dot(presentation.tangent) < 0);
  assert.ok(presentation.halfB.dot(presentation.tangent) > 0);
});

test('mobile cut presentation keeps the primary face centered', () => {
  const normal = new THREE.Vector3(.2, -.1, .97).normalize();
  const presentation = computeCutPresentation(normal, 2, 1, 1, true);
  assert.ok(Math.abs(presentation.halfA.dot(presentation.tangent)) < 1e-10);
  assert.ok(presentation.halfB.dot(presentation.tangent) > 2.6);
});

test('cut face UVs map the sampled volume extent into the complete texture', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -2.4, -2.4, 0,
    0, 0, 0,
    2.4, 2.4, 0
  ], 3));
  applyPlanarCutUVs(geometry, 2.4);
  assert.deepEqual([...geometry.attributes.uv.array], [0, 0, .5, .5, 1, 1]);
});

test('rear cut cap reverses its surface normal before the half is turned', () => {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const before = geometry.attributes.normal.getZ(0);
  reverseTriangleWinding(geometry);
  assert.ok(before > 0);
  assert.ok(geometry.attributes.normal.getZ(0) < 0);
});
