import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  c, iniciar, encerrar, produto, armazem, saldoInicial, saldo, membro, j, unico, DATA,
  familiaDo, topDoModulo, versaoCorrente, post, get, chaves, criado, exigencias, detalhes, escoposComPecuaria,
  loteAnimaisNovo, equipamentoNovo, animalNovo, rebanhoNovo, loteEm, outraOrganizacao, equipamentoEm, dietaEm,
  contador, contar, movimentosDoProduto, movimentosDaOrigem, topGravada, auditorias, type Resposta,
} from "./f10-pecuaria-racao-ajuda.js";

/**
 * OPERACOES-01 F10 (decisão 287) — A API DO MANEJO, DA BATELADA, DA PRODUÇÃO DE RAÇÃO E DA TRANSFERÊNCIA ENTRE EMPRESAS.
 *
 * O que muda nestes módulos, e o que cada caso prova (premissa + conclusão, nunca só o status HTTP):
 *   PM-1..4 manejo — a TOP opcional (versão congelada, exigência geral do registro: a observação), o lote de animais
 *          conferido na organização e no escopo (422 em `batch_id`), a quantidade do produto = dose × CABEÇAS pela conta
 *          do domínio (no cabeçalho e no razão, com o lote de animais como destino), a carência do cadastro do produto e
 *          a capacidade `GET /api/modulos/manejo/operation-types` (403/200, só as TOPs da família, ativas, não excluídas);
 *   PB-1..2 batelada — os itens derivados da dieta (kg × %) pela conta do domínio, o custo pelas partes, a TOP, a
 *          auditoria nova, o vagão conferido (422 em `equipment_id`) e a rota nova dos ingredientes da dieta (a MESMA 404
 *          para malformado, inexistente, de outra organização e excluída; 403 sem `diet_batches.create`);
 *   PR-1    produção de ração — os itens da fórmula × multiplicador pela conta do domínio, a TOP (e a recusa da família
 *          errada, sem queimar código), o detalhe com a TOP e a capacidade;
 *   PT-1    transferência entre empresas — `/livestock/transfers/to-empresa`, a rota que a web chama, passa a existir com o
 *          MESMO handler de `/to-farm` (que continua valendo): mesma resposta, mesmo documento pendente, mesma recusa.
 * As testemunhas são lidas no BANCO por conexão própria de superusuário (sem RLS). Toda recusa vem com a premissa ao
 * lado: o mesmo corpo, corrigido, grava. Respostas dos POST com as MESMAS chaves de antes.
 */

let topManejo = "";
let topManejoObs = "";
let topBatelada = "";
let topRacao = "";

beforeAll(async () => {
  await iniciar();
  // a padrão do manejo é a NEUTRA (formato 5); a outra exige a observação — as duas pela família que o registry declara
  topManejo = await topDoModulo("manejo", { padrao: true });
  topManejoObs = await topDoModulo("manejo", { ajuste: (x) => { x.geral.exigeObservacao = true; } });
  topBatelada = await topDoModulo("batelada");
  topRacao = await topDoModulo("producao_racao");
}, 240_000);
afterAll(encerrar);

const MSG_LOTE = "Lote de animais inválido: escolha um lote da organização.";
const MSG_EQUIPAMENTO = "Equipamento inválido: escolha um equipamento da organização.";
const manejo = (extra: Record<string, unknown>) => ({ empresa_id: c.I.empresa, handling_type: "sanitary", handling_date: DATA, ...extra });

describe("PM — manejo (nutrição e sanitário) com a TOP", () => {
  it("PM-1 sanitário, 3 animais × dose 2, com produto e local: quantidade 6 no cabeçalho e no razão (com o lote de animais), carência do produto, TOP congelada e no detalhe", async () => {
    const p = await produto();
    await c.admin.query("update erp.products set withdrawal_period_days=10 where id=$1", [p.id]);
    await saldoInicial(p.id, "100", { custo: "10" });
    const lote = await loteAnimaisNovo();
    const animais = [await animalNovo(lote), await animalNovo(lote), await animalNovo(lote)];
    expect(await saldo(c.I.warehouse, p.id), "premissa: o saldo de partida").toBe("100.0000");

    const r = await post("/api/livestock/handlings", manejo({ batch_id: lote, product_id: p.id, warehouse_id: c.I.warehouse, dose: "2", tipo_operacao_id: topManejo,
      items: animais.map((a) => ({ animal_id: a, quantity: "1" })) }));
    const id = criado(r, "o manejo sanitário");
    expect(chaves(j(r)), "a resposta tem as MESMAS chaves de antes").toEqual(["animals", "code", "id", "total", "withdrawal_until"]);
    expect(j(r)).toMatchObject({ animals: 3, total: "60.00", withdrawal_until: "2026-09-20" });

    const cab = (await c.admin.query("select quantity::text, animals_count, total::text, withdrawal_until::text from erp.animal_handlings where id=$1", [id])).rows[0];
    expect(cab, "o cabeçalho: dose × cabeças = 2 × 3; a carência são os 10 dias do produto").toEqual({ quantity: "6.0000", animals_count: 3, total: "60.00", withdrawal_until: "2026-09-20" });
    const itens = (await c.admin.query<{ quantity: string }>("select quantity::text from erp.animal_handling_items where handling_id=$1", [id])).rows.map((x) => x.quantity);
    expect(itens, "cada animal: dose × 1 cabeça").toEqual(["2.0000", "2.0000", "2.0000"]);
    const mov = await movimentosDaOrigem("animal_handlings", id);
    expect(mov, "um movimento de 6, com o lote de animais como destino").toEqual([expect.objectContaining({
      movement_type: "nutrition", direction: -1, product_id: p.id, warehouse_id: c.I.warehouse, quantity: "6.0000", total_cost: "60.00", lote_animais_id: lote, equipamento_id: null })]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("94.0000");

    const v = await versaoCorrente(topManejo);
    expect(await topGravada("animal_handlings", id), "a TOP e a versão corrente congeladas no registro").toEqual({ tipo_operacao_id: topManejo, tipo_operacao_versao_id: v.id });
    const det = await get(`/api/livestock/handlings/${id}`);
    expect(det.statusCode, det.body).toBe(200);
    expect(j(det)).toMatchObject({ tipo_operacao_id: topManejo, tipo_operacao_nome: v.nome, tipo_operacao_versao: v.versao, quantity: "6.0000" });
  });

  it("PM-2 por contagem, sem TOP: rebanho de 10 cabeças × dose 0,5 = 5 (como hoje, sem TOP gravada)", async () => {
    const p = await produto();
    await saldoInicial(p.id, "50", { custo: "4" });
    const lote = await loteAnimaisNovo();
    const rebanho = await rebanhoNovo(lote, 10);
    const r = await post("/api/livestock/handlings", manejo({ handling_type: "nutrition", batch_id: lote, product_id: p.id, warehouse_id: c.I.warehouse, dose: "0.5",
      items: [{ herd_lot_id: rebanho, quantity: "10" }] }));
    const id = criado(r, "o manejo de nutrição por contagem");
    expect(chaves(j(r))).toEqual(["animals", "code", "id", "total", "withdrawal_until"]);
    expect(j(r)).toMatchObject({ animals: 10, total: "20.00", withdrawal_until: null });
    const cab = (await c.admin.query("select quantity::text, animals_count from erp.animal_handlings where id=$1", [id])).rows[0];
    expect(cab, "dose × cabeças = 0,5 × 10").toEqual({ quantity: "5.0000", animals_count: 10 });
    expect((await movimentosDaOrigem("animal_handlings", id)).map((m) => [m.movement_type, m.quantity, m.lote_animais_id])).toEqual([["nutrition", "5.0000", lote]]);
    expect(await topGravada("animal_handlings", id), "sem tipo_operacao_id, nenhuma TOP: o manejo de hoje").toEqual({ tipo_operacao_id: null, tipo_operacao_versao_id: null });
  });

  it("PM-3 recusas sem efeito: lote de outra organização, excluído e fora do escopo (422 em batch_id, a mesma superfície); TOP de outra família; TOP 5 que exige a observação sem ela; dose não finita", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "1" });
    const lote = await loteAnimaisNovo();
    const animal = await animalNovo(lote);
    const outra = await outraOrganizacao();
    const loteAlheio = await loteEm(outra.org, outra.empresa);
    const loteExcluido = await loteAnimaisNovo();
    expect((await c.admin.query("update erp.batches set deleted_at=now() where id=$1", [loteExcluido])).rowCount, "premissa: o lote foi excluído").toBe(1);
    const loteDaSegunda = await loteAnimaisNovo({ empresa: c.I.empresa2 });
    const soNaPrimeira = await membro("Manejo só na 1ª", ["nutritions.view", "nutritions.create", "sanitaries.create"], escoposComPecuaria([c.I.empresa]));
    expect((await c.admin.query("select organization_id from erp.batches where id=$1 and status='active' and deleted_at is null", [loteAlheio])).rows[0]?.organization_id,
      "premissa: o lote alheio existe e é válido LÁ").toBe(outra.org);

    const url = "/api/livestock/handlings";
    const corpo = (extra: Record<string, unknown> = {}) => manejo({ batch_id: lote, product_id: p.id, warehouse_id: c.I.warehouse, dose: "1", items: [{ animal_id: animal, quantity: "1" }], ...extra });
    const estado = async () => ({
      manejos: await contar("select count(*)::text n from erp.animal_handlings where organization_id=$1", [c.h.demo.orgId]),
      codigo: await contador("animal_handling"),
      movimentos: await movimentosDoProduto(p.id),
    });
    const antes = await estado();

    const porLote: [string, Resposta][] = [
      ["de outra organização", await post(url, corpo({ batch_id: loteAlheio }))],
      ["excluído", await post(url, corpo({ batch_id: loteExcluido }))],
      ["fora do escopo de quem lança", await post(url, corpo({ batch_id: loteDaSegunda }), soNaPrimeira)],
    ];
    for (const [oque, r] of porLote) {
      expect(r.statusCode, `lote ${oque}: ${r.body}`).toBe(422);
      expect(j(r).error?.code).toBe("VALIDATION_ERROR");
      expect(detalhes(r), `lote ${oque}: no campo`).toEqual([["batch_id", MSG_LOTE]]);
    }
    expect(new Set(porLote.map(([, r]) => r.body)).size, "a mesma superfície: nada distingue o lote alheio do excluído e do fora do escopo").toBe(1);

    const familiaErrada = await post(url, corpo({ tipo_operacao_id: topBatelada }));
    expect(familiaErrada.statusCode, familiaErrada.body).toBe(422);
    expect(j(familiaErrada).error?.code, "a TOP da batelada não lança manejo").toBe("TIPO_OPERACAO_INDISPONIVEL");

    const semObservacao = await post(url, corpo({ tipo_operacao_id: topManejoObs }));
    expect(semObservacao.statusCode, semObservacao.body).toBe(422);
    expect(j(semObservacao).error?.code).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
    expect(exigencias(semObservacao)).toEqual([{ caminho: "note", mensagem: "Observação é obrigatório nesta operação." }]);

    // a dose que `D` aceita mas não é número finito: a conta do domínio a leria como zero — recusada no campo, nunca traduzida
    const doseNaoFinita = await post(url, corpo({ dose: "NaN" }));
    expect(doseNaoFinita.statusCode, doseNaoFinita.body).toBe(422);
    expect(detalhes(doseNaoFinita)).toEqual([["dose", "Valor inválido"]]);

    expect(await estado(), "nenhuma recusa gravou manejo, moveu estoque ou queimou código").toEqual(antes);

    // a premissa: os mesmos corpos, corrigidos, gravam
    const comObservacao = criado(await post(url, corpo({ tipo_operacao_id: topManejoObs, note: "Vacinação de rotina" })), "o manejo com a observação que a TOP exige");
    expect(await topGravada("animal_handlings", comObservacao)).toEqual({ tipo_operacao_id: topManejoObs, tipo_operacao_versao_id: (await versaoCorrente(topManejoObs)).id });
    criado(await post(url, corpo(), soNaPrimeira), "o manejo de quem só vê a 1ª empresa, com o lote dela");
    expect(await movimentosDoProduto(p.id), "os dois lançamentos válidos moveram o estoque").toBe(antes.movimentos + 2);
  });

  it("PM-4 capacidade: GET /api/modulos/manejo/operation-types — 403 sem nutritions.create; 200 só com as TOPs da família, ativas e não excluídas, a padrão primeiro, com os campos que cada uma exige", async () => {
    const familia = familiaDo("manejo");
    const formato1 = await topDoModulo("manejo", { formato1: true });
    const inativa = await topDoModulo("manejo");
    const excluida = await topDoModulo("manejo");
    expect((await c.admin.query("update erp.tipos_operacao set ativo=false where id=$1", [inativa])).rowCount, "premissa: desativada").toBe(1);
    expect((await c.admin.query("update erp.tipos_operacao set excluido_em=now() where id=$1", [excluida])).rowCount, "premissa: excluída").toBe(1);
    const daFamilia = (await c.admin.query<{ id: string }>("select id from erp.tipos_operacao where organization_id=$1 and codigo_base=$2 and ativo and excluido_em is null order by id",
      [c.h.demo.orgId, familia])).rows.map((x) => x.id);
    expect(daFamilia, "premissa: as TOPs válidas do manejo no banco").toEqual(expect.arrayContaining([topManejo, topManejoObs, formato1]));
    expect(daFamilia, "premissa: a desativada e a excluída existem, mas não valem").not.toEqual(expect.arrayContaining([inativa]));
    expect(daFamilia).not.toEqual(expect.arrayContaining([excluida]));

    const url = "/api/modulos/manejo/operation-types";
    const soVe = await membro("Só vê manejo", ["nutritions.view"]);
    const negado = await get(url, soVe);
    expect(negado.statusCode, negado.body).toBe(403);
    expect(j(negado).error?.code).toBe("PERMISSION_DENIED");

    const r = await get(url);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as unknown as { contractVersion: number; capacidades: unknown; family: unknown; defaultId: string | null; items: { id: string; isDefault: boolean; camposExigidos: string[] }[] };
    expect(chaves(corpo)).toEqual(["capacidades", "contractVersion", "defaultId", "family", "items"]);
    expect(corpo.contractVersion).toBe(1);
    expect(corpo.capacidades, "a capacidade que a Central lê").toEqual({ topNoModulo: 1 });
    expect(corpo.family).toEqual({ code: familia, label: "Manejo" });
    expect(corpo.defaultId, "a padrão da família").toBe(topManejo);
    expect(corpo.items.map((x) => x.id).sort(), "só as da família, ativas e não excluídas (a da batelada, a desativada e a excluída ficam de fora)").toEqual(daFamilia);
    expect(corpo.items[0]?.id, "a padrão primeiro").toBe(topManejo);
    expect(chaves(corpo.items[0])).toEqual(["camposExigidos", "code", "id", "isDefault", "name", "version"]);
    const campos = Object.fromEntries(corpo.items.map((x) => [x.id, x.camposExigidos]));
    expect({ obs: campos[topManejoObs], neutra: campos[topManejo], formato1: campos[formato1] }, "o formato 5 que exige a observação aponta a coluna do registro")
      .toEqual({ obs: ["note"], neutra: [], formato1: [] });
  });
});

describe("PB — batelada", () => {
  it("PB-1 dieta 60/40, 100 kg: itens 60 e 40, custo = Σ partes, custo por kg com 6 casas, TOP congelada, auditoria de criação e a lista com a TOP; vagão de outra organização e quilos não finitos recusados sem efeito", async () => {
    const local = await armazem();
    const a = await produto();
    const b = await produto();
    await saldoInicial(a.id, "100", { armazem: local, custo: "2" });
    await saldoInicial(b.id, "100", { armazem: local, custo: "5" });
    const dieta = await dietaEm(c.h.demo.orgId, [{ produto: a.id, percentual: "60" }, { produto: b.id, percentual: "40" }]);
    const vagao = await equipamentoNovo();
    const outra = await outraOrganizacao();
    const vagaoAlheio = await equipamentoEm(outra.org, outra.empresa);
    const corpo = (extra: Record<string, unknown>) => ({ empresa_id: c.I.empresa, batch_date: DATA, diet_id: dieta, warehouse_id: local, quantity_kg: "100", tipo_operacao_id: topBatelada, ...extra });
    const estado = async () => ({
      bateladas: await contar("select count(*)::text n from erp.diet_batches where organization_id=$1", [c.h.demo.orgId]),
      codigo: await contador("diet_batch"),
      movimentos: [await movimentosDoProduto(a.id), await movimentosDoProduto(b.id)],
    });
    const antes = await estado();

    const recusa = await post("/api/feedlot/diet-batches", corpo({ equipment_id: vagaoAlheio }));
    expect(recusa.statusCode, recusa.body).toBe(422);
    expect(j(recusa).error?.code).toBe("VALIDATION_ERROR");
    expect(detalhes(recusa), "o vagão de outra organização, no campo").toEqual([["equipment_id", MSG_EQUIPAMENTO]]);
    // Os quilos que não são número finito: 422 no campo, ANTES do INSERT ("Infinity" estourava o numeric com 500).
    for (const kg of ["Infinity", "-Infinity", "NaN", "abc"]) {
      const r = await post("/api/feedlot/diet-batches", corpo({ quantity_kg: kg, equipment_id: vagao }));
      expect([kg, r.statusCode, j(r).error?.code, detalhes(r)]).toEqual([kg, 422, "VALIDATION_ERROR", [["quantity_kg", "Valor inválido"]]]);
    }
    expect(await estado(), "as recusas não gravaram batelada, não moveram estoque e não queimaram código").toEqual(antes);

    const r = await post("/api/feedlot/diet-batches", corpo({ equipment_id: vagao }));
    const id = criado(r, "a batelada com o vagão da organização");
    expect(chaves(j(r)), "a resposta tem as MESMAS chaves de antes").toEqual(["code", "cost_per_kg", "id", "total_cost"]);
    expect(j(r)).toMatchObject({ total_cost: "320.00", cost_per_kg: "3.200000" });

    const itens = (await c.admin.query("select product_id, quantity_kg::text, unit_cost::text, total_cost::text from erp.diet_batch_items where diet_batch_id=$1 order by quantity_kg desc", [id])).rows;
    expect(itens, "kg × % / 100, com o custo de cada parte").toEqual([
      { product_id: a.id, quantity_kg: "60.0000", unit_cost: "2.000000", total_cost: "120.00" },
      { product_id: b.id, quantity_kg: "40.0000", unit_cost: "5.000000", total_cost: "200.00" },
    ]);
    expect((await movimentosDaOrigem("diet_batches", id)).map((m) => [m.movement_type, m.direction, m.product_id, m.warehouse_id, m.quantity]).sort((x, y) => String(y[4]).localeCompare(String(x[4]))))
      .toEqual([["nutrition", -1, a.id, local, "60.0000"], ["nutrition", -1, b.id, local, "40.0000"]]);
    expect([await saldo(local, a.id), await saldo(local, b.id)]).toEqual(["40.0000", "60.0000"]);
    expect((await c.admin.query("select cost_per_kg::text c from erp.diets where id=$1", [dieta])).rows[0]?.c, "o custo por kg continua gravado na dieta").toBe("3.200000");

    const v = await versaoCorrente(topBatelada);
    expect(await topGravada("diet_batches", id)).toEqual({ tipo_operacao_id: topBatelada, tipo_operacao_versao_id: v.id });
    expect(await auditorias("diet_batches", id), "a criação da batelada passa a ser auditada").toEqual([{ action: "create", metadata: { code: (j(r) as { code: string }).code } }]);

    const lista = await get("/api/feedlot/diet-batches");
    expect(lista.statusCode, lista.body).toBe(200);
    const linha = (j(lista) as unknown as { items: Record<string, unknown>[] }).items.find((x) => x.id === id);
    expect(linha, "a lista traz a batelada com o nome da TOP").toMatchObject({ equipment_id: vagao, tipo_operacao_nome: v.nome, total_cost: "320.00" });
  });

  it("PB-2 ingredientes da dieta: 200 na forma do contrato; a MESMA 404 para id malformado, inexistente, de outra organização e excluída; 403 sem diet_batches.create", async () => {
    const a = await produto();
    const b = await produto();
    const sufixo = unico();
    await c.admin.query("update erp.products set description=$2 where id=$1", [a.id, `F10 Ingrediente A ${sufixo}`]);
    await c.admin.query("update erp.products set description=$2 where id=$1", [b.id, `F10 Ingrediente B ${sufixo}`]);
    // gravados fora da ordem do nome: a resposta ordena pelo produto
    const dieta = await dietaEm(c.h.demo.orgId, [{ produto: b.id, percentual: "40" }, { produto: a.id, percentual: "60" }]);
    const outra = await outraOrganizacao();
    const alheia = await dietaEm(outra.org, [{ produto: a.id, percentual: "100" }]);
    const excluida = await dietaEm(c.h.demo.orgId, [{ produto: a.id, percentual: "100" }]);
    expect((await c.admin.query("update erp.diets set deleted_at=now() where id=$1", [excluida])).rowCount, "premissa: a dieta foi excluída").toBe(1);
    expect(await contar("select count(*)::text n from erp.diet_items where diet_id = any($1::uuid[])", [[alheia, excluida]]), "premissa: as duas têm ingredientes — a 404 não é dieta vazia").toBe(2);

    const url = (id: string) => `/api/modulos/batelada/dietas/${id}/ingredientes`;
    const r = await get(url(dieta));
    expect(r.statusCode, r.body).toBe(200);
    const produtos = (await c.admin.query<{ id: string; code: string; description: string; symbol: string | null }>(
      "select p.id, p.code, p.description, mu.symbol from erp.products p left join erp.measurement_units mu on mu.id=p.measurement_id where p.id = any($1::uuid[])", [[a.id, b.id]])).rows;
    const de = (id: string) => produtos.find((x) => x.id === id)!;
    const cabecalho = (await c.admin.query("select id, code, name from erp.diets where id=$1", [dieta])).rows[0];
    expect(j(r)).toEqual({ ...cabecalho, items: [
      { product_id: a.id, product_code: de(a.id).code, product_name: de(a.id).description, unit: de(a.id).symbol, percentage: "60.0000" },
      { product_id: b.id, product_code: de(b.id).code, product_name: de(b.id).description, unit: de(b.id).symbol, percentage: "40.0000" },
    ] });

    const nao = [
      await get(url("nao-e-uuid")),
      await get(url("00000000-0000-4000-8000-0000000000f1")),
      await get(url(alheia)),
      await get(url(excluida)),
    ];
    for (const x of nao) expect(x.statusCode, x.body).toBe(404);
    expect(new Set(nao.map((x) => x.body)).size, "malformado, inexistente, de outra organização e excluída: o MESMO corpo").toBe(1);
    expect(j(nao[0]!).error).toEqual({ code: "NOT_FOUND", message: "Dieta não encontrada" });

    const soVe = await membro("Só vê batelada", ["diet_batches.view"]);
    for (const u of [url(dieta), "/api/modulos/batelada/operation-types"]) {
      const x = await get(u, soVe);
      expect(x.statusCode, `${u}: ${x.body}`).toBe(403);
      expect(x.body, "nada da dieta sai antes da capacidade").not.toContain(de(a.id).description);
    }
    const cap = await get("/api/modulos/batelada/operation-types");
    expect(cap.statusCode, cap.body).toBe(200);
    expect(j(cap)).toMatchObject({ contractVersion: 1, capacidades: { topNoModulo: 1 }, family: { code: familiaDo("batelada"), label: "Batelada" } });
    expect((j(cap) as unknown as { items: { id: string }[] }).items.map((x) => x.id)).toContain(topBatelada);
  });
});

describe("PR — produção de ração", () => {
  it("PR-1 fórmula × multiplicador 2: itens pela conta do domínio, custo pelas partes, TOP congelada e no detalhe; a TOP de outra família e o multiplicador não finito ou em texto recusados sem queimar código; o cancelamento; capacidade 403/200", async () => {
    const acabado = await produto();
    const i1 = await produto();
    const i2 = await produto();
    await saldoInicial(i1.id, "50", { custo: "4" });
    await saldoInicial(i2.id, "50", { custo: "10" });
    const formula = criado(await post("/api/stock/feed-formulas", { name: `Fórmula F10 ${unico()}`, product_id: acabado.id,
      items: [{ product_id: i1.id, quantity: "3" }, { product_id: i2.id, quantity: "2" }] }), "a fórmula");
    const corpo = (extra: Record<string, unknown>) => ({ empresa_id: c.I.empresa, batch_date: DATA, formula_id: formula, origin_warehouse_id: c.I.warehouse,
      destination_warehouse_id: c.I.warehouse2, quantity_produced: "5", multiplier: "2", ...extra });

    const antes = { codigo: await contador("feed_batch"), movimentos: await movimentosDoProduto(i1.id) };
    const errada = await post("/api/stock/feed-batches", corpo({ tipo_operacao_id: topBatelada }));
    expect(errada.statusCode, errada.body).toBe(422);
    expect(j(errada).error?.code, "a TOP da batelada não lança produção de ração").toBe("TIPO_OPERACAO_INDISPONIVEL");
    // o multiplicador que `D` aceita mas não é número finito: a conta do domínio o trocaria pelo padrão "1" — recusado no campo
    const naoFinito = await post("/api/stock/feed-batches", corpo({ tipo_operacao_id: topRacao, multiplier: "Infinity" }));
    expect(naoFinito.statusCode, naoFinito.body).toBe(422);
    expect(detalhes(naoFinito)).toEqual([["multiplier", "Valor inválido"]]);
    // o texto que não é número (antes, 500 na conta): a mesma recusa no campo
    const texto = await post("/api/stock/feed-batches", corpo({ tipo_operacao_id: topRacao, multiplier: "dois" }));
    expect([texto.statusCode, detalhes(texto)]).toEqual([422, [["multiplier", "Valor inválido"]]]);
    expect({ codigo: await contador("feed_batch"), movimentos: await movimentosDoProduto(i1.id) }, "as recusas não queimaram código nem consumiram matéria-prima").toEqual(antes);

    const r = await post("/api/stock/feed-batches", corpo({ tipo_operacao_id: topRacao }));
    const id = criado(r, "a produção de ração");
    expect(chaves(j(r)), "a resposta tem as MESMAS chaves de antes").toEqual(["code", "id", "production_cost", "unit_cost"]);
    // 3 × 2 × 4 + 2 × 2 × 10 = 24 + 40 = 64; 64 / 5 = 12,8
    expect(j(r)).toMatchObject({ production_cost: "64.00", unit_cost: "12.800000" });
    const itens = (await c.admin.query("select product_id, quantity::text from erp.feed_batch_items where batch_id=$1 order by quantity desc", [id])).rows;
    expect(itens, "quantidade da fórmula × multiplicador").toEqual([{ product_id: i1.id, quantity: "6.0000" }, { product_id: i2.id, quantity: "4.0000" }]);
    const mov = (await movimentosDaOrigem("feed_batches", id)).map((m) => [m.movement_type, m.direction, m.product_id, m.quantity, m.unit_cost]);
    expect(mov.filter((m) => m[1] === -1).sort((x, y) => String(y[3]).localeCompare(String(x[3]))), "a matéria-prima sai da origem")
      .toEqual([["production_out", -1, i1.id, "6.0000", "4.000000"], ["production_out", -1, i2.id, "4.0000", "10.000000"]]);
    expect(mov.filter((m) => m[1] === 1), "o acabado entra pelo custo das partes").toEqual([["production_in", 1, acabado.id, "5.0000", "12.800000"]]);

    const v = await versaoCorrente(topRacao);
    expect(await topGravada("feed_batches", id)).toEqual({ tipo_operacao_id: topRacao, tipo_operacao_versao_id: v.id });
    const det = await get(`/api/stock/feed-batches/${id}`);
    expect(det.statusCode, det.body).toBe(200);
    expect(j(det)).toMatchObject({ tipo_operacao_id: topRacao, tipo_operacao_nome: v.nome, tipo_operacao_versao: v.versao });

    // O cancelamento (ROW COUNT conferido na situação): 200, cancelada, a TOP intacta; o segundo é recusado.
    const cancelar = await post(`/api/stock/feed-batches/${id}/cancel`, {});
    expect([cancelar.statusCode, j(cancelar)], cancelar.body).toEqual([200, { id, status: "cancelled" }]);
    expect((await c.admin.query("select status, tipo_operacao_id from erp.feed_batches where id=$1", [id])).rows).toEqual([{ status: "cancelled", tipo_operacao_id: topRacao }]);
    const deNovo = await post(`/api/stock/feed-batches/${id}/cancel`, {});
    expect([deNovo.statusCode, j(deNovo).error?.code]).toEqual([409, "ALREADY_CANCELLED"]);

    const url = "/api/modulos/producao-racao/operation-types";
    const soVe = await membro("Só vê ração", ["feed_batches.view"]);
    const negado = await get(url, soVe);
    expect(negado.statusCode, negado.body).toBe(403);
    const cap = await get(url);
    expect(cap.statusCode, cap.body).toBe(200);
    expect(j(cap)).toMatchObject({ contractVersion: 1, capacidades: { topNoModulo: 1 }, family: { code: familiaDo("producao_racao"), label: "Produção de ração" } });
    expect((j(cap) as unknown as { items: { id: string }[] }).items.map((x) => x.id)).toContain(topRacao);
  });
});

describe("PT — transferência de rebanho entre empresas", () => {
  it("PT-1 /to-empresa (a rota que a web chama) emite a transferência pendente com a resposta de /to-farm, que continua valendo; a mesma recusa nas duas", async () => {
    const emitir = async (rota: "to-empresa" | "to-farm") => {
      const lote = await loteAnimaisNovo();
      const animais = [await animalNovo(lote), await animalNovo(lote)];
      // o corpo que a tela de transferência entre empresas manda no modo "lote" (`features/livestock/transfer-empresa.tsx`)
      const r = await post(`/api/livestock/transfers/${rota}`, { empresa_id: c.I.empresa, empresa_destino_id: c.I.empresa2, movement_date: DATA, batch_id: lote, destination_batch_id: null, note: null });
      return { r, lote, animais };
    };
    for (const rota of ["to-empresa", "to-farm"] as const) {
      const { r, lote, animais } = await emitir(rota);
      const id = criado(r, `a transferência por /${rota}`);
      expect(chaves(j(r)), `/${rota}: as chaves da resposta`).toEqual(["animals", "code", "heads", "herd_lots", "id", "status"]);
      expect(j(r)).toMatchObject({ animals: 2, herd_lots: 0, heads: 2, status: "pending" });
      const m = (await c.admin.query("select movement_type, status, empresa_id, empresa_destino_id, batch_id, quantity from erp.animal_movements where id=$1", [id])).rows[0];
      expect(m, `/${rota}: o documento pendente`).toEqual({ movement_type: "farm_transfer", status: "pending", empresa_id: c.I.empresa, empresa_destino_id: c.I.empresa2, batch_id: lote, quantity: 2 });
      const itens = (await c.admin.query<{ animal_id: string }>("select animal_id from erp.animal_movement_items where movement_id=$1 order by animal_id", [id])).rows.map((x) => x.animal_id);
      expect(itens, `/${rota}: os animais do lote`).toEqual([...animais].sort());
      expect(await contar("select count(*)::text n from erp.notifications where kind='batch_transfer' and entidade_origem='animal_movements' and id_origem=$1 and empresa_id=$2", [id, c.I.empresa2]),
        `/${rota}: o aviso vai para a empresa de destino`).toBe(1);
    }
    const mesma = { empresa_id: c.I.empresa, empresa_destino_id: c.I.empresa, movement_date: DATA, batch_id: await loteAnimaisNovo() };
    const recusas = [await post("/api/livestock/transfers/to-empresa", mesma), await post("/api/livestock/transfers/to-farm", mesma)];
    for (const x of recusas) expect(x.statusCode, x.body).toBe(422);
    expect(recusas[0]!.body, "o MESMO handler: a mesma recusa, o mesmo corpo").toBe(recusas[1]!.body);
  });
});
