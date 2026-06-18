import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DecryptedTransaction } from "@/hooks/useAccountTransactions";

export function TransactionsTable({
  items,
  loading,
}: {
  items: DecryptedTransaction[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        Decrypting transactions…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No transactions yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((t) => {
            const n = Number(t.amount);
            const negative = n < 0;
            return (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.date}</TableCell>
                <TableCell className="max-w-[420px] truncate">{t.description}</TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${negative ? "text-destructive" : "text-foreground"}`}
                >
                  {n.toFixed(2)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
