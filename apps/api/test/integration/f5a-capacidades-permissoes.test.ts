import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, ESPECIES_MOVIMENTACAO_INTERNA, RECURSO_DA_ESPECIE_ESTOQUE, CAPACIDADE_MOVIMENTACAO_INTERNA,
  CAPACIDADE_LAYOUT_DOCUMENTO, CAPACIDADE_REGRAS_DA_OPERACAO, CAPACIDADE_SALDO_INICIAL_ESTOQUE, entendeMovimentacaoInterna,
  entendeSaldoInicialEstoque, familiaOperacionalDeDocumentoEstoque,
} from "@agro/domain";
import {
  c, iniciar, encerrar, produto, saldoInicial, membro, escopos, j, familia, segmento, lancarDoc, lancadoDoc, lerDoc, previaDoc, confirmarDoc,
  confirmadoDoc, encerrarSaldo, listar, forma, detalhes, itensNoBanco, lido, type Hdr,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F5a (decisão 282) — AS CAPACIDADES DECLARADAS E A AUTORIZAÇÃO DAS TRÊS ESPÉCIES NOVAS.
 *
 *   · `GET /api/estoque/<segmento>/operation-types` (as SETE): `capacidades` = `{ documentoEstoque: 1,
 *     movimentacaoInterna: 1 }`, nessa ordem — a chave nova é ADITIVA, e o leitor do domínio a entende. Desde a F5b
 *     (a Central de Estoque no motor), + `layoutDocumento: 1` e `regrasDaOperacao: 1`, no FIM; desde a F11 (decisão
 *     288), SÓ a entrada declara ainda `saldoInicial: 1`, no fim (o saldo inicial pela TOP de entrada);
 *   · cada espécie nova tem o SEU recurso (`requisicoes_estoque`, `consumos_estoque`, `devolucoes_consumo_estoque`):
 *     sem a capacidade → 403; com ela e fora do escopo de empresa do estoque → a MESMA 404 do inexistente, do id
 *     malformado e da outra espécie (CAPACIDADE × ESCOPO, com AND);
 *   · quem só VÊ requisição lê a prévia dela: a porta da reserva (0043) responde a `requisicoes_estoque.view`;
 *   · a lista única recorta pelas capacidades das sete, no WHERE;
 *   · a LEITURA de um documento só cita (origem, vinculados) os documentos das espécies que quem lê pode ver.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const operacoes = (especie: (typeof TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE)[number], headers: Hdr = c.h.headers()) =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/operation-types`, headers });
const item = (produtoId: string, quantidade: string) => ({ produto_id: produtoId, quantidade });
const perms = (especie: (typeof TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE)[number], acoes: string[]) => acoes.map((a) => `${RECURSO_DA_ESPECIE_ESTOQUE[especie]}.${a}`);

describe("CP-1 — a capacidade declarada nas sete rotas de operações", () => {
  it("CP-1 as sete declaram `{ documentoEstoque: 1, movimentacaoInterna: 1, layoutDocumento: 1, regrasDaOperacao: 1 }` (a primeira continua `documentoEstoque`; as da F5b no fim) e a entrada, só ela, + `saldoInicial: 1` no fim (F11), contrato 1, a família do registry", async () => {
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, "premissa: as sete espécies").toHaveLength(7);
    expect(TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE, "premissa: a entrada é uma das sete").toContain("entrada");
    // Os valores à mão: uma constante do domínio errada não se aprova sozinha.
    expect([CAPACIDADE_MOVIMENTACAO_INTERNA, CAPACIDADE_LAYOUT_DOCUMENTO, CAPACIDADE_REGRAS_DA_OPERACAO, CAPACIDADE_SALDO_INICIAL_ESTOQUE],
      "premissa: as quatro constantes valem 1").toEqual([1, 1, 1, 1]);
    for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) {
      const r = await operacoes(especie);
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(200);
      const corpo = j(r) as { contractVersion: number; capacidades: Record<string, unknown>; family: { code: string; label: string }; items: unknown[] };
      expect(corpo.contractVersion, especie).toBe(1);
      // A entrada declara cinco (o saldo inicial pela TOP, F11); as outras seis, as quatro de antes, byte a byte.
      const daEntrada = especie === "entrada";
      expect(Object.entries(corpo.capacidades), `${especie}: chave a chave, na ordem`).toEqual([
        ["documentoEstoque", 1], ["movimentacaoInterna", 1], ["layoutDocumento", 1], ["regrasDaOperacao", 1],
        ...(daEntrada ? [["saldoInicial", 1]] : []),
      ]);
      expect(entendeMovimentacaoInterna(corpo.capacidades), especie).toBe(true);
      expect(entendeSaldoInicialEstoque(corpo.capacidades), `${especie}: só a entrada declara o saldo inicial`).toBe(daEntrada);
      expect(corpo.family.code, especie).toBe(familia(especie));
      expect(corpo.items.length, `premissa: a TOP da espécie ${especie} está na lista`).toBeGreaterThan(0);
    }
    // A requisição de material é a família NOVA, e não a `estoque.requisicao` da tabela antiga.
    const req = j(await operacoes("requisicao")) as { family: { code: string; label: string } };
    expect(req.family).toEqual({ code: "estoque.requisicao_material", label: "Requisição de material" });
    expect(familiaOperacionalDeDocumentoEstoque("requisicao")).not.toBe("estoque.requisicao");
  });
});

describe("CP-2 — capacidade: o recurso de cada espécie nova", () => {
  it("CP-2a sem a capacidade da espécie → 403 em operações, lançar, ler e encerrar; a de OUTRA espécie não serve", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const req = await lancadoDoc("requisicao", [item(p.id, "1")]);
    const outra = await membro("Só Entrada", perms("entrada", ["view", "create", "edit"]));
    for (const especie of ESPECIES_MOVIMENTACAO_INTERNA) {
      expect((await operacoes(especie, outra)).statusCode, especie).toBe(403);
      expect((await lancarDoc(especie, [item(p.id, "1")], {}, outra)).statusCode, especie).toBe(403);
    }
    expect((await lerDoc("requisicao", req, outra)).statusCode).toBe(403);
    expect((await encerrarSaldo(req, "x", outra)).statusCode).toBe(403);
    // PREMISSA: com a capacidade da espécie, abre.
    const comReq = await membro("Requisitante", perms("requisicao", ["view", "create"]));
    expect((await operacoes("requisicao", comReq)).statusCode).toBe(200);
    expect((await lerDoc("requisicao", req, comReq)).statusCode).toBe(200);
  });

  it("CP-2b quem só VÊ requisição lê a prévia dela (a porta da reserva responde), mas não confirma nem encerra (403)", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const outra = await lancadoDoc("requisicao", [item(p.id, "3")]); await confirmadoDoc("requisicao", outra);
    const req = await lancadoDoc("requisicao", [item(p.id, "4")]);
    const so = await membro("Vê Requisição", perms("requisicao", ["view"]));
    const pv = await previaDoc("requisicao", req, so);
    expect(pv.statusCode, pv.body).toBe(200);
    const corpo = j(pv) as { baseDoSaldo: string; itens: { saldo_atual: string; saldo_depois: string }[] };
    expect(corpo.baseDoSaldo).toBe("disponivel");
    expect(corpo.itens.map((x) => [x.saldo_atual, x.saldo_depois]), "o disponível (10 − 3 reservados pela outra)").toEqual([["7.0000", "3.0000"]]);
    expect((await confirmarDoc("requisicao", req, so)).statusCode).toBe(403);
    expect((await encerrarSaldo(outra, "x", so)).statusCode).toBe(403);
  });
});

describe("CP-3 — escopo: fora do escopo de empresa do estoque = inexistente = outra espécie = malformado (a MESMA 404)", () => {
  it("CP-3 o documento da 1ª empresa para quem só tem o estoque da 2ª: GET, prévia, confirmar e encerrar → a 404 do inexistente", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const req = await lancadoDoc("requisicao", [item(p.id, "1")]);
    const todas = [...perms("requisicao", ["view", "create", "edit"]), ...perms("consumo", ["view", "create", "edit"])];
    const so2 = await membro("Estoque da 2ª", todas, escopos([c.I.empresa2]));
    const inexistente = await lerDoc("requisicao", "00000000-0000-4000-8000-000000000000", so2);
    expect(inexistente.statusCode).toBe(404);
    expect(forma(await lerDoc("requisicao", req, so2)), "fora do escopo").toEqual(forma(inexistente));
    expect(forma(await lerDoc("requisicao", "nao-e-uuid", so2)), "malformado").toEqual(forma(inexistente));
    expect(forma(await lerDoc("consumo", req, so2)), "outra espécie").toEqual(forma(inexistente));
    expect(forma(await previaDoc("requisicao", req, so2))).toEqual(forma(inexistente));
    expect(forma(await confirmarDoc("requisicao", req, so2))).toEqual(forma(inexistente));
    expect(forma(await encerrarSaldo(req, "x", so2))).toEqual(forma(inexistente));
    // PREMISSA: o administrador (todas as empresas) lê o mesmo documento.
    expect((await lerDoc("requisicao", req)).statusCode).toBe(200);

    // A ORIGEM DE OUTRA EMPRESA também não serve: a requisição CONFIRMADA da 1ª (uma origem válida na empresa dela),
    // citada por um consumo na 2ª → a recusa da origem, a MESMA (status, código, mensagem e detalhes) do consumo que
    // cita uma requisição INEXISTENTE — sem oráculo: a resposta não diz que aquele id existe noutra empresa. O corpo é
    // o mesmo nos dois, só muda o id da origem.
    await confirmadoDoc("requisicao", req);
    const itemDaReq = (await itensNoBanco(req))[0]!.id;
    const consumoCitando = (origem: string, extra: Record<string, unknown>, headers?: Hdr) =>
      lancarDoc("consumo", [{ produto_id: p.id, quantidade: "1", origem_item_id: itemDaReq }], { origem_documento_id: origem, ...extra }, headers);
    const na2a = { empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 };
    const deOutraEmpresa = await consumoCitando(req, na2a, so2);
    const origemInexistente = await consumoCitando("00000000-0000-4000-8000-000000000000", na2a, so2);
    expect(detalhes(origemInexistente), "premissa: a origem inexistente é recusada no campo da origem")
      .toEqual([["origem_documento_id", "Requisição de origem inválida: escolha uma requisição pendente da mesma empresa e do mesmo local de estoque"]]);
    expect(forma(deOutraEmpresa), "a origem de outra empresa = a origem inexistente").toEqual(forma(origemInexistente));
    // PREMISSA: na empresa dela, a mesma requisição é uma origem válida — o consumo que a cita é lançado.
    const naPropria = await consumoCitando(req, {});
    expect(naPropria.statusCode, `premissa: a requisição confirmada atende na 1ª empresa — ${naPropria.body}`).toBe(201);
  });
});

describe("CP-4 — a lista única recorta pelas capacidades das sete espécies", () => {
  it("CP-4 quem só vê consumo lista só consumos; quem não vê nenhuma das sete → 403", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    await lancadoDoc("requisicao", [item(p.id, "1")]);
    await lancadoDoc("consumo", [item(p.id, "1")]);
    await lancadoDoc("entrada", [{ produto_id: p.id, quantidade: "1", custo_unitario: "1" }]);
    const especiesDe = async (headers: Hdr) => {
      const r = await listar("pageSize=1000", headers);
      expect(r.statusCode, r.body).toBe(200);
      return new Set((j(r) as unknown as { items: { especie: string }[] }).items.map((x) => x.especie));
    };
    expect([...(await especiesDe(c.h.headers()))].sort(), "premissa: há requisição, consumo e entrada na organização").toEqual(expect.arrayContaining(["consumo", "entrada", "requisicao"]));
    const soConsumo = await membro("Vê Consumo", perms("consumo", ["view"]));
    expect([...(await especiesDe(soConsumo))]).toEqual(["consumo"]);
    const nenhuma = await membro("Sem Estoque Novo", ["stocks.view"]);
    expect((await listar("pageSize=10", nenhuma)).statusCode).toBe(403);
  });
});

describe("CP-5 — a leitura só cita (origem, vinculados) os documentos das espécies que quem lê pode ver", () => {
  it("CP-5 quem vê só a requisição não vê os consumos dela; quem vê só o consumo não vê a requisição de origem; com as duas, vê as duas", async () => {
    const p = await produto(); await saldoInicial(p.id, "10");
    const req = await lancadoDoc("requisicao", [item(p.id, "4")]); await confirmadoDoc("requisicao", req);
    const consumo = await lancadoDoc("consumo", [{ produto_id: p.id, quantidade: "1", origem_item_id: (await itensNoBanco(req))[0]!.id }], { origem_documento_id: req });
    // PREMISSA: o administrador vê os dois lados da ligação.
    const reqAdmin = await lido("requisicao", req);
    const consumoAdmin = await lido("consumo", consumo);
    expect(reqAdmin.vinculados.map((v) => [v.id, v.especie]), "premissa: a requisição cita o consumo").toEqual([[consumo, "consumo"]]);
    expect(consumoAdmin.origem && [consumoAdmin.origem.id, consumoAdmin.origem.especie], "premissa: o consumo cita a requisição").toEqual([req, "requisicao"]);

    const soReq = await membro("Só Requisição", perms("requisicao", ["view"]));
    const reqSemConsumo = await lido("requisicao", req, soReq);
    expect(reqSemConsumo.vinculados, "sem `consumos_estoque.view`: nenhum consumo citado").toEqual([]);
    expect([reqSemConsumo.atendimento, reqSemConsumo.itens.map((i) => i.quantidade_atendida)], "o atendimento é da própria requisição: continua").toEqual(["parcial", ["1.0000"]]);

    const soConsumo = await membro("Só Consumo", perms("consumo", ["view"]));
    const consumoSemReq = await lido("consumo", consumo, soConsumo);
    expect(consumoSemReq.origem, "sem `requisicoes_estoque.view`: a requisição de origem não é citada").toBeNull();
    expect(consumoSemReq.origem_documento_id, "o campo do próprio consumo continua").toBe(req);

    const asDuas = await membro("Requisição e Consumo", [...perms("requisicao", ["view"]), ...perms("consumo", ["view"])]);
    expect((await lido("requisicao", req, asDuas)).vinculados.map((v) => v.id)).toEqual([consumo]);
    expect((await lido("consumo", consumo, asDuas)).origem?.id).toBe(req);
  });
});
