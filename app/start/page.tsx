"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell, Alert, Icon } from "@/components/ui";
import Splash from "@/components/Splash";
import { getSupabase } from "@/lib/supabase";
import { getMembership } from "@/lib/group";
import { useSessionUser } from "@/lib/useSession";

function StartInner() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSessionUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (session.status === "out") { router.replace("/login"); return; }
    if (session.status !== "in") return;
    getMembership(getSupabase())
      .then((m) => (m ? router.replace("/app") : setReady(true)))
      .catch(() => setReady(true));
  }, [session.status, router]);

  if (!ready) return <Splash label="Just a moment…" />;
  const name = (session.user?.user_metadata?.full_name as string) || "";

  return (
    <AuthShell
      title={name ? `Hi ${name.split(" ")[0]}, let’s get you set up` : "Let’s get you set up"}
      subtitle="Your account isn't part of a MealMate yet. Start a new one or join your mess."
      footer={
        <p className="mm-auth-foot-text">
          Signed in as {session.user?.email} ·{" "}
          <button className="mm-link" onClick={async () => { await getSupabase().auth.signOut(); router.replace("/login"); }}>Sign out</button>
        </p>
      }
    >
      <Alert>{params.get("error") || ""}</Alert>
      <div className="mm-choice-grid">
        <Link href="/create" className="mm-choice">
          <span className="mm-choice-icon stat-card-bg"><Icon name="home" size={22} /></span>
          <span className="mm-choice-title">Create New MealMate</span>
          <span className="mm-choice-sub">Start fresh — you&apos;ll be the Admin and get an invite code.</span>
          <span className="mm-choice-go"><Icon name="arrowRight" size={16} /></span>
        </Link>
        <Link href="/join" className="mm-choice">
          <span className="mm-choice-icon stat-card-bg"><Icon name="users" size={22} /></span>
          <span className="mm-choice-title">Join Existing MealMate</span>
          <span className="mm-choice-sub">Have a code like MM-7K29PX or an invite link? Join as a Member.</span>
          <span className="mm-choice-go"><Icon name="arrowRight" size={16} /></span>
        </Link>
      </div>
    </AuthShell>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={<Splash label="Just a moment…" />}>
      <StartInner />
    </Suspense>
  );
}
