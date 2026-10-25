import test from "node:test";
import assert from "node:assert/strict";
import { gradeLocal } from "../src/lib/offline/grade.ts";

const qs = [0, 1, 2].map((c, n) => ({ n, statement: "q", options: ["a", "b", "c"], correct: c, explanation: null }));
test("local grading", () => {
  const g = gradeLocal(qs, [0, 2, 2]);
  assert.deepEqual([g.correct, g.total, g.pct], [2, 3, 67]);
  assert.deepEqual(g.wrong, [1]);
});
test("unanswered is wrong, empty is 0", () => {
  assert.equal(gradeLocal(qs, [-1, -1, -1]).correct, 0);
  assert.equal(gradeLocal([], []).pct, 0);
});
