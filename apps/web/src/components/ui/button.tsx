"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Leaf: Button oficial (docs/UI-STANDARD.md › Primitives visuais). Não importa o barrel ./index. */
export const buttonVariants = cva("tb-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400", {
  variants: {
    variant: { default: "tb-btn-green", secondary: "tb-btn-gray", outline: "tb-btn-outline", ghost: "tb-btn-ghost", danger: "tb-btn-red", link: "!h-auto !min-h-0 !p-0 !rounded-none text-brand-700 underline-offset-4 hover:underline" },
    size: { sm: "", md: "", lg: "!h-9 !min-h-9 px-4 text-[13px]", icon: "tb-btn-icon" }
  }, defaultVariants: { variant: "default", size: "md" }
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={loading || p.disabled} aria-busy={loading || undefined} {...p}>{loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}{children}</button>
));
Button.displayName = "Button";
