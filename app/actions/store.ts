"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { monthKey } from "@/lib/validation";
import * as store from "@/services/store";

const editSchema = z.object({
  month: monthKey,
  item: z.string().min(1).max(80),
  unit: z.string().min(1).max(20),
  remaining: z.number({ message: "Please enter a valid quantity." }).min(0, "Please enter a valid quantity.").max(1e7),
});

export async function editStockAction(input: z.input<typeof editSchema>) {
  const res = await runAction(editSchema, input, (d, p) => store.setManualStock(p.id, d.month, d.item, d.unit, d.remaining));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

const closeSchema = z.object({ month: monthKey, remaining: z.record(z.string(), z.number()) });

export async function closeStoreMonthAction(input: z.input<typeof closeSchema>) {
  const res = await runAction(closeSchema, input, (d, p) => store.closeStoreMonth(p.id, d.month, d.remaining));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
