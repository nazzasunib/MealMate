"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Trash2, Users, Wallet } from "lucide-react";
import { deleteDepositAction, saveDepositAction } from "@/app/actions/deposits";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Avatar, EmptyState } from "@/components/shared";
import { SearchBox, useAction } from "@/components/client-shared";
import { dateLabelMed, monthLabel, todayKey } from "@/lib/dates";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { DepositDTO, MemberDTO, SettlementMemberRow } from "@/types";

interface Form {
  id?: string;
  memberId: string;
  date: string;
  amount: string;
  note: string;
}

export function MoneyView({
  month,
  deposits,
  members,
  activeMembers,
  breakdown,
  totalPaid,
  search,
}: {
  month: string;
  deposits: DepositDTO[];
  members: MemberDTO[];
  activeMembers: MemberDTO[];
  breakdown: SettlementMemberRow[];
  totalPaid: number;
  search: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const byId = new Map(members.map((m) => [m.id, m]));
  const blank = (): Form => ({ memberId: "", date: todayKey(), amount: "", note: "" });
  const [form, setForm] = React.useState<Form | null>(params.get("add") ? blank() : null);
  const [toDelete, setToDelete] = React.useState<string | null>(null);
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const { pending, run } = useAction();

  function closeForm() {
    setForm(null);
    if (params.get("add")) router.replace(`/money?month=${month}`, { scroll: false });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await run(
      () => saveDepositAction({ id: form.id, memberId: form.memberId, date: form.date, amount: form.amount, note: form.note }),
      { success: form.id ? "Deposit updated." : "Deposit added." },
    );
    if (ok) closeForm();
  }

  // Members selectable in the form: active ones, plus the deposit's own member when editing an old record.
  const selectable = form?.id && !activeMembers.some((m) => m.id === form.memberId) && byId.get(form.memberId)
    ? [...activeMembers, byId.get(form.memberId)!]
    : activeMembers;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm(blank())}>
          <Wallet /> Add Deposit
        </Button>
        <Button variant="secondary" onClick={() => setBreakdownOpen(true)}>
          <Users /> Who Deposited How Much
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title={`Deposit History — ${monthLabel(month)}`} actions={<SearchBox placeholder="Search by member..." />} />
        {deposits.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Wallet}
              title={search ? "No matching deposits" : "No deposits this month"}
              description={search ? "Try a different search term." : "Add a deposit or pick a different month."}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {deposits.map((d) => {
              const m = byId.get(d.memberId);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-gray-100/50 sm:px-5">
                  <Avatar name={m?.name ?? "?"} pictureUrl={m?.pictureUrl} color={m?.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{m?.name ?? "Unknown"}</p>
                    <p className="truncate text-xs text-muted">
                      {dateLabelMed(d.date)}
                      {d.note ? ` · ${d.note}` : ""}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-success-700">+{formatCurrency(d.amount)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit deposit"
                      onClick={() => setForm({ id: d.id, memberId: d.memberId, date: d.date, amount: String(d.amount), note: d.note ?? "" })}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete deposit" className="hover:bg-danger-100 hover:text-danger-600" onClick={() => setToDelete(d.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && closeForm()} title={form?.id ? "Edit Deposit" : "Add Deposit"}>
        {form ? (
          <form onSubmit={save} className="space-y-4" noValidate>
            <Field label="Member" htmlFor="d-member">
              <Select id="d-member" required value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                <option value="" disabled>
                  Select a member
                </option>
                {selectable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date" htmlFor="d-date">
                <Input id="d-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Amount (৳)" htmlFor="d-amount">
                <Input id="d-amount" type="number" inputMode="decimal" min="0" step="any" required placeholder="1000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
            </div>
            <Field label="Note (optional)" htmlFor="d-note">
              <Textarea id="d-note" rows={2} placeholder="e.g. Monthly deposit" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                {form.id ? "Save Changes" : "Add Deposit"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this deposit?"
        description="This will remove the deposit and update the available balance."
        loading={pending}
        onConfirm={async () => {
          if (toDelete && (await run(() => deleteDepositAction(toDelete), { success: "Deposit deleted." }))) setToDelete(null);
        }}
      />

      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen} title="Who Deposited How Much" description={monthLabel(month)}>
        {breakdown.length === 0 ? (
          <EmptyState icon={Users} title="No active members" />
        ) : (
          <div className="space-y-2">
            {[...breakdown]
              .sort((a, b) => b.paid - a.paid)
              .map((r) => (
                <div key={r.memberId} className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={r.name} pictureUrl={r.pictureUrl} color={r.avatarColor} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                      <p className="text-xs text-muted">
                        {formatNumber(r.meals)} meal{r.meals === 1 ? "" : "s"} this month
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-success-700">{formatCurrency(r.paid)}</span>
                </div>
              ))}
            <div className="flex items-center justify-between rounded-xl bg-navy-50 px-4 py-3">
              <span className="text-sm font-semibold text-navy-900">Total Paid</span>
              <span className="text-base font-bold tabular-nums text-navy-900">{formatCurrency(totalPaid)}</span>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
