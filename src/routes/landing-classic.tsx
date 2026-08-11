import { useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { useSignupForm } from "@/lib/marketing/useSignupForm";
import bookCover from "@/assets/orange-way/book-cover.png";
import { BudgetMockup } from "@/components/marketing/mockups/BudgetMockup";
import { BitcoinMockup } from "@/components/marketing/mockups/BitcoinMockup";
import { HouseholdMockup } from "@/components/marketing/mockups/HouseholdMockup";
import { PrivacyDiagram } from "@/components/marketing/PrivacyDiagram";

// Brand palette — locked.
const C = {
  burnt: "#E2632E",
  brown: "#3A2012",
  cream: "#FBF6EF",
  warm: "#F8EDD9",
  peach: "#F0A07C",
  btc: "#F7931A",
};

export const Route = createFileRoute("/landing-classic")({
  head: () => ({
    meta: [
      { title: "OrangeWay, The only finance app we can't read." },
      {
        name: "description",
        content:
          "A private finance tracker for households that hold fiat and Bitcoin. Zero knowledge encrypted in your browser. Built for families, not advertisers.",
      },
      { property: "og:title", content: "OrangeWay, The only finance app we can't read." },
      {
        property: "og:description",
        content:
          "Track fiat, Bitcoin, and your household's net worth. Encrypted in your browser before it touches our servers.",
      },
      { property: "og:url", content: "https://orangeway.app/" },
      { property: "og:image", content: "https://orangeway.app/og-image.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "OrangeWay, the only finance app we can't read." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OrangeWay" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OrangeWay, The only finance app we can't read." },
      {
        name: "twitter:description",
        content: "Zero knowledge personal finance for households that hold fiat and Bitcoin.",
      },
      { name: "twitter:image", content: "https://orangeway.app/og-image.jpg" },
      { name: "theme-color", content: C.cream },
    ],
    links: [{ rel: "canonical", href: "https://orangeway.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "OrangeWay",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://orangeway.app",
          description:
            "Zero knowledge personal finance tracker for households holding fiat and Bitcoin. Encrypted in the browser; servers cannot read user data.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" />;
  return <Landing />;
}

const fontSans = `"Inter", ui-sans-serif, system-ui, sans-serif`;
const fontDisplay = `"Fraunces", ui-serif, Georgia, serif`;

function Landing() {
  return (
    <div
      style={{ background: C.cream, color: C.brown, fontFamily: fontSans, minHeight: "100vh" }}
      className="ow-me"
    >
      <Header />
      <Hero />
      <FeatureShowcase />
      <PrivacyDiagram />
      <Features />
      <PrivacyFAQ />
      <PromisesCallout />
      <WhyWeBuiltThis />
      <BookSection />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <div
        style={{ fontFamily: fontDisplay, color: C.brown }}
        className="text-lg font-bold tracking-tight"
      >
        Orange<span style={{ color: C.burnt }}>Way</span>
      </div>
      <a
        href="#waitlist"
        style={{ background: C.burnt, color: C.cream }}
        className="rounded-full px-4 py-2 text-sm font-semibold transition-transform hover:scale-[1.03]"
      >
        {"Join the waitlist"}
      </a>
    </header>
  );
}

/* ──────────────────────────────  HERO  ────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-8 pb-12 md:pt-14 md:pb-20">
      <div className="grid items-center gap-12 md:grid-cols-[1fr_1.05fr] md:gap-14">
        <div>
          <h1
            style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.02 }}
            className="text-balance text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl"
          >
            {"Track all your money. In one place."}{" "}
            <span style={{ color: C.burnt, fontStyle: "italic", fontWeight: 600 }}>
              {"Privately."}
            </span>
          </h1>

          <p
            style={{ fontFamily: fontDisplay, color: C.burnt, fontStyle: "italic" }}
            className="mt-3 text-xl font-semibold tracking-tight md:text-2xl"
          >
            {"Self custody for your financial life."}
          </p>

          <p
            className="mt-6 max-w-xl text-balance text-lg md:text-xl"
            style={{ color: C.brown, opacity: 0.85 }}
          >
            {
              "Track every account: checking, savings, credit cards, investments, your Bitcoin. Built for households. You own the password, so we don't see your numbers."
            }
          </p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a
              href="#waitlist"
              style={{ background: C.burnt, color: C.cream }}
              className="rounded-full px-7 py-3.5 text-base font-semibold shadow-[0_4px_0_0_rgba(58,32,18,0.18)] transition-transform hover:scale-[1.03] active:translate-y-[1px]"
            >
              {"Join the waitlist"}
            </a>
            <a
              href="#features"
              style={{ borderColor: C.brown, color: C.brown }}
              className="rounded-full border-2 px-7 py-3 text-base font-semibold hover:bg-[#F8EDD9]"
            >
              {"See how it works"}
            </a>
          </div>

          <p className="mt-5 text-sm" style={{ color: C.brown, opacity: 0.75 }}>
            <span style={{ fontWeight: 600 }}>{"Private beta · First 100 households"}</span>{" "}
            {
              "Open beta. The first 100 households get lifetime founder pricing, $100 a year, locked in forever."
            }
          </p>

          <p
            className="mt-6 text-xs uppercase tracking-wider"
            style={{ color: C.brown, opacity: 0.55, letterSpacing: "0.08em" }}
          >
            {"Private · Bitcoin friendly · Built for families"}
          </p>
        </div>

        {/* Product mockup, built in CSS, looks crisp & real */}
        <DashboardMock />
      </div>
    </section>
  );
}

/* ──────────────────────────────  FEATURE SHOWCASE  ────────────────────────────── */

function FeatureShowcase() {
  const rows = [
    {
      heading: "Every dollar, every category.",
      paragraph:
        "Set budgets you can live with. Watch where the month is going. Catch overspending before payday tells you.",
      mock: <BudgetMockup />,
    },
    {
      heading: "Your sats, treated like real money.",
      paragraph:
        "Real Bitcoin support, not a crypto bolt-on. Cost basis per lot, DCA tracking, Lightning and on chain in one balance. Switch between dollars, BTC and sats with one tap.",
      mock: <BitcoinMockup />,
    },
    {
      heading: "Share what matters. Keep what's yours.",
      paragraph:
        "Choose which accounts your partner sees. Keep the rest private. No shared passwords, no screenshot updates, just a clear view of the joint stuff and a wall around the personal stuff.",
      mock: <HouseholdMockup />,
    },
  ];
  return (
    <section className="px-6 py-10 md:py-16" style={{ background: C.cream }}>
      <div className="mx-auto max-w-6xl space-y-12 md:space-y-16">
        {rows.map((r, i) => (
          <div
            key={r.heading}
            className={`grid items-center gap-10 md:gap-14 md:grid-cols-2 ${
              i % 2 === 1 ? "md:[&>*:first-child]:order-2" : ""
            }`}
          >
            <div>{r.mock}</div>
            <div>
              <h3
                style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.05 }}
                className="text-balance text-3xl font-bold tracking-tight md:text-4xl"
              >
                {r.heading}
              </h3>
              <p
                className="mt-4 text-[17px] leading-relaxed"
                style={{ color: C.brown, opacity: 0.82 }}
              >
                {r.paragraph}
              </p>
            </div>
          </div>
        ))}
        <div className="text-center">
          <a
            href="#features"
            style={{ color: C.burnt }}
            className="text-sm font-semibold underline-offset-4 hover:underline"
          >
            {"See every feature →"}
          </a>
        </div>
      </div>
    </section>
  );
}

function MockChrome({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: C.cream,
        border: `1px solid ${C.brown}1f`,
        boxShadow: "0 30px 60px -20px rgba(58,32,18,0.35), 0 8px 24px -8px rgba(58,32,18,0.18)",
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ background: C.warm, borderBottom: `1px solid ${C.brown}1a` }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 999, background: "#E5867A" }} />
        <span style={{ width: 10, height: 10, borderRadius: 999, background: "#E8C26E" }} />
        <span style={{ width: 10, height: 10, borderRadius: 999, background: "#9BBF8A" }} />
        {label ? (
          <span className="ml-3 text-[11px] font-medium" style={{ color: C.brown, opacity: 0.6 }}>
            {label}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DashboardMock() {
  return (
    <div className="relative">
      <MockChrome label="orange-way.app/dashboard">
        <div className="grid grid-cols-[120px_1fr]" style={{ minHeight: 420 }}>
          {/* Sidebar */}
          <aside
            className="flex flex-col gap-1.5 p-4 text-[11px] font-semibold"
            style={{ background: C.warm, color: C.brown, opacity: 0.95 }}
          >
            <NavItem active>● Dashboard</NavItem>
            <NavItem>Accounts</NavItem>
            <NavItem>Bitcoin</NavItem>
            <NavItem>Budgets</NavItem>
            <NavItem>Goals</NavItem>
            <NavItem>Household</NavItem>
          </aside>

          {/* Main */}
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.6 }}>
                  Household net worth
                </p>
                <p
                  className="mt-1 text-3xl font-bold tracking-tight"
                  style={{ fontFamily: fontDisplay, color: C.brown }}
                >
                  $284,512
                </p>
                <p className="text-xs" style={{ color: "#1f7a4d" }}>
                  ▲ $4,210 this month
                </p>
              </div>
              <div className="flex gap-1 rounded-full p-1" style={{ background: C.warm }}>
                {["USD", "sats", "BTC"].map((t) => (
                  <span
                    key={t}
                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                    style={
                      t === "USD"
                        ? { background: C.burnt, color: C.cream }
                        : { color: C.brown, opacity: 0.6 }
                    }
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <SparkChart />

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniCard label="Cash + bank" value="$48,210" tint={C.warm} />
              <MiniCard label="Bitcoin" value="0.2451 ₿" tint="#FFE9D6" accent />
              <MiniCard label="Investments" value="$192,841" tint={C.warm} />
            </div>
          </div>
        </div>
      </MockChrome>

      {/* Floating "encrypted" badge */}
      <div
        className="absolute -left-3 top-6 hidden rotate-[-6deg] rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider md:block"
        style={{
          background: C.brown,
          color: C.cream,
          boxShadow: "0 6px 16px rgba(58,32,18,0.3)",
          letterSpacing: "0.08em",
        }}
      >
        🔒 TRUE end to end encrypted
      </div>
    </div>
  );
}

function NavItem({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={active ? { background: C.burnt, color: C.cream } : { color: C.brown, opacity: 0.7 }}
    >
      {children}
    </div>
  );
}

function MiniCard({
  label,
  value,
  tint,
  accent,
}: {
  label: string;
  value: string;
  tint: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: tint, border: `1px solid ${C.brown}14` }}
    >
      <p className="text-[9px] uppercase tracking-wider" style={{ opacity: 0.6 }}>
        {label}
      </p>
      <p
        className="mt-0.5 text-sm font-bold"
        style={{ fontFamily: fontDisplay, color: accent ? C.btc : C.brown }}
      >
        {value}
      </p>
    </div>
  );
}

function SparkChart() {
  // Simple SVG line chart
  const pts = [40, 38, 42, 41, 44, 47, 45, 49, 52, 56, 54, 60, 64, 62, 68, 72];
  const w = 420;
  const h = 110;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const path = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((p - min) / (max - min)) * (h - 10) - 5;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.burnt} stopOpacity="0.35" />
          <stop offset="100%" stopColor={C.burnt} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#g1)" />
      <path d={path} fill="none" stroke={C.burnt} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ──────────────────────────────  FEATURES  ────────────────────────────── */

function Features() {
  return (
    <section id="features" className="px-6 py-14 md:py-20" style={{ background: C.cream }}>
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.burnt }}>
            {"How it works"}
          </p>
          <h2
            style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.05 }}
            className="mt-3 text-balance text-4xl font-bold tracking-tight md:text-5xl"
          >
            {"Everything you own, everything you owe,"}{" "}
            <span style={{ fontStyle: "italic", color: C.burnt }}>{"including your Bitcoin."}</span>
          </h2>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2 md:gap-8">
          <FeatureBlock
            title="You own the password. We never see it."
            body="Most apps say “trust us.” With Orange Way, you don’t have to. Your password is the only key to your data, it never leaves your device. If we wanted to read your numbers, we couldn’t. If a court asked us to, we couldn’t. That’s the whole design."
            mock={<MockEncryption />}
          />
          <FeatureBlock
            title="Everything in one place."
            body="Checking, savings, credit cards, investments, your Bitcoin wallet. One household, one view, one number."
            mock={<MockConnect />}
          />
          <FeatureBlock
            title="Dollars, sats, or BTC."
            body="Toggle the whole dashboard between dollars and Bitcoin units. Watch your household net worth trend month over month."
            mock={<MockNetWorth />}
          />
          <FeatureBlock
            title="Real Bitcoin support."
            body="Cost basis per lot. DCA progress. Lightning and on chain in one balance. Connect your wallet read only, your keys stay on your hardware."
            mock={<MockBitcoin />}
          />
          <FeatureBlock
            title="Budgets that fit your month."
            body="Transactions auto categorize. You correct the ones we miss. Set budgets, see where the month is going, catch problems before payday tells you."
            mock={<MockBudgets />}
          />
          <FeatureBlock
            title="Save for a house. Stack toward a BTC milestone. Same view."
            body="Dollar goals and Bitcoin stacking goals sit side by side. Real progress on both."
            mock={<MockGoals />}
          />
          <FeatureBlock
            title="Built for the whole household."
            body="Invite your partner with full access. Invite your kids with safe views, just their allowance, their savings, in plain words they can read."
            mock={<MockHousehold />}
            wide
          />
        </div>

        {/* Killer pull-quote */}
        <div className="mt-14">
          <div
            className="rounded-3xl px-8 py-10 text-center md:px-16 md:py-14"
            style={{
              background: C.warm,
              border: `1px solid ${C.brown}1a`,
            }}
          >
            <p
              className="mx-auto max-w-4xl text-balance text-3xl font-bold leading-tight md:text-4xl lg:text-5xl"
              style={{ fontFamily: fontDisplay, fontStyle: "italic", color: C.burnt }}
            >
              {'Other apps say "trust us with your data." We made sure you don\'t have to.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBlock({
  title,
  body,
  mock,
  wide,
}: {
  title: string;
  body: string;
  mock: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-6 md:p-8 ${wide ? "md:col-span-2" : ""}`}
      style={{
        background: "white",
        border: `1px solid ${C.brown}14`,
        boxShadow: "0 1px 0 rgba(58,32,18,0.04)",
      }}
    >
      <div className="mb-5">{mock}</div>
      <h3
        className="text-xl font-bold tracking-tight md:text-2xl"
        style={{ fontFamily: fontDisplay, color: C.brown }}
      >
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: C.brown, opacity: 0.78 }}>
        {body}
      </p>
    </div>
  );
}

/* ──────────────  Feature Mocks  ────────────── */

function MockEncryption() {
  return (
    <MockChrome label="settings · security">
      <div className="p-5" style={{ background: C.cream }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold" style={{ color: C.brown }}>
            TRUE end to end encryption
          </p>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: "#1f7a4d", color: "white" }}
          >
            ACTIVE
          </span>
        </div>
        <div
          className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed"
          style={{ background: C.warm, color: C.brown }}
        >
          <p>
            <span style={{ opacity: 0.55 }}>Server sees:</span>{" "}
            <span style={{ fontFamily: "ui-monospace, monospace" }}>
              ▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓▓▓▓ $▓▓,▓▓▓
            </span>
          </p>
          <p className="mt-1">
            <span style={{ opacity: 0.55 }}>You see:</span>{" "}
            <span style={{ fontWeight: 600 }}>Chase Checking · $12,481</span>
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: C.brown }}>
          <span style={{ color: C.burnt }}>🔒</span>
          <span>Encrypted with your password, in your browser. We can't access it.</span>
        </div>
      </div>
    </MockChrome>
  );
}

function MockConnect() {
  const items = [
    { name: "Kraken", tag: "Exchange" },
    { name: "Strike", tag: "Lightning" },
    { name: "River", tag: "Exchange" },
    { name: "Cash App", tag: "Wallet" },
    { name: "Phoenix LN", tag: "Lightning" },
  ];
  return (
    <MockChrome label="connect an account">
      <div className="p-5" style={{ background: C.cream }}>
        <p className="text-xs font-semibold" style={{ color: C.brown, opacity: 0.7 }}>
          Add a source
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {items.map((i) => (
            <div
              key={i.name}
              className="flex items-center gap-2 rounded-lg p-2.5"
              style={{ background: C.warm, border: `1px solid ${C.brown}14` }}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold"
                style={{ background: C.burnt, color: C.cream }}
              >
                {i.name[0]}
              </span>
              <div>
                <p className="text-[11px] font-bold" style={{ color: C.brown }}>
                  {i.name}
                </p>
                <p className="text-[9px]" style={{ color: C.brown, opacity: 0.55 }}>
                  {i.tag}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockChrome>
  );
}

function MockNetWorth() {
  return (
    <MockChrome label="net worth · 12mo">
      <div className="p-5" style={{ background: C.cream }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold" style={{ fontFamily: fontDisplay, color: C.brown }}>
              $284,512
            </p>
            <p className="text-[10px]" style={{ color: "#1f7a4d" }}>
              ▲ 18.2% YoY
            </p>
          </div>
          <div className="flex gap-1 rounded-full p-1" style={{ background: C.warm }}>
            {["USD", "sats", "BTC"].map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                style={
                  t === "USD"
                    ? { background: C.burnt, color: C.cream }
                    : { color: C.brown, opacity: 0.6 }
                }
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <SparkChart />
      </div>
    </MockChrome>
  );
}

function MockBitcoin() {
  const lots = [
    { d: "Mar 12", a: "0.0500", p: "$28,400" },
    { d: "Apr 02", a: "0.0480", p: "$31,100" },
    { d: "May 01", a: "0.0500", p: "$33,250" },
  ];
  return (
    <MockChrome label="bitcoin · holdings">
      <div className="p-5" style={{ background: C.cream }}>
        <p
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: fontDisplay, color: C.btc }}
        >
          0.2451 ₿
        </p>
        <p className="text-[11px]" style={{ color: C.brown, opacity: 0.7 }}>
          24,510,000 sats · $26,142
        </p>
        <div className="mt-3 space-y-1.5">
          {lots.map((l) => (
            <div
              key={l.d}
              className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px]"
              style={{ background: C.warm, color: C.brown }}
            >
              <span style={{ opacity: 0.7 }}>{l.d}</span>
              <span style={{ fontWeight: 700 }}>{l.a} ₿</span>
              <span style={{ opacity: 0.6 }}>{l.p}</span>
            </div>
          ))}
        </div>
      </div>
    </MockChrome>
  );
}

function MockBudgets() {
  const cats = [
    { n: "Groceries", p: 72 },
    { n: "Mortgage", p: 100 },
    { n: "Eating out", p: 48 },
    { n: "Transport", p: 35 },
  ];
  return (
    <MockChrome label="budgets · this month">
      <div className="space-y-3 p-5" style={{ background: C.cream }}>
        {cats.map((c) => (
          <div key={c.n}>
            <div
              className="mb-1 flex justify-between text-[11px] font-semibold"
              style={{ color: C.brown }}
            >
              <span>{c.n}</span>
              <span style={{ opacity: 0.6 }}>{c.p}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: C.warm }}>
              <div
                style={{
                  width: `${c.p}%`,
                  height: "100%",
                  background: c.p >= 100 ? "#9b2c2c" : C.burnt,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </MockChrome>
  );
}

function MockGoals() {
  return (
    <MockChrome label="goals">
      <div className="grid grid-cols-2 gap-3 p-5" style={{ background: C.cream }}>
        <GoalCard label="Down payment" big="$32,400" sub="of $50,000" pct={65} color={C.burnt} />
        <GoalCard label="Stack to 0.1 BTC" big="0.078 ₿" sub="of 0.100 ₿" pct={78} color={C.btc} />
      </div>
    </MockChrome>
  );
}

function GoalCard({
  label,
  big,
  sub,
  pct,
  color,
}: {
  label: string;
  big: string;
  sub: string;
  pct: number;
  color: string;
}) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: C.warm, border: `1px solid ${C.brown}14` }}
    >
      <div className="flex items-center gap-2.5">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r={r} fill="none" stroke={`${C.brown}20`} strokeWidth="6" />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            strokeLinecap="round"
            transform="rotate(-90 28 28)"
          />
        </svg>
        <div>
          <p className="text-[10px] font-semibold" style={{ color: C.brown, opacity: 0.7 }}>
            {label}
          </p>
          <p className="text-sm font-bold" style={{ fontFamily: fontDisplay, color: C.brown }}>
            {big}
          </p>
          <p className="text-[9px]" style={{ color: C.brown, opacity: 0.6 }}>
            {sub}
          </p>
        </div>
      </div>
    </div>
  );
}

function MockHousehold() {
  const members = [
    { n: "You", role: "admin", color: C.burnt },
    { n: "Sarah", role: "partner · full access", color: "#7a9c6e" },
    { n: "Mateo (8)", role: "kid view · allowance", color: C.peach },
  ];
  return (
    <MockChrome label="household">
      <div className="p-5" style={{ background: C.cream }}>
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.n}
              className="flex items-center gap-3 rounded-lg p-2.5"
              style={{ background: C.warm, border: `1px solid ${C.brown}14` }}
            >
              <span
                className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold"
                style={{ background: m.color, color: C.cream }}
              >
                {m.n[0]}
              </span>
              <div className="flex-1">
                <p
                  className="text-[12px] font-bold"
                  style={{ fontFamily: fontDisplay, color: C.brown }}
                >
                  {m.n}
                </p>
                <p className="text-[10px]" style={{ color: C.brown, opacity: 0.6 }}>
                  {m.role}
                </p>
              </div>
              <span className="text-[10px] font-semibold" style={{ color: C.brown, opacity: 0.5 }}>
                ⚙
              </span>
            </div>
          ))}
        </div>
      </div>
    </MockChrome>
  );
}

/* ──────────────────────────────  PRIVACY FAQ  ────────────────────────────── */

const PRIVACY_FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Why does this matter right now?",
    a: (
      <>
        <p>{"Financial surveillance is escalating fast, on a deadline that is already past."}</p>
        <p className="mt-3">
          {
            "In the US, IRS Form 1099-DA goes live in January 2026. Every exchange must report every transaction with your name and tax ID attached. In the EU, the DAC8 directive starts the same month. Every crypto service shares user data with tax authorities by default. 48 countries signed onto the OECD CARF framework to share that data with each other starting 2027."
          }
        </p>
        <p className="mt-3">
          {
            "Meanwhile the apps that touch your finances keep losing data. LastPass got breached and the encrypted vaults were taken; offline cracking of weak master passwords has been linked to more than $35M in downstream crypto theft. Equifax leaked 147 million Americans' identity records in 2017. Under the US CLOUD Act, your cloud provider can be compelled to hand over your data and ordered not to tell you."
          }
        </p>
        <p className="mt-3">
          {
            "We are not anti tax. We are pro architecture. Knowing what your own household spends should not require an act of trust in a software company."
          }
        </p>
      </>
    ),
  },
  {
    q: "How long would it take to break my encryption?",
    a: (
      <>
        <p>
          {
            "Roughly 180,000 years with a state of the art supercomputer running flat out. That number comes from the math behind AES-256, the same encryption used to protect classified government data."
          }
        </p>
        <p className="mt-3">
          {
            "For context, 180,000 years is older than our species. Then on top of that, we use Argon2id to make password guessing slow. Every wrong guess takes seconds instead of milliseconds, which adds billions of years to the original estimate."
          }
        </p>
      </>
    ),
  },
  {
    q: "Is this quantum secure?",
    a: (
      <>
        <p>
          {
            "Yes. We use post quantum key wrapping with ML-KEM-768, the NIST FIPS 203 standard finalized in 2024 for the day quantum computers arrive. ML-DSA-65 (FIPS 204) for per-mutation signatures is in development for a later release."
          }
        </p>
        <p className="mt-3">
          {
            "Even if a quantum computer existed tomorrow, it would still need your password to unlock your data. Without it, your data is mumbo jumbo to a quantum computer too."
          }
        </p>
      </>
    ),
  },
  {
    q: "What does your database actually look like?",
    a: (
      <>
        <p>
          {
            "Like random letters and numbers. If we got hacked tomorrow and a copy of our database showed up online, this is what your row would look like to whoever opened it."
          }
        </p>
        <div
          className="mt-4 rounded-lg p-4 font-mono text-[12px] leading-relaxed"
          style={{ background: C.brown, color: C.cream }}
        >
          <p
            className="mb-3 text-[10px] font-bold uppercase tracking-wider"
            style={{ opacity: 0.55 }}
          >
            {"record #4821 / what our server stores"}
          </p>
          <div style={{ opacity: 0.92 }}>
            <div>{"account_name  →  xK9m2p8cR7tWeNqz3F8o…"}</div>
            <div>{"balance       →  $▓▓,▓▓▓.▓▓"}</div>
            <div>{"merchant      →  bA3kL9oQ7zN5sH2dJ8tW…"}</div>
            <div>{"amount        →  $▓▓▓.▓▓"}</div>
            <div>{"category      →  pM4nXyT8vQ7eKbCu0Aj…"}</div>
            <div>{"date          →  2026-05-10"}</div>
          </div>
        </div>
        <p className="mt-3" style={{ opacity: 0.75 }}>
          {
            "The date is the only plain text field. We need it to sort transactions. Everything else is encrypted on your device before it ever reaches us."
          }
        </p>
      </>
    ),
  },
  {
    q: "Could a court order you to hand over my data?",
    a: (
      <>
        <p>
          {
            "A court can ask. We can hand over a blob of encrypted gibberish. That is all we have. The math does not bend to subpoenas. We don't hold the key, so we cannot produce the contents, no matter who is asking."
          }
        </p>
        <p className="mt-3">
          {
            "Under the US CLOUD Act this matters even more. Most cloud providers can be compelled to hand over your data and ordered not to tell you. We can be compelled too. The difference is that we have nothing to hand over but ciphertext, and nothing to gag about."
          }
        </p>
      </>
    ),
  },
  {
    q: 'Is "end to end encrypted" the same as what you do?',
    a: (
      <>
        <p>
          {
            "Everyone says they are end to end encrypted. The honest version is that they are end to end encrypted until they are not, because they hold the keys."
          }
        </p>
        <p className="mt-3">
          {
            "If someone other than you can decrypt your data, that decryption is not happening for your benefit. It is happening so a company can reset your password, run customer support, sell ad targeting on the side, or comply with a request it would rather not."
          }
        </p>
        <p className="mt-3">
          {
            "We made a different trade. Your password becomes a key in your browser. We never see it. The encryption stays end to end on every end."
          }
        </p>
      </>
    ),
  },
  {
    q: "What if I forget my password?",
    a: (
      <>
        <p>{"We offer recovery, built so we never hold the keys to your data on our own."}</p>
        <p className="mt-3">
          {
            "When you sign up, three recovery shares get created. You hold two of them: your password (in your head) and a recovery kit (you save somewhere safe, like a password manager, a printed sheet, or a hardware wallet). We hold the third. Recovering access requires any two of the three."
          }
        </p>
        <p className="mt-3">
          {
            "Why this matters: we cannot read your data with just our share. You cannot lose access if you keep two of the three. Same security model as a 2 of 3 Bitcoin multisig, applied to your finances."
          }
        </p>
      </>
    ),
  },
  {
    q: "What about my Bitcoin, do you have my keys?",
    a: (
      <>
        <p>{"No. We never see your private keys, your xpub, or your transactions on chain."}</p>
      </>
    ),
  },
];

function PrivacyFAQ() {
  return (
    <section className="px-6 py-14 md:py-20" style={{ background: C.cream }}>
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.burnt }}>
            {"Frequently asked"}
          </p>
          <h2
            style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.05 }}
            className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-4xl"
          >
            {"Privacy questions,"}{" "}
            <span style={{ fontStyle: "italic", color: C.burnt }}>{"in plain English."}</span>
          </h2>
        </div>

        <div className="mt-10 space-y-3">
          {PRIVACY_FAQ.map((item, i) => (
            <FaqItem key={i} q={item.q} a={item.a} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "white", border: `1px solid ${C.brown}1f` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span
          className="text-base font-semibold md:text-lg"
          style={{ fontFamily: fontDisplay, color: C.brown }}
        >
          {q}
        </span>
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg font-bold leading-none"
          style={{
            background: open ? C.burnt : `${C.burnt}1a`,
            color: open ? C.cream : C.burnt,
            transition: "background 120ms ease, color 120ms ease, transform 120ms ease",
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          +
        </span>
      </button>
      {open ? (
        <div className="mt-4 text-[15px] leading-relaxed" style={{ color: C.brown, opacity: 0.82 }}>
          {a}
        </div>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────  PROMISES CALLOUT  ────────────────────────────── */

function PromisesCallout() {
  return (
    <section className="px-6 py-16 md:py-24" style={{ background: C.cream }}>
      <div className="mx-auto max-w-3xl text-center">
        <h2
          style={{ fontFamily: fontDisplay, color: C.brown, lineHeight: 1.05 }}
          className="text-balance text-4xl font-bold tracking-tight md:text-6xl"
        >
          {"Promises are cheap."}
        </h2>
        <p
          className="mx-auto mt-5 max-w-xl text-balance text-lg leading-relaxed md:text-xl"
          style={{ color: C.brown, opacity: 0.82 }}
        >
          {"So are privacy policies. They change all the time."}
        </p>
        <p
          className="mx-auto mt-4 max-w-2xl text-balance text-xl font-semibold leading-snug md:text-2xl"
          style={{ fontFamily: fontDisplay, color: C.burnt, fontStyle: "italic" }}
        >
          {"We took the promise out and built it into the math, so we can't break ours."}
        </p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-[15px] leading-relaxed" style={{ color: C.brown, opacity: 0.78 }}>
            {"Don't trust. Verify. The code is Apache 2.0 and open for inspection."}
          </p>
          <a
            href="https://github.com/The-Orange-Way/Orange-Way-Me"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.03]"
            style={{
              background: C.brown,
              color: C.cream,
              boxShadow: "0 4px 0 0 rgba(58,32,18,0.18)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.35.78 1.05.78 2.12v3.15c0 .31.21.66.79.55C20.71 21.39 24 17.08 24 12 24 5.65 18.85.5 12.5.5h-.5Z" />
            </svg>
            {"See the code on GitHub"}
          </a>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────  WHY WE BUILT THIS  ────────────────────────────── */

function WhyWeBuiltThis() {
  return (
    <section style={{ background: C.brown, color: C.cream }} className="px-6 py-14 md:py-20">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.peach }}>
            {"Our mission"}
          </p>
          <h2
            style={{
              fontFamily: fontDisplay,
              color: C.burnt,
              lineHeight: 1.05,
              fontStyle: "italic",
            }}
            className="mt-3 text-balance text-4xl font-bold tracking-tight md:text-5xl"
          >
            {"Help families get good with money."}
          </h2>
        </div>

        <div
          className="mt-10 space-y-5 text-[17px] leading-relaxed md:text-[18px]"
          style={{ color: C.cream, opacity: 0.92 }}
        >
          <p>
            {"Not literate. "}
            <em style={{ fontFamily: fontDisplay }}>{"Fluent."}</em>
            {
              " The kind of money sense where the words do not need translating, where the kids grow up speaking it, where good decisions feel obvious."
            }
          </p>
        </div>

        {/* The reframe — large italic callout */}
        <p
          className="mx-auto my-10 max-w-2xl text-balance text-center text-2xl font-semibold leading-snug md:text-3xl"
          style={{ fontFamily: fontDisplay, color: C.peach, fontStyle: "italic" }}
        >
          {
            "Most families feel like they're bad with money. The reality is, money's been bad to them."
          }
        </p>

        <div
          className="space-y-5 text-[17px] leading-relaxed md:text-[18px]"
          style={{ color: C.cream, opacity: 0.92 }}
        >
          <p>
            {
              "The dollar buys less every year. Your transactions get sold three ways before lunch. Most apps in this space are built around the data they extract, not the family they serve."
            }
          </p>
          <p>
            {
              "We built one that takes your side. Track everything in one place. See where the money goes. Keep your numbers to yourselves. And teach the next generation what took us years to figure out."
            }
          </p>
        </div>

        {/* Closing beat — resolution reframe, sets up the book that comes next */}
        <p
          className="mx-auto mt-12 max-w-2xl text-balance text-center text-2xl font-semibold leading-snug md:text-3xl"
          style={{ fontFamily: fontDisplay, color: C.burnt, fontStyle: "italic" }}
        >
          {"Most piggy banks end up as bacon. Yours bites back."}
        </p>
      </div>
    </section>
  );
}

/* ──────────────────────────────  BOOK SECTION  ────────────────────────────── */

function BookSection() {
  return (
    <section
      id="book"
      style={{ background: "#3a2012", color: C.cream }}
      className="px-6 py-14 md:py-20"
    >
      <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[1fr_1.1fr] md:gap-14">
        <div className="flex justify-center md:justify-end">
          <img
            src={bookCover}
            alt="Sato and the Chocolate Coins, a picture book about money for children, by OrangeWay."
            width={1280}
            height={1600}
            loading="lazy"
            className="w-full max-w-sm rotate-[-3deg] rounded-2xl shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]"
            draggable={false}
          />
        </div>
        <div>
          <p
            className="text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: C.peach }}
          >
            {"📕 Free with beta access"}
          </p>
          <h2
            style={{
              fontFamily: fontDisplay,
              color: C.burnt,
              lineHeight: 1.05,
              fontStyle: "italic",
            }}
            className="mt-3 text-3xl font-bold tracking-tight md:text-4xl"
          >
            {"We started with the kids."}
          </h2>
          <p
            className="mt-5 text-[16px] leading-relaxed md:text-[17px]"
            style={{ color: C.cream, opacity: 0.92 }}
          >
            <em style={{ fontFamily: fontDisplay }}>{"Sato and the Chocolate Coins"}</em>
            {
              " is our mission in a form a six year old gets. The chocolate coins. The real ones. What's worth keeping. Coming later this year."
            }
          </p>
          <BookForm />
        </div>
      </div>
    </section>
  );
}

// E2E anchor: tests/e2e/marketing-forms.spec.ts identifies BookForm by
// being the form on /landing-classic that contains a <select>. If the
// kids segmentation moves to radio buttons / a separate component, the
// test selector must be updated alongside it.
function BookForm() {
  const { email, setEmail, kids, setKids, err, done, submitting, onSubmit } = useSignupForm({
    form: "book",
    withKids: true,
  });

  if (done) {
    return (
      <p className="mt-4 text-sm font-semibold" style={{ color: C.peach }}>
        {"Saved. We'll email you when the book ships. 🐷"}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@home.com"
        className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: C.cream, color: C.brown, border: `1px solid ${C.peach}55` }}
      />
      <select
        value={kids}
        onChange={(e) => setKids(e.target.value as typeof kids)}
        className="rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: C.cream, color: C.brown, border: `1px solid ${C.peach}55` }}
      >
        <option value="not_yet">{"No kids yet"}</option>
        <option value="little">{"Little kids (2-5)"}</option>
        <option value="bigger">{"Older kids (6-12)"}</option>
        <option value="just_me">{"Just for me"}</option>
      </select>
      <button
        type="submit"
        disabled={submitting}
        style={{ background: C.burnt, color: C.cream, opacity: submitting ? 0.6 : 1 }}
        className="rounded-lg px-4 py-2 text-sm font-bold"
      >
        {submitting ? "Saving…" : "Save my copy"}
      </button>
      {err ? (
        <p className="text-xs" style={{ color: C.peach }}>
          {err}
        </p>
      ) : null}
    </form>
  );
}

/* ──────────────────────────────  FINAL CTA  ────────────────────────────── */

// E2E anchor: tests/e2e/marketing-forms.spec.ts scopes the WaitlistForm
// to the `#waitlist` section to disambiguate it from the BookForm (and
// from any future form on the page). The id is also a real fragment
// link from the page nav, so it's load-bearing for both UX and tests;
// keep it when restructuring.
function FinalCTA() {
  return (
    <section
      id="waitlist"
      style={{ background: C.burnt, color: C.cream }}
      className="px-6 py-14 text-center md:py-20"
    >
      <h2
        style={{ fontFamily: fontDisplay, lineHeight: 1.05 }}
        className="mx-auto max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-6xl"
      >
        {"Your money. Your numbers."}{" "}
        <span style={{ fontStyle: "italic" }}>{"Nobody else's business."}</span>
      </h2>
      <p className="mx-auto mt-5 max-w-xl text-base md:text-lg" style={{ opacity: 0.92 }}>
        {
          "Join the waitlist. The first 100 households get lifetime founder pricing, $100 a year, locked in forever."
        }
      </p>

      <div className="mx-auto mt-8 max-w-md">
        <WaitlistForm />
      </div>

      <p className="mt-5 text-sm" style={{ opacity: 0.85 }}>
        {"Private beta. We'll email when your spot is ready."}
      </p>
    </section>
  );
}

function WaitlistForm() {
  const { email, setEmail, err, done, submitting, onSubmit } = useSignupForm({
    form: "waitlist",
  });

  if (done) {
    return (
      <div
        className="rounded-2xl px-6 py-6"
        style={{ background: C.cream, color: C.brown, border: `2px solid ${C.brown}` }}
      >
        <p className="text-xl font-bold" style={{ fontFamily: fontDisplay }}>
          {"You're on the list."}
        </p>
        <p className="mt-1 text-sm" style={{ opacity: 0.75 }}>
          {"We'll email when your spot is ready."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@home.com"
        className="flex-1 rounded-full px-5 py-3.5 text-base outline-none"
        style={{
          background: C.cream,
          color: C.brown,
          border: `2px solid ${C.cream}`,
        }}
      />
      <button
        type="submit"
        disabled={submitting}
        style={{
          background: "transparent",
          color: C.cream,
          border: `2px solid ${C.cream}`,
          opacity: submitting ? 0.6 : 1,
        }}
        className="rounded-full px-6 py-3 text-base font-bold transition-colors hover:bg-[#FBF6EF] hover:text-[#3A2012]"
      >
        {submitting ? "Joining…" : "Join the waitlist"}
      </button>
      {err ? (
        <p className="text-xs" style={{ color: C.cream }}>
          {err}
        </p>
      ) : null}
    </form>
  );
}

/* ──────────────────────────────  FOOTER  ────────────────────────────── */

function Footer() {
  return (
    <footer className="px-6 py-7 text-center" style={{ background: C.brown, color: C.cream }}>
      <p className="text-xs" style={{ opacity: 0.92 }}>
        {"OrangeWay · The finance app that minds its own business around your data · © 2026"}
      </p>
      <p className="mt-1 text-xs italic" style={{ fontFamily: fontDisplay, opacity: 0.55 }}>
        {"Not your keys, not your privacy."}
      </p>
    </footer>
  );
}
