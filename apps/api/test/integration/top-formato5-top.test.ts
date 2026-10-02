import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CATALOGO_TOP, CODIGOS_TIPO_OPERACAO, MATRIZ_EXECUCAO_TOP, MATRIZ_REGRAS_GERAIS_TOP, SECOES_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  configuracaoNeutraTop, configuracaoNeutraTopV2, configuracaoNeutraTopV5, configuracaoTopParaEdicaoV5, lerCatalogoTop, lerConfiguracaoTop,
  normalizarRegrasGeraisDaFamiliaTop,
  type ConfiguracaoTipoOperacao, type ConfiguracaoTipoOperacaoV5,
} from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, criarTop, top, detalheTop, editarTop, novaVersao, versaoAtualNoBanco, versoesNoBanco,
  usuario, auditoriaDe, type Resposta,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F4 (decisão 281) — A API DA TOP NO FORMATO 5 (plano F4 §1.3 e §4; casos T5-1..T5-8).
 *
 *   · T5-1 capacidades: o bloco `formato5` na RAIZ, depois de `regrasGerais`, com o catálogo do domínio; os blocos de
 *          hoje (`configuracao` 1, `restricoes` 3, `regrasGerais` 4…) passam pelos MESMOS `toEqual` de hoje; 403 sem view;
 *   · T5-2 o POST no 5 grava 5 (coluna, payload, detalhe e trilha) — nunca 4;
 *   · T5-3 no 5, o que o TIPO não aceita (o perfil do catálogo) é UM 422 com as recusas exatas e nada gravado; o MESMO
 *          corpo no 4 é aceito (o comportamento de hoje) e a venda no 5 aceita os mesmos valores;
 *   · T5-4 condições permitidas num tipo sem Financeiro, no 5 → 422 ANTES da consulta das condições; no 4 e na venda, aceitas;
 *          a lista PRESERVADA também (configuração no 5 sem a lista, sobre uma vigente no 4 com condições) → 422; com a
 *          lista vazia, a N+1 no 5 sem condição;
 *   · T5-5 chave de raiz desconhecida (um nome que nenhuma fase declara) → `campo_desconhecido` no 5 e no 4;
 *   · T5-6 4 → 5 sem mudança não grava nada; com mudança, a N+1 nasce no 5 e o histórico devolve a v1 COMO GRAVADA (4);
 *   · T5-7 o formato não retrocede (4 sobre 5 = 422) e renomear preserva o 5 inteiro;
 *   · T5-8 1 a 3 lidos como 5: a TOP de pedido de compra de produção (3) no 5 recebe a matriz; normalizada, grava o 5;
 *          a vista do 5 de uma TOP no 1 ou no 2 neutra, salva sem mexer, é no-op.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): versão corrente, formato, revisão e trilha LIDOS NO BANCO pela
 * testemunha (`c.admin`, superusuário sem RLS); "nada gravado" = o pai, as versões e a trilha idênticos antes e depois,
 * nunca só o 422. As mensagens e os motivos esperados estão escritos AQUI, à mão, e não lidos do domínio: um catálogo
 * ou uma matriz errados no domínio não se aprovam sozinhos.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o formato 5 e os textos exatos (plano F4 §1.5) ───────────────

/** O neutro do FORMATO 5 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}
type ComRegras = { geral: { confirmacao: string }; aprovacao: { politica: string; valorMinimo: string | null } };
const automatica = <X extends ComRegras>(x: X): void => { x.geral.confirmacao = "automatica"; };
const sempre = <X extends ComRegras>(x: X): void => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };

const MSG = {
  exigenciaForaDoTipo: "O documento desta operação não tem este campo.",
  financeiroForaDoTipo: "Esta operação não usa a seção Financeiro.",
  fiscalForaDoTipo: "Esta operação não usa a seção Fiscal.",
  condicoesForaDoTipo: "Esta operação não usa condições de pagamento.",
  /** Os motivos da matriz das regras gerais para o pedido de compra (SPEC da TOP-CONFIG-08 §2). */
  naoConfirmado: "Este documento não é confirmado: ele é convertido ou recebido em outro.",
  semItensOrcamentoPedido: "Orçamento e pedido sem itens não têm o que converter nem receber.",
} as const;
const recusaDoPerfil = (caminho: string, mensagem: string) => ({ motivo: "combinacao_nao_suportada", caminho, mensagem });

/** As 9 famílias cujo documento cita a TOP — as únicas com tela no passo 1 (plano F4 §1.2.4), escritas à mão. */
const FAMILIAS_COM_TELA = [
  "vendas.orcamento", "vendas.pedido", "vendas.venda", "compras.pedido", "compras.compra",
  "estoque.entrada", "estoque.saida", "estoque.transferencia", "estoque.ajuste",
];

// ─────────────── testemunhas ───────────────

async function paiNoBanco(topId: string): Promise<{ versao_atual: number; revisao: number }> {
  const r = await c.admin.query<{ versao_atual: number; revisao: number }>("select versao_atual, revisao from erp.tipos_operacao where id=$1", [topId]);
  expect(r.rows, "premissa: a TOP existe").toHaveLength(1);
  return r.rows[0]!;
}
/** A foto da TOP para "nada gravado": pai, versões e o tamanho da trilha. */
async function foto(topId: string) {
  return { pai: await paiNoBanco(topId), versoes: await versoesNoBanco(topId), trilha: (await auditoriaDe("tipos_operacao", topId)).length };
}
const contarTops = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
/** Quantas TOPs a LISTAGEM da API encontra por este código (a busca do servidor). */
async function totalNaBusca(codigo: string): Promise<number> {
  const r = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao?search=${encodeURIComponent(codigo)}`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).total as number;
}
type ConfiguracaoNaTela = { suportada: boolean; versaoSchema: number; valor?: unknown };
type ItemHistorico = { versao: number; secoesAlteradas: string[] | null; configuracao: ConfiguracaoNaTela };
async function historico(topId: string): Promise<ItemHistorico[]> {
  const r = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}/versoes`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).items as ItemHistorico[];
}
/** A configuração que o DETALHE devolve, lida pelo leitor do domínio (o que o editor faz antes da vista do 5). */
async function configuracaoDoDetalhe(topId: string): Promise<{ versaoSchema: number; valor: ConfiguracaoTipoOperacao }> {
  const d = await detalheTop(topId);
  expect(d.statusCode, d.body).toBe(200);
  const cfg = j(d).configuracao as ConfiguracaoNaTela;
  expect(cfg.suportada, "premissa: a versão vigente é legível").toBe(true);
  const lida = lerConfiguracaoTop(cfg.valor);
  if (!lida.ok) throw new Error(`a configuração do detalhe não é legível: ${JSON.stringify(lida.recusas)}`);
  return { versaoSchema: cfg.versaoSchema, valor: lida.valor };
}
/** Um código de TOP novo (a busca o encontra sozinho). */
const codigoNovo = () => `F5${unico()}`.slice(0, 20);
/** Uma condição de pagamento NOVA e ativa da organização. */
async function condicao(): Promise<string> {
  const s = unico();
  return (await c.admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,1,30,'intervalo',30,null,false,null,true) returning id",
    [c.h.demo.orgId, `F5-${s}`, `Condição F5 ${s}`])).rows[0]!.id;
}

/** A recusa da configuração: o 422, o código, a mensagem do envelope e EXATAMENTE estas recusas, nesta ordem. */
function recusadaConfiguracao(r: Resposta, recusas: unknown[]) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: "A configuração operacional enviada é inválida", details: { recusas } });
}
/** A mensagem do envelope quando a lista recusada é a PRESERVADA da vigente (o corpo trouxe a configuração sem ela). */
const MENSAGEM_CONDICOES_PRESERVADAS = "As condições de pagamento permitidas da versão vigente são inválidas para esta operação; envie a lista vazia";
/** A recusa das condições do perfil: o 422, o código de hoje e a recusa exata (a mensagem do envelope: a da lista enviada). */
function recusadasCondicoes(r: Resposta, mensagem = "As condições de pagamento permitidas enviadas são inválidas") {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONDICOES_INVALIDAS", message: mensagem,
    details: { recusas: [{ caminho: "condicoesPermitidas", mensagem: MSG.condicoesForaDoTipo }] } });
}
/** As condições permitidas da versão CORRENTE da TOP, como o BANCO as guarda (a tabela da versão, 0033). */
async function condicoesNoBanco(topId: string): Promise<string[]> {
  const v = await versaoAtualNoBanco(topId);
  const r = await c.admin.query<{ id: string }>(
    "select condicao_pagamento_id::text as id from erp.tipos_operacao_versao_condicoes where origem_versao_id=$1 order by 1", [v.id]);
  return r.rows.map((x) => x.id);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-1 — capacidades: o bloco formato5 na raiz, com o catálogo do domínio", () => {
  it("T5-1 formato5 = {suportado, versaoSchema 5, secoes [], leituraDoDetalhe, catalogo} depois de regrasGerais; os blocos de hoje iguais, nas duas instâncias", async () => {
    for (const [app, ligado] of [[c.h.app, false], [c.ligada, true]] as const) {
      const r = await app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const d = j(r);
      // O bloco novo: o catálogo é o MESMO do domínio (fonte única), serializado.
      expect(d.formato5).toEqual({ suportado: true, versaoSchema: 5, secoes: [], leituraDoDetalhe: "formato_gravado", catalogo: JSON.parse(JSON.stringify(CATALOGO_TOP)) });
      const chaves = Object.keys(d);
      expect(chaves.indexOf("formato5"), "na RAIZ, depois de regrasGerais").toBeGreaterThan(chaves.indexOf("regrasGerais"));
      expect(chaves.indexOf("regrasGerais"), "premissa: regrasGerais está na raiz").toBeGreaterThan(-1);
      // OS toEqual DE HOJE, sem mudança: o editor anterior compara estes números.
      expect(d.contractVersion).toBe(1);
      expect(d.configuracao).toEqual({ versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP, secoes: [...SECOES_CONFIGURACAO_TOP] });
      expect(d.configuracao, "o número do contrato anterior continua 1, as cinco seções").toEqual({ versaoSchema: 1, secoes: ["geral", "estoque", "financeiro", "fiscal", "aprovacao"] });
      expect(d.execucao).toEqual({ suportado: true, versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, runtimeHabilitado: ligado, matriz: JSON.parse(JSON.stringify(MATRIZ_EXECUCAO_TOP)) });
      expect(d.restricoes).toEqual({ suportado: true, versaoSchema: 3 });
      expect(d.regrasGerais).toEqual({ suportado: true, versaoSchema: 4, matriz: JSON.parse(JSON.stringify(MATRIZ_REGRAS_GERAIS_TOP)) });
      expect(d.reservaEstoque).toBe(1);
      expect(d.destinos).toMatchObject({ suportado: true, emPartes: 1 });

      // O catálogo PUBLICADO é legível pelo leitor estrito do domínio (o que o editor usa) e diz o que a SPEC diz:
      // os 5 grupos, os 9 tipos com tela (à mão) e um perfil por família do registry.
      const catalogo = lerCatalogoTop((d.formato5 as { catalogo: unknown }).catalogo);
      expect(catalogo, "o leitor estrito aceita o catálogo publicado").not.toBeNull();
      expect(catalogo!.grupos.map((g) => g.chave)).toEqual(["vendas", "compras", "movimentacao_interna", "modulos", "financeiro"]);
      expect(catalogo!.tipos.filter((t) => t.temTela).map((t) => t.familia)).toEqual(FAMILIAS_COM_TELA);
      expect(catalogo!.tipos, "premissa: há tipos declarados SEM tela (a fase que cria a tela os liga)").toHaveLength(22);
      expect(catalogo!.perfis.map((p) => p.familia)).toEqual([...CODIGOS_TIPO_OPERACAO]);
    }
    // /familias continua o registry INTEIRO (o catálogo não o recorta): as 23 famílias, com ou sem tela.
    const f = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/familias", headers: c.h.headers() });
    expect(f.statusCode, f.body).toBe(200);
    expect((j(f).items as { codigo: string }[]).map((x) => x.codigo)).toEqual([...CODIGOS_TIPO_OPERACAO]);
    expect(CODIGOS_TIPO_OPERACAO.length, "premissa: o registry tem mais famílias que tipos com tela").toBeGreaterThan(FAMILIAS_COM_TELA.length);
  });

  it("T5-1 sem tipos_operacao.view → 403 e nada do bloco; premissa: com a capacidade, o mesmo membro lê o formato5", async () => {
    const semView = await usuario("Sem TOP F5", ["sales.view"]);
    const r = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: semView });
    expect(r.statusCode, r.body).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
    expect(r.body).not.toContain("formato5");
    const comView = await usuario("Com TOP F5", ["tipos_operacao.view"]);
    const ok = await c.ligada.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: comView });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok).formato5).toMatchObject({ suportado: true, versaoSchema: 5 });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-2 — o POST no formato 5 grava 5", () => {
  it("T5-2 venda com Automática + Sempre → 201; coluna e payload 5 no banco; o detalhe devolve o 5 como enviado; a trilha diz configuracaoSchema 5", async () => {
    const corpo = cfg5((x) => { automatica(x); sempre(x); });
    expect(corpo.versaoSchema, "premissa: o corpo é do formato 5").toBe(5);
    const id = await top("vendas.venda", { configuracao: corpo });
    const v = await versaoAtualNoBanco(id);
    expect([v.versao, v.configuracao_schema_version]).toEqual([1, 5]);
    expect(v.configuracao, "o banco guarda o 5 enviado, não um 4 com as mesmas chaves").toEqual(corpo);
    const d = j(await detalheTop(id));
    expect(d.configuracaoSchema).toBe(5);
    expect(d.configuracao).toEqual({ suportada: true, versaoSchema: 5, valor: corpo });
    const create = await auditoriaDe("tipos_operacao", id, "create");
    expect(create).toHaveLength(1);
    expect(create[0]!.metadata).toMatchObject({ codigoBase: "vendas.venda", versao: 1, configuracaoSchema: 5 });
    // PREMISSA: o número gravado é o do CORPO — o mesmo conteúdo no 4 grava 4.
    const id4 = await top("vendas.venda", { configuracao: cfg4((x) => { automatica(x); sempre(x); }) });
    expect((await versaoAtualNoBanco(id4)).configuracao_schema_version).toBe(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-3 — no formato 5, o que o tipo não aceita é recusado (o perfil do catálogo)", () => {
  /** Uma entrada de estoque com Financeiro "A pagar", "Exigir parceiro" e o Fiscal ligado: nada disso vale no tipo. */
  const foraDoTipo = <X extends { geral: { exigeParceiro: boolean }; financeiro: { atualizacao: string }; fiscal: { habilitado: boolean } }>(x: X): void => {
    x.geral.exigeParceiro = true; x.financeiro.atualizacao = "pagar"; x.fiscal.habilitado = true;
  };
  const RECUSAS_DA_ENTRADA = [
    recusaDoPerfil("geral.exigeParceiro", MSG.exigenciaForaDoTipo),
    recusaDoPerfil("financeiro", MSG.financeiroForaDoTipo),
    recusaDoPerfil("fiscal", MSG.fiscalForaDoTipo),
  ];

  it("T5-3 POST de entrada no 5 → UM 422 com as 3 recusas, na ordem fixa, e nenhuma TOP nasce; premissa: o MESMO corpo no 4 → 201 (o 4 não passa pelo perfil)", async () => {
    const codigo = codigoNovo();
    const antes = await contarTops();
    recusadaConfiguracao(await criarTop("estoque.entrada", { codigo, configuracao: cfg5(foraDoTipo) }), RECUSAS_DA_ENTRADA);
    expect(await contarTops(), "nenhuma TOP nasce").toBe(antes);
    expect(await totalNaBusca(codigo), "a busca pelo código não acha nada").toBe(0);
    // PREMISSA (o corte): o 4 continua conferido como hoje, valor por valor — e a busca acha o que nasce.
    const codigo4 = codigoNovo();
    const r4 = await criarTop("estoque.entrada", { codigo: codigo4, configuracao: cfg4(foraDoTipo) });
    expect(r4.statusCode, r4.body).toBe(201);
    expect((await versaoAtualNoBanco(j(r4).id as string)).configuracao_schema_version).toBe(4);
    expect(await totalNaBusca(codigo4)).toBe(1);
    // PREMISSA (o perfil é POR TIPO): os mesmos valores numa VENDA no 5 são aceitos — ela tem Financeiro, Fiscal e cliente.
    const venda = await criarTop("vendas.venda", { configuracao: cfg5(foraDoTipo) });
    expect(venda.statusCode, venda.body).toBe(201);
    expect((await versaoAtualNoBanco(j(venda).id as string)).configuracao_schema_version).toBe(5);
  });

  it("T5-3 PUT de uma entrada vigente no 5 com o mesmo corpo → o MESMO 422, nada gravado; cada uma sozinha → a sua recusa", async () => {
    const id = await top("estoque.entrada", { configuracao: cfg5() });
    const f = await foto(id);
    expect(f.versoes, "premissa: a entrada nasceu no 5").toEqual([{ versao: 1, configuracao_schema_version: 5 }]);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5(foraDoTipo) }), RECUSAS_DA_ENTRADA);
    expect(await foto(id), "o PUT não grava nada").toEqual(f);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5((x) => { x.geral.exigeParceiro = true; }) }), [RECUSAS_DA_ENTRADA[0]]);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5((x) => { x.financeiro.atualizacao = "pagar"; }) }), [RECUSAS_DA_ENTRADA[1]]);
    recusadaConfiguracao(await editarTop(id, { configuracao: cfg5((x) => { x.fiscal.habilitado = true; }) }), [RECUSAS_DA_ENTRADA[2]]);
    expect(await foto(id), "nenhuma das recusas grava").toEqual(f);
    // PREMISSA: o que o tipo aceita fora do neutro (a exigência de observação, a aprovação Sempre) grava a N+1 no 5.
    const v = await novaVersao(id, cfg5((x) => { x.geral.exigeObservacao = true; sempre(x); }));
    expect(v.versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 5 }, { versao: 2, configuracao_schema_version: 5 }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-4 — condições permitidas num tipo sem Financeiro, no formato 5", () => {
  it("T5-4 POST e PUT de entrada no 5 com uma condição → 422 (caminho e mensagem exatos), antes de conferir a condição; premissa: a venda no 5 e a entrada no 4 aceitam", async () => {
    const cond = await condicao();
    const codigo = codigoNovo();
    const antes = await contarTops();
    recusadasCondicoes(await criarTop("estoque.entrada", { codigo, configuracao: cfg5(), condicoesPermitidas: [cond] }));
    expect(await contarTops(), "nenhuma TOP nasce").toBe(antes);
    expect(await totalNaBusca(codigo)).toBe(0);
    // ANTES de conferir a condição: uma condição INEXISTENTE recebe a MESMA recusa do tipo, não a "inexistente".
    recusadasCondicoes(await criarTop("estoque.entrada", { configuracao: cfg5(), condicoesPermitidas: ["00000000-0000-4000-8000-000000000000"] }));

    // PUT na entrada vigente no 5: a mesma recusa, nada gravado.
    const id = await top("estoque.entrada", { configuracao: cfg5() });
    const f = await foto(id);
    recusadasCondicoes(await editarTop(id, { condicoesPermitidas: [cond] }));
    recusadasCondicoes(await editarTop(id, { configuracao: cfg5(), condicoesPermitidas: [cond] }));
    expect(await foto(id), "o PUT não grava nada").toEqual(f);
    // A lista VAZIA não é condição nenhuma: aceita (e, sendo a mesma lista, nem cria versão).
    expect((await editarTop(id, { condicoesPermitidas: [] })).statusCode).toBe(200);

    // PREMISSA (o perfil é POR TIPO): a venda no 5 aceita a MESMA condição, e o detalhe a lista.
    const venda = await criarTop("vendas.venda", { configuracao: cfg5(), condicoesPermitidas: [cond] });
    expect(venda.statusCode, venda.body).toBe(201);
    const d = j(await detalheTop(j(venda).id as string));
    expect((d.condicoesPermitidas as { id: string }[]).map((x) => x.id)).toEqual([cond]);
    // PREMISSA (o corte): a entrada no 4 com a condição é aceita, como hoje.
    const entrada4 = await criarTop("estoque.entrada", { configuracao: cfg4(), condicoesPermitidas: [cond] });
    expect(entrada4.statusCode, entrada4.body).toBe(201);
  });

  it("T5-4 entrada vigente no 4 COM uma condição: a configuração no 5 SEM a lista → 422 (a lista PRESERVADA não cabe no tipo), nada gravado; com a lista vazia → a N+1 no 5 sem condição; renomear não passa pelo perfil; premissa: a venda no 5 preserva a dela", async () => {
    const cond = await condicao();
    const criada = await criarTop("estoque.entrada", { configuracao: cfg4(), condicoesPermitidas: [cond] });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = j(criada).id as string;
    expect(await versoesNoBanco(id), "premissa: a entrada nasceu no 4").toEqual([{ versao: 1, configuracao_schema_version: 4 }]);
    expect(await condicoesNoBanco(id), "premissa: com a condição").toEqual([cond]);

    // O que um cliente manda sem a volta ao padrão: a vista do 5 do que está gravado, SEM a lista (ausente = preservar).
    const vista = configuracaoTopParaEdicaoV5((await configuracaoDoDetalhe(id)).valor);
    expect(vista.versaoSchema, "premissa: a vista é do 5").toBe(5);
    const f = await foto(id);
    recusadasCondicoes(await editarTop(id, { configuracao: vista }), MENSAGEM_CONDICOES_PRESERVADAS);
    expect(await foto(id), "o PUT não grava nada").toEqual(f);
    expect(await condicoesNoBanco(id), "e a condição continua na vigente").toEqual([cond]);

    // Renomear (PUT sem `configuracao`, o editor anterior) não passa pelo perfil: a N+1 continua no 4, com a condição.
    const rn = await editarTop(id, { nome: `Entrada renomeada ${unico()}` });
    expect(rn.statusCode, rn.body).toBe(200);
    expect(j(rn).versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 4 }]);
    expect(await condicoesNoBanco(id)).toEqual([cond]);

    // O que o editor do 5 manda (a volta ao padrão, no diálogo): a vista do 5 com a lista VAZIA → a N+1 no 5, sem condição.
    const v = await editarTop(id, { configuracao: vista, condicoesPermitidas: [] });
    expect(v.statusCode, v.body).toBe(200);
    expect(j(v).versao).toBe(3);
    expect(await versoesNoBanco(id)).toEqual([
      { versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 4 }, { versao: 3, configuracao_schema_version: 5 },
    ]);
    expect(await condicoesNoBanco(id), "a versão no 5 não carrega condição").toEqual([]);

    // PREMISSA (o perfil é POR TIPO): a venda no 4 com a condição, salva no 5 com uma mudança e SEM a lista, preserva a condição.
    const venda = await criarTop("vendas.venda", { configuracao: cfg4(), condicoesPermitidas: [cond] });
    expect(venda.statusCode, venda.body).toBe(201);
    const vendaId = j(venda).id as string;
    const vistaVenda = configuracaoTopParaEdicaoV5((await configuracaoDoDetalhe(vendaId)).valor);
    const rv = await editarTop(vendaId, { configuracao: { ...vistaVenda, geral: { ...vistaVenda.geral, exigeObservacao: true } } });
    expect(rv.statusCode, rv.body).toBe(200);
    expect(await versoesNoBanco(vendaId)).toEqual([{ versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 5 }]);
    expect(await condicoesNoBanco(vendaId), "a venda no 5 preserva a condição").toEqual([cond]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-5 — chave de raiz desconhecida", () => {
  // A chave é um nome que nenhuma fase vai declarar como seção (`destino`, o nome que o plano sugere para a da F5,
  // quebraria este teste no dia em que ela entrasse).
  it("T5-5 `secaoInexistente` na raiz → 422 campo_desconhecido nela, no 5 e no 4; nenhuma TOP nasce; premissa: sem a chave, 201", async () => {
    for (const corpo of [{ ...cfg5(), secaoInexistente: {} }, { ...cfg4(), secaoInexistente: {} }]) {
      const antes = await contarTops();
      recusadaConfiguracao(await criarTop("vendas.venda", { configuracao: corpo }), [{ motivo: "campo_desconhecido", caminho: "secaoInexistente" }]);
      expect(await contarTops(), `formato ${corpo.versaoSchema}: nada nasce`).toBe(antes);
    }
    for (const corpo of [cfg5(), cfg4()]) {
      expect((await criarTop("vendas.venda", { configuracao: corpo })).statusCode, `formato ${corpo.versaoSchema} sem a chave`).toBe(201);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-6
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-6 — 4 → 5", () => {
  it("T5-6 a vista do 5 de uma TOP no 4, salva sem mexer → no-op (sem versão, revisão nem trilha); com Automática → v2 no 5, `geral`; a v1 continua 4 no histórico", async () => {
    const id = await top("vendas.venda", { configuracao: cfg4() });
    const f = await foto(id);
    expect(f.versoes, "premissa: nasceu no 4").toEqual([{ versao: 1, configuracao_schema_version: 4 }]);
    // O que o editor do 5 faz: lê o detalhe (como gravado: 4) e monta a vista do 5 pelo domínio.
    const lida = await configuracaoDoDetalhe(id);
    expect(lida.versaoSchema, "o detalhe devolve a versão COMO GRAVADA").toBe(4);
    const vista = configuracaoTopParaEdicaoV5(lida.valor);
    expect(vista.versaoSchema, "premissa: a vista é do 5").toBe(5);
    const r = await editarTop(id, { configuracao: vista });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id, versao: 1, revisao: f.pai.revisao });
    expect(await foto(id), "nada gravado: a versão continua a 1, no 4").toEqual(f);
    expect(await auditoriaDe("tipos_operacao", id, "update"), "nenhum update na trilha").toEqual([]);

    // Com mudança: a N+1 nasce no 5, e só a seção que mudou é marcada.
    const v = await novaVersao(id, { ...vista, geral: { ...vista.geral, confirmacao: "automatica" } });
    expect(v.versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 5 }]);
    const hist = await historico(id);
    expect(hist.map((x) => [x.versao, x.configuracao.suportada, x.configuracao.versaoSchema])).toEqual([[2, true, 5], [1, true, 4]]);
    expect(hist[0]!.secoesAlteradas).toEqual(["geral"]);
    // A v1 COMO GRAVADA (leituraDoDetalhe: "formato_gravado"): o payload do 4, nunca promovido.
    expect(hist[1]!.configuracao).toEqual({ suportada: true, versaoSchema: 4, valor: cfg4() });
    const upd = await auditoriaDe("tipos_operacao", id, "update");
    expect(upd).toHaveLength(1);
    expect(upd[0]!.metadata).toMatchObject({ versaoAnterior: 1, versao: 2, secoesAlteradas: ["geral"], configuracaoSchema: 5 });
    expect(j(await detalheTop(id)).configuracaoSchema).toBe(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-7
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-7 — o formato não retrocede, e renomear preserva o 5", () => {
  it("T5-7 vigente no 5: PUT com o 4 → 422 {versaoEnviada 4, versaoVigente 5} e nada muda; PUT só com o nome → v2 com o 5 IDÊNTICO", async () => {
    const corpo = cfg5((x) => { automatica(x); sempre(x); x.geral.exigeObservacao = true; });
    const id = await top("vendas.venda", { configuracao: corpo });
    const v1 = await versaoAtualNoBanco(id);
    expect([v1.versao, v1.configuracao_schema_version], "premissa: vigente no 5").toEqual([1, 5]);
    const f = await foto(id);
    const r = await editarTop(id, { configuracao: cfg4((x) => { automatica(x); sempre(x); x.geral.exigeObservacao = true; }) });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
    expect(erro(r).details).toEqual({ versaoEnviada: 4, versaoVigente: 5 });
    expect(await foto(id), "nada gravado").toEqual(f);

    // Renomear (o que o editor anterior faz com uma TOP no 5: PUT SEM `configuracao`) → a N+1 carrega o 5 inteiro.
    const nome = `Venda renomeada ${unico()}`;
    const rn = await editarTop(id, { nome });
    expect(rn.statusCode, rn.body).toBe(200);
    expect(j(rn).versao).toBe(2);
    const v2 = await versaoAtualNoBanco(id);
    expect([v2.versao, v2.configuracao_schema_version]).toEqual([2, 5]);
    expect(v2.configuracao, "a configuração do 5 viaja inteira").toEqual(v1.configuracao);
    expect(v2.configuracao).toEqual(corpo);
    expect((await historico(id))[0]!.secoesAlteradas, "só o nome mudou").toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// T5-8
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("T5-8 — 1 a 3 lidos como 5", () => {
  it("T5-8 pedido de compra de PRODUÇÃO (3: Automática, Permitido, Permitida) no 5 → 422 da matriz com os 3 motivos; normalizado pela matriz → v2 no 5 com as regras no neutro", async () => {
    const producao = <X extends { geral: { confirmacao: string; documentoSemItens: string; alteracaoAposConfirmacao: string } }>(x: X): void => {
      x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.alteracaoAposConfirmacao = "permitida";
    };
    const id = await top("compras.pedido", { configuracao: cfg3(producao) });
    expect((await versaoAtualNoBanco(id)).configuracao_schema_version, "premissa: o 3 de produção grava como hoje").toBe(3);
    const f = await foto(id);
    // A vista do 5 do que está gravado, sem tirar nada: a matriz recusa as três.
    const vista = configuracaoTopParaEdicaoV5((await configuracaoDoDetalhe(id)).valor);
    expect([vista.versaoSchema, vista.geral.confirmacao], "premissa: a vista do 5 carrega o que o 3 declarava").toEqual([5, "automatica"]);
    recusadaConfiguracao(await editarTop(id, { configuracao: vista }), [
      recusaDoPerfil("geral.confirmacao", MSG.naoConfirmado),
      recusaDoPerfil("geral.documentoSemItens", MSG.semItensOrcamentoPedido),
      recusaDoPerfil("geral.alteracaoAposConfirmacao", MSG.naoConfirmado),
    ]);
    expect(await foto(id), "nada gravado").toEqual(f);

    // "Salvar assim mesmo": o editor volta as três ao padrão pela matriz (o domínio) e grava o 5.
    const normalizada = normalizarRegrasGeraisDaFamiliaTop("compras.pedido", vista);
    expect(normalizada.voltaram.map((x) => x.caminho), "premissa: as três voltam").toEqual(["geral.confirmacao", "geral.documentoSemItens", "geral.alteracaoAposConfirmacao"]);
    const v = await novaVersao(id, normalizada.configuracao);
    expect(v.versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 3 }, { versao: 2, configuracao_schema_version: 5 }]);
    const geral = (await versaoAtualNoBanco(id)).configuracao.geral as Record<string, unknown>;
    expect([geral.confirmacao, geral.documentoSemItens, geral.alteracaoAposConfirmacao]).toEqual(["manual", "proibido", "bloqueada"]);
    expect((await historico(id))[0]!.secoesAlteradas).toEqual(["geral"]);
  });

  it("T5-8 TOPs no 1 e no 2 neutras: a vista do 5, salva sem mexer → no-op (continuam no formato delas); premissa: com uma mudança, a N+1 nasce no 5", async () => {
    for (const [formato, corpo] of [[1, configuracaoNeutraTop()], [2, configuracaoNeutraTopV2()]] as const) {
      const id = await top("vendas.orcamento", { configuracao: corpo });
      const f = await foto(id);
      expect(f.versoes, `premissa: nasceu no ${formato}`).toEqual([{ versao: 1, configuracao_schema_version: formato }]);
      const lida = await configuracaoDoDetalhe(id);
      expect(lida.versaoSchema, "o detalhe devolve o formato gravado").toBe(formato);
      const vista = configuracaoTopParaEdicaoV5(lida.valor);
      expect(vista.versaoSchema).toBe(5);
      const r = await editarTop(id, { configuracao: vista });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toEqual({ id, versao: 1, revisao: f.pai.revisao });
      expect(await foto(id), `formato ${formato}: nada gravado`).toEqual(f);
      // PREMISSA: a mesma vista com uma exigência marcada é mudança → v2 no 5.
      const v = await novaVersao(id, { ...vista, geral: { ...vista.geral, exigeObservacao: true } });
      expect(v.versao).toBe(2);
      expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: formato }, { versao: 2, configuracao_schema_version: 5 }]);
    }
  });
});
