import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderManifest } from "../src/lib/ai-manifest";

/**
 * Build-time prerender of /api/public/ai/manifest.json.
 *
 * The TanStack Start server handler at src/routes/api.public.ai.manifest[.]json.tsx
 * is not active under the static Cloudflare Pages deploy (no SSR runtime),
 * so requests fall through to the SPA shell and return text/html. This
 * plugin writes the manifest as a real static file under
 * dist/api/public/ai/manifest.json so the static host serves it directly
 * with the correct Content-Type from public/_headers.
 *
 * Layout produced (Cloudflare Pages serves these directly):
 *   dist/api/public/ai/manifest.json
 */
export default function prerenderManifestPlugin(): Plugin {
  return {
    name: "prerender-ai-manifest",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      const distDir = path.resolve(process.cwd(), "dist");
      const outPath = path.join(distDir, "api", "public", "ai", "manifest.json");
      const body = JSON.stringify(renderManifest(), null, 2);

      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, body, "utf8");
    },
  };
}
