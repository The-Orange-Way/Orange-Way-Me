import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // ── react-hooks v5 strict rules — demoted to "warn" ───────────────────
      // The 2026 release of eslint-plugin-react-hooks ships several new
      // strict rules that flag patterns the Orange Way codebase uses widely:
      //   - set-state-in-effect: ~39 sites (form dialogs syncing from
      //     props, async data loads, localStorage hydration). React 19
      //     guidance is useSyncExternalStore / derived useMemo / suspense,
      //     but the existing pattern is correct; bulk refactoring 39 sites
      //     has real regression risk across forms, dialogs, and realtime
      //     listeners.
      //   - immutability: ~5 sites that read/derive from a running
      //     accumulator inside a useMemo body. Safe today (no setState
      //     mid-render) but the rule wants the pattern refactored.
      // Warn-level keeps the signal in CI logs without blocking merges.
      // Migrate per-site when the affected file gets touched for other
      // reasons. Re-promote to "error" once the count drops to single
      // digits.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Cloudflare Pages Functions live in functions/ and bundle to the Worker
  // runtime, not the SPA. React + every SPA-only module (components, hooks,
  // route trees) is unavailable there. A future contributor adding such an
  // import would either crash at runtime or silently balloon the Worker
  // bundle. This block forbids the patterns at lint time. Cross-tree
  // imports from src/lib/ are intentionally still allowed: that's the
  // mechanism used to share validation schemas between client and server
  // (see src/lib/marketing/signup-schema.ts and functions/api/signup.ts).
  {
    files: ["functions/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message:
                "Pages Functions run on the Workers runtime; React is not available. Use a React-free helper instead.",
            },
            {
              name: "react-dom",
              message:
                "Pages Functions run on the Workers runtime; React is not available. Use a React-free helper instead.",
            },
            {
              name: "react-dom/client",
              message:
                "Pages Functions run on the Workers runtime; React is not available. Use a React-free helper instead.",
            },
            {
              name: "@tanstack/react-router",
              message:
                "Pages Functions run on the Workers runtime; the SPA router is not available. Use a React-free helper instead.",
            },
            {
              name: "@tanstack/react-start",
              message:
                "Pages Functions run on the Workers runtime; @tanstack/react-start is SPA-only. Use a React-free helper instead.",
            },
          ],
          // Belt-and-suspenders: this is a denylist of SPA-only path roots
          // (components, hooks, context, routes, pages, integrations,
          // marketing UI, generated route tree, app entrypoint, styles).
          // The whitelist of shared-with-server modules is src/lib/, which
          // must stay React-free — enforced by code review until we add a
          // companion rule restricting react imports under src/lib/.
          patterns: [
            {
              group: [
                "@/components/*",
                "@/hooks/*",
                "@/context/*",
                "@/routes/*",
                "@/pages/*",
                "@/integrations/*",
                "@/marketing/*",
                "@/router",
                "@/router/*",
                "@/routeTree",
                "@/routeTree.gen",
                "@/main",
                "@/main.*",
                "@/styles/*",
                "@/lib/marketing/useSignupForm",
                "@/lib/connectors/flows/*",
              ],
              message:
                "Pages Functions cannot import SPA-only modules. If you need shared logic, factor it into a React-free helper under src/lib/ (see signup-schema.ts for the canonical pattern).",
            },
          ],
        },
      ],
    },
  },
  eslintPluginPrettier,
);
