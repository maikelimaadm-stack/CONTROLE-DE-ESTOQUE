import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CODIGOS_TIPO_OPERACAO, MATRIZ_REGRAS_GERAIS_TOP, SECOES_CONFIGURACAO_TOP, configuracaoNeutraTopV5, lerCatalogoTop,
  type ConfiguracaoTipoOperacaoV5
} from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg4, criarTop, top, detalheTop, editarTop, versaoAtualNoBanco, versoesNoBanco,
  auditoriaDe, type Resposta
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F9a (decisão 286) — A TOP GRAVA, PRESERVA E MOSTRA OS PADRÕES FINANCEIROS (plano F9a §1.3.2; TF-1..TF-5).
 *
 *   · TF-1 capacidades: `padroesFinanceiros: 1` na raiz, depois do `formato5`; `formato5.secoes` com `financeiroPadrao`;
 *          os blocos de hoje passam pelos MESMOS `toEqual`;
 *   · TF-2 o POST de um pedido de venda no 5 com a provisão e os cinco padrões grava UMA linha na tabela da versão (ids
 *          em minúsculas), e o detalhe, o histórico e a trilha os devolvem com o cadastro de cada um;
 *   · TF-3 o PUT sem a chave PRESERVA e COPIA os padrões para a N+1; com um padrão diferente, a N+1 com a trilha
 *          `padroesFinanceiros` antes/depois e `secoesAlteradas` com `financeiroPadrao`; os mesmos padrões e a mesma
 *          configuração = no-op; os padrões vazios = a N+1 sem linha; o preservado não passa pelo banco de novo;
 *   · TF-4 as recusas (422 `TIPO_OPERACAO_CONFIGURACAO_INVALIDA`, recusa exata, nada gravado): padrões num 4, família sem
 *          perfil, campo fora do perfil, cadastros inválidos (a MESMA mensagem por campo), a provisão fora do pedido de
 *          venda, "exigir" numa conta a pagar, os padrões PRESERVADOS que não cabem na configuração enviada;
 *   · TF-5 `/familias` com `financeiro.movimento_bancario` e o catálogo com tela nos três tipos do Financeiro.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): a linha da tabela da versão, as versões, a revisão e a trilha são
 * LIDAS NO BANCO pela testemunha (`c.admin`, superusuário sem RLS); "nada gravado" = o pai, as versões, as linhas dos
 * padrões e a trilha idênticos antes e depois, nunca só o 422. As mensagens esperadas estão escritas AQUI, à mão: uma
 * mensagem errada no domínio ou na rota não se aprova sozinha. As TOPs nascem pela API no formato 5, a partir do neutro
 * do domínio (`configuracaoNeutraTopV5`) com a seção do caso.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── a configuração e os textos exatos ───────────────

/** O neutro do FORMATO 5 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
const comProvisao = (x: ConfiguracaoTipoOperacaoV5): void => { x.financeiroPadrao.provisao = true; };

const MSG = {
  exigemFormato5: "Os padrões financeiros exigem a configuração no formato 5.",
  foraDaFamilia: "Esta operação não usa padrões financeiros.",
  formaForaDoPerfil: "Esta operação não usa a forma de pagamento padrão.",
  tipoTituloForaDoPerfil: "Esta operação não usa o tipo de título padrão.",
  natureza: "Natureza padrão inválida para esta operação: escolha uma natureza analítica, ativa e do tipo da operação.",
  centro: "Centro de resultado padrão inválido: escolha um centro analítico e ativo.",
  tipoTitulo: "Tipo de título padrão inválido.",
  forma: "Forma de pagamento padrão inválida: escolha uma forma ativa.",
  conta: "Conta padrão inválida: escolha uma conta ativa da organização.",
  provisaoForaDaFamilia: "A provisão vale só no pedido de venda.",
  exigirForaDaFamilia: "O lançamento desta operação sempre informa natureza e centro: deixe \"Usar a 1ª natureza e o 1º centro por código (como hoje)\".",
  secaoForaDoTipo: "Esta operação não usa a seção Padrões financeiros.",
  envelope: "A configuração operacional enviada é inválida",
  envelopePreservados: "Os padrões financeiros da versão vigente não valem para esta configuração; envie os padrões vazios."
} as const;

const recusa = (caminho: string, mensagem: string, motivo = "combinacao_nao_suportada") => ({ caminho, motivo, mensagem });
/** A recusa da configuração: o 422, o código, o envelope e EXATAMENTE estas recusas, nesta ordem. */
function recusada(r: Resposta, recusas: unknown[], envelope: string = MSG.envelope) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: envelope, details: { recusas } });
}

// ─────────────── os cadastros dos padrões ───────────────

interface Cadastros {
  natureza: string; naturezaDespesa: string; centro: string; tipoTitulo: string; forma: string; conta: string; conta2: string;
}
let K: Cadastros;
let seqCodigo = 0;
/** Uma natureza NOVA da organização (código único na raiz), no estado pedido. */
async function natureza(o: { nature?: string; kind?: string; ativa?: boolean; excluida?: boolean; organizacao?: string } = {}): Promise<string> {
  const s = unico();
  return (await c.admin.query<{ id: string }>(
    `insert into erp.financial_categories(organization_id,code,name,nature,kind,is_active,deleted_at)
     values ($1,$2,$3,$4,$5,$6,case when $7 then now() end) returning id`,
    [o.organizacao ?? c.h.demo.orgId, `79.${++seqCodigo}`, `Natureza F9a ${s}`, o.nature ?? "income", o.kind ?? "analytic", o.ativa ?? true, o.excluida ?? false])).rows[0]!.id;
}
let outraOrg: string | null = null;
/** Uma organização ALHEIA (criada uma vez), para os cadastros de outro tenant. */
async function organizacaoAlheia(): Promise<string> {
  if (outraOrg) return outraOrg;
  outraOrg = (await c.admin.query<{ id: string }>("insert into erp.organizations(name,slug) values ('F9a alheia', $1) returning id", [`f9a-alheia-${unico()}`])).rows[0]!.id;
  return outraOrg;
}
async function um<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await c.admin.query(sql, params);
  expect(r.rows, `premissa: a consulta devolve uma linha — ${sql}`).toHaveLength(1);
  return r.rows[0] as T;
}

beforeAll(async () => {
  // Do seed: a natureza de RECEITA analítica, a de DESPESA analítica, o centro analítico, as contas BB e CXF. Do SISTEMA
  // (organização nula): um tipo de título e uma forma de pagamento — a FK de coluna única da 0045 e a conferência da API
  // aceitam a organização da sessão OU nula.
  const tipoTitulo = await um<{ id: string }>("select id from erp.title_types where organization_id is null order by name limit 1");
  const forma = await um<{ id: string }>("select id from erp.payment_methods where organization_id is null and is_active order by name limit 1");
  K = {
    natureza: c.I.incomeCategory, naturezaDespesa: c.I.category, centro: c.I.costCenter,
    tipoTitulo: tipoTitulo.id, forma: forma.id, conta: c.I.bankAccount, conta2: c.I.cashAccount
  };
}, 60_000);

/** Os cinco padrões no corpo. */
const todosOsPadroes = () => ({ naturezaId: K.natureza, centroCustoId: K.centro, tipoTituloId: K.tipoTitulo, formaPagamentoId: K.forma, contaBancariaId: K.conta });

// ─────────────── testemunhas ───────────────

interface LinhaDosPadroes {
  origem_versao_id: string; natureza_id: string | null; centro_custo_id: string | null; tipo_titulo_id: string | null;
  forma_pagamento_id: string | null; conta_bancaria_id: string | null;
}
/** As linhas da tabela dos padrões de TODAS as versões da TOP, pela ordem da versão. */
async function linhasDosPadroes(topId: string): Promise<(LinhaDosPadroes & { versao: number })[]> {
  return (await c.admin.query<LinhaDosPadroes & { versao: number }>(
    `select v.versao, x.origem_versao_id::text, x.natureza_id::text, x.centro_custo_id::text, x.tipo_titulo_id::text,
            x.forma_pagamento_id::text, x.conta_bancaria_id::text
       from erp.tipos_operacao_versao_financeiro x
       join erp.tipos_operacao_versoes v on v.id = x.origem_versao_id
      where x.origem_tipo_operacao_id = $1 order by v.versao`, [topId])).rows;
}
const paiNoBanco = async (topId: string) =>
  um<{ versao_atual: number; revisao: number }>("select versao_atual, revisao from erp.tipos_operacao where id=$1", [topId]);
/** A foto da TOP para "nada gravado": o pai, as versões, as linhas dos padrões e o tamanho da trilha. */
async function foto(topId: string) {
  return { pai: await paiNoBanco(topId), versoes: await versoesNoBanco(topId), padroes: await linhasDosPadroes(topId), trilha: (await auditoriaDe("tipos_operacao", topId)).length };
}
const contarTops = async () => Number((await um<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [c.h.demo.orgId])).n);

type PadroesNaTela = Record<"natureza" | "centro" | "tipoTitulo" | "formaPagamento" | "conta", Record<string, string> | null> | null;
async function padroesDoDetalhe(topId: string): Promise<PadroesNaTela> {
  const d = await detalheTop(topId);
  expect(d.statusCode, d.body).toBe(200);
  expect(Object.keys(j(d)), "o detalhe sempre traz a chave").toContain("padroesFinanceiros");
  return j(d).padroesFinanceiros as PadroesNaTela;
}
type ItemHistorico = { versao: number; secoesAlteradas: string[] | null; padroesFinanceiros: PadroesNaTela };
async function historico(topId: string): Promise<ItemHistorico[]> {
  const r = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}/versoes`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).items as ItemHistorico[];
}
/** O que o detalhe e o histórico devem mostrar: o cadastro de cada padrão, lido no banco pela testemunha. */
async function cadastrosNaTela(p: { natureza?: string; centro?: string; tipoTitulo?: string; forma?: string; conta?: string }): Promise<PadroesNaTela> {
  const n = p.natureza ? await um<{ id: string; codigo: string; nome: string }>("select id::text, code as codigo, name as nome from erp.financial_categories where id=$1", [p.natureza]) : null;
  const cc = p.centro ? await um<{ id: string; codigo: string; nome: string }>("select id::text, code as codigo, name as nome from erp.cost_centers where id=$1", [p.centro]) : null;
  const t = p.tipoTitulo ? await um<{ id: string; nome: string }>("select id::text, name as nome from erp.title_types where id=$1", [p.tipoTitulo]) : null;
  const f = p.forma ? await um<{ id: string; nome: string }>("select id::text, name as nome from erp.payment_methods where id=$1", [p.forma]) : null;
  const b = p.conta ? await um<{ id: string; codigo: string; descricao: string }>("select id::text, code as codigo, description as descricao from erp.bank_accounts where id=$1", [p.conta]) : null;
  return { natureza: n, centro: cc, tipoTitulo: t, formaPagamento: f, conta: b };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// TF-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("TF-1 — capacidades: o marcador padroesFinanceiros e a seção no formato 5", () => {
  it("TF-1 padroesFinanceiros = 1 na raiz, depois do formato5; formato5.secoes = [financeiroPadrao]; os blocos de hoje iguais", async () => {
    const r = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: c.h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const d = j(r);
    expect(d.padroesFinanceiros).toBe(1);
    const chaves = Object.keys(d);
    expect(chaves.indexOf("formato5"), "premissa: o formato5 está na raiz").toBeGreaterThan(-1);
    expect(chaves.indexOf("padroesFinanceiros"), "na RAIZ, depois do formato5").toBeGreaterThan(chaves.indexOf("formato5"));
    expect((d.formato5 as { secoes: string[] }).secoes, "a seção da F9, à mão").toEqual(["financeiroPadrao"]);
    expect(d.formato5).toMatchObject({ suportado: true, versaoSchema: 5, leituraDoDetalhe: "formato_gravado" });
    // OS toEqual DE HOJE, sem mudança: o editor anterior compara estes números.
    expect(d.contractVersion).toBe(1);
    expect(d.configuracao).toEqual({ versaoSchema: 1, secoes: [...SECOES_CONFIGURACAO_TOP] });
    expect(d.restricoes).toEqual({ suportado: true, versaoSchema: 3 });
    expect(d.regrasGerais).toEqual({ suportado: true, versaoSchema: 4, matriz: JSON.parse(JSON.stringify(MATRIZ_REGRAS_GERAIS_TOP)) });
    expect(d.reservaEstoque).toBe(1);
    expect(d.destinos).toMatchObject({ suportado: true, emPartes: 1 });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// TF-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("TF-2 — o POST no 5 grava os padrões na tabela da versão", () => {
  it("TF-2 pedido de venda com a provisão e os cinco padrões (ids em MAIÚSCULAS) → 201; UMA linha em minúsculas; detalhe, histórico e trilha com os padrões; premissa: sem a chave, nenhuma linha", async () => {
    const corpo = cfg5(comProvisao);
    const maiusculas = Object.fromEntries(Object.entries(todosOsPadroes()).map(([k, v]) => [k, v.toUpperCase()]));
    expect(maiusculas.naturezaId, "premissa: o corpo vai em maiúsculas").not.toBe(K.natureza);
    const id = await top("vendas.pedido", { configuracao: corpo, padroesFinanceiros: maiusculas });

    const v = await versaoAtualNoBanco(id);
    expect([v.versao, v.configuracao_schema_version]).toEqual([1, 5]);
    expect((v.configuracao as { financeiroPadrao: unknown }).financeiroPadrao, "a seção do JSON: só regras").toEqual({ provisao: true, documentoTroca: true, semClassificacao: "padrao_legado" });
    expect(await linhasDosPadroes(id), "UMA linha, da versão 1, com os ids em minúsculas").toEqual([{
      versao: 1, origem_versao_id: v.id, natureza_id: K.natureza, centro_custo_id: K.centro, tipo_titulo_id: K.tipoTitulo,
      forma_pagamento_id: K.forma, conta_bancaria_id: K.conta
    }]);

    const esperado = await cadastrosNaTela({ natureza: K.natureza, centro: K.centro, tipoTitulo: K.tipoTitulo, forma: K.forma, conta: K.conta });
    expect(await padroesDoDetalhe(id), "o detalhe devolve o cadastro de cada padrão").toEqual(esperado);
    const h = await historico(id);
    expect(h).toHaveLength(1);
    expect(h[0]!.padroesFinanceiros, "o histórico da versão 1, os mesmos").toEqual(esperado);
    expect(h[0]!.secoesAlteradas, "a versão 1 não tem com quem comparar").toBeNull();

    const create = await auditoriaDe("tipos_operacao", id, "create");
    expect(create).toHaveLength(1);
    expect(create[0]!.metadata?.padroesFinanceiros, "a trilha leva os ids (minúsculas)").toEqual(todosOsPadroes());

    // PREMISSA: o MESMO corpo sem a chave → nenhuma linha, detalhe e histórico com `null`, trilha sem os padrões.
    const sem = await top("vendas.pedido", { configuracao: cfg5(comProvisao) });
    expect(await linhasDosPadroes(sem)).toEqual([]);
    expect(await padroesDoDetalhe(sem)).toBeNull();
    expect((await historico(sem))[0]!.padroesFinanceiros).toBeNull();
    expect((await auditoriaDe("tipos_operacao", sem, "create"))[0]!.metadata).not.toHaveProperty("padroesFinanceiros");
    // E os padrões TODOS nulos também não gravam linha (a versão sem padrão).
    const nulos = await top("vendas.pedido", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: null, centroCustoId: null, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: null } });
    expect(await linhasDosPadroes(nulos)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// TF-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("TF-3 — o PUT preserva, copia, troca e não cria versão à toa", () => {
  it("TF-3 sem a chave (renomeando) → a N+1 com os MESMOS padrões copiados; um padrão diferente → a N+1, trilha antes/depois e financeiroPadrao nas seções; os mesmos → no-op; vazios → a N+1 sem linha", async () => {
    const id = await top("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: K.natureza, centroCustoId: K.centro, contaBancariaId: K.conta } });
    const [l1] = await linhasDosPadroes(id);
    expect(l1, "premissa: a versão 1 tem a linha").toBeDefined();

    // RENOMEAR, sem a chave: a v2 COPIA os padrões (uma linha nova, da v2, com os mesmos ids); a da v1 fica.
    const rn = await editarTop(id, { nome: `Venda renomeada ${unico()}` });
    expect(rn.statusCode, rn.body).toBe(200);
    expect(j(rn).versao).toBe(2);
    const v2 = await versaoAtualNoBanco(id);
    expect(await linhasDosPadroes(id)).toEqual([
      l1,
      { ...l1!, versao: 2, origem_versao_id: v2.id }
    ]);

    // A CONFIGURAÇÃO no corpo, sem a chave: os preservados cabem nela (venda no 5) → a v3 também os copia.
    const cfgV3 = cfg5((x) => { x.geral.exigeObservacao = true; });
    const r3 = await editarTop(id, { configuracao: cfgV3 });
    expect(r3.statusCode, r3.body).toBe(200);
    expect(j(r3).versao).toBe(3);
    expect((await linhasDosPadroes(id)).map((l) => [l.versao, l.conta_bancaria_id])).toEqual([[1, K.conta], [2, K.conta], [3, K.conta]]);

    // UM PADRÃO DIFERENTE (a conta): a v4, com a trilha antes/depois e `financeiroPadrao` nas seções.
    const depois = { naturezaId: K.natureza, centroCustoId: K.centro, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: K.conta2 };
    const r4 = await editarTop(id, { padroesFinanceiros: depois });
    expect(r4.statusCode, r4.body).toBe(200);
    expect(j(r4).versao).toBe(4);
    const linhas4 = await linhasDosPadroes(id);
    expect(linhas4.map((l) => [l.versao, l.conta_bancaria_id])).toEqual([[1, K.conta], [2, K.conta], [3, K.conta], [4, K.conta2]]);
    const update = (await auditoriaDe("tipos_operacao", id, "update")).at(-1)!;
    expect(update.metadata?.secoesAlteradas, "só os padrões mudaram").toEqual(["financeiroPadrao"]);
    expect(update.metadata?.padroesFinanceiros).toEqual({
      antes: { naturezaId: K.natureza, centroCustoId: K.centro, tipoTituloId: null, formaPagamentoId: null, contaBancariaId: K.conta },
      depois
    });
    const h = await historico(id);
    expect(h.map((x) => [x.versao, x.secoesAlteradas])).toEqual([
      [4, ["financeiroPadrao"]], [3, ["geral"]], [2, []], [1, null]
    ]);
    expect(h[0]!.padroesFinanceiros).toEqual(await cadastrosNaTela({ natureza: K.natureza, centro: K.centro, conta: K.conta2 }));
    expect(h[1]!.padroesFinanceiros, "cada versão mostra os DELA").toEqual(await cadastrosNaTela({ natureza: K.natureza, centro: K.centro, conta: K.conta }));

    // OS MESMOS padrões (ids em maiúsculas) e a MESMA configuração → no-op: nada novo, revisão igual.
    const f = await foto(id);
    const noop = await editarTop(id, { configuracao: cfgV3, padroesFinanceiros: { ...depois, naturezaId: K.natureza.toUpperCase(), contaBancariaId: K.conta2.toUpperCase() } });
    expect(noop.statusCode, noop.body).toBe(200);
    expect(j(noop)).toEqual({ id, versao: 4, revisao: f.pai.revisao });
    expect(await foto(id), "o no-op não grava nada").toEqual(f);

    // OS PADRÕES VAZIOS → a v5, SEM linha; o detalhe devolve `null`, e o histórico marca a mudança.
    const r5 = await editarTop(id, { padroesFinanceiros: {} });
    expect(r5.statusCode, r5.body).toBe(200);
    expect(j(r5).versao).toBe(5);
    expect((await linhasDosPadroes(id)).map((l) => l.versao), "a v5 não tem linha").toEqual([1, 2, 3, 4]);
    expect(await padroesDoDetalhe(id)).toBeNull();
    expect((await historico(id))[0]!.secoesAlteradas).toEqual(["financeiroPadrao"]);
  });

  it("TF-3 o padrão PRESERVADO não passa pelo banco de novo: a natureza inativada depois não trava a gravação sem a chave; enviada de novo, é recusada", async () => {
    const nat = await natureza();
    const id = await top("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: nat } });
    expect((await linhasDosPadroes(id)).map((l) => l.natureza_id), "premissa: a v1 tem a natureza").toEqual([nat]);
    await c.admin.query("update erp.financial_categories set is_active = false where id = $1", [nat]);

    const r = await editarTop(id, { configuracao: cfg5((x) => { x.geral.exigeObservacao = true; }) });
    expect(r.statusCode, r.body).toBe(200);
    expect((await linhasDosPadroes(id)).map((l) => [l.versao, l.natureza_id]), "a v2 copia a natureza (registro)").toEqual([[1, nat], [2, nat]]);
    // PREMISSA: a MESMA natureza ENVIADA é conferida no banco (inativa) e recusada.
    const f = await foto(id);
    recusada(await editarTop(id, { padroesFinanceiros: { naturezaId: nat } }), [recusa("padroesFinanceiros.naturezaId", MSG.natureza, "valor_invalido")]);
    expect(await foto(id)).toEqual(f);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// TF-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("TF-4 — as recusas, exatas, e nada gravado", () => {
  it("TF-4 (a) padrões num formato 4 (e sem configuração, o neutro do 2) → 422 no conjunto; nenhuma TOP nasce; premissa: o MESMO corpo no 5 → 201", async () => {
    const antes = await contarTops();
    recusada(await criarTop("vendas.pedido", { configuracao: cfg4(), padroesFinanceiros: { naturezaId: K.natureza } }), [recusa("padroesFinanceiros", MSG.exigemFormato5)]);
    recusada(await criarTop("vendas.pedido", { padroesFinanceiros: { naturezaId: K.natureza } }), [recusa("padroesFinanceiros", MSG.exigemFormato5)]);
    expect(await contarTops(), "nada nasce").toBe(antes);
    // PUT numa TOP vigente no 4, sem configuração: a configuração resultante é a do 4 → a mesma recusa.
    const id4 = await top("vendas.pedido", { configuracao: cfg4() });
    const f = await foto(id4);
    recusada(await editarTop(id4, { padroesFinanceiros: { contaBancariaId: K.conta } }), [recusa("padroesFinanceiros", MSG.exigemFormato5)]);
    expect(await foto(id4)).toEqual(f);
    // Os padrões VAZIOS num 4 não são padrão nenhum: aceitos (e, sendo os mesmos, nem criam versão).
    expect((await editarTop(id4, { padroesFinanceiros: { contaBancariaId: null } })).statusCode).toBe(200);
    expect(await foto(id4), "vazio sobre vazio = no-op").toEqual(f);
    // PREMISSA: no 5, os mesmos padrões são aceitos (no POST e no PUT que leva a TOP ao 5).
    expect((await criarTop("vendas.pedido", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: K.natureza } })).statusCode).toBe(201);
    const r = await editarTop(id4, { configuracao: cfg5(), padroesFinanceiros: { contaBancariaId: K.conta } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await linhasDosPadroes(id4)).map((l) => [l.versao, l.conta_bancaria_id])).toEqual([[2, K.conta]]);
  });

  it("TF-4 (b) família sem perfil (orçamento) e (c) campo fora do perfil (forma e tipo de título num movimento bancário) → as recusas exatas; premissa: a conta no movimento passa", async () => {
    const antes = await contarTops();
    recusada(await criarTop("vendas.orcamento", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: K.natureza } }), [recusa("padroesFinanceiros", MSG.foraDaFamilia)]);
    recusada(await criarTop("financeiro.movimento_bancario", { configuracao: cfg5(), padroesFinanceiros: { tipoTituloId: K.tipoTitulo, formaPagamentoId: K.forma, contaBancariaId: K.conta } }), [
      recusa("padroesFinanceiros.tipoTituloId", MSG.tipoTituloForaDoPerfil),
      recusa("padroesFinanceiros.formaPagamentoId", MSG.formaForaDoPerfil)
    ]);
    expect(await contarTops(), "nada nasce").toBe(antes);
    // ANTES do banco: um id INEXISTENTE fora do perfil recebe a recusa do perfil, não a do cadastro.
    recusada(await criarTop("financeiro.movimento_bancario", { configuracao: cfg5(), padroesFinanceiros: { formaPagamentoId: "00000000-0000-4000-8000-000000000000" } }),
      [recusa("padroesFinanceiros.formaPagamentoId", MSG.formaForaDoPerfil)]);
    // PREMISSA: o movimento usa natureza (de qualquer tipo), centro e conta.
    const mov = await top("financeiro.movimento_bancario", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: K.naturezaDespesa, centroCustoId: K.centro, contaBancariaId: K.conta } });
    expect((await linhasDosPadroes(mov)).map((l) => [l.natureza_id, l.conta_bancaria_id])).toEqual([[K.naturezaDespesa, K.conta]]);
  });

  it("TF-4 (e) natureza de despesa numa venda, inativa, sintética, excluída, de outra organização e inexistente → a MESMA mensagem; centro, tipo, forma e conta alheios → a do campo; nada gravado", async () => {
    const alheia = await organizacaoAlheia();
    const recusadas = [
      K.naturezaDespesa,
      await natureza({ ativa: false }),
      await natureza({ kind: "synthetic" }),
      await natureza({ excluida: true }),
      await natureza({ organizacao: alheia }),
      "00000000-0000-4000-8000-000000000000"
    ];
    const antes = await contarTops();
    for (const naturezaId of recusadas) {
      recusada(await criarTop("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { naturezaId } }), [recusa("padroesFinanceiros.naturezaId", MSG.natureza, "valor_invalido")]);
    }
    const centroAlheio = (await c.admin.query<{ id: string }>("insert into erp.cost_centers(organization_id,code,name,kind) values ($1,'1','Alheio F9a','analytic') returning id", [alheia])).rows[0]!.id;
    const tipoAlheio = (await c.admin.query<{ id: string }>("insert into erp.title_types(organization_id,name) values ($1,'Tipo alheio F9a') returning id", [alheia])).rows[0]!.id;
    const formaAlheia = (await c.admin.query<{ id: string }>("insert into erp.payment_methods(organization_id,name) values ($1,'Forma alheia F9a') returning id", [alheia])).rows[0]!.id;
    const contaAlheia = (await c.admin.query<{ id: string }>("insert into erp.bank_accounts(organization_id,code,description,type) values ($1,'F9A','Conta alheia F9a','checking') returning id", [alheia])).rows[0]!.id;
    recusada(await criarTop("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { centroCustoId: centroAlheio, tipoTituloId: tipoAlheio, formaPagamentoId: formaAlheia, contaBancariaId: contaAlheia } }), [
      recusa("padroesFinanceiros.centroCustoId", MSG.centro, "valor_invalido"),
      recusa("padroesFinanceiros.tipoTituloId", MSG.tipoTitulo, "valor_invalido"),
      recusa("padroesFinanceiros.formaPagamentoId", MSG.forma, "valor_invalido"),
      recusa("padroesFinanceiros.contaBancariaId", MSG.conta, "valor_invalido")
    ]);
    expect(await contarTops(), "nada nasce").toBe(antes);
    // A forma do corpo é da borda: id que não é uuid e chave desconhecida → 422 de validação, nunca 500 nem descarte.
    const malformado = await criarTop("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { naturezaId: "nao-e-uuid" } });
    expect(malformado.statusCode, malformado.body).toBe(422);
    expect(erro(malformado).code).toBe("VALIDATION_ERROR");
    const desconhecida = await criarTop("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: { natureza: K.natureza } });
    expect(desconhecida.statusCode, desconhecida.body).toBe(422);
    expect(erro(desconhecida).code).toBe("VALIDATION_ERROR");
    expect(await contarTops(), "nada nasce").toBe(antes);
    // PREMISSA: a natureza de RECEITA ativa e analítica, os cadastros do seed e os do SISTEMA → 201.
    expect((await criarTop("vendas.venda", { configuracao: cfg5(), padroesFinanceiros: todosOsPadroes() })).statusCode).toBe(201);
  });

  it("TF-4 (d) a provisão numa venda e \"exigir\" numa conta a pagar → a recusa da seção; a seção ligada num orçamento → a do perfil do tipo; premissa: a provisão no pedido e \"exigir\" na venda passam", async () => {
    const antes = await contarTops();
    recusada(await criarTop("vendas.venda", { configuracao: cfg5(comProvisao) }), [recusa("financeiroPadrao.provisao", MSG.provisaoForaDaFamilia)]);
    recusada(await criarTop("financeiro.conta_a_pagar", { configuracao: cfg5((x) => { x.financeiroPadrao.semClassificacao = "exigir"; }) }),
      [recusa("financeiroPadrao.semClassificacao", MSG.exigirForaDaFamilia)]);
    recusada(await criarTop("vendas.orcamento", { configuracao: cfg5(comProvisao) }), [recusa("financeiroPadrao", MSG.secaoForaDoTipo)]);
    expect(await contarTops(), "nada nasce").toBe(antes);
    // PUT de uma venda no 5: a mesma recusa, nada gravado.
    const venda = await top("vendas.venda", { configuracao: cfg5() });
    const f = await foto(venda);
    recusada(await editarTop(venda, { configuracao: cfg5(comProvisao) }), [recusa("financeiroPadrao.provisao", MSG.provisaoForaDaFamilia)]);
    expect(await foto(venda)).toEqual(f);
    // PREMISSA: a provisão no pedido de venda e "exigir" na venda (e na conta a pagar o "documento troca" desligado) passam.
    expect((await criarTop("vendas.pedido", { configuracao: cfg5(comProvisao) })).statusCode).toBe(201);
    const r = await editarTop(venda, { configuracao: cfg5((x) => { x.financeiroPadrao.semClassificacao = "exigir"; }) });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).versao).toBe(2);
    expect((await criarTop("financeiro.conta_a_pagar", { configuracao: cfg5((x) => { x.financeiroPadrao.documentoTroca = false; }) })).statusCode).toBe(201);
  });

  it("TF-4 os padrões PRESERVADOS que não cabem na configuração enviada → 422 com o envelope \"envie os padrões vazios\"; renomear não passa por aqui; com os padrões vazios, a N+1 sem linha", async () => {
    // Um orçamento no 5 com uma linha de padrões que a porta da API nunca aceitaria (fixture do superusuário): o único
    // jeito de ter padrões vigentes fora do perfil — o caso de um perfil que muda entre versões do produto.
    const id = await top("vendas.orcamento", { configuracao: cfg5() });
    const v1 = await versaoAtualNoBanco(id);
    await c.admin.query(
      `insert into erp.tipos_operacao_versao_financeiro (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id)
       values ($1, $2, $3, $4)`, [c.h.demo.orgId, v1.id, id, K.natureza]);
    expect((await linhasDosPadroes(id)).map((l) => l.versao), "premissa: a v1 tem a linha").toEqual([1]);

    // Renomear (sem configuração) não passa pela conferência: a v2 copia a linha, como as condições.
    const rn = await editarTop(id, { nome: `Orçamento renomeado ${unico()}` });
    expect(rn.statusCode, rn.body).toBe(200);
    expect((await linhasDosPadroes(id)).map((l) => l.versao)).toEqual([1, 2]);

    // A configuração no corpo, SEM a chave: os preservados seriam copiados para a v3 — e não cabem num orçamento.
    const f = await foto(id);
    recusada(await editarTop(id, { configuracao: cfg5((x) => { x.geral.exigeObservacao = true; }) }), [recusa("padroesFinanceiros", MSG.foraDaFamilia)], MSG.envelopePreservados);
    // Mesmo sem mudança na configuração: a conferência vem antes do no-op.
    recusada(await editarTop(id, { configuracao: cfg5() }), [recusa("padroesFinanceiros", MSG.foraDaFamilia)], MSG.envelopePreservados);
    expect(await foto(id), "nada gravado").toEqual(f);

    // Com os padrões VAZIOS no mesmo corpo: a v3, sem linha.
    const r = await editarTop(id, { configuracao: cfg5((x) => { x.geral.exigeObservacao = true; }), padroesFinanceiros: {} });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).versao).toBe(3);
    expect((await linhasDosPadroes(id)).map((l) => l.versao), "a v3 não carrega os padrões").toEqual([1, 2]);
    const update = (await auditoriaDe("tipos_operacao", id, "update")).at(-1)!;
    expect(update.metadata?.secoesAlteradas, "a geral e os padrões").toEqual(["geral", "financeiroPadrao"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// TF-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("TF-5 — a família do movimento bancário e os tipos do Financeiro com tela", () => {
  it("TF-5 /familias tem financeiro.movimento_bancario (24 famílias); o catálogo publicado tem tela nas três do Financeiro, com as famílias do registry", async () => {
    const f = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/familias", headers: c.h.headers() });
    expect(f.statusCode, f.body).toBe(200);
    const codigos = (j(f).items as { codigo: string }[]).map((x) => x.codigo);
    expect(codigos).toContain("financeiro.movimento_bancario");
    expect(codigos, "o registry inteiro").toEqual([...CODIGOS_TIPO_OPERACAO]);
    expect(codigos).toHaveLength(24);

    const r = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: c.h.headers() });
    const catalogo = lerCatalogoTop((j(r).formato5 as { catalogo: unknown }).catalogo);
    expect(catalogo, "o leitor estrito aceita o catálogo publicado").not.toBeNull();
    const financeiros = catalogo!.tipos.filter((t) => t.grupo === "financeiro").map((t) => [t.chave, t.familia, t.temTela]);
    expect(financeiros).toEqual([
      ["conta_pagar", "financeiro.conta_a_pagar", true],
      ["conta_receber", "financeiro.conta_a_receber", true],
      ["movimento_bancario", "financeiro.movimento_bancario", true]
    ]);
    // E uma TOP da família nova nasce pela porta administrativa, no 5.
    const mov = await criarTop("financeiro.movimento_bancario", { configuracao: cfg5() });
    expect(mov.statusCode, mov.body).toBe(201);
  });
});
