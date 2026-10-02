import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  MATRIZ_EXECUCAO_TOP, MATRIZ_REGRAS_GERAIS_TOP, SECOES_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2,
  configuracaoNeutraTop, configuracaoNeutraTopV2,
  ERRO_EXIGENCIA_NAO_ATENDIDA, MENSAGEM_EXIGENCIA_NAO_ATENDIDA, ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA,
  MENSAGEM_CONDICAO_NAO_PERMITIDA, ERRO_CLIENTE_EM_ATRASO,
  type ConfiguracaoTipoOperacaoV4,
} from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, criarTop, top, detalheTop, editarTop, novaVersao, versaoAtualNoBanco, versoesNoBanco,
  produtoComSaldo, itemVenda, corpoVenda, lancarVenda, vendaLancada, confirmarVenda, situacaoNoBanco, movimentosDe, titulosDe,
  auditoriaDe, decisoesDe, type Resposta,
} from "./top-config-08-ajuda.js";

/**
 * TOP-CONFIG-08 (decisão 277) — A API DA TOP NO FORMATO 4 (SPEC §1, §2 e §8; casos F4-1..F4-6).
 *
 *   · F4-1 capabilities: o bloco `regrasGerais` na RAIZ, depois de `reservaEstoque`, com a matriz do domínio; os
 *          blocos de hoje (`configuracao`, `execucao`, `restricoes`) passam pelos MESMOS `toEqual` de hoje;
 *   · F4-2 POST e PUT no formato 4: CADA família da matriz (e três de "outra família") × CADA opção fora do aceito
 *          → 422 `TIPO_OPERACAO_CONFIGURACAO_INVALIDA` com `{ recusas: [{ motivo, caminho, mensagem }] }` e o motivo
 *          EXATO da SPEC §2 — escrito AQUI, e não lido do domínio: uma matriz errada no domínio não se aprova sozinha;
 *   · F4-3 a versão: 3 → 4 no neutro não cria versão; 3 → 4 com regra fora do neutro cria a N+1, e o histórico e a
 *          trilha marcam `geral`/`aprovacao`, cada uma por si; o corpo da TOP de pedido de compra de produção
 *          (formato 3) enviado no formato 4 → 422 com as 3 recusas;
 *   · F4-4 os formatos 1 a 3 gravados e lidos como hoje (a matriz não os alcança); no 4, a exigência, a condição
 *          permitida e o cliente em atraso dão a MESMA resposta do 3, pela venda;
 *   · F4-5 o corpo no formato 4 volta do GET no formato 4, e `configuracao_schema_version` é 4 no banco. Nunca 3;
 *   · F4-6 a guarda da 0023: a venda com TOP formato 4 (legado/legado e configurada) confirma pelo `/confirm` — a
 *          marca é gravada — sem aprovação exigida.
 *
 * O QUE CONTA COMO PROVA: versão corrente, número do formato, revisão e trilha LIDOS NO BANCO (superusuário, sem RLS);
 * "nada gravado" = o pai e as versões idênticos antes e depois, nunca só o 422. Cada recusa tem a PREMISSA ao lado: o
 * mesmo valor no formato 3 é aceito (o corte), e o que a família aceita fora do neutro é aceito no 4.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── a matriz da SPEC §2, escrita à mão ───────────────

const MOTIVO = {
  semDocumento: "Esta operação ainda não tem documento no sistema.",
  naoConfirmado: "Este documento não é confirmado: ele é convertido ou recebido em outro.",
  semItensEstoque: "Documento de estoque sem itens não movimenta nada.",
  semItensOrcamentoPedido: "Orçamento e pedido sem itens não têm o que converter nem receber.",
  alteracaoVenda: "Alterar uma venda confirmada ainda não tem execução: o estorno do estoque e os títulos não sabem refazer o documento. Cancele e lance outra.",
  alteracaoCompra: "Alterar uma compra confirmada ainda não tem execução: a compra não tem edição. Cancele e lance outra.",
  alteracaoEstoque: "Documento de estoque confirmado não se altera: cancele e lance outro.",
  aprovacaoPorValorEstoque: "O valor do documento de estoque só é conhecido na confirmação: use \"Sempre\".",
  aprovacaoSemConfirmacao: "A aprovação acontece antes da confirmação, e este documento não é confirmado.",
} as const;

const OPCOES = {
  confirmacao: ["manual", "automatica"],
  documentoSemItens: ["proibido", "permitido"],
  alteracaoAposConfirmacao: ["bloqueada", "permitida"],
  aprovacao: ["nenhuma", "sempre", "por_valor"],
} as const;
type Regra = keyof typeof OPCOES;
const REGRAS: readonly Regra[] = ["confirmacao", "documentoSemItens", "alteracaoAposConfirmacao", "aprovacao"];
const CAMINHO: Record<Regra, string> = {
  confirmacao: "geral.confirmacao", documentoSemItens: "geral.documentoSemItens",
  alteracaoAposConfirmacao: "geral.alteracaoAposConfirmacao", aprovacao: "aprovacao.politica",
};

type RegraDaFamilia = { aceitos: string[]; motivo: string | null };
type Linha = { familia: string } & Record<Regra, RegraDaFamilia>;
const tudo = (r: Regra): RegraDaFamilia => ({ aceitos: [...OPCOES[r]], motivo: null });
const so = (aceitos: string[], motivo: string): RegraDaFamilia => ({ aceitos, motivo });

const documentoConfirmado = (familia: string, alteracao: string): Linha => ({
  familia, confirmacao: tudo("confirmacao"), documentoSemItens: tudo("documentoSemItens"),
  alteracaoAposConfirmacao: so(["bloqueada"], alteracao), aprovacao: tudo("aprovacao"),
});
const estoque = (familia: string): Linha => ({
  familia, confirmacao: tudo("confirmacao"), documentoSemItens: so(["proibido"], MOTIVO.semItensEstoque),
  alteracaoAposConfirmacao: so(["bloqueada"], MOTIVO.alteracaoEstoque), aprovacao: so(["nenhuma", "sempre"], MOTIVO.aprovacaoPorValorEstoque),
});
const orcamentoOuPedido = (familia: string): Linha => ({
  familia, confirmacao: so(["manual"], MOTIVO.naoConfirmado), documentoSemItens: so(["proibido"], MOTIVO.semItensOrcamentoPedido),
  alteracaoAposConfirmacao: so(["bloqueada"], MOTIVO.naoConfirmado), aprovacao: so(["nenhuma"], MOTIVO.aprovacaoSemConfirmacao),
});
/** OPERACOES-01 F6a (decisão 283): o pedido de compra — como o pedido, mas a aprovação vale inteira (ao finalizar). */
const pedidoDeCompra = (familia: string): Linha => ({
  familia, confirmacao: so(["manual"], MOTIVO.naoConfirmado), documentoSemItens: so(["proibido"], MOTIVO.semItensOrcamentoPedido),
  alteracaoAposConfirmacao: so(["bloqueada"], MOTIVO.naoConfirmado), aprovacao: tudo("aprovacao"),
});
const semDocumento = (familia: string): Linha => ({
  familia, confirmacao: so(["manual"], MOTIVO.semDocumento), documentoSemItens: so(["proibido"], MOTIVO.semDocumento),
  alteracaoAposConfirmacao: so(["bloqueada"], MOTIVO.semDocumento), aprovacao: so(["nenhuma"], MOTIVO.semDocumento),
});

/**
 * A matriz publicada, na ordem da SPEC §2: venda, compra, as 4 espécies de estoque, orçamento e os dois pedidos — e,
 * desde a F6a (decisão 283), o pedido de compra com a aprovação inteira (ao finalizar) e o orçamento de compra no fim.
 */
const MATRIZ_DA_SPEC: readonly Linha[] = [
  documentoConfirmado("vendas.venda", MOTIVO.alteracaoVenda),
  documentoConfirmado("compras.compra", MOTIVO.alteracaoCompra),
  estoque("estoque.entrada"), estoque("estoque.saida"), estoque("estoque.transferencia"), estoque("estoque.ajuste"),
  // OPERACOES-01 F5a (decisão 282): as três espécies da movimentação interna, com a linha do estoque, depois do ajuste.
  estoque("estoque.requisicao_material"), estoque("estoque.consumo"), estoque("estoque.devolucao_consumo"),
  orcamentoOuPedido("vendas.orcamento"), orcamentoOuPedido("vendas.pedido"), pedidoDeCompra("compras.pedido"),
  // OPERACOES-01 F6a (decisão 283): o orçamento de compra, por último.
  orcamentoOuPedido("compras.orcamento"),
];
/** "Qualquer outra família": uma antiga de estoque, a solicitação de compra e uma do financeiro. Não são linhas da matriz. */
const OUTRAS_FAMILIAS: readonly Linha[] = [semDocumento("estoque.baixa"), semDocumento("compras.solicitacao"), semDocumento("financeiro.conta_a_pagar")];

/** A configuração do formato 4 (ou 3) com UMA regra no valor dado. `por_valor` leva o limite de 1500.00. */
function comRegra<C extends ConfiguracaoTipoOperacaoV4 | ReturnType<typeof cfg3>>(x: C, regra: Regra, valor: string): C {
  if (regra === "aprovacao") {
    x.aprovacao.politica = valor as C["aprovacao"]["politica"];
    x.aprovacao.valorMinimo = valor === "por_valor" ? "1500.00" : null;
  } else {
    (x.geral as unknown as Record<string, string>)[regra] = valor;
  }
  return x;
}
const recusa = (regra: Regra, mensagem: string) => ({ motivo: "combinacao_nao_suportada", caminho: CAMINHO[regra], mensagem });

// ─────────────── testemunhas da TOP ───────────────

/** O pai como o BANCO o guarda: versão corrente e revisão. */
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
type ItemHistorico = { versao: number; secoesAlteradas: string[] | null; configuracao: { suportada: boolean; versaoSchema: number; valor?: unknown } };
async function historico(topId: string): Promise<ItemHistorico[]> {
  const r = await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${topId}/versoes`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  return j(r).items as ItemHistorico[];
}
/** A recusa da matriz: o 422, o código, a mensagem do envelope e EXATAMENTE estas recusas, nesta ordem. */
function recusadoPelaMatriz(r: Resposta, recusas: unknown[]) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: "A configuração operacional enviada é inválida", details: { recusas } });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("F4-1 — capabilities: o bloco regrasGerais na raiz", () => {
  it("F4-1 regrasGerais = {suportado, versaoSchema 4, matriz do domínio} depois de reservaEstoque; configuracao, execucao e restricoes como hoje, nas duas instâncias", async () => {
    for (const [app, ligado] of [[c.h.app, false], [c.ligada, true]] as const) {
      const r = await app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const d = j(r);
      // O bloco novo: a MESMA matriz do domínio (fonte única), e a matriz da SPEC §2, linha por linha.
      expect(d.regrasGerais).toEqual({ suportado: true, versaoSchema: 4, matriz: JSON.parse(JSON.stringify(MATRIZ_REGRAS_GERAIS_TOP)) });
      expect((d.regrasGerais as { matriz: unknown }).matriz, "a matriz publicada é a da SPEC §2").toEqual(MATRIZ_DA_SPEC);
      const chaves = Object.keys(d);
      expect(chaves, "na RAIZ").toContain("regrasGerais");
      expect(chaves.indexOf("regrasGerais"), "depois de reservaEstoque").toBeGreaterThan(chaves.indexOf("reservaEstoque"));
      // OS toEqual DE HOJE, sem mudança (tipos-operacao-configuracao, tipos-operacao-execucao, top-config-05/07).
      expect(d.contractVersion).toBe(1);
      expect(d.configuracao).toEqual({ versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP, secoes: [...SECOES_CONFIGURACAO_TOP] });
      expect(d.execucao).toEqual({ suportado: true, versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, runtimeHabilitado: ligado, matriz: JSON.parse(JSON.stringify(MATRIZ_EXECUCAO_TOP)) });
      expect(d.restricoes).toEqual({ suportado: true, versaoSchema: 3 });
      expect(d.reservaEstoque).toBe(1);
      expect(d.destinos).toMatchObject({ suportado: true, emPartes: 1 });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("F4-2 — POST e PUT no formato 4: cada família × cada opção fora da matriz → 422 com o motivo exato", () => {
  for (const linha of [...MATRIZ_DA_SPEC, ...OUTRAS_FAMILIAS]) {
    const fora = REGRAS.flatMap((regra) => OPCOES[regra].filter((v) => !linha[regra].aceitos.includes(v)).map((valor) => ({ regra, valor })));
    const dentro = REGRAS.flatMap((regra) => linha[regra].aceitos.filter((v) => v !== OPCOES[regra][0]).map((valor) => ({ regra, valor })));

    it(`F4-2 ${linha.familia}: ${fora.length} opção(ões) fora → 422 no POST e no PUT, nada gravado; o que ela aceita passa`, async () => {
      expect(fora.length, "premissa: a família recusa alguma opção (a alteração após confirmar, ao menos)").toBeGreaterThan(0);
      const base = await top(linha.familia, { configuracao: cfg4() });
      for (const { regra, valor } of fora) {
        const esperado = [recusa(regra, linha[regra].motivo!)];
        // POST: nenhuma TOP nasce.
        const antes = await contarTops();
        recusadoPelaMatriz(await criarTop(linha.familia, { configuracao: comRegra(cfg4(), regra, valor) }), esperado);
        expect(await contarTops(), `${regra}=${valor}: nenhuma TOP nasce`).toBe(antes);
        // PUT sobre a TOP neutra do formato 4: nem versão, nem revisão, nem trilha.
        const f = await foto(base);
        recusadoPelaMatriz(await editarTop(base, { configuracao: comRegra(cfg4(), regra, valor) }), esperado);
        expect(await foto(base), `${regra}=${valor}: o PUT não grava nada`).toEqual(f);
        // PREMISSA (o corte): o MESMO valor no formato 3 é aceito — a matriz só alcança o 4.
        expect((await criarTop(linha.familia, { configuracao: comRegra(cfg3(), regra, valor) })).statusCode, `${regra}=${valor} no formato 3`).toBe(201);
      }
      // TODAS de uma vez: uma recusa por caminho, na ordem fixa (confirmação, sem itens, alteração, aprovação).
      const todas = cfg4();
      for (const { regra, valor } of fora) comRegra(todas, regra, valor);
      const caminhosFora = [...new Set(fora.map((x) => x.regra))];
      recusadoPelaMatriz(await criarTop(linha.familia, { configuracao: todas }),
        REGRAS.filter((r) => caminhosFora.includes(r)).map((r) => recusa(r, linha[r].motivo!)));
      // PREMISSA: cada opção que a família aceita fora do neutro é gravada no formato 4 (POST e PUT).
      for (const { regra, valor } of dentro) {
        const r = await criarTop(linha.familia, { configuracao: comRegra(cfg4(), regra, valor) });
        expect(r.statusCode, `${linha.familia} aceita ${regra}=${valor}: ${r.body}`).toBe(201);
        expect((await versaoAtualNoBanco(j(r).id as string)).configuracao_schema_version).toBe(4);
      }
      if (dentro.length) {
        const tudoDentro = cfg4();
        for (const { regra, valor } of dentro) comRegra(tudoDentro, regra, valor);
        const v = await novaVersao(base, tudoDentro);
        expect(v.versao, "a configuração aceita cria a versão 2").toBe(2);
      }
    });
  }

  it("F4-2 o PUT sem `configuracao` não reconfere a versão vigente (a matriz só cresce; a conferência é da gravação)", async () => {
    // Uma versão do formato 4 que a matriz de HOJE recusaria (Automática num orçamento), gravada por SQL como versão
    // NOVA (a versão é imutável) — o caso de uma matriz futura que aceitava e de um binário que voltou. Renomear não a toca.
    const id = await top("vendas.orcamento", { configuracao: cfg4() });
    const fora = comRegra(cfg4(), "confirmacao", "automatica");
    await c.admin.query(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, descricao, criado_por, configuracao, configuracao_schema_version, destinos_configurados)
       select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, v.descricao, v.criado_por, $2::jsonb, 4, v.destinos_configurados
         from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao where t.id = $1`,
      [id, JSON.stringify(fora)]);
    await c.admin.query("update erp.tipos_operacao set versao_atual = versao_atual + 1 where id = $1", [id]);
    const r = await editarTop(id, { nome: `Orçamento renomeado ${unico()}` });
    expect(r.statusCode, r.body).toBe(200);
    const v = await versaoAtualNoBanco(id);
    expect([v.versao, v.configuracao_schema_version, (v.configuracao as { geral: { confirmacao: string } }).geral.confirmacao]).toEqual([3, 4, "automatica"]);
    // PREMISSA: com a configuração no corpo, a MESMA versão é recusada.
    recusadoPelaMatriz(await editarTop(id, { configuracao: fora }), [recusa("confirmacao", MOTIVO.naoConfirmado)]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-3
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("F4-3 — a versão: 3 → 4", () => {
  it("F4-3 3 → 4 no neutro (Manual, Proibido, Bloqueada, Sem aprovação) não é mudança: sem versão nova, sem revisão, sem trilha", async () => {
    const id = await top("vendas.venda", { configuracao: cfg3() });
    const f = await foto(id);
    expect(f.versoes).toEqual([{ versao: 1, configuracao_schema_version: 3 }]);
    const r = await editarTop(id, { configuracao: cfg4() });
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ versao: 1, revisao: f.pai.revisao });
    expect(await foto(id), "nada gravado: a versão continua a 1, no formato 3").toEqual(f);
    // PREMISSA: a mesma troca com UMA regra fora do neutro cria a versão (o caso abaixo, em miniatura).
    const v = await novaVersao(id, comRegra(cfg4(), "confirmacao", "automatica"));
    expect(v.versao).toBe(2);
  });

  const casos: { nome: string; ajuste: [Regra, string][]; secoes: string[] }[] = [
    { nome: "Automática", ajuste: [["confirmacao", "automatica"]], secoes: ["geral"] },
    { nome: "Sempre", ajuste: [["aprovacao", "sempre"]], secoes: ["aprovacao"] },
    { nome: "sem itens Permitido + a partir de 1500.00", ajuste: [["documentoSemItens", "permitido"], ["aprovacao", "por_valor"]], secoes: ["geral", "aprovacao"] },
  ];
  for (const caso of casos) {
    it(`F4-3 3 → 4 com os MESMOS valores (${caso.nome}): a regra passa a valer → versão N+1, e as seções ${caso.secoes.join(" e ")} no histórico e na trilha`, async () => {
      const v3 = cfg3(); const v4 = cfg4();
      for (const [regra, valor] of caso.ajuste) { comRegra(v3, regra, valor); comRegra(v4, regra, valor); }
      const id = await top("vendas.venda", { configuracao: v3 });
      expect((await versaoAtualNoBanco(id)).configuracao_schema_version, "premissa: nasceu no formato 3").toBe(3);
      const r = await editarTop(id, { configuracao: v4 });
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r).versao).toBe(2);
      expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 3 }, { versao: 2, configuracao_schema_version: 4 }]);
      // O histórico: a versão 2 marca as seções que PASSAM A VALER — cada uma por si.
      const hist = await historico(id);
      expect(hist.map((x) => [x.versao, x.configuracao.versaoSchema])).toEqual([[2, 4], [1, 3]]);
      expect(hist[0]!.secoesAlteradas).toEqual(caso.secoes);
      // A trilha: o update da versão 2, com as mesmas seções e o formato 4.
      const upd = (await auditoriaDe("tipos_operacao", id, "update")).at(-1)!;
      expect(upd.metadata).toMatchObject({ versaoAnterior: 1, versao: 2, secoesAlteradas: caso.secoes, configuracaoSchema: 4 });
    });
  }

  it("F4-3 3 neutro → 4 com Sempre (o valor muda): N+1 só com `aprovacao`", async () => {
    const id = await top("compras.compra", { configuracao: cfg3() });
    const v = await novaVersao(id, comRegra(cfg4(), "aprovacao", "sempre"));
    expect(v.versao).toBe(2);
    expect((await historico(id))[0]!.secoesAlteradas).toEqual(["aprovacao"]);
    expect((await versaoAtualNoBanco(id)).configuracao_schema_version).toBe(4);
  });

  it("F4-3 a TOP de pedido de compra de PRODUÇÃO (formato 3: Automática, sem itens Permitido, alteração Permitida) enviada no formato 4 → 422 com as 3 recusas; no neutro do 4 → N+1", async () => {
    const producao = (x: ConfiguracaoTipoOperacaoV4 | ReturnType<typeof cfg3>) => {
      x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.alteracaoAposConfirmacao = "permitida";
      return x;
    };
    // O formato 3 grava como hoje (é o que está em produção).
    const id = await top("compras.pedido", { configuracao: producao(cfg3()) });
    expect((await versaoAtualNoBanco(id)).configuracao_schema_version).toBe(3);
    const f = await foto(id);
    recusadoPelaMatriz(await editarTop(id, { configuracao: producao(cfg4()) }), [
      recusa("confirmacao", MOTIVO.naoConfirmado),
      recusa("documentoSemItens", MOTIVO.semItensOrcamentoPedido),
      recusa("alteracaoAposConfirmacao", MOTIVO.naoConfirmado),
    ]);
    expect(await foto(id), "nada gravado").toEqual(f);
    // "Salvar assim mesmo": o editor volta as três ao padrão e grava o formato 4 → versão 2, a seção geral.
    const v = await novaVersao(id, cfg4());
    expect(v.versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 3 }, { versao: 2, configuracao_schema_version: 4 }]);
    expect((await historico(id))[0]!.secoesAlteradas).toEqual(["geral"]);
  });

  it("F4-3 as TOPs de orçamento e de pedido de venda de PRODUÇÃO (formato 2, alteração Permitida) no formato 4 → 422 na alteração; no neutro do 4 → N+1", async () => {
    for (const familia of ["vendas.orcamento", "vendas.pedido"]) {
      const v2 = configuracaoNeutraTopV2(); v2.geral.alteracaoAposConfirmacao = "permitida";
      const id = await top(familia, { configuracao: v2 });
      expect((await versaoAtualNoBanco(id)).configuracao_schema_version).toBe(2);
      const f = await foto(id);
      recusadoPelaMatriz(await editarTop(id, { configuracao: comRegra(cfg4(), "alteracaoAposConfirmacao", "permitida") }),
        [recusa("alteracaoAposConfirmacao", MOTIVO.naoConfirmado)]);
      expect(await foto(id), `${familia}: nada gravado`).toEqual(f);
      expect((await novaVersao(id, cfg4())).versao).toBe(2);
      expect((await versaoAtualNoBanco(id)).configuracao_schema_version).toBe(4);
      expect((await historico(id))[0]!.secoesAlteradas).toEqual(["geral"]);
    }
  });

  it("F4-3 o formato não retrocede: 3 sobre 4 → 422 SCHEMA_NAO_SUPORTADO {versaoEnviada 3, versaoVigente 4}, nada gravado", async () => {
    const id = await top("vendas.venda", { configuracao: cfg4() });
    const f = await foto(id);
    const r = await editarTop(id, { configuracao: comRegra(cfg3(), "confirmacao", "automatica") });
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r).code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
    expect(erro(r).details).toEqual({ versaoEnviada: 3, versaoVigente: 4 });
    expect(await foto(id)).toEqual(f);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-4
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("F4-4 — os formatos 1 a 3 como hoje; no 4, as restrições do 3 valem igual", () => {
  it("F4-4 formatos 1, 2 e 3 com as regras gerais fora da matriz (num orçamento) gravam e voltam no próprio formato; o PUT no mesmo formato cria a N+1 nele", async () => {
    const declarar = <X extends { geral: { confirmacao: string; documentoSemItens: string; alteracaoAposConfirmacao: string }; aprovacao: { politica: string; valorMinimo: string | null } }>(x: X): X => {
      x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.alteracaoAposConfirmacao = "permitida";
      x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null;
      return x;
    };
    for (const [formato, corpo] of [[1, declarar(configuracaoNeutraTop())], [2, declarar(configuracaoNeutraTopV2())], [3, declarar(cfg3())]] as const) {
      const id = await top("vendas.orcamento", { configuracao: corpo });
      expect(await versoesNoBanco(id), `formato ${formato}`).toEqual([{ versao: 1, configuracao_schema_version: formato }]);
      const d = j(await detalheTop(id));
      expect(d.configuracaoSchema).toBe(formato);
      expect(d.configuracao).toEqual({ suportada: true, versaoSchema: formato, valor: corpo });
      // Gravado como hoje: o PUT no mesmo formato muda a regra e a versão nova continua naquele formato.
      const mudado = { ...corpo, geral: { ...corpo.geral, confirmacao: "manual" } };
      expect((await novaVersao(id, mudado)).versao).toBe(2);
      expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `formato ${formato} não vira outro`).toBe(formato);
    }
  });

  it("F4-4 exigência geral: a venda sem observação recebe a MESMA 422 no formato 3 e no 4; com a observação, 201 nos dois", async () => {
    const exige = <X extends { geral: { exigeObservacao: boolean } }>(x: X): X => { x.geral.exigeObservacao = true; return x; };
    const [t3, t4] = [await top("vendas.venda", { configuracao: exige(cfg3()) }), await top("vendas.venda", { configuracao: exige(cfg4()) })];
    const p = await produtoComSaldo("0");
    const r3 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t3 }));
    const r4 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t4 }));
    expect(r4.statusCode, r4.body).toBe(422);
    expect(erro(r4)).toEqual({ code: ERRO_EXIGENCIA_NAO_ATENDIDA, message: MENSAGEM_EXIGENCIA_NAO_ATENDIDA,
      details: { exigencias: [{ caminho: "note", mensagem: "Observação é obrigatório nesta operação." }] } });
    expect([r3.statusCode, erro(r3)], "o formato 4 responde o que o 3 responde").toEqual([422, erro(r4)]);
    for (const t of [t3, t4]) await vendaLancada(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t, note: "entregar pela manhã" }));
  });

  it("F4-4 condição permitida: fora da lista → a MESMA 422 no 3 e no 4; na lista → 201", async () => {
    const condicao = async () => {
      const s = unico();
      return (await c.admin.query<{ id: string }>(
        "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,dia_vencimento,entrada,entrada_percentual,is_active) values ($1,$2,$3,1,30,'intervalo',30,null,false,null,true) returning id",
        [c.h.demo.orgId, `T8-${s}`, `Condição TC08 ${s}`])).rows[0]!.id;
    };
    const [c1, c2] = [await condicao(), await condicao()];
    const [t3, t4] = [await top("vendas.venda", { configuracao: cfg3(), condicoesPermitidas: [c1] }), await top("vendas.venda", { configuracao: cfg4(), condicoesPermitidas: [c1] })];
    const p = await produtoComSaldo("0");
    const r3 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t3, condicao_pagamento_id: c2 }));
    const r4 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t4, condicao_pagamento_id: c2 }));
    expect(r4.statusCode, r4.body).toBe(422);
    expect(erro(r4)).toEqual({ code: ERRO_CONDICAO_PAGAMENTO_NAO_PERMITIDA, message: MENSAGEM_CONDICAO_NAO_PERMITIDA, details: { campo: "condicao_pagamento_id" } });
    expect([r3.statusCode, erro(r3)]).toEqual([422, erro(r4)]);
    for (const t of [t3, t4]) await vendaLancada(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t, condicao_pagamento_id: c1 }));
  });

  it("F4-4 cliente em atraso (bloqueia): o devedor recebe a MESMA 422 no 3 e no 4; o cliente em dia, 201", async () => {
    const cliente = async (n: string) => (await c.admin.query<{ id: string }>(
      "insert into erp.people(organization_id,code,document,person_type,name,legal_name,city_id,is_client) values ($1,$2,$3,'legal',$4,$4,5208707,true) returning id",
      [c.h.demo.orgId, `T8C${n}`, `990800000${n.padStart(5, "0")}`, `[TEST] Cliente TC08 ${n}`])).rows[0]!.id;
    const [emDia, devedor] = [await cliente("1"), await cliente("2")];
    // O vencimento sai do relógio do BANCO (o mesmo `current_date` com que o atraso é conferido), nunca do relógio do
    // processo: perto da meia-noite, ou com fusos diferentes, os dois discordam do "hoje".
    const venc = (await c.admin.query<{ d: string }>("select (current_date - 10)::text d")).rows[0]!.d;
    await c.admin.query(
      "insert into erp.financial_titles(organization_id,empresa_id,code,direction,number,person_id,amount,emission_date,due_date) values ($1,$2,$3,'receivable',$4,$5,'1234.50',$6,$6)",
      [c.h.demo.orgId, c.I.empresa, `T8-ATR-${unico()}`, "T8-ATRASO", devedor, venc]);
    const bloqueia = <X extends { financeiro: { clienteEmAtraso: string } }>(x: X): X => { x.financeiro.clienteEmAtraso = "bloqueia"; return x; };
    const [t3, t4] = [await top("vendas.venda", { configuracao: bloqueia(cfg3()) }), await top("vendas.venda", { configuracao: bloqueia(cfg4()) })];
    const p = await produtoComSaldo("0");
    const r3 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t3, client_id: devedor }));
    const r4 = await lancarVenda(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t4, client_id: devedor }));
    expect(r4.statusCode, r4.body).toBe(422);
    expect(erro(r4)).toMatchObject({ code: ERRO_CLIENTE_EM_ATRASO, details: { campo: "client_id", titulos: 1, total: "1234.50", vencimentoMaisAntigo: venc } });
    expect([r3.statusCode, erro(r3)]).toEqual([422, erro(r4)]);
    for (const t of [t3, t4]) await vendaLancada(corpoVenda([itemVenda(p.id)], { tipo_operacao_id: t, client_id: emDia }));
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-5
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("F4-5 — o formato 4 volta como 4. Nunca 3", () => {
  it("F4-5 um corpo no formato 4 (fora do neutro) volta do GET e do histórico no formato 4; o banco grava 4 e o MESMO payload; o PUT também", async () => {
    const corpo = cfg4((x) => {
      x.geral.confirmacao = "automatica"; x.geral.documentoSemItens = "permitido"; x.geral.exigeObservacao = true;
      x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1500.00";
      x.financeiro.clienteEmAtraso = "avisa";
    });
    const id = await top("vendas.venda", { configuracao: corpo });
    const v = await versaoAtualNoBanco(id);
    expect([v.versao, v.configuracao_schema_version]).toEqual([1, 4]);
    expect(v.configuracao, "o banco guarda o 4, não um 3 com as mesmas chaves").toEqual(corpo);
    const d = j(await detalheTop(id));
    expect(d.configuracaoSchema).toBe(4);
    expect(d.configuracao).toEqual({ suportada: true, versaoSchema: 4, valor: corpo });
    // O PUT no formato 4 também grava 4.
    const mudado = cfg4((x) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; });
    expect((await novaVersao(id, mudado)).versao).toBe(2);
    expect(await versoesNoBanco(id)).toEqual([{ versao: 1, configuracao_schema_version: 4 }, { versao: 2, configuracao_schema_version: 4 }]);
    expect((await historico(id)).map((x) => [x.versao, x.configuracao.suportada, x.configuracao.versaoSchema])).toEqual([[2, true, 4], [1, true, 4]]);
    // A listagem diz o formato de cada linha pelo número.
    const lista = j(await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao?pageSize=200`, headers: c.h.headers() })) as { items: { id: string; configuracaoSchema: number }[] };
    expect(lista.items.find((x) => x.id === id)?.configuracaoSchema).toBe(4);
  });

  it("F4-5 o NEUTRO do formato 4 também grava 4 (não é \"igual ao 3\" na criação), em todas as famílias da matriz", async () => {
    for (const linha of MATRIZ_DA_SPEC) {
      const id = await top(linha.familia, { configuracao: cfg4() });
      expect((await versaoAtualNoBanco(id)).configuracao_schema_version, linha.familia).toBe(4);
      expect((j(await detalheTop(id)).configuracao as { versaoSchema: number }).versaoSchema, linha.familia).toBe(4);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// F4-6
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A GUARDA DA 0023, DIRETO NO BANCO: um UPDATE de superusuário para `confirmed`, numa transação desfeita no fim. A
 * marca da classificação (0024) é posta sempre, para que a ÚNICA guarda em jogo seja a da execução configurada; a da
 * 0023 só com `marca`. Devolve a mensagem da recusa, ou `null` se a transição passou (e foi desfeita).
 */
async function transicaoDireta(vendaId: string, marca: boolean): Promise<string | null> {
  const cx = await c.admin.connect();
  try {
    await cx.query("begin");
    await cx.query("select set_config('app.venda_classificacao_financeira', $1, true)", [vendaId]);
    if (marca) await cx.query("select set_config('app.venda_execucao_configurada', $1, true)", [vendaId]);
    try {
      await cx.query("update erp.sales_documents set status='confirmed' where id=$1", [vendaId]);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  } finally {
    await cx.query("rollback").catch(() => undefined);
    cx.release();
  }
}
const MENSAGEM_DA_GUARDA_0023 = "TIPO_OPERACAO_INDISPONIVEL: a operacao desta venda usa execucao configurada, que este servidor nao executa; a venda nao foi confirmada";

describe("F4-6 — a guarda da 0023: a venda com TOP formato 4 confirma pela marca", () => {
  const configuracoes: { nome: string; cfg: () => ConfiguracaoTipoOperacaoV4; resumo: { estoque: string; financeiro: string } }[] = [
    { nome: "legado/legado (o neutro)", cfg: () => cfg4(), resumo: { estoque: "legado", financeiro: "legado" } },
    { nome: "configurada (Saída + A receber)", resumo: { estoque: "configurada:saida", financeiro: "configurada:receber" },
      cfg: () => cfg4((x) => { x.execucao = { estoque: "configurada", financeiro: "configurada" }; x.estoque.atualizacao = "saida"; x.financeiro.atualizacao = "receber"; }) },
  ];
  for (const caso of configuracoes) {
    it(`F4-6 ${caso.nome}: a guarda exige a marca no formato 4, e o /confirm a grava — confirmada com estoque e título, sem aprovação`, async () => {
      const topId = await top("vendas.venda", { configuracao: caso.cfg() });
      expect((await versaoAtualNoBanco(topId)).configuracao_schema_version, "premissa: a versão é do formato 4").toBe(4);
      const p = await produtoComSaldo("10");
      const corpo = corpoVenda([itemVenda(p.id, "2", "50.00")], { tipo_operacao_id: topId });

      // PREMISSA: a guarda da 0023 está em jogo no formato 4 — sem a marca o banco recusa; com ela, passa.
      const testemunha = (await vendaLancada(corpo)).id;
      expect(await transicaoDireta(testemunha, false), "sem a marca, o banco recusa o formato 4").toBe(MENSAGEM_DA_GUARDA_0023);
      expect(await transicaoDireta(testemunha, true), "com a marca, a transição passa (desfeita no fim)").toBeNull();
      expect(await situacaoNoBanco("sales_documents", testemunha)).toBe("open");

      // O /confirm: passa pela guarda — ou seja, gravou a marca —, e sem aprovação (a versão não pede).
      const id = (await vendaLancada(corpo)).id;
      const r = await confirmarVenda(id);
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r)).toMatchObject({ id, status: "confirmed" });
      expect(await situacaoNoBanco("sales_documents", id)).toBe("confirmed");
      expect((await movimentosDe("sales_documents", id)).map((m) => [m.movement_type, m.direction, Number(m.quantity)])).toEqual([["sale", -1, 2]]);
      expect((await titulosDe("sales_documents", id)).map((t) => [t.direction, t.amount])).toEqual([["receivable", "100.00"]]);
      const confirm = await auditoriaDe("sales_documents", id, "confirm");
      expect(confirm).toHaveLength(1);
      expect(confirm[0]!.metadata).toMatchObject({ execucao: { origem: 4, ...caso.resumo } });
      expect(confirm[0]!.metadata, "a confirmação manual não ganha a chave da automática").not.toHaveProperty("automatica");
      expect(await decisoesDe("aprovacoes_venda", id), "nenhuma decisão de aprovação foi preciso").toEqual([]);
    });
  }
});
