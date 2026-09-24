"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { dateKey, id, money, optionalText } from "@/lib/validation";
import * as deposits from "@/services/deposits";

const schema = z.object({
  id: id.optional(),
  memberId: z.string().min(1, "Please select a member."),
  date: dateKey,
  amount: money,
  note: optionalText(300),
});

export async function saveDepositAction(input: z.input<typeof schema>) {
  const res = await runAction(schema, input, async (d, p) => {
    if (d.id) await deposits.updateDeposit(p.id, d.id, d);
    else await deposits.createDeposit(p.id, d);
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function deleteDepositAction(depositId: string) {
  const res = await runAction(id, depositId, (did, p) => deposits.deleteDeposit(p.id, did));
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
