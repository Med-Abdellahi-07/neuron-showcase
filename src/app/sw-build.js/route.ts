export const dynamic = "force-static";

/** Exposes the build version id to the service worker (importScripts). No private data; public, no session. */
export function GET() {
  const id = (process.env.NEXT_PUBLIC_BUILD_ID ?? "dev").replace(/[^\w.-]/g, "");
  return new Response(`self.NEURON_BUILD = ${JSON.stringify(id)};\n`, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache, max-age=0" },
  });
}
