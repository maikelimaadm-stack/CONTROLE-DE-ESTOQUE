/**
 * COMPRAS-02 (decisão 268) — OS PRÓXIMOS PASSOS DO PEDIDO DE COMPRA: RECEBER (INTEIRO OU EM PARTES) E ENCERRAR O SALDO.
 *
 * O desenho é o dos próximos passos de Vendas (decisões 265 e 266), sem tocar em `sales.ts`: a leitura da política
 * de compras mora aqui, escrita para a tabela de compras.
 *
 * ┌─ RECEBER = LANÇAR UMA COMPRA COM ORIGEM ──────────────────────────────────────────────────────────────┐
 * │ A rota do recebimento não tem regra de lançamento própria: trava o pedido, confere a política e o saldo │
 * │ dos itens, monta o corpo de lançar compra (empresa, fornecedor e produto do PEDIDO; preço, descontos,  │
 * │ nota, lote e o resto do CORPO) e chama a MESMA `lancar` de `compras.ts`, com a origem como parâmetro.  │
 * │ A compra gerada é uma compra comum: confirma, estorna e cancela como na COMPRAS-01.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ SEM PONTE LEGADA ───────────────────────────────────────────────────────────────────────────────────┐
 * │ Em vendas, a versão que nunca declarou política segue a cadeia antiga (havia acervo para proteger).  │
 * │ Em compras não há acervo: pedido cuja TOP não declarou próximas operações NÃO tem próximo passo, e   │
 * │ "não configurada", "configurada vazia" e "TOP fora do leque" dão a MESMA recusa — o diálogo não vira │
 * │ oráculo de quais TOPs existem na organização.                                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ORDEM DAS TRAVAS. Recebimento: pedido (`for update`, em `lerDocumentoCompra`) → as de `lancar` (contador do
 * código → contador do ID Global → itens de origem, `for update` no gatilho da 0037). Cancelamento de compra
 * gerada: compra → pedido, e o pedido ANTES de qualquer movimento de estoque (ver `cancelarCompraConfirmada`).
 *
 * ┌─ TOP-CONFIG-08 (decisão 277) — A COMPRA GERADA SE CONFIRMA SOZINHA? ─────────────────────────────────┐
 * │ Só quando a versão congelada DELA (a da TOP de destino, nunca a do pedido) está no formato 4 com       │
 * │ Confirmação Automática. A tentativa é a ÚLTIMA coisa do recebimento — depois de o pedido virar         │
 * │ convertido e da auditoria "convert" — e nunca dentro de `lancar`, que também serve ao POST de compra.   │
 * │ Ela chama a MESMA confirmação do POST /confirm, num savepoint: recusou, a compra fica salva e aberta e   │
 * │ o pedido convertido como hoje. Formato 1–3 ou Manual: o corpo da resposta é o de hoje, chave por chave. │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * As rotas são registradas por `registrarRecebimentoCompras(app)`, chamada pelo registro de `compras.ts`. Nada
 * aqui é avaliado no carregamento do módulo além de constantes locais: `compras.ts` e este arquivo se importam, e
 * `compras-confirmacao.ts` também (ela trava e reabre o pedido de origem; este arquivo chama a confirmação dela).
 *
 * ┌─ OPERACOES-01 F6a (decisão 283) — O PEDIDO FINALIZADO ───────────────────────────────────────────────┐
 * │ O pedido é recebido ABERTO ou FINALIZADO. Com `fluxoCompra.exigeFinalizar` na versão congelada DO      │
 * │ PEDIDO (formato 5), só o FINALIZADO: o aberto recebe 409. Sem a seção (formatos 1 a 4, ou o neutro) é  │
 * │ como hoje. Configuração ilegível: recusa (fail-closed). Zerado o saldo, vira convertido a partir do     │
 * │ aberto ou do finalizado; o saldo se encerra a partir dos dois; e a compra cancelada REABRE o pedido na  │
 * │ situação de antes de converter (finalizado, se ele tinha sido finalizado). A política de destinos é    │
 * │ exportada com a espécie pedida (o orçamento de compra lê o MESMO leque, com "orcamento").              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, DomainError } from "@agro/shared";
import {
  chaveI18nDaFamiliaOperacional, validarDestinoOperacao, varianteDeDocumentoCompraDaFamilia,
  validarItensDoRecebimento, recebimentoZeraOPedido, saldoDoItemDoPedido, MSG_ITENS_DO_RECEBIMENTO,
  fluxoCompraDaVersaoTop, MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER,
  type ItemDoPedido, type ItemDoRecebimento, type RecusaItemDoRecebimento,
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, idempotent, audit, requirePermission } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import { exigirEmpresaDeLancamento, hasPermission, type ServiceCtx } from "../lib/context.js";
import { confirmaAutomaticamente, tentarConfirmacaoAutomatica, lerVersaoCongeladaTop } from "../lib/confirmacao-automatica.js";
import { lerDocumentoCompra, lancar, recebimentoSchema, type DocumentoCompraEntrada, type RecebimentoEntrada } from "./compras.js";
import { confirmarCompraNaTransacao } from "./compras-confirmacao.js";
// OPERACOES-01 F9b (decisão 286): a provisão do pedido de compra ao receber e ao encerrar o saldo.
import { sincronizarProvisaoDoPedidoDeCompra } from "../lib/financeiro-provisao.js";
import { MOTIVOS_DA_PROVISAO, MOTIVOS_DA_PROVISAO_COMPRA } from "@agro/domain";

const t = criarTradutor(ptBR);

// ─────────────── mensagens ───────────────

export const MSG_PEDIDO_NAO_ABERTO = "Este pedido não está aberto.";
/** A MESMA recusa para política não configurada, configurada vazia e TOP fora do leque. */
export const MSG_PEDIDO_SEM_PROXIMA_OPERACAO = "A TOP deste pedido não tem próxima operação configurada.";
export const MSG_PEDIDO_SEM_COMPRA = "Este pedido ainda não tem compra: cancele-o em vez de encerrar o saldo.";
export const MSG_PEDIDO_SEM_SALDO = "Este pedido não tem saldo a encerrar.";
export const MSG_PEDIDO_COM_COMPRAS = "Este pedido tem compras: cancele-as ou encerre o saldo.";
export const MSG_PEDIDO_CONVERTIDO_COM_COMPRAS = "Este pedido tem compras: cancele-as primeiro.";
export const MSG_PEDIDO_CONVERTIDO_NAO_CANCELA = "Este pedido já foi convertido em compra e não é cancelado.";
/** OPERACOES-01 F6a: a configuração da TOP do pedido que este servidor não lê — o receber e o finalizar recusam (fail-closed). */
export const MSG_CONFIGURACAO_DO_PEDIDO_ILEGIVEL = "A configuração da operação deste pedido está num formato que este servidor não executa.";

/** OPERACOES-01 F6b: quem LANÇA orçamento de compra vê o leque de orçamento em `/proximos-passos`. */
const PERMISSAO_CRIAR_ORCAMENTO = "orcamentos_compra.create";

/** OPERACOES-01 F6a: as situações do pedido que recebem, encerram o saldo e viram convertido. */
const SITUACOES_DO_PEDIDO_EM_ANDAMENTO: readonly string[] = ["aberto", "finalizado"];

/** O corpo do encerramento do saldo: motivo obrigatório, até 500 caracteres. `.strict()`: chave desconhecida é 422. */
const encerrarSaldoSchema = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

// ─────────────── a política de próximas operações ───────────────

/** Um próximo passo do pedido — o contrato de `/proximos-passos` de vendas, com `especie` no lugar de `variante`. */
export interface ProximoPassoCompra {
  tipoOperacaoId: string; codigo: string; nome: string; codigoBase: string; familiaRotulo: string;
  especie: EspecieDoDestinoDaCompra; ordem: number; emPartes: boolean;
}
/** OPERACOES-01 F6a: as espécies que o leque do pedido oferece — a compra (receber) e o orçamento de compra. */
export type EspecieDoDestinoDaCompra = "compra" | "orcamento";
interface PoliticaDeDestinosDaCompra { configurada: boolean; itens: ProximoPassoCompra[] }

/**
 * A POLÍTICA DO PEDIDO: o leque sai da versão CONGELADA que o pedido cita (`destinos_configurados` +
 * `tipos_operacao_versao_destinos`); a DISPONIBILIDADE de cada destino é avaliada AGORA (ativo, não excluído, e a
 * aresta executável pelo grafo). UMA ida ao banco: a versão de origem é o lado fixo do `left join` e responde o
 * estado mesmo sem aresta nenhuma.
 *
 * FAIL-CLOSED na apresentação: destino cuja aresta o grafo não executa (compra → pedido, venda, família fora do
 * registry) não é oferecido — um botão sem serviço atrás é pior do que um botão a menos.
 *
 * OPERACOES-01 F6a: EXPORTADA, com a ESPÉCIE pedida — `"compra"` (o receber e os próximos passos, como hoje) ou
 * `"orcamento"` (a TOP do orçamento de compra, em `compras-orcamento.ts`). Só os destinos daquela espécie entram.
 */
export async function politicaDeDestinosDaCompra(ctx: ServiceCtx, versaoOrigemId: string, especie: EspecieDoDestinoDaCompra = "compra"): Promise<PoliticaDeDestinosDaCompra> {
  return politicaDaEspecie(await linhasDaPoliticaDeDestinos(ctx, versaoOrigemId), especie);
}

/**
 * OPERACOES-01 F6b (decisão 283): a política das DUAS espécies (a compra e o orçamento) na MESMA ida ao banco — a de
 * `/proximos-passos` com o leque do orçamento. Cada uma é exatamente a de `politicaDeDestinosDaCompra` daquela espécie.
 */
export async function politicasDeDestinosDaCompra(ctx: ServiceCtx, versaoOrigemId: string): Promise<Record<EspecieDoDestinoDaCompra, PoliticaDeDestinosDaCompra>> {
  const linhas = await linhasDaPoliticaDeDestinos(ctx, versaoOrigemId);
  return { compra: politicaDaEspecie(linhas, "compra"), orcamento: politicaDaEspecie(linhas, "orcamento") };
}

/** Uma linha da política: a versão de origem (sempre) e, quando há aresta, o destino dela. */
interface LinhaDaPolitica {
  destinos_configurados: boolean; origem_codigo_base: string; destino_id: string | null; codigo: string | null;
  nome: string | null; codigo_base: string | null; ordem: number | null; em_partes: boolean | null;
}

/** A ida ao banco da política (todas as espécies), na ordem do leque. A versão não lida é recusada (ver acima). */
async function linhasDaPoliticaDeDestinos(ctx: ServiceCtx, versaoOrigemId: string): Promise<LinhaDaPolitica[]> {
  const r = await ctx.tx.query<LinhaDaPolitica>(
    `select vo.destinos_configurados, torig.codigo_base as origem_codigo_base,
            t.id as destino_id, t.codigo, tv.nome, t.codigo_base, d.ordem, d.em_partes
       from erp.tipos_operacao_versoes vo
       join erp.tipos_operacao torig
         on torig.id = vo.tipo_operacao_id and torig.organization_id = vo.organization_id
       left join erp.tipos_operacao_versao_destinos d
         on d.origem_versao_id = vo.id and d.organization_id = vo.organization_id
       left join erp.tipos_operacao t
         on t.id = d.destino_tipo_operacao_id and t.organization_id = d.organization_id
        and t.ativo and t.excluido_em is null
       left join erp.tipos_operacao_versoes tv
         on tv.tipo_operacao_id = t.id and tv.organization_id = t.organization_id and tv.versao = t.versao_atual
      where vo.organization_id = $1 and vo.id = $2
      order by d.ordem, t.codigo`,
    [ctx.orgId, versaoOrigemId]);
  // A versão que o pedido cita não foi lida: a TOP é NOT NULL com FK composta, então isto é corrupção — recusar,
  // nunca "sem política" (que aqui daria no mesmo, mas por acaso).
  if (!r.rows[0]) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este documento");
  return r.rows;
}

/** O leque de UMA espécie, das linhas já lidas (a primeira linha existe: `linhasDaPoliticaDeDestinos` o garante). */
function politicaDaEspecie(linhas: readonly LinhaDaPolitica[], especie: EspecieDoDestinoDaCompra): PoliticaDeDestinosDaCompra {
  const itens: ProximoPassoCompra[] = [];
  for (const linha of linhas) {
    if (!linha.destino_id || linha.codigo === null || linha.nome === null || linha.codigo_base === null || linha.ordem === null) continue;
    if (validarDestinoOperacao(linha.origem_codigo_base, linha.codigo_base).length > 0) continue;
    if (varianteDeDocumentoCompraDaFamilia(linha.codigo_base) !== especie) continue;
    itens.push({
      tipoOperacaoId: linha.destino_id, codigo: linha.codigo, nome: linha.nome, codigoBase: linha.codigo_base,
      familiaRotulo: t(chaveI18nDaFamiliaOperacional(linha.codigo_base) ?? linha.codigo_base),
      especie, ordem: linha.ordem, emPartes: linha.em_partes === true,
    });
  }
  return { configurada: linhas[0]!.destinos_configurados, itens };
}

// ─────────────── o pedido como o recebimento o lê ───────────────

/** O pedido lido por `lerDocumentoCompra` (espécie pedido): as colunas que o recebimento e o encerramento usam. */
export interface PedidoLido {
  id: string; situacao: string; empresa_id: string; fornecedor_id: string; tipo_operacao_versao_id: string;
  itens: { id: string; produto_id: string; quantidade: string; recebido: string; saldo: string }[];
  compras_geradas: { id: string; codigo: string; situacao: string }[];
}
const comoPedido = (d: Record<string, unknown>) => d as unknown as PedidoLido;

/** Os itens do pedido no formato do domínio — o `recebido` já veio da leitura feita DEPOIS da trava. */
const itensDoPedido = (p: PedidoLido): ItemDoPedido[] =>
  p.itens.map((i) => ({ id: i.id, produtoId: i.produto_id, quantidade: String(i.quantidade), recebido: i.recebido }));

/**
 * Onde cada recusa aponta no corpo: o item (`itens[N].item_origem_id`) quando o problema é QUAL item, a
 * quantidade (`itens[N].quantidade`) quando é QUANTO, e `itens` quando fala do recebimento inteiro (um item com
 * saldo que ficou de fora numa operação que recebe o pedido inteiro).
 */
function caminhoDaRecusa(r: RecusaItemDoRecebimento): string {
  if (!("posicao" in r) || r.posicao === undefined) return "itens";
  const campo = r.motivo === "item_desconhecido" || r.motivo === "item_repetido" || r.motivo === "item_sem_saldo" ? "item_origem_id" : "quantidade";
  return `itens[${r.posicao}].${campo}`;
}
function recusaDosItens(recusas: readonly RecusaItemDoRecebimento[]): DomainError {
  const details = recusas.map((r) => ({ path: caminhoDaRecusa(r), message: MSG_ITENS_DO_RECEBIMENTO[r.motivo], ...r }));
  return err("VALIDATION_ERROR", details[0]!.message, details);
}

// ─────────────── receber ───────────────

/**
 * OPERACOES-01 F6a — "EXIGIR PEDIDO FINALIZADO PARA RECEBER" (`fluxoCompra.exigeFinalizar`), lido da versão
 * congelada DO PEDIDO (a TOP de quem é recebido, não a da compra de destino). Formatos 1 a 4 (mesmo malformados: a
 * versão não é lida) e o neutro do 5: não exige — o pedido aberto é recebido como hoje. Formato desconhecido, ou um 5
 * que o leitor recusa: ninguém sabe o que ela decidiu, e o receber não adivinha (TIPO_OPERACAO_EXECUCAO_INDISPONIVEL).
 */
async function exigeFinalizarParaReceber(ctx: ServiceCtx, pedido: PedidoLido): Promise<boolean> {
  const fluxo = fluxoCompraDaVersaoTop(await lerVersaoCongeladaTop(ctx, pedido.tipo_operacao_versao_id));
  if (!fluxo.ok) throw new DomainError("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL", MSG_CONFIGURACAO_DO_PEDIDO_ILEGIVEL, { motivo: fluxo.motivo });
  return fluxo.valor.exigeFinalizar;
}

/**
 * A VERSÃO CONGELADA DA COMPRA GERADA — lida da linha que `lancar` acabou de gravar, e não da TOP do corpo: a
 * versão que vale é a que a compra cita (a TOP pode ganhar versão nova entre o lançamento e a leitura, e a compra
 * continua na dela). A linha foi inserida nesta transação; não lê-la é corrupção, nunca "sem TOP".
 */
async function versaoCongeladaDaCompraGerada(ctx: ServiceCtx, compraId: string): Promise<string | null> {
  const r = await ctx.tx.query<{ tipo_operacao_versao_id: string | null }>(
    "select tipo_operacao_versao_id from erp.documentos_compra where id = $1 and organization_id = $2 and especie = 'compra'",
    [compraId, ctx.orgId]);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  return linha.tipo_operacao_versao_id;
}

/**
 * OPERACOES-01 F7 (decisão 284) — O RECEBER EM DUAS METADES, exportadas: `prepararRecebimentoDoPedido` (tudo o que vem
 * ANTES de lançar a compra) e `concluirRecebimentoDoPedido` (tudo o que vem DEPOIS). O receber de hoje é as duas em
 * volta de `lancar`, com o mesmo comportamento, e a importação do XML ("Gerar compra" com pedido) usa as MESMAS duas
 * em volta do `lancar` dela — nenhuma regra do receber é copiada. A confirmação automática fica só no receber (a compra
 * gerada pela importação nunca se confirma sozinha).
 *
 * PREPARAR: 1ª TRAVA, o pedido (duas conversões sobre o mesmo saldo se enfileiram aqui, e a segunda lê — nos itens,
 * lidos depois da trava — o recebido que a primeira gravou; o gatilho da origem é a rede) → situação (aberto ou
 * finalizado; "exige finalizar" da TOP do pedido) → o leque da TOP de destino → `compras.create` → o saldo dos itens
 * (`validarItensDoRecebimento`) → a empresa do pedido no escopo de escrita. Devolve o pedido lido, o passo do leque e
 * os itens validados (na ordem do corpo, quantidades normalizadas).
 */
export async function prepararRecebimentoDoPedido(ctx: ServiceCtx, pedidoId: string, tipoOperacaoId: string, itens: readonly ItemDoRecebimento[]):
  Promise<{ pedido: PedidoLido; passo: ProximoPassoCompra; validados: ItemDoRecebimento[] }> {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  // OPERACOES-01 F6a: aberto ou finalizado recebem (a mensagem de hoje para o resto); com a TOP do pedido exigindo
  // o pedido finalizado, o aberto não recebe.
  if (!SITUACOES_DO_PEDIDO_EM_ANDAMENTO.includes(pedido.situacao)) throw err("CONFLICT", MSG_PEDIDO_NAO_ABERTO);
  // A configuração é lida também no finalizado: ilegível recusa nos dois (fail-closed).
  const exigeFinalizar = await exigeFinalizarParaReceber(ctx, pedido);
  if (exigeFinalizar && pedido.situacao === "aberto") throw err("CONFLICT", MSG_PEDIDO_PRECISA_FINALIZAR_PARA_RECEBER);

  // O GRAFO RESTRINGE O CAMINHO; a capacidade do destino, cobrada logo depois, é quem autoriza percorrê-lo.
  const politica = await politicaDeDestinosDaCompra(ctx, pedido.tipo_operacao_versao_id);
  const passo = politica.configurada ? politica.itens.find((x) => x.tipoOperacaoId === tipoOperacaoId) : undefined;
  if (!passo) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", MSG_PEDIDO_SEM_PROXIMA_OPERACAO);
  requirePermission(ctx, "compras.create");

  // O SALDO É SÓ DE QUANTIDADE. Sem "Em partes": todos os itens com saldo, cada um com o saldo inteiro; com: um
  // subconjunto, cada quantidade > 0 e ≤ saldo. Item repetido ou de outro pedido: 422 no item.
  const v = validarItensDoRecebimento(itensDoPedido(pedido), itens, { emPartes: passo.emPartes });
  if (!v.ok) throw recusaDosItens(v.recusas);

  // A empresa do lançamento é a do pedido — a MESMA conferência do POST de compra (escopo de escrita do módulo).
  await exigirEmpresaDeLancamento(ctx, pedido.empresa_id);
  return { pedido, passo, validados: v.itens };
}

/**
 * CONCLUIR — depois de `lancar` (com a origem): o pedido só vira convertido quando esta compra zera o saldo de TODOS
 * os itens (ROW COUNT sob RLS), a auditoria "convert" no pedido e a provisão dele (F9b). Devolve se zerou e a situação
 * REAL do pedido depois do receber (convertido, ou a de antes).
 */
export async function concluirRecebimentoDoPedido(ctx: ServiceCtx, pedidoId: string, pedido: PedidoLido, passo: ProximoPassoCompra,
  validados: readonly ItemDoRecebimento[], compra: { id: string; codigo: string }): Promise<{ zera: boolean; pedidoSituacao: string }> {
  const zera = recebimentoZeraOPedido(itensDoPedido(pedido), validados);
  if (zera) {
    const u = await ctx.tx.query(
      "update erp.documentos_compra set situacao = 'convertido' where id = $1 and organization_id = $2 and especie = 'pedido' and situacao in ('aberto', 'finalizado')",
      [pedidoId, ctx.orgId]);
    // ROW COUNT SOB RLS: zero linha sem conferência seria "convertido" sem efeito.
    if (u.rowCount !== 1) throw notFound("Documento");
  }
  await audit(ctx.tx, ctx, "documentos_compra", pedidoId, "convert",
    { to: compra.id, tipoOperacaoDestinoId: passo.tipoOperacaoId, emPartes: passo.emPartes, zeraOSaldo: zera,
      itens: validados.map((i) => ({ origemItemId: i.itemOrigemId, quantidade: i.quantidade })) },
    zera ? { before: { situacao: pedido.situacao }, after: { situacao: "convertido" } } : undefined);
  // OPERACOES-01 F9b (decisão 286): a compra que zera o saldo converte o pedido — o previsto passa a esperar só o que já
  // foi gerado. Antes da confirmação automática (que sincroniza de novo, idempotente). O pedido já está travado (1ª trava).
  await sincronizarProvisaoDoPedidoDeCompra(ctx, pedidoId, MOTIVOS_DA_PROVISAO_COMPRA.recebido(compra.codigo));
  return { zera, pedidoSituacao: zera ? "convertido" : pedido.situacao };
}

/**
 * RECEBER O PEDIDO — dentro da transação da rota, sob a chave de idempotência. Nada é gravado antes de TODAS as
 * conferências; um throw desfaz a transação inteira (pedido aberto, zero compra, zero auditoria). É
 * `prepararRecebimentoDoPedido` → `lancar` (com a origem) → `concluirRecebimentoDoPedido` → a confirmação automática.
 *
 * TOP-CONFIG-08: o `app` entra para a confirmação automática da compra gerada — o gate da execução configurada
 * sai dele aqui dentro (o mesmo de `confirmarCompraNaTransacao`), para o lançamento e a confirmação lerem o MESMO.
 */
async function receberPedido(app: FastifyInstance, ctx: ServiceCtx, pedidoId: string, corpo: RecebimentoEntrada) {
  const pedidos: ItemDoRecebimento[] = corpo.itens.map((i) => ({ itemOrigemId: i.item_origem_id, quantidade: i.quantidade }));
  const { pedido, passo, validados } = await prepararRecebimentoDoPedido(ctx, pedidoId, corpo.tipo_operacao_id, pedidos);
  const itensPedido = itensDoPedido(pedido);

  // O corpo de LANÇAR COMPRA: empresa, fornecedor e produto do pedido; o resto (preço e descontos da nota, nota,
  // série, datas, armazém, lote, validade, classificação, condição) do corpo. `validados[i]` é a linha i do corpo.
  const produtoDoItem = new Map(itensPedido.map((i) => [i.id, i.produtoId]));
  const { itens: itensDoCorpo, ...cabecalho } = corpo;
  const d: DocumentoCompraEntrada = {
    ...cabecalho,
    empresa_id: pedido.empresa_id,
    fornecedor_id: pedido.fornecedor_id,
    itens: itensDoCorpo.map(({ item_origem_id, ...item }, i) => ({ ...item, produto_id: produtoDoItem.get(item_origem_id)!, quantidade: validados[i]!.quantidade })),
  };

  // AS TRAVAS SEGUINTES SÃO AS DE `lancar`, na ordem dele: contador do código da compra → contador do ID Global
  // (`atribuirIdGlobal`, antes das linhas) → itens de origem (gatilho, no INSERT de cada linha). NÃO se trava o
  // contador do ID Global antes de `lancar`: o POST de compra comum pega código → ID Global, e a ordem invertida
  // aqui fecharia um ciclo (ABBA) entre um recebimento e um lançamento simultâneos na mesma organização.
  const compra = await lancar(ctx, "compra", d, app.config.TOP_EFFECTS_RUNTIME_V1_ENABLED,
    { documentoId: pedidoId, itemOrigemIds: validados.map((i) => i.itemOrigemId) });

  // O pedido só vira convertido quando esta compra zera o saldo de TODOS os itens; a auditoria e a provisão.
  const { pedidoSituacao } = await concluirRecebimentoDoPedido(ctx, pedidoId, pedido, passo, validados, compra);
  // A situação REAL do pedido depois do receber: convertido, ou a de antes (aberto — o de hoje — ou finalizado).
  const corpoDeHoje = { ...compra, from: pedidoId, pedidoSituacao };

  // TOP-CONFIG-08 (decisão 277) — A CONFIRMAÇÃO AUTOMÁTICA DA COMPRA GERADA, no fim MESMO: o pedido já está
  // convertido (ou aberto, recebido em parte) e auditado. Quem confirma é quem recebeu, com a capacidade da
  // confirmação manual (`compras.edit`); a TOP nunca dá a ninguém um poder que ele não tem. A tentativa roda num
  // savepoint: recusa de domínio ou do banco (saldo, período, exigência, aprovação, a guarda da 0041) volta só a
  // confirmação — a compra fica salva e aberta, o pedido como acima, e a resposta diz o porquê. Erro que não é de
  // domínio sobe (500) e desfaz o recebimento inteiro, como hoje.
  // TRAVAS: as do recebimento (pedido → contador do código → contador do ID Global → itens de origem) já estão
  // tomadas; a confirmação pega a compra (desta transação), o contador do ID Global (já preso) e então o estoque —
  // a ordem da confirmação manual da compra. Compra e estoque: sem ciclo entre si; possível com a confirmação MANUAL
  // de VENDA do mesmo produto (40P01), que trava saldo e produto (`postStock`) e só depois o contador (`createTitles`)
  // — o ciclo que a confirmação manual da compra já tinha. Desfecho do CA-12: a automática que perde vira "recusada"
  // (a compra salva e aberta, o pedido como acima, CONCURRENCY_CONFLICT), ou a manual da venda recebe o 409 de hoje.
  // O contador do ID Global fica preso durante a confirmação: os lançamentos da organização esperam por ele (risco
  // declarado na decisão 277).
  // IDEMPOTÊNCIA: isto roda DENTRO do `idempotent` da rota, então o resultado entra no corpo gravado; o replay
  // devolve o mesmo corpo e não confirma de novo.
  const versaoDaCompra = await versaoCongeladaDaCompraGerada(ctx, compra.id);
  const confirmacaoAutomatica = (await confirmaAutomaticamente(ctx, versaoDaCompra))
    ? await tentarConfirmacaoAutomatica(ctx, {
      permissao: "compras.edit",
      confirmar: () => confirmarCompraNaTransacao(app, ctx, compra.id, { automatica: true }),
    })
    : undefined;
  // Formato 1–3 ou Manual: SEM a chave nova — o corpo é o de hoje, chave por chave.
  if (!confirmacaoAutomatica) return corpoDeHoje;
  // Confirmada: a situação da resposta é a da compra gerada, que deixou de ser a "aberto" herdada de `lancar`.
  return { ...corpoDeHoje, ...(confirmacaoAutomatica.confirmado ? { situacao: "confirmado" } : {}), confirmacaoAutomatica };
}

// ─────────────── encerrar o saldo ───────────────

/** OPERACOES-01 F6a: o saldo se encerra também a partir do pedido FINALIZADO (a mesma mensagem para o resto). */
async function encerrarSaldo(ctx: ServiceCtx, pedidoId: string, motivo: string) {
  const pedido = comoPedido(await lerDocumentoCompra(ctx, pedidoId, "pedido", { lock: true }));
  if (!SITUACOES_DO_PEDIDO_EM_ANDAMENTO.includes(pedido.situacao)) throw err("CONFLICT", MSG_PEDIDO_NAO_ABERTO);
  // Sem compra nenhuma o que se quer é CANCELAR o pedido, não encerrar saldo: "encerrado" diria que parte chegou.
  if (!pedido.compras_geradas.some((c) => c.situacao !== "cancelado")) throw err("VALIDATION_ERROR", MSG_PEDIDO_SEM_COMPRA);
  const saldo = itensDoPedido(pedido).reduce((a, i) => a.plus(saldoDoItemDoPedido(i)), D(0));
  if (!saldo.gt(0)) throw err("VALIDATION_ERROR", MSG_PEDIDO_SEM_SALDO);
  // Quem, quando e por quê na MESMA mudança (aberto|finalizado) → convertido: o gatilho da 0044 recusa em qualquer outra.
  const u = await ctx.tx.query(
    `update erp.documentos_compra set situacao = 'convertido', saldo_encerrado_em = now(), saldo_encerrado_por = $3, saldo_encerrado_motivo = $4
      where id = $1 and organization_id = $2 and especie = 'pedido' and situacao in ('aberto', 'finalizado')`,
    [pedidoId, ctx.orgId, ctx.user.id, motivo]);
  // ROW COUNT SOB RLS: zero linha sem conferência seria "encerrado" sem efeito.
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", pedidoId, "encerrar_saldo", { motivo, saldo: saldo.toFixed(4) },
    { before: { situacao: pedido.situacao }, after: { situacao: "convertido" } });
  // OPERACOES-01 F9b (decisão 286): o saldo encerrado deixa previsto só o que já virou compra e ainda não foi confirmado.
  await sincronizarProvisaoDoPedidoDeCompra(ctx, pedidoId, MOTIVOS_DA_PROVISAO.saldoEncerrado(motivo));
  return { id: pedidoId, situacao: "convertido" };
}

// ─────────────── cancelamentos (chamados por compras.ts e compras-confirmacao.ts) ───────────────

/**
 * O PEDIDO SE CANCELA? — conferido com o pedido JÁ TRAVADO (as compras geradas e o saldo encerrado vêm da mesma
 * leitura). 409 antes de o banco recusar, com a mensagem que diz o que fazer. Três casos:
 *  - convertido COM saldo encerrado (com ou sem compra viva): alguém decidiu que o resto não vem; cancelar as
 *    compras não reabre o pedido (reabrirPedidoDeOrigem), então "cancele-as" seria um caminho sem saída → "já foi
 *    convertido e não é cancelado";
 *  - aberto com compra viva: há dois caminhos — cancelar as compras ou encerrar o saldo;
 *  - convertido SEM saldo encerrado, com compra viva: encerrar o saldo não se aplica (não está aberto); cancelar as
 *    compras, sim (a que zerou o saldo, cancelada, reabre o pedido) → "cancele-as primeiro".
 * Convertido sem saldo encerrado e sem compra viva não existe (cancelar a última compra reabre); o gatilho é a rede.
 */
export function conferirCancelamentoDoPedido(doc: Record<string, unknown>): void {
  const pedido = comoPedido(doc);
  const convertido = pedido.situacao === "convertido";
  if (convertido && doc.saldo_encerrado_em != null) throw err("CONFLICT", MSG_PEDIDO_CONVERTIDO_NAO_CANCELA);
  const comCompraViva = (pedido.compras_geradas ?? []).some((c) => c.situacao !== "cancelado");
  if (comCompraViva) throw err("CONFLICT", convertido ? MSG_PEDIDO_CONVERTIDO_COM_COMPRAS : MSG_PEDIDO_COM_COMPRAS);
  if (convertido) throw err("CONFLICT", MSG_PEDIDO_CONVERTIDO_NAO_CANCELA);
}

/**
 * O pedido de origem travado pelo cancelamento da compra: o estado que decide a reabertura. OPERACOES-01 F6a:
 * `finalizado` = o pedido foi finalizado antes de converter (o carimbo da finalização nunca se apaga).
 */
export interface PedidoDeOrigemTravado { id: string; situacao: string; saldoEncerrado: boolean; finalizado: boolean }

/**
 * TRAVA O PEDIDO DE ORIGEM DA COMPRA (`for update`) — compra → pedido, antes de qualquer movimento. Compra sem
 * origem: `null`, nada muda. O pedido que a compra cita e não se lê (a RLS devolveria zero linha) NÃO vira "sem
 * pedido": o gatilho garante mesma empresa, então isto é corrupção, e seguir deixaria o pedido convertido com
 * saldo devolvido — recusa-se, e a transação inteira desfaz.
 */
export async function travarPedidoDeOrigemDaCompra(ctx: ServiceCtx, compra: Record<string, unknown>): Promise<PedidoDeOrigemTravado | null> {
  const origem = compra.especie === "compra" ? (compra.origem_documento_id as string | null | undefined) ?? null : null;
  if (!origem) return null;
  const r = await ctx.tx.query<{ id: string; situacao: string; saldo_encerrado: boolean; finalizado: boolean }>(
    `select id, situacao, saldo_encerrado_em is not null as saldo_encerrado, finalizado_em is not null as finalizado from erp.documentos_compra
      where id = $1 and organization_id = $2 and especie = 'pedido' for update`, [origem, ctx.orgId]);
  const p = r.rows[0];
  if (!p) throw notFound("Documento");
  return { id: p.id, situacao: p.situacao, saldoEncerrado: p.saldo_encerrado, finalizado: p.finalizado };
}

/**
 * DEPOIS de cancelar a compra: o saldo dela voltou (é conta, não coluna). Pedido convertido porque o saldo ZEROU
 * volta a aberto; convertido porque o saldo foi ENCERRADO fica como está — alguém decidiu que o resto não vem, e
 * cancelar uma compra não desfaz essa decisão. Pedido aberto (recebido em parte) não muda.
 *
 * OPERACOES-01 F6a: reabre na situação de ANTES de converter — `finalizado` se o pedido tinha sido finalizado
 * (`finalizado_em`), `aberto` se não. É a mesma conta da transição v3 da 0044, que recusa o outro destino.
 */
export async function reabrirPedidoDeOrigem(ctx: ServiceCtx, pedido: PedidoDeOrigemTravado | null, compraId: string): Promise<void> {
  if (!pedido || pedido.situacao !== "convertido" || pedido.saldoEncerrado) return;
  const reaberto = pedido.finalizado ? "finalizado" : "aberto";
  const u = await ctx.tx.query(
    `update erp.documentos_compra set situacao = $3
      where id = $1 and organization_id = $2 and especie = 'pedido' and situacao = 'convertido' and saldo_encerrado_em is null`,
    [pedido.id, ctx.orgId, reaberto]);
  // ROW COUNT SOB RLS: zero linha sem conferência seria "reaberto" sem efeito.
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_compra", pedido.id, "compra_cancelada", { compra: compraId },
    { before: { situacao: "convertido" }, after: { situacao: reaberto } });
}

// ─────────────── rotas ───────────────

/** Registra próximos passos, recebimento e encerramento do saldo. Chamada no fim do registro de `compras.ts`. */
export function registrarRecebimentoCompras(app: FastifyInstance) {
  /**
   * OS PRÓXIMOS PASSOS DO PEDIDO — leitura (`pedidos_compra.view`): perguntar o que se pode gerar é ler o pedido;
   * a capacidade do destino é cobrada no recebimento. A leitura do pedido vem ANTES da política: inexistente, de
   * outro tenant, fora do escopo e compra na porta do pedido caem na MESMA 404 do GET (sem oráculo de existência).
   *
   * OPERACOES-01 F6a: + `exigeFinalizar` no FIM do corpo — a versão congelada DO PEDIDO exige o pedido finalizado
   * para receber? Ilegível → `true` (fail-closed na apresentação: o receber recusaria). Os itens continuam só os de
   * compra (o "Receber em …" da tela); o orçamento tem a sua própria porta.
   *
   * OPERACOES-01 F6b (decisão 283): + `orcamentos` no FIM do corpo — o leque de TOPs de ORÇAMENTO de compra da
   * versão congelada do pedido (a MESMA política que o criar orçamento confere: configurada → os destinos de espécie
   * orçamento; não configurada → `[]`), para o "Novo orçamento" da consulta. SÓ para quem tem
   * `orcamentos_compra.create` — sem ela a chave NÃO existe (oferecer o que ele não lança seria um botão sem porta).
   * As duas espécies saem da MESMA leitura da política (`politicasDeDestinosDaCompra`): nenhuma consulta a mais.
   * `items` continua SÓ a compra.
   */
  app.get("/compras/pedidos/:id/proximos-passos", async (req) => runService(app, req, "pedidos_compra.view", async (ctx) => {
    const pedido = comoPedido(await lerDocumentoCompra(ctx, (req.params as { id: string }).id, "pedido"));
    const politicas = await politicasDeDestinosDaCompra(ctx, pedido.tipo_operacao_versao_id);
    const politica = politicas.compra;
    const fluxo = fluxoCompraDaVersaoTop(await lerVersaoCongeladaTop(ctx, pedido.tipo_operacao_versao_id));
    const corpo = { contractVersion: 1, politicaConfigurada: politica.configurada, items: politica.itens, exigeFinalizar: fluxo.ok ? fluxo.valor.exigeFinalizar : true };
    if (!hasPermission(ctx, PERMISSAO_CRIAR_ORCAMENTO)) return corpo;
    const leque = politicas.orcamento;
    return { ...corpo, orcamentos: leque.configurada ? leque.itens : [] };
  }));

  /**
   * RECEBER (converter o pedido em compra). OPERAÇÃO COMPOSTA: muta o pedido (`pedidos_compra.edit`, na porta) e
   * cria a compra (`compras.create`, cobrada DENTRO, depois de saber o destino). Corpo conferido antes de tudo;
   * visibilidade ANTES da idempotência (o replay não atravessa o escopo); o USUÁRIO no hash (chave alheia nunca
   * devolve a resposta de outro).
   */
  app.post("/compras/pedidos/:id/convert", async (req, reply) => reply.status(201).send(await runService(app, req, "pedidos_compra.edit", async (ctx) => {
    // COMPRAS-03_R1 (c): o :id em minúsculas ANTES do hash — a mesma URL com outra caixa é o mesmo pedido (os uuid
    // do corpo já saem do parse em minúsculas; o recebimento os compara com o leque e os itens lidos do banco).
    const id = (req.params as { id: string }).id.toLowerCase();
    const corpo = recebimentoSchema.parse(req.body ?? {});
    await lerDocumentoCompra(ctx, id, "pedido");
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "receber_pedido_compra", pedidoId: id, userId: ctx.user.id, corpo },
      () => receberPedido(app, ctx, id, corpo))).result;
  })));

  /** ENCERRAR O SALDO — muta o pedido (`pedidos_compra.edit`). Idempotente, com o autor e o motivo no hash. */
  app.post("/compras/pedidos/:id/encerrar-saldo", async (req) => runService(app, req, "pedidos_compra.edit", async (ctx) => {
    const { id } = req.params as { id: string };
    const { motivo } = encerrarSaldoSchema.parse(req.body ?? {});
    await lerDocumentoCompra(ctx, id, "pedido");
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: "encerrar_saldo_pedido_compra", pedidoId: id, userId: ctx.user.id, motivo },
      () => encerrarSaldo(ctx, id, motivo))).result;
  }));
}
