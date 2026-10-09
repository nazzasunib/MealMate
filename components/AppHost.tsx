"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isConfigured, siteOrigin } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { completePendingIntent, getMembership, type Membership } from "@/lib/group";
import type { Session, User } from "@supabase/supabase-js";
import Splash from "./Splash";
import ConfigMissing from "./ConfigMissing";

type EngineHandle = {
  refresh: () => void;
  renderNow: () => void;
  updateContext: (patch: Record<string, unknown>) => void;
  teamChanged: () => void;
  syncChanged: () => void;
  activityChanged: () => void;
  toast: (msg: string, tone?: string) => void;
  unmount: () => void;
};

/* ---------- offline support ----------
   The mess data (plus the last server copy, so edits made offline can be
   found and sent later) is kept on this device, together with what's needed
   to open the app without internet: the membership and the profile. */
const CACHE_PREFIX = "mealmate-cache:";
const BOOT_PREFIX = "mealmate-boot:";

function readCache(uid: string, groupId: string) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + uid);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.groupId === groupId ? c.db : null;
  } catch {
    return null;
  }
}
function writeCache(uid: string, groupId: string, db: unknown) {
  try {
    localStorage.setItem(CACHE_PREFIX + uid, JSON.stringify({ groupId, db, at: Date.now() }));
  } catch {
    /* storage full: keep the older copy rather than lose everything */
  }
}
type BootCache = { membership: Membership; profile: { name: string; email: string; avatarUrl: string | null } };
function readBoot(uid: string): BootCache | null {
  try {
    const raw = localStorage.getItem(BOOT_PREFIX + uid);
    return raw ? (JSON.parse(raw) as BootCache) : null;
  } catch {
    return null;
  }
}
function writeBoot(uid: string, boot: BootCache) {
  try { localStorage.setItem(BOOT_PREFIX + uid, JSON.stringify(boot)); } catch {}
}
/** The signed-in session as last saved on this device (used only when the
 *  server can't be reached to refresh it). */
function readStoredSession(): { user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null {
  try {
    const raw = localStorage.getItem("mealmate-auth");
    const v = raw ? JSON.parse(raw) : null;
    return v && v.user ? v : v && v.currentSession && v.currentSession.user ? v.currentSession : null;
  } catch {
    return null;
  }
}
function isNetErr(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  return e.name === "TypeError" || e.name === "AuthRetryableFetchError" || /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET|ERR_NETWORK/i.test(String(e.message || err));
}
export function clearAllCaches() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX) || k.startsWith(BOOT_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export default function AppHost() {
  const router = useRouter();
  const [phase, setPhase] = useState<"boot" | "ready" | "error" | "pending">("boot");
  const [error, setError] = useState("");
  const [bootLabel, setBootLabel] = useState("Signing you in…");
  const [pendingGroupName, setPendingGroupName] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!isConfigured || started.current) return;
    started.current = true;

    const sb = getSupabase();
    let engine: EngineHandle | null = null;
    let sync: { destroy: () => void } | null = null;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      try {
        let session: Session | null = null;
        let sessionErr: unknown = null;
        try {
          const res = await sb.auth.getSession();
          session = res.data.session;
          sessionErr = res.error;
        } catch (e) {
          sessionErr = e;
        }
        let user: User | null = session ? session.user : null;
        let offlineBoot = false;
        if (!user) {
          // No internet to refresh the login? Carry on with the saved one.
          const stored = readStoredSession();
          if (stored && stored.user && readBoot(stored.user.id) && isNetErr(sessionErr)) {
            user = stored.user as unknown as User;
            offlineBoot = true;
          }
        }
        if (!user) {
          router.replace("/login");
          return;
        }
        const boot = readBoot(user.id);

        // Kick off code download while we talk to the server.
        const enginePromise = Promise.all([import("@/lib/engine/engine"), import("@/lib/engine/sync")]);
        const profilePromise = offlineBoot
          ? Promise.resolve({ data: null })
          : Promise.resolve(sb.from("profiles").select("full_name,email,avatar_url").eq("id", user.id).maybeSingle()).catch(() => ({ data: null }));

        let membership: Membership | null = null;
        try {
          membership = offlineBoot && boot ? boot.membership : await getMembership(sb);
        } catch (e) {
          if (boot && isNetErr(e)) {
            membership = boot.membership;
            offlineBoot = true;
          } else throw e;
        }
        if (!membership && !offlineBoot) {
          setBootLabel("Setting up your MealMate…");
          const res = await completePendingIntent(sb, user);
          if (res.done) membership = await getMembership(sb);
          else if (res.error) {
            router.replace("/start?error=" + encodeURIComponent(friendlyError(res.error)));
            return;
          }
        }
        if (!membership) {
          router.replace("/start");
          return;
        }
        if (disposed) return;
        if (membership.status === "PENDING") {
          setPendingGroupName(membership.group_name);
          setPhase("pending");
          return;
        }
        setBootLabel("Loading " + membership.group_name + "…");

        const [[engineMod, syncMod], profileRes] = await Promise.all([enginePromise, profilePromise]);
        const p = (profileRes as { data: { full_name?: string; email?: string; avatar_url?: string } | null }).data;
        const profile = p
          ? {
              name: p.full_name || (user.user_metadata?.full_name as string) || (user.email || "").split("@")[0],
              email: p.email || user.email || "",
              avatarUrl: p.avatar_url || null,
            }
          : boot && boot.profile
            ? boot.profile
            : {
                name: (user.user_metadata?.full_name as string) || (user.email || "").split("@")[0],
                email: user.email || "",
                avatarUrl: null,
              };
        if (!offlineBoot) writeBoot(user.id, { membership, profile });

        let current: Membership = membership;
        const groupId = current.group_id;

        const uid = user.id;
        let saveT: number | undefined;
        // Keep this device's copy current (unsaved offline edits included).
        const saveLocalNow = () => {
          window.clearTimeout(saveT);
          writeCache(uid, groupId, s.exportState());
        };
        const saveLocal = () => {
          window.clearTimeout(saveT);
          saveT = window.setTimeout(saveLocalNow, 250);
        };
        const s = syncMod.createSync({
          supabase: sb,
          groupId,
          onRemoteChange: () => {
            engine?.refresh();
            saveLocal();
          },
          onStateChange: () => {
            engine?.syncChanged();
            saveLocal();
          },
          onError: (err: unknown) => engine?.toast("Couldn't save: " + friendlyError(err), "error"),
          onActivity: () => engine?.activityChanged(),
        });
        sync = s;

        const api = {
          signOut: async () => {
            try { await s.flushNow(); } catch {}
            // stop phone notifications for this account on this phone
            try {
              const tok = localStorage.getItem("mm-push-token");
              if (tok) { await sb.rpc("delete_push_token", { p_token: tok }); localStorage.removeItem("mm-push-token"); }
            } catch {}
            clearAllCaches();
            await sb.auth.signOut();
            window.location.replace("/login");
          },
          updateProfile: async ({ name, avatarUrl }: { name: string; avatarUrl: string | null }) => {
            const { error } = await sb.from("profiles").update({ full_name: name, avatar_url: avatarUrl }).eq("id", user.id);
            if (error) throw error;
          },
          changePassword: async (currentPw: string, nextPw: string) => {
            const check = await sb.auth.signInWithPassword({ email: profile.email, password: currentPw });
            if (check.error) throw new Error("WRONG_CURRENT_PASSWORD");
            const { error } = await sb.auth.updateUser({ password: nextPw });
            if (error) throw error;
          },
          // Profile photos of the people linked to member rows (profiles RLS lets
          // group-mates read each other's profile), so a member's own uploaded
          // photo shows everywhere instead of their initials.
          // phone notifications: remember which phone belongs to this account + mess
          savePushToken: async (token: string, platform: string) => {
            const { error } = await sb.rpc("save_push_token", { p_group: groupId, p_token: token, p_platform: platform });
            if (error) throw error;
          },
          listProfilePictures: async (ids: string[]) => {
            if (!ids.length) return [];
            const { data, error } = await sb.from("profiles").select("id,avatar_url").in("id", ids);
            if (error) throw error;
            return data || [];
          },
          listAccounts: async () => {
            const { data, error } = await sb.rpc("list_group_accounts", { p_group: groupId });
            if (error) throw error;
            return data || [];
          },
          listJoinRequests: async () => {
            const { data, error } = await sb.rpc("list_join_requests", { p_group: groupId });
            if (error) throw error;
            return data || [];
          },
          approveJoinRequest: async (userId: string) => {
            const { error } = await sb.rpc("approve_join_request", { p_group: groupId, p_user: userId });
            if (error) throw error;
            s.refreshAll();
          },
          rejectJoinRequest: async (userId: string) => {
            const { error } = await sb.rpc("reject_join_request", { p_group: groupId, p_user: userId });
            if (error) throw error;
          },
          getInvite: async () => {
            let res = await sb.from("group_invites").select("code,enabled,auto_approve").eq("group_id", groupId).maybeSingle();
            // Older database without the auto_approve column yet: still show the code/link.
            if (res.error && /auto_approve/i.test(res.error.message || "")) {
              res = await sb.from("group_invites").select("code,enabled").eq("group_id", groupId).maybeSingle();
            }
            if (res.error) throw res.error;
            return res.data;
          },
          regenerateInvite: async () => {
            const { data, error } = await sb.rpc("regenerate_invite_code", { p_group: groupId });
            if (error) throw error;
            return data as string;
          },
          setInviteEnabled: async (enabled: boolean) => {
            const { error } = await sb.rpc("set_invite_enabled", { p_group: groupId, p_enabled: enabled });
            if (error) throw error;
          },
          setInviteAutoApprove: async (enabled: boolean) => {
            const { error } = await sb.rpc("set_invite_auto_approve", { p_group: groupId, p_enabled: enabled });
            if (error) throw error;
          },
          changeRole: async (userId: string, role: string) => {
            const { error } = await sb.rpc("change_member_role", { p_group: groupId, p_user: userId, p_role: role });
            if (error) throw error;
            s.broadcastEvent("membership");
            if (userId === user.id) await refreshMembership();
          },
          transferSuperAdmin: async (userId: string) => {
            const { error } = await sb.rpc("transfer_super_admin", { p_group: groupId, p_user: userId });
            if (error) throw error;
            s.broadcastEvent("membership");
            await refreshMembership();
          },
          removeAccount: async (userId: string) => {
            const { error } = await sb.rpc("remove_group_member", { p_group: groupId, p_user: userId });
            if (error) throw error;
            s.broadcastEvent("membership");
            s.refreshAll();
          },
          deleteMember: async (memberId: string, keepData: boolean) => {
            await s.flushNow(); // our pending edits land before the server rewrites this member's rows
            const { error } = await sb.rpc("delete_roster_member", { p_group: groupId, p_member: memberId, p_keep_data: keepData });
            if (error) throw error;
            s.broadcastEvent("membership");
            s.broadcastEvent("changed", { tables: ["members", "meals", "deposits", "guest_meals", "expenses"] });
            s.refreshAll();
          },
          renameGroup: async (name: string) => {
            const { error } = await sb.rpc("update_group_name", { p_group: groupId, p_name: name });
            if (error) throw error;
            current = { ...current, group_name: name };
            s.broadcastEvent("membership");
          },
          importBackup: (data: Record<string, unknown>) => s.importData(data),

          /* ---- notifications (activity feed) & meal requests — migration 0004 ---- */
          listActivity: async () => {
            const { data, error } = await sb.rpc("list_activity", { p_group: groupId, p_limit: 100 });
            if (error) throw error;
            return data || [];
          },
          logActivity: async (kind: string, action: string, summary: string) => {
            const { error } = await sb.from("activity_log").insert({ group_id: groupId, kind, action, summary: summary.slice(0, 400) });
            if (!error) s.broadcastEvent("activity");
          },
          listRequests: async () => {
            const { data, error } = await sb.from("meal_requests").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(200);
            if (error) throw error;
            return data || [];
          },
          createRequest: async (r: { kind: string; from: string; to: string; breakfast: boolean; lunch: boolean; dinner: boolean; guestName?: string; quantity?: number; note?: string }) => {
            const { data, error } = await sb.rpc("create_meal_request", {
              p_group: groupId, p_kind: r.kind, p_from: r.from, p_to: r.to || r.from,
              p_breakfast: r.breakfast, p_lunch: r.lunch, p_dinner: r.dinner,
              p_guest_name: r.guestName || null, p_quantity: r.quantity || 1, p_note: r.note || null,
            });
            if (error) throw error;
            s.broadcastEvent("activity");
            return data as string;
          },
          cancelRequest: async (id: string) => {
            const { error } = await sb.rpc("cancel_meal_request", { p_id: id });
            if (error) throw error;
            s.broadcastEvent("activity");
          },
          decideRequest: async (id: string, approve: boolean, note: string) => {
            const { error } = await sb.rpc("decide_meal_request", { p_id: id, p_approve: approve, p_note: note || null });
            if (error) throw error;
            if (approve) {
              // the database switched meals off / added the guest meal: fetch it here and tell everyone else
              s.refreshAll();
              s.broadcastEvent("changed", { tables: ["meals", "guest_meals"] });
            }
            s.broadcastEvent("activity");
          },
        };

        async function refreshMembership() {
          try {
            const next = await getMembership(sb);
            if (!next || next.group_id !== groupId) {
              engine?.toast("You were removed from this MealMate.", "error");
              clearAllCaches();
              setTimeout(() => window.location.replace("/start"), 1200);
              return;
            }
            const changed =
              next.role !== current.role ||
              !!next.is_super_admin !== !!current.is_super_admin ||
              next.group_name !== current.group_name ||
              next.permissions.join(",") !== current.permissions.join(",");
            if (changed) {
              const roleChanged = next.role !== current.role;
              const superChanged = !!next.is_super_admin !== !!current.is_super_admin;
              current = next;
              engine?.updateContext({ role: next.role, isSuperAdmin: !!next.is_super_admin, permissions: next.permissions, groupName: next.group_name });
              if (superChanged) engine?.toast(next.is_super_admin ? "You are now the Super Admin." : "You are no longer the Super Admin.", "success");
              else if (roleChanged) engine?.toast("Your role is now " + next.role.charAt(0) + next.role.slice(1).toLowerCase() + ".", "success");
            }
            engine?.teamChanged();
          } catch {
            /* offline — try again on next focus */
          }
        }

        const ctx = {
          db: s.db,
          profile,
          groupId,
          userId: user.id,
          groupName: current.group_name,
          role: current.role,
          isSuperAdmin: !!current.is_super_admin,
          permissions: current.permissions,
          inviteBaseUrl: siteOrigin(),
          persist: () => {
            s.persist();
            saveLocal();
          },
          isFresh: () => s.isFresh(),
          syncState: () => s.state(),
          loadPdf: () => import("jspdf").then((m) => m.jsPDF),
          api,
          friendlyError,
        };

        // Instant paint from this device's cache, then swap in live data.
        const cached = readCache(user.id, groupId);
        if (cached) {
          s.hydrate(cached);
          if (navigator.onLine === false) s.markOffline();
          engine = engineMod.mountEngine(ctx) as EngineHandle;
          setPhase("ready");
        }
        let loadedOnline = true;
        try {
          await s.load();
        } catch (e) {
          // No internet: keep working from this device's copy; edits are sent later.
          if (cached && isNetErr(e)) {
            loadedOnline = false;
            s.markOffline();
          } else throw e;
        }
        if (disposed) return;
        if (loadedOnline) saveLocalNow();
        if (engine) engine.refresh();
        else {
          engine = engineMod.mountEngine(ctx) as EngineHandle;
          setPhase("ready");
        }

        s.subscribe({ onMembership: refreshMembership, onActivity: () => engine?.activityChanged() });
        // Just joined? Let the Admin's Team page know right away.
        if (Date.now() - new Date(current.joined_at).getTime() < 5 * 60 * 1000) {
          setTimeout(() => s.broadcastEvent("membership"), 1500);
        }

        // Catch up after the phone wakes up / tab regains focus.
        let lastRefresh = Date.now();
        const onVisible = () => {
          if (document.visibilityState !== "visible") { saveLocalNow(); return; }
          if (Date.now() - lastRefresh < 5000) return;
          lastRefresh = Date.now();
          s.refreshAll();
          refreshMembership();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        // Internet is back: send what was done offline, then fetch the latest.
        const onOnline = () => {
          lastRefresh = Date.now();
          s.refreshAll();
          refreshMembership();
        };
        const onOffline = () => s.markOffline();
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        const onHide = () => saveLocalNow();
        window.addEventListener("pagehide", onHide);
        const poll = window.setInterval(() => {
          if (document.visibilityState === "visible") {
            lastRefresh = Date.now();
            s.refreshAll();
            refreshMembership();
          }
        }, 60000);
        const beforeUnload = (e: BeforeUnloadEvent) => {
          saveLocalNow();
          // offline edits are already kept on this device — no need to warn
          if (s.hasPendingWrites() && navigator.onLine !== false) {
            s.flushNow();
            e.preventDefault();
            e.returnValue = "";
          }
        };
        window.addEventListener("beforeunload", beforeUnload);
        cleanups.push(() => {
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", onVisible);
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
          window.removeEventListener("pagehide", onHide);
          window.removeEventListener("beforeunload", beforeUnload);
          window.clearInterval(poll);
        });

        const { data: authSub } = sb.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") {
            clearAllCaches();
            window.location.replace("/login");
          }
        });
        cleanups.push(() => authSub.subscription.unsubscribe());
      } catch (err) {
        if (disposed) return;
        setError(
          isNetErr(err)
            ? "You're offline. Open MealMate once with internet on this device — after that it works offline too."
            : friendlyError(err)
        );
        setPhase("error");
      }
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      engine?.unmount();
      sync?.destroy();
    };
  }, [router]);

  if (!isConfigured) return <ConfigMissing />;

  return (
    <>
      <div id="app" className="h-full" />
      <div id="toast-host" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" />
      {phase === "boot" && <Splash label={bootLabel} />}
      {phase === "pending" && (
        <div className="mm-fullscreen-msg">
          <div className="mm-auth-card mm-auth-card--narrow">
            <img src="/logo-icon.png" alt="" className="mm-auth-logo" />
            <h1 className="mm-auth-title">Waiting for approval</h1>
            <p className="mm-auth-sub">
              Your request to join <strong>{pendingGroupName}</strong> is with an Admin or Moderator. You&apos;ll get
              access as soon as someone approves it.
            </p>
            <button className="mm-btn mm-btn--primary mm-btn--block" onClick={() => window.location.reload()}>
              Check again
            </button>
            <button
              className="mm-btn mm-btn--ghost mm-btn--block"
              onClick={async () => {
                clearAllCaches();
                await getSupabase().auth.signOut();
                window.location.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
      {phase === "error" && (
        <div className="mm-fullscreen-msg">
          <div className="mm-auth-card mm-auth-card--narrow">
            <img src="/logo-icon.png" alt="" className="mm-auth-logo" />
            <h1 className="mm-auth-title">We couldn&apos;t load MealMate</h1>
            <p className="mm-auth-sub">{error}</p>
            <button className="mm-btn mm-btn--primary mm-btn--block" onClick={() => window.location.reload()}>
              Try again
            </button>
            <button
              className="mm-btn mm-btn--ghost mm-btn--block"
              onClick={async () => {
                clearAllCaches();
                await getSupabase().auth.signOut();
                window.location.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
