import { z } from "zod";
import { isDateKey, isMonthKey } from "@/lib/dates";

export const dateKey = z.string().refine(isDateKey, "Please select a valid date.");
export const monthKey = z.string().refine(isMonthKey, "Invalid month.");
export const id = z.string().min(1).max(64);
export const money = z.coerce.number({ message: "Please enter a valid amount." }).positive("Amount must be greater than 0.").max(1e9);
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
/** Downsized data-URL images only (member/profile pictures). */
export const pictureUrl = z
  .string()
  .max(400_000, "Picture is too large.")
  .refine((v) => v === "" || v.startsWith("data:image/"), "Invalid picture.")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
