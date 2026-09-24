export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(n: number): string {
  const v = round2(n);
  return "৳" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Same as formatCurrency but with an ASCII prefix — jsPDF's built-in fonts have no ৳ glyph. */
export function formatCurrencyAscii(n: number): string {
  return formatCurrency(n).replace("৳", "Tk ");
}

export function formatNumber(n: number, decimals = 0): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Quantities print with one decimal only when they have one (legacy behaviour). */
export function formatQty(n: number): string {
  return formatNumber(n, n % 1 ? 1 : 0);
}

export function initials(name: string): string {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
