"use client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, isConfigured } from "./supabase";

export function useSessionUser() {
  const [state, setState] = useState<{ status: "loading" | "in" | "out"; user: User | null }>({ status: "loading", user: null });
  useEffect(() => {
    if (!isConfigured) { setState({ status: "out", user: null }); return; }
    const sb = getSupabase();
    let alive = true;
    sb.auth.getSession().then(({ data }) => {
      if (alive) setState({ status: data.session ? "in" : "out", user: data.session?.user ?? null });
    });
    const { data } = sb.auth.onAuthStateChange((_e, session) => {
      if (alive) setState({ status: session ? "in" : "out", user: session?.user ?? null });
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  return state;
}
