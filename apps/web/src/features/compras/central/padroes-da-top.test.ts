import { describe, expect, it } from "vitest";
import { EXIGENCIAS_GERAIS_COMPRA_TOP, familiaOperacionalDeDocumentoCompra, perfilDosPadroesFinanceiros, resolverTipoOperacao } from "@agro/domain";
import type { ItemRow } from "@/features/docs/shared";
import type { PadroesFinanceirosDaTop } from "@/features/central/contrato";
import {
  LOCAL_DA_LINHA, cobradoNoCorpo, dicaDaTop, lerPadroesDaTop, localConfirmadoNaEmpresa, localDasLinhasNovas, localDoCadastroDoProduto, marcaDoLocal,
  omissaoDoCorpo, padraoDaTopInvalido, padroesDaTopAplicam, planoDaSemeadura, podeTrocarOsPadroes, travadoPelaTop, type CobrancaNoCorpo,
  type PadroesDaTopLidos, localDasLinhasNovasNoPortao, localDoProdutoLigado, portaoDoLocalDoProduto
} from "./padroes-da-top";

/**
 * LANCAMENTO-01 (decisão 311) — as decisões PURAS dos padrões da TOP na criação da Central de Compras. As famílias são
 * PERGUNTADAS ao registry (nenhum código de família escrito aqui): a compra e a solicitação de compra — a família real
 * cujo perfil diz `trocaPeloDocumento: false`.
 */

const NAT = "aaaaaaaa-0000-4000-8000-000000000001";
const CEN = "aaaaaaaa-0000-4000-8000-000000000002";
const TIT = "aaaaaaaa-0000-4000-8000-000000000003";
const FOR = "aaaaaaaa-0000-4000-8000-000000000004";
const CON = "aaaaaaaa-0000-4000-8000-000000000005";
const OUTRO_CENTRO = "bbbbbbbb-0000-4000-8000-000000000002";
const OUTRA_NATUREZA = "bbbbbbbb-0000-4000-8000-000000000001";

const respostaComPadroes = (extra: Record<string, unknown> = {}) => ({
  contractVersion: 1, exigencias: [], condicoesPermitidas: null, geraTitulos: true,
  secao: { provisao: false, documentoTroca: true, semClassificacao: "exigir" },
  padroes: {
    natureza: { id: NAT, codigo: "3.1.01", nome: "Insumos" }, centro: { id: CEN, codigo: "1.02", nome: "Lavoura" },
    tipoTitulo: { id: TIT, nome: "Duplicata" }, formaPagamento: { id: FOR, nome: "Boleto" }, conta: { id: CON, codigo: "001", descricao: "Conta movimento" }
  },
  regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false },
  ...extra
});
const lidos = (extra: Record<string, unknown> = {}): PadroesDaTopLidos => {
  const l = lerPadroesDaTop(respostaComPadroes(extra));
  if (!l) throw new Error("a resposta de exemplo tem de ser lida");
  return l;
};
const padroes = (): PadroesFinanceirosDaTop => {
  const p = lidos().padroes;
  if (!p) throw new Error("a resposta de exemplo tem padrões");
  return p;
};

const FAMILIA_COMPRA = familiaOperacionalDeDocumentoCompra("compra");
/** Nada cobrado sobre o corpo antes da TOP: nenhum obrigatório do layout, nenhuma exigência geral. */
const SEM_COBRANCA: CobrancaNoCorpo = { obrigatorioNoLayout: () => false, exigenciasGerais: [] };
const FAMILIA_SOLICITACAO = resolverTipoOperacao("erp.purchase_requests")?.codigo;

describe("LANC-U01 o leitor: a API anterior não manda secao nem padroes ⇒ null (a tela de hoje)", () => {
  it("sem as duas chaves, sem uma delas, ou resposta que não é objeto", () => {
    const { secao: _s, padroes: _p, ...anterior } = respostaComPadroes();
    expect(lerPadroesDaTop(anterior)).toBeNull();
    expect(lerPadroesDaTop({ ...anterior, secao: respostaComPadroes().secao })).toBeNull();
    expect(lerPadroesDaTop({ ...anterior, padroes: respostaComPadroes().padroes })).toBeNull();
    expect(lerPadroesDaTop(null)).toBeNull();
    expect(lerPadroesDaTop([respostaComPadroes()])).toBeNull();
  });
  it("a resposta nova é lida inteira (premissa: o leitor não é sempre null)", () => {
    const l = lidos();
    expect(l.secao).toEqual({ provisao: false, documentoTroca: true, semClassificacao: "exigir" });
    expect(l.padroes?.natureza).toEqual({ id: NAT, codigo: "3.1.01", nome: "Insumos" });
    expect(l.padroes?.formaPagamento).toEqual({ id: FOR, nome: "Boleto" });
    expect(l.invalidos.size).toBe(0);
  });
  it("padroes: null ⇒ a seção, sem padrões — e aí nada se aplica", () => {
    const l = lerPadroesDaTop(respostaComPadroes({ padroes: null }));
    expect(l).not.toBeNull();
    expect(l?.padroes).toBeNull();
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: l, geraTitulos: true })).toBe(false);
  });
});

describe("LANC-U02 o leitor: forma errada ⇒ null (nunca 'um padrão a menos')", () => {
  const base = respostaComPadroes();
  it.each([
    ["secao nula", { secao: null }],
    ["provisao não booleana", { secao: { ...base.secao, provisao: "false" } }],
    ["documentoTroca ausente", { secao: { provisao: false, semClassificacao: "exigir" } }],
    ["semClassificacao não texto", { secao: { ...base.secao, semClassificacao: 1 } }],
    ["padroes lista", { padroes: [] }],
    ["padroes texto", { padroes: "x" }],
    ["padroes sem a chave conta", { padroes: { natureza: null, centro: null, tipoTitulo: null, formaPagamento: null } }],
    ["entrada texto", { padroes: { ...base.padroes, formaPagamento: FOR } }],
    ["entrada sem id", { padroes: { ...base.padroes, centro: { codigo: "1", nome: "x" } } }],
    ["entrada com id que não é UUID", { padroes: { ...base.padroes, natureza: { id: "1", codigo: "1", nome: "x" } } }]
  ])("%s", (_nome, extra) => {
    expect(lerPadroesDaTop(respostaComPadroes(extra))).toBeNull();
  });
  it("só as chaves do contrato são copiadas", () => {
    const l = lerPadroesDaTop(respostaComPadroes({ secao: { ...base.secao, extra: 1 }, padroes: { ...base.padroes, tipoTitulo: { id: TIT, nome: "Duplicata", sigla: "DP" } } }));
    expect(l?.secao).toEqual({ provisao: false, documentoTroca: true, semClassificacao: "exigir" });
    expect(l?.padroes?.tipoTitulo).toEqual({ id: TIT, nome: "Duplicata" });
  });
});

describe("LANC-U03 o leitor: entrada com id e sem rótulo ⇒ inválida (não semeia, dá o aviso)", () => {
  const base = respostaComPadroes();
  it("natureza sem nome, centro sem código, forma com nome vazio, conta sem descrição", () => {
    const l = lerPadroesDaTop(respostaComPadroes({
      padroes: { ...base.padroes, natureza: { id: NAT, codigo: "3.1.01" }, centro: { id: CEN, nome: "Lavoura" }, formaPagamento: { id: FOR, nome: "  " }, conta: { id: CON, codigo: "001" } }
    }));
    expect(l).not.toBeNull();
    expect(l?.padroes?.natureza).toBeNull();
    expect(l?.padroes?.centro).toBeNull();
    expect(l?.padroes?.formaPagamento).toBeNull();
    expect(l?.padroes?.conta).toBeNull();
    expect(l?.padroes?.tipoTitulo).toEqual({ id: TIT, nome: "Duplicata" }); // a válida continua valendo
    expect([...(l?.invalidos ?? [])].sort()).toEqual(["centro", "conta", "formaPagamento", "natureza"]);
  });
  it("a inválida não semeia e dá o aviso — só quando a TOP vale", () => {
    const l = lerPadroesDaTop(respostaComPadroes({ padroes: { ...base.padroes, natureza: { id: NAT, codigo: "3.1.01", nome: "" } } }));
    if (!l?.padroes) throw new Error("premissa: lida, com padrões");
    expect(planoDaSemeadura(l.padroes, { natureza: "", centro: "", formaPagamento: "", tipoTitulo: null }, { formaCobrada: false })).toEqual({});
    expect(padraoDaTopInvalido(true, l, "categoria_financeira_id")).toBe(true);
    expect(padraoDaTopInvalido(true, l, "centro_custo_id")).toBe(false);
    expect(padraoDaTopInvalido(false, l, "categoria_financeira_id")).toBe(false);
  });
});

describe("LANC-U04 podeTrocar = documentoTroca E o perfil da família (AND, nunca OR)", () => {
  it("premissas do domínio: a compra troca pelo documento; a solicitação de compra não", () => {
    expect(FAMILIA_COMPRA).toBeTruthy();
    expect(FAMILIA_SOLICITACAO).toBeTruthy();
    expect(perfilDosPadroesFinanceiros(FAMILIA_COMPRA ?? "")?.trocaPeloDocumento).toBe(true);
    expect(perfilDosPadroesFinanceiros(FAMILIA_SOLICITACAO ?? "")?.trocaPeloDocumento).toBe(false);
  });
  it("a compra: segue o documentoTroca", () => {
    const secao = lidos().secao;
    expect(podeTrocarOsPadroes({ ...secao, documentoTroca: true }, FAMILIA_COMPRA ?? "")).toBe(true);
    expect(podeTrocarOsPadroes({ ...secao, documentoTroca: false }, FAMILIA_COMPRA ?? "")).toBe(false);
  });
  it("a solicitação de compra (trocaPeloDocumento: false): não troca nem com documentoTroca ligado", () => {
    const secao = lidos().secao;
    expect(podeTrocarOsPadroes({ ...secao, documentoTroca: true }, FAMILIA_SOLICITACAO ?? "")).toBe(false);
    expect(podeTrocarOsPadroes({ ...secao, documentoTroca: false }, FAMILIA_SOLICITACAO ?? "")).toBe(false);
  });
  it("família sem perfil (o orçamento de compra) ⇒ false", () => {
    const orcamento = familiaOperacionalDeDocumentoCompra("orcamento");
    expect(orcamento).toBeTruthy();
    expect(perfilDosPadroesFinanceiros(orcamento ?? "")).toBeNull();
    expect(podeTrocarOsPadroes({ ...lidos().secao, documentoTroca: true }, orcamento ?? "")).toBe(false);
  });
});

describe("LANC-U05 aplica: criação ∧ padrões ∧ (compra que gera título | pedido que provisiona)", () => {
  it("a compra", () => {
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: lidos(), geraTitulos: true })).toBe(true);
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: lidos(), geraTitulos: false })).toBe(false);
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: lidos(), geraTitulos: null })).toBe(false);
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: null, geraTitulos: true })).toBe(false);
  });
  it("o pedido: pela provisão da seção (geraTitulos não conta)", () => {
    const comProvisao = lidos({ secao: { provisao: true, documentoTroca: true, semClassificacao: "exigir" } });
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: false, lidos: comProvisao, geraTitulos: false })).toBe(true);
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: false, lidos: lidos(), geraTitulos: true })).toBe(false);
  });
});

describe("LANC-U06 receber ⇒ nada (nem semeado, nem travado, nem omitido, nem aviso)", () => {
  it("aplica é falso no receber, e com ele tudo é neutro", () => {
    const l = lidos({ secao: { provisao: true, documentoTroca: false, semClassificacao: "exigir" } });
    const aplica = padroesDaTopAplicam({ modo: "receber", ehCompra: true, lidos: l, geraTitulos: true });
    expect(aplica).toBe(false);
    const semeado = { categoria_financeira_id: NAT, centro_custo_id: CEN, tipo_titulo_id: TIT };
    expect(omissaoDoCorpo({ aplica, padroes: l.padroes, semeado, natureza: NAT, centro: CEN, tipoTitulo: TIT, cobrancaNoCorpo: SEM_COBRANCA }))
      .toEqual({ classificacao: false, tipoTitulo: false });
    expect(travadoPelaTop({ aplica, podeTrocar: false, padroes: l.padroes, campo: "categoria_financeira_id", valor: NAT })).toBe(false);
    expect(dicaDaTop({ aplica, padroes: l.padroes, campo: "categoria_financeira_id", valor: NAT })).toBeUndefined();
    expect(padraoDaTopInvalido(aplica, lerPadroesDaTop(respostaComPadroes({ padroes: { ...respostaComPadroes().padroes, natureza: { id: NAT, codigo: "x" } } })), "categoria_financeira_id")).toBe(false);
  });
});

describe("LANC-U07 o PAR natureza+centro (S3)", () => {
  const vazio = { natureza: "", centro: "", formaPagamento: "", tipoTitulo: null };
  it("os dois vazios ⇒ o par inteiro", () => {
    expect(planoDaSemeadura(padroes(), vazio, { formaCobrada: false })).toEqual({ categoria_financeira_id: NAT, centro_custo_id: CEN });
  });
  it("o layout deu o centro da TOP ⇒ só a natureza (o par fica o da TOP); ids comparados sem caixa", () => {
    expect(planoDaSemeadura(padroes(), { ...vazio, centro: CEN.toUpperCase() }, { formaCobrada: false })).toEqual({ categoria_financeira_id: NAT });
    expect(planoDaSemeadura(padroes(), { ...vazio, natureza: NAT }, { formaCobrada: false })).toEqual({ centro_custo_id: CEN });
  });
  it("o layout (ou a cópia) com o centro ≠ o da TOP ⇒ a natureza NÃO é semeada", () => {
    expect(planoDaSemeadura(padroes(), { ...vazio, centro: OUTRO_CENTRO }, { formaCobrada: false })).toEqual({});
    expect(planoDaSemeadura(padroes(), { ...vazio, natureza: OUTRA_NATUREZA }, { formaCobrada: false })).toEqual({});
  });
  it("a TOP com só um do par ⇒ nada", () => {
    expect(planoDaSemeadura({ ...padroes(), centro: null }, vazio, { formaCobrada: false })).toEqual({});
    expect(planoDaSemeadura({ ...padroes(), natureza: null }, vazio, { formaCobrada: false })).toEqual({});
  });
  it("um do par tocado pelo operador ⇒ nenhum dos dois (meio par seria recusado pelo salvar)", () => {
    expect(planoDaSemeadura(padroes(), vazio, { formaCobrada: false, livre: (c) => c !== "centro_custo_id" })).toEqual({});
  });
});

describe("LANC-U08 a forma só cobrada; o tipo de título só com o bloco fiscal (S4, S5)", () => {
  const vazio = { natureza: NAT, centro: CEN, formaPagamento: "", tipoTitulo: null };
  it("a forma: cobrada e vazia ⇒ semeada; opcional ⇒ não; preenchida ⇒ não", () => {
    expect(planoDaSemeadura(padroes(), vazio, { formaCobrada: true })).toEqual({ forma_pagamento_id: FOR });
    expect(planoDaSemeadura(padroes(), vazio, { formaCobrada: false })).toEqual({});
    expect(planoDaSemeadura(padroes(), { ...vazio, formaPagamento: "cccccccc-0000-4000-8000-000000000004" }, { formaCobrada: true })).toEqual({});
  });
  it("o tipo de título: sem o bloco (null) ⇒ não; vazio ⇒ o da TOP; tocado ⇒ não", () => {
    expect(planoDaSemeadura(padroes(), { ...vazio, tipoTitulo: null }, { formaCobrada: false })).toEqual({});
    expect(planoDaSemeadura(padroes(), { ...vazio, tipoTitulo: "" }, { formaCobrada: false })).toEqual({ tipo_titulo_id: TIT });
    expect(planoDaSemeadura(padroes(), { ...vazio, tipoTitulo: "" }, { formaCobrada: false, livre: (c) => c !== "tipo_titulo_id" })).toEqual({});
  });
});

describe("LANC-U09 a regra do CORPO (S6)", () => {
  const corpo = (o: Partial<Parameters<typeof omissaoDoCorpo>[0]> = {}) => omissaoDoCorpo({
    aplica: true, padroes: padroes(), semeado: { categoria_financeira_id: NAT, centro_custo_id: CEN },
    natureza: NAT, centro: CEN, tipoTitulo: "", cobrancaNoCorpo: SEM_COBRANCA, ...o
  });
  it("o par semeado pela TOP, intocado ⇒ fora do corpo (o servidor aplica o mesmo par)", () => {
    expect(corpo().classificacao).toBe(true);
  });
  it("metade veio do layout (só a natureza foi semeada) ⇒ os DOIS no corpo", () => {
    expect(corpo({ semeado: { categoria_financeira_id: NAT } }).classificacao).toBe(false);
  });
  it("o operador mudou um do par ⇒ os DOIS no corpo", () => {
    expect(corpo({ centro: OUTRO_CENTRO }).classificacao).toBe(false);
    expect(corpo({ natureza: OUTRA_NATUREZA }).classificacao).toBe(false);
    expect(corpo({ natureza: "" }).classificacao).toBe(false);
  });
  it("o layout marca a natureza (ou o centro) obrigatória ⇒ no corpo (o servidor cobra o layout sobre o corpo)", () => {
    expect(corpo({ cobrancaNoCorpo: { ...SEM_COBRANCA, obrigatorioNoLayout: (c) => c === "categoria_financeira_id" } }).classificacao).toBe(false);
    expect(corpo({ cobrancaNoCorpo: { ...SEM_COBRANCA, obrigatorioNoLayout: (c) => c === "centro_custo_id" } }).classificacao).toBe(false);
  });
  it("o tipo de título semeado sai; trocado, vai; sem aplica, tudo vai", () => {
    expect(corpo({ semeado: { tipo_titulo_id: TIT }, tipoTitulo: TIT }).tipoTitulo).toBe(true);
    expect(corpo({ semeado: { tipo_titulo_id: TIT }, tipoTitulo: "cccccccc-0000-4000-8000-000000000003" }).tipoTitulo).toBe(false);
    expect(corpo({ aplica: false, semeado: { categoria_financeira_id: NAT, centro_custo_id: CEN, tipo_titulo_id: TIT }, tipoTitulo: TIT })).toEqual({ classificacao: false, tipoTitulo: false });
  });
  it("o valor igual ao da TOP que NÃO foi semeado (veio do layout) vai no corpo", () => {
    expect(corpo({ semeado: {} }).classificacao).toBe(false);
  });
  it("a TOP respondeu outro par depois de semear ⇒ o da tela (o antigo) vai no corpo (o servidor aplicaria o novo)", () => {
    const novoPar = { ...padroes(), natureza: { id: OUTRA_NATUREZA, codigo: "3.1.02", nome: "Outra" }, centro: { id: OUTRO_CENTRO, codigo: "1.03", nome: "Outro" } };
    expect(corpo({ padroes: novoPar }).classificacao).toBe(false);
    expect(corpo({ padroes: novoPar, semeado: { tipo_titulo_id: TIT }, tipoTitulo: TIT }).tipoTitulo).toBe(true); // o tipo é o mesmo
    expect(corpo({ padroes: { ...novoPar, tipoTitulo: { id: FOR, nome: "x" } }, semeado: { tipo_titulo_id: TIT }, tipoTitulo: TIT }).tipoTitulo).toBe(false);
  });
});

describe("LANC-U13 o que o servidor COBRA SOBRE O CORPO antes da TOP nunca sai do corpo; o total não entra na regra", () => {
  /** O caminho que o servidor cobra para cada exigência geral da compra (o mapa do domínio que `cobrarRegrasDaCompra` usa). */
  const caminhoDa = (chave: string) => {
    const c = EXIGENCIAS_GERAIS_COMPRA_TOP.find((x) => x.chave === chave)?.caminho;
    if (!c) throw new Error(`premissa: o domínio declara a exigência geral ${chave} da compra`);
    return c;
  };
  const corpo = (cobrancaNoCorpo: CobrancaNoCorpo) => omissaoDoCorpo({
    aplica: true, padroes: padroes(), semeado: { categoria_financeira_id: NAT, centro_custo_id: CEN },
    natureza: NAT, centro: CEN, tipoTitulo: "", cobrancaNoCorpo
  });
  it("(a) a exigência geral do CENTRO (`exigencias: [\"centro_custo_id\"]`) ⇒ o par vai INTEIRO no corpo", () => {
    const exigencias = [caminhoDa("exigeCentroResultado")];
    expect(exigencias, "premissa: o servidor cobra o centro pelo caminho do corpo").toEqual(["centro_custo_id"]);
    expect(cobradoNoCorpo("centro_custo_id", { ...SEM_COBRANCA, exigenciasGerais: exigencias })).toBe(true);
    expect(corpo({ ...SEM_COBRANCA, exigenciasGerais: exigencias }).classificacao).toBe(false);
  });
  it("(b) a exigência geral de OUTRO campo (observação, fornecedor, transportadora) ⇒ o par continua fora do corpo", () => {
    const outras = [caminhoDa("exigeObservacao"), caminhoDa("exigeParceiro"), caminhoDa("exigeTransportadora")];
    expect(outras).not.toContain("centro_custo_id");
    expect(outras).not.toContain("categoria_financeira_id");
    expect(corpo({ ...SEM_COBRANCA, exigenciasGerais: outras }).classificacao).toBe(true);
  });
  it("(c) a compra de TOTAL ZERO: a regra não recebe o total — o par semeado e não cobrado fica FORA do corpo (o gravado de hoje)", () => {
    // a compra que gera título é a mesma com qualquer total: `aplica` não olha o total, e a omissão também não
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos: lidos(), geraTitulos: true })).toBe(true);
    expect(corpo(SEM_COBRANCA)).toEqual({ classificacao: true, tipoTitulo: false });
  });
  it("(d) o obrigatório do LAYOUT continua levando o par inteiro ao corpo (também junto de uma exigência de outro campo)", () => {
    expect(corpo({ obrigatorioNoLayout: (c) => c === "centro_custo_id", exigenciasGerais: [] }).classificacao).toBe(false);
    expect(corpo({ obrigatorioNoLayout: (c) => c === "categoria_financeira_id", exigenciasGerais: [caminhoDa("exigeObservacao")] }).classificacao).toBe(false);
  });
});

describe("LANC-U10 a trava e a dica (S7, S8)", () => {
  const trava = (o: Partial<Parameters<typeof travadoPelaTop>[0]> = {}) =>
    travadoPelaTop({ aplica: true, podeTrocar: false, padroes: padroes(), campo: "centro_custo_id", valor: CEN, ...o });
  it("!podeTrocar ∧ aplica ∧ o valor é o da TOP ⇒ trava", () => {
    expect(trava()).toBe(true);
    expect(trava({ campo: "forma_pagamento_id", valor: FOR })).toBe(true);
    expect(trava({ campo: "tipo_titulo_id", valor: TIT })).toBe(true);
  });
  it("valor do layout ≠ o da TOP, vazio, podeTrocar, sem aplica, campo que a TOP não preenche ⇒ não trava", () => {
    expect(trava({ valor: OUTRO_CENTRO })).toBe(false);
    expect(trava({ valor: "" })).toBe(false);
    expect(trava({ podeTrocar: true })).toBe(false);
    expect(trava({ aplica: false })).toBe(false);
    expect(trava({ campo: "fornecedor_id", valor: CEN })).toBe(false);
  });
  it("a dica: 'código · nome' na natureza e no centro; o nome na forma e no tipo; outro valor ⇒ nenhuma", () => {
    const dica = (campo: string, valor: string) => dicaDaTop({ aplica: true, padroes: padroes(), campo, valor });
    expect(dica("categoria_financeira_id", NAT)).toBe("3.1.01 · Insumos");
    expect(dica("centro_custo_id", CEN)).toBe("1.02 · Lavoura");
    expect(dica("forma_pagamento_id", FOR)).toBe("Boleto");
    expect(dica("tipo_titulo_id", TIT)).toBe("Duplicata");
    expect(dica("centro_custo_id", OUTRO_CENTRO)).toBeUndefined();
    expect(dicaDaTop({ aplica: true, padroes: { ...padroes(), centro: { id: CEN, codigo: "", nome: "Lavoura" } }, campo: "centro_custo_id", valor: CEN })).toBe("Lavoura");
  });
});

/* ═════════════════════════════════════ O LOCAL DA LINHA NOVA ═════════════════════════════════════ */

const EMPRESA_A_LOCAL_CAB = "dddddddd-0000-4000-8000-00000000000a";
const LOCAL_DO_PRODUTO = "dddddddd-0000-4000-8000-00000000000b";
const LOCAL_DE_OUTRA_EMPRESA = "dddddddd-0000-4000-8000-00000000000c";
const LOCAL_DO_OPERADOR = "dddddddd-0000-4000-8000-00000000000d";
const P1 = "eeeeeeee-0000-4000-8000-000000000001";
const P2 = "eeeeeeee-0000-4000-8000-000000000002";
const P3 = "eeeeeeee-0000-4000-8000-000000000003";

/** O que o estado faz com as duas leituras: o local do cadastro do produto, só se a empresa do documento o confirmar. */
const localNaEmpresa = (cadastros: Record<string, unknown>, confirmacoes: Record<string, unknown>) => (produto: string) => {
  const l = localDoCadastroDoProduto(cadastros[produto]);
  return l && localConfirmadoNaEmpresa(confirmacoes[l], l) ? l : null;
};
const CADASTROS = { [P1]: { default_warehouse_id: LOCAL_DO_PRODUTO }, [P2]: { default_warehouse_id: LOCAL_DE_OUTRA_EMPRESA }, [P3]: { default_warehouse_id: null } };
const CONFIRMACOES = { [LOCAL_DO_PRODUTO]: [{ id: LOCAL_DO_PRODUTO, label: "Galpão" }], [LOCAL_DE_OUTRA_EMPRESA]: [] };
const ctx = (o: { cabecalhoEscolhido?: boolean } = {}) => ({
  cabecalhoEscolhido: o.cabecalhoEscolhido ?? false, localDoProduto: localNaEmpresa(CADASTROS, CONFIRMACOES), geraEstoque: (i: ItemRow) => i["compra_gera_estoque"] !== false
});
/** A linha que o motor cria: sem produto, com o local do cabeçalho. */
const linhaDoMotor = (local?: string): ItemRow => ({ product_id: "", quantity: "1", unit_value: "0", generate_stock: true, ...(local ? { warehouse_id: local } : {}) });
/** O motor troca uma chave e preserva as outras (`atualizar`). */
const comOMotor = (l: ItemRow, chave: string, v: unknown): ItemRow => ({ ...l, [chave]: v });

describe("LANC-U11 a fonte do local (L1/L2): o cadastro do produto e a empresa do documento", () => {
  it("o cadastro: só o default_warehouse_id com forma de UUID", () => {
    expect(localDoCadastroDoProduto({ default_warehouse_id: LOCAL_DO_PRODUTO, default_warehouse_id_label: "Galpão" })).toBe(LOCAL_DO_PRODUTO);
    expect(localDoCadastroDoProduto({ default_warehouse_id: null })).toBeNull();
    expect(localDoCadastroDoProduto({ default_warehouse_id: "1" })).toBeNull();
    expect(localDoCadastroDoProduto(undefined)).toBeNull();
  });
  it("outra empresa ([]), erro, forma estranha ou outro id ⇒ ignorado; a lista com o próprio local ⇒ vale", () => {
    expect(localConfirmadoNaEmpresa([{ id: LOCAL_DO_PRODUTO }], LOCAL_DO_PRODUTO)).toBe(true);
    expect(localConfirmadoNaEmpresa([{ id: LOCAL_DO_PRODUTO.toUpperCase() }], LOCAL_DO_PRODUTO)).toBe(true);
    expect(localConfirmadoNaEmpresa([], LOCAL_DO_PRODUTO)).toBe(false);
    expect(localConfirmadoNaEmpresa(undefined, LOCAL_DO_PRODUTO)).toBe(false);
    expect(localConfirmadoNaEmpresa({ id: LOCAL_DO_PRODUTO }, LOCAL_DO_PRODUTO)).toBe(false);
    expect(localConfirmadoNaEmpresa([{ id: LOCAL_DE_OUTRA_EMPRESA }], LOCAL_DO_PRODUTO)).toBe(false);
  });
});

describe("LANC-U12 o local da linha nova (L3): operador → produto → cabeçalho", () => {
  it("o padrão do layout no cabeçalho PERDE para o produto", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    expect(nasce[0]?.warehouse_id).toBe(EMPRESA_A_LOCAL_CAB); // sem produto, o do cabeçalho (o de hoje)
    expect(marcaDoLocal(nasce[0]!)).toEqual({ dono: "sistema", base: EMPRESA_A_LOCAL_CAB, atual: EMPRESA_A_LOCAL_CAB });
    const comProduto = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P1)], ctx());
    expect(comProduto[0]?.warehouse_id).toBe(LOCAL_DO_PRODUTO);
  });
  it("o local do produto de OUTRA empresa é ignorado: fica o do cabeçalho", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    const comProduto = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P2)], ctx());
    expect(comProduto[0]?.warehouse_id).toBe(EMPRESA_A_LOCAL_CAB);
  });
  it("o produto sem local, ou o cabeçalho vazio e produto sem local: o de hoje", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor()], ctx());
    const comProduto = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P3)], ctx());
    expect(comProduto[0]?.warehouse_id ?? "").toBe("");
    const doProduto = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P1)], ctx());
    expect(doProduto[0]?.warehouse_id).toBe(LOCAL_DO_PRODUTO); // cabeçalho vazio também fica abaixo do produto
  });
  it("o cabeçalho ESCOLHIDO pelo operador VENCE o produto", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx({ cabecalhoEscolhido: true }));
    expect(marcaDoLocal(nasce[0]!)).toEqual({ dono: "operador" });
    const comProduto = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P1)], ctx({ cabecalhoEscolhido: true }));
    expect(comProduto[0]?.warehouse_id).toBe(EMPRESA_A_LOCAL_CAB);
  });
  it("o AJUSTE do operador na célula é preservado — antes do produto e depois do local automático", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    const ajustadaAntes = localDasLinhasNovas([comOMotor(comOMotor(nasce[0]!, "warehouse_id", LOCAL_DO_OPERADOR), "product_id", P1)], ctx());
    expect(ajustadaAntes[0]?.warehouse_id).toBe(LOCAL_DO_OPERADOR);
    const automatica = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P1)], ctx());
    const ajustadaDepois = localDasLinhasNovas([comOMotor(automatica[0]!, "warehouse_id", LOCAL_DO_OPERADOR)], ctx());
    expect(ajustadaDepois[0]?.warehouse_id).toBe(LOCAL_DO_OPERADOR);
    const outroProduto = localDasLinhasNovas([comOMotor(ajustadaDepois[0]!, "product_id", P3)], ctx());
    expect(outroProduto[0]?.warehouse_id).toBe(LOCAL_DO_OPERADOR); // trocar o produto não derruba o ajuste
  });
  it("trocar para um produto sem local volta ao do cabeçalho (nunca o local do produto anterior)", () => {
    const nasce = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    const p1 = localDasLinhasNovas([comOMotor(nasce[0]!, "product_id", P1)], ctx());
    const p3 = localDasLinhasNovas([comOMotor(p1[0]!, "product_id", P3)], ctx());
    expect(p3[0]?.warehouse_id).toBe(EMPRESA_A_LOCAL_CAB);
  });
  it("a linha da cópia (já com produto) é do operador; a que não gera estoque não recebe local", () => {
    const copia: ItemRow = { product_id: P1, quantity: "2", warehouse_id: LOCAL_DO_OPERADOR };
    expect(localDasLinhasNovas([copia], ctx())[0]?.warehouse_id).toBe(LOCAL_DO_OPERADOR);
    const nasce = localDasLinhasNovas([linhaDoMotor()], ctx());
    const semEstoque = localDasLinhasNovas([{ ...comOMotor(nasce[0]!, "product_id", P1), compra_gera_estoque: false }], ctx());
    expect(semEstoque[0]?.warehouse_id ?? "").toBe("");
  });
  it("a identidade é a da LINHA (a marca anda com ela), nunca o índice; nada a mudar ⇒ o MESMO array", () => {
    const nascidas = localDasLinhasNovas([linhaDoMotor(EMPRESA_A_LOCAL_CAB), linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    const ajustada = comOMotor(nascidas[0]!, "warehouse_id", LOCAL_DO_OPERADOR);
    const marcadas = localDasLinhasNovas([ajustada, nascidas[1]!], ctx());
    // a linha ajustada vai para o fim (reordenada/duplicada pelo motor): continua do operador
    const reordenadas = localDasLinhasNovas([comOMotor(marcadas[1]!, "product_id", P1), comOMotor(marcadas[0]!, "product_id", P1)], ctx());
    expect(reordenadas.map((l) => l.warehouse_id)).toEqual([LOCAL_DO_PRODUTO, LOCAL_DO_OPERADOR]);
    expect(localDasLinhasNovas(reordenadas, ctx())).toBe(reordenadas);
    expect(Object.keys(reordenadas[0]!)).toContain(LOCAL_DA_LINHA);
  });
});

/* ═════════════════════════════ A CHAVE DO LOCAL DO PRODUTO (emenda R2 da decisão 311) ═════════════════════════════ */

describe("LANC-U14 o leitor da capacidade `localDoProdutoNaLinha`: só o booleano true liga (fail-closed)", () => {
  it("ausente (a API anterior) ⇒ desligada; o resto da resposta continua lido", () => {
    const anterior = respostaComPadroes();
    expect(Object.hasOwn(anterior, "localDoProdutoNaLinha"), "premissa: a resposta de exemplo não tem a chave").toBe(false);
    expect(localDoProdutoLigado(anterior)).toBe(false);
    expect(lerPadroesDaTop(anterior), "a chave ausente não derruba os padrões").not.toBeNull();
  });
  it.each([
    ["false", false], ["o texto \"true\"", "true"], ["o número 1", 1], ["null", null], ["um objeto", { ligado: true }], ["uma lista", [true]]
  ])("%s ⇒ desligada", (_nome, valor) => {
    expect(localDoProdutoLigado(respostaComPadroes({ localDoProdutoNaLinha: valor }))).toBe(false);
  });
  it("resposta que não é objeto ⇒ desligada; o booleano true ⇒ ligada (premissa: o leitor não é sempre falso)", () => {
    for (const r of [null, undefined, "x", 1, [respostaComPadroes({ localDoProdutoNaLinha: true })]]) expect(localDoProdutoLigado(r), JSON.stringify(r)).toBe(false);
    expect(localDoProdutoLigado(respostaComPadroes({ localDoProdutoNaLinha: true }))).toBe(true);
  });
});

describe("LANC-U15 o portão: desligada (ou sem a coluna do local) ⇒ nenhum produto a ler e o efeito não roda", () => {
  const produtos = [P1, P2, P3, P1];
  it("desligada ⇒ { roda: false, produtos: [] } — zero leitura nova, mesmo com a coluna do local e linhas com produto", () => {
    expect(portaoDoLocalDoProduto({ ligado: false, localNaGrade: true, produtos })).toEqual({ roda: false, produtos: [] });
  });
  it("sem a coluna do local na grade ⇒ fechado também (o AND)", () => {
    expect(portaoDoLocalDoProduto({ ligado: true, localNaGrade: false, produtos })).toEqual({ roda: false, produtos: [] });
    expect(portaoDoLocalDoProduto({ ligado: false, localNaGrade: false, produtos })).toEqual({ roda: false, produtos: [] });
  });
  it("ligada e com a coluna ⇒ roda, com os produtos das linhas (premissa: o portão não é sempre fechado)", () => {
    const p = portaoDoLocalDoProduto({ ligado: true, localNaGrade: true, produtos });
    expect(p).toEqual({ roda: true, produtos });
    expect(p.produtos).not.toBe(produtos); // uma cópia: o portão não devolve a lista de quem chamou
  });
  it("a capacidade lida da resposta alimenta o portão: a API anterior fecha, o true abre", () => {
    const daResposta = (r: unknown) => portaoDoLocalDoProduto({ ligado: localDoProdutoLigado(r), localNaGrade: true, produtos });
    expect(daResposta(respostaComPadroes())).toEqual({ roda: false, produtos: [] });
    expect(daResposta(respostaComPadroes({ localDoProdutoNaLinha: true })).roda).toBe(true);
  });
});

describe("LANC-U16 o efeito do local atrás do portão: desligada, a linha nasce e fica com o local do cabeçalho, SEM a marca", () => {
  const fechado = portaoDoLocalDoProduto({ ligado: false, localNaGrade: true, produtos: [P1] });
  const aberto = portaoDoLocalDoProduto({ ligado: true, localNaGrade: true, produtos: [P1] });
  it("fechado ⇒ as MESMAS linhas (nenhum local trocado, nenhuma marca), do nascimento ao produto escolhido", () => {
    const nascidas = [linhaDoMotor(EMPRESA_A_LOCAL_CAB)];
    const nasce = localDasLinhasNovasNoPortao(fechado, nascidas, ctx());
    expect(nasce, "a linha que o motor criou, intacta").toBe(nascidas);
    const comProduto = [comOMotor(nasce[0]!, "product_id", P1)];
    const depois = localDasLinhasNovasNoPortao(fechado, comProduto, ctx());
    expect(depois).toBe(comProduto);
    expect(depois[0]?.warehouse_id, "o local do cabeçalho, como antes da 311").toBe(EMPRESA_A_LOCAL_CAB);
    expect(Object.keys(depois[0]!), "sem a marca de quem pôs o local").not.toContain(LOCAL_DA_LINHA);
  });
  it("premissa: o MESMO cenário com o portão aberto marca a linha e põe o local do produto", () => {
    const nasce = localDasLinhasNovasNoPortao(aberto, [linhaDoMotor(EMPRESA_A_LOCAL_CAB)], ctx());
    expect(marcaDoLocal(nasce[0]!)).toEqual({ dono: "sistema", base: EMPRESA_A_LOCAL_CAB, atual: EMPRESA_A_LOCAL_CAB });
    const depois = localDasLinhasNovasNoPortao(aberto, [comOMotor(nasce[0]!, "product_id", P1)], ctx());
    expect(depois[0]?.warehouse_id).toBe(LOCAL_DO_PRODUTO);
  });
});
