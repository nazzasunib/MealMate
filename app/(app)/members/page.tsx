import { requireProfile } from "@/lib/auth";
import { listMembers } from "@/services/members";
import { PageHeader } from "@/components/ui/card";
import { MembersView } from "@/components/members/members-view";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const profile = await requireProfile();
  const members = await listMembers(profile.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Members" description="Only active members are available when recording meals or expenses." />
      <MembersView members={members} />
    </div>
  );
}
