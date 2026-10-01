import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import {
  ESPECIES_DOCUMENTO_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, MENSAGEM_APROVACAO_PENDENTE, MENSAGEM_APROVACAO_NAO_EXIGIDA,
  MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO, mensagemAprovacaoReprovada, type ConfiguracaoComRestricoesTop, type EspecieEstoque,
} from "@agro/domain";
import { fromPgError } from "../../src/lib/errors.js";
import {
  c, iniciar, encerrar, cfg3, cfg4, top, produto, produtoComSaldo, saldoInicial, saldo, usuario, escopos, seg, lancarEstoque, estoqueLancado,
  confirmarEstoque, previaEstoque, aprovar, reprovar, fila, movimentosDe, erro, j, unico, DATA,
  itemVenda, corpoVenda, vendaLancada, confirmarVenda, titulosDe, situacaoNoBanco, auditoriaDe,
  type Hdr, type Resposta, type ItemEstoque, type Erro,
} from "./top-config-08-ajuda.js";

/**
 * TOP-CONFIG-08 (decisão 277) — O DOCUMENTO DE ESTOQUE COM A TOP NO FORMATO 4: CA-8, SI-3, AP-7, AP-8, AP-9 e AP-12
 * do estoque, e a prévia com as recusas do documento.
 *
 * O que se prova aqui, espécie por espécie quando a regra vale para as quatro:
 *   · CONFIRMAÇÃO AUTOMÁTICA (CA-8): o POST com a versão congelada no formato 4 e "Automática" confirma pela MESMA
 *     função do `/confirmar` — os mesmos movimentos, a mesma auditoria "confirm" (só com `automatica: true`) —, e a
 *     recusa dela deixa o documento SALVO e ABERTO, com o MESMO corpo de erro que o `/confirmar` daria;
 *   · O CORTE: versão de formato 1 a 3 (mesmo com "automatica" ou "sempre" gravados) e a Manual respondem o corpo
 *     de hoje, chave por chave, e nada executa;
 *   · DOCUMENTO SEM ITENS (SI-3): o estoque não muda — `itens: []` é o 422 de hoje, inclusive numa versão de
 *     formato 4 que (escrita direto no banco, fora da matriz) dissesse "Permitido";
 *   · APROVAÇÃO (AP-7, AP-8): o ciclo pendente → reprovado → aprovado na confirmação e na prévia; a automática que
 *     espera a aprovação e é confirmada POR QUEM APROVA; a versão de formato 4 ilegível recusa (fail-closed);
 *   · A FILA (AP-9): só as espécies que a pessoa aprova, só o escopo de empresa dela, 403 sem nenhuma `.approve`,
 *     o documento sai ao ser decidido e não volta; número FIXO de consultas (contado); a empresa SELECIONADA recorta
 *     a fila como recorta a decisão (o que a fila mostra é o que Aprovar aceita), e a proibida é o 403 da decisão;
 *   · A GUARDA DO BANCO (AP-12): o UPDATE direto de aberto para confirmado sem aprovação vigente é recusado pelo
 *     gatilho da 0041 com CONFLICT (o 409 que todo binário conhece), e o formato 1 a 3 passa livre.
 *
 * O QUE CONTA COMO PROVA (o molde do ESTOQUE-01): a situação, os movimentos, o saldo, as decisões e a trilha são
 * LIDOS NO BANCO por conexão própria de superusuário (`c.admin`). Toda asserção de "zero efeito" vem com a PREMISSA
 * ao lado: o mesmo documento, corrigido (com saldo, aprovado, pela pessoa com a capacidade), produz o efeito.
 *
 * A trilha conta só o que a ROTA grava (`metadata is not null`): o gatilho `erp.audit_row()` grava, na mesma tabela,
 * as linhas da própria tabela com metadata nulo — contá-las junto mediria o gatilho, não a rota.
 *
 * Cada caso cria a PRÓPRIA TOP e o PRÓPRIO produto. A empresa 2 é reservada à fila (AP-9d): é o que dá à contagem de
 * consultas uma página com exatamente 1 e 5 documentos, sem depender da ordem dos outros casos. Os casos da empresa
 * SELECIONADA (AP-9e, AP-9f) também lançam na empresa 2, e por isso vêm DEPOIS do AP-9d no arquivo (o vitest roda os
 * casos de um arquivo na ordem em que são declarados) e só conferem presença e ausência, nunca a contagem.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

const ESPECIES = ESPECIES_DOCUMENTO_ESTOQUE;
const recurso = (e: EspecieEstoque) => RECURSO_DA_ESPECIE_ESTOQUE[e];

// ─────────────── a TOP do caso ───────────────

/**
 * O ajuste do caso, nas chaves que os formatos 3 e 4 têm iguais: o MESMO ajuste vale para `cfg3` (o corte, que só
 * declara) e para `cfg4` (que executa) — a única diferença entre as duas TOPs é o número do formato.
 */
type Ajuste = (x: ConfiguracaoComRestricoesTop) => void;
/** Uma TOP da família da espécie no FORMATO 4, pela porta administrativa, com o ajuste do caso. */
const top4 = (e: EspecieEstoque, ajuste?: Ajuste) => top(`estoque.${e}`, { configuracao: cfg4(ajuste) });
const AUTOMATICA: Ajuste = (x) => { x.geral.confirmacao = "automatica"; };
const SEMPRE: Ajuste = (x) => { x.aprovacao.politica = "sempre"; };
const AUTOMATICA_E_SEMPRE: Ajuste = (x) => { AUTOMATICA(x); SEMPRE(x); };

/**
 * Uma versão NOVA da TOP escrita DIRETO NO BANCO (superusuário), e já tornada a corrente: o único jeito de ter uma
 * versão que a porta administrativa recusaria (a matriz da família, ou o leitor estrito). A coluna e o payload
 * concordam no número do formato (o CHECK da 0022). Devolve o id da versão nova.
 */
async function versaoDireta(topId: string, configuracao: object): Promise<string> {
  const v = (await c.admin.query<{ id: string; versao: number }>(
    `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
     select v.organization_id, v.tipo_operacao_id, v.versao + 1, v.nome, $2::jsonb, ($2::jsonb ->> 'versaoSchema')::int
       from erp.tipos_operacao_versoes v join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1
     returning id, versao`, [topId, JSON.stringify(configuracao)])).rows[0]!;
  const u = await c.admin.query("update erp.tipos_operacao set versao_atual = $2 where id = $1", [topId, v.versao]);
  expect(u.rowCount, "premissa: a versão direta virou a corrente").toBe(1);
  return v.id;
}

// ─────────────── o documento ───────────────

/** Um item que a espécie aceita: a entrada leva o custo; o ajuste, a quantidade CONTADA. */
function item(e: EspecieEstoque, produtoId: string, quantidade = "3"): ItemEstoque {
  if (e === "entrada") return { produto_id: produtoId, quantidade, custo_unitario: "2" };
  if (e === "ajuste") return { produto_id: produtoId, quantidade_contada: quantidade };
  return { produto_id: produtoId, quantidade };
}

interface CorpoDoPost { id: string; codigo: string; especie: string; situacao: string; confirmacaoAutomatica?: unknown }
const corpoDoPost = (r: Resposta) => j(r) as unknown as CorpoDoPost;

/** O corpo de hoje do POST, chave por chave: sem `confirmacaoAutomatica`. */
const CORPO_DE_HOJE = (e: EspecieEstoque, situacao = "aberto") => ({ id: expect.any(String), codigo: expect.any(String), especie: e, situacao });

interface Previa {
  contractVersion: number;
  documento: { id: string; especie: string; situacao: string };
  podeConfirmar: boolean;
  itens: { saldo_atual: string; saldo_depois: string; insuficiente: boolean; movimento: string | null }[];
  recusas?: Erro[];
}
async function lerPrevia(e: EspecieEstoque, id: string): Promise<Previa> {
  const r = await previaEstoque(e, id);
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as Previa;
}
const resumo = (p: Previa) => p.itens.map((i) => [i.saldo_atual, i.saldo_depois, i.insuficiente, i.movimento]);

const cancelarEstoque = (e: EspecieEstoque, id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/estoque/${seg(e)}/${id}/cancelar`, headers: c.h.headers(), payload: {} });

// ─────────────── testemunhas no banco (superusuário, sem RLS) ───────────────

interface DocNoBanco { situacao: string; confirmado_por: string | null; tipo_operacao_versao_id: string; formato: number }
async function docNoBanco(id: string): Promise<DocNoBanco> {
  return (await c.admin.query<DocNoBanco>(
    `select d.situacao, d.confirmado_por, d.tipo_operacao_versao_id, v.configuracao_schema_version as formato
       from erp.documentos_estoque d join erp.tipos_operacao_versoes v on v.id = d.tipo_operacao_versao_id where d.id = $1`, [id])).rows[0]!;
}
async function contarDocumentos(): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.documentos_estoque where organization_id = $1", [c.h.demo.orgId])).rows[0]!.n);
}
async function contarItens(id: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.documentos_estoque_itens where documento_id = $1", [id])).rows[0]!.n);
}
interface Rastro { action: string; user_id: string | null; metadata: Record<string, unknown> }
/** A trilha que a ROTA gravou no documento (`metadata is not null`; ver o cabeçalho), em ordem. */
async function trilha(id: string): Promise<Rastro[]> {
  return (await c.admin.query<Rastro>(
    "select action, user_id, metadata from erp.audit_logs where entity = 'documentos_estoque' and entity_id = $1 and metadata is not null order by id", [id])).rows;
}
interface DecisaoLida { decisao: string; observacao: string | null; decidido_por: string; decididoEm: string; tipo_operacao_versao_id: string; empresa_id: string }
/** As decisões do documento, em ordem, com `decidido_em` no ISO que a API responde (o `pg` entrega `Date`). */
async function decisoes(id: string): Promise<DecisaoLida[]> {
  const r = await c.admin.query<{ decisao: string; observacao: string | null; decidido_por: string; decidido_em: Date; tipo_operacao_versao_id: string; empresa_id: string }>(
    "select decisao, observacao, decidido_por, decidido_em, tipo_operacao_versao_id, empresa_id from erp.aprovacoes_estoque where documento_id = $1 order by id", [id]);
  return r.rows.map(({ decidido_em, ...x }) => ({ ...x, decididoEm: decidido_em.toISOString() }));
}
const nomeDoAdmin = async () => (await c.admin.query<{ name: string }>("select name from erp.users where id = $1", [c.h.demo.adminUserId])).rows[0]!.name;

/**
 * O UPDATE DIRETO de aberto para confirmado, como um binário que pulasse o planejamento (o anterior, na reversão),
 * numa transação que sempre volta: o caso mede só a guarda, e o documento continua aberto para a premissa.
 * Devolve o erro do banco (ou `null`) e as linhas atualizadas.
 */
async function confirmarDireto(id: string): Promise<{ falha: unknown; linhas: number | null }> {
  const cli = await c.admin.connect();
  try {
    await cli.query("begin");
    const u = await cli.query("update erp.documentos_estoque set situacao = 'confirmado', confirmado_em = now(), confirmado_por = $2 where id = $1 and situacao = 'aberto'",
      [id, c.h.demo.adminUserId]);
    return { falha: null, linhas: u.rowCount };
  } catch (e) {
    return { falha: e, linhas: null };
  } finally {
    await cli.query("rollback").catch(() => undefined);
    cli.release();
  }
}

// ─────────────── o cenário de saldo por espécie (CA-8) ───────────────

/**
 * Produto com 10 no ALM e item de 3 (no ajuste, CONTADO 3): o que cada espécie move, onde, e o saldo depois
 * (ALM, SILO). Os movimentos na ordem de `movimentosDe` (direção, depois armazém).
 */
const ESPERADO: Readonly<Record<EspecieEstoque, { movimentos: [string, number, string, "ALM" | "SILO"][]; saldos: [string, string] }>> = {
  entrada: { movimentos: [["entry", 1, "3.0000", "ALM"]], saldos: ["13.0000", "0.0000"] },
  saida: { movimentos: [["writeoff", -1, "3.0000", "ALM"]], saldos: ["7.0000", "0.0000"] },
  transferencia: { movimentos: [["transfer_out", -1, "3.0000", "ALM"], ["transfer_in", 1, "3.0000", "SILO"]], saldos: ["7.0000", "3.0000"] },
  ajuste: { movimentos: [["correction_out", -1, "7.0000", "ALM"]], saldos: ["3.0000", "0.0000"] },
};
const armazemDe = (w: string) => (w === c.I.warehouse ? "ALM" : w === c.I.warehouse2 ? "SILO" : w);

// ---------------------------------------------------------------------------------------------------------
// CA-8 — confirmação automática nas quatro espécies
// ---------------------------------------------------------------------------------------------------------
describe("CA-8 — estoque com TOP formato 4 Automática: o POST confirma pela mesma função do /confirmar", () => {
  it.each(ESPECIES)("CA-8a %s: 201, situacao 'confirmado', {confirmado:true}; movimentos e saldo no banco; auditoria 'confirm' com automatica:true", async (e) => {
    const topId = await top4(e, AUTOMATICA);
    const p = await produtoComSaldo("10");
    const r = await lancarEstoque(e, [item(e, p.id)], { tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = corpoDoPost(r);
    expect(corpo).toEqual({ ...CORPO_DE_HOJE(e, "confirmado"), confirmacaoAutomatica: { confirmado: true } });

    const d = await docNoBanco(corpo.id);
    expect(d.formato, "premissa: a versão congelada é a do formato 4").toBe(4);
    expect([d.situacao, d.confirmado_por]).toEqual(["confirmado", c.h.demo.adminUserId]);
    expect((await movimentosDe("documentos_estoque", corpo.id)).map((m) => [m.movement_type, m.direction, m.quantity, armazemDe(m.warehouse_id)]))
      .toEqual(ESPERADO[e].movimentos);
    expect([await saldo(p.id, c.I.warehouse), await saldo(p.id, c.I.warehouse2)]).toEqual(ESPERADO[e].saldos);
    // A trilha: o lançamento e, DEPOIS dele, a confirmação — a mesma do /confirmar, só com a chave a mais.
    expect((await trilha(corpo.id)).map((t) => [t.action, t.user_id, t.metadata])).toEqual([
      ["create", c.h.demo.adminUserId, expect.objectContaining({ especie: e, tipoOperacaoVersaoId: d.tipo_operacao_versao_id })],
      ["confirm", c.h.demo.adminUserId, { especie: e, movimentos: ESPERADO[e].movimentos.length, tipoOperacaoVersaoId: d.tipo_operacao_versao_id, automatica: true }],
    ]);
  });

  it.each(ESPECIES)("CA-8b %s: a confirmação MANUAL (TOP formato 4 Manual) grava a auditoria 'confirm' idêntica à de hoje, sem a chave automatica", async (e) => {
    const p = await produtoComSaldo("10");
    const r = await lancarEstoque(e, [item(e, p.id)]);
    expect(r.statusCode, r.body).toBe(201);
    const { id } = corpoDoPost(r);
    const m = await confirmarEstoque(e, id);
    expect(m.statusCode, m.body).toBe(200);
    expect(j(m)).toEqual({ id, situacao: "confirmado", movimentos: ESPERADO[e].movimentos.length });
    const d = await docNoBanco(id);
    const confirm = (await trilha(id)).filter((t) => t.action === "confirm");
    expect(confirm.map((t) => t.metadata)).toEqual([{ especie: e, movimentos: ESPERADO[e].movimentos.length, tipoOperacaoVersaoId: d.tipo_operacao_versao_id }]);
    expect(confirm[0]!.metadata).not.toHaveProperty("automatica");
  });

  it("CA-8c saída sem saldo: 201, documento SALVO e ABERTO, 'recusada' com o MESMO erro do /confirmar (o 422 do item); nada se move", async () => {
    const topId = await top4("saida", AUTOMATICA);
    const p = await produtoComSaldo("1");
    const antes = await contarDocumentos();
    const r = await lancarEstoque("saida", [item("saida", p.id, "5")], { tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = corpoDoPost(r) as CorpoDoPost & { confirmacaoAutomatica: { confirmado: false; motivo: string; erro: Erro } };
    expect(corpo).toEqual({ ...CORPO_DE_HOJE("saida", "aberto"),
      confirmacaoAutomatica: { confirmado: false, motivo: "recusada", erro: { code: "VALIDATION_ERROR", message: expect.stringContaining("Saldo insuficiente"),
        details: [{ path: "itens.0.quantidade", message: expect.stringContaining("Saldo insuficiente") }] } } });

    // Salvo (o documento e o item existem) e aberto; o savepoint desfez tudo o que a confirmação tentou.
    expect(await contarDocumentos()).toBe(antes + 1);
    expect(await contarItens(corpo.id)).toBe(1);
    expect((await docNoBanco(corpo.id)).situacao).toBe("aberto");
    expect(await movimentosDe("documentos_estoque", corpo.id)).toEqual([]);
    expect(await saldo(p.id)).toBe("1.0000");
    expect((await trilha(corpo.id)).map((t) => t.action), "a auditoria 'confirm' voltou com o savepoint").toEqual(["create"]);

    // O MESMO corpo de erro que o /confirmar dá para o mesmo documento.
    const manual = await confirmarEstoque("saida", corpo.id);
    expect(manual.statusCode, manual.body).toBe(422);
    expect(erro(manual)).toEqual(corpo.confirmacaoAutomatica.erro);

    // PREMISSA: com saldo (uma entrada confirmada; o estoque inicial do produto já foi dado), o MESMO documento confirma e move.
    const entrada = await estoqueLancado("entrada", [item("entrada", p.id, "10")]);
    expect((await confirmarEstoque("entrada", entrada.id)).statusCode).toBe(200);
    const depois = await confirmarEstoque("saida", corpo.id);
    expect(depois.statusCode, depois.body).toBe(200);
    expect((await movimentosDe("documentos_estoque", corpo.id)).map((m) => [m.movement_type, m.quantity])).toEqual([["writeoff", "5.0000"]]);
  });

  it("CA-8f a recusa vem DEPOIS de um efeito (ajuste: o 1º balde já foi corrigido quando o 2º recusa): o savepoint desfaz o movimento gravado", async () => {
    // O ajuste corrige os baldes na ordem (armazém, produto, lote): o produto de MENOR id é corrigido primeiro.
    const [x, y] = [await produto(), await produto()];
    const [primeiro, segundo] = x.id < y.id ? [x, y] : [y, x];
    await saldoInicial(primeiro.id, "10");
    // O segundo controla lote E validade: contar um lote NOVO sem validade aumentaria o saldo de um lote sem validade —
    // o 422 no item, que só a confirmação conhece, DEPOIS do `correction_out` do primeiro já gravado.
    await c.admin.query("update erp.products set controle_lote = 'lote_validade', has_lot = true where id = $1", [segundo.id]);
    const topId = await top4("ajuste", AUTOMATICA);
    const itens = [item("ajuste", primeiro.id, "4"), { produto_id: segundo.id, quantidade_contada: "2", lote: "L-SEM-VALIDADE" }];
    const r = await lancarEstoque("ajuste", itens, { tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = corpoDoPost(r) as CorpoDoPost & { confirmacaoAutomatica: { confirmado: false; motivo: string; erro: Erro } };
    expect(corpo.confirmacaoAutomatica).toEqual({ confirmado: false, motivo: "recusada", erro: { code: "VALIDATION_ERROR", message: expect.stringContaining("sem validade"),
      details: [{ path: "itens.1.validade", message: "Informe a validade do lote: o ajuste aumenta o saldo" }] } });
    // Nada ficou: nem o movimento do primeiro balde, nem o saldo, nem o que a confirmação grava no item.
    expect((await docNoBanco(corpo.id)).situacao).toBe("aberto");
    expect(await movimentosDe("documentos_estoque", corpo.id)).toEqual([]);
    expect(await saldo(primeiro.id)).toBe("10.0000");
    expect((await c.admin.query<{ s: string | null }>("select saldo_na_confirmacao::text s from erp.documentos_estoque_itens where documento_id = $1 order by posicao", [corpo.id]))
      .rows.map((i) => i.s)).toEqual([null, null]);
    const manual = await confirmarEstoque("ajuste", corpo.id);
    expect(manual.statusCode, manual.body).toBe(422);
    expect(erro(manual)).toEqual(corpo.confirmacaoAutomatica.erro);

    // PREMISSA: o primeiro balde, sozinho e pela mesma TOP, é corrigido — o efeito desfeito acima existia.
    const so = await lancarEstoque("ajuste", [item("ajuste", primeiro.id, "4")], { tipo_operacao_id: topId });
    expect(corpoDoPost(so).confirmacaoAutomatica, so.body).toEqual({ confirmado: true });
    expect((await movimentosDe("documentos_estoque", corpoDoPost(so).id)).map((m) => [m.movement_type, m.quantity])).toEqual([["correction_out", "6.0000"]]);
  });

  it("CA-8d sem `<recurso>.edit`: 201, salvo e aberto, 'sem_permissao' — e o .edit de OUTRA espécie não serve; nada se move", async () => {
    const topId = await top4("entrada", AUTOMATICA);
    const p = await produto();
    const lancador = await usuario("Lançador de entradas", ["entradas_estoque.create", "saidas_estoque.edit"]);
    const r = await lancarEstoque("entrada", [item("entrada", p.id)], { tipo_operacao_id: topId }, lancador);
    expect(r.statusCode, r.body).toBe(201);
    const corpo = corpoDoPost(r);
    expect(corpo).toEqual({ ...CORPO_DE_HOJE("entrada", "aberto"), confirmacaoAutomatica: { confirmado: false, motivo: "sem_permissao" } });
    expect((await docNoBanco(corpo.id)).situacao).toBe("aberto");
    expect(await movimentosDe("documentos_estoque", corpo.id)).toEqual([]);
    expect((await trilha(corpo.id)).map((t) => t.action)).toEqual(["create"]);

    // PREMISSA: quem tem a capacidade confirma o mesmo documento.
    const m = await confirmarEstoque("entrada", corpo.id);
    expect(m.statusCode, m.body).toBe(200);
    expect((await movimentosDe("documentos_estoque", corpo.id)).map((x) => [x.movement_type, x.quantity])).toEqual([["entry", "3.0000"]]);
  });

  it.each(ESPECIES)("CA-8e/CA-9/CA-11 %s: Manual no formato 4 e 'automatica' gravado no formato 3 → o corpo de hoje, sem a chave; nada se move", async (e) => {
    const p = await produtoComSaldo("10");
    const manual = await lancarEstoque(e, [item(e, p.id)]);
    expect(manual.statusCode, manual.body).toBe(201);
    expect(j(manual)).toEqual(CORPO_DE_HOJE(e));
    expect((await docNoBanco(corpoDoPost(manual).id)).formato, "premissa: a Manual é do formato 4").toBe(4);

    const top3 = await top(`estoque.${e}`, { configuracao: cfg3(AUTOMATICA) });
    const formato3 = await lancarEstoque(e, [item(e, p.id)], { tipo_operacao_id: top3 });
    expect(formato3.statusCode, formato3.body).toBe(201);
    expect(j(formato3)).toEqual(CORPO_DE_HOJE(e));

    for (const id of [corpoDoPost(manual).id, corpoDoPost(formato3).id]) {
      expect((await docNoBanco(id)).situacao).toBe("aberto");
      expect(await movimentosDe("documentos_estoque", id)).toEqual([]);
    }
    const v3 = await docNoBanco(corpoDoPost(formato3).id);
    expect(v3.formato, "premissa: a versão congelada é a do formato 3 (o corte)").toBe(3);
    expect((await c.admin.query<{ c: string }>("select configuracao->'geral'->>'confirmacao' c from erp.tipos_operacao_versoes where id = $1", [v3.tipo_operacao_versao_id])).rows[0]!.c,
      "premissa: o formato 3 tem 'automatica' gravado").toBe("automatica");
    expect(await saldo(p.id), "nada se moveu").toBe("10.0000");
  });

  it("CA-10 Idempotency-Key: o reenvio devolve o MESMO corpo (com o resultado), um documento, um movimento, uma confirmação", async () => {
    const topId = await top4("entrada", AUTOMATICA);
    const p = await produto();
    const chave = `tc08-estoque-${unico()}`;
    const antes = await contarDocumentos();
    const a = await lancarEstoque("entrada", [item("entrada", p.id)], { tipo_operacao_id: topId }, c.h.headers(), chave);
    const b = await lancarEstoque("entrada", [item("entrada", p.id)], { tipo_operacao_id: topId }, c.h.headers(), chave);
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([201, 201]);
    expect(j(b)).toEqual(j(a));
    expect(j(a)).toEqual({ ...CORPO_DE_HOJE("entrada", "confirmado"), confirmacaoAutomatica: { confirmado: true } });
    expect(await contarDocumentos()).toBe(antes + 1);
    const id = corpoDoPost(a).id;
    expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.quantity])).toEqual([["entry", "3.0000"]]);
    expect(await saldo(p.id)).toBe("3.0000");
    expect((await trilha(id)).map((t) => t.action)).toEqual(["create", "confirm"]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// SI-3 — documento de estoque sem itens: nada muda
// ---------------------------------------------------------------------------------------------------------
describe("SI-3 — estoque com itens [] → o 422 de hoje, em toda versão (o zod continua com min(1))", () => {
  /** A resposta de HOJE, fixada: a do zod estrito, com o caminho `itens`. */
  const HOJE = { error: { code: "VALIDATION_ERROR", message: "itens: Valor mínimo: 1", details: [{ path: "itens", message: "Valor mínimo: 1" }] } };

  it.each(ESPECIES)("SI-3 %s: formato 1 a 3, formato 4 neutro, formato 4 Automática e até um formato 4 'Permitido' escrito no banco → a mesma 422; nada gravado", async (e) => {
    const legado = await top(`estoque.${e}`);
    const automatica = await top4(e, AUTOMATICA);
    // A matriz recusa "Permitido" no estoque; a versão escrita direto no banco é o pior caso: mesmo ela não relaxa nada.
    const permitido = await top4(e);
    await versaoDireta(permitido, cfg4((x) => { AUTOMATICA(x); x.geral.documentoSemItens = "permitido"; }));
    const antes = await contarDocumentos();
    for (const tipo of [legado, c.tops[e], automatica, permitido]) {
      const r = await lancarEstoque(e, [], { tipo_operacao_id: tipo });
      expect(r.statusCode, r.body).toBe(422);
      expect(j(r)).toEqual(HOJE);
    }
    expect(await contarDocumentos(), "nenhum documento gravado").toBe(antes);

    // PREMISSA: a versão "Permitido" é legível e EXECUTA (com 1 item, confirma sozinha) — a recusa não é ilegibilidade.
    const p = await produtoComSaldo("10");
    const r = await lancarEstoque(e, [item(e, p.id)], { tipo_operacao_id: permitido });
    expect(r.statusCode, r.body).toBe(201);
    expect(corpoDoPost(r).confirmacaoAutomatica).toEqual({ confirmado: true });
  });
});

// ---------------------------------------------------------------------------------------------------------
// AP-7 — aprovação "Sempre" no estoque: confirmação, prévia, reprovação, aprovação e a automática
// ---------------------------------------------------------------------------------------------------------
describe("AP-7 — estoque, aprovação Sempre: o ciclo na confirmação e na prévia", () => {
  const PENDENTE = { code: "APROVACAO_PENDENTE", message: MENSAGEM_APROVACAO_PENDENTE, details: { politica: "sempre", valorMinimo: null, valorDocumento: null } };

  it("AP-7a saída: pendente → 409 e a MESMA recusa na prévia (sem problema de saldo); reprovar → 409 REPROVADA; aprovar → confirma", async () => {
    const topId = await top4("saida", SEMPRE);
    const p = await produtoComSaldo("10");
    const { id } = await estoqueLancado("saida", [item("saida", p.id)], { tipo_operacao_id: topId });

    // PENDENTE: a confirmação recusa antes de qualquer efeito, e a prévia diz o mesmo.
    const pendente = await confirmarEstoque("saida", id);
    expect(pendente.statusCode, pendente.body).toBe(409);
    expect(erro(pendente)).toEqual(PENDENTE);
    const pv = await lerPrevia("saida", id);
    expect(pv.recusas).toEqual([PENDENTE]);
    expect(pv.podeConfirmar).toBe(false);
    expect(resumo(pv), "nenhum item insuficiente: o falso é só da recusa").toEqual([["10.0000", "7.0000", false, "writeoff"]]);
    expect(await movimentosDe("documentos_estoque", id)).toEqual([]);
    expect(await decisoes(id)).toEqual([]);

    // REPROVADO: a decisão é gravada (com a TOP e a versão do documento), e a confirmação recusa com o motivo.
    const motivo = "Quantidade acima do combinado";
    const rep = await reprovar("saida", id, { motivo });
    expect(rep.statusCode, rep.body).toBe(200);
    const d1 = await decisoes(id);
    const doc = await docNoBanco(id);
    expect(d1).toEqual([{ decisao: "reprovado", observacao: motivo, decidido_por: c.h.demo.adminUserId, decididoEm: expect.any(String),
      tipo_operacao_versao_id: doc.tipo_operacao_versao_id, empresa_id: c.I.empresa }]);
    expect(j(rep)).toEqual({ aprovacao: { decisao: "reprovado", decididoEm: d1[0]!.decididoEm } });
    const REPROVADA = { code: "APROVACAO_REPROVADA", message: mensagemAprovacaoReprovada(motivo),
      details: { motivo, decididoPor: { id: c.h.demo.adminUserId, nome: await nomeDoAdmin() }, decididoEm: d1[0]!.decididoEm } };
    const reprovada = await confirmarEstoque("saida", id);
    expect(reprovada.statusCode, reprovada.body).toBe(409);
    expect(erro(reprovada)).toEqual(REPROVADA);
    expect(REPROVADA.message, "a mensagem exata do contrato").toBe(`Este documento foi reprovado: ${motivo}.`);
    const pv2 = await lerPrevia("saida", id);
    expect([pv2.recusas, pv2.podeConfirmar]).toEqual([[REPROVADA], false]);
    expect(await movimentosDe("documentos_estoque", id)).toEqual([]);

    // APROVADO depois: uma decisão NOVA (a história fica), e a confirmação passa.
    const apr = await aprovar("saida", id, { observacao: "Conferido" });
    expect(apr.statusCode, apr.body).toBe(200);
    const d2 = await decisoes(id);
    expect(d2.map((x) => [x.decisao, x.observacao])).toEqual([["reprovado", motivo], ["aprovado", "Conferido"]]);
    expect(j(apr), "TOP Manual: sem confirmacaoAutomatica").toEqual({ aprovacao: { decisao: "aprovado", decididoEm: d2[1]!.decididoEm } });
    const pv3 = await lerPrevia("saida", id);
    expect([pv3.recusas, pv3.podeConfirmar]).toEqual([[], true]);
    const ok = await confirmarEstoque("saida", id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await docNoBanco(id)).situacao).toBe("confirmado");
    expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.quantity])).toEqual([["writeoff", "3.0000"]]);
    expect((await trilha(id)).map((t) => [t.action, t.metadata])).toEqual([
      ["create", expect.any(Object)],
      ["reject", { motivo }],
      ["approve", { observacao: "Conferido" }],
      ["confirm", { especie: "saida", movimentos: 1, tipoOperacaoVersaoId: doc.tipo_operacao_versao_id }],
    ]);
  });

  it.each(ESPECIES)("AP-7b %s: pendente → 409 APROVACAO_PENDENTE sem efeito; aprovar → a confirmação passa e move", async (e) => {
    const topId = await top4(e, SEMPRE);
    const p = await produtoComSaldo("10");
    const { id } = await estoqueLancado(e, [item(e, p.id)], { tipo_operacao_id: topId });
    const pendente = await confirmarEstoque(e, id);
    expect(pendente.statusCode, pendente.body).toBe(409);
    expect(erro(pendente)).toEqual(PENDENTE);
    expect([(await docNoBanco(id)).situacao, await movimentosDe("documentos_estoque", id)]).toEqual(["aberto", []]);
    expect((await aprovar(e, id)).statusCode).toBe(200);
    const ok = await confirmarEstoque(e, id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.direction, m.quantity, armazemDe(m.warehouse_id)])).toEqual(ESPERADO[e].movimentos);
  });

  it("AP-6/AP-7c automática + aprovação: salvar → aberto, 'aguardando_aprovacao'; aprovar → confirma no mesmo pedido, POR QUEM APROVOU", async () => {
    const topId = await top4("transferencia", AUTOMATICA_E_SEMPRE);
    const p = await produtoComSaldo("10");
    const r = await lancarEstoque("transferencia", [item("transferencia", p.id)], { tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    const corpo = corpoDoPost(r);
    expect(corpo).toEqual({ ...CORPO_DE_HOJE("transferencia", "aberto"), confirmacaoAutomatica: { confirmado: false, motivo: "aguardando_aprovacao" } });
    expect((await docNoBanco(corpo.id)).situacao).toBe("aberto");
    expect(await movimentosDe("documentos_estoque", corpo.id)).toEqual([]);
    expect((await trilha(corpo.id)).map((t) => t.action)).toEqual(["create"]);

    const aprovador = await usuario("Aprovador de transferências", ["transferencias_estoque.approve", "transferencias_estoque.edit"]);
    const apr = await aprovar("transferencia", corpo.id, {}, aprovador);
    expect(apr.statusCode, apr.body).toBe(200);
    const [decisao] = await decisoes(corpo.id);
    expect(j(apr)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: decisao!.decididoEm }, confirmacaoAutomatica: { confirmado: true } });
    const d = await docNoBanco(corpo.id);
    expect(d.situacao).toBe("confirmado");
    // Quem confirma é QUEM APROVOU: a decisão, a confirmação e o carimbo são da mesma pessoa, e não de quem lançou.
    expect(decisao!.decidido_por).not.toBe(c.h.demo.adminUserId);
    expect(d.confirmado_por).toBe(decisao!.decidido_por);
    const t = await trilha(corpo.id);
    expect(t.map((x) => [x.action, x.user_id])).toEqual([["create", c.h.demo.adminUserId], ["approve", decisao!.decidido_por], ["confirm", decisao!.decidido_por]]);
    expect(t[2]!.metadata).toEqual({ especie: "transferencia", movimentos: 2, tipoOperacaoVersaoId: d.tipo_operacao_versao_id, automatica: true });
    expect((await movimentosDe("documentos_estoque", corpo.id)).map((m) => [m.movement_type, m.direction, m.quantity, armazemDe(m.warehouse_id)]))
      .toEqual(ESPERADO.transferencia.movimentos);
  });

  it("AP-6/AP-7d aprovador SEM `.edit`: aprovado e aberto, 'sem_permissao'; quem tem a capacidade confirma depois", async () => {
    const topId = await top4("entrada", AUTOMATICA_E_SEMPRE);
    const p = await produto();
    const { id } = await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: topId });
    const aprovador = await usuario("Aprovador sem editar", ["entradas_estoque.approve"]);
    const apr = await aprovar("entrada", id, { observacao: "Ok" }, aprovador);
    expect(apr.statusCode, apr.body).toBe(200);
    const [decisao] = await decisoes(id);
    expect(j(apr)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: decisao!.decididoEm }, confirmacaoAutomatica: { confirmado: false, motivo: "sem_permissao" } });
    expect(decisao!.decisao).toBe("aprovado");
    expect((await docNoBanco(id)).situacao).toBe("aberto");
    expect(await movimentosDe("documentos_estoque", id)).toEqual([]);
    // PREMISSA: aprovado, o documento confirma pela mão de quem tem `.edit`.
    const ok = await confirmarEstoque("entrada", id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.quantity])).toEqual([["entry", "3.0000"]]);
  });

  it("AP-7e versão formato 4 ILEGÍVEL (escrita no banco): o POST responde o corpo de hoje; confirmar → 409 TIPO_OPERACAO_EXECUCAO_INDISPONIVEL, e a mesma na prévia", async () => {
    const topId = await top4("saida");
    // "talvez" não é modo de confirmação: o leitor estrito recusa a versão inteira. A aprovação fica neutra, então a
    // guarda do banco NÃO barraria — a recusa que aparece é a da API (fail-closed), e não o fundo.
    await versaoDireta(topId, { ...cfg4(), geral: { ...cfg4().geral, confirmacao: "talvez" } });
    const p = await produtoComSaldo("10");
    const r = await lancarEstoque("saida", [item("saida", p.id)], { tipo_operacao_id: topId });
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r), "ilegível não confirma sozinho e não ganha a chave").toEqual(CORPO_DE_HOJE("saida"));
    const { id } = corpoDoPost(r);
    expect((await docNoBanco(id)).formato, "premissa: a versão congelada é a do formato 4 ilegível").toBe(4);

    const recusa = await confirmarEstoque("saida", id);
    expect(recusa.statusCode, recusa.body).toBe(409);
    const ILEGIVEL = { code: "TIPO_OPERACAO_EXECUCAO_INDISPONIVEL",
      message: "A configuração da operação deste documento está num formato que este servidor não executa. O documento não foi confirmado.",
      details: { motivo: "configuracao_ilegivel", recusas: [] } };
    expect(erro(recusa)).toEqual(ILEGIVEL);
    const pv = await lerPrevia("saida", id);
    expect([pv.recusas, pv.podeConfirmar]).toEqual([[ILEGIVEL], false]);
    expect(resumo(pv), "o saldo cabe: o falso é só da recusa").toEqual([["10.0000", "7.0000", false, "writeoff"]]);
    expect([(await docNoBanco(id)).situacao, await movimentosDe("documentos_estoque", id)]).toEqual(["aberto", []]);
    // PREMISSA: a guarda do banco não barraria este documento — quem recusou foi a API.
    expect((await confirmarDireto(id)).falha).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
// A prévia com TOP de formato 1 a 3: como hoje
// ---------------------------------------------------------------------------------------------------------
describe("Prévia do estoque com TOP de formato 1 a 3 — podeConfirmar e os itens como hoje", () => {
  it("formato 1 e formato 3 com 'sempre' e 'automatica' gravados: podeConfirmar true, os mesmos itens; e a confirmação passa", async () => {
    const legado = await top("estoque.saida");
    const top3 = await top("estoque.saida", { configuracao: cfg3(AUTOMATICA_E_SEMPRE) });
    for (const tipo of [legado, top3]) {
      const p = await produtoComSaldo("10");
      const { id } = await estoqueLancado("saida", [item("saida", p.id, "4"), item("saida", p.id, "4")], { tipo_operacao_id: tipo });
      expect((await docNoBanco(id)).formato, "premissa: formato 1 a 3").toBeLessThan(4);
      const pv = await lerPrevia("saida", id);
      // A chave `recusas` não é fixada aqui: o que vale é que nada do formato 1–3 recusa (o corte).
      expect(pv).toMatchObject({ contractVersion: 1, documento: { id, especie: "saida", situacao: "aberto" }, podeConfirmar: true });
      expect(resumo(pv)).toEqual([["10.0000", "6.0000", false, "writeoff"], ["6.0000", "2.0000", false, "writeoff"]]);
      const ok = await confirmarEstoque("saida", id);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await saldo(p.id)).toBe("2.0000");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// AP-8 — o que não passa por aprovação
// ---------------------------------------------------------------------------------------------------------
describe("AP-8 — estoque: documento que não exige → APROVACAO_NAO_EXIGIDA; confirmado ou cancelado → CONFLICT", () => {
  const NAO_EXIGIDA = { code: "APROVACAO_NAO_EXIGIDA", message: MENSAGEM_APROVACAO_NAO_EXIGIDA };
  const SO_ABERTO = { code: "CONFLICT", message: MENSAGEM_APROVACAO_SO_DOCUMENTO_ABERTO };

  it("AP-8a formato 4 sem aprovação e formato 3 com 'sempre' gravado → 409 APROVACAO_NAO_EXIGIDA, nas duas decisões; nenhuma decisão gravada", async () => {
    const top3 = await top("estoque.entrada", { configuracao: cfg3(SEMPRE) });
    const p = await produto();
    for (const tipo of [c.tops.entrada, top3]) {
      const { id } = await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: tipo });
      for (const r of [await aprovar("entrada", id), await reprovar("entrada", id, { motivo: "Não" })]) {
        expect(r.statusCode, r.body).toBe(409);
        expect(erro(r)).toEqual(NAO_EXIGIDA);
      }
      expect(await decisoes(id)).toEqual([]);
      expect((await trilha(id)).map((t) => t.action)).toEqual(["create"]);
    }
    // PREMISSA: a mesma espécie, com Sempre no formato 4, aceita a decisão.
    const { id } = await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: await top4("entrada", SEMPRE) });
    expect((await aprovar("entrada", id)).statusCode).toBe(200);
  });

  it("AP-8b confirmado e cancelado → 409 CONFLICT 'Só documento aberto passa por aprovação.' — antes da pergunta 'exige?'", async () => {
    const sempre = await top4("ajuste", SEMPRE);
    const p = await produtoComSaldo("10");
    // confirmado (aprovado antes): nem aprovar nem reprovar de novo
    const { id: confirmadoId } = await estoqueLancado("ajuste", [item("ajuste", p.id, "8")], { tipo_operacao_id: sempre });
    expect((await aprovar("ajuste", confirmadoId)).statusCode).toBe(200);
    expect((await confirmarEstoque("ajuste", confirmadoId)).statusCode).toBe(200);
    // cancelado ainda pendente
    const { id: canceladoId } = await estoqueLancado("ajuste", [item("ajuste", p.id, "9")], { tipo_operacao_id: sempre });
    expect((await cancelarEstoque("ajuste", canceladoId)).statusCode).toBe(200);
    // confirmado sem exigir aprovação: a situação vem ANTES da exigência (passo 6 antes do 7)
    const { id: neutroId } = await estoqueLancado("ajuste", [item("ajuste", p.id, "7")]);
    expect((await confirmarEstoque("ajuste", neutroId)).statusCode).toBe(200);

    for (const id of [confirmadoId, canceladoId, neutroId]) {
      const antes = await decisoes(id);
      for (const r of [await aprovar("ajuste", id), await reprovar("ajuste", id, { motivo: "Tarde demais" })]) {
        expect(r.statusCode, r.body).toBe(409);
        expect(erro(r)).toEqual(SO_ABERTO);
      }
      expect(await decisoes(id), "nenhuma decisão nova").toEqual(antes);
    }
    expect(SO_ABERTO.message).toBe("Só documento aberto passa por aprovação.");
  });

  it("AP-8c a porta é da espécie: outra espécie na URL e id malformado → a MESMA 404 do GET; nada gravado", async () => {
    const { id } = await estoqueLancado("saida", [item("saida", (await produtoComSaldo("10")).id)], { tipo_operacao_id: await top4("saida", SEMPRE) });
    const get404 = await c.ligada.inject({ method: "GET", url: `/api/estoque/entradas/${id}`, headers: c.h.headers() });
    expect(get404.statusCode, "premissa: o GET pela outra espécie é 404").toBe(404);
    for (const r of [await aprovar("entrada", id), await reprovar("entrada", id, { motivo: "x" }), await aprovar("saida", "nao-e-uuid")]) {
      expect(r.statusCode, r.body).toBe(404);
      expect(j(r)).toEqual(j(get404));
    }
    expect(await decisoes(id)).toEqual([]);
    expect((await aprovar("saida", id)).statusCode, "premissa: pela própria espécie, aprova").toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------
// AP-9 — a fila do estoque
// ---------------------------------------------------------------------------------------------------------
interface LinhaDaFila {
  id: string; codigo: string; especie: string; data: string; empresa: { id: string; nome: string }; parceiro: unknown; operacao: { id: string; nome: string };
  valor: unknown; lancadoPor: { id: string; nome: string } | null; situacao: string; ultimaDecisao: unknown; id_global: number | null; version?: unknown;
}
interface PaginaDaFila { items: LinhaDaFila[]; total: number; page: number; pageSize: number; idGlobal?: { tipoEntidade: string } }
async function filaToda(headers: Hdr = c.h.headers(), query: Record<string, string | number> = {}): Promise<PaginaDaFila> {
  const r = await fila("estoque", headers, { pageSize: 1000, ...query });
  expect(r.statusCode, r.body).toBe(200);
  return j(r) as unknown as PaginaDaFila;
}
const idsDaFila = async (headers?: Hdr) => (await filaToda(headers)).items.map((x) => x.id);

describe("AP-9 — a fila do estoque: espécies de quem aprova, escopo, 403, saída da fila e número fixo de consultas", () => {
  it("AP-9a só as espécies que a pessoa aprova: quem só aprova saídas vê só saídas; a linha tem a forma do contrato", async () => {
    const p = await produtoComSaldo("10");
    const { id: entradaId } = await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: await top4("entrada", SEMPRE) });
    const saidaTop = await top4("saida", SEMPRE);
    const { id: saidaId } = await estoqueLancado("saida", [item("saida", p.id)], { tipo_operacao_id: saidaTop });

    const doAdmin = await idsDaFila();
    expect(doAdmin, "premissa: quem aprova as quatro vê as duas").toEqual(expect.arrayContaining([entradaId, saidaId]));

    const aprovadorDeSaidas = await usuario("Aprovador de saídas", ["saidas_estoque.approve"]);
    const pagina = await filaToda(aprovadorDeSaidas);
    expect(pagina.items.length, "premissa: a fila dele não está vazia").toBeGreaterThan(0);
    expect(new Set(pagina.items.map((x) => x.especie))).toEqual(new Set(["saida"]));
    expect(pagina.items.map((x) => x.id)).toContain(saidaId);
    expect(pagina.items.map((x) => x.id)).not.toContain(entradaId);
    expect(pagina.total, "a contagem é a do recorte, não a de todas").toBe(pagina.items.length);

    const versao = (await docNoBanco(saidaId)).tipo_operacao_versao_id;
    const nomeTop = (await c.admin.query<{ nome: string }>("select nome from erp.tipos_operacao_versoes where id = $1", [versao])).rows[0]!.nome;
    const nomeEmpresa = (await c.admin.query<{ name: string }>("select name from erp.empresas where id = $1", [c.I.empresa])).rows[0]!.name;
    const idGlobal = (await c.admin.query<{ n: string }>(
      "select id_global::text n from erp.registros_globais where tipo_entidade = 'documentos_estoque' and id_entidade = $1", [saidaId])).rows[0]!.n;
    const linha = pagina.items.find((x) => x.id === saidaId)!;
    expect(linha).toEqual({
      id: saidaId, codigo: expect.any(String), especie: "saida", data: DATA, empresa: { id: c.I.empresa, nome: nomeEmpresa }, parceiro: null,
      operacao: { id: saidaTop, nome: nomeTop }, valor: null, lancadoPor: { id: c.h.demo.adminUserId, nome: await nomeDoAdmin() },
      situacao: "pendente", ultimaDecisao: null, id_global: Number(idGlobal),
    });
    expect(pagina.idGlobal?.tipoEntidade, "a página declara o ID Global, como as listas de hoje").toBe("documentos_estoque");
  });

  it("AP-9b sem nenhuma `.approve` das quatro espécies → 403, mesmo com todas as outras capacidades do estoque", async () => {
    const semAprovar = await usuario("Operador de estoque", ESPECIES.flatMap((e) => ["view", "create", "edit"].map((a) => `${recurso(e)}.${a}`)));
    const r = await fila("estoque", semAprovar);
    expect(r.statusCode, r.body).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
    // PREMISSA: com uma `.approve` qualquer, a mesma porta responde.
    const comUma = await usuario("Aprovador de ajustes", ["ajustes_estoque.approve"]);
    expect((await fila("estoque", comUma)).statusCode).toBe(200);
  });

  it("AP-9c sai da fila ao ser aprovado, cancelado ou confirmado; reprovado FICA, com a última decisão; formato 1–3 e sem aprovação nunca entram", async () => {
    const sempre = await top4("entrada", SEMPRE);
    const p = await produto();
    const lancar = async (tipo: string) => (await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: tipo })).id;
    const [aprovado, cancelado, reprovado, confirmado] = [await lancar(sempre), await lancar(sempre), await lancar(sempre), await lancar(sempre)];
    const neutro = await lancar(c.tops.entrada);
    const formato3 = await lancar(await top("estoque.entrada", { configuracao: cfg3(SEMPRE) }));
    const antes = await idsDaFila();
    expect(antes, "premissa: os quatro de Sempre estão na fila").toEqual(expect.arrayContaining([aprovado, cancelado, reprovado, confirmado]));
    expect(antes).not.toContain(neutro);
    expect(antes).not.toContain(formato3);

    expect((await aprovar("entrada", aprovado)).statusCode).toBe(200);
    expect((await cancelarEstoque("entrada", cancelado)).statusCode).toBe(200);
    expect((await reprovar("entrada", reprovado, { motivo: "Sem nota" })).statusCode).toBe(200);
    expect((await aprovar("entrada", confirmado)).statusCode).toBe(200);
    expect((await confirmarEstoque("entrada", confirmado)).statusCode).toBe(200);

    const depois = await filaToda();
    const ids = depois.items.map((x) => x.id);
    for (const saiu of [aprovado, cancelado, confirmado]) expect(ids).not.toContain(saiu);
    const [decisao] = await decisoes(reprovado);
    expect(depois.items.find((x) => x.id === reprovado)).toMatchObject({
      situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: "Sem nota", decididoPor: { id: c.h.demo.adminUserId, nome: await nomeDoAdmin() }, decididoEm: decisao!.decididoEm },
    });
    // O reprovado sai quando é aprovado por uma decisão nova.
    expect((await aprovar("entrada", reprovado)).statusCode).toBe(200);
    expect(await idsDaFila()).not.toContain(reprovado);
  });

  it("AP-9d escopo de empresa de quem aprova e número FIXO de consultas: a página com 1 e com 5 documentos faz as mesmas consultas", async () => {
    // A empresa 2 é só deste caso: a página do aprovador restrito a ela tem exatamente os documentos lançados aqui.
    const aprovador = await usuario("Aprovador da empresa 2", ["entradas_estoque.approve"], escopos({ estoque: [c.I.empresa2] }));
    const sempre = await top4("entrada", SEMPRE);
    const p = await produto();
    const lancar = async () => (await estoqueLancado("entrada", [item("entrada", p.id)],
      { tipo_operacao_id: sempre, empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 })).id;
    // Da empresa 1, na mesma TOP: o admin vê, o aprovador da empresa 2 não.
    const daEmpresa1 = (await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: sempre })).id;

    async function contar(): Promise<{ consultas: number; pagina: PaginaDaFila }> {
      const espiao = vi.spyOn(pg.Client.prototype, "query");
      try {
        const r = await fila("estoque", aprovador, { pageSize: 50 });
        expect(r.statusCode, r.body).toBe(200);
        return { consultas: espiao.mock.calls.length, pagina: j(r) as unknown as PaginaDaFila };
      } finally { espiao.mockRestore(); }
    }
    // Aquecimento: a primeira requisição da pessoa carrega o que a autenticação guarda em cache (papel, escopos); a
    // contagem mede a FILA, e por isso começa com o cache quente — como a do ES-11c, que conta com o admin já usado.
    expect((await fila("estoque", aprovador)).statusCode).toBe(200);
    const umId = await lancar();
    const um = await contar();
    const outros = [await lancar(), await lancar(), await lancar(), await lancar()];
    const cinco = await contar();
    expect(um.pagina.items.map((x) => x.id), "premissa: 1 documento").toEqual([umId]);
    expect(new Set(cinco.pagina.items.map((x) => x.id)), "premissa: 5 documentos").toEqual(new Set([umId, ...outros]));
    expect([um.pagina.total, cinco.pagina.total]).toEqual([1, 5]);
    expect(cinco.pagina.items.every((x) => x.empresa.id === c.I.empresa2), "só a empresa do escopo").toBe(true);
    expect(cinco.consultas, "as mesmas consultas, qualquer que seja o número de linhas").toBe(um.consultas);
    expect(await idsDaFila(), "premissa: o documento da empresa 1 está na fila de quem vê as duas").toContain(daEmpresa1);
  });

  /**
   * A EMPRESA SELECIONADA (X-Empresa-Id) recorta a fila como recorta a decisão (`lerDocumentoEstoque` e a trava, pelo
   * `scopedById`): o que a fila mostra é o que Aprovar e Reprovar aceitam. Se a fila ignorasse a seleção, com a
   * empresa 1 selecionada ela listaria o documento da empresa 2, e Aprovar sobre ele responderia 404.
   */
  it("AP-9e a empresa SELECIONADA recorta a fila como recorta a decisão: com a 1, o documento da 2 não aparece e a decisão é a 404 do GET; com a 2, aparece e Aprovar passa", async () => {
    const sempre = await top4("entrada", SEMPRE);
    const p = await produto();
    const daEmpresa2 = (await estoqueLancado("entrada", [item("entrada", p.id)],
      { tipo_operacao_id: sempre, empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 })).id;
    const daEmpresa1 = (await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: sempre })).id;
    const naEmpresa1 = c.h.headers({ "x-empresa-id": c.I.empresa });
    const naEmpresa2 = c.h.headers({ "x-empresa-id": c.I.empresa2 });
    // PREMISSA: sem empresa selecionada, quem enxerga as duas tem as duas na fila.
    expect(await idsDaFila(), "premissa: sem seleção, as duas estão na fila").toEqual(expect.arrayContaining([daEmpresa1, daEmpresa2]));

    // Empresa 1 selecionada: o da empresa 2 NÃO aparece — e o da 1 aparece (a seleção recortou, não esvaziou).
    const f1 = await filaToda(naEmpresa1);
    expect(f1.items.map((x) => x.id)).toContain(daEmpresa1);
    expect(f1.items.map((x) => x.id)).not.toContain(daEmpresa2);
    expect(f1.items.every((x) => x.empresa.id === c.I.empresa), "só a empresa selecionada").toBe(true);
    expect(f1.total, "a contagem é a do recorte").toBe(f1.items.length);
    // ... e a decisão, com a MESMA seleção, é a MESMA 404 do GET: o que a fila esconde a decisão não aceita.
    const get404 = await c.ligada.inject({ method: "GET", url: `/api/estoque/entradas/${daEmpresa2}`, headers: naEmpresa1 });
    expect(get404.statusCode, "premissa: com a empresa 1 selecionada, o GET do documento da 2 é 404").toBe(404);
    for (const r of [await aprovar("entrada", daEmpresa2, {}, naEmpresa1), await reprovar("entrada", daEmpresa2, { motivo: "Outra empresa" }, naEmpresa1)]) {
      expect(r.statusCode, r.body).toBe(404);
      expect(j(r)).toEqual(j(get404));
    }
    expect(await decisoes(daEmpresa2)).toEqual([]);

    // Empresa 2 selecionada: aparece (e o da 1 não), e Aprovar passa; aprovado, sai da fila.
    const f2 = await filaToda(naEmpresa2);
    expect(f2.items.map((x) => x.id)).toContain(daEmpresa2);
    expect(f2.items.map((x) => x.id)).not.toContain(daEmpresa1);
    const ok = await aprovar("entrada", daEmpresa2, {}, naEmpresa2);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await decisoes(daEmpresa2)).map((d) => [d.decisao, d.empresa_id])).toEqual([["aprovado", c.I.empresa2]]);
    expect((await filaToda(naEmpresa2)).items.map((x) => x.id)).not.toContain(daEmpresa2);
  });

  it("AP-9f empresa selecionada FORA do escopo de estoque de quem aprova → 403 na fila, o MESMO da decisão (nunca uma fila vazia); com a dele, a fila responde", async () => {
    const aprovador = await usuario("Aprovador do estoque da empresa 2", ["entradas_estoque.approve"], escopos({ estoque: [c.I.empresa2] }));
    const daEmpresa2 = (await estoqueLancado("entrada", [item("entrada", (await produto()).id)],
      { tipo_operacao_id: await top4("entrada", SEMPRE), empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 })).id;
    const proibida = { ...aprovador, "x-empresa-id": c.I.empresa };
    const r = await fila("estoque", proibida);
    expect(r.statusCode, r.body).toBe(403);
    expect(erro(r).code).toBe("PERMISSION_DENIED");
    const decisao = await aprovar("entrada", daEmpresa2, {}, proibida);
    expect([decisao.statusCode, erro(decisao)], "a decisão, com a mesma seleção, recusa igual").toEqual([403, erro(r)]);
    expect(await decisoes(daEmpresa2)).toEqual([]);
    // PREMISSA: com a empresa DELE selecionada, a mesma porta responde, e o documento está lá.
    expect((await filaToda({ ...aprovador, "x-empresa-id": c.I.empresa2 })).items.map((x) => x.id)).toContain(daEmpresa2);
  });
});

// ---------------------------------------------------------------------------------------------------------
// AP-12 — a guarda do banco
// ---------------------------------------------------------------------------------------------------------
describe("AP-12 — estoque: UPDATE direto de aberto para confirmado sem aprovação → CONFLICT pelo banco; formato 1 a 3 livre", () => {
  it("AP-12a pendente e reprovado: o gatilho recusa com CONFLICT de uma linha (409, sem details); aprovado passa", async () => {
    const sempre = await top4("saida", SEMPRE);
    const p = await produtoComSaldo("10");
    const { id } = await estoqueLancado("saida", [item("saida", p.id)], { tipo_operacao_id: sempre });

    const casos: [string, string][] = [];
    const pendente = await confirmarDireto(id);
    expect((pendente.falha as { code?: string }).code).toBe("P0001");
    casos.push(["pendente", (pendente.falha as Error).message]);
    expect((await reprovar("saida", id, { motivo: "Motivo livre que não vai para a mensagem" })).statusCode).toBe(200);
    const reprovado = await confirmarDireto(id);
    casos.push(["reprovado", (reprovado.falha as Error).message]);
    expect(casos).toEqual([
      ["pendente", "CONFLICT: Este documento precisa de aprovação antes de ser confirmado."],
      ["reprovado", "CONFLICT: Este documento foi reprovado e não pode ser confirmado."],
    ]);
    // O que todo binário faz com isso: 409 CONFLICT, sem details.
    for (const falha of [pendente.falha, reprovado.falha]) {
      const traduzida = fromPgError(falha);
      expect([traduzida?.code, traduzida?.httpStatus, traduzida?.details]).toEqual(["CONFLICT", 409, undefined]);
    }
    expect([(await docNoBanco(id)).situacao, await movimentosDe("documentos_estoque", id)]).toEqual(["aberto", []]);

    // PREMISSA: aprovado (decisão nova), o mesmo UPDATE passa.
    expect((await aprovar("saida", id)).statusCode).toBe(200);
    expect(await confirmarDireto(id)).toEqual({ falha: null, linhas: 1 });
  });

  it("AP-12b formato 1 a 3 (mesmo com 'sempre' gravado) e formato 4 sem aprovação: o UPDATE direto passa", async () => {
    const p = await produto();
    const tipos = [await top("estoque.entrada"), await top("estoque.entrada", { configuracao: cfg3(SEMPRE) }), c.tops.entrada];
    const formatos: number[] = [];
    for (const tipo of tipos) {
      const { id } = await estoqueLancado("entrada", [item("entrada", p.id)], { tipo_operacao_id: tipo });
      formatos.push((await docNoBanco(id)).formato);
      expect(await confirmarDireto(id), `a guarda não barra o documento da TOP ${tipo}`).toEqual({ falha: null, linhas: 1 });
    }
    expect(formatos[0], "premissa: a TOP sem configuração é de formato 1 a 3").toBeLessThan(4);
    expect(formatos.slice(1), "premissa: o formato 3 com 'sempre' e o 4 neutro").toEqual([3, 4]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// CA-12 (estoque) — a barreira das travas: a automática do estoque × a confirmação MANUAL de uma VENDA
// ---------------------------------------------------------------------------------------------------------

/** Quantas transações DESTE banco (o do agente; nenhum outro processo o usa) estão esperando trava agora. */
async function esperandoTrava(): Promise<number> {
  return Number((await c.admin.query<{ n: string }>(
    "select count(*)::text n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'")).rows[0]!.n);
}
/** Espera (sondando) até `n` transações esperarem trava, por no máximo 15 s. Devolve a última contagem. */
async function ateEsperarem(n: number): Promise<number> {
  const limite = Date.now() + 15_000;
  let esperando = await esperandoTrava();
  while (esperando < n && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 25));
    esperando = await esperandoTrava();
  }
  return esperando;
}
/** A promessa, ou a falha se ela não terminar em `ms` — "ninguém trava para sempre" com prazo CURTO, sem inflar o do teste. */
async function semPendurar<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeitar) => { relogio = setTimeout(() => rejeitar(new Error(`uma das requisições ficou pendurada por mais de ${ms} ms`)), ms); });
  try { return await Promise.race([p, prazo]); } finally { clearTimeout(relogio); }
}

/**
 * DUAS REQUISIÇÕES EM PARALELO DE VERDADE, EM ORDEM DE CHEGADA CONTROLADA — cópia LOCAL do helper do CA-12 da venda
 * (`top-config-08-vendas.test.ts`), que não é exportado.
 *
 * Uma conexão própria (superusuário) segura a linha `sqlTrava`. A `primeira` é disparada e SÓ DEPOIS de ela estar
 * esperando trava no banco a `segunda` é disparada; a barreira cai quando as duas esperam. A fila de uma linha no
 * Postgres é por ordem de chegada (a trava pesada da tupla), então quem pega a linha quando a barreira cai é a
 * `primeira` — é isso que torna o CICLO determinístico, e não a sorte do escalonador. Quem o Postgres escolhe como
 * vítima do 40P01 é decidido pelo detector (o primeiro `deadlock_timeout` que vence): por isso o caso aceita as duas
 * vítimas e exige que haja EXATAMENTE uma.
 */
async function emOrdemComBarreira(sqlTrava: string, params: unknown[], primeira: () => Promise<Resposta>, segunda: () => Promise<Resposta>):
  Promise<{ respostas: [Resposta, Resposta]; esperando: [number, number] }> {
  const barreira = await c.admin.connect();
  try {
    await barreira.query("begin");
    const travou = await barreira.query(sqlTrava, params);
    expect(travou.rowCount, "premissa: a barreira travou a linha").toBe(1);
    const pa = primeira();
    const e1 = await ateEsperarem(1);
    const pb = segunda();
    const e2 = await ateEsperarem(2);
    await barreira.query("rollback");
    const respostas = await semPendurar(Promise.all([pa, pb]), 20_000);
    return { respostas, esperando: [e1, e2] };
  } finally {
    // Se algo falhou antes de soltar, a barreira não pode ficar segurando as requisições (nem voltar ao pool aberta).
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}

/** O 40P01/40001 pelo `fromPgError`: o 409 de hoje — o corpo da manual que perde e o `erro` da automática que perde. */
const RECUSA_DA_CONCORRENCIA: Erro = { code: "CONCURRENCY_CONFLICT", message: "Conflito de concorrência, tente novamente" };

/** A venda no banco: situação, quantos movimentos, quantos títulos e quantas auditorias "confirm" (o "nada aconteceu"). */
async function efeitosDaVenda(id: string): Promise<[string | null, number, number, number]> {
  return [await situacaoNoBanco("sales_documents", id), (await movimentosDe("sales_documents", id)).length,
    (await titulosDe("sales_documents", id)).length, (await auditoriaDe("sales_documents", id, "confirm")).length];
}
/** A venda CONFIRMADA no banco: UMA saída de 1 do produto no ALM, UM título a receber de 10.00, UMA auditoria "confirm". */
async function vendaConfirmada(id: string, produtoId: string): Promise<void> {
  expect(await situacaoNoBanco("sales_documents", id), "a venda confirmada no banco").toBe("confirmed");
  expect((await movimentosDe("sales_documents", id)).map((m) => [m.movement_type, m.direction, m.quantity, m.product_id, armazemDe(m.warehouse_id)]))
    .toEqual([["sale", -1, "1.0000", produtoId, "ALM"]]);
  expect((await titulosDe("sales_documents", id)).map((t) => [t.direction, t.amount])).toEqual([["receivable", "10.00"]]);
  expect(await auditoriaDe("sales_documents", id, "confirm"), "uma confirmação = uma auditoria").toHaveLength(1);
}
/**
 * A saída de estoque CONFIRMADA no banco: UM `writeoff` de 2 no ALM, por quem lançou, e a trilha "create" → "confirm"
 * (com `automatica: true` só quando foi a automática que confirmou).
 */
async function saidaConfirmada(id: string, automatica: boolean): Promise<void> {
  const d = await docNoBanco(id);
  expect([d.situacao, d.confirmado_por], "a saída confirmada no banco").toEqual(["confirmado", c.h.demo.adminUserId]);
  expect((await movimentosDe("documentos_estoque", id)).map((m) => [m.movement_type, m.direction, m.quantity, armazemDe(m.warehouse_id)]))
    .toEqual([["writeoff", -1, "2.0000", "ALM"]]);
  expect((await trilha(id)).map((t) => [t.action, t.metadata.automatica === true])).toEqual([["create", false], ["confirm", automatica]]);
}

describe("CA-12 (estoque) barreira: POST de SAÍDA com TOP formato 4 Automática × confirmação manual de uma VENDA do MESMO produto", () => {
  /**
   * O CICLO (decisão 277; contrato §17.3, "Travas"): o POST do estoque pega o contador do ID Global no `lancar`
   * (`atribuirIdGlobal`) e só depois, na confirmação automática, a linha de saldo e o produto (`postStock`, pelo
   * gatilho do movimento); a confirmação manual da venda trava documento → linha de saldo e produto (`postStock`) →
   * contador do ID Global (`createTitles`). Cada um segura o que o outro pede. É NOVO nesta fatia: a confirmação
   * MANUAL do estoque não pega contador nenhum e não fecha o ciclo; a automática fecha, porque o lançamento já
   * segura o contador. O desfecho tem de ser o do CA-12 da venda. A venda é SEM TOP (a de sempre: baixa e título a
   * receber), do MESMO produto e armazém (ALM, sem lote: a mesma linha de saldo).
   */
  async function cenario() {
    const topAuto = await top4("saida", AUTOMATICA);
    const p = await produtoComSaldo("20");
    const venda = await vendaLancada(corpoVenda([itemVenda(p.id, "1", "10.00")]));
    expect(await efeitosDaVenda(venda.id), "premissa: a venda está aberta, sem efeito").toEqual(["open", 0, 0, 0]);
    return { p, vendaId: venda.id, lancarSaida: () => lancarEstoque("saida", [item("saida", p.id, "2")], { tipo_operacao_id: topAuto }) };
  }

  /**
   * O DESFECHO: as duas terminaram, e EXATAMENTE UMA perdeu o 40P01 com um dos resultados aceitos — a manual da venda
   * com o 409 CONCURRENCY_CONFLICT de hoje, ou o documento de estoque SALVO e ABERTO com "recusada" (o MESMO erro). A
   * vencedora confirmou com efeito; a perdedora, nada. Depois, a perdedora confirma pela porta manual (premissa: ela
   * era confirmável — o "nada" dela não é um cenário que nunca confirmaria). Devolve quem perdeu.
   */
  async function desfecho(s: Awaited<ReturnType<typeof cenario>>, post: Resposta, manual: Resposta): Promise<"manual" | "automatica"> {
    expect(post.statusCode, `o POST do estoque sempre salva: ${post.body}`).toBe(201);
    const doc = corpoDoPost(post);
    const ca = doc.confirmacaoAutomatica as { confirmado: boolean; motivo?: string; erro?: Erro };
    const perdeuManual = manual.statusCode === 409 && erro(manual).code === "CONCURRENCY_CONFLICT";
    const perdeuAutomatica = ca.confirmado === false && ca.erro?.code === "CONCURRENCY_CONFLICT";
    expect([perdeuManual, perdeuAutomatica].filter(Boolean),
      `exatamente uma vítima do ciclo — manual: ${manual.statusCode} ${manual.body} / automática: ${JSON.stringify(ca)}`).toHaveLength(1);
    if (perdeuManual) {
      expect(erro(manual)).toEqual(RECUSA_DA_CONCORRENCIA);
      expect(doc).toEqual({ ...CORPO_DE_HOJE("saida", "confirmado"), confirmacaoAutomatica: { confirmado: true } });
      await saidaConfirmada(doc.id, true);
      expect(await efeitosDaVenda(s.vendaId), "a manual perdedora não deixou efeito").toEqual(["open", 0, 0, 0]);
      expect(await saldo(s.p.id)).toBe("18.0000");
      const r = await confirmarVenda(s.vendaId);
      expect(r.statusCode, `premissa: a venda era confirmável — ${r.body}`).toBe(200);
      await vendaConfirmada(s.vendaId, s.p.id);
    } else {
      expect(manual.statusCode, manual.body).toBe(200);
      expect(doc).toEqual({ ...CORPO_DE_HOJE("saida"), confirmacaoAutomatica: { confirmado: false, motivo: "recusada", erro: RECUSA_DA_CONCORRENCIA } });
      expect((await trilha(doc.id)).map((t) => t.action), "a automática perdedora ficou SALVA").toEqual(["create"]);
      expect([(await docNoBanco(doc.id)).situacao, await movimentosDe("documentos_estoque", doc.id)], "e ABERTA, sem efeito").toEqual(["aberto", []]);
      await vendaConfirmada(s.vendaId, s.p.id);
      expect(await saldo(s.p.id)).toBe("19.0000");
      const r = await confirmarEstoque("saida", doc.id);
      expect(r.statusCode, `premissa: o documento de estoque era confirmável — ${r.body}`).toBe(200);
      await saidaConfirmada(doc.id, false);
    }
    expect(await saldo(s.p.id), "no fim, as duas saíram uma vez cada").toBe("17.0000");
    return perdeuManual ? "manual" : "automatica";
  }

  it("CA-12c a manual da venda chega PRIMEIRO à linha de saldo (o POST do estoque já segura o contador): o ciclo fecha, ninguém pendura, uma vítima só, com um resultado aceito", async () => {
    const s = await cenario();
    const { respostas: [manual, post], esperando } = await emOrdemComBarreira(
      "select 1 from erp.stock_balances where organization_id=$1 and warehouse_id=$2 and product_id=$3 and provider_lot='' for update",
      [c.h.demo.orgId, c.I.warehouse, s.p.id],
      () => confirmarVenda(s.vendaId),
      s.lancarSaida);
    expect(esperando, "premissa: a manual esperou primeiro, e as duas esperavam quando a barreira caiu").toEqual([1, 2]);
    expect(["manual", "automatica"]).toContain(await desfecho(s, post, manual));
  });

  it("CA-12d o POST do estoque chega PRIMEIRO ao contador do ID Global (a manual da venda já segura o saldo): o ciclo fecha, ninguém pendura, uma vítima só, com um resultado aceito", async () => {
    const s = await cenario();
    const { respostas: [post, manual], esperando } = await emOrdemComBarreira(
      "select 1 from erp.sequencias_id_global where organization_id=$1 for update",
      [c.h.demo.orgId],
      s.lancarSaida,
      () => confirmarVenda(s.vendaId));
    expect(esperando, "premissa: o POST esperou primeiro, e as duas esperavam quando a barreira caiu").toEqual([1, 2]);
    expect(["manual", "automatica"]).toContain(await desfecho(s, post, manual));
  });
});
