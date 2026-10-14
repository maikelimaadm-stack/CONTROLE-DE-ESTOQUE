import { describe, expect, it } from "vitest";
import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import {
  CAMPOS_QUE_A_PREVIA_LE, LUGARES_DA_SEMEADURA, MOTIVO_EMPRESA_NA_EDICAO, MSG_EDICAO_SEM_MUDANCA, aberturaDaVenda, aceitaLinhaNovaNaEdicao, avisaAntesDeSalvar,
  corpoDaEdicaoDeVenda, idDoItemDeVenda, itensNaEdicaoDeVenda, linhaDoItemDeVenda, mudouAlgo, numerosDaPreviaValem, planoGravadoDaVenda, recalculaPlanoDaCondicao,
  semeiaNaAbertura, situacaoDoAtrasoNaEdicao, topGravadaDaVenda, travasDaLinhaDaVenda, travasDoItemDeVenda,
  type CamposDaVendaNaTela, type EstadoDaVendaNoFormulario
} from "./central-vendas-edicao";
import type { LimitesDaEdicaoDeVenda } from "./central-vendas-edicao-api";

/**
 * EDITAR-03 (decisão 315) — as contas PURAS da edição do documento de venda na Central (`central-vendas-edicao.ts`): a
 * abertura com o GRAVADO e sem semear nada (os cinco lugares da criação, e o sexto declarado a mais), o corpo da PATCH
 * (`{ version, ...só o que mudou }`, os itens completos, os salvos pelo `id`, a REMOÇÃO pela ausência), as travas por
 * item (a parte gerada e o `armazemTravado`, a trava do armazém do motor), a defesa do handler e o aviso do Salvar que
 * confirma. Sem React e sem rede: o formulário só chama estas funções, e o E2E (`editar-03-venda.spec.ts`) prova o elo.
 */

const EMPRESA = "eeeeeeee-0000-4000-8000-000000000001";
const CLIENTE = "c1c1c1c1-0000-4000-8000-000000000001";
const OUTRO_CLIENTE = "c1c1c1c1-0000-4000-8000-000000000002";
const PRODUTO_A = "aaaaaaaa-0000-4000-8000-000000000001";
const PRODUTO_B = "aaaaaaaa-0000-4000-8000-000000000002";
const PRODUTO_C = "aaaaaaaa-0000-4000-8000-000000000003";
const LOCAL_1 = "cccccccc-0000-4000-8000-000000000001";
const LOCAL_2 = "cccccccc-0000-4000-8000-000000000002";
const ITEM_A = "11111111-0000-4000-8000-00000000000a";
const ITEM_B = "11111111-0000-4000-8000-00000000000b";
const TOP = "77777777-0000-4000-8000-000000000001";
const NAT = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CEN = "aaaaaaaa-0000-4000-8000-0000000000f2";
const COND = "aaaaaaaa-0000-4000-8000-0000000000f3";

const planoPadrao = (): Plan => ({ installments: 1, first_due_date: "2026-11-12", mode: "interval", interval_days: 30, has_down_payment: false });
const PLANO_GRAVADO = { installments: 2, first_due_date: "2026-11-01T00:00:00.000Z", mode: "interval", interval_days: 30, has_down_payment: false, is_deductible: true } as const;

/** O documento como o `GET /api/sales/sales/:id` o devolve (as colunas que a edição lê). O id do item vem em MAIÚSCULAS de propósito. */
const documento = (extra: Row = {}): Row => ({
  id: "99999999-0000-4000-8000-000000000001", kind: "sale", code: "0007", status: "open", version: "3", empresa_id: EMPRESA,
  document_date: "2026-10-01", shipping_date: null, due_date: "2026-10-31T00:00:00.000Z", client_id: CLIENTE, transporter_id: null, proprietary_id: null,
  driver_name: null, payment_method_id: null, freight: "0.00", freight_icms: "0.00", other_values: "0.00", discount: "0.00", note: "nota gravada",
  installment_plan: null, categoria_financeira_id: NAT, centro_custo_id: CEN, condicao_pagamento_id: null, parcelas_ajustadas: false,
  tipo_operacao_id: TOP, tipo_operacao: { id: TOP, codigo: "V1", nome: "Venda balcão", versao: 2, codigoBase: "vendas.venda", familiaRotulo: "Venda" },
  items: [
    { id: ITEM_A.toUpperCase(), product_id: PRODUTO_A, warehouse_id: LOCAL_1, quantity: "2.0000", unit_price: "10.000000", discount: "0.00", discount_percent: "0.0000", note: null },
    { id: ITEM_B, product_id: PRODUTO_B, warehouse_id: null, quantity: "1.0000", unit_price: "5.000000", discount: "0.00", discount_percent: "0.0000", note: "obs do item" }
  ],
  ...extra
});

const abrir = (d: Row = documento()): EstadoDaVendaNoFormulario => aberturaDaVenda(d, planoPadrao);
/** O estado da tela que o teste edita (cópia mutável, como a do `useState`). */
type EstadoNaTela = { cabecalho: EstadoDaVendaNoFormulario["cabecalho"]; itens: ItemRow[]; plano: Plan; ajustado: boolean };
const copia = (e: EstadoDaVendaNoFormulario): EstadoNaTela => ({ cabecalho: { ...e.cabecalho }, itens: e.itens.map((l) => ({ ...l })), plano: { ...e.plano }, ajustado: e.ajustado });
const TUDO: CamposDaVendaNaTela = { classificacao: true, condicao: true };
const corpo = (abertura: EstadoDaVendaNoFormulario, atual: EstadoDaVendaNoFormulario, campos: CamposDaVendaNaTela = TUDO) =>
  corpoDaEdicaoDeVenda({ version: "3", abertura, atual, campos });

const LIVRE: LimitesDaEdicaoDeVenda = { somenteArmazemEObservacao: false, itens: [{ id: ITEM_A, armazemTravado: false }, { id: ITEM_B, armazemTravado: false }] };
const PARTE: LimitesDaEdicaoDeVenda = { somenteArmazemEObservacao: true, itens: [{ id: ITEM_A, armazemTravado: true }, { id: ITEM_B, armazemTravado: false }] };

/* ═════════════════════════════════════ A SEMEADURA ═════════════════════════════════════ */

describe("a edição NÃO semeia — os cinco lugares da criação (e o sexto, a empresa padrão)", () => {
  it("os lugares são exatamente os levantados: padrão do layout, padrão de cadastro, local do cabeçalho, cópia do Duplicar, limpeza da condição e a empresa padrão", () => {
    expect([...LUGARES_DA_SEMEADURA]).toEqual(["padraoDoLayout", "padraoDeCadastro", "localDoCabecalho", "copiaDoDuplicar", "limpezaDaCondicao", "empresaPadrao"]);
  });

  it("na CRIAÇÃO todos semeiam (o de sempre); na EDIÇÃO, nenhum", () => {
    expect(LUGARES_DA_SEMEADURA.map((l) => [l, semeiaNaAbertura("criacao", l)])).toEqual(LUGARES_DA_SEMEADURA.map((l) => [l, true]));
    expect(LUGARES_DA_SEMEADURA.map((l) => [l, semeiaNaAbertura("edicao", l)])).toEqual(LUGARES_DA_SEMEADURA.map((l) => [l, false]));
  });
});

/* ═════════════════════════════════════ A ABERTURA ═════════════════════════════════════ */

describe("a abertura: o documento GRAVADO nas chaves do formulário, nenhum padrão", () => {
  it("o cabeçalho é o gravado: datas cortadas no dia, nulos viram vazio, os números como vieram, a classificação e a empresa do documento", () => {
    expect(abrir().cabecalho).toEqual({
      empresa_id: EMPRESA, document_date: "2026-10-01", shipping_date: "", due_date: "2026-10-31", client_id: CLIENTE, transporter_id: "", proprietary_id: "",
      driver_name: "", payment_method_id: "", freight: "0.00", freight_icms: "0.00", other_values: "0.00", discount: "0.00", note: "nota gravada",
      is_deductible: false, installments: false, categoria_financeira_id: NAT, centro_custo_id: CEN, condicao_pagamento_id: ""
    });
  });

  it("os itens na ordem do servidor, com o `id` (em minúsculas) que a PATCH leva, o local e a observação só quando existem", () => {
    expect(abrir().itens).toEqual([
      { id: ITEM_A, product_id: PRODUTO_A, quantity: "2.0000", unit_value: "10.000000", discount: "0.00", discount_percent: "0.0000", generate_stock: true, warehouse_id: LOCAL_1 },
      { id: ITEM_B, product_id: PRODUTO_B, quantity: "1.0000", unit_value: "5.000000", discount: "0.00", discount_percent: "0.0000", generate_stock: true, note: "obs do item" }
    ]);
    expect(abrir().itens.map(idDoItemDeVenda)).toEqual([ITEM_A, ITEM_B]);
    expect(idDoItemDeVenda({ product_id: PRODUTO_C, quantity: "1" }), "a linha nova não tem id").toBe("");
  });

  it("sem plano gravado: o plano padrão da tela, à vista, sem ajuste", () => {
    const e = abrir();
    expect([e.plano, e.cabecalho.installments, e.ajustado]).toEqual([planoPadrao(), false, false]);
  });

  it("plano gravado SEM condição: 'Parcelado', o plano do servidor (datas no dia) e o dedutível lido do plano", () => {
    const e = abrir(documento({ installment_plan: PLANO_GRAVADO }));
    expect(e.cabecalho.installments).toBe(true);
    expect(e.cabecalho.is_deductible).toBe(true);
    expect(e.plano).toEqual({ installments: 2, first_due_date: "2026-11-01", mode: "interval", interval_days: 30, has_down_payment: false });
    expect(e.ajustado).toBe(false);
  });

  it("plano gravado COM condição: não é 'Parcelado' (a condição decide), e o ajuste é o `parcelas_ajustadas` gravado", () => {
    const ajustada = abrir(documento({ installment_plan: PLANO_GRAVADO, condicao_pagamento_id: COND, parcelas_ajustadas: true }));
    expect([ajustada.cabecalho.condicao_pagamento_id, ajustada.cabecalho.installments, ajustada.ajustado]).toEqual([COND, false, true]);
    const derivada = abrir(documento({ installment_plan: PLANO_GRAVADO, condicao_pagamento_id: COND, parcelas_ajustadas: false }));
    expect(derivada.ajustado).toBe(false);
  });

  it("o plano legado torto não vira plano da tela (a abertura cai no padrão, sem 'Parcelado')", () => {
    expect(planoGravadoDaVenda({ installments: "2", first_due_date: "2026-11-01", mode: "interval", interval_days: 30, has_down_payment: false })).toBeNull();
    expect(planoGravadoDaVenda({ installments: 2, first_due_date: "2026-11-01", mode: "semanal", interval_days: 30, has_down_payment: false })).toBeNull();
    expect(planoGravadoDaVenda(null)).toBeNull();
    expect(planoGravadoDaVenda({ installments: 3, first_due_date: "2026-11-01", mode: "fixed_day", interval_days: 0, due_day: 10, has_down_payment: true, down_payment_value: 50, down_payment_date: "2026-10-05T00:00:00Z" }))
      .toEqual({ installments: 3, first_due_date: "2026-11-01", mode: "fixed_day", interval_days: 0, due_day: 10, has_down_payment: true, down_payment_value: "50", down_payment_date: "2026-10-05" });
    expect(abrir(documento({ installment_plan: { installments: "x" } })).cabecalho.installments).toBe(false);
  });

  it("a linha da grade do item salvo é a da cópia do Duplicar: o desconto vazio vira 0", () => {
    expect(linhaDoItemDeVenda({ id: ITEM_A, product_id: PRODUTO_A, quantity: "1", unit_price: "2", discount: null, discount_percent: "" }))
      .toEqual({ id: ITEM_A, product_id: PRODUTO_A, quantity: "1", unit_value: "2", discount: "0", discount_percent: "0", generate_stock: true });
  });

  it("a TOP gravada é o snapshot da versão CONGELADA; sem ele, ou de outra TOP, nenhuma (a abertura não entra em edição)", () => {
    expect(topGravadaDaVenda(documento())).toEqual({ id: TOP, code: "V1", name: "Venda balcão", version: 2, isDefault: false });
    expect(topGravadaDaVenda(documento({ tipo_operacao: null })), "documento legado, sem TOP").toBeNull();
    expect(topGravadaDaVenda(documento({ tipo_operacao: { id: "77777777-0000-4000-8000-000000000009", codigo: "X", nome: "Outra", versao: 1 } })), "o snapshot de outra TOP").toBeNull();
    expect(topGravadaDaVenda(documento({ tipo_operacao: { id: TOP, codigo: "", nome: "Sem código", versao: 1 } }))).toBeNull();
  });
});

/* ═════════════════════════════════════ O CORPO DA PATCH ═════════════════════════════════════ */

describe("o corpo da PATCH: { version, ...só o que mudou }", () => {
  it("nada mudou ⇒ só a versão, e `mudouAlgo` é falso (a tela não manda PATCH nenhuma)", () => {
    const a = abrir();
    const c = corpo(a, copia(a));
    expect(c).toEqual({ version: "3" });
    expect(mudouAlgo(c)).toBe(false);
    expect(MSG_EDICAO_SEM_MUDANCA).toBe("Nada mudou: o documento continua como estava.");
  });

  it("a mesma coisa com outra grafia NÃO é mudança: o número ('0' × '0.00'), o UUID em outra caixa, a quantidade '2' × '2.0000'", () => {
    const a = abrir();
    const t = copia(a);
    t.cabecalho.freight = "0"; t.cabecalho.discount = ""; t.cabecalho.client_id = CLIENTE.toUpperCase();
    t.itens[0]!.quantity = "2"; t.itens[0]!.unit_value = "10"; t.itens[0]!.warehouse_id = LOCAL_1.toUpperCase();
    expect(corpo(a, t)).toEqual({ version: "3" });
  });

  it("a observação muda ⇒ só ela; apagá-la manda `null` (limpa, §15.2)", () => {
    const a = abrir();
    const t = copia(a); t.cabecalho.note = "nova nota";
    expect(corpo(a, t)).toEqual({ version: "3", note: "nova nota" });
    t.cabecalho.note = "";
    expect(corpo(a, t)).toEqual({ version: "3", note: null });
  });

  it("vários campos do cabeçalho: cada um com a forma do corpo do POST (vazio = null onde o POST manda null; número como string)", () => {
    const a = abrir();
    const t = copia(a);
    t.cabecalho.client_id = OUTRO_CLIENTE; t.cabecalho.freight = "12.5"; t.cabecalho.due_date = ""; t.cabecalho.driver_name = "João";
    expect(corpo(a, t)).toEqual({ version: "3", client_id: OUTRO_CLIENTE, freight: "12.5", due_date: null, driver_name: "João" });
  });

  it("empresa e TOP NUNCA vão (a PATCH as recusa com 422 próprio): trocar a empresa no estado não muda o corpo", () => {
    const a = abrir();
    const t = copia(a); t.cabecalho.empresa_id = "eeeeeeee-0000-4000-8000-000000000002";
    const c = corpo(a, t);
    expect(c).toEqual({ version: "3" });
    expect(Object.keys(c)).not.toContain("empresa_id");
    expect(Object.keys(c)).not.toContain("tipo_operacao_id");
    expect(MOTIVO_EMPRESA_NA_EDICAO).toBe("A empresa não muda na edição do documento.");
  });

  it("natureza, centro e condição: vazios vão `null`; sem a capacidade na tela, nem existem no corpo", () => {
    const a = abrir();
    const t = copia(a); t.cabecalho.categoria_financeira_id = ""; t.cabecalho.centro_custo_id = "";
    expect(corpo(a, t)).toEqual({ version: "3", categoria_financeira_id: null, centro_custo_id: null });
    expect(corpo(a, t, { classificacao: false, condicao: true }), "sem a classificação na tela: o par não vai").toEqual({ version: "3" });
    const comCondicao = copia(a); comCondicao.cabecalho.condicao_pagamento_id = COND;
    expect(corpo(a, comCondicao)).toEqual({ version: "3", condicao_pagamento_id: COND });
    expect(corpo(a, comCondicao, { classificacao: true, condicao: false }), "sem a condição na tela: ela não vai").toEqual({ version: "3" });
  });

  it("o plano: 'Parcelado' manda o plano SÓ com as chaves do contrato (chave a mais seria 422); o mesmo plano com outra grafia não é mudança", () => {
    const a = abrir();
    const t = copia(a); t.cabecalho.installments = true;
    t.plano = { ...planoPadrao(), ...({ extra: "fora do contrato" } as unknown as Partial<Plan>) };
    expect(corpo(a, t)).toEqual({ version: "3", installment_plan: { installments: 1, first_due_date: "2026-11-12", mode: "interval", interval_days: 30, has_down_payment: false } });

    const comPlano = abrir(documento({ installment_plan: { ...PLANO_GRAVADO, has_down_payment: true, down_payment_value: "10.00", down_payment_date: "2026-10-02" } }));
    const mesmo = copia(comPlano); mesmo.plano = { ...mesmo.plano, down_payment_value: "10" };
    expect(corpo(comPlano, mesmo), "a entrada 10 × 10.00 é a mesma").toEqual({ version: "3" });
    const avista = copia(comPlano); avista.cabecalho.installments = false;
    expect(corpo(comPlano, avista), "voltar à vista limpa o plano").toEqual({ version: "3", installment_plan: null });
  });

  it("a condição sem ajuste manda o plano `null` (o servidor deriva); com ajuste, o plano do operador", () => {
    const a = abrir(documento({ installment_plan: PLANO_GRAVADO }));
    const t = copia(a); t.cabecalho.condicao_pagamento_id = COND;
    expect(corpo(a, t)).toEqual({ version: "3", condicao_pagamento_id: COND, installment_plan: null });
    t.ajustado = true; t.plano = { ...planoPadrao(), installments: 4 };
    expect(corpo(a, t)).toEqual({ version: "3", condicao_pagamento_id: COND, installment_plan: { ...planoPadrao(), installments: 4 } });
  });

  it("um item muda ⇒ a lista COMPLETA, na ordem da grade: o salvo com o `id` e só o campo que mudou; o outro só com o `id`", () => {
    const a = abrir();
    const t = copia(a); t.itens[0]!.quantity = "3";
    const c = corpo(a, t);
    expect(c).toEqual({ version: "3", items: [{ id: ITEM_A, quantity: "3" }, { id: ITEM_B }] });
    expect(mudouAlgo(c)).toBe(true);
  });

  it("trocar o local de um item: `warehouse_id` no item; tirar o local: `null`", () => {
    const a = abrir();
    const t = copia(a); t.itens[1]!.warehouse_id = LOCAL_2;
    expect(corpo(a, t)).toEqual({ version: "3", items: [{ id: ITEM_A }, { id: ITEM_B, warehouse_id: LOCAL_2 }] });
    const sem = copia(a); sem.itens[0]!.warehouse_id = "";
    expect(corpo(a, sem)).toEqual({ version: "3", items: [{ id: ITEM_A, warehouse_id: null }, { id: ITEM_B }] });
  });

  it("a observação do item (que a grade não mostra) também é campo do item: apagar manda `null`", () => {
    const a = abrir();
    const t = copia(a); t.itens[1]!["note"] = "";
    expect(corpo(a, t)).toEqual({ version: "3", items: [{ id: ITEM_A }, { id: ITEM_B, note: null }] });
  });

  it("A VENDA REMOVE ITEM: o salvo AUSENTE da lista sai (a PATCH o apaga pela ausência)", () => {
    const a = abrir();
    const t = copia(a); t.itens = [t.itens[0]!];
    expect(corpo(a, t)).toEqual({ version: "3", items: [{ id: ITEM_A }] });
    const nenhum = copia(a); nenhum.itens = [];
    expect(corpo(a, nenhum), "sem itens: a lista vazia vai (quem recusa é o servidor, pela regra da TOP)").toEqual({ version: "3", items: [] });
  });

  it("o item NOVO vai sem `id`, na forma do item do POST (produto, local, quantidade, valor, descontos, observação)", () => {
    const a = abrir();
    const t = copia(a); t.itens.push({ product_id: PRODUTO_C, quantity: "4", unit_value: "2.5" });
    expect(corpo(a, t)).toEqual({ version: "3", items: [
      { id: ITEM_A }, { id: ITEM_B },
      { product_id: PRODUTO_C, warehouse_id: null, quantity: "4", unit_price: "2.5", discount: "0", discount_percent: "0", note: null }
    ] });
  });

  it("a ordem trocada é mudança (a lista leva a ordem da grade); o mesmo `id` duas vezes: a segunda é item NOVO", () => {
    const a = abrir();
    const t = copia(a); t.itens = [t.itens[1]!, t.itens[0]!];
    expect(corpo(a, t)).toEqual({ version: "3", items: [{ id: ITEM_B }, { id: ITEM_A }] });
    const dup = copia(a); dup.itens = [dup.itens[0]!, { ...dup.itens[0]! }, dup.itens[1]!];
    expect(corpo(a, dup)).toEqual({ version: "3", items: [
      { id: ITEM_A },
      { product_id: PRODUTO_A, warehouse_id: LOCAL_1, quantity: "2.0000", unit_price: "10.000000", discount: "0.00", discount_percent: "0.0000", note: null },
      { id: ITEM_B }
    ] });
  });

  it("o cabeçalho e os itens juntos: as duas mudanças, e nada além delas", () => {
    const a = abrir();
    const t = copia(a); t.cabecalho.note = "x"; t.itens = [t.itens[0]!]; t.itens[0]!.discount = "1";
    expect(corpo(a, t)).toEqual({ version: "3", note: "x", items: [{ id: ITEM_A, discount: "1" }] });
  });
});

/* ═════════════════════════════════════ AS TRAVAS E A REMOÇÃO ═════════════════════════════════════ */

describe("as travas por item, pelos limites do /edicao (o armazém incluído)", () => {
  const [a, b] = abrir().itens as [ItemRow, ItemRow];
  const novo: ItemRow = { product_id: PRODUTO_C, quantity: "1" };

  it("venda livre: o item salvo NÃO é fixo (a venda remove item) e nada trava; o item novo, nada", () => {
    expect(travasDoItemDeVenda(LIVRE, a)).toEqual({});
    expect(travasDoItemDeVenda(LIVRE, b)).toEqual({});
    expect(travasDoItemDeVenda(LIVRE, novo)).toEqual({});
    expect(aceitaLinhaNovaNaEdicao(LIVRE)).toBe(true);
  });

  it("a PARTE GERADA: o item salvo fixo, com produto, quantidade, unitário e desconto travados; sem linha nova", () => {
    expect(travasDoItemDeVenda(PARTE, b)).toEqual({ fixa: true, produto: true, quantidade: true, unitario: true, desconto: true });
    expect(aceitaLinhaNovaNaEdicao(PARTE)).toBe(false);
  });

  it("`armazemTravado` ⇒ a trava do ARMAZÉM do motor (`armazem: true`), SEM motivo (o /edicao só manda o booleano)", () => {
    const t = travasDoItemDeVenda(PARTE, a);
    expect(t).toEqual({ fixa: true, produto: true, quantidade: true, unitario: true, desconto: true, armazem: true });
    expect(t.motivos, "nenhum texto escrito na tela: o motivo é o 422 do servidor").toBeUndefined();
    expect(travasDoItemDeVenda(PARTE, b).armazem, "o item que não controla estoque troca o local").toBeUndefined();
  });

  it("o armazém travado fora da parte (o servidor manda): só o armazém trava", () => {
    const limites: LimitesDaEdicaoDeVenda = { somenteArmazemEObservacao: false, itens: [{ id: ITEM_A, armazemTravado: true }] };
    expect(travasDoItemDeVenda(limites, a)).toEqual({ armazem: true });
  });

  it("fail-closed: item salvo que os limites não citam — na parte, tudo travado, o local inclusive; fora dela, nada", () => {
    const semCitar: LimitesDaEdicaoDeVenda = { somenteArmazemEObservacao: true, itens: [] };
    expect(travasDoItemDeVenda(semCitar, a)).toEqual({ fixa: true, produto: true, quantidade: true, unitario: true, desconto: true, armazem: true });
    expect(travasDoItemDeVenda({ somenteArmazemEObservacao: false, itens: [] }, a)).toEqual({});
  });

  it("a função que a GRADE recebe dá as mesmas travas, linha a linha", () => {
    const f = travasDaLinhaDaVenda(PARTE);
    expect([f(a), f(b), f(novo)]).toEqual([travasDoItemDeVenda(PARTE, a), travasDoItemDeVenda(PARTE, b), {}]);
  });
});

describe("a defesa do handler: o que a PATCH recusa nos itens volta ao anterior", () => {
  const antes = abrir().itens.map((l) => ({ ...l }));

  it("venda livre: o item salvo que sumiu SAI; o novo entra", () => {
    const novo: ItemRow = { product_id: PRODUTO_C, quantity: "1" };
    expect(itensNaEdicaoDeVenda(antes, [antes[0]!, novo], LIVRE)).toEqual([antes[0], novo]);
  });

  it("parte gerada: remover um item salvo ⇒ a lista anterior, inteira (a parte não remove)", () => {
    expect(itensNaEdicaoDeVenda(antes, [antes[1]!], PARTE)).toEqual(antes);
  });

  it("parte gerada: item novo ⇒ fora (a parte não acrescenta)", () => {
    expect(itensNaEdicaoDeVenda(antes, [...antes, { product_id: PRODUTO_C, quantity: "1" }], PARTE)).toEqual(antes);
  });

  it("parte gerada: o campo travado volta ao valor anterior (produto, quantidade, unitário, desconto e o ARMAZÉM travado); o local livre troca", () => {
    const mexidos = [
      { ...antes[0]!, product_id: PRODUTO_C, quantity: "9", unit_value: "1", discount: "3", discount_percent: "5", warehouse_id: LOCAL_2 },
      { ...antes[1]!, warehouse_id: LOCAL_2 }
    ];
    expect(itensNaEdicaoDeVenda(antes, mexidos, PARTE)).toEqual([antes[0], { ...antes[1]!, warehouse_id: LOCAL_2 }]);
  });

  it("o mesmo `id` duas vezes (o Duplicar de um item salvo): a cópia é item NOVO, sem `id` — e na parte, fora", () => {
    const { id: _id, ...semId } = antes[0]!;
    expect(itensNaEdicaoDeVenda(antes, [antes[0]!, { ...antes[0]! }, antes[1]!], LIVRE)).toEqual([antes[0], semId, antes[1]]);
    expect(itensNaEdicaoDeVenda(antes, [antes[0]!, { ...antes[0]! }, antes[1]!], PARTE)).toEqual(antes);
  });

  it("fora da parte, campo livre muda (quantidade, produto, local)", () => {
    const mexido = { ...antes[0]!, quantity: "7", product_id: PRODUTO_C, warehouse_id: LOCAL_2 };
    expect(itensNaEdicaoDeVenda(antes, [mexido, antes[1]!], LIVRE)).toEqual([mexido, antes[1]]);
  });
});

/* ═════════════════════════════════════ O AVISO DO SALVAR QUE CONFIRMA ═════════════════════════════════════ */

describe("o aviso: a PATCH desta venda CONFIRMA — o Salvar avisa antes (A0, 'avisar_antes')", () => {
  const confirma = { confirmacaoAutomatica: true, aceitaSemItens: false };
  const naoConfirma = { confirmacaoAutomatica: false, aceitaSemItens: false };
  const comMudanca = { version: "3", note: "x" };

  it("as QUATRO juntas: edição ∧ venda ∧ confirmação automática da versão congelada ∧ a PATCH muda alguma coisa", () => {
    expect(avisaAntesDeSalvar({ modo: "edicao", variante: "sale", regrasGerais: confirma, corpo: comMudanca })).toBe(true);
  });

  it("faltando qualquer uma, não avisa: criação, orçamento, pedido, Confirmação Manual, nada mudou", () => {
    expect(avisaAntesDeSalvar({ modo: "criacao", variante: "sale", regrasGerais: confirma, corpo: comMudanca })).toBe(false);
    expect(avisaAntesDeSalvar({ modo: "edicao", variante: "budget", regrasGerais: confirma, corpo: comMudanca })).toBe(false);
    expect(avisaAntesDeSalvar({ modo: "edicao", variante: "order", regrasGerais: confirma, corpo: comMudanca })).toBe(false);
    expect(avisaAntesDeSalvar({ modo: "edicao", variante: "sale", regrasGerais: naoConfirma, corpo: comMudanca })).toBe(false);
    expect(avisaAntesDeSalvar({ modo: "edicao", variante: "sale", regrasGerais: confirma, corpo: { version: "3" } })).toBe(false);
  });

  it("os NÚMEROS da prévia (da venda GRAVADA) só valem quando a PATCH não toca o que ela lê", () => {
    expect(numerosDaPreviaValem({ version: "3", note: "x" })).toBe(true);
    expect(numerosDaPreviaValem({ version: "3", driver_name: "João", client_id: OUTRO_CLIENTE })).toBe(true);
    for (const campo of CAMPOS_QUE_A_PREVIA_LE) expect(numerosDaPreviaValem({ version: "3", [campo]: null }), campo).toBe(false);
    expect([...CAMPOS_QUE_A_PREVIA_LE].sort()).toEqual(["categoria_financeira_id", "centro_custo_id", "condicao_pagamento_id", "discount", "document_date", "due_date",
      "freight", "freight_icms", "installment_plan", "items", "other_values", "payment_method_id"]);
  });
});

/* ═════════════════════════════════════ O PLANO DA CONDIÇÃO E O ATRASO ═════════════════════════════════════ */

describe("o plano da condição é recalculado na tela só quando a PATCH também o refaria", () => {
  const comCondicao = abrir(documento({ condicao_pagamento_id: COND, installment_plan: PLANO_GRAVADO }));

  it("criação: sempre (o de sempre)", () => {
    expect(recalculaPlanoDaCondicao("criacao", null, comCondicao)).toBe(true);
    expect(recalculaPlanoDaCondicao("criacao", comCondicao, copia(comCondicao))).toBe(true);
  });

  it("edição sem mudar condição, data nem total: NÃO (o plano GRAVADO fica)", () => {
    const t = copia(comCondicao); t.cabecalho.note = "outra";
    expect(recalculaPlanoDaCondicao("edicao", comCondicao, t)).toBe(false);
    const mesmaCaixa = copia(comCondicao); mesmaCaixa.cabecalho.condicao_pagamento_id = COND.toUpperCase();
    expect(recalculaPlanoDaCondicao("edicao", comCondicao, mesmaCaixa), "o mesmo UUID em outra caixa").toBe(false);
  });

  it("edição que muda a condição, a data do documento ou o total: SIM", () => {
    const cond = copia(comCondicao); cond.cabecalho.condicao_pagamento_id = "aaaaaaaa-0000-4000-8000-0000000000f9";
    const dataNova = copia(comCondicao); dataNova.cabecalho.document_date = "2026-10-02";
    const total = copia(comCondicao); total.itens[0]!.quantity = "5";
    const frete = copia(comCondicao); frete.cabecalho.freight = "1";
    expect([cond, dataNova, total, frete].map((t) => recalculaPlanoDaCondicao("edicao", comCondicao, t))).toEqual([true, true, true, true]);
  });
});

describe("a faixa do cliente em atraso na edição: só o 'avisa', e só com o cliente GRAVADO", () => {
  it("com o cliente gravado: 'avisa' aparece; 'bloqueia' não (a PATCH aceita); sem situação, nada", () => {
    expect(situacaoDoAtrasoNaEdicao({ politica: "avisa", titulos: 2 }, CLIENTE, CLIENTE.toUpperCase())).toEqual({ politica: "avisa", titulos: 2 });
    expect(situacaoDoAtrasoNaEdicao({ politica: "bloqueia" }, CLIENTE, CLIENTE)).toBeNull();
    expect(situacaoDoAtrasoNaEdicao(null, CLIENTE, CLIENTE)).toBeNull();
  });

  it("com o cliente TROCADO: nada (quem confere é o 422 da PATCH)", () => {
    expect(situacaoDoAtrasoNaEdicao({ politica: "avisa" }, CLIENTE, OUTRO_CLIENTE)).toBeNull();
  });
});
