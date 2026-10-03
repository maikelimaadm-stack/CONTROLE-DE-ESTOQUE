import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5, type PoliticaAprovacao } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg4, criarTop, top, editarTop, versaoAtualNoBanco, versoesNoBanco, auditoriaDe,
  produto, itemCompra, corpoCompra, compraLancada, receberPedido, corpoReceber, aprovar, decisoesDe,
  type Resposta,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F6a — DECISÃO DO MAIKE DE 03/10 (decisão 283): A APROVAÇÃO AO FINALIZAR E "EXIGIR PEDIDO FINALIZADO PARA
 * RECEBER" ANDAM JUNTAS, NOS DOIS SENTIDOS, NO PEDIDO DE COMPRA DO FORMATO 5 (PAR-1..PAR-3).
 *
 *   · PAR-1 POST: a TOP de pedido de compra no 5 com uma sem a outra → UM 422 com a recusa exata no campo que falta
 *           (aprovação sem "exigir" → `fluxoCompra.exigeFinalizar`; "exigir" sem aprovação → `aprovacao.politica`), e
 *           nenhuma TOP nasce; premissas: as duas ligadas e as duas desligadas → 201 no 5; o 4 com aprovação (sem a
 *           seção) → 201 no 4;
 *   · PAR-2 PUT: as mesmas recusas, nada gravado (pai, versões e trilha iguais); com as duas, a N+1; desligar só o
 *           "exigir", ou só a aprovação, de uma vigente com as duas → o 422 do lado que falta, nada gravado;
 *   · PAR-3 o Receber do pedido ABERTO cuja TOP pede aprovação ao finalizar (e, junto, "exigir") → 409 com a mensagem da
 *           regra e nada recebido — antes e DEPOIS de aprovado; finalizado (aprovado), recebe.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): pai, versões, trilha, compras geradas e situação LIDOS NO BANCO pela
 * testemunha (`c.admin`, superusuário sem RLS); toda recusa "sem efeito" vem com a PREMISSA ao lado. As mensagens estão
 * escritas AQUI, à mão: um texto errado no domínio não se aprova sozinho.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── o contrato, escrito à mão ───────────────

const MSG_PAR = "Com aprovação, o pedido de compra só é recebido depois de finalizado: \"Exigir pedido finalizado para receber\" tem de ser Sim. As duas andam juntas.";
const RECUSA_PAR = { motivo: "combinacao_nao_suportada", caminho: "fluxoCompra.exigeFinalizar", mensagem: MSG_PAR };
const MSG_PAR_INVERSA = "\"Exigir pedido finalizado para receber\" só vale com aprovação do pedido: escolha o critério de aprovação ou deixe a regra em Não. As duas andam juntas.";
const RECUSA_PAR_INVERSA = { motivo: "combinacao_nao_suportada", caminho: "aprovacao.politica", mensagem: MSG_PAR_INVERSA };
const MSG_PRECISA_FINALIZAR = "Este pedido precisa ser finalizado antes de ser recebido.";

/** O 5 do pedido com a aprovação e a regra dadas (o resto no neutro do domínio). Cada chamada devolve um objeto novo. */
function cfg5(politica: PoliticaAprovacao, exigeFinalizar: boolean): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  x.aprovacao = { ...x.aprovacao, politica, valorMinimo: politica === "por_valor" ? "1000.00" : null };
  x.fluxoCompra = { exigeFinalizar };
  return x;
}

/** O 422 da configuração: o código, a mensagem do envelope e EXATAMENTE a recusa do par (por padrão, a do "exigir" que falta). */
function recusadoPeloPar(r: Resposta, recusa: unknown = RECUSA_PAR) {
  expect(r.statusCode, r.body).toBe(422);
  expect(erro(r)).toEqual({ code: "TIPO_OPERACAO_CONFIGURACAO_INVALIDA", message: "A configuração operacional enviada é inválida", details: { recusas: [recusa] } });
}

// ─────────────── testemunhas ───────────────

async function paiNoBanco(topId: string): Promise<{ versao_atual: number; revisao: number }> {
  const r = await c.admin.query<{ versao_atual: number; revisao: number }>("select versao_atual, revisao from erp.tipos_operacao where id=$1", [topId]);
  expect(r.rows, "premissa: a TOP existe").toHaveLength(1);
  return r.rows[0]!;
}
/** A foto da TOP para "nada gravado": pai, versões e o tamanho da trilha. */
async function foto(topId: string) {
  return { pai: await paiNoBanco(topId), versoes: await versoesNoBanco(topId), trilha: (await auditoriaDe("tipos_operacao", topId)).length };
}
const contarTops = async () => Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);
const topsComCodigo = async (codigo: string) =>
  Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.tipos_operacao where organization_id=$1 and codigo=$2", [c.h.demo.orgId, codigo])).rows[0]!.n);
/** O par gravado na versão corrente, como o BANCO o guarda. */
async function parNoBanco(topId: string): Promise<[number, unknown, unknown]> {
  const v = await versaoAtualNoBanco(topId);
  const cfg = v.configuracao as { aprovacao?: { politica?: unknown }; fluxoCompra?: { exigeFinalizar?: unknown } };
  return [v.configuracao_schema_version, cfg.aprovacao?.politica, cfg.fluxoCompra?.exigeFinalizar];
}

// ─────────────── PAR-1 ───────────────

describe("PAR-1 POST da TOP de pedido de compra no 5", () => {
  it("PAR-1a uma sem a outra → UM 422 no campo que falta (Sempre e A partir de um valor sem 'exigir'; 'exigir' sem aprovação); nenhuma TOP nasce", async () => {
    const casos: [PoliticaAprovacao, boolean, string, unknown][] = [
      ["sempre", false, "S", RECUSA_PAR], ["por_valor", false, "V", RECUSA_PAR], ["nenhuma", true, "N", RECUSA_PAR_INVERSA],
    ];
    for (const [politica, exige, letra, recusa] of casos) {
      const codigo = `P${letra}${Date.now().toString(36).slice(-6)}`;
      const antes = await contarTops();
      recusadoPeloPar(await criarTop("compras.pedido", { codigo, configuracao: cfg5(politica, exige) }), recusa);
      expect(await contarTops(), `${politica} + exigir ${exige}: nenhuma TOP nasce`).toBe(antes);
      expect(await topsComCodigo(codigo), `${politica} + exigir ${exige}: o código não existe no banco`).toBe(0);
    }
  });

  it("PAR-1b premissas: as duas ligadas e as duas desligadas → 201 no 5; o 4 com aprovação → 201 no 4", async () => {
    const casos: [PoliticaAprovacao, boolean][] = [["sempre", true], ["por_valor", true], ["nenhuma", false]];
    for (const [politica, exige] of casos) {
      const id = await top("compras.pedido", { configuracao: cfg5(politica, exige) });
      expect(await parNoBanco(id), `${politica} + exigir ${exige}`).toEqual([5, politica, exige]);
    }
    // O 4 não tem a seção (a regra é do 5): o pedido de compra com aprovação grava como hoje.
    const id4 = await top("compras.pedido", { configuracao: cfg4((x) => { x.aprovacao.politica = "sempre"; }) });
    expect(await parNoBanco(id4), "o 4 com aprovação, sem a seção").toEqual([4, "sempre", undefined]);
  });

  it("PAR-1c outra família no 5 não passa pela regra: a compra com aprovação → 201 (premissa: o par é do pedido)", async () => {
    const id = await top("compras.compra", { configuracao: cfg5("sempre", false) });
    expect(await parNoBanco(id)).toEqual([5, "sempre", false]);
  });
});

// ─────────────── PAR-2 ───────────────

describe("PAR-2 PUT da TOP de pedido de compra no 5", () => {
  it("PAR-2 as mesmas recusas, nada gravado; com as duas, a N+1; desligar só uma das duas → o 422 da que falta, nada gravado", async () => {
    const id = await top("compras.pedido", { configuracao: cfg5("nenhuma", false) });
    const f1 = await foto(id);
    expect(f1.versoes, "premissa: nasceu no 5").toEqual([{ versao: 1, configuracao_schema_version: 5 }]);

    for (const politica of ["sempre", "por_valor"] as const) recusadoPeloPar(await editarTop(id, { configuracao: cfg5(politica, false) }));
    recusadoPeloPar(await editarTop(id, { configuracao: cfg5("nenhuma", true) }), RECUSA_PAR_INVERSA);
    expect(await foto(id), "nenhuma das recusas grava").toEqual(f1);

    // PREMISSA: com as duas, a N+1 no 5.
    const r = await editarTop(id, { configuracao: cfg5("sempre", true) });
    expect(r.statusCode, r.body).toBe(200);
    expect(await parNoBanco(id)).toEqual([5, "sempre", true]);
    const f2 = await foto(id);
    expect(f2.versoes.map((v) => v.versao), "a N+1").toEqual([1, 2]);

    // Desligar SÓ o "exigir" (a aprovação ligada), ou SÓ a aprovação ("exigir" ligado): o 422 da que falta, e a versão
    // 2 continua a corrente.
    recusadoPeloPar(await editarTop(id, { configuracao: cfg5("sempre", false) }));
    recusadoPeloPar(await editarTop(id, { configuracao: cfg5("nenhuma", true) }), RECUSA_PAR_INVERSA);
    expect(await foto(id), "nada gravado").toEqual(f2);
    expect(await parNoBanco(id), "a vigente continua com as duas").toEqual([5, "sempre", true]);
    // PREMISSA: desligar as DUAS juntas grava a N+1.
    const r3 = await editarTop(id, { configuracao: cfg5("nenhuma", false) });
    expect(r3.statusCode, r3.body).toBe(200);
    expect(await parNoBanco(id), "as duas desligadas, juntas").toEqual([5, "nenhuma", false]);
    expect((await versoesNoBanco(id)).map((v) => v.versao), "a N+1").toEqual([1, 2, 3]);
  });
});

// ─────────────── PAR-3 ───────────────

describe("PAR-3 o Receber do pedido aberto quando a TOP pede aprovação ao finalizar", () => {
  const finalizar = (id: string): Promise<Resposta> =>
    c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${id}/finalizar`, headers: c.h.headers(), payload: {} });
  const situacao = async (id: string) =>
    (await c.admin.query<{ situacao: string }>("select situacao from erp.documentos_compra where id=$1", [id])).rows[0]!.situacao;
  const comprasGeradas = async (pedidoId: string) =>
    (await c.admin.query<{ id: string }>("select id from erp.documentos_compra where origem_documento_id=$1 order by created_at, id", [pedidoId])).rows.map((x) => x.id);

  it("PAR-3 aberto → 409 e nada recebido (antes e depois de aprovado); aprovado e finalizado → recebe", async () => {
    const topDestino = await top("compras.compra", { configuracao: cfg4() });
    const topPedido = await top("compras.pedido", { configuracao: cfg5("sempre", true), destinos: [{ tipoOperacaoId: topDestino, ordem: 0, emPartes: false }] });
    const p = await produto();
    const ped = await compraLancada("pedido", corpoCompra([itemCompra(p.id, "3", "10.00")], { tipo_operacao_id: topPedido }, "pedido"));
    const itens = (await c.admin.query<{ id: string; quantidade: string }>(
      "select id, quantidade::text from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [ped.id])).rows;
    // PREMISSA: o pedido está ABERTO e cita a versão da TOP que pede aprovação e, junto, "exigir".
    const versao = await versaoAtualNoBanco(topPedido);
    const doc = (await c.admin.query<{ situacao: string; tipo_operacao_versao_id: string }>(
      "select situacao, tipo_operacao_versao_id from erp.documentos_compra where id=$1", [ped.id])).rows[0]!;
    expect([doc.situacao, doc.tipo_operacao_versao_id], "premissa: aberto, com a versão desta TOP").toEqual(["aberto", versao.id]);
    expect(await parNoBanco(topPedido), "premissa: a versão pede aprovação e exige finalizado").toEqual([5, "sempre", true]);
    expect(itens, "premissa: o pedido tem o item").toHaveLength(1);
    const corpo = corpoReceber(topDestino, itens.map((i) => ({ item_origem_id: i.id, quantidade: i.quantidade })));

    // ABERTO, sem aprovação: recusado, nada criado.
    const r1 = await receberPedido(ped.id, corpo);
    expect(r1.statusCode, r1.body).toBe(409);
    expect(erro(r1)).toEqual({ code: "CONFLICT", message: MSG_PRECISA_FINALIZAR });
    expect([await comprasGeradas(ped.id), await situacao(ped.id)], "nada recebido; o pedido continua aberto").toEqual([[], "aberto"]);

    // ABERTO e APROVADO: a aprovação vale ao finalizar — o aberto continua sem ser recebido.
    expect((await aprovar("compras", ped.id)).statusCode).toBe(200);
    expect((await decisoesDe("aprovacoes_compra", ped.id)).map((d) => d.decisao), "premissa: aprovado").toEqual(["aprovado"]);
    const r2 = await receberPedido(ped.id, corpo);
    expect(r2.statusCode, r2.body).toBe(409);
    expect(erro(r2)).toEqual({ code: "CONFLICT", message: MSG_PRECISA_FINALIZAR });
    expect([await comprasGeradas(ped.id), await situacao(ped.id)], "nada recebido; o pedido continua aberto").toEqual([[], "aberto"]);
    expect(await auditoriaDe("documentos_compra", ped.id, "convert"), "nenhuma conversão na trilha").toEqual([]);

    // PREMISSA (o corte): finalizado, o MESMO pedido e o MESMO corpo são recebidos.
    const f = await finalizar(ped.id);
    expect(f.statusCode, f.body).toBe(200);
    const r3 = await receberPedido(ped.id, corpo);
    expect(r3.statusCode, r3.body).toBe(201);
    expect(await comprasGeradas(ped.id)).toEqual([j(r3).id]);
    expect(await situacao(ped.id)).toBe("convertido");
  });
});
