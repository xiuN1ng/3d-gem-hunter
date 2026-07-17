import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyPlanarCutUVs, computeCutPresentation, computePlatformLift, computeShowcaseTransform, createThickCutGeometry, intersectGeometryWithPlane, reverseTriangleWinding, setWorldPlaneFromLocal } from '../src/cutGeometry.js';

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

test('clipping plane can be re-anchored after showcase root translation', () => {
  const object = new THREE.Group();
  const localNormal = new THREE.Vector3(-.22, .17, .96).normalize();
  const localPoint = localNormal.clone().multiplyScalar(.38);
  const initial = setWorldPlaneFromLocal(new THREE.Plane(), localNormal, localPoint, object);
  const initialPoint = object.localToWorld(localPoint.clone());

  object.position.y += .65;
  const moved = setWorldPlaneFromLocal(new THREE.Plane(), localNormal, localPoint, object);
  const movedPoint = object.localToWorld(localPoint.clone());

  assert.ok(movedPoint.distanceTo(initialPoint) > .64);
  assert.ok(Math.abs(moved.distanceToPoint(movedPoint)) < 1e-10);
  assert.ok(1 - moved.normal.dot(initial.normal) < 1e-10);
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

test('platform lift clears a low cut assembly without moving an already resting one', () => {
  assert.ok(Math.abs(computePlatformLift(-1.82, -1.67, .04) - .19) < 1e-12);
  assert.equal(computePlatformLift(-1.61, -1.67, .04), 0);
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

test('thick cut geometry adds a domed front and a stitched side wall', () => {
  const surface = new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(-1, -.7),
    new THREE.Vector2(1, -.7),
    new THREE.Vector2(1.2, .4),
    new THREE.Vector2(0, 1),
    new THREE.Vector2(-1.2, .4)
  ]));
  applyPlanarCutUVs(surface, 1.4);
  const thick = createThickCutGeometry(surface, [
    new THREE.Vector2(-1, -.7),
    new THREE.Vector2(1, -.7),
    new THREE.Vector2(1.2, .4),
    new THREE.Vector2(0, 1),
    new THREE.Vector2(-1.2, .4)
  ], { thickness: .2, dome: .1 });
  assert.equal(thick.groups.length, 2);
  assert.ok(thick.groups[1].count >= (5 * 6) + surface.index.count, 'rear and side walls should close the slab');
  assert.ok(thick.boundingBox.max.z > .1, 'the domed front should rise above the cut plane');
  assert.ok(thick.boundingBox.min.z < -.09);

  const rear = createThickCutGeometry(surface, [
    new THREE.Vector2(-1, -.7),
    new THREE.Vector2(1, -.7),
    new THREE.Vector2(1.2, .4),
    new THREE.Vector2(0, 1),
    new THREE.Vector2(-1.2, .4)
  ], { thickness: .2, dome: .1, outwardSign: -1 });
  assert.ok(rear.boundingBox.min.z < -.19, 'the opposite half should dome toward the rear normal');
});

test('rear cut cap reverses its surface normal before the half is turned', () => {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const before = geometry.attributes.normal.getZ(0);
  reverseTriangleWinding(geometry);
  assert.ok(before > 0);
  assert.ok(geometry.attributes.normal.getZ(0) < 0);
});

test('whole-stone showcase rotation faces the viewer and keeps the cut centre fixed', () => {
  const normal = new THREE.Vector3(.72, -.23, .65).normalize();
  const startQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(.12, -.42, .08));
  const startPosition = new THREE.Vector3(.4, .2, -.3);
  const pivot = normal.clone().multiplyScalar(.37);
  const pivotWorld = pivot.clone().applyQuaternion(startQuaternion).add(startPosition);
  const viewerDirection = new THREE.Vector3(-.12, .18, .976).normalize();
  const initial = computeShowcaseTransform(normal, pivot, startQuaternion, pivotWorld, viewerDirection, 0);
  assert.ok(initial.quaternion.angleTo(startQuaternion) < 1e-10);
  assert.ok(initial.position.distanceTo(startPosition) < 1e-10);
  const transform = computeShowcaseTransform(normal, pivot, startQuaternion, pivotWorld, viewerDirection);
  const displayedNormal = normal.clone().applyQuaternion(transform.quaternion);
  const displayedPivot = pivot.clone().applyQuaternion(transform.quaternion).add(transform.position);
  assert.ok(displayedNormal.distanceTo(viewerDirection) < 1e-10);
  assert.ok(displayedPivot.distanceTo(pivotWorld) < 1e-10);
});
