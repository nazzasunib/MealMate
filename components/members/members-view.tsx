"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Pencil, RotateCcw, UserPlus, Users } from "lucide-react";
import { saveMemberAction, toggleMemberStatusAction } from "@/app/actions/members";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar, EmptyState } from "@/components/shared";
import { PictureField, useAction, YesNoToggle } from "@/components/client-shared";
import { DEFAULT_MEAL_DEFAULTS, MEAL_TYPES } from "@/lib/constants";
import type { MealDefaults, MemberDTO, MemberStatus } from "@/types";

interface FormState {
  id?: string;
  name: string;
  phone: string;
  email: string;
  pictureUrl: string | null;
  status: MemberStatus;
  defaultMeals: MealDefaults;
  color?: string;
}
const EMPTY: FormState = { name: "", phone: "", email: "", pictureUrl: null, status: "ACTIVE", defaultMeals: { ...DEFAULT_MEAL_DEFAULTS } };

export function MembersView({ members }: { members: MemberDTO[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [form, setForm] = React.useState<FormState | null>(params.get("add") ? EMPTY : null);
  const { pending, run } = useAction();

  function close() {
    setForm(null);
    if (params.get("add")) router.replace("/members", { scroll: false });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = await run(
      () =>
        saveMemberAction({
          id: form.id,
          name: form.name,
          phone: form.phone,
          email: form.email,
          pictureUrl: form.pictureUrl,
          status: form.id ? form.status : undefined,
          defaultMeals: form.defaultMeals,
        }),
      { success: form.id ? "Member updated." : "Member added." },
    );
    if (ok) close();
  }

  const active = members.filter((m) => m.status === "ACTIVE").length;

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setForm({ ...EMPTY })}>
          <UserPlus /> Add Member
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <MiniStat label="Active Members" value={active} />
        <MiniStat label="Total Members" value={members.length} />
      </div>

      <Card className="overflow-hidden">
        {members.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="No members yet" description="Add your first member to get started." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-100/50 sm:px-5">
                <Avatar name={m.name} pictureUrl={m.pictureUrl} color={m.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{m.name}</p>
                  <p className="truncate text-xs text-muted">
                    {[m.phone, m.email].filter(Boolean).join(" · ") || "No contact info"} · Defaults:{" "}
                    {MEAL_TYPES.filter((t) => m.defaultMeals[t]).map((t) => t[0].toUpperCase() + t.slice(1)).join(", ") || "none"}
                  </p>
                </div>
                <Badge tone={m.status === "ACTIVE" ? "success" : "gray"}>{m.status === "ACTIVE" ? "Active" : "Inactive"}</Badge>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${m.name}`}
                    onClick={() =>
                      setForm({
                        id: m.id,
                        name: m.name,
                        phone: m.phone ?? "",
                        email: m.email ?? "",
                        pictureUrl: m.pictureUrl,
                        status: m.status,
                        defaultMeals: m.defaultMeals,
                        color: m.avatarColor,
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    aria-label={m.status === "ACTIVE" ? `Deactivate ${m.name}` : `Reactivate ${m.name}`}
                    title={m.status === "ACTIVE" ? "Mark inactive" : "Mark active"}
                    onClick={() =>
                      run(() => toggleMemberStatusAction(m.id), {
                        success: `${m.name} is now ${m.status === "ACTIVE" ? "inactive" : "active"}.`,
                      })
                    }
                  >
                    {m.status === "ACTIVE" ? <Ban /> : <RotateCcw />}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && close()} title={form?.id ? "Edit Member" : "Add Member"}>
        {form ? (
          <form onSubmit={save} className="space-y-4" noValidate>
            <Field label="Name" htmlFor="m-name">
              <Input id="m-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone (optional)" htmlFor="m-phone">
                <Input id="m-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01xxxxxxxxx" />
              </Field>
              <Field label="Email (optional)" htmlFor="m-email">
                <Input id="m-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
              </Field>
            </div>
            <PictureField value={form.pictureUrl} onChange={(v) => setForm({ ...form, pictureUrl: v })} name={form.name} color={form.color} />
            <Field label="Default Meals" hint="Whether each meal is assumed Yes or No for this member every day, until changed on the Meals page.">
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-border p-3">
                {MEAL_TYPES.map((t) => (
                  <div key={t}>
                    <p className="mb-1.5 text-xs font-medium capitalize text-muted">{t}</p>
                    <YesNoToggle
                      label={`Default ${t}`}
                      value={form.defaultMeals[t]}
                      onChange={(v) => setForm({ ...form, defaultMeals: { ...form.defaultMeals, [t]: v } })}
                    />
                  </div>
                ))}
              </div>
            </Field>
            {form.id ? (
              <Field label="Status" htmlFor="m-status">
                <Select id="m-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as MemberStatus })}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </Select>
              </Field>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                {form.id ? "Save Changes" : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card-bg rounded-xl p-3.5 text-white shadow-[var(--shadow-card)]">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-white/70">{label}</p>
    </div>
  );
}
