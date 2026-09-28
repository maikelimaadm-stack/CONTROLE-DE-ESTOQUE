import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, type Db } from "@agro/db";
import {
  CHAVES_MODULO_EMPRESA, LAYOUT_DO_SISTEMA, ERRO_LAYOUT_CAMPO_OBRIGATORIO, ERRO_CONDICAO_PAGAMENTO_INVALIDA,
  configuracaoNeutraTopV3, configuracaoTopParaEdicao,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA,
  MENSAGEM_CONDICAO_NAO_PERMITIDA, ERRO_CLIENTE_EM_ATRASO,
  type ConfiguracaoTipoOperacaoV3,
} from "@agro/domain";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP-CONFIG-05 — AS REGRAS DA OPERAÇÃO NO POST E NO PUT DE VENDA (decisão 263).
 *
 * Fixtures de versão do formato 3 são criadas por SQL como superusuário (não dependem da API de TOP):
 * a TOP nasce pela API administrativa (formato de hoje) e ganha uma versão nova, gravada à mão, que vira a atual.
 * PROVA: status, código, mensagem e detalhes da recusa, e contagem de documentos lida sem RLS.
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
let transportadora: string; let limpo: string; let devedor: string;
beforeAll(async () => {
  h = await harness();
  I = await ids(h);
  await comPool(async (c) => {
    transportadora = (await c.query<{ id: string }>("select id from erp.people where organization_id=$1 order by is_transporter desc, code limit 1", [h.demo.orgId])).rows[0]!.id;
    // Clientes PRÓPRIOS da suíte: nenhum título herdado do seed decide o resultado.
    const cliente = async (n: number) => (await c.query<{ id: string }>(
      "insert into erp.people(organization_id,code,document,person_type,name,legal_name,city_id,is_client) values ($1,$2,$3,'legal',$4,$4,5208707,true) returning id",
      [h.demo.orgId, `T05${n}`, `9905000000000${n}`, `[TEST] Cliente T05 ${n}`])).rows[0]!.id;
    limpo = await cliente(1); devedor = await cliente(2);
  });
}, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
type Erro = { code: string; message: string; details?: unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: Erro };
type Hdr = Record<string, string>;

async function comPool<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  const c = createPool(TEST_URL, { max: 1 });
  try { return await fn(c); } finally { await c.end(); }
}

let seq = 0;
/** TOP de pedido pela API (formato de hoje) e, por cima, uma versão NOVA gravada por SQL que vira a atual. */
async function topCom(config: ConfiguracaoTipoOperacaoV3, o: { formato?: 2 | 3; condicoes?: string[] } = {}): Promise<{ id: string; versaoId: string }> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: `95${String(++seq).padStart(2, "0")}`, codigoBase: "vendas.pedido", nome: `TOP 05 ${seq}` } });
  expect(r.statusCode, r.body).toBe(201);
  const id = j(r).id as string;
  const versaoId = await novaVersao(id, config, o);
  return { id, versaoId };
}
async function novaVersao(topId: string, config: ConfiguracaoTipoOperacaoV3, o: { formato?: 2 | 3; condicoes?: string[] } = {}): Promise<string> {
  const formato = o.formato ?? 3;
  const gravar = formato === 3 ? config : configuracaoTopParaEdicao(config);
  return comPool(async (c) => {
    const v = (await c.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
       select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.descricao, v.criado_por, $2::jsonb, $3, v.destinos_configurados
         from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
        where t.id = $1 returning id`, [topId, JSON.stringify(gravar), formato])).rows[0]!.id;
    await c.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [topId]);
    for (const cond of o.condicoes ?? []) {
      await c.query("insert into erp.tipos_operacao_versao_condicoes(organization_id,origem_versao_id,origem_tipo_operacao_id,condicao_pagamento_id) values ($1,$2,$3,$4)",
        [h.demo.orgId, v, topId, cond]);
    }
    return v;
  });
}
function cfg(ajuste: (c: ConfiguracaoTipoOperacaoV3) => void): ConfiguracaoTipoOperacaoV3 {
  const c = configuracaoNeutraTopV3();
  ajuste(c);
  return c;
}
async function condicao(): Promise<string> {
  const n = ++seq;
  return comPool(async (db) => (await db.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,1,30,'intervalo',30,null,false,null,true) returning id",
    [h.demo.orgId, `T05-${n}`, `Condição T05 ${n}`])).rows[0]!.id);
}

const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: I.empresa, document_date: "2026-09-10", client_id: limpo,
  items: [{ product_id: I.product2!, warehouse_id: I.warehouse!, quantity: "1", unit_price: "10.00" }], ...extra });
const criar = (extra: Record<string, unknown> = {}, headers: Hdr = h.headers()) =>
  h.app.inject({ method: "POST", url: "/api/sales/orders", headers, payload: corpo(extra) });
const editar = (id: string, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: "PUT", url: `/api/sales/orders/${id}`, headers: h.headers(), payload: corpo(extra) });
async function criado(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await criar(extra);
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const documentosDaOrg = () => comPool(async (c) => Number((await c.query<{ n: string }>("select count(*)::text n from erp.sales_documents where organization_id=$1", [h.demo.orgId])).rows[0]!.n));

describe("TR-A3 exigências gerais da versão formato 3", () => {
  it("TR-A3 transportadora, observação e centro faltando → 422 com um detalhe por campo; nada gravado", async () => {
    const top = await topCom(cfg((c) => { c.geral.exigeTransportadora = true; c.geral.exigeObservacao = true; c.geral.exigeCentroResultado = true; }));
    const antes = await documentosDaOrg();
    const r = await criar({ tipo_operacao_id: top.id, note: "   " });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual({ code: ERRO_EXIGENCIA_NAO_ATENDIDA, message: MENSAGEM_EXIGENCIA_NAO_ATENDIDA, details: { exigencias: [
      { caminho: "centro_custo_id", mensagem: "Centro de resultado é obrigatório nesta operação." },
      { caminho: "note", mensagem: "Observação é obrigatório nesta operação." },
      { caminho: "transporter_id", mensagem: "Transportadora é obrigatório nesta operação." },
    ].sort((a, b) => a.caminho.localeCompare(b.caminho)) } });
    expect(await documentosDaOrg()).toBe(antes);
  });

  it("TR-A3 as MESMAS exigências numa versão formato 2 → 201 (legado não executa)", async () => {
    const top = await topCom(cfg((c) => { c.geral.exigeObservacao = true; c.geral.exigeCentroResultado = true; }), { formato: 2 });
    await criado({ tipo_operacao_id: top.id });
  });

  it("TR-A3 atendidas → 201", async () => {
    const top = await topCom(cfg((c) => { c.geral.exigeTransportadora = true; c.geral.exigeObservacao = true; }));
    await criado({ tipo_operacao_id: top.id, transporter_id: transportadora, note: "entregar pela manhã" });
  });

  it("TR-A3 ordem: condição inválida ANTES; layout obrigatório DEPOIS", async () => {
    const top = await topCom(cfg((c) => { c.geral.exigeObservacao = true; }));
    const inexistente = "00000000-0000-4000-8000-000000000505";
    const r1 = await criar({ tipo_operacao_id: top.id, condicao_pagamento_id: inexistente });
    expect(r1.statusCode, r1.body).toBe(422);
    expect(j(r1).error!.code).toBe(ERRO_CONDICAO_PAGAMENTO_INVALIDA);
    // Layout ligado à TOP que exige um campo do cabeçalho que o documento não traz.
    const e = LAYOUT_DO_SISTEMA("vendas.pedido");
    const livres = new Set(["client_id", "transporter_id", "note", "centro_custo_id", "categoria_financeira_id", "empresa_id", "document_date", "tipo_operacao_id", "condicao_pagamento_id"]);
    const alvo = [...e.cabecalho, ...e.rodape.flatMap((a) => a.campos)].find((x) => !livres.has(x.campo) && !x.obrigatorio)!;
    for (const x of [...e.cabecalho, ...e.rodape.flatMap((a) => a.campos)]) {
      if (x.campo === "categoria_financeira_id" || x.campo === "centro_custo_id") x.obrigatorio = false;
      if (x.campo === alvo.campo) x.obrigatorio = true;
    }
    const n = ++seq;
    await comPool(async (c) => {
      const l = (await c.query<{ id: string }>("insert into erp.layouts_documento(organization_id,code,nome,familia,padrao,estrutura) values ($1,$2,$3,'vendas.pedido',false,$4) returning id",
        [h.demo.orgId, `LT05-${n}`, `Layout T05 ${n}`, JSON.stringify(e)])).rows[0]!.id;
      await c.query("insert into erp.layout_documento_tops(organization_id,layout_id,tipo_operacao_id) values ($1,$2,$3)", [h.demo.orgId, l, top.id]);
    });
    const r2 = await criar({ tipo_operacao_id: top.id });
    expect(r2.statusCode, r2.body).toBe(422);
    expect(j(r2).error!.code, "exigência da operação vem antes do layout").toBe(ERRO_EXIGENCIA_NAO_ATENDIDA);
    const r3 = await criar({ tipo_operacao_id: top.id, note: "ok" });
    expect(r3.statusCode, r3.body).toBe(422);
    expect(j(r3).error!.code, `layout exige ${alvo.campo}`).toBe(ERRO_LAYOUT_CAMPO_OBRIGATORIO);
  });

  it("TR-A3 PUT cobra a versão em que o documento NASCEU, não a atual", async () => {
    const top = await topCom(cfg((c) => { c.geral.exigeObservacao = true; }));
    const id = await criado({ tipo_operacao_id: top.id, note: "nasceu com observação" });
    await novaVersao(top.id, configuracaoNeutraTopV3()); // a atual deixa de exigir
    const r = await editar(id, { note: null });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: ERRO_EXIGENCIA_NAO_ATENDIDA, details: { exigencias: [{ caminho: "note" }] } });
    // E o inverso: nasceu sem exigência, a atual exige → o PUT sem observação passa.
    const top2 = await topCom(configuracaoNeutraTopV3());
    const id2 = await criado({ tipo_operacao_id: top2.id });
    await novaVersao(top2.id, cfg((c) => { c.geral.exigeObservacao = true; }));
    const r2 = await editar(id2, {});
    expect(r2.statusCode, r2.body).toBe(200);
  });
});

describe("TR-A4 condição permitida e cliente em atraso", () => {
  it("TR-A4 condição fora da lista → 422; na lista → 201; versão sem linhas → qualquer", async () => {
    const [c1, c2] = [await condicao(), await condicao()];
    const top = await topCom(configuracaoNeutraTopV3(), { condicoes: [c1] });
    const antes = await documentosDaOrg();
    const r = await criar({ tipo_operacao_id: top.id, condicao_pagamento_id: c2 });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual({ code: ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, message: MENSAGEM_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } });
    expect(await documentosDaOrg()).toBe(antes);
    await criado({ tipo_operacao_id: top.id, condicao_pagamento_id: c1 });
    const livre = await topCom(configuracaoNeutraTopV3());
    await criado({ tipo_operacao_id: livre.id, condicao_pagamento_id: c2 });
  });

  it("TR-A4 PUT sem condição não confere; PUT com condição fora da lista → 422", async () => {
    const [c1, c2] = [await condicao(), await condicao()];
    const top = await topCom(configuracaoNeutraTopV3(), { condicoes: [c1] });
    const id = await criado({ tipo_operacao_id: top.id, condicao_pagamento_id: c1 });
    // Documento com condição que a versão não permite (acervo): o PUT que não envia condição não a reconfere.
    await comPool((c) => c.query("update erp.sales_documents set condicao_pagamento_id=$2 where id=$1", [id, c2]));
    const r1 = await editar(id, {});
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await editar(id, { condicao_pagamento_id: c2 });
    expect(r2.statusCode, r2.body).toBe(422);
    expect(j(r2).error!.code).toBe(ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA);
  });

  it("TR-A4 atraso: bloqueia (mensagem exata), tolerância cobre, avisa passa, PUT troca/mantém, usuário só de vendas também é bloqueado", async () => {
    const bloqueia = await topCom(cfg((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; }));
    // Nasce ANTES do título vencido: é o documento do PUT que mantém o cliente.
    const docDoDevedor = await criado({ tipo_operacao_id: bloqueia.id, client_id: devedor });
    const docDoLimpo = await criado({ tipo_operacao_id: bloqueia.id, client_id: limpo });
    // Título a receber vencido há 10 dias, na EMPRESA 2 (fora do escopo do usuário só de vendas).
    const venc = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await comPool((c) => c.query(
      "insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,person_id,amount,emission_date,due_date) values ($1,$2,$3,'receivable',$4,$5,'1234.50',$6,$6)",
      [h.demo.orgId, I.empresa2, `T05-ATR-${Date.now()}`, "T05-ATRASO", devedor, venc]));
    const [a, m, d] = venc.split("-");
    const mensagem = `O cliente tem 1 título(s) vencido(s), total R$ 1.234,50, o mais antigo de ${d}/${m}/${a}. Esta operação não aceita cliente em atraso.`;
    const antes = await documentosDaOrg();
    const r = await criar({ tipo_operacao_id: bloqueia.id, client_id: devedor });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toEqual({ code: ERRO_CLIENTE_EM_ATRASO, message: mensagem,
      details: { campo: "client_id", titulos: 1, total: "1234.50", vencimentoMaisAntigo: venc } });
    expect(await documentosDaOrg()).toBe(antes);
    // Tolerância que cobre os 10 dias → passa; que não cobre → bloqueia.
    const tolera = await topCom(cfg((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; c.financeiro.toleranciaAtrasoDias = 30; }));
    await criado({ tipo_operacao_id: tolera.id, client_id: devedor });
    const curta = await topCom(cfg((c) => { c.financeiro.clienteEmAtraso = "bloqueia"; c.financeiro.toleranciaAtrasoDias = 5; }));
    expect((await criar({ tipo_operacao_id: curta.id, client_id: devedor })).statusCode).toBe(422);
    // "avisa" nunca recusa.
    const avisa = await topCom(cfg((c) => { c.financeiro.clienteEmAtraso = "avisa"; }));
    await criado({ tipo_operacao_id: avisa.id, client_id: devedor });
    // PUT trocando para o cliente em atraso → 422; PUT mantendo o cliente → não confere.
    const t1 = await editar(docDoLimpo, { client_id: devedor });
    expect(t1.statusCode, t1.body).toBe(422);
    expect(j(t1).error!.code).toBe(ERRO_CLIENTE_EM_ATRASO);
    const t2 = await editar(docDoDevedor, { client_id: devedor, note: "mantém o cliente" });
    expect(t2.statusCode, t2.body).toBe(200);
    // Porta estreita: usuário SÓ de vendas, sem nenhuma permissão financeira, escopo só na empresa 1.
    const token = await usuarioSoDeVendas(`t05-vendas-${Date.now()}@teste.local`, [I.empresa]);
    const cab = { authorization: `Bearer ${token}`, "x-org-id": h.demo.orgId };
    const semPermissaoFinanceira = await h.app.inject({ method: "GET", url: "/api/financial/receivables", headers: cab });
    expect(semPermissaoFinanceira.statusCode, "premissa: o usuário não lê o financeiro").toBe(403);
    const rv = await criar({ tipo_operacao_id: bloqueia.id, client_id: devedor }, cab);
    expect(rv.statusCode, rv.body).toBe(422);
    expect(j(rv).error).toEqual({ code: ERRO_CLIENTE_EM_ATRASO, message: mensagem,
      details: { campo: "client_id", titulos: 1, total: "1234.50", vencimentoMaisAntigo: venc } });
    // Premissa: o mesmo usuário lança para o cliente sem atraso.
    const ok = await criar({ tipo_operacao_id: bloqueia.id, client_id: limpo }, cab);
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

async function usuarioSoDeVendas(email: string, empresas: string[]): Promise<string> {
  await comPool(async (admin) => {
    const hash = (await admin.query<{ password_hash: string }>("select password_hash from erp.users where email='operador@demo.local'")).rows[0]!.password_hash;
    const papel = (await admin.query<{ id: string }>("insert into erp.roles(organization_id,name) values ($1,$2) returning id", [h.demo.orgId, `[TEST] ${email}`])).rows[0]!.id;
    for (const k of ["orders.create", "orders.view", "orders.edit"]) await admin.query("insert into erp.role_permissions(role_id,permission_key) values ($1,$2) on conflict do nothing", [papel, k]);
    const u = (await admin.query<{ id: string }>("insert into erp.users(email,name,password_hash) values ($1,$2,$3) returning id", [email, email, hash])).rows[0]!.id;
    const m = (await admin.query<{ id: string }>("insert into erp.organization_members(organization_id,user_id,role_id,is_owner,is_active) values ($1,$2,$3,false,true) returning id", [h.demo.orgId, u, papel])).rows[0]!.id;
    for (const modulo of CHAVES_MODULO_EMPRESA) {
      await admin.query("insert into erp.membro_escopos_empresa(organization_id,membro_id,modulo,modo) values ($1,$2,$3,'selecionadas')", [h.demo.orgId, m, modulo]);
      for (const e of empresas) await admin.query("insert into erp.membro_empresas(organization_id,membro_id,modulo,modo,empresa_id) values ($1,$2,$3,'selecionadas',$4)", [h.demo.orgId, m, modulo, e]);
    }
  });
  const r = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Demo@12345" } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  return (r.json() as { token: string }).token;
}
