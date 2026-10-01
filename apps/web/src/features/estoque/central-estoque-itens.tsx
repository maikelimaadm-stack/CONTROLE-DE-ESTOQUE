"use client";
import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import type { EspecieEstoque } from "@agro/domain";
import { api } from "@/lib/api";
import { brl, dateBR, num } from "@/lib/utils";
import { Button, Input } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";

/**
 * OS ITENS DA CENTRAL DE ESTOQUE — o editor (criação) e a tabela (consulta), por ESPÉCIE (ESTOQUE-01, decisão 274).
 *
 *   entrada        → quantidade e custo unitário (o custo é INFORMADO: é ele que entra no custo médio);
 *   saída          → quantidade (o custo é o médio, calculado na confirmação);
 *   transferência  → quantidade (o mesmo custo sai da origem e entra no destino, na confirmação);
 *   ajuste         → quantidade CONTADA (a diferença para o saldo é calculada na confirmação, sob a trava).
 * Lote quando o produto controla lote; validade quando controla lote e validade — na entrada e no ajuste, que são as
 * espécies em que o lote é obrigatório e o que nasce no saldo leva a validade. Na saída e na transferência o lote é
 * opcional (sem ele, a confirmação escolhe pela validade, decisão 254) e a validade é a do lote que já existe.
 *
 * Por que um editor PRÓPRIO e não o `ItemsEditor` dos documentos (`features/docs/shared`): aquele é desenhado para
 * valor de documento comercial (armazém por linha, valor unitário, desconto, total) e não tem quantidade contada,
 * nem o contrato de `data-testid` do teste do portal. Mudar o editor compartilhado mudaria as telas que o usam; aqui
 * se usam as MESMAS peças (`Input`, `RefSelect`, a tabela `table-dense`), sem estilo novo.
 */

/** Uma linha do editor. Os números ficam como o TEXTO digitado; o corpo leva a forma canônica (ver `central-estoque-campos`). */
export interface LinhaDeEstoque {
  /** Chave de apresentação (React), nunca identidade: o item ganha id no servidor. */
  chave: string;
  produto_id: string;
  quantidade: string;
  quantidade_contada: string;
  custo_unitario: string;
  lote: string;
  validade: string;
}

let sequencia = 0;
export const linhaVazia = (): LinhaDeEstoque => ({ chave: `linha-${++sequencia}`, produto_id: "", quantidade: "", quantidade_contada: "", custo_unitario: "", lote: "", validade: "" });

/** A validade só se informa onde o lote é obrigatório e o saldo nasce com ela. */
export const especieInformaValidade = (especie: EspecieEstoque) => especie === "entrada" || especie === "ajuste";

/**
 * Controle de lote de cada produto (cadastro), como na Central de Compras. `daLinha`: desconhecido = campos abertos
 * (o servidor é quem recusa). `pede`: a coluna tem de aparecer? Só com produto escolhido — controle lido que pede,
 * ou controle que não se conseguiu ler (a pessoa precisa de onde digitar o que o servidor pode cobrar). Enquanto a
 * leitura não chega, não força: a coluna não pisca a cada produto escolhido.
 */
export interface ControleDeLote {
  daLinha: (produtoId: string) => { lote: boolean; validade: boolean };
  pede: (produtoId: string, campo: "lote" | "validade") => boolean;
}

export function useControleDeLote(produtos: string[]): ControleDeLote {
  const unicos = Array.from(new Set(produtos.filter(Boolean)));
  const qs = useQueries({ queries: unicos.map((id) => ({ queryKey: ["estoque-produto-lote", id], queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${id}`), staleTime: 60_000, retry: false })) });
  const mapa = new Map<string, string>(); const ilegivel = new Set<string>();
  unicos.forEach((id, i) => {
    const q = qs[i]; const c = q?.data?.["controle_lote"];
    if (typeof c === "string") mapa.set(id, c); else if (q && !q.isPending) ilegivel.add(id);
  });
  return {
    daLinha: (produtoId) => {
      const c = mapa.get(produtoId);
      if (c === undefined) return { lote: true, validade: true };
      return { lote: c !== "nenhum", validade: c === "lote_validade" };
    },
    pede: (produtoId, campo) => {
      if (!produtoId) return false;
      const c = mapa.get(produtoId);
      if (c === undefined) return ilegivel.has(produtoId);
      return campo === "lote" ? c !== "nenhum" : c === "lote_validade";
    }
  };
}

/** As colunas de lote e validade aparecem quando alguma linha as pede (a regra de quando a coluna existe mora aqui). */
export function colunasDeLote(especie: EspecieEstoque, linhas: readonly LinhaDeEstoque[], lote: ControleDeLote): { lote: boolean; validade: boolean } {
  return {
    lote: linhas.some((l) => lote.pede(l.produto_id, "lote")),
    validade: especieInformaValidade(especie) && linhas.some((l) => lote.pede(l.produto_id, "validade"))
  };
}

/**
 * Os campos da linha que estão À VISTA (e que portanto recebem o próprio erro). O erro do servidor num campo que não
 * está à vista não some: a Central o mostra na lista de erros dos itens.
 */
export function camposDaLinha(especie: EspecieEstoque, linha: LinhaDeEstoque, colunas: { lote: boolean; validade: boolean }, lote: ControleDeLote): string[] {
  const c = lote.daLinha(linha.produto_id);
  return [
    "produto_id",
    especie === "ajuste" ? "quantidade_contada" : "quantidade",
    ...(especie === "entrada" ? ["custo_unitario"] : []),
    ...(colunas.lote && c.lote ? ["lote"] : []),
    ...(colunas.validade && c.validade ? ["validade"] : [])
  ];
}

/** O erro de um campo, com o mesmo texto e a mesma cor do erro do `Field`. */
const ErroDoCampo = ({ texto }: { texto: string | undefined }) => (texto ? <p className="mt-0.5 text-[11px] text-red-600">{texto}</p> : null);

export function EditorDeItensEstoque({ especie, linhas, onChange, lote, colunas, erro }: {
  especie: EspecieEstoque;
  linhas: LinhaDeEstoque[];
  onChange: (linhas: LinhaDeEstoque[]) => void;
  lote: ControleDeLote;
  colunas: { lote: boolean; validade: boolean };
  /** O erro do caminho (`itens.<i>.<campo>`), do servidor ou da conferência local. */
  erro: (caminho: string) => string | undefined;
}) {
  const mudar = (i: number, p: Partial<LinhaDeEstoque>) => onChange(linhas.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const ehAjuste = especie === "ajuste";
  const campoQuantidade = ehAjuste ? "quantidade_contada" : "quantidade";
  return <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>
    <th className="min-w-[240px]">Produto</th>
    <th className="w-32">{ehAjuste ? "Quantidade contada" : "Quantidade"}</th>
    {especie === "entrada" && <th className="w-32">Custo unitário</th>}
    {colunas.lote && <th className="w-32">Lote</th>}
    {colunas.validade && <th className="w-36">Validade</th>}
    <th className="w-8" />
  </tr></thead><tbody>
    {linhas.map((l, i) => {
      const c = lote.daLinha(l.produto_id);
      const caminho = (campo: string) => `itens.${i}.${campo}`;
      return <tr key={l.chave} data-testid="estoque-item" data-posicao={i}>
        <td data-testid="estoque-item-produto">
          {/* Só produto que CONTROLA ESTOQUE é oferecido; trocar o produto descarta lote e validade digitados para o anterior. */}
          <RefSelect resource="products" value={l.produto_id || null} filter={{ control_stock: "true" }}
            onChange={(v) => mudar(i, { produto_id: v ?? "", lote: "", validade: "" })} />
          <ErroDoCampo texto={erro(caminho("produto_id"))} />
        </td>
        <td>
          <Input data-testid={ehAjuste ? "estoque-item-quantidade-contada" : "estoque-item-quantidade"} inputMode="decimal" autoComplete="off"
            value={ehAjuste ? l.quantidade_contada : l.quantidade}
            onChange={(e) => mudar(i, ehAjuste ? { quantidade_contada: e.target.value } : { quantidade: e.target.value })} />
          <ErroDoCampo texto={erro(caminho(campoQuantidade))} />
        </td>
        {especie === "entrada" && <td>
          <Input data-testid="estoque-item-custo" inputMode="decimal" autoComplete="off" value={l.custo_unitario} onChange={(e) => mudar(i, { custo_unitario: e.target.value })} />
          <ErroDoCampo texto={erro(caminho("custo_unitario"))} />
        </td>}
        {colunas.lote && <td>
          {c.lote
            ? <><Input data-testid="estoque-item-lote" value={l.lote} onChange={(e) => mudar(i, { lote: e.target.value })} /><ErroDoCampo texto={erro(caminho("lote"))} /></>
            : <span className="text-slate-400">—</span>}
        </td>}
        {colunas.validade && <td>
          {c.validade
            ? <><Input data-testid="estoque-item-validade" type="date" value={l.validade} onChange={(e) => mudar(i, { validade: e.target.value })} /><ErroDoCampo texto={erro(caminho("validade"))} /></>
            : <span className="text-slate-400">—</span>}
        </td>}
        <td><button type="button" data-testid="estoque-item-remover" aria-label="Remover item" className="p-1 text-slate-400 hover:text-red-600"
          onClick={() => onChange(linhas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
      </tr>;
    })}
  </tbody><tfoot><tr><td colSpan={20} className="p-2">
    <Button type="button" size="sm" variant="outline" data-testid="estoque-item-adicionar" onClick={() => onChange([...linhas, linhaVazia()])}><Plus className="h-3.5 w-3.5" /> Adicionar item</Button>
  </td></tr></tfoot></table></div>;
}

/** Um item como a consulta o recebe (`GET /api/estoque/<segmento>/:id`). Números como TEXTO. */
export interface ItemLidoEstoque {
  id: string;
  posicao: number;
  produto_id: string;
  produto_codigo: string | null;
  produto_nome: string;
  unidade: string | null;
  produto_controle_lote: string;
  lote: string | null;
  validade: string | null;
  quantidade: string | null;
  quantidade_contada: string | null;
  custo_unitario: string | null;
  saldo_na_confirmacao: string | null;
  diferenca: string | null;
  observacao: string | null;
}

const traco = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * A TABELA DOS ITENS NA CONSULTA. O custo unitário da saída, da transferência e do ajuste é o que a CONFIRMAÇÃO gravou
 * (o médio do saldo); antes dela, "—". No ajuste, o saldo encontrado e a diferença também só existem depois da
 * confirmação. `erro`: o 422 da confirmação ou do cancelamento cai no item (`itens.<i>.quantidade`).
 */
export function TabelaDeItensEstoque({ especie, itens, erro }: { especie: EspecieEstoque; itens: ItemLidoEstoque[]; erro: (caminho: string) => string | undefined }) {
  const ehAjuste = especie === "ajuste";
  const comValidade = itens.some((it) => it.validade);
  return <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]"><thead><tr>
    <th>Produto</th>
    <th>Lote</th>
    {comValidade && <th>Validade</th>}
    <th className="text-right">{ehAjuste ? "Quantidade contada" : "Quantidade"}</th>
    {ehAjuste && <th className="text-right">Saldo na confirmação</th>}
    {ehAjuste && <th className="text-right">Diferença</th>}
    <th className="text-right">Custo unitário</th>
  </tr></thead><tbody>
    {itens.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-slate-400">Nenhum item.</td></tr>}
    {itens.map((it, i) => {
      // O erro do item: o da quantidade (saldo insuficiente, entrada já consumida) ou de qualquer outro campo dele.
      const mensagem = erro(`itens.${i}.quantidade`) ?? erro(`itens.${i}.quantidade_contada`) ?? erro(`itens.${i}.produto_id`) ?? erro(`itens.${i}.lote`) ?? erro(`itens.${i}`);
      return <tr key={it.id} data-testid="estoque-item" data-posicao={it.posicao} data-diferenca={it.diferenca ?? ""} data-saldo-na-confirmacao={it.saldo_na_confirmacao ?? ""}>
        <td data-testid="estoque-item-produto">{[it.produto_codigo, it.produto_nome].filter(Boolean).join(" — ") || "—"}<ErroDoCampo texto={mensagem} /></td>
        <td data-testid="estoque-item-lote">{traco(it.lote)}</td>
        {comValidade && <td data-testid="estoque-item-validade">{it.validade ? dateBR(it.validade) : "—"}</td>}
        <td className="num" data-testid={ehAjuste ? "estoque-item-quantidade-contada" : "estoque-item-quantidade"}>
          {num(ehAjuste ? it.quantidade_contada : it.quantidade, 4)}{it.unidade ? ` ${it.unidade}` : ""}
        </td>
        {ehAjuste && <td className="num">{num(it.saldo_na_confirmacao, 4)}</td>}
        {ehAjuste && <td className="num">{num(it.diferenca, 4)}</td>}
        <td className="num" data-testid="estoque-item-custo">{brl(it.custo_unitario)}</td>
      </tr>;
    })}
  </tbody></table></div>;
}
