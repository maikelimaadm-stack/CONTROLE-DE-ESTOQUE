import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedDemo } from "@agro/db";
import {
  RECURSO_DA_ESPECIE_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  type ConfiguracaoTipoOperacaoV3, type ConfiguracaoTipoOperacaoV4, type EspecieEstoque,
} from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, top, usuario, escopos, produto, DATA,
  estoqueLancado, confirmarEstoque, lerEstoque, aprovar, reprovar, situacaoNoBanco, auditoriaDe, decisoesDe,
  type Hdr, type Resposta, type ItemEstoque,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F12 (decisão 282) — A SITUAÇÃO DA APROVAÇÃO DE UM DOCUMENTO DE ESTOQUE (casos SE-1..SE-6).
 *
 *   GET /api/aprovacoes/estoque/<segmento>/:id   (`<recurso da espécie>.view`, as sete espécies)
 *   → 200 { situacao: nao_aberto | nao_exigida | pendente | aprovado | reprovado, ultimaDecisao: {…} | null }
 *
 * O contrato é o da venda e da compra (279, `aprovacoes-situacao.ts`); a decisão continua nas rotas da fila de
 * Aprovações › Estoque (`POST …/<segmento>/:id/aprovar|reprovar`, `<recurso>.approve`), que a consulta da Central de
 * Estoque reusa — e é por elas que os casos decidem.
 *
 *   · SE-1 entrada com a TOP no formato 4 e "Sempre": pendente (quem só VÊ lê) → reprovado com o motivo → aprovado
 *          com a observação, quem e quando; confirmada → nao_aberto, e a última decisão continua lá;
 *   · SE-2 nao_exigida: formato 4 sem aprovação; formato 3 com "Sempre" só DECLARADO (o corte da 277);
 *   · SE-3 AS SETE ESPÉCIES: cada segmento tem a rota, com a capacidade DA espécie — sem `<recurso>.view` (com as
 *          outras seis) é 403 antes de qualquer leitura; com ela, a 404 do GET por id daquele segmento;
 *   · SE-4 a MESMA 404 — corpo idêntico ao do GET por id — para fora do escopo, inexistente, outra organização,
 *          outra ESPÉCIE (o documento de entrada pelo segmento da saída) e id malformado;
 *   · SE-5 422 em qualquer parâmetro de consulta (e no repetido), antes da 404;
 *   · SE-6 só leitura (decisões, trilha e situação iguais) e número FIXO de consultas (1 e 5 itens; no documento que
 *          não está aberto a TOP não é lida).
 *
 * O QUE CONTA COMO PROVA (o molde do ajudante): a situação é conferida contra o que o BANCO guarda (as decisões em
 * `erp.aprovacoes_estoque` e a situação do documento, por conexão de superusuário) e contra o que a confirmação faz com
 * o mesmo documento (o /confirmar recusa com APROVACAO_PENDENTE / APROVACAO_REPROVADA, ou passa). Toda 404 tem a
 * PREMISSA ao lado: o mesmo documento é legível por quem o enxerga.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── a rota ───────────────

interface UltimaDecisao { decisao: "aprovado" | "reprovado"; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string }
interface Situacao { situacao: "nao_aberto" | "nao_exigida" | "pendente" | "aprovado" | "reprovado"; ultimaDecisao: UltimaDecisao | null }

const seg = (e: EspecieEstoque) => SEGMENTO_DA_ESPECIE_ESTOQUE[e];
/** O GET da situação, cru. `query` é o texto depois do `?`. */
const lerSituacao = (especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers(), query = ""): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/aprovacoes/estoque/${seg(especie)}/${id}${query ? `?${query}` : ""}`, headers });

/** O GET da situação que DEVE responder 200; confere as chaves EXATAS do contrato. */
async function situacao(especie: EspecieEstoque, id: string, headers: Hdr = c.h.headers()): Promise<Situacao> {
  const r = await lerSituacao(especie, id, headers);
  expect(r.statusCode, `${especie}/${id}: ${r.body}`).toBe(200);
  const b = j(r);
  expect(Object.keys(b), "o contrato da resposta: só as duas chaves").toEqual(["situacao", "ultimaDecisao"]);
  return b as unknown as Situacao;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sempre = (x: ConfiguracaoTipoOperacaoV3 | ConfiguracaoTipoOperacaoV4) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };
const topEntradaSempre = () => top("estoque.entrada", { configuracao: cfg4(sempre) });

/** Uma entrada NOVA da 1ª empresa (ALM), com a TOP dada e `itens` produtos NOVOS (a entrada não precisa de saldo). */
async function entrada(topId: string, itens = 1, extra: Record<string, unknown> = {}): Promise<string> {
  const linhas: ItemEstoque[] = [];
  for (let i = 0; i < itens; i++) linhas.push({ produto_id: (await produto()).id, quantidade: "3", custo_unitario: "2" });
  return (await estoqueLancado("entrada", linhas, { tipo_operacao_id: topId, ...extra })).id;
}

/** Um membro com nome ÚNICO, e o id dele (lido no banco pelo nome) — para conferir o `decididoPor`. */
async function pessoa(rotulo: string, perms: string[], escopo = escopos()): Promise<{ headers: Hdr; id: string; nome: string }> {
  const nome = `${rotulo} ${unico()}`;
  const headers = await usuario(nome, perms, escopo);
  const r = await c.admin.query<{ id: string }>("select id from erp.users where name = $1", [nome]);
  expect(r.rows, "premissa: o membro existe, com nome único").toHaveLength(1);
  return { headers, id: r.rows[0]!.id, nome };
}
function decididoEm(r: Resposta): string {
  expect(r.statusCode, r.body).toBe(200);
  return (j(r).aprovacao as { decididoEm: string }).decididoEm;
}

/** As SQL que a aplicação mandou ao banco durante `fn` (o espião de `pg.Client.prototype.query`, molde do AP-9b). */
async function comConsultas(fn: () => Promise<Resposta>): Promise<{ r: Resposta; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await fn();
    const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}
/** As tabelas que a situação lê — nenhuma delas pode aparecer numa recusa por capacidade. */
const LEITURAS_DO_DOCUMENTO = /erp\.(documentos_estoque|documentos_estoque_itens|tipos_operacao_versoes|aprovacoes_estoque)\b/;

// ─────────────── SE-1 ───────────────

describe("SE-1 — entrada com Sempre: pendente → reprovado → aprovado → confirmada, com a última decisão", () => {
  it("SE-1 quem só VÊ lê a situação; a decisão é pelas rotas da fila; confirmada → nao_aberto com a última decisão", async () => {
    const id = await entrada(await topEntradaSempre());
    const soVe = await usuario("Só vê entradas", ["entradas_estoque.view"]);

    expect(await situacao("entrada", id, soVe)).toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(erro(await confirmarEstoque("entrada", id)).code, "premissa: a confirmação diz o mesmo — pendente").toBe("APROVACAO_PENDENTE");
    expect(await decisoesDe("aprovacoes_estoque", id)).toEqual([]);

    // Quem só vê NÃO decide: a decisão continua em `.approve` (403), e nada é gravado.
    expect(erro(await aprovar("entrada", id, {}, soVe)).code, "quem só vê não aprova").toBe("PERMISSION_DENIED");
    expect(await decisoesDe("aprovacoes_estoque", id), "a recusa não gravou decisão").toEqual([]);

    const aprovadora = await pessoa("Aprovadora de entradas", ["entradas_estoque.view", "entradas_estoque.approve"]);
    const emR = decididoEm(await reprovar("entrada", id, { motivo: "Nota sem conferência" }, aprovadora.headers));
    expect(await situacao("entrada", id, soVe)).toEqual({ situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: "Nota sem conferência", decididoPor: { id: aprovadora.id, nome: aprovadora.nome }, decididoEm: emR } });
    expect(erro(await confirmarEstoque("entrada", id)).code, "premissa: a confirmação diz o mesmo — reprovado").toBe("APROVACAO_REPROVADA");

    const emA = decididoEm(await aprovar("entrada", id, { observacao: "Conferida" }, aprovadora.headers));
    const sA = await situacao("entrada", id, soVe);
    expect(sA).toEqual({ situacao: "aprovado",
      ultimaDecisao: { decisao: "aprovado", observacao: "Conferida", decididoPor: { id: aprovadora.id, nome: aprovadora.nome }, decididoEm: emA } });
    expect(sA.ultimaDecisao!.decididoEm, "decididoEm em ISO").toMatch(ISO);
    // A testemunha: o banco tem as duas decisões, nesta ordem, de quem decidiu.
    expect((await decisoesDe("aprovacoes_estoque", id)).map((d) => [d.decisao, d.observacao, d.decidido_por]))
      .toEqual([["reprovado", "Nota sem conferência", aprovadora.id], ["aprovado", "Conferida", aprovadora.id]]);

    const conf = await confirmarEstoque("entrada", id);
    expect(conf.statusCode, `premissa: aprovado, o documento confirma — ${conf.body}`).toBe(200);
    expect(await situacaoNoBanco("documentos_estoque", id)).toBe("confirmado");
    expect(await situacao("entrada", id, soVe), "fechado: nao_aberto, e a última decisão continua dita")
      .toEqual({ situacao: "nao_aberto", ultimaDecisao: sA.ultimaDecisao });
  });
});

// ─────────────── SE-2 ───────────────

describe("SE-2 — nao_exigida", () => {
  it("SE-2 formato 4 sem aprovação e formato 3 com 'Sempre' só declarado → nao_exigida; premissa: o 4 com 'Sempre' → pendente", async () => {
    const sem = await entrada(await top("estoque.entrada", { configuracao: cfg4() }));
    expect(await situacao("entrada", sem)).toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
    const corte = await entrada(await top("estoque.entrada", { configuracao: cfg3(sempre) }));
    expect(await situacao("entrada", corte), "o formato 3 só declara: nada executa").toEqual({ situacao: "nao_exigida", ultimaDecisao: null });
    expect((await confirmarEstoque("entrada", corte)).statusCode, "premissa: a confirmação concorda — o 3 confirma sem aprovação").toBe(200);
    expect(await situacao("entrada", await entrada(await topEntradaSempre())), "premissa: o mesmo 'Sempre' no 4 exige")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
  });
});

// ─────────────── SE-3 ───────────────

describe("SE-3 — as sete espécies, cada uma com a SUA capacidade", () => {
  it("SE-3 sem `<recurso>.view` da espécie (com as outras seis) → 403 sem ler nada; com ela → a 404 do GET por id do segmento", async () => {
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, "premissa: as sete espécies").toHaveLength(7);
    const naoExiste = randomUUID();
    for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) {
      const outras = TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.filter((x) => x !== especie).map((x) => `${RECURSO_DA_ESPECIE_ESTOQUE[x]}.view`);
      const semEsta = await usuario(`Sem ${especie}`, outras);
      const { r, sqls } = await comConsultas(() => lerSituacao(especie, naoExiste, semEsta));
      expect([especie, r.statusCode], r.body).toEqual([especie, 403]);
      expect(erro(r).code).toBe("PERMISSION_DENIED");
      expect(sqls.filter((s) => LEITURAS_DO_DOCUMENTO.test(s)), `${especie}: nenhuma leitura do documento antes da capacidade`).toEqual([]);

      const comEsta = await usuario(`Com ${especie}`, [`${RECURSO_DA_ESPECIE_ESTOQUE[especie]}.view`]);
      const referencia = await c.ligada.inject({ method: "GET", url: `/api/estoque/${seg(especie)}/${naoExiste}`, headers: comEsta });
      expect([especie, referencia.statusCode], "premissa: o GET por id do segmento responde 404").toEqual([especie, 404]);
      const lida = await lerSituacao(especie, naoExiste, comEsta);
      expect([especie, lida.statusCode, lida.body], "a rota existe (não é o 404 de rota) e responde a MESMA 404")
        .toEqual([especie, 404, referencia.body]);
    }
  });
});

// ─────────────── SE-4 ───────────────

/** Uma entrada de OUTRA organização (seed próprio), e os cabeçalhos da dona dela. */
async function entradaDeOutraOrganizacao(): Promise<{ id: string; headers: Hdr }> {
  const s = unico();
  const b = await seedDemo(c.admin, { orgName: `[TEST] Outra F12 ${s}`, adminEmail: `outra-f12-${s}@demo.local`, adminPassword: "Demo@12345", slug: `outra-f12-${s}` }, () => {});
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: b.adminEmail, password: b.adminPassword } });
  expect(login.statusCode, login.body).toBe(200);
  const headers = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": b.orgId };
  const um = async (sql: string, params: unknown[]) => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;
  const empresa = b.empresaIds[0]!;
  const prod = await um("select id from erp.products where organization_id=$1 and description like 'Ração%' limit 1", [b.orgId]);
  const armazem = await um("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and initials='ALM'", [b.orgId, empresa]);
  const topB = await top("estoque.entrada", { configuracao: cfg4(sempre) }, headers);
  const r = await c.ligada.inject({ method: "POST", url: "/api/estoque/entradas", headers,
    payload: { empresa_id: empresa, tipo_operacao_id: topB, armazem_id: armazem, data_documento: DATA, itens: [{ produto_id: prod, quantidade: "1", custo_unitario: "2" }] } });
  expect(r.statusCode, `premissa: a entrada da outra organização é lançada — ${r.body}`).toBe(201);
  return { id: (j(r) as { id: string }).id, headers };
}

describe("SE-4 — a superfície de recusa: a MESMA 404 do GET por id", () => {
  it("SE-4 fora do escopo, inexistente, outra organização, outra espécie e id malformado → a MESMA 404 (corpo idêntico ao do GET por id)", async () => {
    const topId = await topEntradaSempre();
    const id = await entrada(topId);
    const doEscopo2 = await usuario("Vê entradas da empresa 2", ["entradas_estoque.view"], escopos({ estoque: [c.I.empresa2] }));
    const todasAsVistas = await usuario("Vê entradas e saídas", ["entradas_estoque.view", "saidas_estoque.view"]);
    const outra = await entradaDeOutraOrganizacao();
    const naoExiste = randomUUID();

    const referencia = await lerEstoque("entrada", naoExiste);
    expect(referencia.statusCode, referencia.body).toBe(404);

    const casos: { nome: string; especie: EspecieEstoque; id: string; headers?: Hdr }[] = [
      { nome: "fora do escopo de empresa", especie: "entrada", id, headers: doEscopo2 },
      { nome: "inexistente", especie: "entrada", id: naoExiste },
      { nome: "inexistente, em maiúsculas", especie: "entrada", id: naoExiste.toUpperCase() },
      { nome: "outra organização", especie: "entrada", id: outra.id },
      { nome: "outra espécie (a entrada pelo segmento da saída)", especie: "saida", id, headers: todasAsVistas },
    ];
    for (const caso of casos) {
      const r = await lerSituacao(caso.especie, caso.id, caso.headers);
      const g = await lerEstoque(caso.especie, caso.id, caso.headers);
      expect([caso.nome, g.statusCode], "o GET por id do mesmo caso é 404").toEqual([caso.nome, 404]);
      expect([caso.nome, r.statusCode, r.body]).toEqual([caso.nome, 404, g.body]);
      expect([caso.nome, r.body], "e o corpo é o da 404 de referência").toEqual([caso.nome, referencia.body]);
    }
    for (const malformado of ["nao-e-uuid", `${naoExiste.slice(0, -1)}x`, "0"]) {
      const r = await lerSituacao("entrada", malformado);
      expect([malformado, r.statusCode, r.body]).toEqual([malformado, 404, referencia.body]);
    }

    // PREMISSAS: cada documento invisível ERA legível por quem o enxerga — a 404 é só visibilidade.
    expect(await situacao("entrada", id, todasAsVistas), "premissa: pelo segmento DELE, a entrada é lida").toEqual({ situacao: "pendente", ultimaDecisao: null });
    expect(await situacao("entrada", outra.id, outra.headers), "premissa: a dona da outra organização lê a entrada dela")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
    const daEmpresa2 = await entrada(topId, 1, { empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 });
    expect(await situacao("entrada", daEmpresa2, doEscopo2), "premissa: a pessoa da empresa 2 lê a entrada da empresa 2")
      .toEqual({ situacao: "pendente", ultimaDecisao: null });
  });
});

// ─────────────── SE-5 ───────────────

describe("SE-5 — parâmetro de consulta: 422 no parâmetro, nunca ignorado", () => {
  it("SE-5 ?foo=1 e ?empresa_id=… → 'não reconhecido'; ?x=1&x=2 → 'repetido'; o 422 vem antes da 404; sem parâmetro, 200", async () => {
    const id = await entrada(await topEntradaSempre());
    expect(await situacao("entrada", id), "premissa: sem parâmetro, 200").toEqual({ situacao: "pendente", ultimaDecisao: null });
    for (const [query, chave, msg] of [
      ["foo=1", "foo", "Parâmetro não reconhecido na situação da aprovação"],
      [`empresa_id=${c.I.empresa}`, "empresa_id", "Parâmetro não reconhecido na situação da aprovação"],
      ["x=1&x=2", "x", "Parâmetro repetido: informe um valor só"],
    ] as const) {
      for (const alvo of [id, randomUUID()]) {
        const r = await lerSituacao("entrada", alvo, c.h.headers(), query);
        expect([query, r.statusCode], r.body).toEqual([query, 422]);
        expect(erro(r)).toMatchObject({ code: "VALIDATION_ERROR", details: [{ path: chave, message: msg }] });
      }
    }
  });
});

// ─────────────── SE-6 ───────────────

describe("SE-6 — só leitura, com número FIXO de consultas", () => {
  it("SE-6a ler a situação não grava nada; premissa: decidir muda os mesmos contadores", async () => {
    const id = await entrada(await topEntradaSempre());
    const antes = { decisoes: await decisoesDe("aprovacoes_estoque", id), trilha: await auditoriaDe("documentos_estoque", id), situacao: await situacaoNoBanco("documentos_estoque", id) };
    for (let i = 0; i < 3; i++) await situacao("entrada", id);
    expect({ decisoes: await decisoesDe("aprovacoes_estoque", id), trilha: await auditoriaDe("documentos_estoque", id), situacao: await situacaoNoBanco("documentos_estoque", id) })
      .toEqual(antes);
    decididoEm(await aprovar("entrada", id));
    expect((await decisoesDe("aprovacoes_estoque", id)).length, "premissa: a decisão grava").toBe(antes.decisoes.length + 1);
    expect((await auditoriaDe("documentos_estoque", id)).length, "premissa: a decisão deixa trilha").toBeGreaterThan(antes.trilha.length);
  });

  it("SE-6b 1 e 5 itens → as MESMAS consultas (cabeçalho, versão da TOP, vigente, última); não aberto → a TOP não é lida", async () => {
    const topId = await topEntradaSempre();
    const um = await entrada(topId, 1);
    const cinco = await entrada(topId, 5);
    const doUm = await comConsultas(() => lerSituacao("entrada", um));
    const doCinco = await comConsultas(() => lerSituacao("entrada", cinco));
    expect([doUm.r.statusCode, doCinco.r.statusCode]).toEqual([200, 200]);
    const doBanco = (sqls: string[]) => sqls.filter((s) => LEITURAS_DO_DOCUMENTO.test(s));
    expect(doBanco(doUm.sqls).length, "premissa: o espião vê as leituras").toBeGreaterThanOrEqual(3);
    expect(doBanco(doCinco.sqls), "o número e o texto das consultas não dependem dos itens").toEqual(doBanco(doUm.sqls));
    expect(doBanco(doUm.sqls).filter((s) => /documentos_estoque_itens/.test(s)), "os itens nunca são lidos").toEqual([]);
    expect(doBanco(doUm.sqls).filter((s) => /tipos_operacao_versoes/.test(s)).length, "premissa: aberto, a versão da TOP é lida").toBeGreaterThan(0);

    decididoEm(await aprovar("entrada", um));
    expect((await confirmarEstoque("entrada", um)).statusCode, "premissa: confirmado").toBe(200);
    const fechado = await comConsultas(() => lerSituacao("entrada", um));
    expect(j(fechado.r).situacao).toBe("nao_aberto");
    expect(doBanco(fechado.sqls).filter((s) => /tipos_operacao_versoes/.test(s)), "fechado: a TOP não é lida").toEqual([]);
  });
});
