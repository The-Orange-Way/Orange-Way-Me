import { useEffect, lazy, Suspense } from "react";
import { Outlet, Link, createRootRoute, HeadContent, useLocation } from "@tanstack/react-router";

import { AuthProvider } from "@/context/AuthContext";
import { VaultProvider } from "@/context/VaultContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { RootErrorFallback } from "@/components/error/RootErrorFallback";
import { logBoundaryError } from "@/components/error/logError";
import { refreshLiveBTCRate } from "@/lib/orbi-rates";
import { isMarketingPath } from "@/lib/observability/analytics-surface";
import { pauseAnalytics, restoreAnalytics } from "@/lib/analytics";

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
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMarketingPath(location.pathname)) {
      // Authenticated app, auth screens, and anything unrecognised. If the
      // user arrived here from marketing after opting in, stop capturing
      // rather than leaving it running behind the sign-in wall.
      void pauseAnalytics();
      return;
    }
    restoreAnalytics();
  }, [location.pathname]);

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
    <ThemeProvider>
      <AuthProvider>
        <VaultProvider>
          <HeadContent />
          <Outlet />
          <Suspense fallback={null}>
            <Toaster />
          </Suspense>
        </VaultProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
