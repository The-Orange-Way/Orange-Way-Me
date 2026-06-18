import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConnectorFlowProps } from "../types";

export function ComingSoonFlow({ onCancel }: ConnectorFlowProps) {
  return (
    <div className="space-y-4 py-2 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Construction className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Coming soon</h3>
        <p className="text-sm text-muted-foreground">
          This connector isn't wired up yet. Use Manual, CSV, or xpub for now.
        </p>
      </div>
      <div className="flex justify-center pt-2">
        <Button variant="outline" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}
