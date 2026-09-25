"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isConfigured, siteOrigin } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { completePendingIntent, getMembership, type Membership } from "@/lib/group";
import Splash from "./Splash";
import ConfigMissing from "./ConfigMissing";

type EngineHandle = {
  refresh: () => void;
  renderNow: () => void;
  updateContext: (patch: Record<string, unknown>) => void;
  teamChanged: () => void;
  syncChanged: () => void;
  toast: (msg: string, tone?: string) => void;
  unmount: () => void;
};

const CACHE_PREFIX = "mealmate-cache:";

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
    /* quota exceeded (large pictures) — the cache is only a speed-up */
    try { localStorage.removeItem(CACHE_PREFIX + uid); } catch {}
  }
}
export function clearAllCaches() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
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
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
          router.replace("/login");
          return;
        }
        const user = session.user;

        // Kick off code download while we talk to the server.
        const enginePromise = Promise.all([import("@/lib/engine/engine"), import("@/lib/engine/sync")]);
        const profilePromise = sb.from("profiles").select("full_name,email,avatar_url").eq("id", user.id).maybeSingle();

        let membership: Membership | null = await getMembership(sb);
        if (!membership) {
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
        const p = profileRes.data;
        const profile = {
          name: (p && p.full_name) || (user.user_metadata?.full_name as string) || (user.email || "").split("@")[0],
          email: (p && p.email) || user.email || "",
          avatarUrl: (p && p.avatar_url) || null,
        };

        let current: Membership = membership;
        const groupId = current.group_id;

        const s = syncMod.createSync({
          supabase: sb,
          groupId,
          onRemoteChange: () => {
            engine?.refresh();
            writeCache(user.id, groupId, s.db);
          },
          onStateChange: () => engine?.syncChanged(),
          onError: (err: unknown) => engine?.toast("Couldn't save: " + friendlyError(err), "error"),
        });
        sync = s;

        const api = {
          signOut: async () => {
            try { await s.flushNow(); } catch {}
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
            const { data, error } = await sb.from("group_invites").select("code,enabled").eq("group_id", groupId).maybeSingle();
            if (error) throw error;
            return data;
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
          changeRole: async (userId: string, role: string) => {
            const { error } = await sb.rpc("change_member_role", { p_group: groupId, p_user: userId, p_role: role });
            if (error) throw error;
            s.broadcastEvent("membership");
            if (userId === user.id) await refreshMembership();
          },
          removeAccount: async (userId: string) => {
            const { error } = await sb.rpc("remove_group_member", { p_group: groupId, p_user: userId });
            if (error) throw error;
            s.broadcastEvent("membership");
            s.refreshAll();
          },
          renameGroup: async (name: string) => {
            const { error } = await sb.rpc("update_group_name", { p_group: groupId, p_name: name });
            if (error) throw error;
            current = { ...current, group_name: name };
            s.broadcastEvent("membership");
          },
          importBackup: (data: Record<string, unknown>) => s.importData(data),
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
              next.group_name !== current.group_name ||
              next.permissions.join(",") !== current.permissions.join(",");
            if (changed) {
              const roleChanged = next.role !== current.role;
              current = next;
              engine?.updateContext({ role: next.role, permissions: next.permissions, groupName: next.group_name });
              if (roleChanged) engine?.toast("Your role is now " + next.role.charAt(0) + next.role.slice(1).toLowerCase() + ".", "success");
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
          groupName: current.group_name,
          role: current.role,
          permissions: current.permissions,
          inviteBaseUrl: siteOrigin(),
          persist: () => {
            s.persist();
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
          engine = engineMod.mountEngine(ctx) as EngineHandle;
          setPhase("ready");
        }
        await s.load();
        if (disposed) return;
        writeCache(user.id, groupId, s.db);
        if (engine) engine.refresh();
        else {
          engine = engineMod.mountEngine(ctx) as EngineHandle;
          setPhase("ready");
        }

        s.subscribe({ onMembership: refreshMembership });
        // Just joined? Let the Admin's Team page know right away.
        if (Date.now() - new Date(current.joined_at).getTime() < 5 * 60 * 1000) {
          setTimeout(() => s.broadcastEvent("membership"), 1500);
        }

        // Catch up after the phone wakes up / tab regains focus.
        let lastRefresh = Date.now();
        const onVisible = () => {
          if (document.visibilityState !== "visible") return;
          if (Date.now() - lastRefresh < 5000) return;
          lastRefresh = Date.now();
          s.refreshAll();
          refreshMembership();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);
        window.addEventListener("online", onVisible);
        const poll = window.setInterval(() => {
          if (document.visibilityState === "visible") {
            lastRefresh = Date.now();
            s.refreshAll();
            refreshMembership();
          }
        }, 60000);
        const beforeUnload = (e: BeforeUnloadEvent) => {
          if (s.hasPendingWrites()) {
            s.flushNow();
            e.preventDefault();
            e.returnValue = "";
          }
        };
        window.addEventListener("beforeunload", beforeUnload);
        cleanups.push(() => {
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("focus", onVisible);
          window.removeEventListener("online", onVisible);
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
        setError(friendlyError(err));
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
