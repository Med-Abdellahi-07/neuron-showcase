import test from "node:test";
import assert from "node:assert/strict";
import { mergeMessages, nameColor } from "../src/lib/chat-format.ts";

test("mergeMessages: no duplicates, sorted, deletions in the latest window win", () => {
  const older = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const latest = [{ id: 3 }, { id: 5 }]; // id 4 is deleted
  assert.deepEqual(mergeMessages(older, latest).map((m) => m.id), [1, 2, 3, 5]);
  assert.deepEqual(mergeMessages([], latest).map((m) => m.id), [3, 5]);
  assert.deepEqual(mergeMessages(older, []).map((m) => m.id), [1, 2, 3]);
});
test("nameColor is stable", () => {
  assert.equal(nameColor("abc"), nameColor("abc"));
  assert.match(nameColor("x"), /^#[0-9A-F]{6}$/);
});
