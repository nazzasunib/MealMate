import "server-only";
import { prisma } from "@/lib/prisma";
import { elapsedDatesInMonth, fromDbDate, monthDbRange, toDbDate } from "@/lib/dates";
import { mealsInDay, resolveMeal } from "@/lib/calculations";
import { UserError } from "@/lib/action";
import type { MealType } from "@/lib/constants";
import type { MealDefaults, MealDay, MemberDTO } from "@/types";
import { listActiveMembers } from "./members";

/** Saved overrides for the given members in a month, as memberId -> (date -> meals). */
export async function loadMonthOverrides(ownerId: string, monthKey: string) {
  const rows = await prisma.mealEntry.findMany({
    where: { ownerId, date: monthDbRange(monthKey) },
    select: { memberId: true, date: true, breakfast: true, lunch: true, dinner: true },
  });
  const map = new Map<string, Map<string, MealDefaults>>();
  for (const r of rows) {
    let inner = map.get(r.memberId);
    if (!inner) map.set(r.memberId, (inner = new Map()));
    inner.set(fromDbDate(r.date), { breakfast: r.breakfast, lunch: r.lunch, dinner: r.dinner });
  }
  return map;
}

export interface MemberMonthMeals {
  member: MemberDTO;
  days: MealDay[];
  total: number;
}

/**
 * Resolved meals for every ACTIVE member for each elapsed day of the month.
 * (Legacy rule: only active members, only days up to today.)
 */
export async function getMonthMeals(ownerId: string, monthKey: string): Promise<MemberMonthMeals[]> {
  const [members, overrides] = await Promise.all([listActiveMembers(ownerId), loadMonthOverrides(ownerId, monthKey)]);
  const dates = elapsedDatesInMonth(monthKey);
  return members.map((member) => {
    const own = overrides.get(member.id) ?? new Map<string, MealDefaults>();
    let total = 0;
    const days = dates.map((date) => {
      const override = own.get(date);
      const meal = resolveMeal(member.defaultMeals, override);
      total += mealsInDay(meal);
      return { date, ...meal, overridden: Boolean(override) };
    });
    return { member, days, total };
  });
}

/** One day's resolved meals for each active member. */
export async function getDayMeals(ownerId: string, dateKey: string) {
  const [members, rows] = await Promise.all([
    listActiveMembers(ownerId),
    prisma.mealEntry.findMany({ where: { ownerId, date: toDbDate(dateKey) } }),
  ]);
  const byMember = new Map(rows.map((r) => [r.memberId, r]));
  return members.map((member) => {
    const r = byMember.get(member.id);
    return { member, meal: resolveMeal(member.defaultMeals, r) };
  });
}

/**
 * Sets one meal for one member-day. The first manual change materialises a
 * row pre-filled with the member's defaults (legacy setMealValue()).
 */
export async function setMeal(ownerId: string, memberId: string, dateKey: string, type: MealType, value: boolean) {
  const member = await prisma.member.findFirst({ where: { id: memberId, ownerId } });
  if (!member) throw new UserError("Member not found.");
  const date = toDbDate(dateKey);
  await prisma.mealEntry.upsert({
    where: { memberId_date: { memberId, date } },
    update: { [type]: value },
    create: {
      ownerId,
      memberId,
      date,
      breakfast: member.defaultBreakfast,
      lunch: member.defaultLunch,
      dinner: member.defaultDinner,
      [type]: value,
    },
  });
}

export async function setMealForAllActive(ownerId: string, dateKey: string, type: MealType, value: boolean) {
  const members = await prisma.member.findMany({ where: { ownerId, status: "ACTIVE" } });
  const date = toDbDate(dateKey);
  await prisma.$transaction(
    members.map((member) =>
      prisma.mealEntry.upsert({
        where: { memberId_date: { memberId: member.id, date } },
        update: { [type]: value },
        create: {
          ownerId,
          memberId: member.id,
          date,
          breakfast: member.defaultBreakfast,
          lunch: member.defaultLunch,
          dinner: member.defaultDinner,
          [type]: value,
        },
      }),
    ),
  );
}
