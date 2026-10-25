import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMath as n } from "../src/lib/math.ts";

test("delimiters \\( \\) and \\[ \\]", () => {
  assert.equal(n("a \\(x^2\\) b"), "a $x^2$ b");
  assert.match(n("\\[E=mc^2\\]"), /\$\$E=mc\^2\$\$/);
});
test("bare latex is wrapped", () => {
  assert.equal(n("نتيجة \\frac{a}{b} هنا"), "نتيجة $\\frac{a}{b}$ هنا");
  assert.equal(n("x^{2}+1"), "$x^{2}+1$");
  assert.equal(n("{}^*"), "${}^*$");
});
test("existing math and code untouched", () => {
  assert.equal(n("$\\frac{a}{b}$"), "$\\frac{a}{b}$");
  assert.equal(n("$$x^{2}$$"), "$$x^{2}$$");
  assert.equal(n("`a^{b}`"), "`a^{b}`");
  assert.equal(n("```\n\\frac{a}{b}\n```"), "```\n\\frac{a}{b}\n```");
});
test("plain text unchanged", () => { assert.equal(n("مرحبا hello 5$ و 6$"), "مرحبا hello 5$ و 6$"); });
