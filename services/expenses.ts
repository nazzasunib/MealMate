import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromDbDate, monthDbRange, monthKeyOf, toDbDate } from "@/lib/dates";
import { UserError } from "@/lib/action";
import { num, numOrNull } from "@/lib/utils";
import type { ExpenseDTO } from "@/types";
import { setManualStock } from "./store";

const include = { items: { orderBy: { position: "asc" } }, buyers: true } satisfies Prisma.ExpenseInclude;
type ExpenseWithRelations = Prisma.ExpenseGetPayload<{ include: typeof include }>;

export function toExpenseDTO(e: ExpenseWithRelations): ExpenseDTO {
  return {
    id: e.id,
    date: fromDbDate(e.date),
    amount: num(e.amount),
    note: e.note,
    buyerIds: e.buyers.map((b) => b.memberId),
    items: e.items.map((i) => ({
      category: i.category,
      item: i.item,
      quantity: numOrNull(i.quantity),
      unit: i.unit,
      amount: num(i.amount),
    })),
    createdAt: e.createdAt.toISOString(),
  };
}

/** Expenses in [from, to] (inclusive day keys), newest first, optional item/buyer search. */
export async function listExpensesInRange(ownerId: string, from: string, to: string, search = ""): Promise<ExpenseDTO[]> {
  const q = search.trim();
  const rows = await prisma.expense.findMany({
    where: {
      ownerId,
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(q
        ? {
            OR: [
              { items: { some: { item: { contains: q, mode: "insensitive" } } } },
              { buyers: { some: { member: { name: { contains: q, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toExpenseDTO);
}

export async function listExpensesForMonth(ownerId: string, monthKey: string): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({
    where: { ownerId, date: monthDbRange(monthKey) },
    include,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toExpenseDTO);
}

export async function listAllExpenses(ownerId: string): Promise<ExpenseDTO[]> {
  const rows = await prisma.expense.findMany({ where: { ownerId }, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  return rows.map(toExpenseDTO);
}

export interface ExpenseItemInput {
  category: string | null;
  item: string;
  quantity: number | null;
  unit: string | null;
  amount: number;
  /** Answer to "Previous stock finished?": 0 for Yes, the typed amount for No, null when not asked. */
  manualStockRemaining: number | null;
}
export interface ExpenseInput {
  date: string;
  note: string | null;
  buyerIds: string[];
  items: ExpenseItemInput[];
}

async function validate(ownerId: string, input: ExpenseInput) {
  if (!input.items.length) throw new UserError("Please add at least one item.");
  if (!input.buyerIds.length) throw new UserError("Please select who did it (Done By).");
  const count = await prisma.member.count({ where: { ownerId, id: { in: input.buyerIds } } });
  if (count !== new Set(input.buyerIds).size) throw new UserError("One of the selected members no longer exists.");
}

function itemRows(items: ExpenseItemInput[]) {
  return items.map((it, position) => ({
    position,
    category: it.category,
    item: it.item,
    quantity: it.quantity,
    unit: it.unit,
    amount: it.amount,
  }));
}

async function applyStockCorrections(tx: Prisma.TransactionClient, ownerId: string, input: ExpenseInput) {
  const month = monthKeyOf(input.date);
  for (const it of input.items) {
    if (it.quantity && it.quantity > 0 && it.unit && it.manualStockRemaining !== null) {
      await setManualStock(ownerId, month, it.item, it.unit, it.manualStockRemaining, tx);
    }
  }
}

export async function createExpense(ownerId: string, input: ExpenseInput) {
  await validate(ownerId, input);
  const amount = input.items.reduce((s, i) => s + i.amount, 0);
  return prisma.$transaction(async (tx) => {
    // Corrections are measured against stock BEFORE this purchase (legacy order).
    await applyStockCorrections(tx, ownerId, input);
    return tx.expense.create({
      data: {
        ownerId,
        date: toDbDate(input.date),
        month: monthKeyOf(input.date),
        amount,
        note: input.note,
        items: { create: itemRows(input.items) },
        buyers: { create: [...new Set(input.buyerIds)].map((memberId) => ({ memberId })) },
      },
    });
  });
}

export async function updateExpense(ownerId: string, id: string, input: ExpenseInput) {
  await validate(ownerId, input);
  const existing = await prisma.expense.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!existing) throw new UserError("Expense not found.");
  const amount = input.items.reduce((s, i) => s + i.amount, 0);
  await prisma.$transaction(async (tx) => {
    await applyStockCorrections(tx, ownerId, input);
    await tx.expenseItem.deleteMany({ where: { expenseId: id } });
    await tx.expenseBuyer.deleteMany({ where: { expenseId: id } });
    await tx.expense.update({
      where: { id },
      data: {
        date: toDbDate(input.date),
        month: monthKeyOf(input.date),
        amount,
        note: input.note,
        items: { create: itemRows(input.items) },
        buyers: { create: [...new Set(input.buyerIds)].map((memberId) => ({ memberId })) },
      },
    });
  });
}

export async function deleteExpense(ownerId: string, id: string) {
  const res = await prisma.expense.deleteMany({ where: { id, ownerId } });
  if (!res.count) throw new UserError("Expense not found.");
}

/** "What was bought — all time": count and amount per item name. */
export async function allTimeItemBreakdown(ownerId: string) {
  const rows = await prisma.expenseItem.groupBy({
    by: ["item"],
    where: { expense: { ownerId } },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return rows
    .map((r) => ({ item: r.item, count: r._count._all, amount: num(r._sum.amount) }))
    .sort((a, b) => b.amount - a.amount);
}
