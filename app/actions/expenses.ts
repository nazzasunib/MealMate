"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { dateKey, id, monthKey, optionalText } from "@/lib/validation";
import { UNITS } from "@/lib/constants";
import * as expenses from "@/services/expenses";
import { getStockSummary } from "@/services/store";

const itemSchema = z.object({
  category: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((v) => (v ? v : null)),
  item: z.string().trim().min(1, "Each item needs a name.").max(80),
  quantity: z.number().positive().max(1e7).nullable(),
  unit: z.enum(UNITS).nullable(),
  amount: z.number({ message: "Each item needs a valid amount." }).positive("Each item needs a valid amount.").max(1e9),
  manualStockRemaining: z.number().min(0).max(1e7).nullable(),
});

const schema = z.object({
  id: id.optional(),
  date: dateKey,
  note: optionalText(500),
  buyerIds: z.array(id).min(1, "Please select who did it (Done By) before adding the expense."),
  items: z.array(itemSchema).min(1, "Please add at least one item.").max(50),
});

export async function saveExpenseAction(input: z.input<typeof schema>) {
  const res = await runAction(schema, input, async (d, p) => {
    if (d.id) await expenses.updateExpense(p.id, d.id, d);
    else await expenses.createExpense(p.id, d);
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function deleteExpenseAction(expenseId: string) {
  const res = await runAction(id, expenseId, (eid, p) => expenses.deleteExpense(p.id, eid));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Stock on hand for a month — the expense form uses it for "Previous stock finished?". */
export async function getStockForMonthAction(month: string) {
  return runAction(monthKey, month, (m, p) => getStockSummary(p.id, m));
}
