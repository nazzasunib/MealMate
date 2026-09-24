"use client";

import * as React from "react";
import { Star, Users } from "lucide-react";
import { setMealAction, setMealAllAction } from "@/app/actions/meals";
import { setMemberDefaultMealAction } from "@/app/actions/members";
import { MEAL_TYPES, type MealType } from "@/lib/constants";
import { mealsInDay } from "@/lib/calculations";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Avatar, EmptyState } from "@/components/shared";
import { useAction, YesNoToggle } from "@/components/client-shared";
import type { MealDefaults, MemberDTO } from "@/types";

type Row = { member: MemberDTO; meal: MealDefaults };
type Patch = { memberId: string | "*"; type: MealType; value: boolean };

/** Today's Yes/No grid with optimistic updates (UI flips instantly, reverts on error). */
export function MealGrid({ date, rows }: { date: string; rows: Row[] }) {
  const { run, pending } = useAction();
  const [optimistic, apply] = React.useOptimistic(rows, (state: Row[], p: Patch) =>
    state.map((r) => (p.memberId === "*" || r.member.id === p.memberId ? { ...r, meal: { ...r.meal, [p.type]: p.value } } : r)),
  );
  const [, startTransition] = React.useTransition();

  function setOne(memberId: string, type: MealType, value: boolean) {
    startTransition(async () => {
      apply({ memberId, type, value });
      await run(() => setMealAction({ memberId, date, type, value }));
    });
  }
  function setAll(type: MealType, value: boolean) {
    startTransition(async () => {
      apply({ memberId: "*", type, value });
      await run(() => setMealAllAction({ date, type, value }), { success: `Set all members' ${type} to ${value ? "Yes" : "No"}.` });
    });
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState icon={Users} title="No active members" description="Add members from the Members page to start recording meals." />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-gray-100/60 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Member</th>
              {MEAL_TYPES.map((t) => (
                <th key={t} className="px-3 py-3 text-center capitalize">
                  {t}
                </th>
              ))}
              <th className="px-5 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border bg-navy-50/50">
              <td className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-navy-900">Set all</td>
              {MEAL_TYPES.map((t) => (
                <td key={t} className="px-3 py-3">
                  <SetAll type={t} onSet={setAll} />
                </td>
              ))}
              <td />
            </tr>
            {optimistic.map(({ member, meal }) => (
              <tr key={member.id} className="border-b border-border transition-colors last:border-0 hover:bg-gray-100/50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={member.name} pictureUrl={member.pictureUrl} color={member.avatarColor} size="sm" />
                    <span className="font-medium text-foreground">{member.name}</span>
                  </div>
                </td>
                {MEAL_TYPES.map((t) => (
                  <td key={t} className="px-3 py-3">
                    <div className="mx-auto flex w-fit items-center gap-1">
                      <YesNoToggle label={`${member.name} ${t}`} value={meal[t]} onChange={(v) => setOne(member.id, t, v)} />
                      <DefaultStar member={member} type={t} value={meal[t]} run={run} busy={pending} />
                    </div>
                  </td>
                ))}
                <td className="px-5 py-3 text-right font-semibold tabular-nums">{mealsInDay(meal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-border md:hidden">
        <div className="space-y-2 bg-navy-50/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-900">Set all</p>
          {MEAL_TYPES.map((t) => (
            <div key={t} className="flex items-center justify-between">
              <span className="text-sm capitalize text-foreground">{t}</span>
              <SetAll type={t} onSet={setAll} />
            </div>
          ))}
        </div>
        {optimistic.map(({ member, meal }) => (
          <div key={member.id} className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={member.name} pictureUrl={member.pictureUrl} color={member.avatarColor} size="sm" />
                <span className="font-medium text-foreground">{member.name}</span>
              </div>
              <span className="text-sm font-semibold tabular-nums">{mealsInDay(meal)} meals</span>
            </div>
            {MEAL_TYPES.map((t) => (
              <div key={t} className="flex items-center justify-between">
                <span className="text-sm capitalize text-muted">{t}</span>
                <div className="flex items-center gap-1">
                  <YesNoToggle label={`${member.name} ${t}`} value={meal[t]} onChange={(v) => setOne(member.id, t, v)} />
                  <DefaultStar member={member} type={t} value={meal[t]} run={run} busy={pending} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SetAll({ type, onSet }: { type: MealType; onSet: (t: MealType, v: boolean) => void }) {
  return (
    <div className="mx-auto flex w-fit items-center gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label={`Set all ${type}`}>
      {[false, true].map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onSet(type, v)}
          className="h-7 w-12 rounded-md text-xs font-semibold text-muted transition-colors hover:bg-white hover:text-foreground"
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

/** Star: makes the shown value this member's default for that meal (legacy set-meal-default). */
function DefaultStar({
  member,
  type,
  value,
  run,
  busy,
}: {
  member: MemberDTO;
  type: MealType;
  value: boolean;
  run: ReturnType<typeof useAction>["run"];
  busy: boolean;
}) {
  const isDefault = member.defaultMeals[type] === value;
  return (
    <button
      type="button"
      disabled={busy || isDefault}
      onClick={() =>
        run(() => setMemberDefaultMealAction({ memberId: member.id, type, value }), {
          success: `${member.name}'s default ${type} is now ${value ? "Yes" : "No"}.`,
        })
      }
      title={isDefault ? `Already ${member.name}'s default for ${type}` : `Make ${value ? "Yes" : "No"} ${member.name}'s default ${type}`}
      aria-label={isDefault ? `${type} default` : `Make this ${member.name}'s default ${type}`}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
        isDefault ? "text-warning-600" : "text-muted hover:bg-white hover:text-warning-600",
      )}
    >
      <Star className="h-3.5 w-3.5" fill={isDefault ? "currentColor" : "none"} />
    </button>
  );
}
