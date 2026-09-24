import { Banknote, Gauge, Receipt, TrendingDown, TrendingUp, Users, UtensilsCrossed } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentHourInAppTz, currentMonthKey, greetingForHour, isMonthKey, monthLabel } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { getDashboard } from "@/services/dashboard";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Avatar, EmptyState, MonthSwitcher, StatCard } from "@/components/shared";
import { DailySpendChart, MemberMoneyChart, ShareDonut } from "@/components/charts";
import { QuickActions } from "@/components/dashboard/quick-actions";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = isMonthKey(m) ? m : currentMonthKey();
  const profile = await requireProfile();
  const d = await getDashboard(profile.id, month);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greetingForHour(currentHourInAppTz())}, ${profile.name} 👋`}
        description={`Here's your mess overview for ${monthLabel(month)}.`}
        actions={<MonthSwitcher month={month} basePath="/dashboard" />}
      />
      <QuickActions />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Money Added" value={d.moneyAdded} prefix="৳" icon={TrendingUp} tone="success" href={`/money?month=${month}`} compact />
        <StatCard label="Available Balance" value={d.availableBalance} prefix="৳" icon={Banknote} href="/balance" helper="Click for a breakdown" compact />
        <StatCard label="Grocery Expense" value={d.mealExpense} prefix="৳" icon={TrendingDown} tone="danger" href={`/expenses?month=${month}`} compact />
        <StatCard label="Total Meals" value={d.totalMeals} icon={UtensilsCrossed} tone="gray" href="/meals" compact />
        <StatCard label="Meal Rate" value={d.mealRate} decimals={2} prefix="৳" suffix=" / meal" icon={Gauge} tone="warning" href={`/settlement?month=${month}`} compact />
        <StatCard label="Active Members" value={d.activeMembers} icon={Users} tone="gray" href="/members" compact />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Who Added & Who Spent Money" description={`Deposits vs bazar purchases in ${monthLabel(month)}. Shared purchases are split equally.`} />
          <div className="space-y-4 p-5">
            {d.perMember.length === 0 ? (
              <EmptyState icon={Users} title="No members yet" description="Add members to start tracking money." />
            ) : (
              <>
                <MemberMoneyChart data={d.perMember.map((m) => ({ name: m.name, deposited: m.deposited, spent: m.spent }))} />
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {d.perMember.map((m) => (
                    <li key={m.memberId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={m.name} color={m.color} size="sm" />
                        <span className="truncate font-medium text-foreground">{m.name}</span>
                      </span>
                      <span className="flex shrink-0 gap-4 tabular-nums">
                        <span className="text-success-700">+{formatCurrency(m.deposited)}</span>
                        <span className="text-danger-600">−{formatCurrency(m.spent)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Grocery Expense by Category" description={`${d.expenseCount} purchase${d.expenseCount === 1 ? "" : "s"}, ${d.itemCount} item${d.itemCount === 1 ? "" : "s"}`} />
          <div className="p-5">
            <ShareDonut data={d.categories} centerLabel="Total spent" centerValue={formatCurrency(d.mealExpense)} emptyText="No expenses this month." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Daily Spending" description="Bazar spending per day this month." />
          <div className="p-5">
            {d.mealExpense > 0 ? <DailySpendChart data={d.daily} /> : <EmptyState icon={Receipt} title="No expenses this month" />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Expense Items" description="Top items by amount this month." />
          <div className="p-5">
            {d.topItems.length === 0 ? (
              <EmptyState icon={Receipt} title="Nothing bought yet" />
            ) : (
              <ul className="space-y-2">
                {d.topItems.map((it) => (
                  <li key={it.item} className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">{it.item}</span>
                      <span className="text-xs text-muted">
                        bought {it.count} time{it.count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-danger-600">{formatCurrency(it.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
