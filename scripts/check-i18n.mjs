// فحص آلي للقاموس: يتأكد أن كل مفاتيح اللغات الثلاث (ar / fr / en) موجودة، وأن لا نصاً فارغاً أو مفتاحاً خاماً
// سيظهر للمستخدم. يعمل قبل كل بناء (prebuild)، فلا يُنشر إصدار ناقص الترجمة.
//   تشغيل يدوي:  npm run check:i18n
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// ───── تحميل ملفات TypeScript الخاصة بالقاموس بلا أدوات بناء إضافية
function load(file, deps = {}) {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", js)(mod.exports, (id) => {
    if (id in deps) return deps[id];
    throw new Error(`import غير متوقع في ${file}: ${id}`);
  }, mod);
  return mod.exports;
}
const { en } = load("src/lib/i18n/en.ts");
const { ar, fr, dictionaries, LOCALES } = load("src/lib/i18n/dictionaries.ts", { "./en": { en } });

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);

// ───── 1) نفس المفاتيح في اللغات الثلاث
const langs = { ar, fr, en };
const all = new Set([...Object.keys(ar), ...Object.keys(fr), ...Object.keys(en)]);
for (const [name, dict] of Object.entries(langs)) {
  for (const k of all) if (!(k in dict)) fail(`[${name}] مفتاح ناقص: ${k}`);
}
if (LOCALES.join() !== "ar,fr,en") fail(`LOCALES غير متوقعة: ${LOCALES.join()}`);
if (Object.keys(dictionaries).join() !== "ar,fr,en") fail("dictionaries يجب أن تضم ar و fr و en");

// ───── 2) لا نص فارغ، ولا قيمة تساوي مفتاحها، ولا بقايا TODO
const ARABIC = /[؀-ۿ]/;
const placeholders = (s) => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort().join(",");
for (const k of all) {
  for (const [name, dict] of Object.entries(langs)) {
    const v = dict[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim() === "") fail(`[${name}] نص فارغ: ${k}`);
    else if (v === k) fail(`[${name}] القيمة تساوي المفتاح الخام: ${k}`);
    else if (/\b(TODO|FIXME|XXX)\b/.test(v)) fail(`[${name}] بقايا TODO في: ${k}`);
  }
  if (typeof en[k] === "string" && ARABIC.test(en[k])) fail(`[en] حروف عربية في: ${k}`);
  if (typeof fr[k] === "string" && ARABIC.test(fr[k])) fail(`[fr] حروف عربية في: ${k}`);
  if (typeof ar[k] === "string" && typeof fr[k] === "string" && placeholders(ar[k]) !== placeholders(fr[k])) fail(`المتغيرات {…} مختلفة بين ar و fr في: ${k}`);
  if (typeof en[k] === "string" && typeof fr[k] === "string" && placeholders(en[k]) !== placeholders(fr[k])) fail(`المتغيرات {…} مختلفة بين en و fr في: ${k}`);
}

// ───── 3) كل t("…") في الكود يشير إلى مفتاح موجود
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
const keyLike = /\b(?:as|:)\s*(?:DictKey|"([a-z0-9_.]+)")/g; // لا نفحصها: TypeScript يتكفّل بها
let used = 0;
for (const f of files) {
  const src = read(f);
  for (const m of src.matchAll(literal)) {
    used += 1;
    if (!(m[2] in ar)) fail(`${f}: t("${m[2]}") مفتاح غير موجود في القاموس`);
  }
}
void keyLike;

// ───── 4) المفاتيح الديناميكية t(`prefix.${x}`): تتأكد من كل قيمة ممكنة
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
  "role.": ["student", "moderator", "admin"],
  "arena.mode.": ["free", "ranked", "review"],
};
for (const [prefix, values] of Object.entries(FAMILIES)) for (const v of values) for (const [name, d] of Object.entries(langs)) if (!(`${prefix}${v}` in d)) fail(`[${name}] مفتاح ديناميكي ناقص: ${prefix}${v}`);
for (const o of ["won", "lost", "draw"]) if (!(`duel.${o}Banner` in en)) fail(`[en] مفتاح ناقص: duel.${o}Banner`);
// قالب جديد غير معروف؟ نطلب تسجيله في FAMILIES كي لا يفلت مفتاح ناقص
const template = /\bt\(\s*`([A-Za-z0-9_.]*)\$\{/g;
for (const f of files) {
  for (const m of read(f).matchAll(template)) {
    const prefix = m[1];
    if (prefix === "duel.") continue;
    if (!(prefix in FAMILIES)) fail(`${f}: قالب مفتاح ديناميكي جديد t(\`${prefix}\${…}\`): أضف بادئته إلى FAMILIES في scripts/check-i18n.mjs`);
  }
}

// ───── 5) تحذير (غير مانع): نصوص عربية صلبة خارج القاموس في الواجهة (components و app)
const hard = [];
for (const f of files.filter((f) => /^src[\\/](components|app)[\\/]/.test(f))) {
  read(f).split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/\{\/\*.*?\*\/\}/g, "");
    if (!ARABIC.test(code)) return;
    if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;
    if (/\/\^|RegExp|\.replace\(|\.split\(|\.test\(/.test(code)) return; // تعابير نمطية لا نصوص عرض
    hard.push(`${f}:${i + 1}`);
  });
}
if (hard.length) warnings.push(`نصوص عربية صلبة خارج القاموس (${hard.length}): ${hard.slice(0, 12).join(", ")}${hard.length > 12 ? " …" : ""}`);

// ───── النتيجة
const n = all.size;
if (errors.length) {
  console.error(`✗ فحص الترجمة فشل (${errors.length}):`);
  for (const e of errors.slice(0, 60)) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ i18n: ${n} مفتاحاً × 3 لغات (ar, fr, en) متطابقة، و${used} استدعاء t("…") كلها صالحة.`);
for (const w of warnings) console.log("  ⚠ " + w);
