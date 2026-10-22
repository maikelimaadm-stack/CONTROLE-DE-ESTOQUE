import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { LAYOUT_DO_SISTEMA, MOTIVOS_DA_PROVISAO_COMPRA, type EstruturaLayout } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, produto, top, cfg4, itemCompra, corpoCompra, compraLancada, lancarCompra, confirmarCompra, lerCompra,
  receberPedido, corpoReceber, aprovar, reprovar, usuario, emParaleloComBarreira, unico,
  type EspecieCompra, type Hdr, type Resposta,
} from "./top-config-08-ajuda.js";
import { topCompraNo5, topPedidoNo5, pedidoCompra, finalizado, recebido, codigoDe, topOrcamentoNo4 } from "./f9b-ajuda.js";
import { cnpjComDv, notaSintetica, fornecedorComDocumento, importada, gerar, ITEM_PADRAO, chaveNova } from "./f7-ajuda.js";
import { compraDoXml, cnpjNovo } from "./editar-02-ajuda.js";
import {
  MSG_DOCUMENTO_MUDOU, MSG_EDICAO_EMPRESA, MSG_EDICAO_TROCA_DE_OPERACAO, MSG_EDICAO_CAMPO_DESCONHECIDO, MSG_EDICAO_VERSAO_AUSENTE,
  MSG_EDICAO_VERSAO_INVALIDA, MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO, MSG_EDICAO_ITEM_REPETIDO,
} from "../../src/routes/vendas-edicao-patch.js";
import { MSG_EDICAO_ESPECIE, MSG_EDICAO_DADOS_FISCAIS, MSG_EDICAO_ITEM_SALVO_NAO_SAI } from "../../src/routes/compras-edicao-patch.js";
import {
  MSG_EDICAO_COMPRA_CONFIRMADA, MSG_EDICAO_DOCUMENTO_CANCELADO, MSG_EDICAO_PEDIDO_FINALIZADO, MSG_EDICAO_PEDIDO_CONVERTIDO,
  MSG_EDICAO_DOCUMENTO_APROVADO, msgEdicaoPedidoComCompraViva, MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO, MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO,
  MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO, MSG_EDICAO_QUANTIDADE_DO_PEDIDO_CONVERTIDO, MSG_EDICAO_QUANTIDADE_ACIMA_DO_SALDO,
  MSG_EDICAO_FORNECEDOR_DO_PEDIDO_COM_COMPRA, MSG_EDICAO_ITEM_ORCADO, MSG_EDICAO_COMPRA_DA_NOTA, MSG_EDICAO_ITEM_DA_NOTA,
  MSG_EDICAO_IDENTIDADE_DA_NOTA, MSG_EDICAO_CABECALHO_DA_NOTA, MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DA_NOTA,
} from "../../src/routes/compras-edicao-regras.js";
import { MSG_PEDIDO_SEM_NOTA, MSG_PEDIDO_SEM_DADOS_FISCAIS, MSG_PEDIDO_SEM_LOTE } from "../../src/routes/compras.js";

/**
 * EDITAR-02 (decisão 313) — A PATCH DO PEDIDO DE COMPRA E DA COMPRA (`PATCH /api/compras/{pedidos|compras}/:id`).
 *
 * O que esta suíte prova, nas DUAS espécies onde a regra é das duas:
 *   (a) as recusas de ESTADO (409 INVALID_STATUS_TRANSITION, cada uma com a sua mensagem): compra confirmada (estoque e
 *       títulos contados antes e depois: iguais), cancelado, pedido finalizado, pedido com compra viva (a recusa cita a
 *       compra), pedido convertido, documento aprovado (P2) — e o reprovado edita;
 *   (b) a versão: errada → 409 CONCURRENCY_CONFLICT; DUAS PATCH concorrentes com a mesma versão (duas transações de
 *       verdade, presas numa barreira no banco) → exatamente uma 200 e uma 409;
 *   (c) a versão sobe pelo GATILHO (0063): na PATCH (+1, também a que só muda item), em escritas que não são PATCH
 *       (cancelar, aprovar para orçamento) e num UPDATE que manda `version` direto (o valor mandado não fica);
 *   (d) as chaves proibidas (empresa, TOP e versão congelada, espécie, desconhecida, os dados fiscais, a nota do pedido)
 *       → 422 no campo, juntas, nada gravado;
 *   (f) as recusas do LANÇAMENTO repetidas pela PATCH com o MESMO código, mensagem e detalhes do POST: classificação,
 *       condição não permitida, exigência geral da versão e layout obrigatório;
 *   (h) itens: item salvo ausente (P1), de outro documento e repetido → 422; a compra da nota (P3); a compra gerada de
 *       pedido (D2, com a prova de que o UPDATE do item só cita a coluna que mudou); o pedido com compra cancelada (D4);
 *       o item orçado (D3);
 *   (i) Idempotency-Key; (j) a PATCH que não muda nada; (k) o evento do histórico; (l) a provisão do pedido (D12);
 *   (n) o número de consultas (CONTADO, `.claude/rules/backend-api.md`): 1 × 20 itens mudados no mesmo conjunto de colunas
 *       → as mesmas consultas, tabela por tabela; a conferência de visibilidade antes da chave é o recorte enxuto, e o
 *       documento só é lido completo sob a trava e na resposta (no pedido com orçamentos, a lista e os preços também);
 *   (o) P6 (decisão do dono, o B1 do cético): a compra com chave de acesso não troca fornecedor, número nem série; a compra
 *       VINDA DA NOTA (importada do XML), mesmo sem as duplicatas, não troca frete, outras despesas nem desconto.
 *
 * TESTEMUNHA: o BANCO, lido por conexão de superusuário (sem RLS) — a linha do documento, os itens, os movimentos de
 * estoque, os títulos e a trilha. "Nada gravado" = as fotos idênticas antes e depois, nunca só o status HTTP.
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── chamadas e testemunhas ───────────────

const SEGMENTO: Record<EspecieCompra, string> = { compra: "compras", pedido: "pedidos" };
const ESPECIES: readonly EspecieCompra[] = ["compra", "pedido"];
const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);
const patch = (especie: EspecieCompra, id: string, payload: Record<string, unknown>, headers: Hdr = c.h.headers(), chave?: string): Promise<Resposta> =>
  c.ligada.inject({ method: "PATCH", url: `/api/compras/${SEGMENTO[especie]}/${id}`, headers: comChave(headers, chave), payload });
const post = (url: string, payload: Record<string, unknown> = {}): Promise<Resposta> => c.ligada.inject({ method: "POST", url, headers: c.h.headers(), payload });

type Linha = Record<string, unknown>;
const linha = async (id: string): Promise<Linha> => (await c.admin.query<Linha>("select * from erp.documentos_compra where id = $1", [id])).rows[0]!;
const itensNoBanco = async (id: string): Promise<(Linha & { id: string })[]> =>
  (await c.admin.query<Linha & { id: string }>("select * from erp.documentos_compra_itens where documento_id = $1 order by posicao, id", [id])).rows;
const versao = async (id: string): Promise<string> => (await c.admin.query<{ v: string }>("select version::text v from erp.documentos_compra where id = $1", [id])).rows[0]!.v;
const mais = (v: string, n: number) => String(BigInt(v) + BigInt(n));
type Evento = { id: string; action: string; user_id: string | null; metadata: Record<string, unknown> | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
const eventos = async (id: string): Promise<Evento[]> => (await c.admin.query<Evento>(
  "select id::text, action, user_id, metadata, before, after from erp.audit_logs where entity = 'documentos_compra' and entity_id = $1 order by id", [id])).rows;
const eventosDaPatch = async (id: string) => (await eventos(id)).filter((e) => e.action === "update" && e.metadata?.["via"] === "patch");
/** A foto inteira do documento: linha, itens e trilha. "Nada gravado" = a mesma foto antes e depois. */
const foto = async (id: string) => ({ doc: await linha(id), itens: await itensNoBanco(id), eventos: await eventos(id) });
/** O `xmin` da linha e de cada item: muda a CADA escrita, mesmo com os mesmos valores. */
const xmins = async (id: string) => ({
  doc: (await c.admin.query<{ x: string }>("select xmin::text x from erp.documentos_compra where id = $1", [id])).rows[0]!.x,
  itens: (await c.admin.query<{ id: string; x: string }>("select id, xmin::text x from erp.documentos_compra_itens where documento_id = $1 order by posicao, id", [id])).rows,
});
type Detalhe = { path: string; message: string };
const detalhes = (r: Resposta) => (erro(r).details ?? []) as Detalhe[];
/** Exige a resposta de erro com o status e o código dados; devolve o erro. */
function recusada(r: Resposta, status: number, codigo: string) {
  expect(r.statusCode, r.body).toBe(status);
  const e = erro(r);
  expect(e.code, r.body).toBe(codigo);
  return e;
}

/** Um documento da espécie, pela API (a TOP neutra do formato 4 da espécie, salvo `extra.tipo_operacao_id`). */
async function documento(especie: EspecieCompra, itens: ReturnType<typeof itemCompra>[], extra: Record<string, unknown> = {}): Promise<string> {
  return (await compraLancada(especie, corpoCompra(itens, extra, especie))).id;
}
async function itensDe(especie: EspecieCompra, id: string): Promise<{ id: string; produto_id: string; quantidade: string }[]> {
  const r = await lerCompra(especie, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r).itens as { id: string; produto_id: string; quantidade: string }[];
}
async function condicao(): Promise<string> {
  return (await c.admin.query<{ id: string }>(
    "insert into erp.condicoes_pagamento(organization_id,code,nome,parcelas,dias_primeira_parcela,modo,intervalo_dias,entrada) values ($1,$2,$3,1,30,'intervalo',30,false) returning id::text as id",
    [c.h.demo.orgId, `E2-${unico()}`.slice(0, 20), `Condição E2 ${unico()}`])).rows[0]!.id;
}
/** Os efeitos do documento no ledger e no financeiro (pela origem) e os totais da organização. */
async function efeitos(id: string) {
  const n = async (sql: string, p: unknown[]) => Number((await c.admin.query<{ n: string }>(sql, p)).rows[0]!.n);
  return {
    movimentos: await n("select count(*)::text n from erp.stock_movements where source_type = 'documentos_compra' and source_id = $1", [id]),
    titulos: await n("select count(*)::text n from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1", [id]),
    movimentosDaOrg: await n("select count(*)::text n from erp.stock_movements where organization_id = $1", [c.h.demo.orgId]),
    titulosDaOrg: await n("select count(*)::text n from erp.financial_titles where organization_id = $1", [c.h.demo.orgId]),
  };
}

/** O layout do sistema da família, ajustado, gravado e ligado às TOPs dadas (o caminho real da administração). */
async function layoutLigado(familia: string, ajuste: (e: EstruturaLayout) => void, tops: string[]): Promise<void> {
  const estrutura = structuredClone(LAYOUT_DO_SISTEMA(familia));
  ajuste(estrutura);
  const r = await c.h.app.inject({ method: "POST", url: "/api/admin/layouts-documento", headers: c.h.headers(), payload: { familia, nome: `E2 ${familia} ${unico()}`, estrutura } });
  expect(r.statusCode, `premissa: o layout grava — ${r.body}`).toBe(201);
  const l = await c.h.app.inject({ method: "PUT", url: `/api/admin/layouts-documento/${j(r).id as string}/tops`, headers: c.h.headers(), payload: { tipoOperacaoIds: tops } });
  expect(l.statusCode, l.body).toBe(200);
}
const exigeObservacaoNoLayout = (e: EstruturaLayout) => {
  const campo = e.cabecalho.find((x) => x.campo === "observacao") ?? e.rodape.flatMap((a) => a.campos).find((x) => x.campo === "observacao");
  if (!campo) throw new Error("observacao fora da estrutura");
  Object.assign(campo, { obrigatorio: true, rotulo: "Obs. E2" });
};

/** Um pedido de compra (TOP do formato 4 com o destino "Em partes" para a TOP de compra neutra) e o item dele. */
async function pedidoQueRecebe(quantidade = "10"): Promise<{ topPedido: string; id: string; itemId: string; produtoId: string }> {
  const topPedido = await top("compras.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: c.tops.compra, ordem: 0, emPartes: true }] });
  const p = await produto();
  const id = await documento("pedido", [itemCompra(p.id, quantidade, "10.00")], { tipo_operacao_id: topPedido });
  return { topPedido, id, itemId: (await itensDe("pedido", id))[0]!.id, produtoId: p.id };
}
async function receber(pedidoId: string, itemId: string, quantidade: string): Promise<{ id: string; codigo: string }> {
  const r = await receberPedido(pedidoId, corpoReceber(c.tops.compra, [{ item_origem_id: itemId, quantidade }]));
  expect(r.statusCode, `premissa: o pedido é recebido — ${r.body}`).toBe(201);
  return { id: j(r).id as string, codigo: j(r).codigo as string };
}

// ─────────────── (a) as recusas de ESTADO ───────────────

describe("(a) estado: só a compra aberta e o pedido aberto sem compra viva se editam", () => {
  it("compra CONFIRMADA → 409 'cancele com estorno', e os movimentos de estoque e os títulos ficam EXATAMENTE os mesmos", async () => {
    const p = await produto();
    const id = await documento("compra", [itemCompra(p.id, "3", "10.00")]);
    const conf = await confirmarCompra(id);
    expect(conf.statusCode, conf.body).toBe(200);
    const antes = await efeitos(id);
    expect([antes.movimentos > 0, antes.titulos > 0], "premissa: a confirmação moveu estoque e criou título").toEqual([true, true]);
    const fotoAntes = await foto(id);
    const r = await patch("compra", id, { version: await versao(id), observacao: "corrigir", itens: [{ id: (await itensDe("compra", id))[0]!.id, quantidade: "4" }] });
    const e = recusada(r, 409, "INVALID_STATUS_TRANSITION");
    expect(e.message).toBe(MSG_EDICAO_COMPRA_CONFIRMADA);
    expect(e.message, "a recusa diz o caminho: cancelar com estorno").toContain("cancele a compra");
    expect(e.details).toEqual({ situacao: "confirmado" });
    expect(await efeitos(id), "estoque e financeiro intactos").toEqual(antes);
    expect(await foto(id), "nada gravado").toEqual(fotoAntes);
  });

  it("CANCELADO (pedido e compra) → 409 com a recusa própria; nada gravado", async () => {
    let provados = 0;
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id)]);
      const cancel = await post(`/api/compras/${SEGMENTO[especie]}/${id}/cancel`);
      expect(cancel.statusCode, cancel.body).toBe(200);
      const antes = await foto(id);
      const e = recusada(await patch(especie, id, { version: await versao(id), observacao: "x" }), 409, "INVALID_STATUS_TRANSITION");
      expect([e.message, e.details], especie).toEqual([MSG_EDICAO_DOCUMENTO_CANCELADO, { situacao: "cancelado" }]);
      expect(await foto(id), especie).toEqual(antes);
      provados++;
    }
    expect(provados).toBe(2);
  });

  it("pedido FINALIZADO → 409 com a recusa própria", async () => {
    const id = await documento("pedido", [itemCompra((await produto()).id)]);
    const f = await post(`/api/compras/pedidos/${id}/finalizar`);
    expect(f.statusCode, f.body).toBe(200);
    const antes = await foto(id);
    const e = recusada(await patch("pedido", id, { version: await versao(id), observacao: "x" }), 409, "INVALID_STATUS_TRANSITION");
    expect([e.message, e.details]).toEqual([MSG_EDICAO_PEDIDO_FINALIZADO, { situacao: "finalizado" }]);
    expect(await foto(id)).toEqual(antes);
  });

  it("pedido ABERTO com compra VIVA → 409 que cita a compra (details.compras); pedido CONVERTIDO → 409 próprio", async () => {
    const ped = await pedidoQueRecebe("10");
    const compra = await receber(ped.id, ped.itemId, "4");
    expect((await linha(ped.id)).situacao, "premissa: recebido em parte, o pedido continua aberto").toBe("aberto");
    const antes = await foto(ped.id);
    const e = recusada(await patch("pedido", ped.id, { version: await versao(ped.id), observacao: "x" }), 409, "INVALID_STATUS_TRANSITION");
    expect(e.message).toBe(msgEdicaoPedidoComCompraViva([compra.codigo]));
    expect(e.message).toContain(compra.codigo);
    expect(e.details).toEqual({ situacao: "aberto", compras: [{ id: compra.id, codigo: compra.codigo, situacao: "aberto" }] });
    expect(await foto(ped.id)).toEqual(antes);
    // O resto do saldo: o pedido vira convertido.
    await receber(ped.id, ped.itemId, "6");
    expect((await linha(ped.id)).situacao, "premissa: convertido").toBe("convertido");
    const e2 = recusada(await patch("pedido", ped.id, { version: await versao(ped.id), observacao: "x" }), 409, "INVALID_STATUS_TRANSITION");
    expect([e2.message, e2.details]).toEqual([MSG_EDICAO_PEDIDO_CONVERTIDO, { situacao: "convertido" }]);
  });

  it("APROVADO (P2: a última decisão é 'aprovado') → 409, na compra e no pedido; o REPROVADO edita (premissa)", async () => {
    let provados = 0;
    for (const especie of ESPECIES) {
      const topSempre = await top(especie === "compra" ? "compras.compra" : "compras.pedido", { configuracao: cfg4((x) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; }) });
      const aprovado = await documento(especie, [itemCompra((await produto()).id)], { tipo_operacao_id: topSempre });
      const a = await aprovar("compras", aprovado);
      expect(a.statusCode, `${especie}: ${a.body}`).toBe(200);
      const antes = await foto(aprovado);
      const e = recusada(await patch(especie, aprovado, { version: await versao(aprovado), observacao: "x" }), 409, "INVALID_STATUS_TRANSITION");
      expect([e.message, e.details], especie).toEqual([MSG_EDICAO_DOCUMENTO_APROVADO, { situacao: "aberto", aprovacao: "aprovado" }]);
      expect(await foto(aprovado), especie).toEqual(antes);
      const reprovado = await documento(especie, [itemCompra((await produto()).id)], { tipo_operacao_id: topSempre });
      const rp = await reprovar("compras", reprovado, { motivo: "Preço alto" });
      expect(rp.statusCode, `${especie}: ${rp.body}`).toBe(200);
      const ok = await patch(especie, reprovado, { version: await versao(reprovado), observacao: "corrigido depois da reprovação" });
      expect(ok.statusCode, `${especie}: o reprovado edita — ${ok.body}`).toBe(200);
      provados++;
    }
    expect(provados).toBe(2);
  });
});

// ─────────────── (b) a versão ───────────────

describe("(b) a versão otimista", () => {
  it("versão diferente da gravada → 409 CONCURRENCY_CONFLICT, nada gravado (nas duas espécies)", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id)]);
      const antes = await foto(id);
      const e = recusada(await patch(especie, id, { version: mais(await versao(id), 1), observacao: "x" }), 409, "CONCURRENCY_CONFLICT");
      expect(e.message, especie).toBe(MSG_DOCUMENTO_MUDOU);
      expect(await foto(id), especie).toEqual(antes);
    }
  });

  it("DUAS PATCH concorrentes com a MESMA versão → exatamente uma 200 e uma 409; a versão sobe UMA vez (nas duas espécies)", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id)]);
      const v0 = await versao(id);
      const { respostas, esperando } = await emParaleloComBarreira("select 1 from erp.documentos_compra where id = $1 for update", [id],
        () => patch(especie, id, { version: v0, observacao: "A" }), () => patch(especie, id, { version: v0, observacao: "B" }));
      expect(esperando, `${especie}: premissa — as duas transações esperavam a trava ao mesmo tempo`).toBeGreaterThanOrEqual(2);
      const status = respostas.map((r) => r.statusCode).sort();
      expect(status, `${especie}: ${respostas.map((r) => r.body).join(" | ")}`).toEqual([200, 409]);
      const perdedora = respostas.find((r) => r.statusCode === 409)!;
      expect(erro(perdedora).code).toBe("CONCURRENCY_CONFLICT");
      const vencedora = respostas.find((r) => r.statusCode === 200)!;
      expect(await versao(id), especie).toBe(mais(v0, 1));
      expect((await linha(id)).observacao, especie).toBe(j(vencedora).observacao);
      expect(await eventosDaPatch(id), `${especie}: um evento só`).toHaveLength(1);
    }
  });
});

// ─────────────── (c) a versão sobe pelo gatilho ───────────────

describe("(c) a versão é do GATILHO (0063), nunca da aplicação", () => {
  it("PATCH do cabeçalho +1; PATCH que só muda item +1 (o cabeçalho é tocado); a resposta e o GET trazem a versão nova", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id, "2")]);
      const v0 = await versao(id);
      const r1 = await patch(especie, id, { version: v0, observacao: "um" });
      expect(r1.statusCode, r1.body).toBe(200);
      expect([j(r1).version, await versao(id)], especie).toEqual([mais(v0, 1), mais(v0, 1)]);
      const item = (await itensDe(especie, id))[0]!;
      const r2 = await patch(especie, id, { version: mais(v0, 1), itens: [{ id: item.id, observacao: "obs do item" }] });
      expect(r2.statusCode, r2.body).toBe(200);
      expect(await versao(id), `${especie}: só item mudou, a versão sobe 1`).toBe(mais(v0, 2));
      const g = await lerCompra(especie, id);
      expect(j(g).version, especie).toBe(mais(v0, 2));
    }
  });

  it("escritas que NÃO são PATCH também sobem a versão (cancelar a compra, aprovar o pedido para orçamento)", async () => {
    const compra = await documento("compra", [itemCompra((await produto()).id)]);
    const vc = await versao(compra);
    expect((await post(`/api/compras/compras/${compra}/cancel`)).statusCode).toBe(200);
    expect(await versao(compra)).toBe(mais(vc, 1));
    const pedido = await documento("pedido", [itemCompra((await produto()).id)]);
    const vp = await versao(pedido);
    const ap = await post(`/api/compras/pedidos/${pedido}/aprovar-para-orcamento`);
    expect(ap.statusCode, ap.body).toBe(200);
    expect(await versao(pedido)).toBe(mais(vp, 1));
  });

  it("um UPDATE que manda `version` direto (o superusuário, por SQL) não fixa o valor: vira a anterior + 1", async () => {
    const id = await documento("compra", [itemCompra((await produto()).id)]);
    const v0 = await versao(id);
    const u = await c.admin.query<{ v: string }>("update erp.documentos_compra set version = 999, observacao = 'direto' where id = $1 returning version::text v", [id]);
    expect(u.rows[0]!.v).toBe(mais(v0, 1));
    expect(u.rows[0]!.v).not.toBe("999");
  });
});

// ─────────────── (d) as chaves proibidas ───────────────

describe("(d) o corpo é estrito: o que a edição não troca é 422 no campo, junto, e nada é gravado", () => {
  it("empresa, TOP, versão congelada, espécie, chave desconhecida e padrão da TOP (D11) → 422 com as recusas JUNTAS (nas duas espécies)", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id)]);
      const antes = await foto(id);
      const v = await versao(id);
      const r = await patch(especie, id, { version: v, empresa_id: c.I.empresa2, tipo_operacao_id: c.tops.compra, tipo_operacao_versao_id: c.tops.compra,
        especie: especie === "compra" ? "pedido" : "compra", nota: "1", padroes: { natureza: c.I.category } });
      recusada(r, 422, "VALIDATION_ERROR");
      expect(detalhes(r), especie).toEqual([
        { path: "empresa_id", message: MSG_EDICAO_EMPRESA },
        { path: "tipo_operacao_id", message: MSG_EDICAO_TROCA_DE_OPERACAO },
        { path: "tipo_operacao_versao_id", message: MSG_EDICAO_TROCA_DE_OPERACAO },
        { path: "especie", message: MSG_EDICAO_ESPECIE },
        { path: "nota", message: MSG_EDICAO_CAMPO_DESCONHECIDO },
        { path: "padroes", message: MSG_EDICAO_CAMPO_DESCONHECIDO },
      ]);
      // Cada uma sozinha também é recusa (e a versão ausente ou torta, com o texto da 272).
      for (const [payload, caminho, mensagem] of [
        [{ version: v, empresa_id: c.I.empresa }, "empresa_id", MSG_EDICAO_EMPRESA],
        [{ version: v, tipo_operacao_id: c.tops.compra }, "tipo_operacao_id", MSG_EDICAO_TROCA_DE_OPERACAO],
        [{ version: v, especie }, "especie", MSG_EDICAO_ESPECIE],
        [{ version: v, itens: [{ id: (await itensDe(especie, id))[0]!.id, preco: "1" }] }, "itens[0].preco", MSG_EDICAO_CAMPO_DESCONHECIDO],
        [{ observacao: "x" }, "version", MSG_EDICAO_VERSAO_AUSENTE],
        [{ version: "01", observacao: "x" }, "version", MSG_EDICAO_VERSAO_INVALIDA],
      ] as [Record<string, unknown>, string, string][]) {
        const x = await patch(especie, id, payload);
        recusada(x, 422, "VALIDATION_ERROR");
        expect(detalhes(x), `${especie}: ${caminho}`).toEqual([{ path: caminho, message: mensagem }]);
      }
      expect(await foto(id), `${especie}: nada gravado`).toEqual(antes);
    }
  });

  it("compra: fato fiscal do cabeçalho → 'não mudam depois do lançamento'; pedido: a nota, os fiscais e o lote → as recusas do POST", async () => {
    const compra = await documento("compra", [itemCompra((await produto()).id)]);
    // EDITAR-02B: rateio/tipo_titulo/CAPEX passam a ser aceitos; chave e IPI continuam imutáveis.
    const rc = await patch("compra", compra, { version: await versao(compra), chave_acesso: null, valor_ipi: "1.00" });
    recusada(rc, 422, "VALIDATION_ERROR");
    expect(detalhes(rc)).toEqual([
      { path: "chave_acesso", message: MSG_EDICAO_DADOS_FISCAIS }, { path: "valor_ipi", message: MSG_EDICAO_DADOS_FISCAIS },
    ]);
    const pedido = await documento("pedido", [itemCompra((await produto()).id)]);
    const item = (await itensDe("pedido", pedido))[0]!.id;
    const antes = await foto(pedido);
    const rp = await patch("pedido", pedido, { version: await versao(pedido), numero_nota: "N1", seguro: "1.00", itens: [{ id: item, lote: "L1" }] });
    recusada(rp, 422, "VALIDATION_ERROR");
    expect(detalhes(rp)).toEqual([
      { path: "numero_nota", message: MSG_PEDIDO_SEM_NOTA }, { path: "seguro", message: MSG_PEDIDO_SEM_DADOS_FISCAIS }, { path: "itens[0].lote", message: MSG_PEDIDO_SEM_LOTE },
    ]);
    expect(await foto(pedido)).toEqual(antes);
    // Premissa: o POST do pedido recusa a mesma nota com o MESMO texto.
    const pp = await lancarCompra("pedido", corpoCompra([itemCompra((await produto()).id)], { numero_nota: "N1" }, "pedido"));
    expect(detalhes(pp)).toEqual([{ path: "numero_nota", message: MSG_PEDIDO_SEM_NOTA }]);
  });
});

// ─────────────── (f) as recusas do lançamento, repetidas ───────────────

describe("(f) a PATCH confere pelo MESMO núcleo do POST: mesmo código, mensagem e detalhes", () => {
  /** O erro sem o que não é contrato (o corpo de erro inteiro: código, mensagem e detalhes). */
  const contrato = (r: Resposta) => ({ status: r.statusCode, code: erro(r).code, message: erro(r).message, details: erro(r).details });

  it("CLASSIFICAÇÃO inválida (natureza de receita) — compra e pedido", async () => {
    for (const especie of ESPECIES) {
      const p = await produto();
      const id = await documento(especie, [itemCompra(p.id)], especie === "pedido" ? { categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } : {});
      const r = await patch(especie, id, { version: await versao(id), categoria_financeira_id: c.I.incomeCategory });
      const doPost = await lancarCompra(especie, corpoCompra([itemCompra(p.id)], { categoria_financeira_id: c.I.incomeCategory, centro_custo_id: c.I.costCenter }, especie));
      expect(contrato(r), especie).toEqual(contrato(doPost));
      expect(contrato(r).status, especie).toBe(422);
      expect(detalhes(r)[0]!.path).toBe("categoria_financeira_id");
    }
  });

  it("CONDIÇÃO não permitida pela versão congelada — compra e pedido; a PATCH que não troca a condição não a reconfere", async () => {
    for (const especie of ESPECIES) {
      const permitida = await condicao(); const outra = await condicao();
      const t = await top(especie === "compra" ? "compras.compra" : "compras.pedido", { configuracao: cfg4(), condicoesPermitidas: [permitida] });
      const p = await produto();
      const id = await documento(especie, [itemCompra(p.id)], { tipo_operacao_id: t, condicao_pagamento_id: permitida });
      const r = await patch(especie, id, { version: await versao(id), condicao_pagamento_id: outra });
      const doPost = await lancarCompra(especie, corpoCompra([itemCompra(p.id)], { tipo_operacao_id: t, condicao_pagamento_id: outra }, especie));
      expect(contrato(r), especie).toEqual(contrato(doPost));
      expect(contrato(r).code, especie).toBe("CONDICAO_PAGAMENTO_NAO_PERMITIDA");
      expect((await patch(especie, id, { version: await versao(id), observacao: "sem trocar a condição" })).statusCode, especie).toBe(200);
    }
  });

  it("EXIGÊNCIA GERAL da versão (observação obrigatória) — compra e pedido", async () => {
    for (const especie of ESPECIES) {
      const t = await top(especie === "compra" ? "compras.compra" : "compras.pedido", { configuracao: cfg4((x) => { x.geral.exigeObservacao = true; }) });
      const p = await produto();
      const id = await documento(especie, [itemCompra(p.id)], { tipo_operacao_id: t, observacao: "obrigatória" });
      const antes = await foto(id);
      const r = await patch(especie, id, { version: await versao(id), observacao: null });
      const doPost = await lancarCompra(especie, corpoCompra([itemCompra(p.id)], { tipo_operacao_id: t }, especie));
      expect(contrato(r), especie).toEqual(contrato(doPost));
      expect(contrato(r).code, especie).toBe("TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA");
      expect(await foto(id), especie).toEqual(antes);
    }
  });

  it("LAYOUT obrigatório (o layout ligado HOJE à TOP do documento) — compra e pedido", async () => {
    for (const especie of ESPECIES) {
      const familia = especie === "compra" ? "compras.compra" : "compras.pedido";
      const t = await top(familia, { configuracao: cfg4() });
      const p = await produto();
      const id = await documento(especie, [itemCompra(p.id)], { tipo_operacao_id: t, observacao: "antes do layout" });
      await layoutLigado(familia, exigeObservacaoNoLayout, [t]);
      const r = await patch(especie, id, { version: await versao(id), observacao: null });
      const doPost = await lancarCompra(especie, corpoCompra([itemCompra(p.id)], { tipo_operacao_id: t }, especie));
      expect(contrato(r), especie).toEqual(contrato(doPost));
      expect(contrato(r).code, especie).toBe("LAYOUT_CAMPO_OBRIGATORIO");
      expect(detalhes(r)[0]!.path).toBe("observacao");
    }
  });
});

// ─────────────── (h) itens ───────────────

describe("(h) itens: P1, a compra da nota (P3), a compra do pedido (D2), D3 e D4", () => {
  it("P1: item salvo ausente → 422 em `itens`; item de outro documento e repetido → 422 no id; item novo entra (premissa)", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id, "1"), itemCompra((await produto()).id, "2")]);
      const [a, b] = await itensDe(especie, id);
      const alheio = (await itensDe(especie, await documento(especie, [itemCompra((await produto()).id)])))[0]!.id;
      const antes = await foto(id);
      const v = await versao(id);
      const ausente = await patch(especie, id, { version: v, itens: [{ id: a!.id, observacao: "só um" }] });
      recusada(ausente, 422, "VALIDATION_ERROR");
      expect(detalhes(ausente), especie).toEqual([{ path: "itens", message: MSG_EDICAO_ITEM_SALVO_NAO_SAI }]);
      const outro = await patch(especie, id, { version: v, itens: [{ id: alheio }, { id: a!.id }, { id: b!.id }] });
      expect(detalhes(outro), especie).toEqual([{ path: "itens[0].id", message: MSG_EDICAO_ITEM_DE_OUTRO_DOCUMENTO }]);
      const repetido = await patch(especie, id, { version: v, itens: [{ id: a!.id }, { id: a!.id }, { id: b!.id }] });
      expect(detalhes(repetido), especie).toEqual([{ path: "itens[1].id", message: MSG_EDICAO_ITEM_REPETIDO }]);
      expect(await foto(id), `${especie}: nada gravado`).toEqual(antes);
      const novo = (await produto()).id;
      const ok = await patch(especie, id, { version: v, itens: [{ id: a!.id }, { id: b!.id }, { produto_id: novo, quantidade: "5", valor_unitario: "2.50" }] });
      expect(ok.statusCode, ok.body).toBe(200);
      const depois = await itensNoBanco(id);
      expect(depois.map((x) => [x.id === a!.id || x.id === b!.id ? "salvo" : x.produto_id, x.posicao]), especie).toEqual([["salvo", 0], ["salvo", 1], [novo, 2]]);
      expect(depois.slice(0, 2), `${especie}: os salvos intactos`).toEqual(antes.itens);
    }
  });

  it("P3: a compra da NOTA com as duplicatas — quantidade, valor, descontos, frete, outras, condição e item novo → 422; produto interno, local, observação e datas editam", async () => {
    const emitente = cnpjComDv(`8${String(Date.now() % 1e10).padStart(11, "0").slice(-11)}`);
    const fornecedor = await fornecedorComDocumento(emitente);
    const p = await produto();
    const nota = notaSintetica({ emitenteCnpj: emitente, itens: [{ ...ITEM_PADRAO, codigo: "E2-P3", quantidade: "10.0000", valorUnitario: "100.00", valorProdutos: "1000.00" }],
      duplicatas: [{ numero: "001", vencimento: "2026-10-08", valor: "500.00" }, { numero: "002", vencimento: "2026-11-07", valor: "500.00" }] });
    const conf = await importada(nota.xml, { empresaId: c.I.empresa });
    const g = await gerar(conf.id, { tipo_operacao_id: c.tops.compra, fornecedor_id: fornecedor, data_entrada: "2026-09-10",
      financeiro: { parcelas: "nota", rateio: { tipo: "documento", categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter } },
      itens: [{ n_item: 1, produto_id: p.id, fator: "1", tipo_fator: "multiply", armazem_id: c.I.warehouse }] });
    expect(g.statusCode, `premissa: a compra da nota nasce — ${g.body}`).toBe(201);
    const id = j(g).id as string;
    const banco = await linha(id);
    expect(banco.parcelas_nota, "premissa: as duplicatas gravadas").not.toBeNull();
    const item = (await itensNoBanco(id))[0]!;
    expect(item.n_item_nota, "premissa: o item carrega a linha da nota").toBe(1);
    const antes = await foto(id);
    const v = await versao(id);
    const casos: [Record<string, unknown>, string, string][] = [
      [{ itens: [{ id: item.id, quantidade: "9" }] }, "itens[0].quantidade", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ itens: [{ id: item.id, valor_unitario: "99" }] }, "itens[0].valor_unitario", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ itens: [{ id: item.id, desconto: "1.00" }] }, "itens[0].desconto", MSG_EDICAO_COMPRA_DA_NOTA],
      // L5 (o cético): o desconto em PERCENTUAL do item também forma o total.
      [{ itens: [{ id: item.id, desconto_percentual: "1" }] }, "itens[0].desconto_percentual", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ itens: [{ id: item.id, valor_ipi: "1.00" }] }, "itens[0].valor_ipi", MSG_EDICAO_ITEM_DA_NOTA],
      [{ itens: [{ id: item.id }, { produto_id: p.id, quantidade: "1", valor_unitario: "1" }] }, "itens[1]", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ frete: "5.00" }, "frete", MSG_EDICAO_COMPRA_DA_NOTA],
      // L5 (o cético): as outras despesas do cabeçalho também.
      [{ outras_despesas: "5.00" }, "outras_despesas", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ desconto: "5.00" }, "desconto", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ condicao_pagamento_id: await condicao() }, "condicao_pagamento_id", MSG_EDICAO_COMPRA_DA_NOTA],
      [{ data_vencimento: "2026-12-01" }, "data_vencimento", MSG_EDICAO_COMPRA_DA_NOTA],
    ];
    for (const [payload, caminho, mensagem] of casos) {
      const r = await patch("compra", id, { version: v, ...payload });
      recusada(r, 422, "VALIDATION_ERROR");
      expect(detalhes(r), caminho).toEqual([{ path: caminho, message: mensagem }]);
    }
    expect(await foto(id), "nada gravado").toEqual(antes);
    // EDITAR-02B: produto interno remapeável; local, observação e datas editam; totais/duplicatas intactos.
    const novoProduto = (await produto()).id;
    const ok = await patch("compra", id, { version: v, data_entrada: "2026-09-11", observacao: "conferida",
      itens: [{ id: item.id, produto_id: novoProduto, armazem_id: c.I.warehouse2, observacao: "no silo" }] });
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = await linha(id);
    expect([depois.observacao, depois.data_entrada, depois.valor_total, depois.parcelas_nota]).toEqual(["conferida", "2026-09-11", banco.valor_total, banco.parcelas_nota]);
    expect((await itensNoBanco(id))[0]).toMatchObject({
      produto_id: novoProduto, armazem_id: c.I.warehouse2, observacao: "no silo",
      quantidade: item.quantidade, valor_unitario: item.valor_unitario, n_item_nota: 1,
    });
  });

  it("D2: a compra GERADA de pedido — fornecedor, produto e item novo travados; quantidade até o saldo; com o pedido convertido a quantidade trava e a observação do item ainda edita", async () => {
    const ped = await pedidoQueRecebe("10");
    const compra = await receber(ped.id, ped.itemId, "4");
    const item = (await itensNoBanco(compra.id))[0]!;
    const v = await versao(compra.id);
    const antes = await foto(compra.id);
    const casos: [Record<string, unknown>, string, string][] = [
      [{ fornecedor_id: (await c.admin.query<{ id: string }>("select id::text as id from erp.people where organization_id = $1 and is_provider and id <> $2 and deleted_at is null limit 1", [c.h.demo.orgId, c.I.provider])).rows[0]!.id },
        "fornecedor_id", MSG_EDICAO_FORNECEDOR_DA_COMPRA_DO_PEDIDO],
      [{ itens: [{ id: item.id, produto_id: (await produto()).id }] }, "itens[0].produto_id", MSG_EDICAO_PRODUTO_DA_COMPRA_DO_PEDIDO],
      [{ itens: [{ id: item.id }, { produto_id: ped.produtoId, quantidade: "1", valor_unitario: "1" }] }, "itens[1]", MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DO_PEDIDO],
      [{ itens: [{ id: item.id, quantidade: "10.0001" }] }, "itens[0].quantidade", MSG_EDICAO_QUANTIDADE_ACIMA_DO_SALDO],
    ];
    for (const [payload, caminho, mensagem] of casos) {
      const r = await patch("compra", compra.id, { version: v, ...payload });
      recusada(r, 422, "VALIDATION_ERROR");
      expect(detalhes(r), caminho).toEqual([{ path: caminho, message: mensagem }]);
    }
    expect(await foto(compra.id)).toEqual(antes);
    // Até o saldo (10 do pedido, nenhuma outra compra viva): passa; o banco confere o mesmo (a guarda da origem).
    const ate = await patch("compra", compra.id, { version: v, itens: [{ id: item.id, quantidade: "10", valor_unitario: "9.50" }] });
    expect(ate.statusCode, ate.body).toBe(200);
    expect((await itensNoBanco(compra.id))[0]).toMatchObject({ quantidade: "10.0000", valor_unitario: "9.500000", valor_total: "95.00" });
    // A outra compra zera o pedido (convertido): a quantidade desta trava; a observação do item EDITA — o UPDATE do item
    // só cita a coluna que mudou (citar `quantidade` dispararia a guarda da origem, que recusa o pedido convertido).
    const volta = await patch("compra", compra.id, { version: await versao(compra.id), itens: [{ id: item.id, quantidade: "4" }] });
    expect(volta.statusCode, volta.body).toBe(200);
    await receber(ped.id, ped.itemId, "6");
    expect((await linha(ped.id)).situacao, "premissa: o pedido convertido").toBe("convertido");
    const vc = await versao(compra.id);
    const trava = await patch("compra", compra.id, { version: vc, itens: [{ id: item.id, quantidade: "3" }] });
    expect(detalhes(trava)).toEqual([{ path: "itens[0].quantidade", message: MSG_EDICAO_QUANTIDADE_DO_PEDIDO_CONVERTIDO }]);
    const obs = await patch("compra", compra.id, { version: vc, itens: [{ id: item.id, observacao: "conferido no recebimento", valor_unitario: "9.00" }] });
    expect(obs.statusCode, obs.body).toBe(200);
    expect((await itensNoBanco(compra.id))[0]).toMatchObject({ observacao: "conferido no recebimento", quantidade: "4.0000", valor_unitario: "9.000000", valor_total: "36.00" });
  });

  it("D4: pedido aberto só com compras canceladas edita, mas o fornecedor trava (422 no campo, a mensagem do banco)", async () => {
    const ped = await pedidoQueRecebe("5");
    const compra = await receber(ped.id, ped.itemId, "2");
    expect((await post(`/api/compras/compras/${compra.id}/cancel`)).statusCode).toBe(200);
    const outroFornecedor = (await c.admin.query<{ id: string }>("select id::text as id from erp.people where organization_id = $1 and is_provider and id <> $2 and deleted_at is null limit 1", [c.h.demo.orgId, c.I.provider])).rows[0]!.id;
    const r = await patch("pedido", ped.id, { version: await versao(ped.id), fornecedor_id: outroFornecedor });
    expect(detalhes(r)).toEqual([{ path: "fornecedor_id", message: MSG_EDICAO_FORNECEDOR_DO_PEDIDO_COM_COMPRA }]);
    const ok = await patch("pedido", ped.id, { version: await versao(ped.id), observacao: "a compra foi cancelada", itens: [{ id: ped.itemId, quantidade: "6" }] });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("D3: o item do pedido já ORÇADO não troca produto nem quantidade (422 no campo); o preço e a observação editam", async () => {
    const topOrc = await topOrcamentoNo4();
    const topPedido = await top("compras.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }] });
    const p = await produto();
    const pedido = await documento("pedido", [itemCompra(p.id, "3", "10.00")], { tipo_operacao_id: topPedido });
    const itemId = (await itensDe("pedido", pedido))[0]!.id;
    expect((await post(`/api/compras/pedidos/${pedido}/aprovar-para-orcamento`)).statusCode).toBe(200);
    const orc = await post(`/api/compras/pedidos/${pedido}/orcamentos`, { tipo_operacao_id: topOrc, fornecedor_id: c.I.provider, data_documento: "2026-09-10", itens: [{ item_pedido_id: itemId, valor_unitario: "9.00" }] });
    expect(orc.statusCode, `premissa: o orçamento nasce — ${orc.body}`).toBe(201);
    const v = await versao(pedido);
    for (const [campo, valor] of [["quantidade", "4"], ["produto_id", (await produto()).id]] as const) {
      const r = await patch("pedido", pedido, { version: v, itens: [{ id: itemId, [campo]: valor }] });
      expect(detalhes(r), campo).toEqual([{ path: `itens[0].${campo}`, message: MSG_EDICAO_ITEM_ORCADO }]);
    }
    const ok = await patch("pedido", pedido, { version: v, itens: [{ id: itemId, valor_unitario: "9.50", observacao: "cotado" }] });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

// ─────────────── (i) Idempotency-Key ───────────────

describe("(i) Idempotency-Key", () => {
  it("o reenvio com a mesma chave e o mesmo corpo devolve a MESMA resposta sem gravar de novo; outro autor com a mesma chave → 409", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id)]);
      const v0 = await versao(id);
      const chave = `e2-idem-${especie}-${unico()}`;
      const corpo = { version: v0, observacao: "uma vez" };
      const r1 = await patch(especie, id, corpo, c.h.headers(), chave);
      expect(r1.statusCode, r1.body).toBe(200);
      const depois = await foto(id);
      const r2 = await patch(especie, id, corpo, c.h.headers(), chave);
      expect(r2.statusCode, r2.body).toBe(200);
      expect(j(r2), especie).toEqual(j(r1));
      expect(await foto(id), `${especie}: nada gravado no reenvio`).toEqual(depois);
      expect(await versao(id)).toBe(mais(v0, 1));
      const outro = await usuario(`E2 idem ${especie}`, [`${SEGMENTO[especie] === "compras" ? "compras" : "pedidos_compra"}.edit`, `${SEGMENTO[especie] === "compras" ? "compras" : "pedidos_compra"}.view`]);
      const r3 = await patch(especie, id, corpo, outro, chave);
      expect(recusada(r3, 409, "CONFLICT").message, especie).toContain("Idempotency-Key");
      expect(await foto(id), `${especie}: a chave alheia não grava`).toEqual(depois);
    }
  });
});

// ─────────────── (j) nada muda ───────────────

describe("(j) a PATCH que não muda nada", () => {
  it("só a versão, valor igual, itens iguais (só ids, ou com os valores em outra grafia) → 200 com o GET, sem escrita (versão, linhas, trilha e xmin)", async () => {
    for (const especie of ESPECIES) {
      const id = await documento(especie, [itemCompra((await produto()).id, "2", "10.00", { observacao: "obs 1" })], { observacao: "igual" });
      const antes = await foto(id);
      const x = await xmins(id);
      const item = antes.itens[0]!;
      const v = antes.doc.version as string;
      for (const [nome, payload] of [
        ["só a versão", { version: v }],
        ["observação igual", { version: v, observacao: "igual" }],
        ["itens só com os ids", { version: v, itens: [{ id: item.id }] }],
        ["itens com os valores em outra grafia", { version: Number(v), itens: [{ id: item.id.toUpperCase(), quantidade: "2", valor_unitario: "10", observacao: "obs 1" }] }],
        ["fornecedor igual em maiúsculas", { version: v, fornecedor_id: c.I.provider.toUpperCase() }],
      ] as [string, Record<string, unknown>][]) {
        const r = await patch(especie, id, payload);
        expect(r.statusCode, `${especie} ${nome}: ${r.body}`).toBe(200);
        expect(j(r), `${especie} ${nome}`).toEqual(j(await lerCompra(especie, id)));
        expect(j(r).version, `${especie} ${nome}: a versão não sobe`).toBe(v);
        expect(await foto(id), `${especie} ${nome}: nada gravado`).toEqual(antes);
        expect(await xmins(id), `${especie} ${nome}: nenhuma linha tocada`).toEqual(x);
      }
    }
  });
});

// ─────────────── (k) o histórico ───────────────

describe("(k) o evento do histórico", () => {
  it("um `update` com o autor, `via: patch`, os campos e os derivados, e antes/depois SÓ do que mudou (cabeçalho e itens)", async () => {
    const autor = await usuario("E2 autor", ["compras.edit", "compras.view"]);
    const a = (await produto()).id; const b = (await produto()).id;
    const id = await documento("compra", [itemCompra(a, "2", "10.00", { observacao: "fica" })], { observacao: "antes" });
    const item = (await itensNoBanco(id))[0]!;
    const r = await patch("compra", id, { version: await versao(id), observacao: "depois", itens: [{ id: item.id, valor_unitario: "12.00" }, { produto_id: b, quantidade: "1", valor_unitario: "3.00" }] }, autor);
    expect(r.statusCode, r.body).toBe(200);
    const evs = await eventosDaPatch(id);
    expect(evs).toHaveLength(1);
    const e = evs[0]!;
    const eu = await c.h.app.inject({ method: "GET", url: "/api/auth/me", headers: autor });
    expect(eu.statusCode, eu.body).toBe(200);
    const autorId = (j(eu).user as { id: string }).id;
    expect(autorId, "premissa: o autor não é o admin do seed").not.toBe(c.h.demo.adminUserId);
    expect(e.user_id, "o autor do evento é quem editou").toBe(autorId);
    expect(e.metadata).toEqual({ via: "patch", campos: ["observacao", "valor_itens", "valor_total", "itens"], derivados: ["valor_itens", "valor_total"] });
    expect(e.before).toMatchObject({ observacao: "antes", valor_itens: "20.00", valor_total: "20.00", itens: { alterados: [{ id: item.id, valor_unitario: "10.000000", valor_total: "20.00" }] } });
    expect(e.after).toMatchObject({ observacao: "depois", valor_itens: "27.00", valor_total: "27.00", itens: { alterados: [{ id: item.id, valor_unitario: "12.000000", valor_total: "24.00" }] } });
    const incluidos = (e.after!["itens"] as { incluidos: Record<string, unknown>[] }).incluidos;
    expect(incluidos).toHaveLength(1);
    expect(incluidos[0]).toMatchObject({ produto_id: b, quantidade: "1.0000", valor_total: "3.00", posicao: 1 });
    // O que NÃO mudou não aparece (a observação do item, o fornecedor, a data).
    expect(Object.keys(e.before!).sort()).toEqual(["itens", "observacao", "valor_itens", "valor_total"]);
  });
});

// ─────────────── (l) a provisão (D12) ───────────────

describe("(l) a provisão do pedido de compra (decisão 286) na PATCH", () => {
  it("compra gerada de pedido FINALIZADO e convertido: mudar o valor da compra refaz os previstos do pedido, com o motivo 'Compra X alterada'; o pedido aberto: nenhum efeito", async () => {
    const natureza = c.I.category; const centroDoSeed = c.I.costCenter;
    const topCompra = await topCompraNo5();
    const topPedido = await topPedidoNo5(topCompra.id, { secao: { provisao: true }, padroes: { naturezaId: natureza, centroCustoId: centroDoSeed } });
    const p = await produto();
    // O pedido ABERTO (nunca finalizado) com TOP que provisiona: a PATCH sincroniza e não cria nada.
    const aberto = await pedidoCompra(topPedido.id, p.id);
    const r0 = await patch("pedido", aberto.id, { version: await versao(aberto.id), observacao: "aberto com provisão" });
    expect(r0.statusCode, r0.body).toBe(200);
    const titulosDoAberto = await c.admin.query("select 1 from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1", [aberto.id]);
    expect(titulosDoAberto.rowCount, "o pedido aberto não provisiona").toBe(0);
    expect((await eventos(aberto.id)).filter((e) => e.action === "provisao"), "nem trilha de provisão").toEqual([]);
    // O pedido FINALIZADO provisiona 1000; recebido por inteiro (convertido), o alvo é a soma das partes vivas.
    const ped = await pedidoCompra(topPedido.id, p.id);
    await finalizado(ped.id);
    const compra = await recebido(ped, topCompra.id, "10", "100.00");
    expect((await linha(ped.id)).situacao, "premissa: convertido").toBe("convertido");
    const previstos = async () => (await c.admin.query<{ status: string; amount: string; cancel_reason: string | null }>(
      "select status, amount::text, cancel_reason from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1 order by created_at, installment_number", [ped.id])).rows;
    const antes = await previstos();
    expect(antes.filter((t) => t.status === "previsto").map((t) => t.amount), "premissa: o previsto do pedido").toEqual(["500.00", "500.00"]);
    const item = (await itensNoBanco(compra.id))[0]!;
    const r = await patch("compra", compra.id, { version: await versao(compra.id), itens: [{ id: item.id, valor_unitario: "90.00" }] });
    expect(r.statusCode, r.body).toBe(200);
    const depois = await previstos();
    expect(depois.filter((t) => t.status === "previsto").map((t) => t.amount), "o previsto segue a compra alterada (900)").toEqual(["450.00", "450.00"]);
    const motivo = MOTIVOS_DA_PROVISAO_COMPRA.compraAlterada(await codigoDe(compra.id));
    expect(depois.filter((t) => t.status === "cancelled").map((t) => t.cancel_reason), "os de antes saem cancelados, com o motivo").toEqual([motivo, motivo]);
    // P4: a PATCH não confirma — a compra continua aberta, sem estoque nem título próprio.
    expect((await linha(compra.id)).situacao).toBe("aberto");
    expect(await efeitos(compra.id)).toMatchObject({ movimentos: 0, titulos: 0 });
  });
});

// ─────────────── (n) o número de consultas ───────────────

/** As consultas SQL que a requisição dispara (o molde do ED-9 da EDITAR-01 e do PQ-6): o texto de cada uma, em ordem. */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const sqls = espiao.mock.calls.map((x) => x[0] as unknown).map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
      .filter((x): x is string => typeof x === "string");
    return { r, sqls };
  } finally { espiao.mockRestore(); }
}
/** A leitura COMPLETA do documento (`lerDocumentoCompra`): a junção que só ela faz. */
const SQL_LEITURA_COMPLETA = /dorig\.codigo as origem_codigo/;
/** O recorte da edição, sem junção (`recorteDaEdicao`): com `for update` é a trava; sem, a visibilidade. */
const SQL_RECORTE = /select d\.id, d\.version from erp\.documentos_compra d\b/;
const SQL_CHAVE = /insert into erp\.idempotency_keys\b/;
/** Os orçamentos do pedido e os preços deles (as duas consultas de `lerDocumentoCompra` no pedido de quem vê orçamento). */
const SQL_ORCAMENTOS = /from erp\.documentos_compra o\s+join erp\.people fo\b[\s\S]*o\.pedido_orcado_id = \$2/;
const SQL_PRECOS_DOS_ORCAMENTOS = /from erp\.documentos_compra_itens i\s+join erp\.documentos_compra o on o\.id = i\.documento_id[\s\S]*o\.pedido_orcado_id = \$2/;
const TABELAS_CONTADAS = ["erp.documentos_compra d", "erp.documentos_compra_itens", "erp.products", "erp.people", "erp.tipos_operacao_versoes",
  "erp.financial_titles", "erp.stock_movements", "erp.audit_logs", "erp.idempotency_keys"] as const;
const porTabela = (sqls: string[]) => Object.fromEntries(TABELAS_CONTADAS.map((t) => [t, sqls.filter((q) => q.includes(t)).length]));
const indices = (sqls: string[], re: RegExp) => sqls.flatMap((q, k) => (re.test(q) ? [k] : []));

describe("(n) o número de consultas da PATCH: nenhuma por item; a visibilidade antes da chave é enxuta", () => {
  it("1 × 20 itens mudados no MESMO conjunto de colunas → o MESMO número de consultas, tabela por tabela — compra e pedido", async () => {
    /** Uma PATCH de AQUECIMENTO (a primeira do caminho não entra na conta) e a CONTADA: a quantidade de TODOS os itens. */
    async function contar(especie: EspecieCompra, id: string) {
      const itens = await itensDe(especie, id);
      const aquece = await patch(especie, id, { version: await versao(id), itens: itens.map((i) => ({ id: i.id, quantidade: "2" })) });
      expect(aquece.statusCode, aquece.body).toBe(200);
      const v = await versao(id);
      const { r, sqls } = await comConsultas(() => patch(especie, id, { version: v, itens: itens.map((i) => ({ id: i.id, quantidade: "3" })) }, c.h.headers(), `e2-n-${unico()}`));
      expect(r.statusCode, r.body).toBe(200);
      expect((await itensDe(especie, id)).map((i) => Number(i.quantidade)), `${especie}: premissa — todos os itens mudaram`).toEqual(itens.map(() => 3));
      const recorte = indices(sqls, SQL_RECORTE);
      return {
        itens: itens.length, total: sqls.length, porTabela: porTabela(sqls),
        leiturasCompletas: indices(sqls, SQL_LEITURA_COMPLETA).length,
        updatesDosItens: sqls.filter((q) => /update erp\.documentos_compra_itens\b/.test(q)).length,
        // A ordem: a visibilidade (sem trava) → a chave → a trava (o recorte com `for update`).
        ordem: [recorte.length, /for update/.test(sqls[recorte[0]!]!), indices(sqls, SQL_CHAVE)[0]! > recorte[0]!, /for update of d/.test(sqls[recorte[1]!]!), recorte[1]! > indices(sqls, SQL_CHAVE)[0]!],
      };
    }
    let provados = 0;
    for (const especie of ESPECIES) {
      const um = await documento(especie, [itemCompra((await produto()).id, "1", "10.00")]);
      const produtos: string[] = [];
      for (let k = 0; k < 20; k++) produtos.push((await produto()).id);
      const vinte = await documento(especie, produtos.map((p) => itemCompra(p, "1", "10.00")));
      const [c1, c20] = [await contar(especie, um), await contar(especie, vinte)];
      expect([c1.itens, c20.itens], `${especie}: premissa — 1 e 20 itens`).toEqual([1, 20]);
      expect(c1.total, `${especie}: premissa — o espião viu as consultas`).toBeGreaterThan(10);
      expect(c1.porTabela["erp.documentos_compra_itens"], `${especie}: premissa — os itens foram lidos e gravados`).toBeGreaterThan(1);
      expect(c20, `${especie}: as MESMAS consultas — nenhuma por item`).toEqual({ ...c1, itens: 20 });
      // O documento é lido COMPLETO duas vezes: sob a trava (a pergunta "pode editar?") e a resposta. A conferência de
      // visibilidade antes da chave é o recorte, sem junção e sem trava.
      expect([c1.leiturasCompletas, c1.updatesDosItens], `${especie}: duas leituras completas; um UPDATE para os itens do mesmo conjunto de colunas`).toEqual([2, 1]);
      expect(c1.ordem, `${especie}: a visibilidade (sem trava) antes da chave; a trava depois`).toEqual([2, false, true, true, true]);
      provados++;
    }
    expect(provados).toBe(2);
  });

  it("pedido COM orçamentos (quem vê orçamento): a visibilidade não lê os orçamentos nem os preços — só as leituras completas, sob a trava", async () => {
    const topOrc = await topOrcamentoNo4();
    const topPedido = await top("compras.pedido", { configuracao: cfg4(), destinos: [{ tipoOperacaoId: topOrc, ordem: 0, emPartes: false }] });
    const pedido = await documento("pedido", [itemCompra((await produto()).id, "3", "10.00"), itemCompra((await produto()).id, "2", "10.00")], { tipo_operacao_id: topPedido });
    const itens = await itensDe("pedido", pedido);
    expect((await post(`/api/compras/pedidos/${pedido}/aprovar-para-orcamento`)).statusCode).toBe(200);
    // Dois orçamentos, de dois fornecedores (um orçamento por fornecedor no pedido).
    for (const [fornecedor, valor] of [[c.I.provider, "9.00"], [await fornecedorComDocumento(cnpjComDv(`7${String(Date.now() % 1e10).padStart(11, "0").slice(-11)}`)), "9.50"]] as const) {
      const orc = await post(`/api/compras/pedidos/${pedido}/orcamentos`, { tipo_operacao_id: topOrc, fornecedor_id: fornecedor, data_documento: "2026-09-10",
        itens: itens.map((i) => ({ item_pedido_id: i.id, valor_unitario: valor })) });
      expect(orc.statusCode, `premissa: o orçamento nasce — ${orc.body}`).toBe(201);
    }
    const g = await lerCompra("pedido", pedido);
    expect((j(g).orcamentos as unknown[]).length, "premissa: o GET do pedido traz os dois orçamentos").toBe(2);
    const v = await versao(pedido);
    const { r, sqls } = await comConsultas(() => patch("pedido", pedido, { version: v, observacao: "com orçamentos" }, c.h.headers(), `e2-n-orc-${unico()}`));
    expect(r.statusCode, r.body).toBe(200);
    expect((j(r).orcamentos as unknown[]).length, "a resposta é o documento como o GET (com os orçamentos)").toBe(2);
    const trava = sqls.findIndex((q) => SQL_RECORTE.test(q) && /for update of d/.test(q));
    expect(trava, "premissa: o espião viu a trava").toBeGreaterThanOrEqual(0);
    const [orcamentos, precos] = [indices(sqls, SQL_ORCAMENTOS), indices(sqls, SQL_PRECOS_DOS_ORCAMENTOS)];
    expect([orcamentos.length, precos.length], "os orçamentos e os preços: só nas duas leituras completas (sob a trava e a resposta)").toEqual([2, 2]);
    expect([...orcamentos, ...precos].every((k) => k > trava), "nada dos orçamentos antes da trava (nem antes da chave)").toBe(true);
  });
});

// ─────────────── (o) P6: a identidade da nota e o cabeçalho da compra vinda da nota ───────────────

const IDENTIDADE = ["fornecedor_id", "numero_nota", "serie_nota"] as const;

describe("(o) P6: a chave de acesso trava fornecedor, número e série; a compra vinda da nota trava frete, outras despesas e desconto", () => {
  it("compra do XML com duplicatas e chave (o B1 do cético): fornecedor, número e série → 422 cada um e juntos, nada gravado; o mesmo valor não é troca; confirmar mantém o fornecedor e o número da nota", async () => {
    const x = await compraDoXml({ duplicatas: true });
    const outro = await fornecedorComDocumento(cnpjNovo());
    const antes = await foto(x.id);
    const v = await versao(x.id);
    const troca: Record<(typeof IDENTIDADE)[number], unknown> = { fornecedor_id: outro, numero_nota: "777777", serie_nota: "99" };
    for (const campo of IDENTIDADE) {
      const r = await patch("compra", x.id, { version: v, [campo]: troca[campo] });
      recusada(r, 422, "VALIDATION_ERROR");
      expect(detalhes(r), campo).toEqual([{ path: campo, message: MSG_EDICAO_IDENTIDADE_DA_NOTA }]);
    }
    const juntos = await patch("compra", x.id, { version: v, ...troca });
    expect(detalhes(juntos), "as três juntas, no campo").toEqual(IDENTIDADE.map((path) => ({ path, message: MSG_EDICAO_IDENTIDADE_DA_NOTA })));
    expect(await foto(x.id), "nada gravado").toEqual(antes);
    // O MESMO valor não é troca: 200, e só a observação muda.
    const igual = await patch("compra", x.id, { version: v, fornecedor_id: x.fornecedor, numero_nota: x.nota.numero, serie_nota: x.nota.serie, observacao: "conferida" });
    expect(igual.statusCode, igual.body).toBe(200);
    // Confirmar: a compra e o título são do fornecedor DA NOTA, com o número DA NOTA (o que a chave diz).
    const conf = await confirmarCompra(x.id);
    expect(conf.statusCode, conf.body).toBe(200);
    const depois = await linha(x.id);
    expect([depois.situacao, depois.fornecedor_id, depois.numero_nota, depois.serie_nota, depois.chave_acesso, depois.observacao])
      .toEqual(["confirmado", x.fornecedor, x.nota.numero, x.nota.serie, x.nota.chave, "conferida"]);
    const titulos = (await c.admin.query<{ person_id: string; number: string; amount: string }>(
      "select person_id::text as person_id, number, amount::text as amount from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1 order by installment_number", [x.id])).rows;
    expect(titulos, "os títulos das duplicatas: do fornecedor e com o número da nota (<número>-<parcela>)").toEqual([
      { person_id: x.fornecedor, number: `${x.nota.numero}-1`, amount: "500.00" }, { person_id: x.fornecedor, number: `${x.nota.numero}-2`, amount: "500.00" }]);
  });

  it("compra MANUAL com a chave digitada: as três travam; a compra SEM chave: as três editam (premissa)", async () => {
    const outro = await fornecedorComDocumento(cnpjNovo());
    const comChave = await documento("compra", [itemCompra((await produto()).id)], { chave_acesso: chaveNova(), numero_nota: "123", serie_nota: "1" });
    const semChave = await documento("compra", [itemCompra((await produto()).id)], { numero_nota: "124", serie_nota: "1" });
    const banco = await linha(comChave);
    expect([banco.chave_acesso !== null, banco.dfe_id, (await itensNoBanco(comChave))[0]!.n_item_nota], "premissa: manual — com a chave, sem DF-e nem linha da nota").toEqual([true, null, null]);
    expect((await linha(semChave)).chave_acesso, "premissa: sem chave").toBeNull();
    const troca = { fornecedor_id: outro, numero_nota: "777777", serie_nota: "99" };
    const antes = await foto(comChave);
    const r = await patch("compra", comChave, { version: await versao(comChave), ...troca });
    recusada(r, 422, "VALIDATION_ERROR");
    expect(detalhes(r)).toEqual(IDENTIDADE.map((path) => ({ path, message: MSG_EDICAO_IDENTIDADE_DA_NOTA })));
    expect(await foto(comChave), "nada gravado").toEqual(antes);
    // Sem nota vinda do XML, frete, outras despesas e desconto continuam livres (a P6 só trava a identidade aqui).
    const despesas = await patch("compra", comChave, { version: await versao(comChave), frete: "5.00", outras_despesas: "2.00", desconto: "1.00" });
    expect(despesas.statusCode, despesas.body).toBe(200);
    // Premissa: sem a chave, as três editam.
    const ok = await patch("compra", semChave, { version: await versao(semChave), ...troca });
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = await linha(semChave);
    expect([depois.fornecedor_id, depois.numero_nota, depois.serie_nota]).toEqual([outro, "777777", "99"]);
  });

  it("compra do XML SEM duplicatas: frete, outras despesas, desconto e item novo (D15) → 422 (o motivo da nota); o local e a observação editam; a data do documento segue editável (resíduo declarado)", async () => {
    const x = await compraDoXml({ duplicatas: false });
    expect([x.item.n_item_nota, (await linha(x.id)).dfe_id], "premissa: vinda da nota pela linha da nota (o XML enviado, sem DF-e)").toEqual([1, null]);
    const antes = await foto(x.id);
    const v = await versao(x.id);
    for (const campo of ["frete", "outras_despesas", "desconto"] as const) {
      const r = await patch("compra", x.id, { version: v, [campo]: "5.00" });
      recusada(r, 422, "VALIDATION_ERROR");
      expect(detalhes(r), campo).toEqual([{ path: campo, message: MSG_EDICAO_CABECALHO_DA_NOTA }]);
    }
    // A identidade também (a compra do XML tem a chave), e o item da linha da nota (a P3 de sempre).
    const identidade = await patch("compra", x.id, { version: v, numero_nota: "777777" });
    expect(detalhes(identidade)).toEqual([{ path: "numero_nota", message: MSG_EDICAO_IDENTIDADE_DA_NOTA }]);
    const item = await patch("compra", x.id, { version: v, itens: [{ id: x.item.id, quantidade: "9" }] });
    expect(detalhes(item)).toEqual([{ path: "itens[0].quantidade", message: MSG_EDICAO_ITEM_DA_NOTA }]);
    // D15 (o B3 do cético): o item NOVO poria o total acima da nota (1000.00 → 1050.00) — 422 no item, sem duplicatas também.
    const novo = await patch("compra", x.id, { version: v, itens: [{ id: x.item.id }, { produto_id: (await produto()).id, quantidade: "1", valor_unitario: "50.00" }] });
    recusada(novo, 422, "VALIDATION_ERROR");
    expect(detalhes(novo)).toEqual([{ path: "itens[1]", message: MSG_EDICAO_ITEM_NOVO_NA_COMPRA_DA_NOTA }]);
    expect(await foto(x.id), "nada gravado (o total continua o da nota)").toEqual(antes);
    expect((await linha(x.id)).valor_total, "premissa: o total da nota").toBe("1000.00");
    // O MESMO valor não é troca.
    const banco = await linha(x.id);
    const igual = await patch("compra", x.id, { version: v, frete: String(banco.frete), outras_despesas: String(banco.outras_despesas), desconto: String(banco.desconto) });
    expect(igual.statusCode, igual.body).toBe(200);
    expect(await versao(x.id), "o mesmo valor não grava (a versão não sobe)").toBe(v);
    // O que não veio da nota edita: o local do item e a observação; e a data do documento (o resíduo declarado da P6).
    const ok = await patch("compra", x.id, { version: v, observacao: "conferida", data_documento: "2026-09-09", itens: [{ id: x.item.id, armazem_id: c.I.warehouse2 }] });
    expect(ok.statusCode, ok.body).toBe(200);
    const depois = await linha(x.id);
    expect([depois.observacao, depois.data_documento, depois.frete, depois.valor_total]).toEqual(["conferida", "2026-09-09", banco.frete, banco.valor_total]);
    expect((await itensNoBanco(x.id))[0]).toMatchObject({ armazem_id: c.I.warehouse2, quantidade: x.item.quantidade });
  });
});

// ─────────────── EDITAR-02B (decisão 324): classificação e rateio na compra ABERTA ───────────────

describe("EDITAR-02B: classificação, CAPEX e rateio na compra ABERTA", () => {
  async function segundaNaturezaECentro(): Promise<{ cat: string; cc: string }> {
    const cat = (await c.admin.query<{ id: string }>(
      `select id::text as id from erp.financial_categories
        where organization_id = $1 and nature = any($2::text[]) and kind = 'analytic' and is_active
          and id <> $3 and deleted_at is null
        order by code, id limit 1`,
      [c.h.demo.orgId, ["expense", "both"], c.I.category])).rows[0];
    const cc = (await c.admin.query<{ id: string }>(
      `select id::text as id from erp.cost_centers
        where organization_id = $1 and kind = 'analytic' and is_active and id <> $2 and deleted_at is null
        order by code, id limit 1`,
      [c.h.demo.orgId, c.I.costCenter])).rows[0];
    expect(cat && cc, "premissa: há segunda natureza e centro analíticos ativos no demo").toBeTruthy();
    return { cat: cat!.id, cc: cc!.id };
  }

  it("completa CAPEX/tipo de título, troca para rateio por valor 60/40 e volta; confirmado continua recusando rateio", async () => {
    const p = await produto();
    const id = await documento("compra", [itemCompra(p.id, "1", "27.00")]);
    const tipoTitulo = (await c.admin.query<{ id: string }>(
      "select id::text as id from erp.title_types where (organization_id is null or organization_id = $1) and not is_advance order by name, id limit 1",
      [c.h.demo.orgId])).rows[0]!.id;
    let v = await versao(id);
    const classifica = await patch("compra", id, {
      version: v,
      classificacao_gasto: "opex",
      tipo_titulo_id: tipoTitulo,
    });
    expect(classifica.statusCode, classifica.body).toBe(200);
    expect(await linha(id)).toMatchObject({
      classificacao_gasto: "opex",
      tipo_titulo_id: tipoTitulo,
      rateio_tipo: null,
    });

    const { cat, cc } = await segundaNaturezaECentro();
    v = await versao(id);
    const rateio = await patch("compra", id, {
      version: v,
      categoria_financeira_id: null,
      centro_custo_id: null,
      rateio: {
        tipo: "por_valor",
        linhas: [
          { categoria_financeira_id: c.I.category, centro_custo_id: c.I.costCenter, percentual: "60" },
          { categoria_financeira_id: cat, centro_custo_id: cc, percentual: "40" },
        ],
      },
    });
    expect(rateio.statusCode, rateio.body).toBe(200);
    expect(await linha(id)).toMatchObject({
      categoria_financeira_id: null,
      centro_custo_id: null,
      rateio_tipo: "por_valor",
    });
    const linhas = (await c.admin.query<{ percentual: string; cat: string }>(
      `select percentual::text as percentual, categoria_financeira_id::text as cat
         from erp.documentos_compra_rateio where documento_id = $1 order by posicao`, [id])).rows;
    expect(linhas.map((l) => [l.cat, l.percentual])).toEqual([
      [c.I.category, "60.0000"], [cat, "40.0000"],
    ]);

    // Trocar linhas (DELETE+INSERT) e voltar à classificação única.
    v = await versao(id);
    const volta = await patch("compra", id, {
      version: v,
      rateio: null,
      categoria_financeira_id: c.I.category,
      centro_custo_id: c.I.costCenter,
    });
    expect(volta.statusCode, volta.body).toBe(200);
    expect(await linha(id)).toMatchObject({ rateio_tipo: null, categoria_financeira_id: c.I.category });
    expect((await c.admin.query("select 1 from erp.documentos_compra_rateio where documento_id = $1", [id])).rowCount).toBe(0);

    const conf = await confirmarCompra(id);
    expect(conf.statusCode, conf.body).toBe(200);
    const negado = await patch("compra", id, {
      version: await versao(id),
      rateio: { tipo: "por_produto" },
    });
    recusada(negado, 409, "INVALID_STATUS_TRANSITION");
    expect(erro(negado).message).toBe(MSG_EDICAO_COMPRA_CONFIRMADA);
  });

  it("XML com 2 duplicatas: plano operacional de 3 parcelas grava sem tocar parcelas_nota; confirmação gera 3 títulos", async () => {
    const x = await compraDoXml({ duplicatas: true });
    const id = x.id;
    const notaAntes = (await c.admin.query<{ parcelas_nota: unknown; plano: unknown; op: unknown }>(
      `select parcelas_nota, plano_parcelas as plano, plano_parcelas_operacional as op from erp.documentos_compra where id = $1`, [id])).rows[0]!;
    expect(notaAntes.parcelas_nota, "premissa: duplicatas fiscais").not.toBeNull();
    expect(notaAntes.plano).toBeNull();
    expect(notaAntes.op).toBeNull();

    const planoOp = {
      installments: 3,
      first_due_date: "2026-10-15",
      mode: "interval" as const,
      interval_days: 30,
      has_down_payment: false,
      parcelas: [
        { vencimento: "2026-10-15", valor: "333.34" },
        { vencimento: "2026-11-14", valor: "333.33" },
        { vencimento: "2026-12-14", valor: "333.33" },
      ],
    };
    const r = await patch("compra", id, { version: await versao(id), plano_parcelas: planoOp });
    expect(r.statusCode, r.body).toBe(200);
    const depois = (await c.admin.query<{ parcelas_nota: unknown; plano: unknown; op: unknown }>(
      `select parcelas_nota, plano_parcelas as plano, plano_parcelas_operacional as op from erp.documentos_compra where id = $1`, [id])).rows[0]!;
    expect(depois.parcelas_nota).toEqual(notaAntes.parcelas_nota);
    expect(depois.plano).toBeNull();
    expect(depois.op).toMatchObject({ installments: 3 });

    const conf = await confirmarCompra(id);
    expect(conf.statusCode, conf.body).toBe(200);
    const titulos = (await c.admin.query<{ due_date: string; amount: string }>(
      `select to_char(due_date, 'YYYY-MM-DD') as due_date, amount::text as amount
         from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1
         order by installment_number, due_date`, [id])).rows;
    expect(titulos).toEqual([
      { due_date: "2026-10-15", amount: "333.34" },
      { due_date: "2026-11-14", amount: "333.33" },
      { due_date: "2026-12-14", amount: "333.33" },
    ]);
  });
});
