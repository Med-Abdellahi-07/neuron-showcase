import type { NextConfig } from "next";

/**
 * معرّف نسخة البناء: يتغيّر مع كل نشر. يُحقن في /sw-build.js فيتغيّر بايتات الـservice worker
 * (المتصفح يفحص السكربتات المستوردة أيضاً) فيُعاد تحميل قشرة التطبيق المحلية مع كل نسخة جديدة.
 * على Vercel نستعمل SHA الالتزام (ثابت بين البناء والتشغيل)، وإلا وقت التحميل.
 */
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
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
