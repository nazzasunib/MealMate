"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, Alert, Button, EMAIL_RE, Field, Icon, PasswordField, validatePassword } from "@/components/ui";
import ConfigMissing from "@/components/ConfigMissing";
import Splash from "@/components/Splash";
import { getSupabase, isConfigured, siteOrigin } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";
import { getMembership, joinGroup, previewInvite } from "@/lib/group";
import { clearPending, isValidCodeShape, normalizeCode, savePending } from "@/lib/pending";
import { useSessionUser } from "@/lib/useSession";

type Preview = { group_name: string; enabled: boolean; code: string };

export default function JoinFlow({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const session = useSessionUser();
  const loggedIn = session.status === "in";

  const [codeInput, setCodeInput] = useState(initialCode ? normalizeCode(initialCode) : "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [existingGroup, setExistingGroup] = useState<string | null>(null);

  const [tab, setTab] = useState<"register" | "login">("register");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const autoChecked = useRef(false);

  const checkCode = useCallback(async (raw: string) => {
    const code = normalizeCode(raw);
    setCodeError("");
    setPreview(null);
    if (!isValidCodeShape(code)) {
      setCodeError("Invite codes look like MM-7K29PX (6 letters/numbers after MM-).");
      return;
    }
    setCheckingCode(true);
    try {
      const p = await previewInvite(getSupabase(), code);
      if (!p) setCodeError("That invite code doesn't exist. Check the code and try again.");
      else if (!p.enabled) setCodeError("This MealMate isn't accepting new members right now. Ask the Admin to turn invites back on.");
      else setPreview(p);
    } catch (err) {
      setCodeError(friendlyError(err));
    } finally {
      setCheckingCode(false);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured || autoChecked.current || !initialCode) return;
    autoChecked.current = true;
    checkCode(initialCode);
  }, [initialCode, checkCode]);

  // Already in a MealMate? Tell them instead of letting the join fail later.
  useEffect(() => {
    if (!loggedIn) { setExistingGroup(null); return; }
    getMembership(getSupabase()).then((m) => setExistingGroup(m ? m.group_name : null)).catch(() => {});
  }, [loggedIn]);

  if (!isConfigured) return <ConfigMissing />;
  if (session.status === "loading") return <Splash label="Just a moment…" />;

  async function doJoin(code: string) {
    const sb = getSupabase();
    await joinGroup(sb, code);
    clearPending();
    sb.auth.updateUser({ data: { pending_invite_code: null } }).catch(() => {});
    router.replace("/app#/dashboard");
  }

  async function joinAsCurrentUser() {
    if (!preview) return;
    setError("");
    setLoading(true);
    try {
      await doJoin(preview.code);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function onAuthSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!preview) return;
    setError("");
    const e: Record<string, string> = {};
    if (tab === "register" && fullName.trim().length < 2) e.fullName = "Enter your full name.";
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
    if (tab === "register") {
      const pw = validatePassword(password);
      if (pw) e.password = pw;
      if (!confirm) e.confirm = "Confirm your password.";
      else if (confirm !== password) e.confirm = "Passwords don't match.";
    } else if (!password) e.password = "Enter your password.";
    setErrors(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const sb = getSupabase();
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (tab === "login") {
        const { error } = await sb.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        await doJoin(preview.code);
        return;
      }
      savePending({ type: "join", code: preview.code });
      const { data, error } = await sb.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { full_name: fullName.trim(), pending_invite_code: preview.code }, emailRedirectTo: siteOrigin() + "/app" },
      });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        clearPending();
        setTab("login");
        throw new Error("User already registered");
      }
      if (data.session) {
        await doJoin(preview.code);
        return;
      }
      setSentTo(cleanEmail);
      setLoading(false);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  if (sentTo && preview) {
    return (
      <AuthShell title="Check your email" subtitle={<>We sent a confirmation link to <strong>{sentTo}</strong>.</>}>
        <div className="mm-success-orb"><Icon name="mail" size={28} /></div>
        <p className="mm-center-text">Open it on any device and you&apos;ll join <strong>{preview.group_name}</strong> automatically.</p>
        <Link href="/login" className="mm-btn mm-btn--ghost mm-btn--block"><span className="mm-btn-label">Back to login</span></Link>
      </AuthShell>
    );
  }

  const groupCard = preview && (
    <div className="mm-group-preview stat-card-bg">
      <div className="mm-invite-card-glow" aria-hidden="true" />
      <span className="mm-group-preview-icon"><Icon name="home" size={20} /></span>
      <div className="mm-group-preview-text">
        <p className="mm-group-preview-kicker">You&apos;re invited to join</p>
        <p className="mm-group-preview-name">{preview.group_name}</p>
        <p className="mm-group-preview-code">{preview.code} · You&apos;ll join as a Member</p>
      </div>
      {!initialCode && (
        <button type="button" className="mm-group-preview-change" onClick={() => { setPreview(null); setError(""); }}>Change</button>
      )}
    </div>
  );

  return (
    <AuthShell
      title={preview ? "Join MealMate" : "Join an existing MealMate"}
      subtitle={preview ? undefined : "Enter the invite code your Admin shared with you."}
      footer={
        <p className="mm-auth-foot-text">
          Want your own instead? <Link href="/create" className="mm-link">Create New MealMate</Link>
          {!loggedIn && <> · <Link href="/login" className="mm-link">Login</Link></>}
        </p>
      }
    >
      {!preview && (
        <form className="mm-form" onSubmit={(e) => { e.preventDefault(); checkCode(codeInput); }} noValidate>
          <Field label="Enter MealMate Invite Code" icon="key" placeholder="MM-7K29PX" value={codeInput} className="mm-field--code"
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setCodeInput(v.replace(/[^A-Z0-9-]/g, "").slice(0, 9));
              setCodeError("");
            }}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} error={codeError} autoFocus={!initialCode} />
          <Button type="submit" loading={checkingCode} block>{checkingCode ? "Checking code…" : "Continue"}</Button>
        </form>
      )}

      {preview && groupCard}

      {preview && loggedIn && (
        <div className="mm-form">
          {existingGroup ? (
            <Alert tone="info">
              You&apos;re already in <strong>{existingGroup}</strong>. One account can belong to one MealMate.{" "}
              <Link href="/app" className="mm-link">Open {existingGroup}</Link>
            </Alert>
          ) : (
            <p className="mm-center-text">Signed in as <strong>{session.user?.email}</strong></p>
          )}
          <Alert>{error}</Alert>
          {!existingGroup && (
            <Button onClick={joinAsCurrentUser} loading={loading} block>{loading ? "Joining…" : "Join MealMate"}</Button>
          )}
          <button type="button" className="mm-btn mm-btn--ghost mm-btn--block" onClick={async () => { await getSupabase().auth.signOut(); }}>
            <span className="mm-btn-label">Use a different account</span>
          </button>
        </div>
      )}

      {preview && !loggedIn && (
        <>
          <div className="mm-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? "is-active" : ""} onClick={() => { setTab("register"); setErrors({}); setError(""); }}>Create account</button>
            <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? "is-active" : ""} onClick={() => { setTab("login"); setErrors({}); setError(""); }}>I have an account</button>
            <span className="mm-tabs-ink" data-pos={tab} />
          </div>
          <form className="mm-form" onSubmit={onAuthSubmit} noValidate key={tab}>
            {tab === "register" && (
              <Field label="Full Name" icon="user" autoComplete="name" placeholder="Your name" value={fullName}
                onChange={(e) => setFullName(e.target.value)} error={errors.fullName} maxLength={80} />
            )}
            <Field label="Email" icon="mail" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
            {tab === "register" ? (
              <div className="mm-grid-2">
                <PasswordField label="Password" icon="lock" autoComplete="new-password" placeholder="8+ characters" value={password}
                  onChange={(e) => setPassword(e.target.value)} error={errors.password} showStrength />
                <PasswordField label="Confirm Password" icon="lock" autoComplete="new-password" placeholder="Repeat password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
              </div>
            ) : (
              <PasswordField label="Password" icon="lock" autoComplete="current-password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} error={errors.password} />
            )}
            <Alert>{error}</Alert>
            <Button type="submit" loading={loading} block>
              {loading ? "Joining…" : tab === "register" ? "Create account & Join" : "Login & Join"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
