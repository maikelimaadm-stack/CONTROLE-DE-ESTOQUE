import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { seedDemo } from "@agro/db";
import { configuracaoNeutraTop, configuracaoNeutraTopV2, resolverTipoOperacao } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg3, cfg4, top, criarTop, revisaoTop, versaoAtualNoBanco, usuario, produto, itemCompra, corpoCompra,
  lancarCompra, unico, type Resposta, type Hdr,
} from "./top-config-08-ajuda.js";
import { COMPRA, PEDIDO_DE_COMPRA, ORCAMENTO_DE_COMPRA, cfg5Fin, topCompraNo5, topPedidoNo5, cadastroDespesa, centro, umTipoDeTitulo, contar, type TopNo5, type PadroesNoCorpo } from "./f9b-ajuda.js";

/**
 * LANCAMENTO-01 (decisão 311) — `GET /api/compras/{compras|pedidos}/regras-da-operacao` DIZ O QUE A TOP JÁ SABE DO
 * FINANCEIRO: `secao` e `padroes`, logo antes de `regrasGerais` (a última), na forma de `GET /api/financeiro/tops` (um contrato só, o
 * da Central Financeira), da versão ATUAL e pela MESMA fonte do salvar (`padroesDaTopParaExecucao`). E a rede do produto
 * que diz o local (o 4.3 da fatia), no servidor de hoje.
 *
 *   LANC-I1  contrato: compra e pedido no formato 5 com os cinco padrões → `secao` da versão e `padroes` com
 *            {id,codigo,nome} / {id,nome} / {id,codigo,descricao} iguais aos cadastros (e aos da Central Financeira); as
 *            chaves de hoje IGUAIS, na mesma ordem, antes de `secao`/`padroes`; contractVersion 1;
 *   LANC-I2  null: formato 5 sem padrões → `padroes` null (a seção ainda da versão); formatos 1 a 4 → `padroes` null e a
 *            seção NEUTRA, também com uma linha de padrões na versão (escrita direto no banco: só o 5 executa); o
 *            orçamento de compra (rota que não mudou) não tem `secao` nem `padroes`;
 *   LANC-I3  404 e autorização: outra organização, inativa, excluída, outra família, inexistente, malformado e ausente
 *            → a MESMA 404 (corpo idêntico), sem padrão no corpo e SEM LER padrão algum (as consultas da recusa);
 *            sem `<recurso>.create` → o 403 de hoje (o mesmo do `/layout-efetivo`), sem padrão; com só a porta
 *            operacional (sem capacidade financeira) → 200 com os padrões (nenhuma capacidade nova);
 *   LANC-I4  consultas da rota CONTADAS (o espião do RG-8): compra formato 5 = 5, formatos 1 a 4 = 4; pedido 4 / 3; a
 *            leitura dos padrões é UMA (`any($2::uuid[])`) com os cinco cadastros, a mesma com um padrão só — sem N+1;
 *            a ordem: a 404 primeiro, os padrões por último;
 *   LANC-I5  cadastro morto: a natureza inativada e o centro excluído DEPOIS continuam vindo com o nome (é o histórico
 *            da versão; o mesmo da Central Financeira) — o comportamento registrado;
 *   LANC-I6  produto e local (a proposta do A3, sem servidor novo): o produto traz `default_warehouse_id` e o rótulo; as
 *            opções do local por `empresa_id`+`id` devolvem o local na empresa certa, [] de OUTRA empresa e [] inativo, e
 *            respondem 200 a um comprador sem `warehouses.view`;
 *   LANC-I7  a rede da R5: compra E pedido na empresa 1 com item no local da empresa 2 → 422 em `itens[0].armazem_id`,
 *            nada gravado (premissa: o MESMO corpo na empresa 2 salva).
 *
 * O QUE CONTA COMO PROVA: os cadastros esperados são LIDOS NO BANCO pela testemunha (`c.admin`, superusuário, sem RLS),
 * a versão e a linha dos padrões também; toda ausência ("null", "nenhum padrão", "[]", "nada gravado") vem com a
 * premissa ao lado — o mesmo cenário, do lado certo, produz o valor. Tudo pela instância `ligada` (a de produção).
 */

beforeAll(async () => {
  await iniciar();
  tipoTitulo = await umTipoDeTitulo();
  forma = (await c.admin.query<{ id: string }>("select id::text as id from erp.payment_methods where organization_id is null and is_active order by name, id limit 1")).rows[0]!.id;
  natureza = await cadastroDespesa("Natureza padrão LANC-01");
  centroP = await centro("Centro padrão LANC-01");
  conta = await contaDaOrganizacao(c.h.demo.orgId, "Conta padrão LANC-01");
  destino = await topCompraNo5();
  // A OUTRA organização (LANC-I3), com o admin dela e os cadastros dela (os padrões da TOP dela são dela).
  const o = await seedDemo(c.admin, { orgName: "[TEST] Org LANC-01", adminEmail: "admin-lanc01@demo.local", adminPassword: "Demo@12345", slug: "orglanc01" }, () => {});
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-lanc01@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  outra = { orgId: o.orgId, headers: { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId } };
}, 240_000);
afterAll(encerrar);

let tipoTitulo = ""; let forma = ""; let natureza = ""; let centroP = ""; let conta = "";
let destino: TopNo5;
let outra: { orgId: string; headers: Hdr };

// ─────────────── o contrato ───────────────

/** As chaves de HOJE de `/regras-da-operacao` de compras, na ordem (a F2 acrescentou `regrasGerais`, a ÚLTIMA). */
const CHAVES_DE_HOJE = ["contractVersion", "formato", "exigencias", "condicoesPermitidas", "geraTitulos", "exigeFormaPagamento", "exigeVencimento", "exigeArmazem", "regrasGerais"] as const;
/**
 * As de hoje + as da LANCAMENTO-01 logo ANTES de `regrasGerais`, que continua a ÚLTIMA (o contrato da F2 que o skew
 * mede: `apps/web/e2e/operacoes-01-f2-skew-comum.ts`, `regrasGeraisDoCorpo`).
 */
const CHAVES = [...CHAVES_DE_HOJE.slice(0, -1), "secao", "padroes", "regrasGerais"];
/** As chaves de `/compras/orcamentos/regras-da-operacao` (a rota do orçamento, que NÃO muda). */
const CHAVES_DO_ORCAMENTO = ["contractVersion", "formato", "exigencias", "condicoesPermitidas", "geraTitulos", "exigeFormaPagamento", "exigeVencimento", "exigeArmazem"];
const CHAVES_DA_SECAO = ["provisao", "documentoTroca", "semClassificacao"];
const CHAVES_DOS_PADROES = ["natureza", "centro", "tipoTitulo", "formaPagamento", "conta"];
const SECAO_NEUTRA = { provisao: false, documentoTroca: true, semClassificacao: "padrao_legado" };
const REGRAS_GERAIS_NEUTRAS = { confirmacaoAutomatica: false, aceitaSemItens: false };
const NAO_ACHADA = { error: { code: "NOT_FOUND", message: "Tipo de operação não encontrado" } };
const MSG_LOCAL = "Local de estoque inválido: escolha um local de estoque ativo da empresa do documento";
/** A família do título a pagar, perguntada ao registry (a Central Financeira: `GET /financeiro/tops?direcao=pagar`). */
const PAGAR = resolverTipoOperacao("erp.financial_titles", "payable")!.codigo;

type Seg = "compras" | "pedidos";
type Padroes = { natureza: unknown; centro: unknown; tipoTitulo: unknown; formaPagamento: unknown; conta: unknown };

const regras = (seg: Seg, q: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/${seg}/regras-da-operacao${q}`, headers });
const daTop = (seg: Seg, topId: string, headers?: Hdr) => regras(seg, `?tipo_operacao_id=${topId}`, headers);
/** O 200 e o corpo. */
async function ok(r: Promise<Resposta>): Promise<Record<string, unknown>> {
  const x = await r;
  expect(x.statusCode, x.body).toBe(200);
  return j(x);
}
const hoje = (b: Record<string, unknown>) => Object.fromEntries(CHAVES_DE_HOJE.map((k) => [k, b[k]]));

// ─────────────── cadastros e fixtures (superusuário) ───────────────

/** Uma conta bancária NOVA e ativa da organização dada. */
async function contaDaOrganizacao(orgId: string, descricao: string): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.bank_accounts(organization_id,code,description,type) values ($1,$2,$3,'checking') returning id::text as id",
    [orgId, `L01${unico()}`.toUpperCase().slice(0, 20), descricao])).rows[0]!.id;
}
const CINCO = (): PadroesNoCorpo => ({ naturezaId: natureza, centroCustoId: centroP, tipoTituloId: tipoTitulo, formaPagamentoId: forma, contaBancariaId: conta });

/** O que a resposta DEVE trazer de cada cadastro, lido no banco (o rótulo de hoje de cada um). */
async function esperados(p: PadroesNoCorpo): Promise<Padroes> {
  const um = async <T>(sql: string, id: string | undefined): Promise<T | null> => (id ? (await c.admin.query<T & Record<string, unknown>>(sql, [id])).rows[0]! : null);
  const n = await um<{ codigo: string; nome: string }>("select code as codigo, name as nome from erp.financial_categories where id=$1", p.naturezaId);
  const ce = await um<{ codigo: string; nome: string }>("select code as codigo, name as nome from erp.cost_centers where id=$1", p.centroCustoId);
  const t = await um<{ nome: string }>("select name as nome from erp.title_types where id=$1", p.tipoTituloId);
  const f = await um<{ nome: string }>("select name as nome from erp.payment_methods where id=$1", p.formaPagamentoId);
  const b = await um<{ codigo: string; descricao: string }>("select code as codigo, description as descricao from erp.bank_accounts where id=$1", p.contaBancariaId);
  return {
    natureza: n && { id: p.naturezaId, codigo: n.codigo, nome: n.nome },
    centro: ce && { id: p.centroCustoId, codigo: ce.codigo, nome: ce.nome },
    tipoTitulo: t && { id: p.tipoTituloId, nome: t.nome },
    formaPagamento: f && { id: p.formaPagamentoId, nome: f.nome },
    conta: b && { id: p.contaBancariaId, codigo: b.codigo, descricao: b.descricao },
  };
}

/** Uma linha de padrões escrita DIRETO NO BANCO numa versão qualquer (a porta administrativa só a grava no formato 5). */
async function padroesDireto(topId: string, versaoId: string, orgId: string = c.h.demo.orgId): Promise<void> {
  const r = await c.admin.query(
    `insert into erp.tipos_operacao_versao_financeiro (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`, [orgId, versaoId, topId, natureza, centroP, tipoTitulo, forma, conta]);
  expect(r.rowCount, "premissa: a linha de padrões entrou na versão").toBe(1);
}
const linhasDosPadroes = async (versaoId: string) =>
  Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao_versao_financeiro where origem_versao_id=$1", [versaoId])).rows[0]!.n);
/** Uma TOP da família no formato pedido (premissa lida no banco), com o id e a versão corrente. */
async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }, formato: number): Promise<TopNo5> {
  const id = await top(codigoBase, { configuracao });
  const v = await versaoAtualNoBanco(id);
  expect(v.configuracao_schema_version, `premissa: a TOP ${codigoBase} está no formato ${formato}`).toBe(formato);
  return { id, versaoId: v.id };
}

// ─────────────── as consultas (o molde do RG-8, `operacoes-01-f2-regras-gerais.test.ts`) ───────────────

/** As consultas SQL que a requisição dispara: o texto de cada uma, em ordem. */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const sqls = espiao.mock.calls.map((x) => x[0] as unknown).map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
      .filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}
/** As consultas que tocam a TOP (as do handler: a existência, as regras, os efeitos, a releitura e os padrões). */
const daTopNo = (sqls: string[]) => sqls.filter((s) => /\berp\.tipos_operacao/.test(s));
/** O nome de cada consulta da TOP — qualquer outra aparece com o texto, e reprova a sequência. */
function nomeDa(s: string): string {
  if (/select v\.id as versao_id\s+from erp\.tipos_operacao t\s/.test(s) && /t\.ativo and t\.excluido_em is null/.test(s)) return "existencia";
  if (/erp\.tipos_operacao_versao_condicoes/.test(s)) return "regras";
  if (/^select configuracao from erp\.tipos_operacao_versoes where id = \$1 and organization_id = \$2$/.test(s.trim())) return "efeitos";
  if (/select v\.id::text as id, v\.configuracao, t\.codigo_base/.test(s)) return "releitura";
  if (/from erp\.tipos_operacao_versao_financeiro x/.test(s)) return "padroes";
  return `outra: ${s.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}
const nomesDaTop = (sqls: string[]) => daTopNo(sqls).map(nomeDa);
/** As consultas que tocam os cadastros dos padrões (fora da leitura dos padrões = N+1). */
const deCadastro = (sqls: string[]) => sqls.filter((s) => /\berp\.(financial_categories|cost_centers|title_types|payment_methods|bank_accounts)\b/.test(s));
const lePadroes = (sqls: string[]) => sqls.some((s) => /\berp\.tipos_operacao_versao_financeiro\b/.test(s));

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I1 contrato: secao e padroes da versão atual, na forma da Central Financeira", () => {
  it("LANC-I1a compra no formato 5 com os cinco padrões e \"o documento não troca\" → secao da versão, padroes iguais aos cadastros; as chaves de hoje iguais e na mesma ordem; contractVersion 1", async () => {
    const t = await topCompraNo5({ secao: { documentoTroca: false }, padroes: CINCO() });
    expect(await linhasDosPadroes(t.versaoId), "premissa: a versão tem a linha dos padrões").toBe(1);
    const b = await ok(daTop("compras", t.id));
    expect(Object.keys(b), "as chaves de hoje, na ordem, com secao e padroes logo antes de regrasGerais (a última)").toEqual(CHAVES);
    expect(b.contractVersion).toBe(1);
    expect(b.secao, "a seção DA VERSÃO (o documento não troca), não o neutro").toEqual({ provisao: false, documentoTroca: false, semClassificacao: "padrao_legado" });
    expect(Object.keys(b.secao as object)).toEqual(CHAVES_DA_SECAO);

    const esperado = await esperados(CINCO());
    expect(Object.values(esperado).every((x) => x !== null), "premissa: os cinco cadastros existem no banco").toBe(true);
    expect(b.padroes).toEqual(esperado);
    const p = b.padroes as Record<string, Record<string, unknown>>;
    expect(Object.keys(p), "os cinco, e só eles (sem os ids soltos de `PadroesFinanceirosResolvidos`)").toEqual(CHAVES_DOS_PADROES);
    expect([Object.keys(p.natureza!), Object.keys(p.centro!), Object.keys(p.tipoTitulo!), Object.keys(p.formaPagamento!), Object.keys(p.conta!)], "chave por chave")
      .toEqual([["id", "codigo", "nome"], ["id", "codigo", "nome"], ["id", "nome"], ["id", "nome"], ["id", "codigo", "descricao"]]);

    // As chaves de HOJE: os valores exatos, e os MESMOS de uma TOP igual sem padrões (os padrões não mexem nelas).
    expect(hoje(b)).toEqual({ contractVersion: 1, formato: 5, exigencias: [], condicoesPermitidas: null, geraTitulos: true,
      exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false, regrasGerais: REGRAS_GERAIS_NEUTRAS });
    const sem = await topCompraNo5({ secao: { documentoTroca: false } });
    expect(hoje(await ok(daTop("compras", sem.id))), "a mesma TOP sem padrões: as chaves de hoje iguais").toEqual(hoje(b));

    // UM CONTRATO SÓ: a Central Financeira (GET /financeiro/tops) devolve os MESMOS objetos para os mesmos cadastros.
    const pagar = await top(PAGAR, { configuracao: cfg5Fin(), padroesFinanceiros: { naturezaId: natureza, centroCustoId: centroP, tipoTituloId: tipoTitulo, contaBancariaId: conta } });
    const central = await ok(c.ligada.inject({ method: "GET", url: "/api/financeiro/tops?direcao=pagar", headers: c.h.headers() }));
    const item = (central.itens as { id: string; secao: unknown; padroes: Record<string, unknown> }[]).find((x) => x.id === pagar);
    expect(item, "premissa: a TOP a pagar está na Central Financeira").toBeDefined();
    expect(Object.keys(item!.padroes), "a mesma lista de chaves").toEqual(CHAVES_DOS_PADROES);
    expect(Object.keys(item!.secao as object)).toEqual(CHAVES_DA_SECAO);
    expect([item!.padroes.natureza, item!.padroes.centro, item!.padroes.tipoTitulo, item!.padroes.conta], "os mesmos objetos, chave por chave")
      .toEqual([p.natureza, p.centro, p.tipoTitulo, p.conta]);
  });

  it("LANC-I1b pedido de compra no formato 5 com a provisão, \"não troca\" e os cinco padrões → secao da versão e padroes iguais aos cadastros; as chaves de hoje iguais (o pedido: regrasGerais neutras, sem efeitos)", async () => {
    const t = await topPedidoNo5(destino.id, { secao: { provisao: true, documentoTroca: false }, padroes: CINCO() });
    const b = await ok(daTop("pedidos", t.id));
    expect(Object.keys(b)).toEqual(CHAVES);
    expect(b.contractVersion).toBe(1);
    expect(b.secao).toEqual({ provisao: true, documentoTroca: false, semClassificacao: "padrao_legado" });
    expect(b.padroes).toEqual(await esperados(CINCO()));
    expect(Object.keys(b.padroes as object)).toEqual(CHAVES_DOS_PADROES);
    expect(hoje(b)).toEqual({ contractVersion: 1, formato: 5, exigencias: [], condicoesPermitidas: null, geraTitulos: false,
      exigeFormaPagamento: false, exigeVencimento: false, exigeArmazem: false, regrasGerais: REGRAS_GERAIS_NEUTRAS });
    const sem = await topPedidoNo5(destino.id, { secao: { provisao: true, documentoTroca: false } });
    expect(hoje(await ok(daTop("pedidos", sem.id))), "o mesmo pedido sem padrões: as chaves de hoje iguais").toEqual(hoje(b));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I2 padroes null: o 5 sem padrões, os formatos 1 a 4 (fail-closed) e o orçamento sem a chave", () => {
  it("LANC-I2a formato 5 SEM padrões → padroes null, a seção ainda da versão (compra \"não troca\"; pedido com provisão)", async () => {
    const compra = await topCompraNo5({ secao: { documentoTroca: false } });
    const pedido = await topPedidoNo5(destino.id, { secao: { provisao: true } });
    for (const v of [compra.versaoId, pedido.versaoId]) expect(await linhasDosPadroes(v), "premissa: a versão NÃO tem linha de padrões").toBe(0);
    const bc = await ok(daTop("compras", compra.id));
    expect([Object.keys(bc), bc.formato, bc.secao, bc.padroes]).toEqual([CHAVES, 5, { provisao: false, documentoTroca: false, semClassificacao: "padrao_legado" }, null]);
    const bp = await ok(daTop("pedidos", pedido.id));
    expect([Object.keys(bp), bp.formato, bp.secao, bp.padroes]).toEqual([CHAVES, 5, { provisao: true, documentoTroca: true, semClassificacao: "padrao_legado" }, null]);
  });

  it("LANC-I2b formatos 1 a 4 → padroes null e a seção NEUTRA, também com uma linha de padrões NA versão (escrita direto no banco): só o 5 executa", async () => {
    const formatos = new Set<number>();
    let provados = 0;
    for (const [seg, familia] of [["compras", COMPRA], ["pedidos", PEDIDO_DE_COMPRA]] as const) {
      for (const [configuracao, formato] of [[cfg4(), 4], [cfg3(), 3], [configuracaoNeutraTopV2(), 2], [configuracaoNeutraTop(), 1]] as const) {
        const t = await topNoFormato(familia, configuracao, formato);
        await padroesDireto(t.id, t.versaoId);
        expect(await linhasDosPadroes(t.versaoId), `premissa (${seg}, formato ${formato}): a versão TEM a linha dos padrões`).toBe(1);
        const b = await ok(daTop(seg, t.id));
        expect(Object.keys(b), `${seg} formato ${formato}`).toEqual(CHAVES);
        expect([b.formato, b.secao, b.padroes], `${seg} formato ${formato}`).toEqual([formato, SECAO_NEUTRA, null]);
        formatos.add(formato);
        provados++;
      }
    }
    expect([provados, [...formatos].sort()], "os quatro formatos, nas duas espécies").toEqual([8, [1, 2, 3, 4]]);
    // CONTRASTE: a MESMA linha numa versão do formato 5 é lida (a linha não é o que muda; o formato é).
    const cinco = await topCompraNo5();
    await padroesDireto(cinco.id, cinco.versaoId);
    expect((await ok(daTop("compras", cinco.id))).padroes, "premissa: no formato 5, a mesma linha vira padroes").toEqual(await esperados(CINCO()));
  });

  it("LANC-I2c orçamento de compra (a rota não mudou): as chaves de hoje e só elas — nem secao, nem padroes —, no formato 4 e no 5 com linha de padrões", async () => {
    const quatro = await topNoFormato(ORCAMENTO_DE_COMPRA, cfg4(), 4);
    const cinco = await topNoFormato(ORCAMENTO_DE_COMPRA, cfg5Fin(), 5);
    await padroesDireto(cinco.id, cinco.versaoId);
    expect(await linhasDosPadroes(cinco.versaoId), "premissa: a versão do orçamento TEM a linha dos padrões").toBe(1);
    let provados = 0;
    for (const t of [quatro, cinco]) {
      const r = await c.ligada.inject({ method: "GET", url: `/api/compras/orcamentos/regras-da-operacao?tipo_operacao_id=${t.id}`, headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      expect(Object.keys(j(r)), "o contrato de hoje do orçamento").toEqual(CHAVES_DO_ORCAMENTO);
      expect(r.body.includes("padroes") || r.body.includes("secao"), "nada da LANCAMENTO-01 no orçamento").toBe(false);
      provados++;
    }
    expect(provados).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I3 a 404 e a autorização são as de hoje; a recusa não lê padrão", () => {
  it("LANC-I3a outra organização, inativa, excluída, outra família, inexistente, malformado e ausente → a MESMA 404 nas duas portas, corpo idêntico, sem padrão no corpo e sem consulta aos padrões", async () => {
    const inativa = await topCompraNo5({ padroes: CINCO() });
    const excluida = await topCompraNo5({ padroes: CINCO() });
    const pedidoComPadroes = await topPedidoNo5(destino.id, { padroes: CINCO() });
    const compraComPadroes = await topCompraNo5({ padroes: CINCO() });
    // A TOP da OUTRA organização, com os padrões DELA (os cadastros dela).
    const daOutra = async (sql: string) => (await c.admin.query<{ id: string }>(sql, [outra.orgId])).rows[0]!.id;
    const nOutra = await daOutra("select id::text as id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='analytic' and is_active and deleted_at is null order by code limit 1");
    const cOutra = await daOutra("select id::text as id from erp.cost_centers where organization_id=$1 and kind='analytic' and is_active and deleted_at is null order by code limit 1");
    const deOutraOrg = await top(COMPRA, { configuracao: cfg5Fin(), padroesFinanceiros: { naturezaId: nOutra, centroCustoId: cOutra } }, outra.headers);

    // PREMISSAS: cada TOP responde 200 COM padrões do lado certo (antes de inativar e de excluir; na porta da família; na organização dela).
    for (const [nome, seg, id, headers] of [
      ["inativa (antes)", "compras", inativa.id, undefined], ["excluída (antes)", "compras", excluida.id, undefined],
      ["pedido na porta do pedido", "pedidos", pedidoComPadroes.id, undefined], ["compra na porta da compra", "compras", compraComPadroes.id, undefined],
      ["a da outra organização, na dela", "compras", deOutraOrg, outra.headers],
    ] as const) {
      const b = await ok(daTop(seg, id, headers));
      expect(b.padroes, `premissa: ${nome} responde com padrões`).not.toBeNull();
    }
    expect((await c.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [inativa.id])).rowCount, "premissa: inativada").toBe(1);
    const del = await c.ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${excluida.id}?revisao=${await revisaoTop(excluida.id)}`, headers: c.h.headers() });
    expect(del.statusCode, del.body).toBeLessThan(300);
    expect((await c.admin.query<{ x: boolean }>("select excluido_em is not null x from erp.tipos_operacao where id=$1", [excluida.id])).rows[0]!.x, "premissa: excluída").toBe(true);

    const nomeDaNatureza = (await esperados(CINCO())).natureza as { nome: string };
    const casos: [string, Seg, string, string[]][] = [];
    for (const seg of ["compras", "pedidos"] as const) {
      casos.push(
        [`${seg}: outra organização`, seg, `?tipo_operacao_id=${deOutraOrg}`, ["existencia"]],
        [`${seg}: inativa`, seg, `?tipo_operacao_id=${inativa.id}`, ["existencia"]],
        [`${seg}: excluída`, seg, `?tipo_operacao_id=${excluida.id}`, ["existencia"]],
        [`${seg}: inexistente`, seg, `?tipo_operacao_id=${randomUUID()}`, ["existencia"]],
        [`${seg}: malformado`, seg, "?tipo_operacao_id=nao-e-uuid", []],
        [`${seg}: ausente`, seg, "", []],
      );
    }
    casos.push(
      ["compras: outra família (pedido de compra)", "compras", `?tipo_operacao_id=${pedidoComPadroes.id}`, ["existencia"]],
      ["pedidos: outra família (compra)", "pedidos", `?tipo_operacao_id=${compraComPadroes.id}`, ["existencia"]],
    );
    const corpos = new Set<string>();
    for (const [nome, seg, q, consultas] of casos) {
      const { r, sqls } = await comConsultas(() => regras(seg, q));
      expect(r.statusCode, `${nome} → ${r.body}`).toBe(404);
      expect(JSON.parse(r.body), nome).toEqual(NAO_ACHADA);
      expect([r.body.includes("padroes"), r.body.includes("secao"), r.body.includes(nomeDaNatureza.nome)], `${nome}: nada da TOP no corpo`).toEqual([false, false, false]);
      expect(sqls.length, `${nome}: N > 0, o espião mede`).toBeGreaterThan(0);
      expect(nomesDaTop(sqls), `${nome}: só a existência — nenhuma releitura, nenhum padrão antes da 404`).toEqual(consultas);
      expect(lePadroes(sqls), `${nome}: a recusa não lê padrão`).toBe(false);
      corpos.add(r.body);
    }
    expect(casos).toHaveLength(14);
    expect(corpos.size, "um corpo só, byte a byte").toBe(1);
  });

  it("LANC-I3b sem a porta operacional → o 403 de hoje (o mesmo do /layout-efetivo), sem padrão e sem tocar a TOP; com SÓ a porta (sem capacidade financeira) → 200 com os padrões", async () => {
    const compra = await topCompraNo5({ padroes: CINCO() });
    const pedido = await topPedidoNo5(destino.id, { padroes: CINCO() });
    const soVer = await usuario("LANC I3 só ver", ["compras.view", "pedidos_compra.view"]);
    let provados = 0;
    for (const [seg, id, permissao] of [["compras", compra.id, "compras.create"], ["pedidos", pedido.id, "pedidos_compra.create"]] as const) {
      const { r, sqls } = await comConsultas(() => daTop(seg, id, soVer));
      expect(r.statusCode, r.body).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: { code: "PERMISSION_DENIED", message: `Sem permissão: ${permissao}` } });
      const layout = await c.ligada.inject({ method: "GET", url: `/api/compras/${seg}/layout-efetivo?tipo_operacao_id=${id}`, headers: soVer });
      expect([layout.statusCode, layout.body], `${seg}: a recusa de hoje (a porta vizinha, que não mudou)`).toEqual([403, r.body]);
      expect(r.body.includes("padroes"), `${seg}: sem padrão no corpo`).toBe(false);
      expect(nomesDaTop(sqls), `${seg}: a recusa vem antes de qualquer leitura da TOP`).toEqual([]);
      provados++;
    }
    expect(provados).toBe(2);
    // Sem capacidade nova: quem só lança compra e pedido (nenhuma permissão financeira) recebe os padrões.
    const comprador = await usuario("LANC I3 comprador", ["compras.view", "compras.create", "pedidos_compra.view", "pedidos_compra.create"]);
    expect((await ok(daTop("compras", compra.id, comprador))).padroes).toEqual(await esperados(CINCO()));
    expect((await ok(daTop("pedidos", pedido.id, comprador))).padroes).toEqual(await esperados(CINCO()));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I4 as consultas da rota, contadas", () => {
  it("LANC-I4 compra formato 5 = 5 consultas da TOP, formato 4 = 4; pedido 4 / 3; os padrões numa leitura só (any($2::uuid[])), também com um padrão só; a 404 primeiro, os padrões por último; o resto da requisição igual", async () => {
    const compra5 = await topCompraNo5({ padroes: CINCO() });
    const compra5Um = await topCompraNo5({ padroes: { naturezaId: natureza } });
    const compra4 = await topNoFormato(COMPRA, cfg4(), 4);
    await padroesDireto(compra4.id, compra4.versaoId); // a linha no 4 não é lida (o 5 é o único que executa)
    const pedido5 = await topPedidoNo5(destino.id, { padroes: CINCO() });
    const pedido4 = await topNoFormato(PEDIDO_DE_COMPRA, cfg4(), 4);
    // Aquecimento: a primeira requisição de cada uma pode carregar o que as seguintes reaproveitam.
    for (const [seg, t] of [["compras", compra5], ["compras", compra5Um], ["compras", compra4], ["pedidos", pedido5], ["pedidos", pedido4]] as const) await ok(daTop(seg, t.id));

    const medir = (seg: Seg, t: TopNo5) => comConsultas(() => ok(daTop(seg, t.id)));
    const c5 = await medir("compras", compra5); const c5um = await medir("compras", compra5Um); const c4 = await medir("compras", compra4);
    const p5 = await medir("pedidos", pedido5); const p4 = await medir("pedidos", pedido4);
    expect([c5.r.padroes !== null, c5um.r.padroes !== null, c4.r.padroes, p5.r.padroes !== null, p4.r.padroes], "premissa: o que cada uma responde").toEqual([true, true, null, true, null]);
    expect([c5.r.formato, c4.r.formato, p5.r.formato, p4.r.formato], "premissa: os formatos medidos").toEqual([5, 4, 5, 4]);

    // Os números EXATOS e a ordem: a existência (a 404) primeiro; a releitura declarada; os padrões por último.
    expect(nomesDaTop(c5.sqls), "compra formato 5: 5").toEqual(["existencia", "regras", "efeitos", "releitura", "padroes"]);
    expect(nomesDaTop(c5um.sqls), "compra formato 5 com UM padrão: as mesmas 5").toEqual(["existencia", "regras", "efeitos", "releitura", "padroes"]);
    expect(nomesDaTop(c4.sqls), "compra formato 4: 4").toEqual(["existencia", "regras", "efeitos", "releitura"]);
    expect(nomesDaTop(p5.sqls), "pedido formato 5: 4").toEqual(["existencia", "regras", "releitura", "padroes"]);
    expect(nomesDaTop(p4.sqls), "pedido formato 4: 3").toEqual(["existencia", "regras", "releitura"]);

    // Sem N+1: os CINCO cadastros numa leitura só, com `any($2::uuid[])`; nenhum cadastro lido fora dela.
    for (const [nome, m] of [["compra 5", c5], ["compra 5 com um", c5um], ["pedido 5", p5]] as const) {
      const padroes = m.sqls.filter((s) => /\berp\.tipos_operacao_versao_financeiro\b/.test(s));
      expect(padroes, `${nome}: UMA leitura dos padrões`).toHaveLength(1);
      expect(padroes[0], `${nome}: em lote`).toContain("any($2::uuid[])");
      expect(deCadastro(m.sqls), `${nome}: os cadastros só dentro dela`).toEqual(padroes);
    }
    for (const [nome, m] of [["compra 4", c4], ["pedido 4", p4]] as const) {
      expect([lePadroes(m.sqls), deCadastro(m.sqls)], `${nome}: nenhum padrão lido`).toEqual([false, []]);
    }
    // O resto da requisição (transação, contexto) é o MESMO: a diferença entre o 5 e o 4 é exatamente a leitura dos padrões.
    const resto = (sqls: string[]) => sqls.filter((s) => !/\berp\.tipos_operacao/.test(s));
    expect(resto(c5.sqls).length, "N > 0: o espião mede o resto também").toBeGreaterThan(0);
    expect(resto(c5.sqls), "compra: o resto igual").toEqual(resto(c4.sqls));
    expect(resto(p5.sqls), "pedido: o resto igual").toEqual(resto(p4.sqls));
    expect([c5.sqls.length - c4.sqls.length, c5um.sqls.length - c5.sqls.length, p5.sqls.length - p4.sqls.length], "o 5 custa UMA consulta a mais que o 4; um padrão ou cinco, o mesmo").toEqual([1, 0, 1]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I5 cadastro morto depois: o padrão continua vindo com o nome (o histórico da versão)", () => {
  it("LANC-I5 a natureza inativada e o centro excluído DEPOIS da TOP → padroes com os mesmos nomes, como na Central Financeira; premissa: o cadastro morto já não serve para uma TOP nova", async () => {
    const n = await cadastroDespesa("Natureza que morre LANC-I5");
    const ce = await centro("Centro que morre LANC-I5");
    const t = await topCompraNo5({ padroes: { naturezaId: n, centroCustoId: ce } });
    const pagar = await top(PAGAR, { configuracao: cfg5Fin(), padroesFinanceiros: { naturezaId: n, centroCustoId: ce } });
    const central = async () => {
      const l = await ok(c.ligada.inject({ method: "GET", url: "/api/financeiro/tops?direcao=pagar", headers: c.h.headers() }));
      const item = (l.itens as { id: string; padroes: Padroes }[]).find((x) => x.id === pagar);
      expect(item, "premissa: a TOP a pagar está na Central Financeira").toBeDefined();
      return item!.padroes;
    };
    const vivos = await esperados({ naturezaId: n, centroCustoId: ce });
    const antes = (await ok(daTop("compras", t.id))).padroes as Padroes;
    expect([antes.natureza, antes.centro, antes.tipoTitulo, antes.formaPagamento, antes.conta], "premissa: vivos, com o nome").toEqual([vivos.natureza, vivos.centro, null, null, null]);

    expect((await c.admin.query("update erp.financial_categories set is_active=false where id=$1", [n])).rowCount, "premissa: natureza inativada").toBe(1);
    expect((await c.admin.query("update erp.cost_centers set deleted_at=now() where id=$1", [ce])).rowCount, "premissa: centro excluído").toBe(1);
    // PREMISSA: mortos de verdade — a porta da TOP já os recusa para uma TOP nova.
    const nova = await criarTop(COMPRA, { configuracao: cfg5Fin(), padroesFinanceiros: { naturezaId: n, centroCustoId: ce } });
    expect(nova.statusCode, nova.body).toBe(422);
    expect((erro(nova).details as { recusas: { caminho: string }[] }).recusas.map((x) => x.caminho)).toEqual(["padroesFinanceiros.naturezaId", "padroesFinanceiros.centroCustoId"]);

    // O COMPORTAMENTO REGISTRADO: a versão guarda o histórico — os mesmos objetos, com o nome; e é o da Central Financeira.
    const depois = (await ok(daTop("compras", t.id))).padroes as Padroes;
    expect([depois.natureza, depois.centro], "a rota de compras: os mesmos de antes").toEqual([vivos.natureza, vivos.centro]);
    const cf = await central();
    expect([cf.natureza, cf.centro], "a Central Financeira: os mesmos").toEqual([depois.natureza, depois.centro]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I6 o produto diz o local: o que o servidor de hoje já responde", () => {
  const opcoes = (empresa: string, local: string, headers: Hdr = c.h.headers()) =>
    c.h.app.inject({ method: "GET", url: `/api/resources/warehouses/options?empresa_id=${empresa}&id=${local}`, headers });
  const idsDe = (r: Resposta) => { expect(r.statusCode, r.body).toBe(200); return (j(r) as unknown as { id: string }[]).map((x) => x.id); };
  const empresaDoLocal = async (id: string) => (await c.admin.query<{ e: string }>("select empresa_id::text e from erp.warehouses where id=$1", [id])).rows[0]!.e;
  const descricaoDoLocal = async (id: string) => (await c.admin.query<{ d: string }>("select description d from erp.warehouses where id=$1", [id])).rows[0]!.d;

  it("LANC-I6a GET /resources/products/:id traz default_warehouse_id e default_warehouse_id_label (o rótulo do local); sem local, os dois nulos", async () => {
    const com = await produto(); const sem = await produto();
    expect((await c.admin.query("update erp.products set default_warehouse_id=$2 where id=$1", [com.id, c.I.warehouse])).rowCount, "premissa: o produto tem local padrão").toBe(1);
    let provados = 0;
    for (const [p, local, rotulo] of [[com, c.I.warehouse, await descricaoDoLocal(c.I.warehouse)], [sem, null, null]] as const) {
      const r = await c.h.app.inject({ method: "GET", url: `/api/resources/products/${p.id}`, headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      expect([j(r).default_warehouse_id, j(r).default_warehouse_id_label], p.nome).toEqual([local, rotulo]);
      provados++;
    }
    expect(provados).toBe(2);
  });

  it("LANC-I6b /resources/warehouses/options?empresa_id=&id= → [o local] na empresa dele, [] de OUTRA empresa, [] inativo; 200 para o comprador sem warehouses.view", async () => {
    const e1 = c.I.empresa;
    const e2 = await empresaDoLocal(c.I.warehouseEmpresa2);
    expect([await empresaDoLocal(c.I.warehouse), e2 === e1], "premissa: um local de cada empresa").toEqual([e1, false]);
    const primeiro = j(await opcoes(e1, c.I.warehouse)) as unknown as { id: string; label: string }[];
    expect(primeiro, "o local, com o rótulo").toEqual([expect.objectContaining({ id: c.I.warehouse, label: await descricaoDoLocal(c.I.warehouse) })]);
    expect(idsDe(await opcoes(e1, c.I.warehouseEmpresa2)), "local de OUTRA empresa: nada").toEqual([]);
    expect(idsDe(await opcoes(e2, c.I.warehouseEmpresa2)), "premissa: na empresa dele, ele vem").toEqual([c.I.warehouseEmpresa2]);

    const inativo = (await c.admin.query<{ id: string }>(
      "insert into erp.warehouses (organization_id, empresa_id, initials, description) values ($1,$2,$3,$4) returning id::text as id",
      [c.h.demo.orgId, e1, `L6${unico()}`.toUpperCase().slice(0, 10), "Local que se inativa LANC-I6"])).rows[0]!.id;
    expect(idsDe(await opcoes(e1, inativo)), "premissa: ativo, ele vem").toEqual([inativo]);
    expect((await c.admin.query("update erp.warehouses set is_active=false where id=$1", [inativo])).rowCount).toBe(1);
    expect(idsDe(await opcoes(e1, inativo)), "inativo: nada").toEqual([]);

    const comprador = await usuario("LANC I6 comprador", ["compras.view", "compras.create", "pedidos_compra.view", "pedidos_compra.create"]);
    const semLocais = await c.h.app.inject({ method: "GET", url: `/api/resources/warehouses/${c.I.warehouse}`, headers: comprador });
    expect(semLocais.statusCode, `premissa: o comprador não tem warehouses.view — ${semLocais.body}`).toBe(403);
    expect(idsDe(await opcoes(e1, c.I.warehouse, comprador)), "o seletor responde ao comprador").toEqual([c.I.warehouse]);
    expect(idsDe(await opcoes(e1, c.I.warehouseEmpresa2, comprador)), "e o local de outra empresa continua fora").toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-I7
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-I7 a rede da R5: local de OUTRA empresa no item é recusado pelo servidor", () => {
  it("LANC-I7 compra E pedido na empresa 1 com o item no local da empresa 2 → 422 em itens[0].armazem_id, nada gravado; premissa: o MESMO corpo na empresa 2 salva", async () => {
    const p = await produto();
    const e2 = (await c.admin.query<{ e: string }>("select empresa_id::text e from erp.warehouses where id=$1", [c.I.warehouseEmpresa2])).rows[0]!.e;
    expect(e2, "premissa: o local é de OUTRA empresa").not.toBe(c.I.empresa);
    let provados = 0;
    for (const especie of ["compra", "pedido"] as const) {
      const corpo = (empresa: string) => corpoCompra([itemCompra(p.id, "1", "10.00", { armazem_id: c.I.warehouseEmpresa2 })], { empresa_id: empresa }, especie);
      const antes = await contar("documentos_compra");
      const r = await lancarCompra(especie, corpo(c.I.empresa));
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(422);
      expect(erro(r), especie).toEqual({ code: "VALIDATION_ERROR", message: MSG_LOCAL, details: [{ path: "itens[0].armazem_id", message: MSG_LOCAL }] });
      expect(await contar("documentos_compra"), `${especie}: nada gravado`).toBe(antes);
      const certo = await lancarCompra(especie, corpo(e2));
      expect(certo.statusCode, `premissa (${especie}): na empresa do local, salva — ${certo.body}`).toBe(201);
      expect(await contar("documentos_compra"), `premissa (${especie}): gravou`).toBe(antes + 1);
      provados++;
    }
    expect(provados).toBe(2);
  });
});
