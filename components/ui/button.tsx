import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600 focus-visible:ring-offset-2 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-navy-800 to-navy-900 text-white shadow-[0_8px_16px_-8px_rgba(11,31,75,.45),0_2px_4px_-1px_rgba(11,31,75,.3)] hover:from-navy-700 hover:to-navy-800",
        secondary: "border border-border bg-surface text-foreground hover:bg-gray-100",
        danger:
          "bg-gradient-to-b from-danger-600 to-danger-700 text-white shadow-[0_8px_16px_-8px_rgba(220,38,38,.4)] hover:from-danger-700",
        ghost: "text-muted hover:bg-gray-100 hover:text-foreground",
        link: "rounded-none px-0 text-navy-900 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4.5",
        sm: "h-9 px-3.5 text-[13px]",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { buttonVariants };
