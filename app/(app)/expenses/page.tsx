import { Receipt, ShoppingCart, TrendingDown, Users } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentMonthKey, dateLabelMed, isDateKey, isMonthKey, monthEndKey, monthStartKey, todayKey } from "@/lib/dates";
import { allTimeItemBreakdown, listExpensesInRange } from "@/services/expenses";
import { listMembers } from "@/services/members";
import { PageHeader } from "@/components/ui/card";
import { StatCard } from "@/components/shared";
import { ExpensesView } from "@/components/expenses/expenses-view";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : currentMonthKey();
  // Default range: the 1st of the month through its end, capped at today (legacy rule).
  const today = todayKey();
  const defaultFrom = monthStartKey(month);
  const defaultTo = monthEndKey(month) < today ? monthEndKey(month) : today;
  const from = isDateKey(sp.from) ? sp.from : defaultFrom;
  const to = isDateKey(sp.to) ? sp.to : defaultTo;
  const q = sp.q ?? "";

  const profile = await requireProfile();
  const [expenses, members, breakdown] = await Promise.all([
    listExpensesInRange(profile.id, from, to, q),
    listMembers(profile.id),
    allTimeItemBreakdown(profile.id),
  ]);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const people = new Set(expenses.flatMap((e) => e.buyerIds)).size;

  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" description={from === to ? dateLabelMed(from) : `${dateLabelMed(from)} – ${dateLabelMed(to)}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Grocery Expense" value={total} prefix="৳" icon={ShoppingCart} tone="danger" compact />
        <StatCard label="Expenses" value={expenses.length} icon={Receipt} compact />
        <StatCard label="Average Expense" value={expenses.length ? total / expenses.length : 0} prefix="৳" icon={TrendingDown} tone="gray" compact />
        <StatCard label="People Involved" value={people} icon={Users} tone="warning" compact />
      </div>
      <ExpensesView
        month={month}
        from={from}
        to={to}
        isCustomRange={from !== defaultFrom || to !== defaultTo}
        expenses={expenses}
        members={members}
        breakdown={breakdown}
        search={q}
      />
    </div>
  );
}
