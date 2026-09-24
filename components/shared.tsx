import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber, initials } from "@/lib/format";
import { currentMonthKey, dateLabelLong, monthLabel, shiftDate, shiftMonth, todayKey } from "@/lib/dates";

type Tone = "navy" | "success" | "danger" | "warning" | "gray";
const ICON_TONE: Record<Tone, string> = {
  navy: "bg-navy-900 text-white ring-1 ring-white/20",
  success: "bg-success-100 text-success-700",
  danger: "bg-danger-100 text-danger-700",
  warning: "bg-warning-100 text-warning-700",
  gray: "bg-gray-100 text-gray-500",
};

/** Navy-gradient stat tile (legacy statCard). */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "navy",
  prefix = "",
  suffix = "",
  decimals = 0,
  href,
  helper,
  compact,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: Tone;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  href?: string;
  helper?: string;
  compact?: boolean;
}) {
  const shown = decimals ? formatNumber(value, decimals) : formatNumber(Math.round(value * 100) / 100, value % 1 ? 2 : 0);
  const negative = value < 0;
  const body = (
    <div
      className={cn(
        "stat-card-bg group relative flex h-full flex-col text-white shadow-[var(--shadow-card)] animate-slide-up",
        compact ? "gap-2 rounded-xl p-3.5" : "gap-3 rounded-2xl p-5",
        href && "card-lift",
      )}
    >
      <span className={cn("flex items-center justify-center rounded-xl", compact ? "h-8 w-8" : "h-10 w-10", ICON_TONE[tone])}>
        <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className={cn("truncate font-semibold tracking-tight tabular-nums", compact ? "text-lg" : "text-2xl")}>
          {negative ? "−" : ""}
          {prefix}
          {negative ? shown.replace("-", "") : shown}
          {suffix}
        </p>
        <p className={cn("font-medium text-white/70", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")}>{label}</p>
      </div>
      {helper ? <p className="text-xs text-white/50">{helper}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-gray-100/40 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-900">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
    </div>
  );
}

export function Avatar({
  name,
  pictureUrl,
  color = "#888",
  size = "md",
}: {
  name: string;
  pictureUrl?: string | null;
  color?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-14 w-14 text-base" : "h-9 w-9 text-xs";
  if (pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- data-URL avatars
    return <img src={pictureUrl} alt={name} className={cn(dims, "shrink-0 rounded-full object-cover")} />;
  }
  return (
    <span
      className={cn(dims, "flex shrink-0 items-center justify-center rounded-full font-semibold text-white")}
      style={{ background: color }}
      aria-hidden
    >
      {initials(name) || "?"}
    </span>
  );
}

function hrefWith(base: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

const pillNav =
  "flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-card)]";
const arrowBtn = "rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground";
const jumpBtn =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-navy-900 shadow-[var(--shadow-card)] transition-colors hover:bg-navy-50";

/** Prev / next month links. `extra` params are preserved (e.g. search). */
export function MonthSwitcher({ month, basePath, extra = {} }: { month: string; basePath: string; extra?: Record<string, string | undefined> }) {
  const latest = currentMonthKey();
  return (
    <div className="flex items-center gap-2">
      <div className={pillNav}>
        <Link href={hrefWith(basePath, { ...extra, month: shiftMonth(month, -1) })} className={arrowBtn} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-[8.5rem] text-center text-sm font-semibold text-foreground">{monthLabel(month)}</span>
        <Link href={hrefWith(basePath, { ...extra, month: shiftMonth(month, 1) })} className={arrowBtn} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {month !== latest ? (
        <Link href={hrefWith(basePath, { ...extra, month: latest })} className={jumpBtn}>
          Latest
        </Link>
      ) : null}
    </div>
  );
}

export function DateSwitcher({ date, basePath }: { date: string; basePath: string }) {
  const today = todayKey();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={pillNav}>
        <Link href={hrefWith(basePath, { date: shiftDate(date, -1) })} className={arrowBtn} aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-[10.5rem] text-center text-sm font-semibold text-foreground">{dateLabelLong(date)}</span>
        <Link href={hrefWith(basePath, { date: shiftDate(date, 1) })} className={arrowBtn} aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {date !== today ? (
        <Link href={hrefWith(basePath, { date: today })} className={jumpBtn}>
          Today
        </Link>
      ) : null}
    </div>
  );
}

export { hrefWith };
