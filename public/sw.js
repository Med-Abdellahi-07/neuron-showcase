// Neuron service worker v3 — يعمل التطبيق بدون إنترنت.
//  • عند التثبيت: يحمّل قشرة /offline كاملة (HTML + كل JS/CSS + الخطوط + الأيقونات + manifest) في كاش خاص بنسخة البناء.
//  • النسخة الجديدة لا تحذف القديمة إلا بعد اكتمال تحميل قشرتها (install يفشل كلياً إن نقص أي ملف فتبقى القديمة).
//  • /_next/static (ثابتة بالهاش): الكاش أولاً. التنقّل: الشبكة أولاً بمهلة 3 ثوانٍ ثم القشرة المحلية.
//  • الصفحات الخاصة بالمستخدم لا تُخزَّن أبداً. /offline لا تحوي بيانات (تقرأ من IndexedDB على الجهاز).
importScripts("/sw-build.js");

const BUILD = self.NEURON_BUILD || "dev";
const SHELL = "neuron-shell-" + BUILD;
const OFFLINE_URL = "/offline";
const EXTRA = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.ico"];
const NAV_TIMEOUT_MS = 3000;

/** كل مسارات /_next/static المذكورة في HTML الصفحة (وسوم script/link وبيانات RSC المضمّنة) */
function extractAssets(html) {
  const out = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) out.add(decodeURIComponent(m[0].replace(/&amp;/g, "&")));
  for (const m of html.matchAll(/(?:^|[^\w/])(static\/(?:chunks|css|media)\/[^"'\\\s)<>]+)/g)) out.add("/_next/" + m[1]);
  return [...out];
}

async function put(cache, url) {
  const res = await fetch(url, { cache: "reload", credentials: "same-origin" });
  if (!res.ok) throw new Error(url + " " + res.status);
  await cache.put(url, res);
  return res;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL);
        const res = await fetch(OFFLINE_URL, { cache: "reload", credentials: "same-origin" });
        if (!res.ok) throw new Error("shell " + res.status);
        const html = await res.clone().text();
        await cache.put(OFFLINE_URL, res);
        const assets = new Set([...extractAssets(html), ...EXTRA]);
        await Promise.all([...assets].map((u) => put(cache, u)));
        // خطوط وصور داخل ملفات CSS
        const fonts = new Set();
        for (const u of assets) {
          if (!u.endsWith(".css")) continue;
          const css = await (await cache.match(u)).text();
          for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
            const f = m[1].replace(/^["']|["']$/g, "");
            if (!f.startsWith("data:")) fonts.add(new URL(f, new URL(u, self.location.origin)).pathname);
          }
        }
        await Promise.all([...fonts].map((u) => put(cache, u)));
        // اكتمل التحميل: الآن فقط نتجاوز الانتظار فتحلّ النسخة محل القديمة
        await self.skipWaiting();
      } catch (e) {
        await caches.delete(SHELL); // لا قشرة ناقصة أبداً؛ تبقى النسخة القديمة تعمل
        throw e;
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("neuron-") && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

const shell = () => caches.match(OFFLINE_URL, { ignoreSearch: true });

async function cacheFirst(request) {
  const hit = await caches.match(request, { ignoreSearch: new URL(request.url).pathname === OFFLINE_URL });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && new URL(request.url).pathname.startsWith("/_next/static/")) {
    const copy = res.clone();
    caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

function fetchWithTimeout(request, ms) {
  if (!ms) return fetch(request);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(request, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

async function navigation(request, url) {
  if (url.pathname === OFFLINE_URL) return (await shell()) || fetch(request);
  // ?online=1 (زر «العودة إلى التطبيق») بلا مهلة؛ وفشله يعيد إلى القشرة المحلية
  const patient = url.searchParams.get("online") === "1";
  try {
    const res = await fetchWithTimeout(request, patient ? 0 : NAV_TIMEOUT_MS);
    if (res.status >= 500) throw new Error("server " + res.status);
    // أجاب بتحويل (غالباً إلى /login لتعذّر تجديد الجلسة) والجهاز غير متصل فعلياً: التطبيق المحلي أفضل
    if (res.type === "opaqueredirect" && self.navigator && self.navigator.onLine === false) throw new Error("redirect-offline");
    return res;
  } catch {
    return (await shell()) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request, url));
    return;
  }
  const p = url.pathname;
  if (p.startsWith("/_next/static/") || p.startsWith("/icons/") || p === "/manifest.webmanifest" || p === "/favicon.ico" || p === OFFLINE_URL) {
    event.respondWith(cacheFirst(request));
  }
});

// ───────── Web Push ─────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Neuron", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Neuron";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c && c.url.startsWith(self.location.origin)) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
