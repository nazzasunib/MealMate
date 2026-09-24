"use client";

import * as React from "react";
import { ClipboardList, Download, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  addShoppingItemAction,
  clearCompletedShoppingAction,
  removeShoppingItemAction,
  removeShoppingItemByNameAction,
  updateShoppingItemAction,
} from "@/app/actions/shopping";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { EmptyState } from "@/components/shared";
import { useAction } from "@/components/client-shared";
import { CATEGORY_NAMES, itemsForCategory, UNITS } from "@/lib/constants";
import { todayKey } from "@/lib/dates";
import { downloadShoppingListPdf } from "@/lib/pdf/shopping-list-pdf";
import { cn } from "@/lib/utils";
import type { ShoppingItemDTO } from "@/types";

function group(items: ShoppingItemDTO[]) {
  const map = new Map<string, ShoppingItemDTO[]>();
  for (const it of items) map.set(it.category, [...(map.get(it.category) ?? []), it]);
  const order = [...CATEGORY_NAMES, ...[...map.keys()].filter((k) => !CATEGORY_NAMES.includes(k))];
  return order.filter((c) => map.get(c)?.length).map((category) => ({ category, rows: map.get(category)! }));
}

export function ShoppingView({ items }: { items: ShoppingItemDTO[] }) {
  const { run, pending } = useAction();
  const [category, setCategory] = React.useState(CATEGORY_NAMES[0]);
  const [search, setSearch] = React.useState("");
  const [custom, setCustom] = React.useState("");
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const onList = new Set(items.map((i) => `${i.category}|${i.item}`));
  const q = search.trim().toLowerCase();
  const catalog = itemsForCategory(category).filter((it) => !q || it.toLowerCase().includes(q));
  const groups = group(items);
  const completedCount = items.filter((i) => i.completed).length;

  async function toggleCatalog(item: string, checked: boolean) {
    const key = `${category}|${item}`;
    setBusyKey(key);
    await run(() => (checked ? addShoppingItemAction({ category, item }) : removeShoppingItemByNameAction({ category, item })));
    setBusyKey(null);
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    const name = custom.trim();
    if (!name) {
      toast.error("Type an item name first.");
      return;
    }
    if (await run(() => addShoppingItemAction({ category, item: name }), { success: `${name} added to ${category}.` })) setCustom("");
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Select a Category</h2>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_NAMES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === category}
              onClick={() => {
                setCategory(c);
                setSearch("");
              }}
              className={cn(
                "rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                c === category ? "bg-navy-900 text-white" : "border border-border bg-surface text-foreground hover:bg-gray-100",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {itemsForCategory(category).length ? (
            <>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search in ${category}`}
                  aria-label={`Search in ${category}`}
                  className="w-full rounded-xl border border-border bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20"
                />
              </div>
              {catalog.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {catalog.map((it) => {
                    const checked = onList.has(`${category}|${it}`);
                    return (
                      <label
                        key={it}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm text-foreground transition-colors",
                          checked ? "border-navy-900 bg-navy-50" : "border-border hover:bg-gray-100/60",
                          busyKey === `${category}|${it}` && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busyKey === `${category}|${it}`}
                          onChange={(e) => toggleCatalog(it, e.target.checked)}
                          className="h-4 w-4 shrink-0 cursor-pointer accent-navy-900"
                        />
                        <span className="min-w-0 flex-1 truncate">{it}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="px-1 py-2 text-sm text-muted">No matching items in {category}.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Type any item below to add it under {category}.</p>
          )}
          <form onSubmit={addCustom} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Others — type an item name" aria-label="Custom item name" />
            <Button type="submit" size="sm" loading={pending && !!custom}>
              <Plus /> Add
            </Button>
          </form>
        </div>
      </Card>

      <Card className="p-5 lg:sticky lg:top-20 lg:self-start">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Today&apos;s Shopping List</h2>
            <p className="text-xs text-muted" suppressHydrationWarning>
              {now
                ? `${now.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })} | ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
                : " "}
            </p>
          </div>
          <div className="flex gap-2">
            {completedCount ? (
              <Button variant="secondary" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 /> Clear done
              </Button>
            ) : null}
            {items.length ? (
              <Button
                size="sm"
                onClick={() =>
                  downloadShoppingListPdf(groups, todayKey())
                    .then(() => toast.success("PDF downloaded."))
                    .catch(() => toast.error("Couldn't generate the PDF. Please try again."))
                }
              >
                <Download /> PDF
              </Button>
            ) : null}
          </div>
        </div>

        {groups.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Your shopping list is empty" description="Pick a category and select items to add them here." />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.category}</h3>
                <div className="space-y-1.5">
                  {g.rows.map((row) => (
                    <ShoppingRow key={row.id} row={row} />
                  ))}
                </div>
              </div>
            ))}
            <p className="text-center text-xs text-muted">
              {items.length} item{items.length === 1 ? "" : "s"} on the list
              {completedCount ? ` · ${completedCount} done` : ""}
            </p>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear completed items?"
        description={`Remove the ${completedCount} checked-off item${completedCount === 1 ? "" : "s"} from the list.`}
        confirmLabel="Clear"
        loading={pending}
        onConfirm={async () => {
          if (await run(() => clearCompletedShoppingAction(), { success: "Completed items cleared." })) setConfirmClear(false);
        }}
      />
    </div>
  );
}

function ShoppingRow({ row }: { row: ShoppingItemDTO }) {
  const { run } = useAction();
  const [qty, setQty] = React.useState(row.quantity ?? "");
  const [completed, setCompleted] = React.useState(row.completed);
  React.useEffect(() => setCompleted(row.completed), [row.completed]);
  React.useEffect(() => setQty(row.quantity ?? ""), [row.quantity]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
      <input
        type="checkbox"
        checked={completed}
        aria-label={`Mark ${row.item} as completed`}
        onChange={async (e) => {
          const v = e.target.checked;
          setCompleted(v);
          if (!(await run(() => updateShoppingItemAction({ id: row.id, completed: v })))) setCompleted(!v);
        }}
        className="h-4 w-4 shrink-0 cursor-pointer accent-navy-900"
      />
      <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", completed ? "text-muted line-through" : "text-foreground")}>{row.item}</span>
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={() => qty !== (row.quantity ?? "") && run(() => updateShoppingItemAction({ id: row.id, quantity: qty }))}
        placeholder="Qty"
        aria-label={`Quantity for ${row.item}`}
        className="w-16 shrink-0 rounded-lg border border-border bg-surface px-2 py-1 text-right text-xs focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20"
      />
      <select
        value={row.unit ?? ""}
        aria-label={`Unit for ${row.item}`}
        onChange={(e) => run(() => updateShoppingItemAction({ id: row.id, unit: (e.target.value || null) as (typeof UNITS)[number] | null }))}
        className="shrink-0 rounded-lg border border-border bg-surface px-1.5 py-1 text-xs focus:border-navy-600 focus:outline-none"
      >
        <option value="">unit</option>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => run(() => removeShoppingItemAction(row.id))}
        aria-label={`Remove ${row.item}`}
        className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger-100 hover:text-danger-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
