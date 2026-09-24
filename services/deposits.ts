import "server-only";
import type { Deposit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromDbDate, monthDbRange, toDbDate } from "@/lib/dates";
import { UserError } from "@/lib/action";
import { num } from "@/lib/utils";
import type { DepositDTO } from "@/types";

export function toDepositDTO(d: Deposit): DepositDTO {
  return {
    id: d.id,
    memberId: d.memberId,
    date: fromDbDate(d.date),
    amount: num(d.amount),
    note: d.note,
    carriedFromMonth: d.carriedFromMonth,
  };
}

/** Deposits in a month, newest first, optionally filtered by member name. */
export async function listDepositsForMonth(ownerId: string, monthKey: string, search = ""): Promise<DepositDTO[]> {
  const q = search.trim();
  const rows = await prisma.deposit.findMany({
    where: {
      ownerId,
      date: monthDbRange(monthKey),
      ...(q ? { member: { name: { contains: q, mode: "insensitive" } } } : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDepositDTO);
}

export async function listAllDeposits(ownerId: string): Promise<DepositDTO[]> {
  const rows = await prisma.deposit.findMany({ where: { ownerId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  return rows.map(toDepositDTO);
}

export interface DepositInput {
  memberId: string;
  date: string;
  amount: number;
  note: string | null;
}

async function assertMember(ownerId: string, memberId: string) {
  const m = await prisma.member.findFirst({ where: { id: memberId, ownerId }, select: { id: true } });
  if (!m) throw new UserError("Please select a member.");
}

export async function createDeposit(ownerId: string, input: DepositInput) {
  await assertMember(ownerId, input.memberId);
  return prisma.deposit.create({
    data: { ownerId, memberId: input.memberId, date: toDbDate(input.date), amount: input.amount, note: input.note },
  });
}

export async function updateDeposit(ownerId: string, id: string, input: DepositInput) {
  await assertMember(ownerId, input.memberId);
  const res = await prisma.deposit.updateMany({
    where: { id, ownerId },
    data: { memberId: input.memberId, date: toDbDate(input.date), amount: input.amount, note: input.note },
  });
  if (!res.count) throw new UserError("Deposit not found.");
}

export async function deleteDeposit(ownerId: string, id: string) {
  const res = await prisma.deposit.deleteMany({ where: { id, ownerId } });
  if (!res.count) throw new UserError("Deposit not found.");
}
