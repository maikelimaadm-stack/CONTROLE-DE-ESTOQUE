"use client";
import { use } from "react";
import { PaginaConfigurador } from "@/features/admin/layout-configurador/pagina";

/** CONFIGURAÇÕES › OPERAÇÕES › LAYOUT DO DOCUMENTO (VENDAS-A3-1c, decisão 261): o configurador visual de um layout. */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PaginaConfigurador id={id} />;
}
