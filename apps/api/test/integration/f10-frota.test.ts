import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTop } from "@agro/domain";
import {
  c, iniciar, encerrar, produto, armazem, saldoInicial, saldo, membro, j, unico, DATA,
  cfg5, centroNovo, safraNova, equipamentoNovo, erro, forma, detalhes,
  familiaDo, topDoModulo, topV5DoModulo, novaVersaoDaTop, excluirTop, versaoCorrente,
  tiposDoModulo, abastecer, lerAbastecimento, cancelarAbastecimento, manter, lerManutencao, cancelarManutencao,
  abrirOs, editarOs, lerOs, situacaoDaOs, criado, exigencias, escoposCom,
  equipamentoDeOutraOrganizacao, excluirEquipamento, preventiva,
  abastecimentoNoBanco, manutencaoNoBanco, osNoBanco, itensDaManutencao, razaoDaOrigem, movimentosDoProduto,
  abastecimentosDoProduto, contar, ultimoCodigo, contadorDoBem, preventivaNoBanco, acoesAuditadas,
} from "./f10-frota-ajuda.js";

/**
 * OPERACOES-01 F10 (decisão 287) — A FROTA NA API: abastecimento, manutenção e ordem de serviço com a TOP no próprio
 * registro, o destino no razão, o equipamento conferido, o contador do bem pelo horímetro/km e a OS idempotente e
 * editável (plano F10 §1.3.2–§1.3.5, §1.3.8, §1.4; casos FA-1..5, FM-1..3, FO-1..3).
 *
 *   · FA-1 a capacidade do abastecimento (403/200, a forma exata, só a família ativa e não excluída, os campos exigidos);
 *   · FA-2 com local e TOP: a versão CORRENTE congelada; o razão grava equipamento, centro e safra em cada parte;
 *   · FA-3 sem local: não baixa; o contador do bem pelo km, pelo horímetro, e nunca desce;
 *   · FA-4 as recusas não gravam nada nem queimam código (TOP de outra família, exigência, equipamento de fora);
 *   · FA-5 o cancelamento estorna com o destino e é auditado;
 *   · FA-6 o horímetro e o km na forma canônica: "6e3" e "+6100" gravam e sobem o contador; o não finito é 422 no campo;
 *   · FM-1 manutenção com duas máquinas: destino por item (a máquina) e a safra; o item SEM local grava; observação;
 *          preventivas; contador;
 *   · FM-2 a TOP que exige observação; a máquina de fora no caminho dela; a capacidade da manutenção;
 *   · FM-3 o cancelamento estorna com o destino;
 *   · FO-1 OS com TOP e Idempotency-Key: um registro só, auditado; a capacidade da OS;
 *   · FO-2 a edição em aberta e em andamento; a TOP não muda; a encerrada não edita; a exigência da versão CONGELADA;
 *   · FO-3 finalizar baixa só insumo/EPI com local, com centro, safra e a própria OS.
 *
 * O QUE CONTA COMO PROVA (o molde da F5a): registro, razão, contador do bem, trilha e contador de código LIDOS NO
 * BANCO pela testemunha (`c.admin`, superusuário sem RLS); "nada gravado" vem sempre com a premissa — o MESMO corpo,
 * corrigido, grava. As mensagens esperadas estão escritas AQUI, à mão: um domínio errado não se aprova sozinho. A
 * família de cada módulo é perguntada ao registry (`familiaDo`), nunca escrita.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const MSG = {
  equipamento: "Equipamento inválido: escolha um equipamento da organização.",
  topIndisponivel: "Tipo de operação indisponível para este lançamento",
  exigencia: "A operação exige dados que o documento não tem.",
  topDaOsNaoMuda: "O tipo de operação da OS não muda depois do lançamento.",
} as const;

type Item = { id: string; code: string; name: string; version: number; isDefault: boolean; camposExigidos: string[] };
type Tipos = { contractVersion: number; capacidades: unknown; family: unknown; defaultId: string | null; items: Item[] };

/** A TOP no registro e na linha da versão: as duas colunas da migration dos módulos com TOP. */
const comTop = (topId: string | null, versaoId: string | null) => ({ tipo_operacao_id: topId, tipo_operacao_versao_id: versaoId });

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// ABASTECIMENTO
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FA — abastecimento", () => {
  it("FA-1 capacidade: 403 sem fuel_supplies.create; 200 com a forma exata, só as TOPs da família ativas e não excluídas (a padrão primeiro) e os campos que a versão exige", async () => {
    const familia = familiaDo("abastecimento");
    const semCriar = await membro("Frota leitura F10", ["fuel_supplies.view"]);
    const negado = await tiposDoModulo("abastecimento", semCriar);
    expect(negado.statusCode, negado.body).toBe(403);
    expect(erro(negado).code).toBe("PERMISSION_DENIED");
    expect(negado.body, "nada da capacidade sai antes da permissão").not.toContain("topNoModulo");
    const comCriar = await membro("Frota lança F10", ["fuel_supplies.create"]);
    const aceito = await tiposDoModulo("abastecimento", comCriar);
    expect(aceito.statusCode, `premissa: com fuel_supplies.create, um membro igual lê — ${aceito.body}`).toBe(200);

    const padrao = await topV5DoModulo("abastecimento", undefined, { padrao: true, nome: "Abastecimento padrão F10" });
    const exigeCentro = await topV5DoModulo("abastecimento", (x) => { x.geral.exigeCentroResultado = true; });
    const neutra = await topV5DoModulo("abastecimento");
    const formato1 = await topDoModulo("abastecimento", { configuracao: configuracaoNeutraTop() });
    const inativa = await topV5DoModulo("abastecimento", undefined, { ativo: false });
    const excluida = await topV5DoModulo("abastecimento");
    await excluirTop(excluida);
    const daManutencao = await topV5DoModulo("manutencao");

    const r = await tiposDoModulo("abastecimento");
    expect(r.statusCode, r.body).toBe(200);
    const corpo = j(r) as unknown as Tipos;
    expect(Object.keys(corpo), "a forma exata, nesta ordem").toEqual(["contractVersion", "capacidades", "family", "defaultId", "items"]);
    expect(corpo.contractVersion).toBe(1);
    expect(corpo.capacidades).toEqual({ topNoModulo: 1 });
    expect(corpo.family).toEqual({ code: familia, label: "Abastecimento" });
    expect(corpo.defaultId).toBe(padrao);
    expect(corpo.items[0]?.id, "a padrão vem primeiro").toBe(padrao);
    const porId = new Map(corpo.items.map((x) => [x.id, x]));
    expect(porId.get(padrao)).toEqual({ id: padrao, code: expect.any(String), name: "Abastecimento padrão F10", version: 1, isDefault: true, camposExigidos: [] });
    expect(Object.keys(porId.get(padrao)!), "a forma exata de cada item").toEqual(["id", "code", "name", "version", "isDefault", "camposExigidos"]);
    expect(porId.get(exigeCentro)?.camposExigidos, "formato 5 com o centro exigido").toEqual(["cost_center_id"]);
    expect(porId.get(neutra)?.camposExigidos, "formato 5 neutro").toEqual([]);
    expect(porId.get(formato1)?.camposExigidos, "formato 1 não exige nada").toEqual([]);
    for (const fora of [inativa, excluida, daManutencao]) expect(porId.has(fora), `fora da lista: ${fora}`).toBe(false);

    // Premissa das ausências: as três EXISTEM no banco — a inativa e a excluída na família do abastecimento.
    const banco = await c.admin.query<{ id: string; codigo_base: string; ativo: boolean; excluida: boolean }>(
      "select id, codigo_base, ativo, excluido_em is not null as excluida from erp.tipos_operacao where id = any($1::uuid[])", [[...porId.keys(), inativa, excluida, daManutencao]]);
    const noBanco = new Map(banco.rows.map((x) => [x.id, x]));
    expect(noBanco.get(inativa)).toMatchObject({ codigo_base: familia, ativo: false, excluida: false });
    expect(noBanco.get(excluida)).toMatchObject({ codigo_base: familia, excluida: true });
    expect(noBanco.get(daManutencao)?.codigo_base).toBe(familiaDo("manutencao"));
    // Cada item listado é da família, ativo e não excluído.
    for (const id of porId.keys()) expect(noBanco.get(id), `item ${id}`).toMatchObject({ codigo_base: familia, ativo: true, excluida: false });
  });

  it("FA-2 com local e TOP 5: 201 com as chaves de hoje; a versão CORRENTE congelada; o razão grava equipamento, centro e safra em cada parte; total = Σ partes; o detalhe devolve nome e versão da TOP", async () => {
    const p = await produto({ lote: "lote_validade" });
    const local = await armazem();
    await saldoInicial(p.id, "30", { armazem: local, custo: "6", lote: "L-A", validade: "2026-12-01" });
    await saldoInicial(p.id, "30", { armazem: local, custo: "7", lote: "L-B", validade: "2027-01-01" });
    const [equipamento, centro, safra] = [await equipamentoNovo(), await centroNovo(), await safraNova()];
    // A v1 exige observação e a v2 (a corrente) é a neutra: o lançamento SEM observação só passa com a versão corrente.
    const topId = await topV5DoModulo("abastecimento", (x) => { x.geral.exigeObservacao = true; }, { nome: "Abastecimento F10 FA-2" });
    expect(await novaVersaoDaTop(topId, cfg5()), "premissa: a TOP ganhou a versão 2").toBe(2);
    const corrente = await versaoCorrente(topId);
    expect(corrente.versao, "premissa: a corrente é a 2").toBe(2);

    const r = await abastecer({ empresa_id: c.I.empresa, supply_date: DATA, equipment_id: equipamento, warehouse_id: local, product_id: p.id, quantity: "50",
      cost_center_id: centro, harvest_id: safra, tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = j(r) as { id: string; code: string; total: string };
    expect(Object.keys(corpo).sort(), "as MESMAS chaves de hoje").toEqual(["code", "id", "total"]);
    // A saída sem lote escolhe os lotes pela validade: 30 do L-A a 6 e 20 do L-B a 7.
    expect(corpo.total, "Σ partes = 180 + 140").toBe("320.00");
    expect(await abastecimentoNoBanco(corpo.id)).toMatchObject({ ...comTop(topId, corrente.id), total: "320.00", unit_value: "6.400000", status: "confirmed" });
    const destino = { cost_center_id: centro, harvest_id: safra, equipamento_id: equipamento, ordem_servico_id: null, lote_animais_id: null, area_id: null };
    expect(await razaoDaOrigem("fuel_supplies", corpo.id)).toEqual([
      { movement_type: "fuel_supply", direction: -1, quantity: "30.0000", unit_cost: "6.000000", valor: "180.00", product_id: p.id, warehouse_id: local, provider_lot: "L-A", ...destino },
      { movement_type: "fuel_supply", direction: -1, quantity: "20.0000", unit_cost: "7.000000", valor: "140.00", product_id: p.id, warehouse_id: local, provider_lot: "L-B", ...destino },
    ]);
    expect(await saldo(local, p.id), "o local baixou 50").toBe("10.0000");

    const d = await lerAbastecimento(corpo.id);
    expect(d.statusCode, d.body).toBe(200);
    expect(corrente.nome, "premissa: o nome da versão corrente é o do cadastro").toBe("Abastecimento F10 FA-2");
    expect(j(d)).toMatchObject({ id: corpo.id, ...comTop(topId, corrente.id), tipo_operacao_nome: "Abastecimento F10 FA-2", tipo_operacao_versao: 2, equipment_id: equipamento });
    expect(await acoesAuditadas("fuel_supplies", corpo.id)).toEqual(["create"]);
  });

  it("FA-3 sem local: nenhum movimento e total = quantidade × unitário; só o km sobe o contador; com os dois vale o horímetro; leitura menor não desce nem toca o bem", async () => {
    const p = await produto();
    const equipamento = await equipamentoNovo();
    expect((await contadorDoBem(equipamento)).hour_meter, "premissa: o bem nasce sem contador").toBeNull();
    const corpo = (extra: Record<string, unknown>) => ({ empresa_id: c.I.empresa, supply_date: DATA, equipment_id: equipamento, product_id: p.id, quantity: "10", unit_value: "6.5", ...extra });

    const a = await criado(abastecer(corpo({ mileage: "5000" })));
    expect(a.total).toBe("65.00");
    expect(await abastecimentoNoBanco(a.id)).toMatchObject({ ...comTop(null, null), unit_value: "6.500000", total: "65.00" });
    expect(await razaoDaOrigem("fuel_supplies", a.id), "sem local, não baixa").toEqual([]);
    expect(await movimentosDoProduto(p.id)).toBe(0);
    expect((await contadorDoBem(equipamento)).hour_meter, "só o km: ele sobe o contador do bem").toBe("5000.00");

    await criado(abastecer(corpo({ hour_meter: "5100", mileage: "9000" })));
    expect((await contadorDoBem(equipamento)).hour_meter, "os dois: vale o horímetro, não o km").toBe("5100.00");

    const antes = await contadorDoBem(equipamento);
    await criado(abastecer(corpo({ hour_meter: "100" })));
    expect(await contadorDoBem(equipamento), "leitura menor: o contador não desce e o bem não é tocado").toEqual(antes);
    expect(await abastecimentosDoProduto(p.id), "premissa: os três foram gravados").toBe(3);
  });

  it("FA-4 recusas sem efeito (nem linha, nem movimento, nem código): TOP de outra família ou inativa, exigência da TOP, equipamento de outra organização, excluído ou fora do escopo; o mesmo corpo corrigido grava", async () => {
    const p = await produto();
    await saldoInicial(p.id, "100", { custo: "5" });
    const [equipamento, centro] = [await equipamentoNovo(), await centroNovo()];
    const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: c.I.empresa, supply_date: DATA, equipment_id: equipamento, warehouse_id: c.I.warehouse, product_id: p.id, quantity: "4", ...extra });
    const codigoAntes = await ultimoCodigo("fuel_supply");
    const movimentosAntes = await movimentosDoProduto(p.id);
    expect(movimentosAntes, "premissa: só o saldo inicial").toBe(1);

    // TOP de outra família e TOP inativa: a MESMA recusa.
    const outraFamilia = await abastecer(corpo({ tipo_operacao_id: await topV5DoModulo("manutencao") }));
    expect(erro(outraFamilia)).toEqual({ status: 422, code: "TIPO_OPERACAO_INDISPONIVEL", message: MSG.topIndisponivel });
    const inativa = await abastecer(corpo({ tipo_operacao_id: await topV5DoModulo("abastecimento", undefined, { ativo: false }) }));
    expect(forma(inativa), "inativa = outra família, indistinguíveis").toEqual(forma(outraFamilia));

    // A exigência da TOP (formato 5): sem o centro, 422 com o caminho e a mensagem do rótulo.
    const exigeCentro = await topV5DoModulo("abastecimento", (x) => { x.geral.exigeCentroResultado = true; });
    const semCentro = await abastecer(corpo({ tipo_operacao_id: exigeCentro }));
    expect(erro(semCentro)).toEqual({ status: 422, code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.exigencia });
    expect(exigencias(semCentro)).toEqual([{ caminho: "cost_center_id", mensagem: "Centro de resultado é obrigatório nesta operação." }]);

    // O equipamento: de outra organização, excluído, ou fora do escopo de frota de quem lança — a MESMA recusa.
    const deOutraOrg = await abastecer(corpo({ equipment_id: await equipamentoDeOutraOrganizacao() }));
    expect(forma(deOutraOrg)).toEqual([422, "VALIDATION_ERROR", MSG.equipamento, JSON.stringify([{ path: "equipment_id", message: MSG.equipamento }])]);
    const excluido = await equipamentoNovo();
    await excluirEquipamento(excluido);
    expect(forma(await abastecer(corpo({ equipment_id: excluido }))), "excluído = de outra organização").toEqual(forma(deOutraOrg));
    const soEmpresa2 = await membro("Frota só empresa 2 F10", ["fuel_supplies.create"], escoposCom({ frota_ativos: [c.I.empresa2] }));
    const doOutroEscopo = { empresa_id: c.I.empresa2, supply_date: DATA, product_id: p.id, quantity: "4" };
    expect(forma(await abastecer({ ...doOutroEscopo, equipment_id: equipamento }, soEmpresa2)), "fora do escopo = de outra organização").toEqual(forma(deOutraOrg));

    // Nada foi gravado, nada saiu do estoque e nenhum código foi queimado.
    expect(await abastecimentosDoProduto(p.id)).toBe(0);
    expect(await movimentosDoProduto(p.id)).toBe(movimentosAntes);
    expect(await ultimoCodigo("fuel_supply"), "nenhuma recusa queima código").toBe(codigoAntes);

    // Premissas: os MESMOS corpos, corrigidos, gravam.
    const comCentro = await criado(abastecer(corpo({ tipo_operacao_id: exigeCentro, cost_center_id: centro })));
    expect(Number(comCentro.code), "o próximo código é o seguinte ao de antes das recusas").toBe(codigoAntes + 1);
    expect(await abastecimentoNoBanco(comCentro.id)).toMatchObject(comTop(exigeCentro, (await versaoCorrente(exigeCentro)).id));
    const daEmpresa2 = await equipamentoNovo({ empresa: c.I.empresa2 });
    await criado(abastecer({ ...doOutroEscopo, equipment_id: daEmpresa2 }, soEmpresa2));
    const semTop = await criado(abastecer(corpo()));
    expect(await abastecimentoNoBanco(semTop.id), "sem TOP, como hoje").toMatchObject(comTop(null, null));
    expect(await abastecimentosDoProduto(p.id)).toBe(3);
  });

  it("FA-5 cancelar: o estorno copia equipamento, centro e safra; o cancelamento é auditado; o segundo é recusado sem nova trilha", async () => {
    const p = await produto();
    await saldoInicial(p.id, "20", { custo: "8" });
    const [equipamento, centro, safra] = [await equipamentoNovo(), await centroNovo(), await safraNova()];
    const topId = await topV5DoModulo("abastecimento");
    const a = await criado(abastecer({ empresa_id: c.I.empresa, supply_date: DATA, equipment_id: equipamento, warehouse_id: c.I.warehouse, product_id: p.id, quantity: "5",
      cost_center_id: centro, harvest_id: safra, tipo_operacao_id: topId }));
    expect(await saldo(c.I.warehouse, p.id), "premissa: baixou 5").toBe("15.0000");

    const r = await cancelarAbastecimento(a.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: a.id, status: "cancelled" });
    const destino = { cost_center_id: centro, harvest_id: safra, equipamento_id: equipamento, ordem_servico_id: null, lote_animais_id: null, area_id: null };
    expect((await razaoDaOrigem("fuel_supplies", a.id)).map((m) => ({ tipo: m.movement_type, direction: m.direction, quantity: m.quantity, cost_center_id: m.cost_center_id,
      harvest_id: m.harvest_id, equipamento_id: m.equipamento_id, ordem_servico_id: m.ordem_servico_id, lote_animais_id: m.lote_animais_id, area_id: m.area_id }))).toEqual([
      { tipo: "fuel_supply", direction: -1, quantity: "5.0000", ...destino },
      { tipo: "reversal", direction: 1, quantity: "5.0000", ...destino },
    ]);
    expect(await saldo(c.I.warehouse, p.id), "o estorno devolveu").toBe("20.0000");
    expect(await abastecimentoNoBanco(a.id), "a TOP não muda no cancelamento").toMatchObject({ status: "cancelled", tipo_operacao_id: topId });
    expect(await acoesAuditadas("fuel_supplies", a.id)).toEqual(["create", "cancel"]);

    const deNovo = await cancelarAbastecimento(a.id);
    expect(erro(deNovo)).toMatchObject({ status: 409, code: "ALREADY_CANCELLED" });
    expect(await acoesAuditadas("fuel_supplies", a.id), "a recusa não audita").toEqual(["create", "cancel"]);
  });
  it("FA-6 horímetro e km na forma canônica: \"6e3\" e \"+6100\" gravam no registro e sobem o contador do bem; NaN, Infinity e texto são 422 no campo, sem gravar nem queimar código", async () => {
    const p = await produto();
    const equipamento = await equipamentoNovo();
    const corpo = (extra: Record<string, unknown>) => ({ empresa_id: c.I.empresa, supply_date: DATA, equipment_id: equipamento, product_id: p.id, quantity: "10", unit_value: "6.5", ...extra });
    const horimetroGravado = async (id: string) => (await c.admin.query<{ h: string | null; k: string | null }>("select hour_meter::text h, mileage::text k from erp.fuel_supplies where id=$1", [id])).rows[0];

    // A forma que o banco gravava e o contador ignorava (antes do conserto, o registro dizia 6000 e o bem não subia).
    const exp = await criado(abastecer(corpo({ hour_meter: "6e3" })));
    expect(await horimetroGravado(exp.id)).toEqual({ h: "6000.00", k: null });
    expect((await contadorDoBem(equipamento)).hour_meter, "\"6e3\" sobe o contador como 6000").toBe("6000.00");
    const sinal = await criado(abastecer(corpo({ mileage: " +6100 " })));
    expect(await horimetroGravado(sinal.id), "o km aparado e sem o sinal").toEqual({ h: null, k: "6100.00" });
    expect((await contadorDoBem(equipamento)).hour_meter, "só o km \"+6100\": ele sobe o contador").toBe("6100.00");

    // O que não é número finito é recusado no campo — nada gravado, o contador intacto, nenhum código queimado.
    const [codigoAntes, contadorAntes] = [await ultimoCodigo("fuel_supply"), await contadorDoBem(equipamento)];
    for (const [campo, valor] of [["hour_meter", "NaN"], ["hour_meter", "Infinity"], ["mileage", "-Infinity"], ["mileage", "abc"]] as const) {
      const r = await abastecer(corpo({ [campo]: valor }));
      expect([campo, valor, erro(r), detalhes(r)]).toEqual([campo, valor, { status: 422, code: "VALIDATION_ERROR", message: "Valor inválido" }, [[campo, "Valor inválido"]]]);
    }
    expect(await abastecimentosDoProduto(p.id), "premissa: só os dois de cima foram gravados").toBe(2);
    expect(await contadorDoBem(equipamento), "o contador do bem não foi tocado").toEqual(contadorAntes);
    expect(await ultimoCodigo("fuel_supply"), "nenhuma recusa queima código").toBe(codigoAntes);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// MANUTENÇÃO
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FM — manutenção", () => {
  it("FM-1 duas máquinas: o razão grava a máquina de cada item e a safra; o item SEM local grava (total 20) e aparece no detalhe; observação e TOP gravadas e lidas; preventivas e contador pelo km/horímetro", async () => {
    const p1 = await produto();
    await saldoInicial(p1.id, "10", { custo: "12" });
    const p2 = await produto();
    const [maquinaA, maquinaB, safra] = [await equipamentoNovo(), await equipamentoNovo(), await safraNova()];
    const [planoA, planoB] = [await preventiva(maquinaA, "km"), await preventiva(maquinaB, "hours")];
    const topId = await topV5DoModulo("manutencao", undefined, { nome: "Manutenção F10 FM-1" });
    const corrente = await versaoCorrente(topId);

    const r = await manter({ empresa_id: c.I.empresa, maintenance_date: DATA, harvest_id: safra, note: "Troca de óleo e filtros", tipo_operacao_id: topId, machines: [
      { equipment_id: maquinaA, mileage: "800", maintenance_type: "employee", executor_person_id: c.I.employee, hours: "2", service_total: "150", service_description: "Troca de óleo", items: [
        { warehouse_id: c.I.warehouse, product_id: p1.id, quantity: "3" },
        { product_id: p2.id, quantity: "2", unit_value: "10", note: "Filtro comprado na cidade" },
      ] },
      { equipment_id: maquinaB, hour_meter: "150", service_total: "50", items: [{ warehouse_id: c.I.warehouse, product_id: p1.id, quantity: "1" }] },
    ] });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = j(r) as { id: string; code: string; total_parts: string; total_services: string };
    expect(Object.keys(corpo).sort(), "as MESMAS chaves de hoje").toEqual(["code", "id", "total_parts", "total_services"]);
    expect(corpo).toMatchObject({ total_parts: "68.00", total_services: "200.00" }); // 3 × 12 + 2 × 10 + 1 × 12

    expect(await manutencaoNoBanco(corpo.id)).toMatchObject({ ...comTop(topId, corrente.id), note: "Troca de óleo e filtros", total_parts: "68.00", total_services: "200.00" });
    const itens = await itensDaManutencao(corpo.id);
    expect(itens).toHaveLength(3);
    expect(itens).toEqual(expect.arrayContaining([
      { equipment_id: maquinaA, product_id: p1.id, warehouse_id: c.I.warehouse, quantity: "3.0000", unit_value: "12.000000", total: "36.00" },
      { equipment_id: maquinaA, product_id: p2.id, warehouse_id: null, quantity: "2.0000", unit_value: "10.000000", total: "20.00" },
      { equipment_id: maquinaB, product_id: p1.id, warehouse_id: c.I.warehouse, quantity: "1.0000", unit_value: "12.000000", total: "12.00" },
    ]));
    const semDestino = { cost_center_id: null, ordem_servico_id: null, lote_animais_id: null, area_id: null, provider_lot: null };
    expect(await razaoDaOrigem("maintenances", corpo.id), "um movimento por item COM local, com a máquina do item e a safra").toEqual([
      { movement_type: "maintenance", direction: -1, quantity: "1.0000", unit_cost: "12.000000", valor: "12.00", product_id: p1.id, warehouse_id: c.I.warehouse, harvest_id: safra, equipamento_id: maquinaB, ...semDestino },
      { movement_type: "maintenance", direction: -1, quantity: "3.0000", unit_cost: "12.000000", valor: "36.00", product_id: p1.id, warehouse_id: c.I.warehouse, harvest_id: safra, equipamento_id: maquinaA, ...semDestino },
    ]);
    expect(await movimentosDoProduto(p2.id), "o item sem local não baixa").toBe(0);
    expect((await contadorDoBem(maquinaA)).hour_meter, "máquina A: só o km, ele sobe o contador").toBe("800.00");
    expect((await contadorDoBem(maquinaB)).hour_meter, "máquina B: o horímetro").toBe("150.00");
    expect(await preventivaNoBanco(planoA), "a preventiva por km da máquina A").toEqual({ last_done_date: DATA, last_done_value: "800.00" });
    expect(await preventivaNoBanco(planoB), "a preventiva por horas da máquina B").toEqual({ last_done_date: DATA, last_done_value: "150.00" });

    // O detalhe (lido pela API, como erp_app, sob a política nova de maintenance_items): a observação, a TOP e o item sem local.
    const d = await lerManutencao(corpo.id);
    expect(d.statusCode, d.body).toBe(200);
    const lido = j(d) as Record<string, unknown> & { machines: { equipment_id: string; items: { product_id: string; warehouse_id: string | null; quantity: unknown; total: unknown; note: string | null }[] | null }[] };
    expect(lido).toMatchObject({ note: "Troca de óleo e filtros", ...comTop(topId, corrente.id), tipo_operacao_nome: "Manutenção F10 FM-1", tipo_operacao_versao: 1 });
    const daMaquinaA = lido.machines.find((m) => m.equipment_id === maquinaA);
    expect(daMaquinaA?.items, "premissa: a máquina A tem os dois itens").toHaveLength(2);
    const semLocal = daMaquinaA!.items!.find((i) => i.product_id === p2.id);
    expect(semLocal, "o item sem local é visível no detalhe da própria manutenção").toMatchObject({ warehouse_id: null, note: "Filtro comprado na cidade" });
    expect(String(semLocal!.total)).toBe("20");
    expect(await acoesAuditadas("maintenances", corpo.id)).toEqual(["create"]);
  });

  it("FM-2 TOP 5 que exige observação: sem ela (ou em branco) 422 no caminho note; máquina de fora 422 no caminho dela; nada gravado nem código queimado; corrigido grava; a capacidade da manutenção (200/403)", async () => {
    const exigeObs = await topV5DoModulo("manutencao", (x) => { x.geral.exigeObservacao = true; });
    const [maquina, deOutraOrg] = [await equipamentoNovo(), await equipamentoDeOutraOrganizacao()];
    const p = await produto();
    await saldoInicial(p.id, "5", { custo: "3" });
    const maquinaOk = { equipment_id: maquina, hour_meter: "40", items: [{ warehouse_id: c.I.warehouse, product_id: p.id, quantity: "1" }] };
    const corpo = (extra: Record<string, unknown> = {}) => ({ empresa_id: c.I.empresa, maintenance_date: DATA, tipo_operacao_id: exigeObs, machines: [maquinaOk], ...extra });
    const [codigoAntes, quantasAntes, contadorAntes, movimentosAntes] = [await ultimoCodigo("maintenance"), await contar("maintenances"), await contadorDoBem(maquina), await movimentosDoProduto(p.id)];

    for (const note of [undefined, "   "]) {
      const r = await manter(corpo(note === undefined ? {} : { note }));
      expect(erro(r), `observação ${JSON.stringify(note)}`).toEqual({ status: 422, code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.exigencia });
      expect(exigencias(r)).toEqual([{ caminho: "note", mensagem: "Observação é obrigatório nesta operação." }]);
    }
    const foraDaOrg = await manter(corpo({ note: "Revisão", machines: [maquinaOk, { equipment_id: deOutraOrg }] }));
    expect(forma(foraDaOrg), "a recusa aponta a máquina de fora").toEqual([422, "VALIDATION_ERROR", MSG.equipamento, JSON.stringify([{ path: "machines.1.equipment_id", message: MSG.equipamento }])]);
    const longa = await manter(corpo({ note: "x".repeat(2001) }));
    expect(longa.statusCode, longa.body).toBe(422);
    expect((j(longa).error?.details as { path: string }[]).map((x) => x.path)).toEqual(["note"]);

    expect(await contar("maintenances"), "nenhuma manutenção gravada").toBe(quantasAntes);
    expect(await ultimoCodigo("maintenance"), "nenhum código queimado").toBe(codigoAntes);
    expect(await movimentosDoProduto(p.id), "nada saiu do estoque").toBe(movimentosAntes);
    expect(await contadorDoBem(maquina), "o contador da máquina não mudou").toEqual(contadorAntes);

    const ok = await criado(manter(corpo({ note: "Revisão de 40 horas" })));
    expect(Number(ok.code)).toBe(codigoAntes + 1);
    expect(await manutencaoNoBanco(ok.id)).toMatchObject({ ...comTop(exigeObs, (await versaoCorrente(exigeObs)).id), note: "Revisão de 40 horas" });
    expect((await contadorDoBem(maquina)).hour_meter).toBe("40.00");

    // A capacidade da manutenção.
    const semCriar = await membro("Manutenção leitura F10", ["maintenances.view"]);
    expect(erro(await tiposDoModulo("manutencao", semCriar))).toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    const t = await tiposDoModulo("manutencao");
    expect(t.statusCode, t.body).toBe(200);
    const tipos = j(t) as unknown as Tipos;
    expect(tipos).toMatchObject({ contractVersion: 1, capacidades: { topNoModulo: 1 }, family: { code: familiaDo("manutencao"), label: "Manutenção" } });
    expect(tipos.items.find((x) => x.id === exigeObs)?.camposExigidos).toEqual(["note"]);
  });

  it("FM-3 cancelar: o estorno copia a máquina e a safra; o local volta; o cancelamento é auditado", async () => {
    const p = await produto();
    await saldoInicial(p.id, "10", { custo: "4" });
    const [maquina, safra] = [await equipamentoNovo(), await safraNova()];
    const m = await criado(manter({ empresa_id: c.I.empresa, maintenance_date: DATA, harvest_id: safra,
      machines: [{ equipment_id: maquina, items: [{ warehouse_id: c.I.warehouse, product_id: p.id, quantity: "2" }] }] }));
    expect(await saldo(c.I.warehouse, p.id), "premissa: baixou 2").toBe("8.0000");

    const r = await cancelarManutencao(m.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: m.id, status: "cancelled" });
    expect((await razaoDaOrigem("maintenances", m.id)).map((x) => [x.movement_type, x.direction, x.quantity, x.equipamento_id, x.harvest_id])).toEqual([
      ["maintenance", -1, "2.0000", maquina, safra],
      ["reversal", 1, "2.0000", maquina, safra],
    ]);
    expect(await saldo(c.I.warehouse, p.id)).toBe("10.0000");
    expect((await manutencaoNoBanco(m.id)).status).toBe("cancelled");
    expect(await acoesAuditadas("maintenances", m.id)).toEqual(["create", "cancel"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// ORDEM DE SERVIÇO
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("FO — ordem de serviço", () => {
  it("FO-1 POST com TOP e Idempotency-Key repetida: o mesmo id e um registro só, auditado uma vez; outra família recusada sem queimar código; a capacidade da OS (200/403)", async () => {
    const topId = await topV5DoModulo("ordem_servico", undefined, { nome: "OS F10 FO-1" });
    const marca = `OS F10 FO-1 ${unico()}`;
    const corpo = { empresa_id: c.I.empresa, order_date: DATA, description: marca, tipo_operacao_id: topId, lines: [{ section: "labor", person_id: c.I.employee, quantity: "8", unit_value: "25" }] };
    const chave = `f10-fo1-${unico()}`;
    const codigoAntes = await ultimoCodigo("service_order");

    const a = await abrirOs(corpo, undefined, chave);
    expect(a.statusCode, a.body).toBe(201);
    expect(Object.keys(j(a)).sort(), "as MESMAS chaves de hoje").toEqual(["code", "id"]);
    const b = await abrirOs(corpo, undefined, chave);
    expect(b.statusCode, b.body).toBe(201);
    expect(j(b), "a repetição devolve a resposta gravada").toEqual(j(a));
    const id = String(j(a).id);
    const comMarca = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.service_orders where description = $1", [marca])).rows[0]!.n);
    expect(await comMarca(), "um registro só").toBe(1);
    expect(await ultimoCodigo("service_order"), "um código só").toBe(codigoAntes + 1);
    expect(await acoesAuditadas("service_orders", id), "a criação é auditada uma vez").toEqual(["create"]);
    expect(await osNoBanco(id)).toMatchObject({ ...comTop(topId, (await versaoCorrente(topId)).id), status: "open", total: "200.00" });
    const conflito = await abrirOs({ ...corpo, description: `${marca} outra` }, undefined, chave);
    expect(erro(conflito), "a mesma chave com outro corpo").toMatchObject({ status: 409, code: "CONFLICT" });
    expect(await comMarca()).toBe(1);

    const d = await lerOs(id);
    expect(d.statusCode, d.body).toBe(200);
    expect(j(d)).toMatchObject({ tipo_operacao_id: topId, tipo_operacao_nome: "OS F10 FO-1", tipo_operacao_versao: 1 });

    const outraFamilia = await abrirOs({ ...corpo, description: `${marca} recusada`, tipo_operacao_id: await topV5DoModulo("abastecimento") });
    expect(erro(outraFamilia)).toEqual({ status: 422, code: "TIPO_OPERACAO_INDISPONIVEL", message: MSG.topIndisponivel });
    expect(await ultimoCodigo("service_order"), "a recusa não queima código").toBe(codigoAntes + 1);

    // Sem a chave, executa como antes: dois POSTs, duas OS.
    const semChave = { empresa_id: c.I.empresa, order_date: DATA, description: `${marca} sem chave` };
    await criado(abrirOs(semChave));
    await criado(abrirOs(semChave));
    expect(Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.service_orders where description = $1", [semChave.description])).rows[0]!.n)).toBe(2);

    // A capacidade da OS.
    const semCriar = await membro("OS leitura F10", ["service_orders.view"]);
    expect(erro(await tiposDoModulo("ordem_servico", semCriar))).toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    const t = await tiposDoModulo("ordem_servico");
    expect(t.statusCode, t.body).toBe(200);
    const tipos = j(t) as unknown as Tipos;
    expect(tipos).toMatchObject({ contractVersion: 1, capacidades: { topNoModulo: 1 }, family: { code: familiaDo("ordem_servico"), label: "Ordem de serviço" } });
    expect(tipos.items.map((x) => x.id)).toContain(topId);
  });

  it("FO-2 PUT em aberta e em andamento → 200 e auditado; com tipo_operacao_id → 422 e nada muda; encerrada → INVALID_STATUS_TRANSITION; a exigência da versão CONGELADA na OS", async () => {
    const o = await criado(abrirOs({ empresa_id: c.I.empresa, order_date: DATA, description: "OS F10 FO-2" }));
    const edicao = (description: string, extra: Record<string, unknown> = {}) => ({ empresa_id: c.I.empresa, order_date: DATA, description,
      lines: [{ section: "labor", person_id: c.I.employee, quantity: "1", unit_value: "10" }], ...extra });

    const aberta = await editarOs(o.id, edicao("Editada em aberta"));
    expect(aberta.statusCode, aberta.body).toBe(200);
    expect(j(aberta), "a MESMA resposta de hoje").toEqual({ id: o.id });
    expect(await osNoBanco(o.id)).toMatchObject({ description: "Editada em aberta", total: "10.00", status: "open" });
    await situacaoDaOs(o.id, "in_progress");
    const andamento = await editarOs(o.id, edicao("Editada em andamento"));
    expect(andamento.statusCode, andamento.body).toBe(200);
    expect(await osNoBanco(o.id)).toMatchObject({ description: "Editada em andamento", status: "in_progress" });

    // A TOP não muda: a chave própria no corpo (qualquer valor) é recusada, e nada muda.
    const topDaOs = await topV5DoModulo("ordem_servico");
    for (const valor of [topDaOs, null]) {
      const r = await editarOs(o.id, edicao("Não pode", { tipo_operacao_id: valor }));
      expect(forma(r), `tipo_operacao_id = ${String(valor)}`).toEqual([422, "VALIDATION_ERROR", MSG.topDaOsNaoMuda, JSON.stringify([{ path: "tipo_operacao_id", message: MSG.topDaOsNaoMuda }])]);
    }
    expect(await osNoBanco(o.id), "nada mudou").toMatchObject({ description: "Editada em andamento", ...comTop(null, null) });
    expect(await acoesAuditadas("service_orders", o.id)).toEqual(["create", "edit", "in_progress", "edit"]);

    // Encerrada não edita.
    const fim = await criado(abrirOs({ empresa_id: c.I.empresa, order_date: DATA, description: "OS F10 FO-2 finalizada" }));
    await situacaoDaOs(fim.id, "in_progress");
    await situacaoDaOs(fim.id, "finished");
    expect(erro(await editarOs(fim.id, edicao("Depois de finalizada")))).toMatchObject({ status: 409, code: "INVALID_STATUS_TRANSITION" });
    expect((await osNoBanco(fim.id)).description).toBe("OS F10 FO-2 finalizada");

    // A exigência da versão CONGELADA: a v1 exige o centro; a v2 (a corrente depois do lançamento) não exige nada — o PUT
    // sem centro continua recusado, porque a OS cita a v1.
    const exigeCentro = await topV5DoModulo("ordem_servico", (x) => { x.geral.exigeCentroResultado = true; });
    const v1 = await versaoCorrente(exigeCentro);
    const centro = await centroNovo();
    const comTopCentro = await criado(abrirOs({ empresa_id: c.I.empresa, order_date: DATA, description: "OS F10 FO-2 com centro", cost_center_id: centro, tipo_operacao_id: exigeCentro }));
    expect(await novaVersaoDaTop(exigeCentro, cfg5()), "premissa: a TOP ganhou a v2, neutra").toBe(2);
    expect(await osNoBanco(comTopCentro.id), "premissa: a OS cita a v1").toMatchObject(comTop(exigeCentro, v1.id));
    const semCentro = await editarOs(comTopCentro.id, edicao("Sem centro"));
    expect(erro(semCentro)).toEqual({ status: 422, code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.exigencia });
    expect(exigencias(semCentro)).toEqual([{ caminho: "cost_center_id", mensagem: "Centro de resultado é obrigatório nesta operação." }]);
    expect(await osNoBanco(comTopCentro.id), "nada mudou").toMatchObject({ description: "OS F10 FO-2 com centro", cost_center_id: centro });
    const comCentro = await editarOs(comTopCentro.id, edicao("Com centro", { cost_center_id: centro }));
    expect(comCentro.statusCode, comCentro.body).toBe(200);
    expect(await osNoBanco(comTopCentro.id)).toMatchObject({ description: "Com centro", ...comTop(exigeCentro, v1.id) });
  });

  it("FO-3 finalizar baixa só insumo e EPI com local, com o centro, a safra e a própria OS; a linha sem local é pulada; nada sai antes de finalizar", async () => {
    const [insumo, epi, semLocal] = [await produto(), await produto(), await produto()];
    await saldoInicial(insumo.id, "10", { custo: "4" });
    await saldoInicial(epi.id, "5", { custo: "20" });
    const [centro, safra] = [await centroNovo(), await safraNova()];
    const o = await criado(abrirOs({ empresa_id: c.I.empresa, order_date: DATA, cost_center_id: centro, harvest_id: safra, description: "OS F10 FO-3", lines: [
      { section: "input", product_id: insumo.id, warehouse_id: c.I.warehouse, quantity: "2", unit_value: "4" },
      { section: "ppe", product_id: epi.id, warehouse_id: c.I.warehouse, quantity: "1", unit_value: "20" },
      { section: "input", product_id: semLocal.id, quantity: "5", unit_value: "1" },
      { section: "labor", person_id: c.I.employee, quantity: "3", unit_value: "15" },
    ] }));
    await situacaoDaOs(o.id, "in_progress");
    expect(await razaoDaOrigem("service_orders", o.id), "nada sai antes de finalizar").toEqual([]);

    await situacaoDaOs(o.id, "finished");
    const destino = { cost_center_id: centro, harvest_id: safra, ordem_servico_id: o.id, equipamento_id: null, lote_animais_id: null, area_id: null };
    const esperado = [
      { movement_type: "requisition", direction: -1, quantity: "2.0000", product_id: insumo.id, ...destino },
      { movement_type: "requisition", direction: -1, quantity: "1.0000", product_id: epi.id, ...destino },
    ].sort((a, b) => (a.product_id < b.product_id ? -1 : 1));
    expect((await razaoDaOrigem("service_orders", o.id)).map((m) => ({ movement_type: m.movement_type, direction: m.direction, quantity: m.quantity, product_id: m.product_id,
      cost_center_id: m.cost_center_id, harvest_id: m.harvest_id, ordem_servico_id: m.ordem_servico_id, equipamento_id: m.equipamento_id,
      lote_animais_id: m.lote_animais_id, area_id: m.area_id }))).toEqual(esperado);
    expect(await movimentosDoProduto(semLocal.id), "a linha sem local é pulada").toBe(0);
    expect(await saldo(c.I.warehouse, insumo.id)).toBe("8.0000");
    expect(await saldo(c.I.warehouse, epi.id)).toBe("4.0000");
  });
});
