/* Turns Supabase / Postgres / network errors into short, human messages. */
type AnyErr = { message?: string; code?: string; status?: number; name?: string } | null | undefined;

const RPC_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Please log in to continue.",
  INVALID_INVITE: "That invite code doesn't exist. Check the code and try again.",
  INVITE_DISABLED: "This MealMate isn't accepting new members right now. Ask the Admin to turn invites back on.",
  ALREADY_MEMBER: "You're already a member of this MealMate.",
  ALREADY_IN_GROUP: "Your account already belongs to a MealMate. One account can be in one MealMate at a time.",
  INVALID_GROUP_NAME: "MealMate name must be 2–60 characters.",
  LAST_ADMIN: "Every MealMate needs at least one Admin. Promote someone else first.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID_ROLE: "That role isn't valid.",
  NOT_A_MEMBER: "That person is no longer in this MealMate.",
  CANNOT_REMOVE_SELF: "You can't delete yourself from the member list.",
  WRONG_CURRENT_PASSWORD: "Current password is incorrect.",
  TOO_MANY_ATTEMPTS: "Too many wrong invite codes. Please wait an hour, or ask your Admin for the invite link.",
  IMPORT_FAILED: "Some records couldn't be imported. Nothing was lost — please try again.",
};

export function friendlyError(err: unknown): string {
  const e = err as AnyErr;
  const msg = (e && (e.message || String(e))) || "";
  const code = (e && e.code) || "";

  for (const key of Object.keys(RPC_MESSAGES)) {
    if (msg === key || msg.includes(key) || code === key) return RPC_MESSAGES[key];
  }
  if (code === "PGRST202" || code === "PGRST205" || code === "42P01" || code === "42883" || /could not find the (function|table)|schema cache|does not exist/i.test(msg))
    return "Database setup isn't finished. Run supabase/migrations/0001_mealmate.sql in Supabase → SQL Editor, then try again.";
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox (and spam folder).";
  if (/already registered|already been registered|user_already_exists/i.test(msg + code)) return "An account with this email already exists. Try logging in instead.";
  if (code === "weak_password" || /password should|weak password|pwned/i.test(msg)) return "That password is too weak. Use at least 8 characters with letters and numbers.";
  if (code === "same_password" || /different from the old/i.test(msg)) return "New password must be different from the current one.";
  if (/unable to validate email|invalid email|email address .* is invalid/i.test(msg)) return "Please enter a valid email address.";
  if (e && e.status === 429 || /rate limit|too many/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
  if (/jwt expired|refresh token|session.*(missing|expired)/i.test(msg)) return "Your session expired. Please log in again.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg) || (typeof navigator !== "undefined" && navigator.onLine === false))
    return "Can't reach the server. Check your internet connection and try again.";
  if (code === "23505") return "That already exists.";
  if (code && /^(22|23)/.test(code)) return "Some of that information isn't valid. Please check and try again.";
  return "Something went wrong. Please try again." + (msg ? " (" + msg.slice(0, 140) + ")" : "");
}
