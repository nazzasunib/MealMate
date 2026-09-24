import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Prisma Decimal | number | null -> number. */
export function num(v: { toNumber(): number } | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : v.toNumber();
}
export function numOrNull(v: { toNumber(): number } | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : v.toNumber();
}
