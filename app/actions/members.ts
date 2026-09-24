"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { id, optionalText, pictureUrl } from "@/lib/validation";
import { MEAL_TYPES } from "@/lib/constants";
import * as members from "@/services/members";

const memberSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
  phone: optionalText(30),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Please enter a valid email.")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  pictureUrl,
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  defaultMeals: z.object({ breakfast: z.boolean(), lunch: z.boolean(), dinner: z.boolean() }),
});

export async function saveMemberAction(input: z.input<typeof memberSchema>) {
  const res = await runAction(memberSchema, input, async (data, profile) => {
    if (data.id) await members.updateMember(profile.id, data.id, data);
    else await members.createMember(profile.id, data);
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function toggleMemberStatusAction(memberId: string) {
  const res = await runAction(id, memberId, async (mid, profile) => {
    await members.toggleMemberStatus(profile.id, mid);
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

const defaultSchema = z.object({ memberId: id, type: z.enum(MEAL_TYPES), value: z.boolean() });
export async function setMemberDefaultMealAction(input: z.input<typeof defaultSchema>) {
  const res = await runAction(defaultSchema, input, async (d, profile) => {
    await members.setMemberDefaultMeal(profile.id, d.memberId, d.type, d.value);
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
