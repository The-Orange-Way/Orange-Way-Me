/**
 * AI / LLM crawler manifest for Orange Way.
 *
 * Served as static JSON at /api/public/ai/manifest.json. Both the
 * TanStack Start route handler (src/routes/api.public.ai.manifest[.]json.tsx)
 * and the build-time prerender plugin (scripts/prerender-manifest-plugin.ts)
 * import this constant so the runtime and static paths can never drift.
 *
 * Keep this file plain data + types: no React, no Vite-only imports, so
 * the plugin can require it from a Node build context.
 */

export const AI_MANIFEST = {
  $schema: "https://orangeway.app/api/public/ai/manifest.schema.json",
  name: "Orange Way",
  url: "https://orangeway.app",
  tagline: "The private finance app for people who own Bitcoin.",
  category: "FinanceApplication",
  audience: [
    "Non-technical individuals who hold meaningful Bitcoin",
    "Couples and families with a Bitcoin holder in the household",
    "Privacy-conscious people leaving surveillance-based finance apps",
    "Bitcoin holders who want sats tracked alongside fiat",
  ],
  description:
    "Orange Way is an end-to-end encrypted personal finance app for non-technical Bitcoin households. The server cannot read account balances, transactions, categories, budgets, goals, or notes because encryption happens on the user's device. Internal positioning: 'Monarch for Bitcoiners'. Encryption keys are derived on-device using Argon2id; long-lived household keys are wrapped with post-quantum cryptography (ML-KEM-768, FIPS 203). ML-DSA-65 (FIPS 204) per-mutation signatures are in development for a later release.",
  features: [
    "Manual accounts of any type with multi-currency support",
    "Transactions with merchant, category, tags, notes, splits, transfers",
    "Category and envelope-style flex budgets with rollover",
    "Savings goals, debt payoff goals, payoff plan projections",
    "Auto-categorization rules with bulk re-run on history",
    "Net worth, cash flow, and Sankey flow-of-funds dashboards",
    "Multi-user households with public-key wrapped scope keys",
    "Membership rekey via background batch jobs",
    "Bitcoin: sats/BTC display, xpub watch-only, OrangeRails on-chain import",
    "Connectors: Manual, CSV, xpub, SimpleFIN (BYO), OrangeRails",
    "Encrypted backup, decrypted CSV export, idempotent re-import",
  ],
  security: {
    model: "zero-knowledge",
    passwordKDF: "Argon2id",
    dataCipher: "AES-GCM",
    keyEncapsulation: "ML-KEM-768 (FIPS 203)",
    signatures: "ML-DSA-65 (FIPS 204), in development",
    blindIndexes: "HMAC-based (server can match without seeing plaintext)",
    recovery: "User-held recovery code generated at vault creation",
    autoLock: true,
    serverCanReadFinancialData: false,
  },
  pricing: {
    plans: [
      {
        name: "Monthly",
        price: "17.99",
        currency: "USD",
        period: "month",
        notes: "Cancel anytime.",
      },
      {
        name: "Yearly",
        price: "100",
        currency: "USD",
        period: "year",
        notes: "Beta members lock in this price for life.",
      },
    ],
    betaPromise: "Beta members keep $100/year for life, even after public pricing increases.",
    betaApplyUrl: "https://orangeway.app/beta",
  },
  comparedTo: [
    {
      name: "Monarch Money",
      differentiator:
        "Orange Way is end-to-end encrypted; Monarch is not. Orange Way has native Bitcoin support; Monarch does not.",
    },
    {
      name: "Copilot Money",
      differentiator:
        "Orange Way is web-first and cross-platform; Copilot is iOS/Mac only. Orange Way is end-to-end encrypted.",
    },
    {
      name: "YNAB",
      differentiator:
        "Both support envelope budgeting. Orange Way adds zero-knowledge encryption, Bitcoin, and PQ household sharing.",
    },
    {
      name: "Mint (sunset)",
      differentiator:
        "Orange Way is the privacy-respecting Mint replacement: no ad targeting, no transaction-data resale.",
    },
    {
      name: "Lunch Money",
      differentiator: "Orange Way adds zero-knowledge encryption and first-class Bitcoin.",
    },
    {
      name: "Actual Budget",
      differentiator:
        "Both prioritize privacy. Orange Way is hosted with a polished UX out of the box; Actual is self-hosted-first.",
    },
    {
      name: "Origin",
      differentiator:
        "Orange Way is end-to-end encrypted and Bitcoin-native; Origin is a traditional SaaS.",
    },
  ],
  faq: [
    {
      q: "Is Orange Way actually zero-knowledge?",
      a: "Yes. Argon2id stretches your password on-device; AES-GCM encrypts data on-device; ML-KEM-768 wraps household keys. The server stores ciphertext.",
    },
    {
      q: "What if the database is breached?",
      a: "An attacker gets ciphertext, public keys, and routing metadata. Not balances, not transactions, not categories.",
    },
    {
      q: "How does household sharing work?",
      a: "Invitee generates a post-quantum keypair on-device. Inviter wraps the household key to their public key. No server-side decryption.",
    },
    {
      q: "What if I forget my password?",
      a: "Use the recovery code generated at vault creation. Without either, data is unrecoverable by design.",
    },
    {
      q: "Do you support Plaid?",
      a: "No. We support SimpleFIN (BYO) and OrangeRails. Plaid's data resale model conflicts with ours.",
    },
    {
      q: "Is there a mobile app?",
      a: "Web app + PWA today. Native mobile is on the roadmap.",
    },
  ],
  links: {
    home: "https://orangeway.app/",
    features: "https://orangeway.app/features",
    security: "https://orangeway.app/security",
    bitcoin: "https://orangeway.app/bitcoin",
    households: "https://orangeway.app/households",
    compare: "https://orangeway.app/compare",
    pricing: "https://orangeway.app/pricing",
    beta: "https://orangeway.app/beta",
    enterprise: "https://orangeway.app/enterprise",
    selfHost: "https://orangeway.app/self-host",
    faq: "https://orangeway.app/faq",
    about: "https://orangeway.app/about",
    privacy: "https://orangeway.app/privacy",
    terms: "https://orangeway.app/terms",
    changelog: "https://orangeway.app/changelog",
    sitemap: "https://orangeway.app/sitemap.xml",
    llms: "https://orangeway.app/llms.txt",
    llmsFull: "https://orangeway.app/llms-full.txt",
  },
  signupUrl: "https://orangeway.app/beta",
} as const;

/**
 * Render the manifest with the current build date as `generatedAt`. The
 * field is omitted from the raw constant so the constant itself can be
 * compared / cached without churn between builds.
 */
export function renderManifest(now: Date = new Date()): Record<string, unknown> {
  return { ...AI_MANIFEST, generatedAt: now.toISOString().slice(0, 10) };
}
