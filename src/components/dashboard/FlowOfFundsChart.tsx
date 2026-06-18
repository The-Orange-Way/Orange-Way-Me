/**
 * FlowOfFundsChart — Sankey diagram showing money flowing from income sources
 * through spending categories for the selected period. Uses recharts Sankey.
 */
import { useMemo } from "react";
import { Sankey, Tooltip, ResponsiveContainer, Rectangle } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import type { DecryptedCategory } from "@/hooks/useCategories";

interface Props {
  transactions: DecryptedTxn[];
  categories: DecryptedCategory[];
  primaryCurrency?: string;
}

interface SankeyNode {
  name: string;
}
interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

function buildSankeyData(
  transactions: DecryptedTxn[],
  categories: DecryptedCategory[],
): { nodes: SankeyNode[]; links: SankeyLink[] } | null {
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Aggregate by category
  const incomeByCategory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();

  for (const t of transactions) {
    const amt = parseFloat(t.amount);
    if (isNaN(amt) || amt === 0) continue;
    const cat = t.category_id ? catById.get(t.category_id) : null;
    const label = cat?.name ?? "Uncategorized";

    if (amt > 0) {
      incomeByCategory.set(label, (incomeByCategory.get(label) ?? 0) + amt);
    } else {
      expenseByCategory.set(label, (expenseByCategory.get(label) ?? 0) + Math.abs(amt));
    }
  }

  if (incomeByCategory.size === 0 && expenseByCategory.size === 0) return null;

  // Nodes: income sources (left) → "Money In" (center) → expense categories (right)
  // IMPORTANT: use namespaced keys (in:/out: prefix) so that an income category
  // and an expense category with the same name (e.g. both "Uncategorized") get
  // distinct node indices. A shared index creates a cycle in d3-sankey which
  // causes infinite recursion in the layout algorithm.
  const nodes: SankeyNode[] = [];
  const nodeIndex = new Map<string, number>();

  const addNode = (key: string, displayName: string) => {
    if (!nodeIndex.has(key)) {
      nodeIndex.set(key, nodes.length);
      nodes.push({ name: displayName });
    }
    return nodeIndex.get(key)!;
  };

  // Income nodes first (lowest indices), CENTER in middle, expenses last.
  // d3-sankey requires source index < target index for left-to-right flow.
  const CENTER_KEY = "__center__";
  const CENTER_LABEL = "Total Income";
  for (const k of incomeByCategory.keys()) addNode(`in:${k}`, k);
  addNode(CENTER_KEY, CENTER_LABEL);
  for (const k of expenseByCategory.keys()) addNode(`out:${k}`, k);

  const links: SankeyLink[] = [];

  // Income sources → center
  for (const [label, amt] of incomeByCategory) {
    links.push({
      source: nodeIndex.get(`in:${label}`)!,
      target: nodeIndex.get(CENTER_KEY)!,
      value: Math.max(0.01, Math.round(amt * 100) / 100),
    });
  }

  // Center → expenses (capped at total income so diagram balances visually)
  const totalIncome = Array.from(incomeByCategory.values()).reduce((s, v) => s + v, 0);
  let remaining = totalIncome;
  const sortedExpenses = Array.from(expenseByCategory.entries()).sort((a, b) => b[1] - a[1]);
  for (const [label, amt] of sortedExpenses) {
    const capped = Math.min(amt, remaining);
    if (capped <= 0) break;
    links.push({
      source: nodeIndex.get(CENTER_KEY)!,
      target: nodeIndex.get(`out:${label}`)!,
      value: Math.max(0.01, Math.round(capped * 100) / 100),
    });
    remaining -= capped;
  }

  return links.length > 0 ? { nodes, links } : null;
}

const NODE_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#10b981",
  "#ef4444",
  "#6366f1",
];

// recharts clones the node element and injects these props at render
// time (the `<SankeyNodeShape />` JSX usage passes nothing). Optional
// at the type level, required at runtime, defaults guard against a
// non-recharts call.
interface SankeyNodeShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { name?: string };
}

function SankeyNodeShape(props: SankeyNodeShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props;
  const color = NODE_COLORS[index % NODE_COLORS.length];
  const name: string = payload?.name ?? "";
  const isLeft = x < 80;
  const labelX = isLeft ? x + width + 6 : x - 6;
  const anchor = isLeft ? "start" : "end";
  const display = name.length > 22 ? name.slice(0, 20) + "…" : name;
  // Skip label for nodes too small to read without overlapping neighbours
  const showLabel = height >= 14;
  return (
    <g>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={0.85}
        radius={3}
      />
      {showLabel && (
        <text
          x={labelX}
          y={y + height / 2}
          dy="0.35em"
          textAnchor={anchor}
          fontSize={11}
          fill="#e5e7eb"
        >
          {display}
        </text>
      )}
    </g>
  );
}

export function FlowOfFundsChart({ transactions, categories, primaryCurrency = "USD" }: Props) {
  const data = useMemo(() => buildSankeyData(transactions, categories), [transactions, categories]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flow of Funds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            Add income and expense transactions to see the flow.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Flow of Funds</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <Sankey
            data={data}
            node={<SankeyNodeShape />}
            nodePadding={12}
            nodeWidth={16}
            link={{ stroke: "#888", strokeOpacity: 0.3 }}
            margin={{ top: 8, right: 140, bottom: 8, left: 140 }}
          >
            <Tooltip
              formatter={
                ((value: number) =>
                  new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: primaryCurrency,
                  }).format(value)) as never
              }
            />
          </Sankey>
        </ResponsiveContainer>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Income sources → spending categories · expenses capped at total income
        </p>
      </CardContent>
    </Card>
  );
}
