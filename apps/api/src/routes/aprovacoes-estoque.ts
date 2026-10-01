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
 *     tem; nenhuma → 403 ("lista vazia" nunca é "todas"). O molde é a lista única do portal (`estoque-documentos.ts`).
 *   · POST /aprovacoes/estoque/<segmento>/:id/aprovar  {observacao?} e /reprovar {motivo} → uma rota por espécie,
 *     com `<recurso da espécie>.approve`; o segmento na URL é a porta, e o documento de OUTRA espécie é a mesma 404.
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
import { runService, idempotent, audit } from "../lib/service.js";
import { err, denied, notFound, validation } from "../lib/errors.js";
import { empresaScope, hasPermission, scopedById, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { registrarDecisao, situacaoDaAprovacao } from "../lib/aprovacao-documento.js";
import {
  confirmaAutomaticamente, lerVersaoCongeladaTop, tentarConfirmacaoAutomatica, type ResultadoConfirmacaoAutomatica,
} from "../lib/confirmacao-automatica.js";
import { ESPECIES_ESTOQUE, FORMA_UUID, lerDocumentoEstoque } from "./estoque-comum.js";
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

/**
 * A FILA DO ESTOQUE — os documentos ABERTOS das espécies que a pessoa aprova, cuja versão CONGELADA exige aprovação
 * e cuja última decisão não é "aprovado" (pendentes e reprovados), no escopo de empresa do módulo estoque.
 *
 * A espécie entra no WHERE ANTES do LIMIT (recorte de autorização, nunca filtro sobre o resultado), e o escopo de
 * empresa é aplicado no SQL com o módulo EXPLÍCITO (a porta é dinâmica, e o módulo não vem dela). A última decisão
 * sai de um `lateral` pelo índice (organização, documento, id desc), amarrada à empresa do documento pela PRÓPRIA
 * coluna. Número FIXO de consultas — contagem e página —, qualquer que seja o tamanho da página.
 */
async function listarFila(ctx: ServiceCtx, especies: readonly EspecieEstoque[], query: unknown) {
  const bruta = (query ?? {}) as Record<string, unknown>;
  // Parâmetro repetido chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  for (const [chave, valor] of Object.entries(bruta)) {
    if (Array.isArray(valor)) throw validation("Parâmetro repetido: informe um valor só", [{ path: chave, message: "Parâmetro repetido: informe um valor só" }]);
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
  if (q.search) { params.push(`%${q.search}%`); where.push(`d.codigo ilike $${params.length}`); }
  // Como a lista única do portal: a empresa SELECIONADA não recorta; a autorização entra sempre.
  where.push(...empresaScope(ctx, "d", params, { ignoreSelected: true, modulo: MODULO_ESTOQUE }));

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
 * A TRAVA DA DECISÃO, SEM JUNÇÃO: só `erp.documentos_estoque`, só o que a decisão lê. O RECORTE é o MESMO do
 * `lerDocumentoEstoque` (organização, espécie e escopo de empresa do módulo da rota, pelo `scopedById`): zero linhas
 * é a MESMA 404. A confirmação automática, depois, trava o mesmo cabeçalho — já é desta transação, não espera.
 */
async function travarDocumento(ctx: ServiceCtx, id: string, especie: EspecieEstoque) {
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<{ id: string; situacao: string; empresa_id: string; tipo_operacao_versao_id: string }>(
    `select d.id, d.situacao, d.empresa_id, d.tipo_operacao_versao_id
       from erp.documentos_estoque d
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}
        for update of d`, sc.params);
  if (!r.rows[0]) throw notFound("Documento");
  return r.rows[0];
}

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

// ─────────────── rotas ───────────────

export default async function aprovacoesEstoqueRoutes(app: FastifyInstance) {
  /**
   * ═══ A FILA ═══ — porta dinâmica (`permission: null`), no desenho da lista única do portal: recorte por
   * capacidade (`<recurso>.approve`) no WHERE antes do LIMIT; nenhuma capacidade → 403; escopo de empresa
   * reaplicado no SQL com o módulo EXPLÍCITO de estoque.
   */
  app.get("/aprovacoes/estoque", async (req) => runService(app, req, null, async (ctx) => {
    const permitidas = ESPECIES_ESTOQUE.filter((e) => hasPermission(ctx, `${e.recurso}.approve`)).map((e) => e.especie);
    if (permitidas.length === 0) throw denied("entradas_estoque.approve");
    return listarFila(ctx, permitidas, req.query);
  }));

  for (const { especie, segmento, recurso } of ESPECIES_ESTOQUE) {
    const base = `/aprovacoes/estoque/${segmento}/:id`;

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
