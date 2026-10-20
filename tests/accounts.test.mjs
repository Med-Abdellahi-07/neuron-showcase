import test from "node:test";
import assert from "node:assert/strict";
import { parseAccountRows, MAX_ACCOUNT_ROWS } from "../src/lib/account-import.ts";

test("عنوان بالإنجليزية/العربية يُتعرَّف عليه ويُتجاوز", () => {
  const r = parseAccountRows([["الاسم", "الهاتف", "كلمة السر"], ["أحمد", "22244556677", ""], ["Fatima", "f@x.com", "Secret2026"]]);
  assert.equal(r.valid.length, 2);
  assert.equal(r.valid[0].phone, "22244556677");
  assert.equal(r.valid[0].password, null);
  assert.equal(r.valid[1].email, "f@x.com");
  assert.equal(r.valid[1].password, "Secret2026");
});
test("بلا عنوان: الترتيب اسم، معرّف، كلمة سر", () => {
  const r = parseAccountRows([["Ali", "+222 44 55 66 77"], ["Sara", "sara@x.org", "12345678"]]);
  assert.equal(r.valid.length, 2);
  assert.equal(r.valid[0].email, "22244556677@phone.neuron.local");
});
test("أخطاء الصفوف: اسم، معرّف، كلمة سر قصيرة، تكرار", () => {
  const r = parseAccountRows([["name", "identifier", "password"], ["", "a@b.co", ""], ["X", "not-an-id", ""], ["Y", "y@b.co", "short"], ["Z", "z@b.co", ""], ["Z2", "Z@b.co", ""]]);
  assert.deepEqual(r.errors.map((e) => e.key), ["acc.imp.err.name", "acc.imp.err.identifier", "acc.imp.err.password", "acc.imp.err.duplicate"]);
  assert.equal(r.valid.length, 1);
});
test("الصفوف الفارغة تُتجاهل والحد الأقصى يُفرض", () => {
  const many = Array.from({ length: MAX_ACCOUNT_ROWS + 5 }, (_, i) => [`N${i}`, `${10000000 + i}`]);
  const r = parseAccountRows([[], ["", ""], ...many]);
  assert.equal(r.valid.length, MAX_ACCOUNT_ROWS);
  assert.equal(r.tooMany, true);
});
test("أعمدة بترتيب مختلف مع العنوان", () => {
  const r = parseAccountRows([["email", "full_name"], ["a@b.co", "Amine"]]);
  assert.equal(r.valid[0].full_name, "Amine");
});
