"use client";
import { use } from "react";
import { LoadingOr, useDoc } from "@/features/docs/shared";
import { EdicaoDaOrdemDeServico, type DocumentoDaOs } from "@/features/modulos/os/central-os";

/**
 * OPERACOES-01 F10 (decisão 287): a EDIÇÃO da OS — a Central da OS preenchida com o detalhe (`GET /api/service-orders/:id`)
 * e salva pelo PUT de sempre, sem a TOP (ela não muda depois do lançamento). Fora de aberta/em andamento, o aviso e o
 * Salvar desabilitado; quem recusa é o servidor. A mesma 404 do detalhe para OS inexistente ou fora do escopo.
 */
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useDoc<DocumentoDaOs>(`/api/service-orders/${id}`);
  return <LoadingOr q={q}>{q.data && <EdicaoDaOrdemDeServico key={String(q.data["id"])} documento={q.data} />}</LoadingOr>;
}
