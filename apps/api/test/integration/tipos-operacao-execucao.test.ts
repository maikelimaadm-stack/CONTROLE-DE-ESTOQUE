import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createPool, seedDemo } from "@agro/db";
import {
  MATRIZ_EXECUCAO_TOP,
  MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  configuracaoNeutraTop,
  configuracaoNeutraTopV2,
  type ConfiguracaoTipoOperacaoV2,
  type ModoExecucaoTop,
} from "@agro/domain";
import { appCom, harness, TEST_URL, type Harness } from "./setup.js";

/**
 * A ATIVAÇÃO DA EXECUÇÃO CONFIGURADA NA ADMINISTRAÇÃO DA TOP (TOP-CONFIG-04A).
 *
 * Duas instâncias da API sobre o MESMO banco, e a diferença entre elas é o gate:
 *   · `h.app`  — o padrão de produção, gate DESLIGADO;
 *   · `ligada` — a mesma API com `TOP_EFFECTS_RUNTIME_V1_ENABLED=1`.
 * É a coexistência real da implantação em duas fases, medida na mesma suíte.
 *
 * O que se prova aqui é a PORTA DE ESCRITA: o que pode ser gravado, o que é recusado ANTES de gravar, e
 * que a recusa não deixa rastro (versão, revisão e trilha intactas). O EFEITO na venda é provado em
 * `sales-top-execucao.test.ts`. Os casos I12 e I13 da missão moram aqui; os demais são complementos.
 */
let h: Harness; let ligada: FastifyInstance;
beforeAll(async () => { h = await harness(); ligada = await appCom(h, { TOP_EFFECTS_RUNTIME_V1_ENABLED: "1" }); }, 180_000);
afterAll(async () => { await ligada?.close(); await h.app.close(); await h.db.end(); });

type Resposta = { statusCode: number; body: string; json: () => unknown };
const j = (r: Resposta) => r.json() as Record<string, unknown> & { error?: { code: string; message: string; details?: Record<string, unknown> } };

let sequencia = 0;
const codigo = () => `25${String(++sequencia).padStart(2, "0")}`;
const VENDA = MATRIZ_EXECUCAO_TOP[0]!.familia;

function v2(execucao: { estoque: ModoExecucaoTop; financeiro: ModoExecucaoTop }, ajuste: (c: ConfiguracaoTipoOperacaoV2) => void = () => {}) {
  const c = configuracaoNeutraTopV2();
  c.execucao = { ...execucao };
  ajuste(c);
  return c;
}
/** A combinação suportada mais completa: saída + contas a receber. */
const configurada = () => v2({ estoque: "configurada", financeiro: "configurada" }, (c) => {
  c.estoque.atualizacao = "saida";
  c.financeiro.atualizacao = "receber";
});

const criar = (app: FastifyInstance, corpo: Record<string, unknown>, headers = h.headers()) =>
  app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: { codigo: codigo(), codigoBase: VENDA, nome: "TOP de execução", ...corpo } });
const detalhe = async (id: string) => j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() }));
const editar = (app: FastifyInstance, id: string, corpo: Record<string, unknown>, headers = h.headers()) =>
  app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers, payload: corpo });

async function trilha(id: string) {
  const adm = createPool(TEST_URL, { max: 1 });
  try {
    return (await adm.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 order by created_at, id", [id])).rows;
  } finally { await adm.end(); }
}
const contarTops = async () => {
  const adm = createPool(TEST_URL, { max: 1 });
  try { return Number((await adm.query<{ n: string }>("select count(*) n from erp.tipos_operacao where organization_id=$1", [h.demo.orgId])).rows[0]!.n); }
  finally { await adm.end(); }
};

async function nova(app: FastifyInstance, corpo: Record<string, unknown> = {}): Promise<string> {
  const r = await criar(app, corpo);
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}

describe("capacidade — o servidor declara a execução, sem mudar o contrato que o cliente anterior lê", () => {
  it("o bloco `execucao` diz o formato, o estado do gate DESTA instância e a matriz; `contractVersion` e `configuracao` não mudam", async () => {
    for (const [app, ligado] of [[h.app, false], [ligada, true]] as const) {
      const r = await app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const d = j(r);
      expect(d.contractVersion).toBe(1);
      expect((d.configuracao as { versaoSchema: number }).versaoSchema, "o cliente anterior compara ESTE número").toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP);
      expect(d.execucao).toEqual({ suportado: true, versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, runtimeHabilitado: ligado, matriz: JSON.parse(JSON.stringify(MATRIZ_EXECUCAO_TOP)) });
    }
  });
});

describe("I13 — gate DESLIGADO: ativar é impossível, e a recusa não deixa rastro", () => {
  it("I13 criar já configurada é 409 com código próprio, e nenhuma TOP nasce", async () => {
    const antes = await contarTops();
    const r = await criar(h.app, { configuracao: configurada() });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL");
    expect(j(r).error!.details).toEqual({ efeitos: ["estoque", "financeiro"] });
    expect(await contarTops(), "a recusa vem ANTES do insert do pai").toBe(antes);
    // A premissa: o MESMO corpo é aceito pela instância com o gate ligado.
    expect((await criar(ligada, { configuracao: configurada() })).statusCode).toBe(201);
  });

  it("I13b editar para configurada é 409, e versão, revisão e trilha ficam intactas", async () => {
    const id = await nova(h.app);
    const antes = await detalhe(id);
    const eventos = (await trilha(id)).length;
    for (const execucao of [{ estoque: "configurada", financeiro: "legado" }, { estoque: "legado", financeiro: "configurada" }] as const) {
      const r = await editar(h.app, id, { configuracao: v2(execucao), revisao: antes.revisao });
      expect(r.statusCode, r.body).toBe(409);
      expect(j(r).error!.code).toBe("TIPO_OPERACAO_EXECUCAO_INDISPONIVEL");
    }
    const depois = await detalhe(id);
    expect([depois.versao, depois.revisao]).toEqual([antes.versao, antes.revisao]);
    expect((await trilha(id)).length).toBe(eventos);
  });

  it("I13c mudar O QUE um efeito configurado executa também é ativação — e é recusado com o gate desligado", async () => {
    const id = await nova(ligada, { configuracao: configurada() });
    const antes = await detalhe(id);
    const outra = configurada();
    outra.estoque.exigeArmazem = true;
    const r = await editar(h.app, id, { configuracao: outra, revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(409);
    expect(j(r).error!.details).toEqual({ efeitos: ["estoque"] });
  });

  it("I13d com o gate desligado, REDUZIR o risco continua possível: voltar ao legado, renomear, mexer no que nada executa", async () => {
    const id = await nova(ligada, { configuracao: configurada() });
    let d = await detalhe(id);
    // renomear (a configuração é preservada inteira — inclusive a execução)
    expect((await editar(h.app, id, { nome: "Renomeada com o gate desligado", revisao: d.revisao })).statusCode).toBe(200);
    d = await detalhe(id);
    expect(((d.configuracao as { valor: ConfiguracaoTipoOperacaoV2 }).valor).execucao).toEqual({ estoque: "configurada", financeiro: "configurada" });
    // mexer numa seção que nenhum efeito configurado executa
    const fiscal = configurada();
    fiscal.fiscal.habilitado = true;
    expect((await editar(h.app, id, { configuracao: fiscal, revisao: d.revisao })).statusCode).toBe(200);
    d = await detalhe(id);
    // voltar o estoque ao legado
    const recuo = configurada();
    recuo.fiscal.habilitado = true;
    recuo.execucao.estoque = "legado";
    const r = await editar(h.app, id, { configuracao: recuo, revisao: d.revisao });
    expect(r.statusCode, r.body).toBe(200);
    expect(((await detalhe(id)).configuracao as { valor: ConfiguracaoTipoOperacaoV2 }).valor.execucao).toEqual({ estoque: "legado", financeiro: "configurada" });
  });
});

describe("I12 — combinação sem executor real é impossível de ativar (com o gate LIGADO)", () => {
  const casos: { nome: string; ajuste: (c: ConfiguracaoTipoOperacaoV2) => void; caminhos: string[] }[] = [
    { nome: "estoque de entrada", ajuste: (c) => { c.execucao.estoque = "configurada"; c.estoque.atualizacao = "entrada"; }, caminhos: ["estoque.atualizacao"] },
    { nome: "estoque de transferência", ajuste: (c) => { c.execucao.estoque = "configurada"; c.estoque.atualizacao = "transferencia"; }, caminhos: ["estoque.atualizacao"] },
    { nome: "saldo negativo permitido", ajuste: (c) => { c.execucao.estoque = "configurada"; c.estoque.atualizacao = "saida"; c.estoque.saldoNegativo = "permitir"; }, caminhos: ["estoque.saldoNegativo"] },
    { nome: "conta a pagar", ajuste: (c) => { c.execucao.financeiro = "configurada"; c.financeiro.atualizacao = "pagar"; }, caminhos: ["financeiro.atualizacao"] },
    { nome: "previsão", ajuste: (c) => { c.execucao.financeiro = "configurada"; c.financeiro.atualizacao = "receber"; c.financeiro.modo = "provisionar"; }, caminhos: ["financeiro.modo"] },
    { nome: "centro de resultado exigido", ajuste: (c) => { c.execucao.financeiro = "configurada"; c.financeiro.atualizacao = "receber"; c.financeiro.exigeCentroResultado = true; }, caminhos: ["financeiro.exigeCentroResultado"] },
  ];
  for (const caso of casos) {
    it(`I12 ${caso.nome}: 422 com o caminho e a mensagem em português, e nada gravado`, async () => {
      const antes = await contarTops();
      const r = await criar(ligada, { configuracao: v2({ estoque: "legado", financeiro: "legado" }, caso.ajuste) });
      expect(r.statusCode, r.body).toBe(422);
      const e = j(r).error!;
      expect(e.code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
      const recusas = (e.details as { recusas: { motivo: string; caminho: string; mensagem: string }[] }).recusas;
      expect(recusas.map((x) => x.caminho)).toEqual(caso.caminhos);
      expect(recusas.every((x) => x.motivo === "combinacao_nao_suportada")).toBe(true);
      expect(e.message.length, "a mensagem é a explicação, não um código").toBeGreaterThan(30);
      expect(await contarTops()).toBe(antes);
    });
  }

  it("I12b a mesma recusa vale na EDIÇÃO, e a versão não muda", async () => {
    const id = await nova(ligada);
    const antes = await detalhe(id);
    const r = await editar(ligada, id, { configuracao: v2({ estoque: "configurada", financeiro: "legado" }, (c) => { c.estoque.atualizacao = "entrada"; }), revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(422);
    expect([ (await detalhe(id)).versao, (await detalhe(id)).revisao ]).toEqual([antes.versao, antes.revisao]);
  });

  it("I12c família sem consumidor: a recusa objetiva, com o gate ligado ou desligado", async () => {
    const familias = (j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/familias", headers: h.headers() })).items as { codigo: string }[])
      .map((f) => f.codigo).filter((f) => f !== VENDA);
    expect(familias.length).toBeGreaterThan(10);
    for (const familia of familias) {
      for (const app of [ligada, h.app]) {
        const r = await criar(app, { codigoBase: familia, configuracao: v2({ estoque: "configurada", financeiro: "legado" }) });
        expect(r.statusCode, `${familia}: ${r.body}`).toBe(422);
        expect(j(r).error!.code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
        expect(j(r).error!.message).toBe(MENSAGEM_FAMILIA_SEM_EXECUCAO_TOP);
      }
    }
  });

  it("I12d a combinação suportada é aceita, gravada no formato 2 e com a execução exatamente como pedida", async () => {
    for (const execucao of [
      { estoque: "configurada", financeiro: "legado" }, { estoque: "legado", financeiro: "configurada" }, { estoque: "configurada", financeiro: "configurada" },
    ] as const) {
      const c = v2(execucao, (x) => { x.estoque.atualizacao = "saida"; x.estoque.exigeArmazem = true; x.financeiro.atualizacao = "receber"; x.financeiro.exigeVencimento = true; x.financeiro.exigeFormaPagamento = true; });
      const id = await nova(ligada, { configuracao: c });
      const d = await detalhe(id);
      expect(d.configuracaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
      expect((d.configuracao as { valor: unknown }).valor).toEqual(c);
    }
  });
});

describe("o formato não retrocede, e salvar sem mudar continua não sendo escrita", () => {
  it("corpo no formato 1 sobre versão vigente no formato 2 é recusado — não desliga execução em silêncio", async () => {
    const id = await nova(ligada, { configuracao: configurada() });
    const antes = await detalhe(id);
    const r = await editar(ligada, id, { configuracao: configuracaoNeutraTop(), revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
    const depois = await detalhe(id);
    expect([depois.versao, depois.revisao]).toEqual([antes.versao, antes.revisao]);
  });

  it("uma TOP no formato 1 salva com o MESMO conteúdo em formato 2 legado/legado é no-op: sem versão, sem revisão, sem evento", async () => {
    const v1 = configuracaoNeutraTop();
    v1.estoque.atualizacao = "saida";
    v1.financeiro.atualizacao = "receber";
    const id = await nova(h.app, { configuracao: v1 });
    const antes = await detalhe(id);
    expect(antes.configuracaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP);
    const eventos = (await trilha(id)).length;
    const mesmaEmV2 = { ...v1, versaoSchema: 2, execucao: { estoque: "legado", financeiro: "legado" } };
    const r = await editar(h.app, id, { nome: antes.nome, configuracao: mesmaEmV2, revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await detalhe(id);
    expect([depois.versao, depois.revisao, depois.configuracaoSchema]).toEqual([antes.versao, antes.revisao, VERSAO_SCHEMA_CONFIGURACAO_TOP]);
    expect((await trilha(id)).length).toBe(eventos);
    // A premissa do no-op: uma mudança REAL cria a versão seguinte, e só então no formato 2.
    const r2 = await editar(h.app, id, { nome: "Agora sim", configuracao: mesmaEmV2, revisao: antes.revisao });
    expect(r2.statusCode, r2.body).toBe(200);
    const d2 = await detalhe(id);
    expect([d2.versao, d2.configuracaoSchema]).toEqual([(antes.versao as number) + 1, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2]);
  });

  it("o cutover é identificável na trilha existente: `execucao` nas seções alteradas, com o antes e o depois", async () => {
    const id = await nova(ligada);
    const antes = await detalhe(id);
    expect((await editar(ligada, id, { configuracao: configurada(), revisao: antes.revisao })).statusCode).toBe(200);
    const update = (await trilha(id)).filter((x) => x.action === "update").at(-1)!;
    expect(update.metadata!.secoesAlteradas).toEqual(["estoque", "financeiro", "execucao"]);
    expect(update.metadata!.execucao).toEqual({ antes: { estoque: "legado", financeiro: "legado" }, depois: { estoque: "configurada", financeiro: "configurada" } });
    const versoes = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() })).items as { versao: number; secoesAlteradas: string[] | null }[];
    expect(versoes[0]!.secoesAlteradas).toEqual(["estoque", "financeiro", "execucao"]);
  });
});

describe("permissão e isolamento continuam os mesmos", () => {
  it("sem capacidade administrativa é 403; de outro tenant é a mesma 404 de inexistente", async () => {
    const id = await nova(ligada, { configuracao: configurada() });
    expect((await criar(ligada, { configuracao: configurada() }, h.opHeaders())).statusCode).toBe(403);

    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org TOP EXEC", adminEmail: "admin-topexec@demo.local", adminPassword: "Demo@12345", slug: "orgtopexec" }, () => {});
    await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-topexec@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const B = { authorization: `Bearer ${tok}`, "x-org-id": o2.orgId };
    const r = await editar(ligada, id, { configuracao: configuracaoNeutraTopV2(), revisao: 1 }, B);
    expect(r.statusCode).toBe(404);
  });
});
