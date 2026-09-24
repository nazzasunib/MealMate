"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, Alert, Button, PasswordField, validatePassword } from "@/components/ui";
import Splash from "@/components/Splash";
import { getSupabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

export default function ResetPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    let decided = false;
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) { decided = true; setStatus("ready"); }
    });
    // The recovery link signs the user in via the URL; give it a moment.
    const t = setTimeout(async () => {
      if (decided) return;
      const { data: s } = await sb.auth.getSession();
      setStatus(s.session ? "ready" : "invalid");
    }, 1200);
    return () => { clearTimeout(t); data.subscription.unsubscribe(); };
  }, []);

  if (status === "checking") return <Splash label="Verifying your link…" />;

  if (status === "invalid") {
    return (
      <AuthShell title="Link expired" subtitle="This reset link is invalid or has already been used."
        footer={<p className="mm-auth-foot-text"><Link href="/login" className="mm-link">Back to login</Link></p>}>
        <Link href="/forgot" className="mm-btn mm-btn--primary mm-btn--block"><span className="mm-btn-label">Send a new link</span></Link>
      </AuthShell>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const next: typeof errors = {};
    const pw = validatePassword(password);
    if (pw) next.password = pw;
    if (confirm !== password) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) { setError(friendlyError(error)); setLoading(false); return; }
    router.replace("/app");
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Make it something you haven't used before.">
      <form className="mm-form" onSubmit={onSubmit} noValidate>
        <PasswordField label="New Password" icon="lock" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} showStrength autoFocus />
        <PasswordField label="Confirm New Password" icon="lock" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Alert>{error}</Alert>
        <Button type="submit" loading={loading} block>{loading ? "Saving…" : "Save password & continue"}</Button>
      </form>
    </AuthShell>
  );
}
