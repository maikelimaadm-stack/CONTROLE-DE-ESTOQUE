"use client";
import { brl } from "@/lib/utils";
import { DocList, colDate, colMoney, colStatus, type Row } from "@/features/docs/shared";
import { type Column } from "@/components/ui/data-table";
import { COPY } from "@/lib/copy";
import { colTipoOperacao } from "@/features/sales/tipo-operacao-select";
import { useOpcoesDeTopDeVendas } from "@/features/sales/variantes";

/**
 * A LISTA ÚNICA DE DOCUMENTOS COMERCIAIS (TOP-CONFIG-03).
 *
 * ┌─ POR QUE UMA LISTA, E NÃO TRÊS ABAS ───────────────────────────────────────────────────────────┐
 * │ Orçamento, pedido e venda continuam sendo documentos DISTINTOS — regra, permissão, endpoint e   │
 * │ efeito contábil próprios (tela unificada ≠ regra de negócio unificada). O que era artificial    │
 * │ era a BUSCA: o operador pergunta "onde está o documento do cliente X", não "em qual das três    │
 * │ telas ele está". Procurar em três lugares é o sintoma de a navegação estar modelada pela        │
 * │ tabela, e não pelo processo.                                                                     │
 * │                                                                                                  │
 * │ O tipo do documento vira, portanto, FILTRO — ferramenta de consulta, que se aplica e se remove   │
 * │ na mesma tela — e não mais uma camada de navegação.                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O RÓTULO DO TIPO VEM DO SERVIDOR ─────────────────────────────────────────────────────────────┐
 * │ `kind_rotulo` chega pronto em cada linha, resolvido pelo registry de famílias operacionais. Um   │
 * │ mapa `{ budget: "Orçamento", … }` aqui seria a segunda lista que envelhece em silêncio: no dia   │
 * │ em que o registry ganhasse uma variante nova, a coluna mostraria o valor cru — ou nada.          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE ESTA LISTA NÃO FAZ ─────────────────────────────────────────────────────────────────────┐
 * │ NÃO CRIA. O lançamento nasce da TOP (`LancadorUnificadoDeVendas` no `+ Novo` do portal), nunca  │
 * │ de "novo documento genérico": a porta e a família de capacidade dependem da operação escolhida.  │
 * │ NÃO CANCELA em massa. O cancelamento de `DocList` monta `${endpoint}/<id>/cancel`, e não existe  │
 * │ porta `/api/sales/documentos/<id>/cancel` — cada variante tem a sua. Botão que aparece e         │
 * │ responde 404 é pior que botão nenhum; cancelar continua no detalhe, que sabe a variante.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export function DocumentosDeVendaList({ kind }: { kind: string }) {
  const opcoesTop = useOpcoesDeTopDeVendas();

  /**
   * TODA COLUNA É `filterable: false`, e isso é decisão, não esquecimento.
   *
   * `DocList` transforma automaticamente cada coluna exibida num chip de filtro avançado
   * (`coluna__operador`), e esse contrato é servido por `wrapListing` — que a porta unificada NÃO usa.
   * Um chip sobre `client_name` sairia daqui, chegaria em `/api/sales/documentos` como parâmetro
   * desconhecido e seria IGNORADO: a lista voltaria inteira com o chip aceso na tela. Filtro que
   * aparenta recortar e não recorta é pior que filtro ausente — o usuário conclui que o que existe não
   * existe. Os filtros de verdade são os declarados abaixo, os mesmos que o servidor lê.
   */
  const colunas: Column<Row>[] = [
    { key: "code", label: "Código", filterable: false },
    { ...colDate("document_date", "Data"), filterable: false },
    { key: "kind_rotulo", label: "Tipo de documento", render: (r) => String(r["kind_rotulo"] ?? "—"), filterable: false },
    colTipoOperacao(),
    { key: "client_name", label: "Cliente", filterable: false },
    { key: "empresa_name", label: "Empresa", filterable: false },
    { ...colMoney("subtotal", "Subtotal"), filterable: false },
    { ...colMoney("discount", "Desconto"), filterable: false },
    { ...colMoney("freight", "Frete"), filterable: false },
    { ...colMoney("total", "Total"), filterable: false },
    { ...colStatus(), filterable: false }
  ];

  /**
   * O `colSpan` do rodapé DERIVA da lista de colunas (`.claude/rules/frontend-web.md`): é o ÍNDICE da
   * coluna "Total". A conta fecha porque o rodapé do `DocList` já PREPENDE um `<td/>` próprio, que
   * ocupa a célula de seleção — então as N colunas anteriores ao total cabem exatamente em `colSpan=N`.
   * Com as onze colunas acima o resultado é 9, o MESMO número que o E2E `id-global-listagem.spec.ts:279`
   * mede hoje (ele confere o alinhamento do total sob a coluna Total, em pixels). Derivar em vez de
   * contar à mão é o que mantém esse alinhamento válido quando a lista ganhar ou perder uma coluna.
   */
  const indiceDoTotal = colunas.findIndex((c) => c.key === "total");
  const depoisDoTotal = colunas.length - indiceDoTotal - 1;

  return <DocList key={kind} title="Documentos comerciais" endpoint="/api/sales/documentos" base="/vendas" entity="sales_documents"
    // A rota do detalhe sai da VARIANTE DA LINHA (o que o servidor classificou), nunca do filtro ativo:
    // numa lista de tipos mistos, derivar do filtro mandaria o pedido para a porta do orçamento.
    rowHref={(r) => `/vendas/${String(r["kind"])}s/${String(r["id"])}`}
    canCreate={false} canCancel={false}
    defaultFilters={kind ? { kind } : undefined}
    filters={[
      { name: "start_date", label: "Data inicial", type: "date" },
      { name: "end_date", label: "Data final", type: "date" },
      { name: "client_id", label: "Cliente", type: "ref", resource: "people", extra: { is_client: "true" } },
      { name: "empresa_id", label: "Empresa", type: "ref", resource: "empresas" },
      { name: "status", label: COPY.situacao, type: "select", options: [{ value: "open", label: "Aberto" }, { value: "approved", label: "Aprovado" }, { value: "converted", label: "Convertido" }, { value: "confirmed", label: "Confirmado" }, { value: "cancelled", label: "Cancelado" }] },
      { name: "search", label: "Código / cliente", type: "text" },
      ...(opcoesTop.length ? [{ name: "tipo_operacao_id", label: "Tipo de Operação", type: "select" as const, options: opcoesTop }] : [])
    ]}
    columns={colunas}
    totals={(t) => <tr><td colSpan={indiceDoTotal} className="px-2 py-1">Total (filtro)</td><td className="num">{brl(t["total"] ?? "0")}</td>{Array.from({ length: depoisDoTotal }, (_, i) => <td key={i} />)}</tr>} />;
}
