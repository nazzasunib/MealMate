"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell, Alert, Button, EMAIL_RE, Field, Icon } from "@/components/ui";
import ConfigMissing from "@/components/ConfigMissing";
import { getSupabase, isConfigured, siteOrigin } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!isConfigured) return <ConfigMissing />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!EMAIL_RE.test(email.trim())) { setFieldError("Enter a valid email address."); return; }
    setFieldError("");
    setLoading(true);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: siteOrigin() + "/reset" });
    setLoading(false);
    // Don't reveal whether an account exists; only surface real failures.
    if (error && (error.status === 429 || /fetch|network/i.test(error.message))) { setError(friendlyError(error)); return; }
    setSent(true);
  }

  return (
    <AuthShell
      title={sent ? "Check your email" : "Reset your password"}
      subtitle={sent ? <>If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way.</> : "We'll email you a secure link to choose a new password."}
      footer={<p className="mm-auth-foot-text"><Link href="/login" className="mm-link">Back to login</Link></p>}
    >
      {sent ? (
        <div className="mm-success-orb"><Icon name="check" size={28} /></div>
      ) : (
        <form className="mm-form" onSubmit={onSubmit} noValidate>
          <Field label="Email" icon="mail" type="email" autoComplete="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} error={fieldError} autoFocus />
          <Alert>{error}</Alert>
          <Button type="submit" loading={loading} block>{loading ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
    </AuthShell>
  );
}
