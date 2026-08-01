import { createFileRoute } from "@tanstack/react-router";
import {
  MarketingShell,
  pageMeta,
  jsonLd,
  breadcrumb,
} from "@/components/marketing/MarketingShell";

export const Route = createFileRoute("/terms")({
  head: () => ({
    ...pageMeta({
      title: "Terms of Service | Orange Way",
      description:
        "The terms governing your use of Orange Way. Plain language version: be a good citizen, don't abuse the service, and we'll do our part.",
      path: "/terms",
    }),
    scripts: [
      jsonLd(
        breadcrumb([
          { name: "Home", path: "/" },
          { name: "Terms", path: "/terms" },
        ]),
      ),
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: April 28, 2026</p>

        <h2 className="mt-10 text-xl font-semibold">Use of the service</h2>
        <p className="mt-2 text-muted-foreground">
          You may use Orange Way for personal financial tracking, alone or with members of your
          household. You agree not to abuse the service, attempt to break the encryption of other
          users, or use the service to violate applicable law.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Accounts</h2>
        <p className="mt-2 text-muted-foreground">
          You're responsible for keeping your vault password and recovery kit safe. We cannot
          recover them for you. That is the point.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Beta status</h2>
        <p className="mt-2 text-muted-foreground">
          Orange Way is in beta. The service is provided "as is." Maintain your own backups via
          Settings → Import / Export.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Termination</h2>
        <p className="mt-2 text-muted-foreground">
          You may delete your account at any time. We may suspend or terminate accounts that abuse
          the service.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Liability</h2>
        <p className="mt-2 text-muted-foreground">
          Orange Way is provided without warranties. To the maximum extent permitted by law, our
          aggregate liability is limited to fees you paid in the 12 months preceding the claim
          (which, during beta, is zero).
        </p>

        <p className="mt-10 text-xs text-muted-foreground">Questions? Email legal@orangeway.app.</p>
      </article>
    </MarketingShell>
  );
}
