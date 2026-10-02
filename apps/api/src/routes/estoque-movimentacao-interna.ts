/**
 * ═══ PORTAL DE ESTOQUE — A MOVIMENTAÇÃO INTERNA NO DOCUMENTO DE ESTOQUE (OPERACOES-01 F5a, decisão 282) ═══
 *
 * O documento de estoque ganhou (0043) três espécies — a REQUISIÇÃO (pedido de material, que reserva no local de
 * estoque), o CONSUMO (que baixa, atendendo uma requisição ou direto) e a DEVOLUÇÃO DE CONSUMO (que volta ao local
 * de estoque e puxa do consumo) —, o DESTINO no cabeçalho (para onde vai o que sai) e o MOTIVO e a justificativa da
 * saída. Este arquivo é o que o LANÇAMENTO confere a mais por causa disso, e a rota de ENCERRAR O SALDO da
 * requisição. A lista, o lançamento e a consulta continuam em `estoque-documentos.ts`; a prévia, a confirmação e o
 * cancelamento, em `estoque-confirmacao.ts`; a leitura e a conta do atendimento, em `estoque-comum.ts`.
 *
 *   · FORMA (sem consulta): a origem só no consumo e na devolução (obrigatória nela, no cabeçalho e em cada item); o
 *     destino só nas espécies que o levam (na devolução ele é COPIADO do consumo: não se informa); o motivo e a
 *     justificativa só na saída, em par (o par é OPCIONAL: o web anterior lança a saída sem ele);
 *   · ORIGEM: a requisição do consumo (confirmada, sem saldo encerrado) e o consumo da devolução (confirmado), da
 *     MESMA empresa e do MESMO local de estoque, lidos `for share` com o recorte do GET — uma recusa só para tudo,
 *     como o gatilho; os itens ligados são da origem, do mesmo produto, e a soma não passa do saldo do item;
 *   · DESTINO: o consumo HERDA cada dimensão que a requisição tem; as referências informadas existem, estão ativas e
 *     são da organização (centro de resultado, safra) ou da empresa do documento (as outras quatro) — uma consulta, a
 *     MESMA 422 para inexistente, de outra empresa e de outra organização —; depois, a seção Destino da TOP;
 *   · FLUXO: a seção Fluxo da TOP no consumo (exigir requisição, atender em parte).
 * As regras que TRAVAM (destino obrigatório, exigir requisição) nascem DESLIGADAS: no neutro da TOP nada muda. O banco
 * (0043) repete as invariantes em gatilho; a API confere antes, com a mensagem no campo.
 *
 * As rotas deste arquivo são registradas por `registrarMovimentacaoInterna(app)`, chamada do registro de
 * `estoque-documentos.ts` (prefixo `/api` vem do registro).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { D, type Decimal } from "@agro/shared";
import {
  CAMPOS_DESTINO_ESTOQUE, ESPECIES_COM_DESTINO_ESTOQUE, especieDeOrigemEstoque, recusasDoDestinoPelaTop, recusasDoFluxoDoConsumo,
  type ColunaDestinoEstoque, type DimensaoDestinoEstoque, type EspecieEstoque, type MotivoSaidaEstoque,
  type SecaoDestinoTop, type SecaoFluxoTop,
} from "@agro/domain";
import { runService, idempotent, audit } from "../lib/service.js";
import { err, notFound } from "../lib/errors.js";
import { scopedById, type ServiceCtx } from "../lib/context.js";
import { quantidadeLegivel } from "../services/stock-core.js";
import { lerDocumentoEstoque, sqlAtendidoDoItem, sqlDevolvidoDoItem } from "./estoque-comum.js";

export interface Recusa { path: string; message: string }
/** Uma recusa com TODOS os campos que falharam: a tela marca cada um, e a mensagem é a do primeiro. */
const recusar = (details: Recusa[]) => err("VALIDATION_ERROR", details[0]!.message, details);
const caminhoDoItem = (i: number, campo: string) => `itens.${i}.${campo}`;

/** O destino como o corpo o traz (e como o cabeçalho o grava): uma coluna por dimensão, `null` = não informada. */
export type DestinoEstoque = Record<ColunaDestinoEstoque, string | null>;

/** O destino vazio: o das espécies que não levam destino, e o ponto de partida dos outros. */
export const destinoVazio = (): DestinoEstoque =>
  Object.fromEntries(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.coluna, null])) as DestinoEstoque;

/** O que este arquivo lê do corpo do lançamento (o zod de `estoque-documentos.ts` o produz — números já canônicos). */
export interface LancamentoComMovimentacaoInterna extends Readonly<DestinoEstoque> {
  readonly empresa_id: string;
  readonly armazem_id: string;
  readonly origem_documento_id: string | null;
  readonly motivo_saida: MotivoSaidaEstoque | null;
  readonly justificativa: string | null;
  readonly itens: readonly { readonly produto_id: string; readonly origem_item_id: string | null }[];
}

const ESPECIE_DA_ORIGEM_NA_FRASE: Readonly<Partial<Record<EspecieEstoque, { daOrigem: string; item: string; produto: string; passa: string; invalida: string }>>> = Object.freeze({
  consumo: {
    daOrigem: "Informe a requisição de origem",
    item: "O item não é da requisição de origem",
    produto: "O produto difere do item da requisição",
    passa: "Passa do saldo pendente do item da requisição",
    invalida: "Requisição de origem inválida: escolha uma requisição pendente da mesma empresa e do mesmo local de estoque",
  },
  devolucao_consumo: {
    daOrigem: "Informe o consumo de origem",
    item: "O item não é do consumo de origem",
    produto: "O produto difere do item do consumo",
    passa: "Passa do que o consumo baixou e ainda não voltou",
    invalida: "Consumo de origem inválido: escolha um consumo confirmado da mesma empresa e do mesmo local de estoque",
  },
});

// ─────────────── forma (sem consulta) ───────────────

/**
 * O QUE A MOVIMENTAÇÃO INTERNA ACRESCENTOU À FORMA DO CORPO, por espécie — sem consultar nada. Devolve as recusas
 * (quem chama junta com as da forma de hoje, num 422 só). Campo de outra espécie é RECUSADO, nunca ignorado: aceitar
 * e descartar um destino numa entrada faria a tela acreditar que ele foi gravado.
 */
export function recusasDaFormaDaMovimentacaoInterna(especie: EspecieEstoque, d: LancamentoComMovimentacaoInterna): Recusa[] {
  const recusas: Recusa[] = [];
  // ORIGEM: só o consumo (opcional) e a devolução de consumo (obrigatória no cabeçalho e em cada item) puxam de outro documento.
  const frases = ESPECIE_DA_ORIGEM_NA_FRASE[especie];
  if (especieDeOrigemEstoque(especie) === null || !frases) {
    const message = "A origem é só do consumo e da devolução de consumo";
    if (d.origem_documento_id) recusas.push({ path: "origem_documento_id", message });
    d.itens.forEach((it, i) => { if (it.origem_item_id) recusas.push({ path: caminhoDoItem(i, "origem_item_id"), message }); });
  } else if (especie === "devolucao_consumo") {
    if (!d.origem_documento_id) recusas.push({ path: "origem_documento_id", message: frases.daOrigem });
    d.itens.forEach((it, i) => { if (!it.origem_item_id) recusas.push({ path: caminhoDoItem(i, "origem_item_id"), message: "Informe o item do consumo que volta" }); });
  } else if (!d.origem_documento_id && d.itens.some((it) => it.origem_item_id)) {
    recusas.push({ path: "origem_documento_id", message: frases.daOrigem });
  }
  // DESTINO: só nas espécies que o levam; na devolução de consumo ele é o do consumo de origem (copiado).
  if (!ESPECIES_COM_DESTINO_ESTOQUE.includes(especie) || especie === "devolucao_consumo") {
    const message = especie === "devolucao_consumo"
      ? "O destino da devolução de consumo é o do consumo de origem: não informe"
      : "O destino é só da requisição, do consumo e da saída";
    for (const c of CAMPOS_DESTINO_ESTOQUE) if (d[c.coluna]) recusas.push({ path: c.coluna, message });
  }
  // MOTIVO E JUSTIFICATIVA: só na saída, em par. O par é OPCIONAL — TRANSITÓRIO, e não a regra do pedido ("justificativa
  // obrigatória"): o web anterior (o de produção, e o da reversão só do web na DEPLOYMENT) lança a saída sem ele, e
  // exigir o par aqui quebraria a saída dele (skew sentido 2, K2-a). O servidor é a autoridade, então a obrigação NÃO
  // pode morar só na tela nova: o par passa a ser obrigatório AQUI (e no banco, para a saída nova — a do web anterior já
  // gravada fica como está) na primeira PR depois que o web anterior à OPERACOES-01 sair de produção e da janela de
  // reversão — pendência registrada na decisão 282 (F5a). O SEA-4 (`f5a-saida-entrada-ajuste.test.ts`) é o caso que
  // muda nesse dia.
  if (especie !== "saida") {
    if (d.motivo_saida) recusas.push({ path: "motivo_saida", message: "O motivo é só da saída" });
    if (d.justificativa) recusas.push({ path: "justificativa", message: "A justificativa é só da saída" });
  } else if (d.motivo_saida && !d.justificativa) {
    recusas.push({ path: "justificativa", message: "Informe a justificativa da saída" });
  } else if (d.justificativa && !d.motivo_saida) {
    recusas.push({ path: "motivo_saida", message: "Informe o motivo da saída" });
  }
  return recusas;
}

// ─────────────── origem ───────────────

/** Um item do documento de origem e o SALDO dele (requisição: o pendente; consumo: o que ainda pode voltar). */
export interface ItemDaOrigem { id: string; produto_id: string; saldo: string }

/** A origem conferida: o documento, o destino dele (que o consumo herda e a devolução copia) e os itens com o saldo. */
export interface OrigemConferida { id: string; destino: DestinoEstoque; itens: ItemDaOrigem[] }

/**
 * A ORIGEM DO CONSUMO E DA DEVOLUÇÃO. Três consultas, qualquer que seja o número de itens:
 *   1) o cabeçalho da origem, com o MESMO recorte do GET (organização e escopo de empresa do módulo da rota) e com o
 *      filtro inteiro da recusa no WHERE (a espécie esperada, a empresa e o local de estoque deste documento) —
 *      `for share`: o cancelamento e o encerramento concorrentes da origem esperam este lançamento. Não é a espécie
 *      esperada, é de outra empresa ou de outro local de estoque, não está na situação que atende (a requisição
 *      confirmada sem saldo encerrado; o consumo confirmado) → a MESMA recusa, no campo: uma mensagem por motivo
 *      diria que aquele id existe noutra empresa;
 *   2) a TRAVA dos itens da origem (`for update`, em ordem de id) — a mesma que o gatilho dos itens (0043) pega item a
 *      item, e na mesma ordem das travas dele (cabeçalho da origem, depois o item). Dois lançamentos que puxam da
 *      mesma origem fazem FILA aqui, em ordem fixa: sem ela, duas linhas em ordem trocada travariam uma à outra;
 *   3) DEPOIS da trava (instrução nova, foto nova do READ COMMITTED), os itens da origem com o que já foi ligado a
 *      cada um (consumos ou devoluções NÃO cancelados — a mesma conta do gatilho e da reserva): o que o lançamento
 *      anterior gravou enquanto este esperava ENTRA na conta.
 * Cada item do corpo com origem: o item é da origem, do mesmo produto, e a soma das linhas do corpo para ele não passa
 * do saldo. O gatilho dos itens repete a soma no banco: é a rede.
 */
export async function conferirOrigem(ctx: ServiceCtx, especie: EspecieEstoque, d: LancamentoComMovimentacaoInterna, quantidades: readonly (string | null)[]): Promise<OrigemConferida | null> {
  const especieDaOrigem = especieDeOrigemEstoque(especie);
  const frases = ESPECIE_DA_ORIGEM_NA_FRASE[especie];
  if (!d.origem_documento_id || especieDaOrigem === null || !frases) return null;
  const sc = scopedById(ctx, "o", d.origem_documento_id);
  sc.params.push(especieDaOrigem, d.empresa_id, d.armazem_id);
  const n = sc.params.length;
  const o = await ctx.tx.query<DestinoEstoque & { id: string; situacao: string; saldo_encerrado_em: Date | null }>(
    `select o.id, o.situacao, o.saldo_encerrado_em, ${CAMPOS_DESTINO_ESTOQUE.map((c) => `o.${c.coluna}`).join(", ")}
       from erp.documentos_estoque o
      where o.id = $1 and o.organization_id = $2 and o.especie = $${n - 2} and o.empresa_id = $${n - 1} and o.armazem_id = $${n}${sc.sql}
        for share of o`, sc.params);
  const origem = o.rows[0];
  const atende = origem && origem.situacao === "confirmado" && (especie !== "consumo" || origem.saldo_encerrado_em === null);
  if (!origem || !atende) throw recusar([{ path: "origem_documento_id", message: frases.invalida }]);

  await ctx.tx.query(
    "select i.id from erp.documentos_estoque_itens i where i.documento_id = $1 and i.organization_id = $2 order by i.id for update of i",
    [origem.id, ctx.orgId]);
  const ligado = especie === "consumo" ? sqlAtendidoDoItem("i") : sqlDevolvidoDoItem("i");
  const it = await ctx.tx.query<{ id: string; produto_id: string; quantidade: string; ligado: string }>(
    `select i.id, i.produto_id, i.quantidade::text as quantidade, (${ligado})::numeric(18,4)::text as ligado
       from erp.documentos_estoque_itens i
      where i.documento_id = $1 and i.organization_id = $2
      order by i.posicao, i.id`, [origem.id, ctx.orgId]);
  const saldoDe = (q: string, l: string) => { const s = D(q).minus(l); return (s.lt(0) ? D(0) : s).toFixed(4); };
  const itens: ItemDaOrigem[] = it.rows.map((x) => ({ id: x.id, produto_id: x.produto_id, saldo: saldoDe(x.quantidade, x.ligado) }));
  const porId = new Map(itens.map((x) => [x.id, x]));

  const recusas: Recusa[] = [];
  const pedido = new Map<string, Decimal>();
  d.itens.forEach((linha, i) => {
    if (!linha.origem_item_id) return;
    const doItem = porId.get(linha.origem_item_id);
    if (!doItem) return void recusas.push({ path: caminhoDoItem(i, "origem_item_id"), message: frases.item });
    if (doItem.produto_id !== linha.produto_id) return void recusas.push({ path: caminhoDoItem(i, "produto_id"), message: frases.produto });
    const q = quantidades[i];
    if (q === null || q === undefined) return;
    const soma = (pedido.get(doItem.id) ?? D(0)).plus(q);
    pedido.set(doItem.id, soma);
    if (soma.gt(doItem.saldo)) recusas.push({ path: caminhoDoItem(i, "quantidade"), message: `${frases.passa}: há ${quantidadeLegivel(doItem.saldo)}` });
  });
  if (recusas.length) throw recusar(recusas);
  const destino = destinoVazio();
  for (const c of CAMPOS_DESTINO_ESTOQUE) destino[c.coluna] = origem[c.coluna] ?? null;
  return { id: origem.id, destino, itens };
}

// ─────────────── destino ───────────────

/** A recusa da referência do destino — a MESMA para inexistente, inativo, de outra empresa e de outra organização. */
const REFERENCIA_INVALIDA: Readonly<Record<DimensaoDestinoEstoque, string>> = Object.freeze({
  centroCusto: "Centro de resultado inválido: escolha um centro de resultado analítico e ativo da organização",
  equipamento: "Máquina/equipamento inválido: escolha uma máquina/equipamento ativo da empresa do documento",
  ordemServico: "Ordem de serviço inválida: escolha uma ordem de serviço aberta ou em andamento da empresa do documento",
  loteAnimais: "Lote de animais inválido: escolha um lote de animais ativo da empresa do documento",
  area: "Área/talhão inválida: escolha uma área/talhão ativa da empresa do documento",
  safra: "Safra inválida: escolha uma safra ativa da organização",
});

/**
 * As referências INFORMADAS do destino, numa consulta só (uma parte por alvo, `union all`), qualquer que seja o
 * número de dimensões. Cada parte devolve a chave da dimensão quando a referência existe, não está excluída, está
 * ATIVA e é da organização (centro de resultado ANALÍTICO, safra) ou da EMPRESA DO DOCUMENTO (máquina/equipamento,
 * ordem de serviço aberta ou em andamento, lote de animais, área/talhão). A leitura passa pela RLS do módulo da
 * transação (estoque): o que a pessoa não enxerga no estoque também não existe aqui.
 */
async function referenciasValidas(ctx: ServiceCtx, empresaId: string, informados: DestinoEstoque): Promise<Set<DimensaoDestinoEstoque>> {
  const r = await ctx.tx.query<{ chave: DimensaoDestinoEstoque }>(
    `select 'centroCusto'::text as chave from erp.cost_centers
      where id = $3::uuid and organization_id = $1 and is_active and kind = 'analytic' and deleted_at is null
     union all select 'equipamento' from erp.equipments
      where id = $4::uuid and organization_id = $1 and empresa_id = $2 and status = 'active' and deleted_at is null
     union all select 'ordemServico' from erp.service_orders
      where id = $5::uuid and organization_id = $1 and empresa_id = $2 and status in ('open', 'in_progress') and deleted_at is null
     union all select 'loteAnimais' from erp.batches
      where id = $6::uuid and organization_id = $1 and empresa_id = $2 and status = 'active' and deleted_at is null
     union all select 'area' from erp.areas
      where id = $7::uuid and organization_id = $1 and empresa_id = $2 and is_active and deleted_at is null
     union all select 'safra' from erp.harvests
      where id = $8::uuid and organization_id = $1 and is_active and deleted_at is null`,
    [ctx.orgId, empresaId, informados.centro_custo_id, informados.equipamento_id, informados.ordem_servico_id,
      informados.lote_animais_id, informados.area_id, informados.safra_id]);
  return new Set(r.rows.map((x) => x.chave));
}

/**
 * O DESTINO FINAL DO DOCUMENTO — o que o cabeçalho grava (e o razão leva na confirmação):
 *   · devolução de consumo: o do consumo de origem, copiado (a forma já recusou o informado);
 *   · espécie sem destino: vazio (a forma já recusou o informado);
 *   · requisição, saída e consumo: o informado; o consumo que atende uma requisição HERDA cada dimensão que ela tem
 *     (informada diferente → recusa no campo). As referências INFORMADAS são conferidas (`referenciasValidas`); a
 *     herdada não — foi escolhida sob a TOP da requisição, e o gatilho ainda confere que ela existe. Depois, a seção
 *     Destino da TOP (`recusasDoDestinoPelaTop`): dimensão informada que a TOP não usa, obrigatória sem valor final.
 *   · REENVIAR O HERDADO é o mesmo que omiti-lo: a dimensão informada IGUAL à da requisição não conta como informada
 *     — nem para a conferência da referência (a OS encerrada depois da requisição continua valendo no consumo dela, com
 *     ou sem o reenvio), nem para a seção Destino da TOP do consumo (o herdado que ela "não usa" não é recusado, com ou
 *     sem o reenvio). O que se grava é o mesmo nos dois casos, então nada é descartado: a tela pode mandar de volta o
 *     destino que leu da requisição sem ganhar uma recusa que o corpo sem ele não teria.
 * No máximo UMA consulta (só quando há dimensão informada que não é a herdada).
 */
export async function conferirDestino(ctx: ServiceCtx, especie: EspecieEstoque, d: LancamentoComMovimentacaoInterna, origem: OrigemConferida | null, secao: SecaoDestinoTop): Promise<DestinoEstoque> {
  if (especie === "devolucao_consumo") return origem ? { ...origem.destino } : destinoVazio();
  const finais = destinoVazio();
  if (!ESPECIES_COM_DESTINO_ESTOQUE.includes(especie)) return finais;
  const informados = destinoVazio();
  const informadas = new Set<DimensaoDestinoEstoque>();
  const recusas: Recusa[] = [];
  for (const c of CAMPOS_DESTINO_ESTOQUE) {
    const valor = d[c.coluna];
    const herdado = especie === "consumo" ? origem?.destino[c.coluna] ?? null : null;
    if (herdado && valor && valor !== herdado) recusas.push({ path: c.coluna, message: "O destino do consumo é o da requisição de origem" });
    // O herdado reenviado é o herdado (ver acima): só o valor que NÃO é o da requisição conta como informado.
    if (valor && valor !== herdado) { informados[c.coluna] = valor; informadas.add(c.chave); }
    finais[c.coluna] = herdado ?? valor ?? null;
  }
  if (recusas.length) throw recusar(recusas);
  if (informadas.size) {
    const validas = await referenciasValidas(ctx, d.empresa_id, informados);
    const invalidas = CAMPOS_DESTINO_ESTOQUE.filter((c) => informadas.has(c.chave) && !validas.has(c.chave))
      .map((c) => ({ path: c.coluna, message: REFERENCIA_INVALIDA[c.chave] }));
    if (invalidas.length) throw recusar(invalidas);
  }
  const valores = Object.fromEntries(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.chave, finais[c.coluna]])) as Record<DimensaoDestinoEstoque, string | null>;
  const pelaTop = recusasDoDestinoPelaTop(secao, valores, informadas);
  if (pelaTop.length) throw recusar(pelaTop.map((x) => ({ path: x.coluna, message: x.mensagem })));
  return finais;
}

// ─────────────── fluxo ───────────────

/**
 * A SEÇÃO FLUXO DA TOP NO CONSUMO: exigir requisição (não, em algum item, em todos) e atender a requisição em parte.
 * `atendeTudo`: todo item da requisição com saldo é ligado, e a soma das linhas do corpo para ele é o saldo inteiro.
 * Nas outras espécies, nada. Sem consulta (o saldo dos itens veio da origem).
 */
export function conferirFluxo(especie: EspecieEstoque, d: LancamentoComMovimentacaoInterna, origem: OrigemConferida | null, secao: SecaoFluxoTop, quantidades: readonly (string | null)[]): void {
  if (especie !== "consumo") return;
  const levado = new Map<string, Decimal>();
  d.itens.forEach((it, i) => {
    if (it.origem_item_id) levado.set(it.origem_item_id, (levado.get(it.origem_item_id) ?? D(0)).plus(quantidades[i] ?? "0"));
  });
  const atendeTudo = origem !== null
    && origem.itens.filter((x) => D(x.saldo).gt(0)).every((x) => (levado.get(x.id) ?? D(0)).eq(x.saldo));
  const recusas = recusasDoFluxoDoConsumo(secao, { temOrigem: origem !== null, ligados: d.itens.map((it) => it.origem_item_id !== null), atendeTudo });
  if (recusas.length) throw recusar(recusas.map((x) => ({ path: x.caminho, message: x.mensagem })));
}

// ─────────────── encerrar o saldo da requisição ───────────────

/** O corpo do encerramento: o motivo, aparado, de 1 a 500. `.strict()`: chave desconhecida é 422. */
const encerrarSchema = z.object({ motivo: z.string().trim().min(1, "Informe o motivo do encerramento do saldo").max(500) }).strict();

/**
 * ENCERRAR O SALDO DA REQUISIÇÃO — o que ficou pendente deixa de ser esperado (e de reservar). A requisição continua
 * CONFIRMADA (o atendimento passa a "encerrado"); o que já foi consumido fica como está, e o consumo ABERTO que a
 * atende continua reservando a parte dele até ser confirmado ou cancelado.
 *
 * Com o cabeçalho travado (a mesma trava da confirmação e do cancelamento), nesta ordem, cada uma 409:
 *   · não está confirmada → não está pendente;
 *   · o saldo já foi encerrado;
 *   · nada atendido (nenhum item ligado em consumo não cancelado) → nunca foi atendida: o caminho é CANCELAR, não
 *     encerrar. Julgado pelos ITENS (`quantidade_atendida`), lidos DEPOIS da trava numa instrução nova (foto nova do
 *     READ COMMITTED): o consumo que terminou enquanto esta esperava entra na conta — os `vinculados` vêm na foto da
 *     consulta que travou, e um consumo ligado só pelo cabeçalho, sem item ligado, não atendeu nada;
 *   · nada pendente → não há saldo a encerrar.
 * O UPDATE confere a situação e o saldo de novo no WHERE e o ROW COUNT (zero linha = a mesma 404 da leitura). O gatilho
 * do cabeçalho (0043) aceita esta mudança uma vez, sozinha, só na requisição confirmada.
 */
async function encerrarSaldo(ctx: ServiceCtx, id: string, motivo: string) {
  const doc = await lerDocumentoEstoque(ctx, id, "requisicao", { lock: true });
  if (doc.situacao !== "confirmado") throw err("CONFLICT", "Esta requisição não está pendente.");
  if (doc.saldo_encerrado_em !== null) throw err("CONFLICT", "O saldo desta requisição já foi encerrado.");
  if (!doc.itens.some((it) => D(it.quantidade_atendida ?? "0").gt(0))) {
    throw err("CONFLICT", "Esta requisição ainda não foi atendida: cancele-a em vez de encerrar o saldo.");
  }
  if (doc.itens.every((it) => D(it.saldo_pendente ?? "0").lte(0))) throw err("CONFLICT", "Esta requisição não tem saldo a encerrar.");
  const u = await ctx.tx.query(
    `update erp.documentos_estoque set saldo_encerrado_em = now(), saldo_encerrado_por = $3, saldo_encerrado_motivo = $4
      where id = $1 and organization_id = $2 and especie = 'requisicao' and situacao = 'confirmado' and saldo_encerrado_em is null`,
    [doc.id, ctx.orgId, ctx.user.id, motivo]);
  // ROW COUNT sob RLS: zero linhas seria "sucesso sem efeito".
  if (u.rowCount !== 1) throw notFound("Documento");
  await audit(ctx.tx, ctx, "documentos_estoque", doc.id, "encerrar_saldo", { motivo });
  return { id: doc.id, situacao: "confirmado" as const, atendimento: "encerrado" as const };
}

const chaveDeIdempotencia = (h: unknown) => (typeof h === "string" ? h : undefined);

/** Registra as rotas da movimentação interna. Chamada no registro de `estoque-documentos.ts`. */
export function registrarMovimentacaoInterna(app: FastifyInstance): void {
  app.post("/estoque/requisicoes/:id/encerrar-saldo", async (req) => runService(app, req, "requisicoes_estoque.edit", async (ctx) => {
    const { id } = req.params as { id: string };
    const corpo = encerrarSchema.parse(req.body ?? {});
    // Visibilidade ANTES de reservar a chave: fora de escopo/inexistente/outra espécie/malformado é a MESMA 404 do GET.
    await lerDocumentoEstoque(ctx, id, "requisicao");
    return (await idempotent(ctx.tx, ctx.orgId, chaveDeIdempotencia(req.headers["idempotency-key"]),
      { action: "encerrar_saldo_requisicao_estoque", especie: "requisicao", sourceId: id.toLowerCase(), actorId: ctx.user.id, motivo: corpo.motivo },
      () => encerrarSaldo(ctx, id, corpo.motivo))).result;
  }));
}
