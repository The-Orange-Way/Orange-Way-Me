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
        "Orange Way encrypts your financial data on your device, so we cannot read it. This page explains exactly what we collect, what we don't, and the one bank-feed exception.",
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
          Version: 2026.08.17.{" "}
          <Link to="/privacy-changelog" className="underline">
            See changes to this policy.
          </Link>
        </p>

        <h2 className="mt-10 text-xl font-semibold">What we cannot see</h2>
        <p className="mt-2 text-muted-foreground">
          Account names, balances, transactions (amount, merchant, category, notes), budgets, goals,
          rules, tags, splits, transfers. All of this is encrypted on your device before it touches
          our servers. Bank-synced transactions are the one exception on their way in: they arrive
          through the bank feed pathway described under Sub-processors, and are sealed before we
          store them.
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

        <h2 className="mt-8 text-xl font-semibold">Marketing and cross-product messages</h2>
        <p className="mt-2 text-muted-foreground">
          Separately from the transactional emails above, we may send you a small number of
          marketing messages about other Generation Bitcoin products, such as the Children's Books.
          These are distinct from transactional email: transactional messages (signup, password
          reset, account notices) are part of running your account and are always sent, while these
          marketing messages are optional and you can turn them off at any time.
        </p>
        <p className="mt-2 text-muted-foreground">
          One of these messages is triggered by an in-app action: when you connect a financial
          account, such as a bank feed or a wallet, that connection event can trigger a one-time
          message inviting you to a related Generation Bitcoin product. The trigger is only the fact
          that you connected an account. We do not read, and cannot read, the contents of that
          account: your balances and transactions stay encrypted on your device exactly as described
          above, and none of that data is used to target or personalize these messages.
        </p>
        <p className="mt-2 text-muted-foreground">
          You can opt out at any time, and opting out is honored across both products:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>One tap at the moment you connect an account, before any message is sent.</li>
          <li>A one-click unsubscribe link in every marketing email, which needs no login.</li>
          <li>A setting in the app you can change whenever you like.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Sub-processors</h2>
        <p className="mt-2 text-muted-foreground">
          A handful of third parties touch parts of Orange Way. Each one only sees what is listed
          below. Your manually entered and Bitcoin data is encrypted on your device, so none of
          these companies can read those accounts, balances, transactions, budgets, or goals. Bank
          feeds are the one exception: Quiltt processes your bank feed in the clear under its own
          privacy policy (see its row below), and our Orange Rails connector handles it in the clear
          only for the moment it takes to seal it, exactly as described on our{" "}
          <Link to="/security" className="underline">
            security page
          </Link>
          .
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
          and any future notification we explicitly opt into. Resend also delivers the optional
          cross-product marketing messages described under Marketing and cross-product messages
          above. Headquartered in Delaware, United States, with mail delivery infrastructure in the
          United States and Europe. Sees: your email address and the email body. Retention: send
          logs for the period required by the Resend service plan, typically up to 30 days.{" "}
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
          version). Before any report leaves your device, an in-browser scrubber strips any field
          whose name contains the substring &quot;recovery&quot; (covering all naming variants),
          along with other known sensitive field names (passwords, vault keys, account balances,
          merchant names), and rewrites URL fragments. Retention: 30 days on the GlitchTip server.
          No external DPA: GlitchTip is operated by us, not a third-party vendor.
        </p>

        <h3 className="mt-6 text-lg font-semibold">Quiltt</h3>
        <p className="mt-2 text-muted-foreground">
          Provides the bank connection feed, only if you choose to link a bank account. Quiltt is
          headquartered in the United States. Sees: your bank account and transaction data in the
          clear, to deliver the feed, as bank aggregators do, retained under its own privacy policy.
          Your bank credentials are entered into Quiltt's connector or your bank's own sign-in and
          are never sent to Orange Way. Our Orange Rails connector then handles the feed briefly in
          the clear to seal each transaction to a key only you hold, and Orange Way stores only the
          sealed version. Retention on our side: we keep nothing unsealed. If you never link a bank,
          Quiltt never sees anything about you.{" "}
          <a
            href="https://www.quiltt.io/policies/privacy-policy"
            className="underline"
            rel="noopener noreferrer"
            target="_blank"
          >
            Quiltt privacy policy
          </a>
          .
        </p>

        <h3 className="mt-6 text-lg font-semibold">PostHog</h3>
        <p className="mt-2 text-muted-foreground">
          Marketing-site analytics. Enabled on <code>orangeway.app</code>. Disabled by default on
          self-hosted builds. Anonymous events only; no cross-site cookies, no profiles. Sees: page
          views and aggregate clicks, with URL query strings and known sensitive field names
          stripped before send. Events are sent to PostHog's EU Cloud, so analytics data is ingested
          and stored in the European Union. The actual retention is the value the operator has
          configured on the PostHog project; our target is 90 days.{" "}
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
            <strong>PostHog (EU-hosted; US company).</strong> Our PostHog project runs on PostHog's
            EU Cloud, so analytics events are ingested and stored in the European Union, not
            transferred to the United States in the ordinary course. PostHog Inc. is a US company;
            the SCCs in its DPA cover any residual access from the US. Quebec Law 25 §17
            implication: anonymous event-level analytics; no profile, no cross-site identifier.
            Disabled entirely on self-hosted builds.
          </li>
          <li>
            <strong>Quiltt (US).</strong> Applies only if you link a bank account. Quebec Law 25 §17
            implication: bank account and transaction data is processed in the United States to
            deliver the feed, under Quiltt's privacy policy and our agreement with them. Transfer
            safeguard: our assessment of the applicable mechanism (SCCs or equivalent in the Quiltt
            agreement) is in progress; contact us for its current status.
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

        <h2 className="mt-8 text-xl font-semibold">Controller</h2>
        <p className="mt-2 text-muted-foreground">
          The controller responsible for the personal information described on this page, for
          purposes of Quebec Law 25 §8.1 and GDPR Art. 13(1)(a), is reachable at:
        </p>
        <address className="mt-2 not-italic text-muted-foreground">
          Orange Way
          <br />
          24 Maple Ave #1
          <br />
          Barrie, ON L4N 1R6
          <br />
          Canada
        </address>

        <p className="mt-10 text-xs text-muted-foreground">
          Questions? Email privacy@orangeway.app or write to the address above.
        </p>
      </article>
    </MarketingShell>
  );
}
