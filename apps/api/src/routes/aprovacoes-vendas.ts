/**
 * ═══ APROVAÇÕES DE VENDA — A FILA, A DECISÃO E A SITUAÇÃO (TOP-CONFIG-08, decisão 277; OPERACOES-01 F2, 279) ═══
 *
 * A versão congelada da TOP no FORMATO 4 pode exigir aprovação antes da confirmação ("Sempre", ou "A partir de um
 * valor", com o total ATUAL do documento). Este arquivo serve quatro rotas — três sob `sales.approve` e a leitura da
 * situação sob `sales.view`:
 *
 *   GET  /api/aprovacoes/vendas                 a fila: vendas abertas que exigem aprovação e não estão aprovadas;
 *   POST /api/aprovacoes/vendas/:id/aprovar     { version, observacao? }
 *   POST /api/aprovacoes/vendas/:id/reprovar    { version, motivo }
 *   GET  /api/aprovacoes/vendas/:id             a situação da aprovação DE UMA venda (F2, decisão 279):
 *                                               { situacao, ultimaDecisao } — o contrato em `aprovacoes-situacao.ts`.
 *
 * POR QUE A LEITURA FICA EM `sales.view`: quem vê o documento vê a situação dele (a consulta da Central de Vendas
 * mostra "Aguardando aprovação", e a prévia do Confirmar já dizia o mesmo sob `sales.view`); quem DECIDE continua
 * sendo `sales.approve` (a fila e os dois POST). Ordem das recusas da leitura: 403 sem `sales.view` (o `runService`,
 * antes de qualquer leitura) → 422 parâmetro de consulta (qualquer um) → a MESMA 404 do GET por id (id fora da
 * forma; documento inexistente, de outra organização, fora do escopo de empresa do módulo vendas, excluído ou de
 * outra variante). Só leitura, consultas fixas.
 *
 * A decisão é uma linha de `erp.aprovacoes_venda` (0041), só de inserção, e vale para a VERSÃO do documento
 * (`sales_documents.version`, 0039): a vigente é a última decisão DA VERSÃO ATUAL. Alterar a venda sobe a versão, e
 * ela volta a "pendente" sem ninguém precisar lembrar. Aprovar não grava nada na venda (é por isso que a decisão mora
 * numa tabela ao lado): a versão que se aprovou é a que continua valendo. O status "approved" da 0005 não tem nada com
 * isto — aqui ele é só "aberto", como "open".
 *
 * ┌─ POR QUE UM PREFIXO PRÓPRIO ─────────────────────────────────────────────────────────────────────────────────────┐
 * │ `/api/aprovacoes/*`, e não `/api/sales/sales/:id/aprovar`. O binário anterior não conhece estas rotas, e um       │
 * │ prefixo que ele não serve responde o 404 do `setNotFoundHandler` — limpo, sem tocar no documento. É esse 404 que │
 * │ a web nova lê como "aprovações ainda não disponíveis neste servidor" durante a janela de deploy. Debaixo de       │
 * │ `/api/sales/sales/:id` o binário anterior poderia casar outra rota (o GET por id, com outro método) e o sinal     │
 * │ deixaria de ser inequívoco.                                                                                       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A ORDEM DAS RECUSAS (o molde do PATCH da venda, `sales.ts`) ────────────────────────────────────────────────────┐
 * │ 1. corpo (422) → 2. id fora da forma (a MESMA 404) → 3. documento invisível (a MESMA 404 do GET) →                │
 * │ 4. Idempotency-Key → 5. trava FOR UPDATE sem junção → 6. versão (409 CONCURRENCY_CONFLICT) →                       │
 * │ 7. documento não aberto (409 CONFLICT) → 8. não exige aprovação (409 APROVACAO_NAO_EXIGIDA) → 9. grava.          │
 * │                                                                                                                   │
 * │ A 404 VEM ANTES DO 409. Outra organização, fora do escopo de empresa, inexistente, excluída, outra variante e id │
 * │ malformado respondem a mesma 404, sem ler a versão. Se a versão fosse conferida antes, um 409 "o documento mudou" │
 * │ diria a quem não pode ver a venda que ela existe — o oráculo de existência que a superfície de recusa proíbe.    │
 * │ O id malformado é conferido na forma: passado ao banco ele viraria 22P02 (500), distinguível da 404.             │
 * │ A visibilidade é conferida ANTES da idempotência porque o replay devolve o corpo gravado sem rodar o handler (a  │
 * │ mesma razão do `/confirm` e do PATCH); o autor entra no hash pelo mesmo motivo.                                  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A TRAVA É A ORDEM DAS DECISÕES ─────────────────────────────────────────────────────────────────────────────────┐
 * │ `travarDocumentoDaEdicao` trava a linha da venda FOR UPDATE, sem junção — a MESMA trava do PATCH e da             │
 * │ confirmação. Duas aprovações da mesma venda, uma aprovação e um PATCH, uma aprovação e uma confirmação: a segunda │
 * │ espera o commit da primeira e decide sobre o que ela deixou. Assim nunca se aprova uma versão que ninguém viu (o  │
 * │ PATCH que commitou primeiro subiu a versão, e a aprovação cai no 409), e as decisões ficam em ordem: o `id` da    │
 * │ decisão cresce na ordem das travas, e "a última" é bem definida. O gatilho de inserção da 0041 confere tudo de   │
 * │ novo (organização, empresa, versão, situação, exigência) e atribui do documento a TOP, a versão e o valor: ele é │
 * │ o fundo; a rota é quem explica.                                                                                   │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * APROVAR COM TOP AUTOMÁTICA: depois de gravar a decisão, a venda é confirmada na mesma transação, num savepoint, pela
 * MESMA função do `/confirm` (`confirmarVendaNaTransacao`, `lib/confirmacao-automatica.ts`). Quem confirma é o
 * APROVADOR, com a capacidade DELE (`sales.edit`): sem ela, a decisão fica gravada e o resultado diz "sem_permissao".
 * A confirmação que recusa (saldo, período, exigência) volta ao savepoint: a aprovação fica, a venda fica aberta.
 *
 * A FILA: número FIXO de consultas — a contagem e a página —, qualquer que seja o tamanho da página. A exigência é a
 * conta do banco (`erp.top_exige_aprovacao`, a MESMA do domínio, provada por paridade) sobre a versão congelada e o
 * total ATUAL; a decisão vigente e a última decisão saem de `left join lateral … limit 1` pelo índice
 * (organization_id, documento_id, id desc). Nada de consulta por linha.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FORMA_UUID_PADRAO, MENSAGEM_APROVACAO_NAO_EXIGIDA, MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO } from "@agro/domain";
import { runService, idempotent, audit } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import { empresaScope, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { situacaoDaAprovacao, registrarDecisao } from "../lib/aprovacao-documento.js";
import { lerVersaoCongeladaTop, confirmaAutomaticamente, tentarConfirmacaoAutomatica, type ResultadoConfirmacaoAutomatica } from "../lib/confirmacao-automatica.js";
import { exigirDocumentoVisivel, travarDocumentoDaEdicao, confirmarVendaNaTransacao, getDoc } from "./sales.js";
import { recusarParametrosDaSituacao, respostaDaSituacaoDaAprovacao, type RespostaDaSituacaoDaAprovacao } from "./aprovacoes-situacao.js";
import { MSG_DOCUMENTO_MUDOU, MSG_EDICAO_VERSAO_AUSENTE, MSG_EDICAO_VERSAO_INVALIDA } from "./vendas-edicao-patch.js";
import { paginaComIdGlobal } from "../lib/id-global.js";

// ─────────────── contrato de entrada (estrito) ───────────────

/**
 * A VERSÃO DO DOCUMENTO QUE A PESSOA VIU — o mesmo contrato da `version` do PATCH (`vendas-edicao-patch.ts`): o TEXTO
 * do bigint que o GET e a fila devolvem, na forma canônica (sem zero à esquerda, dentro do bigint), ou um inteiro JSON
 * exato e ≥ 0. A versão nasce 0 (0039), então o zero é versão legítima. Comparada como texto do bigint: "7" e 7 são o
 * mesmo pedido (e o mesmo hash de idempotência); "007" é outra grafia, recusada (422) em vez de virar um 409 falso.
 * As mensagens são as do PATCH: ausente → "Informe a versão…"; fora da forma → "Versão inválida…".
 */
const FORMA_VERSAO = /^(0|[1-9]\d{0,18})$/;
const VERSAO_MAXIMA = 9223372036854775807n;
const versaoCanonica = (v: string | number): string | null =>
  typeof v === "string" ? (FORMA_VERSAO.test(v) && BigInt(v) <= VERSAO_MAXIMA ? v : null)
    : Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
const versaoSchema = z.union([z.string(), z.number()], { error: (i) => (i.input === undefined ? MSG_EDICAO_VERSAO_AUSENTE : MSG_EDICAO_VERSAO_INVALIDA) })
  .superRefine((v, c) => { if (versaoCanonica(v) === null) c.addIssue({ code: "custom", message: MSG_EDICAO_VERSAO_INVALIDA }); })
  .transform((v) => String(v));

/**
 * Os corpos são `.strict()`: chave desconhecida é 422, nunca descartada (um `observaçao` com typo viraria "aprovado sem
 * observação" com 200). A observação é opcional — ausente, `null` ou texto até 500; em branco é "sem observação"
 * (`null`), o mesmo tratamento do texto opcional do documento de estoque. O motivo da reprovação é obrigatório, de 1 a
 * 500 caracteres depois do `trim` (o CHECK da 0041 recusa motivo vazio também no banco).
 */
const aprovarSchema = z.object({
  version: versaoSchema,
  observacao: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
}).strict();
const reprovarSchema = z.object({
  version: versaoSchema,
  motivo: z.string().trim().min(1).max(500),
}).strict();

type Decisao = "aprovado" | "reprovado";
type Acao = "aprovar" | "reprovar";

/** O pedido conferido: a versão canônica e o texto da decisão (a observação da aprovação, ou o motivo da reprovação). */
function lerPedido(acao: Acao, corpo: unknown): { versao: string; texto: string | null } {
  if (acao === "aprovar") {
    const c = aprovarSchema.parse(corpo ?? {});
    return { versao: c.version, texto: c.observacao };
  }
  const c = reprovarSchema.parse(corpo ?? {});
  return { versao: c.version, texto: c.motivo };
}

/** A resposta da decisão. `confirmacaoAutomatica` só existe quando a versão congelada confirma sozinha. */
interface RespostaDaDecisao {
  aprovacao: { decisao: Decisao; decididoEm: string };
  confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica;
}

// ─────────────── a fila ───────────────

/** Uma linha da fila como o W4 a consome (COORD, "Rotas de aprovação"). */
type LinhaDaFila = {
  id: string; codigo: string; especie: "venda"; data: string;
  empresa: { id: string; nome: string }; parceiro: { id: string; nome: string } | null; operacao: { id: string; nome: string };
  valor: string | null; lancadoPor: { id: string; nome: string } | null; situacao: "pendente" | "reprovado";
  ultimaDecisao: { decisao: Decisao; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string } | null;
  version: string;
};

interface LinhaLida {
  id: string; code: string; document_date: string; empresa_id: string; empresa_nome: string | null;
  client_id: string | null; cliente_nome: string | null; tipo_operacao_id: string; operacao_nome: string; total: string;
  criado_por_id: string | null; criado_por_nome: string | null; version: string; vigente: Decisao | null;
  ultima_decisao: Decisao | null; ultima_observacao: string | null; ultima_decidido_por: string | null;
  ultima_decidido_por_nome: string | null; ultima_decidido_em: Date | string | null;
}

const instante = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** A fila aceita só a paginação (`page`, `pageSize`). */
const PARAMETROS_DA_FILA = new Set(["page", "pageSize"]);

/**
 * A FILA DE APROVAÇÃO DA VENDA: venda (`kind` sale) viva e aberta (open | approved) cuja versão congelada EXIGE
 * aprovação pelo total ATUAL e cuja decisão vigente — a última DA VERSÃO ATUAL — não é "aprovado". Sem decisão da
 * versão atual = "pendente"; vigente reprovada = "reprovado".
 *
 * `ultimaDecisao` é a última decisão do documento, de QUALQUER versão: numa venda reprovada (ou aprovada) e alterada
 * depois, a situação volta a "pendente" e a última decisão continua mostrando o que foi decidido antes, e por quem.
 * Quando a versão atual tem decisão, a última É a vigente (a trava ordena as decisões, e a versão só cresce).
 *
 * O ESCOPO é o de quem aprova: o módulo de vendas (o da permissão `sales.approve`) e a empresa selecionada, o MESMO
 * recorte da lista de vendas e do GET por id — o que a fila mostra é o que a decisão aceita (a decisão confere a
 * visibilidade pelo `getDoc`, que respeita a empresa selecionada). A RLS das duas tabelas recorta pelo mesmo módulo;
 * o SQL o reaplica, e o lateral da decisão responde pela PRÓPRIA coluna de empresa.
 *
 * Paginação no servidor (`pageQuerySchema`), ordem fixa: data do documento desc, criação desc, id.
 */
async function listarFila(ctx: ServiceCtx, query: unknown) {
  const bruta = (query ?? {}) as Record<string, unknown>;
  // A fila aceita só a paginação, como as de compra e de estoque: o que vier além é 422 no parâmetro, nunca
  // "ignorado" (descarte silencioso de contrato não canônico é ampliação de escopo — CLAUDE.md). Parâmetro repetido
  // chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  for (const [chave, valor] of Object.entries(bruta)) {
    if (Array.isArray(valor)) throw err("VALIDATION_ERROR", "Parâmetro repetido: informe um valor só", [{ path: chave, message: "Parâmetro repetido: informe um valor só" }]);
    if (!PARAMETROS_DA_FILA.has(chave)) throw err("VALIDATION_ERROR", "Parâmetro não reconhecido na fila de aprovações", [{ path: chave, message: "Parâmetro não reconhecido na fila de aprovações" }]);
  }
  const q = pageQuerySchema.parse(bruta);
  const params: unknown[] = [ctx.orgId];
  const where = [
    "d.organization_id = $1", "d.kind = 'sale'", "d.status in ('open', 'approved')", "d.deleted_at is null",
    "erp.top_exige_aprovacao(topv.configuracao, d.total)",
    "vig.decisao is distinct from 'aprovado'",
  ];
  where.push(...empresaScope(ctx, "d", params));
  // A base: o documento, a versão congelada (INNER — sem versão não há o que exigir) e a decisão vigente.
  const base = `from erp.sales_documents d
                join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
                left join lateral (
                  select a.decisao
                    from erp.aprovacoes_venda a
                   where a.organization_id = d.organization_id and a.empresa_id = d.empresa_id
                     and a.documento_id = d.id and a.versao_documento = d.version
                   order by a.id desc
                   limit 1) vig on true`;
  const filtro = `where ${where.join(" and ")}`;

  const total = await ctx.tx.query<{ n: string }>(`select count(*)::text n ${base} ${filtro}`, params);
  // Os LEFT JOINs da página são todos de no máximo uma linha (por id, ou `limit 1`): não mudam a contagem.
  const r = await ctx.tx.query<LinhaLida>(
    `select d.id, d.code, d.document_date, d.empresa_id, e.name as empresa_nome,
            d.client_id, c.name as cliente_nome, d.tipo_operacao_id, topv.nome as operacao_nome, d.total,
            d.created_by as criado_por_id, ul.name as criado_por_nome, d.version, vig.decisao as vigente,
            ult.decisao as ultima_decisao, ult.observacao as ultima_observacao, ult.decidido_por as ultima_decidido_por,
            ud.name as ultima_decidido_por_nome, ult.decidido_em as ultima_decidido_em
       ${base}
       left join lateral (
         select a.decisao, a.observacao, a.decidido_por, a.decidido_em
           from erp.aprovacoes_venda a
          where a.organization_id = d.organization_id and a.empresa_id = d.empresa_id and a.documento_id = d.id
          order by a.id desc
          limit 1) ult on true
       left join erp.empresas e on e.id = d.empresa_id and e.organization_id = d.organization_id
       left join erp.people c on c.id = d.client_id and c.organization_id = d.organization_id
       left join erp.users ul on ul.id = d.created_by
       left join erp.users ud on ud.id = ult.decidido_por
       ${filtro}
      order by d.document_date desc, d.created_at desc, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);

  const items: LinhaDaFila[] = r.rows.map((x) => ({
    id: x.id, codigo: x.code, especie: "venda", data: x.document_date,
    empresa: { id: x.empresa_id, nome: x.empresa_nome ?? "" },
    parceiro: x.client_id && x.cliente_nome !== null ? { id: x.client_id, nome: x.cliente_nome } : null,
    operacao: { id: x.tipo_operacao_id, nome: x.operacao_nome },
    valor: x.total,
    lancadoPor: x.criado_por_id && x.criado_por_nome !== null ? { id: x.criado_por_id, nome: x.criado_por_nome } : null,
    situacao: x.vigente === "reprovado" ? "reprovado" : "pendente",
    ultimaDecisao: x.ultima_decisao && x.ultima_decidido_por && x.ultima_decidido_em
      ? { decisao: x.ultima_decisao, observacao: x.ultima_observacao,
          decididoPor: { id: x.ultima_decidido_por, nome: x.ultima_decidido_por_nome ?? "" }, decididoEm: instante(x.ultima_decidido_em) }
      : null,
    version: x.version,
  }));
  // O ID Global de cada documento (o localizador humano da organização), como nas listas de hoje: uma consulta a
  // mais, fixa, e a marca `idGlobal` que a tela lê para mostrar a coluna (id-global-audit).
  return paginaComIdGlobal(ctx, "sales_documents", { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize });
}

// ─────────────── a decisão ───────────────

/**
 * APROVAR OU REPROVAR, já dentro da idempotência, a partir do passo 5 (a trava). Quem chama já conferiu o corpo, a
 * forma do id e a visibilidade.
 */
async function decidir(app: FastifyInstance, ctx: ServiceCtx, id: string, versao: string, decisao: Decisao, texto: string | null): Promise<RespostaDaDecisao> {
  // 5. A trava sem junção (a do PATCH): é ela que ordena decisões, edições e confirmações da mesma venda.
  const travada = await travarDocumentoDaEdicao(ctx, id, "sale");
  // 6. A versão que a pessoa viu é a gravada? Comparada como bigint (o texto canônico dos dois lados).
  if (BigInt(travada.version) !== BigInt(versao)) throw err("CONCURRENCY_CONFLICT", MSG_DOCUMENTO_MUDOU);
  // A linha já é desta transação: a leitura sem trava enxerga o que vale até o commit. Uma consulta, só o que decide.
  const lida = await ctx.tx.query<{ status: string; total: string; empresa_id: string; tipo_operacao_versao_id: string | null }>(
    "select d.status, d.total, d.empresa_id, d.tipo_operacao_versao_id from erp.sales_documents d where d.id = $1 and d.organization_id = $2",
    [travada.id, ctx.orgId]);
  const doc = lida.rows[0];
  if (!doc) throw notFound("Documento");
  // 7. Só documento aberto. "approved" (0005) é aberto: não é a aprovação desta fatia.
  if (doc.status !== "open" && doc.status !== "approved") throw err("CONFLICT", MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO);
  // 8. Exige aprovação? Pela versão congelada e pelo total ATUAL; formato 1–3, sem TOP ou abaixo do limite → não.
  // Versão no formato 4 ilegível → TIPO_OPERACAO_EXECUCAO_INDISPONIVEL (fail-closed), lançado pelo `situacaoDaAprovacao`.
  const versaoTop = await lerVersaoCongeladaTop(ctx, doc.tipo_operacao_versao_id);
  const situacao = await situacaoDaAprovacao(ctx, { modulo: "vendas", documentoId: travada.id, versaoDocumento: travada.version, valorDocumento: doc.total, versaoTop });
  if (situacao === "nao_exigida") throw err("APROVACAO_NAO_EXIGIDA", MENSAGEM_APROVACAO_NAO_EXIGIDA);

  // 9. A decisão (o gatilho da 0041 reconfere e atribui TOP, versão, valor, quem e quando) e a auditoria no documento.
  const registro = await registrarDecisao(ctx, { modulo: "vendas", documentoId: travada.id, empresaId: doc.empresa_id, versaoDocumento: travada.version, decisao, observacao: texto });
  await audit(ctx.tx, ctx, "sales_documents", travada.id, decisao === "aprovado" ? "approve" : "reject",
    decisao === "aprovado" ? { observacao: texto, versao: travada.version } : { motivo: texto, versao: travada.version });
  const corpo: RespostaDaDecisao = { aprovacao: { decisao, decididoEm: registro.decididoEm } };
  if (decisao !== "aprovado") return corpo;

  // 10. Aprovada e a versão confirma sozinha: o APROVADOR confirma, com a capacidade dele, pela confirmação única.
  const confirmacaoAutomatica = (await confirmaAutomaticamente(ctx, doc.tipo_operacao_versao_id))
    ? await tentarConfirmacaoAutomatica(ctx, { permissao: "sales.edit", confirmar: () => confirmarVendaNaTransacao(app, ctx, travada.id, { automatica: true }) })
    : undefined;
  return confirmacaoAutomatica ? { ...corpo, confirmacaoAutomatica } : corpo;
}

// ─────────────── a situação de UMA venda (F2, decisão 279) ───────────────

/**
 * A SITUAÇÃO DA APROVAÇÃO DE UMA VENDA, para a consulta da Central de Vendas. Quem chama já passou pelo `sales.view`.
 * O documento é achado pela MESMA leitura do GET por id (`getDoc`, variante `sale`): é ela que aplica organização,
 * escopo de empresa, `deleted_at` e variante — e é por isso que a 404 é a mesma, com o mesmo corpo.
 */
async function situacaoDaVenda(ctx: ServiceCtx, params: unknown, query: unknown): Promise<RespostaDaSituacaoDaAprovacao> {
  // 1. Parâmetro de consulta: 422, antes de qualquer leitura (nunca ignorado).
  recusarParametrosDaSituacao(query);
  // 2. Id malformado é inexistente: a MESMA 404 do GET, e não o 500 do 22P02.
  const bruto = (params as { id: string }).id;
  if (!FORMA_UUID_PADRAO.test(bruto)) throw notFound("Documento");
  const id = bruto.toLowerCase();
  // 3. Visível neste contexto — a leitura do GET por id; invisível é a MESMA 404.
  const doc = await getDoc(ctx, id, "sale");
  // 4. A conta (o contrato em `aprovacoes-situacao.ts`). "approved" (0005) é aberto, como na decisão.
  return respostaDaSituacaoDaAprovacao(ctx, {
    modulo: "vendas",
    documentoId: String(doc["id"]),
    aberto: doc["status"] === "open" || doc["status"] === "approved",
    versaoDocumento: String(doc["version"]),
    valorDocumento: String(doc["total"]),
    tipoOperacaoVersaoId: typeof doc["tipo_operacao_versao_id"] === "string" ? doc["tipo_operacao_versao_id"] : null,
  });
}

export default async function aprovacoesVendasRoutes(app: FastifyInstance) {
  app.get("/aprovacoes/vendas", async (req) => runService(app, req, "sales.approve", (ctx) => listarFila(ctx, req.query)));

  // A situação da aprovação de UMA venda: leitura sob `sales.view` (quem vê o documento vê a situação).
  app.get("/aprovacoes/vendas/:id", async (req) => runService(app, req, "sales.view", (ctx) => situacaoDaVenda(ctx, req.params, req.query)));

  for (const acao of ["aprovar", "reprovar"] as const satisfies readonly Acao[]) {
    const decisao: Decisao = acao === "aprovar" ? "aprovado" : "reprovado";
    app.post(`/aprovacoes/vendas/:id/${acao}`, async (req) => runService(app, req, "sales.approve", async (ctx) => {
      // 1. O corpo, antes de qualquer leitura de registro e de reservar a chave.
      const pedido = lerPedido(acao, req.body);
      // 2. Id malformado é inexistente: a MESMA 404 do GET, e não o 500 do 22P02.
      const bruto = (req.params as { id: string }).id;
      if (!FORMA_UUID_PADRAO.test(bruto)) throw notFound("Documento");
      const id = bruto.toLowerCase();
      // 3. Visível neste contexto (organização, escopo de empresa, variante, excluído) — a MESMA 404 do GET por id.
      await exigirDocumentoVisivel(ctx, id, "sale");
      // 4. Idempotência: ação, documento, o pedido e QUEM pede (o replay não pode atravessar o recorte de outro ator).
      return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
        { action: acao === "aprovar" ? "approve_sales_document" : "reject_sales_document", sourceId: id, version: pedido.versao, texto: pedido.texto, actorId: ctx.user.id },
        () => decidir(app, ctx, id, pedido.versao, decisao, pedido.texto))).result;
    }));
  }
}
