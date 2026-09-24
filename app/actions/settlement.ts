"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { monthKey } from "@/lib/validation";
import { closeSettlementMonth } from "@/services/settlement";

const schema = z.object({ month: monthKey, choices: z.record(z.string(), z.enum(["paid", "carry"])) });

export async function closeSettlementMonthAction(input: z.input<typeof schema>) {
  const res = await runAction(schema, input, (d, p) => closeSettlementMonth(p.id, d.month, d.choices));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
