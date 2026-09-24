import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export interface CurrentProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Returns the signed-in account's Profile, creating it on first sign-in.
 * Cached per request. Returns null when nobody is signed in.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  const metaName = typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() : "";
  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id, email: user.email, name: metaName || user.email.split("@")[0] },
    select: { id: true, email: true, name: true, avatarUrl: true },
  });
  return profile;
});

/** For pages: redirect to /login when signed out. */
export async function requireProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}
