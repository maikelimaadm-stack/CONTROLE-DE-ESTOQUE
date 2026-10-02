/**
 * ═══ APROVAÇÕES DE COMPRA (TOP-CONFIG-08, decisão 277; OPERACOES-01 F2, decisão 279) ═══
 *
 * A compra cuja versão congelada da TOP está no FORMATO 4 e exige aprovação (Sempre, ou A partir de um valor com o
 * `valor_total` ATUAL ≥ o mínimo) só confirma depois de aprovada. Este arquivo é a porta de quem APROVA: a fila e as
 * duas decisões, sob `compras.approve`. Quem EXPLICA a recusa na confirmação é o passo do planejamento
 * (`compras-confirmacao.ts`); quem BARRA no fundo é a guarda de transição da 0041 (`trg_documentos_compra_aprovacao`).
 *
 * E a quarta rota, de LEITURA (F2, decisão 279): `GET /api/aprovacoes/compras/:id` → `{ situacao, ultimaDecisao }` de
 * UMA compra, para a consulta da Central de Compras (o contrato em `aprovacoes-situacao.ts`). Fica em `compras.view`:
 * quem vê o documento vê a situação dele (a prévia do Confirmar já a dizia sob a mesma capacidade); quem DECIDE
 * continua sendo `compras.approve`. Ordem das recusas: 403 sem `compras.view` (o `runService`, antes de qualquer
 * leitura) → 422 parâmetro de consulta (qualquer um) → a MESMA 404 do `GET /api/compras/compras/:id` (a mesma
 * leitura, `lerDocumentoCompra`: id fora da forma, inexistente, outra organização, fora do escopo do módulo compras,
 * pedido de compra). Só leitura, consultas fixas.
 *
 * PREFIXO PRÓPRIO (`/api/aprovacoes/...`): o binário anterior não conhece a rota e responde o 404 limpo de rota
 * inexistente — a tela nova lê esse 404 como "aprovações indisponíveis neste servidor", sem quebrar o resto.
 *
 * ┌─ O MODELO ─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ `erp.aprovacoes_compra`: uma linha por DECISÃO, só inserção (sem UPDATE e sem DELETE). A compra não tem   │
 * │ edição, então a decisão VIGENTE é a última (id desc), e vale enquanto o documento estiver aberto. A fatia │
 * │ que um dia criar edição de compra terá de invalidar a aprovação (a venda faz isso pela versão).           │
 * │ Reprovada pode ser aprovada depois por uma decisão nova; a história fica.                                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A ORDEM DO APROVAR E DO REPROVAR (o molde do PATCH da venda) ─────────────────────────────────────────┐
 * │ 0. a CAPACIDADE `compras.approve` (a porta do `runService`) → 403, antes de ler o corpo;                  │
 * │ 1. o CORPO estrito → 422, antes de ler qualquer registro e de reservar a chave;                         │
 * │ 2. id fora da forma de UUID → a MESMA 404 do GET (e não o 500 do 22P02);                                │
 * │ 3. documento invisível — outra organização, fora do escopo de empresa, inexistente, ou de uma espécie que │
 * │    o usuário não aprova (o pedido sem `pedidos_compra.approve`, o orçamento) → a MESMA 404 do GET por id  │
 * │    (`lerDocumentoCompra`), ANTES da idempotência: o replay devolveria o corpo gravado sem passar pelo     │
 * │    recorte de empresa;                                                                                   │
 * │ 4. a IDEMPOTÊNCIA (`Idempotency-Key`; ação, documento, texto e AUTOR no hash): o reenvio devolve o corpo │
 * │    gravado — a decisão e o resultado da confirmação automática — e nunca decide nem confirma duas vezes; │
 * │ 5. a TRAVA do documento, `for update` SEM junção: é ela que impede duas decisões e a confirmação de se    │
 * │    cruzarem, e que dá a ordem das decisões. Zero linhas → a mesma 404;                                   │
 * │ 6. documento que não está aberto → 409 CONFLICT "Só documento aberto passa por aprovação.";             │
 * │ 7. documento que não exige aprovação (formato 1 a 3, ou formato 4 cuja política, com o total ATUAL, não   │
 * │    exige) → 409 APROVACAO_NAO_EXIGIDA "Este documento não precisa de aprovação.";                         │
 * │ 8. grava a decisão (`registrarDecisao`; o gatilho da 0041 confere tudo de novo e ATRIBUI TOP, versão,     │
 * │    valor, autor e momento a partir do documento) e a auditoria no documento ("approve" | "reject");      │
 * │ 9. APROVAR com TOP de Confirmação Automática: a confirmação automática, no fim, pelo molde de todos os     │
 * │    caminhos que gravam — num savepoint, chamando a MESMA confirmação do POST /confirm. Quem confirma é o  │
 * │    APROVADOR, com a capacidade de confirmar DELE (`compras.edit`): sem ela, aprovado e aberto, motivo     │
 * │    "sem_permissao". A TOP nunca dá a ninguém um poder que ele não tem.                                    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ORDEM DAS TRAVAS: chave de idempotência → documento (`for update`) → [confirmação automática: o documento de
 * novo (já é desta transação) → contador do ID Global → saldo/produto]. É a ordem da confirmação manual
 * (`compras-confirmacao.ts`). Compra e estoque: sem ciclo entre si; possível com a confirmação MANUAL de VENDA do
 * mesmo produto (40P01), que trava saldo e produto (`postStock`) e só depois o contador (`createTitles`) — o ciclo
 * que a confirmação manual da compra já tinha, sem ciclo novo. Desfecho do CA-12: a automática que perde vira
 * "recusada" (a compra aprovada, salva e aberta, CONCURRENCY_CONFLICT), ou a manual da venda recebe o 409 de hoje.
 *
 * A FILA (`GET /aprovacoes/compras`): compras ABERTAS que exigem aprovação pela versão congelada e o total ATUAL
 * (`erp.top_exige_aprovacao`, a MESMA conta do domínio, provada por paridade) e cuja última decisão NÃO é
 * "aprovado" — pendentes e reprovadas —, no escopo de empresa de quem aprova (o módulo compras, pela permissão da
 * rota; a empresa selecionada só DIMINUI o recorte, como no GET por id que o Aprovar usa). Paginação, ordem e
 * filtro no servidor; DUAS consultas por página (total e página), nunca uma por linha. Parâmetro que não seja
 * `page`/`pageSize` é 422: um filtro descartado em silêncio mostraria mais do que foi pedido.
 *
 * ┌─ OPERACOES-01 F6a (decisão 283) — O PEDIDO DE COMPRA NA FILA ────────────────────────────────────────────┐
 * │ O pedido é aprovado ao FINALIZAR (`compras-finalizacao.ts`; a guarda da 0044 barra no banco). A porta     │
 * │ continua `compras.approve` (as rotas e a tela da base não mudam); a ESPÉCIE pedido exige também           │
 * │ `pedidos_compra.approve` (AND). Quem não aprova pedido não vê a linha, e o Aprovar/Reprovar no id dele dá │
 * │ a MESMA 404 de inexistente. A fila lista também a aprovação que deixou de COBRIR o documento (valor atual │
 * │ acima do aprovado, ou outra versão da TOP) — a mesma conta da guarda: o pedido muda de valor quando o     │
 * │ orçamento vencedor é escolhido. A confirmação automática depois do aprovar continua só da COMPRA.          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { FORMA_UUID_PADRAO, MENSAGEM_APROVACAO_NAO_EXIGIDA, MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO, moduloDaPermissao } from "@agro/domain";
import { runService, idempotent, audit } from "../lib/service.js";
import { notFound, err } from "../lib/errors.js";
import { empresaScope, scopedById, hasPermission, type ServiceCtx } from "../lib/context.js";
import { pageQuerySchema } from "../lib/pagination.js";
import { situacaoDaAprovacao, registrarDecisao } from "../lib/aprovacao-documento.js";
import { confirmaAutomaticamente, tentarConfirmacaoAutomatica, lerVersaoCongeladaTop, type ResultadoConfirmacaoAutomatica } from "../lib/confirmacao-automatica.js";
import { lerDocumentoCompra } from "./compras.js";
import { recusarParametrosDaSituacao, respostaDaSituacaoDaAprovacao, type RespostaDaSituacaoDaAprovacao } from "./aprovacoes-situacao.js";
import { confirmarCompraNaTransacao } from "./compras-confirmacao.js";
import { paginaComIdGlobal } from "../lib/id-global.js";

/** A capacidade da porta: decidir a aprovação da compra. A confirmação automática pede a DELA (`compras.edit`). */
const PERMISSAO_APROVAR = "compras.approve";
const PERMISSAO_CONFIRMAR = "compras.edit";
/** A capacidade da leitura da situação (F2): a MESMA do GET da compra por id. */
const PERMISSAO_VER = "compras.view";

/** OPERACOES-01 F6a: a capacidade da ESPÉCIE pedido, somada (AND) à da porta. */
const PERMISSAO_APROVAR_PEDIDO = "pedidos_compra.approve";

/** As espécies de documento de compra que passam por aprovação. O orçamento de compra não passa. */
type EspecieAprovavel = "compra" | "pedido";

/**
 * As espécies que ESTE usuário aprova: a compra, pela porta (`compras.approve`); o pedido, só com
 * `pedidos_compra.approve` também. Fail-closed: sem a segunda, o pedido não existe para ele aqui.
 */
const especiesQueAprova = (ctx: ServiceCtx): EspecieAprovavel[] =>
  hasPermission(ctx, PERMISSAO_APROVAR_PEDIDO) ? ["compra", "pedido"] : ["compra"];

// ─────────────── contrato de entrada (estrito) ───────────────

/**
 * Aprovar: observação opcional (ausente, `null` ou vazia → `null`), até 500. Reprovar: motivo obrigatório, de 1 a 500
 * (o CHECK da 0041 exige o motivo não vazio na reprovação). `.strict()`: chave desconhecida é 422 — nunca descartada.
 */
const aprovarSchema = z.object({
  observacao: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
}).strict();
const reprovarSchema = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

const recusa = (path: string, message: string) => err("VALIDATION_ERROR", message, [{ path, message }]);

/** A fila aceita só a paginação: o que vier além é 422 no parâmetro (nunca "ignorado"). */
const PARAMETROS_DA_FILA = new Set(["page", "pageSize"]);

// ─────────────── a fila ───────────────

/** Uma linha da fila (o corpo que a tela de Aprovações consome). `version` só existe na venda. */
type LinhaDaFilaCompra = {
  id: string; codigo: string; especie: EspecieAprovavel; data: string;
  empresa: { id: string; nome: string };
  parceiro: { id: string; nome: string } | null;
  operacao: { id: string; nome: string };
  valor: string | null;
  lancadoPor: { id: string; nome: string } | null;
  situacao: "pendente" | "reprovado";
  ultimaDecisao: { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string } | null;
};

interface LinhaLida {
  id: string; codigo: string; especie: EspecieAprovavel; data: string; empresa_id: string; empresa_nome: string;
  fornecedor_id: string; fornecedor_nome: string | null; tipo_operacao_id: string; operacao_nome: string;
  valor: string; criado_por: string | null; lancado_por_nome: string | null;
  ud_decisao: "aprovado" | "reprovado" | null; ud_observacao: string | null; ud_decidido_por: string | null;
  ud_decidido_por_nome: string | null; ud_decidido_em: Date | null;
}

async function listarFila(ctx: ServiceCtx, query: unknown) {
  const bruta = (query ?? {}) as Record<string, unknown>;
  // Parâmetro repetido chega como lista: 422 no parâmetro, nunca 500 (e nunca "o primeiro vale").
  for (const [chave, valor] of Object.entries(bruta)) {
    if (Array.isArray(valor)) throw recusa(chave, "Parâmetro repetido: informe um valor só");
    if (!PARAMETROS_DA_FILA.has(chave)) throw recusa(chave, "Parâmetro não reconhecido na fila de aprovações");
  }
  const q = pageQuerySchema.parse(bruta);
  const params: unknown[] = [ctx.orgId, especiesQueAprova(ctx)];
  const where = [
    // OPERACOES-01 F6a: as espécies que o usuário aprova (o pedido só com `pedidos_compra.approve`), antes do LIMIT.
    "d.organization_id = $1", "d.especie = any($2::text[])", "d.situacao = 'aberto'",
    // A MESMA conta da confirmação: versão congelada no formato 4 ou 5 e política que exige com o total ATUAL.
    "erp.top_exige_aprovacao(v.configuracao, d.valor_total)",
    // Sem decisão, ou a última é uma reprovação: pendente ou reprovado. A aprovada sai da fila — enquanto COBRE o
    // documento (OPERACOES-01 F6a, a conta da guarda da 0041/0044): valor aprovado ≥ o total atual e a mesma versão
    // da TOP. Na compra a aprovação sempre cobre (sem edição, valor e versão não mudam); no pedido, o vencedor do
    // orçamento muda o valor, e a aprovação que deixou de cobrir volta para a fila como pendente.
    `(ud.decisao is null or ud.decisao <> 'aprovado'
      or ud.valor_documento < d.valor_total or ud.tipo_operacao_versao_id is distinct from d.tipo_operacao_versao_id)`,
  ];
  // Escopo de empresa de quem aprova, no SQL e antes do LIMIT (recorte de autorização, nunca filtro sobre o resultado).
  where.push(...empresaScope(ctx, "d", params, { modulo: moduloDaPermissao(PERMISSAO_APROVAR) }));

  // A última decisão por documento numa lateral (o índice (organization_id, documento_id, id desc) responde cada uma
  // com uma leitura): é ela que decide se a linha entra, então vale para o total e para a página. A decisão responde
  // pela PRÓPRIA coluna de empresa, amarrada à do documento (que já passou pelo escopo acima).
  const de = `from erp.documentos_compra d
              join erp.tipos_operacao_versoes v on v.id = d.tipo_operacao_versao_id and v.organization_id = d.organization_id
              join erp.empresas e on e.id = d.empresa_id and e.organization_id = d.organization_id
              left join erp.people fo on fo.id = d.fornecedor_id and fo.organization_id = d.organization_id
              left join erp.users ul on ul.id = d.criado_por
              left join lateral (
                select a.decisao, a.observacao, a.decidido_por, a.decidido_em, a.valor_documento, a.tipo_operacao_versao_id
                  from erp.aprovacoes_compra a
                 where a.organization_id = d.organization_id and a.documento_id = d.id and a.empresa_id = d.empresa_id
                 order by a.id desc
                 limit 1) ud on true
              left join erp.users ud_u on ud_u.id = ud.decidido_por
             where ${where.join(" and ")}`;
  const total = await ctx.tx.query<{ n: string }>(`select count(*)::text n ${de}`, params);
  const r = await ctx.tx.query<LinhaLida>(
    `select d.id, d.codigo, d.especie, to_char(d.data_documento, 'YYYY-MM-DD') as data, d.empresa_id, e.name as empresa_nome,
            d.fornecedor_id, fo.name as fornecedor_nome, d.tipo_operacao_id, v.nome as operacao_nome,
            d.valor_total::text as valor, d.criado_por, ul.name as lancado_por_nome,
            ud.decisao as ud_decisao, ud.observacao as ud_observacao, ud.decidido_por as ud_decidido_por,
            ud_u.name as ud_decidido_por_nome, ud.decidido_em as ud_decidido_em
       ${de}
      order by d.data_documento desc, d.created_at desc, d.id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`, params);
  const items: LinhaDaFilaCompra[] = r.rows.map((l) => ({
    id: l.id, codigo: l.codigo, especie: l.especie, data: l.data,
    empresa: { id: l.empresa_id, nome: l.empresa_nome },
    parceiro: l.fornecedor_nome !== null ? { id: l.fornecedor_id, nome: l.fornecedor_nome } : null,
    operacao: { id: l.tipo_operacao_id, nome: l.operacao_nome },
    valor: l.valor,
    lancadoPor: l.criado_por && l.lancado_por_nome !== null ? { id: l.criado_por, nome: l.lancado_por_nome } : null,
    situacao: l.ud_decisao === "reprovado" ? "reprovado" : "pendente",
    ultimaDecisao: l.ud_decisao && l.ud_decidido_por && l.ud_decidido_em
      ? { decisao: l.ud_decisao, observacao: l.ud_observacao, decididoPor: { id: l.ud_decidido_por, nome: l.ud_decidido_por_nome ?? "" },
          decididoEm: l.ud_decidido_em.toISOString() }
      : null,
  }));
  // O ID Global de cada documento (o localizador humano da organização), como nas listas de hoje: uma consulta a
  // mais, fixa, e a marca `idGlobal` que a tela lê para mostrar a coluna (id-global-audit).
  return paginaComIdGlobal(ctx, "documentos_compra", { items, total: Number(total.rows[0]!.n), page: q.page, pageSize: q.pageSize });
}

// ─────────────── a decisão ───────────────

/**
 * A TRAVA DA DECISÃO, SEM JUNÇÃO: só `erp.documentos_compra`, só o que a decisão lê. Uma junção seria reavaliada
 * contra a foto nova por quem espera a trava (READ COMMITTED) e poderia sumir com a linha — "não existe" sobre um
 * documento que só mudou. O RECORTE é o mesmo do GET por id (organização, espécie e escopo de empresa): zero
 * linhas é a MESMA 404.
 *
 * OPERACOES-01 F6a: a espécie é a que `especieDaDecisao` achou (compra ou pedido), no WHERE como antes.
 */
async function travarCompraDaDecisao(ctx: ServiceCtx, id: string, especie: EspecieAprovavel) {
  const sc = scopedById(ctx, "d", id); sc.params.push(especie);
  const r = await ctx.tx.query<{ id: string; situacao: string; empresa_id: string; valor_total: string; tipo_operacao_versao_id: string | null }>(
    `select d.id, d.situacao, d.empresa_id, d.valor_total::text as valor_total, d.tipo_operacao_versao_id
       from erp.documentos_compra d
      where d.id = $1 and d.organization_id = $2 and d.especie = $${sc.params.length}${sc.sql}
        for update of d`, sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  return linha;
}

/**
 * OPERACOES-01 F6a — A ESPÉCIE DO DOCUMENTO DA DECISÃO, procurada SÓ entre as que o usuário aprova
 * (`especiesQueAprova`), com o recorte do GET por id (organização e escopo de empresa). Fora delas (o pedido para
 * quem não tem `pedidos_compra.approve`, o orçamento para todos), inexistente, de outro tenant ou fora do escopo: a
 * MESMA 404 — dizer "é um pedido, e você não o aprova" seria oráculo de existência.
 */
async function especieDaDecisao(ctx: ServiceCtx, id: string): Promise<EspecieAprovavel> {
  const sc = scopedById(ctx, "d", id); sc.params.push(especiesQueAprova(ctx));
  const r = await ctx.tx.query<{ especie: EspecieAprovavel }>(
    `select d.especie from erp.documentos_compra d
      where d.id = $1 and d.organization_id = $2 and d.especie = any($${sc.params.length}::text[])${sc.sql}`, sc.params);
  const linha = r.rows[0];
  if (!linha) throw notFound("Documento");
  return linha.especie;
}

type Decisao = "aprovado" | "reprovado";
interface RespostaDaDecisao {
  aprovacao: { decisao: Decisao; decididoEm: string };
  confirmacaoAutomatica?: ResultadoConfirmacaoAutomatica;
}

async function decidir(app: FastifyInstance, req: FastifyRequest, decisao: Decisao): Promise<RespostaDaDecisao> {
  return runService(app, req, PERMISSAO_APROVAR, async (ctx) => {
    // 1. o corpo, antes de qualquer leitura de registro e antes da chave.
    // O texto da decisão vai para a MESMA coluna (`observacao`): a observação da aprovação ou o motivo da reprovação.
    const observacao = decisao === "aprovado" ? aprovarSchema.parse(req.body ?? {}).observacao : reprovarSchema.parse(req.body ?? {}).motivo;
    const bruto = (req.params as { id: string }).id;
    // 2. id malformado é inexistente: a MESMA 404.
    if (!FORMA_UUID_PADRAO.test(bruto)) throw notFound("Documento");
    // O id CANÔNICO, em minúsculas (o molde da venda): a forma aceita maiúsculas, e o MESMO documento escrito de dois
    // jeitos seria dois `sourceId` no hash da idempotência e dois `entity_id` (texto) na trilha do documento.
    const id = bruto.toLowerCase();
    // 3. invisível (outra organização, fora do escopo, inexistente, espécie que o usuário não aprova — o pedido sem
    // `pedidos_compra.approve`, o orçamento): a MESMA 404 do GET por id. OPERACOES-01 F6a: a espécie é procurada só
    // entre as que ele aprova, e a leitura de visibilidade é a da espécie achada.
    const especie = await especieDaDecisao(ctx, id);
    await lerDocumentoCompra(ctx, id, especie);
    // 4. a idempotência — com o AUTOR no hash: chave alheia nunca devolve a resposta de outro. A espécie entra no
    // hash SÓ no pedido: o da compra fica idêntico ao de antes (a chave de um reenvio do cliente da base continua valendo).
    const texto = decisao === "aprovado" ? { observacao } : { motivo: observacao };
    return (await idempotent(ctx.tx, ctx.orgId, req.headers["idempotency-key"] as string | undefined,
      { action: decisao === "aprovado" ? "aprovar_documento_compra" : "reprovar_documento_compra", sourceId: id, ...texto, actorId: ctx.user.id,
        ...(especie === "pedido" ? { especie } : {}) },
      async (): Promise<RespostaDaDecisao> => {
        // 5. a trava do documento: serializa as decisões entre si e com a confirmação. Daqui em diante, o id é o
        // que o BANCO devolveu (`doc.id`): a decisão, a trilha e a confirmação falam do documento lido.
        const doc = await travarCompraDaDecisao(ctx, id, especie);
        // 6. só documento aberto passa por aprovação.
        if (doc.situacao !== "aberto") throw err("CONFLICT", MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO);
        // 7. exige aprovação? A versão congelada e o total ATUAL, pela mesma regra da confirmação.
        const versaoTop = await lerVersaoCongeladaTop(ctx, doc.tipo_operacao_versao_id);
        const situacao = await situacaoDaAprovacao(ctx,
          { modulo: "compras", documentoId: doc.id, versaoDocumento: null, valorDocumento: doc.valor_total, versaoTop });
        if (situacao === "nao_exigida") throw err("APROVACAO_NAO_EXIGIDA", MENSAGEM_APROVACAO_NAO_EXIGIDA);
        // 8. a decisão e a auditoria no documento.
        const registro = await registrarDecisao(ctx,
          { modulo: "compras", documentoId: doc.id, empresaId: doc.empresa_id, versaoDocumento: null, decisao, observacao });
        await audit(ctx.tx, ctx, "documentos_compra", doc.id, decisao === "aprovado" ? "approve" : "reject", texto);
        const corpo: RespostaDaDecisao = { aprovacao: { decisao, decididoEm: registro.decididoEm } };
        // OPERACOES-01 F6a: o PEDIDO aprovado não se finaliza sozinho — finalizar é um ato de quem lança o pedido.
        if (decisao !== "aprovado" || especie !== "compra") return corpo;
        // 9. aprovada com Confirmação Automática: confirma no fim, pelo aprovador, com a capacidade DELE.
        const confirmacaoAutomatica = (await confirmaAutomaticamente(ctx, doc.tipo_operacao_versao_id))
          ? await tentarConfirmacaoAutomatica(ctx, { permissao: PERMISSAO_CONFIRMAR, confirmar: () => confirmarCompraNaTransacao(app, ctx, doc.id, { automatica: true }) })
          : undefined;
        return confirmacaoAutomatica ? { ...corpo, confirmacaoAutomatica } : corpo;
      })).result;
  });
}

// ─────────────── a situação de UMA compra (F2, decisão 279) ───────────────

/**
 * A SITUAÇÃO DA APROVAÇÃO DE UMA COMPRA, para a consulta da Central de Compras. Quem chama já passou pelo
 * `compras.view`. O documento é achado pela MESMA leitura do GET por id (`lerDocumentoCompra`, espécie `compra`), que
 * já recusa o id fora da forma e aplica organização, escopo de empresa e espécie: a 404 é a mesma, com o mesmo corpo.
 * A compra não tem versão do documento: a decisão vigente é a última (a régua de `situacaoDaAprovacao`).
 */
async function situacaoDaCompra(ctx: ServiceCtx, params: unknown, query: unknown): Promise<RespostaDaSituacaoDaAprovacao> {
  // 1. Parâmetro de consulta: 422, antes de qualquer leitura (nunca ignorado).
  recusarParametrosDaSituacao(query);
  // 2 e 3. Forma do id e visibilidade — a leitura do GET por id, com o id como ele o recebe.
  const doc = await lerDocumentoCompra(ctx, (params as { id: string }).id, "compra");
  // 4. A conta (o contrato em `aprovacoes-situacao.ts`).
  return respostaDaSituacaoDaAprovacao(ctx, {
    modulo: "compras",
    documentoId: String(doc["id"]),
    aberto: doc["situacao"] === "aberto",
    versaoDocumento: null,
    valorDocumento: String(doc["valor_total"]),
    tipoOperacaoVersaoId: typeof doc["tipo_operacao_versao_id"] === "string" ? doc["tipo_operacao_versao_id"] : null,
  });
}

// ─────────────── rotas ───────────────

export default async function aprovacoesComprasRoutes(app: FastifyInstance) {
  /**
   * A FILA: compras (e, para quem aprova pedido, pedidos de compra) abertas que aguardam aprovação ou foram
   * reprovadas, no escopo de quem aprova.
   */
  app.get("/aprovacoes/compras", async (req) => runService(app, req, PERMISSAO_APROVAR, (ctx) => listarFila(ctx, req.query)));

  /** APROVAR `{ observacao? }` — e, com Confirmação Automática, confirmar no mesmo pedido. */
  app.post("/aprovacoes/compras/:id/aprovar", async (req) => decidir(app, req, "aprovado"));

  /** REPROVAR `{ motivo }` — a compra fica aberta; uma aprovação nova, depois, a libera. */
  app.post("/aprovacoes/compras/:id/reprovar", async (req) => decidir(app, req, "reprovado"));

  /** A SITUAÇÃO da aprovação de UMA compra: leitura sob `compras.view` (quem vê o documento vê a situação). */
  app.get("/aprovacoes/compras/:id", async (req) => runService(app, req, PERMISSAO_VER, (ctx) => situacaoDaCompra(ctx, req.params, req.query)));
}
