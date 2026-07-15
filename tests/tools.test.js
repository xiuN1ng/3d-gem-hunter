import test from 'node:test';
import assert from 'node:assert/strict';
import { CUTTING_TOOL_LIST, CUTTING_TOOLS } from '../src/game/tools.js';

test('cutting tools expose distinct physical operating profiles', () => {
  assert.deepEqual(CUTTING_TOOL_LIST.map((tool) => tool.id), ['saw', 'wire', 'burr']);
  assert.equal(new Set(CUTTING_TOOL_LIST.map((tool) => tool.duration)).size, 3);
  for (const tool of CUTTING_TOOL_LIST) {
    assert.ok(tool.label.length > 1);
    assert.ok(tool.subtitle.length > 1);
    assert.equal(CUTTING_TOOLS[tool.id], tool);
  }
});
