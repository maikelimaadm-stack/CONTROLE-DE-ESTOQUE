"use client";
import * as React from "react";
import { ItensDaCentral as ItensDoMotor, type ItensDaOrigem, type LayoutDosItens, type LoteDosItens } from "@/features/central/itens";
import type { ItemRow } from "@/features/docs/shared";
import { rotuloDoErro } from "../central-estoque-campos";
import {
  PESQUISA_DE_PRODUTO_DA_ENTRADA_DE_ESTOQUE, PESQUISA_DE_PRODUTO_DA_SAIDA_DE_ESTOQUE, PREFIXO_CENTRAL_ESTOQUE, RESERVA_DA_REQUISICAO, colunasDosItensDeEstoque
} from "./adaptador";
import type { EstadoDaCriacaoDeEstoque } from "./estado-criacao";

/**
 * ITENS DA CRIAÇÃO DA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — a grade/formulário do MOTOR sobre o MESMO
 * `itens`/`setItens` do estado (nenhuma cópia). UMA chamada do motor, com as chaves que a tabela `COMBINACOES_DO_MOTOR`
 * (`e2e/compras-03-central-unitario.spec.ts`) confere:
 *   · `armazemPorItem={false}` — o documento de estoque tem UM local (o do cabeçalho; na transferência, o de origem): a
 *     coluna não existe, e toda linha nasce e fica no local do cabeçalho (`armazemPadrao`), estado da tela que nunca vai
 *     no corpo por item;
 *   · `custoMedioNoUnitario={false}` — o custo vazio da entrada é "use o custo médio" (quem o calcula é a confirmação);
 *     nada é escrito no unitário;
 *   · `lote` — lote e validade por linha, só onde a espécie os tem e o produto os controla;
 *   · `daOrigem` — o consumo que atende uma requisição e a devolução de consumo: produto travado, a coluna Saldo, sem
 *     Adicionar nem Duplicar (e a quantidade travada quando a TOP não atende em parte);
 *   · `pesquisaDeProduto` — a da espécie, sempre só produto que controla estoque;
 *   · `reservaEstoque` — na requisição, a coluna Estoque mostra o DISPONÍVEL;
 *   · `linhaNovaEmBranco` e `subtotal={false}` — nada inventado (a contagem do ajuste nunca nasce "1") e nenhum valor no
 *     rodapé (o documento de estoque não tem valor); `casasDaQuantidade={4}`, a escala da quantidade.
 */

/** O Saldo da linha que veio da origem (o máximo que ela leva). */
const saldoDaLinha = (it: ItemRow) => (typeof it["saldo_origem"] === "string" ? it["saldo_origem"] : "0");
const linhaDoEstoque = () => `${PREFIXO_CENTRAL_ESTOQUE}-linha`;

export function ItensDaCriacaoDeEstoque({ e }: { e: EstadoDaCriacaoDeEstoque }) {
  const { variante, forma, itens, setItens, lote, localDasLinhas, errosDoMotor: erros, origemAplicada, regras } = e;
  const colunas = React.useMemo(() => colunasDosItensDeEstoque(variante), [variante]);
  const layout = React.useMemo<LayoutDosItens>(() => ({ colunas: e.colunasDosItens }), [e.colunasDosItens]);
  const controleDeLote = React.useMemo<LoteDosItens | null>(() => (forma.lote
    ? { daLinha: (it: ItemRow) => { const c = lote.daLinha(it.product_id); return { lote: c.lote, validade: forma.validade && c.validade }; } }
    : null), [forma.lote, forma.validade, lote]);
  const quantidadeTravada = regras?.fluxo?.permiteParcial === false;
  const daOrigem = React.useMemo<ItensDaOrigem | null>(() => (origemAplicada
    ? { saldo: saldoDaLinha, quantidadeTravada, testIdDaLinha: linhaDoEstoque }
    : null), [origemAplicada, quantidadeTravada]);
  const pesquisaDeProduto = forma.pesquisaDeProduto === "saida" ? PESQUISA_DE_PRODUTO_DA_SAIDA_DE_ESTOQUE : PESQUISA_DE_PRODUTO_DA_ENTRADA_DE_ESTOQUE;
  const reservaDaEspecie = forma.colunaDoEstoque === "disponivel" ? RESERVA_DA_REQUISICAO : null;

  return <div data-testid="estoque-central-itens" className="contents">
    <ItensDoMotor prefixoTestid={PREFIXO_CENTRAL_ESTOQUE} colunas={colunas} items={itens} onChange={setItens} layout={layout}
      erros={erros} armazemPadrao={localDasLinhas} armazemPorItem={false} custoMedioNoUnitario={false} lote={controleDeLote}
      daOrigem={daOrigem} pesquisaDeProduto={pesquisaDeProduto} reservaEstoque={reservaDaEspecie} linhaNovaEmBranco subtotal={false}
      casasDaQuantidade={4} />
    {e.errosSemCampo.length > 0 && <ul data-testid="estoque-central-erros" className="mt-2 space-y-0.5 px-3 text-[12px] text-red-700">
      {e.errosSemCampo.map(([c, m]) => <li key={c}>{rotuloDoErro(c)}: {m}</li>)}
    </ul>}
  </div>;
}
