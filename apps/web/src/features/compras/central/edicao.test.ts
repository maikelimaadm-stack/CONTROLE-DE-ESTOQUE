import { describe, expect, it } from "vitest";
import type { ItemRow, Plan, Row } from "@/features/docs/shared";
import {
  DICA_EDITAR_CANCELADO, DICA_EDITAR_CONFIRMADA, DICA_EDITAR_PEDIDO_CONVERTIDO, DICA_EDITAR_PEDIDO_FINALIZADO, aberturaDoDocumento, acaoEditar,
  MOTIVO_EMPRESA_NA_EDICAO, campoTravadoNaEdicao, corpoDaEdicao, dicaDaIdentidadeNaEdicao, dicaDoEditar, itensNaEdicao, motivoDaTravaNaEdicao, mudouAlgo,
  travasDaLinhaNaTela, travasDoItem, type EstadoDaEdicao
} from "./edicao";
import { MSG_DOCUMENTO_MUDOU_NA_EDICAO, conflitoDaEdicao, edicaoIndisponivel, lerEdicao, type LimitesDaEdicaoDeCompra } from "./edicao-api";
import { lerPadroesDaTop, padroesDaTopAplicam } from "./padroes-da-top";
import { maximoDaQuantidade } from "../../central/contrato";

/**
 * EDITAR-02 (decisão 313) — as contas PURAS da edição do pedido de compra e da compra na Central: a ação "Editar" na
 * consulta (escondida sem a capacidade, desabilitada com o motivo), a abertura sem semeadura (311), o corpo da PATCH (só o
 * que mudou; itens completos, os salvos pelo `id`), as travas (P1: item salvo não sai) e o conflito de versão (a oferta
 * de recarregar). A forma do servidor (`GET /edicao`) é conferida pelo leitor do adaptador.
 */

const EMPRESA = "eeeeeeee-0000-4000-8000-000000000001";
const FORNECEDOR = "ffffffff-0000-4000-8000-000000000001";
const OUTRO_FORNECEDOR = "ffffffff-0000-4000-8000-000000000002";
const TRANSPORTADORA = "dddddddd-0000-4000-8000-000000000001";
const PRODUTO = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTRO_PRODUTO = "aaaaaaaa-0000-4000-8000-000000000002";
const LOCAL = "cccccccc-0000-4000-8000-000000000001";
const ITEM_A = "11111111-0000-4000-8000-00000000000a";
const ITEM_B = "11111111-0000-4000-8000-00000000000b";
const NAT = "aaaaaaaa-0000-4000-8000-0000000000f1";
const CEN = "aaaaaaaa-0000-4000-8000-0000000000f2";

const planoPadrao = (): Plan => ({ installments: 1, first_due_date: "2026-10-12", mode: "interval", interval_days: 30, has_down_payment: false });

/** O documento como o `GET :id` o devolve (as colunas que a edição lê). */
const documento = (extra: Row = {}): Row => ({
  id: "99999999-0000-4000-8000-000000000001", codigo: "C-7", situacao: "aberto", empresa_id: EMPRESA, fornecedor_id: FORNECEDOR,
  transportadora_id: null, tipo_operacao_id: "77777777-0000-4000-8000-000000000001", data_documento: "2026-10-01", data_entrada: null,
  data_vencimento: null, numero_nota: null, serie_nota: null, categoria_financeira_id: null, centro_custo_id: null,
  condicao_pagamento_id: null, forma_pagamento_id: null, plano_parcelas: null, parcelas_ajustadas: false,
  frete: "0.00", outras_despesas: "0.00", desconto: "0.00", observacao: null,
  itens: [
    { id: ITEM_A, produto_id: PRODUTO, armazem_id: LOCAL, quantidade: "10.0000", valor_unitario: "5.500000", desconto: "0.00", desconto_percentual: "0.0000", lote: null, validade: null },
    { id: ITEM_B, produto_id: OUTRO_PRODUTO, armazem_id: null, quantidade: "2.0000", valor_unitario: "1.000000", desconto: "0.00", desconto_percentual: "0.0000", lote: "L1", validade: "2027-01-31" }
  ],
  ...extra
});

const abrir = (d: Row = documento()): EstadoDaEdicao => aberturaDoDocumento(d, planoPadrao);
/** O estado da tela que o teste edita (a lista de itens mutável, como a do `useState`). */
type EstadoNaTela = Omit<EstadoDaEdicao, "itens"> & { itens: ItemRow[] };
const copia = (e: EstadoDaEdicao): EstadoNaTela => ({ cabecalho: { ...e.cabecalho }, itens: e.itens.map((l) => ({ ...l })), ajustarParcelas: e.ajustarParcelas, plano: { ...e.plano } });
const corpo = (abertura: EstadoDaEdicao, atual: EstadoDaEdicao, ehCompra = true) => corpoDaEdicao({ version: "4", ehCompra, abertura, atual });

const SEM_LIMITES: LimitesDaEdicaoDeCompra = { campos: {}, itemNovo: null, itens: [] };

describe("a ação Editar na consulta (escondida sem a capacidade; desabilitada com o motivo)", () => {
  const tudo = () => true;
  const base = { perm: "compras", carregado: true, ehPedido: false, comprasGeradas: null, recusaDoServidor: null };

  it("sem `<recurso>.edit` a ação NÃO aparece; sem `.view` também não (AND, as MESMAS da PATCH)", () => {
    expect(acaoEditar({ ...base, situacao: "aberto", can: (p) => p !== "compras.edit" })).toEqual({ visivel: false, dicaDesabilitada: null });
    expect(acaoEditar({ ...base, situacao: "aberto", can: (p) => p !== "compras.view" })).toEqual({ visivel: false, dicaDesabilitada: null });
    expect(acaoEditar({ ...base, situacao: "aberto", can: tudo, carregado: false }).visivel).toBe(false);
  });

  it("compra aberta: habilitada", () => {
    expect(acaoEditar({ ...base, situacao: "aberto", can: tudo })).toEqual({ visivel: true, dicaDesabilitada: null });
  });

  it("confirmada: desabilitada, e o motivo aponta o cancelamento com estorno", () => {
    const a = acaoEditar({ ...base, situacao: "confirmado", can: tudo });
    expect(a).toEqual({ visivel: true, dicaDesabilitada: DICA_EDITAR_CONFIRMADA });
    expect(DICA_EDITAR_CONFIRMADA).toMatch(/cancele a compra \(o cancelamento estorna o estoque e as contas\)/);
  });

  it("cancelado (compra e pedido): desabilitada, nada a editar", () => {
    expect(acaoEditar({ ...base, situacao: "cancelado", can: tudo }).dicaDesabilitada).toBe(DICA_EDITAR_CANCELADO);
    expect(acaoEditar({ ...base, perm: "pedidos_compra", ehPedido: true, situacao: "cancelado", can: tudo }).dicaDesabilitada).toBe(DICA_EDITAR_CANCELADO);
  });

  it("pedido aberto com compra viva: desabilitada, e o motivo aponta a compra pelo código (as canceladas não contam)", () => {
    const comprasGeradas = [{ id: "c1", codigo: "C-1", situacao: "cancelado" }, { id: "c2", codigo: "C-2", situacao: "aberto" }, { id: "c3", codigo: "C-3", situacao: "confirmado" }];
    const a = acaoEditar({ ...base, perm: "pedidos_compra", ehPedido: true, situacao: "aberto", comprasGeradas, can: tudo });
    expect(a.visivel).toBe(true);
    expect(a.dicaDesabilitada).toMatch(/as compras C-2, C-3:/);
    expect(dicaDoEditar({ situacao: "aberto", ehPedido: true, comprasGeradas: [comprasGeradas[1]!] })).toMatch(/^Este pedido já gerou a compra C-2:/);
    expect(a.dicaDesabilitada).not.toMatch(/C-1/);
    // só compras canceladas: o pedido aberto edita (o fornecedor fica com o servidor, D4)
    expect(dicaDoEditar({ situacao: "aberto", ehPedido: true, comprasGeradas: [comprasGeradas[0]!] })).toBeNull();
  });

  it("pedido finalizado e convertido: desabilitada com a recusa própria de cada um (a situação antes da compra viva)", () => {
    const viva = [{ id: "c2", codigo: "C-2", situacao: "aberto" }];
    expect(dicaDoEditar({ situacao: "finalizado", ehPedido: true, comprasGeradas: viva })).toBe(DICA_EDITAR_PEDIDO_FINALIZADO);
    expect(dicaDoEditar({ situacao: "convertido", ehPedido: true, comprasGeradas: viva })).toBe(DICA_EDITAR_PEDIDO_CONVERTIDO);
  });

  it("situação desconhecida: desabilitada (fail-closed)", () => {
    expect(dicaDoEditar({ situacao: "em_revisao", ehPedido: false, comprasGeradas: null })).not.toBeNull();
  });

  it("a recusa do `/edicao` (o aprovado, P2) desabilita o que a consulta achava editável — e não troca o motivo da situação", () => {
    expect(acaoEditar({ ...base, situacao: "aberto", can: tudo, recusaDoServidor: "Aprovada: não se edita." }).dicaDesabilitada).toBe("Aprovada: não se edita.");
    expect(acaoEditar({ ...base, situacao: "confirmado", can: tudo, recusaDoServidor: "outra" }).dicaDesabilitada).toBe(DICA_EDITAR_CONFIRMADA);
  });
});

describe("a abertura da edição: o documento GRAVADO, sem semeadura (decisão 311 item 2: só na criação)", () => {
  it("os padrões financeiros da TOP NUNCA valem na edição — os mesmos dados que valem na criação", () => {
    const lidos = lerPadroesDaTop({
      secao: { provisao: true, documentoTroca: false, semClassificacao: "exigir" },
      padroes: { natureza: { id: NAT, codigo: "3.1", nome: "Insumos" }, centro: { id: CEN, codigo: "1.2", nome: "Lavoura" }, tipoTitulo: null, formaPagamento: null, conta: null }
    });
    expect(lidos).not.toBeNull();
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: true, lidos, geraTitulos: true })).toBe(true);
    expect(padroesDaTopAplicam({ modo: "edicao", ehCompra: true, lidos, geraTitulos: true })).toBe(false);
    expect(padroesDaTopAplicam({ modo: "criacao", ehCompra: false, lidos, geraTitulos: null })).toBe(true);
    expect(padroesDaTopAplicam({ modo: "edicao", ehCompra: false, lidos, geraTitulos: null })).toBe(false);
  });

  it("natureza e centro gravados nulos (o par veio da TOP) ficam vazios, e o corpo intocado NÃO os leva", () => {
    const a = abrir();
    expect(a.cabecalho.categoria_financeira_id).toBe("");
    expect(a.cabecalho.centro_custo_id).toBe("");
    expect(a.cabecalho.forma_pagamento_id).toBe("");
    const c = corpo(a, copia(a));
    expect(c).toEqual({ version: "4" });
    expect(mudouAlgo(c)).toBe(false);
  });

  it("os itens salvos com o `id` (a chave da PATCH), nas chaves da grade; datas em ISO curto", () => {
    const a = abrir(documento({ data_documento: "2026-10-01T00:00:00.000Z" }));
    expect(a.cabecalho.data_documento).toBe("2026-10-01");
    expect(a.itens.map((l) => l["id"])).toEqual([ITEM_A, ITEM_B]);
    expect(a.itens[1]).toMatchObject({ product_id: OUTRO_PRODUTO, warehouse_id: "", quantity: "2.0000", unit_value: "1.000000", provider_lot: "L1", expiration_date: "2027-01-31" });
  });

  it("o plano é do operador quando gravado ajustado sobre a condição (ou sem condição); o da condição não", () => {
    const ajustado = { installments: 3, first_due_date: "2026-11-01", mode: "interval", interval_days: 30, has_down_payment: false };
    expect(abrir(documento({ plano_parcelas: ajustado, parcelas_ajustadas: true, condicao_pagamento_id: "88888888-0000-4000-8000-000000000001" })).ajustarParcelas).toBe(true);
    expect(abrir(documento({ plano_parcelas: ajustado, parcelas_ajustadas: false, condicao_pagamento_id: null })).ajustarParcelas).toBe(true);
    const daCondicao = abrir(documento({ plano_parcelas: ajustado, parcelas_ajustadas: false, condicao_pagamento_id: "88888888-0000-4000-8000-000000000001" }));
    expect(daCondicao.ajustarParcelas).toBe(false);
    expect(daCondicao.plano).toEqual(planoPadrao());
  });
});

describe("o corpo da PATCH: { version, ...só o que mudou }", () => {
  it("o mesmo número com outra grafia e o mesmo UUID em outra caixa NÃO são mudança", () => {
    const a = abrir();
    const b = copia(a);
    b.cabecalho.frete = "0"; b.cabecalho.fornecedor_id = FORNECEDOR.toUpperCase();
    b.itens[0] = { ...b.itens[0]!, quantity: "10", unit_value: "5.5" };
    expect(corpo(a, b)).toEqual({ version: "4" });
  });

  it("cabeçalho: só o campo alterado; vazio vai `null`; frete vazio vai \"0\"; a empresa nunca vai", () => {
    const a = abrir(documento({ transportadora_id: TRANSPORTADORA, frete: "12.50", observacao: "antes" }));
    const b = copia(a);
    b.cabecalho.observacao = "depois"; b.cabecalho.transportadora_id = ""; b.cabecalho.frete = ""; b.cabecalho.empresa_id = "outra";
    b.cabecalho.fornecedor_id = OUTRO_FORNECEDOR;
    expect(corpo(a, b)).toEqual({ version: "4", observacao: "depois", transportadora_id: null, frete: "0", fornecedor_id: OUTRO_FORNECEDOR });
  });

  it("no pedido, nota, série e data de entrada nunca vão (são da compra)", () => {
    const a = abrir();
    const b = copia(a);
    b.cabecalho.numero_nota = "123"; b.cabecalho.data_entrada = "2026-10-02";
    expect(corpo(a, b, false)).toEqual({ version: "4" });
    expect(corpo(a, b, true)).toEqual({ version: "4", numero_nota: "123", data_entrada: "2026-10-02" });
  });

  it("um item salvo alterado: `itens` COMPLETO — todo salvo pelo `id`, cada um só com o que mudou nele", () => {
    const a = abrir();
    const b = copia(a);
    b.itens[0] = { ...b.itens[0]!, quantity: "3" };
    expect(corpo(a, b)).toEqual({ version: "4", itens: [{ id: ITEM_A, quantidade: "3" }, { id: ITEM_B }] });
  });

  it("item novo incluído: entra sem `id`, com produto, quantidade e valor unitário (e os salvos pelo `id`)", () => {
    const a = abrir();
    const b = copia(a);
    b.itens.push({ product_id: PRODUTO, quantity: "1", unit_value: "", warehouse_id: LOCAL, discount: "", discount_percent: "" });
    expect(corpo(a, b)).toEqual({ version: "4", itens: [{ id: ITEM_A }, { id: ITEM_B }, { produto_id: PRODUTO, armazem_id: LOCAL, quantidade: "1", valor_unitario: "0" }] });
  });

  it("no pedido, lote e validade do item não vão", () => {
    const a = abrir();
    const b = copia(a);
    b.itens[1] = { ...b.itens[1]!, provider_lot: "L2" };
    expect(corpo(a, b, false)).toEqual({ version: "4" });
    expect(corpo(a, b, true)).toEqual({ version: "4", itens: [{ id: ITEM_A }, { id: ITEM_B, lote: "L2" }] });
  });

  it("plano: desligar o ajuste vai `null` (pela condição); ligar ou mudar o plano ajustado vai o plano", () => {
    const ajustado = { installments: 3, first_due_date: "2026-11-01", mode: "interval", interval_days: 30, has_down_payment: false };
    const a = abrir(documento({ plano_parcelas: ajustado, parcelas_ajustadas: true, condicao_pagamento_id: "88888888-0000-4000-8000-000000000001" }));
    const desligado = copia(a); desligado.ajustarParcelas = false;
    expect(corpo(a, desligado)).toEqual({ version: "4", plano_parcelas: null });
    const mudado = copia(a); mudado.plano = { ...mudado.plano, installments: 4 };
    expect(corpo(a, mudado)).toEqual({ version: "4", plano_parcelas: { ...ajustado, installments: 4 } });
    const semAjuste = abrir();
    const ligado = copia(semAjuste); ligado.ajustarParcelas = true;
    expect(corpo(semAjuste, ligado)).toEqual({ version: "4", plano_parcelas: planoPadrao() });
  });
});

describe("as travas da edição (P1: item salvo não sai; os limites do servidor)", () => {
  const DA_NOTA = "Esta compra veio da nota com as duplicatas…";
  const limites: LimitesDaEdicaoDeCompra = {
    campos: { fornecedor_id: "O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.", frete: DA_NOTA, outras_despesas: DA_NOTA, desconto: DA_NOTA, plano_parcelas: DA_NOTA },
    itemNovo: null,
    itens: [
      { id: ITEM_A, campos: { produto_id: "O produto do item vem do pedido de origem e não muda.", quantidade: "O pedido de origem já foi convertido…" }, quantidadeMaxima: null },
      { id: ITEM_B, campos: { valor_unitario: DA_NOTA, desconto: DA_NOTA, desconto_percentual: DA_NOTA }, quantidadeMaxima: "5.0000" }
    ]
  };

  it("o item salvo é FIXO (o Remover não aparece) e leva os limites dele, com o MOTIVO do servidor; o item novo, nenhuma trava", () => {
    const a = abrir();
    expect(travasDoItem(limites, a.itens[0]!)).toEqual({
      fixa: true, produto: true, quantidade: true, unitario: false, desconto: false,
      motivos: { produto: "O produto do item vem do pedido de origem e não muda.", quantidade: "O pedido de origem já foi convertido…" }
    });
    expect(travasDoItem(limites, a.itens[1]!)).toEqual({
      fixa: true, produto: false, quantidade: false, unitario: true, desconto: true, motivos: { unitario: DA_NOTA, desconto: DA_NOTA }, quantidadeMaxima: "5.0000"
    });
    expect(travasDoItem(SEM_LIMITES, a.itens[1]!)).toEqual({ fixa: true, produto: false, quantidade: false, unitario: false, desconto: false });
    expect(travasDoItem(limites, { product_id: PRODUTO, quantity: "1" })).toEqual({});
  });

  it("o teto da quantidade (D2): o `max` na EDIÇÃO; nenhum na CRIAÇÃO; o receber continua com o saldo da origem", () => {
    const a = abrir();
    const daEdicao = travasDaLinhaNaTela(limites);
    expect(daEdicao).not.toBeNull();
    // a edição: o item com teto o recebe; o que tem a quantidade travada e o item novo, não
    expect(maximoDaQuantidade(null, daEdicao!(a.itens[1]!), a.itens[1]!)).toBe("5.0000");
    expect(maximoDaQuantidade(null, daEdicao!(a.itens[0]!), a.itens[0]!)).toBeUndefined();
    const novo: ItemRow = { product_id: PRODUTO, quantity: "1" };
    expect(maximoDaQuantidade(null, daEdicao!(novo), novo)).toBeUndefined();
    // a criação: sem limites, a grade não recebe travas — nenhum `max` (o DOM de hoje)
    expect(travasDaLinhaNaTela(null)).toBeNull();
    expect(maximoDaQuantidade(null, {}, a.itens[1]!)).toBeUndefined();
    // o receber: o saldo da origem, como sempre (vence qualquer trava)
    expect(maximoDaQuantidade({ saldo: () => "7.0000", quantidadeTravada: false }, { quantidadeMaxima: "5.0000" }, a.itens[1]!)).toBe("7.0000");
  });

  it("a dica do nome na edição não promete confirmação (P4: editar não confirma)", () => {
    expect(dicaDaIdentidadeNaEdicao(true)).toBe("Editar não confirma: salve as alterações e confirme pela consulta.");
    expect(dicaDaIdentidadeNaEdicao(false)).not.toMatch(/antes de confirmar/);
  });

  it("o cabeçalho: a empresa sempre; o resto pelos limites do servidor, com o motivo dele", () => {
    expect(campoTravadoNaEdicao(SEM_LIMITES, "empresa_id")).toBe(true);
    expect(motivoDaTravaNaEdicao(SEM_LIMITES, "empresa_id")).toBe(MOTIVO_EMPRESA_NA_EDICAO);
    expect(campoTravadoNaEdicao(SEM_LIMITES, "fornecedor_id")).toBe(false);
    expect(campoTravadoNaEdicao(limites, "fornecedor_id")).toBe(true);
    expect(["frete", "outras_despesas", "desconto", "plano_parcelas"].every((c) => motivoDaTravaNaEdicao(limites, c) === DA_NOTA)).toBe(true);
    expect(campoTravadoNaEdicao(limites, "observacao")).toBe(false);
    // herdado do protótipo não é limite
    expect(campoTravadoNaEdicao(limites, "toString")).toBe(false);
  });

  it("P6: fornecedor, número e série da compra com chave, e frete, outras despesas e desconto da compra vinda da nota — travados pelos limites, com o motivo do servidor (o mesmo mecanismo do cabeçalho)", () => {
    const DA_CHAVE = "A nota desta compra tem chave de acesso: fornecedor, número e série vêm da chave e não mudam.";
    const DO_XML = "Esta compra veio da nota fiscal: frete, outras despesas e desconto do cabeçalho são os da nota…";
    const p6: LimitesDaEdicaoDeCompra = {
      campos: { fornecedor_id: DA_CHAVE, numero_nota: DA_CHAVE, serie_nota: DA_CHAVE, frete: DO_XML, outras_despesas: DO_XML, desconto: DO_XML },
      itemNovo: null, itens: []
    };
    for (const c of ["fornecedor_id", "numero_nota", "serie_nota"]) {
      expect(campoTravadoNaEdicao(p6, c), c).toBe(true);
      expect(motivoDaTravaNaEdicao(p6, c), c).toBe(DA_CHAVE);
    }
    for (const c of ["frete", "outras_despesas", "desconto"]) expect(motivoDaTravaNaEdicao(p6, c), c).toBe(DO_XML);
    // o que a P6 deixa livre: a data do documento (o resíduo declarado), a entrada e a observação
    for (const c of ["data_documento", "data_entrada", "observacao"]) expect(campoTravadoNaEdicao(p6, c), c).toBe(false);
  });

  it("a defesa do handler: o item salvo que sumiu volta (a lista anterior inteira)", () => {
    const a = abrir().itens;
    expect(itensNaEdicao(a, [a[1]!], SEM_LIMITES)).toEqual(a);
  });

  it("o item NOVO sai antes de salvar", () => {
    const a = abrir().itens;
    const novo: ItemRow = { product_id: PRODUTO, quantity: "1", unit_value: "0" };
    const comNovo = itensNaEdicao(a, [...a, novo], SEM_LIMITES);
    expect(comNovo).toHaveLength(3);
    expect(itensNaEdicao(comNovo, a, SEM_LIMITES)).toEqual(a);
  });

  it("o Duplicar de um item salvo vira item NOVO (sem o `id`), e o corpo o manda como novo", () => {
    const a = abrir();
    const duplicado = itensNaEdicao(a.itens, [a.itens[0]!, { ...a.itens[0]! }, a.itens[1]!], SEM_LIMITES);
    expect(duplicado.map((l) => l["id"])).toEqual([ITEM_A, undefined, ITEM_B]);
    const c = corpo(a, { ...copia(a), itens: duplicado });
    expect(c["itens"]).toEqual([{ id: ITEM_A }, { produto_id: PRODUTO, armazem_id: LOCAL, quantidade: "10.0000", valor_unitario: "5.500000", desconto: "0.00", desconto_percentual: "0.0000" }, { id: ITEM_B }]);
  });

  it("sem item novo (a compra gerada de pedido; a compra da nota): o novo não entra", () => {
    const a = abrir().itens;
    expect(itensNaEdicao(a, [...a, { product_id: PRODUTO, quantity: "1" }], { ...SEM_LIMITES, itemNovo: "A compra gerada de um pedido só tem os itens do pedido…" })).toEqual(a);
  });

  it("o campo travado do item salvo volta ao valor anterior; o livre muda", () => {
    const a = abrir().itens;
    const tentativa = [{ ...a[0]!, product_id: OUTRO_PRODUTO, quantity: "99", unit_value: "7" }, { ...a[1]!, unit_value: "9", discount: "1", provider_lot: "L9" }];
    const r = itensNaEdicao(a, tentativa, limites);
    expect(r[0]).toMatchObject({ product_id: PRODUTO, quantity: "10.0000", unit_value: "7" });
    expect(r[1]).toMatchObject({ unit_value: "1.000000", discount: "0.00", provider_lot: "L9" });
  });
});

describe("o adaptador do `GET /edicao` (fail-closed)", () => {
  const resposta = (extra: Record<string, unknown> = {}) => ({
    podeEditar: true, motivo: null, version: "4",
    limites: { campos: {}, itemNovo: null, itens: [{ id: ITEM_A.toUpperCase(), campos: { quantidade: "motivo" }, quantidadeMaxima: "3.0000" }] },
    regras: { exigencias: [] }, layout: { estrutura: null }, documento: documento(), ...extra
  });

  it("a resposta na forma: lida (o id do limite em minúsculas; regras e layout passam para os leitores de sempre)", () => {
    const l = lerEdicao(resposta());
    expect(l).not.toBeNull();
    expect(l?.limites.itens[0]).toEqual({ id: ITEM_A, campos: { quantidade: "motivo" }, quantidadeMaxima: "3.0000" });
    expect(l?.version).toBe("4");
    expect(lerEdicao(resposta({ version: 7 }))?.version).toBe("7");
  });

  it("recusa com o motivo do servidor; sem motivo, fora da forma", () => {
    expect(lerEdicao(resposta({ podeEditar: false, motivo: "Aprovado: não se edita." }))).toMatchObject({ podeEditar: false, motivo: "Aprovado: não se edita." });
    expect(lerEdicao(resposta({ podeEditar: false, motivo: null }))).toBeNull();
  });

  it("fora da forma ⇒ null (versão, limites, documento, podeEditar)", () => {
    expect(lerEdicao(resposta({ version: "x" }))).toBeNull();
    expect(lerEdicao(resposta({ version: -1 }))).toBeNull();
    expect(lerEdicao(resposta({ limites: undefined }))).toBeNull();
    expect(lerEdicao(resposta({ limites: { campos: {}, itemNovo: null, itens: [{ id: "não-é-uuid", campos: {}, quantidadeMaxima: null }] } }))).toBeNull();
    expect(lerEdicao(resposta({ limites: { campos: { fornecedor_id: true }, itemNovo: null, itens: [] } }))).toBeNull();
    expect(lerEdicao(resposta({ limites: { campos: {}, itemNovo: false, itens: [] } }))).toBeNull();
    expect(lerEdicao(resposta({ limites: { campos: {}, itemNovo: null, itens: [{ id: ITEM_A, quantidadeMaxima: null }] } }))).toBeNull();
    expect(lerEdicao(resposta({ documento: null }))).toBeNull();
    expect(lerEdicao(resposta({ podeEditar: "true" }))).toBeNull();
    expect(lerEdicao(null)).toBeNull();
  });
});

describe("o erro do salvar: o conflito de versão oferece recarregar; o resto vai ao lugar de sempre", () => {
  const erro = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

  it("409 CONCURRENCY_CONFLICT: a mensagem do servidor (a oferta de recarregar)", () => {
    expect(conflitoDaEdicao(erro(409, "CONCURRENCY_CONFLICT", "Este documento mudou desde que você o abriu. Recarregue antes de salvar.")))
      .toBe("Este documento mudou desde que você o abriu. Recarregue antes de salvar.");
    expect(conflitoDaEdicao(erro(409, "CONCURRENCY_CONFLICT", " "))).toBe(MSG_DOCUMENTO_MUDOU_NA_EDICAO);
  });

  it("409 de situação, 422 e falha de rede NÃO são conflito de versão", () => {
    expect(conflitoDaEdicao(erro(409, "INVALID_STATUS_TRANSITION", "Esta compra está confirmada…"))).toBeNull();
    expect(conflitoDaEdicao(erro(422, "VALIDATION_ERROR", "Dados inválidos"))).toBeNull();
    expect(conflitoDaEdicao(new TypeError("Failed to fetch"))).toBeNull();
    expect(conflitoDaEdicao("texto")).toBeNull();
  });

  it("a porta que não existe (a API anterior): 404 de ROTA, não de documento", () => {
    expect(edicaoIndisponivel(erro(404, "NOT_FOUND", "Rota não encontrada"))).toBe(true);
    expect(edicaoIndisponivel(erro(404, "NOT_FOUND", "Documento não encontrado"))).toBe(false);
  });
});
