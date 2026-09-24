"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Scale,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/shared";
import { GridBackground } from "./grid-background";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/meals", label: "Meals", icon: UtensilsCrossed },
  { href: "/expenses", label: "Expenses", icon: ShoppingCart },
  { href: "/members", label: "Members", icon: Users },
  { href: "/shopping-list", label: "Shopping List", icon: ClipboardList },
  { href: "/store", label: "Store", icon: ShoppingBasket },
  { href: "/settlement", label: "Settlement", icon: Scale },
  { href: "/summary", label: "Summary", icon: Receipt },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-navy-950 p-4">
      <Link href="/dashboard" onClick={onNavigate} className="mb-6 flex items-center gap-2.5 px-2">
        <Image src="/logo.png" alt="" width={32} height={32} className="rounded-lg" />
        <span className="text-base font-bold text-white">MealMate</span>
      </Link>
      <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-white text-navy-900 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="h-4.5 w-4.5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 pt-3 text-xs text-white/40">MealMate v3.0</div>
    </div>
  );
}

function UserMenu({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-xl p-1.5 pr-2.5 transition-colors hover:bg-gray-100"
      >
        <Avatar name={name} pictureUrl={avatarUrl} color="#0b1f4b" size="sm" />
        <span className="hidden text-sm font-medium text-foreground sm:block">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-52 animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-popover)]">
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-gray-100">
            <Settings className="h-4 w-4" /> Profile &amp; Settings
          </Link>
          <Link href="/balance" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-gray-100">
            <Wallet className="h-4 w-4" /> Available Balance
          </Link>
          <form action={signOutAction}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-100">
              <LogOut className="h-4 w-4" /> Sign Out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ profile, children }: { profile: { name: string; avatarUrl: string | null }; children: React.ReactNode }) {
  const [drawer, setDrawer] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-64 shrink-0 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:block">
        <Sidebar />
      </aside>

      {drawer ? <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden" onClick={() => setDrawer(false)} aria-hidden /> : null}
      <aside
        className={cn("fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200 lg:hidden", drawer ? "translate-x-0" : "-translate-x-full")}
        aria-hidden={!drawer}
      >
        <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Close menu">
          <X className="h-4.5 w-4.5" />
        </button>
        <Sidebar onNavigate={() => setDrawer(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur sm:px-6">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-muted hover:bg-gray-100 lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <UserMenu name={profile.name} avatarUrl={profile.avatarUrl} />
        </header>
        <main className="app-grid-bg relative flex-1 overflow-hidden p-4 sm:p-6">
          <GridBackground />
          <div className="relative z-[1] mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
