import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { initSentry } from "./lib/observability/sentry";
import { installChunkReloadHandler } from "./lib/chunk-reload";
import { initChatwoot } from "./lib/chatwoot";
import "./styles.css";

// Wire Sentry before React mounts so the very first render errors are
// captured. No-op when VITE_SENTRY_DSN is unset, so dev builds and forks
// without a DSN stay quiet. Async because the SDK is dynamic-imported on
// first init; capture() calls before init resolves are queued internally.
void initSentry();

// Stale-deploy chunk recovery: one hard reload when a lazy chunk 404s after
// a deploy renamed the hashed files. Rationale + loop guard in the module.
installChunkReloadHandler();

const router = getRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found — check index.html");
}

createRoot(container).render(<RouterProvider router={router} />);

// Chatwoot live-chat widget. Extracted from an inline <script> in index.html so
// a strict script-src 'self' CSP covers it with no per-build sha256 to drift.
initChatwoot();

// Fade out the inline loading splash after React paints. Keeps the brand
// moment visible briefly even on fast connections so the framing
// ("encrypting in browser") registers.
const splash = document.getElementById("ow-splash");
if (splash) {
  // requestAnimationFrame waits until after the first React paint.
  requestAnimationFrame(() => {
    setTimeout(() => {
      splash.classList.add("ow-splash-leaving");
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    }, 250); // small minimum visibility window
  });
}
