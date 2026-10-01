"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import { COPY, enumLabel, enumOptions } from "@/lib/copy";
import { LoadingState, StatusBadge, statusTone } from "@/components/ui";
import { type Column } from "@/components/ui/data-table";
import { FilterChips, useUrlParam } from "@/components/workspace";
import { DocList, colDate, type Row } from "@/features/docs/shared";
import { colTipoOperacao } from "@/features/sales/tipo-operacao-select";
import { NovoDocumentoPorTop } from "@/features/sales/lancador-unificado";
import { TODOS_OS_TIPOS } from "@/features/sales/seletor-tipo-documento";
import {
  opcoesDeTopDeEstoque, rotaDeLancamentoDeEstoque, rotaDoDocumentoEstoque, useTopsDeEstoque, variantesDeEstoque
} from "./movimentacoes-variantes";

/**
 * A ABA "MOVIMENTAÇÕES" DO PORTAL DE ESTOQUE — A LISTA ÚNICA DO DOCUMENTO DE ESTOQUE (ESTOQUE-01, decisão 274).
 *
 * O mesmo desenho das listas únicas de Vendas e de Compras: uma lista das quatro espécies (entrada, saída,
 * transferência e ajuste), filtros e o `Novo` que pergunta a OPERAÇÃO (a TOP) e abre a Central de Estoque em
 * `/estoque/movimentacoes/<segmento>/new?tipo_operacao_id=…`. As abas antigas do /estoque e o `+ Novo` do topo
 * continuam como estão: esta aba não substitui nenhuma tela antiga, ela é a porta do documento novo.
 *
 * Porta: `/api/estoque/documentos`. Quem recorta linha é o servidor (a capacidade de LEITURA de cada espécie no
 * WHERE e o escopo de empresa do módulo estoque); a espécie e a situação escolhidas aqui são PEDIDO de recorte,
 * nunca autorização. Paginação, filtro e busca são do servidor.
 *
 * Toda coluna é `filterable: false` pelo mesmo motivo das listas de vendas e de compras: a porta unificada não lê
 * o filtro avançado por coluna, e chip que aparenta recortar e não recorta é pior que chip ausente. Os filtros de
 * verdade são os declarados abaixo (espécie e situação na faixa de cima; período, armazém, empresa, TOP e busca
 * na barra da lista).
 *
 * SKEW (web nova, API anterior): a API anterior não tem a porta e responde 404. A aba então diz que as
 * movimentações estão indisponíveis nesta versão do servidor — e não mostra uma lista vazia, que afirmaria
 * "não há documentos". O resto do /estoque não depende desta aba e continua funcionando.
 */
export function MovimentacoesEstoque() {
  const { can } = useAuth(); const tr = useTradutor();
  const [especieUrl, setEspecie] = useUrlParam("especie", "");
  const [situacaoUrl, setSituacao] = useUrlParam("situacao", "");
  const disponivel = usePortaDisponivel();
  const grupos = useTopsDeEstoque();

  // Só as espécies que o usuário pode LER são oferecidas; um `?especie=` fora delas (link antigo, colado) vale
  // "todas" — e o servidor recortaria do mesmo jeito.
  const visiveis = variantesDeEstoque().filter((v) => can(`${v.perm}.view`));
  const especie = visiveis.some((v) => v.variante === especieUrl) ? especieUrl : "";
  const situacoes = enumOptions("situacao_documento_estoque");
  const situacao = situacoes.some((o) => o.value === situacaoUrl) ? situacaoUrl : "";
  const daEspecie = visiveis.find((v) => v.variante === especie);
  const rotuloDoTipo = daEspecie ? tr(daEspecie.chaveI18n) : TODOS_OS_TIPOS;

  const novo = <NovoDocumentoPorTop variante={especie} rotuloDoTipo={rotuloDoTipo} todosOsGrupos={grupos} prefixo="estoque" rota={rotaDeLancamentoDeEstoque} />;
  const faixa = <div className="ws-filters no-print flex flex-wrap items-center gap-3">
    <FilterChips label="Espécie" testId="estoque-filtro-especie" value={especie} onChange={setEspecie}
      options={[{ value: "", label: "Todas" }, ...visiveis.map((v) => ({ value: v.variante, label: enumLabel("especie_documento_estoque", v.variante) }))]} />
    <FilterChips label={COPY.situacao} testId="estoque-filtro-situacao" value={situacao} onChange={setSituacao}
      options={[{ value: "", label: "Todas" }, ...situacoes]} />
  </div>;

  if (disponivel === "carregando") return <div data-testid="estoque-movimentacoes" className="flex min-h-0 flex-1 flex-col"><LoadingState /></div>;
  if (disponivel === "ausente") {
    return <div data-testid="estoque-movimentacoes" className="flex flex-col gap-3">
      <p data-testid="estoque-movimentacoes-indisponivel" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
        Movimentações indisponíveis nesta versão do servidor. As demais abas do Estoque continuam funcionando.
      </p>
    </div>;
  }

  return <div data-testid="estoque-movimentacoes" data-especie={especie} data-situacao={situacao} className="flex min-h-0 flex-1 flex-col gap-2">
    {faixa}
    <ListaDeDocumentosDeEstoque key={`${especie}|${situacao}`} especie={especie} situacao={situacao} barra={novo} opcoesTop={opcoesDeTopDeEstoque(grupos)} />
  </div>;
}

function ListaDeDocumentosDeEstoque({ especie, situacao, barra, opcoesTop }: {
  especie: string; situacao: string; barra: React.ReactNode; opcoesTop: { value: string; label: string }[];
}) {
  const colunas: Column<Row>[] = [
    {
      key: "codigo", label: "Código", filterable: false,
      // A linha leva o contrato do teste (código, espécie e situação que o SERVIDOR devolveu) e o clique no código
      // abre a Central de consulta — o duplo clique e o "Visualizar" da linha levam ao mesmo lugar.
      render: (r) => <Link href={rotaDoDocumentoEstoque(r)} className="text-brand-700 hover:underline" data-testid="estoque-doc-linha"
        data-codigo={String(r["codigo"] ?? "")} data-especie={String(r["especie"] ?? "")} data-situacao={String(r["situacao"] ?? "")}>{String(r["codigo"] ?? "")}</Link>,
      text: (r) => String(r["codigo"] ?? "")
    },
    { ...colDate("data_documento", "Data"), filterable: false },
    { key: "especie", label: "Espécie", render: (r) => rotuloDaEspecie(r["especie"]), text: (r) => rotuloDaEspecie(r["especie"]), filterable: false },
    colTipoOperacao(),
    { key: "armazem_nome", label: "Armazém", filterable: false },
    // Só a transferência tem destino; nas outras espécies a célula fica com o traço de "não se aplica".
    { key: "armazem_destino_nome", label: "Armazém de destino", render: (r) => textoOuTraco(r["armazem_destino_nome"]), text: (r) => textoOuTraco(r["armazem_destino_nome"]), filterable: false },
    { key: "empresa_nome", label: "Empresa", filterable: false },
    { key: "quantidade_itens", label: "Itens", kind: "number", align: "right", filterable: false },
    {
      key: "situacao", label: COPY.situacao, filterable: false,
      // A cor é a da situação do documento de compra — os mesmos três valores, com o mesmo significado
      // (aberto = pendente, confirmado = concluído, cancelado = negativo); o rótulo é o do domínio do estoque.
      render: (r) => <StatusBadge domain="situacao_documento_estoque" value={r["situacao"]} tone={statusTone(r["situacao"], "situacao_documento_compra")} />,
      text: (r) => enumLabel("situacao_documento_estoque", r["situacao"])
    }
  ];

  const recorte: Record<string, string> = {};
  if (especie) recorte["especie"] = especie;
  if (situacao) recorte["situacao"] = situacao;

  // SEM `entity`: com ela a barra ganharia Anexos e Histórico, e o anexo do documento de estoque ainda não está no
  // registro de pais de anexo da API (`lib/attachment-parent.ts`) — o botão apareceria e recusaria. Controle que
  // aparece e não funciona é pior que controle ausente; entra quando a API declarar o documento como pai de anexo.
  return <DocList title="Movimentações de estoque" endpoint="/api/estoque/documentos" base="/estoque"
    // A rota do detalhe sai da ESPÉCIE DA LINHA (o que o servidor classificou), nunca do filtro ativo.
    rowHref={rotaDoDocumentoEstoque}
    canCreate={false} canCancel={false} extraActions={barra}
    defaultFilters={Object.keys(recorte).length ? recorte : undefined}
    filters={[
      { name: "start_date", label: "Data inicial", type: "date" },
      { name: "end_date", label: "Data final", type: "date" },
      { name: "armazem_id", label: "Armazém", type: "ref", resource: "warehouses" },
      { name: "empresa_id", label: "Empresa", type: "ref", resource: "empresas" },
      { name: "search", label: "Código", type: "text" },
      ...(opcoesTop.length ? [{ name: "tipo_operacao_id", label: "Tipo de Operação", type: "select" as const, options: opcoesTop }] : [])
    ]}
    columns={colunas} />;
}

const rotuloDaEspecie = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : enumLabel("especie_documento_estoque", v));
const textoOuTraco = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * A porta da lista existe neste servidor? Uma pergunta de uma linha, só para distinguir a API anterior (404) do
 * resto. 403 (sem nenhuma capacidade de leitura) e os demais erros NÃO são "ausente": a lista monta e mostra o
 * erro que o servidor deu.
 */
function usePortaDisponivel(): "carregando" | "ausente" | "presente" {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["estoque-documentos-porta"],
    queryFn: () => api<unknown>("/api/estoque/documentos?limit=1"),
    retry: false,
    staleTime: 5 * 60_000
  });
  if (q.isPending) return "carregando";
  if (q.error && q.error.status === 404) return "ausente";
  return "presente";
}
