import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/about")({
  head: () => ({
    ...pageMeta({
      title: "About, Orange Way",
      description:
        "Orange Way is built for households that want a beautiful budget app without surrendering their financial data. Our mission is sovereignty over your numbers.",
      path: "/about",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "About", path: "/about" },
        ]),
      ),
      jsonLd({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Orange Way",
        legalName: "The Orange Way Inc",
        url: "https://orangeway.app",
        description: "Zero knowledge personal finance for Bitcoin first households.",
        email: "hello@orangeway.app",
        address: {
          "@type": "PostalAddress",
          streetAddress: "620 Veterans Drive Suite 12",
          addressLocality: "Barrie",
          addressRegion: "ON",
          postalCode: "L4N9J4",
          addressCountry: "CA",
        },
        sameAs: [],
      }),
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">About</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Sovereignty over your numbers.
          </h1>
        </header>
        <p className="text-muted-foreground">
          Personal finance apps spent the last decade convincing people that the price of a nice
          dashboard is letting a third party read every transaction. Mint sold ad targeting on top
          of your spending. Plaid wholesales transaction history. Modern competitors charge a
          subscription <em>and</em> still see everything.
        </p>
        <p className="mt-4 text-muted-foreground">
          Orange Way is built on the opposite premise: a finance app should look and feel like the
          best of them, but the company shipping it should be cryptographically incapable of reading
          your data. We use Argon2id, AES-GCM, and post quantum key wrapping (ML-KEM-768) so that a
          server breach today, or a quantum computer ten years from now, doesn't matter.
        </p>
        <p className="mt-4 text-muted-foreground">
          We're built for the next generation of financially-sovereign households, people who hold
          Bitcoin, run their own infrastructure when they can, and want their tools to respect that
          worldview.
        </p>
        <p className="mt-10 text-xs text-muted-foreground">
          The Orange Way Inc · 620 Veterans Drive Suite 12, Barrie, ON L4N9J4, Canada · Contact:{" "}
          <a href="mailto:hello@orangeway.app" className="underline">
            hello@orangeway.app
          </a>
        </p>
      </article>
    </MarketingShell>
  );
}
