import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { Wallet, Bitcoin, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/features")({
  head: () => ({
    ...pageMeta({
      title: "Features, Orange Way",
      description:
        "Everyday money: accounts, budgets, goals, rules. Bitcoin: sats, wallet sync, on chain net worth. Privacy: encryption, recovery, household sharing without shared logins.",
      path: "/features",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Features", path: "/features" },
        ]),
      ),
    ],
  }),
  component: FeaturesPage,
});

const PILLARS: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  features: { h: string; p: string }[];
}[] = [
  {
    icon: <Wallet className="h-5 w-5" />,
    title: "Everyday money",
    blurb: "Everything a modern budgeting app does, and the basics done right.",
    features: [
      {
        h: "Accounts",
        p: "Checking, savings, credit, investment, loans, real estate, Bitcoin. Multi currency with automatic conversion.",
      },
      {
        h: "Transactions",
        p: "Merchant, category, tags, notes, splits, transfers. Bulk edit thousands of rows at once.",
      },
      {
        h: "Budgets",
        p: "Category budgets with rollover, or envelope-style flex budgets. Compare to past months.",
      },
      {
        h: "Goals",
        p: "Saving goals, debt payoff, milestones. The app projects your finish date based on how you actually contribute.",
      },
      {
        h: "Rules",
        p: "Auto categorize and rename merchants. Re-run rules on history to clean up imports retroactively.",
      },
      {
        h: "Dashboard",
        p: "Net worth over time, monthly cash flow, where your money goes, upcoming bills, goal progress.",
      },
    ],
  },
  {
    icon: <Bitcoin className="h-5 w-5" />,
    title: "Bitcoin",
    blurb: "Treated like real money, not a footnote.",
    features: [
      {
        h: "Sats and BTC display",
        p: "Switch any account between sats and BTC. Net worth respects your preferred unit.",
      },
      {
        h: "Wallet sync (read only)",
        p: "Connect your wallet read only, like showing someone a window into the safe but not the key. Your private keys never leave your hardware wallet.",
      },
      {
        h: "On chain net worth",
        p: "Your Bitcoin holdings show up in net worth and cash flow alongside your bank accounts. Fiat and BTC, in one private view.",
      },
      {
        h: "Idempotent imports",
        p: "Re-syncing the same batch of on chain transactions never creates duplicates.",
      },
    ],
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Privacy",
    blurb: "We can't read your data. That's the whole point.",
    features: [
      {
        h: "Encrypted on your device",
        p: "Every balance, transaction, category, and note is scrambled in your browser before it ever reaches our servers.",
      },
      {
        h: "Recovery kit",
        p: "One-time recovery kit at signup. Save it safely. With it, you can reset your password and keep your data.",
      },
      {
        h: "Household sharing",
        p: "Invite a partner, family member, or accountant. They get their own login, no shared passwords. Revoke any time.",
      },
      {
        h: "Auto lock",
        p: "Configurable inactivity timeout wipes the in-memory keys. A stolen laptop with an unlocked browser tab still won't expose your numbers for long.",
      },
      {
        h: "Encrypted backup & CSV export",
        p: "Take your data with you whenever you want. Backup stays encrypted; CSV is decrypted on your device.",
      },
    ],
  },
];

function FeaturesPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-12 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Features</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            A real finance app. Built private.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Three things, done well: your everyday money, your Bitcoin, and your privacy. No
            dashboards full of features you'll never use.
          </p>
        </header>

        <div className="space-y-16">
          {PILLARS.map((p) => (
            <section key={p.title}>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {p.icon}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">{p.title}</h2>
                  <p className="text-sm text-muted-foreground">{p.blurb}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {p.features.map((f) => (
                  <div key={f.h} className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-base font-semibold">{f.h}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{f.p}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-16 text-center">
          <Link
            to="/beta"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Apply for beta access
          </Link>
        </div>
      </article>
    </MarketingShell>
  );
}
