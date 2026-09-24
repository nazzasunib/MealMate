import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDateKey, isMonthKey, monthKeyOf, toDbDate, todayKey } from "@/lib/dates";
import { AVATAR_COLORS, DEFAULT_MEAL_DEFAULTS } from "@/lib/constants";
import { UserError } from "@/lib/action";
import { accountHasData } from "./account";

/**
 * One-time import of the legacy app's localStorage["mealmate_db_v2"] JSON.
 * Schemas are deliberately lenient: old records may miss newer fields.
 */
const day = z.string().refine(isDateKey);
const month = z.string().refine(isMonthKey);
const n = z.coerce.number().finite();

const legacySchema = z.object({
  members: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        avatarColor: z.string().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        joinedAt: z.string().optional(),
        phone: z.string().nullish(),
        email: z.string().nullish(),
        pictureUrl: z.string().nullish(),
        defaultMeals: z.object({ breakfast: z.boolean(), lunch: z.boolean(), dinner: z.boolean() }).partial().nullish(),
      }),
    )
    .default([]),
  meals: z
    .array(z.object({ memberId: z.string(), date: day, breakfast: z.boolean(), lunch: z.boolean(), dinner: z.boolean() }))
    .default([]),
  deposits: z
    .array(
      z.object({
        memberId: z.string(),
        date: day,
        amount: n,
        note: z.string().nullish(),
        carriedFromMonthKey: z.string().nullish(),
      }),
    )
    .default([]),
  expenses: z
    .array(
      z.object({
        date: day,
        note: z.string().nullish(),
        amount: n,
        buyerIds: z.array(z.string()).optional(),
        memberId: z.string().optional(),
        category: z.string().nullish(),
        item: z.string().optional(),
        quantity: n.nullish(),
        unit: z.string().nullish(),
        items: z
          .array(
            z.object({
              category: z.string().nullish(),
              item: z.string(),
              quantity: n.nullish(),
              unit: z.string().nullish(),
              amount: n,
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  shoppingList: z
    .array(z.object({ category: z.string(), item: z.string(), quantity: z.string().nullish(), checked: z.boolean().optional() }))
    .default([]),
  storeCarryForward: z
    .array(z.object({ item: z.string(), unit: z.string().nullish(), monthKey: month, fromMonthKey: z.string(), quantity: n }))
    .default([]),
  storeClosedMonths: z
    .array(z.object({ monthKey: month, closedAt: z.string(), rows: z.array(z.unknown()), totals: z.unknown() }))
    .default([]),
  settlements: z
    .array(
      z
        .object({
          monthKey: month,
          finalizedAt: z.string(),
          totalBazarCost: n,
          totalPaid: n,
          totalMeals: n,
          mealRate: n,
          members: z.array(z.unknown()),
          transfers: z.array(z.unknown()),
        })
        .passthrough(),
    )
    .default([]),
  moneyClosedMonths: z
    .array(z.object({ monthKey: month, decisions: z.array(z.object({ memberId: z.string() }).passthrough()) }))
    .default([]),
});

export interface ImportSummary {
  members: number;
  meals: number;
  deposits: number;
  expenses: number;
  shoppingItems: number;
}

export async function importLegacyData(ownerId: string, raw: string): Promise<ImportSummary> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new UserError("That isn't valid JSON. Paste the full value copied from the legacy app.");
  }
  const parsed = legacySchema.safeParse(json);
  if (!parsed.success) throw new UserError("The data doesn't look like a MealMate backup (mealmate_db_v2).");
  if (await accountHasData(ownerId)) {
    throw new UserError("This account already has data. Use “Reset all data” first, then import.");
  }
  const data = parsed.data;

  return prisma.$transaction(
    async (tx) => {
      const idMap = new Map<string, string>();
      for (const [i, m] of data.members.entries()) {
        const d = { ...DEFAULT_MEAL_DEFAULTS, ...(m.defaultMeals ?? {}) };
        const created = await tx.member.create({
          data: {
            ownerId,
            name: m.name,
            phone: m.phone ?? null,
            email: m.email ?? null,
            pictureUrl: m.pictureUrl ?? null,
            avatarColor: m.avatarColor ?? AVATAR_COLORS[i % AVATAR_COLORS.length],
            status: m.status ?? "ACTIVE",
            defaultBreakfast: d.breakfast ?? DEFAULT_MEAL_DEFAULTS.breakfast,
            defaultLunch: d.lunch ?? DEFAULT_MEAL_DEFAULTS.lunch,
            defaultDinner: d.dinner ?? DEFAULT_MEAL_DEFAULTS.dinner,
            joinedAt: toDbDate(m.joinedAt && isDateKey(m.joinedAt) ? m.joinedAt : todayKey()),
          },
        });
        idMap.set(m.id, created.id);
      }
      const mid = (legacyId: string) => idMap.get(legacyId);

      const meals = data.meals.filter((m) => mid(m.memberId));
      const seen = new Set<string>();
      const mealRows = meals
        .filter((m) => {
          const k = `${m.memberId}|${m.date}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((m) => ({
          ownerId,
          memberId: mid(m.memberId)!,
          date: toDbDate(m.date),
          breakfast: m.breakfast,
          lunch: m.lunch,
          dinner: m.dinner,
        }));
      if (mealRows.length) await tx.mealEntry.createMany({ data: mealRows });

      const depositRows = data.deposits
        .filter((d) => mid(d.memberId) && d.amount > 0)
        .map((d) => ({
          ownerId,
          memberId: mid(d.memberId)!,
          date: toDbDate(d.date),
          amount: d.amount,
          note: d.note ?? null,
          carriedFromMonth: d.carriedFromMonthKey && isMonthKey(d.carriedFromMonthKey) ? d.carriedFromMonthKey : null,
        }));
      if (depositRows.length) await tx.deposit.createMany({ data: depositRows });

      let expenseCount = 0;
      for (const e of data.expenses) {
        const items =
          e.items && e.items.length
            ? e.items
            : e.item
              ? [{ category: e.category ?? null, item: e.item, quantity: e.quantity ?? null, unit: e.unit ?? null, amount: e.amount }]
              : [];
        if (!items.length) continue;
        const buyers = [...new Set((e.buyerIds ?? (e.memberId ? [e.memberId] : [])).map(mid).filter(Boolean))] as string[];
        await tx.expense.create({
          data: {
            ownerId,
            date: toDbDate(e.date),
            month: monthKeyOf(e.date),
            amount: items.reduce((s, it) => s + it.amount, 0),
            note: e.note ?? null,
            items: {
              create: items.map((it, position) => ({
                position,
                category: it.category ?? null,
                item: it.item,
                quantity: it.quantity ?? null,
                unit: it.unit ?? null,
                amount: it.amount,
              })),
            },
            buyers: { create: buyers.map((memberId) => ({ memberId })) },
          },
        });
        expenseCount += 1;
      }

      const shopSeen = new Set<string>();
      const shopRows = data.shoppingList
        .filter((s) => {
          const k = `${s.category}|${s.item}`;
          if (shopSeen.has(k)) return false;
          shopSeen.add(k);
          return true;
        })
        .map((s) => ({ ownerId, category: s.category, item: s.item, quantity: s.quantity || null, completed: !!s.checked }));
      if (shopRows.length) await tx.shoppingListItem.createMany({ data: shopRows });

      const cfSeen = new Set<string>();
      const cfRows = data.storeCarryForward
        .map((c) => ({
          ownerId,
          month: c.monthKey,
          item: c.item,
          unit: c.unit ?? "",
          source: c.fromMonthKey === "manual" ? "manual" : `close:${c.fromMonthKey}`,
          quantity: c.quantity,
        }))
        .filter((c) => {
          const k = `${c.month}|${c.item}|${c.unit}|${c.source}`;
          if (cfSeen.has(k)) return false;
          cfSeen.add(k);
          return true;
        });
      if (cfRows.length) await tx.stockCarryForward.createMany({ data: cfRows });

      for (const c of data.storeClosedMonths) {
        await tx.storeMonthClosing.create({
          data: {
            ownerId,
            month: c.monthKey,
            closedAt: new Date(c.closedAt),
            snapshot: { rows: c.rows, totals: c.totals } as Prisma.InputJsonValue,
          },
        });
      }

      const decisionsByMonth = new Map(data.moneyClosedMonths.map((m) => [m.monthKey, m.decisions]));
      for (const s of data.settlements) {
        const remap = <T extends { memberId?: unknown }>(rows: T[]) =>
          rows.map((r) => ({ ...r, memberId: typeof r.memberId === "string" ? (mid(r.memberId) ?? r.memberId) : r.memberId }));
        await tx.settlementClosing.create({
          data: {
            ownerId,
            month: s.monthKey,
            finalizedAt: new Date(s.finalizedAt),
            snapshot: {
              totalBazarCost: s.totalBazarCost,
              totalPaid: s.totalPaid,
              totalMeals: s.totalMeals,
              mealRate: s.mealRate,
              members: remap(s.members as { memberId?: unknown }[]),
              transfers: s.transfers,
            } as Prisma.InputJsonValue,
            decisions: remap(decisionsByMonth.get(s.monthKey) ?? []) as Prisma.InputJsonValue,
          },
        });
      }

      return {
        members: idMap.size,
        meals: mealRows.length,
        deposits: depositRows.length,
        expenses: expenseCount,
        shoppingItems: shopRows.length,
      };
    },
    { timeout: 60_000 },
  );
}
