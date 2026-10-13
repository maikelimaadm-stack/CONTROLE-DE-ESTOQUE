import { describe, expect, it, vi } from "vitest";
import { familiaOperacionalDeDocumentoCompra, rotuloDoTPag, type EstruturaLayout, type FormaDePagamentoDaConferencia } from "@agro/domain";
import { lerRegras } from "../layout-da-central";
import { formaCobradaPelaTop, formaDaImportacao, lerFormaDaConferencia, perguntaDaForma, topDaForma, type TopDaForma } from "./forma-da-nota";

// O leitor das regras (`lerRegras`) é o MESMO da Central; os módulos dele pelo apelido "@/…" vêm pelo caminho relativo.
vi.mock("@/lib/utils", () => import("../../../lib/utils"));
vi.mock("@/features/central/regras-gerais", () => import("../../central/regras-gerais"));

/**
 * XML-04 (decisão 318) — a forma de pagamento da importação: a precedência operador → nota → padrão da TOP (só
 * cobrando) → pergunta, a trava da TOP com o aviso das duas, o texto de cada situação e o skew com a API anterior.
 * R5: mais de um `<detPag>` nunca escolhe forma alguma (nem "a primeira"); R6: o tPag sem ligação (e a forma inativa)
 * nunca escolhe forma alguma; R7: a forma da nota nunca vence a escolha do operador.
 */

const PIX = "aaaaaaaa-0000-4000-8000-000000000017";
const BOLETO = "aaaaaaaa-0000-4000-8000-000000000015";
const DINHEIRO = "aaaaaaaa-0000-4000-8000-000000000001";
const INATIVA = "aaaaaaaa-0000-4000-8000-000000000099";

const ligada: FormaDePagamentoDaConferencia = { situacao: "ligada", tPag: "17", forma: { id: PIX, nome: "Pix" } };
const ligadaAoPadrao: FormaDePagamentoDaConferencia = { situacao: "ligada", tPag: "15", forma: { id: BOLETO, nome: "Boleto" } };
const varias: FormaDePagamentoDaConferencia = { situacao: "varias", quantidade: 2 };
const semTPag: FormaDePagamentoDaConferencia = { situacao: "sem_tpag" };
const semLigacao: FormaDePagamentoDaConferencia = { situacao: "sem_ligacao", tPag: "15" };
const inativa: FormaDePagamentoDaConferencia = { situacao: "forma_inativa", tPag: "03", forma: { id: INATIVA, nome: "Cartão antigo" } };
const NAO_LIGADAS: [string, FormaDePagamentoDaConferencia | null][] = [["varias", varias], ["sem_tpag", semTPag], ["sem_ligacao", semLigacao], ["forma_inativa", inativa], ["ilegível", null]];

/** A TOP: os padrões valem, deixa trocar, cobra a forma e o padrão dela é o Boleto (`padrao: null` = sem padrão de forma). */
const top = ({ padrao = { id: BOLETO, nome: "Boleto" }, ...o }: Partial<Omit<TopDaForma, "padroes">> & { padrao?: { id: string; nome: string } | null } = {}): TopDaForma =>
  ({ aplica: true, podeTrocar: true, formaCobrada: true, ...o, padroes: { natureza: null, centro: null, tipoTitulo: null, formaPagamento: padrao, conta: null } });
const TRAVA = top({ podeTrocar: false });

describe("XML-04 F1 os QUATRO DEGRAUS, cada um isolado", () => {
  it("1 · o OPERADOR vence a nota (R7) — e vence o padrão da TOP que cobra", () => {
    for (const t of [null, top()]) {
      const f = formaDaImportacao({ operador: DINHEIRO, daNota: ligada, top: t });
      expect([f.formaId, f.origem, f.travada, f.texto, f.aviso, f.pergunta]).toEqual([DINHEIRO, "operador", false, null, null, null]);
      expect(f.formaId).not.toBe(PIX);
    }
  });
  it("1 · esvaziar o campo é resposta do operador: a nota (e a TOP) não voltam a preenchê-lo", () => {
    const f = formaDaImportacao({ operador: "", daNota: ligada, top: top() });
    expect([f.formaId, f.origem, f.pergunta]).toEqual(["", "operador", null]);
  });
  it("2 · a NOTA (tPag ligado a uma forma ativa) vence o padrão da TOP que cobra, e diz o código e o rótulo do leiaute", () => {
    const f = formaDaImportacao({ operador: null, daNota: ligada, top: top() });
    expect([f.formaId, f.origem, f.rotulo, f.travada, f.aviso, f.pergunta]).toEqual([PIX, "nota", "Pix", false, null, null]);
    expect(rotuloDoTPag("17"), "premissa: o 17 é do leiaute").toBe("Pix dinâmico");
    expect(f.texto).toBe("Forma de pagamento da nota (código 17 — Pix dinâmico).");
  });
  it("3 · o padrão da TOP SÓ quando a TOP cobra a forma (e os padrões valem)", () => {
    const cobra = formaDaImportacao({ operador: null, daNota: semTPag, top: top() });
    expect([cobra.formaId, cobra.origem, cobra.rotulo, cobra.texto, cobra.pergunta]).toEqual([BOLETO, "top", "Boleto", "Forma de pagamento padrão da TOP desta compra.", null]);
    const casos: [string, TopDaForma | null][] = [
      ["não cobra", top({ formaCobrada: false })], ["os padrões não valem", top({ aplica: false })], ["sem padrão de forma", top({ padrao: null })], ["sem TOP", null]
    ];
    for (const [nome, t] of casos) {
      const f = formaDaImportacao({ operador: null, daNota: semTPag, top: t });
      expect([f.formaId, f.origem, f.texto], nome).toEqual(["", "pergunta", null]);
      expect(f.pergunta, nome).toBe("A nota não diz a forma de pagamento: escolha a forma.");
    }
  });
  it("4 · a PERGUNTA: nem operador, nem nota, nem TOP cobrando ⇒ o campo vazio, com o porquê", () => {
    const f = formaDaImportacao({ operador: null, daNota: varias, top: null });
    expect([f.formaId, f.origem, f.rotulo, f.travada, f.texto, f.aviso]).toEqual(["", "pergunta", null, false, null, null]);
    expect(f.pergunta).toBe("A nota traz 2 formas de pagamento (detPag): escolha a forma.");
  });
});

describe("XML-04 F2 a TRAVA da TOP (não deixa trocar): vence o que difere do padrão dela, e AVISA com as duas", () => {
  it("a nota diz OUTRA forma ⇒ vale a da TOP, travada, com o nome da forma da nota, o tPag com o rótulo e a da TOP", () => {
    const f = formaDaImportacao({ operador: null, daNota: ligada, top: TRAVA });
    expect([f.formaId, f.origem, f.rotulo, f.travada, f.pergunta]).toEqual([BOLETO, "top", "Boleto", true, null]);
    expect(f.aviso).toBe("A nota diz Pix (código 17 — Pix dinâmico), mas a TOP desta compra não deixa trocar a forma de pagamento: vale a dela, Boleto.");
  });
  it("a nota diz a MESMA forma do padrão ⇒ a da nota, travada, sem aviso (o id comparado como o servidor: aparado e sem caixa)", () => {
    const f = formaDaImportacao({ operador: null, daNota: ligadaAoPadrao, top: top({ podeTrocar: false, padrao: { id: ` ${BOLETO.toUpperCase()} `, nome: "Boleto" } }) });
    expect([f.formaId, f.origem, f.travada, f.aviso]).toEqual([BOLETO, "nota", true, null]);
  });
  it("a escolha do operador DIFERENTE do padrão ⇒ a da TOP (salvo trava); sem a trava, a escolha GUARDADA volta (o recálculo não a apagou)", () => {
    const travada = formaDaImportacao({ operador: DINHEIRO, daNota: ligada, top: TRAVA });
    expect([travada.formaId, travada.origem, travada.travada]).toEqual([BOLETO, "top", true]);
    expect(travada.aviso).toBe("A TOP desta compra não deixa trocar a forma de pagamento: vale a dela, Boleto.");
    const outraTop = formaDaImportacao({ operador: DINHEIRO, daNota: ligada, top: top() });
    expect([outraTop.formaId, outraTop.origem, outraTop.travada, outraTop.aviso]).toEqual([DINHEIRO, "operador", false, null]);
  });
  it("o operador escolheu o próprio padrão ⇒ dele, travado (o campo cujo valor é o padrão trava, como na Central)", () => {
    const f = formaDaImportacao({ operador: BOLETO, daNota: ligada, top: TRAVA });
    expect([f.formaId, f.origem, f.travada, f.aviso]).toEqual([BOLETO, "operador", true, null]);
  });
  it("sem nada a vencer: cobrando ⇒ o padrão travado; sem cobrar ⇒ a pergunta, campo livre (o servidor recusa a troca, como na Central)", () => {
    const cobra = formaDaImportacao({ operador: null, daNota: semLigacao, top: TRAVA });
    expect([cobra.formaId, cobra.origem, cobra.travada, cobra.aviso]).toEqual([BOLETO, "top", true, null]);
    const naoCobra = formaDaImportacao({ operador: null, daNota: semLigacao, top: top({ podeTrocar: false, formaCobrada: false }) });
    expect([naoCobra.formaId, naoCobra.origem, naoCobra.travada]).toEqual(["", "pergunta", false]);
  });
  it("a trava só existe com os padrões valendo (aplica): fora disso, nada trava", () => {
    const f = formaDaImportacao({ operador: null, daNota: ligada, top: top({ podeTrocar: false, aplica: false }) });
    expect([f.formaId, f.origem, f.travada, f.aviso]).toEqual([PIX, "nota", false, null]);
  });
});

describe("XML-04 F3 cada SITUAÇÃO da forma da nota (R5, R6): fora da `ligada`, a nota nunca escolhe forma alguma", () => {
  it("R5 · mais de um <detPag> ⇒ nenhuma forma (nunca a primeira): o campo vazio, a quantidade na pergunta", () => {
    const f = formaDaImportacao({ operador: null, daNota: { situacao: "varias", quantidade: 3 }, top: top({ formaCobrada: false }) });
    expect([f.formaId, f.origem]).toEqual(["", "pergunta"]);
    expect(f.pergunta).toBe("A nota traz 3 formas de pagamento (detPag): escolha a forma.");
  });
  it("R6 · o tPag sem ligação ⇒ nenhuma forma; a pergunta diz o código, o rótulo e onde ligar", () => {
    const f = formaDaImportacao({ operador: null, daNota: semLigacao, top: null });
    expect([f.formaId, f.origem]).toEqual(["", "pergunta"]);
    expect(formaDaImportacao({ operador: null, daNota: semLigacao, top: top({ formaCobrada: false }) }).formaId, "nem com a TOP que tem padrão e não cobra").toBe("");
    expect(f.pergunta).toBe("O código 15 (Boleto bancário) da nota não está ligado a uma forma de pagamento da organização: ligue em Configurações › Financeiro › Formas de Pagamento da NF-e, ou escolha a forma.");
    expect(perguntaDaForma({ situacao: "sem_ligacao", tPag: "77" }), "código fora do leiaute: só o código").toBe("O código 77 da nota não está ligado a uma forma de pagamento da organização: ligue em Configurações › Financeiro › Formas de Pagamento da NF-e, ou escolha a forma.");
  });
  it("R6 · a forma INATIVA nunca é escolhida (o id dela vem na resposta e mesmo assim não vale); a pergunta diz qual é", () => {
    const f = formaDaImportacao({ operador: null, daNota: inativa, top: null });
    expect([f.formaId, f.origem]).toEqual(["", "pergunta"]);
    expect(f.formaId).not.toBe(INATIVA);
    expect(formaDaImportacao({ operador: null, daNota: inativa, top: top({ formaCobrada: false }) }).formaId, "nem com a TOP que tem padrão e não cobra").toBe("");
    expect(f.pergunta).toBe("A forma Cartão antigo, ligada ao código 03 (Cartão de crédito) da nota, está inativa: escolha a forma.");
  });
  it("a nota sem <detPag>/tPag e a forma que a tela não leu: a pergunta de cada uma", () => {
    expect(formaDaImportacao({ operador: null, daNota: semTPag, top: null }).pergunta).toBe("A nota não diz a forma de pagamento: escolha a forma.");
    expect(formaDaImportacao({ operador: null, daNota: null, top: null }).pergunta).toBe("A forma de pagamento da nota não pôde ser lida: escolha a forma.");
  });
  it("nenhuma situação não-ligada escolhe forma sem a TOP cobrando — e com a TOP cobrando, a escolhida é a da TOP, nunca a da nota", () => {
    expect(NAO_LIGADAS).toHaveLength(5);
    for (const [nome, daNota] of NAO_LIGADAS) {
      expect(formaDaImportacao({ operador: null, daNota, top: top({ formaCobrada: false }) }).formaId, nome).toBe("");
      expect(formaDaImportacao({ operador: null, daNota, top: top() }).formaId, nome).toBe(BOLETO);
      expect(perguntaDaForma(daNota), nome).not.toBeNull();
    }
  });
});

describe("XML-04 F4 a leitura por PROPRIEDADE PRÓPRIA e a API anterior (skew)", () => {
  const parcelas = { situacao: "sem_duplicatas", origem: "nota" };
  it("sem `financeiro.forma` (ou herdada do protótipo) ⇒ undefined: a forma é a da pessoa, a TOP não entra, nenhum texto", () => {
    expect(lerFormaDaConferencia({ parcelas })).toBeUndefined();
    expect(lerFormaDaConferencia(Object.assign(Object.create({ forma: ligada }) as object, { parcelas }))).toBeUndefined();
    for (const operador of [null, "", DINHEIRO]) {
      const f = formaDaImportacao({ operador, daNota: undefined, top: TRAVA });
      expect([f.formaId, f.declarada, f.travada, f.rotulo, f.texto, f.aviso, f.pergunta], String(operador)).toEqual([operador ?? "", false, false, null, null, null, null]);
    }
  });
  it("cada situação do contrato é lida; fora da forma ⇒ null (a nota não dá forma)", () => {
    for (const forma of [ligada, varias, semTPag, semLigacao, inativa]) expect(lerFormaDaConferencia({ parcelas, forma })).toEqual(forma);
    const estranhas: unknown[] = [null, "ligada", { situacao: "ligada", tPag: "17" }, { situacao: "ligada", tPag: "17", forma: { id: "", nome: "Pix" } },
      { situacao: "forma_inativa", tPag: "03" }, { situacao: "sem_ligacao" }, { situacao: "varias", quantidade: 1 }, { situacao: "varias", quantidade: "2" },
      { situacao: "situacao_futura", tPag: "17", forma: { id: PIX, nome: "Pix" } }];
    for (const forma of estranhas) expect(lerFormaDaConferencia({ parcelas, forma }), JSON.stringify(forma)).toBeNull();
  });
  it("só as chaves do contrato entram na tela", () => {
    expect(lerFormaDaConferencia({ forma: { ...ligada, extra: "x", forma: { id: PIX, nome: "Pix", ativo: false } } })).toEqual(ligada);
  });
});

describe("XML-04 F5 o que a TOP diz, pela régua da Central (o mesmo leitor das regras e os mesmos padrões da 311)", () => {
  const FAMILIA_COMPRA = familiaOperacionalDeDocumentoCompra("compra") ?? "";
  const regras = (extra: Record<string, unknown> = {}) => ({
    contractVersion: 1, formato: "configurado", exigencias: [], condicoesPermitidas: null, geraTitulos: true, exigeFormaPagamento: true, exigeVencimento: false, exigeArmazem: false,
    secao: { provisao: false, documentoTroca: true, semClassificacao: "exigir" },
    padroes: { natureza: null, centro: null, tipoTitulo: null, formaPagamento: { id: BOLETO, nome: "Boleto" }, conta: null },
    localDoProdutoNaLinha: false, regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false },
    ...extra
  });
  const layout = (obrigatorio: boolean, onde: "cabecalho" | "rodape"): EstruturaLayout => {
    const campo = { campo: "forma_pagamento_id", obrigatorio, editavel: true };
    return { versaoSchema: 1, cabecalho: onde === "cabecalho" ? [campo] : [], rodape: onde === "rodape" ? [{ aba: "financeiro", campos: [campo] }] : [], itens: [] };
  };
  it("premissa: a família da compra existe", () => expect(FAMILIA_COMPRA).not.toBe(""));
  it("a TOP que gera título, deixa trocar e exige a forma ⇒ aplica, pode trocar, o padrão e cobrada", () => {
    expect(topDaForma(lerRegras(regras()), { familia: FAMILIA_COMPRA, layout: null })).toEqual({
      aplica: true, podeTrocar: true, formaCobrada: true, padroes: { natureza: null, centro: null, tipoTitulo: null, formaPagamento: { id: BOLETO, nome: "Boleto" }, conta: null }
    });
  });
  it("cobrada = a regra exige OU o layout marca obrigatória (no cabeçalho ou numa aba); nenhum dos dois ⇒ não cobrada", () => {
    const naoExige = lerRegras(regras({ exigeFormaPagamento: false }));
    expect(formaCobradaPelaTop(naoExige, null)).toBe(false);
    expect(formaCobradaPelaTop(naoExige, layout(true, "cabecalho"))).toBe(true);
    expect(formaCobradaPelaTop(naoExige, layout(true, "rodape"))).toBe(true);
    expect(formaCobradaPelaTop(naoExige, layout(false, "cabecalho"))).toBe(false);
    expect(formaCobradaPelaTop(lerRegras(regras()), null)).toBe(true);
    expect(formaCobradaPelaTop(null, null)).toBe(false);
  });
  it("a compra que não gera título ⇒ os padrões não valem; `documentoTroca` falso ⇒ não deixa trocar (a trava)", () => {
    expect(topDaForma(lerRegras(regras({ geraTitulos: false })), { familia: FAMILIA_COMPRA, layout: null })?.aplica).toBe(false);
    const trava = topDaForma(lerRegras(regras({ secao: { provisao: false, documentoTroca: false, semClassificacao: "exigir" } })), { familia: FAMILIA_COMPRA, layout: null });
    expect([trava?.aplica, trava?.podeTrocar]).toEqual([true, false]);
    expect(formaDaImportacao({ operador: null, daNota: ligada, top: trava }).formaId).toBe(BOLETO);
  });
  it("as regras de uma API sem os padrões da 311 ⇒ nada da TOP (nem semeado, nem travado); sem regras ⇒ null", () => {
    const { secao: _s, padroes: _p, ...anterior } = regras();
    const t = topDaForma(lerRegras(anterior), { familia: FAMILIA_COMPRA, layout: null });
    expect([t?.aplica, t?.podeTrocar, t?.padroes]).toEqual([false, true, null]);
    expect(formaDaImportacao({ operador: null, daNota: semTPag, top: t }).origem).toBe("pergunta");
    expect(topDaForma(null, { familia: FAMILIA_COMPRA, layout: null })).toBeNull();
  });
});
