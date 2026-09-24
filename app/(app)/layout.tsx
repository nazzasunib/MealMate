import { requireProfile } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return <AppShell profile={{ name: profile.name, avatarUrl: profile.avatarUrl }}>{children}</AppShell>;
}
