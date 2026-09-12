"use client";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Leaf: indicador de carregamento inline; LoadingState (./states) compõe sobre ele. */
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-5 w-5 animate-spin text-brand-600", className)} />;
