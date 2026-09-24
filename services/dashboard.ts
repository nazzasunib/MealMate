import "server-only";
import { prisma } from "@/lib/prisma";
import { eachDateInMonth, todayKey } from "@/lib/dates";
import { calcAvailableBalance, spendByMember } from "@/lib/calculations";
import { num } from "@/lib/utils";
import { listActiveMembers, listMembers } from "./members";
import { listExpensesForMonth } from "./expenses";
import { getSettlementSummary } from "./settlement";

export interface MemberAmount {
  memberId: string;
  name: string;
  color: string;
  deposited: number;
  spent: number;
}

/** Everything the Dashboard shows for a month, computed server-side. */
export async function getDashboard(ownerId: string, monthKey: string) {
  const [settlement, expenses, members, active] = await Promise.all([
    getSettlementSummary(ownerId, monthKey),
    listExpensesForMonth(ownerId, monthKey),
    listMembers(ownerId),
    listActiveMembers(ownerId),
  ]);

  const spend = spendByMember(expenses);
  const paid = new Map(settlement.members.map((m) => [m.memberId, m.paid]));
  const perMember: MemberAmount[] = members
    .map((m) => ({
      memberId: m.id,
      name: m.name,
      color: m.avatarColor,
      deposited: paid.get(m.id) ?? 0,
      spent: spend.get(m.id) ?? 0,
    }))
    .filter((m) => m.deposited > 0 || m.spent > 0 || active.some((a) => a.id === m.memberId));

  const byCategory = new Map<string, number>();
  const byItem = new Map<string, { item: string; amount: number; count: number }>();
  let itemCount = 0;
  for (const e of expenses) {
    for (const it of e.items) {
      itemCount += 1;
      const cat = it.category || "Uncategorised";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + it.amount);
      const row = byItem.get(it.item) ?? { item: it.item, amount: 0, count: 0 };
      row.amount += it.amount;
      row.count += 1;
      byItem.set(it.item, row);
    }
  }

  // Daily spending for elapsed days of the month.
  const today = todayKey();
  const dailyMap = new Map<string, number>();
  for (const e of expenses) dailyMap.set(e.date, (dailyMap.get(e.date) ?? 0) + e.amount);
  let running = 0;
  const daily = eachDateInMonth(monthKey)
    .filter((d) => d <= today)
    .map((d) => {
      const amount = dailyMap.get(d) ?? 0;
      running += amount;
      return { date: d, day: Number(d.slice(8)), amount, cumulative: running };
    });

  return {
    moneyAdded: settlement.totalPaid,
    mealExpense: settlement.totalBazarCost,
    availableBalance: calcAvailableBalance(settlement.totalPaid, settlement.totalBazarCost),
    totalMeals: settlement.totalMeals,
    mealRate: settlement.mealRate,
    activeMembers: active.length,
    expenseCount: expenses.length,
    itemCount,
    perMember,
    categories: [...byCategory.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    topItems: [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    daily,
  };
}

/** All-time totals and recent transactions (legacy Available Balance page). */
export async function getAllTimeBalance(ownerId: string) {
  const [dep, exp, recentDeposits, recentExpenses] = await Promise.all([
    prisma.deposit.aggregate({ where: { ownerId }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { ownerId }, _sum: { amount: true } }),
    prisma.deposit.findMany({
      where: { ownerId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 20,
      include: { member: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: { ownerId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 20,
      include: { items: { orderBy: { position: "asc" } } },
    }),
  ]);
  const totalMoneyAdded = num(dep._sum.amount);
  const totalMealExpense = num(exp._sum.amount);
  const recent = [
    ...recentDeposits.map((d) => ({
      type: "in" as const,
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      label: d.member.name,
      amount: num(d.amount),
    })),
    ...recentExpenses.map((e) => ({
      type: "out" as const,
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      label: e.items.map((i) => i.item).join(", ") || "Expense",
      amount: num(e.amount),
    })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 20);
  return {
    totalMoneyAdded,
    totalMealExpense,
    availableBalance: calcAvailableBalance(totalMoneyAdded, totalMealExpense),
    recent,
  };
}
