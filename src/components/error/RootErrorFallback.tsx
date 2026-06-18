// Fallback shown when the root error boundary catches a render throw.
// Intentionally minimal: no stack trace, no error message, no PII —
// just a friendly recovery affordance. Lives outside __root.tsx so the
// boundary can be exported and tested in isolation.
export function RootErrorFallback() {
  const reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-foreground">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The app hit an unexpected error. Refresh the page to try again — your data is safe and
          stays on your device.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Refresh page
          </button>
        </div>
      </div>
    </div>
  );
}

// Fallback for the /settings/household* subtree. Keeps the user inside
// the app — they can navigate back to settings without losing context.
export function HouseholdSectionErrorFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h2 className="text-xl font-semibold text-foreground">We couldn't load this section</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing the page, or come back to it in a moment.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <a
            href="/settings"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Back to settings
          </a>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") window.location.reload();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
