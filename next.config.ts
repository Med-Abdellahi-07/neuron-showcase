import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // كل صفحات التطبيق خلف تسجيل الدخول وديناميكية، لذا نعطّل Cache Components.
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
