"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, Alert, Button, Divider, EMAIL_RE, Field, LinkButton, PasswordField } from "@/components/ui";
import ConfigMissing from "@/components/ConfigMissing";
import { getSupabase, isConfigured } from "@/lib/supabase";
import { friendlyError } from "@/lib/errors";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    router.prefetch("/app");
    getSupabase().auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/app");
    });
  }, [router]);

  if (!isConfigured) return <ConfigMissing />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const next: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setError(friendlyError(error));
      setLoading(false);
      return;
    }
    router.replace("/app");
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your MealMate to see today’s meals, money and bazar."
      footer={
        <>
          <Divider>New here?</Divider>
          <div className="mm-auth-actions">
            <LinkButton href="/create" icon="home">Create New MealMate</LinkButton>
            <LinkButton href="/join" icon="users">Join Existing MealMate</LinkButton>
          </div>
        </>
      }
    >
      <form className="mm-form" onSubmit={onSubmit} noValidate>
        <Field label="Email" icon="mail" type="email" autoComplete="email" inputMode="email" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
        <PasswordField label="Password" icon="lock" autoComplete="current-password" placeholder="••••••••"
          value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <div className="mm-form-row-end">
          <Link href="/forgot" className="mm-link">Forgot password?</Link>
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" loading={loading} block>
          {loading ? "Logging in…" : "Login"}
        </Button>
      </form>
    </AuthShell>
  );
}
