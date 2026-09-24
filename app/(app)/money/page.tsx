import { Coins, TrendingUp, Users, Wallet } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentMonthKey, isMonthKey, monthLabel } from "@/lib/dates";
import { listDepositsForMonth } from "@/services/deposits";
import { listActiveMembers, listMembers } from "@/services/members";
import { getSettlementSummary } from "@/services/settlement";
import { PageHeader } from "@/components/ui/card";
import { MonthSwitcher, StatCard } from "@/components/shared";
import { MoneyView } from "@/components/money/money-view";

export const metadata = { title: "Money" };

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ month?: string; q?: string }> }) {
  const { month: m, q = "" } = await searchParams;
  const month = isMonthKey(m) ? m : currentMonthKey();
  const profile = await requireProfile();
  const [deposits, members, active, summary] = await Promise.all([
    listDepositsForMonth(profile.id, month, q),
    listMembers(profile.id),
    listActiveMembers(profile.id),
    getSettlementSummary(profile.id, month),
  ]);
  const total = deposits.reduce((s, d) => s + d.amount, 0);
  const depositors = new Set(deposits.map((d) => d.memberId)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Money Added"
        description={`Deposits recorded in ${monthLabel(month)}.`}
        actions={<MonthSwitcher month={month} basePath="/money" extra={{ q }} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Money Added" value={total} prefix="৳" icon={Wallet} tone="success" compact />
        <StatCard label="Deposits" value={deposits.length} icon={Coins} compact />
        <StatCard label="Average Deposit" value={deposits.length ? total / deposits.length : 0} prefix="৳" icon={TrendingUp} tone="gray" compact />
        <StatCard label="Depositors" value={depositors} icon={Users} tone="warning" compact />
      </div>
      <MoneyView
        month={month}
        deposits={deposits}
        members={members}
        activeMembers={active}
        breakdown={summary.members}
        totalPaid={summary.totalPaid}
        search={q}
      />
    </div>
  );
}
