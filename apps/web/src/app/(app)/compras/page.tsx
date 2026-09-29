"use client";
import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { Workspace, NewChooser, tab, useUrlParam } from "@/components/workspace";
import { Dashboard } from "@/features/dashboards/dashboard";
import { SupplyProcesses } from "@/features/supply/processes";
import { SeletorDeTipoDeDocumento, TODOS_OS_TIPOS } from "@/features/sales/seletor-tipo-documento";
import { NovoDocumentoPorTop } from "@/features/sales/lancador-unificado";
import type { LinhaDeLancamento } from "@/features/sales/launcher-operacoes";
import { DocumentosDeCompraList } from "@/features/compras/documentos-compra-list";
import { useTopsDeCompras, variantesDeCompra } from "@/features/compras/variantes";
import estilos from "@/features/sales/portal-vendas.module.css";

/**
 * PORTAL DE COMPRAS (COMPRAS-01, decisão 267): Documentos (primeira e padrão) + Visão Geral + Processos.
 *
 * "Documentos" é a lista única de pedidos de compra e compras, no desenho do Portal de Vendas: "Tipo" e o `Novo`
 * dividido na barra da listagem. O `Novo` escolhe a TOP (Pedido de compra ou Compra) e abre a Central de Compras
 * em `/compras/<segmento>/new?tipo_operacao_id=…`. "Processos" (solicitação → cotação → …) é o fluxo de
 * suprimentos, que não muda.
 */
const rotaDeLancamentoDeCompra = (linha: LinhaDeLancamento) => `/compras/${linha.segmento}/new?tipo_operacao_id=${encodeURIComponent(linha.id)}`;

function Documentos() {
  const { can } = useAuth(); const tr = useTradutor();
  const [especie, setEspecie] = useUrlParam("especie", "");
  const visiveis = variantesDeCompra().filter((v) => can(`${v.perm}.view`));
  const atual = visiveis.some((v) => v.variante === especie) ? especie : "";
  // Do documento final para o inicial (Compra, Pedido de compra): a ordem do registry invertida, como em Vendas.
  const opcoes = [...visiveis].reverse().map((v) => ({ value: v.variante, label: tr(v.chaveI18n) }));
  const rotuloDoTipo = opcoes.find((o) => o.value === atual)?.label ?? TODOS_OS_TIPOS;
  const focarTipo = React.useRef(false);
  const grupos = useTopsDeCompras();
  const barra = <span className={estilos.contexto} role="group" aria-label="Contexto operacional">
    <SeletorDeTipoDeDocumento prefixo="compras" valor={atual} opcoes={opcoes} focarAoMontar={focarTipo} onChange={(v) => { focarTipo.current = true; setEspecie(v); }} />
    <NovoDocumentoPorTop variante={atual} rotuloDoTipo={rotuloDoTipo} todosOsGrupos={grupos} prefixo="compras" rota={rotaDeLancamentoDeCompra} />
  </span>;
  return <div data-testid="compras-documentos" data-especie={atual} className="flex min-h-0 flex-1 flex-col">
    <DocumentosDeCompraList especie={atual} barra={barra} />
  </div>;
}

function Inner() {
  // Sem leitura de nenhum documento de compra, o padrão continua sendo Processos (o de antes desta fatia).
  const { can } = useAuth();
  const comDocumentos = variantesDeCompra().some((v) => can(`${v.perm}.view`));
  return <Workspace title="Compras" actions={<NewChooser items={[{ label: "Nova solicitação de compra", href: "/suprimentos/new", perm: "purchase_requests.create" }]} />} tabs={[
    tab("compras.documentos", <Documentos />),
    tab("compras.visao-geral", <Dashboard k="suprimentos" title="Indicadores de compras" />),
    tab("compras.processos", <SupplyProcesses />)
  ]} defaultTab={comDocumentos ? "documentos" : "processos"} />;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
