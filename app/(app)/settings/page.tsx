import { requireProfile } from "@/lib/auth";
import { PageHeader } from "@/components/ui/card";
import { DangerZone, LegacyImport, PasswordForm, ProfileForm } from "@/components/settings/settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Profile & Settings" description="Update your name, picture and password, or import old data." />
      <ProfileForm name={profile.name} email={profile.email} avatarUrl={profile.avatarUrl} />
      <PasswordForm />
      <LegacyImport />
      <DangerZone />
    </div>
  );
}
