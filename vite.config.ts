import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import prerenderMarketingPlugin from "./scripts/prerender-plugin";
import prerenderManifestPlugin from "./scripts/prerender-manifest-plugin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    // Build-time per-route HTML prerender (mirrors V3 pattern).
    mode !== "development" && prerenderMarketingPlugin(),
    // Build-time static prerender for /api/public/ai/manifest.json (issue #7).
    mode !== "development" && prerenderManifestPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Force the CJS entry. The package's ESM build (modules-sumo-esm)
      // has an internal import the bundler can't resolve; main points at
      // the CJS build, which the commonjs plugin handles cleanly.
      "libsodium-wrappers-sumo": path.resolve(
        __dirname,
        "./node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js",
      ),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
      "@tanstack/react-router",
    ],
  },
  build: {
    // 'hidden' emits source maps to disk but does NOT reference them in the
    // JS bundle (no //# sourceMappingURL=). Customers won't see them; we can
    // upload to an error tracker (PostHog / Sentry-style) to map prod errors.
    // 'inline' would leak source into the bundle — never use for prod.
    // false would make prod errors un-mappable.
    sourcemap: "hidden",
    // NOTE on manualChunks: we experimented with bucketing vendors (lucide,
    // recharts, supabase, @noble, @tanstack, radix) into named chunks. Every
    // variant *regressed* marketing first-paint bytes because Rollup's manual
    // bucketing pulls shared deps (react, jsx-runtime) into the named chunk,
    // then collapses sibling chunks into the entry's static-import graph.
    // Vite's automatic route-level splitting (driven by TanStack Router's
    // autoCodeSplitting) already isolates these libraries behind lazy route
    // boundaries. The real perf-1 wins live elsewhere in this PR:
    //   1) MarketingShell no longer imports lucide-react (inline SVG).
    //   2) Toaster (sonner -> lucide transitive) is lazy-loaded in __root.
    // ZKA invariant unchanged: @noble stays out of marketing entry chunks.
  },
}));
