import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as Icons from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  PICKER_CONNECTORS,
  type Connector,
  type ConnectorType,
  type AccountDraft,
} from "@/lib/connectors";
import { useAccounts } from "@/hooks/useAccounts";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function AddAccountDialog({ open, onOpenChange, onCreated }: AddAccountDialogProps) {
  const [selected, setSelected] = useState<Connector | null>(null);
  const { createAccount } = useAccounts();
  const navigate = useNavigate();

  const handleClose = () => {
    setSelected(null);
    onOpenChange(false);
  };

  // Navigation tiles (e.g. OrangeRails) close the picker and route the
  // user to a dedicated page where the multi-step flow lives. The
  // dialog never shows a FlowComponent for navigation tiles.
  const handleSelect = (c: Connector) => {
    if (c.comingSoon) return;
    if (c.navigateTo) {
      handleClose();
      void navigate({ to: c.navigateTo });
      return;
    }
    setSelected(c);
  };

  const handleComplete = async (type: ConnectorType, draft: AccountDraft) => {
    try {
      const id = await createAccount(type, draft);
      toast.success("Account added");
      onCreated?.(id);
      handleClose();
    } catch (err) {
      toastError(err, "Failed to add account");
    }
  };

  const Flow = selected?.FlowComponent;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleClose() : onOpenChange(o))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {selected ? selected.label : "How do you want to add this account?"}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? selected.description
              : "Pick a connector. Manual entry is fine — you can always import later."}
          </DialogDescription>
        </DialogHeader>

        {!selected && (
          <div className="grid grid-cols-1 gap-2">
            {PICKER_CONNECTORS.map((c) => (
              <ConnectorTile key={c.type} connector={c} onSelect={() => handleSelect(c)} />
            ))}
          </div>
        )}

        {selected && Flow && (
          <Flow
            onComplete={(draft) => handleComplete(selected.type, draft)}
            onCancel={() => setSelected(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectorTile({ connector, onSelect }: { connector: Connector; onSelect: () => void }) {
  const Icon = (Icons[connector.icon as keyof typeof Icons] ??
    Icons.Wallet) as React.ComponentType<{
    className?: string;
  }>;
  const disabled = !!connector.comingSoon;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary/40 hover:bg-accent/40"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{connector.label}</span>
          {connector.comingSoon && (
            <Badge variant="secondary" className="text-[10px]">
              Coming soon
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">{connector.description}</div>
      </div>
    </button>
  );
}
