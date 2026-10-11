import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { mensagemDosPadroesTrocados, type ConfiguracaoTipoOperacaoV4, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, cfg4, top, versaoAtualNoBanco, produto, itemCompra, corpoCompra, lancarCompra, compraLancada,
  confirmarCompra, previaCompra, movimentosDe, type Produto, type Resposta
} from "./top-config-08-ajuda.js";
import { COMPRA, cfg5Fin, topCompraNo5, topPedidoNo5, cadastroDespesa, centro, situacaoDe, titulosDe, contar, type PadroesNoCorpo } from "./f9b-ajuda.js";

/**
 * LANCAMENTO-01 R2 (decisão 311, emenda R2) — AS DUAS CORREÇÕES DO SERVIDOR.
 *
 *   LANC-C1  P4 no SALVAR: a TOP no formato 5 com o tipo de título X nos padrões e `documentoTroca` desligado → a compra
 *            que gera título com o tipo Y (≠ X) é recusada (422 TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA em
 *            `financeiroPadrao.documentoTroca`, a mensagem de "o tipo de título"), NADA gravado; com X, sem tipo, e numa
 *            TOP que deixa trocar com Y → 201, gravada com o tipo pedido. O PEDIDO não carrega tipo de título (os dados
 *            fiscais são só da compra): o corpo dele com o campo é a recusa de hoje — por isso a provisão não muda;
 *   LANC-C2  P4 na CONFIRMAÇÃO (a rede): a compra ABERTA com Y gravado direto no banco (o salvar já recusaria) → a prévia
 *            anota e a confirmação lança a MESMA recusa, nada confirmado (sem título, sem movimento, aberta); premissa:
 *            com X, confirma e o título leva X;
 *   LANC-C3  P3 a COERÊNCIA de `regras-da-operacao`: uma versão nova da MESMA TOP publicada NO MEIO da requisição (logo
 *            depois da consulta da existência, por uma conexão à parte, autocommit) não entra na resposta — tudo sai da
 *            versão capturada na existência (formato, exigências, regras gerais, títulos, seção e padrões), e cada
 *            consulta da TOP depois da existência é endereçada pelo id DESSA versão; as consultas da TOP continuam as 5 de
 *            hoje. Premissa: a versão nova é distinguível em cada campo (uma requisição seguinte a responde).
 *
 * O QUE CONTA COMO PROVA: a TOP, a versão corrente, a linha dos padrões, a compra, os títulos e os movimentos LIDOS NO
 * BANCO pela testemunha (`c.admin`, superusuário, sem RLS); toda recusa "sem efeito" vem com a premissa ao lado. As
 * mensagens esperadas estão escritas AQUI, à mão.
 */

beforeAll(async () => {
  await iniciar();
  const tipos = (await c.admin.query<{ id: string }>(
    "select id::text as id from erp.title_types where (organization_id is null or organization_id = $1) and not is_advance order by name, id limit 2",
    [c.h.demo.orgId])).rows.map((x) => x.id);
  expect(tipos, "premissa: dois tipos de título comuns (X e Y)").toHaveLength(2);
  [tipoX, tipoY] = tipos as [string, string];
  forma = (await c.admin.query<{ id: string }>("select id::text as id from erp.payment_methods where organization_id is null and is_active order by name, id limit 1")).rows[0]!.id;
  natureza = await cadastroDespesa("Natureza padrão LANC-C");
  centroC = await centro("Centro padrão LANC-C");
  naturezaB = await cadastroDespesa("Natureza da versão nova LANC-C");
  centroB = await centro("Centro da versão nova LANC-C");
  prod = await produto();
}, 240_000);
afterAll(encerrar);

let tipoX = ""; let tipoY = ""; let forma = ""; let natureza = ""; let centroC = ""; let naturezaB = ""; let centroB = "";
let prod: Produto;

const MSG = {
  trocaDoTipo: "Esta operação não deixa trocar o tipo de título: use o padrão da TOP.",
  pedidoSemDadosFiscais: "O pedido de compra não tem dados fiscais: este campo é da compra",
} as const;
const RECUSA_DO_TIPO = {
  code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: MSG.trocaDoTipo,
  details: { exigencias: [{ caminho: "financeiroPadrao.documentoTroca", mensagem: MSG.trocaDoTipo }] },
};

/** Os padrões da TOP: o par (natureza e centro) e o tipo de título X. */
const PADROES_X = (): PadroesNoCorpo => ({ naturezaId: natureza, centroCustoId: centroC, tipoTituloId: tipoX });

/** A compra de 10 (1 × 10, gera título) na TOP dada, SEM natureza e centro (o par vem da TOP) e com o tipo dado. */
const corpo = (topId: string, tipoTitulo?: string) =>
  corpoCompra([itemCompra(prod.id, "1", "10.00")], {
    tipo_operacao_id: topId, categoria_financeira_id: null, centro_custo_id: null, ...(tipoTitulo ? { tipo_titulo_id: tipoTitulo } : {}),
  });
/** O tipo de título que a compra GRAVOU (o banco). */
const tipoGravado = async (id: string) =>
  (await c.admin.query<{ t: string | null }>("select tipo_titulo_id::text t from erp.documentos_compra where id=$1", [id])).rows[0]!.t;
/** A seção da versão corrente da TOP como o banco a guarda (só `documentoTroca`). */
const trocaNoBanco = async (topId: string) =>
  ((await versaoAtualNoBanco(topId)).configuracao.financeiroPadrao as { documentoTroca: boolean }).documentoTroca;

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-C1
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-C1 P4 no salvar: o tipo de título trocado é recusado com documentoTroca desligado", () => {
  it("LANC-C1a TOP sem troca com o tipo X → compra com Y: 422 em financeiroPadrao.documentoTroca (o tipo de título), nada gravado; com X, sem tipo e numa TOP que deixa trocar com Y → 201", async () => {
    expect(tipoX, "premissa: X e Y são tipos diferentes").not.toBe(tipoY);
    expect(MSG.trocaDoTipo, "a mensagem é a do domínio para o tipo de título").toBe(mensagemDosPadroesTrocados(["tipoTitulo"]));
    const semTroca = await topCompraNo5({ secao: { documentoTroca: false }, padroes: PADROES_X() });
    const comTroca = await topCompraNo5({ padroes: PADROES_X() });
    expect([await trocaNoBanco(semTroca.id), await trocaNoBanco(comTroca.id)], "premissa: a seção de cada TOP no banco").toEqual([false, true]);

    const antes = await contar("documentos_compra");
    const r = await lancarCompra("compra", corpo(semTroca.id, tipoY));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(RECUSA_DO_TIPO);
    expect(await contar("documentos_compra"), "nada gravado").toBe(antes);

    let provados = 0;
    for (const [nome, topId, tipo, esperado] of [
      ["sem troca, com o tipo X (o da TOP)", semTroca.id, tipoX, tipoX],
      ["sem troca, sem tipo (vazio não é troca)", semTroca.id, undefined, null],
      ["a TOP deixa trocar, com o tipo Y", comTroca.id, tipoY, tipoY],
    ] as const) {
      const compra = await compraLancada("compra", corpo(topId, tipo));
      expect(await tipoGravado(compra.id), nome).toBe(esperado);
      provados++;
    }
    expect([provados, await contar("documentos_compra")], "as três salvas").toEqual([3, antes + 3]);
  });

  it("LANC-C1b o PEDIDO não carrega tipo de título: o corpo com o campo é a recusa de hoje (dados fiscais só da compra), mesmo numa TOP com provisão e sem troca; premissa: sem o campo, salva", async () => {
    const destino = await topCompraNo5({ secao: { documentoTroca: false }, padroes: PADROES_X() });
    const pedidoTop = await topPedidoNo5(destino.id, { secao: { provisao: true, documentoTroca: false }, padroes: PADROES_X() });
    const corpoPedido = (extra: Record<string, unknown>) => corpoCompra([itemCompra(prod.id, "1", "10.00")], { tipo_operacao_id: pedidoTop.id, ...extra }, "pedido");
    const antes = await contar("documentos_compra");
    const r = await lancarCompra("pedido", corpoPedido({ tipo_titulo_id: tipoY }));
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual({ code: "VALIDATION_ERROR", message: MSG.pedidoSemDadosFiscais, details: [{ path: "tipo_titulo_id", message: MSG.pedidoSemDadosFiscais }] });
    expect(await contar("documentos_compra"), "nada gravado").toBe(antes);
    const ok = await lancarCompra("pedido", corpoPedido({}));
    expect(ok.statusCode, `premissa: o mesmo pedido sem o campo salva — ${ok.body}`).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-C2
// ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("LANC-C2 P4 na confirmação: a rede recusa o tipo de título trocado", () => {
  it("LANC-C2 compra ABERTA com Y gravado direto no banco numa TOP sem troca → a prévia anota e a confirmação lança a mesma recusa, nada confirmado; premissa: com X, confirma e o título leva X", async () => {
    const semTroca = await topCompraNo5({ secao: { documentoTroca: false }, padroes: PADROES_X() });
    const compra = await compraLancada("compra", corpo(semTroca.id));
    // O gatilho da 0047 congela os dados fiscais depois do lançamento: a gravação passa por fora dele (só no teste) — é
    // o documento que o salvar de antes da R2 aceitava (ele não conferia o tipo de título).
    const gravar = async (tipo: string) => {
      const cx = await c.admin.connect();
      try {
        await cx.query("begin");
        await cx.query("set local session_replication_role = replica");
        const u = await cx.query("update erp.documentos_compra set tipo_titulo_id=$2 where id=$1 and situacao='aberto'", [compra.id, tipo]);
        await cx.query("commit");
        expect(u.rowCount, "premissa: o tipo de título da compra aberta mudou no banco").toBe(1);
      } catch (e) { await cx.query("rollback"); throw e; } finally { cx.release(); }
      expect(await tipoGravado(compra.id)).toBe(tipo);
    };
    await gravar(tipoY);

    const p = await previaCompra(compra.id);
    expect(p.statusCode, p.body).toBe(200);
    expect([j(p).podeConfirmar, j(p).recusas], "a prévia anota a recusa").toEqual([false, [RECUSA_DO_TIPO]]);
    const r = await confirmarCompra(compra.id);
    expect(r.statusCode, r.body).toBe(422);
    expect(erro(r)).toEqual(RECUSA_DO_TIPO);
    expect([await situacaoDe(compra.id), await titulosDe(compra.id), await movimentosDe("documentos_compra", compra.id)], "nada confirmado")
      .toEqual(["aberto", [], []]);

    // PREMISSA: o mesmo documento com o tipo da TOP confirma — e o título leva X.
    await gravar(tipoX);
    const ok = await confirmarCompra(compra.id);
    expect(ok.statusCode, `premissa: com X a compra confirma — ${ok.body}`).toBe(200);
    expect(await situacaoDe(compra.id)).toBe("confirmado");
    expect((await titulosDe(compra.id)).map((t) => t.title_type_id)).toEqual([tipoX]);
    expect((await movimentosDe("documentos_compra", compra.id)).length, "premissa: confirmada, deu entrada").toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// LANC-C3
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/** O texto SQL de uma chamada a `pg.Client.prototype.query` (texto solto ou `{ text }`). */
const textoDa = (x: unknown): string | null => {
  const t = typeof x === "string" ? x : (x as { text?: unknown } | null)?.text;
  return typeof t === "string" ? t : null;
};
/** O nome de cada consulta da TOP do handler (o molde de `lancamento-01-regras-padroes.test.ts`, LANC-I4). */
function nomeDa(s: string): string {
  if (/select v\.id as versao_id\s+from erp\.tipos_operacao t\s/.test(s) && /t\.ativo and t\.excluido_em is null/.test(s)) return "existencia";
  if (/erp\.tipos_operacao_versao_condicoes/.test(s)) return "regras";
  if (/^select configuracao from erp\.tipos_operacao_versoes where id = \$1 and organization_id = \$2$/.test(s.trim())) return "efeitos";
  if (/select v\.id::text as id, v\.configuracao, t\.codigo_base/.test(s)) return "releitura";
  if (/from erp\.tipos_operacao_versao_financeiro x/.test(s)) return "padroes";
  return `outra: ${s.replace(/\s+/g, " ").trim().slice(0, 120)}`;
}
interface ConsultaDaRequisicao { sql: string; params: unknown }

/**
 * A requisição com uma PUBLICAÇÃO NO MEIO: o espião de `pg.Client.prototype.query` deixa passar tudo e, quando a consulta
 * da EXISTÊNCIA (a que devolve `versao_id`) volta, segura o resultado até `publicar` terminar — pela testemunha, outra
 * conexão, em autocommit. A requisição só continua DEPOIS de a versão nova estar gravada e corrente. As consultas da
 * publicação não entram na lista.
 */
async function comPublicacaoNoMeio<T>(pedir: () => Promise<T>, publicar: () => Promise<void>): Promise<{ r: T; consultas: ConsultaDaRequisicao[]; publicou: boolean }> {
  const original = pg.Client.prototype.query;
  const consultas: ConsultaDaRequisicao[] = [];
  let publicando = false; let publicou = false;
  const espiar = function (this: unknown, ...args: unknown[]): unknown {
    const resultado: unknown = Reflect.apply(original, this, args);
    if (publicando) return resultado;
    const sql = textoDa(args[0]);
    if (sql === null) return resultado;
    consultas.push({ sql, params: args[1] });
    if (publicou || nomeDa(sql) !== "existencia" || !(resultado instanceof Promise)) return resultado;
    publicou = true;
    return resultado.then(async (linhas: unknown) => {
      publicando = true;
      try { await publicar(); } finally { publicando = false; }
      return linhas;
    });
  };
  const espiao = vi.spyOn(pg.Client.prototype, "query").mockImplementation(espiar as unknown as typeof original);
  try {
    const r = await pedir();
    return { r, consultas, publicou };
  } finally { espiao.mockRestore(); }
}

/** A versão nova da TOP, escrita pela testemunha (uma versão a mais, a linha dos padrões dela, e só então a corrente). */
async function publicarVersao(topId: string, configuracao: ConfiguracaoTipoOperacaoV4 | ConfiguracaoTipoOperacaoV5, padroes: PadroesNoCorpo | null, gravada: { id: string; versao: number }[]): Promise<void> {
  const v = (await c.admin.query<{ id: string; versao: number }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, $2::jsonb, ($2::jsonb ->> 'versaoSchema')::int
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1
     returning id::text as id, versao`, [topId, JSON.stringify(configuracao)])).rows[0]!;
  if (padroes) {
    await c.admin.query(
      `insert into erp.tipos_operacao_versao_financeiro (organization_id, origem_versao_id, origem_tipo_operacao_id, natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id)
       values ($1, $2, $3, $4, $5, $6, $7, null)`,
      [c.h.demo.orgId, v.id, topId, padroes.naturezaId ?? null, padroes.centroCustoId ?? null, padroes.tipoTituloId ?? null, padroes.formaPagamentoId ?? null]);
  }
  const u = await c.admin.query("update erp.tipos_operacao set versao_atual = $2 where id = $1", [topId, v.versao]);
  if (u.rowCount === 1) gravada.push(v);
}

/** A v1: formato 5, confirmação automática, exige observação, o documento não troca, e os padrões A (com X). */
function cfgV1(): ConfiguracaoTipoOperacaoV5 {
  const x = cfg5Fin({ documentoTroca: false });
  x.geral.confirmacao = "automatica";
  x.geral.exigeObservacao = true;
  return x;
}
/** A v2 muda tudo o que a v1 diz: sem confirmação automática, exige transportadora, a execução financeira sem título. */
function v2Diferente<C extends ConfiguracaoTipoOperacaoV4 | ConfiguracaoTipoOperacaoV5>(x: C): C {
  x.geral.exigeTransportadora = true;
  x.execucao = { estoque: "legado", financeiro: "configurada" };
  x.financeiro.atualizacao = "nenhuma";
  return x;
}

describe("LANC-C3 P3 regras-da-operacao responde tudo de UMA versão", () => {
  it("LANC-C3 a versão nova publicada logo depois da existência (no 5 com outra seção, outras regras e os padrões B; e no 4) → a resposta é a da v1 inteira, cada consulta da TOP depois da existência pela v1, as 5 de hoje; premissa: a v2 é distinguível em cada campo", async () => {
    const PADROES_B: PadroesNoCorpo = { naturezaId: naturezaB, centroCustoId: centroB, tipoTituloId: tipoY, formaPagamentoId: forma };
    const cenarios = [
      { nome: "v2 no formato 5 (o documento troca, os padrões B)", configuracao: v2Diferente(cfg5Fin()), padroes: PADROES_B, mudam: ["exigencias", "geraTitulos", "secao", "padroes", "regrasGerais"] },
      { nome: "v2 no formato 4", configuracao: v2Diferente(cfg4()), padroes: null, mudam: ["formato", "exigencias", "geraTitulos", "secao", "padroes", "regrasGerais"] },
    ] as const;
    let provados = 0;
    for (const cen of cenarios) {
      const id = await top(COMPRA, { configuracao: cfgV1(), padroesFinanceiros: PADROES_X() });
      const v1 = await versaoAtualNoBanco(id);
      expect([v1.versao, v1.configuracao_schema_version], `${cen.nome}: premissa — a v1 no formato 5`).toEqual([1, 5]);
      const url = `/api/compras/compras/regras-da-operacao?tipo_operacao_id=${id}`;
      const pedir = (): Promise<Resposta> => c.ligada.inject({ method: "GET", url, headers: c.h.headers() });

      // A v1 sozinha (nenhuma publicação): o que a resposta coerente É.
      const sozinha = await pedir();
      expect(sozinha.statusCode, sozinha.body).toBe(200);
      const antes = j(sozinha);
      expect([antes.formato, antes.exigencias, antes.geraTitulos, antes.secao, (antes.padroes as { natureza: { id: string } } | null)?.natureza.id, antes.regrasGerais],
        `${cen.nome}: premissa — a v1 inteira`)
        .toEqual([5, ["observacao"], true, { provisao: false, documentoTroca: false, semClassificacao: "padrao_legado" }, natureza, { confirmacaoAutomatica: true, aceitaSemItens: false }]);

      // A requisição com a v2 publicada NO MEIO.
      const gravada: { id: string; versao: number }[] = [];
      const { r, consultas, publicou } = await comPublicacaoNoMeio(pedir, () => publicarVersao(id, cen.configuracao, cen.padroes, gravada));
      expect(r.statusCode, r.body).toBe(200);
      expect([publicou, gravada.map((g) => g.versao), (await versaoAtualNoBanco(id)).id], `${cen.nome}: premissa — a v2 foi publicada no meio e é a corrente`)
        .toEqual([true, [2], gravada[0]?.id]);
      expect(j(r), `${cen.nome}: a resposta é a da v1 INTEIRA (nada da v2)`).toEqual(antes);

      // Cada consulta da TOP depois da existência é endereçada pela v1 — e são as 5 de hoje (o P3 não acrescenta nenhuma).
      const daTop = consultas.filter((x) => /\berp\.tipos_operacao/.test(x.sql));
      expect(daTop.map((x) => nomeDa(x.sql)), `${cen.nome}: as consultas da TOP`).toEqual(["existencia", "regras", "efeitos", "releitura", "padroes"]);
      for (const x of daTop.slice(1)) {
        const params = JSON.stringify(x.params ?? null).toLowerCase();
        expect(params, `${cen.nome}: ${nomeDa(x.sql)} pela v1`).toContain(v1.id.toLowerCase());
        expect(params, `${cen.nome}: ${nomeDa(x.sql)} nunca pela v2`).not.toContain(String(gravada[0]?.id).toLowerCase());
      }

      // PREMISSA: a v2 é distinguível em cada campo — a requisição seguinte, inteira na v2, difere da v1 em todos eles.
      const seguinte = await pedir();
      expect(seguinte.statusCode, seguinte.body).toBe(200);
      const depois = j(seguinte);
      for (const k of cen.mudam) expect(depois[k], `${cen.nome}: premissa — ${k} da v2 difere`).not.toEqual(antes[k]);
      provados++;
    }
    expect(provados).toBe(2);
  });
});
