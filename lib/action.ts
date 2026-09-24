import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getCurrentProfile, type CurrentProfile } from "@/lib/auth";
import type { ActionResult } from "@/types";

/** Throw inside a service/action for an expected, user-facing error. */
export class UserError extends Error {}

function friendlyError(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Invalid input.";
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "That entry already exists.";
    if (err.code === "P2025") return "That record no longer exists. Refresh and try again.";
    return "A database error occurred. Please try again.";
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return "Cannot reach the database. Check DATABASE_URL and that Supabase is running.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * Standard server-action wrapper: authenticates, validates input with zod,
 * runs the handler and converts any failure into { ok: false, error }.
 * Handlers never see unauthenticated calls, and every service call receives
 * the caller's ownerId, so one account can never touch another's data.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.infer<S>, profile: CurrentProfile) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Your session has expired. Please sign in again." };
    const data = schema.parse(input);
    const result = await handler(data, profile);
    return { ok: true, data: result };
  } catch (err) {
    if (!(err instanceof UserError) && !(err instanceof z.ZodError)) console.error("[action]", err);
    return { ok: false, error: friendlyError(err) };
  }
}
