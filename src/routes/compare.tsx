import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/compare")({
  head: () => ({
    ...pageMeta({
      title: "How Orange Way compares to other personal finance apps",
      description:
        "Honest comparison on what actually matters for privacy conscious, Bitcoin holding households: encryption, Bitcoin support, household sharing, and pricing.",
      path: "/compare",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
        ]),
      ),
      jsonLd({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Personal finance app comparison",
        itemListElement: [
          "Orange Way",
          "Monarch Money",
          "Copilot Money",
          "YNAB",
          "Mint",
          "Lunch Money",
          "Actual Budget",
          "Origin",
        ].map((name, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: { "@type": "SoftwareApplication", name, applicationCategory: "FinanceApplication" },
        })),
      }),
    ],
  }),
  component: ComparePage,
});

const ROWS = [
  [
    "Zero knowledge end to end encryption",
    "Yes",
    "No",
    "No",
    "No",
    "No",
    "No",
    "Yes (self host)",
    "No",
  ],
  ["Native Bitcoin / sats display", "Yes", "No", "No", "No", "No", "Limited", "No", "No"],
  [
    "Household / multi user vaults",
    "Yes (PQ-wrapped)",
    "Shared account",
    "Limited",
    "Shared sub",
    "No",
    "No",
    "Manual",
    "Yes",
  ],
  ["Post quantum cryptography", "Yes", "No", "No", "No", "No", "No", "No", "No"],
  ["Web app", "Yes", "Yes", "iOS/Mac only", "Yes", "Yes", "Yes", "Yes", "Yes"],
  ["Self hostable", "Roadmap", "No", "No", "No", "No", "No", "Yes", "No"],
  [
    "Bank aggregation included",
    "BYO SimpleFIN",
    "Yes (Plaid/MX)",
    "Yes (Plaid)",
    "Yes",
    "Yes",
    "Yes (Plaid)",
    "Manual",
    "Yes",
  ],
  ["Free tier", "Yes (beta)", "No", "No", "Trial", "Was free", "No", "Free (self host)", "No"],
];
const COLS = [
  "Capability",
  "Orange Way",
  "Monarch",
  "Copilot",
  "YNAB",
  "Mint",
  "Lunch Money",
  "Actual",
  "Origin",
];

function ComparePage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Compare</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            How we compare to other personal finance apps.
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            An honest look at where Orange Way stands on the things that actually matter to people
            who hold Bitcoin and care about privacy.
          </p>
        </header>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50">
                {COLS.map((c) => (
                  <th key={c} className="p-3 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((cell, j) => (
                    <td
                      key={j}
                      className={
                        "p-3 " +
                        (j === 0 ? "font-medium" : "text-muted-foreground") +
                        (j === 1 ? " bg-primary/5 text-foreground" : "")
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-12 space-y-8">
          <Choose
            h="Choose Orange Way if…"
            items={[
              "You want a beautiful, modern budget app and you don't want the vendor to read your numbers.",
              "You hold Bitcoin and want it tracked alongside fiat without bolting on a separate tool.",
              "You and a partner want to share a budget without giving a third party joint visibility.",
              "You're rebuilding your finance stack post-Mint and refuse to upgrade to surveillance SaaS.",
            ]}
          />
          <Choose
            h="Choose something else if…"
            items={[
              "You want the broadest possible US bank coverage out of the box → Monarch or Copilot.",
              "You want strict envelope budgeting methodology with a large community → YNAB.",
              "You want a fully offline desktop client → Actual Budget.",
              "You don't care about encryption and want the cheapest Mint replacement → many options.",
            ]}
          />
        </section>

        <p className="mt-12 text-xs text-muted-foreground">
          Trademarks belong to their respective owners. Comparison reflects publicly available
          information at time of publication and is updated as competitors evolve.
        </p>
      </article>
    </MarketingShell>
  );
}

function Choose({ h, items }: { h: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">{h}</h2>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((it) => (
          <li key={it}>• {it}</li>
        ))}
      </ul>
    </div>
  );
}
