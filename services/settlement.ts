import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { monthDbRange, monthLabel, shiftMonth, toDbDate } from "@/lib/dates";
import { calcMealRate, computeSettlementRows, computeSettlementTransfers } from "@/lib/calculations";
import { num } from "@/lib/utils";
import type { CarryChoice, SettlementClosingDTO, SettlementSummary } from "@/types";
import { getMonthMeals } from "./meals";

/**
 * Month settlement (legacy computeHisabSummary): bazar cost = month expenses,
 * paid = month deposits per member, meals from getMonthMeals (active members,
 * elapsed days), meal rate = cost / meals, balance = paid - meals * rate.
 */
export async function getSettlementSummary(ownerId: string, monthKey: string): Promise<SettlementSummary> {
  const range = monthDbRange(monthKey);
  const [meals, expenseAgg, depositsByMember] = await Promise.all([
    getMonthMeals(ownerId, monthKey),
    prisma.expense.aggregate({ where: { ownerId, date: range }, _sum: { amount: true } }),
    prisma.deposit.groupBy({ by: ["memberId"], where: { ownerId, date: range }, _sum: { amount: true } }),
  ]);
  const paidBy = new Map(depositsByMember.map((d) => [d.memberId, num(d._sum.amount)]));
  const totalBazarCost = num(expenseAgg._sum.amount);
  const totalPaid = [...paidBy.values()].reduce((a, b) => a + b, 0);
  const totalMeals = meals.reduce((s, m) => s + m.total, 0);
  const mealRate = calcMealRate(totalBazarCost, totalMeals);
  const members = computeSettlementRows(
    meals.map(({ member, total }) => ({
      memberId: member.id,
      name: member.name,
      avatarColor: member.avatarColor,
      pictureUrl: member.pictureUrl,
      paid: paidBy.get(member.id) ?? 0,
      meals: total,
    })),
    mealRate,
  );
  return {
    month: monthKey,
    totalBazarCost,
    totalPaid,
    totalMeals,
    mealRate,
    memberCount: members.length,
    members,
    transfers: computeSettlementTransfers(members),
  };
}

export async function getSettlementClosing(ownerId: string, monthKey: string): Promise<SettlementClosingDTO | null> {
  const c = await prisma.settlementClosing.findUnique({ where: { ownerId_month: { ownerId, month: monthKey } } });
  if (!c) return null;
  return {
    month: c.month,
    finalizedAt: c.finalizedAt.toISOString(),
    decisions: c.decisions as unknown as SettlementClosingDTO["decisions"],
  };
}

/**
 * Finalises a month (legacy closeMonth + closeMoneyMonth, done together):
 *  - snapshots the settlement numbers,
 *  - for each member with a positive balance applies the chosen decision:
 *    "paid" -> nothing carried; "carry" -> a Deposit dated the 1st of next
 *    month, marked carriedFromMonth so re-closing replaces (never duplicates) it.
 * No existing history is deleted.
 */
export async function closeSettlementMonth(ownerId: string, monthKey: string, choices: Record<string, CarryChoice>) {
  const summary = await getSettlementSummary(ownerId, monthKey);
  const nextFirstDay = toDbDate(`${shiftMonth(monthKey, 1)}-01`);
  const decisions = summary.members
    .filter((r) => r.balance > 0.01)
    .map((r) => ({
      memberId: r.memberId,
      name: r.name,
      balance: r.balance,
      choice: (choices[r.memberId] === "carry" ? "carry" : "paid") as CarryChoice,
    }));
  const snapshot = {
    totalBazarCost: summary.totalBazarCost,
    totalPaid: summary.totalPaid,
    totalMeals: summary.totalMeals,
    mealRate: summary.mealRate,
    members: summary.members.map(({ memberId, name, paid, meals, mealCost, balance }) => ({
      memberId,
      name,
      paid,
      meals,
      mealCost,
      balance,
    })),
    transfers: summary.transfers,
  };

  await prisma.$transaction(async (tx) => {
    await tx.deposit.deleteMany({ where: { ownerId, carriedFromMonth: monthKey } });
    const carry = decisions.filter((d) => d.choice === "carry");
    if (carry.length) {
      await tx.deposit.createMany({
        data: carry.map((d) => ({
          ownerId,
          memberId: d.memberId,
          date: nextFirstDay,
          amount: Math.round(d.balance * 100) / 100,
          note: `Carried forward from ${monthLabel(monthKey)}`,
          carriedFromMonth: monthKey,
        })),
      });
    }
    await tx.settlementClosing.upsert({
      where: { ownerId_month: { ownerId, month: monthKey } },
      update: {
        finalizedAt: new Date(),
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        decisions: decisions as unknown as Prisma.InputJsonValue,
      },
      create: {
        ownerId,
        month: monthKey,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        decisions: decisions as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
