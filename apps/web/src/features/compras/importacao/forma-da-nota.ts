import { rotuloDoTPag, type EstruturaLayout, type FormaDePagamentoDaConferencia } from "@agro/domain";
import type { PadroesFinanceirosDaTop } from "@/features/central/contrato";
import type { RegrasDaCompra } from "../layout-da-central";
import { CAMPO_DO_PADRAO_DA_TOP, mesmoId, padroesDaTopAplicam, planoDaSemeadura, podeTrocarOsPadroes, travadoPelaTop } from "../central/padroes-da-top";

/**
 * A FORMA DE PAGAMENTO NA CONFERÊNCIA DO XML (XML-04, decisão 318) — contas PURAS, sem React e sem rede (o estado da
 * conferência só as chama; o teste de unidade as prova uma a uma). A decisão do dono ("aplicar como a 311"): a forma da
 * tela é RESOLVIDA a cada desenho, nesta precedência —
 *
 *   1. o OPERADOR: a escolha explícita dele nunca é sobrescrita por um recálculo (trocar a TOP depois de escolher não a
 *      apaga: ela fica guardada no estado e volta a valer quando nada a trava);
 *   2. a NOTA: só a `ligada` (o tPag de EXATAMENTE um `<detPag>`, ligado a uma forma ATIVA da organização). Mais de um
 *      `<detPag>`, o tPag sem ligação e a forma inativa NÃO dão forma — nunca "a primeira", nunca a inativa;
 *   3. o padrão da TOP, SÓ quando a TOP cobra a forma (a régua da Central: `formaCobradaPelaTop`) e só quando os padrões
 *      da TOP valem — as funções da Central de Compras, importadas sem cópia: `padroesDaTopAplicam` e o plano da
 *      semeadura (`planoDaSemeadura`: a forma só no campo vazio e só COBRADA);
 *   4. a PERGUNTA: o campo vazio, com o porquê (`perguntaDaForma`). A pergunta não bloqueia por si: a obrigatoriedade
 *      continua a da TOP e do servidor, como antes.
 *
 * A TRAVA DA TOP (`podeTrocarOsPadroes` falso): a TOP que não deixa o documento trocar os padrões vence a forma da nota
 * e a escolha do operador quando elas DIFEREM do padrão dela — o servidor recusaria a troca —, e a tela AVISA com as
 * duas; o campo cujo valor é o padrão fica travado pela MESMA conta da Central (`travadoPelaTop`: aplica ∧ ¬podeTrocar ∧
 * valor = padrão). Sem `financeiro.forma` na conferência (a API anterior), nada disto existe: a forma é a da pessoa, a TOP não
 * é lida e nenhum texto aparece — a tela de antes, byte a byte no corpo.
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const formaLida = (v: unknown): { id: string; nome: string } | null => (ehObjeto(v) && ehTexto(v.id) && v.id.trim() !== "" && ehTexto(v.nome) ? { id: v.id, nome: v.nome } : null);

/**
 * `financeiro.forma` da conferência, por PROPRIEDADE PRÓPRIA: ausente (a API anterior) ⇒ `undefined`; presente e fora
 * da forma (uma situação que esta tela não conhece, um campo faltando) ⇒ `null` — a nota não dá forma (fail-closed).
 */
export function lerFormaDaConferencia(financeiro: unknown): FormaDePagamentoDaConferencia | null | undefined {
  if (!ehObjeto(financeiro) || !Object.hasOwn(financeiro, "forma")) return undefined;
  const f = financeiro.forma;
  if (!ehObjeto(f)) return null;
  const forma = formaLida(f.forma);
  switch (f.situacao) {
    case "ligada": return ehTexto(f.tPag) && forma ? { situacao: "ligada", tPag: f.tPag, forma } : null;
    case "forma_inativa": return ehTexto(f.tPag) && forma ? { situacao: "forma_inativa", tPag: f.tPag, forma } : null;
    case "sem_ligacao": return ehTexto(f.tPag) ? { situacao: "sem_ligacao", tPag: f.tPag } : null;
    case "varias": return typeof f.quantidade === "number" && Number.isInteger(f.quantidade) && f.quantidade > 1 ? { situacao: "varias", quantidade: f.quantidade } : null;
    case "sem_tpag": return { situacao: "sem_tpag" };
    default: return null;
  }
}

/* ═════════════════════════════════════ o que a TOP diz ═════════════════════════════════════ */

/** O que a TOP escolhida diz sobre a forma: se os padrões valem, se o documento pode trocá-los, os padrões e a cobrança. */
export interface TopDaForma { aplica: boolean; podeTrocar: boolean; padroes: PadroesFinanceirosDaTop | null; formaCobrada: boolean }

/** O layout marca a forma de pagamento obrigatória? (o mesmo `obrigatorio` que a Central lê, no cabeçalho ou numa aba) */
export function formaObrigatoriaNoLayout(layout: EstruturaLayout | null): boolean {
  if (!layout) return false;
  const campo = CAMPO_DO_PADRAO_DA_TOP.formaPagamento;
  return [...layout.cabecalho, ...layout.rodape.flatMap((a) => a.campos)].some((c) => c.campo === campo && c.obrigatorio === true);
}

/** A forma é COBRADA: a regra da TOP a exige OU o layout a marca obrigatória — a MESMA régua da Central (`central/estado.ts`). */
export const formaCobradaPelaTop = (regras: RegrasDaCompra | null, layout: EstruturaLayout | null): boolean =>
  regras?.exigeFormaPagamento === true || formaObrigatoriaNoLayout(layout);

/**
 * O que a TOP diz, das regras da operação (`lerRegras`) e do layout efetivo: os padrões valem na CRIAÇÃO da compra que
 * gera título (`padroesDaTopAplicam`, a importação nunca é receber nem edição), a troca segue a seção e o perfil da
 * família (`podeTrocarOsPadroes`). Sem as regras (ainda chegando, sem TOP, erro) ⇒ `null`: a TOP não entra.
 */
export function topDaForma(regras: RegrasDaCompra | null, o: { familia: string; layout: EstruturaLayout | null }): TopDaForma | null {
  if (!regras) return null;
  const lidos = regras.padroesDaTop;
  return {
    aplica: padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos, geraTitulos: regras.geraTitulos }),
    podeTrocar: lidos ? podeTrocarOsPadroes(lidos.secao, o.familia) : true,
    padroes: lidos?.padroes ?? null,
    formaCobrada: formaCobradaPelaTop(regras, o.layout)
  };
}

/* ═════════════════════════════════════ os textos ═════════════════════════════════════ */

/** "15 — Boleto bancário" (o código e o rótulo do leiaute); código fora do leiaute ⇒ só o código. */
const codigoComRotulo = (tPag: string) => { const r = rotuloDoTPag(tPag); return r ? `${tPag} — ${r}` : tPag; };
/** "15 (Boleto bancário)"; código fora do leiaute ⇒ só o código. */
const codigoComRotuloEntreParenteses = (tPag: string) => { const r = rotuloDoTPag(tPag); return r ? `${tPag} (${r})` : tPag; };

/** A pergunta de cada situação em que a nota NÃO dá a forma (`null`: a conferência mandou uma forma que a tela não leu). */
export function perguntaDaForma(daNota: FormaDePagamentoDaConferencia | null): string | null {
  if (daNota === null) return "A forma de pagamento da nota não pôde ser lida: escolha a forma.";
  switch (daNota.situacao) {
    case "varias": return `A nota traz ${daNota.quantidade} formas de pagamento (detPag): escolha a forma.`;
    case "sem_tpag": return "A nota não diz a forma de pagamento: escolha a forma.";
    case "sem_ligacao": return `O código ${codigoComRotuloEntreParenteses(daNota.tPag)} da nota não está ligado a uma forma de pagamento da organização: ligue em Configurações › Financeiro › Formas de Pagamento da NF-e, ou escolha a forma.`;
    case "forma_inativa": return `A forma ${daNota.forma.nome}, ligada ao código ${codigoComRotuloEntreParenteses(daNota.tPag)} da nota, está inativa: escolha a forma.`;
    case "ligada": return null;
  }
}

/* ═════════════════════════════════════ a resolução ═════════════════════════════════════ */

export type OrigemDaForma = "operador" | "nota" | "top" | "pergunta";

export interface FormaNaTela {
  /** O id que vai no corpo (`""` = nenhuma: `forma_pagamento_id: null`). */
  formaId: string;
  origem: OrigemDaForma;
  /** A conferência declara a forma da nota (`financeiro.forma`): sem isso, a tela de antes. */
  declarada: boolean;
  /** O rótulo já conhecido do valor (a forma da nota, o padrão da TOP) — o seletor não pergunta de novo. */
  rotulo: string | null;
  /** A TOP trava o campo (o valor é o padrão dela e ela não deixa trocar). */
  travada: boolean;
  /** De onde veio a forma, quando não foi a pessoa (a nota, o padrão da TOP). */
  texto: string | null;
  /** A TOP venceu a forma da nota ou a escolha da pessoa: as duas, no aviso. */
  aviso: string | null;
  /** O porquê do campo vazio. */
  pergunta: string | null;
}

export interface EntradaDaForma {
  /** A escolha EXPLÍCITA do operador (`""` = ele esvaziou o campo), ou `null` = ele nunca escolheu. */
  operador: string | null;
  /** `financeiro.forma` lida (`lerFormaDaConferencia`): `undefined` = a API anterior. */
  daNota: FormaDePagamentoDaConferencia | null | undefined;
  /** O que a TOP escolhida diz (`topDaForma`); `null` = sem TOP ou as regras ainda não chegaram. */
  top: TopDaForma | null;
}

/** A forma da tela pela precedência operador → nota → TOP (só cobrando) → pergunta, com a trava da TOP. */
export function formaDaImportacao(p: EntradaDaForma): FormaNaTela {
  const base: Omit<FormaNaTela, "formaId" | "origem"> = { declarada: true, rotulo: null, travada: false, texto: null, aviso: null, pergunta: null };
  // A API anterior: só a escolha da pessoa — nada da nota, nada da TOP, nenhum texto (a tela de antes).
  if (p.daNota === undefined) return { ...base, declarada: false, formaId: p.operador ?? "", origem: p.operador !== null ? "operador" : "pergunta" };
  const top = p.top;
  const padrao = top?.aplica ? top.padroes?.formaPagamento ?? null : null;
  /** O padrão que TRAVA (a TOP não deixa trocar), ou `null`. */
  const trava = padrao !== null && top?.podeTrocar === false ? padrao : null;
  /** O campo com este valor fica travado? A conta da Central, sem cópia. */
  const travado = (valor: string) => top !== null && travadoPelaTop({ aplica: top.aplica, podeTrocar: top.podeTrocar, padroes: top.padroes, campo: CAMPO_DO_PADRAO_DA_TOP.formaPagamento, valor });
  const pelaTrava = (t: { id: string; nome: string }, aviso: string): FormaNaTela => ({ ...base, formaId: t.id, origem: "top", rotulo: t.nome, travada: travado(t.id), aviso });
  // 1. o operador (a trava da TOP vence só o que DIFERE do padrão dela; esvaziar não é troca)
  if (p.operador !== null) {
    if (trava && p.operador !== "" && !mesmoId(p.operador, trava.id)) {
      return pelaTrava(trava, `A TOP desta compra não deixa trocar a forma de pagamento: vale a dela, ${trava.nome}.`);
    }
    return { ...base, formaId: p.operador, origem: "operador", travada: travado(p.operador) };
  }
  // 2. a nota: só a forma LIGADA (ativa)
  if (p.daNota !== null && p.daNota.situacao === "ligada") {
    const nota = p.daNota;
    if (trava && !mesmoId(nota.forma.id, trava.id)) {
      return pelaTrava(trava, `A nota diz ${nota.forma.nome} (código ${codigoComRotulo(nota.tPag)}), mas a TOP desta compra não deixa trocar a forma de pagamento: vale a dela, ${trava.nome}.`);
    }
    return { ...base, formaId: nota.forma.id, origem: "nota", rotulo: nota.forma.nome, travada: travado(nota.forma.id), texto: `Forma de pagamento da nota (código ${codigoComRotulo(nota.tPag)}).` };
  }
  // 3. o padrão da TOP, só quando a TOP cobra a forma: o plano da semeadura da Central para o campo vazio
  const semeada = top?.aplica && top.padroes ? planoDaSemeadura(top.padroes, { natureza: "", centro: "", formaPagamento: "", tipoTitulo: null }, { formaCobrada: top.formaCobrada }).forma_pagamento_id : undefined;
  if (padrao !== null && semeada !== undefined && mesmoId(semeada, padrao.id)) {
    return { ...base, formaId: padrao.id, origem: "top", rotulo: padrao.nome, travada: travado(padrao.id), texto: "Forma de pagamento padrão da TOP desta compra." };
  }
  // 4. a pergunta
  return { ...base, formaId: "", origem: "pergunta", pergunta: perguntaDaForma(p.daNota) };
}
