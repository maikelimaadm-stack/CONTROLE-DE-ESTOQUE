"use client";
import { use, Suspense } from "react";
import { getResource } from "@agro/domain";
import { useFormLayout, FormLayoutPage } from "@/features/resources/form-layout";
function Inner({ resource }: { resource: string }) {
  const def = getResource(resource);
  const p = useFormLayout(resource, def?.fields ?? []);
  if (!def) return <div>Recurso desconhecido</div>;
  return <FormLayoutPage p={p} resourceLabel={def.label} backHref={`/cadastros/${resource}`} />;
}
export default function Page({ params }: { params: Promise<{ resource: string }> }) { const { resource } = use(params); return <Suspense><Inner resource={resource} /></Suspense>; }
