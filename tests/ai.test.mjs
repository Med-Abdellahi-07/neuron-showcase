import test from "node:test";
import assert from "node:assert/strict";
import { validateGenerated } from "../src/lib/ai/qcm-validate.ts";
import { PERSONAL_CHAIN, GENERAL_CHAIN } from "../src/lib/ai/chain-order.ts";
import { pressureFor, dailyLimit } from "../src/lib/ai/pressure-model.ts";

const mat = { pages: new Map([[1, new Set([2, 3])], [2, new Set([7])]]), lessons: [{ index: 1, id: "L-a", kind: "cm", number: 1, title: "A" }, { index: 2, id: "L-b", kind: "td", number: 2, title: "B" }] };
const good = { statement: "Q ?", options: ["a", "b", "c", "d"], correct_index: 2, explanation: "because", lesson: 1, page: 3 };

test("سؤال سليم يُقبل مع الدرس والصفحة", () => {
  const [q] = validateGenerated([good], mat);
  assert.equal(q.correctIndex, 2); assert.equal(q.lessonId, "L-a"); assert.equal(q.page, 3);
});
test("صفحة غير موجودة في مقاطع الدرس تُهمل (لا صفحة مخترعة)", () => {
  const [q] = validateGenerated([{ ...good, page: 99 }], mat);
  assert.equal(q.page, null);
  const [r] = validateGenerated([{ ...good, lesson: 2, page: 3 }], mat); // الصفحة 3 ليست في الدرس 2
  assert.equal(r.page, null); assert.equal(r.lessonId, "L-b");
});
test("بنى مرفوضة: 3 خيارات، خيارات مكررة، فهرس خارج 0-3، بلا شرح، خيار فارغ", () => {
  const bad = [
    { ...good, options: ["a", "b", "c"] }, { ...good, options: ["a", "a", "c", "d"] },
    { ...good, correct_index: 4 }, { ...good, correct_index: -1 }, { ...good, correct_index: "x" },
    { ...good, explanation: "" }, { ...good, options: ["a", "b", "", "d"] }, { ...good, statement: " " }, { ...good, options: "abcd" },
  ];
  assert.equal(validateGenerated(bad, mat).length, 0);
});
test("رقم الدرس غير معروف مع درس واحد فقط يُنسب إليه، ومع عدة دروس يبقى فارغاً", () => {
  const one = { pages: new Map([[1, new Set([2])]]), lessons: [mat.lessons[0]] };
  assert.equal(validateGenerated([{ ...good, lesson: 9 }], one)[0].lessonId, "L-a");
  assert.equal(validateGenerated([{ ...good, lesson: 9 }], mat)[0].lessonId, null);
});
test("Mistral مستبعد نهائياً، والمحتوى غير الشخصي يبدأ بـ Gemini", () => {
  assert.ok(!PERSONAL_CHAIN.includes("mistral") && !GENERAL_CHAIN.includes("mistral"));
  assert.deepEqual(PERSONAL_CHAIN, ["groq", "openrouter", "nvidia", "github", "gemini"]);
  assert.equal(GENERAL_CHAIN[0], "gemini");
  assert.equal(PERSONAL_CHAIN.at(-1), "gemini"); // احتياط أخير
});
test("وضع الضغط: عتبات متدرّجة", () => {
  assert.equal(pressureFor(0), 1); assert.equal(pressureFor(0.64), 1);
  assert.equal(pressureFor(0.65), 0.75); assert.equal(pressureFor(0.8), 0.5); assert.equal(pressureFor(0.95), 0.3);
  assert.ok(dailyLimit("groq") > 0);
});
