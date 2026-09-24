"use client";

import * as React from "react";
import Link from "next/link";
import { Lock, Mail, MailCheck, User } from "lucide-react";
import { signInAction, signUpAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { FormError, Label } from "@/components/ui/form";

function IconInput({
  icon: Icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        {...props}
        className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3.5 text-sm text-foreground placeholder:text-muted transition-all focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20"
      />
    </div>
  );
}

function isRedirect(err: unknown) {
  return typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [error, setError] = React.useState(initialError ?? "");
  const [pending, start] = React.useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    start(async () => {
      try {
        const res = await signInAction({ email: String(fd.get("email")), password: String(fd.get("password")), next });
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        if (isRedirect(err)) throw err;
        setError("Could not reach the server. Please try again.");
      }
    });
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <IconInput icon={Mail} id="email" name="email" type="email" required autoComplete="email" placeholder="you@mealmate.app" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <IconInput icon={Lock} id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
        </div>
        <FormError message={error} />
        <Button type="submit" className="h-11 w-full rounded-xl" loading={pending}>
          Sign In
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-navy-900 hover:underline">
          Sign up
        </Link>
      </p>
    </>
  );
}

export function SignupForm() {
  const [error, setError] = React.useState("");
  const [sentTo, setSentTo] = React.useState("");
  const [pending, start] = React.useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    setError("");
    start(async () => {
      try {
        const res = await signUpAction({ name: String(fd.get("name")), email, password: String(fd.get("password")) });
        if (!res.ok) setError(res.error);
        else if (res.data.needsConfirmation) setSentTo(email);
      } catch (err) {
        if (isRedirect(err)) throw err;
        setError("Could not reach the server. Please try again.");
      }
    });
  }

  if (sentTo) {
    return (
      <div className="mt-7 flex flex-col items-center gap-3 rounded-xl bg-navy-50 p-5 text-center">
        <MailCheck className="h-8 w-8 text-navy-900" />
        <p className="text-sm text-foreground">
          We sent a confirmation link to <span className="font-semibold">{sentTo}</span>. Open it to activate your account, then sign in.
        </p>
        <Link href="/login" className="text-sm font-semibold text-navy-900 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <div>
          <Label htmlFor="name">Full Name</Label>
          <IconInput icon={User} id="name" name="name" required autoComplete="name" placeholder="Your name" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <IconInput icon={Mail} id="email" name="email" type="email" required autoComplete="email" placeholder="you@mealmate.app" />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <IconInput
            icon={Lock}
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="At least 6 characters"
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="h-11 w-full rounded-xl" loading={pending}>
          Create Account
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-navy-900 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
