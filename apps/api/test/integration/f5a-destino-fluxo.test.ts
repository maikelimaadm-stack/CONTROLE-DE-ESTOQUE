import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTop } from "@agro/domain";
import {
  c, iniciar, encerrar, top, familia, produto, saldoInicial, j, recusadoNoCampo, contarDocumentos, topV5, lancarDoc, lancadoDoc, lido, confirmadoDoc,
  cancelarDoc, detalhes, forma, cabecalho, itensNoBanco, razao, centroNovo, safraNova, equipamentoNovo, osNova, loteAnimaisNovo, areaNova,
  type Resposta,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — O DESTINO E O FLUXO PELA TOP (seções `destino` e `fluxo` do formato 5).
 *
 * As regras que TRAVAM nascem DESLIGADAS: no neutro (Destino "opcional" desde a OPERACOES-01 F11, decisão 288 — era
 * "não usada" na F5a; Fluxo "não exige requisição, atende em parte") nada novo é exigido e o destino informado é
 * ACEITO e gravado, como a baixa e a requisição antigas aceitavam. Numa dimensão que a TOP grava "não usada", o destino
 * informado é RECUSADO, nunca ignorado. Com a TOP ligando a dimensão, o lançamento confere: obrigatória sem valor → 422 no campo; a referência informada existe,
 * está ativa e é da organização (centro de resultado, safra) ou da EMPRESA do documento (as outras quatro), com a
 * MESMA recusa para inexistente e de outra empresa. O consumo HERDA o destino da requisição; o razão grava o destino
 * do cabeçalho e o estorno o copia.
 *
 * O QUE CONTA COMO PROVA: colunas do cabeçalho e do razão lidas no banco (superusuário); toda recusa com a premissa ao
 * lado (o mesmo corpo, corrigido, salva) e a contagem de documentos antes e depois (nada gravado).
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const item = (produtoId: string, quantidade: string, extra: Record<string, unknown> = {}) => ({ produto_id: produtoId, quantidade, ...extra });
const idDe = (r: Resposta) => { expect(r.statusCode, r.body).toBe(201); return (j(r) as { id: string }).id; };

describe("DF-1 — a seção Destino da TOP no lançamento", () => {
  it("DF-1a dimensão OBRIGATÓRIA sem valor → 422 no campo, com a mensagem da TOP; nada gravado; com o valor, salva", async () => {
    const p = await produto();
    const t = await topV5("requisicao", (x) => { x.destino.centroCusto = "obrigatoria"; });
    const antes = await contarDocumentos();
    const r = await lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: t });
    recusadoNoCampo(r, "centro_custo_id");
    expect(detalhes(r)).toEqual([["centro_custo_id", "Esta operação exige centro de resultado."]]);
    expect(await contarDocumentos()).toBe(antes);
    // PREMISSA
    const centro = await centroNovo();
    const id = idDe(await lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: t, centro_custo_id: centro }));
    expect((await cabecalho(id)).centro_custo_id).toBe(centro);
  });

  it("DF-1b TOP NEUTRA (formato 1 e formato 5 no neutro, F11/288): a dimensão informada é ACEITA e gravada; com \"não usada\" explícito é recusada, nunca ignorada", async () => {
    const p = await produto(); await saldoInicial(p.id, "10"); const eq = await equipamentoNovo();
    const neutra5 = await topV5("saida");
    const naoUsa5 = await topV5("saida", (x) => { x.destino.equipamento = "nao_usada"; });
    // PREMISSA: a TOP do 5 que grava "não usada" na máquina recusa a máquina informada (nada gravado).
    const antes = await contarDocumentos();
    const recusada = await lancarDoc("saida", [item(p.id, "1")], { tipo_operacao_id: naoUsa5, equipamento_id: eq });
    recusadoNoCampo(recusada, "equipamento_id");
    expect(detalhes(recusada)).toEqual([["equipamento_id", "Esta operação não usa máquina/equipamento."]]);
    expect(await contarDocumentos(), "a recusa não grava").toBe(antes);
    // CONCLUSÃO: a TOP neutra (a do formato 1 da requisição e a do 5 no neutro da saída) aceita e grava a MESMA máquina.
    for (const [especie, extra] of [["requisicao", {}], ["saida", { tipo_operacao_id: neutra5 }]] as const) {
      const id = idDe(await lancarDoc(especie, [item(p.id, "1")], { ...extra, equipamento_id: eq }));
      expect((await cabecalho(id)).equipamento_id, `${especie}: a máquina gravada`).toBe(eq);
      if (especie === "saida") {
        await confirmadoDoc("saida", id);
        expect(await razao(id), "a saída confirmada leva a máquina ao razão").toEqual([expect.objectContaining({ movement_type: "writeoff", equipamento_id: eq })]);
      }
    }
    // E nada novo é exigido no neutro: sem o destino, a mesma TOP neutra salva.
    idDe(await lancarDoc("saida", [item(p.id, "1")], { tipo_operacao_id: neutra5 }));
  });

  it("DF-1c as seis OPCIONAIS: tudo informado salva, e a leitura traz os nomes do destino", async () => {
    const p = await produto();
    const t = await topV5("requisicao", (x) => { for (const k of Object.keys(x.destino) as (keyof typeof x.destino)[]) x.destino[k] = "opcional"; });
    const d = { centro_custo_id: await centroNovo(), equipamento_id: await equipamentoNovo(), ordem_servico_id: await osNova(),
      lote_animais_id: await loteAnimaisNovo(), area_id: await areaNova(), safra_id: await safraNova() };
    const id = idDe(await lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: t, ...d }));
    expect(await cabecalho(id)).toMatchObject(d);
    const l = await lido("requisicao", id);
    expect(l).toMatchObject(d);
    for (const nome of [l.centro_custo_nome, l.equipamento_nome, l.ordem_servico_codigo, l.lote_animais_nome, l.area_nome, l.safra_nome]) {
      expect(nome, "cada dimensão vem com o nome").toEqual(expect.any(String));
    }
    // PREMISSA do opcional: sem nenhuma, a mesma TOP também salva.
    idDe(await lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: t }));
  });

  it("DF-1d referência de OUTRA EMPRESA = a MESMA 422 do inexistente; inativa, OS encerrada, centro sintético e safra inativa → 422", async () => {
    const p = await produto();
    const t = await topV5("requisicao", (x) => { for (const k of Object.keys(x.destino) as (keyof typeof x.destino)[]) x.destino[k] = "opcional"; });
    const lancar = (extra: Record<string, unknown>) => lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: t, ...extra });
    const antes = await contarDocumentos();
    const deOutra = await lancar({ equipamento_id: await equipamentoNovo({ empresa: c.I.empresa2 }) });
    const inexistente = await lancar({ equipamento_id: "00000000-0000-4000-8000-000000000000" });
    const inativo = await lancar({ equipamento_id: await equipamentoNovo({ status: "inactive" }) });
    for (const r of [deOutra, inexistente, inativo]) recusadoNoCampo(r, "equipamento_id");
    expect(forma(deOutra), "de outra empresa não se distingue do inexistente").toEqual(forma(inexistente));
    expect(detalhes(inexistente)).toEqual([["equipamento_id", "Máquina/equipamento inválido: escolha uma máquina/equipamento ativo da empresa do documento"]]);
    expect(forma(inativo)).toEqual(forma(inexistente));
    for (const [campo, valor] of [
      ["ordem_servico_id", await osNova({ status: "finished" })], ["ordem_servico_id", await osNova({ empresa: c.I.empresa2 })],
      ["centro_custo_id", await centroNovo({ kind: "synthetic" })], ["safra_id", await safraNova({ ativa: false })],
      ["lote_animais_id", await loteAnimaisNovo({ empresa: c.I.empresa2 })], ["area_id", await areaNova({ ativa: false })],
    ] as const) {
      recusadoNoCampo(await lancar({ [campo]: valor }), campo);
    }
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);
    // PREMISSA: as mesmas dimensões, ativas e da empresa do documento, salvam.
    idDe(await lancar({ equipamento_id: await equipamentoNovo(), ordem_servico_id: await osNova({ status: "in_progress" }), centro_custo_id: await centroNovo() }));
  });
});

describe("DF-2 — o consumo herda o destino da requisição; o razão grava; o estorno copia", () => {
  it("DF-2a o consumo ligado HERDA (sem informar); informado DIFERENTE → 422; confirmado, o movimento leva o destino", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const tReq = await topV5("requisicao", (x) => { x.destino.centroCusto = "opcional"; x.destino.equipamento = "opcional"; });
    const tCon = await topV5("consumo", (x) => { x.destino.centroCusto = "opcional"; });
    const centro = await centroNovo(); const eq = await equipamentoNovo();
    const req = await lancadoDoc("requisicao", [item(p.id, "5")], { tipo_operacao_id: tReq, centro_custo_id: centro, equipamento_id: eq });
    await confirmadoDoc("requisicao", req);
    const itemReq = (await itensNoBanco(req))[0]!.id;
    const ligado = { origem_documento_id: req, tipo_operacao_id: tCon };

    const outro = await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemReq })], { ...ligado, centro_custo_id: await centroNovo() });
    recusadoNoCampo(outro, "centro_custo_id");
    expect(detalhes(outro)).toEqual([["centro_custo_id", "O destino do consumo é o da requisição de origem"]]);
    // o MESMO centro informado é aceito (é o herdado)
    idDe(await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemReq })], { ...ligado, centro_custo_id: centro }));

    const consumo = await lancadoDoc("consumo", [item(p.id, "2", { origem_item_id: itemReq })], ligado);
    expect(await cabecalho(consumo), "herdou as duas dimensões da requisição").toMatchObject({ centro_custo_id: centro, equipamento_id: eq });
    await confirmadoDoc("consumo", consumo);
    expect(await razao(consumo)).toEqual([expect.objectContaining({ movement_type: "requisition", direction: -1, quantity: "2.0000", cost_center_id: centro, equipamento_id: eq, harvest_id: null })]);
  });

  it("DF-2c REENVIAR o destino herdado = omiti-lo: com a TOP do consumo que NÃO USA centro nem OS (\"não usada\" explícito, F11) e a OS fechada depois da requisição, o consumo com o herdado reenviado salva igual ao sem ele; outro valor continua 422", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const tReq = await topV5("requisicao", (x) => { x.destino.centroCusto = "opcional"; x.destino.ordemServico = "opcional"; });
    const centro = await centroNovo(); const os = await osNova();
    // A TOP do consumo grava "não usada" EXPLÍCITO no centro e na OS (desde a F11 o neutro é "opcional").
    const tCon = await topV5("consumo", (x) => { x.destino.centroCusto = "nao_usada"; x.destino.ordemServico = "nao_usada"; });
    const req = await lancadoDoc("requisicao", [item(p.id, "5")], { tipo_operacao_id: tReq, centro_custo_id: centro, ordem_servico_id: os });
    await confirmadoDoc("requisicao", req);
    // A OS fecha DEPOIS da requisição (por SQL: a rota de status baixaria os insumos da OS).
    await c.admin.query("update erp.service_orders set status = 'finished' where id = $1", [os]);
    const itemReq = (await itensNoBanco(req))[0]!.id;
    const consumo = (extra: Record<string, unknown>) =>
      lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemReq })], { tipo_operacao_id: tCon, origem_documento_id: req, ...extra });

    // PREMISSAS: a TOP do consumo NÃO usa centro — num consumo direto, o centro é recusado; e a OS fechada,
    // informada numa requisição nova, é uma referência inválida.
    expect(detalhes(await lancarDoc("consumo", [item(p.id, "1")], { tipo_operacao_id: tCon, centro_custo_id: centro })), "premissa: a TOP do consumo não usa centro")
      .toEqual([["centro_custo_id", "Esta operação não usa centro de resultado."]]);
    expect(detalhes(await lancarDoc("requisicao", [item(p.id, "1")], { tipo_operacao_id: tReq, ordem_servico_id: os })), "premissa: a OS fechada não se informa")
      .toEqual([["ordem_servico_id", "Ordem de serviço inválida: escolha uma ordem de serviço aberta ou em andamento da empresa do documento"]]);

    const semReenvio = idDe(await consumo({}));
    const comReenvio = idDe(await consumo({ centro_custo_id: centro, ordem_servico_id: os }));
    for (const id of [semReenvio, comReenvio]) {
      expect(await cabecalho(id), "o mesmo destino gravado, com ou sem o reenvio: o da requisição").toMatchObject({ centro_custo_id: centro, ordem_servico_id: os });
    }
    // Outro valor (não é o herdado) continua recusado no campo.
    expect(detalhes(await consumo({ ordem_servico_id: await osNova() }))).toEqual([["ordem_servico_id", "O destino do consumo é o da requisição de origem"]]);
  });

  it("DF-2b a SAÍDA com destino: o `writeoff` leva o destino; cancelada, o estorno copia o destino inteiro", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const t = await topV5("saida", (x) => { for (const k of Object.keys(x.destino) as (keyof typeof x.destino)[]) x.destino[k] = "opcional"; });
    const d = { centro_custo_id: await centroNovo(), equipamento_id: await equipamentoNovo(), ordem_servico_id: await osNova(),
      lote_animais_id: await loteAnimaisNovo(), area_id: await areaNova(), safra_id: await safraNova() };
    const saida = await lancadoDoc("saida", [item(p.id, "3")], { tipo_operacao_id: t, ...d });
    await confirmadoDoc("saida", saida);
    const destino = { cost_center_id: d.centro_custo_id, harvest_id: d.safra_id, equipamento_id: d.equipamento_id, ordem_servico_id: d.ordem_servico_id,
      lote_animais_id: d.lote_animais_id, area_id: d.area_id };
    expect(await razao(saida)).toEqual([{ movement_type: "writeoff", direction: -1, quantity: "3.0000", unit_cost: "10.000000", ...destino }]);
    const r = await cancelarDoc("saida", saida);
    expect(r.statusCode, r.body).toBe(200);
    expect(await razao(saida)).toEqual([
      { movement_type: "writeoff", direction: -1, quantity: "3.0000", unit_cost: "10.000000", ...destino },
      { movement_type: "reversal", direction: 1, quantity: "3.0000", unit_cost: "10.000000", ...destino },
    ]);
  });
});

describe("DF-3 — a seção Fluxo da TOP no consumo", () => {
  it("DF-3a \"todos os itens\": sem requisição → 422 na origem; item não ligado → 422 no item; todos ligados → salva", async () => {
    const p = await produto(); const q = await produto(); await saldoInicial(p.id, "10"); await saldoInicial(q.id, "10");
    const t = await topV5("consumo", (x) => { x.fluxo.exigeRequisicao = "todos"; });
    const antes = await contarDocumentos();
    const sem = await lancarDoc("consumo", [item(p.id, "1")], { tipo_operacao_id: t });
    expect(detalhes(sem)).toEqual([["origem_documento_id", "Esta operação exige requisição: informe a requisição de origem."]]);
    const req = await lancadoDoc("requisicao", [item(p.id, "4")]); await confirmadoDoc("requisicao", req);
    const itemReq = (await itensNoBanco(req))[0]!.id;
    const comAvulso = await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemReq }), item(q.id, "1")], { tipo_operacao_id: t, origem_documento_id: req });
    expect(detalhes(comAvulso)).toEqual([["itens.1.origem_item_id", "Esta operação exige que todo item venha da requisição."]]);
    expect(await contarDocumentos()).toBe(antes + 1);
    // PREMISSA
    idDe(await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: itemReq })], { tipo_operacao_id: t, origem_documento_id: req }));
  });

  it("DF-3b \"algum item\": com a requisição e nenhum item ligado → 422; \"atende em parte\" desligado: levar parte → 422, levar tudo salva", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const requisicaoConfirmada = async () => {
      const req = await lancadoDoc("requisicao", [item(p.id, "4")]); await confirmadoDoc("requisicao", req);
      return { req, itemReq: (await itensNoBanco(req))[0]!.id };
    };
    const a = await requisicaoConfirmada();
    const algum = await topV5("consumo", (x) => { x.fluxo.exigeRequisicao = "algum_item"; });
    const nenhumLigado = await lancarDoc("consumo", [item(p.id, "1")], { tipo_operacao_id: algum, origem_documento_id: a.req });
    expect(detalhes(nenhumLigado)).toEqual([["itens", "Esta operação exige ao menos um item da requisição."]]);
    // PREMISSA: um item ligado basta (o outro pode ser avulso).
    idDe(await lancarDoc("consumo", [item(p.id, "1", { origem_item_id: a.itemReq }), item(p.id, "1")], { tipo_operacao_id: algum, origem_documento_id: a.req }));

    const b = await requisicaoConfirmada();
    const inteiro = await topV5("consumo", (x) => { x.fluxo.permiteParcial = false; });
    const parte = await lancarDoc("consumo", [item(p.id, "3", { origem_item_id: b.itemReq })], { tipo_operacao_id: inteiro, origem_documento_id: b.req });
    expect(detalhes(parte)).toEqual([["itens", "Esta operação não atende requisição em parte: leve o saldo inteiro de todos os itens pendentes da requisição."]]);
    // PREMISSA: o saldo inteiro passa.
    idDe(await lancarDoc("consumo", [item(p.id, "4", { origem_item_id: b.itemReq })], { tipo_operacao_id: inteiro, origem_documento_id: b.req }));
  });

  it("DF-3c TOP de FORMATO 1 (neutra): o consumo DIRETO (sem requisição) é aceito e confirma como baixa", async () => {
    const t1 = await top(familia("consumo"), { configuracao: configuracaoNeutraTop() });
    const v = (await c.admin.query<{ configuracao_schema_version: number }>(
      "select v.configuracao_schema_version from erp.tipos_operacao t join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual where t.id = $1",
      [t1])).rows[0]!;
    expect(v.configuracao_schema_version, "premissa: a TOP do consumo está no formato 1 (sem as seções: lida no neutro)").toBe(1);
    const p = await produto(); await saldoInicial(p.id, "5");
    const consumo = await lancadoDoc("consumo", [item(p.id, "2")], { tipo_operacao_id: t1 });
    expect((await cabecalho(consumo)).origem_documento_id).toBeNull();
    await confirmadoDoc("consumo", consumo);
    expect((await razao(consumo)).map((m) => [m.movement_type, m.direction, m.quantity])).toEqual([["requisition", -1, "2.0000"]]);
  });
});
