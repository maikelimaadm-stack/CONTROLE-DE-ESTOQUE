"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Badge genérico (categorias, tags, contadores). Para situação/status use StatusBadge (./status-badge). */
export const Badge = ({ children, tone = "slate", className, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "slate" | "green" | "red" | "amber" | "blue" | "violet" }) => {
  const t = { slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800", blue: "bg-blue-100 text-blue-800", violet: "bg-violet-100 text-violet-800" }[tone];
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", t, className)} {...rest}>{children}</span>;
};
