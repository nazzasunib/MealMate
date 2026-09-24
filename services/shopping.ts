import "server-only";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action";
import type { ShoppingItemDTO } from "@/types";

export async function listShoppingItems(ownerId: string): Promise<ShoppingItemDTO[]> {
  const rows = await prisma.shoppingListItem.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    item: r.item,
    quantity: r.quantity,
    unit: r.unit,
    completed: r.completed,
  }));
}

/** Adds an item once per category; re-adding an existing item is a no-op (legacy rule). */
export async function addShoppingItem(ownerId: string, category: string, item: string) {
  await prisma.shoppingListItem.upsert({
    where: { ownerId_category_item: { ownerId, category, item } },
    update: {},
    create: { ownerId, category, item },
  });
}

export async function removeShoppingItemByName(ownerId: string, category: string, item: string) {
  await prisma.shoppingListItem.deleteMany({ where: { ownerId, category, item } });
}

export async function updateShoppingItem(
  ownerId: string,
  id: string,
  data: { quantity?: string | null; unit?: string | null; completed?: boolean },
) {
  const res = await prisma.shoppingListItem.updateMany({ where: { id, ownerId }, data });
  if (!res.count) throw new UserError("Item not found.");
}

export async function removeShoppingItem(ownerId: string, id: string) {
  await prisma.shoppingListItem.deleteMany({ where: { id, ownerId } });
}

export async function clearCompletedShoppingItems(ownerId: string) {
  const res = await prisma.shoppingListItem.deleteMany({ where: { ownerId, completed: true } });
  return res.count;
}
