import "server-only";
import { prisma } from "@/lib/prisma";
import { fromDbDate, monthDbRange } from "@/lib/dates";
import { calcAvailableBalance, mealsInDay } from "@/lib/calculations";
import { num } from "@/lib/utils";
import { getSettlementSummary } from "./settlement";
import { getMonthMeals } from "./meals";
import { listExpensesForMonth } from "./expenses";
import { listMembers } from "./members";

export interface SummaryReport {
  month: string;
  settlement: Awaited<ReturnType<typeof getSettlementSummary>>;
  availableBalance: number;
  daily: Record<string, { date: string; breakfast: boolean; lunch: boolean; dinner: boolean; total: number }[]>;
  expenses: { id: string; date: string; items: string; buyers: string; amount: number }[];
  deposits: { id: string; date: string; member: string; amount: number; note: string | null }[];
}

/** Everything the printable monthly Summary report needs, in one serialisable object. */
export async function getSummaryReport(ownerId: string, month: string): Promise<SummaryReport> {
  const [settlement, meals, expenses, deposits, members] = await Promise.all([
    getSettlementSummary(ownerId, month),
    getMonthMeals(ownerId, month),
    listExpensesForMonth(ownerId, month),
    prisma.deposit.findMany({
      where: { ownerId, date: monthDbRange(month) },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { member: { select: { name: true } } },
    }),
    listMembers(ownerId),
  ]);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const daily: SummaryReport["daily"] = {};
  for (const m of meals) {
    daily[m.member.id] = m.days.map((d) => ({ date: d.date, breakfast: d.breakfast, lunch: d.lunch, dinner: d.dinner, total: mealsInDay(d) }));
  }
  return {
    month,
    settlement,
    availableBalance: calcAvailableBalance(settlement.totalPaid, settlement.totalBazarCost),
    daily,
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      amount: e.amount,
      items: e.items
        .map((it) => it.item + (it.quantity ? ` (${it.quantity}${it.unit ? " " + it.unit : ""})` : ""))
        .join(", "),
      buyers: e.buyerIds.map((id) => nameOf.get(id)).filter(Boolean).join(", ") || "Unknown",
    })),
    deposits: deposits.map((d) => ({ id: d.id, date: fromDbDate(d.date), member: d.member.name, amount: num(d.amount), note: d.note })),
  };
}
