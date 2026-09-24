import { requireProfile } from "@/lib/auth";
import { listShoppingItems } from "@/services/shopping";
import { PageHeader } from "@/components/ui/card";
import { ShoppingView } from "@/components/shopping/shopping-view";

export const metadata = { title: "Shopping List" };

export default async function ShoppingListPage() {
  const profile = await requireProfile();
  const items = await listShoppingItems(profile.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Shopping List" description="Unchecked items stay on the list until you buy or remove them." />
      <ShoppingView items={items} />
    </div>
  );
}
