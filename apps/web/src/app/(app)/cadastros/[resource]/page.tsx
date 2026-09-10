"use client";
import { use, Suspense } from "react";
import { ResourceList } from "@/features/resources/resource-list";
export default function Page({ params }: { params: Promise<{ resource: string }> }) { const { resource } = use(params); return <Suspense><ResourceList resourceKey={resource} /></Suspense>; }
