/**
 * يضمن أن صفحة /offline وأصولها (JS/CSS/خطوط) في كاش الـservice worker قبل أن ينقطع الاتصال:
 * نجلب HTML الصفحة ثم كل ما فيه من /_next/static، ونتتبع url(...) داخل ملفات CSS (الخطوط).
 */
export async function primeOfflineShell(): Promise<void> {
  const html = await (await fetch("/offline", { cache: "reload" })).text();
  const urls = new Set<string>(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? []);
  const css = [...urls].filter((u) => u.endsWith(".css"));
  await Promise.all([...urls].map((u) => fetch(u).catch(() => null)));
  for (const c of css) {
    try {
      const text = await (await fetch(c)).text();
      const base = new URL(c, location.origin);
      const fonts = [...text.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/^["']|["']$/g, "")).filter((u) => !u.startsWith("data:"));
      await Promise.all(fonts.map((u) => fetch(new URL(u, base)).catch(() => null)));
    } catch {
      /* تجاهل */
    }
  }
}
