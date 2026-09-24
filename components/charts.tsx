"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, CHART_OTHER_COLOR } from "@/lib/constants";
import { formatCurrency } from "@/lib/format";

const AXIS = { stroke: "#98a2b3", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid #e4e7ec",
  boxShadow: "0 8px 24px #0b1f4b24",
  fontSize: 13,
  padding: "8px 12px",
};
const shortMoney = (v: number) => (Math.abs(v) >= 1000 ? `৳${Math.round(v / 100) / 10}k` : `৳${v}`);

/** Who added money vs who spent money, per member (same money scale -> one axis). */
export function MemberMoneyChart({ data }: { data: { name: string; deposited: number; spent: number }[] }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        <LegendDot color={CHART_COLORS[0]} label="Money added" />
        <LegendDot color={CHART_COLORS[1]} label="Money spent (bazar)" />
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#eef0f3" />
            <XAxis dataKey="name" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={shortMoney} width={56} />
            <Tooltip
              cursor={{ fill: "#f2f5fb" }}
              contentStyle={tooltipStyle}
              formatter={(v, key) => [formatCurrency(Number(v)), key === "deposited" ? "Money added" : "Money spent"]}
            />
            <Bar dataKey="deposited" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
            <Bar dataKey="spent" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Daily bazar spending for the elapsed days of the month (single series, no legend box). */
export function DailySpendChart({ data }: { data: { day: number; date: string; amount: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis dataKey="day" {...AXIS} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...AXIS} tickFormatter={shortMoney} width={56} />
          <Tooltip
            cursor={{ fill: "#f2f5fb" }}
            contentStyle={tooltipStyle}
            labelFormatter={(_, p) => (p?.[0]?.payload?.date as string) ?? ""}
            formatter={(v) => [formatCurrency(Number(v)), "Spent"]}
          />
          <Bar dataKey="amount" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Donut with a value list beside it (the list doubles as the table view and
 * the always-visible labels). More than 7 slices fold into "Other".
 */
export function ShareDonut({
  data,
  centerLabel,
  centerValue,
  emptyText = "No data yet.",
}: {
  data: { name: string; value: number }[];
  centerLabel: string;
  centerValue: string;
  emptyText?: string;
}) {
  const positive = data.filter((d) => d.value > 0);
  const slices =
    positive.length > 7
      ? [...positive.slice(0, 6), { name: "Other", value: positive.slice(6).reduce((s, d) => s + d.value, 0) }]
      : positive;
  const total = slices.reduce((s, d) => s + d.value, 0);
  const colorAt = (i: number, name: string) => (name === "Other" ? CHART_OTHER_COLOR : CHART_COLORS[i % CHART_COLORS.length]);

  if (!total) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s, i) => (
                <Cell key={s.name} fill={colorAt(i, s.name)} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [formatCurrency(Number(v)), String(n)]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-bold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-[11px] text-muted">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-3">
        {slices.map((s, i) => {
          const pct = Math.round((s.value / total) * 1000) / 10;
          const color = colorAt(i, s.name);
          return (
            <li key={s.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  {formatCurrency(s.value)} · {pct}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
