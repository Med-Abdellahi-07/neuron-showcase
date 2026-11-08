import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { MULTI_SPACE } from "@/lib/flags";

// /api/cron/notify is protected by the CRON_SECRET inside the route itself (Vercel Cron has no session).
const PUBLIC_PATHS = ["/login", "/forgot", "/auth", "/api/cron", "/offline"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims: local JWT verification (no network request with asymmetric keys) + refreshes the session before it expires.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));

  // Single space: multi-space pages do not exist (a real 404 status, not an empty page with 200).
  if (!MULTI_SPACE && (path === "/admin/spaces" || path.startsWith("/admin/spaces/"))) {
    return NextResponse.rewrite(new URL("/not-found-multi-space-off", request.url), { status: 404 });
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|sw-build.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
