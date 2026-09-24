/**
 * Date helpers. All app dates are plain "YYYY-MM-DD" day keys and "YYYY-MM"
 * month keys (same as the legacy app). "Today" is computed in APP_TIMEZONE
 * rather than the server clock, so meal days roll over at local midnight even
 * when the server runs in UTC.
 */

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Dhaka";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && DAY_KEY_RE.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
}
export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && MONTH_KEY_RE.test(v);
}

export function todayKey(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function currentMonthKey(): string {
  return monthKeyOf(todayKey());
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}
export function inMonth(dateKey: string, monthKey: string): boolean {
  return monthKeyOf(dateKey) === monthKey;
}

export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function eachDateInMonth(monthKey: string): string[] {
  const n = daysInMonth(monthKey);
  return Array.from({ length: n }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
}
/** Dates of the month that are not in the future (legacy rule for meal counting). */
export function elapsedDatesInMonth(monthKey: string, today = todayKey()): string[] {
  return eachDateInMonth(monthKey).filter((d) => d <= today);
}
export function monthStartKey(monthKey: string): string {
  return `${monthKey}-01`;
}
export function monthEndKey(monthKey: string): string {
  return `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, "0")}`;
}

export function shiftDate(dateKey: string, delta: number): string {
  const d = new Date(dateKey + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Postgres DATE <-> day key. Prisma returns DATE columns as UTC-midnight Dates. */
export function toDbDate(dateKey: string): Date {
  return new Date(dateKey + "T00:00:00.000Z");
}
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Half-open [start, end) DB range covering a month. */
export function monthDbRange(monthKey: string): { gte: Date; lt: Date } {
  return { gte: toDbDate(monthStartKey(monthKey)), lt: toDbDate(monthStartKey(shiftMonth(monthKey, 1))) };
}

const utc = (dateKey: string) => new Date(dateKey + "T00:00:00.000Z");

export function monthLabel(monthKey: string): string {
  return utc(monthKey + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
export function dateLabelShort(dateKey: string): string {
  return utc(dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function dateLabelMed(dateKey: string): string {
  return utc(dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function dateLabelLong(dateKey: string): string {
  return utc(dateKey).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Good Night";
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  if (hour < 21) return "Good Evening";
  return "Good Night";
}
export function currentHourInAppTz(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(now));
}
