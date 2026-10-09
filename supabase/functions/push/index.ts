// MealMate — phone notifications (Supabase Edge Function "push").
//
// Called by a Database Webhook on INSERT into public.activity_log.
// Sends a phone notification (Firebase Cloud Messaging) only for:
//   • meal off (direct change, or a meal-off request)
//   • guest meals (added / edited / deleted, or a guest-meal request)
//   • money added (deposit)
//   • edits / deletes of money: deposits and expenses
// Everything else stays in the app's bell only.
//
// Who gets it: everyone in the mess except the person who did it.
//   - a new meal request  -> Admins and Moderators only
//   - request approved     -> everyone (except the approver)
//   - request rejected     -> only the person who asked
//
// Secrets (Supabase → Edge Functions → Secrets):
//   FCM_SERVICE_ACCOUNT = the whole Firebase service-account JSON
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

type Row = {
  id: number;
  group_id: string;
  actor_id: string | null;
  actor_name: string;
  kind: string;
  action: string;
  summary: string;
  target_user: string | null;
  created_at: string;
  pushed_at: string | null;
};
type Plan = { title: string; route: string; audience: "all" | "managers" | "target" };

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function plan(r: Row): Plan | null {
  const s = r.summary || "";
  if (/ at once$/.test(s)) return null; // a backup import / big batch
  switch (r.kind) {
    case "request": {
      const off = /meal off/.test(s);
      if (r.action === "requested") return { title: off ? "Meal off request" : "Guest meal request", route: "requests", audience: "managers" };
      if (r.action === "approved") return { title: off ? "Meal off approved" : "Guest meal approved", route: "meals", audience: "all" };
      if (r.action === "rejected") return { title: "Request rejected", route: "requests", audience: "target" };
      return null;
    }
    case "meal":
      // direct meal changes: only when something was switched OFF
      return /\b(Breakfast|Lunch|Dinner) off\b/.test(s) ? { title: "Meal off", route: "meals", audience: "all" } : null;
    case "guest":
      if (r.action === "added") return { title: "Guest meal", route: "meals", audience: "all" };
      if (r.action === "updated") return { title: "Guest meal edited", route: "meals", audience: "all" };
      if (r.action === "deleted") return { title: "Guest meal removed", route: "meals", audience: "all" };
      return null;
    case "deposit":
      if (r.action === "added") return /^carried forward/.test(s) ? null : { title: "Money added", route: "money", audience: "all" };
      if (r.action === "updated") return { title: "Money edited", route: "money", audience: "all" };
      if (r.action === "deleted") return { title: "Money deleted", route: "money", audience: "all" };
      return null;
    case "expense":
      if (r.action === "updated") return { title: "Expense edited", route: "expenses", audience: "all" };
      if (r.action === "deleted") return { title: "Expense deleted", route: "expenses", audience: "all" };
      return null;
  }
  return null;
}

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

// ---- Google sign-in for FCM (service account -> short-lived access token) ----
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
  let bin = "";
  bytes.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
let cached: { token: string; exp: number } | null = null;
async function googleToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("Google sign-in failed: " + JSON.stringify(j));
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.record?.id);
    if (!id) return new Response("ignored", { status: 200 });

    // Never trust the caller's copy: claim the real row once (pushed_at is
    // null -> now). A second call for the same line gets nothing back.
    const claimed: Row[] = await rest(`activity_log?id=eq.${id}&pushed_at=is.null&created_at=gte.${encodeURIComponent(new Date(Date.now() - 10 * 60 * 1000).toISOString())}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ pushed_at: new Date().toISOString() }),
    });
    const row = claimed && claimed[0];
    if (!row) return new Response("already handled", { status: 200 });

    const p = plan(row);
    if (!p) return new Response("bell only", { status: 200 });

    // who should get it
    let members: { user_id: string; role: string }[] = await rest(
      `group_members?group_id=eq.${row.group_id}&status=eq.ACTIVE&select=user_id,role`,
    );
    if (p.audience === "managers") members = members.filter((m) => m.role === "ADMIN" || m.role === "MODERATOR");
    if (p.audience === "target") members = members.filter((m) => m.user_id === row.target_user);
    const users = members.map((m) => m.user_id).filter((u) => u && u !== row.actor_id);
    if (!users.length) return new Response("nobody to tell", { status: 200 });

    const tokens: { token: string }[] = await rest(
      `push_tokens?group_id=eq.${row.group_id}&user_id=in.(${users.join(",")})&select=token`,
    );
    if (!tokens.length) return new Response("no phones", { status: 200 });

    const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") || "{}");
    if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error("FCM_SERVICE_ACCOUNT secret is missing or incomplete");
    const access = await googleToken(sa);

    const who = (row.actor_name || "Someone").trim();
    const text = `${who} ${row.summary}`.slice(0, 240);
    let sent = 0;
    const dead: string[] = [];
    await Promise.all(tokens.map(async ({ token }) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: p.title, body: text },
            data: { route: p.route, kind: row.kind, id: String(row.id) },
            android: {
              priority: "HIGH",
              notification: { channel_id: "mealmate", icon: "ic_stat_mealmate", color: "#0b1f4b", default_sound: true },
            },
          },
        }),
      });
      if (res.ok) { sent++; return; }
      const err = await res.text();
      // the app was uninstalled / signed out on that phone: forget the token
      if (res.status === 404 || /UNREGISTERED/.test(err)) dead.push(token);
      else console.error("FCM", res.status, err);
    }));
    if (dead.length) {
      await rest(`push_tokens?token=in.(${dead.map((t) => `"${t}"`).join(",")})`, { method: "DELETE" }).catch(() => {});
    }
    return new Response(JSON.stringify({ sent, removed: dead.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
