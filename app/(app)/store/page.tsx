import { Receipt, ShoppingBasket, ShoppingCart } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentMonthKey, isMonthKey, monthLabel } from "@/lib/dates";
import { formatCurrency, formatQty } from "@/lib/format";
import { getMonthPurchasesByItem, getMonthSpend, getStockSummary, listStoreClosings } from "@/services/store";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState, MonthSwitcher, StatCard } from "@/components/shared";
import { StoreView } from "@/components/store/store-view";

export const metadata = { title: "Store" };

export default async function StorePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = isMonthKey(m) ? m : currentMonthKey();
  const profile = await requireProfile();
  const [stock, closings, bought, { spent, purchases }] = await Promise.all([
    getStockSummary(profile.id, month),
    listStoreClosings(profile.id),
    getMonthPurchasesByItem(profile.id, month),
    getMonthSpend(profile.id, month),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Store" description="What was bought and what is available this month." actions={<MonthSwitcher month={month} basePath="/store" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total Spent" value={spent} prefix="৳" icon={ShoppingBasket} tone="danger" compact />
        <StatCard label="Items Bought" value={bought.length} icon={Receipt} compact />
        <StatCard label="Purchases" value={purchases} icon={ShoppingCart} tone="gray" compact />
      </div>

      <StoreView month={month} stock={stock} closings={closings} />

      <Card className="overflow-hidden">
        <CardHeader title={`${monthLabel(month)} — What Was Bought`} />
        {bought.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={ShoppingBasket} title="Nothing bought this month" description="Add an expense to start tracking the store for this month." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">Quantity</th>
                  <th className="px-5 py-3 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {bought.map((r) => (
                  <tr key={r.item} className="border-b border-border last:border-0 hover:bg-gray-100/50">
                    <td className="px-5 py-3 font-medium text-foreground">{r.item}</td>
                    <td className="px-5 py-3 text-muted">{r.qty ? `${formatQty(r.qty)}${r.unit ? " " + r.unit : ""}` : "-"}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-navy-50">
                  <td className="px-5 py-3 font-semibold text-navy-900" colSpan={2}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">{formatCurrency(spent)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
