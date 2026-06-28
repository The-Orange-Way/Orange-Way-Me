/**
 * Public route metadata, consumed by scripts/prerender-plugin.ts at build time
 * to emit per-route static HTML in dist/<route>/index.html.
 *
 * Only public marketing surface lives here. Authenticated app routes (dashboard,
 * accounts, etc.) are not pre-rendered — their content is locked behind login
 * and ZKA, so crawlers can't see it anyway.
 */

export interface PublicRouteMeta {
  /** URL path, including leading slash. Use "/" for landing. */
  path: string;
  /** <title>. Keep under 60 chars where possible. */
  title: string;
  /** <meta name="description">. Keep under 160 chars. */
  description: string;
  /** <h1> shown in the <noscript> fallback (and used by AI crawlers). */
  h1: string;
  /** Plain-text body for the <noscript> fallback. */
  summary: string;
  /** Optional extra JSON-LD blocks specific to this route. */
  jsonLd?: Array<Record<string, unknown>>;
}

const ORG_NAME = "Orange Way";

export const ALL_PRERENDER_ROUTES: PublicRouteMeta[] = [
  {
    path: "/",
    title: `Private finance for Bitcoin households | ${ORG_NAME}`,
    description:
      "Zero-knowledge personal finance for Bitcoin-first households. Your money, your keys, your books.",
    h1: "Orange Way: the private finance app for people who own Bitcoin",
    summary:
      "Orange Way is the zero-knowledge personal finance app for households that hold Bitcoin. Track spending, plan budgets, and share securely with family, all encrypted on your device before it leaves.",
  },
  {
    path: "/about",
    title: `About | ${ORG_NAME}`,
    description:
      "Why we built Orange Way: private, Bitcoin-native budgeting for families that hold their own keys.",
    h1: "About Orange Way",
    summary:
      "We built Orange Way because nobody else made a budget app for families who hold their own Bitcoin.",
  },
  {
    path: "/features",
    title: `Features | ${ORG_NAME}`,
    description:
      "Multi-currency budgeting, household sharing with per-member privacy, on-chain wallet sync, end-to-end encryption.",
    h1: "Features",
    summary:
      "Multi-currency budgeting, household sharing with per-member privacy, on-chain wallet sync, end-to-end encryption.",
  },
  {
    path: "/security",
    title: `Security | ${ORG_NAME}`,
    description:
      "Zero-knowledge architecture, client-side encryption, vault password derivation, household privacy boundaries.",
    h1: "Security",
    summary:
      "Zero-knowledge architecture, client-side encryption, vault password derivation, household privacy boundaries.",
  },
  {
    path: "/pricing",
    title: `Pricing | ${ORG_NAME}`,
    description:
      "Free for individuals. Affordable for households. Optional self-hosting. No ads. No data sales.",
    h1: "Pricing",
    summary:
      "Free for individuals. Affordable for households. Optional self-hosting. No ads. No data sales.",
  },
  {
    path: "/faq",
    title: `FAQ | ${ORG_NAME}`,
    description:
      "Common questions about Orange Way, household privacy, Bitcoin support, and zero-knowledge encryption.",
    h1: "Frequently asked questions",
    summary:
      "Common questions about Orange Way, household privacy, Bitcoin support, and zero-knowledge encryption.",
  },
  {
    path: "/compare",
    title: `Compare | ${ORG_NAME}`,
    description:
      "Orange Way versus YNAB, Monarch Money, Copilot, and Mint: Bitcoin-native and privacy-first by default.",
    h1: "Compare Orange Way to YNAB, Monarch, Copilot, and Mint",
    summary:
      "Orange Way versus YNAB, Monarch Money, Copilot, and Mint: Bitcoin-native and privacy-first by default.",
  },
  {
    path: "/privacy",
    title: `Privacy | ${ORG_NAME}`,
    description:
      "What data we can and cannot read, how household privacy works, retention, and your right to delete.",
    h1: "Privacy",
    summary:
      "What data we can and cannot read, how household privacy works, retention, and your right to delete.",
  },
  {
    path: "/terms",
    title: `Terms of service | ${ORG_NAME}`,
    description:
      "Terms governing your use of Orange Way: account responsibilities, vault password recovery, and liability.",
    h1: "Terms of service",
    summary:
      "Terms governing your use of Orange Way: account responsibilities, vault password recovery, and liability.",
  },
  {
    path: "/self-host",
    title: `Self-host | ${ORG_NAME}`,
    description:
      "Run Orange Way on your own server. Open source under Apache-2.0. Sovereignty by design.",
    h1: "Self-host Orange Way",
    summary:
      "Run Orange Way on your own server. Open source under Apache-2.0. Sovereignty by design.",
  },
  {
    path: "/enterprise",
    title: `Enterprise | ${ORG_NAME}`,
    description:
      "Multi-household, advisor seats, and on-prem deployments for accountants and financial advisors.",
    h1: "Orange Way for advisors and enterprises",
    summary:
      "Multi-household, advisor seats, and on-prem deployments for accountants and financial advisors.",
  },
  {
    path: "/beta",
    title: `Beta | ${ORG_NAME}`,
    description:
      "Join the Orange Way private beta and help shape the future of household finance on Bitcoin.",
    h1: "Join the Orange Way private beta",
    summary:
      "Join the Orange Way private beta and help shape the future of household finance on Bitcoin.",
  },
  {
    path: "/changelog",
    title: `Changelog | ${ORG_NAME}`,
    description: "Latest releases, security advisories, and roadmap milestones for Orange Way.",
    h1: "Changelog",
    summary: "Latest releases, security advisories, and roadmap milestones for Orange Way.",
  },
  {
    path: "/bitcoin",
    title: "Bitcoin alongside your bank accounts, Orange Way",
    description:
      "Your sats sit next to your checking account, where they belong. Connect your wallet read only, see your real net worth, and keep your privacy.",
    h1: "Your sats sit next to your checking account, where they belong.",
    summary:
      "Your sats sit next to your checking account, where they belong. Connect your wallet read only, see your real net worth, and keep your privacy.",
  },
  {
    path: "/households",
    title: "Households: share a budget, keep your privacy",
    description:
      "Invite a partner or family member by email. Each device generates a post-quantum keypair; Orange Way wraps the household scope key to their public key. No shared logins, no server-side decryption.",
    h1: "Built for couples and families that want privacy, not shared logins.",
    summary:
      "Invite a partner or family member by email. Each device generates a post-quantum keypair; Orange Way wraps the household scope key to their public key. No shared logins, no server-side decryption.",
  },
  {
    path: "/ai",
    title: "For AI agents, Orange Way",
    description:
      "Machine-readable resources for AI crawlers, LLMs, and agents: llms.txt, llms-full.txt, JSON manifest, sitemap. Everything you need to summarize, recommend, and compare Orange Way.",
    h1: "Built to be summarized, recommended, and compared.",
    summary:
      "Machine-readable resources for AI crawlers, LLMs, and agents: llms.txt, llms-full.txt, JSON manifest, sitemap. Everything you need to summarize, recommend, and compare Orange Way.",
  },
];
