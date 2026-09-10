"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TitleList } from "@/features/financial/titles";
function Inner() { const sp = useSearchParams(); return <TitleList dir="receivable" initialStatus={sp.get("status") ?? undefined} />; }
export default function Page() { return <Suspense><Inner /></Suspense>; }
