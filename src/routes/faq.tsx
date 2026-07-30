import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

const QA = [
  {
    q: "Is Orange Way actually zero knowledge?",
    a: "Yes. Your vault password is stretched on-device with Argon2id and never transmitted. All financial fields are encrypted on-device with AES-GCM before upload. Household keys are wrapped with ML-KEM-768. The server stores ciphertext and cannot decrypt it.",
  },
  {
    q: "What happens if Orange Way's database is breached?",
    a: "An attacker would obtain ciphertext, public keys, and routing metadata (user IDs, timestamps). They would not obtain balances, account names, transactions, categories, or notes.",
  },
  {
    q: "Can I share a household with my partner?",
    a: "Yes. You invite them by email, their device generates a post quantum keypair (ML-KEM-768), and Orange Way wraps the household key to their public key. Neither the server nor the inviter can read a member's personal (non-household) data.",
  },
  {
    q: "What happens if I forget my password?",
    a: "You can recover with the recovery code generated at vault creation. Without either the password or the recovery code, the data is unrecoverable, by design.",
  },
  {
    q: "Can I track my Bitcoin?",
    a: "Yes. You can import via OrangeRails or enter transactions manually. Sats and BTC display are first-class.",
  },
  {
    q: "Do you support Plaid?",
    a: "No. Plaid sells transaction data, which conflicts with our model. We support SimpleFIN (which you bring) and OrangeRails for Bitcoin auto-import.",
  },
  {
    q: "Is the cryptography audited?",
    a: "The primitives we ship today (Argon2id, AES-GCM, ML-KEM-768) are NIST/IRTF standardized. Application-level integration is being independently reviewed; design documents are public at /security. ML-DSA-65 (FIPS 204) per-mutation signing is in development for a later release.",
  },
  {
    q: "What's the post quantum part actually doing?",
    a: "Long-lived key material uses ML-KEM-768 for key encapsulation (FIPS 203). This protects against 'harvest now, decrypt later' attacks where an adversary records ciphertext today and waits for a quantum computer. ML-DSA-65 (FIPS 204) for per-mutation signatures is in development for a later release.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. Settings → Import / Export gives you a full encrypted backup or a plain CSV export decrypted on your device.",
  },
  {
    q: "Is there an open-source version?",
    a: "Self-hosting is on the roadmap. Cryptographic test vectors and design documents are public.",
  },
  {
    q: "How does Orange Way compare to Monarch Money?",
    a: "Same depth of features (dashboards, budgets, goals, rules, household sharing) but with end to end encryption and native Bitcoin support. Monarch can read your finances; Orange Way cannot.",
  },
  {
    q: "How does Orange Way compare to YNAB?",
    a: "YNAB is a strict envelope-budgeting methodology with a large community. Orange Way supports envelope budgeting too, but its differentiators are zero knowledge encryption, Bitcoin support, and household sharing without surrendering visibility to a vendor.",
  },
  {
    q: "Is there a mobile app?",
    a: "Orange Way is currently a web app and works well as a PWA on iOS and Android. A native mobile app is on the roadmap.",
  },
  {
    q: "Where is my data stored?",
    a: "Encrypted blobs are stored on Supabase infrastructure. Because the data is encrypted on your device before upload, the storage location does not affect your privacy posture.",
  },
  {
    q: "What does Orange Way cost?",
    a: "Free during beta. After beta we plan a flat subscription with generous grandfathering for existing users.",
  },
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    ...pageMeta({
      title: "FAQ, Orange Way",
      description:
        "Common questions about Orange Way: zero knowledge encryption, Bitcoin support, households, recovery, comparisons, and pricing.",
      path: "/faq",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ]),
      ),
      jsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: QA.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      }),
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">FAQ</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Frequently asked questions
          </h1>
        </header>
        <dl className="space-y-6">
          {QA.map(({ q, a }) => (
            <div key={q} className="rounded-lg border border-border bg-card p-5">
              <dt className="text-base font-semibold">{q}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
      </article>
    </MarketingShell>
  );
}
