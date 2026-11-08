import type { NextConfig } from "next";

/**
 * Build id: changes on every deploy. It is injected into /sw-build.js, which changes the service worker bytes
 * (browsers also check imported scripts), so the local app shell is reloaded with each new version.
 * On Vercel we use the commit SHA (stable between build and runtime), otherwise the load time.
 */
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // Every app page is behind login and dynamic, so Cache Components are disabled.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
