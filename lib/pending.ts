/* A small "what was this person trying to do" note, so the create/join step
   still happens after an email-confirmation round trip (even on another
   device, via user metadata). */
export type PendingIntent = { type: "create"; groupName: string; fullName?: string } | { type: "join"; code: string };

const KEY = "mealmate-pending";

export function savePending(p: PendingIntent) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}
export function readPending(meta?: Record<string, unknown> | null): PendingIntent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  if (meta && typeof meta.pending_group_name === "string" && meta.pending_group_name)
    return { type: "create", groupName: meta.pending_group_name, fullName: (meta.full_name as string) || undefined };
  if (meta && typeof meta.pending_invite_code === "string" && meta.pending_invite_code)
    return { type: "join", code: meta.pending_invite_code };
  return null;
}
export function clearPending() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function normalizeCode(input: string): string {
  const raw = (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("MM") && raw.length > 6 ? raw.slice(2) : raw;
  return "MM-" + body.slice(0, 6);
}
export function isValidCodeShape(code: string) {
  return /^MM-[A-Z0-9]{6}$/.test(code);
}
