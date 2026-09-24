"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { closeSettlementMonthAction } from "@/app/actions/settlement";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { useAction } from "@/components/client-shared";
import { dateLabelMed, monthLabel, shiftMonth } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CarryChoice, SettlementClosingDTO, SettlementMemberRow } from "@/types";

export function CloseMonthButton({
  month,
  members,
  closing,
}: {
  month: string;
  members: SettlementMemberRow[];
  closing: SettlementClosingDTO | null;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = React.useState(false);
  const withBalance = members.filter((m) => m.balance > 0.01);
  const initial = () =>
    Object.fromEntries(
      withBalance.map((m) => [m.memberId, closing?.decisions.find((d) => d.memberId === m.memberId)?.choice ?? ("paid" as CarryChoice)]),
    );
  const [choices, setChoices] = React.useState<Record<string, CarryChoice>>(initial);

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setChoices(initial());
          setOpen(true);
        }}
      >
        <ShieldCheck /> {closing ? "Re-close Month" : "Close Month"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={closing ? "Re-finalize Settlement" : "Close Month / Finalize Settlement"}>
        <p className="text-sm text-muted">
          {closing
            ? `${monthLabel(month)} was finalized on ${dateLabelMed(closing.finalizedAt.slice(0, 10))}. Finalizing again overwrites the saved snapshot and replaces any carried-forward deposits.`
            : `This saves a snapshot of the ${monthLabel(month)} settlement — bazar cost, meals, meal rate, balances and transfers — so the numbers stay preserved even if data changes later.`}
        </p>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-foreground">Leftover Balances</h3>
        <p className="mb-3 text-sm text-muted">
          These members paid more than their meal cost. Choose <b className="text-foreground">Paid</b> (settled, nothing carries) or{" "}
          <b className="text-foreground">Carry Forward</b> (added as a deposit on the 1st of {monthLabel(shiftMonth(month, 1))}).
        </p>
        {withBalance.length === 0 ? (
          <p className="text-sm text-muted">No one has a leftover balance this month — nothing to decide.</p>
        ) : (
          <div className="max-h-[16rem] space-y-2 overflow-y-auto">
            {withBalance.map((m) => (
              <div key={m.memberId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                  <p className="text-xs text-muted">Balance: +{formatCurrency(m.balance)}</p>
                </div>
                <div className="flex gap-1.5" role="radiogroup" aria-label={`${m.name} leftover balance`}>
                  {(["paid", "carry"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={choices[m.memberId] === c}
                      onClick={() => setChoices({ ...choices, [m.memberId]: c })}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        choices[m.memberId] === c ? "border-navy-900 bg-navy-900 text-white" : "border-border text-foreground hover:bg-gray-100",
                      )}
                    >
                      {c === "paid" ? "Paid" : "Carry Forward"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5">
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                if (await run(() => closeSettlementMonthAction({ month, choices }), { success: `Settlement for ${monthLabel(month)} finalized.` }))
                  setOpen(false);
              }}
            >
              {closing ? "Re-finalize" : "Close Month"}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
