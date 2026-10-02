import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configuracaoNeutraTopV5, type ConfiguracaoTipoOperacaoV5 } from "@agro/domain";
import {
  c, iniciar, encerrar, j, erro, unico, cfg4, top, versaoAtualNoBanco, usuario, escopos, produto,
  itemCompra, corpoCompra, compraLancada, lerCompra, receberPedido, corpoReceber, aprovar, reprovar, fila,
  situacaoNoBanco, decisoesDe,
  type Hdr, type Resposta, type Erro, type ItemCompra,
} from "./top-config-08-ajuda.js";

/**
 * OPERACOES-01 F6a (decisão 283) — O PEDIDO DE COMPRA FINALIZADO (plano F6a §1.3.2, §1.3.3, §1.3.9, §1.3.11; FP-1..FP-6).
 *
 *   · FP-1 finalizar sem aprovação: 200 com quem/quando, auditoria "finalize", replay da Idempotency-Key; 403 sem
 *          `pedidos_compra.edit`; a MESMA 404 para inexistente, malformado, compra na porta do pedido e pedido de
 *          outra empresa fora do escopo; 409 para o que não está aberto;
 *   · FP-2 a prévia da finalização (`podeFinalizar`, recusas, aprovação);
 *   · FP-3 a aprovação do pedido ao finalizar ("Sempre" e "A partir de um valor", acima e abaixo): 409 pendente com a
 *          mensagem do pedido, a fila com o pedido só para quem tem `compras.approve` ∧ `pedidos_compra.approve`,
 *          reprovar, aprovar, e a COBERTURA (o valor muda depois de aprovado → pendente de novo, e volta à fila);
 *   · FP-4 receber: com `fluxoCompra.exigeFinalizar`, o aberto não é recebido e o finalizado é; a compra cancelada
 *          reabre o pedido como FINALIZADO; sem a exigência, como hoje (a premissa do skew);
 *   · FP-5 encerrar o saldo e cancelar o pedido finalizado;
 *   · FP-6 a capacidade `finalizacaoEOrcamento` e a leitura do pedido com as chaves novas e `orcamentos: []`.
 *
 * O QUE CONTA COMO PROVA (o molde da TOP-CONFIG-08): a situação, os carimbos, as compras geradas, as decisões e a
 * trilha LIDOS NO BANCO pela testemunha (`c.admin`, superusuário sem RLS); toda recusa "sem efeito" vem com a
 * PREMISSA ao lado (o mesmo pedido, sem o obstáculo, passa).
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── mensagens, escritas à mão (o contrato da F6a) ───────────────

const MSG_SO_ABERTO = "Só pedido aberto é finalizado.";
const MSG_PENDENTE_PEDIDO = "Este pedido precisa de aprovação antes de ser finalizado.";
const MSG_NAO_EXIGIDA = "Este documento não precisa de aprovação.";
const MSG_PRECISA_FINALIZAR = "Este pedido precisa ser finalizado antes de ser recebido.";
const MSG_PEDIDO_COM_COMPRAS = "Este pedido tem compras: cancele-as ou encerre o saldo.";

// ─────────────── TOPs ───────────────

/** O neutro do FORMATO 5 (o do domínio), com o ajuste do caso. Cada chamada devolve um objeto novo. */
function cfg5(ajuste: (x: ConfiguracaoTipoOperacaoV5) => void = () => {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  ajuste(x);
  return x;
}

/** Uma TOP nova da família, com a PREMISSA de que o banco guardou a versão no formato pedido. */
async function topNoFormato(codigoBase: string, configuracao: { versaoSchema: number }, extra: Record<string, unknown> = {}): Promise<string> {
  const id = await top(codigoBase, { configuracao, ...extra });
  expect((await versaoAtualNoBanco(id)).configuracao_schema_version, `premissa: a versão de ${codigoBase} está no formato ${configuracao.versaoSchema}`)
    .toBe(configuracao.versaoSchema);
  return id;
}

/** A TOP de pedido com a aresta para a TOP de compra de destino (inteiro ou "Em partes"). */
const topPedidoPara = (configuracao: { versaoSchema: number }, topCompraDestino: string, emPartes = false) =>
  topNoFormato("compras.pedido", configuracao, { destinos: [{ tipoOperacaoId: topCompraDestino, ordem: 0, emPartes }] });

// ─────────────── chamadas ───────────────

const comChave = (headers: Hdr, chave?: string): Hdr => (chave ? { ...headers, "idempotency-key": chave } : headers);
const finalizar = (id: string, headers: Hdr = c.h.headers(), chave?: string, payload: unknown = {}): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${id}/finalizar`, headers: comChave(headers, chave), payload: payload as Record<string, unknown> });
const previaFinalizacao = (id: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/pedidos/${id}/previa-finalizacao`, headers });
const proximosPassos = (id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "GET", url: `/api/compras/pedidos/${id}/proximos-passos`, headers: c.h.headers() });
const cancelar = (segmento: "pedidos" | "compras", id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/${segmento}/${id}/cancel`, headers: c.h.headers(), payload: {} });
const encerrarSaldo = (id: string, motivo: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/pedidos/${id}/encerrar-saldo`, headers: c.h.headers(), payload: { motivo } });

/** Um pedido lançado pela API com a TOP dada (a neutra do formato 4 sem TOP), e os itens dele no banco. */
async function pedido(itens: ItemCompra[], topPedido: string = c.tops.pedidoCompra, extra: Record<string, unknown> = {}) {
  const p = await compraLancada("pedido", corpoCompra(itens, { tipo_operacao_id: topPedido, ...extra }, "pedido"));
  const linhas = (await c.admin.query<{ id: string; quantidade: string }>(
    "select id, quantidade::text from erp.documentos_compra_itens where documento_id=$1 order by posicao, id", [p.id])).rows;
  expect(linhas, "premissa: o pedido tem os itens do corpo").toHaveLength(itens.length);
  expect(p.situacao, "premissa: o pedido nasce aberto").toBe("aberto");
  return { id: p.id, itens: linhas };
}

/** O cabeçalho do pedido no banco: situação e os carimbos da finalização. */
async function cabecalho(id: string) {
  return (await c.admin.query<{ situacao: string; finalizado_em: Date | null; finalizado_por: string | null; valor_total: string; saldo_encerrado_em: Date | null }>(
    "select situacao, finalizado_em, finalizado_por, valor_total::text, saldo_encerrado_em from erp.documentos_compra where id=$1", [id])).rows[0]!;
}

/**
 * A trilha do SERVIÇO para a ação (as de transição — finalize, convert, cancel, encerrar_saldo, compra_cancelada — só o
 * serviço grava; o gatilho da tabela grava "create"/"update") e as fotos antes/depois, em ordem.
 */
async function trilha(id: string, action: string) {
  return (await c.admin.query<{ user_id: string | null; metadata: Record<string, unknown> | null; before: unknown; after: unknown }>(
    "select user_id, metadata, before, after from erp.audit_logs where entity='documentos_compra' and entity_id=$1 and action=$2 order by id",
    [id, action])).rows;
}

/** As compras geradas pelo pedido (todas, inclusive canceladas), pela origem. */
async function comprasGeradas(pedidoId: string): Promise<string[]> {
  return (await c.admin.query<{ id: string }>("select id from erp.documentos_compra where origem_documento_id=$1 order by created_at, id", [pedidoId])).rows.map((x) => x.id);
}

/** O receber de itens do pedido para a TOP de destino (quantidade por item; padrão: o item inteiro). */
const receber = (p: { id: string; itens: { id: string; quantidade: string }[] }, topDestino: string, quantidades?: string[], extra: Record<string, unknown> = {}) =>
  receberPedido(p.id, corpoReceber(topDestino, p.itens.map((i, k) => ({ item_origem_id: i.id, quantidade: quantidades?.[k] ?? i.quantidade })), extra));

type LinhaFila = { id: string; especie: string; situacao: string; valor: string | null; ultimaDecisao: { decisao: string } | null };
/** A fila de compras INTEIRA de quem pergunta (página de 1000, conferida contra o total). */
async function filaDeCompras(headers: Hdr = c.h.headers()): Promise<LinhaFila[]> {
  const r = await fila("compras", headers, { pageSize: 1000 });
  expect(r.statusCode, r.body).toBe(200);
  const f = j(r) as unknown as { items: LinhaFila[]; total: number };
  expect(f.items.length, "premissa: a página de 1000 traz a fila inteira").toBe(f.total);
  return f.items;
}

/** A 404 do GET por id do pedido (o corpo de referência de "não existe para você"). */
async function get404(): Promise<Erro> {
  const r = await lerCompra("pedido", "00000000-0000-4000-8000-0000000000f6");
  expect(r.statusCode).toBe(404);
  return erro(r);
}

// ─────────────── FP-1 ───────────────

describe("FP-1 finalizar sem aprovação", () => {
  it("FP-1a 200 com quem e quando; o banco finalizado; auditoria 'finalize'; o replay devolve o MESMO corpo e não grava de novo", async () => {
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "3", "10.00")]);
    const chave = `f6a-fp1a-${unico()}`;
    const r1 = await finalizar(ped.id, c.h.headers(), chave);
    expect(r1.statusCode, r1.body).toBe(200);
    const b = j(r1);
    expect(Object.keys(b)).toEqual(["id", "situacao", "finalizado_em", "finalizado_por"]);
    expect([b.id, b.situacao, b.finalizado_por]).toEqual([ped.id, "finalizado", c.h.demo.adminUserId]);
    // NO BANCO: finalizado, com os dois carimbos juntos — os da resposta.
    const db = await cabecalho(ped.id);
    expect([db.situacao, db.finalizado_por]).toEqual(["finalizado", c.h.demo.adminUserId]);
    expect(db.finalizado_em!.toISOString()).toBe(b.finalizado_em);
    // A trilha do serviço: UMA "finalize", com a aprovação não exigida e a mudança de situação.
    const t = await trilha(ped.id, "finalize");
    expect(t).toEqual([{ user_id: c.h.demo.adminUserId, metadata: { aprovacao: "nao_exigida" }, before: { situacao: "aberto" }, after: { situacao: "finalizado" } }]);
    // O REPLAY: a mesma chave → o mesmo corpo, nenhuma trilha nova (e nenhum 409 de "não está aberto").
    const r2 = await finalizar(ped.id, c.h.headers(), chave);
    expect(r2.statusCode, r2.body).toBe(200);
    expect(j(r2)).toEqual(b);
    expect(await trilha(ped.id, "finalize")).toHaveLength(1);
    // A leitura do pedido traz os carimbos e o nome de quem finalizou.
    const lido = j(await lerCompra("pedido", ped.id));
    expect([lido.situacao, lido.finalizado_por, lido.finalizado_por_nome]).toEqual(["finalizado", c.h.demo.adminUserId, expect.any(String)]);
    // Premissa: sem a chave, o MESMO pedido não finaliza de novo (o replay não "deu sorte").
    const sem = await finalizar(ped.id);
    expect(sem.statusCode, sem.body).toBe(409);
    expect(erro(sem)).toEqual({ code: "CONFLICT", message: MSG_SO_ABERTO });
  });

  it("FP-1b corpo com chave desconhecida → 422; sem pedidos_compra.edit → 403; nada muda; premissa: com a capacidade, finaliza", async () => {
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "1", "10.00")]);
    const corpoRuim = await finalizar(ped.id, c.h.headers(), undefined, { motivo: "x" });
    expect(corpoRuim.statusCode, corpoRuim.body).toBe(422);
    const leitor = await usuario("Leitor de pedido F6a", ["pedidos_compra.view"]);
    expect((await lerCompra("pedido", ped.id, leitor)).statusCode, "premissa: ele VÊ o pedido").toBe(200);
    const r = await finalizar(ped.id, leitor);
    expect(r.statusCode, r.body).toBe(403);
    expect((await cabecalho(ped.id)).situacao).toBe("aberto");
    expect(await trilha(ped.id, "finalize")).toEqual([]);
    const editor = await usuario("Editor de pedido F6a", ["pedidos_compra.view", "pedidos_compra.edit"]);
    expect((await finalizar(ped.id, editor)).statusCode).toBe(200);
    expect((await cabecalho(ped.id)).situacao).toBe("finalizado");
  });

  it("FP-1c a MESMA 404 do GET: inexistente, malformado, compra na porta do pedido e pedido de outra empresa fora do escopo", async () => {
    const ref = await get404();
    const p = await produto();
    const compra = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")]));
    const daEmpresa2 = await pedido([itemCompra(p.id, "1", "10.00", { armazem_id: c.I.warehouseEmpresa2 })], c.tops.pedidoCompra, { empresa_id: c.I.empresa2 });
    const soA = await usuario("Comprador só da A F6a", ["pedidos_compra.view", "pedidos_compra.edit"], escopos({ compras: [c.I.empresa] }));
    const casos: { nome: string; id: string; headers: Hdr }[] = [
      { nome: "inexistente", id: "00000000-0000-4000-8000-0000000000aa", headers: c.h.headers() },
      { nome: "malformado", id: "nao-e-uuid", headers: c.h.headers() },
      { nome: "compra na porta do pedido", id: compra.id, headers: c.h.headers() },
      { nome: "pedido da empresa 2 para quem só vê a 1", id: daEmpresa2.id, headers: soA },
    ];
    for (const caso of casos) {
      for (const r of [await finalizar(caso.id, caso.headers), await previaFinalizacao(caso.id, caso.headers)]) {
        expect(r.statusCode, `${caso.nome}: ${r.body}`).toBe(404);
        expect(erro(r), caso.nome).toEqual(ref);
      }
    }
    // Premissas: a compra está aberta, e o pedido da empresa 2 está aberto e finaliza por quem enxerga a empresa 2.
    expect(await situacaoNoBanco("documentos_compra", compra.id)).toBe("aberto");
    expect((await cabecalho(daEmpresa2.id)).situacao).toBe("aberto");
    expect((await finalizar(daEmpresa2.id)).statusCode).toBe(200);
  });

  it("FP-1d o que não está aberto → 409 'Só pedido aberto é finalizado.' (cancelado e convertido), sem efeito", async () => {
    const p = await produto();
    const cancelado = await pedido([itemCompra(p.id, "1", "10.00")]);
    expect((await cancelar("pedidos", cancelado.id)).statusCode).toBe(200);
    const topDestino = await topNoFormato("compras.compra", cfg4());
    const convertido = await pedido([itemCompra(p.id, "2", "10.00")], await topPedidoPara(cfg4(), topDestino));
    expect((await receber(convertido, topDestino)).statusCode).toBe(201);
    expect((await cabecalho(convertido.id)).situacao, "premissa: o receber inteiro converteu").toBe("convertido");
    for (const id of [cancelado.id, convertido.id]) {
      const antes = await cabecalho(id);
      const r = await finalizar(id);
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG_SO_ABERTO });
      expect(await cabecalho(id)).toEqual(antes);
    }
  });
});

// ─────────────── FP-2 ───────────────

describe("FP-2 a prévia da finalização", () => {
  it("FP-2a aberto sem aprovação → podeFinalizar; finalizado → a recusa e aprovacao null; a prévia não grava nada", async () => {
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "1", "10.00")]);
    const r = await previaFinalizacao(ped.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ contractVersion: 1, podeFinalizar: true, recusas: [], aprovacao: { situacao: "nao_exigida" } });
    expect((await cabecalho(ped.id)).situacao, "a prévia não finaliza").toBe("aberto");
    expect((await finalizar(ped.id)).statusCode).toBe(200);
    expect(j(await previaFinalizacao(ped.id))).toEqual({ contractVersion: 1, podeFinalizar: false, recusas: [{ code: "CONFLICT", message: MSG_SO_ABERTO }], aprovacao: null });
    // Quem só lê o pedido vê a prévia (é leitura).
    const leitor = await usuario("Leitor da prévia F6a", ["pedidos_compra.view"]);
    expect((await previaFinalizacao(ped.id, leitor)).statusCode).toBe(200);
  });
});

// ─────────────── FP-3 ───────────────

describe("FP-3 a aprovação do pedido ao finalizar", () => {
  it("FP-3a 'Sempre' (formato 4): 409 PENDENTE com a mensagem do pedido; a fila do pedido (AND); reprovar → 409 REPROVADA; aprovar → finaliza", async () => {
    const topSempre = await topNoFormato("compras.pedido", cfg4((x) => { x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "3", "10.00")], topSempre);

    // PENDENTE: o finalizar e a prévia recusam do mesmo jeito, com os details de hoje.
    const pendente: Erro = { code: "APROVACAO_PENDENTE", message: MSG_PENDENTE_PEDIDO, details: { politica: "sempre", valorMinimo: null, valorDocumento: "30.00" } };
    const r = await finalizar(ped.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual(pendente);
    expect((await cabecalho(ped.id)).situacao).toBe("aberto");
    expect(j(await previaFinalizacao(ped.id))).toEqual({ contractVersion: 1, podeFinalizar: false, recusas: [pendente], aprovacao: { situacao: "pendente" } });

    // A FILA: o pedido aparece para quem aprova as duas espécies; quem só aprova compra não o vê nem o decide.
    const aprovador = await usuario("Aprovador de pedido F6a", ["compras.view", "compras.approve", "pedidos_compra.view", "pedidos_compra.approve"]);
    const soCompra = await usuario("Aprovador só de compra F6a", ["compras.view", "compras.approve", "pedidos_compra.view"]);
    expect((await filaDeCompras(aprovador)).find((l) => l.id === ped.id)).toMatchObject({ especie: "pedido", situacao: "pendente", valor: "30.00", ultimaDecisao: null });
    expect((await filaDeCompras()).map((l) => l.id), "o administrador (dono) aprova as duas espécies").toContain(ped.id);
    expect((await filaDeCompras(soCompra)).map((l) => l.id)).not.toContain(ped.id);
    const ref = await get404();
    for (const decisao of [await aprovar("compras", ped.id, {}, soCompra), await reprovar("compras", ped.id, { motivo: "Não" }, soCompra)]) {
      expect(decisao.statusCode, decisao.body).toBe(404);
      expect(erro(decisao)).toEqual(ref);
    }
    expect(await decisoesDe("aprovacoes_compra", ped.id)).toEqual([]);

    // REPROVAR: 409 REPROVADA no finalizar (a recusa da lib, como veio), e a linha fica na fila como reprovada.
    const motivo = "Fornecedor sem cadastro atualizado";
    const rr = await reprovar("compras", ped.id, { motivo }, aprovador);
    expect(rr.statusCode, rr.body).toBe(200);
    expect(j(rr)).toEqual({ aprovacao: { decisao: "reprovado", decididoEm: expect.any(String) } });
    const reprovada = await finalizar(ped.id);
    expect(reprovada.statusCode, reprovada.body).toBe(409);
    expect(erro(reprovada)).toMatchObject({ code: "APROVACAO_REPROVADA", message: `Este documento foi reprovado: ${motivo}.`, details: { motivo } });
    expect((await filaDeCompras(aprovador)).find((l) => l.id === ped.id)).toMatchObject({ situacao: "reprovado" });

    // APROVAR: sem confirmação automática (o pedido não se finaliza sozinho); a prévia libera; finaliza.
    const ra = await aprovar("compras", ped.id, { observacao: "Ok" }, aprovador);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(j(ra)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) } });
    expect((await cabecalho(ped.id)).situacao, "aprovar não finaliza").toBe("aberto");
    expect((await decisoesDe("aprovacoes_compra", ped.id)).map((d) => [d.decisao, d.valor_documento])).toEqual([["reprovado", "30.00"], ["aprovado", "30.00"]]);
    expect((await filaDeCompras(aprovador)).map((l) => l.id), "aprovada e cobrindo: sai da fila").not.toContain(ped.id);
    expect(j(await previaFinalizacao(ped.id))).toEqual({ contractVersion: 1, podeFinalizar: true, recusas: [], aprovacao: { situacao: "aprovado" } });
    const ok = await finalizar(ped.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await trilha(ped.id, "finalize")).map((a) => a.metadata)).toEqual([{ aprovacao: "aprovado" }]);
    // Finalizado, a fila não o mostra (só documento aberto) e a decisão nova é recusada como hoje.
    expect((await filaDeCompras(aprovador)).map((l) => l.id)).not.toContain(ped.id);
    const tarde = await aprovar("compras", ped.id, {}, aprovador);
    expect(tarde.statusCode, tarde.body).toBe(409);
    expect(erro(tarde)).toEqual({ code: "CONFLICT", message: "Só documento aberto passa por aprovação." });
  });

  it("FP-3b a COBERTURA: aprovado e depois o valor sobe → 409 PENDENTE e o pedido volta à fila; aprovado de novo, finaliza", async () => {
    const topSempre = await topNoFormato("compras.pedido", cfg5((x) => { x.aprovacao.politica = "sempre"; }));
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "3", "10.00")], topSempre);
    expect((await aprovar("compras", ped.id)).statusCode).toBe(200);
    expect(j(await previaFinalizacao(ped.id)), "premissa: aprovado, o pedido finalizaria").toMatchObject({ podeFinalizar: true, aprovacao: { situacao: "aprovado" } });
    // O valor muda com o pedido aberto (o que o vencedor do orçamento fará): itens e cabeçalho, pelo superusuário.
    await c.admin.query("update erp.documentos_compra_itens set valor_unitario = 20, valor_total = 60 where documento_id = $1", [ped.id]);
    await c.admin.query("update erp.documentos_compra set valor_itens = 60, valor_total = 60 where id = $1", [ped.id]);
    expect((await cabecalho(ped.id)).valor_total, "premissa: o total subiu acima do aprovado").toBe("60.00");
    const pendente: Erro = { code: "APROVACAO_PENDENTE", message: MSG_PENDENTE_PEDIDO, details: { politica: "sempre", valorMinimo: null, valorDocumento: "60.00" } };
    const r = await finalizar(ped.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual(pendente);
    expect(j(await previaFinalizacao(ped.id))).toEqual({ contractVersion: 1, podeFinalizar: false, recusas: [pendente], aprovacao: { situacao: "pendente" } });
    expect((await cabecalho(ped.id)).situacao).toBe("aberto");
    // A fila volta a listar, como pendente, com a última decisão (a aprovação que deixou de cobrir).
    expect((await filaDeCompras()).find((l) => l.id === ped.id)).toMatchObject({ especie: "pedido", situacao: "pendente", valor: "60.00", ultimaDecisao: { decisao: "aprovado" } });
    // Aprovada de novo (agora pelo valor de 60), finaliza.
    expect((await aprovar("compras", ped.id)).statusCode).toBe(200);
    expect((await filaDeCompras()).map((l) => l.id)).not.toContain(ped.id);
    expect((await finalizar(ped.id)).statusCode).toBe(200);
    expect((await cabecalho(ped.id)).situacao).toBe("finalizado");
  });

  it("FP-3c 'A partir de 1000.00' (formato 5): 1000.00 exige (409, aprovar, finaliza); 999.99 não exige (aprovar → 409 NAO_EXIGIDA) e finaliza direto", async () => {
    const topValor = await topNoFormato("compras.pedido", cfg5((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1000.00"; }));
    const p = await produto();
    const acima = await pedido([itemCompra(p.id, "2", "500.00")], topValor);
    const r = await finalizar(acima.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG_PENDENTE_PEDIDO, details: { politica: "por_valor", valorMinimo: "1000.00", valorDocumento: "1000.00" } });
    expect((await filaDeCompras()).map((l) => l.id)).toContain(acima.id);
    expect((await aprovar("compras", acima.id)).statusCode).toBe(200);
    expect((await finalizar(acima.id)).statusCode).toBe(200);

    const abaixo = await pedido([itemCompra(p.id, "1", "999.99")], topValor);
    expect(j(await previaFinalizacao(abaixo.id))).toEqual({ contractVersion: 1, podeFinalizar: true, recusas: [], aprovacao: { situacao: "nao_exigida" } });
    expect((await filaDeCompras()).map((l) => l.id)).not.toContain(abaixo.id);
    const naoExigida = await aprovar("compras", abaixo.id);
    expect(naoExigida.statusCode, naoExigida.body).toBe(409);
    expect(erro(naoExigida)).toEqual({ code: "APROVACAO_NAO_EXIGIDA", message: MSG_NAO_EXIGIDA });
    expect(await decisoesDe("aprovacoes_compra", abaixo.id)).toEqual([]);
    expect((await finalizar(abaixo.id)).statusCode).toBe(200);
    expect((await trilha(abaixo.id, "finalize")).map((a) => a.metadata)).toEqual([{ aprovacao: "nao_exigida" }]);
  });
});

// ─────────────── FP-4 ───────────────

describe("FP-4 receber: 'Exigir pedido finalizado para receber' só quando a TOP do pedido diz", () => {
  it("FP-4a exige: o aberto → 409 (nenhuma compra); finalizado → recebe em partes e converte; a compra cancelada reabre o pedido FINALIZADO", async () => {
    const topDestino = await topNoFormato("compras.compra", cfg4());
    const topExige = await topPedidoPara(cfg5((x) => { x.fluxoCompra.exigeFinalizar = true; }), topDestino, true);
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "10", "10.00")], topExige);
    expect(j(await proximosPassos(ped.id))).toMatchObject({ politicaConfigurada: true, items: [{ tipoOperacaoId: topDestino, especie: "compra" }], exigeFinalizar: true });
    const aberto = await receber(ped, topDestino, ["4"]);
    expect(aberto.statusCode, aberto.body).toBe(409);
    expect(erro(aberto)).toEqual({ code: "CONFLICT", message: MSG_PRECISA_FINALIZAR });
    expect(await comprasGeradas(ped.id)).toEqual([]);

    expect((await finalizar(ped.id)).statusCode).toBe(200);
    // Em partes: o pedido continua FINALIZADO (a situação real volta na resposta).
    const parte = await receber(ped, topDestino, ["4"]);
    expect(parte.statusCode, parte.body).toBe(201);
    expect([j(parte).from, j(parte).pedidoSituacao]).toEqual([ped.id, "finalizado"]);
    expect((await cabecalho(ped.id)).situacao).toBe("finalizado");
    // O resto: zera o saldo → convertido a partir do finalizado, auditado com a situação de antes.
    const resto = await receber(ped, topDestino, ["6"]);
    expect(resto.statusCode, resto.body).toBe(201);
    expect(j(resto).pedidoSituacao).toBe("convertido");
    expect((await cabecalho(ped.id)).situacao).toBe("convertido");
    const conv = await trilha(ped.id, "convert");
    expect(conv.map((a) => [a.before, a.after])).toEqual([[null, null], [{ situacao: "finalizado" }, { situacao: "convertido" }]]);
    expect(await comprasGeradas(ped.id)).toEqual([j(parte).id, j(resto).id]);

    // Cancelar a compra que zerou: o saldo volta e o pedido REABRE como estava antes de converter — finalizado.
    expect((await cancelar("compras", j(resto).id as string)).statusCode).toBe(200);
    const db = await cabecalho(ped.id);
    expect([db.situacao, db.finalizado_por]).toEqual(["finalizado", c.h.demo.adminUserId]);
    expect((await trilha(ped.id, "compra_cancelada")).map((a) => [a.before, a.after])).toEqual([[{ situacao: "convertido" }, { situacao: "finalizado" }]]);
    // E é recebido de novo, finalizado.
    expect((await receber(ped, topDestino, ["6"])).statusCode).toBe(201);
    expect((await cabecalho(ped.id)).situacao).toBe("convertido");
  });

  it("FP-4b sem a exigência (formato 4 e o neutro do 5 — a premissa do skew): o aberto recebe como hoje, exigeFinalizar false; o finalizado também recebe", async () => {
    const topDestino = await topNoFormato("compras.compra", cfg4());
    const p = await produto();
    for (const configuracao of [cfg4(), cfg5()]) {
      const topPedido = await topPedidoPara(configuracao, topDestino);
      const aberto = await pedido([itemCompra(p.id, "2", "10.00")], topPedido);
      expect(j(await proximosPassos(aberto.id)).exigeFinalizar, `formato ${configuracao.versaoSchema}`).toBe(false);
      const r = await receber(aberto, topDestino);
      expect(r.statusCode, r.body).toBe(201);
      expect(j(r).pedidoSituacao).toBe("convertido");
      // A trilha do convert do aberto é a de hoje (antes: aberto).
      expect((await trilha(aberto.id, "convert")).map((a) => a.before)).toEqual([{ situacao: "aberto" }]);

      const finalizado = await pedido([itemCompra(p.id, "2", "10.00")], topPedido);
      expect((await finalizar(finalizado.id)).statusCode).toBe(200);
      const rf = await receber(finalizado, topDestino);
      expect(rf.statusCode, rf.body).toBe(201);
      expect(j(rf).pedidoSituacao).toBe("convertido");
    }
  });
});

// ─────────────── FP-5 ───────────────

describe("FP-5 encerrar o saldo e cancelar o pedido finalizado", () => {
  it("FP-5a encerrar o saldo do finalizado (recebido em parte) → convertido com quem/quando; a trilha diz 'finalizado' antes", async () => {
    const topDestino = await topNoFormato("compras.compra", cfg4());
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "5", "10.00")], await topPedidoPara(cfg4(), topDestino, true));
    expect((await finalizar(ped.id)).statusCode).toBe(200);
    expect((await receber(ped, topDestino, ["2"])).statusCode).toBe(201);
    expect((await cabecalho(ped.id)).situacao, "premissa: recebido em parte, continua finalizado").toBe("finalizado");
    const r = await encerrarSaldo(ped.id, "Fornecedor não entrega o resto");
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: ped.id, situacao: "convertido" });
    const db = await cabecalho(ped.id);
    expect([db.situacao, db.saldo_encerrado_em !== null, db.finalizado_por]).toEqual(["convertido", true, c.h.demo.adminUserId]);
    expect((await trilha(ped.id, "encerrar_saldo")).map((a) => [a.metadata, a.before, a.after]))
      .toEqual([[{ motivo: "Fornecedor não entrega o resto", saldo: "3.0000" }, { situacao: "finalizado" }, { situacao: "convertido" }]]);
  });

  it("FP-5b cancelar o finalizado: sem compra viva → cancelado (trilha 'finalizado' antes); com compra viva → 409 de hoje; premissa: cancelada a compra, cancela", async () => {
    const p = await produto();
    const semCompra = await pedido([itemCompra(p.id, "1", "10.00")]);
    expect((await finalizar(semCompra.id)).statusCode).toBe(200);
    const r = await cancelar("pedidos", semCompra.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({ id: semCompra.id, situacao: "cancelado" });
    expect((await cabecalho(semCompra.id)).situacao).toBe("cancelado");
    expect((await trilha(semCompra.id, "cancel")).map((a) => [a.before, a.after])).toEqual([[{ situacao: "finalizado" }, { situacao: "cancelado" }]]);

    const topDestino = await topNoFormato("compras.compra", cfg4());
    const comCompra = await pedido([itemCompra(p.id, "4", "10.00")], await topPedidoPara(cfg4(), topDestino, true));
    expect((await finalizar(comCompra.id)).statusCode).toBe(200);
    const parte = await receber(comCompra, topDestino, ["1"]);
    expect(parte.statusCode).toBe(201);
    const recusado = await cancelar("pedidos", comCompra.id);
    expect(recusado.statusCode, recusado.body).toBe(409);
    expect(erro(recusado)).toEqual({ code: "CONFLICT", message: MSG_PEDIDO_COM_COMPRAS });
    expect((await cabecalho(comCompra.id)).situacao).toBe("finalizado");
    expect((await cancelar("compras", j(parte).id as string)).statusCode).toBe(200);
    expect((await cabecalho(comCompra.id)).situacao, "cancelar a compra parcial não muda o finalizado").toBe("finalizado");
    expect((await cancelar("pedidos", comCompra.id)).statusCode).toBe(200);
    expect((await cabecalho(comCompra.id)).situacao).toBe("cancelado");
  });
});

// ─────────────── FP-6 ───────────────

describe("FP-6 a capacidade e a leitura", () => {
  it("FP-6a operation-types das duas espécies: finalizacaoEOrcamento = 1, a ÚLTIMA chave (as de hoje na mesma ordem)", async () => {
    for (const segmento of ["pedidos", "compras"] as const) {
      const r = await c.ligada.inject({ method: "GET", url: `/api/compras/${segmento}/operation-types`, headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      const capacidades = j(r).capacidades as Record<string, unknown>;
      expect(Object.keys(capacidades), segmento).toEqual(["classificacaoFinanceira", "condicaoPagamento", "layoutDocumento", "regrasDaOperacao", "finalizacaoEOrcamento"]);
      expect(capacidades.finalizacaoEOrcamento).toBe(1);
    }
  });

  it("FP-6b a leitura do pedido: as chaves novas (nulas) e orcamentos: []; a compra sem orcamentos; a lista única só traz orçamento a pedido", async () => {
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "1", "10.00")]);
    const lido = j(await lerCompra("pedido", ped.id));
    for (const chave of ["finalizado_em", "finalizado_por", "finalizado_por_nome", "aprovado_orcamento_em", "aprovado_orcamento_por",
      "aprovado_orcamento_por_nome", "pedido_orcado_id", "pedido_orcado_codigo", "prazo_entrega_dias", "validade_orcamento"]) {
      expect(Object.hasOwn(lido, chave), chave).toBe(true);
      expect(lido[chave], chave).toBeNull();
    }
    expect(lido.orcamentos).toEqual([]);
    expect(Object.hasOwn(lido, "compras_geradas"), "a chave de hoje continua").toBe(true);
    const compra = await compraLancada("compra", corpoCompra([itemCompra(p.id, "1", "10.00")]));
    const lida = j(await lerCompra("compra", compra.id));
    expect([Object.hasOwn(lida, "orcamentos"), Object.hasOwn(lida, "compras_geradas"), Object.hasOwn(lida, "finalizado_em")]).toEqual([false, false, true]);
    // A lista única: o orçamento só entra com o filtro (sem ele, as espécies de hoje); o filtro pedido_orcado_id fora da forma não traz nada.
    const lista = async (q: string) => {
      const r = await c.ligada.inject({ method: "GET", url: `/api/compras/documentos?pageSize=200&${q}`, headers: c.h.headers() });
      expect(r.statusCode, r.body).toBe(200);
      return j(r) as { items: { especie: string }[]; total: number };
    };
    const padrao = await lista("");
    expect(padrao.total, "premissa: há documentos de compra").toBeGreaterThan(0);
    expect(new Set(padrao.items.map((x) => x.especie))).toEqual(new Set(["pedido", "compra"]));
    expect((await lista("especie=orcamento")).total).toBe(0);
    expect((await lista(`pedido_orcado_id=${ped.id}`)).total).toBe(0);
    expect((await lista("pedido_orcado_id=nao-e-uuid")).total).toBe(0);
  });

  /**
   * O orçamento é GRAVADO DIRETO NO BANCO (superusuário, pelos gatilhos da 0044): as rotas dele são do pacote do
   * orçamento. Aqui se prova só o que é deste pacote — a leitura do pedido com os orçamentos, a lista única que só
   * mostra orçamento a pedido e com `orcamentos_compra.view`, o filtro `pedido_orcado_id`, a 404 do orçamento nas
   * portas do pedido e da compra, e o finalizar que não mexe nos orçamentos.
   */
  it("FP-6c com um orçamento do pedido: orcamentos na leitura; a lista única só o mostra a pedido (e com a capacidade); finalizar não o muda", async () => {
    const p = await produto();
    const ped = await pedido([itemCompra(p.id, "3", "10.00")]);
    const aprovado = await c.admin.query("update erp.documentos_compra set aprovado_orcamento_em = now(), aprovado_orcamento_por = $2 where id = $1 and aprovado_orcamento_em is null",
      [ped.id, c.h.demo.adminUserId]);
    expect(aprovado.rowCount, "premissa: o pedido foi aprovado para orçamento").toBe(1);
    const topOrcamento = await topNoFormato("compras.orcamento", cfg4());
    const versao = await versaoAtualNoBanco(topOrcamento);
    const codigo = `F6A${unico()}`;
    const orc = (await c.admin.query<{ id: string }>(
      `insert into erp.documentos_compra (organization_id, empresa_id, especie, codigo, tipo_operacao_id, tipo_operacao_versao_id, fornecedor_id,
          data_documento, valor_itens, valor_total, pedido_orcado_id, prazo_entrega_dias, validade_orcamento, criado_por)
       values ($1, $2, 'orcamento', $3, $4, $5, $6, $7, 28.50, 28.50, $8, 7, '2026-10-10', $9) returning id`,
      [c.h.demo.orgId, c.I.empresa, codigo, topOrcamento, versao.id, c.I.provider, "2026-09-10", ped.id, c.h.demo.adminUserId])).rows[0]!.id;
    await c.admin.query(
      `insert into erp.documentos_compra_itens (organization_id, documento_id, produto_id, quantidade, valor_unitario, valor_total, posicao, item_pedido_orcado_id)
       values ($1, $2, $3, 3, 9.5, 28.50, 0, $4)`, [c.h.demo.orgId, orc, p.id, ped.itens[0]!.id]);
    const fornecedor = (await c.admin.query<{ name: string }>("select name from erp.people where id=$1", [c.I.provider])).rows[0]!.name;

    // A LEITURA DO PEDIDO: o orçamento dele (uma linha), e o nome de quem aprovou para orçamento.
    const lido = j(await lerCompra("pedido", ped.id));
    // OPERACOES-01 F6b: + a condição (nula: o orçamento não tem) e o preço do item, no fim — os valores gravados acima.
    expect(lido.orcamentos).toEqual([{ id: orc, codigo, situacao: "aberto", fornecedor_id: c.I.provider, fornecedor_nome: fornecedor,
      condicao_pagamento_id: null, prazo_entrega_dias: 7, validade_orcamento: "2026-10-10", valor_total: "28.50",
      condicao_pagamento_codigo: null, condicao_pagamento_nome: null,
      itens: [{ item_pedido_orcado_id: ped.itens[0]!.id, valor_unitario: "9.500000", valor_total: "28.50" }] }]);
    expect([lido.aprovado_orcamento_por, lido.aprovado_orcamento_por_nome]).toEqual([c.h.demo.adminUserId, expect.any(String)]);

    // A LISTA ÚNICA: sem o filtro, as espécies de hoje (o orçamento não aparece); com `especie=orcamento`, aparece.
    const lista = async (q: string, headers: Hdr = c.h.headers()) => {
      const r = await c.ligada.inject({ method: "GET", url: `/api/compras/documentos?pageSize=200&${q}`, headers });
      expect(r.statusCode, r.body).toBe(200);
      return j(r) as { items: { id: string; especie: string; especie_rotulo: string }[]; total: number };
    };
    expect((await lista("")).items.map((x) => x.id)).not.toContain(orc);
    expect((await lista(`pedido_orcado_id=${ped.id}`)).total, "o filtro sozinho não traz a espécie que o padrão não traz").toBe(0);
    const pedida = await lista(`especie=orcamento&pedido_orcado_id=${ped.id}`);
    expect(pedida.items.map((x) => [x.id, x.especie, x.especie_rotulo])).toEqual([[orc, "orcamento", "Orçamento de compra"]]);
    // Sem `orcamentos_compra.view`, o pedido do filtro não alarga nada (a lista é a das espécies que ele lê).
    const semOrcamento = await usuario("Comprador sem orçamento F6a", ["compras.view", "pedidos_compra.view"]);
    expect((await lista(`especie=orcamento&pedido_orcado_id=${ped.id}`, semOrcamento)).total).toBe(0);
    const comOrcamento = await usuario("Comprador com orçamento F6a", ["orcamentos_compra.view"]);
    expect((await lista(`especie=orcamento&pedido_orcado_id=${ped.id}`, comOrcamento)).items.map((x) => x.id)).toEqual([orc]);

    // As portas do pedido e da compra não leem o orçamento: a MESMA 404 do GET.
    const ref = await get404();
    for (const especie of ["pedido", "compra"] as const) {
      const r = await lerCompra(especie, orc);
      expect(r.statusCode, especie).toBe(404);
      expect(erro(r)).toEqual(ref);
    }

    // Finalizar o pedido não mexe no orçamento aberto (sem cascata).
    expect((await finalizar(ped.id)).statusCode).toBe(200);
    expect(await situacaoNoBanco("documentos_compra", orc)).toBe("aberto");
    expect((j(await lerCompra("pedido", ped.id)).orcamentos as { situacao: string }[]).map((o) => o.situacao)).toEqual(["aberto"]);
  });
});
