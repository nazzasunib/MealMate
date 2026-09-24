"use client";

import * as React from "react";
import { ArrowLeft, CalendarDays, Pencil, ShieldCheck, ShoppingBasket } from "lucide-react";
import { closeStoreMonthAction, editStockAction } from "@/app/actions/store";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/shared";
import { useAction } from "@/components/client-shared";
import { stockKey } from "@/lib/calculations";
import { dateLabelMed, monthLabel, shiftMonth } from "@/lib/dates";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StockRow, StoreClosingDTO } from "@/types";

const q = (n: number, unit: string) => (n ? `${formatQty(n)} ${unit}` : "-");

export function StoreView({ month, stock, closings }: { month: string; stock: StockRow[]; closings: StoreClosingDTO[] }) {
  const { run, pending } = useAction();
  const closed = closings.find((c) => c.month === month);
  const [editing, setEditing] = React.useState<StockRow | null>(null);
  const [editQty, setEditQty] = React.useState("");
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [remaining, setRemaining] = React.useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyMonth, setHistoryMonth] = React.useState<string | null>(null);

  function openClose() {
    setRemaining(Object.fromEntries(stock.map((r) => [stockKey(r.item, r.unit), String(Math.max(0, r.available))])));
    setCloseOpen(true);
  }

  const detail = historyMonth ? closings.find((c) => c.month === historyMonth) : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {closed ? <Badge tone="navy">Closed {dateLabelMed(closed.closedAt.slice(0, 10))}</Badge> : null}
        <Button variant="secondary" size="sm" onClick={openClose}>
          <ShieldCheck /> {closed ? "Re-close Month" : "Close Month"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setHistoryMonth(null);
            setHistoryOpen(true);
          }}
        >
          <CalendarDays /> Monthly History
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title={`Current Stock — ${monthLabel(month)}`}
          description="Available = Carry Forward + Purchased. Use the edit icon to correct an item by hand. Only items recorded with a quantity and unit are tracked."
        />
        {stock.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={ShoppingBasket} title="No trackable stock this month" description="Add an expense with a quantity + unit to start tracking stock." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Item</th>
                  <th className="px-5 py-3 text-right">Carry Forward</th>
                  <th className="px-5 py-3 text-right">Purchased</th>
                  <th className="px-5 py-3 text-right">Available</th>
                  <th className="px-5 py-3 text-right">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stock.map((r) => (
                  <tr key={stockKey(r.item, r.unit)} className="border-b border-border last:border-0 hover:bg-gray-100/50">
                    <td className="px-5 py-3 font-medium text-foreground">{r.item}</td>
                    <td className={cn("px-5 py-3 text-right tabular-nums", r.previousCarryForward < 0 ? "text-warning-700" : "text-muted")}>
                      {q(r.previousCarryForward, r.unit)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-success-700">{q(r.purchased, r.unit)}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-navy-900">{q(r.available, r.unit)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit stock for ${r.item}`}
                        onClick={() => {
                          setEditing(r);
                          setEditQty(String(Math.max(0, r.available)));
                        }}
                      >
                        <Pencil />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit Stock Quantity">
        {editing ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const v = parseFloat(editQty);
              const ok = await run(() => editStockAction({ month, item: editing.item, unit: editing.unit, remaining: v }), {
                success: `Stock for ${editing.item} updated.`,
              });
              if (ok) setEditing(null);
            }}
          >
            <p className="text-sm text-muted">
              Currently shows <span className="font-semibold text-foreground">{q(editing.available, editing.unit)}</span> available for{" "}
              <span className="font-semibold text-foreground">{editing.item}</span>. Type the quantity you actually have on hand.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Input type="number" min="0" step="any" className="w-32 text-right" value={editQty} onChange={(e) => setEditQty(e.target.value)} aria-label="Quantity on hand" />
              <span className="text-sm text-muted">{editing.unit}</span>
            </div>
            <div className="mt-5">
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={pending}>
                  Save
                </Button>
              </DialogFooter>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen} title={`Close ${monthLabel(month)}`}>
        <p className="text-sm text-muted">
          Type how much of each item is actually left. That amount carries forward into{" "}
          <span className="font-semibold text-foreground">{monthLabel(shiftMonth(month, 1))}</span> as opening stock — items left at 0 don&apos;t carry
          forward. No expense is changed or deleted.
        </p>
        {stock.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No trackable items this month.</p>
        ) : (
          <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto">
            {stock.map((r) => {
              const k = stockKey(r.item, r.unit);
              return (
                <div key={k} className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{r.item}</p>
                    <p className="text-xs text-muted">Available: {q(r.available, r.unit)}</p>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="w-24 px-2.5 py-1.5 text-right"
                    aria-label={`Remaining ${r.item}`}
                    value={remaining[k] ?? ""}
                    onChange={(e) => setRemaining({ ...remaining, [k]: e.target.value })}
                  />
                  <span className="w-12 shrink-0 text-xs text-muted">{r.unit}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-5">
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                const parsed = Object.fromEntries(
                  Object.entries(remaining)
                    .map(([k, v]) => [k, parseFloat(v)] as const)
                    .filter(([, v]) => Number.isFinite(v)),
                );
                const ok = await run(() => closeStoreMonthAction({ month, remaining: parsed }), {
                  success: `${monthLabel(month)} closed — remaining stock carried forward to ${monthLabel(shiftMonth(month, 1))}.`,
                });
                if (ok) setCloseOpen(false);
              }}
            >
              <ShieldCheck /> Close Month
            </Button>
          </DialogFooter>
        </div>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title="Store History" className="max-w-2xl">
        {detail ? (
          <div>
            <button onClick={() => setHistoryMonth(null)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-navy-900 hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to Store History
            </button>
            <h3 className="text-base font-semibold text-foreground">{monthLabel(detail.month)} Summary</h3>
            <p className="mb-4 text-xs text-muted">Closed on {dateLabelMed(detail.closedAt.slice(0, 10))}</p>
            {detail.rows.length === 0 ? (
              <EmptyState icon={ShoppingBasket} title="No trackable items this month" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[460px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Carry Forward</th>
                      <th className="px-3 py-2 text-right">Purchased</th>
                      <th className="px-4 py-2 text-right">Carried to Next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.rows.map((r) => (
                      <tr key={stockKey(r.item, r.unit)} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 font-medium text-foreground">{r.item}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{q(r.previousCarryForward, r.unit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-success-700">{q(r.purchased, r.unit)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-navy-900">{q(r.remaining, r.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : closings.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No closed months yet" description="Close a month from the Store page to start building history." />
        ) : (
          <div className="max-h-[28rem] space-y-2 overflow-y-auto">
            {closings.map((c) => (
              <button
                key={c.month}
                onClick={() => setHistoryMonth(c.month)}
                className="flex w-full items-center justify-between rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-gray-100"
              >
                <span className="font-medium text-foreground">{monthLabel(c.month)}</span>
                <Badge tone="navy">Closed</Badge>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
