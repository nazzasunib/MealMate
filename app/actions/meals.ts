"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { dateKey, id } from "@/lib/validation";
import { MEAL_TYPES } from "@/lib/constants";
import * as meals from "@/services/meals";

const setSchema = z.object({ memberId: id, date: dateKey, type: z.enum(MEAL_TYPES), value: z.boolean() });
export async function setMealAction(input: z.input<typeof setSchema>) {
  const res = await runAction(setSchema, input, (d, p) => meals.setMeal(p.id, d.memberId, d.date, d.type, d.value));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

const allSchema = z.object({ date: dateKey, type: z.enum(MEAL_TYPES), value: z.boolean() });
export async function setMealAllAction(input: z.input<typeof allSchema>) {
  const res = await runAction(allSchema, input, (d, p) => meals.setMealForAllActive(p.id, d.date, d.type, d.value));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
