import Link from "next/link";
import { Coffee, Moon, Pencil, Sun, UtensilsCrossed } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { dateLabelMed, isDateKey, monthKeyOf, monthLabel, todayKey } from "@/lib/dates";
import { mealsInDay } from "@/lib/calculations";
import { getDayMeals, getMonthMeals } from "@/services/meals";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Avatar, DateSwitcher, EmptyState, StatCard } from "@/components/shared";
import { MealGrid } from "@/components/meals/meal-grid";
import { cn } from "@/lib/utils";

export const metadata = { title: "Meals" };

export default async function MealsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: q } = await searchParams;
  const date = isDateKey(q) ? q : todayKey();
  const month = monthKeyOf(date);
  const profile = await requireProfile();
  const [day, monthly] = await Promise.all([getDayMeals(profile.id, date), getMonthMeals(profile.id, month)]);

  const totals = day.reduce(
    (a, r) => ({ b: a.b + (r.meal.breakfast ? 1 : 0), l: a.l + (r.meal.lunch ? 1 : 0), d: a.d + (r.meal.dinner ? 1 : 0) }),
    { b: 0, l: 0, d: 0 },
  );
  const monthTotal = monthly.reduce((s, m) => s + m.total, 0);
  const dates = monthly[0]?.days.map((d) => d.date) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meals"
        description="Each member has their own default for Breakfast, Lunch and Dinner (set from Members) — this overrides a day's value manually."
        actions={<DateSwitcher date={date} basePath="/meals" />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Breakfast" value={totals.b} icon={Coffee} tone="warning" compact />
        <StatCard label="Lunch" value={totals.l} icon={Sun} tone="success" compact />
        <StatCard label="Dinner" value={totals.d} icon={Moon} compact />
        <StatCard label="Total Meals" value={totals.b + totals.l + totals.d} icon={UtensilsCrossed} tone="gray" compact />
      </div>

      <MealGrid date={date} rows={day} />

      <Card className="overflow-hidden">
        <CardHeader title={`Monthly Meal Summary — ${monthLabel(month)}`} description="Counted up to today, for active members." />
        {monthly.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={UtensilsCrossed} title="No active members" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 border-b border-border p-5 sm:grid-cols-3 lg:grid-cols-4">
              {monthly.map(({ member, total }) => (
                <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border bg-gray-100/40 px-4 py-3">
                  <Avatar name={member.name} pictureUrl={member.pictureUrl} color={member.avatarColor} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
                    <p className="text-xs text-muted">
                      {total} meal{total === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 rounded-xl border border-navy-900 bg-navy-50/60 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-white">
                  <UtensilsCrossed className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-navy-900">Total</p>
                  <p className="text-xs text-navy-900/70">
                    {monthTotal} meal{monthTotal === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-100">
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2 sm:px-5">Date</th>
                    {monthly.map(({ member }) => (
                      <th key={member.id} className="px-3 py-2 text-right">
                        {member.name}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right sm:px-5">Total</th>
                    <th className="px-4 py-2 text-right sm:px-5">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...dates].reverse().map((d) => {
                    let dayTotal = 0;
                    return (
                      <tr key={d} className={cn("border-b border-border last:border-0 hover:bg-gray-100/50", d === date && "bg-navy-50/50")}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted sm:px-5">{dateLabelMed(d)}</td>
                        {monthly.map(({ member, days }) => {
                          const md = days.find((x) => x.date === d);
                          const t = md ? mealsInDay(md) : 0;
                          dayTotal += t;
                          return (
                            <td key={member.id} className="px-3 py-2.5 text-right tabular-nums">
                              {t}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums sm:px-5">{dayTotal}</td>
                        <td className="px-4 py-2.5 text-right sm:px-5">
                          <Link href={`/meals?date=${d}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-navy-50">
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
