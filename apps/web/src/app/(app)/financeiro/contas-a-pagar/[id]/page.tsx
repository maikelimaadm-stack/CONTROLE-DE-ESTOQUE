"use client";
import { use } from "react";
import { TitleDetail } from "@/features/financial/titles";
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <TitleDetail dir="payable" id={id} />; }
