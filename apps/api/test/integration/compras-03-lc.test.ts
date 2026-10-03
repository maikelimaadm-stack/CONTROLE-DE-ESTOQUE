import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo, type Db } from "@agro/db";
import {
  ERRO_LAYOUT_CAMPO_OBRIGATORIO, LAYOUT_DO_SISTEMA, configuracaoNeutraTopV3, mensagemCampoObrigatorio, mensagemRegistroPadraoInvalido,
  type CampoDoLayout, type ColunaDoLayout, type EstruturaLayout,
} from "@agro/domain";
import { appCom, escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * LAYOUT DO DOCUMENTO DE COMPRA (COMPRAS-03, decisão 269) — LC-1..LC-6 da missão.
 *
 *   LC-1  o cadastro: layout de `compras.pedido` e `compras.compra` nasce pela API administrativa (a porta do
 *         configurador), é conferido pelo catálogo DA FAMÍLIA e se liga à TOP; TOP de outra família é recusada pela
 *         API e, por baixo dela, pelo GATILHO do banco (SQL direto, superusuário);
 *   LC-2  `GET /api/compras/{pedidos|compras}/layout-efetivo` por espécie: sistema, ligado e padrão da família (o
 *         padrão de uma família não vaza para a outra nem para vendas); TOP ausente, malformada, inexistente, de outra
 *         família, inativa, excluída ou de outra organização → a MESMA 404; a porta é `<recurso>.create`;
 *   LC-3  a cobrança ao salvar: obrigatório vazio → 422 `LAYOUT_CAMPO_OBRIGATORIO` no campo (zonas e `itens[i].campo`
 *         inclusive) ao LANÇAR PEDIDO, LANÇAR COMPRA e RECEBER; layout do sistema → nada muda;
 *   LC-4  padrão de CADASTRO do Fornecedor (`is_provider`) — o que vale, o que é recusado com a MESMA 422, o que morre
 *         depois (`padroesInvalidos`) — e o Armazém como a coluna de padrão de compras;
 *   LC-5  `regras-da-operacao` com `exigeFormaPagamento`, `exigeVencimento` e `exigeArmazem` — os MESMOS que o
 *         lançamento cobra, da versão ATUAL;
 *   LC-6  item 0 a) convertido com compra viva responde o mesmo do aberto; c) receber com UUID em maiúsculas;
 *         d) compra que não gera título confirma sem forma e sem vencimento.
 *
 * O QUE CONTA COMO PROVA. O layout é montado pela API administrativa (nunca por SQL): a suíte prova a mesma porta que
 * o configurador usa. Toda recusa vem com a PREMISSA ao lado (o mesmo cenário, completo, grava), e toda "não
 * cobrança" com a prova de que o documento REALMENTE está sem o campo. O que foi — ou não foi — gravado é LIDO NO
 * BANCO por conexão própria (superusuário, sem RLS).
 *
 * DUAS INSTÂNCIAS DA API sobre o mesmo banco: `h.app` com o gate da execução configurada DESLIGADO e `ligada` com
 * `TOP_EFFECTS_RUNTIME_V1_ENABLED=1` (o de produção) — os três flags de LC-5 e o item d) só existem com a execução
 * configurada.
 */
let h: Harness; let ligada: FastifyInstance; let I: Awaited<ReturnType<typeof ids>>; let admin: Db;
type Hdr = Record<string, string>;
type Resposta = { statusCode: number; body: string; json: () => unknown };
type Detalhe = { path: string; message: string };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
const detalhes = (r: Resposta): Detalhe[] => (j(r).error?.details as Detalhe[] | undefined) ?? [];

const COMPRA = "compras.compra";
const PEDIDO = "compras.pedido";
type Segmento = "pedidos" | "compras";
const FAMILIA: Record<Segmento, string> = { pedidos: PEDIDO, compras: COMPRA };
const DATA = "2026-09-10";
const LAYOUTS = "/api/admin/layouts-documento";
const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";

/** A outra organização (TOP e fornecedor de outro tenant). */
let outra: { orgId: string; headers: Hdr; fornecedor: string };
/** Uma transportadora da organização (a compra só aceita pessoa com `is_transporter`). */
let transportadora: string;

let seq = 0;
const unico = () => `${Date.now().toString(36).slice(-4)}${++seq}`;

beforeAll(async () => {
  h = await harness();
  ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" });
  I = await ids(h);
  admin = createPool(TEST_URL, { max: 4 });
  const o = await seedDemo(admin, { orgName: "[TEST] Org C03 LC", adminEmail: "admin-c03lc@demo.local", adminPassword: "Demo@12345", slug: "orgc03lc" }, () => {});
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-c03lc@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  const fornecedorDeLa = (await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_provider and deleted_at is null order by code limit 1", [o.orgId])).rows[0]?.id;
  if (!fornecedorDeLa) throw new Error("premissa: a outra organização tem fornecedor no seed");
  outra = { orgId: o.orgId, headers: { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId }, fornecedor: fornecedorDeLa };
  const t = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: `LC Transportadora ${unico()}`, person_type: "legal", is_transporter: true } });
  expect(t.statusCode, t.body).toBe(201);
  transportadora = j(t).id as string;
}, 240_000);
afterAll(async () => { await ligada?.close(); await h?.app.close(); await h?.db.end(); await admin?.end(); });

// ---------------------------------------------------------------------------------------------------------
// Cenário
// ---------------------------------------------------------------------------------------------------------
/** TOP pela API administrativa (instância com a execução configurada ligada: aceita qualquer configuração válida). */
async function top(codigoBase: string, extra: Record<string, unknown> = {}, headers: Hdr = h.headers()): Promise<string> {
  const r = await ligada.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers,
    payload: { codigo: `7${String(++seq).padStart(3, "0")}${Math.floor(Math.random() * 90 + 10)}`, codigoBase, nome: `TOP LC ${codigoBase} ${seq}`, ...extra } });
  expect(r.statusCode, `premissa: a TOP ${codigoBase} é cadastrada — ${r.body}`).toBe(201);
  return j(r).id as string;
}
const topPedidoPara = (topCompra: string, emPartes: boolean) => top(PEDIDO, { destinos: [{ tipoOperacaoId: topCompra, ordem: 0, emPartes }] });

const criarLayout = (familia: string, estrutura?: EstruturaLayout, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "POST", url: LAYOUTS, headers, payload: { familia, nome: `LC ${familia} ${unico()}`, ...(estrutura ? { estrutura } : {}) } });
/** O layout do sistema da família, ajustado, gravado pela API e (opcionalmente) ligado às TOPs dadas. */
async function layout(familia: string, ajuste: (e: EstruturaLayout) => void, tops: string[] = []): Promise<string> {
  const estrutura = structuredClone(LAYOUT_DO_SISTEMA(familia));
  ajuste(estrutura);
  const r = await criarLayout(familia, estrutura);
  expect(r.statusCode, `premissa: o layout de ${familia} grava — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  if (tops.length) await ligar(id, tops);
  return id;
}
const ligarTops = (layoutId: string, tops: string[]) =>
  h.app.inject({ method: "PUT", url: `${LAYOUTS}/${layoutId}/tops`, headers: h.headers(), payload: { tipoOperacaoIds: tops } });
async function ligar(layoutId: string, tops: string[]): Promise<void> {
  const r = await ligarTops(layoutId, tops);
  expect(r.statusCode, r.body).toBe(200);
}
function campo(e: EstruturaLayout, chave: string): CampoDoLayout {
  const c = e.cabecalho.find((x) => x.campo === chave) ?? e.rodape.flatMap((a) => a.campos).find((x) => x.campo === chave);
  if (!c) throw new Error(`campo ${chave} fora da estrutura`);
  return c;
}
function coluna(e: EstruturaLayout, chave: string): ColunaDoLayout {
  const c = e.itens.find((x) => x.campo === chave);
  if (!c) throw new Error(`coluna ${chave} fora dos itens`);
  return c;
}
/** Tira o campo do cabeçalho (esconder no layout) e o devolve, para ser posto em outra zona. */
function tirar(e: EstruturaLayout, chave: string): CampoDoLayout {
  const i = e.cabecalho.findIndex((x) => x.campo === chave);
  if (i < 0) throw new Error(`campo ${chave} fora do cabeçalho`);
  return e.cabecalho.splice(i, 1)[0]!;
}
/** Caminho do `valorPadrao` de um campo do cabeçalho ou de uma coluna dos itens, na estrutura do sistema. */
function caminhoDoPadrao(familia: string, chave: string, parte: "cabecalho" | "itens"): string {
  const e = LAYOUT_DO_SISTEMA(familia);
  const i = (parte === "cabecalho" ? e.cabecalho : e.itens).findIndex((x) => x.campo === chave);
  if (i < 0) throw new Error(`${chave} fora de ${parte}`);
  return `${parte}[${i}].valorPadrao`;
}

type Item = { produto_id: string; armazem_id?: string | null; quantidade: string; valor_unitario: string } & Record<string, unknown>;
const corpoCompra = (topId: string, o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
  categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: [{ produto_id: I.product2!, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" }] as Item[], ...o,
});
const corpoPedido = (topId: string, o: Record<string, unknown> = {}) => ({
  empresa_id: I.empresa, tipo_operacao_id: topId, fornecedor_id: I.provider, data_documento: DATA,
  itens: [{ produto_id: I.product!, quantidade: "2", valor_unitario: "5.00" }] as Item[], ...o,
});
const lancar = (segmento: Segmento, corpo: unknown, app: FastifyInstance = h.app, headers: Hdr = h.headers()) =>
  app.inject({ method: "POST", url: `/api/compras/${segmento}`, headers, payload: corpo as Record<string, unknown> });
async function lancado(segmento: Segmento, corpo: unknown, app: FastifyInstance = h.app): Promise<string> {
  const r = await lancar(segmento, corpo, app);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function pedido(topPedido: string, itens: Item[]): Promise<{ id: string; itens: { id: string }[] }> {
  const id = await lancado("pedidos", corpoPedido(topPedido, { itens }));
  const itensDoBanco = (await admin.query<{ id: string }>("select id from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [id])).rows;
  return { id, itens: itensDoBanco };
}
type ItemRecebido = { item_origem_id: string; quantidade: string } & Record<string, unknown>;
const corpoReceber = (topCompra: string, itens: ItemRecebido[], extra: Record<string, unknown> = {}) => ({
  tipo_operacao_id: topCompra, data_documento: DATA, categoria_financeira_id: I.category, centro_custo_id: I.costCenter,
  itens: itens.map((i) => ({ valor_unitario: "10.00", armazem_id: I.warehouse, ...i })), ...extra,
});
const receber = (pedidoId: string, corpo: unknown, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoId}/convert`, headers, payload: corpo as Record<string, unknown> });
const cancelar = (segmento: Segmento, id: string) =>
  h.app.inject({ method: "POST", url: `/api/compras/${segmento}/${id}/cancel`, headers: h.headers(), payload: {} });
const efetivo = (segmento: Segmento, query: string, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/compras/${segmento}/layout-efetivo${query}`, headers });

// ---- leituras no banco ----
const situacao = async (id: string) => (await admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!.situacao;
const documentosDaOrg = async () => Number((await admin.query<{ n: string }>("select count(*)::text n from erp.documentos_compra where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
const comprasDoPedido = async (id: string) => (await admin.query<{ id: string; situacao: string }>(
  "select id, situacao from erp.documentos_compra where origem_documento_id=$1 order by created_at, id", [id])).rows;
const ligacoesDoLayout = async (layoutId: string) => (await admin.query<{ tipo_operacao_id: string }>(
  "select tipo_operacao_id from erp.layout_documento_tops where layout_id=$1 order by tipo_operacao_id", [layoutId])).rows.map((x) => x.tipo_operacao_id);
const inserirLigacao = (layoutId: string, topId: string) =>
  admin.query("insert into erp.layout_documento_tops (organization_id, layout_id, tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, layoutId, topId]);

async function membro(nome: string, perms: string[]): Promise<Hdr> {
  const email = `${nome.toLowerCase().replace(/\W+/g, "")}${unico()}@c03lc.local`;
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome} ${unico()}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const v = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "Restrito@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(v.statusCode, v.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Restrito@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

// ---------------------------------------------------------------------------------------------------------
// LC-1 — o cadastro do layout de compra
// ---------------------------------------------------------------------------------------------------------
describe("LC-1 — layout de compra: criar pela API, conferido pelo catálogo da família, ligar à TOP; outra família recusada (API e gatilho)", () => {
  it("LC-1a as duas famílias de compra nascem com o layout do sistema delas; família fora das cinco → 422 na API e no CHECK do banco", async () => {
    for (const familia of [PEDIDO, COMPRA]) {
      const r = await criarLayout(familia);
      expect(r.statusCode, `${familia}: ${r.body}`).toBe(201);
      const id = j(r).id as string;
      const g = await h.app.inject({ method: "GET", url: `${LAYOUTS}/${id}`, headers: h.headers() });
      expect(g.statusCode, g.body).toBe(200);
      expect(j(g)).toMatchObject({ familia, estrutura: LAYOUT_DO_SISTEMA(familia) });
      const gravado = (await admin.query<{ familia: string; estrutura: EstruturaLayout }>("select familia, estrutura from erp.layouts_documento where id=$1", [id])).rows[0]!;
      expect(gravado, "gravado no banco com a família e a estrutura do sistema dela").toEqual({ familia, estrutura: LAYOUT_DO_SISTEMA(familia) });
    }
    // O layout do sistema de compras É a Central de hoje: nota, série, entrada, lote e validade só na Compra.
    const soNaCompra = ["data_entrada", "numero_nota", "serie_nota"];
    expect(LAYOUT_DO_SISTEMA(COMPRA).cabecalho.map((c) => c.campo)).toEqual(expect.arrayContaining(soNaCompra));
    for (const c of soNaCompra) expect(LAYOUT_DO_SISTEMA(PEDIDO).cabecalho.map((x) => x.campo)).not.toContain(c);
    expect(LAYOUT_DO_SISTEMA(COMPRA).itens.map((c) => c.campo)).toEqual(["armazem_id", "produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual", "lote", "validade"]);
    expect(LAYOUT_DO_SISTEMA(PEDIDO).itens.map((c) => c.campo)).toEqual(["armazem_id", "produto_id", "quantidade", "valor_unitario", "desconto", "desconto_percentual"]);

    // Fora das cinco (a solicitação de compra não tem layout): a API recusa, e o CHECK do banco recusa por baixo dela.
    const antes = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
    const fora = await criarLayout("compras.solicitacao");
    expect(fora.statusCode, fora.body).toBe(422);
    expect(j(fora).error!.code).toBe("VALIDATION_ERROR");
    await expect(admin.query("insert into erp.layouts_documento(organization_id,code,nome,familia,estrutura) values ($1,$2,$3,'compras.solicitacao',$4)",
      [h.demo.orgId, `LC-${unico()}`, `LC fora ${unico()}`, JSON.stringify(LAYOUT_DO_SISTEMA(COMPRA))])).rejects.toMatchObject({ code: "23514" });
    expect(Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n),
      "nenhuma recusa gravou layout").toBe(antes);
  });

  it("LC-1b a estrutura é conferida pelo catálogo DA FAMÍLIA: chave de venda em compra, de compra em venda, de compra no pedido → 422 no caminho", async () => {
    const casos: [string, string, (e: EstruturaLayout) => void, string][] = [
      ["cliente (de venda) na compra", COMPRA, (e) => { e.cabecalho.push({ campo: "client_id", obrigatorio: false, editavel: true }); }, `cabecalho[${LAYOUT_DO_SISTEMA(COMPRA).cabecalho.length}].campo`],
      ["número da nota (só da compra) no pedido", PEDIDO, (e) => { e.cabecalho.push({ campo: "numero_nota", obrigatorio: false, editavel: true }); }, `cabecalho[${LAYOUT_DO_SISTEMA(PEDIDO).cabecalho.length}].campo`],
      ["coluna warehouse_id (de venda) nos itens da compra", COMPRA, (e) => { e.itens.push({ campo: "warehouse_id", obrigatorio: false }); }, `itens[${LAYOUT_DO_SISTEMA(COMPRA).itens.length}].campo`],
      ["lote (só da compra) nos itens do pedido", PEDIDO, (e) => { e.itens.push({ campo: "lote", obrigatorio: false }); }, `itens[${LAYOUT_DO_SISTEMA(PEDIDO).itens.length}].campo`],
      ["fornecedor (de compra) na venda", "vendas.venda", (e) => { e.cabecalho.push({ campo: "fornecedor_id", obrigatorio: false, editavel: true }); }, `cabecalho[${LAYOUT_DO_SISTEMA("vendas.venda").cabecalho.length}].campo`],
      ["Fornecedor (obrigatório do sistema) fora do layout", COMPRA, (e) => { tirar(e, "fornecedor_id"); }, "cabecalho"],
      ["Frete (sempre tem valor) obrigatório", PEDIDO, (e) => { campo(e, "frete").obrigatorio = true; }, `cabecalho[${LAYOUT_DO_SISTEMA(PEDIDO).cabecalho.findIndex((c) => c.campo === "frete")}].obrigatorio`],
    ];
    for (const [nome, familia, ajuste, caminho] of casos) {
      const e = structuredClone(LAYOUT_DO_SISTEMA(familia));
      ajuste(e);
      const r = await criarLayout(familia, e);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r).map((d) => d.path), nome).toContain(caminho);
    }
    // PREMISSA: a mesma porta aceita uma estrutura de compra válida com zonas (aba no rodapé, "Dados adicionais"),
    // rótulo próprio, campo escondido e obrigatório novo — e grava exatamente o que recebeu.
    const e = structuredClone(LAYOUT_DO_SISTEMA(COMPRA));
    const obs = tirar(e, "observacao");
    e.rodape.push({ aba: "Entrega", campos: [{ ...obs, obrigatorio: true, rotulo: "Obs. da entrega" }] });
    Object.assign(campo(e, "numero_nota"), { grupo: "adicionais", rotulo: "Nº da NF" });
    tirar(e, "transportadora_id");
    const ok = await criarLayout(COMPRA, e);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await admin.query<{ estrutura: EstruturaLayout }>("select estrutura from erp.layouts_documento where id=$1", [j(ok).id])).rows[0]!.estrutura).toEqual(e);
  });

  it("LC-1e o que o lançar sempre recusaria é recusado na GRAVAÇÃO do layout de compra: 422 no campo, com a mensagem da regra; o par certo grava", async () => {
    const sis = LAYOUT_DO_SISTEMA(COMPRA);
    const iCab = (e: EstruturaLayout, chave: string) => e.cabecalho.findIndex((x) => x.campo === chave);
    const iLote = sis.itens.findIndex((x) => x.campo === "lote"); const iValidade = sis.itens.findIndex((x) => x.campo === "validade");
    type Caso = [string, string, (e: EstruturaLayout) => void, (e: EstruturaLayout) => Detalhe];
    const casos: Caso[] = [
      ["Lote obrigatório", COMPRA, (e) => { coluna(e, "lote").obrigatorio = true; },
        () => ({ path: `itens[${iLote}].obrigatorio`, message: `"Lote" é exigido pela regra do produto: o layout não o torna obrigatório.` })],
      ["Validade obrigatória", COMPRA, (e) => { coluna(e, "validade").obrigatorio = true; },
        () => ({ path: `itens[${iValidade}].obrigatorio`, message: `"Validade" é exigido pela regra do produto: o layout não o torna obrigatório.` })],
      ["Lote com valor padrão", COMPRA, (e) => { coluna(e, "lote").valorPadrao = { tipo: "literal", valor: "L1" }; },
        () => ({ path: `itens[${iLote}].valorPadrao`, message: `"Lote" é informado item a item: não aceita valor padrão.` })],
      ["Validade com valor padrão", COMPRA, (e) => { coluna(e, "validade").valorPadrao = { tipo: "variavel", variavel: "data_atual" }; },
        () => ({ path: `itens[${iValidade}].valorPadrao`, message: `"Validade" é informado item a item: não aceita valor padrão.` })],
      ["Série sem Número da nota", COMPRA, (e) => { tirar(e, "numero_nota"); },
        (e) => ({ path: `cabecalho[${iCab(e, "serie_nota")}].campo`, message: `"Série" só entra no layout com "Número da nota".` })],
      ["Série fixa com Número não editável", COMPRA, (e) => {
        Object.assign(campo(e, "serie_nota"), { editavel: false, valorPadrao: { tipo: "literal", valor: "1" } });
        campo(e, "numero_nota").editavel = false;
      }, (e) => ({ path: `cabecalho[${iCab(e, "serie_nota")}].editavel`, message: `"Série" com valor padrão fixo exige "Número da nota" editável.` })],
      ["Natureza sem Centro (compra)", COMPRA, (e) => { tirar(e, "centro_custo_id"); },
        (e) => ({ path: `cabecalho[${iCab(e, "categoria_financeira_id")}].campo`, message: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Centro de resultado".` })],
      ["Centro sem Natureza (pedido)", PEDIDO, (e) => { tirar(e, "categoria_financeira_id"); },
        (e) => ({ path: `cabecalho[${iCab(e, "centro_custo_id")}].campo`, message: `"Natureza de despesa" e "Centro de resultado" entram juntos no layout: ponha também "Natureza de despesa".` })],
      ["Natureza obrigatória e Centro opcional", COMPRA, (e) => { campo(e, "categoria_financeira_id").obrigatorio = true; },
        (e) => ({ path: `cabecalho[${iCab(e, "centro_custo_id")}].obrigatorio`, message: `"Centro de resultado" e "Natureza de despesa" têm de ser ambos obrigatórios ou ambos opcionais.` })],
      ["Centro fixo com Natureza não editável", COMPRA, (e) => {
        Object.assign(campo(e, "centro_custo_id"), { editavel: false, valorPadrao: { tipo: "registro", id: I.costCenter } });
        campo(e, "categoria_financeira_id").editavel = false;
      }, (e) => ({ path: `cabecalho[${iCab(e, "centro_custo_id")}].editavel`, message: `"Centro de resultado" com valor padrão fixo exige "Natureza de despesa" editável.` })],
    ];
    for (const [nome, familia, ajuste, esperado] of casos) {
      const e = structuredClone(LAYOUT_DO_SISTEMA(familia));
      ajuste(e);
      const antes = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
      const r = await criarLayout(familia, e);
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(j(r).error!.code, nome).toBe("VALIDATION_ERROR");
      expect(detalhes(r), nome).toContainEqual(esperado(e));
      expect(Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n), `${nome}: nada gravado`).toBe(antes);
    }
    // PREMISSAS (o par certo grava): Lote/Validade só com rótulo e ordem; Série com Número; Natureza e Centro juntos,
    // ambos obrigatórios; Centro fixo com Natureza editável; e os dois fora juntos.
    const certos: [string, (e: EstruturaLayout) => void][] = [
      ["Lote e Validade renomeados e reordenados", (e) => {
        coluna(e, "lote").rotulo = "Lote do fornecedor";
        const [v] = e.itens.splice(e.itens.findIndex((x) => x.campo === "validade"), 1); e.itens.splice(e.itens.findIndex((x) => x.campo === "lote"), 0, v!);
      }],
      ["Série fixa com Número editável", (e) => { Object.assign(campo(e, "serie_nota"), { editavel: false, valorPadrao: { tipo: "literal", valor: "1" } }); }],
      ["Natureza e Centro obrigatórios", (e) => { campo(e, "categoria_financeira_id").obrigatorio = true; campo(e, "centro_custo_id").obrigatorio = true; }],
      ["Centro fixo com Natureza editável", (e) => { Object.assign(campo(e, "centro_custo_id"), { editavel: false, valorPadrao: { tipo: "registro", id: I.costCenter } }); }],
      ["Natureza e Centro fora, Série e Número fora", (e) => { for (const k of ["categoria_financeira_id", "centro_custo_id", "serie_nota", "numero_nota"]) tirar(e, k); }],
    ];
    for (const [nome, ajuste] of certos) {
      const e = structuredClone(LAYOUT_DO_SISTEMA(COMPRA));
      ajuste(e);
      const r = await criarLayout(COMPRA, e);
      expect(r.statusCode, `premissa — ${nome}: ${r.body}`).toBe(201);
    }
  });

  it("LC-1c ligar TOP de compra → 200 e a ligação no banco; TOP de venda ou da OUTRA família de compra → 422 e nada muda", async () => {
    const l = await layout(COMPRA, () => {});
    const tCompra = await top(COMPRA);
    const r = await ligarTops(l, [tCompra]);
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r).tops as { id: string }[]).map((x) => x.id)).toEqual([tCompra]);
    expect(await ligacoesDoLayout(l)).toEqual([tCompra]);

    for (const [nome, familia] of [["de venda", "vendas.venda"], ["de pedido de compra", PEDIDO]] as const) {
      const t = await top(familia);
      const x = await ligarTops(l, [tCompra, t]);
      expect(x.statusCode, `${nome}: ${x.body}`).toBe(422);
      expect(j(x).error!.message, nome).toBe("TOP de outro movimento");
      expect(detalhes(x), nome).toEqual([{ path: "tipoOperacaoIds.1", message: `A TOP não é do movimento ${COMPRA} deste layout.` }]);
      expect(await ligacoesDoLayout(l), `${nome}: a ligação de antes continua, e só ela`).toEqual([tCompra]);
    }
    // E no sentido inverso: TOP de compra num layout de VENDA.
    const lVenda = await layout("vendas.venda", () => {});
    const inversa = await ligarTops(lVenda, [tCompra]);
    expect(inversa.statusCode, inversa.body).toBe(422);
    expect(j(inversa).error!.message).toBe("TOP de outro movimento");
    expect(await ligacoesDoLayout(lVenda)).toEqual([]);
  });

  it("LC-1d o GATILHO do banco recusa família divergente em INSERT direto (superusuário), nos três cruzamentos; a mesma família grava", async () => {
    const lCompra = await layout(COMPRA, () => {});
    const lPedido = await layout(PEDIDO, () => {});
    const lVenda = await layout("vendas.pedido", () => {});
    const tCompra = await top(COMPRA); const tPedido = await top(PEDIDO); const tVenda = await top("vendas.pedido");
    const cruzamentos: [string, string, string][] = [
      ["TOP de venda → layout de compra", lCompra, tVenda],
      ["TOP de compra → layout de venda", lVenda, tCompra],
      ["TOP de pedido de compra → layout de compra", lCompra, tPedido],
      ["TOP de compra → layout de pedido de compra", lPedido, tCompra],
    ];
    for (const [nome, l, t] of cruzamentos) {
      await expect(inserirLigacao(l, t), nome).rejects.toMatchObject({ code: "23514", message: expect.stringMatching(/difere da familia do layout/) });
    }
    expect([...await ligacoesDoLayout(lCompra), ...await ligacoesDoLayout(lPedido), ...await ligacoesDoLayout(lVenda)], "nenhum cruzamento gravou").toEqual([]);
    // PREMISSA: o gatilho não recusa tudo — a mesma família grava, nas duas famílias de compra.
    await inserirLigacao(lCompra, tCompra);
    await inserirLigacao(lPedido, tPedido);
    expect([await ligacoesDoLayout(lCompra), await ligacoesDoLayout(lPedido)]).toEqual([[tCompra], [tPedido]]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// LC-2 — layout efetivo por espécie
// ---------------------------------------------------------------------------------------------------------
describe("LC-2 — GET /api/compras/{pedidos|compras}/layout-efetivo por espécie, e a MESMA 404", () => {
  it("LC-2a por espécie: sem layout → o do sistema da família (só as quatro chaves); ligado → o ligado, com id, nome e a estrutura gravada", async () => {
    for (const segmento of ["pedidos", "compras"] as const) {
      const familia = FAMILIA[segmento];
      const t = await top(familia);
      const s = await efetivo(segmento, `?tipo_operacao_id=${t}`);
      expect(s.statusCode, s.body).toBe(200);
      expect(j(s), segmento).toEqual({ estrutura: LAYOUT_DO_SISTEMA(familia), origem: "sistema", nome: null, id: null });

      const estrutura = structuredClone(LAYOUT_DO_SISTEMA(familia));
      Object.assign(campo(estrutura, "observacao"), { obrigatorio: true, rotulo: `Obs. ${segmento}` });
      tirar(estrutura, "transportadora_id");
      const r = await criarLayout(familia, estrutura);
      expect(r.statusCode, r.body).toBe(201);
      const l = j(r).id as string;
      await ligar(l, [t]);
      const nome = (await admin.query<{ nome: string }>("select nome from erp.layouts_documento where id=$1", [l])).rows[0]!.nome;
      const g = await efetivo(segmento, `?tipo_operacao_id=${t}`);
      expect(g.statusCode, g.body).toBe(200);
      expect(j(g), segmento).toEqual({ estrutura, origem: "ligado", nome, id: l });
    }
  });

  it("LC-2b padrão da família: vale para a TOP sem layout ligado DAQUELA família; a outra família de compra e vendas seguem no sistema", async () => {
    const tPedido = await top(PEDIDO); const tCompra = await top(COMPRA); const tVenda = await top("vendas.pedido");
    const l = await layout(PEDIDO, (e) => { campo(e, "data_vencimento").obrigatorio = true; });
    try {
      const marcar = await h.app.inject({ method: "POST", url: `${LAYOUTS}/${l}/padrao`, headers: h.headers(), payload: {} });
      expect(marcar.statusCode, marcar.body).toBe(200);
      expect(j(await efetivo("pedidos", `?tipo_operacao_id=${tPedido}`))).toMatchObject({ origem: "padrao_da_familia", id: l });
      expect(j(await efetivo("compras", `?tipo_operacao_id=${tCompra}`)), "o padrão do pedido não vale para a compra").toMatchObject({ origem: "sistema", id: null });
      const venda = await h.app.inject({ method: "GET", url: `/api/sales/orders/layout-efetivo?tipo_operacao_id=${tVenda}`, headers: h.headers() });
      expect(venda.statusCode, venda.body).toBe(200);
      expect(j(venda), "nem para vendas").toMatchObject({ origem: "sistema", id: null });
      // e o padrão é COBRADO ao lançar (a cobrança usa o mesmo layout efetivo)
      const r = await lancar("pedidos", corpoPedido(tPedido));
      expect(r.statusCode, r.body).toBe(422);
      expect(detalhes(r)).toEqual([{ path: "data_vencimento", message: mensagemCampoObrigatorio("Vencimento") }]);
    } finally {
      // Desativar tira o padrão: as outras suítes deste arquivo voltam ao layout do sistema da família.
      const d = await h.app.inject({ method: "POST", url: `${LAYOUTS}/${l}/ativo`, headers: h.headers(), payload: { ativo: false } });
      expect(d.statusCode, d.body).toBe(200);
    }
    expect(j(await efetivo("pedidos", `?tipo_operacao_id=${tPedido}`))).toMatchObject({ origem: "sistema", id: null });
  });

  it("LC-2c TOP ausente, malformada, inexistente, de outra família, inativa, excluída ou de outra organização → a MESMA 404, nas duas espécies", async () => {
    const inativa = await top(COMPRA);
    const rev = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${inativa}`, headers: h.headers() })).revisao as number;
    const desativar = await ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${inativa}`, headers: h.headers(), payload: { ativo: false, revisao: rev } });
    expect(desativar.statusCode, desativar.body).toBe(200);
    const excluida = await top(PEDIDO);
    const rev2 = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${excluida}`, headers: h.headers() })).revisao as number;
    const del = await ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${excluida}?revisao=${rev2}`, headers: h.headers() });
    expect(del.statusCode, del.body).toBe(200);
    const deOutraOrg = await top(COMPRA, {}, outra.headers);
    const validaCompra = await top(COMPRA); const validaPedido = await top(PEDIDO); const venda = await top("vendas.venda");

    const casos: [Segmento, string, string][] = [
      ["compras", "ausente", ""], ["pedidos", "ausente", ""],
      ["compras", "malformada", "?tipo_operacao_id=nao-e-uuid"], ["pedidos", "malformada", "?tipo_operacao_id=123"],
      ["compras", "inexistente", `?tipo_operacao_id=${NAO_ACHADO}`], ["pedidos", "inexistente", `?tipo_operacao_id=${NAO_ACHADO}`],
      ["compras", "de pedido na porta da compra", `?tipo_operacao_id=${validaPedido}`], ["pedidos", "de compra na porta do pedido", `?tipo_operacao_id=${validaCompra}`],
      ["compras", "de vendas", `?tipo_operacao_id=${venda}`], ["pedidos", "de vendas", `?tipo_operacao_id=${venda}`],
      ["compras", "inativa", `?tipo_operacao_id=${inativa}`], ["pedidos", "excluída", `?tipo_operacao_id=${excluida}`],
      ["compras", "de outra organização", `?tipo_operacao_id=${deOutraOrg}`],
    ];
    const corpos = new Set<string>();
    for (const [segmento, caso, query] of casos) {
      const r = await efetivo(segmento, query);
      expect(r.statusCode, `${segmento} ${caso}: ${r.body}`).toBe(404);
      corpos.add(r.body);
    }
    expect(corpos.size, "corpos idênticos em todos os casos, nas duas espécies").toBe(1);
    expect(JSON.parse([...corpos][0]!), "o corpo cravado: nada da TOP sai na recusa").toEqual({ error: { code: "NOT_FOUND", message: "Tipo de operação não encontrado" } });
    // PREMISSAS: as válidas respondem na própria porta; a de outra organização responde lá (a 404 é recorte de tenant).
    expect((await efetivo("compras", `?tipo_operacao_id=${validaCompra}`)).statusCode).toBe(200);
    expect((await efetivo("pedidos", `?tipo_operacao_id=${validaPedido}`)).statusCode).toBe(200);
    expect((await efetivo("compras", `?tipo_operacao_id=${deOutraOrg}`, outra.headers)).statusCode).toBe(200);
  });

  it("LC-2d a porta é `<recurso>.create` da espécie: quem só lança pedido lê o do pedido e recebe 403 no da compra", async () => {
    const tPedido = await top(PEDIDO); const tCompra = await top(COMPRA);
    const soPedido = await membro("So Pedido LC", ["pedidos_compra.view", "pedidos_compra.create"]);
    const doPedido = await efetivo("pedidos", `?tipo_operacao_id=${tPedido}`, soPedido);
    expect(doPedido.statusCode, doPedido.body).toBe(200);
    const daCompra = await efetivo("compras", `?tipo_operacao_id=${tCompra}`, soPedido);
    expect(daCompra.statusCode, daCompra.body).toBe(403);
    // PREMISSA: a mesma TOP responde a quem tem compras.create.
    expect((await efetivo("compras", `?tipo_operacao_id=${tCompra}`)).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------
// LC-3 — cobrança ao salvar
// ---------------------------------------------------------------------------------------------------------
describe("LC-3 — obrigatório do layout vazio → 422 LAYOUT_CAMPO_OBRIGATORIO no campo: lançar pedido, lançar compra e RECEBER", () => {
  it("LC-3a PEDIDO: obrigatórios em 'Dados adicionais', numa aba do rodapé e numa coluna dos itens, com rótulo do layout → 422 nos três caminhos (inclusive `itens[0].armazem_id`), nada gravado; preenchidos → 201", async () => {
    const t = await top(PEDIDO);
    await layout(PEDIDO, (e) => {
      Object.assign(campo(e, "observacao"), { obrigatorio: true, grupo: "adicionais", rotulo: "Obs. do pedido" });
      const tr = tirar(e, "transportadora_id");
      e.rodape.push({ aba: "Entrega", campos: [{ ...tr, obrigatorio: true, rotulo: "Quem entrega" }] });
      // A coluna prova o caminho do ITEM também no pedido (chave `itens` da família de compras, não `items` de vendas).
      Object.assign(coluna(e, "armazem_id"), { obrigatorio: true, rotulo: "Armazém de entrega" });
    }, [t]);
    const antes = await documentosDaOrg();
    const r = await lancar("pedidos", corpoPedido(t));
    expect(r.statusCode, r.body).toBe(422);
    // A ordem é a da estrutura: cabeçalho (inclusive "Dados adicionais"), depois as abas, depois as linhas.
    expect(j(r).error).toEqual({ code: ERRO_LAYOUT_CAMPO_OBRIGATORIO, message: mensagemCampoObrigatorio("Obs. do pedido"), details: [
      { path: "observacao", message: mensagemCampoObrigatorio("Obs. do pedido") },
      { path: "transportadora_id", message: mensagemCampoObrigatorio("Quem entrega") },
      { path: "itens[0].armazem_id", message: mensagemCampoObrigatorio("Armazém de entrega") },
    ] });
    expect(await documentosDaOrg(), "nada gravado").toBe(antes);
    const id = await lancado("pedidos", corpoPedido(t, { observacao: "conferido", transportadora_id: transportadora,
      itens: [{ produto_id: I.product!, armazem_id: I.warehouse, quantidade: "2", valor_unitario: "5.00" }] }));
    const g = (await admin.query<{ observacao: string; transportadora_id: string }>("select observacao, transportadora_id from erp.documentos_compra where id=$1", [id])).rows[0]!;
    expect(g).toEqual({ observacao: "conferido", transportadora_id: transportadora });
    const armazens = (await admin.query<{ armazem_id: string }>("select armazem_id from erp.documentos_compra_itens where documento_id=$1", [id])).rows;
    expect(armazens).toEqual([{ armazem_id: I.warehouse }]);
  });

  it("LC-3b COMPRA: nota e entrada (campos só da compra) e o armazém de cada linha → 422 com `itens[i].armazem_id`; a MESMA estrutura em outra TOP sem layout grava", async () => {
    const t = await top(COMPRA); const semLayout = await top(COMPRA);
    await layout(COMPRA, (e) => {
      Object.assign(campo(e, "numero_nota"), { obrigatorio: true, rotulo: "Nº da NF" });
      campo(e, "data_entrada").obrigatorio = true;
      Object.assign(coluna(e, "armazem_id"), { obrigatorio: true, rotulo: "Depósito" });
    }, [t]);
    const itens: Item[] = [
      { produto_id: I.product2!, armazem_id: I.warehouse, quantidade: "1", valor_unitario: "10.00" },
      { produto_id: I.product!, armazem_id: null, quantidade: "1", valor_unitario: "3.00" },
      { produto_id: I.product!, quantidade: "2", valor_unitario: "3.00" },
    ];
    const antes = await documentosDaOrg();
    const r = await lancar("compras", corpoCompra(t, { itens }));
    expect(r.statusCode, r.body).toBe(422);
    // A ordem é a da estrutura (entrada vem antes da nota no layout do sistema da compra), e as linhas na ordem do corpo;
    // a mensagem do erro é a do primeiro detalhe. Linha com `armazem_id: null` e linha SEM a chave: as duas cobradas.
    expect(j(r).error).toEqual({ code: ERRO_LAYOUT_CAMPO_OBRIGATORIO, message: mensagemCampoObrigatorio("Data de entrada"), details: [
      { path: "data_entrada", message: mensagemCampoObrigatorio("Data de entrada") },
      { path: "numero_nota", message: mensagemCampoObrigatorio("Nº da NF") },
      { path: "itens[1].armazem_id", message: mensagemCampoObrigatorio("Depósito") },
      { path: "itens[2].armazem_id", message: mensagemCampoObrigatorio("Depósito") },
    ] });
    expect(await documentosDaOrg(), "nada gravado").toBe(antes);
    // PREMISSA 1: o MESMO corpo, pela TOP sem layout (layout do sistema), grava — a recusa é do layout, não da compra.
    await lancado("compras", corpoCompra(semLayout, { itens }));
    // PREMISSA 2: preenchido, grava pela TOP com layout.
    const nota = `LC${unico()}`;
    const id = await lancado("compras", corpoCompra(t, { numero_nota: nota, data_entrada: DATA, itens: itens.map((i) => ({ ...i, armazem_id: I.warehouse })) }));
    expect((await admin.query<{ numero_nota: string }>("select numero_nota from erp.documentos_compra where id=$1", [id])).rows[0]!.numero_nota).toBe(nota);
    expect(await documentosDaOrg()).toBe(antes + 2);
  });

  it("LC-3c RECEBER: a compra de destino é cobrada pelo layout da TOP DELA — 422 no campo, pedido intacto; preenchido → 201 e o pedido converte", async () => {
    const topCompra = await top(COMPRA);
    await layout(COMPRA, (e) => {
      Object.assign(campo(e, "numero_nota"), { obrigatorio: true, rotulo: "Nº da NF" });
      coluna(e, "armazem_id").obrigatorio = true;
    }, [topCompra]);
    // A cobrança do recebimento é a da TOP de destino, não a da origem: o layout da TOP do PEDIDO, ligado depois de o
    // pedido ser lançado, exige Observação — e o recebimento sem Observação grava.
    const topPedido = await topPedidoPara(topCompra, false);
    const p = await pedido(topPedido, [
      { produto_id: I.product!, quantidade: "4", valor_unitario: "5.00" },
      { produto_id: I.product2!, quantidade: "1", valor_unitario: "9.00" },
    ]);
    await layout(PEDIDO, (e) => { campo(e, "observacao").obrigatorio = true; }, [topPedido]);
    const antes = await documentosDaOrg();
    const r = await receber(p.id, corpoReceber(topCompra, [
      { item_origem_id: p.itens[0]!.id, quantidade: "4" },
      { item_origem_id: p.itens[1]!.id, quantidade: "1", armazem_id: null },
    ]));
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe(ERRO_LAYOUT_CAMPO_OBRIGATORIO);
    expect(detalhes(r)).toEqual([
      { path: "numero_nota", message: mensagemCampoObrigatorio("Nº da NF") },
      { path: "itens[1].armazem_id", message: mensagemCampoObrigatorio("Local de estoque") },
    ]);
    expect([await documentosDaOrg(), await situacao(p.id), (await comprasDoPedido(p.id)).length], "nada gravado, pedido aberto e sem compra").toEqual([antes, "aberto", 0]);

    const ok = await receber(p.id, corpoReceber(topCompra, [
      { item_origem_id: p.itens[0]!.id, quantidade: "4" },
      { item_origem_id: p.itens[1]!.id, quantidade: "1" },
    ], { numero_nota: `LC${unico()}` }));
    expect(ok.statusCode, `sem Observação (exigida só pelo layout do pedido de origem): ${ok.body}`).toBe(201);
    expect(await situacao(p.id)).toBe("convertido");
    expect((await comprasDoPedido(p.id)).map((c) => c.situacao)).toEqual(["aberto"]);
  });

  it("LC-3d layout do SISTEMA (TOP sem layout) e layout ligado sem obrigatório novo: o documento mínimo grava nas três portas; campo escondido no corpo não é recusado", async () => {
    const semLayout = { compra: await top(COMPRA), pedido: await top(PEDIDO) };
    const comLayout = { compra: await top(COMPRA), pedido: await top(PEDIDO) };
    // Layout que só ESCONDE e renomeia: o servidor cobra só obrigatório vazio — não recusa o que a tela escondeu.
    await layout(COMPRA, (e) => { tirar(e, "transportadora_id"); campo(e, "observacao").rotulo = "Notas"; }, [comLayout.compra]);
    await layout(PEDIDO, (e) => { tirar(e, "transportadora_id"); }, [comLayout.pedido]);
    expect(j(await efetivo("compras", `?tipo_operacao_id=${comLayout.compra}`)).origem, "premissa: o layout está ligado").toBe("ligado");
    expect(j(await efetivo("compras", `?tipo_operacao_id=${semLayout.compra}`)).origem, "premissa: esta TOP cai no sistema").toBe("sistema");

    const minimoCompra = { itens: [{ produto_id: I.product2!, armazem_id: null, quantidade: "1", valor_unitario: "10.00" }] };
    for (const t of [semLayout.compra, comLayout.compra]) {
      const id = await lancado("compras", corpoCompra(t, minimoCompra));
      // o documento REALMENTE foi gravado sem observação, transportadora, vencimento, nota, entrada e armazém
      const g = (await admin.query<Record<string, string | null>>(
        `select d.observacao, d.transportadora_id::text, d.data_vencimento::text, d.numero_nota, d.data_entrada::text, i.armazem_id::text
           from erp.documentos_compra d join erp.documentos_compra_itens i on i.documento_id = d.id where d.id=$1`, [id])).rows;
      expect(g).toEqual([{ observacao: null, transportadora_id: null, data_vencimento: null, numero_nota: null, data_entrada: null, armazem_id: null }]);
      await lancado("compras", corpoCompra(t, { ...minimoCompra, transportadora_id: transportadora }));
    }
    for (const t of [semLayout.pedido, comLayout.pedido]) await lancado("pedidos", corpoPedido(t, { transportadora_id: transportadora }));

    // RECEBER pela TOP de compra com layout só de apresentação: grava, sem nota e sem armazém.
    const p = await pedido(await topPedidoPara(comLayout.compra, false), [{ produto_id: I.product2!, quantidade: "1", valor_unitario: "9.00" }]);
    const c = await receber(p.id, corpoReceber(comLayout.compra, [{ item_origem_id: p.itens[0]!.id, quantidade: "1", armazem_id: null }]));
    expect(c.statusCode, c.body).toBe(201);
  });

  it("LC-3e confirmar a compra e cancelar o pedido e a compra NÃO cobram o layout que passou a exigir depois", async () => {
    const tCompra = await top(COMPRA); const tPedido = await top(PEDIDO);
    const compraId = await lancado("compras", corpoCompra(tCompra));
    const outraCompra = await lancado("compras", corpoCompra(tCompra));
    const pedidoId = await lancado("pedidos", corpoPedido(tPedido));
    await layout(COMPRA, (e) => { campo(e, "observacao").obrigatorio = true; }, [tCompra]);
    await layout(PEDIDO, (e) => { campo(e, "observacao").obrigatorio = true; }, [tPedido]);
    // PREMISSA: os layouts valem — um lançamento novo, igual, é recusado.
    expect(j(await lancar("compras", corpoCompra(tCompra))).error?.code).toBe(ERRO_LAYOUT_CAMPO_OBRIGATORIO);
    expect(j(await lancar("pedidos", corpoPedido(tPedido))).error?.code).toBe(ERRO_LAYOUT_CAMPO_OBRIGATORIO);
    const conf = await h.app.inject({ method: "POST", url: `/api/compras/compras/${compraId}/confirm`, headers: h.headers(), payload: {} });
    expect(conf.statusCode, conf.body).toBe(200);
    expect(await situacao(compraId)).toBe("confirmado");
    for (const [segmento, id] of [["compras", outraCompra], ["pedidos", pedidoId]] as const) {
      const x = await cancelar(segmento, id);
      expect(x.statusCode, `${segmento}: ${x.body}`).toBe(200);
      expect(await situacao(id)).toBe("cancelado");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// LC-4 — padrão de cadastro do Fornecedor
// ---------------------------------------------------------------------------------------------------------
describe("LC-4 — padrão de CADASTRO do Fornecedor (is_provider) e do Armazém da compra", () => {
  const comPadrao = (familia: string, padroes: { fornecedor?: string; armazem?: string; categoria?: string; warehouse?: string }): EstruturaLayout => {
    const e = structuredClone(LAYOUT_DO_SISTEMA(familia));
    if (padroes.fornecedor) campo(e, "fornecedor_id").valorPadrao = { tipo: "registro", id: padroes.fornecedor };
    if (padroes.categoria) campo(e, "categoria_financeira_id").valorPadrao = { tipo: "registro", id: padroes.categoria };
    if (padroes.armazem) coluna(e, "armazem_id").valorPadrao = { tipo: "registro", id: padroes.armazem };
    return e;
  };

  it("LC-4a fornecedor válido grava; cliente que não é fornecedor, inativo, de outra organização e inexistente → a MESMA 422 no caminho, nada gravado", async () => {
    const ok = await criarLayout(COMPRA, comPadrao(COMPRA, { fornecedor: I.provider, armazem: I.warehouse }));
    expect(ok.statusCode, ok.body).toBe(201);

    const soCliente = (await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_client and not is_provider and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]?.id;
    if (!soCliente) throw new Error("premissa: o seed tem cliente que não é fornecedor");
    const inativo = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: `LC Fornecedor inativo ${unico()}`, person_type: "legal", is_provider: true } });
    expect(inativo.statusCode, inativo.body).toBe(201);
    await admin.query("update erp.people set is_active=false where id=$1", [j(inativo).id]);

    const caminho = caminhoDoPadrao(COMPRA, "fornecedor_id", "cabecalho");
    const antes = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n);
    const corpos = new Set<string>();
    for (const [nome, id] of [["só cliente", soCliente], ["inativo", j(inativo).id as string], ["de outra organização", outra.fornecedor], ["inexistente", NAO_ACHADO]] as const) {
      const r = await criarLayout(COMPRA, comPadrao(COMPRA, { fornecedor: id }));
      expect(r.statusCode, `${nome}: ${r.body}`).toBe(422);
      expect(detalhes(r), nome).toEqual([{ path: caminho, message: mensagemRegistroPadraoInvalido("Fornecedor") }]);
      corpos.add(JSON.stringify(j(r).error));
    }
    expect(corpos.size, "a mesma recusa para os quatro casos").toBe(1);
    expect(Number((await admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id=$1", [h.demo.orgId])).rows[0]!.n)).toBe(antes);
  });

  it("LC-4b layout-efetivo: padroesDeCadastro com o rótulo do Fornecedor e a empresa do Armazém; estrutura SEM registro; inativar o fornecedor o move para padroesInvalidos", async () => {
    const f = await h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers(), payload: { name: `LC Fornecedor padrão ${unico()}`, person_type: "legal", is_provider: true } });
    expect(f.statusCode, f.body).toBe(201);
    const fornecedor = j(f).id as string;
    const nomeFornecedor = (await admin.query<{ name: string }>("select name from erp.people where id=$1", [fornecedor])).rows[0]!.name;
    const armazem = (await admin.query<{ description: string; empresa_id: string }>("select description, empresa_id from erp.warehouses where id=$1", [I.warehouse])).rows[0]!;
    const t = await top(COMPRA);
    const r = await criarLayout(COMPRA, comPadrao(COMPRA, { fornecedor, armazem: I.warehouse }));
    expect(r.statusCode, r.body).toBe(201);
    await ligar(j(r).id as string, [t]);

    const g = await efetivo("compras", `?tipo_operacao_id=${t}`);
    expect(g.statusCode, g.body).toBe(200);
    const b = j(g) as { estrutura: EstruturaLayout; padroesDeCadastro: Record<string, unknown>; padroesInvalidos: string[] };
    expect(b.padroesDeCadastro).toEqual({
      fornecedor_id: { id: fornecedor, rotulo: nomeFornecedor },
      "itens.armazem_id": { id: I.warehouse, rotulo: armazem.description, empresaId: armazem.empresa_id },
    });
    expect(b.padroesInvalidos).toEqual([]);
    expect(JSON.stringify(b.estrutura), "a estrutura sai sem os padrões de cadastro").not.toContain("\"registro\"");

    await admin.query("update erp.people set is_active=false where id=$1", [fornecedor]);
    try {
      const d = j(await efetivo("compras", `?tipo_operacao_id=${t}`)) as { padroesDeCadastro: Record<string, unknown>; padroesInvalidos: string[] };
      expect(Object.keys(d.padroesDeCadastro)).toEqual(["itens.armazem_id"]);
      expect(d.padroesInvalidos).toEqual(["fornecedor_id"]);
    } finally {
      await admin.query("update erp.people set is_active=true where id=$1", [fornecedor]);
    }
  });

  it("LC-4c Natureza de despesa não aceita padrão de cadastro nesta fatia; o pedido aceita o Fornecedor; em vendas, fornecedor no Cliente é recusado", async () => {
    const natureza = await criarLayout(COMPRA, comPadrao(COMPRA, { categoria: I.category }));
    expect(natureza.statusCode, natureza.body).toBe(422);
    expect(detalhes(natureza).map((d) => d.path)).toEqual([caminhoDoPadrao(COMPRA, "categoria_financeira_id", "cabecalho")]);
    const doPedido = await criarLayout(PEDIDO, comPadrao(PEDIDO, { fornecedor: I.provider, armazem: I.warehouse }));
    expect(doPedido.statusCode, doPedido.body).toBe(201);
    // Vendas não mudou: o Cliente continua pedindo `is_client` — um fornecedor que não é cliente é recusado lá.
    const soFornecedor = (await admin.query<{ id: string }>("select id from erp.people where organization_id=$1 and is_provider and not is_client and deleted_at is null order by code limit 1", [h.demo.orgId])).rows[0]?.id;
    if (!soFornecedor) throw new Error("premissa: o seed tem fornecedor que não é cliente");
    const venda = structuredClone(LAYOUT_DO_SISTEMA("vendas.venda"));
    campo(venda, "client_id").valorPadrao = { tipo: "registro", id: soFornecedor };
    const rv = await criarLayout("vendas.venda", venda);
    expect(rv.statusCode, rv.body).toBe(422);
    expect(detalhes(rv)).toEqual([{ path: caminhoDoPadrao("vendas.venda", "client_id", "cabecalho"), message: mensagemRegistroPadraoInvalido("Cliente") }]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// LC-5 — regras da operação com os três flags
// ---------------------------------------------------------------------------------------------------------
describe("LC-5 — regras-da-operacao: exigeFormaPagamento, exigeVencimento e exigeArmazem, os MESMOS que o lançamento cobra", () => {
  const regras = (segmento: Segmento, t: string, app: FastifyInstance = ligada) =>
    app.inject({ method: "GET", url: `/api/compras/${segmento}/regras-da-operacao?tipo_operacao_id=${t}`, headers: h.headers() });
  const flags = (r: Resposta) => { const b = j(r); return { exigeFormaPagamento: b.exigeFormaPagamento, exigeVencimento: b.exigeVencimento, exigeArmazem: b.exigeArmazem }; };
  const TODOS_FALSOS = { exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false };
  function configurada(o: { forma?: boolean; vencimento?: boolean; armazem?: boolean }) {
    const c = configuracaoNeutraTopV3();
    c.execucao = { estoque: "configurada", financeiro: "configurada" };
    c.estoque.atualizacao = "entrada";
    c.estoque.exigeArmazem = Boolean(o.armazem);
    c.financeiro.atualizacao = "pagar";
    c.financeiro.exigeFormaPagamento = Boolean(o.forma);
    c.financeiro.exigeVencimento = Boolean(o.vencimento);
    return c;
  }

  it("LC-5a compra configurada com os três → true, e o lançamento cobra cada um no mesmo campo; padrão, pedido e gate desligado → false", async () => {
    const t = await top(COMPRA, { configuracao: configurada({ forma: true, vencimento: true, armazem: true }) });
    const r = await regras("compras", t);
    expect(r.statusCode, r.body).toBe(200);
    expect(flags(r)).toEqual({ exigeFormaPagamento: true, exigeVencimento: true, exigeArmazem: true });
    expect(j(r).geraTitulos).toBe(true);
    // Os MESMOS do lançamento: sem armazém → recusa no item; com armazém e sem forma → na forma; sem vencimento → no vencimento.
    const semArmazem = await lancar("compras", corpoCompra(t, { itens: [{ produto_id: I.product2!, armazem_id: null, quantidade: "1", valor_unitario: "10.00" }] }), ligada);
    expect(semArmazem.statusCode, semArmazem.body).toBe(422);
    expect(detalhes(semArmazem).map((d) => d.path)).toEqual(["itens[0].armazem_id"]);
    const semForma = await lancar("compras", corpoCompra(t, { data_vencimento: "2026-10-10" }), ligada);
    expect(semForma.statusCode, semForma.body).toBe(422);
    expect(detalhes(semForma).map((d) => d.path)).toEqual(["forma_pagamento_id"]);
    const forma = (await admin.query<{ id: string }>("select id from erp.payment_methods where (organization_id=$1 or organization_id is null) and is_active order by name, id limit 1", [h.demo.orgId])).rows[0]!.id;
    const semVencimento = await lancar("compras", corpoCompra(t, { forma_pagamento_id: forma }), ligada);
    expect(semVencimento.statusCode, semVencimento.body).toBe(422);
    expect(detalhes(semVencimento).map((d) => d.path)).toEqual(["data_vencimento"]);
    await lancado("compras", corpoCompra(t, { forma_pagamento_id: forma, data_vencimento: "2026-10-10" }), ligada);

    // Cada flag sozinho: o que a TOP declara é o que a rota diz.
    for (const um of ["forma", "vencimento", "armazem"] as const) {
      const x = await regras("compras", await top(COMPRA, { configuracao: configurada({ [um]: true }) }));
      expect(flags(x), um).toEqual({ exigeFormaPagamento: um === "forma", exigeVencimento: um === "vencimento", exigeArmazem: um === "armazem" });
    }
    // Padrão (sem execução configurada) e PEDIDO (sem efeito) → os três falsos.
    expect(flags(await regras("compras", await top(COMPRA)))).toEqual(TODOS_FALSOS);
    expect(flags(await regras("pedidos", await top(PEDIDO)))).toEqual(TODOS_FALSOS);
    // Com o gate da execução configurada desligado a política não resolve: a rota não promete o que a confirmação recusaria.
    expect(flags(await regras("compras", t, h.app))).toEqual(TODOS_FALSOS);
  });

  it("LC-5b é a versão ATUAL da TOP: a nova versão sem as exigências desliga os flags", async () => {
    const t = await top(COMPRA, { configuracao: configurada({ forma: true, vencimento: true, armazem: true }) });
    expect(flags(await regras("compras", t))).toEqual({ exigeFormaPagamento: true, exigeVencimento: true, exigeArmazem: true });
    const rev = j(await ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${t}`, headers: h.headers() })).revisao as number;
    const nova = await ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${t}`, headers: h.headers(), payload: { configuracao: configurada({}), revisao: rev } });
    expect(nova.statusCode, nova.body).toBe(200);
    expect(flags(await regras("compras", t))).toEqual(TODOS_FALSOS);
    // e o lançamento deixa de cobrar: sem armazém, sem forma e sem vencimento, grava.
    await lancado("compras", corpoCompra(t, { itens: [{ produto_id: I.product2!, armazem_id: null, quantidade: "1", valor_unitario: "10.00" }] }), ligada);
  });
});

// ---------------------------------------------------------------------------------------------------------
// LC-6 — item 0 a) c) d)
// ---------------------------------------------------------------------------------------------------------
describe("LC-6 — item 0: a) os três casos do cancelamento do pedido; c) UUID em maiúsculas; d) confirmar sem título", () => {
  const corpo409 = (message: string) => ({ error: { code: "CONFLICT", message } });
  const TEM_COMPRAS = corpo409("Este pedido tem compras: cancele-as ou encerre o saldo.");
  const TEM_COMPRAS_CONVERTIDO = corpo409("Este pedido tem compras: cancele-as primeiro.");
  const CONVERTIDO = corpo409("Este pedido já foi convertido em compra e não é cancelado.");

  it("LC-6a aberto com compra viva → cancele-as ou encerre; convertido SEM saldo encerrado com compra viva → cancele-as primeiro; convertido COM saldo encerrado, com e sem compra viva → não é cancelado", async () => {
    const topCompra = await top(COMPRA);
    const topPedido = await topPedidoPara(topCompra, true);

    // aberto com compra viva (recebido em parte)
    const aberto = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "5", valor_unitario: "5.00" }]);
    expect((await receber(aberto.id, corpoReceber(topCompra, [{ item_origem_id: aberto.itens[0]!.id, quantidade: "2" }]))).statusCode).toBe(201);
    expect(await situacao(aberto.id), "premissa").toBe("aberto");
    const rAberto = await cancelar("pedidos", aberto.id);
    expect(rAberto.statusCode, rAberto.body).toBe(409);
    expect(JSON.parse(rAberto.body)).toEqual(TEM_COMPRAS);

    // convertido pelo saldo zerado (sem saldo encerrado), com a compra viva
    const cheio = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "3", valor_unitario: "5.00" }]);
    const recCheio = await receber(cheio.id, corpoReceber(topCompra, [{ item_origem_id: cheio.itens[0]!.id, quantidade: "3" }]));
    expect(recCheio.statusCode, recCheio.body).toBe(201);
    expect(await situacao(cheio.id), "premissa").toBe("convertido");
    const rCheio = await cancelar("pedidos", cheio.id);
    expect(rCheio.statusCode, rCheio.body).toBe(409);
    expect(JSON.parse(rCheio.body)).toEqual(TEM_COMPRAS_CONVERTIDO);
    expect(await situacao(cheio.id)).toBe("convertido");
    // o caminho que a mensagem aponta existe: cancelada a compra, o pedido reabre e se cancela
    expect((await cancelar("compras", (j(recCheio) as { id: string }).id)).statusCode).toBe(200);
    expect(await situacao(cheio.id)).toBe("aberto");
    expect((await cancelar("pedidos", cheio.id)).statusCode).toBe(200);

    // convertido por saldo ENCERRADO: com a compra viva e, cancelada ela (não reabre), sem — a mensagem do convertido
    const encerrado = await pedido(topPedido, [{ produto_id: I.product!, quantidade: "6", valor_unitario: "5.00" }]);
    const rec = await receber(encerrado.id, corpoReceber(topCompra, [{ item_origem_id: encerrado.itens[0]!.id, quantidade: "1" }]));
    expect(rec.statusCode, rec.body).toBe(201);
    const enc = await h.app.inject({ method: "POST", url: `/api/compras/pedidos/${encerrado.id}/encerrar-saldo`, headers: h.headers(), payload: { motivo: "o resto não vem" } });
    expect(enc.statusCode, enc.body).toBe(200);
    expect(await situacao(encerrado.id), "premissa").toBe("convertido");
    const rEncerrado = await cancelar("pedidos", encerrado.id);
    expect(rEncerrado.statusCode, rEncerrado.body).toBe(409);
    expect(JSON.parse(rEncerrado.body), "encerrado, com compra viva").toEqual(CONVERTIDO);
    expect((await cancelar("compras", (j(rec) as { id: string }).id)).statusCode).toBe(200);
    expect(await situacao(encerrado.id), "saldo encerrado: cancelar a compra não reabre").toBe("convertido");
    const semCompraViva = await cancelar("pedidos", encerrado.id);
    expect(semCompraViva.statusCode, semCompraViva.body).toBe(409);
    expect(JSON.parse(semCompraViva.body), "encerrado, sem compra viva").toEqual(CONVERTIDO);
    expect(await situacao(encerrado.id)).toBe("convertido");
  });

  it("LC-6c receber com o :id, a TOP de destino, os itens de origem e o armazém em MAIÚSCULAS → 201; reenviado em minúsculas com a mesma chave é o mesmo recebimento", async () => {
    const topCompra = await top(COMPRA);
    const p = await pedido(await topPedidoPara(topCompra, true), [
      { produto_id: I.product!, quantidade: "5", valor_unitario: "5.00" },
      { produto_id: I.product2!, quantidade: "2", valor_unitario: "7.00" },
    ]);
    const [a, b] = p.itens;
    const chave = `lc6c-${unico()}`;
    const corpo = (caixa: (s: string) => string) => corpoReceber(caixa(topCompra), [
      { item_origem_id: caixa(a!.id), quantidade: "2", armazem_id: caixa(I.warehouse!) },
      { item_origem_id: caixa(b!.id), quantidade: "2", armazem_id: caixa(I.warehouse!) },
    ]);
    const r = await receber(p.id.toUpperCase(), corpo((s) => s.toUpperCase()), h.headers({ "idempotency-key": chave }));
    expect(r.statusCode, r.body).toBe(201);
    const compra = (j(r) as { id: string }).id;

    const replay = await receber(p.id, corpo((s) => s.toLowerCase()), h.headers({ "idempotency-key": chave }));
    expect(replay.statusCode, replay.body).toBe(201);
    expect((j(replay) as { id: string }).id, "o mesmo recebimento").toBe(compra);
    expect((await comprasDoPedido(p.id)).length, "uma compra só").toBe(1);
  });

  it("LC-6c2 lançar compra com armazém e condição (restrita pela TOP) em MAIÚSCULAS → 201; o reenvio em minúsculas com a mesma chave é a mesma compra", async () => {
    const cond = (await admin.query<{ id: string }>(
      "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,1,30,'intervalo',30,false) returning id",
      [h.demo.orgId, `LC6-${unico()}`, `Condição LC6 ${unico()}`])).rows[0]!.id;
    const t = await top(COMPRA, { configuracao: configuracaoNeutraTopV3(), condicoesPermitidas: [cond] });
    const corpo = (caixa: (s: string) => string) => corpoCompra(caixa(t), { condicao_pagamento_id: caixa(cond),
      itens: [{ produto_id: caixa(I.product2!), armazem_id: caixa(I.warehouse!), quantidade: "1", valor_unitario: "10.00" }] });
    const chave = `lc6c2-${unico()}`;
    const r = await lancar("compras", corpo((s) => s.toUpperCase()), h.app, h.headers({ "idempotency-key": chave }));
    expect(r.statusCode, `sem "Armazém inválido" nem condição não permitida falsos: ${r.body}`).toBe(201);
    const antes = await documentosDaOrg();
    const replay = await lancar("compras", corpo((s) => s.toLowerCase()), h.app, h.headers({ "idempotency-key": chave }));
    expect(replay.statusCode, replay.body).toBe(201);
    expect((j(replay) as { id: string }).id, "a mesma compra").toBe((j(r) as { id: string }).id);
    expect(await documentosDaOrg()).toBe(antes);
  });

  it("LC-6d compra que NÃO gera título (valor zero) confirma sem forma e sem vencimento, mesmo com a TOP os exigindo; com valor, o salvar exige", async () => {
    const c = configuracaoNeutraTopV3();
    c.execucao = { estoque: "configurada", financeiro: "configurada" };
    c.estoque.atualizacao = "entrada";
    c.financeiro.atualizacao = "pagar";
    c.financeiro.exigeFormaPagamento = true;
    c.financeiro.exigeVencimento = true;
    const t = await top(COMPRA, { configuracao: c });
    // PREMISSA: com valor, a exigência vale ao salvar.
    const comValor = await lancar("compras", corpoCompra(t), ligada);
    expect(comValor.statusCode, comValor.body).toBe(422);
    expect(detalhes(comValor).map((d) => d.path)).toEqual(["forma_pagamento_id"]);

    const id = await lancado("compras", corpoCompra(t, { itens: [{ produto_id: I.product2!, armazem_id: I.warehouse, quantidade: "3", valor_unitario: "0" }] }), ligada);
    const previa = await ligada.inject({ method: "GET", url: `/api/compras/compras/${id}/previa-confirmacao`, headers: h.headers() });
    expect(previa.statusCode, previa.body).toBe(200);
    expect(j(previa).podeConfirmar, previa.body).toBe(true);
    const conf = await ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/confirm`, headers: h.headers(), payload: {} });
    expect(conf.statusCode, conf.body).toBe(200);
    expect(await situacao(id)).toBe("confirmado");
    const titulos = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.financial_titles where source_type='documentos_compra' and source_id=$1", [id])).rows[0]!.n);
    const entradas = Number((await admin.query<{ n: string }>("select count(*)::text n from erp.stock_movements where source_type='documentos_compra' and source_id=$1", [id])).rows[0]!.n);
    expect({ titulos, entradas }, "valor zero: entrada no estoque, nenhum título").toEqual({ titulos: 0, entradas: 1 });
  });
});
