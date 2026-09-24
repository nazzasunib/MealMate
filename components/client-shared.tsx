"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types";
import { Avatar } from "./shared";

/**
 * Runs a server action with a pending flag, toasts on success/failure, and
 * never fails silently. Returns true when the action succeeded.
 */
export function useAction() {
  const [pending, startTransition] = React.useTransition();
  const run = React.useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onSuccess?: (data: T) => void } = {}) =>
      new Promise<boolean>((resolve) => {
        startTransition(async () => {
          try {
            const res = await fn();
            if (res.ok) {
              if (opts.success) toast.success(opts.success);
              opts.onSuccess?.(res.data);
              resolve(true);
            } else {
              toast.error(res.error);
              resolve(false);
            }
          } catch (err) {
            // redirect() inside an action throws a special error that must propagate.
            if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) {
              throw err;
            }
            toast.error("Network error — please check your connection and try again.");
            resolve(false);
          }
        });
      }),
    [],
  );
  return { pending, run };
}

/** Debounced search box that writes `?q=` to the URL, preserving other params. */
export function SearchBox({ placeholder, param = "q" }: { placeholder: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = React.useState(params.get(param) ?? "");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(v: string) {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (v) next.set(param, v);
      else next.delete(param);
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    }, 350);
  }

  return (
    <div className="relative w-full sm:w-56">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-3.5 text-sm text-foreground placeholder:text-muted transition-all focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20"
      />
    </div>
  );
}

/** Reads an image file, downsizes to <=256px and returns a JPEG data-URL (legacy downsizeImageFile). */
export function downsizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function PictureField({
  value,
  onChange,
  name,
  color,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  name: string;
  color?: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-foreground">Picture (optional)</span>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name || "?"} pictureUrl={value} color={color} size="lg" />
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-gray-100">
          <Camera className="h-4 w-4" aria-hidden /> Upload Photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                onChange(await downsizeImage(file));
              } catch {
                toast.error("Could not read that image.");
              }
            }}
          />
        </label>
        {value ? (
          <button type="button" onClick={() => onChange(null)} className="text-sm font-medium text-muted underline decoration-dotted hover:text-foreground">
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Yes / No pill pair (legacy meal toggle look). */
export function YesNoToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex w-fit items-center gap-1 rounded-lg bg-gray-100 p-1", disabled && "opacity-60")}>
      {[false, true].map((v) => (
        <button
          key={String(v)}
          type="button"
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => value !== v && onChange(v)}
          className={cn(
            "h-7 w-12 rounded-md text-xs font-semibold transition-colors",
            value === v ? (v ? "bg-success-600 text-white" : "bg-danger-600 text-white") : "text-muted hover:bg-white hover:text-foreground",
          )}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}
