import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { Check } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    ...pageMeta({
      title: "Pricing, Orange Way",
      description:
        "$100 a year, locked in for beta members for life. Or $17.99/month. We charge for the app instead of selling your data.",
      path: "/pricing",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]),
      ),
      jsonLd({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Orange Way",
        description: "The private finance app for people who own Bitcoin.",
        brand: { "@type": "Brand", name: "Orange Way" },
        offers: [
          {
            "@type": "Offer",
            name: "Monthly",
            price: "17.99",
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            url: "https://orangeway.app/pricing",
          },
          {
            "@type": "Offer",
            name: "Yearly",
            price: "100",
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
            url: "https://orangeway.app/pricing",
          },
        ],
      }),
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");

  return (
    <MarketingShell>
      <article className="mx-auto max-w-4xl px-6 py-16">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Pricing</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            $100 a year. Locked in for life.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            For beta members, the yearly price never goes up. Pick yearly and save 54%, or pay
            monthly if you'd rather try it month-to-month.
          </p>
        </header>

        {/* Billing toggle */}
        <div className="mt-10 flex justify-center">
          <div
            role="tablist"
            aria-label="Billing period"
            className="inline-flex items-center rounded-full border border-border bg-card p-1 text-sm"
          >
            <button
              role="tab"
              aria-selected={billing === "monthly"}
              onClick={() => setBilling("monthly")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                billing === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              role="tab"
              aria-selected={billing === "yearly"}
              onClick={() => setBilling("yearly")}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                billing === "yearly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yearly <span className="ml-1 text-xs opacity-80">save 54%</span>
            </button>
          </div>
        </div>

        {/* Two plans */}
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <PlanCard
            name="Monthly"
            price="$17.99"
            period="per month"
            note="Cancel anytime."
            highlighted={billing === "monthly"}
            features={COMMON_FEATURES}
            cta="Apply for beta"
          />
          <PlanCard
            name="Yearly"
            price="$100"
            period="per year (~$8.33/mo)"
            note="Beta members lock in this price for life."
            highlighted={billing === "yearly"}
            badge="Best value · 54% off"
            features={COMMON_FEATURES}
            cta="Apply for beta"
          />
        </div>

        {/* Why we charge */}
        <section className="mx-auto mt-12 max-w-2xl rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold">Why we charge for this</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Most finance apps are free because they read your transactions and sell what they learn.
            We don't. We can't, your data is encrypted on your device before it ever reaches us.
            That costs more to build, so we charge for it instead of selling you.
          </p>
        </section>

        {/* Beta promise */}
        <section className="mx-auto mt-5 max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <h2 className="text-base font-semibold text-primary">Beta promise</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong className="text-foreground">$100/year, locked in for life.</strong> When we
            launch publicly, prices will go up. If you join in beta, you keep your rate as long as
            you're a member.
          </p>
        </section>

        {/* Quiet self host link */}
        <p className="mt-12 text-center text-xs text-muted-foreground">
          Are you a developer?{" "}
          <Link to="/self-host" className="underline underline-offset-4 hover:text-foreground">
            You can also run Orange Way yourself.
          </Link>
        </p>
      </article>
    </MarketingShell>
  );
}

const COMMON_FEATURES = [
  "All your accounts in one place",
  "Budgets, goals, rules, dashboard",
  "Households, share what matters, keep what's yours",
  "Bitcoin alongside your bank accounts",
  "Encrypted backup and CSV export",
  "We can't read a single number",
];

function PlanCard({
  name,
  price,
  period,
  note,
  features,
  cta,
  highlighted,
  badge,
}: {
  name: string;
  price: string;
  period: string;
  note: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-7 ${
        highlighted
          ? "border-primary/50 bg-card shadow-2xl shadow-primary/10"
          : "border-border bg-card"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-7 inline-flex items-center rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
          {badge}
        </div>
      )}
      <div className="text-sm font-medium uppercase tracking-wider text-primary">{name}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-5xl font-semibold tracking-tight">{price}</div>
      </div>
      <div className="text-sm text-muted-foreground">{period}</div>
      <p className="mt-3 text-xs text-muted-foreground">{note}</p>

      <ul className="mt-6 space-y-2.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        to="/beta"
        className={`mt-7 inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium ${
          highlighted
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border bg-background hover:bg-muted"
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
