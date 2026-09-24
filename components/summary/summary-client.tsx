"use client";

import * as React from "react";
import { ChevronDown, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadSummaryPdf } from "@/lib/pdf/summary-pdf";
import { dateLabelMed, monthLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SummaryReport } from "@/services/summary";

export function SummaryActions({ report }: { report: SummaryReport }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="no-print flex gap-2">
      <Button variant="secondary" onClick={() => window.print()}>
        <Printer /> Print
      </Button>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadSummaryPdf(report);
            toast.success("PDF downloaded.");
          } catch {
            toast.error("Couldn't generate the PDF. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download /> Download PDF
      </Button>
    </div>
  );
}

/** Member row with an expandable day-by-day meal breakdown (always expanded when printing). */
export function MemberDetails({
  name,
  month,
  days,
  children,
}: {
  name: string;
  month: string;
  days: SummaryReport["daily"][string];
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <li className="print-break-avoid">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        {children}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="no-print inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-navy-50"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /> Details
        </button>
      </div>
      <div className={cn("bg-gray-100/40 px-4 py-4 sm:px-5", open ? "block" : "hidden print:block")}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {name} — Day-by-Day Meal Breakdown ({monthLabel(month)})
        </p>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2">Date</th>
                <th className="px-3 py-2 text-center">Breakfast</th>
                <th className="px-3 py-2 text-center">Lunch</th>
                <th className="px-3 py-2 text-center">Dinner</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-muted">{dateLabelMed(d.date)}</td>
                  <td className="px-3 py-2 text-center">{d.breakfast ? "Yes" : "—"}</td>
                  <td className="px-3 py-2 text-center">{d.lunch ? "Yes" : "—"}</td>
                  <td className="px-3 py-2 text-center">{d.dinner ? "Yes" : "—"}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </li>
  );
}
