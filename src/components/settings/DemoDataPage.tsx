import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Loader2, Trash2, Wallet, Receipt, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { DEMO_FAMILIES, type DemoFamily } from "@/lib/demo-families";
import { useDemoSeed } from "@/hooks/useDemoSeed";
import { useCategories } from "@/hooks/useCategories";

// ── Confetti cannon ──────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d")!;

  const COLORS = ["#f59e0b", "#8b5cf6", "#10b981", "#3b82f6", "#f43f5e", "#facc15"];
  const particles = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * 200,
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * 4 + 2,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    w: Math.random() * 10 + 5,
    h: Math.random() * 6 + 3,
    rot: Math.random() * 360,
    rotV: (Math.random() - 0.5) * 6,
  }));

  let raf: number;
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.07;
      p.rot += p.rotV;
      if (p.y < canvas.height + 20) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(tick);
    else canvas.remove();
  };
  raf = requestAnimationFrame(tick);
  setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, 4500);
}

// ── Progress overlay ─────────────────────────────────────────────────────────
function SeedingOverlay({
  family,
  progress,
}: {
  family: DemoFamily;
  progress: import("@/hooks/useDemoSeed").SeedProgress | null;
}) {
  if (!progress) return null;

  const isDone = progress.phase === "done";

  const steps = [
    {
      key: "wallets",
      icon: Wallet,
      label: "Creating wallets",
      done: progress.walletsDone,
      total: progress.walletsTotal,
      active: progress.phase === "wallets",
      complete: ["categories", "transactions", "goals", "done"].includes(progress.phase),
    },
    {
      key: "transactions",
      icon: Receipt,
      label: "Importing transactions",
      done: progress.txnsDone,
      total: progress.txnsTotal,
      active: progress.phase === "transactions",
      complete: ["goals", "done"].includes(progress.phase),
    },
    {
      key: "goals",
      icon: Target,
      label: "Setting up goals",
      done: progress.goalsDone,
      total: progress.goalsTotal,
      active: progress.phase === "goals",
      complete: progress.phase === "done",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl">
        {isDone ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-3xl">
              {family.emoji}
            </div>
            <div className="text-xl font-semibold">{family.name} loaded!</div>
            <p className="text-sm text-muted-foreground">Taking you to the dashboard…</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <div className="text-3xl">{family.emoji}</div>
              <div className="text-base font-semibold">Loading {family.name}</div>
              <p className="text-xs text-muted-foreground">Encrypting and saving your demo data</p>
            </div>

            <div className="space-y-4">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                      {step.complete ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : step.active ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${step.active ? "text-foreground" : step.complete ? "text-foreground" : "text-muted-foreground/50"}`}
                      >
                        {step.label}
                      </div>
                      {step.active && step.total > 0 && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${Math.round((step.done / step.total) * 100)}%` }}
                          />
                        </div>
                      )}
                      {(step.active || step.complete) && (
                        <div className="text-xs text-muted-foreground">
                          {step.complete
                            ? `${step.total} ${step.key === "wallets" ? "wallets" : step.key === "transactions" ? "transactions" : "goals"}`
                            : `${step.done} / ${step.total}`}
                        </div>
                      )}
                    </div>
                    {step.complete && (
                      <span className="text-xs text-primary font-medium">Done</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export function DemoDataPage() {
  const { seededFamily, seedFamily, clearDemoData, seeding, clearing, progress } = useDemoSeed();
  const { categories, seedDefaults } = useCategories();
  const navigate = useNavigate();
  const [pendingFamily, setPendingFamily] = useState<DemoFamily | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [activeSeedFamily, setActiveSeedFamily] = useState<DemoFamily | null>(null);
  const confettiFired = useRef(false);

  // When seeding completes (phase=done), fire confetti then soft-navigate to dashboard.
  // Soft navigation keeps the vault unlocked so all hooks can fetch the new data immediately.
  useEffect(() => {
    if (progress?.phase === "done" && !confettiFired.current) {
      confettiFired.current = true;
      launchConfetti();
      setTimeout(() => {
        void navigate({ to: "/dashboard" });
      }, 2200);
    }
  }, [progress?.phase, navigate]);

  const handleSeed = async (family: DemoFamily) => {
    if (seededFamily) {
      setPendingFamily(family);
      return;
    }
    await doSeed(family);
  };

  const doSeed = async (family: DemoFamily) => {
    confettiFired.current = false;
    setActiveSeedFamily(family);
    try {
      if (categories.length === 0) await seedDefaults();
      await seedFamily(family);
    } catch (err) {
      setActiveSeedFamily(null);
      toastError(err, "Seeding failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress overlay — shown while seeding AND during the "done" celebration beat */}
      {activeSeedFamily && (seeding || progress?.phase === "done") && (
        <SeedingOverlay family={activeSeedFamily} progress={progress} />
      )}

      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Demo Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Load a sample family to explore Orange Way with realistic data. Perfect for demos and
          learning the app.
        </p>
      </div>

      {seededFamily && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <span>
              <strong>{seededFamily}</strong> is currently loaded.
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={clearing}
            onClick={() => setClearOpen(true)}
          >
            {clearing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Clear demo data
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
        {DEMO_FAMILIES.map((family) => {
          const isActive = seededFamily === family.name;
          return (
            <Card
              key={family.id}
              className={`relative overflow-hidden transition-all ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: family.accentColor }}
              />
              <CardHeader className="pt-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{family.name}</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">{family.tagline}</CardDescription>
                  </div>
                  <span className="text-2xl leading-none">{family.emoji}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{family.description}</p>

                <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
                  <div className="font-medium text-foreground">What gets seeded:</div>
                  <div className="text-muted-foreground">
                    · {family.accounts.length} wallets (
                    {family.accounts
                      .map((a) => a.currency)
                      .filter((v, i, s) => s.indexOf(v) === i)
                      .join(", ")}
                    )
                  </div>
                  <div className="text-muted-foreground">
                    · {family.transactions.length} transactions over ~3 months
                  </div>
                  <div className="text-muted-foreground">
                    · {family.goals.length} financial goals
                  </div>
                </div>

                {isActive ? (
                  <Button disabled className="w-full" variant="outline">
                    <CheckCircle2 className="mr-2 h-4 w-4 text-primary" />
                    Currently loaded
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    style={{ background: family.accentColor, borderColor: family.accentColor }}
                    disabled={seeding}
                    onClick={() => handleSeed(family)}
                  >
                    {seeding ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      `Load ${family.name.split(" ")[1]} family`
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        All demo data is encrypted the same way as real data. Clear it any time using the button
        above.
      </p>

      {/* Replace confirmation */}
      <AlertDialog
        open={!!pendingFamily}
        onOpenChange={(o) => {
          if (!o) setPendingFamily(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{seededFamily}</strong> and load{" "}
              <strong>{pendingFamily?.name}</strong> instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const f = pendingFamily!;
                setPendingFamily(null);
                await doSeed(f);
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear confirmation */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all wallets, transactions, and goals seeded by the demo. Your real data
              is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setClearOpen(false);
                try {
                  await clearDemoData();
                  toast.success("Demo data cleared");
                } catch (err) {
                  toastError(err, "Clear failed");
                }
              }}
            >
              Clear demo data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
