import { createFileRoute, Link } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { Bitcoin, Wallet } from "lucide-react";

export const Route = createFileRoute("/bitcoin")({
  head: () => ({
    ...pageMeta({
      title: "Bitcoin alongside your bank accounts, Orange Way",
      description:
        "Your sats sit next to your checking account, where they belong. Connect your wallet read only, see your real net worth, and keep your privacy.",
      path: "/bitcoin",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Bitcoin", path: "/bitcoin" },
        ]),
      ),
    ],
  }),
  component: BitcoinPage,
});

function BitcoinPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-5xl px-6 py-16">
        {/* Hero */}
        <section className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-primary">Bitcoin</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
              Your sats sit next to your checking account, where they belong.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Most personal finance apps treat Bitcoin like an afterthought, a single number you
              type in. Orange Way treats it like real money: live balances, real net worth, real
              privacy.
            </p>
            <Link
              to="/beta"
              className="mt-7 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Apply for beta access
            </Link>
          </div>

          <BitcoinMockup />
        </section>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <Item title="Real Bitcoin, real net worth">
            Your Bitcoin holdings show up in your net worth, your cash flow, and your reports — not
            in some side panel. Sats and dollars, side by side.
          </Item>
          <Item title="Connect your wallet read only">
            Add your wallet and we'll watch the addresses for you. Read only, like showing someone a
            window into the safe but not the key. Your private keys never leave your hardware
            wallet. We see balances; we don't see seeds.
          </Item>
          <Item title="Switch between sats and BTC">
            Some people think in sats, some in BTC. Pick your unit per account. Charts and totals
            follow your preference. No more mental math.
          </Item>
          <Item title="Private, like everything else">
            Your Bitcoin balances are encrypted on your device, just like your bank accounts. We
            can't see how much you hold or what you do with it. That's the whole point.
          </Item>
        </div>
      </article>
    </MarketingShell>
  );
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function BitcoinMockup() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-primary/10"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Net worth</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-semibold tracking-tight">$184,320</div>
        <div className="text-xs text-primary">+2.4%</div>
      </div>

      <div className="mt-5 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Accounts</div>
        <Row
          icon={<Wallet className="h-3.5 w-3.5" />}
          name="Chase Checking"
          sub="Cash"
          amount="$4,210"
        />
        <Row
          icon={<Wallet className="h-3.5 w-3.5" />}
          name="Ally Savings"
          sub="Cash"
          amount="$22,940"
        />
        <Row
          icon={<Wallet className="h-3.5 w-3.5" />}
          name="Vanguard"
          sub="Investments"
          amount="$98,490"
        />
        <Row
          icon={<Bitcoin className="h-3.5 w-3.5" />}
          name="Cold Storage"
          sub="0.84 BTC"
          amount="$57,180"
          accent
        />
        <Row
          icon={<Bitcoin className="h-3.5 w-3.5" />}
          name="Lightning"
          sub="0.012 BTC"
          amount="$816"
          accent
        />
      </div>
    </div>
  );
}

function Row({
  icon,
  name,
  sub,
  amount,
  accent = false,
}: {
  icon: React.ReactNode;
  name: string;
  sub: string;
  amount: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
        accent ? "border-primary/30 bg-primary/5" : "border-border bg-background/40"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            accent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {icon}
        </div>
        <div>
          <div className="text-xs font-medium">{name}</div>
          <div className="text-[10px] text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="text-xs font-semibold tabular-nums">{amount}</div>
    </div>
  );
}
