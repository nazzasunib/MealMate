import type { SupabaseClient, User } from "@supabase/supabase-js";
import { clearPending, readPending } from "./pending";

export type Membership = {
  group_id: string;
  group_name: string;
  role: "ADMIN" | "MODERATOR" | "MEMBER";
  status: "ACTIVE" | "PENDING";
  joined_at: string;
  member_id: string | null;
  permissions: string[];
};

export async function getMembership(sb: SupabaseClient): Promise<Membership | null> {
  const { data, error } = await sb.rpc("get_my_membership");
  if (error) throw error;
  return (data as Membership) || null;
}

export async function createGroup(sb: SupabaseClient, groupName: string, fullName?: string) {
  const { data, error } = await sb.rpc("create_meal_group", { p_group_name: groupName, p_full_name: fullName || null });
  if (error) throw error;
  return data as { group_id: string; group_name: string; invite_code: string };
}

export async function joinGroup(sb: SupabaseClient, code: string) {
  const { data, error } = await sb.rpc("join_meal_group", { p_code: code });
  if (error) throw error;
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as { group_id: string; group_name: string };
}

export async function previewInvite(sb: SupabaseClient, code: string) {
  const { data, error } = await sb.rpc("get_invite_preview", { p_code: code });
  if (error) throw error;
  return (data as { group_name: string; enabled: boolean; code: string } | null) || null;
}

/** Finishes a create/join the user started before confirming their email. */
export async function completePendingIntent(sb: SupabaseClient, user: User): Promise<{ done: boolean; error?: unknown }> {
  const pending = readPending(user.user_metadata);
  if (!pending) return { done: false };
  try {
    if (pending.type === "create") await createGroup(sb, pending.groupName, pending.fullName);
    else await joinGroup(sb, pending.code);
    return { done: true };
  } catch (error) {
    return { done: false, error };
  } finally {
    clearPending();
    if (user.user_metadata?.pending_group_name || user.user_metadata?.pending_invite_code) {
      sb.auth.updateUser({ data: { pending_group_name: null, pending_invite_code: null } }).catch(() => {});
    }
  }
}
