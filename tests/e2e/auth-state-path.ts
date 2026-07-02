import path from "node:path";

/**
 * Where auth.setup.ts writes the authenticated browser context's
 * storage state, and where the `authenticated` Playwright project
 * reads it from. Kept in its own module so playwright.config.ts can
 * import it without pulling auth.setup.ts (which calls test()) into
 * the configuration loader.
 */
export const AUTH_STATE_PATH = path.join("tests/e2e/.auth", "user.json");
