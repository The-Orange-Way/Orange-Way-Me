import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/privacy-changelog")({
  head: () => ({
    ...pageMeta({
      title: "Privacy Policy Change Log, Orange Way",
      description:
        "One-line summary of every change to the Orange Way privacy policy. Bumped on every sub-processor change with a 30-day pre-change notice.",
      path: "/privacy-changelog",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
          { name: "Change log", path: "/privacy-changelog" },
        ]),
      ),
    ],
  }),
  component: PrivacyChangelogPage,
});

function PrivacyChangelogPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy Change Log</h1>
          <p className="mt-2 text-muted-foreground">
            One-line summary of every change to the{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            . The page Version anchor bumps to the date of each entry.
          </p>
        </header>

        <section className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold">Version 2026.06.26</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Added Cross-border data transfers section (SCC + DPF + Quebec Law 25 §17).</li>
              <li>
                Added Changes to sub-processors section (30-day pre-change notice, version anchor,
                this change log).
              </li>
              <li>Added DPA links per US vendor (Supabase, Cloudflare, Resend, PostHog).</li>
              <li>
                Added PostHog as an explicit sub-processor row; clarified scope: enabled on{" "}
                <code>orangeway.app</code>, disabled by default on self-hosted.
              </li>
              <li>Replaced "Last updated" date with a "Version: YYYY.MM.DD" anchor.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-xl font-semibold">Version 2026.06.25 and earlier</h2>
            <p className="mt-2 text-muted-foreground">
              Pre-change-log history. Track via the git history of{" "}
              <a
                href="https://github.com/The-Orange-Way/Orange-Way-Me/commits/dev/src/routes/privacy.tsx"
                className="underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                src/routes/privacy.tsx
              </a>
              .
            </p>
          </div>
        </section>
      </article>
    </MarketingShell>
  );
}
