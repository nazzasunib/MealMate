import { ShoppingCart, Users, Wallet } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { currentMonthKey, dateLabelMed, isMonthKey, monthLabel } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSummaryReport } from "@/services/summary";
import { Card, PageHeader } from "@/components/ui/card";
import { Avatar, EmptyState, MonthSwitcher } from "@/components/shared";
import { MemberDetails, SummaryActions } from "@/components/summary/summary-client";
import { BalanceBadge, signedCurrency } from "@/components/settlement/balance-badge";

export const metadata = { title: "Summary" };

const ACCENT = {
  danger: "border-l-danger-600",
  success: "border-l-success-600",
  gray: "border-l-border",
  warning: "border-l-warning-600",
  navy: "border-l-navy-900",
} as const;

function AccentCard({ label, value, tone, href }: { label: string; value: string; tone: keyof typeof ACCENT; href: string }) {
  return (
    <div className={cn("rounded-xl border border-l-4 border-border bg-surface p-4", ACCENT[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-foreground">{value}</p>
      <a href={href} className="no-print mt-1 inline-block text-xs font-semibold text-navy-900 hover:underline">
        View Details ›
      </a>
    </div>
  );
}

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: m } = await searchParams;
  const month = isMonthKey(m) ? m : currentMonthKey();
  const profile = await requireProfile();
  const r = await getSummaryReport(profile.id, month);
  const s = r.settlement;

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader
          title="Summary"
          description={`A complete printable report for ${monthLabel(month)}.`}
          actions={
            <>
              <MonthSwitcher month={month} basePath="/summary" />
              <SummaryActions report={r} />
            </>
          }
        />
      </div>
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold">Monthly Summary Report</h1>
        <p className="text-sm">{monthLabel(month)}</p>
      </div>

      <section>
        <h2 className="text-[1.05rem] font-bold text-foreground">1. Executive Summary</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <AccentCard label="Total Bazar/Meal Cost" value={formatCurrency(s.totalBazarCost)} tone="danger" href="#summary-expenses" />
          <AccentCard label="Total Money Deposited" value={formatCurrency(s.totalPaid)} tone="success" href="#summary-deposits" />
          <AccentCard label="Total Meals" value={formatNumber(s.totalMeals)} tone="gray" href="#summary-members" />
          <AccentCard label="Meal Rate" value={`${formatCurrency(s.mealRate)} / meal`} tone="warning" href="#summary-members" />
          <AccentCard
            label="Available Balance"
            value={(r.availableBalance < 0 ? "−" : "") + formatCurrency(Math.abs(r.availableBalance))}
            tone={r.availableBalance < 0 ? "danger" : "navy"}
            href="#summary-members"
          />
        </div>
      </section>

      <Card id="summary-members" className="print-break-avoid overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="text-[1.05rem] font-bold text-foreground">2. Member Breakdown</h2>
        </div>
        {s.members.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No active members" />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {s.members.map((mem) => (
              <MemberDetails key={mem.memberId} name={mem.name} month={month} days={r.daily[mem.memberId] ?? []}>
                <div className="flex min-w-40 flex-1 items-center gap-3">
                  <Avatar name={mem.name} pictureUrl={mem.pictureUrl} color={mem.avatarColor} size="sm" />
                  <span className="font-medium text-foreground">{mem.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <span>
                    <span className="text-xs text-muted">Paid </span>
                    <span className="tabular-nums text-success-700">{formatCurrency(mem.paid)}</span>
                  </span>
                  <span>
                    <span className="text-xs text-muted">Meals </span>
                    <span className="tabular-nums">{formatNumber(mem.meals)}</span>
                  </span>
                  <span>
                    <span className="text-xs text-muted">Cost </span>
                    <span className="tabular-nums text-danger-600">{formatCurrency(mem.mealCost)}</span>
                  </span>
                  <span>
                    <span className="text-xs text-muted">Balance </span>
                    <span className="font-semibold tabular-nums">{signedCurrency(mem.balance)}</span>
                  </span>
                </div>
                <BalanceBadge balance={mem.balance} />
              </MemberDetails>
            ))}
          </ul>
        )}
      </Card>

      <Card id="summary-expenses" className="overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="text-[1.05rem] font-bold text-foreground">3. Full Expense List — {monthLabel(month)}</h2>
        </div>
        {r.expenses.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={ShoppingCart} title="No expenses this month" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Items</th>
                  <th className="px-5 py-3">Bought By</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.expenses.map((e) => (
                  <tr key={e.id} className="print-break-avoid border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{dateLabelMed(e.date)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{e.items}</td>
                    <td className="px-5 py-3">{e.buyers}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-danger-600">−{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-navy-50">
                  <td className="px-5 py-3 font-semibold text-navy-900" colSpan={3}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">{formatCurrency(s.totalBazarCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card id="summary-deposits" className="overflow-hidden">
        <div className="border-b border-border p-5">
          <h2 className="text-[1.05rem] font-bold text-foreground">4. Full Deposit List — {monthLabel(month)}</h2>
        </div>
        {r.deposits.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Wallet} title="No deposits this month" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Member</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {r.deposits.map((d) => (
                  <tr key={d.id} className="print-break-avoid border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-muted">{dateLabelMed(d.date)}</td>
                    <td className="px-5 py-3 font-medium text-foreground">{d.member}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-success-700">+{formatCurrency(d.amount)}</td>
                    <td className="px-5 py-3 text-muted">{d.note || "—"}</td>
                  </tr>
                ))}
                <tr className="bg-navy-50">
                  <td className="px-5 py-3 font-semibold text-navy-900" colSpan={2}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-base font-bold tabular-nums text-navy-900">{formatCurrency(s.totalPaid)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
