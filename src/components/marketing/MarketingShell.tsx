/**
 * Marketing layout — public, AI-crawlable shell shared by all marketing routes.
 * Renders content immediately (no auth gating) so bots and unauthenticated users
 * see the real HTML on first response.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV = [
  { to: "/features", label: "Features" },
  { to: "/security", label: "Security" },
  { to: "/bitcoin", label: "Bitcoin" },
  { to: "/compare", label: "Compare" },
  { to: "/pricing", label: "Pricing" },
  { to: "/faq", label: "FAQ" },
] as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="text-sm font-semibold tracking-tight">Orange Way</span>
          </Link>
          <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "text-foreground font-medium" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/auth"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/beta"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Apply for beta
            </Link>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-10 text-sm md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <img src="/icon-192.png" alt="" width={16} height={16} className="h-4 w-4 rounded" />
              <span className="font-semibold">Orange Way</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The private finance app for people who own Bitcoin.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              { to: "/features", label: "Features" },
              { to: "/security", label: "Security" },
              { to: "/bitcoin", label: "Bitcoin" },
              { to: "/households", label: "Households" },
              { to: "/pricing", label: "Pricing" },
            ]}
          />
          <FooterCol
            title="Resources"
            links={[
              { to: "/compare", label: "Compare" },
              { to: "/faq", label: "FAQ" },
              { to: "/changelog", label: "Changelog" },
              { to: "/ai", label: "For AI agents" },
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              { to: "/about", label: "About" },
              { to: "/enterprise", label: "Enterprise" },
              { to: "/self-host", label: "Self host" },
              { to: "/privacy", label: "Privacy" },
              { to: "/terms", label: "Terms" },
            ]}
          />
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Orange Way · Built for sovereignty
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="text-sm text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Helper: build standard meta tags for a marketing page. */
export function pageMeta(args: {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
}) {
  const url = `https://orangeway.app${args.path}`;
  const image = args.image ?? "https://orangeway.app/og-image.jpg";
  const imageAlt =
    args.imageAlt ??
    "Orange Way, the private finance app for people who own Bitcoin. Dashboard preview showing net worth and accounts including Bitcoin.";
  return {
    meta: [
      { title: args.title },
      { name: "description", content: args.description },
      { property: "og:title", content: args.title },
      { property: "og:description", content: args.description },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: imageAlt },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Orange Way" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: args.title },
      { name: "twitter:description", content: args.description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: imageAlt },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** Helper: build a JSON-LD <script> entry for route head(). */
export function jsonLd(data: unknown) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data),
  };
}

/** Reusable BreadcrumbList JSON-LD. */
export function breadcrumb(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `https://orangeway.app${it.path}`,
    })),
  };
}
