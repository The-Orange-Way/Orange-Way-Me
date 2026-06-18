import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/self-host")({
  head: () => ({
    ...pageMeta({
      title: "Self host Orange Way, for developers",
      description:
        "Orange Way is open source. If you're a developer, you can run it on your own server. If you're not, the hosted app is the right choice.",
      path: "/self-host",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Self host", path: "/self-host" },
        ]),
      ),
    ],
  }),
  component: SelfHostPage,
});

function SelfHostPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">Self host</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
          For developers who want to run it themselves.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground">
          Orange Way is open source. If you're comfortable with Docker, Postgres, and reading a
          README, you can run it on your own server for free, forever.
        </p>

        <p className="mt-4 text-muted-foreground">
          For everyone else, the hosted app is the right choice. Same code, no servers to manage,
          and we can't read your data either way.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            View on GitHub
          </a>
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Use the hosted app instead
          </Link>
        </div>

        <section className="mt-12 space-y-4 text-sm text-muted-foreground">
          <h2 className="text-base font-semibold text-foreground">What you'll need</h2>
          <ul className="space-y-2">
            <li>• A server (anything that runs Docker)</li>
            <li>• Postgres 15+</li>
            <li>• A domain and TLS certificate</li>
            <li>• Comfort with backups, upgrades, and basic ops</li>
          </ul>
          <p className="pt-4">
            Self hosted installs don't get our hosted-only features (managed backups, automatic
            updates, customer support). You're in charge.
          </p>
        </section>
      </article>
    </MarketingShell>
  );
}
