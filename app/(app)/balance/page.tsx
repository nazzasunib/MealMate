import { Banknote, CircleArrowDown, CircleArrowUp, TrendingDown, TrendingUp } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { dateLabelMed } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAllTimeBalance } from "@/services/dashboard";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { EmptyState, StatCard } from "@/components/shared";

export const metadata = { title: "Available Balance" };

export default async function BalancePage() {
  const profile = await requireProfile();
  const b = await getAllTimeBalance(profile.id);

  const row = (label: string, value: number, tone: "success" | "danger" | "navy", sign: string, bold = false) => (
    <div className={cn("flex items-center justify-between rounded-xl px-4 py-3", bold ? "bg-navy-50" : "border border-border")}>
      <span className={cn("text-sm", bold ? "font-semibold text-navy-900" : "text-muted")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "text-lg font-bold" : "font-semibold",
          tone === "success" ? "text-success-700" : tone === "danger" ? "text-danger-600" : "text-navy-900",
        )}
      >
        {sign}
        {formatCurrency(Math.abs(value))}
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Available Balance" description="Total money added minus total meal expense, across all time." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total Money Added" value={b.totalMoneyAdded} prefix="৳" icon={TrendingUp} tone="success" href="/money" compact />
        <StatCard label="Total Meal Expense" value={b.totalMealExpense} prefix="৳" icon={TrendingDown} tone="danger" href="/expenses" compact />
        <StatCard label="Available Balance" value={b.availableBalance} prefix="৳" icon={Banknote} compact />
      </div>
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Balance Breakdown</h3>
        <div className="space-y-3">
          {row("Money Added (Money In)", b.totalMoneyAdded, "success", "+")}
          {row("Meal Expense (Money Out)", b.totalMealExpense, "danger", "−")}
          {row("Available Balance", b.availableBalance, "navy", b.availableBalance < 0 ? "−" : "", true)}
        </div>
      </Card>
      <Card>
        <CardHeader title="Recent Transactions" />
        <div className="p-3 sm:p-5">
          {b.recent.length === 0 ? (
            <EmptyState icon={Banknote} title="No transactions yet" />
          ) : (
            <ul className="space-y-1">
              {b.recent.map((t) => (
                <li key={t.type + t.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      t.type === "in" ? "bg-success-100 text-success-600" : "bg-danger-100 text-danger-600",
                    )}
                  >
                    {t.type === "in" ? <CircleArrowUp className="h-4 w-4" /> : <CircleArrowDown className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{t.label}</span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", t.type === "in" ? "text-success-700" : "text-danger-600")}>
                    {t.type === "in" ? "+" : "−"}
                    {formatCurrency(t.amount)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted sm:block">{dateLabelMed(t.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
