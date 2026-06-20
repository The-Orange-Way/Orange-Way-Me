import { useEffect, useState, lazy, Suspense } from "react";
import { Outlet, Link, createRootRoute, HeadContent, useLocation } from "@tanstack/react-router";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

import { AuthProvider } from "@/context/AuthContext";
import { VaultProvider } from "@/context/VaultContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RootErrorFallback } from "@/components/error/RootErrorFallback";
import { logBoundaryError } from "@/components/error/logError";
import { refreshLiveBTCRate } from "@/lib/orbi-rates";
import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";

// Toaster is lazy-loaded: sonner transitively imports lucide-react icons
// (CheckCircle, Info, etc.), which would otherwise drag the entire
// icons-lucide chunk (~611 KB) into the marketing entry's static graph.
// We don't render toasts on first paint anyway — deferring this is free.
const Toaster = lazy(() => import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })));

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    // Per-route head() in src/routes/*.tsx overrides title, description,
    // og:*, twitter:* with page-specific values. Defaults for non-overriding
    // routes live in /index.html so search engines / AI crawlers see them
    // even when JS doesn't execute.
    meta: [
      {
        name: "robots",
        content: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  // Root-level error boundary. Catches any render throw that escapes
  // children boundaries (e.g. VaultContext unwrap failures, provider
  // init crashes) so the user sees a recovery UI instead of a blank
  // white screen. ZKA invariant: only the Error object is forwarded
  // to the logger — never React props or component state, which may
  // contain decrypted household data.
  errorComponent: ({ error }) => {
    logBoundaryError(error, "root");
    return <RootErrorFallback />;
  },
});

function RootComponent() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Cookieless PostHog — privacy-first analytics for Orange Way.
    // Memory-only persistence, no cookies, no localStorage tracking,
    // no session recording, no person profiles. Each page load is a
    // fresh anonymous event stream. Pageview + explicit captures only.
    // phc_ keys are PostHog "Project API Keys" — write-only, public-safe.
    posthog.init(import.meta.env.VITE_POSTHOG_KEY ?? "", {
      api_host: import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com",
      persistence: "memory",
      person_profiles: "never",
      capture_pageview: true,
      autocapture: false,
      disable_session_recording: true,
      respect_dnt: true,
      // Cybersec audit finding 2026-06-19: PostHog captures URL query
      // strings and path params on pageview. If a route happens to
      // surface an account / household / transaction id in the URL,
      // PostHog would receive it. The before_send hook scrubs:
      //  - any url field's query string + fragment
      //  - any path segment that looks like a UUID, slug, or numeric id
      //  - any property whose key name suggests decrypted content
      // The Sentry init does the same on its side. Keep the two
      // scrubbers in shape with each other.
      before_send: scrubPostHogEvent,
    });
    posthog.register({ app: "orangeway", brand: "orange-way" });
  }, []);

  // Bootstrap + refresh the live ORBI BTC/USD rate. The fx-rates convert()
  // reads from this cache for any BTC↔fiat path; static 65k fallback kicks
  // in if the fetch fails (offline, ORBI down, env unset).
  useEffect(() => {
    if (typeof window === "undefined") return;
    void refreshLiveBTCRate("USD");
    const id = setInterval(() => void refreshLiveBTCRate("USD"), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <PostHogProvider client={posthog}>
      <ThemeProvider>
        <AuthProvider>
          <VaultProvider>
            <HeadContent />
            <Outlet />
            <Suspense fallback={null}>
              <Toaster />
            </Suspense>
            <AnalyticsNotice />
          </VaultProvider>
        </AuthProvider>
      </ThemeProvider>
    </PostHogProvider>
  );
}

// One-time analytics-notice banner shown once per browser, dismissed via
// localStorage (UI state, not tracking — exempt from consent under
// GDPR Article 6 because it's strictly necessary for the banner not to
// nag). Consistent wording across every Orange Way surface.
// Marketing pages only — suppress on app/auth surfaces. Re-evaluated on
// every SPA route change so navigating from marketing → app hides it.
const NOTICE_SUPPRESSED_PREFIXES = [
  "/auth",
  "/reset-password",
  "/dashboard",
  "/accounts",
  "/budgets",
  "/goals",
  "/households",
  "/connections",
  "/settings",
];

function AnalyticsNotice() {
  const location = useLocation();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (NOTICE_SUPPRESSED_PREFIXES.some((p) => location.pathname.startsWith(p))) {
      setShow(false);
      return;
    }
    setShow(localStorage.getItem("ow_notice_dismissed") !== "1");
  }, [location.pathname]);
  useEffect(() => {
    if (!show) return;
    const onScroll = () => {
      if (window.scrollY > 600) {
        localStorage.setItem("ow_notice_dismissed", "1");
        setShow(false);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [show]);
  if (!show) return null;
  const dismiss = () => {
    localStorage.setItem("ow_notice_dismissed", "1");
    setShow(false);
  };
  return (
    <div
      style={{
        position: "fixed",
        left: 20,
        bottom: 20,
        zIndex: 9999,
        maxWidth: 320,
        padding: "14px 16px",
        background: "#0F172A",
        color: "#FAFAF9",
        borderRadius: 14,
        boxShadow: "0 12px 32px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.18)",
        font: "12.5px/1.5 -apple-system, 'Plus Jakarta Sans', system-ui, sans-serif",
        animation: "bbnotin 260ms cubic-bezier(0.16,1,0.3,1)",
      }}
      role="region"
      aria-label="Analytics notice"
    >
      <style>{`@keyframes bbnotin{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          background: "transparent",
          color: "#94A3B8",
          border: 0,
          fontSize: 18,
          lineHeight: 1,
          padding: "4px 6px",
          cursor: "pointer",
          borderRadius: 6,
        }}
      >
        ×
      </button>
      <p style={{ margin: "0 0 10px 0", paddingRight: 18 }}>
        Anonymous analytics —{" "}
        <strong style={{ color: "#fff" }}>no tracking, no profiles, no cookies.</strong> A session
        cookie is set only if you sign in, and is deleted when you sign out.
      </p>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: "#fb923c",
          color: "#fff",
          border: 0,
          borderRadius: 8,
          padding: "6px 14px",
          font: "inherit",
          fontWeight: 600,
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        Got it
      </button>
    </div>
  );
}
