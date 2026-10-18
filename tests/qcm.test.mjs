import test from "node:test";
import assert from "node:assert/strict";
import { QCM_COUNTS, chunk, optionLetter, parseQcmParams, scopeLabel } from "../src/lib/qcm.ts";
import { parseQuestionInput, QUESTION_CSV_EXAMPLE } from "../src/lib/question-import.ts";

const L = "123e4567-e89b-42d3-a456-426614174000";

test("باراميترات التنزيل: القيم الافتراضية والحصر", () => {
  const d = parseQcmParams({});
  assert.deepEqual(d, { subjectCode: "", lesson: null, from: null, to: null, difficulty: null, count: 20, shuffle: false, explain: false });
  assert.equal(parseQcmParams({ count: "9999" }).count, 50);
  assert.equal(parseQcmParams({ count: "0" }).count, 1);
  assert.equal(parseQcmParams({ count: "abc" }).count, 20);
  assert.equal(parseQcmParams({ difficulty: "hard" }).difficulty, "hard");
  assert.equal(parseQcmParams({ difficulty: "x'; drop" }).difficulty, null);
  assert.equal(parseQcmParams({ shuffle: "1", explain: "1" }).shuffle, true);
  assert.equal(parseQcmParams({ explain: "on" }).explain, false);
});

test("الحصة تلغي النطاق؛ UUID غير صالح يُهمل", () => {
  const p = parseQcmParams({ lesson: L, from: "2", to: "5" });
  assert.equal(p.lesson, L);
  assert.equal(p.from, null);
  assert.equal(p.to, null);
  assert.equal(parseQcmParams({ lesson: "not-a-uuid" }).lesson, null);
  assert.equal(parseQcmParams({ from: "2", to: "5" }).from, 2);
  assert.equal(parseQcmParams({ from: "-3" }).from, null);
});

test("خيارات العدد: 10 و20 و30 و«الكل» = 50", () => {
  assert.deepEqual([...QCM_COUNTS], [10, 20, 30, 50]);
});

test("حروف الخيارات", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(optionLetter), ["A", "B", "C", "D", "E"]);
});

test("تقسيم جداول الأجوبة (10 صفوف لكل جدول)", () => {
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  const c = chunk(nums);
  assert.deepEqual(c.map((x) => x.length), [10, 10, 5]);
  assert.equal(c[2][0], 21);
  assert.equal(chunk(nums.slice(0, 10)).length, 1);
  assert.deepEqual(chunk([]), []);
});

test("تسمية النطاق", () => {
  const w = { all: "كل الحصص", lessons: "الحصص", lesson: "الحصة" };
  assert.equal(scopeLabel({ lessonLabel: "CM 3", from: null, to: null }, w), "الحصة CM 3");
  assert.equal(scopeLabel({ lessonLabel: null, from: 2, to: 5 }, w), "الحصص 2–5");
  assert.equal(scopeLabel({ lessonLabel: null, from: 4, to: null }, w), "الحصص 4–…");
  assert.equal(scopeLabel({ lessonLabel: null, from: null, to: null }, w), "كل الحصص");
});

test("الرفع الجماعي: عمود exam_only اختياري (JSON)", () => {
  const base = { subject: "LIAA311", type: "mcq", statement: "Question ?", options: ["a", "b"], correct: "A" };
  const r = parseQuestionInput(JSON.stringify([base, { ...base, exam_only: true }, { ...base, exam_only: "oui" }, { ...base, exam_only: "0" }, { ...base, exam_only: "" }]));
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.valid.map((q) => q.exam_only), [false, true, true, false, false]);
});

test("الرفع الجماعي: عمود exam_only في CSV، والمثال الرسمي يعمل", () => {
  const ex = parseQuestionInput(QUESTION_CSV_EXAMPLE);
  assert.equal(ex.errors.length, 0, JSON.stringify(ex.errors));
  assert.equal(ex.valid.length, 2);
  assert.ok(ex.valid.every((q) => q.exam_only === false));
  const csv = `subject,type,statement,option_a,option_b,correct,exam_only\nLIAA311,mcq,"Q1 ?",x,y,A,true\nLIAA311,mcq,"Q2 ?",x,y,B,\n`;
  const r = parseQuestionInput(csv);
  assert.deepEqual(r.valid.map((q) => q.exam_only), [true, false]);
});

test("ملف قديم بلا عمود exam_only يبقى صالحاً", () => {
  const csv = `subject,type,statement,option_a,option_b,correct\nLIAA311,mcq,"Q1 ?",x,y,A\n`;
  const r = parseQuestionInput(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.valid[0].exam_only, false);
});
