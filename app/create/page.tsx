"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, Alert, Button, EMAIL_RE, Field, Icon, PasswordField, validatePassword } from "@/components/ui";
import ConfigMissing from "@/components/ConfigMissing";
import Splash from "@/components/Splash";
import { getSupabase, isConfigured, siteOrigin } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { createGroup, getMembership } from "@/lib/group";
import { clearPending, savePending } from "@/lib/pending";
import { useSessionUser } from "@/lib/useSession";

type Errors = Partial<Record<"fullName" | "email" | "password" | "confirm" | "groupName", string>>;

export default function CreatePage() {
  const router = useRouter();
  const session = useSessionUser();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [groupName, setGroupName] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(true);

  const loggedIn = session.status === "in";

  // Someone who already has a MealMate doesn't belong here.
  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "out") { setChecking(false); return; }
    getMembership(getSupabase())
      .then((m) => (m ? router.replace("/app") : setChecking(false)))
      .catch(() => setChecking(false));
    const meta = session.user?.user_metadata;
    if (meta?.full_name) setFullName(String(meta.full_name));
  }, [session.status, session.user, router]);

  if (!isConfigured) return <ConfigMissing />;
  if (session.status === "loading" || (loggedIn && checking)) return <Splash label="Just a moment…" />;

  function validate(): Errors {
    const e: Errors = {};
    if (fullName.trim().length < 2) e.fullName = "Enter your full name.";
    if (groupName.trim().length < 2) e.groupName = "Give your MealMate a name (2–60 characters).";
    else if (groupName.trim().length > 60) e.groupName = "Keep it under 60 characters.";
    if (!loggedIn) {
      if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
      const pw = validatePassword(password);
      if (pw) e.password = pw;
      if (!confirm) e.confirm = "Confirm your password.";
      else if (confirm !== password) e.confirm = "Passwords don't match.";
    }
    return e;
  }

  async function finishCreate() {
    const sb = getSupabase();
    await createGroup(sb, groupName.trim(), fullName.trim());
    clearPending();
    sb.auth.updateUser({ data: { pending_group_name: null } }).catch(() => {});
    router.replace("/app#/dashboard");
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setLoading(true);
    const sb = getSupabase();
    try {
      if (loggedIn) {
        await finishCreate();
        return;
      }
      const cleanEmail = email.trim().toLowerCase();
      savePending({ type: "create", groupName: groupName.trim(), fullName: fullName.trim() });
      const { data, error } = await sb.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { full_name: fullName.trim(), pending_group_name: groupName.trim() },
          emailRedirectTo: siteOrigin() + "/app",
        },
      });
      if (error) throw error;
      // Supabase hides "already registered" by returning a user with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        clearPending();
        throw new Error("User already registered");
      }
      if (data.session) {
        await finishCreate();
        return;
      }
      setSentTo(cleanEmail);
      setLoading(false);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function resend() {
    const { error } = await getSupabase().auth.resend({ type: "signup", email: sentTo, options: { emailRedirectTo: siteOrigin() + "/app" } });
    if (error) setError(friendlyError(error));
    else setResent(true);
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle={<>We sent a confirmation link to <strong>{sentTo}</strong>.</>}>
        <div className="mm-success-orb"><Icon name="mail" size={28} /></div>
        <p className="mm-center-text">Open the link on any device — your <strong>{groupName.trim()}</strong> MealMate will be created automatically and you&apos;ll land on your Admin dashboard.</p>
        <Alert tone="success">{resent ? "Sent again. It can take a minute — check spam too." : ""}</Alert>
        <Alert>{error}</Alert>
        <div className="mm-auth-actions">
          <Button variant="secondary" block onClick={resend} disabled={resent}>Resend email</Button>
          <Link href="/login" className="mm-btn mm-btn--ghost mm-btn--block"><span className="mm-btn-label">Back to login</span></Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your MealMate"
      subtitle={loggedIn ? "Name your mess — you'll be its Admin." : "Set up your mess in under a minute. You'll be the Admin."}
      badge={<span className="mm-step-badge"><Icon name="sparkles" size={14} /> You become the Admin</span>}
      footer={
        loggedIn ? (
          <p className="mm-auth-foot-text">Have an invite instead? <Link href="/join" className="mm-link">Join an existing MealMate</Link></p>
        ) : (
          <p className="mm-auth-foot-text">Already have an account? <Link href="/login" className="mm-link">Log in</Link> · <Link href="/join" className="mm-link">Join with a code</Link></p>
        )
      }
    >
      <form className="mm-form" onSubmit={onSubmit} noValidate>
        <Field label="Full Name" icon="user" autoComplete="name" placeholder="e.g. Nazzas Ahmed" value={fullName}
          onChange={(e) => setFullName(e.target.value)} error={errors.fullName} maxLength={80} autoFocus />
        {!loggedIn && (
          <>
            <Field label="Email" icon="mail" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
            <div className="mm-grid-2">
              <PasswordField label="Password" icon="lock" autoComplete="new-password" placeholder="8+ characters" value={password}
                onChange={(e) => setPassword(e.target.value)} error={errors.password} showStrength />
              <PasswordField label="Confirm Password" icon="lock" autoComplete="new-password" placeholder="Repeat password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
            </div>
          </>
        )}
        <Field label="MealMate Name" icon="home" placeholder="e.g. Dhaka MealMate" value={groupName}
          onChange={(e) => setGroupName(e.target.value)} error={errors.groupName} maxLength={60}
          hint="This is what members see when they join." />
        <Alert>{error}</Alert>
        <Button type="submit" loading={loading} block>{loading ? "Creating your MealMate…" : "Create MealMate"}</Button>
      </form>
    </AuthShell>
  );
}
