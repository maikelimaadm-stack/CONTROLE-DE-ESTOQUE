import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedDemo } from "@agro/db";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV3, type ConfiguracaoTipoOperacaoV4, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, top, usuario, escopos, produto, produtoComSaldo, DATA,
  itemVenda, corpoVenda, vendaLancada, patchVenda, confirmarVenda, lerVenda, versaoDaVenda, versaoAtualNoBanco,
  itemCompra, corpoCompra, compraLancada, confirmarCompra, lerCompra,
  aprovar, reprovar, situacaoNoBanco, auditoriaDe, decisoesDe,
  type Hdr, type Resposta,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F2 (decisão 279) — A SITUAÇÃO DA APROVAÇÃO DE UM DOCUMENTO (casos SA-1..SA-8).
 *
 *   GET /api/aprovacoes/vendas/:id    (`sales.view`)
 *   GET /api/aprovacoes/compras/:id   (`compras.view`)
 *   → 200 { situacao: nao_aberto | nao_exigida | pendente | aprovado | reprovado, ultimaDecisao: {…} | null }
 *
 *   · SA-1 venda Manual + "Sempre": pendente sem decisão → aprovado com a última decisão (quem, quando, observação) →
 *          reprovado com o motivo; quem só VÊ a venda (sem `sales.approve`) lê a situação;
 *   · SA-2 a decisão é DA VERSÃO: aprovada e alterada pelo PATCH → pendente, e a última decisão continua a de antes;
 *   · SA-3 nao_exigida: formato 4 sem aprovação; formato 3 com "Sempre" DECLARADO (o corte da 277); sem TOP; abaixo do
 *          valor mínimo;
 *   · SA-4 nao_aberto: confirmada (que respondia "aprovado" antes do /confirm) e cancelada (que respondia "pendente");
 *          SA-4b o status legado "approved" (0005) é ABERTO: a situação é a conta da aprovação, nunca nao_aberto;
 *   · SA-5 a MESMA 404 — corpo idêntico ao do GET por id — para fora do escopo, inexistente, outra organização,
 *          excluída, orçamento, pedido e id malformado; 403 sem `sales.view`, antes de ler qualquer coisa;
 *   · SA-6 422 em qualquer parâmetro de consulta (e no repetido), antes da 404;
 *   · SA-7 compras: o espelho de SA-1, SA-3, SA-4 e SA-5 (orçamento de compra, escopo, 403; o PEDIDO de compra é
 *          legível desde a OPERACOES-01 F6b — a conta dele é provada em `f6b-compras-api.test.ts`);
 *   · SA-8 só leitura (nada gravado: decisões, trilha e versão do documento iguais) e número FIXO de consultas (venda
 *          de 1 e de 5 itens; a TOP não é lida no documento que não está aberto).
 *   · SA-9 FORMATO 5 (OPERACOES-01 F4, decisão 281 — o que o editor grava desde a F4): a mesma conta — "Sempre" →
 *          pendente na venda e na compra, a venda aprovada → aprovado; o 5 sem aprovação → nao_exigida.
 *
 * O QUE CONTA COMO PROVA (o molde do ajudante): a situação é conferida contra o que o BANCO guarda (as decisões em
 * `erp.aprovacoes_*`, a situação e a versão do documento, lidas por conexão de superusuário) e contra o que a
 * confirmação faz com o mesmo documento (o /confirm recusa com APROVACAO_PENDENTE / APROVACAO_REPROVADA, ou passa).
 * Toda 404 tem a PREMISSA ao lado: o mesmo documento é legível por quem o enxerga.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── a rota ───────────────

type Modulo = "vendas" | "compras";
interface UltimaDecisao { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string }
interface Situacao { situacao: "nao_aberto" | "nao_exigida" | "pendente" | "aprovado" | "reprovado"; ultimaDecisao: UltimaDecisao | null }

/** O GET da situação, cru. `query` é o texto depois do `?` (sem ele, nenhum parâmetro). */
const lerSituacao = (modulo: Modulo, id: string, headers: Hdr = c.h.headers(), query = ""): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/aprovacoes/${modulo}/${id}${query ? `?${query}` : ""}`, headers });

/** O GET da situação que DEVE responder 200; confere as chaves EXATAS do contrato. */
async function situacao(modulo: Modulo, id: string, headers: Hdr = c.h.headers()): Promise<Situacao> {
  const r = await lerSituacao(modulo, id, headers);
  expect(r.statusCode, `${modulo}/${id}: ${r.body}`).toBe(200);
  const b = j(r);
  expect(Object.keys(b), "o contrato da resposta: só as duas chaves").toEqual(["situacao", "ultimaDecisao"]);
  return b as unknown as Situacao;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ─────────────── configurações das TOPs ───────────────

type Cfg = ConfiguracaoTipoOperacaoV3 | ConfiguracaoTipoOperacaoV4 | ConfiguracaoTipoOperacaoV5;
/** O neutro do FORMATO 5 do domínio (um dono só), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
const sempre = (x: Cfg) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };
const porValor = (valorMinimo: string) => (x: Cfg) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = valorMinimo; };
const topVendaSempre = () => top("vendas.venda", { configuracao: cfg4(sempre) });
const topCompraSempre = () => top("compras.compra", { configuracao: cfg4(sempre) });

// ─────────────── documentos e pessoas ───────────────

/** Uma venda NOVA da 1ª empresa, com a TOP dada (ou sem TOP), `itens` itens de produtos NOVOS com saldo no ALM. */
async function venda(topId: string | null, preco = "100.00", itens = 1): Promise<string> {
  const linhas = [];
  for (let i = 0; i < itens; i++) linhas.push(itemVenda((await produtoComSaldo("10")).id, "1", preco));
  return (await vendaLancada(corpoVenda(linhas, topId ? { tipo_operacao_id: topId } : {}))).id;
}
/** Uma venda da 2ª EMPRESA (armazém dela; sem saldo — ela só precisa existir). */
async function vendaDaEmpresa2(topId: string): Promise<string> {
  const p = await produto();
  return (await vendaLancada(corpoVenda([itemVenda(p.id, "1", "100.00", { warehouse_id: c.I.warehouseEmpresa2 })],
    { empresa_id: c.I.empresa2, tipo_operacao_id: topId }))).id;
}
/** Uma compra NOVA (2 × 15.00) com a TOP dada, da empresa e do armazém dados (padrão: os da 1ª empresa). */
async function compra(topId: string, empresa = c.I.empresa, armazem = c.I.warehouse): Promise<string> {
  return (await compraLancada("compra", corpoCompra([itemCompra((await produto()).id, "2", "15.00", { armazem_id: armazem })],
    { tipo_operacao_id: topId, empresa_id: empresa }))).id;
}
/** A `version` que a PESSOA vê: a do GET do documento (é ela que a decisão leva). */
async function versaoVista(id: string): Promise<string> {
  const r = await lerVenda(id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r).version as string;
}
const cancelarVenda = (id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/sales/${id}/cancel`, headers: c.h.headers(), payload: {} });

/** Um membro com nome ÚNICO, e o id dele (lido no banco pelo nome) — para conferir o `decididoPor`. */
async function pessoa(rotulo: string, perms: string[], escopo = escopos()): Promise<{ headers: Hdr; id: string; nome: string }> {
  const nome = `${rotulo} ${unico()}`;
  const headers = await usuario(nome, perms, escopo);
  const r = await c.admin.query<{ id: string }>("select id from erp.users where name = $1", [nome]);
  expect(r.rows, "premissa: o membro existe, com nome único").toHaveLength(1);
  return { headers, id: r.rows[0]!.id, nome };
}
/** O administrador do harness (quem decide quando o caso não diz outro). */
async function admin(): Promise<{ id: string; nome: string }> {
  const nome = (await c.admin.query<{ name: string }>("select name from erp.users where id=$1", [c.h.demo.adminUserId])).rows[0]!.name;
  return { id: c.h.demo.adminUserId, nome };
}
/** O `decididoEm` da resposta de uma decisão que DEVE ter passado (200). */
function decididoEm(r: Resposta): string {
  expect(r.statusCode, r.body).toBe(200);
  return (j(r).aprovacao as { decididoEm: string }).decididoEm;
}

// ─────────────── o espião de consultas ───────────────

/** As SQL que a aplicação mandou ao banco durante `fn` (o espião de `pg.Client.prototype.query`, molde do AP-9b). */
async function comConsultas(fn: () => Promise<Resposta>): Promise<{ r: Resposta; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await fn();
    const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}

// ─────────────── SA-1 ───────────────

describe("SA-1 — venda Manual + Sempre: pendente → aprovado → reprovado, com a última decisão", () => {
  it("SA-1 pendente sem decisão; aprovada → 'aprovado' com quem, quando e a observação; reprovada → 'reprovado' com o motivo; quem só vê a venda lê", async () => {
    const topId = await topVendaSempre();
    const id = await venda(topId, "200.00");
    const versao = await versaoVista(id);
    // Quem só VÊ a venda (sem `sales.approve`, sem `sales.edit`) lê a situação: a leitura é `sales.view`.
    const soVe = await usuario("Só vê vendas", ["sales.view"]);

    expect(await situacao("vendas", id, soVe)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação diz o mesmo — pendente").toBe("APROVACAO_PENDENTE");
    expect(await decisoesDe("aprovacoes_venda", id)).toEqual([]);

    const aprovadora = await pessoa("Aprovadora", ["sales.view", "sales.approve"]);
    const emA = decididoEm(await aprovar("vendas", id, { version: versao, observacao: "Conferido com o cliente" }, aprovadora.headers));
    const sA = await situacao("vendas", id, soVe);
    expect(sA).toEqual({ situacao: "aprovado",
      ultimaDecisao: { decisao: "aprovado", observacao: "Conferido com o cliente", decididoPor: { id: aprovadora.id, nome: aprovadora.nome }, decididoEm: emA } });
    expect(sA.ultimaDecisao!.decididoEm, "decididoEm em ISO").toMatch(ISO);
    const [dA] = await decisoesDe("aprovacoes_venda", id);
    expect(new Date(dA!.decidido_em).toISOString(), "o decididoEm é o gravado").toBe(emA);

    const quem = await admin();
    const emR = decididoEm(await reprovar("vendas", id, { version: versao, motivo: "Preço alto" }));
    expect(await situacao("vendas", id, soVe)).toEqual({ situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: "Preço alto", decididoPor: quem, decididoEm: emR } });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação diz o mesmo — reprovada").toBe("APROVACAO_REPROVADA");
    expect((await decisoesDe("aprovacoes_venda", id)).map((d) => [d.decisao, d.observacao]), "a última decisão é a de id maior")
      .toEqual([["aprovado", "Conferido com o cliente"], ["reprovado", "Preço alto"]]);
  });
});

// ─────────────── SA-2 ───────────────

describe("SA-2 — a decisão é DA VERSÃO da venda", () => {
  it("SA-2 aprovada e alterada pelo PATCH → 'pendente', e a última decisão continua a aprovação anterior; aprovar a versão nova → 'aprovado'", async () => {
    const id = await venda(await topVendaSempre());
    const v1 = await versaoVista(id);
    const emV1 = decididoEm(await aprovar("vendas", id, { version: v1, observacao: "Versão 1" }));
    const anterior = { decisao: "aprovado", observacao: "Versão 1", decididoPor: await admin(), decididoEm: emV1 };
    expect(await situacao("vendas", id)).toEqual({ situacao: "aprovado", ultimaDecisao: anterior });

    const p = await patchVenda(id, { version: v1, note: "depois da aprovação" });
    expect(p.statusCode, p.body).toBe(200);
    const v2 = await versaoVista(id);
    expect(BigInt(v2), "premissa: o PATCH subiu a versão").toBeGreaterThan(BigInt(v1));
    expect(await situacao("vendas", id)).toEqual({ situacao: "pendente", ultimaDecisao: anterior });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação também diz pendente").toBe("APROVACAO_PENDENTE");
    expect((await decisoesDe("aprovacoes_venda", id)).map((d) => d.versao_documento), "a decisão de antes é de OUTRA versão").toEqual([v1]);

    const emV2 = decididoEm(await aprovar("vendas", id, { version: v2 }));
    expect(await situacao("vendas", id)).toEqual({ situacao: "aprovado",
      ultimaDecisao: { decisao: "aprovado", observacao: null, decididoPor: await admin(), decididoEm: emV2 } });
  });

  it("SA-2b reprovada na versão V e alterada para V+1 → 'pendente' (não reprovada), com a reprovação como última decisão", async () => {
    const id = await venda(await topVendaSempre());
    const v = await versaoVista(id);
    const em = decididoEm(await reprovar("vendas", id, { version: v, motivo: "Cliente sem limite" }));
    const reprovacao = { decisao: "reprovado", observacao: "Cliente sem limite", decididoPor: await admin(), decididoEm: em };
    expect(await situacao("vendas", id)).toEqual({ situacao: "reprovado", ultimaDecisao: reprovacao });
    expect((await patchVenda(id, { version: v, note: "ajustado" })).statusCode).toBe(200);
    expect(await situacao("vendas", id)).toEqual({ situacao: "pendente", ultimaDecisao: reprovacao });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação também diz pendente").toBe("APROVACAO_PENDENTE");
  });
});

// ─────────────── SA-3 ───────────────

describe("SA-3 — nao_exigida: a MESMA conta da confirmação", () => {
  it("SA-3 formato 4 sem aprovação, formato 3 com Sempre declarado (o corte), sem TOP e abaixo do valor mínimo → 'nao_exigida'; o aprovar diz o mesmo", async () => {
    const corte = await top("vendas.venda", { configuracao: cfg3(sempre) });
    const gravada = await versaoAtualNoBanco(corte);
    expect([gravada.configuracao_schema_version, (gravada.configuracao["aprovacao"] as { politica: string }).politica],
      "premissa: a TOP do corte é formato 3 COM 'Sempre' gravado").toEqual([3, "sempre"]);
    const casos = [
      { nome: "formato 4, sem aprovação", id: await venda(await top("vendas.venda", { configuracao: cfg4() })) },
      { nome: "formato 3 com Sempre declarado", id: await venda(corte) },
      { nome: "sem TOP", id: await venda(null) },
      { nome: "por valor, abaixo do mínimo", id: await venda(await top("vendas.venda", { configuracao: cfg4(porValor("1500.00")) }), "1499.99") },
    ];
    for (const caso of casos) {
      expect([caso.nome, await situacao("vendas", caso.id)]).toEqual([caso.nome, { situacao: "nao_exigida", ultimaDecisao: null }]);
      // PREMISSA: a decisão faz a MESMA conta e recusa — o documento é aberto e não exige.
      const a = await aprovar("vendas", caso.id, { version: await versaoVista(caso.id) });
      expect([caso.nome, a.statusCode, erro(a).code]).toEqual([caso.nome, 409, "APROVACAO_NAO_EXIGIDA"]);
      expect(await situacaoNoBanco("sales_documents", caso.id)).toBe("open");
    }
    // PREMISSA do contraste: a mesma régua com o total NO mínimo exige.
    const noMinimo = await venda(await top("vendas.venda", { configuracao: cfg4(porValor("1500.00")) }), "1500.00");
    expect(await situacao("vendas", noMinimo)).toEqual({ situacao: "pendente", ultimaDecisao: null });
  });
});

// ─────────────── SA-4 ───────────────

describe("SA-4 — nao_aberto: o documento que não está aberto não passa por aprovação", () => {
  it("SA-4 confirmada (respondia 'aprovado' antes do /confirm) e cancelada (respondia 'pendente') → 'nao_aberto', com a última decisão", async () => {
    const topId = await topVendaSempre();
    const confirmada = await venda(topId);
    const vAprovada = await versaoVista(confirmada);
    const em = decididoEm(await aprovar("vendas", confirmada, { version: vAprovada }));
    const aprovacao = { decisao: "aprovado", observacao: null, decididoPor: await admin(), decididoEm: em };
    expect(await situacao("vendas", confirmada), "premissa: aberta e aprovada").toEqual({ situacao: "aprovado", ultimaDecisao: aprovacao });
    const ok = await confirmarVenda(confirmada);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await situacaoNoBanco("sales_documents", confirmada)).toBe("confirmed");
    // A confirmação subiu a versão: a conta por versão diria "pendente" — é por isso que a TOP não é lida.
    expect(await versaoDaVenda(confirmada), "premissa: a confirmação subiu a versão").not.toBe(vAprovada);
    expect(await situacao("vendas", confirmada)).toEqual({ situacao: "nao_aberto", ultimaDecisao: aprovacao });

    const cancelada = await venda(topId);
    expect(await situacao("vendas", cancelada), "premissa: aberta e pendente").toEqual({ situacao: "pendente", ultimaDecisao: null });
    const cx = await cancelarVenda(cancelada);
    expect(cx.statusCode, cx.body).toBe(200);
    expect(await situacaoNoBanco("sales_documents", cancelada)).toBe("cancelled");
    expect(await situacao("vendas", cancelada)).toEqual({ situacao: "nao_aberto", ultimaDecisao: null });
  });

  it("SA-4b o status legado 'approved' (0005) é ABERTO: pendente sem decisão; aprovada → 'aprovado' — nunca 'nao_aberto' (a régua da decisão e da fila)", async () => {
    const topId = await topVendaSempre();
    const id = await venda(topId);
    // O status da 0005, escrito direto no banco (nenhuma rota de hoje o grava): é o legado que a régua trata como aberto.
    expect((await c.admin.query("update erp.sales_documents set status = 'approved' where id = $1", [id])).rowCount, "premissa: o status legado foi gravado").toBe(1);
    const lida = await lerVenda(id);
    expect(lida.statusCode, lida.body).toBe(200);
    expect((j(lida) as { status: string }).status, "premissa: o GET por id devolve o status legado").toBe("approved");
    expect(await situacao("vendas", id), "aberta para a aprovação: a conta da TOP, pendente").toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação diz o mesmo — pendente").toBe("APROVACAO_PENDENTE");
    // A decisão também a trata como aberta (a mesma régua): aprovar a versão vista passa, e a situação segue a decisão.
    const em = decididoEm(await aprovar("vendas", id, { version: await versaoVista(id) }));
    expect(await situacao("vendas", id)).toEqual({ situacao: "aprovado", ultimaDecisao: { decisao: "aprovado", observacao: null, decididoPor: await admin(), decididoEm: em } });
    expect(await situacaoNoBanco("sales_documents", id), "a situação da aprovação não mexe no status legado").toBe("approved");
  });
});

// ─────────────── SA-5 ───────────────

/** Uma venda REAL de outra organização (seed demo próprio, admin próprio), com TOP formato 4 Sempre, aberta. */
async function vendaDeOutraOrganizacao(): Promise<{ id: string; headers: Hdr }> {
  const s = unico();
  const b = await seedDemo(c.admin, { orgName: `[TEST] Outra F2 ${s}`, adminEmail: `outra-f2-${s}@demo.local`, adminPassword: "Demo@12345", slug: `outra-f2-${s}` }, () => {});
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: b.adminEmail, password: b.adminPassword } });
  expect(login.statusCode, login.body).toBe(200);
  const headers = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": b.orgId };
  const um = async (sql: string, params: unknown[]) => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;
  const empresa = b.empresaIds[0]!;
  const cliente = await um("select id from erp.people where organization_id=$1 and is_client order by code limit 1", [b.orgId]);
  const prod = await um("select id from erp.products where organization_id=$1 and description like 'Ração%' limit 1", [b.orgId]);
  const armazem = await um("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and initials='ALM'", [b.orgId, empresa]);
  const topB = await top("vendas.venda", { configuracao: cfg4(sempre) }, headers);
  const v = await vendaLancada({ empresa_id: empresa, document_date: DATA, client_id: cliente, tipo_operacao_id: topB,
    items: [{ product_id: prod, warehouse_id: armazem, quantity: "1", unit_price: "10.00" }] }, headers);
  return { id: v.id, headers };
}

/** As tabelas que a situação lê — nenhuma delas pode aparecer numa recusa por capacidade. */
const LEITURAS_DO_DOCUMENTO = /erp\.(sales_documents|sales_document_items|tipos_operacao_versoes|aprovacoes_venda|documentos_compra|aprovacoes_compra)\b/;

describe("SA-5 — a superfície de recusa: a MESMA 404 do GET por id, e 403 sem a capacidade", () => {
  it("SA-5 fora do escopo, inexistente, outra organização, excluída, orçamento, pedido e id malformado → a MESMA 404 (corpo idêntico ao do GET por id)", async () => {
    const topId = await topVendaSempre();
    const v = await venda(topId);
    const doEscopo2 = await usuario("Vê vendas da empresa 2", ["sales.view"], escopos({ vendas: [c.I.empresa2] }));

    // A 404 de referência: o GET por id de uma venda que não existe.
    const naoExiste = randomUUID();
    const referencia = await lerVenda(naoExiste);
    expect(referencia.statusCode, referencia.body).toBe(404);
    expect(erro(referencia)).toEqual({ code: "NOT_FOUND", message: "Documento não encontrado" });

    const outra = await vendaDeOutraOrganizacao();
    const p = await produto();
    const variante = async (seg: "budgets" | "orders") => {
      const r = await c.ligada.inject({ method: "POST", url: `/api/sales/${seg}`, headers: c.h.headers(), payload: corpoVenda([itemVenda(p.id, "1", "10.00")]) });
      expect(r.statusCode, `premissa: o documento de ${seg} é lançado — ${r.body}`).toBe(201);
      return (j(r) as { id: string }).id;
    };
    const orcamento = await variante("budgets");
    const pedido = await variante("orders");
    const excluida = await venda(topId);
    expect(await situacao("vendas", excluida), "premissa: antes de excluída, a situação é lida").toEqual({ situacao: "pendente", ultimaDecisao: null });
    await c.admin.query("update erp.sales_documents set deleted_at = now() where id=$1", [excluida]);

    const bemFormados: { nome: string; id: string; headers?: Hdr }[] = [
      { nome: "fora do escopo de empresa", id: v, headers: doEscopo2 },
      { nome: "inexistente", id: naoExiste },
      { nome: "inexistente, em maiúsculas", id: naoExiste.toUpperCase() },
      { nome: "outra organização", id: outra.id },
      { nome: "excluída", id: excluida },
      { nome: "outra variante (orçamento)", id: orcamento },
      { nome: "outra variante (pedido)", id: pedido },
    ];
    for (const caso of bemFormados) {
      const r = await lerSituacao("vendas", caso.id, caso.headers);
      expect([caso.nome, r.statusCode, r.body]).toEqual([caso.nome, 404, referencia.body]);
      // O MESMO corpo do GET por id DO MESMO CASO (mesmo id, mesma pessoa).
      const g = await lerVenda(caso.id, caso.headers);
      expect([caso.nome, "GET por id", g.statusCode, g.body]).toEqual([caso.nome, "GET por id", 404, r.body]);
    }
    // O id fora da forma: a 404 do id inexistente bem formado (e não o 500 do 22P02).
    for (const id of ["nao-e-uuid", `${naoExiste.slice(0, -1)}x`, "0"]) {
      const r = await lerSituacao("vendas", id);
      expect([id, r.statusCode, r.body]).toEqual([id, 404, referencia.body]);
    }

    // PREMISSAS: cada documento invisível ERA legível por quem o enxerga — a 404 é só visibilidade.
    expect(await situacao("vendas", v), "premissa: quem enxerga a empresa 1 lê").toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await situacao("vendas", await vendaDaEmpresa2(topId), doEscopo2), "premissa: a pessoa da empresa 2 lê a venda da empresa 2")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await situacao("vendas", outra.id, outra.headers), "premissa: a dona da outra organização lê a venda dela")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
    for (const [seg, id] of [["budgets", orcamento], ["orders", pedido]] as const) {
      const g = await c.ligada.inject({ method: "GET", url: `/api/sales/${seg}/${id}`, headers: c.h.headers() });
      expect([seg, g.statusCode], `premissa: o documento de ${seg} existe e é legível pela porta dele`).toEqual([seg, 200]);
    }
  });

  it("SA-5b sem sales.view (só orçamento e pedido) → 403 antes de ler qualquer coisa — mesmo com parâmetro e id malformado; quem tem, lê", async () => {
    const v = await venda(await topVendaSempre());
    const semVer = await usuario("Só orçamentos e pedidos", ["budgets.view", "orders.view"]);
    for (const [id, query] of [[v, ""], [v, "foo=1"], ["nao-e-uuid", ""], [randomUUID(), "x=1&x=2"]] as const) {
      const { r, sqls } = await comConsultas(() => lerSituacao("vendas", id, semVer, query));
      expect([id, query, r.statusCode], r.body).toEqual([id, query, 403]);
      expect(erro(r).code).toBe("PERMISSION_DENIED");
      expect(sqls.filter((s) => LEITURAS_DO_DOCUMENTO.test(s)), "nenhuma leitura do documento, da TOP ou da decisão").toEqual([]);
    }
    // PREMISSA: o espião enxerga as leituras — a mesma pergunta, por quem tem `sales.view`, lê o documento.
    const { r, sqls } = await comConsultas(() => lerSituacao("vendas", v));
    expect(r.statusCode, r.body).toBe(200);
    expect(sqls.filter((s) => LEITURAS_DO_DOCUMENTO.test(s)).length, "premissa: a leitura permitida passa pelo documento").toBeGreaterThan(0);
  });
});

// ─────────────── SA-6 ───────────────

describe("SA-6 — parâmetro de consulta: 422 no parâmetro, nunca ignorado", () => {
  it("SA-6 ?foo=1, ?page=1, ?empresa_id=… → 'não reconhecido'; ?x=1&x=2 → 'repetido'; o 422 vem antes da 404; sem parâmetro, 200", async () => {
    const id = await venda(await topVendaSempre());
    expect(await situacao("vendas", id), "premissa: sem parâmetro, 200").toEqual({ situacao: "pendente", ultimaDecisao: null });
    const naoReconhecido = "Parâmetro não reconhecido na situação da aprovação";
    const repetido = "Parâmetro repetido: informe um valor só";
    const casos: [string, string, string][] = [
      ["foo=1", "foo", naoReconhecido],
      ["page=1", "page", naoReconhecido],
      [`empresa_id=${c.I.empresa2}`, "empresa_id", naoReconhecido],
      ["x=1&x=2", "x", repetido],
    ];
    for (const alvo of [id, randomUUID(), "nao-e-uuid"]) {
      for (const [query, path, message] of casos) {
        const r = await lerSituacao("vendas", alvo, c.h.headers(), query);
        expect([alvo, query, r.statusCode]).toEqual([alvo, query, 422]);
        expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message, details: [{ path, message }] });
      }
    }
    // A compra recusa igual.
    const cId = await compra(await topCompraSempre());
    expect(await situacao("compras", cId), "premissa: sem parâmetro, 200").toEqual({ situacao: "pendente", ultimaDecisao: null });
    for (const [query, path, message] of casos) {
      const r = await lerSituacao("compras", cId, c.h.headers(), query);
      expect([query, r.statusCode]).toEqual([query, 422]);
      expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message, details: [{ path, message }] });
    }
  });
});

// ─────────────── SA-7 ───────────────

describe("SA-7 — compras: o espelho", () => {
  it("SA-7a compra Sempre: pendente → aprovado (quem, quando, observação) → reprovado (motivo); quem só vê a compra lê", async () => {
    const id = await compra(await topCompraSempre());
    const soVe = await usuario("Só vê compras", ["compras.view"]);
    expect(await situacao("compras", id, soVe)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarCompra(id)).code, "premissa: a confirmação diz o mesmo — pendente").toBe("APROVACAO_PENDENTE");

    const aprovador = await pessoa("Aprovador de compras", ["compras.view", "compras.approve"]);
    const emA = decididoEm(await aprovar("compras", id, { observacao: "Cotação conferida" }, aprovador.headers));
    const sA = await situacao("compras", id, soVe);
    expect(sA).toEqual({ situacao: "aprovado",
      ultimaDecisao: { decisao: "aprovado", observacao: "Cotação conferida", decididoPor: { id: aprovador.id, nome: aprovador.nome }, decididoEm: emA } });
    expect(sA.ultimaDecisao!.decididoEm).toMatch(ISO);

    const emR = decididoEm(await reprovar("compras", id, { motivo: "Fornecedor bloqueado" }));
    expect(await situacao("compras", id, soVe)).toEqual({ situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: "Fornecedor bloqueado", decididoPor: await admin(), decididoEm: emR } });
    expect(erro(await confirmarCompra(id)).code, "premissa: a confirmação diz o mesmo — reprovada").toBe("APROVACAO_REPROVADA");
    expect((await decisoesDe("aprovacoes_compra", id)).map((d) => d.decisao)).toEqual(["aprovado", "reprovado"]);
  });

  it("SA-7b nao_exigida (TOP neutra do formato 4) e nao_aberto (compra aprovada e confirmada, que respondia 'aprovado')", async () => {
    const neutra = await compra(c.tops.compra);
    expect(await situacao("compras", neutra)).toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
    const a = await aprovar("compras", neutra, {});
    expect([a.statusCode, erro(a).code], "premissa: a decisão faz a MESMA conta").toEqual([409, "APROVACAO_NAO_EXIGIDA"]);

    const id = await compra(await topCompraSempre());
    const em = decididoEm(await aprovar("compras", id, {}));
    const aprovacao = { decisao: "aprovado", observacao: null, decididoPor: await admin(), decididoEm: em };
    expect(await situacao("compras", id), "premissa: aberta e aprovada").toEqual({ situacao: "aprovado", ultimaDecisao: aprovacao });
    const ok = await confirmarCompra(id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await situacaoNoBanco("documentos_compra", id)).toBe("confirmado");
    expect(await situacao("compras", id)).toEqual({ situacao: "nao_aberto", ultimaDecisao: aprovacao });
  });

  it("SA-7c orçamento de compra, fora do escopo, inexistente e id malformado → a MESMA 404 do GET da compra por id; o pedido de compra é legível (F6b); sem compras.view → 403 antes de ler", async () => {
    const topId = await topCompraSempre();
    const id = await compra(topId);
    const doEscopo2 = await usuario("Vê compras da empresa 2", ["compras.view"], escopos({ compras: [c.I.empresa2] }));
    const pedido = (await compraLancada("pedido", corpoCompra([itemCompra((await produto()).id, "1", "10.00")], {}, "pedido"))).id;
    // O ORÇAMENTO DE COMPRA (OPERACOES-01 F6a), criado pela API: o pedido aprovado para orçamento e a TOP do leque dele.
    // OPERACOES-01 F6b: é ele a "outra espécie" desta rota — o pedido passou a ser legível pela porta (com
    // `pedidos_compra.view`), e o orçamento continua sendo, para todos, a MESMA 404.
    const topOrc = await top("compras.orcamento", { configuracao: cfg4() });
    const topPedido = await top("compras.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }] });
    const pedidoCotado = (await compraLancada("pedido", corpoCompra([itemCompra((await produto()).id, "1", "10.00")], { tipo_operacao_id: topPedido }, "pedido"))).id;
    const aprovado = await c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoCotado}/aprovar-para-orcamento`, headers: c.h.headers(), payload: {} });
    expect(aprovado.statusCode, `premissa: o pedido é aprovado para orçamento — ${aprovado.body}`).toBe(200);
    const criado = await c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${pedidoCotado}/orcamentos`, headers: c.h.headers(),
      payload: { tipo_operacao_id: topOrc, fornecedor_id: c.I.provider, data_documento: DATA } });
    expect(criado.statusCode, `premissa: o orçamento é criado — ${criado.body}`).toBe(201);
    const orcamento = j(criado).id as string;

    const naoExiste = randomUUID();
    const referencia = await lerCompra("compra", naoExiste);
    expect(referencia.statusCode, referencia.body).toBe(404);
    expect(erro(referencia)).toEqual({ code: "NOT_FOUND", message: "Documento não encontrado" });

    const casos: { nome: string; id: string; headers?: Hdr }[] = [
      { nome: "orçamento de compra (outra espécie)", id: orcamento },
      { nome: "fora do escopo de empresa", id, headers: doEscopo2 },
      { nome: "inexistente", id: naoExiste },
      { nome: "id malformado", id: "nao-e-uuid" },
      { nome: "id malformado (quase uuid)", id: `${naoExiste.slice(0, -1)}x` },
    ];
    for (const caso of casos) {
      const r = await lerSituacao("compras", caso.id, caso.headers);
      expect([caso.nome, r.statusCode, r.body]).toEqual([caso.nome, 404, referencia.body]);
      const g = await lerCompra("compra", caso.id, caso.headers);
      expect([caso.nome, "GET por id", g.statusCode, g.body]).toEqual([caso.nome, "GET por id", 404, r.body]);
    }

    const semVer = await usuario("Só pedidos de compra", ["pedidos_compra.view", "pedidos_compra.create"]);
    for (const alvo of [id, pedido, "nao-e-uuid"]) {
      const { r, sqls } = await comConsultas(() => lerSituacao("compras", alvo, semVer, "foo=1"));
      expect([alvo, r.statusCode], r.body).toEqual([alvo, 403]);
      expect(erro(r).code).toBe("PERMISSION_DENIED");
      expect(sqls.filter((s) => LEITURAS_DO_DOCUMENTO.test(s)), "nenhuma leitura do documento, da TOP ou da decisão").toEqual([]);
    }

    // PREMISSAS: legíveis por quem os enxerga.
    expect(await situacao("compras", id)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await situacao("compras", await compra(topId, c.I.empresa2, c.I.warehouseEmpresa2), doEscopo2), "premissa: a pessoa da empresa 2 lê a compra da empresa 2")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
    const go = await c.ligada.inject({ method: "GET", url: `/api/compras/orcamentos/${orcamento}`, headers: c.h.headers() });
    expect(go.statusCode, `premissa: o orçamento existe e é legível pela porta dele — ${go.body}`).toBe(200);
    // F6b: o PEDIDO não é mais "outra espécie" aqui — quem tem `compras.view` ∧ `pedidos_compra.view` lê a situação dele
    // (a TOP neutra não exige aprovação). A conta do pedido e as recusas dele: `f6b-compras-api.test.ts`.
    expect(await situacao("compras", pedido), "o pedido de compra é legível pela porta (F6b)").toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
  });
});

// ─────────────── SA-8 ───────────────

/** As consultas de UMA leitura da situação da venda, por assunto. */
async function consultasDaSituacao(id: string) {
  const { r, sqls } = await comConsultas(() => lerSituacao("vendas", id));
  expect(r.statusCode, r.body).toBe(200);
  return {
    situacao: (j(r) as unknown as Situacao).situacao,
    todas: sqls.length,
    documento: sqls.filter((s) => /from erp\.sales_documents d\b/.test(s)).length,
    itens: sqls.filter((s) => /from erp\.sales_document_items i\b/.test(s)).length,
    versaoTop: sqls.filter((s) => /select v\.configuracao, t\.codigo_base\s+from erp\.tipos_operacao_versoes v\b/.test(s)).length,
    vigente: sqls.filter((s) => /from erp\.aprovacoes_venda a\b[\s\S]*a\.versao_documento = \$3/.test(s)).length,
    ultima: sqls.filter((s) => /from erp\.aprovacoes_venda a\b[\s\S]*a\.organization_id = \$2\s+order by a\.id desc/.test(s)).length,
  };
}

/** O que uma leitura NÃO pode mudar: as decisões, a trilha e a versão do documento. */
async function rastroDaVenda(id: string) {
  return {
    decisoes: (await decisoesDe("aprovacoes_venda", id)).length,
    trilha: (await c.admin.query<{ n: string }>("select count(*)::text n from erp.audit_logs where entity_id=$1", [id])).rows[0]!.n,
    versao: await versaoDaVenda(id),
    situacao: await situacaoNoBanco("sales_documents", id),
  };
}

describe("SA-8 — só leitura, com número FIXO de consultas", () => {
  it("SA-8a ler a situação não grava nada (decisões, trilha, versão iguais); premissa: decidir muda os mesmos contadores", async () => {
    const id = await venda(await topVendaSempre());
    const antes = await rastroDaVenda(id);
    for (let i = 0; i < 3; i++) expect(await situacao("vendas", id)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await rastroDaVenda(id), "três leituras, nenhum efeito").toEqual(antes);
    expect(await auditoriaDe("sales_documents", id, "approve")).toEqual([]);

    // PREMISSA: os contadores enxergam uma escrita — a decisão muda a contagem de decisões e a trilha.
    decididoEm(await aprovar("vendas", id, { version: antes.versao }));
    const depois = await rastroDaVenda(id);
    expect([depois.decisoes, Number(depois.trilha) > Number(antes.trilha)]).toEqual([antes.decisoes + 1, true]);
  });

  it("SA-8b venda de 1 e de 5 itens → as MESMAS consultas (documento, itens, versão da TOP, vigente, última); não aberta → a TOP não é lida", async () => {
    const topId = await topVendaSempre();
    const um = await venda(topId, "10.00", 1);
    const cinco = await venda(topId, "10.00", 5);
    expect((await c.admin.query<{ n: string }>("select count(*)::text n from erp.sales_document_items where document_id=$1", [cinco])).rows[0]!.n,
      "premissa: a venda grande tem 5 itens").toBe("5");
    // Aquecimento (o que a autenticação lê uma vez não entra na conta de nenhuma das duas).
    await situacao("vendas", um); await situacao("vendas", cinco);

    const c1 = await consultasDaSituacao(um);
    const c5 = await consultasDaSituacao(cinco);
    const esperado = { situacao: "pendente", documento: 1, itens: 1, versaoTop: 1, vigente: 1, ultima: 1 };
    expect(c1).toMatchObject(esperado);
    expect(c5).toMatchObject(esperado);
    expect(c1.todas, "premissa: o espião contou consultas").toBeGreaterThan(0);
    expect(c5.todas, "as mesmas consultas, qualquer que seja o número de itens").toBe(c1.todas);

    // Não aberta: a conta não roda — nem a versão da TOP nem a vigente; a última decisão, sim (uma).
    expect((await cancelarVenda(um)).statusCode).toBe(200);
    const cx = await consultasDaSituacao(um);
    expect(cx).toMatchObject({ situacao: "nao_aberto", documento: 1, versaoTop: 0, vigente: 0, ultima: 1 });
    expect(cx.todas, "duas consultas a menos que a aberta").toBe(c1.todas - 2);
  });
});

// ─────────────── SA-9 ───────────────

describe("SA-9 — formato 5 (F4, decisão 281): a mesma conta da confirmação", () => {
  it("SA-9 venda e compra com a TOP no formato 5 'Sempre' → 'pendente' (a confirmação diz o mesmo); a venda aprovada → 'aprovado'; o 5 sem aprovação → 'nao_exigida'", async () => {
    const t5 = await top("vendas.venda", { configuracao: cfg5(sempre) });
    expect((await versaoAtualNoBanco(t5)).configuracao_schema_version, "premissa: a versão da venda está no formato 5").toBe(5);
    const id = await venda(t5);
    expect(await situacao("vendas", id)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarVenda(id)).code, "premissa: a confirmação diz o mesmo — pendente").toBe("APROVACAO_PENDENTE");
    const em = decididoEm(await aprovar("vendas", id, { version: await versaoVista(id) }));
    expect(await situacao("vendas", id)).toEqual({ situacao: "aprovado", ultimaDecisao: { decisao: "aprovado", observacao: null, decididoPor: await admin(), decididoEm: em } });

    const tc5 = await top("compras.compra", { configuracao: cfg5(sempre) });
    expect((await versaoAtualNoBanco(tc5)).configuracao_schema_version, "premissa: a versão da compra está no formato 5").toBe(5);
    const cid = await compra(tc5);
    expect(await situacao("compras", cid)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarCompra(cid)).code, "premissa: a confirmação da compra diz o mesmo").toBe("APROVACAO_PENDENTE");

    const n5 = await top("vendas.venda", { configuracao: cfg5() });
    expect((await versaoAtualNoBanco(n5)).configuracao_schema_version, "premissa: formato 5, sem aprovação").toBe(5);
    expect(await situacao("vendas", await venda(n5))).toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
  });
});
