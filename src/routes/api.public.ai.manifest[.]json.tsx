import { createFileRoute } from "@tanstack/react-router";
import { renderManifest } from "@/lib/ai-manifest";

/**
 * Runtime fallback for /api/public/ai/manifest.json when a server runtime
 * is wired up (TanStack Start adapter). On the current Cloudflare Pages
 * deploy this handler is NOT active; the manifest is served as a static
 * file written by scripts/prerender-manifest-plugin.ts.
 *
 * Both code paths import { AI_MANIFEST } from "@/lib/ai-manifest" so the
 * static and runtime outputs can never drift.
 */
export const Route = createFileRoute("/api/public/ai/manifest.json")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify(renderManifest(), null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
    },
  },
});
