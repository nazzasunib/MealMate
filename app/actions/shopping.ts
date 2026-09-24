"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { id } from "@/lib/validation";
import { UNITS } from "@/lib/constants";
import * as shopping from "@/services/shopping";

const nameSchema = z.object({
  category: z.string().trim().min(1).max(60),
  item: z.string().trim().min(1, "Type an item name first.").max(80),
});

function done<T>(res: T): T {
  revalidatePath("/shopping-list");
  return res;
}

export async function addShoppingItemAction(input: z.input<typeof nameSchema>) {
  return done(await runAction(nameSchema, input, (d, p) => shopping.addShoppingItem(p.id, d.category, d.item)));
}

export async function removeShoppingItemByNameAction(input: z.input<typeof nameSchema>) {
  return done(await runAction(nameSchema, input, (d, p) => shopping.removeShoppingItemByName(p.id, d.category, d.item)));
}

const updateSchema = z.object({
  id,
  quantity: z.string().trim().max(30).nullable().optional(),
  unit: z.enum(UNITS).nullable().optional(),
  completed: z.boolean().optional(),
});

export async function updateShoppingItemAction(input: z.input<typeof updateSchema>) {
  return done(
    await runAction(updateSchema, input, ({ id: itemId, quantity, ...rest }, p) =>
      shopping.updateShoppingItem(p.id, itemId, {
        ...rest,
        ...(quantity === undefined ? {} : { quantity: quantity || null }),
      }),
    ),
  );
}

export async function removeShoppingItemAction(itemId: string) {
  return done(await runAction(id, itemId, (i, p) => shopping.removeShoppingItem(p.id, i)));
}

export async function clearCompletedShoppingAction() {
  return done(await runAction(z.undefined(), undefined, (_d, p) => shopping.clearCompletedShoppingItems(p.id)));
}
