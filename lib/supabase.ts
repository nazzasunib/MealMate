import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const isConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** One shared browser client. Session is persisted in localStorage and
 *  refreshed automatically, so users stay signed in across visits. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(url || "http://localhost:54321", anonKey || "missing-anon-key", {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "mealmate-auth" },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

/** The origin invite links and auth emails point to. In the browser this is
 *  always the site the app is actually running on, so a stale or wrong
 *  NEXT_PUBLIC_SITE_URL can never send people to someone else's website;
 *  the env value is only a fallback outside the browser. */
export function siteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, "");
  return "";
}
