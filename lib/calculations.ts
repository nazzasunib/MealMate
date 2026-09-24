/**
 * Pure business calculations — no database, no React. Ported from the legacy
 * index.html so results stay identical. Covered by lib/calculations.test.ts.
 */
import type { MealDefaults, SettlementMemberRow, StockRow, Transfer } from "@/types";

/* ---------------------------------- meals --------------------------------- */

export function mealsInDay(m: MealDefaults): number {
  return (m.breakfast ? 1 : 0) + (m.lunch ? 1 : 0) + (m.dinner ? 1 : 0);
}

/** A saved override wins; otherwise the member's defaults apply (legacy mealFor()). */
export function resolveMeal(defaults: MealDefaults, override?: MealDefaults | null): MealDefaults {
  if (override) return { breakfast: override.breakfast, lunch: override.lunch, dinner: override.dinner };
  return { ...defaults };
}

/**
 * Total meals for one member across `dates`. `overrides` is keyed by day key.
 */
export function countMemberMeals(
  defaults: MealDefaults,
  overrides: ReadonlyMap<string, MealDefaults>,
  dates: readonly string[],
): number {
  let total = 0;
  for (const d of dates) total += mealsInDay(resolveMeal(defaults, overrides.get(d)));
  return total;
}

/* -------------------------------- money ----------------------------------- */

/** Meal rate = total meal (bazar) expense / total meals; 0 when there are no meals. */
export function calcMealRate(totalExpense: number, totalMeals: number): number {
  return totalMeals > 0 ? totalExpense / totalMeals : 0;
}

export function calcAvailableBalance(totalMoneyAdded: number, totalMealExpense: number): number {
  return totalMoneyAdded - totalMealExpense;
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/* ------------------------------ settlement -------------------------------- */

export interface SettlementInput {
  memberId: string;
  name: string;
  avatarColor: string;
  pictureUrl: string | null;
  paid: number;
  meals: number;
}

/** Adds mealCost and balance (paid - meals * rate) to each member row. */
export function computeSettlementRows(rows: readonly SettlementInput[], mealRate: number): SettlementMemberRow[] {
  return rows.map((r) => {
    const mealCost = r.meals * mealRate;
    return { ...r, mealCost, balance: r.paid - mealCost };
  });
}

/**
 * Greedy minimal-transfer settlement: repeatedly match the largest debtor with
 * the largest creditor for min(|debt|, credit). Identical to the legacy logic.
 */
export function computeSettlementTransfers(
  rows: ReadonlyArray<{ name: string; balance: number }>,
): Transfer[] {
  const EPS = 0.01;
  const debtors = rows.filter((r) => r.balance < -EPS).map((r) => ({ name: r.name, amount: -r.balance }));
  const creditors = rows.filter((r) => r.balance > EPS).map((r) => ({ name: r.name, amount: r.balance }));
  const transfers: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > EPS) transfers.push({ from: debtor.name, to: creditor.name, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= EPS) debtors.shift();
    if (creditor.amount <= EPS) creditors.shift();
  }
  return transfers;
}

export type BalanceStatus = "receive" | "pay" | "settled";
export function balanceStatus(balance: number): BalanceStatus {
  if (balance > 0.01) return "receive";
  if (balance < -0.01) return "pay";
  return "settled";
}

/* --------------------------------- store ---------------------------------- */

/** Stock is keyed by (item, unit) so the same item in two units never sums together. */
export function stockKey(item: string, unit: string | null | undefined): string {
  return `${item}\u0000${unit ?? ""}`;
}

export interface StockPurchase {
  item: string;
  unit: string;
  quantity: number;
  amount: number;
}
export interface StockCarryIn {
  item: string;
  unit: string;
  quantity: number;
}

/**
 * Available = Previous Carry Forward + Purchased, per (item, unit).
 * Carry-ins with the same key are summed (a Close-Month row plus any manual
 * correction deltas), exactly like the legacy storeCarryForwardInto().
 */
export function computeStockRows(purchases: readonly StockPurchase[], carryIns: readonly StockCarryIn[]): StockRow[] {
  const rows = new Map<string, StockRow>();
  const ensure = (item: string, unit: string) => {
    const key = stockKey(item, unit);
    let row = rows.get(key);
    if (!row) {
      row = { item, unit, purchased: 0, purchaseAmount: 0, previousCarryForward: 0, available: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const p of purchases) {
    const row = ensure(p.item, p.unit);
    row.purchased += p.quantity;
    row.purchaseAmount += p.amount;
  }
  for (const c of carryIns) ensure(c.item, c.unit).previousCarryForward += c.quantity;
  return [...rows.values()]
    .map((r) => ({ ...r, available: r.purchased + r.previousCarryForward }))
    .sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}

/** Case-insensitive lookup of existing positive stock for an (item, unit). */
export function findStockRow(rows: readonly StockRow[], item: string, unit: string): StockRow | null {
  const i = item.trim().toLowerCase();
  const u = unit.trim().toLowerCase();
  const row = rows.find((r) => r.item.trim().toLowerCase() === i && r.unit.trim().toLowerCase() === u);
  return row && row.available > 0 ? row : null;
}

/* -------------------------------- expenses -------------------------------- */

/** Splits each expense equally among its buyers ("who spent money"). */
export function spendByMember(
  expenses: ReadonlyArray<{ amount: number; buyerIds: readonly string[] }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of expenses) {
    if (!e.buyerIds.length) continue;
    const share = e.amount / e.buyerIds.length;
    for (const id of e.buyerIds) out.set(id, (out.get(id) ?? 0) + share);
  }
  return out;
}
