import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/beta")({
  head: () => ({
    ...pageMeta({
      title: "Apply for beta access, Orange Way",
      description:
        "Beta members get the private finance app for people who own Bitcoin, and lock in $100/year for life.",
      path: "/beta",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Apply for beta", path: "/beta" },
        ]),
      ),
    ],
  }),
  component: BetaPage,
});

function BetaPage() {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [ownsBtc, setOwnsBtc] = useState(true);
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const { error: insertError } = await supabase.from("beta_applications").insert({
        email: email.trim().toLowerCase(),
        note: note.trim() || null,
        owns_btc: ownsBtc,
      });
      if (insertError) throw insertError;
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "ok") {
    return (
      <MarketingShell>
        <article className="mx-auto max-w-xl px-6 py-24 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">You're on the list.</h1>
          <p className="mt-4 text-muted-foreground">
            We'll be in touch when we let you in. When you join, you keep{" "}
            <strong className="text-foreground">$100/year for life</strong> — even after we raise
            prices publicly.
          </p>
        </article>
      </MarketingShell>
    );
  }

  return (
    <MarketingShell>
      <article className="mx-auto max-w-xl px-6 py-16">
        <header className="mb-8 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Beta</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Apply for beta access.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Beta members lock in <strong className="text-foreground">$100/year for life.</strong>{" "}
            We'll let you in as we open up.
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
        >
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="note" className="mb-1.5 block text-sm font-medium">
              Tell us about your setup <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="A few accounts, some sats in cold storage, partner shares the budget..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ownsBtc}
              onChange={(e) => setOwnsBtc(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary"
            />
            I own Bitcoin
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Apply for beta"}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            We only use your email to let you into the beta.
          </p>
        </form>
      </article>
    </MarketingShell>
  );
}
