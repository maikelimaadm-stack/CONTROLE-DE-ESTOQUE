"use client";
import { use } from "react";
import { TitleForm } from "@/features/financial/titles";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <TitleForm dir="payable" id={id} />; }
