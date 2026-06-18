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
  eslintPluginPrettier,
);
