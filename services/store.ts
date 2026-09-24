import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shiftMonth } from "@/lib/dates";
import { computeStockRows, findStockRow, stockKey, type StockCarryIn, type StockPurchase } from "@/lib/calculations";
import { num } from "@/lib/utils";
import type { StockRow, StoreClosedRow, StoreClosingDTO } from "@/types";

type Db = Prisma.TransactionClient | typeof prisma;

export const MANUAL_SOURCE = "manual";
const closeSource = (fromMonth: string) => `close:${fromMonth}`;

/** Expense items with both a positive quantity and a unit are stock-tracked. */
async function purchasesForMonth(db: Db, ownerId: string, monthKey: string): Promise<StockPurchase[]> {
  const items = await db.expenseItem.findMany({
    where: { expense: { ownerId, month: monthKey }, quantity: { gt: 0 }, unit: { not: null } },
    select: { item: true, unit: true, quantity: true, amount: true },
  });
  return items
    .filter((i) => i.unit)
    .map((i) => ({ item: i.item, unit: i.unit as string, quantity: num(i.quantity), amount: num(i.amount) }));
}

async function carryInsForMonth(
  db: Db,
  ownerId: string,
  monthKey: string,
  exclude?: { item: string; unit: string; source: string },
): Promise<StockCarryIn[]> {
  const rows = await db.stockCarryForward.findMany({ where: { ownerId, month: monthKey } });
  return rows
    .filter((r) => !(exclude && r.item === exclude.item && r.unit === exclude.unit && r.source === exclude.source))
    .map((r) => ({ item: r.item, unit: r.unit, quantity: num(r.quantity) }));
}

/** Carry Forward + Purchased = Available, per (item, unit), for a month. */
export async function getStockSummary(ownerId: string, monthKey: string, db: Db = prisma): Promise<StockRow[]> {
  const [purchases, carryIns] = await Promise.all([
    purchasesForMonth(db, ownerId, monthKey),
    carryInsForMonth(db, ownerId, monthKey),
  ]);
  return computeStockRows(purchases, carryIns);
}

/**
 * Records what the user says is ACTUALLY left of an item this month (legacy
 * recordManualStockCarryForward). Stored as one "manual" delta row per
 * (item, unit, month): delta = remaining - available-without-this-manual-row.
 * Recomputing the baseline each time keeps repeated edits idempotent.
 */
export async function setManualStock(
  ownerId: string,
  monthKey: string,
  item: string,
  unit: string,
  remaining: number,
  db: Db = prisma,
) {
  const exclude = { item, unit, source: MANUAL_SOURCE };
  const [purchases, carryIns] = await Promise.all([
    purchasesForMonth(db, ownerId, monthKey),
    carryInsForMonth(db, ownerId, monthKey, exclude),
  ]);
  const baseline = findStockRow(computeStockRows(purchases, carryIns), item, unit);
  const delta = remaining - (baseline ? baseline.available : 0);

  await db.stockCarryForward.deleteMany({ where: { ownerId, month: monthKey, item, unit, source: MANUAL_SOURCE } });
  if (delta !== 0) {
    await db.stockCarryForward.create({
      data: { ownerId, month: monthKey, item, unit, source: MANUAL_SOURCE, quantity: delta },
    });
  }
}

/**
 * Closes a Store month using the remaining quantities the user typed
 * (keyed by stockKey). Missing/invalid entries fall back to Available.
 * Writes a history snapshot and replaces this month's carry-forward rows into
 * next month. Never deletes or edits any expense.
 */
export async function closeStoreMonth(ownerId: string, monthKey: string, remainingByKey: Record<string, number>) {
  const next = shiftMonth(monthKey, 1);
  return prisma.$transaction(async (tx) => {
    const stock = await getStockSummary(ownerId, monthKey, tx);
    const rows: StoreClosedRow[] = stock.map((r) => {
      const typed = remainingByKey[stockKey(r.item, r.unit)];
      const remaining = typeof typed === "number" && Number.isFinite(typed) ? Math.max(0, typed) : r.available;
      return {
        item: r.item,
        unit: r.unit,
        purchased: r.purchased,
        previousCarryForward: r.previousCarryForward,
        available: r.available,
        remaining,
      };
    });
    const totals = rows.reduce(
      (acc, r) => ({
        purchased: acc.purchased + r.purchased,
        previousCarryForward: acc.previousCarryForward + r.previousCarryForward,
        available: acc.available + r.available,
        remaining: acc.remaining + r.remaining,
      }),
      { purchased: 0, previousCarryForward: 0, available: 0, remaining: 0 },
    );
    const snapshot = { rows, totals } as unknown as Prisma.InputJsonValue;

    await tx.storeMonthClosing.upsert({
      where: { ownerId_month: { ownerId, month: monthKey } },
      update: { snapshot, closedAt: new Date() },
      create: { ownerId, month: monthKey, snapshot },
    });
    await tx.stockCarryForward.deleteMany({ where: { ownerId, month: next, source: closeSource(monthKey) } });
    const carry = rows.filter((r) => r.remaining > 0);
    if (carry.length) {
      await tx.stockCarryForward.createMany({
        data: carry.map((r) => ({
          ownerId,
          month: next,
          item: r.item,
          unit: r.unit,
          source: closeSource(monthKey),
          quantity: r.remaining,
        })),
      });
    }
    return { carried: carry.length, next };
  });
}

function toClosingDTO(c: { month: string; closedAt: Date; snapshot: Prisma.JsonValue }): StoreClosingDTO {
  const s = c.snapshot as unknown as Pick<StoreClosingDTO, "rows" | "totals">;
  return { month: c.month, closedAt: c.closedAt.toISOString(), rows: s.rows ?? [], totals: s.totals };
}

export async function listStoreClosings(ownerId: string): Promise<StoreClosingDTO[]> {
  const rows = await prisma.storeMonthClosing.findMany({ where: { ownerId }, orderBy: { month: "desc" } });
  return rows.map(toClosingDTO);
}

export async function getMonthSpend(ownerId: string, monthKey: string) {
  const agg = await prisma.expense.aggregate({ where: { ownerId, month: monthKey }, _sum: { amount: true }, _count: true });
  return { spent: num(agg._sum.amount), purchases: agg._count };
}

/** Plain "what was bought" list for a month, grouped by item name (legacy Store table). */
export async function getMonthPurchasesByItem(ownerId: string, monthKey: string) {
  const items = await prisma.expenseItem.findMany({
    where: { expense: { ownerId, month: monthKey } },
    select: { item: true, quantity: true, unit: true, amount: true },
  });
  const totals = new Map<string, { item: string; amount: number; qty: number; unit: string }>();
  for (const it of items) {
    let row = totals.get(it.item);
    if (!row) totals.set(it.item, (row = { item: it.item, amount: 0, qty: 0, unit: it.unit ?? "" }));
    row.amount += num(it.amount);
    const q = num(it.quantity);
    if (q && (!row.unit || row.unit === it.unit)) {
      row.qty += q;
      row.unit = it.unit ?? row.unit;
    }
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}
