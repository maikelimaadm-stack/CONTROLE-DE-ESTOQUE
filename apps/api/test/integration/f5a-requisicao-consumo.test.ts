import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MENSAGEM_APROVACAO_PENDENTE } from "@agro/domain";
import {
  c, iniciar, encerrar, produto, armazem, saldoInicial, j, unico, recusadoNoCampo, contarDocumentos, topV5, lancarDoc, lancadoDoc, lido, previaDoc,
  confirmarDoc, confirmadoDoc, cancelarDoc, encerrarSaldo, listar, saldoDoPar, erro, detalhes, forma, cabecalho, itensNoBanco, razao, centroNovo,
  type Resposta,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — REQUISIÇÃO → CONSUMO (em parte) → ENCERRAR O SALDO → DEVOLUÇÃO DE CONSUMO.
 *
 * A requisição (pedido de material) nasce ABERTA sem reservar nada; CONFIRMADA, ela é a PENDENTE e o saldo pendente
 * dela entra no reservado do local de estoque (parte C1 da reserva, 0043) — sem mover o razão. O consumo ligado a
 * ela baixa (`requisition`) e herda o destino dela; o aberto continua reservando a parte dele (C2). Encerrar o saldo
 * tira o pendente da reserva. A devolução puxa do consumo e volta pelo custo dele, com o destino copiado.
 *
 * O QUE CONTA COMO PROVA: o saldo do par (físico, reservado e disponível) é o que o SERVIDOR diz em
 * `/api/stock/balances/:local/:produto`; movimentos e colunas novas são lidos no banco por conexão própria de
 * superusuário. Toda recusa vem com a premissa ao lado: o mesmo cenário, corrigido, passa. Cada caso cria o PRÓPRIO
 * produto: nenhum lê o saldo de outro.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const item = (produtoId: string, quantidade: string, extra: Record<string, unknown> = {}) => ({ produto_id: produtoId, quantidade, ...extra });
const corpoDe = (r: Resposta) => j(r) as Record<string, unknown>;

describe("RC-1 — o caminho inteiro: requisição → reserva → consumo em parte → encerrar o saldo → devolução", () => {
  let p: { id: string; nome: string };
  let topRequisicao: string;
  let centro: string;
  let requisicao: string;
  let itemDaRequisicao: string;
  let consumo: string;
  let itemDoConsumo: string;
  let devolucao: string;

  it("RC-1a a requisição SALVA não reserva nem move; a prévia mostra o DISPONÍVEL (`baseDoSaldo`), sem movimento", async () => {
    p = await produto();
    await saldoInicial(p.id, "10");
    centro = await centroNovo();
    // A TOP da requisição no formato 5 com o centro de resultado OPCIONAL: o consumo vai herdá-lo.
    topRequisicao = await topV5("requisicao", (x) => { x.destino.centroCusto = "opcional"; });
    const r = await lancarDoc("requisicao", [item(p.id, "10")], { tipo_operacao_id: topRequisicao, centro_custo_id: centro });
    expect(r.statusCode, r.body).toBe(201);
    expect(Object.keys(corpoDe(r)).sort(), "a resposta do POST tem as chaves de sempre").toEqual(["codigo", "especie", "id", "situacao"]);
    expect(corpoDe(r)).toMatchObject({ especie: "requisicao", situacao: "aberto" });
    requisicao = (corpoDe(r) as { id: string }).id;
    expect(await cabecalho(requisicao)).toMatchObject({ situacao: "aberto", especie: "requisicao", centro_custo_id: centro });
    expect(await razao(requisicao), "salvar não move o razão").toEqual([]);
    expect(await saldoDoPar(p.id), "salvar não reserva (premissa: o físico é 10)").toEqual({ quantity: "10.0000", reservado: "0.0000", disponivel: "10.0000" });

    const pv = await previaDoc("requisicao", requisicao);
    expect(pv.statusCode, pv.body).toBe(200);
    const corpo = corpoDe(pv) as { baseDoSaldo: string; podeConfirmar: boolean; itens: { saldo_atual: string; saldo_depois: string; insuficiente: boolean; diferenca: string | null; movimento: string | null }[] };
    expect(corpo.baseDoSaldo).toBe("disponivel");
    expect(corpo.podeConfirmar).toBe(true);
    expect(corpo.itens.map((x) => [x.saldo_atual, x.saldo_depois, x.insuficiente, x.diferenca, x.movimento])).toEqual([["10.0000", "0.0000", false, null, null]]);
    itemDaRequisicao = (await itensNoBanco(requisicao))[0]!.id;
  });

  it("RC-1b confirmar a requisição: NENHUM movimento; reservado 10, disponível 0 (físico 10); a leitura diz \"pendente\"", async () => {
    expect(await confirmadoDoc("requisicao", requisicao)).toEqual({ id: requisicao, situacao: "confirmado", movimentos: 0 });
    expect(await razao(requisicao), "a requisição não move o razão").toEqual([]);
    expect(await saldoDoPar(p.id)).toEqual({ quantity: "10.0000", reservado: "10.0000", disponivel: "0.0000" });
    const l = await lido("requisicao", requisicao);
    expect(l).toMatchObject({ situacao: "confirmado", atendimento: "pendente", origem: null, vinculados: [] });
    expect(l.itens.map((x) => [x.quantidade_atendida, x.saldo_pendente, x.quantidade_devolvida])).toEqual([["0.0000", "10.0000", null]]);
  });

  it("RC-1c uma SAÍDA de 1 por outro documento é recusada pela reserva (409 INSUFFICIENT_STOCK, a mensagem de sempre), sem efeito", async () => {
    const saida = await lancadoDoc("saida", [item(p.id, "1")]);
    const r = await confirmarDoc("saida", saida);
    expect(erro(r)).toEqual({ status: 409, code: "INSUFFICIENT_STOCK", message: "disponível 0 < solicitado 1 (10 reservado para pedidos)" });
    expect(await razao(saida), "nada saiu").toEqual([]);
    expect((await cabecalho(saida)).situacao).toBe("aberto");
    expect((await saldoDoPar(p.id)).quantity, "premissa: o físico (10) cobria a saída — quem recusou foi a reserva").toBe("10.0000");
    expect((await cancelarDoc("saida", saida)).statusCode).toBe(200);
  });

  it("RC-1d o CONSUMO de 4 ligado (aberto) herda o destino; a reserva continua 10 (6 pendentes + 4 do consumo aberto); a requisição fica \"parcial\"", async () => {
    // A TOP do consumo é a NEUTRA (destino "opcional" desde a F11, decisão 288): o consumo HERDA o destino da requisição
    // sem informá-lo (e o herdado nunca é recusado, nem numa TOP que grava "não usada": quem o escolheu foi a requisição —
    // `f5a-destino-fluxo.test.ts`, DF-2c).
    const r = await lancarDoc("consumo", [item(p.id, "4", { origem_item_id: itemDaRequisicao })], { origem_documento_id: requisicao });
    expect(r.statusCode, r.body).toBe(201);
    consumo = (corpoDe(r) as { id: string }).id;
    expect(await cabecalho(consumo)).toMatchObject({ situacao: "aberto", origem_documento_id: requisicao, centro_custo_id: centro });
    itemDoConsumo = (await itensNoBanco(consumo))[0]!.id;
    expect((await itensNoBanco(consumo))[0]!.origem_item_id).toBe(itemDaRequisicao);
    expect(await saldoDoPar(p.id), "o consumo aberto segura a parte dele").toEqual({ quantity: "10.0000", reservado: "10.0000", disponivel: "0.0000" });

    const lr = await lido("requisicao", requisicao);
    expect(lr.atendimento).toBe("parcial");
    expect(lr.itens.map((x) => [x.quantidade_atendida, x.saldo_pendente])).toEqual([["4.0000", "6.0000"]]);
    expect(lr.vinculados.map((v) => [v.id, v.especie, v.situacao])).toEqual([[consumo, "consumo", "aberto"]]);
    const lc = await lido("consumo", consumo);
    expect(lc.origem).toMatchObject({ id: requisicao, especie: "requisicao", situacao: "confirmado" });
    expect(lc.centro_custo_id).toBe(centro);
    // A prévia do consumo olha o FÍSICO, como a saída.
    const pv = corpoDe(await previaDoc("consumo", consumo)) as { itens: { saldo_atual: string; saldo_depois: string; movimento: string }[]; baseDoSaldo?: unknown };
    expect(pv.itens.map((x) => [x.saldo_atual, x.saldo_depois, x.movimento])).toEqual([["10.0000", "6.0000", "writeoff"]]);
    expect("baseDoSaldo" in pv, "`baseDoSaldo` é só da requisição").toBe(false);
  });

  it("RC-1e confirmar o consumo: movimento `requisition` de 4 COM o destino; físico 6, reservado 6 (a guarda tira a parte do próprio consumo)", async () => {
    expect(await confirmadoDoc("consumo", consumo)).toEqual({ id: consumo, situacao: "confirmado", movimentos: 1 });
    expect(await razao(consumo)).toEqual([{ movement_type: "requisition", direction: -1, quantity: "4.0000", unit_cost: "10.000000",
      cost_center_id: centro, harvest_id: null, equipamento_id: null, ordem_servico_id: null, lote_animais_id: null, area_id: null }]);
    expect((await itensNoBanco(consumo))[0]!.custo_unitario, "o custo do movimento fica no item").toBe("10.000000");
    expect(await saldoDoPar(p.id)).toEqual({ quantity: "6.0000", reservado: "6.0000", disponivel: "0.0000" });
  });

  it("RC-1f um consumo de 7 ligado passa do pendente (6) → 422 no item, nada gravado", async () => {
    const antes = await contarDocumentos();
    const r = await lancarDoc("consumo", [item(p.id, "7", { origem_item_id: itemDaRequisicao })], { origem_documento_id: requisicao });
    recusadoNoCampo(r, "itens.0.quantidade");
    expect(detalhes(r)).toEqual([["itens.0.quantidade", "Passa do saldo pendente do item da requisição: há 6"]]);
    expect(await contarDocumentos()).toBe(antes);
  });

  it("RC-1g ENCERRAR O SALDO: a requisição continua confirmada, \"encerrado\", e a reserva some; encerrar de novo → 409; consumo depois → 422", async () => {
    const r = await encerrarSaldo(requisicao, "  Obra concluída antes  ");
    expect(r.statusCode, r.body).toBe(200);
    expect(corpoDe(r)).toEqual({ id: requisicao, situacao: "confirmado", atendimento: "encerrado" });
    expect(await cabecalho(requisicao)).toMatchObject({ situacao: "confirmado", encerrado: true, saldo_encerrado_motivo: "Obra concluída antes" });
    const l = await lido("requisicao", requisicao);
    expect(l.atendimento).toBe("encerrado");
    expect(l.saldo_encerrado_por_nome, "quem encerrou").toEqual(expect.any(String));
    expect(l.itens.map((x) => [x.quantidade_atendida, x.saldo_pendente])).toEqual([["4.0000", "0.0000"]]);
    expect(await saldoDoPar(p.id), "o pendente saiu da reserva").toEqual({ quantity: "6.0000", reservado: "0.0000", disponivel: "6.0000" });
    expect(erro(await encerrarSaldo(requisicao))).toEqual({ status: 409, code: "CONFLICT", message: "O saldo desta requisição já foi encerrado." });
    const depois = await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemDaRequisicao })], { origem_documento_id: requisicao });
    recusadoNoCampo(depois, "origem_documento_id");
    expect(detalhes(depois)).toEqual([["origem_documento_id", "Requisição de origem inválida: escolha uma requisição pendente da mesma empresa e do mesmo local de estoque"]]);
  });

  it("RC-1h a DEVOLUÇÃO de 2 puxa do consumo: volta como `devolution` pelo custo do consumo, com o destino COPIADO; 3 a mais → 422", async () => {
    const r = await lancarDoc("devolucao_consumo", [item(p.id, "2", { origem_item_id: itemDoConsumo })], { origem_documento_id: consumo });
    expect(r.statusCode, r.body).toBe(201);
    devolucao = (corpoDe(r) as { id: string }).id;
    expect(await cabecalho(devolucao), "o destino é o do consumo").toMatchObject({ origem_documento_id: consumo, centro_custo_id: centro });
    expect(await confirmadoDoc("devolucao_consumo", devolucao)).toMatchObject({ situacao: "confirmado", movimentos: 1 });
    expect(await razao(devolucao)).toEqual([{ movement_type: "devolution", direction: 1, quantity: "2.0000", unit_cost: "10.000000",
      cost_center_id: centro, harvest_id: null, equipamento_id: null, ordem_servico_id: null, lote_animais_id: null, area_id: null }]);
    expect((await itensNoBanco(devolucao))[0]!.custo_unitario, "o custo do consumo, gravado no item").toBe("10.000000");
    expect((await saldoDoPar(p.id)).quantity).toBe("8.0000");
    expect((await lido("consumo", consumo)).itens.map((x) => x.quantidade_devolvida)).toEqual(["2.0000"]);

    const mais = await lancarDoc("devolucao_consumo", [item(p.id, "3", { origem_item_id: itemDoConsumo })], { origem_documento_id: consumo });
    recusadoNoCampo(mais, "itens.0.quantidade");
    expect(detalhes(mais)).toEqual([["itens.0.quantidade", "Passa do que o consumo baixou e ainda não voltou: há 2"]]);
  });

  it("RC-1i desfaz-se de baixo para cima: consumo com devolução viva e requisição com consumo vivo → 409; cancelados em ordem, tudo volta", async () => {
    expect(erro(await cancelarDoc("consumo", consumo))).toEqual({ status: 409, code: "CONFLICT", message: "Este consumo tem devoluções: cancele-as primeiro." });
    expect(erro(await cancelarDoc("requisicao", requisicao))).toEqual({ status: 409, code: "CONFLICT", message: "Esta requisição tem consumos: cancele-os ou encerre o saldo." });
    expect((await cabecalho(consumo)).situacao, "nada mudou").toBe("confirmado");
    for (const [especie, id] of [["devolucao_consumo", devolucao], ["consumo", consumo]] as const) {
      const r = await cancelarDoc(especie, id);
      expect(r.statusCode, r.body).toBe(200);
    }
    const r = await cancelarDoc("requisicao", requisicao);
    expect(r.statusCode, r.body).toBe(200);
    expect(corpoDe(r), "a requisição não tinha movimento: nenhum estorno").toMatchObject({ situacao: "cancelado", estornos: 0 });
    expect(await saldoDoPar(p.id), "o físico volta a 10, sem reserva").toEqual({ quantity: "10.0000", reservado: "0.0000", disponivel: "10.0000" });
  });
});

describe("RC-2 — a confirmação da requisição recusa sem disponível (422 por item), e a prévia já diz", () => {
  it("RC-2a pedido maior que o disponível → a prévia marca insuficiente; confirmar → 422 no item, nada reservado; menor → confirma", async () => {
    const p = await produto(); await saldoInicial(p.id, "5");
    const r = await lancadoDoc("requisicao", [item(p.id, "3"), item(p.id, "3")]);
    const pv = corpoDe(await previaDoc("requisicao", r)) as { podeConfirmar: boolean; itens: { saldo_atual: string; saldo_depois: string; insuficiente: boolean }[] };
    expect(pv.podeConfirmar).toBe(false);
    expect(pv.itens.map((x) => [x.saldo_atual, x.saldo_depois, x.insuficiente]), "o segundo item enxerga o que o primeiro pediu").toEqual([["5.0000", "2.0000", false], ["2.0000", "-1.0000", true]]);
    const c1 = await confirmarDoc("requisicao", r);
    recusadoNoCampo(c1, "itens.1.quantidade");
    expect(detalhes(c1)).toEqual([["itens.1.quantidade", `Disponível insuficiente de ${p.nome} no local de estoque: há 2, a requisição pede 3.`]]);
    expect((await cabecalho(r)).situacao).toBe("aberto");
    expect((await saldoDoPar(p.id)).reservado).toBe("0.0000");
    // PREMISSA: o que cabe confirma.
    const cabe = await lancadoDoc("requisicao", [item(p.id, "5")]);
    await confirmadoDoc("requisicao", cabe);
    expect(await saldoDoPar(p.id)).toEqual({ quantity: "5.0000", reservado: "5.0000", disponivel: "0.0000" });
  });

  it("RC-2b a reserva de OUTRA requisição conta: com 4 reservados de 5, a requisição de 2 é recusada (disponível 1)", async () => {
    const p = await produto(); await saldoInicial(p.id, "5");
    const primeira = await lancadoDoc("requisicao", [item(p.id, "4")]);
    await confirmadoDoc("requisicao", primeira);
    const segunda = await lancadoDoc("requisicao", [item(p.id, "2")]);
    const r = await confirmarDoc("requisicao", segunda);
    expect(detalhes(r)).toEqual([["itens.0.quantidade", `Disponível insuficiente de ${p.nome} no local de estoque: há 1, a requisição pede 2.`]]);
    // PREMISSA: cancelada a primeira (confirmada, sem consumo), a reserva dela some e a segunda confirma.
    expect((await cancelarDoc("requisicao", primeira)).statusCode).toBe(200);
    await confirmadoDoc("requisicao", segunda);
    expect((await saldoDoPar(p.id)).reservado).toBe("2.0000");
  });
});

describe("RC-3 — a aprovação da requisição pela TOP (\"Sempre\")", () => {
  it("RC-3 confirmar sem aprovação → 409 APROVACAO_PENDENTE (nada reservado); aparece na fila; aprovada, confirma e reserva", async () => {
    const p = await produto(); await saldoInicial(p.id, "8");
    const topSempre = await topV5("requisicao", (x) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; });
    const r = await lancadoDoc("requisicao", [item(p.id, "3")], { tipo_operacao_id: topSempre });
    const antes = await confirmarDoc("requisicao", r);
    expect(erro(antes)).toMatchObject({ status: 409, code: "APROVACAO_PENDENTE", message: MENSAGEM_APROVACAO_PENDENTE });
    expect((await saldoDoPar(p.id)).reservado, "nada reservado sem aprovação").toBe("0.0000");

    const fila = await c.h.app.inject({ method: "GET", url: "/api/aprovacoes/estoque?pageSize=100", headers: c.h.headers() });
    expect(fila.statusCode, fila.body).toBe(200);
    const naFila = (j(fila) as unknown as { items: { id: string; especie: string; situacao: string }[] }).items.find((x) => x.id === r);
    expect(naFila, "a requisição aparece na fila de aprovações de estoque").toMatchObject({ especie: "requisicao", situacao: "pendente" });

    const aprovado = await c.h.app.inject({ method: "POST", url: `/api/aprovacoes/estoque/requisicoes/${r}/aprovar`, headers: c.h.headers(), payload: {} });
    expect(aprovado.statusCode, aprovado.body).toBe(200);
    expect(await confirmadoDoc("requisicao", r)).toMatchObject({ situacao: "confirmado", movimentos: 0 });
    expect(await saldoDoPar(p.id)).toEqual({ quantity: "8.0000", reservado: "3.0000", disponivel: "5.0000" });
  });
});

describe("RC-4 — a lista única: o atendimento calculado, os filtros novos e as chaves novas", () => {
  it("RC-4 `especie=requisicao&atendimento=pendente,parcial` traz só as pendentes e as em parte; `origem_documento_id` traz os consumos; valor fora → 422", async () => {
    const w = await armazem();
    const p = await produto(); await saldoInicial(p.id, "20", { armazem: w });
    const naW = { armazem_id: w };
    const pendente = await lancadoDoc("requisicao", [item(p.id, "2")], naW); await confirmadoDoc("requisicao", pendente);
    const parcial = await lancadoDoc("requisicao", [item(p.id, "4")], naW); await confirmadoDoc("requisicao", parcial);
    const atendida = await lancadoDoc("requisicao", [item(p.id, "1")], naW); await confirmadoDoc("requisicao", atendida);
    const aberta = await lancadoDoc("requisicao", [item(p.id, "1")], naW);
    const itemDe = async (id: string) => (await itensNoBanco(id))[0]!.id;
    const consumoParcial = await lancadoDoc("consumo", [item(p.id, "1", { origem_item_id: await itemDe(parcial) })], { ...naW, origem_documento_id: parcial });
    const consumoTotal = await lancadoDoc("consumo", [item(p.id, "1", { origem_item_id: await itemDe(atendida) })], { ...naW, origem_documento_id: atendida });
    await confirmadoDoc("consumo", consumoTotal);

    type Linha = { id: string; especie: string; atendimento: string | null; origem_documento_id: string | null };
    const pagina = async (q: string): Promise<Linha[]> => {
      const r = await listar(`${q}&armazem_id=${w}&pageSize=50`);
      expect(r.statusCode, r.body).toBe(200);
      return (j(r) as unknown as { items: Linha[] }).items;
    };
    const todas = await pagina("especie=requisicao");
    expect(new Map(todas.map((x) => [x.id, x.atendimento])), "premissa: o atendimento de cada uma, como a lista o calcula").toEqual(new Map([
      [pendente, "pendente"], [parcial, "parcial"], [atendida, "atendido"], [aberta, null]]));
    const filtradas = await pagina("especie=requisicao&atendimento=pendente,parcial");
    expect(filtradas.map((x) => x.id).sort()).toEqual([pendente, parcial].sort());
    expect((await pagina("atendimento=atendido")).map((x) => x.id)).toEqual([atendida]);

    const consumos = await pagina(`origem_documento_id=${parcial}`);
    expect(consumos.map((x) => [x.id, x.especie, x.origem_documento_id])).toEqual([[consumoParcial, "consumo", parcial]]);
    expect(await pagina("origem_documento_id=nao-uuid"), "uuid malformado no filtro = zero linhas").toEqual([]);

    const ruim = await listar("atendimento=pendente,talvez");
    recusadoNoCampo(ruim, "atendimento");
  });
});

describe("RC-5 — encerrar o saldo: só a requisição confirmada, atendida em parte", () => {
  it("RC-5 aberta → 409; sem consumo → 409 (cancele); atendida por inteiro → 409 (sem saldo); corpo inválido → 422; outra espécie → 404", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const aberta = await lancadoDoc("requisicao", [item(p.id, "2")]);
    expect(erro(await encerrarSaldo(aberta))).toEqual({ status: 409, code: "CONFLICT", message: "Esta requisição não está pendente." });
    const semConsumo = await lancadoDoc("requisicao", [item(p.id, "2")]); await confirmadoDoc("requisicao", semConsumo);
    expect(erro(await encerrarSaldo(semConsumo))).toEqual({ status: 409, code: "CONFLICT", message: "Esta requisição ainda não foi atendida: cancele-a em vez de encerrar o saldo." });
    const toda = await lancadoDoc("requisicao", [item(p.id, "3")]); await confirmadoDoc("requisicao", toda);
    const itemToda = (await itensNoBanco(toda))[0]!.id;
    const c1 = await lancadoDoc("consumo", [item(p.id, "3", { origem_item_id: itemToda })], { origem_documento_id: toda });
    expect((await lido("requisicao", toda)).atendimento, "o consumo ABERTO já atende").toBe("atendido");
    expect(erro(await encerrarSaldo(toda))).toEqual({ status: 409, code: "CONFLICT", message: "Esta requisição não tem saldo a encerrar." });
    await confirmadoDoc("consumo", c1);
    expect(await cabecalho(toda), "nada foi encerrado").toMatchObject({ encerrado: false });
    // corpo: motivo obrigatório (não vazio) e nada além dele
    for (const corpo of [{ motivo: "   " }, { motivo: "ok", extra: 1 }]) {
      const r = await c.h.app.inject({ method: "POST", url: `/api/estoque/requisicoes/${semConsumo}/encerrar-saldo`, headers: c.h.headers(), payload: corpo });
      expect(r.statusCode, r.body).toBe(422);
    }
    // a porta é da requisição: o id de um consumo é a MESMA 404 do inexistente
    const outraEspecie = await encerrarSaldo(c1);
    const inexistente = await encerrarSaldo("00000000-0000-4000-8000-000000000000");
    expect([outraEspecie.statusCode, inexistente.statusCode]).toEqual([404, 404]);
    expect(forma(outraEspecie), "outra espécie = inexistente").toEqual(forma(inexistente));
    // PREMISSA: a requisição em parte encerra.
    const emParte = await lancadoDoc("requisicao", [item(p.id, "2")]); await confirmadoDoc("requisicao", emParte);
    await confirmadoDoc("consumo", await lancadoDoc("consumo", [item(p.id, "1", { origem_item_id: (await itensNoBanco(emParte))[0]!.id })], { origem_documento_id: emParte }));
    const ok = await encerrarSaldo(emParte, `Encerrado ${unico()}`);
    expect(ok.statusCode, ok.body).toBe(200);
  });
});
