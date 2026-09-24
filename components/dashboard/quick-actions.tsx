"use client";

import Link from "next/link";
import { ShoppingCart, UserPlus, UtensilsCrossed, Wallet } from "lucide-react";

const ACTIONS = [
  { href: "/meals", label: "Add Meal", icon: UtensilsCrossed },
  { href: "/money?add=1", label: "Add Money", icon: Wallet },
  { href: "/expenses?add=1", label: "Add Expense", icon: ShoppingCart },
  { href: "/members?add=1", label: "Add Member", icon: UserPlus },
];

/** Pill links whose navy fill grows from the point the cursor enters (legacy patch 15). */
export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
            e.currentTarget.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
          }}
          className="quick-action-pill card-lift inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-card)]"
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}
