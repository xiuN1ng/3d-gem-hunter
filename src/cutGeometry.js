import * as THREE from 'three';

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * .5;
}

export function intersectGeometryWithPlane(geometry, normal, center) {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const inverseQuaternion = quaternion.clone().invert();
  const position = geometry.attributes.position;
  const index = geometry.index;
  const triangleCount = (index ? index.count : position.count) / 3;
  const epsilon = 1e-5;
  const snap = 1e-4;
  const nodes = new Map();

  const vertex = (triangle, corner) => {
    const attributeIndex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
    return new THREE.Vector3().fromBufferAttribute(position, attributeIndex);
  };
  const project = (point) => {
    const local = point.clone().sub(center).applyQuaternion(inverseQuaternion);
    return new THREE.Vector2(local.x, local.y);
  };
  const nodeKey = (point) => `${Math.round(point.x / snap)},${Math.round(point.y / snap)}`;
  const ensureNode = (point) => {
    const key = nodeKey(point);
    if (!nodes.has(key)) nodes.set(key, { point: point.clone(), neighbors: new Set() });
    return key;
  };
  const connect = (a, b) => {
    const keyA = ensureNode(a);
    const keyB = ensureNode(b);
    if (keyA === keyB) return;
    nodes.get(keyA).neighbors.add(keyB);
    nodes.get(keyB).neighbors.add(keyA);
  };

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const vertices = [vertex(triangle, 0), vertex(triangle, 1), vertex(triangle, 2)];
    const distances = vertices.map((point) => normal.dot(point.clone().sub(center)));
    const intersections = [];

    for (let edge = 0; edge < 3; edge++) {
      const next = (edge + 1) % 3;
      const a = vertices[edge];
      const b = vertices[next];
      const distanceA = distances[edge];
      const distanceB = distances[next];
      let hit = null;
      if (Math.abs(distanceA) <= epsilon) hit = a;
      else if (distanceA * distanceB < 0) hit = a.clone().lerp(b, distanceA / (distanceA - distanceB));
      if (hit && !intersections.some((point) => point.distanceToSquared(hit) < epsilon * epsilon)) intersections.push(hit);
    }

    if (intersections.length === 2) connect(project(intersections[0]), project(intersections[1]));
  }

  const visitedEdges = new Set();
  const loops = [];
  const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

  for (const [start, node] of nodes) {
    for (const firstNeighbor of node.neighbors) {
      if (visitedEdges.has(edgeKey(start, firstNeighbor))) continue;
      const loop = [];
      let previous = null;
      let current = start;
      let next = firstNeighbor;

      while (loop.length <= nodes.size + 1) {
        loop.push(nodes.get(current).point.clone());
        visitedEdges.add(edgeKey(current, next));
        previous = current;
        current = next;
        if (current === start) break;
        const candidates = [...nodes.get(current).neighbors].filter((candidate) => candidate !== previous);
        next = candidates.find((candidate) => !visitedEdges.has(edgeKey(current, candidate))) ?? candidates[0];
        if (!next) break;
      }

      if (current === start && loop.length >= 3) loops.push(loop);
    }
  }

  const points = loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  if (!points?.length) return null;
  if (signedArea(points) < 0) points.reverse();
  return {
    points,
    quaternion,
    radius: points.reduce((maximum, point) => Math.max(maximum, point.length()), 0)
  };
}

export function setWorldPlaneFromLocal(target, localNormal, localPoint, object) {
  object.updateMatrixWorld(true);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
  const worldNormal = localNormal.clone().applyMatrix3(normalMatrix).normalize();
  const worldPoint = localPoint.clone().applyMatrix4(object.matrixWorld);
  target.setFromNormalAndCoplanarPoint(worldNormal, worldPoint);
  return target;
}

export function computeCutPresentation(normal, radius, axialProgress, displayProgress, singleFace = false) {
  const tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal);
  if (tangent.lengthSq() < 1e-6) tangent.crossVectors(new THREE.Vector3(1, 0, 0), normal);
  tangent.normalize();

  const axialDistance = .48 * axialProgress;
  const lateralDistance = radius * (singleFace ? 1.35 : .92) * displayProgress;
  const halfA = normal.clone().multiplyScalar(axialDistance);
  const halfB = normal.clone().multiplyScalar(-axialDistance);
  if (singleFace) {
    halfB.addScaledVector(tangent, lateralDistance);
  } else {
    halfA.addScaledVector(tangent, -lateralDistance);
    halfB.addScaledVector(tangent, lateralDistance);
  }
  return { tangent, halfA, halfB, axialDistance, lateralDistance };
}
