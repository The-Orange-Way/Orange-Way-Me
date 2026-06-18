import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";

export function ProfilePage() {
  const { user } = useAuth();
  const { profile, loading, updateDisplayName } = useProfile();
  const navigate = useNavigate();
  const [nameEdit, setNameEdit] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const openEdit = () => {
    setNameEdit(profile.displayName);
    setEditOpen(true);
  };

  const saveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateDisplayName(nameEdit.trim());
      toast.success("Display name updated");
      setEditOpen(false);
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account information and sign-out controls.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Account
          </CardTitle>
          <CardDescription>Email is managed by your auth provider.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="mt-1 font-mono text-sm">{user?.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Display name</div>
            {loading ? (
              <div className="mt-1 h-4 w-32 animate-pulse rounded bg-muted" />
            ) : (
              <div className="mt-1 flex items-center gap-3">
                <span className="text-sm">{profile.displayName || "(not set)"}</span>
                <Button size="sm" variant="outline" onClick={openEdit}>
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogOut className="h-4 w-4" />
            Sign out
          </CardTitle>
          <CardDescription>This locks the vault and ends your session.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setSignOutOpen(true)}>
            Sign out
          </Button>
        </CardContent>
      </Card>

      {/* Edit display name */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit display name</DialogTitle>
            <DialogDescription>Stored encrypted. Only you can see it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveDisplayName} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sign out confirm */}
      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>Your vault will be locked and your session ended.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOutOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleSignOut}>
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
