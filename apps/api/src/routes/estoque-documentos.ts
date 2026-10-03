/**
 * ═══ PORTAL DE ESTOQUE — O DOCUMENTO DE ESTOQUE (ESTOQUE-01, decisão 274) ═══
 *
 * `erp.documentos_estoque` é UMA tabela com QUATRO espécies (`especie`): ENTRADA, SAÍDA, TRANSFERÊNCIA e AJUSTE
 * (inventário). Cada espécie tem a sua família de TOP (`estoque.<especie>`) e o seu recurso de permissão
 * (`entradas_estoque.*`, `saidas_estoque.*`, `transferencias_estoque.*`, `ajustes_estoque.*`) — o desenho do
 * documento de compra: a porta é da espécie e o registro também (espécie errada = a mesma 404 de inexistente).
 *
 * Este arquivo LISTA (a lista única do portal), diz as OPERAÇÕES que cada espécie lança, LANÇA o documento ABERTO
 * e o CONSULTA. Lançar NÃO mexe no saldo: o estoque só se move na CONFIRMAÇÃO. A prévia, a confirmação e o
 * cancelamento moram em `estoque-confirmacao.ts`; o que os dois arquivos leem igual mora em `estoque-comum.ts`.
 *
 * A TOP dá ao documento o nome da operação, a TOP padrão por espécie, a versão congelada e as exigências gerais
 * (só "observação obrigatória" se aplica ao estoque). O MOVIMENTO é o da ESPÉCIE: a execução configurada da TOP
 * continua recusada para estas famílias nesta fatia.
 *
 * O que NÃO existe aqui (fora da fatia): editar documento aberto e transferência entre empresas (os dois locais de
 * estoque são da empresa do documento — entre empresas fica nas telas antigas).
 *
 * MOVIMENTAÇÃO INTERNA (OPERACOES-01 F5a, decisão 282): as rotas servem as SETE espécies — as quatro de antes e a
 * REQUISIÇÃO (pedido de material: confirmada, reserva no local de estoque), o CONSUMO (baixa; atende uma requisição ou
 * é lançado direto) e a DEVOLUÇÃO DE CONSUMO (volta ao local de estoque, puxando do consumo). O corpo ganhou campos
 * OPCIONAIS — a origem, o destino (seis dimensões), o motivo e a justificativa da saída, a origem do item —, a entrada
 * pode vir sem custo (a confirmação grava o custo médio do produto) e o ajuste aceita o custo informado. O corpo de
 * antes continua aceito do mesmo jeito, e a resposta continua com as mesmas chaves. O que a movimentação interna
 * confere a mais mora em `estoque-movimentacao-interna.ts`; a capacidade nova é `capacidades.movimentacaoInterna`.
 *
 * CONFIRMAÇÃO AUTOMÁTICA (TOP-CONFIG-08, decisão 277): com a versão congelada no FORMATO 4 e "Confirmação:
 * Automática", o POST confirma o documento que acabou de lançar, na mesma transação, pela MESMA função do
 * `/confirmar` (`lancarEConfirmar`). Versão 1–3, ou Manual: o POST responde o que respondia, chave por chave.
 * Documento sem itens continua recusado em toda versão: no estoque ele não movimenta nada (o zod fica com `min(1)`).
 *
 * A CENTRAL DE ESTOQUE NO MOTOR (OPERACOES-01 F5b, decisão 282): três rotas de LEITURA, para a tela, com o contrato das
 * Centrais de Vendas e de Compras — as REGRAS DA OPERAÇÃO da TOP escolhida (`/regras-da-operacao`: as exigências, a
 * confirmação automática e as seções Destino e Fluxo, pela MESMA leitura do lançamento), o LAYOUT POR TOP
 * (`/layout-efetivo`, o mesmo de vendas e compras: o layout do estoque governa colunas, rótulos, valor padrão e
 * "editável" — o servidor do estoque não cobra layout) e as OPÇÕES DO DESTINO (`/destino/opcoes`, em
 * `estoque-movimentacao-interna.ts`, só nas espécies cujo destino a TOP configura). Declaradas nas capacidades de
 * `operation-types`: `layoutDocumento` e `regrasDaOperacao` (as opções do destino são parte de `movimentacaoInterna`).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DomainError, isISODate } from "@agro/shared";
import {
  conferirNumeroEstoque, familiaOperacionalDeDocumentoEstoque, chaveI18nDaFamiliaOperacional, moduloDaPermissao,
  lerConfiguracaoTop, restricoesExecutamTop, exigenciasGeraisFaltando, secoesExtensaoDaVersaoTop, secoesExtensaoNeutrasTop,
  EXIGENCIAS_GERAIS_ESTOQUE_TOP, ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, LIMITE_QUANTIDADE_ESTOQUE, LIMITE_CUSTO_ESTOQUE,
  ROTULO_DA_ESPECIE_ESTOQUE, MOTIVOS_SAIDA_ESTOQUE, LIMITE_JUSTIFICATIVA_SAIDA, ATENDIMENTOS_REQUISICAO_ESTOQUE, CAPACIDADE_MOVIMENTACAO_INTERNA,
  CAPACIDADE_LAYOUT_DOCUMENTO, CAPACIDADE_REGRAS_DA_OPERACAO, regrasDaOperacaoDoEstoque,
  type EspecieEstoque, type ConfiguracaoComRestricoesTop, type SecoesExtensaoV5,
} from "@agro/domain";
import { criarTradutor, ptBR } from "@erp/plataforma";
import { runService, nextCode, idempotent, audit } from "../lib/service.js";
import { err, denied, notFound } from "../lib/errors.js";
import { exigirEmpresaDeLancamento, empresaScope, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { atribuirIdGlobal, paginaComIdGlobal } from "../lib/id-global.js";
import { resolverTopParaLancamento, type TopDoLancamento } from "../lib/documento-comercial.js";
import { confirmaAutomaticamente, tentarConfirmacaoAutomatica } from "../lib/confirmacao-automatica.js";
import { respostaDoLayoutEfetivo } from "../lib/layout-documento.js";
import {
  ESPECIES_ESTOQUE, FORMA_UUID, SQL_ATENDIMENTO_REQUISICAO, lerDocumentoEstoque, topParaTela, type ColunasDaTop, type RecursoEstoque,
} from "./estoque-comum.js";
import { registrarConfirmacaoEstoque, confirmarDocumentoEstoqueNaTransacao } from "./estoque-confirmacao.js";
import {
  registrarMovimentacaoInterna, registrarOpcoesDoDestino, recusasDaFormaDaMovimentacaoInterna, conferirOrigem, conferirDestino, conferirFluxo,
} from "./estoque-movimentacao-interna.js";

const t = criarTradutor(ptBR);

/** A família da espécie — perguntada ao registry. Fail-closed se o registry deixar de declará-la. */
function familiaDaEspecie(especie: EspecieEstoque): string {
  const familia = familiaOperacionalDeDocumentoEstoque(especie);
  if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { especie });
  return familia;
}

// ─────────────── contrato de entrada (estrito) ───────────────

/**
 * Todo uuid do corpo sai do parse em MINÚSCULAS (a lição da COMPRAS-03_R1): o banco devolve uuid em minúsculas e o
 * servidor compara como texto (armazém da empresa, produto repetido no ajuste). Aplicado no parse, ANTES do hash
 * da idempotência: o reenvio com outra caixa é o mesmo pedido.
 */
const uuid = z.string().uuid().transform((v) => v.toLowerCase());
/** Um uuid opcional do corpo: ausente ou `null` é "não informado" (`null`). */
const uuidOpcional = uuid.nullish().transform((v) => v ?? null);
const textoOpcional = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const data = z.string().refine(isISODate, "Data inválida");
/**
 * Um número do corpo chega CRU até `conferirNumeroEstoque` (domínio): é lá que se decide forma, casas e limite, e
 * que um número JSON é recusado com "Informe o número como texto" — se o zod recusasse o `number` antes, a mensagem
 * seria a genérica. Qualquer outro tipo (booleano, objeto, lista) é recusado aqui mesmo.
 */
const numeroCru = z.union([z.string(), z.number(), z.null()]).optional();

const itemSchema = z.object({
  produto_id: uuid,
  quantidade: numeroCru,
  quantidade_contada: numeroCru,
  custo_unitario: numeroCru,
  lote: textoOpcional(60),
  validade: data.nullish().transform((v) => v ?? null),
  observacao: textoOpcional(500),
  /** OPERACOES-01 F5a: o item da requisição que esta linha do consumo atende, ou o do consumo que esta devolução devolve. */
  origem_item_id: uuidOpcional,
}).strict();

/**
 * O corpo do POST. `.strict()` nos dois níveis: chave desconhecida é 422 — nunca traduzida, nunca descartada.
 * Os campos da movimentação interna (OPERACOES-01 F5a) são TODOS opcionais: o corpo de antes continua valendo.
 */
const documentoSchema = z.object({
  empresa_id: uuid,
  tipo_operacao_id: uuid,
  armazem_id: uuid,
  armazem_destino_id: uuidOpcional,
  data_documento: data,
  observacao: textoOpcional(2000),
  /** A requisição que o consumo atende, ou o consumo de que a devolução de consumo puxa (obrigatório nela). */
  origem_documento_id: uuidOpcional,
  // O DESTINO (requisição, consumo e saída — pela seção Destino da TOP; a devolução de consumo copia o do consumo).
  centro_custo_id: uuidOpcional,
  equipamento_id: uuidOpcional,
  ordem_servico_id: uuidOpcional,
  lote_animais_id: uuidOpcional,
  area_id: uuidOpcional,
  safra_id: uuidOpcional,
  /** O motivo da saída (os 13 da baixa antiga), em par com a justificativa. Só na saída; o par é opcional. */
  motivo_saida: z.enum(MOTIVOS_SAIDA_ESTOQUE).nullish().transform((v) => v ?? null),
  justificativa: textoOpcional(LIMITE_JUSTIFICATIVA_SAIDA),
  itens: z.array(itemSchema).min(1).max(500),
}).strict();
type DocumentoEstoqueEntrada = z.infer<typeof documentoSchema>;
type ItemEntrada = DocumentoEstoqueEntrada["itens"][number];

interface Recusa { path: string; message: string }
/** Uma recusa com TODOS os campos que falharam: a Central marca cada um, e a mensagem é a do primeiro. */
const recusar = (details: Recusa[]) => err("VALIDATION_ERROR", details[0]!.message, details);
const caminhoDoItem = (i: number, campo: string) => `itens.${i}.${campo}`;

// ─────────────── listagem ───────────────

type LinhaDaLista = Record<string, unknown> & ColunasDaTop & { especie: EspecieEstoque };

/**
 * A LISTA ÚNICA do portal. A espécie entra no WHERE ANTES do LIMIT (recorte de autorização, nunca filtro sobre o
 * resultado), e o escopo de empresa do módulo estoque é aplicado no SQL, com o módulo EXPLÍCITO (a porta é
 * dinâmica, e o módulo não vem dela). Número FIXO de consultas — contagem, página e o ID Global —, qualquer que
 * seja o tamanho da página: a quantidade de itens sai de subconsulta, nunca de uma consulta por linha.
 */
async function listarDocumentos(ctx: ServiceCtx, especies: readonly EspecieEstoque[], query: unknown) {
  const bruta = (query ?? {}) as Record<string, unknown>;
  // Parâmetro repetido chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  for (const [chave, valor] of Object.entries(bruta)) {
    if (Array.isArray(valor)) throw recusar([{ path: chave, message: "Parâmetro repetido: informe um valor só" }]);
  }
  // `limit` é apelido de `pageSize` (a sonda da tela pede `limit=1`); os dois juntos → vale `pageSize`.
  const q = pageQuerySchema.parse(bruta.pageSize === undefined && bruta.limit !== undefined ? { ...bruta, pageSize: bruta.limit } : bruta);
  const f = bruta as Record<string, string | undefined>;
  const params: unknown[] = [ctx.orgId];
  const where = ["d.organization_id = $1"];
  params.push([...especies]); where.push(`d.especie = any($${params.length}::text[])`);
  // O filtro de espécie é PEDIDO: só intersecta o que já foi autorizado acima.
  if (f.especie) {
    const pedidas = f.especie.split(",").map((x) => x.trim()).filter((x) => (especies as readonly string[]).includes(x));
    params.push(pedidas); where.push(`d.especie = any($${params.length}::text[])`);
  }
  if (f.situacao) {
    params.push(f.situacao.split(",").map((x) => x.trim()).filter(Boolean));
    where.push(`d.situacao = any($${params.length}::text[])`);
  }
  // uuid malformado num filtro é ZERO linhas (o filtro não casa com nada), nunca 22P02 → 500.
  const porUuid = (valor: string | undefined, condicao: (p: string) => string) => {
    if (!valor) return;
    if (FORMA_UUID.test(valor)) { params.push(valor.toLowerCase()); where.push(condicao(`$${params.length}`)); } else where.push("false");
  };
  porUuid(f.empresa_id, (p) => `d.empresa_id = ${p}::uuid`);
  porUuid(f.tipo_operacao_id, (p) => `d.tipo_operacao_id = ${p}::uuid`);
  // OPERACOES-01 F5a: os documentos que puxam de uma origem (os consumos de uma requisição, as devoluções de um consumo).
  porUuid(f.origem_documento_id, (p) => `d.origem_documento_id = ${p}::uuid`);
  // O ATENDIMENTO da requisição (calculado — `SQL_ATENDIMENTO_REQUISICAO`), no WHERE antes do LIMIT. Valor fora do
  // domínio é 422 no parâmetro: um filtro que não filtra viraria "todas".
  if (f.atendimento) {
    const pedidos = f.atendimento.split(",").map((x) => x.trim()).filter(Boolean);
    const fora = pedidos.filter((x) => !(ATENDIMENTOS_REQUISICAO_ESTOQUE as readonly string[]).includes(x));
    if (fora.length || !pedidos.length) {
      throw recusar([{ path: "atendimento", message: `Atendimento inválido: use ${ATENDIMENTOS_REQUISICAO_ESTOQUE.join(", ")}` }]);
    }
    params.push(pedidos); where.push(`${SQL_ATENDIMENTO_REQUISICAO} = any($${params.length}::text[])`);
  }
  // O armazém casa com a ORIGEM ou com o DESTINO: a transferência aparece no filtro dos dois armazéns.
  porUuid(f.armazem_id, (p) => `(d.armazem_id = ${p}::uuid or d.armazem_destino_id = ${p}::uuid)`);
  for (const [chave, op] of [["start_date", ">="], ["end_date", "<="]] as const) {
    const v = f[chave];
    if (v) { if (isISODate(v)) { params.push(v); where.push(`d.data_documento ${op} $${params.length}::date`); } else where.push("false"); }
  }
  if (q.search) { params.push(`%${q.search}%`); where.push(`d.codigo ilike $${params.length}`); }
  // A lista única ignora a empresa SELECIONADA (como as de Vendas e Compras); a autorização entra sempre.
  where.push(...empresaScope(ctx, "d", params, { ignoreSelected: true, modulo: moduloDaPermissao("entradas_estoque.view") }));

  const de = `from erp.documentos_estoque d
              left join erp.empresas e on e.id = d.empresa_id
              left join erp.warehouses wo on wo.id = d.armazem_id and wo.organization_id = d.organization_id
              left join erp.warehouses wd on wd.id = d.armazem_destino_id and wd.organization_id = d.organization_id
              left join erp.tipos_operacao toper on toper.id = d.tipo_operacao_id and toper.organization_id = d.organization_id
              left join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
             where ${where.join(" and ")}`;
  const total = await ctx.tx.query<{ n: string }>(`select count(*)::text n ${de}`, params);
  const r = await ctx.tx.query<LinhaDaLista>(
    `select d.id, d.codigo, d.especie, d.situacao, d.data_documento, d.empresa_id, e.name as empresa_nome,
            d.armazem_id, wo.description as armazem_nome, d.armazem_destino_id, wd.description as armazem_destino_nome,
            d.tipo_operacao_id, toper.codigo as top_codigo, toper.codigo_base as top_codigo_base, topv.nome as top_nome, topv.versao as top_versao,
            (select count(*) from erp.documentos_estoque_itens i where i.documento_id = d.id and i.organization_id = d.organization_id)::int as quantidade_itens,
            d.created_at as criado_em, d.origem_documento_id, ${SQL_ATENDIMENTO_REQUISICAO} as atendimento
       ${de}
      order by d.data_documento desc, d.created_at desc, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
  const items = r.rows.map(({ top_codigo, top_codigo_base, top_nome, top_versao, ...x }) => ({
    ...x,
    especie_rotulo: ROTULO_DA_ESPECIE_ESTOQUE[x.especie] ?? x.especie,
    tipo_operacao: topParaTela({ tipo_operacao_id: x.tipo_operacao_id, top_codigo, top_codigo_base, top_nome, top_versao }),
  }));
  return paginaComIdGlobal(ctx, "documentos_estoque", { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize });
}

// ─────────────── lançamento ───────────────

const ROTULO_LONGO: Readonly<Record<EspecieEstoque, string>> = {
  entrada: "a entrada", saida: "a saída", transferencia: "a transferência", ajuste: "o ajuste",
  requisicao: "a requisição", consumo: "o consumo", devolucao_consumo: "a devolução de consumo",
};

/** O que é proibido estar presente: `null`/ausente é "não informado"; qualquer outro valor é recusado, nunca ignorado. */
const informado = (v: unknown) => v !== undefined && v !== null;

/**
 * A FORMA DO DOCUMENTO POR ESPÉCIE, sem consultar nada — o que cada espécie aceita e exige, e os números como
 * TEXTO CANÔNICO na forma e no limite da coluna (`conferirNumeroEstoque`: fora da forma ou do limite é 422, nunca
 * 500, nunca arredondado). Campo de outra espécie é RECUSADO: aceitar e ignorar um custo na saída faria a Central
 * acreditar que o custo informado vale, quando o da saída é o custo médio da confirmação.
 *
 * O CUSTO (OPERACOES-01 F5a): opcional na ENTRADA (vazio, a confirmação grava o custo médio do produto — como a
 * devolução antiga) e no AJUSTE (o custo da correção, como a correção antiga); proibido nas outras, que o calculam na
 * confirmação (a requisição não tem custo). A requisição reserva pelo produto no local de estoque: sem lote nem
 * validade. O que a movimentação interna acrescentou (origem, destino, motivo) entra nas MESMAS recusas, num 422 só.
 */
function conferirFormaDaEspecie(especie: EspecieEstoque, d: DocumentoEstoqueEntrada): { quantidades: (string | null)[]; contadas: (string | null)[]; custos: (string | null)[] } {
  const recusas: Recusa[] = [];
  if (especie === "transferencia") {
    if (!d.armazem_destino_id) recusas.push({ path: "armazem_destino_id", message: "Informe o local de estoque de destino da transferência" });
    else if (d.armazem_destino_id === d.armazem_id) recusas.push({ path: "armazem_destino_id", message: "O local de estoque de destino tem de ser diferente do local de estoque de origem" });
  } else if (d.armazem_destino_id) {
    recusas.push({ path: "armazem_destino_id", message: `O local de estoque de destino é só da transferência: não informe n${ROTULO_LONGO[especie]}` });
  }
  const numero = (i: number, campo: string, valor: unknown, limite: typeof LIMITE_QUANTIDADE_ESTOQUE | typeof LIMITE_CUSTO_ESTOQUE, minimo: "positivo" | "naoNegativo", faltando: string | null): string | null => {
    if (!informado(valor)) { if (faltando) recusas.push({ path: caminhoDoItem(i, campo), message: faltando }); return null; }
    const r = conferirNumeroEstoque(valor, { ...limite, minimo });
    if (!r.ok) { recusas.push({ path: caminhoDoItem(i, campo), message: r.mensagem }); return null; }
    return r.valor;
  };
  const proibido = (i: number, campo: string, valor: unknown, message: string) => {
    if (informado(valor)) recusas.push({ path: caminhoDoItem(i, campo), message });
  };
  /** O custo: opcional (conferido quando vem) na entrada e no ajuste; proibido nas outras. */
  const custo = (i: number, valor: unknown): string | null => {
    if (especie === "entrada" || especie === "ajuste") return numero(i, "custo_unitario", valor, LIMITE_CUSTO_ESTOQUE, "naoNegativo", null);
    proibido(i, "custo_unitario", valor, especie === "requisicao"
      ? "A requisição não tem custo: não informe o custo"
      : `O custo d${ROTULO_LONGO[especie]} é calculado na confirmação: não informe o custo`);
    return null;
  };
  const quantidades: (string | null)[] = []; const contadas: (string | null)[] = []; const custos: (string | null)[] = [];
  d.itens.forEach((it: ItemEntrada, i) => {
    custos.push(custo(i, it.custo_unitario));
    if (especie === "ajuste") {
      quantidades.push(null);
      proibido(i, "quantidade", it.quantidade, "O ajuste informa a quantidade CONTADA: use quantidade_contada");
      contadas.push(numero(i, "quantidade_contada", it.quantidade_contada, LIMITE_QUANTIDADE_ESTOQUE, "naoNegativo", "Informe a quantidade contada"));
      return;
    }
    contadas.push(null);
    proibido(i, "quantidade_contada", it.quantidade_contada, "A quantidade contada é só do ajuste: informe a quantidade");
    quantidades.push(numero(i, "quantidade", it.quantidade, LIMITE_QUANTIDADE_ESTOQUE, "positivo", "Informe a quantidade"));
    if (especie === "requisicao") {
      const message = "A requisição reserva pelo produto no local de estoque: não informe lote nem validade";
      proibido(i, "lote", it.lote, message);
      proibido(i, "validade", it.validade, message);
    }
  });
  recusas.push(...recusasDaFormaDaMovimentacaoInterna(especie, d));
  if (recusas.length) throw recusar(recusas);
  return { quantidades, contadas, custos };
}

/**
 * Armazém (e destino, na transferência): existe, não está excluído, está ATIVO e é DA EMPRESA DO DOCUMENTO. Tudo
 * isso cai na MESMA recusa, no campo — o armazém de outra empresa não se distingue do inexistente. Uma consulta.
 */
async function conferirArmazens(ctx: ServiceCtx, d: DocumentoEstoqueEntrada): Promise<void> {
  const pedidos = [d.armazem_id, ...(d.armazem_destino_id ? [d.armazem_destino_id] : [])];
  const r = await ctx.tx.query<{ id: string }>(
    "select id from erp.warehouses where id = any($1::uuid[]) and organization_id = $2 and empresa_id = $3 and deleted_at is null and is_active",
    [pedidos, ctx.orgId, d.empresa_id]);
  const validos = new Set(r.rows.map((w) => w.id));
  const recusas: Recusa[] = [];
  const message = "Local de estoque inválido: escolha um local de estoque ativo da empresa do documento";
  if (!validos.has(d.armazem_id)) recusas.push({ path: "armazem_id", message });
  if (d.armazem_destino_id && !validos.has(d.armazem_destino_id)) recusas.push({ path: "armazem_destino_id", message });
  if (recusas.length) throw recusar(recusas);
}

/**
 * Itens: produto da organização, não excluído, ATIVO e que CONTROLA ESTOQUE; lote só em produto que controla lote
 * e validade só em "lote e validade"; lote obrigatório na ENTRADA, na DEVOLUÇÃO DE CONSUMO e no AJUSTE de produto com
 * lote (o saldo que entra ou é contado é o de UM lote); validade obrigatória na entrada e na devolução de consumo de
 * "lote e validade". Na saída, na transferência e no consumo o lote é opcional: sem ele, a confirmação escolhe pela
 * validade (decisão 254). A requisição não tem lote (a forma já recusou): reserva pelo produto.
 *
 * No AJUSTE, o mesmo saldo (produto × lote) contado duas vezes é recusado: a contagem é UMA por saldo, e a
 * segunda linha calcularia a diferença sobre a primeira. Uma consulta, para todos os produtos.
 */
async function conferirItens(ctx: ServiceCtx, especie: EspecieEstoque, d: DocumentoEstoqueEntrada): Promise<void> {
  const produtos = await ctx.tx.query<{ id: string; control_stock: boolean; is_active: boolean; controle: string }>(
    `select id, control_stock, is_active,
            coalesce(to_jsonb(p)->>'controle_lote', case when p.has_lot then 'lote' else 'nenhum' end) as controle
       from erp.products p where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null`,
    [[...new Set(d.itens.map((i) => i.produto_id))], ctx.orgId]);
  const porProduto = new Map(produtos.rows.map((p) => [p.id, p]));
  const recusas: Recusa[] = [];
  const saldosContados = new Set<string>();
  d.itens.forEach((it, i) => {
    const p = porProduto.get(it.produto_id);
    const no = (campo: string, message: string) => recusas.push({ path: caminhoDoItem(i, campo), message });
    if (!p) return no("produto_id", "Produto inválido");
    if (!p.is_active) return no("produto_id", "Produto inativo: reative-o no cadastro ou escolha outro produto");
    if (!p.control_stock) return no("produto_id", "Este produto não controla estoque");
    if (it.lote && p.controle === "nenhum") no("lote", "Este produto não controla lote: não informe o lote");
    if (it.validade && p.controle !== "lote_validade") no("validade", "Este produto não controla validade: não informe a validade");
    const entra = especie === "entrada" || especie === "devolucao_consumo";
    if ((entra || especie === "ajuste") && p.controle !== "nenhum" && !it.lote) no("lote", "Este produto controla lote: informe o lote");
    if (entra && p.controle === "lote_validade" && !it.validade) no("validade", "Este produto controla lote e validade: informe a validade");
    if (especie === "ajuste") {
      const saldo = `${it.produto_id}\u0000${it.lote ?? ""}`;
      if (saldosContados.has(saldo)) no("produto_id", "Este produto e lote já foram contados neste ajuste: informe cada saldo uma vez só");
      saldosContados.add(saldo);
    }
  });
  if (recusas.length) throw recusar(recusas);
}

/**
 * A CONFIGURAÇÃO DA VERSÃO CONGELADA, lida UMA vez no lançamento (uma consulta) e usada por tudo o que o lançamento
 * cobra dela:
 *   · as EXIGÊNCIAS GERAIS — só "observação obrigatória" se aplica ao estoque, pelo mapa PRÓPRIO do estoque
 *     (`EXIGENCIAS_GERAIS_ESTOQUE_TOP`): cair no mapa da venda cobraria um parceiro que o documento nem tem. Versão de
 *     formato 1/2 não executa restrições; a de formato 3, 4 e 5 executa (`restricoesExecutamTop`);
 *   · as SEÇÕES DE EXTENSÃO do formato 5 (OPERACOES-01 F5a: Destino e Fluxo), pela pergunta do ponto de extensão
 *     (`secoesExtensaoDaVersaoTop`) — formatos 1 a 4 respondem o NEUTRO de cada seção (nada novo é exigido).
 * Versão ilegível: nenhuma exigência e as seções no neutro, como as exigências de hoje — quem recusa a versão que
 * ninguém sabe ler é a confirmação (`TIPO_OPERACAO_EXECUCAO_INDISPONIVEL`).
 * Lida aqui, e não pelas regras de vendas: o documento de estoque não tem condição de pagamento nem cliente.
 */
async function lerConfiguracaoDoLancamento(ctx: ServiceCtx, top: TopDoLancamento): Promise<{ restricoes: ConfiguracaoComRestricoesTop | null; secoes: SecoesExtensaoV5 }> {
  const v = await ctx.tx.query<{ configuracao: unknown }>(
    "select configuracao from erp.tipos_operacao_versoes where id = $1 and organization_id = $2", [top.tipoOperacaoVersaoId, ctx.orgId]);
  const lida = lerConfiguracaoTop(v.rows[0]?.configuracao ?? null);
  if (!lida.ok) return { restricoes: null, secoes: secoesExtensaoNeutrasTop() };
  return { restricoes: restricoesExecutamTop(lida.valor) ? lida.valor : null, secoes: secoesExtensaoDaVersaoTop(lida.valor) };
}

/** EXIGÊNCIAS GERAIS DA VERSÃO CONGELADA (ver `lerConfiguracaoDoLancamento`): faltou → 422 com cada exigência. */
function cobrarExigenciasDaTop(restricoes: ConfiguracaoComRestricoesTop | null, d: DocumentoEstoqueEntrada): void {
  if (!restricoes) return;
  const faltando = exigenciasGeraisFaltando(restricoes, { observacao: d.observacao }, EXIGENCIAS_GERAIS_ESTOQUE_TOP);
  if (!faltando.length) return;
  throw new DomainError(ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
    { exigencias: faltando.map((x) => ({ caminho: x.caminho, mensagem: `${x.rotulo} é obrigatório nesta operação.` })) });
}

/**
 * LANÇAR — o documento nasce ABERTO, com a TOP e a versão CONGELADAS pelo servidor (o cliente manda só
 * `tipo_operacao_id`). Recusas, nesta ordem: forma da espécie → TOP → (a configuração da versão, lida uma vez) →
 * locais de estoque → itens → ORIGEM → DESTINO → FLUXO → exigências da TOP; só então o número (recusa não queima
 * código). NADA de estoque se move aqui — nem com a TOP automática, nem na requisição (que só reserva ao ser
 * CONFIRMADA): quem confirma é `lancarEConfirmar`, depois daqui. Devolve o corpo da resposta e, à parte, a versão
 * congelada.
 *
 * O cabeçalho grava o DESTINO FINAL (o informado, o herdado da requisição ou o copiado do consumo) e a origem; cada
 * item grava a origem dele. O gatilho do cabeçalho e o dos itens (0043) repetem as invariantes no banco.
 */
async function lancar(ctx: ServiceCtx, especie: EspecieEstoque, d: DocumentoEstoqueEntrada) {
  const { quantidades, contadas, custos } = conferirFormaDaEspecie(especie, d);
  const top = await resolverTopParaLancamento(ctx, familiaDaEspecie(especie), d.tipo_operacao_id);
  const configuracao = await lerConfiguracaoDoLancamento(ctx, top);
  await conferirArmazens(ctx, d);
  await conferirItens(ctx, especie, d);
  const origem = await conferirOrigem(ctx, especie, d, quantidades);
  const destino = await conferirDestino(ctx, especie, d, origem, configuracao.secoes.destino);
  conferirFluxo(especie, d, origem, configuracao.secoes.fluxo, quantidades);
  cobrarExigenciasDaTop(configuracao.restricoes, d);

  const codigo = await nextCode(ctx.tx, ctx.orgId, `estoque_${especie}`);
  const id = (await ctx.tx.query<{ id: string }>(
    `insert into erp.documentos_estoque (organization_id, empresa_id, especie, codigo, situacao, tipo_operacao_id, tipo_operacao_versao_id, armazem_id, armazem_destino_id, data_documento, observacao, criado_por,
                                         origem_documento_id, centro_custo_id, equipamento_id, ordem_servico_id, lote_animais_id, area_id, safra_id, motivo_saida, justificativa)
     values ($1,$2,$3,$4,'aberto',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning id`,
    [ctx.orgId, d.empresa_id, especie, codigo, top.tipoOperacaoId, top.tipoOperacaoVersaoId, d.armazem_id, d.armazem_destino_id,
      d.data_documento, d.observacao, ctx.user.id,
      origem?.id ?? null, destino.centro_custo_id, destino.equipamento_id, destino.ordem_servico_id, destino.lote_animais_id, destino.area_id, destino.safra_id,
      d.motivo_saida, d.justificativa])).rows[0]!.id;
  await atribuirIdGlobal(ctx, "documentos_estoque", id);
  // Os itens num INSERT só (unnest), na ordem do corpo: `posicao` é o índice. A espécie vai em cada item — é o que
  // deixa o CHECK por espécie no banco (a FK composta garante que é a do cabeçalho).
  await ctx.tx.query(
    `insert into erp.documentos_estoque_itens (organization_id, documento_id, especie, posicao, produto_id, lote, validade, quantidade, quantidade_contada, custo_unitario, observacao, origem_item_id)
     select $1, $2, $3, u.posicao, u.produto_id, u.lote, u.validade, u.quantidade, u.quantidade_contada, u.custo_unitario, u.observacao, u.origem_item_id
       from unnest($4::int[], $5::uuid[], $6::text[], $7::date[], $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::uuid[])
            as u(posicao, produto_id, lote, validade, quantidade, quantidade_contada, custo_unitario, observacao, origem_item_id)
      order by u.posicao`,
    [ctx.orgId, id, especie, d.itens.map((_, i) => i), d.itens.map((x) => x.produto_id), d.itens.map((x) => x.lote), d.itens.map((x) => x.validade),
      quantidades, contadas, custos, d.itens.map((x) => x.observacao), d.itens.map((x) => x.origem_item_id)]);
  await audit(ctx.tx, ctx, "documentos_estoque", id, "create",
    { especie, codigo, tipoOperacaoId: top.tipoOperacaoId, tipoOperacaoVersaoId: top.tipoOperacaoVersaoId, tipoOperacaoCodigo: top.codigo, tipoOperacaoVersao: top.versao,
      ...(origem ? { origemDocumentoId: origem.id } : {}) });
  return { corpo: { id, codigo, especie, situacao: "aberto" as const }, versaoTopId: top.tipoOperacaoVersaoId };
}

/**
 * ═══ CONFIRMAÇÃO AUTOMÁTICA (TOP-CONFIG-08, decisão 277) ═══ — o FIM do POST, dentro do `idempotent` e depois
 * da auditoria "create" do `lancar`. Nunca dentro do `lancar`: lançar é só lançar, e o gancho fica num lugar só.
 *
 *   · quem decide é a versão CONGELADA no documento (`confirmaAutomaticamente`): formato 4 legível com
 *     "Confirmação: Automática". Formato 1–3, Manual ou sem TOP → nenhuma tentativa, e o corpo é o de hoje,
 *     chave por chave (sem `confirmacaoAutomatica`);
 *   · confirma pela MESMA função do `/confirmar` (`confirmarDocumentoEstoqueNaTransacao`): mesmas recusas, mesmos
 *     movimentos, mesma auditoria "confirm" (com `automatica: true`). Não existe segundo caminho de confirmação;
 *   · quem confirma é quem lançou, com a capacidade da confirmação manual (`<recurso>.edit`): o mesmo recurso cai
 *     no mesmo módulo de escopo, e a TOP nunca dá a ninguém um poder que ele não tem (sem ela: "sem_permissao");
 *   · recusa (saldo, período, cadastro, reprovação, a guarda do banco) volta ao savepoint: o documento fica SALVO
 *     e ABERTO, e a resposta diz o porquê com o MESMO corpo de erro que o `/confirmar` daria; aprovação exigida e
 *     ainda não dada para antes de qualquer efeito, e a resposta diz "aguardando_aprovacao";
 *   · com `{ confirmado: true }`, a `situacao` da resposta passa a "confirmado".
 * O resultado entra no corpo que o `idempotent` grava: o reenvio com a mesma chave devolve o mesmo corpo e nunca
 * confirma duas vezes.
 *
 * TRAVAS: lançar pega o contador do código e o do ID Global; a confirmação (manual ou automática) trava o cabeçalho e
 * depois o saldo e o produto, sem pegar contador nenhum. Compra e estoque: sem ciclo entre si. Mas a automática, que
 * já segura o contador do ID Global desde o lançamento, pede o saldo e o produto, e a confirmação MANUAL de uma VENDA
 * do mesmo produto faz o contrário (saldo e produto em `postStock`, depois o contador em `createTitles`): é possível
 * o 40P01, NOVO nesta fatia (a confirmação manual do estoque não fecha esse ciclo), com o mesmo desfecho do CA-12 — o
 * `fromPgError` o traduz em CONCURRENCY_CONFLICT, e a automática que perde vira "recusada" (documento salvo e aberto)
 * ou a manual da venda recebe o 409 de hoje. Barreira nas duas ordens: CA-12c/d de `top-config-08-estoque.test.ts`.
 * O contador do ID Global fica preso até o fim da confirmação automática (os lançamentos da organização esperam por
 * ele): risco declarado no contrato.
 */
async function lancarEConfirmar(ctx: ServiceCtx, especie: EspecieEstoque, recurso: RecursoEstoque, d: DocumentoEstoqueEntrada) {
  const { corpo, versaoTopId } = await lancar(ctx, especie, d);
  const confirmacaoAutomatica = (await confirmaAutomaticamente(ctx, versaoTopId))
    ? await tentarConfirmacaoAutomatica(ctx, {
      permissao: `${recurso}.edit`,
      confirmar: () => confirmarDocumentoEstoqueNaTransacao(ctx, especie, corpo.id, { automatica: true }),
    })
    : undefined;
  if (!confirmacaoAutomatica) return corpo;
  const situacao = confirmacaoAutomatica.confirmado ? "confirmado" as const : corpo.situacao;
  return { ...corpo, situacao, confirmacaoAutomatica };
}

// ─────────────── a TOP das rotas de leitura da Central (F5b) ───────────────

/** A TOP da query, conferida: a identidade, a família e a configuração da versão ATUAL. */
interface TopDaCentral { id: string; codigoBase: string; configuracao: unknown }

/**
 * A TOP pedida em `?tipo_operacao_id=` pelas rotas de LEITURA da Central de Estoque (`/regras-da-operacao` e
 * `/layout-efetivo`), com a configuração da versão ATUAL — UMA consulta. Ausente, repetida, malformada (`FORMA_UUID`,
 * conferida antes de qualquer consulta: um `::uuid` estourado seria 500), de outra família, inativa, excluída ou de
 * outra organização → a MESMA 404 (o molde de compras): uma resposta por motivo seria oráculo de existência. Outro
 * parâmetro qualquer é 422 no parâmetro — recusado, nunca ignorado.
 */
async function topDaCentral(ctx: ServiceCtx, familia: string, query: unknown): Promise<TopDaCentral> {
  const bruta = (query ?? {}) as Record<string, unknown>;
  const estranhos = Object.keys(bruta).filter((chave) => chave !== "tipo_operacao_id");
  if (estranhos.length) throw recusar(estranhos.map((path) => ({ path, message: "Parâmetro não reconhecido" })));
  const pedido = bruta["tipo_operacao_id"];
  if (typeof pedido !== "string" || !FORMA_UUID.test(pedido)) throw notFound("Tipo de operação");
  const r = await ctx.tx.query<{ id: string; codigo_base: string; configuracao: unknown }>(
    `select t.id, t.codigo_base, v.configuracao
       from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.id = $1 and t.organization_id = $2 and t.codigo_base = $3 and t.ativo and t.excluido_em is null`,
    [pedido.toLowerCase(), ctx.orgId, familia]);
  const linha = r.rows[0];
  if (!linha) throw notFound("Tipo de operação");
  return { id: linha.id, codigoBase: linha.codigo_base, configuracao: linha.configuracao };
}

// ─────────────── rotas ───────────────

export default async function estoqueRoutes(app: FastifyInstance) {
  for (const { especie, segmento, recurso } of ESPECIES_ESTOQUE) {
    const base = `/estoque/${segmento}`;

    /** As TOPs que esta espécie pode lançar — porta OPERACIONAL (`<recurso>.create`), não administrativa. */
    app.get(`${base}/operation-types`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const r = await ctx.tx.query<{ id: string; codigo: string; nome: string; versao: number; padrao: boolean }>(
        `select t.id, t.codigo, v.nome, v.versao, t.padrao
           from erp.tipos_operacao t
           join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
          where t.organization_id = $1 and t.codigo_base = $2 and t.ativo and t.excluido_em is null
          order by t.padrao desc, t.codigo, v.nome`, [ctx.orgId, familia]);
      return {
        contractVersion: 1,
        // `documentoEstoque` declara a capacidade: a web nova só oferece o "+ Novo" do portal contra uma API que a tem.
        // `movimentacaoInterna` (OPERACOES-01 F5a, aditiva): as três espécies novas, o destino, o motivo e a
        // justificativa da saída, a entrada sem custo, o custo no ajuste, a origem, o encerramento do saldo, o
        // atendimento/vinculados/`baseDoSaldo`, o `empresa_id` do saldo e (F5b) as opções do destino
        // (`/destino/opcoes`). Leitor: `entendeMovimentacaoInterna`.
        // `layoutDocumento` e `regrasDaOperacao` (OPERACOES-01 F5b, aditivas, no FIM, os valores de vendas e compras):
        // `/layout-efetivo` (o layout por TOP) e `/regras-da-operacao` (exigências, confirmação automática, Destino e
        // Fluxo) existem no estoque. A Central só pede as duas rotas com a chave declarada: contra a API anterior, o
        // layout do sistema local e o neutro de cada seção (o comportamento de hoje).
        capacidades: { documentoEstoque: 1, movimentacaoInterna: CAPACIDADE_MOVIMENTACAO_INTERNA, layoutDocumento: CAPACIDADE_LAYOUT_DOCUMENTO,
          regrasDaOperacao: CAPACIDADE_REGRAS_DA_OPERACAO },
        family: { code: familia, label: t(chaveI18nDaFamiliaOperacional(familia) ?? familia) },
        defaultId: r.rows.find((x) => x.padrao)?.id ?? null,
        items: r.rows.map((x) => ({ id: x.id, code: x.codigo, name: x.nome, version: x.versao, isDefault: x.padrao })),
      };
    }));

    /**
     * REGRAS DA OPERAÇÃO da TOP escolhida (versão ATUAL) — o que o lançamento vai cobrar dela, para a Central pedir o
     * mesmo antes do POST: `regrasDaOperacaoDoEstoque` (domínio), com a MESMA leitura do lançamento (as exigências pelo
     * mapa do estoque, a confirmação automática, as seções Destino e Fluxo — formatos 1 a 4 no neutro; `null` na
     * família que não usa a seção). Porta OPERACIONAL `<recurso>.create`; a mesma 404 de `topDaCentral`. Uma consulta.
     * O servidor continua a autoridade: o POST cobra tudo de novo, pela versão que ele mesmo congela.
     */
    app.get(`${base}/regras-da-operacao`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const top = await topDaCentral(ctx, familiaDaEspecie(especie), req.query);
      return regrasDaOperacaoDoEstoque(top.codigoBase, top.configuracao);
    }));

    /**
     * LAYOUT EFETIVO da TOP escolhida — o MESMO contrato de vendas e compras (`respostaDoLayoutEfetivo`: ligado à TOP →
     * padrão ativo da família → layout do sistema; `padroesDeCadastro`/`padroesInvalidos` só com padrão de cadastro,
     * como o Local de estoque padrão). TOP obrigatória (todo documento de estoque tem TOP); a mesma 404 de
     * `topDaCentral`. Porta OPERACIONAL `<recurso>.create`.
     */
    app.get(`${base}/layout-efetivo`, async (req) => runService(app, req, `${recurso}.create`, async (ctx) => {
      const familia = familiaDaEspecie(especie);
      const top = await topDaCentral(ctx, familia, req.query);
      return respostaDoLayoutEfetivo(ctx, familia, top.id);
    }));

    // As opções do destino (só saída, requisição e consumo; nas outras espécies a rota não existe).
    registrarOpcoesDoDestino(app, { especie, segmento, recurso });

    app.get(`${base}/:id`, async (req) => runService(app, req, `${recurso}.view`, (ctx) => lerDocumentoEstoque(ctx, (req.params as { id: string }).id, especie)));

    /**
     * LANÇAR. TOP obrigatória (versão congelada pelo servidor). Idempotency-Key com o USUÁRIO no hash. Com a TOP
     * no formato 4 e Confirmação Automática, confirma no fim, dentro da chave (`lancarEConfirmar`).
     */
    app.post(base, async (req, reply) => reply.status(201).send(await runService(app, req, `${recurso}.create`, async (ctx) => {
      const d = documentoSchema.parse(req.body);
      // Empresa do corpo é PEDIDO: fora do escopo do módulo estoque → 422 (o id veio do cliente; nada a revelar).
      await exigirEmpresaDeLancamento(ctx, d.empresa_id);
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: "lancar_documento_estoque", especie, corpo: d, actorId: ctx.user.id },
        () => lancarEConfirmar(ctx, especie, recurso, d))).result;
    })));
  }

  /**
   * ═══ A LISTA ÚNICA DE DOCUMENTOS DE ESTOQUE ═══ — no desenho das listas únicas de Vendas e Compras.
   * Porta dinâmica (`permission: null`): recorte por capacidade no WHERE antes do LIMIT; nenhuma capacidade → 403
   * ("lista vazia" nunca é "todas"); escopo de empresa reaplicado no SQL com o módulo EXPLÍCITO de estoque.
   */
  app.get("/estoque/documentos", async (req) => runService(app, req, null, async (ctx) => {
    const permitidas = ESPECIES_ESTOQUE.filter((e) => hasPermission(ctx, `${e.recurso}.view`)).map((e) => e.especie);
    if (permitidas.length === 0) throw denied("entradas_estoque.view");
    return listarDocumentos(ctx, permitidas, req.query);
  }));

  registrarConfirmacaoEstoque(app);
  registrarMovimentacaoInterna(app);
}
