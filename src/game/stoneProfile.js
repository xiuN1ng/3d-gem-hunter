import { mulberry32 } from '../volume/noise.js';

const SHAPE_NAMES = ['卵圆', '扁圆', '长条', '三角砾', '山子料', '鹅卵'];

/** Deterministic natural-stone silhouette parameters shared by geometry and UI. */
export function makeRockShape(seed) {
  const random = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const size = .78 + random() * .64;
  const asymmetry = .1 + random() * .25;
  const angularity = .18 + random() * .5;
  const lobe = .12 + random() * .28;
  const axis = {
    x: .86 + random() * .42,
    y: .78 + random() * .55,
    z: .84 + random() * .48
  };
  const flatten = random();
  const elongate = random();
  if (flatten > .56) axis.y *= .68 + random() * .18;
  if (elongate > .58) axis.x *= 1.12 + random() * .2;
  const volumeScale = size ** 3 * axis.x * axis.y * axis.z;
  const longest = Math.max(axis.x, axis.y, axis.z);
  const shortest = Math.min(axis.x, axis.y, axis.z);
  const shapeIndex = Math.floor(random() * SHAPE_NAMES.length);
  return {
    size,
    axis,
    asymmetry,
    angularity,
    lobe,
    phase: random() * Math.PI * 2,
    volumeScale,
    shapeName: SHAPE_NAMES[shapeIndex],
    aspect: longest / shortest
  };
}

export function makeStoneProfile(seed) {
  const random = mulberry32(seed);
  const shape = makeRockShape(seed);
  const origins = ['莫西沙', '会卡', '木那', '大马坎', '南齐'];
  const skins = ['黑乌砂 · 紧', '黄盐砂 · 细', '白盐砂 · 老', '水翻砂 · 匀', '蜡壳 · 厚'];
  const notes = [
    '皮壳老辣，局部有松花。灯下表现含蓄，值得一刀。',
    '砂粒细密，蟒带绕腰。色可能吃进，但需提防内裂。',
    '翻砂均匀，压灯见淡雾。适合避裂取中线。',
    '皮薄水长，局部脱沙。窗口表现值得期待。',
    '形正压手，枯癣附近有色根迹象，下刀要稳。'
  ];
  const quality = Math.pow(random(), 1.42);
  const water = Math.min(1, quality * .78 + random() * .28);
  const color = Math.min(1, quality * .7 + random() * .35);
  const crack = Math.max(0, random() * 1.08 - quality * .28);
  const cotton = Math.max(0, random() * .9 - water * .22);
  const cost = Math.round((5600 + random() * 15600 + shape.volumeScale * 1200) / 100) * 100;
  const weight = Math.round((7.4 + shape.volumeScale * 4.8 + random() * 1.8) * 10) / 10;
  const greenChance = Math.round(22 + color * 53 + random() * 8);
  return {
    seed, quality, water, color, crack, cotton, cost, weight,
    shapeName: shape.shapeName,
    shapeAspect: shape.aspect,
    shapeSize: shape.size,
    origin: origins[Math.floor(random() * origins.length)],
    skin: skins[Math.floor(random() * skins.length)],
    note: notes[Math.floor(random() * notes.length)],
    id: `${['MZ','HK','NM','DK'][Math.floor(random() * 4)]}-${String(Math.floor(1000 + random() * 8999))}`,
    greenChance
  };
}
