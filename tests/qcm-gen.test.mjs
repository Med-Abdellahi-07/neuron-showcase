import test from "node:test";
import assert from "node:assert/strict";
import { parseCount, splitCount } from "../src/lib/ai/qcm-count.ts";

test("parseCount accepts only integers in range", () => {
  assert.equal(parseCount("1", 1, 50), 1);
  assert.equal(parseCount("50", 1, 50), 50);
  assert.equal(parseCount("0", 1, 50), null);
  assert.equal(parseCount("51", 1, 50), null);
  assert.equal(parseCount("7.5", 1, 50), null);
  assert.equal(parseCount("abc", 1, 50), null);
  assert.equal(parseCount("", 1, 50), null);
  assert.equal(parseCount(null, 1, 50), null);
});
test("splitCount makes balanced chunks <= 10 that sum to count", () => {
  for (let n = 1; n <= 50; n++) {
    const p = splitCount(n);
    assert.equal(p.reduce((a, b) => a + b, 0), n);
    assert.ok(p.every((x) => x >= 1 && x <= 10), String(n));
    assert.ok(Math.max(...p) - Math.min(...p) <= 1);
  }
  assert.deepEqual(splitCount(25), [9, 8, 8]);
});
