import "server-only";
import { prisma } from "@/lib/prisma";

export async function updateProfile(ownerId: string, data: { name: string; avatarUrl: string | null }) {
  return prisma.profile.update({ where: { id: ownerId }, data });
}

/**
 * Deletes every MealMate record owned by this account (legacy "Reset all
 * data"). The login and profile are kept. Deleting members cascades to their
 * meals and deposits; the rest is removed explicitly.
 */
export async function resetAccountData(ownerId: string) {
  await prisma.$transaction([
    prisma.expense.deleteMany({ where: { ownerId } }),
    prisma.shoppingListItem.deleteMany({ where: { ownerId } }),
    prisma.stockCarryForward.deleteMany({ where: { ownerId } }),
    prisma.storeMonthClosing.deleteMany({ where: { ownerId } }),
    prisma.settlementClosing.deleteMany({ where: { ownerId } }),
    prisma.mealEntry.deleteMany({ where: { ownerId } }),
    prisma.deposit.deleteMany({ where: { ownerId } }),
    prisma.member.deleteMany({ where: { ownerId } }),
  ]);
}

export async function accountHasData(ownerId: string) {
  const [members, expenses, deposits] = await Promise.all([
    prisma.member.count({ where: { ownerId } }),
    prisma.expense.count({ where: { ownerId } }),
    prisma.deposit.count({ where: { ownerId } }),
  ]);
  return members + expenses + deposits > 0;
}
