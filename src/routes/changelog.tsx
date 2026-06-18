import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

const ENTRIES = [
  {
    date: "2026-04-28",
    title: "AI-discoverable site",
    body: "Public marketing site, JSON-LD structured data on every page, llms.txt + llms-full.txt, machine-readable AI manifest, and a sitemap. Orange Way is now fully readable by ChatGPT, Perplexity, Claude, Gemini, and Bing Copilot.",
  },
  {
    date: "2026-04-27",
    title: "Email-based household invites",
    body: "Invite household members by email. Recipient generates an ML-KEM-768 keypair on-device; the household scope key is automatically wrapped to their public key in real time.",
  },
  {
    date: "2026-04-26",
    title: "Household rekey infrastructure",
    body: "Background jobs (`household_key_rotation_jobs`) batch re-encryption of transactions, accounts, categories, budgets, goals, and rules when membership changes.",
  },
  {
    date: "2026-04-23",
    title: "OrangeRails import bridge",
    body: "Idempotent on chain transaction import via `(user_id, external_source, external_id)` unique partial index. Re-syncing a batch never creates duplicates.",
  },
];

export const Route = createFileRoute("/changelog")({
  head: () => ({
    ...pageMeta({
      title: "Changelog, Orange Way",
      description:
        "What's new in Orange Way. Recent releases include AI discoverability, email-based household invites, and the household rekey job framework.",
      path: "/changelog",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Changelog", path: "/changelog" },
        ]),
      ),
    ],
  }),
  component: ChangelogPage,
});

function ChangelogPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Changelog</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">What's new</h1>
        </header>
        <div className="space-y-8">
          {ENTRIES.map((e) => (
            <article key={e.date} className="rounded-lg border border-border bg-card p-6">
              <time
                className="text-xs uppercase tracking-wider text-muted-foreground"
                dateTime={e.date}
              >
                {new Date(e.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
              <h2 className="mt-1 text-lg font-semibold">{e.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{e.body}</p>
            </article>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
