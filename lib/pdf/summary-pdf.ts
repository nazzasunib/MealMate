import type { jsPDF as JsPDF } from "jspdf";
import { dateLabelMed, monthLabel } from "@/lib/dates";
import { formatCurrencyAscii as tk, formatNumber } from "@/lib/format";
import { balanceStatus } from "@/lib/calculations";
import type { SummaryReport } from "@/services/summary";

/**
 * Native (vector) PDF of the monthly Summary, ported from the legacy
 * downloadSummaryPdf(). Two passes: first compute which page every section
 * starts on, then draw - so "View Details" / "< Back to Summary" are real
 * clickable internal links (pdf.link with a target page).
 */
const M = 40;
const ROW = 18;
const HEAD = 22;
const FIRST_ROW_STD = 36 + 4 + 18 + HEAD; // back link + heading + header row
const FIRST_ROW_MEMBER = 36 + 4 + 18 + 24 + HEAD; // + month label line
const CONT_TOP = 40;
const CONT_FIRST_ROW = CONT_TOP + HEAD;

const statusLabel = (b: number) =>
  balanceStatus(b) === "receive" ? `Will Receive ${tk(b)}` : balanceStatus(b) === "pay" ? `Needs to Pay ${tk(Math.abs(b))}` : "Settled";

function pagesFor(rows: number, pageH: number, firstRowY: number) {
  const bottom = pageH - M;
  const first = Math.max(1, Math.floor((bottom - (M + firstRowY)) / ROW));
  const cont = Math.max(1, Math.floor((bottom - (M + CONT_FIRST_ROW)) / ROW));
  return rows <= first ? 1 : 1 + Math.ceil((rows - first) / cont);
}

function plan(r: SummaryReport, pageH: number) {
  let page = 1; // executive summary
  const memberPage = ++page;
  page += pagesFor(r.settlement.members.length, pageH, FIRST_ROW_STD) - 1;
  const memberDetailPage: Record<string, number> = {};
  for (const mem of r.settlement.members) {
    memberDetailPage[mem.memberId] = ++page;
    page += pagesFor((r.daily[mem.memberId] ?? []).length, pageH, FIRST_ROW_MEMBER) - 1;
  }
  const expensePage = ++page;
  page += pagesFor(r.expenses.length + 1, pageH, FIRST_ROW_STD) - 1;
  const depositPage = ++page;
  return { memberPage, memberDetailPage, expensePage, depositPage };
}

type Col = { label: string; w: number; right?: boolean };

export async function downloadSummaryPdf(r: SummaryReport) {
  const { jsPDF } = await import("jspdf");
  const pdf: JsPDF = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const CW = W - M * 2;
  const bottom = H - M;
  const s = r.settlement;
  const p = plan(r, H);
  const title = "MealMate - Monthly Summary Report";

  const gray = (v: number) => pdf.setDrawColor(v, v, v);
  const pageHeader = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(title, M, 24);
    pdf.text("Page " + pdf.getNumberOfPages(), W - M, 24, { align: "right" });
    gray(210);
    pdf.setLineWidth(0.75);
    pdf.line(M, 30, W - M, 30);
    pdf.setTextColor(0, 0, 0);
  };
  const backLink = () => {
    const y = M + 6;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(11, 31, 75);
    const label = "< Back to Summary";
    pdf.text(label, M, y + 20);
    pdf.link(M, y + 11, pdf.getTextWidth(label), 12, { pageNumber: 1 });
    pdf.setTextColor(0, 0, 0);
    return y + 30;
  };
  const heading = (text: string, y: number) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(11, 31, 75);
    pdf.text(text, M, y);
    pdf.setTextColor(0, 0, 0);
    return y + 18;
  };
  const headerRow = (cols: Col[], y: number) => {
    pdf.setFillColor(243, 244, 246);
    pdf.rect(M, y - 13, CW, HEAD, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(90, 90, 90);
    let x = M + 6;
    for (const c of cols) {
      pdf.text(c.label, c.right ? x + c.w - 6 : x, y, { align: c.right ? "right" : "left" });
      x += c.w;
    }
    pdf.setTextColor(0, 0, 0);
    gray(220);
    pdf.setLineWidth(0.5);
    pdf.line(M, y + 5, M + CW, y + 5);
    return y + HEAD;
  };
  const table = (
    cols: Col[],
    rows: string[][],
    startY: number,
    opts: { empty: string; total?: (string | null)[]; links?: (number | null)[] },
  ) => {
    let y = headerRow(cols, startY);
    if (!rows.length) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(140, 140, 140);
      pdf.text(opts.empty, M + CW / 2, y + 20, { align: "center" });
      pdf.setTextColor(0, 0, 0);
      return;
    }
    const newPage = () => {
      pdf.addPage();
      pageHeader();
      y = headerRow(cols, M + CONT_TOP);
    };
    rows.forEach((row, ri) => {
      if (y + ROW > bottom) newPage();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      let x = M + 6;
      row.forEach((cell, i) => {
        const c = cols[i];
        const isLink = opts.links && i === row.length - 1 && opts.links[ri] != null;
        pdf.setTextColor(isLink ? 11 : 0, isLink ? 31 : 0, isLink ? 75 : 0);
        pdf.text(cell, c.right ? x + c.w - 6 : x, y, { align: c.right ? "right" : "left" });
        if (isLink) pdf.link(x - 6, y - 10, c.w, 14, { pageNumber: opts.links![ri]! });
        x += c.w;
      });
      pdf.setTextColor(0, 0, 0);
      gray(235);
      pdf.setLineWidth(0.4);
      pdf.line(M, y + 6, M + CW, y + 6);
      y += ROW;
    });
    if (opts.total) {
      if (y + ROW > bottom) newPage();
      pdf.setFillColor(238, 241, 250);
      pdf.rect(M, y - 12, CW, ROW + 2, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(11, 31, 75);
      let x = M + 6;
      opts.total.forEach((cell, i) => {
        const c = cols[i];
        if (cell !== null) pdf.text(cell, c.right ? x + c.w - 6 : x, y, { align: c.right ? "right" : "left" });
        x += c.w;
      });
      pdf.setTextColor(0, 0, 0);
    }
  };
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 3) + "..." : t);

  /* Page 1: executive summary */
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.setTextColor(11, 31, 75);
  pdf.text("Monthly Summary Report", M, 60);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(60, 60, 60);
  pdf.text(monthLabel(r.month), M, 80);
  pdf.setFontSize(9);
  pdf.setTextColor(130, 130, 130);
  const now = new Date();
  pdf.text(
    `Report generated on: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    M,
    96,
  );
  gray(220);
  pdf.line(M, 108, W - M, 108);

  const tones: Record<string, [number, number, number]> = {
    danger: [220, 38, 38],
    success: [22, 163, 74],
    gray: [107, 114, 128],
    warning: [217, 119, 6],
    navy: [11, 31, 75],
  };
  const cards = [
    { label: "Total Bazar/Meal Cost", value: tk(s.totalBazarCost), tone: "danger", page: p.expensePage },
    { label: "Total Money Deposited", value: tk(s.totalPaid), tone: "success", page: p.depositPage },
    { label: "Total Meals", value: formatNumber(s.totalMeals), tone: "gray", page: p.memberPage },
    { label: "Meal Rate", value: tk(s.mealRate) + " / meal", tone: "warning", page: p.memberPage },
    {
      label: "Available Balance",
      value: (r.availableBalance < 0 ? "-" : "") + tk(Math.abs(r.availableBalance)),
      tone: r.availableBalance < 0 ? "danger" : "navy",
      page: p.memberPage,
    },
  ];
  const gap = 14;
  const cardW = (CW - gap * 2) / 3;
  const cardH = 62;
  cards.forEach((c, i) => {
    const cx = M + (i % 3) * (cardW + gap);
    const cy = 130 + Math.floor(i / 3) * (cardH + gap);
    const [cr, cg, cb] = tones[c.tone];
    gray(225);
    pdf.setLineWidth(0.75);
    pdf.rect(cx, cy, cardW, cardH);
    pdf.setFillColor(cr, cg, cb);
    pdf.rect(cx, cy, 3, cardH, "F");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(c.label.toUpperCase(), cx + 12, cy + 16);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14.5);
    pdf.setTextColor(20, 20, 20);
    pdf.text(c.value, cx + 12, cy + 36);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(11, 31, 75);
    pdf.text("View Details >", cx + 12, cy + 50);
    pdf.link(cx, cy, cardW, cardH, { pageNumber: c.page });
  });

  /* Member breakdown */
  pdf.addPage();
  pageHeader();
  let y = heading(`2. Member Breakdown - ${monthLabel(r.month)}`, backLink() + 4);
  table(
    [
      { label: "NAME", w: CW * 0.18 },
      { label: "TOTAL PAID", w: CW * 0.12, right: true },
      { label: "MEALS", w: CW * 0.08, right: true },
      { label: "MEAL COST", w: CW * 0.12, right: true },
      { label: "BALANCE", w: CW * 0.13, right: true },
      { label: "STATUS", w: CW * 0.3 },
      { label: "DETAILS", w: CW * 0.07 },
    ],
    s.members.map((m) => [
      clip(m.name, 18),
      tk(m.paid),
      formatNumber(m.meals),
      tk(m.mealCost),
      (m.balance > 0 ? "+" : m.balance < 0 ? "-" : "") + tk(Math.abs(m.balance)),
      statusLabel(m.balance),
      "View >",
    ]),
    y,
    { empty: "No active members", links: s.members.map((m) => p.memberDetailPage[m.memberId]) },
  );

  /* Per-member daily meals */
  for (const m of s.members) {
    pdf.addPage();
    pageHeader();
    y = heading(`${m.name} - Day-by-Day Meal Breakdown`, backLink() + 4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(90, 90, 90);
    pdf.text(monthLabel(r.month), M, y + 2);
    pdf.setTextColor(0, 0, 0);
    table(
      [
        { label: "DATE", w: CW * 0.3 },
        { label: "BREAKFAST", w: CW * 0.2 },
        { label: "LUNCH", w: CW * 0.18 },
        { label: "DINNER", w: CW * 0.17 },
        { label: "TOTAL", w: CW * 0.15, right: true },
      ],
      (r.daily[m.memberId] ?? []).map((d) => [
        dateLabelMed(d.date),
        d.breakfast ? "Yes" : "-",
        d.lunch ? "Yes" : "-",
        d.dinner ? "Yes" : "-",
        String(d.total),
      ]),
      y + 24,
      { empty: "No days recorded yet" },
    );
  }

  /* Expenses */
  pdf.addPage();
  pageHeader();
  y = heading(`3. Full Expense List - ${monthLabel(r.month)}`, backLink() + 4);
  table(
    [
      { label: "DATE", w: CW * 0.16 },
      { label: "ITEMS", w: CW * 0.42 },
      { label: "BOUGHT BY", w: CW * 0.22 },
      { label: "AMOUNT", w: CW * 0.2, right: true },
    ],
    r.expenses.map((e) => [dateLabelMed(e.date), clip(e.items, 60), clip(e.buyers, 26), "-" + tk(e.amount)]),
    y,
    { empty: "No expenses this month", total: r.expenses.length ? ["Total", null, null, tk(s.totalBazarCost)] : undefined },
  );

  /* Deposits */
  pdf.addPage();
  pageHeader();
  y = heading(`4. Full Deposit List - ${monthLabel(r.month)}`, backLink() + 4);
  table(
    [
      { label: "DATE", w: CW * 0.18 },
      { label: "MEMBER", w: CW * 0.25 },
      { label: "AMOUNT", w: CW * 0.2, right: true },
      { label: "NOTE", w: CW * 0.37 },
    ],
    r.deposits.map((d) => [dateLabelMed(d.date), clip(d.member, 28), "+" + tk(d.amount), clip(d.note || "-", 45)]),
    y,
    { empty: "No deposits this month", total: r.deposits.length ? ["Total", null, tk(s.totalPaid), null] : undefined },
  );

  pdf.save(`MealMate-Summary-${r.month}.pdf`);
}
