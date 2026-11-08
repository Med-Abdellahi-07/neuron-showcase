import test from "node:test";
import assert from "node:assert/strict";
import { parentPath } from "../src/lib/nav.ts";

test("parent page for each internal path", () => {
  assert.equal(parentPath("/subjects"), "/");
  assert.equal(parentPath("/subjects/LIAA311"), "/subjects");
  assert.equal(parentPath("/subjects/LIAA311/cm"), "/subjects/LIAA311");
  assert.equal(parentPath("/assistant/qcm/abc"), "/assistant/qcm");
  assert.equal(parentPath("/admin/ai"), "/admin");
  assert.equal(parentPath("/"), "/");
});
