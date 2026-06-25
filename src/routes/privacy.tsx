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
        <p className="mt-2 text-sm text-muted-foreground">Last updated: June 25, 2026</p>

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
          A handful of third parties touch parts of Orange Way. Each one only sees what is listed
          below. Because your financial data is encrypted on your device, none of these companies
          can read your accounts, balances, transactions, budgets, or goals.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Supabase</h3>
        <p className="mt-2 text-muted-foreground">
          Stores your account, authentication state, and the ciphertext your device produces. Hosted
          in the United States. Sees: your email, the ciphertext blobs (which it cannot decrypt),
          and connection metadata. Retention: as long as your account exists, plus 30 days after
          deletion for backups.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Cloudflare</h3>
        <p className="mt-2 text-muted-foreground">
          Hosts the website and runs the Turnstile challenge that appears on sign in, sign up, and
          password reset. Cloudflare is headquartered in the United States. Sees: standard request
          metadata (IP, user agent, timestamp) and the Turnstile challenge response. Cloudflare
          Turnstile does not use tracking cookies and does not build a profile of you. Retention:
          edge logs are typically deleted within 7 days.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Resend</h3>
        <p className="mt-2 text-muted-foreground">
          Sends the transactional emails we generate: signup confirmations, password reset links,
          and any future notification we explicitly opt into. Headquartered in Delaware, United
          States, with mail delivery infrastructure in the United States and Europe. Sees: your
          email address and the email body. Retention: send logs for the period required by the
          Resend service plan, typically up to 30 days.
        </p>

        <h3 className="mt-6 text-lg font-semibold">GlitchTip</h3>
        <p className="mt-2 text-muted-foreground">
          Receives error reports when the app crashes so we can fix bugs faster. We run GlitchTip on
          our own server. Sees: the technical details of the crash (route name, stack trace, browser
          version). Before any report leaves your device, an in browser scrubber strips known
          sensitive field names (passwords, recovery codes, vault keys, account balances, merchant
          names) and rewrites URL fragments. Retention: 30 days on the GlitchTip server.
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
