import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/households")({
  head: () => ({
    ...pageMeta({
      title: "Households — share a budget, keep your privacy",
      description:
        "Invite a partner or family member by email. Each device generates a post-quantum keypair; Orange Way wraps the household scope key to their public key. No shared logins, no server-side decryption.",
      path: "/households",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Households", path: "/households" },
        ]),
      ),
    ],
  }),
  component: HouseholdsPage,
});

function HouseholdsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Households</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            Built for couples and families that want privacy, not shared logins.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Most "shared" budget apps just give two people the same login. Orange Way uses
            public-key cryptography so each household member has their own account, their own keys,
            and a cleanly defined scope of what they can see.
          </p>
        </header>

        <h2 className="mt-8 text-xl font-semibold">How an invite works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>You invite someone by email.</li>
          <li>They sign up. Their device generates a post-quantum keypair (ML-KEM-768).</li>
          <li>
            Orange Way wraps the household scope key to their public key — automatically, in real
            time.
          </li>
          <li>
            They open the app and see the shared household. The server never held a decryption key.
          </li>
        </ol>

        <h2 className="mt-10 text-xl font-semibold">Roles</h2>
        <p className="mt-2 text-muted-foreground">
          Owner, admin, and member roles. Admins can manage membership; owners can transfer
          ownership and trigger key rotations.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Revocation and rekey</h2>
        <p className="mt-2 text-muted-foreground">
          Remove a member and Orange Way rotates the household key, then re-encrypts the shared
          ciphertext (transactions, accounts, categories, budgets, goals, rules) in batched
          background jobs. The removed member retains access to nothing new.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Personal vs shared</h2>
        <p className="mt-2 text-muted-foreground">
          You can have personal accounts that never enter the household scope. Members of the same
          household can't see each other's personal data — only what's explicitly shared.
        </p>
      </article>
    </MarketingShell>
  );
}
