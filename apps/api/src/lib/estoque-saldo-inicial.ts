/**
 * ═══ O SALDO INICIAL DE ESTOQUE — UMA REGRA PARA AS DUAS PORTAS (OPERACOES-01 F11, decisão 288) ═══
 *
 * O saldo inicial (o movimento "Estoque inicial", `opening_balance`) nasce por duas portas:
 *   · a tela antiga de Implantação (`POST /stock/opening-balances`, origem `opening_balances`);
 *   · a ENTRADA da Central de Estoque com uma TOP que lança o saldo inicial (seção `implantacao` do formato 5;
 *     origem `documentos_estoque`), na confirmação do documento.
 * O mesmo produto, local de estoque e lote não recebe dois saldos iniciais VIVOS, venha o primeiro de qualquer das
 * duas. A regra mora AQUI, uma vez: uma cópia por porta deixaria uma enxergar só os seus e aceitar o segundo.
 *
 * VIVO = o movimento `opening_balance` de entrada cuja ORIGEM não foi estornada (`reversal` da mesma origem, produto
 * e local). É o razão que responde pelas duas portas: o estorno da tela antiga (`DELETE`, `status = 'reversed'`) e o
 * cancelamento do documento estornam pela origem (`reverseStock`), e os dois liberam a chave. A conferência de ANTES
 * (o documento antigo `confirmed` em `erp.opening_balances`) continua somada a ela: a tela antiga nunca passa a aceitar
 * o que recusava — nem o documento antigo cujo movimento não está onde a chave procura (o gravado antes do aparo,
 * R1-1). Para todo documento antigo com o seu movimento, as duas respostas coincidem.
 *
 * O LOTE é comparado NORMALIZADO nos dois lados (`coalesce(nullif(btrim(x), ''), '')`): sem lote, nulo e espaços são
 * a mesma chave — o lote gravado antes do aparo (R1-1) pode ter espaços.
 *
 * A TRAVA: a conferência é "ler e depois gravar", e duas transações que conferem a mesma chave ao mesmo tempo leriam
 * as duas "não existe" (o saldo inicial que a outra grava ainda não foi commitado). Quem confere trava ANTES a chave
 * (trava consultiva de transação, o molde de `travarBaldeDoAjuste`): a segunda espera a primeira terminar e lê o
 * razão NOVO (READ COMMITTED: a leitura vem depois da espera). Quem trava várias chaves trava em ORDEM fixa (local,
 * produto, lote), e as duas portas usam a mesma chave de trava — sem deadlock entre elas.
 */
import type { ServiceCtx } from "./context.js";

/** A recusa da duplicidade — o MESMO texto que a tela antiga sempre devolveu (o web anterior o mostra como está). */
export const MENSAGEM_SALDO_INICIAL_DUPLICADO = "Já existe estoque inicial confirmado para este produto/local de estoque/lote";

/** O lote como a chave o compara: aparado, e vazio quando não há (o `coalesce(nullif(btrim(x), ''), '')` do SQL). */
export const loteDaChaveDoSaldoInicial = (lote: string | null | undefined): string => (lote ?? "").replace(/^ +| +$/g, "");

/** Uma chave do saldo inicial dentro de um local de estoque: o produto e o lote (o lote ainda sem aparar). */
export interface ChaveDoSaldoInicial { produtoId: string; lote: string | null | undefined }

/**
 * O texto que identifica a chave (produto em minúsculas, como o `uuid::text` do banco devolve; lote aparado) — o mesmo
 * de quem pergunta e de quem responde em `saldosIniciaisVivos`.
 */
export const textoDaChaveDoSaldoInicial = (c: ChaveDoSaldoInicial): string => `${c.produtoId.toLowerCase()}\u0000${loteDaChaveDoSaldoInicial(c.lote)}`;

/** As chaves DISTINTAS, em ORDEM fixa (produto, depois lote) — a ordem das travas. */
function chavesDistintasEmOrdem(chaves: readonly ChaveDoSaldoInicial[]): { produto: string; lote: string }[] {
  const distintas = new Map<string, { produto: string; lote: string }>();
  for (const c of chaves) distintas.set(textoDaChaveDoSaldoInicial(c), { produto: c.produtoId.toLowerCase(), lote: loteDaChaveDoSaldoInicial(c.lote) });
  const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...distintas.values()].sort((a, b) => comparar(a.produto, b.produto) || comparar(a.lote, b.lote));
}

/**
 * Trava (consultiva, até o fim da transação) as chaves organização + local de estoque + produto + lote, TODAS numa
 * consulta só, qualquer que seja o número de chaves (a implantação é o documento de centenas de produtos). As travas
 * são tomadas em ORDEM (produto, lote): a ordem vem do array (`with ordinality`) e o `order by` a fixa — a função
 * volátil da lista de saída é avaliada depois da ordenação. O local e o produto entram no texto pelo `uuid::text`
 * (minúsculas), qualquer que seja a grafia que o cliente mandou: as duas portas travam o MESMO texto.
 */
export async function travarChavesDoSaldoInicial(ctx: ServiceCtx, armazemId: string, chaves: readonly ChaveDoSaldoInicial[]): Promise<void> {
  const ordem = chavesDistintasEmOrdem(chaves);
  if (!ordem.length) return;
  await ctx.tx.query(
    `select pg_advisory_xact_lock(hashtextextended('estoque-saldo-inicial:' || $1::text || ':' || $2::uuid::text || ':' || k.produto::text || ':' || k.lote, 0))
       from unnest($3::uuid[], $4::text[]) with ordinality as k(produto, lote, n)
      order by k.n`,
    [ctx.orgId, armazemId, ordem.map((c) => c.produto), ordem.map((c) => c.lote)]);
}

/** A trava de UMA chave (a tela antiga) — a mesma consulta de `travarChavesDoSaldoInicial`. */
export async function travarChaveDoSaldoInicial(ctx: ServiceCtx, armazemId: string, produtoId: string, lote: string | null): Promise<void> {
  await travarChavesDoSaldoInicial(ctx, armazemId, [{ produtoId, lote }]);
}

/**
 * Quais destas chaves já têm saldo inicial VIVO? UMA consulta, qualquer que seja o número de chaves, sob a RLS da
 * transação (o local é da empresa que quem chama já conferiu; as duas tabelas são do módulo estoque). Cobre as duas
 * portas: a origem não entra no filtro do razão. Devolve os textos (`textoDaChaveDoSaldoInicial`) das chaves vivas.
 */
export async function saldosIniciaisVivos(ctx: ServiceCtx, armazemId: string, chaves: readonly ChaveDoSaldoInicial[]): Promise<Set<string>> {
  const ordem = chavesDistintasEmOrdem(chaves);
  if (!ordem.length) return new Set();
  const r = await ctx.tx.query<{ produto: string; lote: string }>(
    `select k.produto::text as produto, k.lote
       from unnest($3::uuid[], $4::text[]) as k(produto, lote)
      where exists (
              select 1 from erp.stock_movements m
               where m.organization_id = $1 and m.warehouse_id = $2 and m.product_id = k.produto
                 and coalesce(nullif(btrim(m.provider_lot), ''), '') = coalesce(nullif(btrim(k.lote), ''), '')
                 and m.movement_type = 'opening_balance' and m.direction = 1
                 and not exists (select 1 from erp.stock_movements r
                                  where r.organization_id = m.organization_id and r.source_type = m.source_type and r.source_id = m.source_id
                                    and r.product_id = m.product_id and r.warehouse_id = m.warehouse_id
                                    and r.movement_type = 'reversal' and r.direction = -1))
         or exists (
              select 1 from erp.opening_balances o
               where o.organization_id = $1 and o.warehouse_id = $2 and o.product_id = k.produto
                 and coalesce(nullif(btrim(o.provider_lot), ''), '') = coalesce(nullif(btrim(k.lote), ''), '')
                 and o.status = 'confirmed')`,
    [ctx.orgId, armazemId, ordem.map((c) => c.produto), ordem.map((c) => c.lote)]);
  return new Set(r.rows.map((x) => textoDaChaveDoSaldoInicial({ produtoId: x.produto, lote: x.lote })));
}

/** Há saldo inicial VIVO nesta chave (a tela antiga)? A mesma consulta de `saldosIniciaisVivos`. */
export async function existeSaldoInicialVivo(ctx: ServiceCtx, armazemId: string, produtoId: string, lote: string | null): Promise<boolean> {
  return (await saldosIniciaisVivos(ctx, armazemId, [{ produtoId, lote }])).size > 0;
}
