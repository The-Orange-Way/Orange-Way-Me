import { createFileRoute, Link } from "@tanstack/react-router";
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
        <p className="mt-2 text-sm text-muted-foreground">
          Version: 2026.06.26.{" "}
          <Link to="/privacy-changelog" className="underline">
            See changes to this policy.
          </Link>
        </p>

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

        <h2 className="mt-8 text-xl font-semibold">Sub-processors</h2>
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
          deletion for backups.{" "}
          <a
            href="https://supabase.com/legal/dpa"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Supabase DPA
          </a>
          .
        </p>

        <h3 className="mt-6 text-lg font-semibold">Cloudflare</h3>
        <p className="mt-2 text-muted-foreground">
          Hosts the website and runs the Turnstile challenge that appears on sign in, sign up, and
          password reset. Cloudflare is headquartered in the United States. Sees: standard request
          metadata (IP, user agent, timestamp) and the Turnstile challenge response. Cloudflare
          Turnstile does not use tracking cookies and does not build a profile of you. Retention:
          edge logs are typically deleted within 7 days.{" "}
          <a
            href="https://www.cloudflare.com/cloudflare-customer-dpa/"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Cloudflare DPA
          </a>
          .
        </p>

        <h3 className="mt-6 text-lg font-semibold">Resend</h3>
        <p className="mt-2 text-muted-foreground">
          Sends the transactional emails we generate: signup confirmations, password reset links,
          and any future notification we explicitly opt into. Headquartered in Delaware, United
          States, with mail delivery infrastructure in the United States and Europe. Sees: your
          email address and the email body. Retention: send logs for the period required by the
          Resend service plan, typically up to 30 days.{" "}
          <a
            href="https://resend.com/legal/dpa"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Resend DPA
          </a>
          .
        </p>

        <h3 className="mt-6 text-lg font-semibold">GlitchTip</h3>
        <p className="mt-2 text-muted-foreground">
          Receives error reports when the app crashes so we can fix bugs faster. We run GlitchTip on
          our own server. Sees: the technical details of the crash (route name, stack trace, browser
          version). Before any report leaves your device, an in-browser scrubber strips known
          sensitive field names (passwords, recovery codes, vault keys, account balances, merchant
          names) and rewrites URL fragments. Retention: 30 days on the GlitchTip server. No external
          DPA: GlitchTip is operated by us, not a third-party vendor.
        </p>

        <h3 className="mt-6 text-lg font-semibold">PostHog</h3>
        <p className="mt-2 text-muted-foreground">
          Marketing-site analytics. Enabled on <code>orangeway.app</code>. Disabled by default on
          self-hosted builds. Anonymous events only; no cross-site cookies, no profiles. Sees: page
          views and aggregate clicks, with URL query strings and known sensitive field names
          stripped before send. The actual retention is the value the operator has configured on the
          PostHog project; our target is 90 days.{" "}
          <a
            href="https://posthog.com/dpa"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            PostHog DPA
          </a>
          .
        </p>

        <h2 className="mt-8 text-xl font-semibold">Cross-border data transfers</h2>
        <p className="mt-2 text-muted-foreground">
          Most of our sub-processors are headquartered in the United States. When personal
          information crosses a border to reach them, the transfer relies on one of the following
          safeguards. For Quebec residents, Law 25 §17 requires us to inform you of the transfer and
          the assessment; for EEA / UK residents, GDPR Art. 13(1)(f) requires the same.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            <strong>Supabase (US).</strong> Standard Contractual Clauses (SCCs) as the default
            transfer mechanism. Supabase has assessed Quebec Law 25 in their DPA. Risk assessment:
            ciphertext-only payload, server cannot read the content.
          </li>
          <li>
            <strong>Cloudflare (US).</strong> SCCs plus EU-US Data Privacy Framework
            self-certification. Captcha vendor in use on Orange Way is Cloudflare Turnstile. Quebec
            Law 25 §17 implication: edge logs are short-lived (≤ 7 days) and do not contain customer
            business data.
          </li>
          <li>
            <strong>Resend (US).</strong> SCCs. Quebec Law 25 §17 implication: only the message
            recipient address and the message body cross the border; no business data leaves the
            encrypted store.
          </li>
          <li>
            <strong>PostHog (US).</strong> SCCs. Quebec Law 25 §17 implication: anonymous
            event-level analytics; no profile, no cross-site identifier. Disabled entirely on
            self-hosted builds.
          </li>
          <li>
            <strong>GlitchTip (operated by us).</strong> No third-country transfer: data lands on
            our own server. Geographic location of the GlitchTip host is documented on the Orange
            Way security page.
          </li>
        </ul>
        <p className="mt-4 text-muted-foreground">
          If your jurisdiction's data-protection authority requires a copy of the SCCs or the
          transfer-impact assessment for any of the above vendors, contact us at the address in the
          Questions section and we will share the relevant document.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Changes to sub-processors</h2>
        <p className="mt-2 text-muted-foreground">
          We commit to notifying you before adding or replacing a sub-processor that sees personal
          information. The mechanism:
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-muted-foreground">
          <li>
            <strong>30-day pre-change notice.</strong> When we plan to add or replace a
            sub-processor, we update this page at least 30 days before the change takes effect. The
            Version anchor at the top of this page (e.g. <code>Version: 2026.06.26</code>) bumps to
            the new date.
          </li>
          <li>
            <strong>Change log.</strong> Each version bump is recorded with a one-line summary on{" "}
            <Link to="/privacy-changelog" className="underline">
              the privacy change log
            </Link>
            , so a reader can see what changed without diffing the page by hand.
          </li>
          <li>
            <strong>Right to object.</strong> If a planned change is unacceptable to you, you may
            cancel your account before the change takes effect. Your encrypted business data is not
            migrated to the new sub-processor before then.
          </li>
          <li>
            <strong>Emergency changes</strong> (vendor outage, security incident, sudden
            policy-of-record change) may occur without the 30-day window. We will record those after
            the fact on the change log and explain the trigger.
          </li>
        </ul>

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
