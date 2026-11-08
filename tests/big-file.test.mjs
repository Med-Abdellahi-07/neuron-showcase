import test from "node:test";
import assert from "node:assert/strict";
import { PART_SIZE, partCountFor, partPath, manifestHash, sha256Hex, fetchJoined, withRetry, Cancelled } from "../src/lib/big-file.ts";

test("chunking limits", () => {
  assert.equal(PART_SIZE, 45 * 1024 * 1024);
  assert.equal(partCountFor(1), 1);
  assert.equal(partCountFor(PART_SIZE), 1);
  assert.equal(partCountFor(PART_SIZE + 1), 2);
  assert.equal(partCountFor(100 * 1024 * 1024), 3);
  assert.equal(partPath("l/f", 0), "l/f/part-001");
  assert.equal(partPath("l/f", 11), "l/f/part-012");
});

test("known sha256 and a stable manifest fingerprint", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc").buffer), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await manifestHash(["a", "b"]), await sha256Hex(new TextEncoder().encode("ab").buffer));
});

test("retry succeeds after a transient failure and stops on cancel", async () => {
  let n = 0;
  assert.equal(await withRetry(async () => { if (++n < 3) throw new Error("x"); return "ok"; }, undefined, 4), "ok");
  const ac = new AbortController(); ac.abort();
  await assert.rejects(() => withRetry(async () => 1, ac.signal), Cancelled);
});

test("parts are joined in order with hash verification and a corrupt part is rejected", async () => {
  const parts = [Buffer.from("AAAA"), Buffer.from("BB"), Buffer.from("C")];
  const hashes = await Promise.all(parts.map((p) => sha256Hex(new Uint8Array(p).buffer)));
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => new Response(parts[Number(String(u).slice(-1))]);
  try {
    const progress = [];
    const blob = await fetchJoined(["u0", "u1", "u2"].map((u, i) => `http://x/${i}`), { hashes, onProgress: (d) => progress.push(d) });
    assert.equal(Buffer.from(await blob.arrayBuffer()).toString(), "AAAABBC");
    assert.deepEqual(progress, [1, 2, 3]);
    globalThis.fetch = async (u) => new Response(Buffer.from("zzz"));
    await assert.rejects(() => fetchJoined(["http://x/0"], { hashes }), /hash/);
  } finally { globalThis.fetch = real; }
});
