import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Widened from the original __tests__-only pattern. The previous glob
    //   ["src/**/__tests__/**/*.test.ts", ...]
    // silently missed .test.tsx files and any test colocated next to its
    // source outside an __tests__/ directory, both with CI still green.
    // This pattern captures every test under src/ regardless of directory
    // structure or extension. The supabase/functions glob is unchanged:
    // those files run under Deno (deno-typecheck job), not vitest.
    include: ["src/**/*.test.{ts,tsx}", "supabase/functions/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Mirror vite.config.ts: force the CJS entry. The package's ESM build
      // references an internal module the resolver can't find, so tests that
      // pull in libsodium (opk.ts -> VaultContext -> HouseholdPage) fail to load.
      "libsodium-wrappers-sumo": path.resolve(
        __dirname,
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js",
      ),
    },
  },
});
