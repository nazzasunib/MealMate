import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Sign In" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthCard title="Welcome Back" subtitle="Manage your meals, money and mess smarter.">
      <LoginForm next={next} initialError={error === "confirm" ? "That confirmation link is invalid or expired." : undefined} />
    </AuthCard>
  );
}
