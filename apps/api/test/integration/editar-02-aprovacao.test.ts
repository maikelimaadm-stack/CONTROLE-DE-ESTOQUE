import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO, type ConfiguracaoTipoOperacaoV4 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, produto, top, cfg4, itemCompra, corpoCompra, compraLancada, lerCompra,
  aprovar, reprovar, fila, decisoesDe, situacaoNoBanco, emParaleloComBarreira, unico,
  type EspecieCompra, type Resposta,
} from "./top-config-08-ajuda.js";
import { MSG_DOCUMENTO_MUDOU, MSG_EDICAO_VERSAO_INVALIDA } from "../../src/routes/vendas-edicao-patch.js";
import { MSG_EDICAO_DOCUMENTO_APROVADO } from "../../src/routes/compras-edicao-regras.js";

/**
 * EDITAR-02 (decisão 313, P5 — decisão do dono) — O APROVAR E O REPROVAR DA COMPRA E DO PEDIDO FICAM AMARRADOS À
 * VERSÃO VISTA (`POST /api/aprovacoes/compras/:id/aprovar|reprovar`, corpo `{ version?, observacao? }` /
 * `{ version?, motivo }`).
 *
 * Desde a EDITAR-02 a compra aberta e o pedido aberto se editam (PATCH), e cada edição sobe a `version` (gatilho da
 * 0063). A decisão leva a versão que o aprovador VIU (a da fila, ou a do documento na consulta) e o servidor a confere,
 * sob a trava do documento, contra a TRAVADA. O que esta suíte prova, nas DUAS espécies:
 *   (a) a versão vista → 200 (aprovar e reprovar; texto e inteiro JSON; a do GET do documento serve igual) — e a
 *       decisão não sobe a versão (o aprovar depois do reprovar usa a mesma);
 *   (b) a PATCH muda o documento → a decisão com a versão ANTIGA é 409 CONCURRENCY_CONFLICT e NADA é gravado: nem a
 *       decisão (`erp.aprovacoes_compra` contada no documento e na organização), nem a trilha, nem — na compra de
 *       Confirmação Automática — a confirmação (movimentos e títulos iguais). Premissa ao lado: com a versão nova, a
 *       mesma decisão passa (e a automática confirma). O 409 não consome a Idempotency-Key, e a versão entra no hash;
 *   (c) a PONTE da janela de deploy: sem `version`, vale "0" (a versão em que todo documento nasce) com a MESMA
 *       conferência — o intocado decide, o mudado é 409; o documento fechado continua com a recusa de hoje;
 *   (d) a fila declara `version` (texto do bigint) em TODA linha, igual ao banco, e a nova depois da PATCH; a SITUAÇÃO
 *       da aprovação (`GET /api/aprovacoes/compras/:id`, a que a consulta lê) também — é a declaração pela qual a web
 *       decide mandar a versão (o GET por id do documento da base também a traz, pelo `d.*`, e não serve);
 *   (e) concorrência de verdade, PATCH × aprovar com a MESMA versão: um passa e o outro é 409 — nunca "aprovado" com
 *       o conteúdo editado. Em paralelo (barreira) e nas duas ordens forçadas (quem chega primeiro à trava);
 *   (f) `version` fora da forma → 422 no campo, nada gravado.
 *
 * TESTEMUNHA: o BANCO, lido por conexão de superusuário (sem RLS) — a linha do documento, as decisões, a trilha, os
 * movimentos e os títulos. "Nada gravado" = as fotos idênticas antes e depois, nunca só o status HTTP.
 */

beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── chamadas ───────────────

const SEGMENTO: Record<EspecieCompra, string> = { compra: "compras", pedido: "pedidos" };
const ESPECIES: readonly EspecieCompra[] = ["compra", "pedido"];
const patch = (especie: EspecieCompra, id: string, payload: Record<string, unknown>): Promise<Resposta> =>
  c.ligada.inject({ method: "PATCH", url: `/api/compras/${SEGMENTO[especie]}/${id}`, headers: c.h.headers(), payload });
const comChave = (chave: string) => ({ ...c.h.headers(), "idempotency-key": chave });

const sempre = (x: ConfiguracaoTipoOperacaoV4) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };
const automatica = (x: ConfiguracaoTipoOperacaoV4) => { x.geral.confirmacao = "automatica"; };
/** Uma TOP NOVA da espécie que SEMPRE exige aprovação; a compra pode, ainda, confirmar sozinha ao ser aprovada. */
const topQueExige = (especie: EspecieCompra, opcoes: { automatica?: boolean } = {}) =>
  top(especie === "compra" ? "compras.compra" : "compras.pedido", { configuracao: cfg4((x) => { sempre(x); if (opcoes.automatica) automatica(x); }) });
/** Um documento NOVO da espécie, com a TOP dada: 1 item de um produto novo (2 × 15.00). */
async function documento(especie: EspecieCompra, topId: string): Promise<string> {
  return (await compraLancada(especie, corpoCompra([itemCompra((await produto()).id, "2", "15.00")], { tipo_operacao_id: topId }, especie))).id;
}
/** Um documento novo de uma TOP nova que exige aprovação (o caso mais comum desta suíte). */
const documentoQueExige = async (especie: EspecieCompra) => documento(especie, await topQueExige(especie));
/** Edita a observação pela PATCH (a versão vista é a do banco no momento): exige o 200 e devolve a versão nova. */
async function editar(especie: EspecieCompra, id: string, observacao: string): Promise<string> {
  const r = await patch(especie, id, { version: await versao(id), observacao });
  expect(r.statusCode, `premissa: a PATCH grava — ${r.body}`).toBe(200);
  return j(r).version as string;
}
const cancelarCompra = (id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/cancel`, headers: c.h.headers(), payload: {} });

type LinhaFila = { id: string; especie: string; situacao: string; version: string } & Record<string, unknown>;
/** A fila de compras INTEIRA (página de 1000, conferida contra o total). */
async function filaToda(): Promise<LinhaFila[]> {
  const r = await fila("compras", c.h.headers(), { pageSize: 1000 });
  expect(r.statusCode, r.body).toBe(200);
  const f = j(r) as unknown as { items: LinhaFila[]; total: number };
  expect(f.items.length, "premissa: a página de 1000 traz a fila inteira").toBe(f.total);
  return f.items;
}
/** A `version` que a FILA mostra para o documento (é ela que a tela de Aprovações manda de volta). */
async function versaoNaFila(id: string): Promise<string> {
  const linha = (await filaToda()).find((l) => l.id === id);
  expect(linha, `premissa: ${id} está na fila`).toBeDefined();
  return linha!.version;
}

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

const versao = async (id: string): Promise<string> =>
  (await c.admin.query<{ v: string }>("select version::text v from erp.documentos_compra where id = $1", [id])).rows[0]!.v;
const mais = (v: string, n: number) => String(BigInt(v) + BigInt(n));
const contar = async (sql: string, params: unknown[]) => Number((await c.admin.query<{ n: string }>(sql, params)).rows[0]!.n);
/**
 * A FOTO do documento e da organização: a linha inteira, as decisões, a trilha, os movimentos e os títulos do
 * documento (pela origem) — e as contagens da organização (decisões de compra, movimentos, títulos).
 */
async function foto(id: string) {
  const org = c.h.demo.orgId;
  return {
    doc: (await c.admin.query("select * from erp.documentos_compra where id = $1", [id])).rows[0],
    decisoes: await decisoesDe("aprovacoes_compra", id),
    trilha: (await c.admin.query("select id::text, action, metadata from erp.audit_logs where entity = 'documentos_compra' and entity_id = $1 order by id", [id])).rows,
    movimentos: await contar("select count(*)::text n from erp.stock_movements where source_type = 'documentos_compra' and source_id = $1", [id]),
    titulos: await contar("select count(*)::text n from erp.financial_titles where source_type = 'documentos_compra' and source_id = $1", [id]),
    decisoesDaOrg: await contar("select count(*)::text n from erp.aprovacoes_compra where organization_id = $1", [org]),
    movimentosDaOrg: await contar("select count(*)::text n from erp.stock_movements where organization_id = $1", [org]),
    titulosDaOrg: await contar("select count(*)::text n from erp.financial_titles where organization_id = $1", [org]),
  };
}
const decididas = async (id: string) => (await decisoesDe("aprovacoes_compra", id)).map((d) => d.decisao);

/** Exige a resposta de erro com o status, o código e a mensagem dados. */
function recusada(r: Resposta, status: number, codigo: string, mensagem?: string) {
  expect(r.statusCode, r.body).toBe(status);
  const e = erro(r);
  expect(e.code, r.body).toBe(codigo);
  if (mensagem !== undefined) expect(e.message, r.body).toBe(mensagem);
  return e;
}
/** O 409 da versão: o MESMO código e o MESMO texto da PATCH e da decisão da venda. */
const mudou = (r: Resposta) => recusada(r, 409, "CONCURRENCY_CONFLICT", MSG_DOCUMENTO_MUDOU);

// ─────────────── (a) a versão vista ───────────────

describe("(a) com a versão vista, aprovar e reprovar passam — compra e pedido", () => {
  it("a versão da FILA (texto; no pedido, o inteiro JSON): reprovar → 200; a decisão não sobe a versão; aprovar com a mesma → 200", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const vista = await versaoNaFila(id);
      expect(vista, `${especie}: premissa — o documento nasce na versão 0 (0063), e a fila mostra a do banco`).toBe("0");
      expect(vista).toBe(await versao(id));
      const comoVai = especie === "pedido" ? Number(vista) : vista;
      const rep = await reprovar("compras", id, { version: comoVai, motivo: "Preço acima do combinado" });
      expect(rep.statusCode, `${especie}: ${rep.body}`).toBe(200);
      expect(j(rep)).toEqual({ aprovacao: { decisao: "reprovado", decididoEm: expect.any(String) } });
      expect(await versao(id), `${especie}: a decisão não toca o documento (a versão é a mesma)`).toBe(vista);
      const apr = await aprovar("compras", id, { version: comoVai, observacao: "Revisto" });
      expect(apr.statusCode, `${especie}: ${apr.body}`).toBe(200);
      expect(await decididas(id), especie).toEqual(["reprovado", "aprovado"]);
    }
  });

  it("documento EDITADO: a versão que o GET do documento (a consulta) devolve AGORA — ≠ 0 — decide", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      await editar(especie, id, "primeira edição");
      await editar(especie, id, "segunda edição");
      const g = await lerCompra(especie, id);
      expect(g.statusCode, g.body).toBe(200);
      const doGet = j(g).version as string;
      expect(doGet, `${especie}: premissa — duas edições, duas subidas`).toBe("2");
      const apr = await aprovar("compras", id, { version: doGet });
      expect(apr.statusCode, `${especie}: ${apr.body}`).toBe(200);
      expect(await decididas(id), especie).toEqual(["aprovado"]);
    }
  });
});

// ─────────────── (b) a PATCH mudou o documento ───────────────

describe("(b) a PATCH mudou o documento: a decisão com a versão ANTIGA é 409 e nada é gravado", () => {
  it("compra de Confirmação Automática: aprovar e reprovar antigos → 409; nenhuma decisão, nenhuma confirmação (estoque e títulos iguais); com a nova, aprova E confirma", async () => {
    const id = await documento("compra", await topQueExige("compra", { automatica: true }));
    const vista = await versaoNaFila(id);
    const nova = await editar("compra", id, "editada depois da fila");
    expect(nova, "premissa: a PATCH subiu a versão").toBe(mais(vista, 1));
    const antes = await foto(id);
    expect([antes.decisoes.length, antes.movimentos, antes.titulos], "premissa: nada decidido nem confirmado ainda").toEqual([0, 0, 0]);

    mudou(await aprovar("compras", id, { version: vista, observacao: "ok" }));
    mudou(await reprovar("compras", id, { version: vista, motivo: "não" }));
    expect(await foto(id), "nada gravado: o documento, as decisões, a trilha, o estoque e os títulos — no documento e na organização").toEqual(antes);
    expect(await situacaoNoBanco("documentos_compra", id)).toBe("aberto");

    // PREMISSA: a mesma decisão, com a versão que a fila mostra AGORA, passa — e a automática confirma.
    expect(await versaoNaFila(id)).toBe(nova);
    const apr = await aprovar("compras", id, { version: nova, observacao: "ok" });
    expect(apr.statusCode, apr.body).toBe(200);
    expect(j(apr).confirmacaoAutomatica).toEqual({ confirmado: true });
    const depois = await foto(id);
    expect(await situacaoNoBanco("documentos_compra", id)).toBe("confirmado");
    expect([depois.decisoes.map((d) => d.decisao), depois.movimentos > 0, depois.titulos > 0, depois.decisoesDaOrg - antes.decisoesDaOrg])
      .toEqual([["aprovado"], true, true, 1]);
  });

  it("pedido: o antigo → 409, nada gravado; reprovado, EDITADO pelo comprador e aprovado com a versão de antes da edição → 409; com a nova → 200", async () => {
    const id = await documentoQueExige("pedido");
    const v0 = await versaoNaFila(id);
    const v1 = await editar("pedido", id, "corrigido");
    const antes = await foto(id);
    mudou(await aprovar("compras", id, { version: v0 }));
    mudou(await reprovar("compras", id, { version: v0, motivo: "não" }));
    expect(await foto(id), "nada gravado").toEqual(antes);

    // Reprovado na versão vista; o reprovado se edita (P2) e sobe a versão; o aprovador com a fila velha é recusado.
    expect((await reprovar("compras", id, { version: v1, motivo: "Quantidade errada" })).statusCode).toBe(200);
    const v2 = await editar("pedido", id, "quantidade corrigida");
    const antesDaVelha = await foto(id);
    mudou(await aprovar("compras", id, { version: v1, observacao: "agora sim" }));
    expect(await foto(id), "nada gravado: a última decisão continua a reprovação").toEqual(antesDaVelha);
    expect(await decididas(id)).toEqual(["reprovado"]);

    const apr = await aprovar("compras", id, { version: v2, observacao: "agora sim" });
    expect(apr.statusCode, apr.body).toBe(200);
    expect(await decididas(id)).toEqual(["reprovado", "aprovado"]);
  });

  it("o 409 não consome a Idempotency-Key; a `version` entra no hash (a mesma chave sem ela é outro corpo)", async () => {
    const id = await documentoQueExige("compra");
    const v1 = await editar("compra", id, "editada");
    const chave = `e2-ap-${unico()}`;
    mudou(await aprovar("compras", id, { version: "0" }, comChave(chave)));
    const r1 = await aprovar("compras", id, { version: v1 }, comChave(chave));
    expect(r1.statusCode, `o 409 desfez a transação inteira, a reserva da chave inclusive — ${r1.body}`).toBe(200);
    const r2 = await aprovar("compras", id, { version: v1 }, comChave(chave));
    expect([r2.statusCode, r2.body], "o reenvio devolve o corpo gravado").toEqual([200, r1.body]);
    expect(await decididas(id), "uma decisão só").toEqual(["aprovado"]);
    recusada(await aprovar("compras", id, {}, comChave(chave)), 409, "CONFLICT", "Idempotency-Key reutilizada com corpo diferente");
    expect(await decididas(id)).toEqual(["aprovado"]);
  });
});

// ─────────────── (c) a ponte ───────────────

describe("(c) a PONTE: sem `version` vale a versão em que o documento nasce (0), com a MESMA conferência", () => {
  it("documento INTOCADO (versão 0): aprovar `{}` e reprovar `{ motivo }` → 200 (o corpo da web anterior)", async () => {
    for (const especie of ESPECIES) {
      const paraAprovar = await documentoQueExige(especie);
      const paraReprovar = await documentoQueExige(especie);
      expect([await versao(paraAprovar), await versao(paraReprovar)], `${especie}: premissa — intocados`).toEqual(["0", "0"]);
      const a = await aprovar("compras", paraAprovar, {});
      expect(a.statusCode, `${especie}: ${a.body}`).toBe(200);
      const r = await reprovar("compras", paraReprovar, { motivo: "Sem orçamento" });
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(200);
      expect([await decididas(paraAprovar), await decididas(paraReprovar)], especie).toEqual([["aprovado"], ["reprovado"]]);
    }
  });

  it("documento MUDADO (versão > 0): sem `version` → 409 CONCURRENCY_CONFLICT, nada gravado — nunca 'sem conferência'; com a versão → 200", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const v1 = await editar(especie, id, "mudou");
      const antes = await foto(id);
      mudou(await aprovar("compras", id, {}));
      mudou(await aprovar("compras", id, { observacao: "ok" }));
      mudou(await reprovar("compras", id, { motivo: "não" }));
      expect(await foto(id), `${especie}: nada gravado`).toEqual(antes);
      const a = await aprovar("compras", id, { version: v1 });
      expect(a.statusCode, `${especie}: premissa — com a versão, passa — ${a.body}`).toBe(200);
    }
  });

  it("documento FECHADO (cancelado: a versão subiu) sem `version` → a recusa de hoje, 'Só documento aberto…' (a situação vem antes da versão)", async () => {
    const id = await documentoQueExige("compra");
    const cancel = await cancelarCompra(id);
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await versao(id), "premissa: cancelar sobe a versão (gatilho da 0063)").not.toBe("0");
    const antes = await foto(id);
    recusada(await aprovar("compras", id, {}), 409, "CONFLICT", MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO);
    recusada(await reprovar("compras", id, { version: "0", motivo: "x" }), 409, "CONFLICT", MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO);
    expect(await foto(id)).toEqual(antes);
  });
});

// ─────────────── (d) a fila declara a versão ───────────────

describe("(d) a fila de compras declara `version`", () => {
  it("TODA linha traz `version` (texto do bigint) igual à do banco; depois da PATCH, a nova; e ela decide", async () => {
    const compra = await documentoQueExige("compra");
    const pedido = await documentoQueExige("pedido");
    await editar("pedido", pedido, "um");
    await editar("pedido", pedido, "dois");
    const f = await filaToda();
    expect(f.length, "premissa: a fila tem linhas").toBeGreaterThanOrEqual(2);
    const banco = new Map((await c.admin.query<{ id: string; v: string }>(
      "select id, version::text v from erp.documentos_compra where id = any($1::uuid[])", [f.map((l) => l.id)])).rows.map((x) => [x.id, x.v]));
    expect(banco.size, "cada linha da fila é um documento do banco").toBe(f.length);
    for (const l of f) {
      expect(typeof l.version, l.id).toBe("string");
      expect(l.version, l.id).toMatch(/^(0|[1-9]\d*)$/);
      expect(l.version, l.id).toBe(banco.get(l.id));
    }
    const linha = (id: string) => f.find((l) => l.id === id)!;
    expect([linha(compra).especie, linha(compra).version, linha(pedido).especie, linha(pedido).version]).toEqual(["compra", "0", "pedido", "2"]);
    for (const id of [compra, pedido]) {
      const a = await aprovar("compras", id, { version: linha(id).version });
      expect(a.statusCode, a.body).toBe(200);
    }
  });

  it("a SITUAÇÃO da aprovação (`GET /api/aprovacoes/compras/:id`, a que a consulta lê) declara `version` no FIM, igual ao banco — a declaração que a base nunca faz", async () => {
    const lerSituacao = (id: string) => c.ligada.inject({ method: "GET", url: `/api/aprovacoes/compras/${id}`, headers: c.h.headers() });
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const s0 = await lerSituacao(id);
      expect(s0.statusCode, s0.body).toBe(200);
      expect(Object.keys(j(s0)), `${especie}: aditivo, no fim`).toEqual(["situacao", "ultimaDecisao", "version"]);
      expect(j(s0), especie).toEqual({ situacao: "pendente", ultimaDecisao: null, version: "0" });
      const v1 = await editar(especie, id, "mudou");
      const s1 = await lerSituacao(id);
      expect([j(s1)["version"], await versao(id)], `${especie}: depois da PATCH, a nova`).toEqual([v1, v1]);
      // A consulta manda de volta a versão do documento mostrado: a do GET por id, a mesma da situação.
      const g = await lerCompra(especie, id);
      expect(j(g).version, especie).toBe(v1);
      const a = await aprovar("compras", id, { version: j(g).version });
      expect(a.statusCode, a.body).toBe(200);
      expect(j(await lerSituacao(id)), `${especie}: a decisão não muda a versão declarada`)
        .toMatchObject({ situacao: "aprovado", version: v1 });
    }
  });
});

// ─────────────── (e) concorrência ───────────────

const SQL_TRAVA = "select 1 from erp.documentos_compra where id = $1 for update";
const ESPERANDO_TRAVA = "select count(*)::text n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'";

/**
 * AS DUAS NA ORDEM DADA: uma conexão própria segura a trava do documento; a PRIMEIRA requisição é disparada e só
 * quando ela está esperando a trava no banco a SEGUNDA é disparada; a barreira cai com as duas esperando. A fila da
 * trava de linha do Postgres é por ordem de chegada (a primeira segura a trava da tupla e a segunda espera atrás
 * dela): é quem chega primeiro que decide — sem sorte de escalonador.
 */
async function naOrdemComBarreira(id: string, primeira: () => Promise<Resposta>, segunda: () => Promise<Resposta>):
  Promise<{ respostas: [Resposta, Resposta]; esperando: [number, number] }> {
  const barreira = await c.admin.connect();
  const ate = async (n: number) => {
    const limite = Date.now() + 15_000;
    let agora = 0;
    while (Date.now() < limite) {
      agora = await contar(ESPERANDO_TRAVA, []);
      if (agora >= n) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return agora;
  };
  try {
    await barreira.query("begin");
    expect((await barreira.query(SQL_TRAVA, [id])).rowCount, "premissa: a barreira travou a linha").toBe(1);
    const p1 = primeira();
    const e1 = await ate(1);
    const p2 = segunda();
    const e2 = await ate(2);
    await barreira.query("rollback");
    return { respostas: await Promise.all([p1, p2]) as [Resposta, Resposta], esperando: [e1, e2] };
  } finally {
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}

describe("(e) concorrência PATCH × aprovar com a MESMA versão: um passa, o outro é 409 — nunca aprovado com o conteúdo editado", () => {
  const EDITADA = "editada no meio da aprovação";

  it("em paralelo de verdade (as duas presas na trava do documento): exatamente um 200 e um 409, e o desfecho é coerente", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const v0 = await versao(id);
      const { respostas, esperando } = await emParaleloComBarreira(SQL_TRAVA, [id],
        () => patch(especie, id, { version: v0, observacao: EDITADA }), () => aprovar("compras", id, { version: v0 }));
      expect(esperando, `${especie}: premissa — as duas transações esperavam a trava ao mesmo tempo`).toBeGreaterThanOrEqual(2);
      const [rp, ra] = respostas;
      expect([rp.statusCode, ra.statusCode].sort(), `${especie}: ${rp.body} | ${ra.body}`).toEqual([200, 409]);
      const decisoes = await decididas(id);
      const observacao = (await c.admin.query<{ o: string | null }>("select observacao o from erp.documentos_compra where id = $1", [id])).rows[0]!.o;
      if (rp.statusCode === 200) {
        // A PATCH chegou primeiro: o aprovar leu a versão nova sob a trava.
        mudou(ra);
        expect([decisoes, await versao(id), observacao], especie).toEqual([[], mais(v0, 1), EDITADA]);
      } else {
        // O aprovar chegou primeiro: a PATCH viu o documento aprovado (P2) — o conteúdo aprovado é o que ficou.
        recusada(rp, 409, "INVALID_STATUS_TRANSITION", MSG_EDICAO_DOCUMENTO_APROVADO);
        expect([decisoes, await versao(id)], especie).toEqual([["aprovado"], v0]);
        expect(observacao, especie).not.toBe(EDITADA);
      }
      expect(decisoes.includes("aprovado") && observacao === EDITADA, `${especie}: NUNCA aprovado com o conteúdo editado`).toBe(false);
    }
  });

  it("a PATCH chega primeiro à trava → o aprovar espera, lê a versão nova e é 409: nada decidido", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const v0 = await versao(id);
      const { respostas: [rp, ra], esperando } = await naOrdemComBarreira(id,
        () => patch(especie, id, { version: v0, observacao: EDITADA }), () => aprovar("compras", id, { version: v0 }));
      expect(esperando, `${especie}: premissa — a primeira esperava sozinha, depois as duas`).toEqual([1, 2]);
      expect(rp.statusCode, `${especie}: ${rp.body}`).toBe(200);
      mudou(ra);
      expect([await decididas(id), await versao(id)], especie).toEqual([[], mais(v0, 1)]);
    }
  });

  it("o aprovar chega primeiro à trava → a PATCH espera, vê o aprovado e é 409: o documento fica como foi aprovado", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const v0 = await versao(id);
      const docAntes = (await c.admin.query("select * from erp.documentos_compra where id = $1", [id])).rows[0];
      const { respostas: [ra, rp], esperando } = await naOrdemComBarreira(id,
        () => aprovar("compras", id, { version: v0 }), () => patch(especie, id, { version: v0, observacao: EDITADA }));
      expect(esperando, `${especie}: premissa — a primeira esperava sozinha, depois as duas`).toEqual([1, 2]);
      expect(ra.statusCode, `${especie}: ${ra.body}`).toBe(200);
      recusada(rp, 409, "INVALID_STATUS_TRANSITION", MSG_EDICAO_DOCUMENTO_APROVADO);
      expect(await decididas(id), especie).toEqual(["aprovado"]);
      expect((await c.admin.query("select * from erp.documentos_compra where id = $1", [id])).rows[0], `${especie}: o documento é o aprovado`).toEqual(docAntes);
    }
  });
});

// ─────────────── (f) a forma da versão ───────────────

describe("(f) `version` fora da forma → 422 no campo, nada gravado", () => {
  it("zero à esquerda, negativo, fração, acima do bigint, vazio, com espaço, nulo, booleano — no aprovar e no reprovar", async () => {
    for (const especie of ESPECIES) {
      const id = await documentoQueExige(especie);
      const antes = await foto(id);
      for (const v of ["01", -1, 1.5, "9223372036854775808", "", " 0", "1e3", null, true]) {
        for (const r of [await aprovar("compras", id, { version: v }), await reprovar("compras", id, { version: v, motivo: "x" })]) {
          const e = recusada(r, 422, "VALIDATION_ERROR");
          expect(e.details, `${especie}: ${JSON.stringify(v)}`).toEqual([{ path: "version", message: MSG_EDICAO_VERSAO_INVALIDA }]);
        }
      }
      expect(await foto(id), `${especie}: nada gravado`).toEqual(antes);
      // Premissa: a forma canônica, no limite do bigint, passa da forma (e só então a conferência recusa: 409).
      mudou(await aprovar("compras", id, { version: "9223372036854775807" }));
    }
  });
});
