"use client";
import { use, Suspense } from "react";
import { ResourceForm } from "@/features/resources/resource-form";
export default function Page({ params }: { params: Promise<{ resource: string; id: string }> }) { const { resource, id } = use(params); return <Suspense><ResourceForm resourceKey={resource} id={id} /></Suspense>; }
