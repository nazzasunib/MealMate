import { ArrowRight, CircleCheck, Gauge, ShoppingBasket, Users, UtensilsCrossed, Wallet } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentMonthKey, dateLabelMed, isMonthKey, monthLabel } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSettlementClosing, getSettlementSummary } from "@/services/settlement";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Avatar, EmptyState, MonthSwitcher, StatCard } from "@/components/shared";
import { ShareDonut } from "@/components/charts";
import { CloseMonthButton } from "@/components/settlement/close-month-dialog";
import { BalanceBadge, signedCurrency } from "@/components/settlement/balance-badge";

export const metadata = { title: "Settlement" };

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = isMonthKey(m) ? m : currentMonthKey();
  const profile = await requireProfile();
  const [s, closing] = await Promise.all([getSettlementSummary(profile.id, month), getSettlementClosing(profile.id, month)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            Settlement {closing ? <Badge tone="navy">Finalized</Badge> : null}
          </>
        }
        description={`Who paid what, who ate how much, and who owes whom — ${monthLabel(month)}.`}
        actions={<MonthSwitcher month={month} basePath="/settlement" />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Bazar Cost" value={s.totalBazarCost} prefix="৳" icon={ShoppingBasket} tone="danger" compact />
        <StatCard label="Total Paid" value={s.totalPaid} prefix="৳" icon={Wallet} tone="success" compact />
        <StatCard label="Total Meals" value={s.totalMeals} icon={UtensilsCrossed} tone="gray" compact />
        <StatCard label="Meal Rate" value={s.mealRate} decimals={2} prefix="৳" suffix=" / meal" icon={Gauge} tone="warning" compact />
        <StatCard label="Members" value={s.memberCount} icon={Users} compact />
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Member Settlement" description="Balance = total paid − (meals × meal rate)." />
        {s.members.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No active members" description="Add active members to calculate a settlement." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            <li
              aria-hidden
              className="hidden bg-gray-100/60 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:grid md:grid-cols-[1.4fr_repeat(4,1fr)_11rem] md:gap-3"
            >
              <span>Member</span>
              <span className="text-right">Total Paid</span>
              <span className="text-right">Meals</span>
              <span className="text-right">Meal Cost</span>
              <span className="text-right">Balance</span>
              <span className="text-right">Status</span>
            </li>
            {s.members.map((r) => (
              <li key={r.memberId} className="grid gap-3 px-4 py-4 sm:px-5 md:grid-cols-[1.4fr_repeat(4,1fr)_11rem] md:items-center">
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} pictureUrl={r.pictureUrl} color={r.avatarColor} size="sm" />
                  <span className="font-medium text-foreground">{r.name}</span>
                </div>
                <Cell label="Paid" value={formatCurrency(r.paid)} className="text-success-700" />
                <Cell label="Meals" value={formatNumber(r.meals)} />
                <Cell label="Meal Cost" value={formatCurrency(r.mealCost)} className="text-danger-600" />
                <Cell
                  label="Balance"
                  value={signedCurrency(r.balance)}
                  className={cn("font-semibold", r.balance > 0.01 ? "text-success-700" : r.balance < -0.01 ? "text-danger-600" : "text-muted")}
                />
                <div className="md:justify-self-end">
                  <BalanceBadge balance={r.balance} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Meal Cost Share by Member" />
          <div className="p-5">
            <ShareDonut
              data={s.members.map((r) => ({ name: r.name, value: r.mealCost }))}
              centerLabel="Bazar cost"
              centerValue={formatCurrency(s.totalBazarCost)}
              emptyText="No meal cost recorded yet."
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Final Settlement Summary"
            description={closing ? `Finalized ${dateLabelMed(closing.finalizedAt.slice(0, 10))}` : undefined}
            actions={<CloseMonthButton month={month} members={s.members} closing={closing} />}
          />
          <div className="space-y-4 p-5">
            <h3 className="text-sm font-semibold text-foreground">Who Needs to Pay Whom?</h3>
            {s.transfers.length === 0 ? (
              <EmptyState icon={CircleCheck} title="All settled up" description="No transfers are needed for this month." />
            ) : (
              <div className="space-y-2">
                {s.transfers.map((t, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                      <span className="truncate">{t.from}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-label="pays" />
                      <span className="truncate">{t.to}</span>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-navy-900">{formatCurrency(t.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {closing?.decisions.length ? (
              <div className="rounded-xl bg-navy-50 p-4 text-sm">
                <p className="mb-1 font-semibold text-navy-900">Leftover balance decisions</p>
                <ul className="space-y-0.5 text-foreground">
                  {closing.decisions.map((d) => (
                    <li key={d.memberId}>
                      {d.name}: {formatCurrency(d.balance)} — {d.choice === "carry" ? "carried forward to next month" : "marked paid"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between md:block md:text-right">
      <span className="text-xs text-muted md:hidden">{label}</span>
      <span className={cn("tabular-nums", className)}>{value}</span>
    </div>
  );
}
