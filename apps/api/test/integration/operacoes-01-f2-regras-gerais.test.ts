import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { configuracaoNeutraTopV2, regrasGeraisDaVersaoTop } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg3, cfg4, top, novaVersao, revisaoTop, versaoAtualNoBanco, versaoDireta,
  produto, produtoComSaldo, itemVenda, corpoVenda, lancarVenda, vendaLancada, patchVenda, versaoDaVenda, situacaoNoBanco,
  itemCompra, corpoCompra, lancarCompra,
  type Resposta, type Erro, type Hdr,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F2 (decisão 279) — `regrasGerais` NAS REGRAS DA OPERAÇÃO (RG-1..RG-8).
 *
 * `GET /api/sales/<seg>/regras-da-operacao`, `GET /api/compras/<seg>/regras-da-operacao` e o `regras` de
 * `GET /api/sales/<seg>/:id/edicao` ganham, como ÚLTIMA chave e de forma aditiva, `regrasGerais: { confirmacaoAutomatica,
 * aceitaSemItens }`: o que a Central precisa saber ANTES de salvar para dizer "Salvar e confirmar" e para não cobrar
 * "ao menos um item" quando a TOP permite. O valor é o da VERSÃO que a porta lê (a ATUAL no lançamento, a CONGELADA na
 * edição), pela MESMA função da gravação (`regrasGeraisDaVersaoTop`), e só na variante que executa regra geral (venda,
 * compra); orçamento, pedido de venda e pedido de compra respondem sempre o neutro `{ false, false }`.
 *
 *   RG-1  venda formato 4: o bloco, por último, cada regra ligando só a sua; as chaves de hoje iguais;
 *   RG-2  venda formato 3 com Automática e Permitido DECLARADOS (o corte da 277) e formato 4 ilegível → neutro;
 *   RG-3  orçamento e pedido → neutro — também com a versão que declara as duas (escrita direto no banco);
 *   RG-4  compra formato 4 → o bloco, por último; pedido de compra → neutro;
 *   RG-5  a 404 não muda (corpo idêntico);
 *   RG-6  COERÊNCIA com a gravação: o que o bloco diz é o que o POST faz (201 com/sem `confirmacaoAutomatica`, itens
 *         vazios 201/422), na venda e na compra;
 *   RG-7  `/edicao` pela versão CONGELADA × `/regras-da-operacao` pela ATUAL — e a PATCH faz o que o `/edicao` diz;
 *   RG-8  o bloco não custa consulta: as MESMAS consultas (texto e ordem) para uma TOP que liga as duas e para uma que
 *         não liga nada; a família vem por subselect DENTRO da leitura da versão que já existia (a mesma SQL), e a
 *         versão continua lida as vezes de antes do bloco — na venda, duas (a porta e as regras); na compra, três (a
 *         porta, as regras e os efeitos previstos);
 *         nenhuma leitura própria da gravação (`lerVersaoCongeladaTop`). O "como antes" é o desenho do diff (nenhuma
 *         chamada nova ao banco nas rotas); o teste fixa o número para que uma leitura a mais reprove.
 *
 * O QUE CONTA COMO PROVA: toda conclusão vem com a premissa — a versão no formato pedido (lida no banco), o que a
 * função da gravação diz da versão guardada, e o efeito no banco (situação, itens) do POST que o bloco anuncia.
 * Tudo pela instância `ligada` (a de produção), que também é a que cria as TOPs.
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o contrato e as recusas de hoje ───────────────

type RegrasGerais = { confirmacaoAutomatica: boolean; aceitaSemItens: boolean };
const NEUTRO: RegrasGerais = { confirmacaoAutomatica: false, aceitaSemItens: false };
const AS_DUAS: RegrasGerais = { confirmacaoAutomatica: true, aceitaSemItens: true };

/** As chaves de `/regras-da-operacao` de vendas, na ordem: as de hoje + `regrasGerais` por último. */
const CHAVES_VENDA = ["formato", "exigencias", "condicoesPermitidas", "clienteEmAtraso", "reservaEstoque", "regrasGerais"];
/** As chaves de `/regras-da-operacao` de compras, na ordem: as de hoje + `regrasGerais` por último. */
const CHAVES_COMPRA = ["contractVersion", "formato", "exigencias", "condicoesPermitidas", "geraTitulos", "exigeFormaPagamento", "exigeVencimento", "exigeArmazem", "regrasGerais"];
/** As chaves do POST de hoje (sem a confirmação automática). */
const CHAVES_DO_POST_VENDA = ["id", "subtotal", "total"];
const CHAVES_DO_POST_COMPRA = ["id", "codigo", "especie", "situacao", "valor_itens", "valor_total"];
/** As recusas de HOJE dos itens vazios (o esquema estrito, pelo plugin de erros). */
const RECUSA_VENDA_SEM_ITENS: Erro = { code: "VALIDATION_ERROR", message: "items: Valor mínimo: 1", details: [{ path: "items", message: "Valor mínimo: 1" }] };
const RECUSA_COMPRA_SEM_ITENS: Erro = { code: "VALIDATION_ERROR", message: "itens: Valor mínimo: 1", details: [{ path: "itens", message: "Valor mínimo: 1" }] };
/** A 404 de hoje das regras da operação (a de `/layout-efetivo`). */
const NAO_ACHADA: Erro = { code: "NOT_FOUND", message: "Tipo de operação não encontrado" };

// ─────────────── as TOPs do caso ───────────────

const automaticaEPermitido = () => cfg4((x) => { x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; });
const soAutomatica = () => cfg4((x) => { x.geral.confirmacao = "automatica"; });
const soPermitido = () => cfg4((x) => { x.geral.documentoSemItens = "permitido"; });
/** O que as TOPs de produção declaram no formato 3 (o corte): Automática e Permitido gravados, que só declaram. */
const comoProducao = () => cfg3((x) => { x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; });

/** Uma TOP nova da família, com a PREMISSA de que o banco guardou a versão no formato pedido. */
async function topDa(codigoBase: string, configuracao: { versaoSchema: number }): Promise<string> {
  const id = await top(codigoBase, { configuracao });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato pedido`).toBe(configuracao.versaoSchema);
  return id;
}
/** O que a GRAVAÇÃO decide da versão ATUAL da TOP, como o banco a guarda (a premissa de todo valor esperado). */
async function daGravacao(topId: string, codigoBase: string): Promise<RegrasGerais | "ilegivel"> {
  const r = regrasGeraisDaVersaoTop({ codigoBase, configuracao: (await versaoAtualNoBanco(topId)).configuracao });
  return r.ok ? { confirmacaoAutomatica: r.regras.confirmacaoAutomatica, aceitaSemItens: r.regras.aceitaSemItens } : "ilegivel";
}

// ─────────────── as portas ───────────────

type SegVenda = "budgets" | "orders" | "sales";
type SegCompra = "pedidos" | "compras";
const regrasVenda = (seg: SegVenda, q: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/sales/${seg}/regras-da-operacao${q}`, headers });
const regrasCompra = (seg: SegCompra, q: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/${seg}/regras-da-operacao${q}`, headers });
/** O 200 das regras da operação, e o corpo. */
async function ok(r: Promise<Resposta>): Promise<Record<string, unknown>> {
  const x = await r;
  expect(x.statusCode, x.body).toBe(200);
  return j(x);
}
const blocoVenda = async (seg: SegVenda, topId: string) => (await ok(regrasVenda(seg, `?tipo_operacao_id=${topId}`))).regrasGerais;
const blocoCompra = async (seg: SegCompra, topId: string) => (await ok(regrasCompra(seg, `?tipo_operacao_id=${topId}`))).regrasGerais;
const lancarDaVariante = (seg: "budgets" | "orders", corpo: Record<string, unknown>): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/${seg}`, headers: c.h.headers(), payload: corpo });
const edicao = (seg: SegVenda, id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/sales/${seg}/${id}/edicao`, headers: c.h.headers() });
const itensDaVenda = async (id: string) => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.sales_document_items where document_id=$1", [id])).rows[0]!.n);
const itensDaCompra = async (id: string) => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.documentos_compra_itens where documento_id=$1", [id])).rows[0]!.n);

/** As consultas SQL que a requisição dispara (o molde de `editar-01-edicao.test.ts`): o texto de cada uma, em ordem. */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const sqls = espiao.mock.calls.map((x) => x[0] as unknown).map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
      .filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-1 venda formato 4: regrasGerais por último, cada regra ligando só a sua", () => {
  it("RG-1 Automática + Permitido → { true, true } como ÚLTIMA chave; as chaves de hoje iguais; só Automática / só Permitido / neutro ligam só a sua", async () => {
    const t = await topDa("vendas.venda", automaticaEPermitido());
    expect(await daGravacao(t, "vendas.venda"), "premissa: a gravação confirma e aceita sem itens").toEqual(AS_DUAS);
    const b = await ok(regrasVenda("sales", `?tipo_operacao_id=${t}`));
    expect(Object.keys(b), "as chaves de hoje, na ordem, e regrasGerais por último").toEqual(CHAVES_VENDA);
    expect(b).toEqual({ formato: 4, exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 }, reservaEstoque: false, regrasGerais: AS_DUAS });
    expect(Object.keys(b.regrasGerais as object), "o bloco tem as duas chaves, e só elas").toEqual(["confirmacaoAutomatica", "aceitaSemItens"]);

    let provados = 0;
    for (const [nome, configuracao, esperado] of [
      ["só Automática", soAutomatica(), { confirmacaoAutomatica: true, aceitaSemItens: false }],
      ["só Permitido", soPermitido(), { confirmacaoAutomatica: false, aceitaSemItens: true }],
      ["neutro do formato 4", cfg4(), NEUTRO],
    ] as const) {
      const id = await topDa("vendas.venda", configuracao);
      expect(await daGravacao(id, "vendas.venda"), `premissa (${nome})`).toEqual(esperado);
      expect(await blocoVenda("sales", id), nome).toEqual(esperado);
      provados++;
    }
    expect(provados).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-2 o corte: formato 3 que declara as duas, e formato 4 ilegível → o neutro", () => {
  it("RG-2a venda formato 3 com Automática e Permitido DECLARADOS (como o pedido de compra de produção) → { false, false }", async () => {
    const t = await topDa("vendas.venda", comoProducao());
    const guardada = (await versaoAtualNoBanco(t)).configuracao.geral as Record<string, unknown>;
    expect([guardada.confirmacao, guardada.documentoSemItens], "premissa: o formato 3 DECLARA as duas").toEqual(["automatica", "permitido"]);
    expect(await daGravacao(t, "vendas.venda"), "premissa: a gravação lê o formato 3 como neutro").toEqual(NEUTRO);
    const b = await ok(regrasVenda("sales", `?tipo_operacao_id=${t}`));
    expect(Object.keys(b)).toEqual(CHAVES_VENDA);
    expect(b).toMatchObject({ formato: 3, regrasGerais: NEUTRO });
  });

  it("RG-2b venda formato 4 ILEGÍVEL (escrito direto no banco, declarando as duas) → { false, false }; a gravação também não sabe ler", async () => {
    const t = await topDa("vendas.venda", cfg4());
    const ilegivel = { ...automaticaEPermitido(), geral: { ...automaticaEPermitido().geral, alteracaoAposConfirmacao: "talvez" } };
    await versaoDireta(t, ilegivel);
    const v = await versaoAtualNoBanco(t);
    expect([v.configuracao_schema_version, (v.configuracao.geral as Record<string, unknown>).confirmacao], "premissa: a versão atual é a direta, formato 4 Automática").toEqual([4, "automatica"]);
    expect(await daGravacao(t, "vendas.venda"), "premissa: a gravação não sabe ler esta versão").toBe("ilegivel");
    const b = await ok(regrasVenda("sales", `?tipo_operacao_id=${t}`));
    expect(Object.keys(b)).toEqual(CHAVES_VENDA);
    // Ilegível: nem as restrições (resposta neutra das chaves de hoje) nem as regras gerais.
    expect(b).toEqual({ formato: 4, exigencias: [], condicoesPermitidas: null, clienteEmAtraso: { politica: "nao_valida", toleranciaDias: 0 }, reservaEstoque: false, regrasGerais: NEUTRO });
    // E a gravação faz o que o neutro diz: itens vazios → a recusa de hoje.
    const vazio = await lancarVenda(corpoVenda([], { tipo_operacao_id: t }));
    expect(vazio.statusCode, vazio.body).toBe(422);
    expect(erro(vazio)).toEqual(RECUSA_VENDA_SEM_ITENS);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-3 orçamento e pedido de venda: sempre o neutro (a variante não executa regra geral)", () => {
  it("RG-3 TOP da família (neutra) → { false, false }; e com a versão que DECLARA as duas (direto no banco, a matriz não deixa pela API) → ainda o neutro, e o POST faz o mesmo", async () => {
    // Premissa do contraste: a mesma configuração, numa TOP de VENDA, liga as duas na porta `sales`.
    expect(await blocoVenda("sales", await topDa("vendas.venda", automaticaEPermitido())), "premissa: na venda, liga").toEqual(AS_DUAS);
    let provados = 0;
    for (const [seg, familia] of [["budgets", "vendas.orcamento"], ["orders", "vendas.pedido"]] as const) {
      const neutra = await topDa(familia, cfg4());
      const b = await ok(regrasVenda(seg, `?tipo_operacao_id=${neutra}`));
      expect(Object.keys(b), seg).toEqual(CHAVES_VENDA);
      expect(b.regrasGerais, `${seg}: a TOP neutra`).toEqual(NEUTRO);

      const declarando = await topDa(familia, cfg4());
      await versaoDireta(declarando, automaticaEPermitido());
      expect(await daGravacao(declarando, familia), `premissa (${seg}): a VERSÃO, sozinha, ligaria as duas`).toEqual(AS_DUAS);
      expect(await blocoVenda(seg, declarando), `${seg}: a variante decide — neutro`).toEqual(NEUTRO);
      // O POST da variante faz o que o neutro diz: com item, o corpo de hoje (sem a confirmação); sem itens, a recusa de hoje.
      const p = await produtoComSaldo("5");
      const comItem = await lancarDaVariante(seg, corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: declarando }));
      expect(comItem.statusCode, comItem.body).toBe(201);
      expect(Object.keys(j(comItem)), `${seg}: sem confirmacaoAutomatica`).toEqual(CHAVES_DO_POST_VENDA);
      expect(await situacaoNoBanco("sales_documents", (j(comItem) as { id: string }).id)).toBe("open");
      const vazio = await lancarDaVariante(seg, corpoVenda([], { tipo_operacao_id: declarando }));
      expect(vazio.statusCode, vazio.body).toBe(422);
      expect(erro(vazio), seg).toEqual(RECUSA_VENDA_SEM_ITENS);
      provados++;
    }
    expect(provados).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-4 compras: a compra formato 4 diz as regras; o pedido de compra, nunca", () => {
  it("RG-4 compra Automática + Permitido → { true, true } por último, as chaves de hoje + regrasGerais; pedido de compra (neutro e declarando as duas) → { false, false }", async () => {
    const t = await topDa("compras.compra", automaticaEPermitido());
    expect(await daGravacao(t, "compras.compra"), "premissa: a gravação confirma e aceita sem itens").toEqual(AS_DUAS);
    const b = await ok(regrasCompra("compras", `?tipo_operacao_id=${t}`));
    expect(Object.keys(b), "as chaves de hoje, na ordem, e regrasGerais por último").toEqual(CHAVES_COMPRA);
    expect(b).toMatchObject({ contractVersion: 1, formato: 4, exigencias: [], condicoesPermitidas: null, regrasGerais: AS_DUAS });

    const pedidoNeutro = await topDa("compras.pedido", cfg4());
    const p = await ok(regrasCompra("pedidos", `?tipo_operacao_id=${pedidoNeutro}`));
    expect(Object.keys(p)).toEqual(CHAVES_COMPRA);
    expect(p.regrasGerais, "pedido de compra neutro").toEqual(NEUTRO);

    const pedidoDeclarando = await topDa("compras.pedido", cfg4());
    await versaoDireta(pedidoDeclarando, automaticaEPermitido());
    expect(await daGravacao(pedidoDeclarando, "compras.pedido"), "premissa: a VERSÃO, sozinha, ligaria as duas").toEqual(AS_DUAS);
    expect(await blocoCompra("pedidos", pedidoDeclarando), "a espécie decide — neutro").toEqual(NEUTRO);
    // O POST do pedido faz o que o neutro diz: com item, o corpo de hoje; sem itens, a recusa de hoje.
    const prod = await produto();
    const comItem = await lancarCompra("pedido", corpoCompra([itemCompra(prod.id, "1", "10.00")], { tipo_operacao_id: pedidoDeclarando }, "pedido"));
    expect(comItem.statusCode, comItem.body).toBe(201);
    expect(Object.keys(j(comItem)), "pedido: sem confirmacaoAutomatica").toEqual(CHAVES_DO_POST_COMPRA);
    const vazio = await lancarCompra("pedido", corpoCompra([], { tipo_operacao_id: pedidoDeclarando }, "pedido"));
    expect(vazio.statusCode, vazio.body).toBe(422);
    expect(erro(vazio)).toEqual(RECUSA_COMPRA_SEM_ITENS);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-5 a 404 não muda", () => {
  it("RG-5 inexistente, malformado, outra família, ausente, inativa e excluída → a MESMA 404 de hoje, corpo idêntico, nas portas de venda e de compra; premissa: a TOP válida responde 200 com o bloco", async () => {
    const venda = await topDa("vendas.venda", automaticaEPermitido());
    const compra = await topDa("compras.compra", automaticaEPermitido());
    const deOrcamento = await topDa("vendas.orcamento", cfg4());
    const dePedidoCompra = await topDa("compras.pedido", cfg4());
    const inativaVenda = await topDa("vendas.venda", automaticaEPermitido());
    const inativaCompra = await topDa("compras.compra", automaticaEPermitido());
    for (const id of [inativaVenda, inativaCompra]) {
      expect((await c.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [id])).rowCount, "premissa: desativada").toBe(1);
    }
    const excluidaVenda = await topDa("vendas.venda", automaticaEPermitido());
    const excluidaCompra = await topDa("compras.compra", automaticaEPermitido());
    for (const id of [excluidaVenda, excluidaCompra]) {
      const del = await c.ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${id}?revisao=${await revisaoTop(id)}`, headers: c.h.headers() });
      expect(del.statusCode, del.body).toBeLessThan(300);
      expect((await c.admin.query<{ x: boolean }>("select excluido_em is not null x from erp.tipos_operacao where id=$1", [id])).rows[0]!.x, "premissa: excluída").toBe(true);
    }
    // Premissa: as portas respondem 200, com o bloco, para a TOP válida de cada uma.
    expect(await blocoVenda("sales", venda)).toEqual(AS_DUAS);
    expect(await blocoCompra("compras", compra)).toEqual(AS_DUAS);

    const corpos: string[] = [];
    const casos: [string, () => Promise<Resposta>][] = [];
    for (const [porta, consultar, outraFamilia, inativa, excluida] of [
      ["vendas", (q: string) => regrasVenda("sales", q), deOrcamento, inativaVenda, excluidaVenda],
      ["compras", (q: string) => regrasCompra("compras", q), dePedidoCompra, inativaCompra, excluidaCompra],
    ] as const) {
      casos.push(
        [`${porta}: inexistente`, () => consultar(`?tipo_operacao_id=${randomUUID()}`)],
        [`${porta}: malformado`, () => consultar("?tipo_operacao_id=nao-e-uuid")],
        [`${porta}: outra família`, () => consultar(`?tipo_operacao_id=${outraFamilia}`)],
        [`${porta}: ausente`, () => consultar("")],
        [`${porta}: inativa`, () => consultar(`?tipo_operacao_id=${inativa}`)],
        [`${porta}: excluída`, () => consultar(`?tipo_operacao_id=${excluida}`)],
      );
    }
    for (const [nome, consultar] of casos) {
      const r = await consultar();
      expect(r.statusCode, `${nome} → ${r.body}`).toBe(404);
      expect(j(r), nome).toEqual({ error: NAO_ACHADA });
      corpos.push(r.body);
    }
    expect(casos).toHaveLength(12);
    expect(new Set(corpos).size, "um corpo só, byte a byte").toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
/** As TOPs da coerência: as quatro combinações do formato 4 e o corte do formato 3. */
const MATRIZ: readonly [string, () => { versaoSchema: number }][] = [
  ["formato 4 Automática + Permitido", automaticaEPermitido],
  ["formato 4 só Automática", soAutomatica],
  ["formato 4 só Permitido", soPermitido],
  ["formato 4 neutro", () => cfg4()],
  ["formato 3 declarando as duas", comoProducao],
];

describe("RG-6 COERÊNCIA com a gravação: o que o bloco diz é o que o POST faz", () => {
  it("RG-6a venda: confirmacaoAutomatica ⇔ o 201 traz a chave (e confirma); aceitaSemItens ⇔ items [] dá 201, senão a 422 de hoje", async () => {
    const combinacoes = new Set<string>();
    for (const [nome, configuracao] of MATRIZ) {
      const t = await topDa("vendas.venda", configuracao());
      const rg = (await blocoVenda("sales", t)) as RegrasGerais;
      expect(await daGravacao(t, "vendas.venda"), `premissa (${nome}): o bloco é o que a gravação lê`).toEqual(rg);
      combinacoes.add(JSON.stringify(rg));

      // Com um item: a chave da confirmação automática aparece exatamente quando o bloco a anuncia.
      const p = await produtoComSaldo("5");
      const comItem = await lancarVenda(corpoVenda([itemVenda(p.id, "1", "10.00")], { tipo_operacao_id: t }));
      expect(comItem.statusCode, `${nome}: ${comItem.body}`).toBe(201);
      const b = j(comItem) as Record<string, unknown> & { id: string };
      if (rg.confirmacaoAutomatica) {
        expect(Object.keys(b), nome).toEqual([...CHAVES_DO_POST_VENDA, "confirmacaoAutomatica"]);
        expect(b.confirmacaoAutomatica, nome).toEqual({ confirmado: true });
        expect(await situacaoNoBanco("sales_documents", b.id), `${nome}: confirmada no banco`).toBe("confirmed");
      } else {
        expect(Object.keys(b), `${nome}: o corpo de hoje`).toEqual(CHAVES_DO_POST_VENDA);
        expect(await situacaoNoBanco("sales_documents", b.id), `${nome}: aberta no banco`).toBe("open");
      }

      // Sem itens: 201 exatamente quando o bloco aceita; senão a recusa de hoje, byte a byte.
      const vazio = await lancarVenda(corpoVenda([], { tipo_operacao_id: t }));
      if (rg.aceitaSemItens) {
        expect(vazio.statusCode, `${nome}: ${vazio.body}`).toBe(201);
        const v = j(vazio) as Record<string, unknown> & { id: string };
        expect(await itensDaVenda(v.id), `${nome}: salva sem itens`).toBe(0);
        expect(Object.keys(v).includes("confirmacaoAutomatica"), `${nome}: a chave segue o bloco também sem itens`).toBe(rg.confirmacaoAutomatica);
      } else {
        expect(vazio.statusCode, `${nome}: ${vazio.body}`).toBe(422);
        expect(erro(vazio), nome).toEqual(RECUSA_VENDA_SEM_ITENS);
      }
    }
    // Não-vacuidade: as quatro combinações apareceram (e o formato 3 caiu no neutro, que já é uma delas).
    expect([...combinacoes].sort()).toEqual([AS_DUAS, NEUTRO, { confirmacaoAutomatica: true, aceitaSemItens: false }, { confirmacaoAutomatica: false, aceitaSemItens: true }].map((x) => JSON.stringify(x)).sort());
  });

  it("RG-6b compra: confirmacaoAutomatica ⇔ o 201 traz a chave (e confirma); aceitaSemItens ⇔ itens [] dá 201, senão a 422 de hoje", async () => {
    const combinacoes = new Set<string>();
    for (const [nome, configuracao] of MATRIZ) {
      const t = await topDa("compras.compra", configuracao());
      const rg = (await blocoCompra("compras", t)) as RegrasGerais;
      expect(await daGravacao(t, "compras.compra"), `premissa (${nome}): o bloco é o que a gravação lê`).toEqual(rg);
      combinacoes.add(JSON.stringify(rg));

      const p = await produto();
      const comItem = await lancarCompra("compra", corpoCompra([itemCompra(p.id, "1", "10.00")], { tipo_operacao_id: t }));
      expect(comItem.statusCode, `${nome}: ${comItem.body}`).toBe(201);
      const b = j(comItem) as Record<string, unknown> & { id: string };
      if (rg.confirmacaoAutomatica) {
        expect(Object.keys(b), nome).toEqual([...CHAVES_DO_POST_COMPRA, "confirmacaoAutomatica"]);
        expect([b.situacao, b.confirmacaoAutomatica], nome).toEqual(["confirmado", { confirmado: true }]);
        expect(await situacaoNoBanco("documentos_compra", b.id), `${nome}: confirmada no banco`).toBe("confirmado");
      } else {
        expect(Object.keys(b), `${nome}: o corpo de hoje`).toEqual(CHAVES_DO_POST_COMPRA);
        expect(await situacaoNoBanco("documentos_compra", b.id), `${nome}: aberta no banco`).toBe("aberto");
      }

      const vazio = await lancarCompra("compra", corpoCompra([], { tipo_operacao_id: t }));
      if (rg.aceitaSemItens) {
        expect(vazio.statusCode, `${nome}: ${vazio.body}`).toBe(201);
        const v = j(vazio) as Record<string, unknown> & { id: string };
        expect(await itensDaCompra(v.id), `${nome}: salva sem itens`).toBe(0);
        expect(Object.keys(v).includes("confirmacaoAutomatica"), `${nome}: a chave segue o bloco também sem itens`).toBe(rg.confirmacaoAutomatica);
      } else {
        expect(vazio.statusCode, `${nome}: ${vazio.body}`).toBe(422);
        expect(erro(vazio), nome).toEqual(RECUSA_COMPRA_SEM_ITENS);
      }
    }
    expect([...combinacoes].sort()).toEqual([AS_DUAS, NEUTRO, { confirmacaoAutomatica: true, aceitaSemItens: false }, { confirmacaoAutomatica: false, aceitaSemItens: true }].map((x) => JSON.stringify(x)).sort());
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-7
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("RG-7 /edicao pela versão CONGELADA; /regras-da-operacao pela ATUAL", () => {
  it("RG-7 venda lançada sem itens na v1 (Manual + Permitido); a TOP ganha a v2 (Automática + Proibido): /edicao diz a v1, /regras-da-operacao a v2, e a PATCH faz o que o /edicao diz", async () => {
    const t = await topDa("vendas.venda", soPermitido());
    const v = await vendaLancada(corpoVenda([], { tipo_operacao_id: t }));
    expect(await itensDaVenda(v.id), "premissa: a venda nasceu sem itens").toBe(0);
    const congelada = (await versaoAtualNoBanco(t)).id;

    await novaVersao(t, soAutomatica());
    const atual = await versaoAtualNoBanco(t);
    expect([atual.versao, atual.id === congelada], "premissa: a versão atual é a 2, outra que a congelada").toEqual([2, false]);
    expect((await c.admin.query<{ v: string }>("select tipo_operacao_versao_id v from erp.sales_documents where id=$1", [v.id])).rows[0]!.v, "premissa: a venda congelou a v1").toBe(congelada);

    const e = await edicao("sales", v.id);
    expect(e.statusCode, e.body).toBe(200);
    const regras = (j(e) as { regras: Record<string, unknown> }).regras;
    expect(Object.keys(regras), "o MESMO contrato da porta do lançamento").toEqual(CHAVES_VENDA);
    expect(regras.regrasGerais, "/edicao: a versão CONGELADA").toEqual({ confirmacaoAutomatica: false, aceitaSemItens: true });
    expect(await blocoVenda("sales", t), "/regras-da-operacao: a versão ATUAL").toEqual({ confirmacaoAutomatica: true, aceitaSemItens: false });

    // A PATCH executa a versão CONGELADA, como o /edicao disse: a venda sem itens continua salvável, e não confirma.
    const p = await patchVenda(v.id, { version: await versaoDaVenda(v.id), note: "RG-7 edição sem itens" });
    expect(p.statusCode, p.body).toBe(200);
    expect(Object.keys(j(p)).includes("confirmacaoAutomatica"), "Manual na congelada: sem a chave").toBe(false);
    expect([await situacaoNoBanco("sales_documents", v.id), await itensDaVenda(v.id)]).toEqual(["open", 0]);
  });

  it("RG-7b documento sem TOP, orçamento e pedido → /edicao com o bloco neutro", async () => {
    const semTop = await vendaLancada(corpoVenda([itemVenda((await produtoComSaldo("5")).id, "1", "10.00")]));
    const e = await edicao("sales", semTop.id);
    expect(e.statusCode, e.body).toBe(200);
    expect((j(e) as { regras: { regrasGerais: unknown } }).regras.regrasGerais, "venda sem TOP").toEqual(NEUTRO);
    let provados = 0;
    for (const [seg, familia] of [["budgets", "vendas.orcamento"], ["orders", "vendas.pedido"]] as const) {
      const t = await topDa(familia, cfg4());
      await versaoDireta(t, automaticaEPermitido());
      expect(await daGravacao(t, familia), `premissa (${seg}): a versão, sozinha, ligaria as duas`).toEqual(AS_DUAS);
      const d = await lancarDaVariante(seg, corpoVenda([itemVenda((await produtoComSaldo("5")).id, "1", "10.00")], { tipo_operacao_id: t }));
      expect(d.statusCode, d.body).toBe(201);
      const r = await edicao(seg, (j(d) as { id: string }).id);
      expect(r.statusCode, r.body).toBe(200);
      expect((j(r) as { regras: { regrasGerais: unknown } }).regras.regrasGerais, seg).toEqual(NEUTRO);
      provados++;
    }
    expect(provados).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// RG-8
// ───────────────────────────────────────────────────────────────────────────────────────────────────
/** As SQL que leem a VERSÃO da TOP (a porta confere a existência; `regrasPorFiltro` lê as regras). Nunca a das condições. */
const leemAVersao = (sqls: string[]) => sqls.filter((s) => /\berp\.tipos_operacao_versoes\b/.test(s));

describe("RG-8 o bloco não custa consulta", () => {
  it("RG-8 vendas: TOP formato 4 Automática + Permitido e TOP formato 2 disparam as MESMAS consultas (texto e ordem); a família vem DENTRO da leitura da versão, que continua sendo lida duas vezes (porta + regras)", async () => {
    const liga = await topDa("vendas.venda", automaticaEPermitido());
    const formato2 = await topDa("vendas.venda", configuracaoNeutraTopV2());
    // Aquecimento: a primeira requisição pode carregar o que as seguintes reaproveitam.
    await ok(regrasVenda("sales", `?tipo_operacao_id=${liga}`));
    const a = await comConsultas(() => ok(regrasVenda("sales", `?tipo_operacao_id=${liga}`)));
    const b = await comConsultas(() => ok(regrasVenda("sales", `?tipo_operacao_id=${formato2}`)));
    expect([a.r.regrasGerais, b.r.regrasGerais], "premissa: uma liga as duas, a outra não").toEqual([AS_DUAS, NEUTRO]);
    expect([a.r.formato, b.r.formato], "premissa: os formatos medidos").toEqual([4, 2]);
    expect(a.sqls.length, "N > 0: o espião mede").toBeGreaterThan(0);
    expect(a.sqls, "as mesmas consultas, na mesma ordem").toEqual(b.sqls);
    // A família entra por subselect na consulta da versão: UMA consulta a cita, e nenhuma é a leitura própria da gravação.
    const daFamilia = a.sqls.filter((s) => s.includes("tb.codigo_base"));
    expect(daFamilia, "o subselect da família, numa SQL só").toHaveLength(1);
    expect(daFamilia[0], "e ela É a leitura das regras da versão (a de `regrasPorFiltro`, com o subselect das condições)").toMatch(/tipos_operacao_versao_condicoes/);
    expect(leemAVersao(a.sqls), "a versão lida duas vezes — a porta e as regras —, nenhuma a mais").toHaveLength(2);
    expect(a.sqls.filter((s) => /select v\.configuracao, t\.codigo_base/.test(s)), "nenhuma leitura própria da gravação").toHaveLength(0);
  });

  it("RG-8 compras: TOP formato 4 Automática + Permitido e TOP formato 4 neutra disparam as MESMAS consultas; a família DENTRO da leitura da versão, lida três vezes (porta + regras + efeitos previstos da compra)", async () => {
    const liga = await topDa("compras.compra", automaticaEPermitido());
    const neutra = await topDa("compras.compra", cfg4());
    await ok(regrasCompra("compras", `?tipo_operacao_id=${liga}`));
    const a = await comConsultas(() => ok(regrasCompra("compras", `?tipo_operacao_id=${liga}`)));
    const b = await comConsultas(() => ok(regrasCompra("compras", `?tipo_operacao_id=${neutra}`)));
    expect([a.r.regrasGerais, b.r.regrasGerais], "premissa: uma liga as duas, a outra não").toEqual([AS_DUAS, NEUTRO]);
    expect(a.sqls.length, "N > 0: o espião mede").toBeGreaterThan(0);
    expect(a.sqls, "as mesmas consultas, na mesma ordem").toEqual(b.sqls);
    const daFamilia = a.sqls.filter((s) => s.includes("tb.codigo_base"));
    expect(daFamilia, "o subselect da família, numa SQL só").toHaveLength(1);
    expect(daFamilia[0], "e ela É a leitura das regras da versão (a de `regrasPorFiltro`, com o subselect das condições)").toMatch(/tipos_operacao_versao_condicoes/);
    expect(leemAVersao(a.sqls), "a versão lida três vezes — a porta, as regras e os efeitos previstos da compra (`efeitosPrevistosDaCompra`) —, nenhuma a mais").toHaveLength(3);
    expect(a.sqls.filter((s) => /select v\.configuracao, t\.codigo_base/.test(s)), "nenhuma leitura própria da gravação").toHaveLength(0);
  });
});
