import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/auth-forms";

export const metadata = { title: "Create Account" };

export default function SignupPage() {
  return (
    <AuthCard title="Create Account" subtitle="Join your mess on MealMate.">
      <SignupForm />
    </AuthCard>
  );
}
