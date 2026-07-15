import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyPlanarCutUVs, computeCutPresentation, intersectGeometryWithPlane, setWorldPlaneFromLocal } from './cutGeometry.js';
import { CI_SOFTWARE_WEBGL_BUDGETS, evaluatePerformance, summarizeFrameTimes } from './performanceDiagnostics.js';
import { AdaptiveFrameBudget, createRenderProfile, detectMobileQuality, timelineProgress } from './performancePolicy.js';
import { createSeasonStats, createSupplierInventory, finishReason, SEASON_DAYS, STARTING_MONEY } from './game/season.js';
import { makeStoneProfile } from './game/stoneProfile.js';
import { fbm, hash3, mulberry32, valueNoise } from './volume/noise.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const sceneHost = $('#scene');
const CUT_TEXTURE_EXTENT = 2.4;

const ui = {
  funds: $('#funds'), day: $('#day'), stoneId: $('#stoneId'), origin: $('#origin'), weight: $('#weight'),
  skin: $('#skin'), cost: $('#cost'), riskCrack: $('#riskCrack'), riskFog: $('#riskFog'),
  greenChance: $('#greenChance'), inspectorNote: $('#inspectorNote'), angle: $('#angle'), depth: $('#depth'),
  angleOutput: $('#angleOutput'), depthOutput: $('#depthOutput'), dialNeedle: $('#dialNeedle'),
  depthFill: $('#depthFill'), depthThumb: $('#depthThumb'), lossEstimate: $('#lossEstimate'),
  faceEstimate: $('#faceEstimate'), cutButton: $('#cutButton'), newStoneButton: $('#newStoneButton'),
  cutProgress: $('#cutProgress'), cutProgressBar: $('#cutProgressBar'), cutProgressText: $('#cutProgressText'),
  sceneState: $('#sceneState'), temperature: $('#temperature'), resultCard: $('#resultCard'),
  resultBadge: $('#resultBadge'), resultName: $('#resultName'), resultSummary: $('#resultSummary'),
  resultWater: $('#resultWater'), resultColor: $('#resultColor'), resultCrack: $('#resultCrack'),
  resultPrice: $('#resultPrice'), sellButton: $('#sellButton'), resultClose: $('#resultClose'),
  supplierOverlay: $('#supplierOverlay'), supplierGrid: $('#supplierGrid'), supplierClose: $('#supplierClose'),
  supplierDay: $('#supplierDay'), supplierFunds: $('#supplierFunds'), supplierHint: $('#supplierHint'),
  seasonOverlay: $('#seasonOverlay'), seasonBadge: $('#seasonBadge'), seasonTitle: $('#seasonTitle'),
  seasonSummary: $('#seasonSummary'), seasonStats: $('#seasonStats'), restartButton: $('#restartButton')
};

const state = {
  money: STARTING_MONEY,
  day: 1,
  angle: 18,
  depth: 46,
  seed: 713,
  stone: null,
  phase: 'supplier',
  cutProgress: 0,
  cutStartedAt: 0,
  split: 0,
  lastTime: performance.now(),
  seasonSeed: 713,
  inventory: [],
  stats: createSeasonStats()
};

const query = new URLSearchParams(window.location.search);
const performanceTestMode = query.has('perf-test');
const mobileQuality = performanceTestMode || detectMobileQuality({
  coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  width: window.innerWidth,
  height: window.innerHeight,
  deviceMemory: navigator.deviceMemory ?? 8
});
const renderProfile = createRenderProfile(mobileQuality);

class CutTextureWorkerClient {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  ensureWorker() {
    if (this.worker || typeof Worker === 'undefined') return this.worker;
    this.worker = new Worker(new URL('./workers/cutTexture.worker.js', import.meta.url), { type: 'module' });
    this.worker?.addEventListener('message', ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve({ data: new Uint8Array(data.buffer), size: data.size });
    });
    this.worker?.addEventListener('error', (error) => {
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    });
    return this.worker;
  }

  generate(profile, normal, center, size) {
    const worker = this.ensureWorker();
    if (!worker) return Promise.reject(new Error('Web Worker unavailable'));
    const id = this.nextId++;
    const serializableProfile = {
      seed: profile.seed,
      water: profile.water,
      color: profile.color,
      cotton: profile.cotton,
      crack: profile.crack
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        profile: serializableProfile,
        normal: normal.toArray(),
        center: center.toArray(),
        size,
        fast: mobileQuality
      });
    });
  }

  dispose() {
    for (const request of this.pending.values()) request.reject(new Error('Cut texture worker disposed'));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

const cutTextureWorker = new CutTextureWorkerClient();

function formatMoney(value) {
  return `¥${Math.round(value).toLocaleString('zh-CN')}`;
}

const renderer = new THREE.WebGLRenderer({ antialias: !mobileQuality, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderProfile.pixelRatio));
renderer.setSize(sceneHost.clientWidth, sceneHost.clientHeight);
renderer.shadowMap.enabled = !mobileQuality;
renderer.shadowMap.type = mobileQuality ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.transmissionResolutionScale = renderProfile.transmissionScale;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.localClippingEnabled = true;
sceneHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030807);
scene.fog = new THREE.FogExp2(0x030807, .032);

const camera = new THREE.PerspectiveCamera(35, sceneHost.clientWidth / sceneHost.clientHeight, .1, 100);
camera.position.set(0, .4, 9.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .065;
controls.minDistance = 6.2;
controls.maxDistance = 12.5;
controls.minPolarAngle = Math.PI * .25;
controls.maxPolarAngle = Math.PI * .72;
controls.target.set(0, .12, 0);

scene.add(new THREE.HemisphereLight(0x9acbb8, 0x100b08, .76));

const keyLight = new THREE.SpotLight(0xffd28a, 55, 18, Math.PI * .2, .65, 1.1);
keyLight.position.set(-4, 6.5, 5.5);
keyLight.target.position.set(0, .2, 0);
keyLight.castShadow = !mobileQuality;
keyLight.shadow.mapSize.set(mobileQuality ? 512 : 1024, mobileQuality ? 512 : 1024);
scene.add(keyLight, keyLight.target);

const jadeLight = new THREE.PointLight(0x36e8ad, 18, 9, 1.5);
jadeLight.position.set(3.4, 1.8, 2.8);
scene.add(jadeLight);

const rimLight = new THREE.SpotLight(0x2dbba0, 36, 16, Math.PI * .22, .8, 1.6);
rimLight.position.set(3.8, 4.6, -4.5);
rimLight.target.position.set(0, .4, 0);
scene.add(rimLight, rimLight.target);

function createStudio() {
  const group = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x07100e, roughness: .7, metalness: .35 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.18;
  floor.receiveShadow = true;
  group.add(floor);

  const grid = new THREE.GridHelper(24, 48, 0x1b5c4d, 0x12241f);
  grid.position.y = -2.17;
  grid.material.transparent = true;
  grid.material.opacity = .22;
  group.add(grid);

  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x101916, metalness: .78, roughness: .32 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0x6f5a32, metalness: .88, roughness: .28 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.45, .48, renderProfile.studioSegments), pedestalMat);
  base.position.y = -1.91;
  base.receiveShadow = true;
  base.castShadow = true;
  group.add(base);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.72, .075, 8, renderProfile.studioSegments), goldMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.62;
  group.add(ring);

  const clampGeometry = new THREE.BoxGeometry(.36, .28, .7);
  const clamps = new THREE.InstancedMesh(clampGeometry, pedestalMat, 8);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    transform.position.set(Math.cos(a) * 2.47, -1.5, Math.sin(a) * 2.47);
    transform.rotation.set(0, -a, 0);
    transform.updateMatrix();
    clamps.setMatrixAt(i, transform.matrix);
  }
  clamps.instanceMatrix.needsUpdate = true;
  clamps.castShadow = !mobileQuality;
  group.add(clamps);

  const backRing = new THREE.Mesh(new THREE.TorusGeometry(5.3, .035, 6, 128), new THREE.MeshBasicMaterial({ color: 0x204e42, transparent: true, opacity: .23 }));
  backRing.position.set(0, .45, -3.7);
  group.add(backRing);

  const tickGeometry = new THREE.BoxGeometry(.025, .24, .02);
  const tickMaterial = new THREE.MeshBasicMaterial({ color: 0x806b3c, transparent: true, opacity: .42 });
  const ticks = new THREE.InstancedMesh(tickGeometry, tickMaterial, 14);
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    transform.position.set(Math.cos(a) * 5.3, .45 + Math.sin(a) * 5.3, -3.68);
    transform.rotation.set(0, 0, a + Math.PI / 2);
    transform.updateMatrix();
    ticks.setMatrixAt(i, transform.matrix);
  }
  ticks.instanceMatrix.needsUpdate = true;
  group.add(ticks);

  scene.add(group);
}

createStudio();

function makeRockTexture(seed) {
  const size = renderProfile.rockTextureSize;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm(x / 52, y / 52, 0, seed, 5);
      const speck = hash3(x, y, 0, seed + 92);
      const v = Math.max(0, Math.min(1, n * .86 + (speck > .965 ? .24 : 0)));
      data[i] = 25 + v * 48;
      data[i + 1] = 22 + v * 42;
      data[i + 2] = 17 + v * 30;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 1.9);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeRockGeometry(seed) {
  const geometry = new THREE.IcosahedronGeometry(2.18, renderProfile.rockGeometryDetail);
  const pos = geometry.attributes.position;
  const colors = [];
  const direction = new THREE.Vector3();
  const axisScale = rockAxisScale(seed);
  const warm = new THREE.Color(0x483c2c);
  const dark = new THREE.Color(0x171815);
  const moss = new THREE.Color(0x29392b);
  for (let i = 0; i < pos.count; i++) {
    direction.fromBufferAttribute(pos, i).normalize();
    const broad = fbm(direction.x * 1.25 + 2.3, direction.y * 1.25 - 4.1, direction.z * 1.25, seed, 5);
    const fine = fbm(direction.x * 5.7, direction.y * 5.7, direction.z * 5.7, seed + 31, 3);
    const radius = rockSurfaceRadius(direction, seed);
    pos.setXYZ(i, direction.x * radius * axisScale.x, direction.y * radius * axisScale.y, direction.z * radius * axisScale.z);
    const c = dark.clone().lerp(warm, Math.min(1, broad * .83));
    if (fine > .77) c.lerp(moss, .28);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// Legacy 2D texture generator – kept temporarily for comparison / fallback
function makeJadeTexture(profile) {
  const random = mulberry32(profile.seed + 808);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const hueShift = profile.color * 22;
  const base = ctx.createRadialGradient(250, 220, 22, 256, 256, 360);
  base.addColorStop(0, `hsl(${145 + hueShift} 68% ${28 + profile.water * 18}%)`);
  base.addColorStop(.48, `hsl(${151 + hueShift * .4} 62% ${17 + profile.water * 11}%)`);
  base.addColorStop(1, '#06130f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 38; i++) {
    const x = random() * 560 - 24, y = random() * 560 - 24;
    const radius = 25 + random() * 100;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const light = 22 + profile.water * 30 + random() * 15;
    glow.addColorStop(0, `hsla(${140 + random() * 28} 75% ${light}% / ${.09 + profile.color * .22})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (.45 + random() * .8), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = `rgba(190, 235, 208, ${.08 + profile.cotton * .22})`;
  ctx.lineWidth = 2 + profile.cotton * 7;
  for (let i = 0; i < 7 + profile.cotton * 13; i++) {
    let x = random() * 512, y = random() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      x += (random() - .5) * 75; y += (random() - .5) * 75;
      ctx.quadraticCurveTo(x + (random() - .5) * 30, y + (random() - .5) * 30, x, y);
    }
    ctx.stroke();
  }

  const crackCount = Math.floor(profile.crack * 8);
  for (let i = 0; i < crackCount; i++) {
    let x = random() * 512, y = random() * 512;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.strokeStyle = `rgba(17, 9, 4, ${.38 + profile.crack * .38})`;
    ctx.lineWidth = .8 + random() * 2.2;
    for (let j = 0; j < 8; j++) {
      x += (random() - .46) * 65; y += (random() - .5) * 52;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(210, 243, 221, .13)';
    ctx.lineWidth = .5;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function rockAxisScale(seed) {
  return new THREE.Vector3(
    .95 + .08 * Math.sin(seed * .07),
    1.08 + .06 * Math.cos(seed * .13),
    .88 + .07 * Math.sin(seed * .11)
  );
}

function rockSurfaceRadius(direction, seed) {
  const broad = fbm(direction.x * 1.25 + 2.3, direction.y * 1.25 - 4.1, direction.z * 1.25, seed, 5);
  const fine = fbm(direction.x * 5.7, direction.y * 5.7, direction.z * 5.7, seed + 31, 3);
  const ridge = Math.abs(valueNoise(direction.x * 8, direction.y * 8, direction.z * 8, seed + 9) - .5);
  return 1.84 + broad * .55 + fine * .16 - ridge * .08;
}

function pointInsideRock(point, seed, axisScale) {
  const unscaled = point.clone().divide(axisScale);
  return unscaled.length() <= rockSurfaceRadius(unscaled.clone().normalize(), seed);
}

function createAnalyticalCutShape(normal, center, seed, sampleCount = 112) {
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const axisScale = rockAxisScale(seed);
  const points = [];
  let radius = 0;

  for (let i = 0; i < sampleCount; i++) {
    const angle = i / sampleCount * Math.PI * 2;
    const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(quaternion);
    let inside = 0;
    let outside = 3.2;
    for (let step = 0; step < 16; step++) {
      const distance = (inside + outside) * .5;
      const sample = center.clone().addScaledVector(radial, distance);
      if (pointInsideRock(sample, seed, axisScale)) inside = distance;
      else outside = distance;
    }
    radius = Math.max(radius, inside);
    points.push(new THREE.Vector2(Math.cos(angle) * inside, Math.sin(angle) * inside));
  }

  return { shape: new THREE.Shape(points), points, quaternion, radius };
}

function createCutShape(geometry, normal, center, seed) {
  const cacheKey = [...normal.toArray(), ...center.toArray()].map((value) => value.toFixed(6)).join(':');
  if (geometry.userData.cutShapeCache?.key === cacheKey) return geometry.userData.cutShapeCache.result;
  const intersection = intersectGeometryWithPlane(geometry, normal, center);
  if (!intersection) {
    const fallback = createAnalyticalCutShape(normal, center, seed);
    geometry.userData.cutShapeCache = { key: cacheKey, result: fallback };
    return fallback;
  }
  const result = { ...intersection, shape: new THREE.Shape(intersection.points) };
  geometry.userData.cutShapeCache = { key: cacheKey, result };
  return result;
}

function setWorldClippingPlane(target, localNormal, localPoint) {
  return setWorldPlaneFromLocal(target, localNormal, localPoint, stoneRoot);
}

function cutNormal(angle) {
  const r = THREE.MathUtils.degToRad(angle);
  return new THREE.Vector3(Math.sin(r) * .54, Math.sin(r * .65) * .26 - .1, .92).normalize();
}

function cutPosition(angle, depth) {
  const normal = cutNormal(angle);
  const offset = THREE.MathUtils.mapLinear(depth, 18, 82, -.88, .88);
  return normal.multiplyScalar(offset);
}

let stoneRoot = null;
let wholeRock = null;
let previewGroup = null;
let halves = null;
let cuttingFX = null;
let cameraTween = null;
let stoneResources = null;

function disposeObject(object, options = {}) {
  const preserveGeometries = options.preserveGeometries ?? new Set();
  const preserveTextures = options.preserveTextures ?? new Set();
  const disposedGeometries = new Set();
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  object.traverse((child) => {
    if (child.geometry && !preserveGeometries.has(child.geometry) && !disposedGeometries.has(child.geometry)) {
      child.geometry.dispose();
      disposedGeometries.add(child.geometry);
    }
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (disposedMaterials.has(material)) return;
        for (const texture of [material.map, material.bumpMap, material.emissiveMap]) {
          if (texture && !preserveTextures.has(texture) && !disposedTextures.has(texture)) {
            texture.dispose();
            disposedTextures.add(texture);
          }
        }
        material.dispose();
        disposedMaterials.add(material);
      });
    }
  });
  object.removeFromParent();
}

function createRockMaterial(profile, clippingPlanes = []) {
  const texture = stoneResources?.rockTexture ?? makeRockTexture(profile.seed);
  return new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: .16,
    vertexColors: true,
    roughness: .83,
    metalness: .04,
    clearcoat: .2,
    clearcoatRoughness: .66,
    clippingPlanes,
    clipShadows: true,
    side: THREE.DoubleSide
  });
}

function buildPreviewPlane() {
  if (previewGroup) disposeObject(previewGroup);
  previewGroup = new THREE.Group();
  const normal = cutNormal(state.angle);
  const position = cutPosition(state.angle, state.depth);
  const { shape, points, quaternion, radius } = createCutShape(wholeRock.geometry, normal, position, state.stone.seed);
  const planeGeometry = new THREE.ShapeGeometry(shape);
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x50edc2, transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const plane = new THREE.Mesh(planeGeometry, planeMat);
  previewGroup.add(plane);

  const borderPoints = points.map((p) => new THREE.Vector3(p.x, p.y, .008));
  borderPoints.push(borderPoints[0].clone());
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
  const border = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({ color: 0x52f2c6, transparent: true, opacity: .68, blending: THREE.AdditiveBlending }));
  previewGroup.add(border);

  const gridPoints = [];
  for (let i = -4; i <= 4; i++) {
    const y = i * radius * .18;
    gridPoints.push(new THREE.Vector3(-radius * .74, y, .004), new THREE.Vector3(radius * .74, y, .004));
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(gridPoints),
    new THREE.LineBasicMaterial({ color: 0x45ba9a, transparent: true, opacity: .09 })
  );
  previewGroup.add(grid);

  previewGroup.quaternion.copy(quaternion);
  previewGroup.position.copy(position);
  stoneRoot.add(previewGroup);
}

function createCutFX(radius, normal, position) {
  const group = new THREE.Group();
  const random = mulberry32(state.stone.seed + 551);
  const count = renderProfile.particleCount;
  const positions = new Float32Array(count * 3);
  const speeds = [];
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  for (let i = 0; i < count; i++) {
    const local = new THREE.Vector3((random() - .5) * radius * 1.6, (random() - .5) * radius * 1.4, (random() - .5) * .03).applyQuaternion(quaternion).add(position);
    positions.set([local.x, local.y, local.z], i * 3);
    speeds.push(new THREE.Vector3((random() - .5) * .25, random() * .4, (random() - .5) * .2).addScaledVector(normal, (random() - .5) * .6));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xa3fbe5, size: .035, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const particles = new THREE.Points(geometry, material);
  particles.userData.speeds = speeds;
  group.add(particles);

  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-radius, 0, 0), new THREE.Vector3(radius, 0, 0)]);
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0xe7fff9, transparent: true, opacity: .9, blending: THREE.AdditiveBlending }));
  beam.quaternion.copy(quaternion);
  beam.position.copy(position);
  beam.userData.radius = radius;
  group.add(beam);
  group.userData = { particles, beam, quaternion, position: position.clone(), radius, basePositions: positions.slice() };
  stoneRoot.add(group);
  return group;
}

function createCutFaceMaterial(profile, texture) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(.38 + profile.color * .025, .2, .82),
    map: texture,
    emissive: new THREE.Color(0x003d29),
    emissiveMap: texture,
    emissiveIntensity: .32 + profile.water * .22,
    roughness: .3 + profile.cotton * .16,
    metalness: 0,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
}

function createFaceAssembly(faceGeometry, material, points, quaternion, position) {
  const assembly = new THREE.Group();
  assembly.quaternion.copy(quaternion);
  assembly.position.copy(position);

  const face = new THREE.Mesh(faceGeometry, material);
  face.position.z = .012;
  face.renderOrder = 3;
  assembly.add(face);

  const glow = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({
    color: 0x35ffb5,
    transparent: true,
    opacity: .12,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  }));
  glow.position.z = .016;
  glow.renderOrder = 4;
  assembly.add(glow);

  const borderPoints = points.map((point) => new THREE.Vector3(point.x, point.y, .02));
  borderPoints.push(borderPoints[0].clone());
  const outline = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(borderPoints),
    new THREE.LineBasicMaterial({ color: 0x9affdf, transparent: true, opacity: .72, depthTest: true, blending: THREE.AdditiveBlending })
  );
  outline.renderOrder = 5;
  assembly.add(outline);
  return { assembly, face, glow, outline };
}

function buildHalves(jadeTexture = null) {
  if (halves) {
    disposeObject(halves.group, {
      preserveGeometries: new Set([stoneResources.geometry]),
      preserveTextures: new Set([stoneResources.rockTexture])
    });
  }
  const group = new THREE.Group();
  const normal = cutNormal(state.angle);
  const position = cutPosition(state.angle, state.depth);
  const planeA = setWorldClippingPlane(new THREE.Plane(), normal, position);
  const planeBNormal = normal.clone().negate();
  const planeB = setWorldClippingPlane(new THREE.Plane(), planeBNormal, position);

  const geometry = wholeRock.geometry;
  const rockA = new THREE.Mesh(geometry, createRockMaterial(state.stone, [planeA]));
  const rockB = new THREE.Mesh(geometry, createRockMaterial(state.stone, [planeB]));
  rockA.castShadow = rockB.castShadow = !mobileQuality;
  rockA.receiveShadow = rockB.receiveShadow = true;

  const { shape, points, quaternion, radius } = createCutShape(geometry, normal, position, state.stone.seed);
  const faceGeo = applyPlanarCutUVs(new THREE.ShapeGeometry(shape), CUT_TEXTURE_EXTENT);

  // Phase 1: use volumetric sampling for cut face texture
  jadeTexture ??= makeJadeTexture(state.stone);

  const faceMaterialA = createCutFaceMaterial(state.stone, jadeTexture);
  const faceMaterialB = createCutFaceMaterial(state.stone, jadeTexture);
  const capA = createFaceAssembly(faceGeo, faceMaterialA, points, quaternion, position);
  const capB = createFaceAssembly(faceGeo, faceMaterialB, points, quaternion, position);

  const halfA = new THREE.Group();
  const halfB = new THREE.Group();
  halfA.add(rockA, capA.assembly);
  halfB.add(rockB, capB.assembly);

  const faceLightA = new THREE.PointLight(0x25e7a2, 3.2 + state.stone.water * 4, 3.4, 1.8);
  const faceLightB = faceLightA.clone();
  faceLightA.position.copy(position).addScaledVector(normal, .28);
  faceLightB.position.copy(position).addScaledVector(normal, -.28);
  halfA.add(faceLightA);
  halfB.add(faceLightB);
  group.add(halfA, halfB);
  group.visible = false;
  stoneRoot.add(group);
  halves = {
    group, halfA, halfB, rockA, rockB,
    faceA: capA.face, faceB: capB.face,
    glowA: capA.glow, glowB: capB.glow,
    planeA, planeB, planeBNormal, normal, position, radius, jadeTexture
  };
}

function buildStone(profile) {
  if (stoneRoot) disposeObject(stoneRoot);
  halves = null;
  stoneResources = null;
  stoneRoot = new THREE.Group();
  stoneRoot.position.y = .24;
  scene.add(stoneRoot);

  const geometry = makeRockGeometry(profile.seed);
  stoneResources = { geometry, rockTexture: makeRockTexture(profile.seed) };
  wholeRock = new THREE.Mesh(geometry, createRockMaterial(profile));
  wholeRock.castShadow = !mobileQuality;
  wholeRock.receiveShadow = true;
  stoneRoot.add(wholeRock);

  const underGlow = new THREE.PointLight(0x20d28f, 2.4 + profile.color * 2.8, 4.2, 2);
  underGlow.position.set(.4, -1.2, .9);
  stoneRoot.add(underGlow);
  buildPreviewPlane();
}

function updateCutPreview() {
  if (state.phase !== 'inspect') return;
  buildPreviewPlane();
  const depthBias = Math.abs(state.depth - 50) / 50;
  ui.lossEstimate.textContent = `${(7.4 + depthBias * 6.2 + Math.abs(state.angle) * .026).toFixed(1)}%`;
  ui.faceEstimate.textContent = `${Math.round(79 - depthBias * 31)}%`;
}

let previewFrame = 0;
function scheduleCutPreview() {
  if (previewFrame || state.phase !== 'inspect') return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = 0;
    updateCutPreview();
  });
}

function updateControls() {
  state.angle = Number(ui.angle.value);
  state.depth = Number(ui.depth.value);
  ui.angleOutput.textContent = `${state.angle}°`;
  ui.depthOutput.textContent = `${state.depth}%`;
  ui.dialNeedle.style.transform = `rotate(${state.angle}deg)`;
  ui.depthFill.style.width = `${state.depth}%`;
  ui.depthThumb.style.left = `${state.depth}%`;
  scheduleCutPreview();
}

function updateStoneUI(profile) {
  ui.stoneId.textContent = profile.id;
  ui.origin.textContent = profile.origin;
  ui.weight.textContent = profile.weight.toFixed(1);
  ui.skin.textContent = profile.skin;
  ui.cost.textContent = formatMoney(profile.cost);
  ui.greenChance.textContent = `${profile.greenChance}%`;
  ui.riskCrack.textContent = profile.crack > .68 ? '高' : profile.crack > .34 ? '中' : '低';
  ui.riskCrack.className = profile.crack > .34 ? 'warn' : 'jade';
  ui.riskFog.textContent = ['偏薄', '未知', '偏厚'][Math.floor(profile.cotton * 2.99)];
  ui.inspectorNote.textContent = profile.note;
}

function updateLedger() {
  ui.funds.textContent = formatMoney(state.money);
  ui.day.textContent = Math.min(state.day, SEASON_DAYS);
  ui.supplierDay.textContent = `第 ${Math.min(state.day, SEASON_DAYS)} / ${SEASON_DAYS} 天`;
  ui.supplierFunds.textContent = formatMoney(state.money);
}

function purchaseStone(profile, charge = true) {
  if (state.stone || (charge && state.money < profile.cost)) return false;
  state.seed = profile.seed;
  if (charge) {
    state.money -= profile.cost;
    state.stats.totalSpent += profile.cost;
  }
  state.stone = profile;
  state.phase = 'inspect';
  state.split = 0;
  cameraTween = null;
  updateLedger();
  ui.resultCard.classList.remove('visible');
  ui.supplierOverlay.classList.remove('visible');
  ui.cutButton.disabled = false;
  ui.newStoneButton.disabled = false;
  ui.sceneState.textContent = '原石扫描就绪';
  ui.temperature.textContent = '24°C';
  updateStoneUI(profile);
  buildStone(profile);
  controls.target.set(0, .1, 0);
  return true;
}

function supplierRisk(profile) {
  const crack = profile.crack > .68 ? '裂象偏高' : profile.crack > .34 ? '见绺' : '皮壳完整';
  const lamp = profile.greenChance > 62 ? '压灯明显' : profile.greenChance > 42 ? '压灯含蓄' : '压灯微弱';
  return { crack, lamp };
}

function renderSupplierInventory() {
  const locked = Boolean(state.stone);
  ui.supplierGrid.replaceChildren(...state.inventory.map((profile) => {
    const card = document.createElement('article');
    card.className = 'supplier-card';
    const risk = supplierRisk(profile);
    card.innerHTML = `<header><h3>${profile.origin} · ${profile.id}</h3><span>${profile.weight.toFixed(1)} kg</span></header>
      <dl><div><dt>皮壳</dt><dd>${profile.skin}</dd></div><div><dt>裂象</dt><dd>${risk.crack}</dd></div><div><dt>灯感</dt><dd>${risk.lamp}</dd></div><div><dt>叫价</dt><dd class="gold">${formatMoney(profile.cost)}</dd></div></dl>
      <p class="supplier-note">${profile.note}</p>`;
    const button = document.createElement('button');
    button.className = 'supplier-buy';
    button.type = 'button';
    button.disabled = locked || state.money < profile.cost;
    button.textContent = locked ? '先处理当前原石' : state.money < profile.cost ? '资金不足' : `买入 · ${formatMoney(profile.cost)}`;
    button.addEventListener('click', () => purchaseStone(profile));
    card.appendChild(button);
    return card;
  }));
  ui.supplierHint.textContent = locked
    ? '当前已有待处理原石，可查看今日货盘，但必须先完成切割与出售。'
    : '货盘每日固定且不可免费刷新。依据皮壳、场口与压灯反馈判断，内部品质只有切开后才会公开。';
  ui.supplierClose.hidden = !locked;
}

function showSeasonResult(reason) {
  state.phase = 'gameover';
  ui.supplierOverlay.classList.remove('visible');
  ui.resultCard.classList.remove('visible');
  const profit = state.money - STARTING_MONEY;
  const complete = reason === 'complete';
  ui.seasonBadge.textContent = complete ? '卅' : '破';
  ui.seasonTitle.textContent = complete ? '三十日挑战完成' : '资金链断裂';
  ui.seasonSummary.textContent = complete
    ? `三十日货盘已经走完，本季最终资金 ${formatMoney(state.money)}。`
    : `第 ${state.day} 天已无力买入货盘中最便宜的原石，本赛季提前结束。`;
  ui.seasonStats.innerHTML = [
    ['最终资金', formatMoney(state.money)],
    ['赛季盈亏', `${profit >= 0 ? '+' : '−'}${formatMoney(Math.abs(profit))}`],
    ['完成切石', `${state.stats.stonesCut} 块`],
    ['单笔最高', formatMoney(state.stats.bestSale)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  ui.seasonOverlay.classList.add('visible');
}

function openSupplier() {
  if (state.phase === 'cutting' || state.phase === 'preparing' || state.phase === 'gameover') return;
  if (!state.inventory.length) state.inventory = createSupplierInventory(state.seasonSeed, state.day);
  updateLedger();
  const reason = !state.stone ? finishReason(state.day, state.money, state.inventory) : null;
  if (reason) return showSeasonResult(reason);
  if (!state.stone) state.phase = 'supplier';
  renderSupplierInventory();
  ui.supplierOverlay.classList.add('visible');
}

function restartSeason() {
  state.money = STARTING_MONEY;
  state.day = 1;
  state.seasonSeed = Math.floor(Date.now() % 0xffffffff);
  state.inventory = [];
  state.stats = createSeasonStats();
  state.stone = null;
  state.phase = 'supplier';
  if (stoneRoot) {
    disposeObject(stoneRoot);
    stoneRoot = wholeRock = halves = stoneResources = previewGroup = null;
  }
  ui.seasonOverlay.classList.remove('visible');
  openSupplier();
}

function evaluateStone(profile) {
  const cutCenterBonus = 1 - Math.abs(state.depth - 50) / 58;
  const angleLuck = .88 + Math.sin((state.angle + profile.seed) * .17) * .12;
  const material = profile.water * .33 + profile.color * .35 + profile.quality * .28 - profile.crack * .22 - profile.cotton * .11;
  const score = THREE.MathUtils.clamp(material * cutCenterBonus * angleLuck + .12, 0, 1);
  const waterLevels = ['豆种', '糯种', '糯冰', '冰种', '高冰'];
  const colorLevels = ['灰绿', '油青', '晴水', '阳绿', '帝王绿'];
  const waterIndex = Math.min(4, Math.floor(profile.water * 4.4));
  const colorIndex = Math.min(4, Math.floor(profile.color * 4.35));
  const waterName = waterLevels[waterIndex];
  const colorName = colorLevels[colorIndex];
  const crackName = profile.crack > .7 ? '贯穿' : profile.crack > .4 ? '数道' : profile.crack > .2 ? '少' : '无明显裂';
  const price = Math.max(900, Math.round((1200 + score * score * 97000 + profile.weight * 280) * (1 - profile.crack * .52) / 100) * 100);
  const ratio = price / profile.cost;
  const badge = ratio > 1.55 ? '暴涨' : ratio > 1.04 ? '涨' : ratio > .72 ? '平' : '垮';
  const summary = profile.crack > .62
    ? '种色有表现，但裂纹侵入主料，成品率受限。'
    : profile.water > .64
      ? '水头充足，底子细腻，切面荧光感明显。'
      : profile.color > .62 ? '色根集中，颜色进入较深，仍有取件空间。' : '底子偏灰，色散而浅，适合小件取材。';
  return { score, price, ratio, badge, waterName, colorName, crackName, summary, name: `${waterName} · ${colorName}` };
}

let audioContext = null;
let cutNoise = null;

function startCutSound() {
  try {
    audioContext ??= new AudioContext();
    const length = audioContext.sampleRate * 4;
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * Math.exp(-i / length * .7);
    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = 'bandpass'; filter.frequency.value = 740; filter.Q.value = .72;
    gain.gain.setValueAtTime(.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.07, audioContext.currentTime + .22);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + 3.65);
    source.buffer = buffer; source.loop = true;
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start(); source.stop(audioContext.currentTime + 3.8);
    cutNoise = source;
  } catch { /* Audio is enhancement only. */ }
}

function createWorkerTexture(generated) {
  const texture = new THREE.DataTexture(generated.data, generated.size, generated.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

async function prepareCutTexture(normal, position) {
  try {
    const generated = await cutTextureWorker.generate(
      state.stone,
      normal,
      position,
      renderProfile.cutTextureSize
    );
    return createWorkerTexture(generated);
  } catch (error) {
    console.warn('Cut texture worker failed; using synchronous fallback.', error);
    const { JadeVolume } = await import('./volume/JadeVolume.js');
    const fallbackVolume = new JadeVolume(state.stone);
    try {
      const generated = fallbackVolume.generateCutTextureData(
        normal,
        position,
        renderProfile.cutTextureSize,
        2.4,
        { fast: mobileQuality }
      );
      return createWorkerTexture({ data: generated.data, size: renderProfile.cutTextureSize });
    } finally {
      fallbackVolume.dispose();
    }
  }
}

async function startCut() {
  if (state.phase !== 'inspect') return;
  state.phase = 'preparing';
  state.cutProgress = 0;
  state.split = 0;
  ui.cutButton.disabled = true;
  ui.newStoneButton.disabled = true;
  ui.resultCard.classList.remove('visible');
  ui.cutProgress.classList.add('active');
  ui.cutProgressBar.style.width = '3%';
  ui.cutProgressText.textContent = '解析';
  ui.sceneState.textContent = '正在解析内部翠质';

  // Let the preparation state paint before the worker starts returning data.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const normal = cutNormal(state.angle);
  const position = cutPosition(state.angle, state.depth);
  const jadeTexture = await prepareCutTexture(normal, position);
  if (state.phase !== 'preparing') {
    jadeTexture.dispose();
    return;
  }

  buildHalves(jadeTexture);
  state.phase = 'cutting';
  state.cutStartedAt = performance.now();
  ui.sceneState.textContent = '金刚砂轮运转中';
  cuttingFX = createCutFX(halves.radius, halves.normal, halves.position);
  startCutSound();
}

function focusCutSurface() {
  if (!halves || !stoneRoot) return;
  const localFocus = halves.position.clone();
  if (mobileQuality) localFocus.add(halves.halfA.position);
  const worldFocus = stoneRoot.localToWorld(localFocus);
  const worldRotation = stoneRoot.getWorldQuaternion(new THREE.Quaternion());
  const worldNormal = halves.normal.clone().applyQuaternion(worldRotation).normalize();
  const worldTangent = halves.presentationTangent.clone().applyQuaternion(worldRotation).normalize();
  const framingTarget = worldFocus.clone().add(new THREE.Vector3(0, mobileQuality ? -.72 : -.48, 0));
  const distance = mobileQuality
    ? Math.max(7.2, halves.radius * 3.65)
    : Math.max(7.6, halves.radius * 4.15);
  const destination = framingTarget.clone()
    .addScaledVector(worldNormal, distance)
    .addScaledVector(worldTangent, mobileQuality ? 0 : .16)
    .add(new THREE.Vector3(0, .12, 0));

  cameraTween = {
    startedAt: performance.now(),
    duration: 1050,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: destination,
    toTarget: framingTarget
  };
}

function updateCameraTween(time) {
  if (!cameraTween) return;
  const linear = THREE.MathUtils.clamp((time - cameraTween.startedAt) / cameraTween.duration, 0, 1);
  const eased = 1 - Math.pow(1 - linear, 3);
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  if (linear >= 1) cameraTween = null;
}

function showResult() {
  const result = evaluateStone(state.stone);
  state.stone.result = result;
  ui.resultBadge.textContent = result.badge;
  ui.resultBadge.style.fontSize = result.badge.length > 1 ? '17px' : '24px';
  ui.resultName.textContent = result.name;
  ui.resultSummary.textContent = result.summary;
  ui.resultWater.textContent = result.waterName;
  ui.resultColor.textContent = result.colorName;
  ui.resultCrack.textContent = result.crackName;
  ui.resultPrice.textContent = formatMoney(result.price);
  ui.resultCard.classList.add('visible');
  ui.sellButton.textContent = `按 ${formatMoney(result.price)} 出售`;
  ui.sceneState.textContent = `双面鉴赏 · ${result.badge} · 可拖拽观察`;
}

function sellStone() {
  if (!state.stone?.result) return;
  const salePrice = state.stone.result.price;
  state.money += salePrice;
  state.stats.totalSales += salePrice;
  state.stats.stonesCut += 1;
  state.stats.bestSale = Math.max(state.stats.bestSale, salePrice);
  updateLedger();
  ui.sellButton.textContent = '交易完成';
  ui.sellButton.disabled = true;
  setTimeout(() => {
    ui.sellButton.disabled = false;
    ui.sellButton.textContent = '按估价出售';
    state.stone = null;
    state.inventory = [];
    ui.resultCard.classList.remove('visible');
    if (state.day >= SEASON_DAYS) {
      state.day = SEASON_DAYS + 1;
      showSeasonResult('complete');
      return;
    }
    state.day += 1;
    openSupplier();
  }, 650);
}

ui.angle.addEventListener('input', updateControls);
ui.depth.addEventListener('input', updateControls);
$('#angleMinus').addEventListener('click', () => { ui.angle.value = Math.max(-40, Number(ui.angle.value) - 1); updateControls(); });
$('#anglePlus').addEventListener('click', () => { ui.angle.value = Math.min(40, Number(ui.angle.value) + 1); updateControls(); });
ui.cutButton.addEventListener('click', startCut);
ui.newStoneButton.addEventListener('click', openSupplier);
ui.supplierClose.addEventListener('click', () => ui.supplierOverlay.classList.remove('visible'));
ui.restartButton.addEventListener('click', restartSeason);
ui.sellButton.addEventListener('click', sellStone);
ui.resultClose.addEventListener('click', () => ui.resultCard.classList.remove('visible'));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift') controls.rotateSpeed = .25;
  if (event.key === 'Enter' && state.phase === 'inspect') startCut();
});
window.addEventListener('keyup', (event) => { if (event.key === 'Shift') controls.rotateSpeed = 1; });

function animateCut(time) {
  state.cutProgress = timelineProgress(time, state.cutStartedAt, 3700);
  const p = state.cutProgress;
  const percent = Math.round(p * 100);
  ui.cutProgressBar.style.width = `${percent}%`;
  ui.cutProgressText.textContent = `${percent}%`;
  ui.temperature.textContent = `${Math.round(24 + Math.sin(p * Math.PI) * 43)}°C`;

  if (cuttingFX) {
    const { particles, beam, radius, basePositions } = cuttingFX.userData;
    particles.material.opacity = Math.sin(p * Math.PI) * .72;
    const attr = particles.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const speed = particles.userData.speeds[i];
      attr.setXYZ(i, basePositions[i * 3] + speed.x * p, basePositions[i * 3 + 1] + speed.y * p, basePositions[i * 3 + 2] + speed.z * p);
    }
    attr.needsUpdate = true;
    beam.position.copy(halves.position).add(new THREE.Vector3(0, THREE.MathUtils.lerp(-radius * .72, radius * .72, p), .02).applyQuaternion(beam.quaternion));
    beam.material.opacity = Math.sin(p * Math.PI) * .95;
  }

  previewGroup.visible = p < .78;
  if (p > .56 && p <= .72) ui.sceneState.textContent = '翠色显影 · 准备分离';
  if (p > .72) {
    wholeRock.visible = false;
    halves.group.visible = true;
    const axialProgress = THREE.MathUtils.smoothstep(p, .72, .94);
    const displayProgress = THREE.MathUtils.smoothstep(p, .84, 1);
    const presentation = computeCutPresentation(
      halves.normal,
      halves.radius,
      axialProgress,
      displayProgress,
      mobileQuality
    );
    state.split = presentation.axialDistance;
    halves.presentationTangent = presentation.tangent;
    halves.halfA.quaternion.identity();
    halves.halfA.position.copy(presentation.halfA);
    halves.halfB.quaternion.setFromAxisAngle(presentation.tangent, Math.PI * displayProgress);
    const rotatedPivot = halves.position.clone().applyQuaternion(halves.halfB.quaternion);
    halves.halfB.position.copy(presentation.halfB).add(halves.position).sub(rotatedPivot);
    setWorldPlaneFromLocal(halves.planeA, halves.normal, halves.position, halves.halfA);
    setWorldPlaneFromLocal(halves.planeB, halves.planeBNormal, halves.position, halves.halfB);
    const reveal = THREE.MathUtils.smoothstep(p, .72, .94);
    halves.faceA.material.emissiveIntensity = .32 + state.stone.water * .22 + reveal * .18;
    halves.faceB.material.emissiveIntensity = halves.faceA.material.emissiveIntensity;
    halves.glowA.material.opacity = halves.glowB.material.opacity = .1 + reveal * .18;
  }

  if (p >= 1) {
    state.phase = 'result';
    ui.cutProgress.classList.remove('active');
    ui.newStoneButton.disabled = false;
    if (cuttingFX) { disposeObject(cuttingFX); cuttingFX = null; }
    focusCutSurface();
    showResult();
  }
}

function resize() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => cutTextureWorker.dispose(), { once: true });

let lastRenderedAt = 0;
const frameBudget = new AdaptiveFrameBudget({ targetFps: renderProfile.targetFps });
function animate(time) {
  requestAnimationFrame(animate);
  if (mobileQuality && !frameBudget.shouldRender(time, lastRenderedAt)) return;
  lastRenderedAt = time;
  const delta = Math.min(.25, (time - state.lastTime) / 1000);
  state.lastTime = time;
  if (mobileQuality) frameBudget.observe(delta * 1000);
  controls.update();
  if (stoneRoot && state.phase === 'inspect') stoneRoot.rotation.y += delta * .045;
  if (previewGroup && state.phase === 'inspect') {
    const shimmer = .055 + Math.sin(time * .003) * .018;
    previewGroup.children[0].material.opacity = shimmer;
  }
  if (state.phase === 'cutting') animateCut(time);
  updateCameraTween(time);
  jadeLight.intensity = 16 + Math.sin(time * .0018) * 2.5;
  renderer.render(scene, camera);
}

updateControls();
resize();
requestAnimationFrame(animate);

if (performanceTestMode) {
  ui.supplierOverlay.classList.remove('visible');
  purchaseStone(makeStoneProfile(state.seed), false);
} else {
  state.inventory = createSupplierInventory(state.seasonSeed, state.day);
  openSupplier();
}

async function runPerformanceAcceptance() {
  const ciSoftwareWebgl = query.get('perf-tier') === 'ci';
  const frameTimes = [];
  let maxLongTaskMs = 0;
  const longTaskObserver = typeof PerformanceObserver === 'undefined'
    ? null
    : new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) maxLongTaskMs = Math.max(maxLongTaskMs, entry.duration);
      });
  try {
    longTaskObserver?.observe({ type: 'longtask', buffered: true });
  } catch { /* Long Task API is optional. */ }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  for (let i = 0; i < 30; i++) await nextFrame();

  const prepareStartedAt = performance.now();
  await startCut();
  const prepareMs = performance.now() - prepareStartedAt;
  const cutStartedAt = performance.now();
  let previousFrame = cutStartedAt;
  const cutTimeoutMs = 10000;
  while (state.phase !== 'result' && performance.now() - cutStartedAt < cutTimeoutMs) {
    const time = await nextFrame();
    frameTimes.push(time - previousFrame);
    previousFrame = time;
  }

  longTaskObserver?.disconnect();
  const frameSummary = summarizeFrameTimes(frameTimes);
  const metrics = {
    ...frameSummary,
    prepareMs,
    cutMs: performance.now() - cutStartedAt,
    maxLongTaskMs,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    contextLost: renderer.getContext().isContextLost(),
    completed: state.phase === 'result'
  };
  const budgets = ciSoftwareWebgl ? CI_SOFTWARE_WEBGL_BUDGETS : undefined;
  const evaluation = evaluatePerformance(metrics, budgets);
  const output = document.createElement('pre');
  output.id = 'perf-result';
  output.hidden = true;
  output.textContent = JSON.stringify({ metrics, evaluation });
  document.body.appendChild(output);
  document.documentElement.dataset.perfTest = evaluation.passed ? 'pass' : 'fail';
  document.title = evaluation.passed ? 'PERF_PASS' : 'PERF_FAIL';
}

if (performanceTestMode) runPerformanceAcceptance().catch((error) => {
  document.documentElement.dataset.perfTest = 'fail';
  document.title = 'PERF_FAIL';
  console.error(error);
});
