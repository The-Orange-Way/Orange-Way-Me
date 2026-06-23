/**
 * Landing page. Brand palette: orange-way #F7931A + deep #0F172A + surface
 * #FAFAF9. Typography: Plus Jakarta Sans + Inter + JetBrains Mono.
 * Rotating-word headline, two-card privacy visual, pricing grid.
 *
 * Text content lives in the COPY constants block below.
 *
 * Notes:
 *   - CTAs wired to /auth so the funnel works today.
 *   - Book email capture POSTs to the Cloudflare Pages function at
 *     functions/api/signup.ts with form: "book"; Resend delivers the
 *     transactional confirmation. Same endpoint and pattern as the
 *     BookForm + WaitlistForm on /landing-classic.
 *   - Book cover uses our existing asset at @/assets/orange-way/book-cover.png.
 *   - No auth-state redirect — a live Supabase session does not imply an
 *     unlocked vault, and the bounce confused first-time visitors.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import bookCover from "@/assets/orange-way/book-cover.png";
import { BitcoinMockup } from "@/components/marketing/mockups/BitcoinMockup";
import { BudgetMockup } from "@/components/marketing/mockups/BudgetMockup";
import { HouseholdMockup } from "@/components/marketing/mockups/HouseholdMockup";

// ─────────────────────────────────────────────────────────────────────────────
// COPY block — all landing-page text. Edit here.
// ─────────────────────────────────────────────────────────────────────────────

const COPY = {
  navLinks: { features: "Features", privacy: "Privacy", pricing: "Pricing", book: "Free Book" },
  navLogIn: "Log in",
  navCTA: "Start free trial",

  heroRotating: ["Monarch", "YNAB", "Mint"],
  heroHeadingTail: "for Bitcoiners.",
  heroBody:
    "Helping Bitcoiners be better with their personal finances. Track every transaction, budget, and savings goal in one place by syncing your fiat bank accounts & Bitcoin wallets. All with a Bitcoin-native lens and privacy ethos.",
  heroEyebrow: "Starting with Bitcoin parents and families.",
  heroPrimaryCTA: "Start your 14-day free trial",
  heroSecondaryCTA: "Get the free children's book",

  shiftH2: "Bitcoiners are great at savings, but what about personal finances?",
  shiftP1:
    "Understanding our personal finances allows us to hodl stronger, accumulate more sats, and pass down more Bitcoin to our children for generational wealth.",
  shiftP2:
    "Especially as Bitcoin parents and families, we have the extra responsibility to prepare our children to be good with money, with Bitcoin. Knowing how our money moves in and out, setting low-time preference money goals, and achieving them through proof-of-work is the way.",
  shiftClose: "This is the Orange Way.",

  featuresH2:
    "Everything you'd expect from a personal finance app. Nothing you wouldn't trust it with.",
  features: [
    {
      glyph: "₿",
      title: "Sync your Bitcoin",
      body: "Connect your wallets and watch your full picture — fiat and Bitcoin — in one view. Native, not bolted on.",
    },
    {
      glyph: "⇄",
      title: "Track every transaction",
      body: "See where your money goes across accounts. Categorized, searchable, in one place.",
    },
    {
      glyph: "◷",
      title: "Set budgets that hold",
      body: "Build budgets you'll actually keep. Know your limits before you hit them.",
    },
    {
      glyph: "↗",
      title: "Build toward goals",
      body: "Set goals for your family and stack toward them. For the toddler, the move, the future.",
    },
  ],
  featuresPullQuote:
    "The Bitcoin-native personal finance tracking app to do all the above, all the while never having access to any of your data to track, sell, report, or hand over. You hold the keys to your cold wallet, so should you with your personal finance data.",

  btcEyebrow: "Bitcoin-native",
  btcH2: "Built for Bitcoiners by Bitcoiners. Not retrofitted for them.",
  btcBody:
    'Most money apps treat Bitcoin as an afterthought: a line item, a price ticker, a "crypto" tab. Orange Way is Bitcoin-native from the ground up. Connect your BTC wallets, track your sats alongside your spending, and manage your whole financial life without leaving the soundest money standard you\'ve already chosen.',
  btcPullQuote:
    "If you already protect your seed words for your Bitcoin cold storage, you already understand everything that makes Orange Way work.",

  privacyEyebrow: "Zero-knowledge privacy",
  privacyH2: "We can't ever see your data. By design, not by promise.",
  privacyBody:
    "Everything is encrypted on your device before it ever reaches us. Your password is the only key, and you hold it. We never have it. That means we can't read your data, can't sell it, can't hand it over… because we can't access it at all.",
  privacyCallout:
    "Protect your financial data the way you protect your Bitcoin: not your keys, not your data.",
  privacySubBody:
    "Other apps ask you to trust them with your credentials and your history. Privacy policies are cheap, and they change. We took the promise out and built it into the architecture.",
  privacyVisualCaption:
    "Left: your dashboard. Right: exactly what we store. This is what anyone who breaches our servers would find.",
  privacyTrustStrip: ["Encrypted on your device", "We can't read it", "Neither can a breach"],

  bookEyebrow: "Free children's e-book",
  bookH2Prefix: "A free e-book for your family about",
  bookH2Orange: "sound money.",
  bookBody:
    "Sato learns the difference between money that melts in your pocket and money that holds. Chocolate coins, gold, and one harder thing — told as a bedtime story your kids will understand before most adults do.",
  bookFormSubmit: "Send me the book",
  bookMicrocopy: "No trial required. We'll just email you the book.",

  pricingH2: "Start free. Pay when it earns its place.",
  pricingFreeTitle: "Free Trial",
  pricingFreeBody: "14 days. Full access. No credit card to start.",
  pricingFreePrice: "$0",
  pricingFreeUnit: "for 14 days",
  pricingFreeCTA: "Start free trial",
  pricingPaidTitle: "Subscription",
  pricingPaidBadge: "Beta",
  pricingPaidBody: "Full Orange Way after your trial ends.",
  pricingPaidPrice: "$100",
  pricingPaidUnit: "per year",
  pricingPaidCTA: "Coming after trial",
  pricingFooter: "Orange Way is in beta. Early users lock in $100/year for life.",

  visionH2: "Self-custody of your money. Then self-custody of your financial life.",
  visionP1:
    "You learned to hold your own keys. The next step is holding your own financial data, out of the hands of banks, bureaus, and the apps that monetize you.",
  visionP2:
    "We're starting with Bitcoin parents because you already understand why this matters, especially for your kids.",
  visionP3:
    "But the goal is bigger: a way for any family to control their financial life on a Bitcoin Standard.",
  visionClose: "“Have you tried the Orange Way?”",

  finalH2: "Take your Bitcoin financial life into your own hands.",
  finalPrimaryCTA: "Start your 14-day free trial",
  finalSecondaryCTA: "Get the free book",

  footerTagline: "Self-custody for your financial life.",
  footerColProduct: {
    title: "Product",
    items: [
      { label: "Features", href: "#features" },
      { label: "Privacy", href: "#privacy" },
    ],
  },
  footerColPricing: { title: "Pricing", items: [{ label: "Plans", href: "#pricing" }] },
  footerColResources: {
    title: "Resources",
    items: [
      { label: "Free Book", href: "#book" },
      { label: "Security", to: "/security" as const },
      { label: "Log in", to: "/auth" as const },
    ],
  },
  footerColLegal: {
    title: "Legal",
    items: [
      { label: "Privacy", to: "/privacy" as const },
      { label: "Terms", to: "/terms" as const },
    ],
  },
  footerLegalLine: "Orange Way. Built on a Bitcoin standard.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Palette + typography — locked design tokens.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  orange: "#F7931A",
  orangeSoft: "rgba(247, 147, 26, 0.10)",
  deep: "#0F172A",
  surface: "#FAFAF9",
  card: "#FFFFFF",
  border: "rgba(15, 23, 42, 0.08)",
  body: "#1F2937",
  muted: "#6B7280",
};

const FONT_HEADING =
  '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_BODY = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div style={{ background: C.surface, color: C.body, fontFamily: FONT_BODY }}>
      <Nav />
      <Hero />
      <Shift />
      <Features />
      <BitcoinNative />
      <Privacy />
      <Book />
      <Pricing />
      <Vision />
      <FinalCTA />
      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav
// ─────────────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{ background: "rgba(250, 250, 249, 0.8)", borderBottom: `1px solid ${C.border}` }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Logo />
        <div
          className="hidden items-center gap-8 text-sm font-medium md:flex"
          style={{ color: C.body }}
        >
          <a href="#features" className="transition-colors hover:text-orange-500">
            {COPY.navLinks.features}
          </a>
          <a href="#privacy" className="transition-colors hover:text-orange-500">
            {COPY.navLinks.privacy}
          </a>
          <a href="#pricing" className="transition-colors hover:text-orange-500">
            {COPY.navLinks.pricing}
          </a>
          <a href="#book" className="transition-colors hover:text-orange-500">
            {COPY.navLinks.book}
          </a>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/auth"
            className="text-sm font-medium transition-colors hover:text-orange-500"
            style={{ color: C.body }}
          >
            {COPY.navLogIn}
          </Link>
          <Link
            to="/auth"
            className="rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
            style={{ background: C.deep, color: "#fff" }}
          >
            {COPY.navCTA}
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 place-items-center rounded-lg text-base font-bold"
        style={{ background: C.orange, color: "#fff", fontFamily: FONT_HEADING }}
      >
        O
      </span>
      <span
        className="text-base font-bold tracking-tight"
        style={{ fontFamily: FONT_HEADING, color: C.deep }}
      >
        Orange Way
      </span>
      <span
        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
        style={{ background: C.orangeSoft, color: C.orange }}
      >
        Beta
      </span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────────

function RotatingWord() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % COPY.heroRotating.length), 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="relative inline-block">
      <span className="invisible">{COPY.heroRotating[0] || "Placeholder"}</span>
      <span
        key={idx}
        className="absolute inset-0 animate-[fadeUp_700ms_cubic-bezier(0.16,1,0.3,1)]"
        style={{ color: C.orange }}
      >
        {COPY.heroRotating[idx]}
      </span>
    </span>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-6 pt-10 pb-16 text-center md:pt-14 md:pb-20">
      <h1
        className="mx-auto max-w-5xl text-4xl font-bold leading-[1.05] tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl"
        style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
      >
        <RotatingWord />
        <br />
        {COPY.heroHeadingTail}
      </h1>
      <p
        className="mx-auto mt-5 max-w-2xl text-base leading-relaxed md:mt-6 md:text-lg"
        style={{ color: C.body, opacity: 0.85 }}
      >
        {COPY.heroBody}
      </p>
      <p
        className="mt-4 text-xs font-semibold uppercase tracking-[0.2em]"
        style={{ color: C.orange }}
      >
        {COPY.heroEyebrow}
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/auth"
          className="inline-flex items-center justify-center rounded-full px-7 py-3.5 text-base font-semibold transition-transform hover:-translate-y-0.5"
          style={{
            background: C.orange,
            color: "#fff",
            boxShadow: "0 10px 40px -10px rgba(247, 147, 26, 0.55)",
          }}
        >
          {COPY.heroPrimaryCTA}
        </Link>
        <a
          href="#book"
          className="inline-flex items-center justify-center rounded-full border px-7 py-3.5 text-base font-semibold"
          style={{ borderColor: C.border, color: C.deep, background: "#fff" }}
        >
          {COPY.heroSecondaryCTA}
        </a>
      </div>
      {/* Hero product shot — first visual moment. Sits below CTAs, full-bleed
          on mobile, max-w-5xl centered on desktop. */}
      <div className="mx-auto mt-10 max-w-5xl md:mt-12">
        <BitcoinMockup />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift — dark band
// ─────────────────────────────────────────────────────────────────────────────

function Shift() {
  return (
    <section className="px-6 py-24 md:py-32" style={{ background: C.deep, color: "#fff" }}>
      <div className="mx-auto max-w-4xl">
        <h2
          className="text-3xl font-bold leading-tight tracking-tight md:text-5xl"
          style={{ fontFamily: FONT_HEADING, letterSpacing: "-0.02em" }}
        >
          {COPY.shiftH2}
        </h2>
        <p className="mt-8 text-lg leading-relaxed md:text-xl" style={{ opacity: 0.85 }}>
          {COPY.shiftP1}
        </p>
        <p className="mt-5 text-lg leading-relaxed md:text-xl" style={{ opacity: 0.85 }}>
          {COPY.shiftP2}
        </p>
        <p
          className="mt-8 text-2xl italic md:text-3xl"
          style={{ fontFamily: FONT_HEADING, color: C.orange }}
        >
          {COPY.shiftClose}
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Features — 4 tiles
// ─────────────────────────────────────────────────────────────────────────────

function Features() {
  return (
    <section id="features" className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-7xl">
        <h2
          className="max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-5xl"
          style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
        >
          {COPY.featuresH2}
        </h2>
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          {COPY.features.map((f, i) => (
            <div
              key={i}
              className="rounded-2xl border bg-white p-6 transition-shadow hover:shadow-md"
              style={{ borderColor: C.border, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
            >
              <div
                className="grid h-11 w-11 place-items-center rounded-xl text-xl"
                style={{ background: C.orangeSoft, color: C.orange, fontFamily: FONT_MONO }}
              >
                {f.glyph}
              </div>
              <h3
                className="mt-5 text-lg font-semibold tracking-tight"
                style={{ fontFamily: FONT_HEADING, color: C.deep }}
              >
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
        <blockquote
          className="mt-14 max-w-3xl border-l-4 pl-6 text-lg italic leading-relaxed md:text-xl"
          style={{ borderColor: C.orange, color: C.body }}
        >
          {COPY.featuresPullQuote}
        </blockquote>

        {/* In action — two product shots stacked side by side under the
            feature tiles. Visual proof that what's described above is
            already running. */}
        <div className="mt-20 grid gap-6 lg:grid-cols-2">
          <figure>
            <BudgetMockup />
            <figcaption
              className="mt-3 text-sm font-medium"
              style={{ color: C.muted, fontFamily: FONT_HEADING }}
            >
              Budgets — categories, progress, and what's left this month.
            </figcaption>
          </figure>
          <figure>
            <HouseholdMockup />
            <figcaption
              className="mt-3 text-sm font-medium"
              style={{ color: C.muted, fontFamily: FONT_HEADING }}
            >
              Household — shared and private spending, side by side.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bitcoin-native
// ─────────────────────────────────────────────────────────────────────────────

function BitcoinNative() {
  return (
    <section className="px-6 py-24 md:py-32" style={{ background: "rgba(15, 23, 42, 0.03)" }}>
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: C.orange }}
          >
            {COPY.btcEyebrow}
          </p>
          <h2
            className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-5xl"
            style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
          >
            {COPY.btcH2}
          </h2>
          <p
            className="mt-6 text-lg leading-relaxed md:text-xl"
            style={{ color: C.body, opacity: 0.9 }}
          >
            {COPY.btcBody}
          </p>
          <blockquote
            className="mt-6 border-l-4 pl-6 text-base italic leading-relaxed"
            style={{ borderColor: C.orange, color: C.body }}
          >
            {COPY.btcPullQuote}
          </blockquote>
        </div>
        <div>
          <BitcoinMockup />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Privacy — signature visual
// ─────────────────────────────────────────────────────────────────────────────

function Privacy() {
  return (
    <section id="privacy" className="px-6 py-24 md:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: C.orange }}
          >
            {COPY.privacyEyebrow}
          </p>
          <h2
            className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-5xl"
            style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
          >
            {COPY.privacyH2}
          </h2>
          <p className="mt-7 text-lg leading-relaxed" style={{ color: C.body, opacity: 0.9 }}>
            {COPY.privacyBody}
          </p>
          <div
            className="mt-7 rounded-2xl p-5"
            style={{ background: C.orangeSoft, border: `1px solid ${C.orange}55` }}
          >
            <p className="text-base font-bold leading-snug" style={{ color: C.orange }}>
              {COPY.privacyCallout}
            </p>
          </div>
          <p className="mt-7 text-base leading-relaxed" style={{ color: C.body, opacity: 0.85 }}>
            {COPY.privacySubBody}
          </p>
        </div>
        <PrivacyVisual />
      </div>
      <div
        className="mx-auto mt-20 grid max-w-7xl gap-6 border-y py-8 text-center md:grid-cols-3"
        style={{ borderColor: C.border, color: C.deep }}
      >
        {COPY.privacyTrustStrip.map((s, i) => (
          <span key={i} className="text-sm font-semibold tracking-tight">
            {s}
          </span>
        ))}
      </div>
    </section>
  );
}

function PrivacyVisual() {
  return (
    <div>
      <picture>
        <source media="(max-width: 640px)" srcSet="/marketing/privacy-diagram-mobile.webp" />
        <img
          src="/marketing/privacy-diagram.webp"
          alt="Your dashboard side by side with what we store on the server — readable on your device, opaque ciphertext on ours."
          className="w-full rounded-2xl"
          style={{ boxShadow: "0 30px 60px -20px rgba(15,23,42,0.25)" }}
          loading="lazy"
          width={1280}
          height={896}
        />
      </picture>
      <p className="mt-4 text-xs" style={{ color: C.muted }}>
        {COPY.privacyVisualCaption}
      </p>
    </div>
  );
}

// PrivacyVisual is now a single polished diagram (public/marketing/privacy-diagram.webp).
// The prior hand-rolled WindowDots + LedgerRow + CIPHER blob were retired.

// ─────────────────────────────────────────────────────────────────────────────
// Book — Sato + Chocolate Coins lead magnet
// ─────────────────────────────────────────────────────────────────────────────

// TODO: extract a shared <BookEmailForm /> with src/routes/landing-classic.tsx
// BookForm: both routes carry near-identical schema + submit logic. Tracked
// as a follow-up so this PR stays focused on un-breaking the form.
const bookSchema = z.object({
  email: z.string().trim().email("That doesn't look like an email").max(255),
});

function Book() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const parsed = bookSchema.safeParse({ email });
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Something is off.");
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: "book", email: parsed.data.email }),
      });
      if (!resp.ok) {
        setErr("Something went wrong. Try again in a minute.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setErr("Network error. Try again in a minute.");
      setSubmitting(false);
    }
  };

  return (
    <section id="book" className="px-6 py-24 md:py-32">
      <div
        className="mx-auto grid max-w-7xl gap-10 rounded-3xl p-10 md:p-14 lg:grid-cols-2 lg:gap-14"
        style={{ background: C.orangeSoft }}
      >
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.2em]"
            style={{ color: C.orange }}
          >
            {COPY.bookEyebrow}
          </p>
          <h2
            className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-5xl"
            style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
          >
            {COPY.bookH2Prefix} <span style={{ color: C.orange }}>{COPY.bookH2Orange}</span>
          </h2>
          <p className="mt-6 text-lg leading-relaxed" style={{ color: C.body, opacity: 0.9 }}>
            {COPY.bookBody}
          </p>
          {done ? (
            <p
              className="mt-7 text-base font-semibold"
              style={{ color: C.deep }}
              role="status"
              aria-live="polite"
            >
              {"Saved. We'll email you when the book ships."}
            </p>
          ) : (
            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="book-email" className="sr-only">
                Email address
              </label>
              <input
                id="book-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                disabled={submitting}
                className="flex-1 rounded-full border px-5 py-3 text-base outline-none focus:ring-2"
                style={{ borderColor: C.border, background: "#fff" }}
                aria-invalid={err ? true : undefined}
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full px-6 py-3 text-base font-semibold transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: C.deep, color: "#fff" }}
              >
                {submitting ? "Sending…" : COPY.bookFormSubmit}
              </button>
            </form>
          )}
          {err ? (
            <p className="mt-3 text-sm font-medium" style={{ color: "#B91C1C" }} role="alert">
              {err}
            </p>
          ) : (
            <p className="mt-3 text-xs" style={{ color: C.muted }}>
              {COPY.bookMicrocopy}{" "}
              <Link
                to="/privacy"
                className="underline underline-offset-2 hover:opacity-80"
                style={{ color: C.muted }}
              >
                Privacy
              </Link>
              .
            </p>
          )}
        </div>
        <div className="flex items-center justify-center">
          <img
            src={bookCover}
            alt="Children's book cover"
            className="max-w-full rounded-xl transition-transform duration-500"
            style={{
              transform: "rotate(2deg)",
              boxShadow: "0 25px 50px -12px rgba(15,23,42,0.35)",
              maxHeight: "32rem",
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = "rotate(0deg)")}
            onMouseOut={(e) => (e.currentTarget.style.transform = "rotate(2deg)")}
          />
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

function Pricing() {
  return (
    <section id="pricing" className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-4xl">
        <h2
          className="text-center text-3xl font-bold leading-tight tracking-tight md:text-5xl"
          style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
        >
          {COPY.pricingH2}
        </h2>
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <div
            className="rounded-2xl border bg-white p-8"
            style={{ borderColor: C.border, boxShadow: "0 4px 24px rgba(15,23,42,0.06)" }}
          >
            <h3
              className="text-xl font-bold tracking-tight"
              style={{ fontFamily: FONT_HEADING, color: C.deep }}
            >
              {COPY.pricingFreeTitle}
            </h3>
            <p className="mt-2 text-sm" style={{ color: C.muted }}>
              {COPY.pricingFreeBody}
            </p>
            <p
              className="mt-6 text-5xl font-bold tracking-tight"
              style={{ fontFamily: FONT_HEADING, color: C.deep }}
            >
              {COPY.pricingFreePrice}
            </p>
            <p className="mt-1 text-sm" style={{ color: C.muted }}>
              {COPY.pricingFreeUnit}
            </p>
            <Link
              to="/auth"
              className="mt-8 inline-flex w-full items-center justify-center rounded-full px-6 py-3 text-base font-semibold transition-transform hover:-translate-y-0.5"
              style={{
                background: C.orange,
                color: "#fff",
                boxShadow: "0 10px 40px -10px rgba(247, 147, 26, 0.55)",
              }}
            >
              {COPY.pricingFreeCTA}
            </Link>
          </div>
          <div className="rounded-2xl p-8" style={{ background: C.deep, color: "#fff" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold tracking-tight" style={{ fontFamily: FONT_HEADING }}>
                {COPY.pricingPaidTitle}
              </h3>
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: C.orangeSoft, color: C.orange }}
              >
                {COPY.pricingPaidBadge}
              </span>
            </div>
            <p className="mt-2 text-sm" style={{ opacity: 0.7 }}>
              {COPY.pricingPaidBody}
            </p>
            <p
              className="mt-6 text-5xl font-bold tracking-tight"
              style={{ fontFamily: FONT_HEADING }}
            >
              {COPY.pricingPaidPrice}
            </p>
            <p className="mt-1 text-sm" style={{ opacity: 0.7 }}>
              {COPY.pricingPaidUnit}
            </p>
            <button
              type="button"
              disabled
              className="mt-8 inline-flex w-full cursor-not-allowed items-center justify-center rounded-full px-6 py-3 text-base font-semibold"
              style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}
            >
              {COPY.pricingPaidCTA}
            </button>
          </div>
        </div>
        <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>
          {COPY.pricingFooter}
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision
// ─────────────────────────────────────────────────────────────────────────────

function Vision() {
  return (
    <section className="px-6 py-24 md:py-32">
      <div className="mx-auto max-w-3xl text-center">
        <h2
          className="text-3xl font-bold leading-tight tracking-tight md:text-5xl"
          style={{ fontFamily: FONT_HEADING, color: C.deep, letterSpacing: "-0.02em" }}
        >
          {COPY.visionH2}
        </h2>
        <p className="mt-7 text-lg leading-relaxed" style={{ color: C.body, opacity: 0.9 }}>
          {COPY.visionP1}
        </p>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: C.body, opacity: 0.9 }}>
          {COPY.visionP2}
        </p>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: C.body, opacity: 0.9 }}>
          {COPY.visionP3}
        </p>
        <p
          className="mt-10 text-2xl italic md:text-3xl"
          style={{ fontFamily: FONT_HEADING, color: C.orange }}
        >
          {COPY.visionClose}
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Final CTA
// ─────────────────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="px-6 pb-24">
      <div
        className="mx-auto max-w-7xl rounded-3xl p-10 text-center md:p-16"
        style={{ background: C.deep, color: "#fff" }}
      >
        <h2
          className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-5xl"
          style={{ fontFamily: FONT_HEADING, letterSpacing: "-0.02em" }}
        >
          {COPY.finalH2}
        </h2>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-full px-7 py-3.5 text-base font-semibold transition-transform hover:scale-105"
            style={{
              background: C.orange,
              color: "#fff",
              boxShadow: "0 10px 40px -10px rgba(247, 147, 26, 0.55)",
            }}
          >
            {COPY.finalPrimaryCTA}
          </Link>
          <a
            href="#book"
            className="inline-flex items-center justify-center rounded-full border px-7 py-3.5 text-base font-semibold"
            style={{ borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}
          >
            {COPY.finalSecondaryCTA}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t px-6 py-14" style={{ borderColor: C.border }}>
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm" style={{ color: C.muted }}>
            {COPY.footerTagline}
          </p>
        </div>
        <FooterCol col={COPY.footerColProduct} />
        <FooterCol col={COPY.footerColPricing} />
        <FooterCol col={COPY.footerColResources} />
        <FooterCol col={COPY.footerColLegal} />
      </div>
      <div
        className="mx-auto mt-10 max-w-7xl border-t pt-6 text-xs"
        style={{ borderColor: C.border, color: C.muted }}
      >
        © {year} {COPY.footerLegalLine}
      </div>
    </footer>
  );
}

function FooterCol({
  col,
}: {
  col: {
    title: string;
    items: Array<{
      label: string;
      href?: string;
      to?: "/auth" | "/security" | "/privacy" | "/terms";
    }>;
  };
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.deep }}>
        {col.title}
      </h4>
      <ul className="mt-4 space-y-2 text-sm">
        {col.items.map((it, i) => (
          <li key={it.label || `item-${i}`}>
            {it.to ? (
              <Link
                to={it.to}
                className="transition-colors hover:text-orange-500"
                style={{ color: C.muted }}
              >
                {it.label}
              </Link>
            ) : (
              <a
                href={it.href}
                className="transition-colors hover:text-orange-500"
                style={{ color: C.muted }}
              >
                {it.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
