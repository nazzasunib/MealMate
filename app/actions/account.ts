"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, UserError } from "@/lib/action";
import { pictureUrl } from "@/lib/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resetAccountData, updateProfile } from "@/services/account";
import { importLegacyData } from "@/services/legacy-import";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
  avatarUrl: pictureUrl,
});

export async function updateProfileAction(input: z.input<typeof profileSchema>) {
  const res = await runAction(profileSchema, input, async (d, p) => {
    await updateProfile(p.id, { name: d.name, avatarUrl: d.avatarUrl });
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(6, "New password must be at least 6 characters.").max(72),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "Passwords do not match." });

export async function changePasswordAction(input: z.input<typeof passwordSchema>) {
  return runAction(passwordSchema, input, async (d, p) => {
    const supabase = await createSupabaseServerClient();
    // Verify the current password first, like the legacy app did.
    const check = await supabase.auth.signInWithPassword({ email: p.email, password: d.current });
    if (check.error) throw new UserError("Current password is incorrect.");
    const { error } = await supabase.auth.updateUser({ password: d.next });
    if (error) throw new UserError(error.message);
  });
}

export async function resetAllDataAction(confirmText: string) {
  const res = await runAction(
    z.literal("RESET", { message: "Type RESET to confirm." }),
    confirmText,
    async (_d, p) => {
      await resetAccountData(p.id);
    },
  );
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function importLegacyDataAction(raw: string) {
  const res = await runAction(z.string().min(2, "Paste the exported data first.").max(20_000_000), raw, (json, p) =>
    importLegacyData(p.id, json),
  );
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
