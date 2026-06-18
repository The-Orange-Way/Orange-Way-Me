import { useEffect, useMemo, useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  PlusCircle,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useHousehold,
  type HouseholdInvite,
  type HouseholdMember,
  type HouseholdRole,
} from "@/hooks/useHousehold";
import { CalendarClock } from "lucide-react";
import { completePendingHouseholdWraps } from "@/lib/household-invite-wrap";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import HouseholdRekeyWizard from "@/components/rekey/HouseholdRekeyWizard";
import { featureFlags } from "@/lib/feature-flags";
import { HouseholdCurrenciesCard } from "@/components/settings/HouseholdCurrenciesCard";

export function HouseholdPage() {
  const {
    household,
    members,
    invites,
    loading,
    createHousehold,
    updateName,
    inviteByEmail,
    revokeInvite,
    removeMember,
    changeRole,
    extendRoleExpiry,
    reload,
  } = useHousehold();
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  // Phase 4.5: post-remove-member prompt state.
  const [postRemovePrompt, setPostRemovePrompt] = useState<{
    name: string;
  } | null>(null);
  const [rekeyWizardOpen, setRekeyWizardOpen] = useState(false);
  // Phase 4.3: confirm-remove dialog (Bitwarden-style).
  const [removeConfirm, setRemoveConfirm] = useState<{
    member: HouseholdMember;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  // Phase 4.3 realtime: when the recipient publishes a keypair, the DB
  // trigger flips household_invites to status='ready_to_wrap'. Subscribe
  // here and drain ready rows so the Owner sees the invite resolve
  // automatically without a refresh.
  useEffect(() => {
    if (!household) return;
    let cancelled = false;

    const drain = async () => {
      try {
        const { ok, failed } = await completePendingHouseholdWraps(household.id);
        if (cancelled) return;
        if (ok > 0) {
          toast.success(`${ok} pending invite${ok === 1 ? "" : "s"} completed`);
        }
        if (failed > 0) {
          // Quiet warn — the trigger will retry next time the row
          // changes; surfacing per-failure toasts here would be noisy.
          console.warn(
            `[household] ${failed} invite${failed === 1 ? "" : "s"} could not be completed yet.`,
          );
        }
        if (ok > 0 || failed > 0) {
          await reload();
        }
      } catch (err) {
        console.warn("[household] completePendingHouseholdWraps threw:", err);
      }
    };
    void drain();

    const channel = supabase
      .channel(`household_invites:${household.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_invites",
          filter: `household_id=eq.${household.id}`,
        },
        () => {
          if (cancelled) return;
          void drain();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [household, reload]);

  const pendingInvitesByEmail = useMemo(() => {
    const map = new Map<string, HouseholdInvite>();
    for (const inv of invites) {
      if (inv.email) map.set(inv.email.toLowerCase(), inv);
    }
    return map;
  }, [invites]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Household</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite family members to share views of your finances.
        </p>
      </div>

      {!household ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              No household yet
            </CardTitle>
            <CardDescription>Create a household to invite family members.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Create household
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Household name */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{household.name}</CardTitle>
              <CardDescription>
                {members.length} member{members.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
                Rename household
              </Button>
            </CardContent>
          </Card>

          {/* Currencies (Phase 1 of household currency settings) */}
          <HouseholdCurrenciesCard />

          {/* Members */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Members</CardTitle>
                <Button size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Invite
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-0">
              {members.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">No members yet.</p>
              ) : (
                members.map((m) => {
                  const pending = m.email
                    ? pendingInvitesByEmail.get(m.email.toLowerCase())
                    : undefined;
                  const isWaiting =
                    pending?.status === "awaiting_recipient" || pending?.status === "ready_to_wrap";
                  const isTimeBoxed = m.role === "auditor" || m.role === "support";
                  // Phase 4.4 visual artefacts (auditor badge, support
                  // badge, expiry pill, "Extend 30 days") stay hidden
                  // until featureFlags.phase44Public flips on.
                  const showPhase44Member = featureFlags.phase44Public;
                  const expiryBadge =
                    showPhase44Member && isTimeBoxed && m.expires_at
                      ? formatExpiresBadge(m.expires_at)
                      : null;
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between px-6 py-3 hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{m.email ?? "(pending)"}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground capitalize">
                            {m.status}
                          </span>
                          {showPhase44Member && m.role === "auditor" && (
                            <Badge variant="outline" className="text-xs">
                              Tax accountant view
                            </Badge>
                          )}
                          {showPhase44Member && m.role === "support" && (
                            <Badge variant="outline" className="text-xs">
                              Customer support
                            </Badge>
                          )}
                          {expiryBadge && (
                            <Badge
                              variant={expiryBadge.tone === "danger" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              <CalendarClock className="mr-1 h-3 w-3" />
                              {expiryBadge.label}
                            </Badge>
                          )}
                          {isWaiting && (
                            <Badge variant="secondary" className="text-xs">
                              {pending?.status === "ready_to_wrap"
                                ? "Finishing setup"
                                : "Waiting for them to set up"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.role !== "owner" && !isTimeBoxed && (
                          <Select
                            value={m.role}
                            onValueChange={async (v) => {
                              try {
                                await changeRole(m.id, v as HouseholdRole);
                              } catch (err) {
                                toastError(err, "Failed");
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="partner">Partner</SelectItem>
                              <SelectItem value="advisor">Advisor</SelectItem>
                              <SelectItem value="dependent">Dependent</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {showPhase44Member && m.role === "auditor" && (
                          <ExtendRoleButton memberId={m.id} extendRoleExpiry={extendRoleExpiry} />
                        )}
                        {m.role === "owner" && <Badge variant="secondary">Owner</Badge>}
                        {m.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setRemoveConfirm({ member: m })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* Active invites */}
          {invites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pending invites</CardTitle>
                <CardDescription>
                  Pending invites disappear once the person finishes setup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-0">
                {invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between px-6 py-3 hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {inv.email ?? <span className="font-mono text-xs">{inv.code}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.status === "code_only" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(inv.code);
                            toast.success("Code copied");
                          }}
                        >
                          <Copy className="mr-1 h-3 w-3" />
                          Copy code
                        </Button>
                      )}
                      {inv.status !== "code_only" && (
                        <Badge variant="secondary" className="text-xs">
                          {inv.status === "ready_to_wrap" ? "Finishing setup" : "Waiting"}
                        </Badge>
                      )}
                      <RevokeInviteButton inviteId={inv.id} revokeInvite={revokeInvite} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <CreateHouseholdDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createHousehold}
      />
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvite={async (email, role, expiresAt) => {
          const result = await inviteByEmail(email, role, { expiresAt });
          if (result?.wrap_status === "wrapped") {
            toast.success(result.message ?? "Member added");
          } else {
            toast.success(
              result?.message ?? "Invite sent — they'll join once they set up their account.",
            );
          }
        }}
      />
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        current={household?.name ?? ""}
        onSave={updateName}
      />

      {/* Phase 4.3 confirm-remove dialog (Bitwarden pattern). */}
      <Dialog
        open={Boolean(removeConfirm)}
        onOpenChange={(o) => {
          if (!o) setRemoveConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove from household?
            </DialogTitle>
            <DialogDescription>
              Remove {removeConfirm?.member.email ?? "this person"} from this household? They will
              lose access to future data. Historical data access will be revoked when you next
              refresh household security.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveConfirm(null)} disabled={removing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={async () => {
                if (!removeConfirm) return;
                setRemoving(true);
                try {
                  await removeMember(removeConfirm.member.id);
                  setPostRemovePrompt({
                    name: removeConfirm.member.email ?? "This person",
                  });
                  setRemoveConfirm(null);
                } catch (err) {
                  toastError(err, "Failed");
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 4.5 post-remove-member prompt */}
      <Dialog
        open={Boolean(postRemovePrompt)}
        onOpenChange={(o) => {
          if (!o) setPostRemovePrompt(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Refresh household security?
            </DialogTitle>
            <DialogDescription>
              {postRemovePrompt?.name ?? "This person"} has been removed from your household.
              Refresh your household's security so they can't read data they may have viewed? (Takes
              a few minutes.)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostRemovePrompt(null)}>
              Not now
            </Button>
            <Button
              onClick={() => {
                setPostRemovePrompt(null);
                setRekeyWizardOpen(true);
              }}
            >
              Refresh security now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 4.5 wizard, opened from the post-remove-member prompt. */}
      {rekeyWizardOpen && household && (
        <HouseholdRekeyWizard
          householdId={household.id}
          open={rekeyWizardOpen}
          startAtWhatHappens
          triggerType="post_revoke"
          onClose={() => setRekeyWizardOpen(false)}
        />
      )}
    </div>
  );
}

function ExtendRoleButton({
  memberId,
  extendRoleExpiry,
}: {
  memberId: string;
  extendRoleExpiry: (id: string, iso: string) => Promise<unknown>;
}) {
  const [run, busy] = useAsyncAction(async () => {
    try {
      const next = new Date();
      next.setDate(next.getDate() + 30);
      await extendRoleExpiry(memberId, next.toISOString());
      toast.success("Extended by 30 days");
    } catch (err) {
      toastError(err, "Could not extend");
    }
  });
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      disabled={busy}
      onClick={() => void run()}
    >
      {busy ? "Extending…" : "Extend 30 days"}
    </Button>
  );
}

function RevokeInviteButton({
  inviteId,
  revokeInvite,
}: {
  inviteId: string;
  revokeInvite: (id: string) => Promise<unknown>;
}) {
  const [run, busy] = useAsyncAction(async () => {
    try {
      await revokeInvite(inviteId);
    } catch (err) {
      toastError(err, "Failed");
    }
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive"
      disabled={busy}
      onClick={() => void run()}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function CreateHouseholdDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate(name.trim());
      toast.success("Household created");
      setName("");
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create household</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hh-name">Household name</Label>
            <Input
              id="hh-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smith Family"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type InviteHandler = (email: string, role: HouseholdRole, expiresAt?: string) => Promise<void>;

function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInvite: InviteHandler;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Re-mounts on each open so per-form state starts clean. */}
        {open && <InviteDialogBody onInvite={onInvite} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Default Auditor expiry: 30 days from today (YYYY-MM-DD). */
function defaultAuditorExpiryDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

/** One year from today, ISO YYYY-MM-DD — UI cap on Auditor expiry. */
function maxAuditorExpiryDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function InviteDialogBody({ onInvite, onClose }: { onInvite: InviteHandler; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<HouseholdRole>("partner");
  // Phase 4.4: Auditor invites need a future expires_at (max 1 year).
  const [expiresOn, setExpiresOn] = useState<string>(defaultAuditorExpiryDate());
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      let expiresAtIso: string | undefined;
      if (role === "auditor") {
        // Send as end-of-day local for predictable UX.
        const parsed = new Date(`${expiresOn}T23:59:59`);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Please pick a valid expiry date.");
        }
        expiresAtIso = parsed.toISOString();
      }
      await onInvite(email.trim(), role, expiresAtIso);
      onClose();
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invite to household</DialogTitle>
        <DialogDescription>
          Send an email invite. They'll get access once they create their account.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as HouseholdRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="partner">Partner · full household access</SelectItem>
              {featureFlags.phase44Public && (
                <SelectItem value="auditor">Tax accountant view · time-boxed, read only</SelectItem>
              )}
              <SelectItem value="dependent" disabled>
                Dependent — coming soon
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {role === "auditor" && (
          <div className="space-y-2">
            <Label htmlFor="invite-expires">Access ends on</Label>
            <Input
              id="invite-expires"
              type="date"
              value={expiresOn}
              min={new Date().toISOString().slice(0, 10)}
              max={maxAuditorExpiryDate()}
              onChange={(e) => setExpiresOn(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              They can view your data until this date. Up to 1 year. You can extend it any time
              before then.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? "Sending…" : "Send invite"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/**
 * Phase 4.4: render a member's `expires_at` as a friendly badge.
 * Green/secondary if more than 7 days remain; destructive when <= 2
 * days; "Expired" if already past.
 */
export function formatExpiresBadge(expiresAt: string): {
  label: string;
  tone: "ok" | "warn" | "danger";
} {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: "Expired", tone: "danger" };
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days <= 2) {
    const hoursLeft = Math.ceil(ms / (1000 * 60 * 60));
    return { label: `Expires in ${hoursLeft}h`, tone: "danger" };
  }
  if (days <= 7) return { label: `Expires in ${days}d`, tone: "warn" };
  return { label: `Expires in ${days}d`, tone: "ok" };
}

function RenameDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: string;
  onSave: (name: string) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Re-mount on each open so the input always shows the live name. */}
        {open && (
          <RenameDialogBody current={current} onSave={onSave} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameDialogBody({
  current,
  onSave,
  onClose,
}: {
  current: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(name.trim());
      toast.success("Household renamed");
      onClose();
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename household</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
