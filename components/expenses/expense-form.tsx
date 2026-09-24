"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { getStockForMonthAction, saveExpenseAction } from "@/app/actions/expenses";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/shared";
import { useAction } from "@/components/client-shared";
import { CATEGORY_NAMES, itemsForCategory, UNITS } from "@/lib/constants";
import { findStockRow } from "@/lib/calculations";
import { monthKeyOf, todayKey } from "@/lib/dates";
import { formatCurrency, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExpenseDTO, MemberDTO, StockRow } from "@/types";

interface Row {
  key: string;
  category: string;
  item: string;
  quantity: string;
  unit: string;
  amount: string;
  finished: "yes" | "no";
  remaining: string;
}

const newRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  category: "",
  item: "",
  quantity: "",
  unit: "",
  amount: "",
  finished: "yes",
  remaining: "",
});

export function ExpenseFormDialog({
  open,
  onClose,
  expense,
  members,
}: {
  open: boolean;
  onClose: () => void;
  expense: ExpenseDTO | null;
  members: MemberDTO[];
}) {
  const { pending, run } = useAction();
  const [date, setDate] = React.useState(todayKey());
  const [note, setNote] = React.useState("");
  const [buyers, setBuyers] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Row[]>([newRow()]);
  const [stock, setStock] = React.useState<Record<string, StockRow[]>>({});

  // Reset the form whenever it opens.
  React.useEffect(() => {
    if (!open) return;
    setDate(expense?.date ?? todayKey());
    setNote(expense?.note ?? "");
    setBuyers(expense?.buyerIds ?? []);
    setRows(
      expense?.items.length
        ? expense.items.map((it) => ({
            ...newRow(),
            category: it.category ?? "",
            item: it.item,
            quantity: it.quantity != null ? String(it.quantity) : "",
            unit: it.unit ?? "",
            amount: String(it.amount),
          }))
        : [newRow()],
    );
  }, [open, expense]);

  // Stock on hand for the expense's month, used by the "Previous stock finished?" check.
  const month = date ? monthKeyOf(date) : monthKeyOf(todayKey());
  React.useEffect(() => {
    if (!open || stock[month]) return;
    let cancelled = false;
    getStockForMonthAction(month).then((res) => {
      if (!cancelled && res.ok) setStock((s) => ({ ...s, [month]: res.data }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, month, stock]);

  const monthStock = stock[month] ?? [];
  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) > 0 ? parseFloat(r.amount) : 0), 0);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = rows.filter((r) => r.item.trim() || r.amount);
    const items = filled.map((r) => {
      const existing = r.item && r.unit ? findStockRow(monthStock, r.item, r.unit) : null;
      const remaining = parseFloat(r.remaining);
      return {
        category: r.category || null,
        item: r.item.trim(),
        quantity: r.quantity ? parseFloat(r.quantity) : null,
        unit: (r.unit || null) as (typeof UNITS)[number] | null,
        amount: parseFloat(r.amount),
        manualStockRemaining: existing ? (r.finished === "no" ? (Number.isFinite(remaining) ? Math.max(0, remaining) : 0) : 0) : null,
      };
    });
    const ok = await run(() => saveExpenseAction({ id: expense?.id, date, note, buyerIds: buyers, items }), {
      success: expense ? "Expense updated." : "Expense added.",
    });
    if (ok) {
      setStock({});
      onClose();
    }
  }

  // An inactive buyer on an old expense stays selectable while editing it.
  const pickable = members.filter((m) => m.status === "ACTIVE" || buyers.includes(m.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={expense ? "Edit Expense" : "Add Expense"} className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <Label>Items</Label>
          <div className="space-y-3">
            {rows.map((r) => {
              const suggestions = itemsForCategory(r.category);
              const existing = r.item && r.unit ? findStockRow(monthStock, r.item, r.unit) : null;
              return (
                <div key={r.key} className="space-y-3 rounded-xl border border-border p-3.5">
                  <div className="flex items-start gap-2">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2">
                      <Field label="Category" htmlFor={`cat-${r.key}`}>
                        <Select id={`cat-${r.key}`} value={r.category} onChange={(e) => update(r.key, { category: e.target.value })}>
                          <option value="">Select a category</option>
                          {CATEGORY_NAMES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Item" htmlFor={`item-${r.key}`}>
                        <Input
                          id={`item-${r.key}`}
                          list={`items-${r.key}`}
                          autoComplete="off"
                          placeholder={r.category === "Others" ? "Type any item" : "e.g. Rice, Fish, Vegetables"}
                          value={r.item}
                          onChange={(e) => update(r.key, { item: e.target.value })}
                        />
                        <datalist id={`items-${r.key}`}>
                          {suggestions.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-6 hover:bg-danger-100 hover:text-danger-600"
                      disabled={rows.length <= 1}
                      aria-label="Remove item"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Qty (optional)" htmlFor={`qty-${r.key}`}>
                      <Input id={`qty-${r.key}`} type="number" inputMode="decimal" min="0" step="any" placeholder="e.g. 5" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
                    </Field>
                    <Field label="Unit" htmlFor={`unit-${r.key}`}>
                      <Select id={`unit-${r.key}`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>
                        <option value="">—</option>
                        {UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Amount (৳)" htmlFor={`amt-${r.key}`}>
                      <Input id={`amt-${r.key}`} type="number" inputMode="decimal" min="0" step="any" placeholder="500" value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
                    </Field>
                  </div>
                  {existing ? (
                    <div className="rounded-lg border border-warning-100 bg-warning-100/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground">
                          You already have {formatQty(existing.available)} {existing.unit} of this in stock. Previous stock finished?
                        </p>
                        <div className="flex gap-1.5" role="radiogroup" aria-label="Previous stock finished?">
                          {(["yes", "no"] as const).map((v) => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={r.finished === v}
                              onClick={() =>
                                update(r.key, {
                                  finished: v,
                                  remaining: v === "no" && !r.remaining ? String(existing.available) : r.remaining,
                                })
                              }
                              className={cn(
                                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                r.finished === v ? "border-navy-900 bg-navy-900 text-white" : "border-border bg-surface text-foreground",
                              )}
                            >
                              {v === "yes" ? "Yes" : "No"}
                            </button>
                          ))}
                        </div>
                      </div>
                      {r.finished === "no" ? (
                        <div className="mt-2.5 flex items-center gap-2">
                          <label htmlFor={`rem-${r.key}`} className="text-xs font-medium text-muted">
                            Remaining from before:
                          </label>
                          <Input
                            id={`rem-${r.key}`}
                            type="number"
                            min="0"
                            step="any"
                            className="w-24 px-2 py-1"
                            value={r.remaining}
                            onChange={(e) => update(r.key, { remaining: e.target.value })}
                          />
                          <span className="text-xs text-muted">{existing.unit}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, newRow()])}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-gray-100/40 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Add Another Item
          </button>
        </div>

        <Field label="Done By (select one or more)">
          <div className="grid grid-cols-2 gap-2">
            {pickable.map((m) => {
              const on = buyers.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBuyers((b) => (on ? b.filter((x) => x !== m.id) : [...b, m.id]))}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
                    on ? "border-navy-900 bg-navy-900 text-white" : "border-border text-foreground hover:bg-gray-100",
                  )}
                >
                  <Avatar name={m.name} pictureUrl={m.pictureUrl} color={m.avatarColor} size="sm" />
                  <span className="truncate">{m.name}</span>
                </button>
              );
            })}
            {pickable.length === 0 ? <p className="col-span-2 text-sm text-muted">Add an active member first.</p> : null}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="e-date">
            <Input id="e-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)" htmlFor="e-note">
          <Textarea id="e-note" rows={2} placeholder="e.g. Price increased this week" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3">
          <span className="text-sm font-semibold text-navy-900">Total</span>
          <span className="text-base font-bold tabular-nums text-navy-900">{formatCurrency(total)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {expense ? "Save Changes" : "Add Expense"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
