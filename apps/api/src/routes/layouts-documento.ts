import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FAMILIAS_COM_LAYOUT, LAYOUT_DO_SISTEMA, familiaTemLayout, validarEstruturaLayout, type EstruturaLayout } from "@agro/domain";
import { runService, audit, nextCode } from "../lib/service.js";
import { notFound, validation } from "../lib/errors.js";
import type { ServiceCtx } from "../lib/context.js";
import { layoutEfetivo } from "../lib/layout-documento.js";

/**
 * LAYOUT DO DOCUMENTO POR TOP (VENDAS-A3-1) — administração.
 *
 * Recurso de ORGANIZAÇÃO (sem empresa_id), administrado com as MESMAS capacidades da TOP (`tipos_operacao.*`):
 * o layout é configuração da TOP. A conta (catálogo, validação da estrutura, layout do sistema) mora no domínio
 * (`packages/domain/src/layout-documento.ts`); aqui só a forma do JSON é conferida antes de entregar ao domínio,
 * para que um tipo errado seja 422 e não uma exceção.
 *
 * SUPERFÍCIE DE RECUSA: inexistente, de outra organização ou excluído → a MESMA 404 (a consulta filtra por
 * organização e `deleted_at is null` antes de decidir). Toda gravação confere ROW COUNT.
 */

const LIMITE_ESTRUTURA = 65536;
const familiaSchema = z.enum(FAMILIAS_COM_LAYOUT);
const nomeSchema = z.string().trim().min(1).max(120);

/** Forma da EstruturaLayout v1 (só tipos; as regras são do domínio). Strict: chave desconhecida é 422. */
const valorPadraoSchema = z.union([
  z.object({ tipo: z.literal("literal"), valor: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
  z.object({ tipo: z.literal("variavel"), variavel: z.enum(["data_atual", "empresa_selecionada"]) }).strict()
]);
const campoSchema = z.object({
  campo: z.string().min(1).max(80), rotulo: z.string().max(120).optional(), obrigatorio: z.boolean(), editavel: z.boolean(),
  valorPadrao: valorPadraoSchema.optional()
}).strict();
const estruturaSchema = z.object({
  versaoSchema: z.literal(1),
  cabecalho: z.array(campoSchema).max(200),
  rodape: z.array(z.object({ aba: z.string().min(1).max(80), campos: z.array(campoSchema).max(200) }).strict()).max(50),
  itens: z.array(z.object({ campo: z.string().min(1).max(80), rotulo: z.string().max(120).optional(), obrigatorio: z.boolean() }).strict()).max(200)
}).strict();

const criarSchema = z.object({ nome: nomeSchema, familia: familiaSchema, estrutura: z.unknown().optional() }).strict();
const editarSchema = z.object({ nome: nomeSchema.optional(), estrutura: z.unknown().optional() }).strict();
const ativoSchema = z.object({ ativo: z.boolean() }).strict();
const topsSchema = z.object({ tipoOperacaoIds: z.array(z.string().uuid()).max(500) }).strict();
const listaSchema = z.object({ familia: familiaSchema.optional() }).strict();
const idSchema = z.object({ id: z.string() }).strict();
const efetivoSchema = z.object({ tipoOperacaoId: z.string() }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estrutura → EstruturaLayout validada (forma + regras do domínio), ou 422 com details [{path, message}]. */
function estruturaValida(familia: string, bruta: unknown): EstruturaLayout {
  const forma = estruturaSchema.safeParse(bruta);
  if (!forma.success) {
    const details = forma.error.issues.map((i) => ({ path: ["estrutura", ...i.path].join("."), message: i.message }));
    throw validation(details.length === 1 ? `${details[0]!.path}: ${details[0]!.message}` : "Estrutura do layout inválida", details);
  }
  const estrutura = forma.data as EstruturaLayout;
  const erros = validarEstruturaLayout(familia, estrutura);
  if (erros.length) {
    const details = erros.map((e) => ({ path: e.caminho, message: e.mensagem }));
    throw validation(details.length === 1 ? `${details[0]!.path}: ${details[0]!.message}` : "Estrutura do layout inválida", details);
  }
  if (JSON.stringify(estrutura).length > LIMITE_ESTRUTURA) {
    throw validation("Estrutura do layout grande demais", [{ path: "estrutura", message: "A estrutura excede 64 KiB." }]);
  }
  return estrutura;
}

interface LinhaLayout { id: string; code: string; nome: string; familia: string; padrao: boolean; is_active: boolean; estrutura: EstruturaLayout; created_at: string; updated_at: string }

async function lerLayout(ctx: ServiceCtx, id: string, travar = false): Promise<LinhaLayout> {
  if (!UUID.test(id)) throw notFound("Layout");
  const r = await ctx.tx.query<LinhaLayout>(
    `select id, code, nome, familia, padrao, is_active, estrutura, created_at, updated_at from erp.layouts_documento
      where id=$1 and organization_id=$2 and deleted_at is null${travar ? " for update" : ""}`, [id, ctx.orgId]);
  if (!r.rows[0]) throw notFound("Layout");
  return r.rows[0];
}

async function topsLigadas(ctx: ServiceCtx, layoutId: string) {
  const r = await ctx.tx.query<{ id: string; codigo: string; nome: string }>(
    `select t.id, t.codigo, v.nome
       from erp.layout_documento_tops l
       join erp.tipos_operacao t on t.id = l.tipo_operacao_id and t.organization_id = l.organization_id
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
      where l.organization_id=$1 and l.layout_id=$2 and t.excluido_em is null
      order by t.codigo`, [ctx.orgId, layoutId]);
  return r.rows;
}

const paraTela = (l: LinhaLayout) => ({ id: l.id, code: l.code, nome: l.nome, familia: l.familia, padrao: l.padrao, is_active: l.is_active, created_at: l.created_at, updated_at: l.updated_at });

async function gerarCodigo(ctx: ServiceCtx): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const codigo = await nextCode(ctx.tx, ctx.orgId, "layout_documento");
    const usado = await ctx.tx.query("select 1 from erp.layouts_documento where organization_id=$1 and code=$2", [ctx.orgId, codigo]);
    if (!usado.rowCount) return codigo;
  }
  throw validation("Não foi possível gerar o código do layout.");
}

async function nomeDeCopiaLivre(ctx: ServiceCtx, nome: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidato = `${nome} (cópia${n > 1 ? ` ${n}` : ""})`;
    const r = await ctx.tx.query("select 1 from erp.layouts_documento where organization_id=$1 and lower(nome)=lower($2) and deleted_at is null", [ctx.orgId, candidato]);
    if (!r.rowCount) return candidato;
  }
  throw validation("Não foi possível gerar o nome da cópia.");
}

/** Tira o padrão de quem o ocupa na família (mesma transação), e audita quem perdeu. */
async function liberarPadrao(ctx: ServiceCtx, familia: string, exceto: string, novoPadraoId: string | null) {
  const r = await ctx.tx.query<{ id: string; code: string }>(
    `update erp.layouts_documento set padrao=false
      where organization_id=$1 and familia=$2 and padrao and deleted_at is null and id <> $3 returning id, code`,
    [ctx.orgId, familia, exceto]);
  for (const x of r.rows) await audit(ctx.tx, ctx, "layouts_documento", x.id, "unset_default", { code: x.code, familia, ...(novoPadraoId ? { novoPadraoId } : {}) });
}

export default async function layoutsDocumentoRoutes(app: FastifyInstance) {
  const BASE = "/admin/layouts-documento";

  app.get(BASE, async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const f = listaSchema.parse(req.query);
    const params: unknown[] = [ctx.orgId];
    let filtro = "";
    if (f.familia) { params.push(f.familia); filtro = ` and l.familia = $${params.length}`; }
    const r = await ctx.tx.query<LinhaLayout & { qtd_tops: string }>(
      `select l.id, l.code, l.nome, l.familia, l.padrao, l.is_active, l.created_at, l.updated_at,
              (select count(*) from erp.layout_documento_tops x
                 join erp.tipos_operacao t on t.id = x.tipo_operacao_id and t.organization_id = x.organization_id and t.excluido_em is null
                where x.organization_id = l.organization_id and x.layout_id = l.id) as qtd_tops
         from erp.layouts_documento l
        where l.organization_id = $1 and l.deleted_at is null${filtro}
        order by l.familia, l.code`, params);
    return { items: r.rows.map((x) => ({ ...paraTela(x), qtdTops: Number(x.qtd_tops) })) };
  }));

  /**
   * LAYOUT EFETIVO DA TOP, PELA PORTA DE CONFIGURAÇÕES (R1): é o que a linha "Layout do documento" do editor da TOP
   * mostra. A permissão é a da tela (`tipos_operacao.view`), não a de lançar venda; e a TOP pode estar INATIVA — quem
   * configura precisa ver o layout dela. A consulta é a MESMA da Central (`layoutEfetivo`, um dono).
   * TOP inexistente, de outra organização, excluída, id malformado ou de família sem layout: a MESMA 404.
   * Registrada ANTES de `/:id`: "efetivo" nunca é tratado como id de layout.
   */
  app.get(`${BASE}/efetivo`, async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const q = efetivoSchema.parse(req.query);
    if (!UUID.test(q.tipoOperacaoId)) throw notFound("Tipo de operação");
    const t = await ctx.tx.query<{ codigo_base: string }>(
      "select codigo_base from erp.tipos_operacao where id = $1 and organization_id = $2 and excluido_em is null", [q.tipoOperacaoId, ctx.orgId]);
    const familia = t.rows[0]?.codigo_base;
    if (!familia || !familiaTemLayout(familia)) throw notFound("Tipo de operação");
    const l = await layoutEfetivo(ctx, familia, q.tipoOperacaoId);
    return { origem: l.origem, nome: l.nome, id: l.id };
  }));

  app.get(`${BASE}/:id`, async (req) => runService(app, req, "tipos_operacao.view", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    const l = await lerLayout(ctx, id);
    return { ...paraTela(l), estrutura: l.estrutura, tops: await topsLigadas(ctx, id) };
  }));

  app.post(BASE, async (req, reply) => reply.status(201).send(await runService(app, req, "tipos_operacao.create", async (ctx) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    if (corpo["code"] !== undefined) throw validation("code: o código é gerado pelo sistema", [{ path: "code", message: "O código é gerado pelo sistema; não o envie." }]);
    const d = criarSchema.parse(corpo);
    const estrutura = d.estrutura === undefined ? LAYOUT_DO_SISTEMA(d.familia) : estruturaValida(d.familia, d.estrutura);
    const code = await gerarCodigo(ctx);
    const r = await ctx.tx.query<{ id: string }>(
      `insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura) values ($1,$2,$3,$4,$5) returning id`,
      [ctx.orgId, code, d.nome, d.familia, JSON.stringify(estrutura)]);
    const id = r.rows[0]!.id;
    await audit(ctx.tx, ctx, "layouts_documento", id, "create", { code, familia: d.familia, estruturaDoSistema: d.estrutura === undefined }, { after: { nome: d.nome, estrutura } });
    return { id, code };
  })));

  app.put(`${BASE}/:id`, async (req) => runService(app, req, "tipos_operacao.edit", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    const d = editarSchema.parse(req.body ?? {});
    const atual = await lerLayout(ctx, id, true);
    const nome = d.nome ?? atual.nome;
    const estrutura = d.estrutura === undefined ? atual.estrutura : estruturaValida(atual.familia, d.estrutura);
    const u = await ctx.tx.query(`update erp.layouts_documento set nome=$3, estrutura=$4 where id=$1 and organization_id=$2 and deleted_at is null`,
      [id, ctx.orgId, nome, JSON.stringify(estrutura)]);
    if (!u.rowCount) throw notFound("Layout");
    await audit(ctx.tx, ctx, "layouts_documento", id, "update", { code: atual.code },
      { before: { nome: atual.nome, estrutura: atual.estrutura }, after: { nome, estrutura } });
    return { ok: true };
  }));

  app.post(`${BASE}/:id/duplicar`, async (req, reply) => reply.status(201).send(await runService(app, req, "tipos_operacao.create", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    if (req.body !== undefined && req.body !== null && Object.keys(req.body as object).length) z.object({}).strict().parse(req.body);
    const origem = await lerLayout(ctx, id);
    const code = await gerarCodigo(ctx);
    const nome = await nomeDeCopiaLivre(ctx, origem.nome);
    const r = await ctx.tx.query<{ id: string }>(
      `insert into erp.layouts_documento (organization_id, code, nome, familia, estrutura, is_active) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.orgId, code, nome, origem.familia, JSON.stringify(origem.estrutura), origem.is_active]);
    const novo = r.rows[0]!.id;
    await audit(ctx.tx, ctx, "layouts_documento", novo, "duplicate", { code, familia: origem.familia, origemId: id, origemCode: origem.code });
    return { id: novo, code, nome };
  })));

  app.delete(`${BASE}/:id`, async (req) => runService(app, req, "tipos_operacao.delete", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    const atual = await lerLayout(ctx, id, true);
    const links = await ctx.tx.query<{ tipo_operacao_id: string }>(
      "delete from erp.layout_documento_tops where organization_id=$1 and layout_id=$2 returning tipo_operacao_id", [ctx.orgId, id]);
    const u = await ctx.tx.query("update erp.layouts_documento set deleted_at=now(), padrao=false where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!u.rowCount) throw notFound("Layout");
    await audit(ctx.tx, ctx, "layouts_documento", id, "delete",
      { code: atual.code, familia: atual.familia, eraPadrao: atual.padrao, topsDesligadas: links.rows.map((x) => x.tipo_operacao_id) });
    return { ok: true };
  }));

  app.post(`${BASE}/:id/ativo`, async (req) => runService(app, req, "tipos_operacao.edit", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    const { ativo } = ativoSchema.parse(req.body ?? {});
    const atual = await lerLayout(ctx, id, true);
    // Desativar tira o padrão: layout inativo não é padrão (o índice parcial nem o contaria, e a marca ficaria enganosa).
    const u = await ctx.tx.query("update erp.layouts_documento set is_active=$3, padrao = (padrao and $3) where id=$1 and organization_id=$2 and deleted_at is null",
      [id, ctx.orgId, ativo]);
    if (!u.rowCount) throw notFound("Layout");
    await audit(ctx.tx, ctx, "layouts_documento", id, ativo ? "activate" : "deactivate", { code: atual.code, ...(atual.padrao && !ativo ? { perdeuPadrao: true } : {}) });
    return { ok: true };
  }));

  app.post(`${BASE}/:id/padrao`, async (req) => runService(app, req, "tipos_operacao.edit", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    if (req.body !== undefined && req.body !== null && Object.keys(req.body as object).length) z.object({}).strict().parse(req.body);
    const atual = await lerLayout(ctx, id, true);
    if (!atual.is_active) throw validation("Layout inativo não pode ser o padrão da família", [{ path: "ativo", message: "Ative o layout antes de marcá-lo como padrão." }]);
    if (atual.padrao) return { ok: true };
    await liberarPadrao(ctx, atual.familia, id, id);
    const u = await ctx.tx.query("update erp.layouts_documento set padrao=true where id=$1 and organization_id=$2 and deleted_at is null", [id, ctx.orgId]);
    if (!u.rowCount) throw notFound("Layout");
    await audit(ctx.tx, ctx, "layouts_documento", id, "set_default", { code: atual.code, familia: atual.familia });
    return { ok: true };
  }));

  app.put(`${BASE}/:id/tops`, async (req) => runService(app, req, "tipos_operacao.edit", async (ctx) => {
    const { id } = idSchema.parse(req.params);
    const { tipoOperacaoIds } = topsSchema.parse(req.body ?? {});
    const atual = await lerLayout(ctx, id, true);
    const pedidos = [...new Set(tipoOperacaoIds)];
    const tops = await ctx.tx.query<{ id: string; codigo_base: string }>(
      "select id, codigo_base from erp.tipos_operacao where organization_id=$1 and excluido_em is null and id = any($2::uuid[])", [ctx.orgId, pedidos]);
    const familiaDe = new Map(tops.rows.map((t) => [t.id, t.codigo_base]));
    // Inexistente, de outra organização ou excluída: a MESMA recusa (nada revela existência).
    const invalidas = tipoOperacaoIds.map((t, i) => ({ t, i })).filter(({ t }) => !familiaDe.has(t));
    if (invalidas.length) {
      throw validation("TOP inválida para este layout", invalidas.map(({ i }) => ({ path: `tipoOperacaoIds.${i}`, message: "TOP inválida para este layout." })));
    }
    const outraFamilia = tipoOperacaoIds.map((t, i) => ({ t, i })).filter(({ t }) => familiaDe.get(t) !== atual.familia);
    if (outraFamilia.length) {
      throw validation("TOP de outra família", outraFamilia.map(({ i }) => ({ path: `tipoOperacaoIds.${i}`, message: `A TOP não é da família ${atual.familia} deste layout.` })));
    }
    const antes = await ctx.tx.query<{ tipo_operacao_id: string; layout_id: string }>(
      `select tipo_operacao_id, layout_id from erp.layout_documento_tops
        where organization_id=$1 and (layout_id=$2 or tipo_operacao_id = any($3::uuid[])) for update`, [ctx.orgId, id, pedidos]);
    const removidas = antes.rows.filter((x) => x.layout_id === id && !pedidos.includes(x.tipo_operacao_id)).map((x) => x.tipo_operacao_id);
    const movidas = antes.rows.filter((x) => x.layout_id !== id).map((x) => ({ tipoOperacaoId: x.tipo_operacao_id, deLayoutId: x.layout_id }));
    const jaLigadas = new Set(antes.rows.filter((x) => x.layout_id === id).map((x) => x.tipo_operacao_id));
    const novas = pedidos.filter((t) => !jaLigadas.has(t));
    if (removidas.length) {
      const d = await ctx.tx.query("delete from erp.layout_documento_tops where organization_id=$1 and layout_id=$2 and tipo_operacao_id = any($3::uuid[])", [ctx.orgId, id, removidas]);
      if (d.rowCount !== removidas.length) throw notFound("Layout");
    }
    if (movidas.length) {
      const m = await ctx.tx.query("update erp.layout_documento_tops set layout_id=$2, created_at=now(), created_by=$4 where organization_id=$1 and tipo_operacao_id = any($3::uuid[])",
        [ctx.orgId, id, movidas.map((x) => x.tipoOperacaoId), ctx.user.id]);
      if (m.rowCount !== movidas.length) throw notFound("Layout");
    }
    const inserir = novas.filter((t) => !movidas.some((m) => m.tipoOperacaoId === t));
    if (inserir.length) {
      const ins = await ctx.tx.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id, created_by) select $1, $2, unnest($3::uuid[]), $4",
        [ctx.orgId, id, inserir, ctx.user.id]);
      if (ins.rowCount !== inserir.length) throw notFound("Layout");
    }
    await audit(ctx.tx, ctx, "layouts_documento", id, "set_tops",
      { code: atual.code, adicionadas: inserir, removidas, movidas },
      { before: { tops: [...jaLigadas] }, after: { tops: pedidos } });
    return { ok: true, tops: await topsLigadas(ctx, id) };
  }));
}
