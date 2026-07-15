import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupplierInventory, finishReason, isBankrupt, minimumSupplierPrice, SEASON_DAYS } from '../src/game/season.js';

test('supplier inventory is fixed for a given season and day', () => {
  const first = createSupplierInventory(713, 9);
  const second = createSupplierInventory(713, 9);
  assert.equal(first.length, 6);
  assert.deepEqual(first.map(({ seed, cost, id }) => ({ seed, cost, id })), second.map(({ seed, cost, id }) => ({ seed, cost, id })));
});

test('bankruptcy uses the cheapest available supplier stone', () => {
  const inventory = createSupplierInventory(713, 1);
  const minimum = minimumSupplierPrice(inventory);
  assert.equal(isBankrupt(minimum, inventory), false);
  assert.equal(isBankrupt(minimum - 1, inventory), true);
});

test('season completes only after the thirtieth trading day', () => {
  const inventory = createSupplierInventory(713, 1);
  assert.equal(finishReason(SEASON_DAYS, 999999, inventory), null);
  assert.equal(finishReason(SEASON_DAYS + 1, 999999, inventory), 'complete');
});
