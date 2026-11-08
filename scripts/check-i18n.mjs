// Automated dictionary check: ensures every key exists in all three languages (ar / fr / en), and that no empty text or raw key
// can reach the user. Runs before every build (prebuild), so an incomplete translation is never deployed.
//   Manual run:  npm run check:i18n
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ---- Load the dictionary TypeScript files without extra build tooling
function load(file, deps = {}) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", js)(mod.exports, (id) => {
    if (id in deps) return deps[id];
    throw new Error(`unexpected import in ${file}: ${id}`);
  }, mod);
  return mod.exports;
}
const { en } = load("src/lib/i18n/en.ts");
const { ar, fr, dictionaries, LOCALES } = load("src/lib/i18n/dictionaries.ts", { "./en": { en } });

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

// ---- 1) The same keys in all three languages
const langs = { ar, fr, en };
const all = new Set([...Object.keys(ar), ...Object.keys(fr), ...Object.keys(en)]);
for (const [name, dict] of Object.entries(langs)) {
  for (const k of all) if (!(k in dict)) fail(`[${name}] missing key: ${k}`);
}
if (LOCALES.join() !== "ar,fr,en") fail(`unexpected LOCALES: ${LOCALES.join()}`);
if (Object.keys(dictionaries).join() !== "ar,fr,en") fail("dictionaries must contain ar, fr and en");

// ---- 2) No empty text, no value equal to its key, no leftover TODO
const ARABIC = /[؀-ۿ]/;
const placeholders = (s) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort().join(",");
for (const k of all) {
  for (const [name, dict] of Object.entries(langs)) {
    const v = dict[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "") fail(`[${name}] empty text: ${k}`);
    else if (v === k) fail(`[${name}] value equals the raw key: ${k}`);
    else if (/\b(TODO|FIXME|XXX)\b/.test(v)) fail(`[${name}] leftover TODO in: ${k}`);
  }
  if (typeof en[k] === "string" && ARABIC.test(en[k])) fail(`[en] Arabic characters in: ${k}`);
  if (typeof fr[k] === "string" && ARABIC.test(fr[k])) fail(`[fr] Arabic characters in: ${k}`);
  if (typeof ar[k] === "string" && typeof fr[k] === "string" && placeholders(ar[k]) !== placeholders(fr[k])) fail(`placeholders {…} differ between ar and fr in: ${k}`);
  if (typeof en[k] === "string" && typeof fr[k] === "string" && placeholders(en[k]) !== placeholders(fr[k])) fail(`placeholders {…} differ between en and fr in: ${k}`);
}

// ---- 3) Every t("...") in the code points to an existing key
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk("src").filter((f) => !f.endsWith("i18n/dictionaries.ts") && !f.endsWith("i18n/en.ts"));
const literal = /\bt\(\s*(["'])([A-Za-z0-9_.]+)\1\s*[,)]/g;
const keyLike = /\b(?:as|:)\s*(?:DictKey|"([a-z0-9_.]+)")/g; // Not checked here: TypeScript covers these
let used = 0;
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(literal)) {
    used += 1;
    if (!(m[2] in ar)) fail(`${f}: t("${m[2]}") key not found in the dictionary`);
  }
}
void keyLike;

// ---- 4) Dynamic keys t(`prefix.${x}`): verify every possible value
const FAMILIES = {
  "kind.": ["cm", "td", "tp", "resume"],
  "status.": ["draft", "pending", "published"],
  "diff.": ["easy", "medium", "hard"],
  "stats.kind.": ["chat", "web", "grade", "analysis", "schedule"],
  "chat.mode.": ["explain", "review", "solve"],
  "chat.pick.desc.": ["explain", "review", "solve"],
  "notif.k.": ["lesson_tomorrow", "schedule_change", "new_content", "duel", "review", "announcement"],
  "day.": ["1", "2", "3", "4", "5", "6"],
  "file.": ["pdf", "code", "data"],
  "qtype.": ["mcq", "written"],
  "role.": ["student", "moderator", "space_admin", "admin"],
  "plan.": ["full", "basic", "custom"],
  "feat.": ["ai", "arena", "ranking", "duel", "review", "recordings", "qcm_pdf", "written"],
  "arena.mode.": ["free", "ranked", "review"],
  "ai.err.": ["break", "busy", "disabled", "unavailable", "noMaterial"],
  "sum.kind.": ["short", "detailed", "sheet", "flashcards"],
  "sum.kindHelp.": ["short", "detailed", "sheet", "flashcards"],
  "aiadm.flag.": ["ai_chat", "ai_summary", "ai_qcm", "ai_duel", "ai_tools", "ai_exam"],
  "aiadm.alertKind.": ["minute", "daily"],
};
for (const [prefix, values] of Object.entries(FAMILIES)) for (const v of values) for (const [name, d] of Object.entries(langs)) if (!(`${prefix}${v}` in d)) fail(`[${name}] مفتاح ديناميكي ناقص: ${prefix}${v}`);
for (const o of ["won", "lost", "draw"]) if (!(`duel.${o}Banner` in en)) fail(`[en] missing key: duel.${o}Banner`);
// Unknown new template: require it to be registered in FAMILIES so a missing key cannot slip through
const template = /\bt\(\s*`([A-Za-z0-9_.]*)\$\{/g;
for (const f of files) {
  for (const m of read(f).matchAll(template)) {
    const prefix = m[1];
    if (prefix === "duel.") continue;
    if (!(prefix in FAMILIES)) fail(`${f}: new dynamic key template t(\`${prefix}\${…}\`): add its prefix to FAMILIES in scripts/check-i18n.mjs`);
  }
}

// ---- 5) Warning (non-blocking): hard-coded Arabic text outside the dictionary in the UI (components and app)
const hard = [];
for (const f of files.filter((f) => /^src[\\/](components|app)[\\/]/.test(f))) {
  read(f).split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/\{\/\*.*?\*\/\}/g, "");
    if (!ARABIC.test(code)) return;
    if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
    if (/\/\^|RegExp|\.replace\(|\.split\(|\.test\(/.test(code)) return; // Regular expressions, not display text
    hard.push(`${f}:${i + 1}`);
  });
}
if (hard.length) warnings.push(`hard-coded Arabic text outside the dictionary (${hard.length}): ${hard.slice(0, 12).join(", ")}${hard.length > 12 ? " …" : ""}`);

// ---- Result
const n = all.size;
if (errors.length) {
  console.error(`✗ i18n check failed (${errors.length}):`);
  for (const e of errors.slice(0, 60)) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ i18n: ${n} keys x 3 languages (ar, fr, en) match, and all ${used} t("…") calls are valid.`);
for (const w of warnings) console.log("  ⚠ " + w);
