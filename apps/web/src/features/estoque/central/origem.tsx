"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CAMPOS_DESTINO_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, type ColunaDestinoEstoque, type EspecieEstoque } from "@agro/domain";
import { D, qty } from "@agro/shared";
import { api, type ApiError } from "@/lib/api";
import { enumLabel } from "@/lib/copy";
import { dateBR } from "@/lib/utils";
import { RefSelect, type BuscaDeOpcoes, type Option } from "@/components/ui/ref-select";
import type { ItemRow } from "@/features/docs/shared";
import { CampoDaCentral } from "@/features/central/campo";

/**
 * A ORIGEM DO LANÇAMENTO NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282, D7 do plano) — o consumo que atende uma
 * requisição e a devolução de consumo que volta de um consumo.
 *
 * A origem chega pela URL (`?origem=<id>`, vinda de "Atender requisição" ou "Devolver itens" na consulta) ou pelo campo
 * "Requisição de origem" / "Consumo de origem" dos Dados principais. É PEDIDO, nunca autorização: o documento é lido
 * pela MESMA porta do GET da espécie dele (a 404 de fora do escopo, de outra organização ou inexistente é a mesma) e a
 * Central só o aplica se ele ATENDE (a requisição confirmada e pendente ou atendida em parte; o consumo confirmado). O
 * servidor confere tudo de novo no POST — a mesma empresa, o mesmo Local de estoque, cada item e o saldo dele.
 *
 * Aqui moram a leitura (`useOrigemDoEstoque`, sem desenho), as linhas que a origem dá (`linhasDaOrigem`, pura) e o
 * campo (`CampoDaOrigem`, só desenho). Quem aplica (empresa, local, itens, destino herdado) é o estado da criação.
 */

/** Um item da origem como o GET o devolve (números como TEXTO). */
export interface ItemDaOrigemLido {
  id: string;
  produto_id: string;
  produto_nome: string;
  lote: string | null;
  validade: string | null;
  quantidade: string | null;
  saldo_pendente: string | null;
  quantidade_devolvida: string | null;
}

/** O documento de origem, como o GET da espécie dele o devolve (só o que a Central usa). */
export type DocumentoDeOrigem = {
  id: string;
  codigo: string;
  especie: string;
  situacao: string;
  atendimento: string | null;
  empresa_id: string;
  empresa_nome: string | null;
  armazem_id: string;
  armazem_nome: string | null;
  data_documento: string;
  centro_custo_nome: string | null;
  equipamento_nome: string | null;
  ordem_servico_codigo: string | null;
  lote_animais_nome: string | null;
  area_nome: string | null;
  safra_nome: string | null;
  itens: ItemDaOrigemLido[];
} & Record<ColunaDestinoEstoque, string | null>;

/** A chave do nome de cada dimensão do destino na leitura do documento (o contrato do GET da F5a). */
type NomeDoDestinoNaLeitura = "centro_custo_nome" | "equipamento_nome" | "ordem_servico_codigo" | "lote_animais_nome" | "area_nome" | "safra_nome";
export const NOME_DO_DESTINO_NA_LEITURA: Readonly<Record<ColunaDestinoEstoque, NomeDoDestinoNaLeitura>> = Object.freeze({
  centro_custo_id: "centro_custo_nome",
  equipamento_id: "equipamento_nome",
  ordem_servico_id: "ordem_servico_codigo",
  lote_animais_id: "lote_animais_nome",
  area_id: "area_nome",
  safra_id: "safra_nome"
});

export type EstadoDaOrigem =
  | { situacao: "sem-origem" }
  | { situacao: "carregando"; id: string }
  | { situacao: "recusada"; id: string; mensagem: string }
  | { situacao: "pronta"; id: string; documento: DocumentoDeOrigem };

export const MENSAGEM_ORIGEM_INDISPONIVEL = "O documento de origem não foi encontrado ou não está disponível para você.";
export const MENSAGEM_REQUISICAO_NAO_PENDENTE = "Esta requisição não está pendente: escolha outra.";
export const MENSAGEM_CONSUMO_NAO_CONFIRMADO = "Este consumo não está confirmado: escolha outro.";

/** Os atendimentos da requisição que ainda pedem consumo (o domínio os calcula; a Central só lê). */
const ATENDIMENTOS_QUE_ATENDEM: ReadonlySet<string> = new Set(["pendente", "parcial"]);

/** A origem serve? `null` = serve; texto = a recusa (nada é aplicado). A mesma régua da API, vista pela tela. */
export function recusaDaOrigem(especieDaOrigem: EspecieEstoque, d: DocumentoDeOrigem): string | null {
  if (especieDaOrigem === "requisicao") {
    return d.situacao === "confirmado" && d.atendimento !== null && ATENDIMENTOS_QUE_ATENDEM.has(d.atendimento) ? null : MENSAGEM_REQUISICAO_NAO_PENDENTE;
  }
  return d.situacao === "confirmado" ? null : MENSAGEM_CONSUMO_NAO_CONFIRMADO;
}

/**
 * Lê o documento de origem pela porta da espécie dele (`/api/estoque/<segmento>/<id>`), com a chave de cache da consulta
 * (`docone`). Sem espécie de origem ou sem id: "sem-origem". 404/403/erro: "recusada", com a mensagem única (não revela
 * se o documento existe noutro escopo).
 */
export function useOrigemDoEstoque(especieDaOrigem: EspecieEstoque | null, id: string): EstadoDaOrigem {
  const porta = especieDaOrigem && id ? `/api/estoque/${SEGMENTO_DA_ESPECIE_ESTOQUE[especieDaOrigem]}/${encodeURIComponent(id)}` : "";
  const q = useQuery<DocumentoDeOrigem, ApiError>({
    queryKey: ["docone", porta],
    queryFn: () => api<DocumentoDeOrigem>(porta),
    enabled: Boolean(porta),
    retry: false
  });
  if (!especieDaOrigem || !id) return { situacao: "sem-origem" };
  if (q.isPending) return { situacao: "carregando", id };
  if (q.error || !q.data) return { situacao: "recusada", id, mensagem: MENSAGEM_ORIGEM_INDISPONIVEL };
  const recusa = recusaDaOrigem(especieDaOrigem, q.data);
  return recusa ? { situacao: "recusada", id, mensagem: recusa } : { situacao: "pronta", id, documento: q.data };
}

/** Um texto decimal do servidor, ou zero (o servidor manda número como texto; nada vira float). */
const decimal = (v: string | null | undefined) => D(v && /^-?\d+(\.\d+)?$/.test(v) ? v : "0");

/**
 * AS LINHAS QUE A ORIGEM DÁ — uma por item com saldo, no Local de estoque da origem:
 *   · requisição → consumo: o saldo PENDENTE do item (do servidor), sem lote (a requisição não tem);
 *   · consumo → devolução: o que o item baixou e ainda não voltou (quantidade − devolvida, 4 casas), com o lote e a
 *     validade do consumo.
 * Cada linha leva `origem_item_id` (vai no corpo) e `saldo_origem` (o máximo da linha, para a coluna Saldo do motor).
 */
export function linhasDaOrigem(especieDaOrigem: EspecieEstoque, d: DocumentoDeOrigem): ItemRow[] {
  return d.itens.flatMap((it): ItemRow[] => {
    const saldo = especieDaOrigem === "requisicao"
      ? decimal(it.saldo_pendente)
      : decimal(it.quantidade).minus(decimal(it.quantidade_devolvida));
    if (!saldo.gt(0)) return [];
    const texto = qty(saldo);
    return [{
      product_id: it.produto_id, quantity: texto, unit_value: "", generate_stock: true, warehouse_id: d.armazem_id,
      ...(especieDaOrigem === "consumo" ? { provider_lot: it.lote ?? "", expiration_date: it.validade ?? "" } : {}),
      origem_item_id: it.id, saldo_origem: texto
    }];
  });
}

/** O destino que a origem tem (o consumo o herda da requisição): por coluna, o id e o nome lido. */
export function destinoDaOrigem(d: Omit<DocumentoDeOrigem, "itens">): Partial<Record<ColunaDestinoEstoque, { id: string; nome: string }>> {
  const out: Partial<Record<ColunaDestinoEstoque, { id: string; nome: string }>> = {};
  for (const c of CAMPOS_DESTINO_ESTOQUE) {
    const id = d[c.coluna];
    if (!id) continue;
    const nome = d[NOME_DO_DESTINO_NA_LEITURA[c.coluna]];
    out[c.coluna] = { id, nome: typeof nome === "string" && nome ? nome : "—" };
  }
  return out;
}

/** O rótulo da origem escolhida: "<código> · <data>". */
export const rotuloDoDocumentoDeOrigem = (d: { codigo: string; data_documento: string }) => `${d.codigo} · ${dateBR(d.data_documento)}`;

/** "Requisição de origem" / "Consumo de origem" — o rótulo da espécie é do dono dos rótulos de enum. */
export const rotuloDoCampoDaOrigem = (especieDaOrigem: EspecieEstoque) => `${enumLabel("especie_documento_estoque", especieDaOrigem)} de origem`;

const DICA_DA_ORIGEM: Readonly<Partial<Record<EspecieEstoque, string>>> = Object.freeze({
  requisicao: "Os itens vêm da requisição; a quantidade pode ser menor que o saldo.",
  consumo: "Os itens vêm do consumo; devolva até o que ele baixou e ainda não voltou."
});

/**
 * As opções do campo: os documentos da espécie de origem, CONFIRMADOS, da empresa e do Local de estoque do lançamento
 * (a requisição, só pendente ou atendida em parte), pela lista única (`/api/estoque/documentos`): busca, recorte e página
 * no servidor.
 */
function opcoesDaOrigem(especieDaOrigem: EspecieEstoque, empresaId: string, armazemId: string): BuscaDeOpcoes {
  return {
    chave: `estoque-origem:${especieDaOrigem}:${empresaId}:${armazemId}`,
    buscar: async (search) => {
      const q = new URLSearchParams({ especie: especieDaOrigem, situacao: "confirmado" });
      if (especieDaOrigem === "requisicao") q.set("atendimento", [...ATENDIMENTOS_QUE_ATENDEM].join(","));
      q.set("empresa_id", empresaId); q.set("armazem_id", armazemId);
      if (search) q.set("search", search);
      q.set("page", "1"); q.set("pageSize", "20");
      const r = await api<{ items: { id: string; codigo: string; data_documento: string }[] }>(`/api/estoque/documentos?${q.toString()}`);
      return r.items.map((d): Option => ({ id: d.id, label: rotuloDoDocumentoDeOrigem(d) }));
    }
  };
}

/**
 * O CAMPO DA ORIGEM nos Dados principais (`estoque-central-origem`, `data-origem-id`). Desabilitado sem empresa e Local
 * de estoque (a lista é recortada por eles). O "recurso" do RefSelect é só a chave do cache: as opções e o rótulo vêm do
 * servidor do estoque, e nenhuma leitura de `/api/resources` nem cadastro rápido sai daqui.
 */
export function CampoDaOrigem({ especieDaOrigem, empresaId, armazemId, valor, rotuloDoValor, obrigatorio, erro, onChange }: {
  especieDaOrigem: EspecieEstoque;
  empresaId: string;
  armazemId: string;
  valor: string;
  rotuloDoValor: string;
  obrigatorio: boolean;
  erro?: string;
  onChange: (id: string, rotulo: string) => void;
}) {
  const desabilitado = !empresaId || !armazemId;
  const busca = React.useMemo(() => opcoesDaOrigem(especieDaOrigem, empresaId, armazemId), [especieDaOrigem, empresaId, armazemId]);
  return <CampoDaCentral rotulo={rotuloDoCampoDaOrigem(especieDaOrigem)} obrigatorio={obrigatorio} erro={erro} icone="pesquisa" preenchido={Boolean(valor)}
    estado={desabilitado ? "desabilitado" : "editavel"} testId="estoque-central-origem" data-origem-id={valor || undefined} data-campo="origem_documento_id"
    dica={DICA_DA_ORIGEM[especieDaOrigem]}>
    <RefSelect resource="estoque-origem" value={valor || null} labelHint={valor ? rotuloDoValor || "…" : undefined} disabled={desabilitado || undefined}
      buscarOpcoes={busca} onChange={(id, opcao) => onChange(id ?? "", opcao?.label ?? "")} />
  </CampoDaCentral>;
}
