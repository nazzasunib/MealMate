"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Receipt, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteExpenseAction } from "@/app/actions/expenses";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, MonthSwitcher } from "@/components/shared";
import { SearchBox, useAction } from "@/components/client-shared";
import { dateLabelMed } from "@/lib/dates";
import { formatCurrency, formatQty } from "@/lib/format";
import type { ExpenseDTO, MemberDTO } from "@/types";
import { ExpenseFormDialog } from "./expense-form";

export function itemsSummary(e: ExpenseDTO) {
  return e.items.map((it) => it.item + (it.quantity ? ` (${formatQty(it.quantity)}${it.unit ? " " + it.unit : ""})` : "")).join(", ");
}

export function ExpensesView({
  month,
  from,
  to,
  isCustomRange,
  expenses,
  members,
  breakdown,
  search,
}: {
  month: string;
  from: string;
  to: string;
  isCustomRange: boolean;
  expenses: ExpenseDTO[];
  members: MemberDTO[];
  breakdown: { item: string; count: number; amount: number }[];
  search: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const byId = new Map(members.map((m) => [m.id, m]));
  const [formOpen, setFormOpen] = React.useState(Boolean(params.get("add")));
  const [editing, setEditing] = React.useState<ExpenseDTO | null>(null);
  const [toDelete, setToDelete] = React.useState<string | null>(null);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [range, setRange] = React.useState({ from, to });
  const { pending, run } = useAction();
  React.useEffect(() => setRange({ from, to }), [from, to]);

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    if (params.get("add")) router.replace(`/expenses?month=${month}`, { scroll: false });
  }

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    if (!next.from || !next.to) return;
    if (next.from > next.to) {
      toast.error("Start date must be before the end date.");
      return;
    }
    const q = new URLSearchParams({ month, from: next.from, to: next.to });
    if (search) q.set("q", search);
    router.replace(`${pathname}?${q}`, { scroll: false });
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const allTimeTotal = breakdown.reduce((s, r) => s + r.amount, 0);
  const buyerNames = (e: ExpenseDTO) => e.buyerIds.map((id) => byId.get(id)?.name).filter(Boolean).join(", ") || "Unknown";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <ShoppingCart /> Add Expense
        </Button>
        <Button variant="secondary" onClick={() => setBreakdownOpen(true)}>
          <Receipt /> What Was Bought
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Expense History</h2>
            <SearchBox placeholder="Search item or member..." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthSwitcher month={month} basePath="/expenses" extra={{ q: search }} />
            <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-1 shadow-[var(--shadow-card)]">
              <input
                type="date"
                aria-label="From date"
                value={range.from}
                onChange={(e) => applyRange({ ...range, from: e.target.value })}
                className="rounded-lg bg-transparent px-1.5 py-1 text-xs text-foreground focus:outline-none"
              />
              <span className="text-xs text-muted">to</span>
              <input
                type="date"
                aria-label="To date"
                value={range.to}
                onChange={(e) => applyRange({ ...range, to: e.target.value })}
                className="rounded-lg bg-transparent px-1.5 py-1 text-xs text-foreground focus:outline-none"
              />
            </div>
            {isCustomRange ? (
              <Link
                href={`/expenses?month=${month}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-navy-900 shadow-[var(--shadow-card)] hover:bg-navy-50"
              >
                Reset to this month
              </Link>
            ) : null}
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={ShoppingCart}
              title={search ? "No matching expenses" : "No expenses in this range"}
              description={search ? "Try a different search term." : "Add an expense or pick a different date range."}
            />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {expenses.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-gray-100/50 sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{itemsSummary(e)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {dateLabelMed(e.date)} · Done by {buyerNames(e)}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-danger-600">−{formatCurrency(e.amount)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit expense"
                      onClick={() => {
                        setEditing(e);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete expense" className="hover:bg-danger-100 hover:text-danger-600" onClick={() => setToDelete(e.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border bg-navy-50 px-5 py-3">
              <span className="text-sm font-semibold text-navy-900">Total in range</span>
              <span className="font-bold tabular-nums text-navy-900">{formatCurrency(total)}</span>
            </div>
          </>
        )}
      </Card>

      <ExpenseFormDialog open={formOpen} onClose={closeForm} expense={editing} members={members} />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this expense?"
        description="This will remove the expense and update the available balance."
        loading={pending}
        onConfirm={async () => {
          if (toDelete && (await run(() => deleteExpenseAction(toDelete), { success: "Expense deleted." }))) setToDelete(null);
        }}
      />

      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen} title="What Was Bought — All Time">
        {breakdown.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No expenses yet" />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {breakdown.map((r) => (
              <div key={r.item} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{r.item}</p>
                  <p className="text-xs text-muted">
                    bought {r.count} time{r.count === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-danger-600">{formatCurrency(r.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3">
              <span className="text-sm font-semibold text-navy-900">Total</span>
              <span className="text-base font-bold tabular-nums text-navy-900">{formatCurrency(allTimeTotal)}</span>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
