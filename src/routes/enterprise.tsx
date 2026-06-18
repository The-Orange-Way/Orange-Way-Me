import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { Building2, Globe2, KeyRound, Users } from "lucide-react";

export const Route = createFileRoute("/enterprise")({
  head: () => ({
    ...pageMeta({
      title: "Enterprise, Orange Way for your customers",
      description:
        "Offer Orange Way to your customers. White-label, SSO, custom domain. For Bitcoin native firms, exchanges, wealth advisors, accountants serving Bitcoiners.",
      path: "/enterprise",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Enterprise", path: "/enterprise" },
        ]),
      ),
    ],
  }),
  component: EnterprisePage,
});

function EnterprisePage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Enterprise</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Offer Orange Way to your customers.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Built for Bitcoin native firms, exchanges, wealth advisors, and accountants serving
            Bitcoin holding clients. Give your customers a finance app that respects them, branded
            as yours.
          </p>
          <a
            href="mailto:enterprise@orangeway.app?subject=Orange%20Way%20Enterprise%20inquiry"
            className="mt-7 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Contact sales
          </a>
        </header>

        <div className="grid gap-5 md:grid-cols-2">
          <Capability icon={<Building2 className="h-5 w-5" />} title="White-label">
            Your brand, your colors, your domain. Customers see you, not us.
          </Capability>
          <Capability icon={<KeyRound className="h-5 w-5" />} title="SSO">
            SAML / OIDC for your team and your customers. Standard enterprise auth.
          </Capability>
          <Capability icon={<Globe2 className="h-5 w-5" />} title="Custom domain">
            Run on a domain you own. We handle the certs.
          </Capability>
          <Capability icon={<Users className="h-5 w-5" />} title="Volume licensing">
            Per-seat or per-customer pricing, depending on how you sell.
          </Capability>
        </div>

        <section className="mt-12 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold">How it works</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>We talk through your use case, number of customers, branding, integrations.</li>
            <li>We set up a dedicated tenant on your domain with your branding.</li>
            <li>Your customers get the same encryption, the same Bitcoin support, the same UX.</li>
            <li>You get usage analytics and admin tooling. We never see your customers' data.</li>
          </ol>
        </section>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          Questions?{" "}
          <a
            href="mailto:enterprise@orangeway.app"
            className="text-foreground underline underline-offset-4 hover:text-primary"
          >
            enterprise@orangeway.app
          </a>
        </p>
      </article>
    </MarketingShell>
  );
}

function Capability({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
