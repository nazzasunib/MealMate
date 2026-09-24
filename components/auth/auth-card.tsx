import Image from "next/image";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-bg relative flex min-h-dvh items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-navy-700/40 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-navy-600/30 blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-md animate-scale-in rounded-2xl bg-surface p-6 shadow-[var(--shadow-popover)] sm:p-8">
        <div className="flex flex-col items-center text-center">
          <Image src="/logo.png" alt="MealMate" width={64} height={64} className="mb-4 rounded-2xl shadow-[var(--shadow-card)]" priority />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
