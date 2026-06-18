import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    ...pageMeta({
      title: "Privacy Policy, Orange Way",
      description:
        "Orange Way is end to end encrypted. We cannot read your financial data. This page explains exactly what we collect, what we don't, and why.",
      path: "/privacy",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
        ]),
      ),
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: April 28, 2026</p>

        <h2 className="mt-10 text-xl font-semibold">What we cannot see</h2>
        <p className="mt-2 text-muted-foreground">
          Account names, balances, transactions (amount, merchant, category, notes), budgets, goals,
          rules, tags, splits, transfers. All of this is encrypted on your device before it touches
          our servers.
        </p>

        <h2 className="mt-8 text-xl font-semibold">What we do collect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Email address and authentication state.</li>
          <li>Public keys you publish for household sharing.</li>
          <li>Encrypted blobs (which we cannot decrypt).</li>
          <li>Standard server logs (IP, timestamps) for abuse prevention.</li>
          <li>Aggregate, anonymous usage metrics so we can improve the product.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">What we never do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Sell or share your data with advertisers, brokers, or aggregators.</li>
          <li>Train AI models on your financial data.</li>
          <li>Build a behavioral profile of your spending.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Subprocessors</h2>
        <p className="mt-2 text-muted-foreground">
          Orange Way runs on Supabase infrastructure for storage and authentication. Because data
          is encrypted client side, subprocessors handle ciphertext only.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Your rights</h2>
        <p className="mt-2 text-muted-foreground">
          You can export your data at any time, delete your account at any time, and revoke
          household access at any time. Account deletion removes the encrypted blobs along with the
          metadata.
        </p>

        <p className="mt-10 text-xs text-muted-foreground">
          Questions? Email privacy@orangeway.app.
        </p>
      </article>
    </MarketingShell>
  );
}
