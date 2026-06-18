import { useState } from "react";
import { Bitcoin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ConnectorFlowProps } from "../types";
import { fetchXpubBalanceBtc, shortXpub, validateExtendedKey } from "../xpub-api";

export function XpubFlow({ onComplete, onCancel }: ConnectorFlowProps) {
  const [xpub, setXpub] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("BTC");
  const [balanceBtc, setBalanceBtc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onLookup = async () => {
    setError(null);
    setBalanceBtc(null);
    const v = validateExtendedKey(xpub);
    if (!v.ok) {
      setError(v.reason ?? "Invalid xpub");
      return;
    }
    setLoading(true);
    try {
      const btc = await fetchXpubBalanceBtc(xpub.trim());
      setBalanceBtc(btc);
      if (!name.trim()) setName(`Bitcoin — ${shortXpub(xpub)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanceBtc || !name.trim()) return;
    setSubmitting(true);
    try {
      const balance =
        currency === "sats" ? Math.round(Number(balanceBtc) * 1e8).toString() : balanceBtc;
      await onComplete({
        name: name.trim(),
        type: "bitcoin",
        currency,
        institution: "mempool.space",
        balance,
        metadata: { xpub: xpub.trim(), source: "mempool.space" },
        credentials: { xpub: xpub.trim() },
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Bitcoin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Watch-only. We never see a private key. Balance is fetched from mempool.space — you can
            self-host one and switch in Settings later.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="xpub">Extended public key</Label>
        <Input
          id="xpub"
          value={xpub}
          onChange={(e) => {
            setXpub(e.target.value);
            setBalanceBtc(null);
          }}
          placeholder="xpub6C…"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onLookup}
            disabled={loading || !xpub}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Fetching…
              </>
            ) : (
              "Fetch balance"
            )}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {balanceBtc !== null && (
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Detected balance
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {balanceBtc} BTC
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-name">Display name</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BTC">BTC</SelectItem>
                <SelectItem value="sats">sats</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || balanceBtc === null}>
          {submitting ? "Encrypting…" : "Add wallet"}
        </Button>
      </div>
    </form>
  );
}
