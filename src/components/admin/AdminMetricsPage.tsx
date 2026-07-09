import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DailySignup {
  day: string;
  count: number;
}

interface AdminMetrics {
  generated_at: string;
  total_users: number;
  users_confirmed: number;
  signups_last_7d: number;
  signups_last_30d: number;
  allowlist_total: number;
  allowlist_invited: number;
  allowlist_signed_up: number;
  applications_total: number;
  signups_daily_30d: DailySignup[];
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AdminMetricsPage() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      // @ts-expect-error supabase types are generated against the deployed schema; this PR's
      // migration adds the admin_metrics RPC and types regenerate on the next `supabase gen types` pass.
      const { data, error } = await supabase.rpc("admin_metrics");
      if (!active) return;
      if (error || !data) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setMetrics(data as unknown as AdminMetrics);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
      </div>
    );
  }

  if (denied || !metrics) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-xl font-semibold text-foreground">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have admin access. This page shows aggregate signup and activity counts only,
          never any user's financial data.
        </p>
      </div>
    );
  }

  const daily = metrics.signups_daily_30d ?? [];
  const maxDaily = daily.reduce((m, d) => Math.max(m, d.count), 0) || 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-xl font-semibold text-foreground">Admin metrics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Aggregate counts only. User financial data is client-encrypted and cannot be read here.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total users" value={metrics.total_users} />
        <StatCard label="Confirmed" value={metrics.users_confirmed} hint="email confirmed" />
        <StatCard label="Signups 7d" value={metrics.signups_last_7d} />
        <StatCard label="Signups 30d" value={metrics.signups_last_30d} />
        <StatCard
          label="Allowlist"
          value={metrics.allowlist_total}
          hint={`${metrics.allowlist_signed_up} signed up`}
        />
        <StatCard label="Applications" value={metrics.applications_total} hint="beta apply form" />
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Signups, last 30 days
        </p>
        {daily.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No signups in the last 30 days.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {daily.map((d) => (
              <li key={d.day} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{d.day}</span>
                <span
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (d.count / maxDaily) * 100)}%` }}
                />
                <span className="text-xs text-foreground">{d.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Generated {new Date(metrics.generated_at).toLocaleString()}
      </p>
    </div>
  );
}
