import { mulberry32 } from '../volume/noise.js';

export function makeStoneProfile(seed) {
  const random = mulberry32(seed);
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
  const cost = Math.round((5600 + random() * 15600) / 100) * 100;
  const weight = 12 + random() * 13;
  const greenChance = Math.round(22 + color * 53 + random() * 8);
  return {
    seed, quality, water, color, crack, cotton, cost, weight,
    origin: origins[Math.floor(random() * origins.length)],
    skin: skins[Math.floor(random() * skins.length)],
    note: notes[Math.floor(random() * notes.length)],
    id: `${['MZ','HK','NM','DK'][Math.floor(random() * 4)]}-${String(Math.floor(1000 + random() * 8999))}`,
    greenChance
  };
}
