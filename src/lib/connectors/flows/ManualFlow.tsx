import { useState } from "react";
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
import type { AccountTypeKey, ConnectorFlowProps } from "../types";
import { ACCOUNT_TYPES, CURRENCIES } from "../constants";

export function ManualFlow({ onComplete, onCancel }: ConnectorFlowProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountTypeKey>("checking");
  const [currency, setCurrency] = useState("USD");
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("0.00");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onComplete({
        name: name.trim(),
        type,
        currency,
        institution: institution.trim() || null,
        balance: balance.trim() || "0",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="acc-name">Account name</Label>
        <Input
          id="acc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Everyday checking"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as AccountTypeKey)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="acc-inst">Institution (optional)</Label>
        <Input
          id="acc-inst"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="Chase, Coinbase, Wealthsimple…"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="acc-bal">Starting balance</Label>
        <Input
          id="acc-bal"
          value={balance}
          inputMode="decimal"
          onChange={(e) => setBalance(e.target.value)}
          className="font-mono"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Encrypting…" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
