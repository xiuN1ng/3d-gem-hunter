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

/** Map cut-plane local coordinates to the same square sampled by JadeVolume. */
export function applyPlanarCutUVs(geometry, extent = 2.4) {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const scale = 1 / (extent * 2);
  for (let index = 0; index < position.count; index++) {
    uv[index * 2] = THREE.MathUtils.clamp(position.getX(index) * scale + .5, 0, 1);
    uv[index * 2 + 1] = THREE.MathUtils.clamp(position.getY(index) * scale + .5, 0, 1);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Build a shallow, domed cut slab from a triangulated planar surface.
 *
 * ShapeGeometry gives us a faithful irregular contour, but by itself it has
 * no thickness or view-dependent shading. This helper keeps the sampled front
 * surface and UVs, adds a subtle convex polish dome, and stitches a side wall
 * back to the cut plane. It is deliberately a small mesh (one vertex per
 * sampled surface vertex plus two vertices per contour edge) so it is cheap on
 * mobile GPUs while still producing real silhouette/parallax cues.
 */
export function createThickCutGeometry(surfaceGeometry, boundaryPoints, {
  thickness = .14,
  dome = .06,
  outwardSign = 1
} = {}) {
  const position = surfaceGeometry.getAttribute('position');
  const uv = surfaceGeometry.getAttribute('uv');
  const index = surfaceGeometry.getIndex();
  if (!position || !index || boundaryPoints.length < 3) {
    throw new Error('createThickCutGeometry requires indexed surface geometry and a boundary');
  }

  const vertexCount = position.count;
  const triangleIndices = Array.from({ length: index.count }, (_, offset) => index.getX(offset));
  const radius = boundaryPoints.reduce((maximum, point) => Math.max(maximum, point.length()), 0) || 1;
  const half = Math.max(.001, thickness * .5);
  const frontZ = (x, y) => {
    const normalizedRadius = THREE.MathUtils.clamp(Math.hypot(x, y) / radius, 0, 1);
    const domeLift = dome * Math.pow(Math.max(0, 1 - normalizedRadius * normalizedRadius), 1.35);
    return outwardSign * (half + domeLift);
  };

  const positions = [];
  const uvs = [];
  const pushVertex = (x, y, z, u = 0, v = 0) => {
    positions.push(x, y, z);
    uvs.push(u, v);
  };

  // The front surface keeps the original sampled UVs and receives the dome.
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    pushVertex(x, y, frontZ(x, y), uv?.getX(vertex) ?? .5, uv?.getY(vertex) ?? .5);
  }

  // ShapeGeometry normally stores only the contour vertices. Add one
  // barycentre per source triangle so the centre of the cut can actually
  // rise above the rim instead of remaining a flat triangulated polygon.
  const triangleCentersStart = positions.length / 3;
  for (let offset = 0; offset < triangleIndices.length; offset += 3) {
    const a = triangleIndices[offset];
    const b = triangleIndices[offset + 1];
    const c = triangleIndices[offset + 2];
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const u = ((uv?.getX(a) ?? .5) + (uv?.getX(b) ?? .5) + (uv?.getX(c) ?? .5)) / 3;
    const v = ((uv?.getY(a) ?? .5) + (uv?.getY(b) ?? .5) + (uv?.getY(c) ?? .5)) / 3;
    pushVertex(x, y, frontZ(x, y), u, v);
  }

  // A flat rear plane closes the slab at the original cut plane. It shares
  // the source triangulation and is rendered with the darker side material.
  const backStart = positions.length / 3;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    pushVertex(x, y, -outwardSign * half, uv?.getX(vertex) ?? .5, uv?.getY(vertex) ?? .5);
  }

  const sideStart = positions.length / 3;
  const frontSide = [];
  const backSide = [];
  for (const point of boundaryPoints) {
    const sideIndex = positions.length / 3;
    pushVertex(point.x, point.y, frontZ(point.x, point.y));
    frontSide.push(sideIndex);
  }
  for (const point of boundaryPoints) {
    const sideIndex = positions.length / 3;
    pushVertex(point.x, point.y, -outwardSign * half);
    backSide.push(sideIndex);
  }

  const frontIndices = [];
  for (let offset = 0; offset < triangleIndices.length; offset += 3) {
    const a = triangleIndices[offset];
    const b = triangleIndices[offset + 1];
    const c = triangleIndices[offset + 2];
    const centre = triangleCentersStart + offset / 3;
    if (outwardSign > 0) {
      frontIndices.push(a, b, centre, b, c, centre, c, a, centre);
    } else {
      frontIndices.push(a, centre, b, b, centre, c, c, centre, a);
    }
  }

  const backIndices = [];
  for (let offset = 0; offset < triangleIndices.length; offset += 3) {
    const a = triangleIndices[offset] + backStart;
    const b = triangleIndices[offset + 1] + backStart;
    const c = triangleIndices[offset + 2] + backStart;
    // The rear plane faces away from the front surface so the slab remains
    // closed when the player rotates around either half.
    if (outwardSign > 0) backIndices.push(a, c, b);
    else backIndices.push(a, b, c);
  }

  const sideIndices = [];
  for (let edge = 0; edge < boundaryPoints.length; edge++) {
    const next = (edge + 1) % boundaryPoints.length;
    const frontA = frontSide[edge];
    const frontB = frontSide[next];
    const backA = backSide[edge];
    const backB = backSide[next];
    if (outwardSign > 0) {
      sideIndices.push(frontA, backA, backB, frontA, backB, frontB);
    } else {
      sideIndices.push(frontA, frontB, backB, frontA, backB, backA);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([...frontIndices, ...backIndices, ...sideIndices]);
  geometry.addGroup(0, frontIndices.length, 0);
  geometry.addGroup(frontIndices.length, backIndices.length + sideIndices.length, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { thickness, dome, outwardSign, backStart, sideStart };
  return geometry;
}

/** Reverse an indexed triangle surface while preserving positions and UVs. */
export function reverseTriangleWinding(geometry) {
  const index = geometry.getIndex();
  if (!index) throw new Error('reverseTriangleWinding requires indexed geometry');
  for (let offset = 0; offset < index.count; offset += 3) {
    const second = index.getX(offset + 1);
    index.setX(offset + 1, index.getX(offset + 2));
    index.setX(offset + 2, second);
  }
  index.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
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

/** Lift a displayed cut assembly until its lowest visible bound clears the stand. */
export function computePlatformLift(boundsMinY, platformTopY, clearance = 0) {
  if (!Number.isFinite(boundsMinY) || !Number.isFinite(platformTopY)) return 0;
  return Math.max(0, platformTopY + clearance - boundsMinY);
}

/** Rotate the whole stone toward a viewer while keeping the cut centre fixed in world space. */
export function computeShowcaseTransform(surfaceNormal, pivotLocal, startQuaternion, pivotWorld, viewerDirection, progress = 1) {
  const currentWorldNormal = surfaceNormal.clone().normalize().applyQuaternion(startQuaternion).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(
    currentWorldNormal,
    viewerDirection.clone().normalize()
  );
  const targetQuaternion = delta.multiply(startQuaternion.clone());
  const quaternion = startQuaternion.clone().slerp(targetQuaternion, THREE.MathUtils.clamp(progress, 0, 1));
  const position = pivotWorld.clone().sub(pivotLocal.clone().applyQuaternion(quaternion));
  return { quaternion, position, targetQuaternion };
}
