"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Leaf: Card e CardBody (mg-card). CardHeader vive em ./page-header (é PageHeader `inCard`). */
export const Card = ({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("mg-card", className)} {...p}>{children}</div>;
export const CardBody = ({ className, children }: { className?: string; children: React.ReactNode }) => <div className={cn("p-4", className)}>{children}</div>;
