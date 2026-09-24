import "server-only";
import type { Member } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromDbDate, toDbDate, todayKey } from "@/lib/dates";
import { AVATAR_COLORS, type MealType } from "@/lib/constants";
import { UserError } from "@/lib/action";
import type { MealDefaults, MemberDTO, MemberStatus } from "@/types";

export function toMemberDTO(m: Member): MemberDTO {
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    email: m.email,
    pictureUrl: m.pictureUrl,
    avatarColor: m.avatarColor,
    status: m.status,
    defaultMeals: { breakfast: m.defaultBreakfast, lunch: m.defaultLunch, dinner: m.defaultDinner },
    joinedAt: fromDbDate(m.joinedAt),
  };
}

/** All members, active first then by name (legacy Members page order). */
export async function listMembers(ownerId: string): Promise<MemberDTO[]> {
  const rows = await prisma.member.findMany({ where: { ownerId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  return rows.map(toMemberDTO);
}

export async function listActiveMembers(ownerId: string): Promise<MemberDTO[]> {
  const rows = await prisma.member.findMany({ where: { ownerId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  return rows.map(toMemberDTO);
}

async function assertOwnMember(ownerId: string, memberId: string) {
  const m = await prisma.member.findFirst({ where: { id: memberId, ownerId } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

export interface MemberInput {
  name: string;
  phone: string | null;
  email: string | null;
  pictureUrl: string | null;
  defaultMeals: MealDefaults;
  status?: MemberStatus;
}

export async function createMember(ownerId: string, input: MemberInput) {
  const count = await prisma.member.count({ where: { ownerId } });
  return prisma.member.create({
    data: {
      ownerId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      pictureUrl: input.pictureUrl,
      avatarColor: AVATAR_COLORS[count % AVATAR_COLORS.length],
      defaultBreakfast: input.defaultMeals.breakfast,
      defaultLunch: input.defaultMeals.lunch,
      defaultDinner: input.defaultMeals.dinner,
      joinedAt: toDbDate(todayKey()),
    },
  });
}

export async function updateMember(ownerId: string, memberId: string, input: MemberInput) {
  await assertOwnMember(ownerId, memberId);
  return prisma.member.update({
    where: { id: memberId },
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      pictureUrl: input.pictureUrl,
      status: input.status,
      defaultBreakfast: input.defaultMeals.breakfast,
      defaultLunch: input.defaultMeals.lunch,
      defaultDinner: input.defaultMeals.dinner,
    },
  });
}

export async function toggleMemberStatus(ownerId: string, memberId: string) {
  const m = await assertOwnMember(ownerId, memberId);
  return prisma.member.update({
    where: { id: memberId },
    data: { status: m.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
  });
}

const DEFAULT_FIELD: Record<MealType, "defaultBreakfast" | "defaultLunch" | "defaultDinner"> = {
  breakfast: "defaultBreakfast",
  lunch: "defaultLunch",
  dinner: "defaultDinner",
};

export async function setMemberDefaultMeal(ownerId: string, memberId: string, type: MealType, value: boolean) {
  await assertOwnMember(ownerId, memberId);
  return prisma.member.update({ where: { id: memberId }, data: { [DEFAULT_FIELD[type]]: value } });
}

export async function memberCounts(ownerId: string) {
  const [active, total] = await Promise.all([
    prisma.member.count({ where: { ownerId, status: "ACTIVE" } }),
    prisma.member.count({ where: { ownerId } }),
  ]);
  return { active, total };
}
