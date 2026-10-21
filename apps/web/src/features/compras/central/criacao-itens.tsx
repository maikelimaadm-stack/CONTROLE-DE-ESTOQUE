"use client";
import * as React from "react";
import type { ColunaDoLayout } from "@agro/domain";
import { ItensDaCentral as ItensDoMotor, type LayoutDosItens, type LoteDosItens } from "@/features/central/itens";
import { PESQUISA_DE_PRODUTO_DA_ENTRADA } from "@/features/central/contrato";
import type { ColunaDoEditorDeItens, ItemRow } from "@/features/docs/shared";
import { PREFIXO_CENTRAL_COMPRAS, colunasDosItensDeCompras } from "./adaptador";
import type { EstadoDaCriacao } from "./estado";

/** Colunas sempre visíveis na grade (detalhe do item cobre o restante). */
const COLUNAS_DA_GRADE: ReadonlySet<string> = new Set([
  "produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual", "total", "unidade"
]);

/**
 * ITENS DA CRIAÇÃO DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — a grade/formulário do MOTOR sobre o MESMO
 * `itens`/`setItens` do estado (nenhuma cópia).
 *
 * Colunas: as de `colunasDoEditor` (COMPRAS-03: ordem e rótulos do layout, local de estoque exigido pela regra,
 * lote/validade de produto com controle) e, sem layout, as de hoje — Compra: Local de estoque, Produto, Quantidade,
 * Valor unitário, Desconto, Desconto %, Lote, Validade; Pedido: sem Lote/Validade. Total sempre ao fim.
 * Lote/validade por linha pelo controle de lote do produto (só compra). Só o LANÇAMENTO: o receber pedido desenha
 * os itens em `receber.tsx` (`central-compras.tsx` escolhe um ou outro pelo modo).
 *
 * Valor unitário: é o do documento (o digitado ou o padrão), nunca o custo médio do local — a compra FORMA o custo,
 * não o lê (`custoMedioNoUnitario={false}`; o saldo do local continua lido). Local de estoque POR LINHA: a coluna é
 * forçada na grade (`armazemForcado`), inclusive quando o layout não a traz — cada item escolhe o seu local.
 *
 * OPERACOES-01 F3b (decisão 280): não há mais campo de local acima da grade; a linha NOVA nasce com o local padrão
 * (`armazemPadrao`: o de cadastro do layout, estado da tela) e troca o seu na célula; a pesquisa de produto é a da
 * ENTRADA — aparece tudo, com o saldo do local da linha para quem o vê (com a capacidade da pesquisa; sem ela, a de antes).
 *
 * EDITAR-02 (decisão 313): na EDIÇÃO, as travas de cada linha (`travasDaLinha`: o item salvo não sai — o Remover não
 * aparece com ele marcado —; produto, quantidade, valor unitário e descontos conforme os limites) e, sem item novo
 * (`aceitaLinhaNova` falso), nem Adicionar nem Duplicar. O item novo da edição se remove antes de salvar.
 */

/** Coluna do editor de hoje → chave do catálogo de compras (a que `colunasDosItensDeCompras` mapeia). */
const CATALOGO_DA_COLUNA: Partial<Record<ColunaDoEditorDeItens, string>> = {
  warehouse: "armazem_id", product: "produto_id", quantity: "quantidade", unit_value: "valor_unitario",
  discount: "desconto", discount_percent: "desconto_percentual", lot: "lote", expiration: "validade"
};

/** `itens.0.lote` / `itens[0].lote` → `items[0].lote` (o caminho que o motor lê). */
function caminhoDoMotor(caminho: string): string | null {
  const m = /^(?:itens|items)(?:\.(\d+)|\[(\d+)\])\.(.+)$/.exec(caminho);
  if (!m) return null;
  return `items[${m[1] ?? m[2]}].${m[3]}`;
}

export function ItensDaCriacaoDeCompra({ estado }: { estado: EstadoDaCriacao }) {
  const { variante, ehCompra, itens, setItens, colunasDoLayout, fieldsDosItens, errosDeItens, lote, localDoCabecalho, travasDaLinha, aceitaLinhaNova } = estado;
  const colunas = React.useMemo(() => colunasDosItensDeCompras(variante), [variante]);

  /** Grade enxuta (decisão 319): produto, qtd, unitário, desconto, total — mais o Local de estoque de CADA linha. */
  const layout = React.useMemo<LayoutDosItens>(() => {
    const lista: ColunaDoLayout[] = colunasDoLayout
      ? colunasDoLayout.map((c) => ({ campo: c.chave, obrigatorio: c.obrigatorio, ...(c.rotulo ? { rotulo: c.rotulo } : {}) }))
      : fieldsDosItens.flatMap((f) => { const campo = CATALOGO_DA_COLUNA[f]; return campo ? [{ campo, obrigatorio: false }] : []; });
    const daGrade = lista.filter((c) => COLUNAS_DA_GRADE.has(c.campo));
    return { colunas: daGrade.some((c) => c.campo === "total") ? daGrade : [...daGrade, { campo: "total", obrigatorio: false }] };
  }, [colunasDoLayout, fieldsDosItens]);

  const erros = React.useMemo(() => {
    const r: Record<string, string> = {};
    for (const [c, m] of errosDeItens) { const k = caminhoDoMotor(c); if (k) r[k] = m; }
    return r;
  }, [errosDeItens]);

  const controleDeLote = React.useMemo<LoteDosItens | null>(
    () => (ehCompra ? { daLinha: (it: ItemRow) => lote.daLinha(it.product_id) } : null), [ehCompra, lote]);

  // `min-h-0 flex-1`: a coluna do Itens é alta e recorta o que passa dela — sem isso a grade cresce e some, sem rolagem.
  return <div data-testid="compras-itens" className="flex min-h-0 flex-1 flex-col gap-2">
    {/* Local de estoque POR LINHA: a coluna é forçada na grade (cada item escolhe o seu); `armazemPadrao` só semeia a linha nova. */}
    <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_COMPRAS} colunas={colunas} items={itens} onChange={setItens} layout={layout}
      erros={erros} armazemPadrao={localDoCabecalho} armazemPorItem armazemForcado estoqueNaGrade={false} custoMedioNoUnitario={false}
      lote={controleDeLote} pesquisaDeProduto={PESQUISA_DE_PRODUTO_DA_ENTRADA} travasDaLinha={travasDaLinha} aceitaLinhaNova={aceitaLinhaNova} />
  </div>;
}
