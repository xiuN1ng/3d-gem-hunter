import { makeStoneProfile } from './stoneProfile.js';

export const SEASON_DAYS = 30;
export const SUPPLIER_STONE_COUNT = 6;
export const STARTING_MONEY = 128600;

export function createSupplierInventory(seasonSeed, day, count = SUPPLIER_STONE_COUNT) {
  return Array.from({ length: count }, (_, index) => {
    const seed = (seasonSeed + day * 10007 + index * 7919) >>> 0;
    return makeStoneProfile(seed);
  });
}

export function minimumSupplierPrice(inventory) {
  return inventory.reduce((minimum, stone) => Math.min(minimum, stone.cost), Infinity);
}

export function isBankrupt(money, inventory) {
  return inventory.length > 0 && money < minimumSupplierPrice(inventory);
}

export function createSeasonStats() {
  return { totalSpent: 0, totalSales: 0, stonesCut: 0, bestSale: 0 };
}

export function finishReason(day, money, inventory) {
  if (day > SEASON_DAYS) return 'complete';
  if (isBankrupt(money, inventory)) return 'bankrupt';
  return null;
}
