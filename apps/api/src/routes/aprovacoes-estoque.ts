/**
 * ═══ APROVAÇÕES — O DOCUMENTO DE ESTOQUE (TOP-CONFIG-08, decisão 277) ═══
 *
 * A TOP no FORMATO 4 pode exigir aprovação antes da confirmação. No estoque só a política "Sempre" existe (a matriz
 * recusa "A partir de um valor": o valor do documento de estoque só é conhecido na confirmação), então a conta é
 * sempre feita SEM valor (`erp.top_exige_aprovacao(configuracao, null)`, a mesma do domínio, `exigeAprovacao`).
 *
 * Este arquivo tem a FILA (o que espera decisão) e as DECISÕES (aprovar, reprovar). O prefixo é PRÓPRIO
 * (`/api/aprovacoes/...`), e não um sufixo das rotas do portal: o binário anterior responde a ele um 404 limpo.
 *   · GET  /aprovacoes/estoque                       → porta DINÂMICA: as espécies cuja `<recurso>.approve` a pessoa
 *     tem; nenhuma → 403 ("lista vazia" nunca é "todas"). O molde é a lista única do portal (`estoque-documentos.ts`),
 *     com UMA diferença: a empresa SELECIONADA recorta a fila, como recorta a decisão — a fila só mostra o que o
 *     Aprovar e o Reprovar, com a mesma seleção, aceitam.
 *   · POST /aprovacoes/estoque/<segmento>/:id/aprovar  {observacao?} e /reprovar {motivo} → uma rota por espécie,
 *     com `<recurso da espécie>.approve`; o segmento na URL é a porta, e o documento de OUTRA espécie é a mesma 404.
 *   · GET  /aprovacoes/estoque/<segmento>/:id  (OPERACOES-01 F12, decisão 282) → `{ situacao, ultimaDecisao }`, a
 *     SITUAÇÃO DA APROVAÇÃO de um documento, para a consulta da Central de Estoque — o contrato da venda e da compra
 *     (`aprovacoes-situacao.ts`, decisão 279). Uma rota por espécie, como as decisões, com `<recurso da espécie>.view`:
 *     a capacidade é conferida pelo `runService` ANTES de qualquer leitura (a porta é a espécie da URL, nunca a linha —
 *     nada do documento é lido para escolher a permissão), e o documento é achado pelo MESMO recorte do GET por id
 *     (organização, espécie e escopo de empresa do módulo estoque): a MESMA 404. Só leitura, consultas fixas.
 *
 * A ORDEM DAS RECUSAS é a do PATCH da venda (EDITAR-01), e é contrato:
 *   1. o corpo → 422, antes de ler qualquer registro e de reservar a chave de idempotência;
 *   2. id fora da forma de UUID → a MESMA 404 (sem isso, o `::uuid` do banco daria 500 — um oráculo de formato);
 *   3. documento invisível (outra organização, fora do escopo de empresa do módulo estoque, inexistente, de outra
 *      espécie) → a MESMA 404 do GET (`lerDocumentoEstoque`), ANTES da idempotência: o replay não pode devolver a
 *      resposta gravada a quem não enxerga o documento;
 *   4. a Idempotency-Key (o autor no hash);
 *   5. a TRAVA do cabeçalho, `for update`, SEM junção: é ela que impede duas decisões e a confirmação de se cruzarem
 *      e que dá a ordem das decisões. Sob READ COMMITTED, quem espera relê só a própria linha;
 *   6. documento que não está aberto → 409 CONFLICT;
 *   7. documento que não exige aprovação (versão de formato 1 a 3, política "nenhuma") → 409 APROVACAO_NAO_EXIGIDA;
 *   8. grava a decisão (`registrarDecisao`; o gatilho da 0041 confere tudo de novo e atribui TOP, versão, quem e
 *      quando) e a auditoria no DOCUMENTO ("approve" | "reject", com a observação ou o motivo);
 *   9. aprovar com TOP de confirmação AUTOMÁTICA: a confirmação é tentada no fim, por QUEM APROVOU e com a capacidade
 *      de confirmar DELE (`<recurso>.edit`), num savepoint — recusada, a aprovação fica e o documento fica aberto.
 * O banco é o fundo: a guarda de transição da 0041 recusa o aberto → confirmado sem aprovação vigente, venha de onde vier.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  moduloDaPermissao, MENSAGEM_APROVACAO_NAO_EXIGIDA, MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO, type EspecieEstoque,
} from "@agro/domain";
import { runService, idempotent, audit, comPermissaoResolvida } from "../lib/service.js";
import { err, denied, notFound, validation } from "../lib/errors.js";
import { empresaScope, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { registrarDecisao, situacaoDaAprovacao } from "../lib/aprovacao-documento.js";
import {
  confirmaAutomaticamente, lerVersaoCongeladaTop, tentarConfirmacaoAutomatica, type ResultadoConfirmacaoAutomatica,
} from "../lib/confirmacao-automatica.js";
import { ESPECIES_ESTOQUE, FORMA_UUID, lerDocumentoEstoque } from "./estoque-comum.js";
import { recusarParametrosDaSituacao, respostaDaSituacaoDaAprovacao, type RespostaDaSituacaoDaAprovacao } from "./aprovacoes-situacao.js";
import { confirmarDocumentoEstoqueNaTransacao } from "./estoque-confirmacao.js";
import { paginaComIdGlobal } from "../lib/id-global.js";

// ─────────────── contrato de entrada (estrito) ───────────────

/**
 * Aprovar: observação OPCIONAL (ausente ou null), aparada, até 500; vazia ou só espaços vira `null`.
 * Reprovar: motivo OBRIGATÓRIO, aparado, de 1 a 500 — só espaços é 422 aqui, e não o CHECK do banco.
 * `.strict()`: chave desconhecida é 422 — nunca descartada em silêncio.
 */
const aprovarSchema = z.object({
  observacao: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
}).strict();
const reprovarSchema = z.object({
  motivo: z.string().trim().min(1).max(500),
}).strict();

type Decisao = "aprovado" | "reprovado";

/** A resposta das duas decisões. `confirmacaoAutomatica` só existe quando a TOP é automática (e só no aprovar). */
interface RespostaDaDecisao {
  aprovacao: { decisao: Decisao; decididoEm: string };
  confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica;
}

const chaveDeIdempotencia = (h: unknown) => (typeof h === "string" ? h : undefined);

// ─────────────── a fila ───────────────

/** O módulo de escopo das quatro espécies (todas caem em estoque). Explícito: a porta da fila é dinâmica. */
const MODULO_ESTOQUE = moduloDaPermissao("entradas_estoque.approve");

interface LinhaDaFilaLida {
  id: string;
  codigo: string;
  especie: EspecieEstoque;
  data: string;
  empresa_id: string;
  empresa_nome: string | null;
  operacao_id: string;
  operacao_nome: string;
  criado_por: string | null;
  criado_por_nome: string | null;
  decisao: Decisao | null;
  observacao: string | null;
  decidido_por: string | null;
  decidido_por_nome: string | null;
  decidido_em: Date | null;
}

/** A fila aceita só a paginação (`page`, `pageSize`). */
const PARAMETROS_DA_FILA = new Set(["page", "pageSize"]);

/**
 * A FILA DO ESTOQUE — os documentos ABERTOS das espécies que a pessoa aprova, cuja versão CONGELADA exige aprovação
 * e cuja última decisão não é "aprovado" (pendentes e reprovados), no escopo de empresa do módulo estoque.
 *
 * A espécie entra no WHERE ANTES do LIMIT (recorte de autorização, nunca filtro sobre o resultado), e o escopo de
 * empresa é aplicado no SQL com o módulo EXPLÍCITO (a porta é dinâmica, e o módulo não vem dela) e com a empresa
 * SELECIONADA — a mesma regra da decisão, que vem pelo `scopedById` sem `ignoreSelected`. A última decisão
 * sai de um `lateral` pelo índice (organização, documento, id desc), amarrada à empresa do documento pela PRÓPRIA
 * coluna. Número FIXO de consultas — contagem e página —, qualquer que seja o tamanho da página.
 */
async function listarFila(ctx: ServiceCtx, especies: readonly EspecieEstoque[], query: unknown) {
  const bruta = (query ?? {}) as Record<string, unknown>;
  // Parâmetro repetido chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  // A fila aceita só a paginação, como as de venda e de compra: o que vier além é 422 no parâmetro, nunca "ignorado"
  // (descarte silencioso de contrato não canônico é ampliação de escopo — CLAUDE.md).
  for (const [chave, valor] of Object.entries(bruta)) {
    if (Array.isArray(valor)) throw validation("Parâmetro repetido: informe um valor só", [{ path: chave, message: "Parâmetro repetido: informe um valor só" }]);
    if (!PARAMETROS_DA_FILA.has(chave)) throw validation("Parâmetro não reconhecido na fila de aprovações", [{ path: chave, message: "Parâmetro não reconhecido na fila de aprovações" }]);
  }
  const q = pageQuerySchema.parse(bruta);
  const params: unknown[] = [ctx.orgId, [...especies]];
  const where = [
    "d.organization_id = $1",
    "d.especie = any($2::text[])",
    "d.situacao = 'aberto'",
    "erp.top_exige_aprovacao(topv.configuracao, null)",
    "ult.decisao is distinct from 'aprovado'",
  ];
  // A empresa SELECIONADA (X-Empresa-Id) recorta, e a autorização do módulo estoque entra sempre por cima, como nas
  // filas de venda e de compra. É o MESMO recorte da decisão (`lerDocumentoEstoque` e a trava, pelo `scopedById`): o
  // que a fila mostra é o que Aprovar e Reprovar aceitam. Ignorar a seleção aqui listaria o documento da empresa Y
  // com a X selecionada, e a decisão sobre ele responderia 404. A seleção só DIMINUI o escopo, nunca o amplia.
  where.push(...empresaScope(ctx, "d", params, { modulo: MODULO_ESTOQUE }));

  const de = `from erp.documentos_estoque d
              join erp.tipos_operacao_versoes topv on topv.id = d.tipo_operacao_versao_id and topv.organization_id = d.organization_id
              left join erp.empresas e on e.id = d.empresa_id
              left join erp.users uc on uc.id = d.criado_por
              left join lateral (
                select a.decisao, a.observacao, a.decidido_por, a.decidido_em
                  from erp.aprovacoes_estoque a
                 where a.organization_id = d.organization_id and a.documento_id = d.id and a.empresa_id = d.empresa_id
                 order by a.id desc
                 limit 1) ult on true
              left join erp.users ud on ud.id = ult.decidido_por
             where ${where.join(" and ")}`;
  const total = await ctx.tx.query<{ n: string }>(`select count(*)::text n ${de}`, params);
  const r = await ctx.tx.query<LinhaDaFilaLida>(
    `select d.id, d.codigo, d.especie, d.data_documento as data, d.empresa_id, e.name as empresa_nome,
            d.tipo_operacao_id as operacao_id, topv.nome as operacao_nome, d.criado_por, uc.name as criado_por_nome,
            ult.decisao, ult.observacao, ult.decidido_por, ud.name as decidido_por_nome, ult.decidido_em
       ${de}
      order by d.data_documento desc, d.created_at desc, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
  const items = r.rows.map((x) => ({
    id: x.id,
    codigo: x.codigo,
    especie: x.especie,
    data: x.data,
    empresa: { id: x.empresa_id, nome: x.empresa_nome ?? "" },
    parceiro: null,
    operacao: { id: x.operacao_id, nome: x.operacao_nome },
    valor: null,
    lancadoPor: x.criado_por ? { id: x.criado_por, nome: x.criado_por_nome ?? "" } : null,
    situacao: x.decisao === "reprovado" ? "reprovado" as const : "pendente" as const,
    ultimaDecisao: x.decisao && x.decidido_por && x.decidido_em
      ? { decisao: x.decisao, observacao: x.observacao, decididoPor: { id: x.decidido_por, nome: x.decidido_por_nome ?? "" }, decididoEm: x.decidido_em.toISOString() }
      : null,
  }));
  // O ID Global de cada documento (o localizador humano da organização), como nas listas de hoje: uma consulta a
  // mais, fixa, e a marca `idGlobal` que a tela lê para mostrar a coluna (id-global-audit).
  return paginaComIdGlobal(ctx, "documentos_estoque", { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize });
}

// ─────────────── as decisões ───────────────

/**
 * O CABEÇALHO DA APROVAÇÃO, SEM JUNÇÃO: só `erp.documentos_estoque`, só o que a decisão e a situação leem. O RECORTE é
 * o MESMO do `lerDocumentoEstoque` (organização, espécie e escopo de empresa do módulo da rota, pelo `scopedById`):
 * zero linhas é a MESMA 404. `travar`: a TRAVA DA DECISÃO (`for update`) — a confirmação automática, depois, trava o
 * mesmo cabeçalho, já desta transação, e não espera. A situação (F12) lê sem travar.
 */
async function cabecalhoDaAprovacao(ctx: ServiceCtx, id: string, especie: EspecieEstoque, travar: boolean) {
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<{ id: string; situacao: string; empresa_id: string; tipo_operacao_versao_id: string }>(
    `select d.id, d.situacao, d.empresa_id, d.tipo_operacao_versao_id
       from erp.documentos_estoque d
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}${travar ? `
        for update of d` : ""}`, sc.params);
  if (!r.rows[0]) throw notFound("Documento");
  return r.rows[0];
}
const travarDocumento = (ctx: ServiceCtx, id: string, especie: EspecieEstoque) => cabecalhoDaAprovacao(ctx, id, especie, true);

/**
 * DECIDIR — passos 5 a 9 do cabeçalho, dentro da idempotência. Aprovar com TOP automática tenta a confirmação no
 * FIM do caminho (depois da decisão e da auditoria), pela MESMA função do `/confirmar`, com `automatica: true`.
 */
async function decidir(ctx: ServiceCtx, especie: EspecieEstoque, recurso: string, id: string, decisao: Decisao, texto: string | null): Promise<RespostaDaDecisao> {
  const doc = await travarDocumento(ctx, id, especie);
  if (doc.situacao !== "aberto") throw err("CONFLICT", MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO);
  const versaoTop = await lerVersaoCongeladaTop(ctx, doc.tipo_operacao_versao_id);
  const situacao = await situacaoDaAprovacao(ctx, { modulo: "estoque", documentoId: doc.id, versaoDocumento: null, valorDocumento: null, versaoTop });
  if (situacao === "nao_exigida") throw err("APROVACAO_NAO_EXIGIDA", MENSAGEM_APROVACAO_NAO_EXIGIDA);

  const gravada = await registrarDecisao(ctx, { modulo: "estoque", documentoId: doc.id, empresaId: doc.empresa_id, versaoDocumento: null, decisao, observacao: texto });
  await audit(ctx.tx, ctx, "documentos_estoque", doc.id, decisao === "aprovado" ? "approve" : "reject",
    decisao === "aprovado" ? { observacao: texto } : { motivo: texto });
  const corpo: RespostaDaDecisao = { aprovacao: { decisao, decididoEm: gravada.decididoEm } };
  if (decisao !== "aprovado") return corpo;

  const confirmacaoAutomatica = (await confirmaAutomaticamente(ctx, doc.tipo_operacao_versao_id))
    ? await tentarConfirmacaoAutomatica(ctx, {
      permissao: `${recurso}.edit`,
      confirmar: () => confirmarDocumentoEstoqueNaTransacao(ctx, especie, doc.id, { automatica: true }),
    })
    : undefined;
  return confirmacaoAutomatica ? { ...corpo, confirmacaoAutomatica } : corpo;
}

// ─────────────── a situação de UM documento (OPERACOES-01 F12, decisão 282) ───────────────

/**
 * A SITUAÇÃO DA APROVAÇÃO DE UM DOCUMENTO DE ESTOQUE, para a consulta da Central de Estoque. Quem chama já passou pela
 * `<recurso da espécie>.view` (o `runService`, antes de ler qualquer registro). Ordem, a da venda e da compra (279):
 *   1. parâmetro de consulta → 422, antes de qualquer leitura (nunca ignorado);
 *   2. id fora da forma de UUID → a MESMA 404 (o id nunca vai ao SQL: 22P02 seria 500);
 *   3. o cabeçalho pelo recorte do GET por id — outra organização, fora do escopo de empresa do módulo estoque,
 *      inexistente ou de OUTRA espécie: a MESMA 404, com o mesmo corpo;
 *   4. a conta (`respostaDaSituacaoDaAprovacao`): não aberto → `nao_aberto`, sem ler a TOP; aberto → a versão
 *      CONGELADA e a conta das decisões, SEM valor (a política do estoque é só "Sempre"); e a última decisão.
 * Consultas fixas: o cabeçalho + no máximo 1 da versão da TOP + 1 da vigente + 1 da última decisão. Nada é gravado.
 */
async function situacaoDoDocumentoDeEstoque(ctx: ServiceCtx, especie: EspecieEstoque, params: unknown, query: unknown): Promise<RespostaDaSituacaoDaAprovacao> {
  recusarParametrosDaSituacao(query);
  const { id } = params as { id: string };
  if (!FORMA_UUID.test(id)) throw notFound("Documento");
  const doc = await cabecalhoDaAprovacao(ctx, id, especie, false);
  return respostaDaSituacaoDaAprovacao(ctx, {
    modulo: "estoque",
    documentoId: doc.id,
    aberto: doc.situacao === "aberto",
    versaoDocumento: null,
    valorDocumento: null,
    tipoOperacaoVersaoId: doc.tipo_operacao_versao_id,
  });
}

// ─────────────── rotas ───────────────

export default async function aprovacoesEstoqueRoutes(app: FastifyInstance) {
  /**
   * ═══ A FILA ═══ — porta dinâmica (`permission: null`), no desenho da lista única do portal: recorte por
   * capacidade (`<recurso>.approve`) no WHERE antes do LIMIT; nenhuma capacidade → 403; escopo de empresa
   * reaplicado no SQL com o módulo EXPLÍCITO de estoque.
   *
   * Resolvida a porta, o módulo é PUBLICADO na transação e a empresa SELECIONADA é validada
   * (`comPermissaoResolvida`), como o `runService` faz nas filas de venda e de compra e nas decisões do estoque: as
   * quatro espécies caem no MESMO módulo (estoque), então qualquer `.approve` que a pessoa tenha resolve igual. A
   * RLS e o SQL falam do mesmo módulo, e a empresa explicitamente proibida no estoque é 403 aqui também — nunca uma
   * fila vazia que a decisão, com a mesma seleção, recusaria com 403.
   */
  app.get("/aprovacoes/estoque", async (req) => runService(app, req, null, async (ctx) => {
    const aprovaveis = ESPECIES_ESTOQUE.filter((e) => hasPermission(ctx, `${e.recurso}.approve`));
    const [primeira] = aprovaveis;
    if (!primeira) throw denied("entradas_estoque.approve");
    const resolvido = await comPermissaoResolvida(ctx, `${primeira.recurso}.approve`);
    return listarFila(resolvido, aprovaveis.map((e) => e.especie), req.query);
  }));

  for (const { especie, segmento, recurso } of ESPECIES_ESTOQUE) {
    const base = `/aprovacoes/estoque/${segmento}/:id`;

    // A SITUAÇÃO (F12): quem VÊ o documento vê a situação dele; quem DECIDE continua sendo `<recurso>.approve`.
    app.get(base, async (req) => runService(app, req, `${recurso}.view`, (ctx) => situacaoDoDocumentoDeEstoque(ctx, especie, req.params, req.query)));

    app.post(`${base}/aprovar`, async (req) => runService(app, req, `${recurso}.approve`, async (ctx) => {
      const corpo = aprovarSchema.parse(req.body ?? {});
      const { id } = req.params as { id: string };
      if (!FORMA_UUID.test(id)) throw notFound("Documento");
      await lerDocumentoEstoque(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, chaveDeIdempotencia(req.headers["idempotency-key"]),
        { action: "aprovar_documento_estoque", especie, sourceId: id.toLowerCase(), actorId: ctx.user.id, observacao: corpo.observacao },
        () => decidir(ctx, especie, recurso, id, "aprovado", corpo.observacao))).result;
    }));

    app.post(`${base}/reprovar`, async (req) => runService(app, req, `${recurso}.approve`, async (ctx) => {
      const corpo = reprovarSchema.parse(req.body ?? {});
      const { id } = req.params as { id: string };
      if (!FORMA_UUID.test(id)) throw notFound("Documento");
      await lerDocumentoEstoque(ctx, id, especie);
      return (await idempotent(ctx.tx, ctx.orgId, chaveDeIdempotencia(req.headers["idempotency-key"]),
        { action: "reprovar_documento_estoque", especie, sourceId: id.toLowerCase(), actorId: ctx.user.id, motivo: corpo.motivo },
        () => decidir(ctx, especie, recurso, id, "reprovado", corpo.motivo))).result;
    }));
  }
}
