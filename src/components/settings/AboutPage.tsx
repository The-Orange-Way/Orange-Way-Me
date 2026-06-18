import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const OPEN_SOURCE: { name: string; url: string; license: string }[] = [
  { name: "React", url: "https://react.dev", license: "MIT" },
  { name: "Vite", url: "https://vitejs.dev", license: "MIT" },
  { name: "TanStack Router", url: "https://tanstack.com/router", license: "MIT" },
  { name: "Supabase", url: "https://supabase.com", license: "Apache-2.0" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com", license: "MIT" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com", license: "MIT" },
  { name: "Lucide", url: "https://lucide.dev", license: "ISC" },
  { name: "Sonner", url: "https://sonner.emilkowal.ski", license: "MIT" },
  { name: "Recharts", url: "https://recharts.org", license: "MIT" },
];

export function AboutPage() {
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">About</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Version, privacy, and open-source credits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orange Way</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-2">
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-mono">0.1.0-alpha</dd>
            <dt className="text-muted-foreground">Encryption</dt>
            <dd>AES-256-GCM, PBKDF2 600k</dd>
            <dt className="text-muted-foreground">Key storage</dt>
            <dd>Browser memory only</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Privacy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Orange Way is zero-knowledge by design. All financial data is encrypted in your browser
            before it reaches our servers.
          </p>
          <p>
            We store: encrypted ciphertext, KDF salts, and blind-index HMACs. We can never read your
            account names, balances, transactions, or any other financial data.
          </p>
          <p>
            Your vault password never leaves your device. Losing it means losing access unless you
            have your recovery code.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open-source credits</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {OPEN_SOURCE.map((lib) => (
              <li key={lib.name} className="flex items-center justify-between text-sm">
                <span>{lib.name}</span>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span className="font-mono text-xs">{lib.license}</span>
                  <a
                    href={lib.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
