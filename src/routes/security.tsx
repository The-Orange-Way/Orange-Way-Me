import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";
import { ShieldCheck, EyeOff, KeyRound, Users, Link2 } from "lucide-react";

export const Route = createFileRoute("/security")({
  head: () => ({
    ...pageMeta({
      title: "Security, Orange Way",
      description:
        "What we can see (basically nothing). What happens if we get hacked. What happens if you forget your password. Plain English answers about how your data stays yours.",
      path: "/security",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ]),
      ),
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-12">
          <p className="text-xs font-medium uppercase tracking-wider text-primary">Security</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
            If we get hacked, the attacker doesn't get your numbers.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            They get gibberish. That's not marketing, it's how the app is built.
          </p>
        </header>

        <Story icon={<EyeOff className="h-5 w-5" />} title="What we can see (basically nothing)">
          <p>
            When you add an account or a transaction, your phone or laptop scrambles it before
            sending. We store the scrambled version. We don't have the key, you do. So when our
            servers look at your data, all we see is noise.
          </p>
          <p className="mt-3">
            We can see that you have an account. We can't see what kind. We can see you have
            transactions. We can't see how much, where, or what for. Same goes for your budgets,
            goals, categories, and notes.
          </p>
        </Story>

        <Story icon={<ShieldCheck className="h-5 w-5" />} title="What happens if we get hacked">
          <p>
            An attacker who breaks into our servers walks away with a pile of encrypted nonsense. No
            balances, no merchant names, no spending patterns. Even with our full database in their
            hands, they can't read your finances, because we never could.
          </p>
          <p className="mt-3">
            That's the point of the design. We treat our own servers as untrusted, on purpose, so
            that one bad day on our side doesn't become a permanent leak of your life.
          </p>
        </Story>

        <Story icon={<Link2 className="h-5 w-5" />} title="Connecting your bank and your Bitcoin">
          <p>Your Bitcoin is sealed in your browser, so Orange Way's servers never see it.</p>
          <p className="mt-3">
            Your bank connection works a little differently: the feed comes in through Quiltt, and
            our connector (Orange Rails) briefly handles it in the clear to lock each transaction to
            a key only you hold, derived from your password. The connector does not keep that key:
            it is handed over only while a sync runs, and between syncs it cannot read anything it
            sealed. Orange Way stores only the sealed version. Either way, you hold the only lasting
            key.
          </p>
        </Story>

        <Story
          icon={<KeyRound className="h-5 w-5" />}
          title="What happens if you forget your password"
        >
          <p>
            When you sign up, we give you a one-time recovery kit. Write it down, save it
            in your password manager, somewhere safe and offline. With it, you can reset your
            password and keep all your data.
          </p>
          <p className="mt-3">
            Without the password and without the recovery kit, your data is unrecoverable. We can't
            reset it for you, and we can't see it ourselves. That's the trade, and it's why your
            data is actually safe.
          </p>
        </Story>

        <Story icon={<Users className="h-5 w-5" />} title="What if you and your partner split up">
          <p>
            One click and your household is "rekeyed." Anyone you removed loses access to future
            data immediately. The accounts you used to share don't show up in their app anymore.
          </p>
          <p className="mt-3">
            What they backed up before that point is theirs to keep, that's true of any tool. But
            from the moment you rekey, they're locked out.
          </p>
        </Story>

        {/* Technical details, collapsed */}
        <details className="mt-14 rounded-xl border border-border bg-card p-6">
          <summary className="cursor-pointer text-sm font-medium">
            For the technically curious
          </summary>
          <div className="mt-4 space-y-4 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Password stretching:</strong> Argon2id
              (memory-hard, side-channel resistant) derives a 256-bit master key in your browser.
              Your password never leaves your device.
            </p>
            <p>
              <strong className="text-foreground">Data encryption:</strong> AES-GCM with a random
              96-bit IV per record. Authenticated encryption, tampering is detected on read.
            </p>
            <p>
              <strong className="text-foreground">Key wrapping:</strong> Long-lived household keys
              are wrapped with ML-KEM-768 (NIST FIPS 203). Post quantum, so today's recorded
              ciphertext can't be decrypted by tomorrow's quantum computer. Per-mutation signing
              with ML-DSA-65 (NIST FIPS 204) is in development for a later release.
            </p>
            <p>
              <strong className="text-foreground">Household sharing:</strong> Each member generates
              a keypair on-device. The household key is wrapped to each member's public key. The
              server never holds a decryption key, it routes ciphertext.
            </p>
            <p>
              <strong className="text-foreground">Membership rekey:</strong> When members are added
              or revoked, a background job batches re-encryption of accounts, transactions,
              categories, budgets, goals, and rules. Decryption and re-encryption happen client side
              on the owner's device.
            </p>
            <p>
              <strong className="text-foreground">Blind indexes:</strong> HMAC-based indexes let the
              server match queries without seeing plaintext.
            </p>
            <p>
              <strong className="text-foreground">Threat model:</strong> We assume the server can be
              compromised. We assume the network can be observed. We assume future quantum
              adversaries may try to decrypt today's traffic. We don't claim to defend a device
              that's already compromised at the OS level.
            </p>
          </div>
        </details>
      </article>
    </MarketingShell>
  );
}

function Story({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 rounded-2xl border border-border bg-card p-6 md:p-8">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}
