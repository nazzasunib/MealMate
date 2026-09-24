"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dbDown = /prisma|database|connect|DATABASE_URL/i.test(error.message);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 text-danger-700">
        <TriangleAlert className="h-6 w-6" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
      <p className="mt-1 text-sm text-muted">
        {dbDown
          ? "MealMate couldn't reach the database. Check your DATABASE_URL and that your Supabase project is running."
          : "This page failed to load. Your data is safe — please try again."}
      </p>
      {error.digest ? <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p> : null}
      <Button className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
