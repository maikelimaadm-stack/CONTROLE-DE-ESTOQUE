import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { seedDemo } from "@agro/db";
import {
  configuracaoNeutraTop, configuracaoNeutraTopV2, exigeAprovacao, regrasGeraisDaVersaoTop,
  type ConfiguracaoTipoOperacaoV3, type ConfiguracaoTipoOperacaoV4, type EspecieEstoque,
} from "@agro/domain";
import { fromPgError } from "../../src/lib/errors.js";
import {
  c, iniciar, encerrar, j, erro, unico, cfg3, cfg4, top, usuario, escopos, produto, produtoComSaldo, DATA,
  itemVenda, corpoVenda, vendaLancada, lancarVenda, patchVenda, confirmarVenda, previaVenda, lerVenda, versaoDaVenda,
  itemCompra, corpoCompra, compraLancada, confirmarCompra, estoqueLancado, confirmarEstoque, seg,
  aprovar, reprovar, fila, situacaoNoBanco, movimentosDe, titulosDe, auditoriaDe, decisoesDe, emParaleloComBarreira,
  type Hdr, type Resposta, type Erro, type Produto,
} from "./top-config-08-ajuda.js";

/**
 * TOP-CONFIG-08 (decisão 277) — A APROVAÇÃO DO DOCUMENTO (SPEC §5; casos AP-1..AP-6 e AP-8..AP-12).
 *
 * O ciclo inteiro é medido na VENDA, que é o caso mais rico (a decisão vale para a VERSÃO do documento, 0039). Compra
 * e estoque têm o mesmo ciclo nos arquivos deles (AP-7); aqui eles entram na FILA (AP-9) e na GUARDA DO BANCO (AP-12),
 * que são as três.
 *
 *   · AP-1  Sempre: o /confirm recusa com 409 APROVACAO_PENDENTE e os details; a prévia lista a MESMA recusa;
 *   · AP-2  "A partir de um valor" 1500.00: o total (não o preço) 1500.00 exige; 1499.99 não — confirma direto;
 *   · AP-3  aprovar com `sales.approve` libera o /confirm; sem a capacidade → 403; fora do escopo, inexistente, de
 *           outra organização, de outra variante, excluída e id malformado → a MESMA 404, com o mesmo corpo — e a 404
 *           vem ANTES do 409 de versão;
 *   · AP-4  a versão: aprovar com a velha → 409; alterar depois de aprovada → pendente de novo; reprovada em V e
 *           alterada para V+1 → pendente; o total que desce abaixo do limite deixa de exigir;
 *   · AP-5  reprovar exige motivo (422); confirmar reprovada → 409 APROVACAO_REPROVADA com o motivo e quem decidiu;
 *           aprovada depois → passa, e a história fica;
 *   · AP-6  Automática + aprovação: salvar → aberto, "aguardando_aprovacao"; aprovar → confirma no MESMO pedido;
 *           o aprovador sem `sales.edit` → aprovado e aberto, "sem_permissao";
 *   · AP-8  documento que não exige → 409 APROVACAO_NAO_EXIGIDA; confirmado ou cancelado → 409 CONFLICT;
 *   · AP-9  a FILA das três: só pendentes e reprovados do escopo de quem aprova; sai ao ser aprovado, cancelado ou
 *           confirmado; número FIXO de consultas (CONTADO, página de 1 e de 5); o ID Global;
 *   · AP-10 CONCORRÊNCIA COM BARREIRA (o molde do ESTOQUE-01): duas decisões, decisão × PATCH, decisão × /confirm;
 *   · AP-11 PARIDADE: `exigeAprovacao` (domínio) × `erp.top_exige_aprovacao` (banco) numa tabela de casos, com o
 *           resultado esperado ESCRITO À MÃO ao lado (nenhum dos dois lados se aprova sozinho);
 *   · AP-12 a GUARDA DO BANCO: UPDATE direto para confirmado sem aprovação, pela conexão da APLICAÇÃO (erp_app, com a
 *           RLS e a GUC), na venda, na compra e no estoque → CONFLICT, que o `fromPgError` traduz em 409 sem details;
 *           formato 1 a 3 nunca é barrado.
 *
 * O QUE CONTA COMO PROVA (o molde do ajudante): a situação do documento, os movimentos, os títulos, as DECISÕES
 * (`erp.aprovacoes_*`) e a trilha são LIDOS NO BANCO por conexão de superusuário, sem RLS. Toda asserção de "zero
 * efeito" tem a PREMISSA ao lado: o mesmo documento, aprovado (ou o mesmo pedido, por quem pode), produz o efeito.
 * As mensagens são as da SPEC, ESCRITAS AQUI — uma constante errada no domínio não se aprova sozinha.
 */
beforeAll(iniciar, 240_000);
afterAll(encerrar);

// ─────────────── os textos da SPEC §5, escritos à mão ───────────────

const MSG = {
  pendente: "Este documento precisa de aprovação antes de ser confirmado.",
  reprovado: (motivo: string) => `Este documento foi reprovado: ${motivo}.`,
  naoExigida: "Este documento não precisa de aprovação.",
  soAberto: "Só documento aberto passa por aprovação.",
  /** O 409 de versão do PATCH (EDITAR-01), o mesmo das decisões da venda. */
  mudou: "Este documento mudou desde que você o abriu. Recarregue antes de salvar.",
  /** As mensagens FIXAS da guarda do banco (0041, seção 6) — sem motivo livre. */
  guardaPendente: "Este documento precisa de aprovação antes de ser confirmado.",
  guardaReprovado: "Este documento foi reprovado e não pode ser confirmado.",
  /** O que o `fromPgError` dá para o 40P01/40001 — se aparecer, houve deadlock (ou serialização) na barreira. */
  deadlock: "Conflito de concorrência, tente novamente",
} as const;

// ─────────────── configurações das TOPs ───────────────

type Cfg = ConfiguracaoTipoOperacaoV3 | ConfiguracaoTipoOperacaoV4;
const sempre = (x: Cfg) => { x.aprovacao.politica = "sempre"; x.aprovacao.valorMinimo = null; };
const porValor = (valorMinimo: string) => (x: Cfg) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = valorMinimo; };
const automatica = (x: Cfg) => { x.geral.confirmacao = "automatica"; };

/** TOPs de VENDA, cada caso a sua (nenhum caso lê o estado de outro). */
const topVendaSempre = () => top("vendas.venda", { configuracao: cfg4(sempre) });
const topVendaPorValor = (v: string) => top("vendas.venda", { configuracao: cfg4(porValor(v)) });

// ─────────────── a venda do caso ───────────────

interface Venda { id: string; produto: Produto }
/**
 * Uma venda NOVA da 1ª empresa, com a TOP dada (ou sem TOP), 1 item de um produto NOVO com saldo 10 no ALM. O total
 * é quantidade × preço (sem frete nem desconto): a regra mede o TOTAL do documento.
 */
async function venda(topId: string | null, preco = "100.00", quantidade = "1", headers?: Hdr): Promise<Venda> {
  const p = await produtoComSaldo("10");
  const v = await vendaLancada(corpoVenda([itemVenda(p.id, quantidade, preco)], topId ? { tipo_operacao_id: topId } : {}), headers);
  return { id: v.id, produto: p };
}
/** Uma venda da 2ª EMPRESA (armazém dela; sem saldo — ela só precisa existir e entrar ou não na fila). */
async function vendaDaEmpresa2(topId: string): Promise<string> {
  const p = await produto();
  return (await vendaLancada(corpoVenda([itemVenda(p.id, "1", "100.00", { warehouse_id: c.I.warehouseEmpresa2 })],
    { empresa_id: c.I.empresa2, tipo_operacao_id: topId }))).id;
}
/** A `version` que a PESSOA vê: a do GET do documento (é ela que a tela manda de volta). */
async function versaoVista(id: string, headers: Hdr = c.h.headers()): Promise<string> {
  const r = await lerVenda(id, headers);
  expect(r.statusCode, r.body).toBe(200);
  return j(r).version as string;
}
const cancelarVenda = (id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/sales/sales/${id}/cancel`, headers: c.h.headers(), payload: {} });
const cancelarCompra = (id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/compras/compras/${id}/cancel`, headers: c.h.headers(), payload: {} });
const cancelarEstoque = (especie: EspecieEstoque, id: string): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: `/api/estoque/${seg(especie)}/${id}/cancelar`, headers: c.h.headers(), payload: {} });

/** O resumo dos efeitos da confirmação da venda, pelo banco: situação, movimentos e títulos. */
async function efeitosDaVenda(id: string) {
  return {
    status: await situacaoNoBanco("sales_documents", id),
    movimentos: (await movimentosDe("sales_documents", id)).map((m) => [m.movement_type, m.direction, Number(m.quantity)]),
    titulos: (await titulosDe("sales_documents", id)).map((t) => [t.direction, t.amount]),
  };
}
const SEM_EFEITO = { status: "open", movimentos: [], titulos: [] };

/** Um membro com nome ÚNICO, e o id dele (lido no banco pelo nome) — para conferir o `decididoPor`. */
async function pessoa(rotulo: string, perms: string[], escopo = escopos()): Promise<{ headers: Hdr; id: string; nome: string }> {
  const nome = `${rotulo} ${unico()}`;
  const headers = await usuario(nome, perms, escopo);
  const r = await c.admin.query<{ id: string }>("select id from erp.users where name = $1", [nome]);
  expect(r.rows, "premissa: o membro existe, com nome único").toHaveLength(1);
  return { headers, id: r.rows[0]!.id, nome };
}
/** O nome do administrador do harness (quem decide quando o caso não diz outro). */
async function nomeDoAdmin(): Promise<string> {
  return (await c.admin.query<{ name: string }>("select name from erp.users where id=$1", [c.h.demo.adminUserId])).rows[0]!.name;
}

// ─────────────── AP-1 ───────────────

describe("AP-1 — venda Sempre: o /confirm recusa com APROVACAO_PENDENTE, e a prévia mostra a MESMA recusa", () => {
  it("AP-1 409 com a mensagem e os details { politica, valorMinimo, valorDocumento }; prévia podeConfirmar false; nada de efeito — aprovada, confirma", async () => {
    const topId = await topVendaSempre();
    const v = await venda(topId, "750.00", "2");

    const r = await confirmarVenda(v.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG.pendente, details: { politica: "sempre", valorMinimo: null, valorDocumento: "1500.00" } });
    expect(await efeitosDaVenda(v.id), "o passo da aprovação vem antes de qualquer efeito").toEqual(SEM_EFEITO);
    expect(await auditoriaDe("sales_documents", v.id, "confirm")).toEqual([]);

    // A prévia: a recusa entra na lista, no MESMO formato do corpo do /confirm, e é a única.
    const p = await previaVenda(v.id);
    expect(p.statusCode, p.body).toBe(200);
    expect(j(p)).toMatchObject({ podeConfirmar: false, recusas: [erro(r)] });
    expect((j(p).recusas as unknown[])).toHaveLength(1);
    expect(await efeitosDaVenda(v.id), "a prévia não confirma nada").toEqual(SEM_EFEITO);

    // PREMISSA: o MESMO documento, aprovado, confirma com os efeitos — a recusa era só a aprovação.
    const a = await aprovar("vendas", v.id, { version: await versaoVista(v.id) });
    expect(a.statusCode, a.body).toBe(200);
    expect(j(await previaVenda(v.id))).toMatchObject({ podeConfirmar: true, recusas: [] });
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await efeitosDaVenda(v.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 2]], titulos: [["receivable", "1500.00"]] });
  });
});

// ─────────────── AP-2 ───────────────

describe("AP-2 — A partir de um valor (1500.00): o TOTAL igual exige; um centavo abaixo não", () => {
  it("AP-2 3 × 500.00 = 1500.00 e 1500.01 → 409 com os details; 1499.99 → confirma direto, sem decisão nenhuma", async () => {
    const topId = await topVendaPorValor("1500.00");
    const igual = await venda(topId, "500.00", "3");
    const acima = await venda(topId, "1500.01");
    const abaixo = await venda(topId, "1499.99");

    for (const [v, total] of [[igual, "1500.00"], [acima, "1500.01"]] as const) {
      const r = await confirmarVenda(v.id);
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG.pendente, details: { politica: "por_valor", valorMinimo: "1500.00", valorDocumento: total } });
      expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
    }

    const r = await confirmarVenda(abaixo.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(await efeitosDaVenda(abaixo.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 1]], titulos: [["receivable", "1499.99"]] });
    expect(await decisoesDe("aprovacoes_venda", abaixo.id), "abaixo do limite não precisa de decisão").toEqual([]);
  });
});

// ─────────────── AP-3 ───────────────

describe("AP-3 — quem aprova: a capacidade (403) e a superfície de recusa (a MESMA 404)", () => {
  it("AP-3a aprovar com sales.approve libera o /confirm: a decisão é gravada com o que o gatilho atribui, e a auditoria no documento", async () => {
    const topId = await topVendaSempre();
    const v = await venda(topId, "200.00");
    const versao = await versaoVista(v.id);
    expect(versao, "a versão do GET é a do banco").toBe(await versaoDaVenda(v.id));

    const a = await aprovar("vendas", v.id, { version: versao, observacao: "  Conferido com o cliente  " });
    expect(a.statusCode, a.body).toBe(200);
    expect(j(a)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) } });

    const versaoTop = (await c.admin.query<{ v: string }>("select tipo_operacao_versao_id v from erp.sales_documents where id=$1", [v.id])).rows[0]!.v;
    const ds = await decisoesDe("aprovacoes_venda", v.id);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ decisao: "aprovado", observacao: "Conferido com o cliente", decidido_por: c.h.demo.adminUserId, empresa_id: c.I.empresa,
      tipo_operacao_id: topId, tipo_operacao_versao_id: versaoTop, versao_documento: versao, valor_documento: "200.00" });
    expect(new Date(ds[0]!.decidido_em).toISOString(), "o decididoEm da resposta é o gravado").toBe((j(a).aprovacao as { decididoEm: string }).decididoEm);
    const trilha = await auditoriaDe("sales_documents", v.id, "approve");
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({ user_id: c.h.demo.adminUserId, metadata: { observacao: "Conferido com o cliente", versao } });
    expect(await versaoDaVenda(v.id), "aprovar não mexe na versão do documento").toBe(versao);

    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await efeitosDaVenda(v.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 1]], titulos: [["receivable", "200.00"]] });
  });

  it("AP-3b sem sales.approve → 403 no aprovar, no reprovar e na fila; nada gravado — quem tem, aprova", async () => {
    const topId = await topVendaSempre();
    const v = await venda(topId);
    const versao = await versaoVista(v.id);
    const semAprovar = await usuario("Vendedor sem aprovar", ["sales.view", "sales.create", "sales.edit"]);

    for (const r of [await aprovar("vendas", v.id, { version: versao }, semAprovar), await reprovar("vendas", v.id, { version: versao, motivo: "x" }, semAprovar),
      await fila("vendas", semAprovar)]) {
      expect(r.statusCode, r.body).toBe(403);
      expect(erro(r).code).toBe("PERMISSION_DENIED");
    }
    expect(await decisoesDe("aprovacoes_venda", v.id)).toEqual([]);
    expect(await auditoriaDe("sales_documents", v.id, "approve")).toEqual([]);

    const aprovador = await usuario("Aprovador", ["sales.view", "sales.approve"]);
    const ok = await aprovar("vendas", v.id, { version: versao }, aprovador);
    expect(ok.statusCode, `premissa: com a capacidade, a mesma decisão passa — ${ok.body}`).toBe(200);
    expect(await decisoesDe("aprovacoes_venda", v.id)).toHaveLength(1);
  });

  it("AP-3c fora do escopo, inexistente, outra organização, outra variante, excluída e id malformado → a MESMA 404 (corpo idêntico ao do GET), ANTES do 409 de versão", async () => {
    const topId = await topVendaSempre();
    const v = await venda(topId);
    const versao = await versaoVista(v.id);
    const doEscopo2 = await usuario("Aprovador da empresa 2", ["sales.view", "sales.approve"], escopos({ vendas: [c.I.empresa2] }));

    // A 404 de referência: o GET por id de um documento que não existe.
    const naoExiste = randomUUID();
    const referencia = await lerVenda(naoExiste);
    expect(referencia.statusCode, referencia.body).toBe(404);
    expect(erro(referencia)).toEqual({ code: "NOT_FOUND", message: "Documento não encontrado" });

    // Outra organização: uma venda REAL, de TOP Sempre, de outra organização (a dona a aprova no fim).
    const outra = await vendaDeOutraOrganizacao();
    // Outra variante: um orçamento desta organização (o id existe, a rota de vendas não o serve).
    const orcamento = (j(await c.ligada.inject({ method: "POST", url: "/api/sales/budgets", headers: c.h.headers(),
      payload: corpoVenda([itemVenda(v.produto.id, "1", "10.00")]) })) as { id: string }).id;
    expect(orcamento, "premissa: o orçamento existe").toEqual(expect.any(String));
    // Excluída: uma venda Sempre com deleted_at.
    const excluida = await venda(topId);
    const versaoExcluida = await versaoDaVenda(excluida.id);
    await c.admin.query("update erp.sales_documents set deleted_at = now() where id=$1", [excluida.id]);

    const casos: { nome: string; id: string; version: string; headers?: Hdr }[] = [
      { nome: "fora do escopo de empresa (versão certa)", id: v.id, version: versao, headers: doEscopo2 },
      { nome: "fora do escopo de empresa (versão VELHA: a 404 vem antes do 409)", id: v.id, version: "999999", headers: doEscopo2 },
      { nome: "inexistente", id: naoExiste, version: "0" },
      { nome: "outra organização (versão certa)", id: outra.id, version: outra.version },
      { nome: "outra organização (versão VELHA)", id: outra.id, version: "999999" },
      { nome: "outra variante (orçamento)", id: orcamento, version: "0" },
      { nome: "excluída", id: excluida.id, version: versaoExcluida },
      { nome: "id malformado", id: "nao-e-uuid", version: "0" },
      { nome: "id malformado (quase uuid)", id: `${naoExiste.slice(0, -1)}x`, version: "0" },
    ];
    for (const caso of casos) {
      for (const r of [await aprovar("vendas", caso.id, { version: caso.version }, caso.headers),
        await reprovar("vendas", caso.id, { version: caso.version, motivo: "Fora da política" }, caso.headers)]) {
        expect([caso.nome, r.statusCode, r.body]).toEqual([caso.nome, 404, referencia.body]);
      }
    }
    for (const id of [v.id, outra.id, orcamento, excluida.id]) expect(await decisoesDe("aprovacoes_venda", id), id).toEqual([]);

    // PREMISSAS: cada documento invisível ERA aprovável por quem o enxerga — a 404 é só visibilidade.
    const daEmpresa2 = await vendaDaEmpresa2(topId);
    const e2 = await aprovar("vendas", daEmpresa2, { version: await versaoVista(daEmpresa2, doEscopo2) }, doEscopo2);
    expect(e2.statusCode, `premissa: o aprovador da empresa 2 aprova a venda da empresa 2 — ${e2.body}`).toBe(200);
    const o = await aprovar("vendas", outra.id, { version: outra.version }, outra.headers);
    expect(o.statusCode, `premissa: a dona da outra organização aprova a venda dela — ${o.body}`).toBe(200);
    const a = await aprovar("vendas", v.id, { version: versao });
    expect(a.statusCode, `premissa: quem enxerga a venda a aprova — ${a.body}`).toBe(200);
  });
});

/** Uma venda REAL de outra organização (seed demo próprio, admin próprio), com TOP formato 4 Sempre, aberta. */
async function vendaDeOutraOrganizacao(): Promise<{ id: string; version: string; headers: Hdr }> {
  const s = unico();
  const b = await seedDemo(c.admin, { orgName: `[TEST] Outra TC08 ${s}`, adminEmail: `outra-tc08-${s}@demo.local`, adminPassword: "Demo@12345", slug: `outra-tc08-${s}` }, () => {});
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: b.adminEmail, password: b.adminPassword } });
  expect(login.statusCode, login.body).toBe(200);
  const headers = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": b.orgId };
  const um = async (sql: string, params: unknown[]) => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;
  const empresa = b.empresaIds[0]!;
  const cliente = await um("select id from erp.people where organization_id=$1 and is_client order by code limit 1", [b.orgId]);
  const prod = await um("select id from erp.products where organization_id=$1 and description like 'Ração%' limit 1", [b.orgId]);
  const armazem = await um("select id from erp.warehouses where organization_id=$1 and empresa_id=$2 and initials='ALM'", [b.orgId, empresa]);
  const topB = await top("vendas.venda", { configuracao: cfg4(sempre) }, headers);
  const v = await vendaLancada({ empresa_id: empresa, document_date: DATA, client_id: cliente, tipo_operacao_id: topB,
    items: [{ product_id: prod, warehouse_id: armazem, quantity: "1", unit_price: "10.00" }] }, headers);
  return { id: v.id, version: await versaoDaVenda(v.id), headers };
}

// ─────────────── AP-4 ───────────────

describe("AP-4 — a decisão vale para a VERSÃO da venda", () => {
  it("AP-4a aprovar com a version VELHA → 409 CONCURRENCY_CONFLICT, nada gravado; com a atual → 200", async () => {
    const v = await venda(await topVendaSempre());
    const velha = await versaoVista(v.id);
    const p = await patchVenda(v.id, { version: velha, note: "mudou" });
    expect(p.statusCode, p.body).toBe(200);
    const atual = await versaoVista(v.id);
    expect(BigInt(atual), "premissa: o PATCH subiu a versão").toBeGreaterThan(BigInt(velha));

    for (const r of [await aprovar("vendas", v.id, { version: velha }), await reprovar("vendas", v.id, { version: velha, motivo: "x" })]) {
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toEqual({ code: "CONCURRENCY_CONFLICT", message: MSG.mudou });
    }
    expect(await decisoesDe("aprovacoes_venda", v.id)).toEqual([]);
    const ok = await aprovar("vendas", v.id, { version: atual });
    expect(ok.statusCode, `premissa: com a versão atual, a decisão passa — ${ok.body}`).toBe(200);
    expect((await decisoesDe("aprovacoes_venda", v.id)).map((d) => d.versao_documento)).toEqual([atual]);
  });

  it("AP-4b alterar DEPOIS de aprovada → pendente de novo (o /confirm recusa); aprovar a versão nova → confirma", async () => {
    const v = await venda(await topVendaSempre());
    const v1 = await versaoVista(v.id);
    expect((await aprovar("vendas", v.id, { version: v1 })).statusCode).toBe(200);
    expect(j(await previaVenda(v.id)), "premissa: aprovada, a prévia libera").toMatchObject({ podeConfirmar: true });

    expect((await patchVenda(v.id, { version: v1, note: "depois da aprovação" })).statusCode).toBe(200);
    const v2 = await versaoVista(v.id);
    const r = await confirmarVenda(v.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toMatchObject({ code: "APROVACAO_PENDENTE", message: MSG.pendente });
    expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
    // A decisão de antes continua lá (só inserção), mas é de OUTRA versão: não vale.
    expect((await decisoesDe("aprovacoes_venda", v.id)).map((d) => [d.decisao, d.versao_documento])).toEqual([["aprovado", v1]]);

    expect((await aprovar("vendas", v.id, { version: v2 })).statusCode).toBe(200);
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await efeitosDaVenda(v.id)).status).toBe("confirmed");
  });

  it("AP-4c reprovada na versão V e alterada para V+1 → PENDENTE (não reprovada)", async () => {
    const v = await venda(await topVendaSempre());
    const vV = await versaoVista(v.id);
    expect((await reprovar("vendas", v.id, { version: vV, motivo: "Cliente sem limite" })).statusCode).toBe(200);
    expect(erro(await confirmarVenda(v.id)).code, "premissa: na versão V ela está reprovada").toBe("APROVACAO_REPROVADA");

    expect((await patchVenda(v.id, { version: vV, note: "ajustado" })).statusCode).toBe(200);
    const r = await confirmarVenda(v.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "APROVACAO_PENDENTE", message: MSG.pendente, details: { politica: "sempre", valorMinimo: null, valorDocumento: "100.00" } });
  });

  it("AP-4d o total desce abaixo do limite pelo PATCH → não exige mais: o /confirm passa e aprovar responde APROVACAO_NAO_EXIGIDA", async () => {
    const v = await venda(await topVendaPorValor("1500.00"), "1500.00");
    expect(erro(await confirmarVenda(v.id)).code, "premissa: com 1500.00 exige").toBe("APROVACAO_PENDENTE");

    expect((await patchVenda(v.id, { version: await versaoVista(v.id), discount: "0.01" })).statusCode).toBe(200);
    expect((await c.admin.query<{ t: string }>("select total::text t from erp.sales_documents where id=$1", [v.id])).rows[0]!.t, "premissa: o total desceu").toBe("1499.99");
    const a = await aprovar("vendas", v.id, { version: await versaoVista(v.id) });
    expect(a.statusCode, a.body).toBe(409);
    expect(erro(a)).toEqual({ code: "APROVACAO_NAO_EXIGIDA", message: MSG.naoExigida });
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await efeitosDaVenda(v.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 1]], titulos: [["receivable", "1499.99"]] });
    expect(await decisoesDe("aprovacoes_venda", v.id)).toEqual([]);
  });
});

// ─────────────── AP-5 ───────────────

describe("AP-5 — reprovar: o motivo é obrigatório, a recusa o explica, e a aprovação depois libera", () => {
  it("AP-5 sem motivo → 422; reprovada → 409 APROVACAO_REPROVADA com motivo, quem e quando; aprovada depois → passa, e a história fica", async () => {
    const v = await venda(await topVendaSempre());
    const versao = await versaoVista(v.id);
    const quem = await pessoa("Aprovadora", ["sales.view", "sales.approve"]);

    for (const corpo of [{ version: versao }, { version: versao, motivo: "" }, { version: versao, motivo: "   " }, { version: versao, motivo: "x".repeat(501) },
      { version: versao, motivo: "ok", observacao: "chave de outra ação" }, { motivo: "sem versão" }]) {
      const r = await reprovar("vendas", v.id, corpo, quem.headers);
      expect([JSON.stringify(corpo).slice(0, 60), r.statusCode]).toEqual([JSON.stringify(corpo).slice(0, 60), 422]);
      expect(erro(r).code).toBe("VALIDATION_ERROR");
    }
    expect(await decisoesDe("aprovacoes_venda", v.id), "nenhum 422 gravou decisão").toEqual([]);

    const motivo = "Preço abaixo da tabela";
    const rep = await reprovar("vendas", v.id, { version: versao, motivo: `  ${motivo} ` }, quem.headers);
    expect(rep.statusCode, rep.body).toBe(200);
    expect(j(rep)).toEqual({ aprovacao: { decisao: "reprovado", decididoEm: expect.any(String) } });
    const decididoEm = (j(rep).aprovacao as { decididoEm: string }).decididoEm;

    const r = await confirmarVenda(v.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r)).toEqual({ code: "APROVACAO_REPROVADA", message: MSG.reprovado(motivo),
      details: { motivo, decididoPor: { id: quem.id, nome: quem.nome }, decididoEm } });
    expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
    expect(j(await previaVenda(v.id))).toMatchObject({ podeConfirmar: false, recusas: [erro(r)] });
    expect((await auditoriaDe("sales_documents", v.id, "reject")).map((a) => a.metadata)).toEqual([{ motivo, versao }]);

    const ap = await aprovar("vendas", v.id, { version: versao }, quem.headers);
    expect(ap.statusCode, ap.body).toBe(200);
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await efeitosDaVenda(v.id)).status).toBe("confirmed");
    expect((await decisoesDe("aprovacoes_venda", v.id)).map((d) => [d.decisao, d.observacao, d.versao_documento, d.decidido_por]),
      "só inserção: a reprovação continua na história").toEqual([["reprovado", motivo, versao, quem.id], ["aprovado", null, versao, quem.id]]);
  });
});

// ─────────────── AP-6 ───────────────

describe("AP-6 — Confirmação Automática + aprovação", () => {
  const cfgAutoSempre = () => cfg4((x) => { automatica(x); sempre(x); });

  it("AP-6a salvar → aberto, 'aguardando_aprovacao'; aprovar → confirma no MESMO pedido, pelo aprovador; o replay não confirma de novo", async () => {
    const topId = await top("vendas.venda", { configuracao: cfgAutoSempre() });
    const p = await produtoComSaldo("10");
    const r = await lancarVenda(corpoVenda([itemVenda(p.id, "2", "50.00")], { tipo_operacao_id: topId }));
    expect(r.statusCode, r.body).toBe(201);
    const id = (j(r) as { id: string }).id;
    expect(j(r).confirmacaoAutomatica).toEqual({ confirmado: false, motivo: "aguardando_aprovacao" });
    expect(await efeitosDaVenda(id), "salvo e aberto, sem efeito").toEqual(SEM_EFEITO);

    const versao = await versaoVista(id);
    const a = await aprovar("vendas", id, { version: versao }, c.h.headers(), `ap6-${unico()}`);
    expect(a.statusCode, a.body).toBe(200);
    expect(j(a)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) }, confirmacaoAutomatica: { confirmado: true } });
    expect(await efeitosDaVenda(id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 2]], titulos: [["receivable", "100.00"]] });
    expect((await decisoesDe("aprovacoes_venda", id)).map((d) => [d.decisao, d.versao_documento]), "a decisão é da versão que o aprovador viu").toEqual([["aprovado", versao]]);
    const confirm = await auditoriaDe("sales_documents", id, "confirm");
    expect(confirm).toHaveLength(1);
    expect(confirm[0]).toMatchObject({ user_id: c.h.demo.adminUserId, metadata: { automatica: true } });
    // A trilha na ordem do caminho: a decisão, e depois a confirmação.
    expect((await auditoriaDe("sales_documents", id)).map((x) => x.action).filter((x) => x === "approve" || x === "confirm")).toEqual(["approve", "confirm"]);

    // O replay da MESMA chave devolve o corpo gravado e não decide nem confirma de novo.
    const chave = `ap6r-${unico()}`;
    const v2 = await venda(topId);
    const pv = await versaoVista(v2.id);
    const um = await aprovar("vendas", v2.id, { version: pv }, c.h.headers(), chave);
    const dois = await aprovar("vendas", v2.id, { version: pv }, c.h.headers(), chave);
    expect([um.statusCode, dois.statusCode]).toEqual([200, 200]);
    expect(dois.body, "o replay é o corpo gravado").toBe(um.body);
    expect(await decisoesDe("aprovacoes_venda", v2.id)).toHaveLength(1);
    expect(await auditoriaDe("sales_documents", v2.id, "confirm")).toHaveLength(1);
    expect((await movimentosDe("sales_documents", v2.id))).toHaveLength(1);
  });

  it("AP-6b o aprovador SEM sales.edit → aprovado e aberto, 'sem_permissao' — a TOP não dá poder; quem tem a capacidade confirma depois", async () => {
    const topId = await top("vendas.venda", { configuracao: cfgAutoSempre() });
    const v = await venda(topId);
    const soAprova = await usuario("Só aprova", ["sales.view", "sales.approve"]);
    const a = await aprovar("vendas", v.id, { version: await versaoVista(v.id) }, soAprova);
    expect(a.statusCode, a.body).toBe(200);
    expect(j(a)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) }, confirmacaoAutomatica: { confirmado: false, motivo: "sem_permissao" } });
    expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
    expect((await decisoesDe("aprovacoes_venda", v.id)).map((d) => d.decisao)).toEqual(["aprovado"]);
    expect(await auditoriaDe("sales_documents", v.id, "confirm")).toEqual([]);

    // PREMISSA: a aprovação vale; faltava só a capacidade de confirmar. Quem a tem confirma pelo /confirm.
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await efeitosDaVenda(v.id)).status).toBe("confirmed");
  });

  it("AP-6c TOP Manual + aprovação: a resposta do aprovar NÃO tem a chave confirmacaoAutomatica, e o documento fica aberto", async () => {
    const v = await venda(await topVendaSempre());
    const a = await aprovar("vendas", v.id, { version: await versaoVista(v.id) });
    expect(a.statusCode, a.body).toBe(200);
    expect(j(a)).toEqual({ aprovacao: { decisao: "aprovado", decididoEm: expect.any(String) } });
    expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
  });
});

// ─────────────── AP-8 ───────────────

describe("AP-8 — o que não passa por aprovação", () => {
  it("AP-8a não exige (formato 4 Sem aprovação, formato 3 com Sempre — o corte —, sem TOP) → 409 APROVACAO_NAO_EXIGIDA; o /confirm passa direto", async () => {
    const casos = [
      { nome: "formato 4, Sem aprovação", topId: await top("vendas.venda", { configuracao: cfg4() }) },
      { nome: "formato 3 com Sempre gravado (não executa)", topId: await top("vendas.venda", { configuracao: cfg3(sempre) }) },
      { nome: "sem TOP", topId: null },
    ];
    for (const caso of casos) {
      const v = await venda(caso.topId);
      const versao = await versaoDaVenda(v.id);
      for (const r of [await aprovar("vendas", v.id, { version: versao }), await reprovar("vendas", v.id, { version: versao, motivo: "x" })]) {
        expect([caso.nome, r.statusCode]).toEqual([caso.nome, 409]);
        expect(erro(r)).toEqual({ code: "APROVACAO_NAO_EXIGIDA", message: MSG.naoExigida });
      }
      expect(await decisoesDe("aprovacoes_venda", v.id)).toEqual([]);
      const ok = await confirmarVenda(v.id);
      expect([caso.nome, ok.statusCode, ok.body]).toEqual([caso.nome, 200, ok.body]);
      expect((await efeitosDaVenda(v.id)).status).toBe("confirmed");
    }
  });

  it("AP-8b confirmado ou cancelado → 409 CONFLICT 'Só documento aberto passa por aprovação.' (com a versão ATUAL: é a situação que recusa)", async () => {
    const topId = await topVendaSempre();
    const confirmada = await venda(topId);
    expect((await aprovar("vendas", confirmada.id, { version: await versaoVista(confirmada.id) })).statusCode).toBe(200);
    expect((await confirmarVenda(confirmada.id)).statusCode).toBe(200);
    const cancelada = await venda(topId);
    const cx = await cancelarVenda(cancelada.id);
    expect(cx.statusCode, cx.body).toBe(200);
    expect(await situacaoNoBanco("sales_documents", cancelada.id)).toBe("cancelled");

    for (const v of [confirmada, cancelada]) {
      const versao = await versaoVista(v.id);
      const antes = await decisoesDe("aprovacoes_venda", v.id);
      for (const r of [await aprovar("vendas", v.id, { version: versao }), await reprovar("vendas", v.id, { version: versao, motivo: "x" })]) {
        expect(r.statusCode, r.body).toBe(409);
        expect(erro(r)).toEqual({ code: "CONFLICT", message: MSG.soAberto });
      }
      expect(await decisoesDe("aprovacoes_venda", v.id), "nenhuma decisão nova").toEqual(antes);
    }
  });
});

// ─────────────── AP-9 ───────────────

type LinhaFila = {
  id: string; codigo: string; especie: string; data: string; empresa: { id: string; nome: string }; parceiro: { id: string; nome: string } | null;
  operacao: { id: string; nome: string }; valor: string | null; lancadoPor: { id: string; nome: string } | null; situacao: "pendente" | "reprovado";
  ultimaDecisao: { decisao: string; observacao: string | null; decididoPor: { id: string; nome: string }; decididoEm: string } | null;
  version?: string; id_global: number | null;
};
type Fila = { items: LinhaFila[]; total: number; page: number; pageSize: number; idGlobal: { tipoEntidade: string; rotulo: string } };
type ModuloFila = "vendas" | "compras" | "estoque";

/** A fila INTEIRA de quem pergunta (página de 1000): a premissa é que nada ficou de fora da página. */
async function filaToda(modulo: ModuloFila, headers: Hdr = c.h.headers()): Promise<Fila> {
  const r = await fila(modulo, headers, { pageSize: 1000 });
  expect(r.statusCode, r.body).toBe(200);
  const f = j(r) as unknown as Fila;
  expect(f.items.length, "premissa: a página de 1000 traz a fila inteira").toBe(f.total);
  return f;
}
const idsDa = (f: Fila) => f.items.map((x) => x.id);
const linhaDe = (f: Fila, id: string): LinhaFila => {
  const l = f.items.find((x) => x.id === id);
  expect(l, `a linha ${id} está na fila`).toBeDefined();
  return l!;
};

/** O ID Global do documento, lido no banco (o localizador humano que a fila anexa). */
async function idGlobalDe(tipo: string, id: string): Promise<number> {
  const r = await c.admin.query<{ g: string }>("select id_global::text g from erp.registros_globais where tipo_entidade=$1 and id_entidade=$2", [tipo, id]);
  expect(r.rows, `premissa: o documento ${id} tem ID Global`).toHaveLength(1);
  return Number(r.rows[0]!.g);
}

/**
 * NÚMERO FIXO DE CONSULTAS (o molde do ES-10c): a mesma fila com página de 1 e de 5 documentos, contada pelo espião
 * em `pg.Client.prototype.query`. Precisa haver ≥ 5 linhas (a premissa é conferida: [1, 5]).
 */
async function consultasDaFila(modulo: ModuloFila, pageSize: number, tabela: RegExp) {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await fila(modulo, c.h.headers(), { pageSize });
    expect(r.statusCode, r.body).toBe(200);
    const sqls = espiao.mock.calls.map((x) => (typeof x[0] === "string" ? x[0] : (x[0] as { text?: unknown } | undefined)?.text)).filter((x): x is string => typeof x === "string");
    return {
      todas: sqls.length,
      documentos: sqls.filter((s) => tabela.test(s)).length,
      decisoes: sqls.filter((s) => /erp\.aprovacoes_(venda|compra|estoque)\b/.test(s)).length,
      idGlobal: sqls.filter((s) => /from erp\.registros_globais/.test(s)).length,
      linhas: (j(r).items as unknown[]).length,
    };
  } finally { espiao.mockRestore(); }
}
async function conferirConsultasFixas(modulo: ModuloFila, tabela: RegExp): Promise<void> {
  const um = await consultasDaFila(modulo, 1, tabela);
  const cinco = await consultasDaFila(modulo, 5, tabela);
  expect([um.linhas, cinco.linhas], "premissa: páginas de 1 e de 5 documentos (senão a contagem não prova nada)").toEqual([1, 5]);
  // A contagem e a página (as duas leem a decisão no MESMO comando, por `lateral`) e o ID Global, em lote.
  expect(um).toMatchObject({ documentos: 2, decisoes: 2, idGlobal: 1 });
  expect(cinco).toMatchObject({ documentos: 2, decisoes: 2, idGlobal: 1 });
  expect(cinco.todas, "as mesmas consultas, qualquer que seja o tamanho da página").toBe(um.todas);
}

describe("AP-9 — a FILA (venda, compra e estoque)", () => {
  it("AP-9a vendas: só pendentes e reprovadas do escopo de quem aprova; a linha inteira; sai ao ser aprovada, cancelada e confirmada", async () => {
    const tSempre = await topVendaSempre();
    const pendente = await venda(tSempre);
    const reprovada = await venda(tSempre);
    const motivo = "Desconto fora da política";
    expect((await reprovar("vendas", reprovada.id, { version: await versaoVista(reprovada.id), motivo })).statusCode).toBe(200);
    const aprovada = await venda(tSempre);
    expect((await aprovar("vendas", aprovada.id, { version: await versaoVista(aprovada.id) })).statusCode).toBe(200);
    const naoExige = await venda(await top("vendas.venda", { configuracao: cfg4() }));
    const corte = await venda(await top("vendas.venda", { configuracao: cfg3(sempre) }));
    const semTop = await venda(null);
    const daEmpresa2 = await vendaDaEmpresa2(tSempre);
    const abaixo = await venda(await topVendaPorValor("1500.00"), "1499.99");
    const acima = await venda(await topVendaPorValor("1500.00"), "1500.00");
    const paraCancelar = await venda(tSempre);
    const paraConfirmar = await venda(tSempre);

    const aprovadorA = await usuario("Aprovador A", ["sales.view", "sales.approve"], escopos({ vendas: [c.I.empresa] }));
    const f = await filaToda("vendas", aprovadorA);
    const ids = idsDa(f);
    for (const dentro of [pendente.id, reprovada.id, acima.id, paraCancelar.id, paraConfirmar.id]) expect(ids, `${dentro} está na fila`).toContain(dentro);
    for (const fora of [aprovada.id, naoExige.id, corte.id, semTop.id, daEmpresa2, abaixo.id]) expect(ids, `${fora} não está na fila`).not.toContain(fora);
    expect(idsDa(await filaToda("vendas")), "premissa: a venda da empresa 2 está na fila de quem enxerga a empresa 2").toContain(daEmpresa2);
    await conferirLinhasDaFilaVenda(f, [c.I.empresa]);

    // A ordem: data desc, criação desc — a criada por último vem antes.
    expect(ids.indexOf(paraConfirmar.id)).toBeLessThan(ids.indexOf(pendente.id));

    // A linha inteira, contra o banco.
    const db = (await c.admin.query<{ code: string; empresa: string; cliente: string; operacao: string; lancador: string; version: string }>(
      `select d.code, e.name empresa, p.name cliente, v.nome operacao, u.name lancador, d.version::text version
         from erp.sales_documents d join erp.empresas e on e.id=d.empresa_id join erp.people p on p.id=d.client_id
         join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.users u on u.id=d.created_by where d.id=$1`, [pendente.id])).rows[0]!;
    expect(linhaDe(f, pendente.id)).toEqual({
      id: pendente.id, codigo: db.code, especie: "venda", data: DATA, empresa: { id: c.I.empresa, nome: db.empresa },
      parceiro: { id: c.I.client, nome: db.cliente }, operacao: { id: tSempre, nome: db.operacao }, valor: "100.00",
      lancadoPor: { id: c.h.demo.adminUserId, nome: db.lancador }, situacao: "pendente", ultimaDecisao: null, version: db.version,
      id_global: await idGlobalDe("sales_documents", pendente.id),
    });
    const decisao = (await decisoesDe("aprovacoes_venda", reprovada.id))[0]!;
    expect(linhaDe(f, reprovada.id)).toMatchObject({ situacao: "reprovado",
      ultimaDecisao: { decisao: "reprovado", observacao: motivo, decididoPor: { id: c.h.demo.adminUserId, nome: await nomeDoAdmin() }, decididoEm: new Date(decisao.decidido_em).toISOString() } });
    expect(f.idGlobal).toEqual({ tipoEntidade: "sales_documents", rotulo: expect.any(String) });
    for (const l of f.items) expect(l.id_global, `o ID Global da linha ${l.id}`).toEqual(expect.any(Number));

    // SAI ao ser aprovada (e a reprovada também, quando aprovada depois).
    expect((await aprovar("vendas", pendente.id, { version: await versaoVista(pendente.id) })).statusCode).toBe(200);
    expect((await aprovar("vendas", reprovada.id, { version: await versaoVista(reprovada.id) })).statusCode).toBe(200);
    // SAI ao ser cancelada (sem decisão nenhuma: é a SITUAÇÃO que a tira).
    expect((await cancelarVenda(paraCancelar.id)).statusCode).toBe(200);
    // SAI ao ser confirmada: aprovada na versão V e confirmada, a venda está na versão V+1 SEM decisão — é a
    // situação, e não a decisão vigente, que a mantém fora (sem o filtro de situação ela voltaria como "pendente").
    const vAprovada = await versaoVista(paraConfirmar.id);
    expect((await aprovar("vendas", paraConfirmar.id, { version: vAprovada })).statusCode).toBe(200);
    expect((await confirmarVenda(paraConfirmar.id)).statusCode).toBe(200);
    expect(await versaoDaVenda(paraConfirmar.id), "premissa: a confirmação subiu a versão (a vigente da versão atual é nenhuma)").not.toBe(vAprovada);

    const depois = idsDa(await filaToda("vendas", aprovadorA));
    for (const saiu of [pendente.id, reprovada.id, paraCancelar.id, paraConfirmar.id]) expect(depois, `${saiu} saiu da fila`).not.toContain(saiu);
    expect(depois, "premissa: a fila não esvaziou à toa").toContain(acima.id);
  });

  it("AP-9b vendas: número FIXO de consultas — página de 1 e de 5 documentos", async () => {
    const tSempre = await topVendaSempre();
    for (let i = 0; i < 5; i++) await venda(tSempre);
    await conferirConsultasFixas("vendas", /from erp\.sales_documents d\b/);
  });

  it("AP-9c compras: só pendentes e reprovadas do escopo; sai ao ser aprovada, cancelada (reprovada) e confirmada; consultas fixas; ID Global", async () => {
    const tSempre = await top("compras.compra", { configuracao: cfg4(sempre) });
    const tAutoSempre = await top("compras.compra", { configuracao: cfg4((x) => { automatica(x); sempre(x); }) });
    const compra = async (topId: string, extra: Record<string, unknown> = {}, armazem = c.I.warehouse) =>
      (await compraLancada("compra", corpoCompra([itemCompra((await produto()).id, "2", "15.00", { armazem_id: armazem })], { tipo_operacao_id: topId, ...extra }))).id;
    const pendente = await compra(tSempre);
    const reprovada = await compra(tSempre);
    expect((await reprovar("compras", reprovada, { motivo: "Fornecedor bloqueado" })).statusCode).toBe(200);
    const aprovada = await compra(tSempre);
    expect((await aprovar("compras", aprovada, {})).statusCode).toBe(200);
    const naoExige = await compra(c.tops.compra);
    const daEmpresa2 = await compra(tSempre, { empresa_id: c.I.empresa2 }, c.I.warehouseEmpresa2);
    const reprovadaECancelada = await compra(tSempre);
    expect((await reprovar("compras", reprovadaECancelada, { motivo: "Sem orçamento" })).statusCode).toBe(200);
    const automaticaPendente = await compra(tAutoSempre);
    for (let i = 0; i < 3; i++) await compra(tSempre);

    const aprovadorA = await usuario("Comprador aprovador A", ["compras.view", "compras.approve"], escopos({ compras: [c.I.empresa] }));
    const f = await filaToda("compras", aprovadorA);
    const ids = idsDa(f);
    for (const dentro of [pendente, reprovada, reprovadaECancelada, automaticaPendente]) expect(ids).toContain(dentro);
    for (const fora of [aprovada, naoExige, daEmpresa2]) expect(ids).not.toContain(fora);
    expect(idsDa(await filaToda("compras")), "premissa: a compra da empresa 2 está na fila de quem enxerga a empresa 2").toContain(daEmpresa2);
    // Toda linha: compra aberta, da empresa do escopo, que exige (domínio) e cuja última decisão não é "aprovado".
    const r = await c.admin.query<{ id: string; especie: string; situacao: string; empresa_id: string; valor: string; configuracao: unknown; codigo_base: string; ultima: string | null }>(
      `select d.id, d.especie, d.situacao, d.empresa_id, d.valor_total::text valor, v.configuracao, t.codigo_base,
              (select a.decisao from erp.aprovacoes_compra a where a.documento_id=d.id order by a.id desc limit 1) ultima
         from erp.documentos_compra d join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.tipos_operacao t on t.id=v.tipo_operacao_id
        where d.id = any($1::uuid[])`, [ids]);
    expect(r.rows).toHaveLength(ids.length);
    for (const x of r.rows) {
      expect([x.id, x.especie, x.situacao, x.empresa_id, x.ultima === "aprovado", exigePeloDominio(x.codigo_base, x.configuracao, x.valor)])
        .toEqual([x.id, "compra", "aberto", c.I.empresa, false, true]);
      expect(linhaDe(f, x.id).situacao).toBe(x.ultima === "reprovado" ? "reprovado" : "pendente");
    }
    const db = (await c.admin.query<{ codigo: string; empresa: string; fornecedor: string; operacao: string; lancador: string }>(
      `select d.codigo, e.name empresa, p.name fornecedor, v.nome operacao, u.name lancador
         from erp.documentos_compra d join erp.empresas e on e.id=d.empresa_id join erp.people p on p.id=d.fornecedor_id
         join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.users u on u.id=d.criado_por where d.id=$1`, [pendente])).rows[0]!;
    expect(linhaDe(f, pendente)).toEqual({
      id: pendente, codigo: db.codigo, especie: "compra", data: DATA, empresa: { id: c.I.empresa, nome: db.empresa },
      parceiro: { id: c.I.provider, nome: db.fornecedor }, operacao: { id: tSempre, nome: db.operacao }, valor: "30.00",
      lancadoPor: { id: c.h.demo.adminUserId, nome: db.lancador }, situacao: "pendente", ultimaDecisao: null,
      id_global: await idGlobalDe("documentos_compra", pendente),
    });
    expect(linhaDe(f, reprovada)).toMatchObject({ situacao: "reprovado", ultimaDecisao: { decisao: "reprovado", observacao: "Fornecedor bloqueado" } });
    expect(f.idGlobal).toEqual({ tipoEntidade: "documentos_compra", rotulo: expect.any(String) });

    // SAI: aprovada; reprovada e CANCELADA (a última decisão continua "reprovado": é a situação que a tira); e a
    // automática, que o aprovar CONFIRMA no mesmo pedido.
    expect((await aprovar("compras", pendente, {})).statusCode).toBe(200);
    expect((await cancelarCompra(reprovadaECancelada)).statusCode).toBe(200);
    expect((await decisoesDe("aprovacoes_compra", reprovadaECancelada)).map((d) => d.decisao), "premissa: a última decisão dela é a reprovação").toEqual(["reprovado"]);
    const auto = await aprovar("compras", automaticaPendente, {});
    expect(auto.statusCode, auto.body).toBe(200);
    expect(j(auto).confirmacaoAutomatica).toEqual({ confirmado: true });
    expect(await situacaoNoBanco("documentos_compra", automaticaPendente)).toBe("confirmado");
    const depois = idsDa(await filaToda("compras", aprovadorA));
    for (const saiu of [pendente, reprovadaECancelada, automaticaPendente]) expect(depois).not.toContain(saiu);
    expect(depois, "premissa: a fila não esvaziou à toa").toContain(reprovada);

    await conferirConsultasFixas("compras", /from erp\.documentos_compra d\b/);
  });

  it("AP-9d estoque: a porta dinâmica (só as espécies que a pessoa aprova; nenhuma → 403), o escopo, as saídas da fila, consultas fixas, ID Global", async () => {
    const tEntrada = await top("estoque.entrada", { configuracao: cfg4(sempre) });
    const tEntradaAuto = await top("estoque.entrada", { configuracao: cfg4((x) => { automatica(x); sempre(x); }) });
    const tSaida = await top("estoque.saida", { configuracao: cfg4(sempre) });
    const entrada = async (topId: string, extra: Record<string, unknown> = {}) =>
      (await estoqueLancado("entrada", [{ produto_id: (await produto()).id, quantidade: "3", custo_unitario: "2" }], { tipo_operacao_id: topId, ...extra })).id;
    const pendente = await entrada(tEntrada);
    const reprovada = await entrada(tEntrada);
    expect((await reprovar("entrada", reprovada, { motivo: "Nota não conferida" })).statusCode).toBe(200);
    const aprovada = await entrada(tEntrada);
    expect((await aprovar("entrada", aprovada, {})).statusCode).toBe(200);
    const naoExige = await entrada(c.tops.entrada);
    const daEmpresa2 = await entrada(tEntrada, { empresa_id: c.I.empresa2, armazem_id: c.I.warehouseEmpresa2 });
    const reprovadaECancelada = await entrada(tEntrada);
    expect((await reprovar("entrada", reprovadaECancelada, { motivo: "Duplicada" })).statusCode).toBe(200);
    const automaticaPendente = await entrada(tEntradaAuto);
    const saida = (await estoqueLancado("saida", [{ produto_id: (await produtoComSaldo("5")).id, quantidade: "1" }], { tipo_operacao_id: tSaida })).id;
    for (let i = 0; i < 2; i++) await entrada(tEntrada);

    // A porta dinâmica: quem aprova só entradas vê só entradas; quem aprova só saídas, só saídas; quem não aprova nada, 403.
    const soEntradas = await usuario("Aprova entradas", ["entradas_estoque.view", "entradas_estoque.approve"], escopos({ estoque: [c.I.empresa] }));
    const soSaidas = await usuario("Aprova saídas", ["saidas_estoque.view", "saidas_estoque.approve"]);
    const nenhuma = await usuario("Não aprova estoque", ["entradas_estoque.view", "entradas_estoque.edit", "saidas_estoque.view"]);
    const fe = await filaToda("estoque", soEntradas);
    expect(new Set(fe.items.map((x) => x.especie))).toEqual(new Set(["entrada"]));
    const fs = await filaToda("estoque", soSaidas);
    expect(fs.items.map((x) => x.especie).every((e) => e === "saida") && fs.items.some((x) => x.id === saida), "só saídas, e a do caso está lá").toBe(true);
    const r403 = await fila("estoque", nenhuma);
    expect(r403.statusCode, r403.body).toBe(403);
    expect(erro(r403).code).toBe("PERMISSION_DENIED");

    const ids = idsDa(fe);
    for (const dentro of [pendente, reprovada, reprovadaECancelada, automaticaPendente]) expect(ids).toContain(dentro);
    for (const fora of [aprovada, naoExige, daEmpresa2, saida]) expect(ids).not.toContain(fora);
    expect(idsDa(await filaToda("estoque")), "premissa: o documento da empresa 2 está na fila de quem enxerga a empresa 2").toContain(daEmpresa2);
    // Toda linha: entrada aberta, da empresa do escopo, que exige pelo DOMÍNIO (sem valor) e cuja última decisão não é "aprovado".
    const r = await c.admin.query<{ id: string; especie: string; situacao: string; empresa_id: string; configuracao: unknown; codigo_base: string; ultima: string | null }>(
      `select d.id, d.especie, d.situacao, d.empresa_id, v.configuracao, t.codigo_base,
              (select a.decisao from erp.aprovacoes_estoque a where a.documento_id=d.id order by a.id desc limit 1) ultima
         from erp.documentos_estoque d join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.tipos_operacao t on t.id=v.tipo_operacao_id
        where d.id = any($1::uuid[])`, [ids]);
    expect(r.rows).toHaveLength(ids.length);
    for (const x of r.rows) {
      expect([x.id, x.especie, x.situacao, x.empresa_id, x.ultima === "aprovado", exigePeloDominio(x.codigo_base, x.configuracao, null)])
        .toEqual([x.id, "entrada", "aberto", c.I.empresa, false, true]);
      expect(linhaDe(fe, x.id).situacao).toBe(x.ultima === "reprovado" ? "reprovado" : "pendente");
    }
    const db = (await c.admin.query<{ codigo: string; empresa: string; operacao: string; lancador: string }>(
      `select d.codigo, e.name empresa, v.nome operacao, u.name lancador from erp.documentos_estoque d join erp.empresas e on e.id=d.empresa_id
         join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.users u on u.id=d.criado_por where d.id=$1`, [pendente])).rows[0]!;
    expect(linhaDe(fe, pendente)).toEqual({
      id: pendente, codigo: db.codigo, especie: "entrada", data: DATA, empresa: { id: c.I.empresa, nome: db.empresa }, parceiro: null,
      operacao: { id: tEntrada, nome: db.operacao }, valor: null, lancadoPor: { id: c.h.demo.adminUserId, nome: db.lancador },
      situacao: "pendente", ultimaDecisao: null, id_global: await idGlobalDe("documentos_estoque", pendente),
    });
    expect(linhaDe(fe, reprovada)).toMatchObject({ situacao: "reprovado", ultimaDecisao: { decisao: "reprovado", observacao: "Nota não conferida" } });
    expect(fe.idGlobal).toEqual({ tipoEntidade: "documentos_estoque", rotulo: expect.any(String) });

    expect((await aprovar("entrada", pendente, {})).statusCode).toBe(200);
    expect((await cancelarEstoque("entrada", reprovadaECancelada)).statusCode).toBe(200);
    const auto = await aprovar("entrada", automaticaPendente, {});
    expect(auto.statusCode, auto.body).toBe(200);
    expect(j(auto).confirmacaoAutomatica).toEqual({ confirmado: true });
    expect(await situacaoNoBanco("documentos_estoque", automaticaPendente)).toBe("confirmado");
    const depois = idsDa(await filaToda("estoque", soEntradas));
    for (const saiu of [pendente, reprovadaECancelada, automaticaPendente]) expect(depois).not.toContain(saiu);
    expect(depois, "premissa: a fila não esvaziou à toa").toContain(reprovada);

    await conferirConsultasFixas("estoque", /from erp\.documentos_estoque d\b/);
  });
  it("AP-9e as três: a fila aceita só a paginação — parâmetro desconhecido, filtro e busca são 422 no parâmetro, nunca ignorados", async () => {
    for (const modulo of ["vendas", "compras", "estoque"] as const) {
      // Premissa: a mesma porta, só com a paginação, responde.
      expect((await fila(modulo, c.h.headers(), { page: 1, pageSize: 5 })).statusCode, `${modulo}: paginação`).toBe(200);
      for (const [chave, valor] of [["foo", "1"], ["empresa_id", c.I.empresa2], ["search", "x"], ["sort", "id"]] as const) {
        const r = await fila(modulo, c.h.headers(), { [chave]: valor });
        expect(r.statusCode, `${modulo}?${chave}`).toBe(422);
        expect(j(r).error?.code).toBe("VALIDATION_ERROR");
        expect(j(r).error?.details, `${modulo}?${chave}: o parâmetro recusado`).toEqual([{ path: chave, message: "Parâmetro não reconhecido na fila de aprovações" }]);
      }
    }
  });
});

/** A conta do DOMÍNIO sobre a versão congelada (a mesma da confirmação): nunca a SQL que se está testando. */
function exigePeloDominio(codigoBase: string, configuracao: unknown, valor: string | null): boolean {
  const r = regrasGeraisDaVersaoTop({ codigoBase, configuracao });
  expect(r.ok, "premissa: a versão é legível").toBe(true);
  return r.ok && exigeAprovacao(r.regras, valor);
}

/**
 * Toda linha da fila de vendas, contra o banco e o DOMÍNIO: venda viva e aberta, da empresa do escopo, cuja versão
 * congelada exige aprovação com o total ATUAL e cuja decisão vigente (a última DA VERSÃO ATUAL) não é "aprovado" — e a
 * situação da linha é a dessa vigente. É o invariante da fila, conferido sem a SQL dela.
 */
async function conferirLinhasDaFilaVenda(f: Fila, empresas: string[]): Promise<void> {
  const ids = idsDa(f);
  const r = await c.admin.query<{ id: string; kind: string; status: string; viva: boolean; empresa_id: string; total: string; version: string; configuracao: unknown; codigo_base: string; vigente: string | null }>(
    `select d.id, d.kind, d.status, d.deleted_at is null viva, d.empresa_id, d.total::text total, d.version::text version, v.configuracao, t.codigo_base,
            (select a.decisao from erp.aprovacoes_venda a where a.documento_id=d.id and a.versao_documento=d.version order by a.id desc limit 1) vigente
       from erp.sales_documents d join erp.tipos_operacao_versoes v on v.id=d.tipo_operacao_versao_id join erp.tipos_operacao t on t.id=v.tipo_operacao_id
      where d.id = any($1::uuid[])`, [ids]);
  expect(r.rows, "premissa: toda linha da fila é uma venda com TOP").toHaveLength(ids.length);
  for (const x of r.rows) {
    expect([x.id, x.kind, ["open", "approved"].includes(x.status), x.viva, empresas.includes(x.empresa_id), x.vigente === "aprovado", exigePeloDominio(x.codigo_base, x.configuracao, x.total)])
      .toEqual([x.id, "sale", true, true, true, false, true]);
    expect(linhaDe(f, x.id)).toMatchObject({ situacao: x.vigente === "reprovado" ? "reprovado" : "pendente", version: x.version, valor: x.total });
  }
}

// ─────────────── AP-10 ───────────────

/** A barreira: trava a linha da venda FOR UPDATE, a MESMA linha que as decisões, o PATCH e o /confirm travam. */
const TRAVA_DA_VENDA = "select id from erp.sales_documents where id = $1 for update";

/** Quantas transações deste banco esperam trava agora (`pg_stat_activity`), até chegar a `n` ou o limite. */
async function esperarTravados(n: number): Promise<number> {
  const limite = Date.now() + 15_000;
  let esperando = 0;
  while (Date.now() < limite) {
    esperando = Number((await c.admin.query<{ n: string }>(
      "select count(*)::text n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and state = 'active'")).rows[0]!.n);
    if (esperando >= n) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return esperando;
}

/**
 * A BARREIRA EM ORDEM: a 1ª requisição começa e só então a 2ª — cada uma conferida ESPERANDO a trava no banco antes
 * da seguinte. A fila de espera de uma linha no Postgres é por ordem de chegada: soltar a barreira dá a trava à 1ª,
 * e a 2ª espera o commit dela. É o que torna CADA ordem reproduzível (o `emParaleloComBarreira` do ajudante mede o
 * simultâneo, em que a ordem é do escalonador). Devolve as respostas e quantas esperavam em cada passo ([1, 2]).
 */
async function emOrdemComBarreira(sqlTrava: string, params: unknown[], primeira: () => Promise<Resposta>, segunda: () => Promise<Resposta>):
  Promise<{ respostas: [Resposta, Resposta]; esperando: [number, number] }> {
  const barreira = await c.admin.connect();
  try {
    await barreira.query("begin");
    expect((await barreira.query(sqlTrava, params)).rowCount, "premissa: a barreira travou a linha").toBe(1);
    const pa = primeira();
    const e1 = await esperarTravados(1);
    const pb = segunda();
    const e2 = await esperarTravados(2);
    await barreira.query("rollback");
    return { respostas: await Promise.all([pa, pb]) as [Resposta, Resposta], esperando: [e1, e2] };
  } finally {
    await barreira.query("rollback").catch(() => undefined);
    barreira.release();
  }
}

/**
 * A ORDEM DOS FATOS NO BANCO, pela trilha (`erp.audit_logs.id` é sequência, gravada dentro de cada transação; as
 * duas transações se serializam pela trava, então o id diz quem gravou primeiro): o INSERT da decisão da venda
 * (`erp.audit_row` em `aprovacoes_venda`) e o 1º UPDATE que tirou a venda da versão `v` (`erp.audit_row` em
 * `sales_documents`, com a `version` antes e depois). Decisão da versão `v` gravada DEPOIS de a venda sair dela seria
 * a aprovação de uma versão que ninguém mais via.
 */
async function ordemNaTrilha(vendaId: string, v: string): Promise<{ decisao: number | null; saiuDaVersao: number | null }> {
  const r = (await c.admin.query<{ decisao: string | null; saiu: string | null }>(
    `select (select min(l.id)::text from erp.audit_logs l where l.entity = 'aprovacoes_venda' and l.action = 'create' and l.after->>'documento_id' = $1) decisao,
            (select min(l.id)::text from erp.audit_logs l where l.entity = 'sales_documents' and l.entity_id = $1 and l.action = 'update'
                and l.before->>'version' = $2 and l.after->>'version' <> $2) saiu`, [vendaId, v])).rows[0]!;
  return { decisao: r.decisao === null ? null : Number(r.decisao), saiuDaVersao: r.saiu === null ? null : Number(r.saiu) };
}

/** Nenhuma das respostas é a vítima de um deadlock (40P01 → 409 "Conflito de concorrência…"). */
function semDeadlock(...rs: Resposta[]): void {
  for (const r of rs) expect(r.statusCode === 409 && (j(r).error as Erro | undefined)?.message === MSG.deadlock, `deadlock: ${r.body}`).toBe(false);
}

describe("AP-10 — concorrência com barreira: a trava do documento ordena decisões, edições e confirmações", () => {
  /*
   * O QUE ACONTECE (descrito e provado abaixo). As decisões, o PATCH e o /confirm travam a MESMA linha
   * (`sales_documents`, FOR UPDATE, sem junção) antes de decidir qualquer coisa. Quem chega segundo ESPERA o commit
   * do primeiro e decide sobre o que ele deixou:
   *   · duas decisões da mesma venda e da mesma versão: aprovar NÃO muda a versão (a decisão mora noutra tabela), então
   *     a segunda passa também e grava OUTRA decisão, de id maior — nenhuma se perde, nenhuma sobrescreve a outra, e
   *     a vigente é a última na ordem da trava. Aprovar × reprovar: a vigente é a de id maior, e o /confirm obedece a ela;
   *   · aprovar × PATCH (as duas com a versão V): se o PATCH trava primeiro, a versão sobe e a aprovação cai no 409
   *     CONCURRENCY_CONFLICT — nada gravado; se a aprovação trava primeiro, ela grava a decisão DA VERSÃO V (a que o
   *     aprovador viu e que o documento tinha), e o PATCH, que também enviou V, passa: a versão sobe e a venda volta a
   *     "pendente". Em nenhuma ordem existe uma aprovação de uma versão que ninguém viu;
   *   · aprovar × /confirm: se o /confirm trava primeiro, ele recusa (APROVACAO_PENDENTE) sem efeito e a aprovação
   *     grava depois; se a aprovação trava primeiro, o /confirm encontra a decisão e confirma.
   * Nenhum caso termina em deadlock (a vítima do 40P01 responderia 409 "Conflito de concorrência"): a ordem das travas
   * é sempre documento → (confirmação: saldo/produto → contador), e a decisão não pega nenhuma outra trava de linha.
   */

  it("AP-10a duas aprovações SIMULTÂNEAS da mesma venda: a 2ª espera a 1ª e grava a sua decisão (id maior); nenhuma perdida, sem deadlock", async () => {
    const v = await venda(await topVendaSempre());
    const versao = await versaoVista(v.id);
    const { respostas: [a, b], esperando } = await emParaleloComBarreira(TRAVA_DA_VENDA, [v.id],
      () => aprovar("vendas", v.id, { version: versao, observacao: "A" }), () => aprovar("vendas", v.id, { version: versao, observacao: "B" }));
    expect(esperando, "premissa: as duas esperavam a trava ao mesmo tempo").toBeGreaterThanOrEqual(2);
    semDeadlock(a, b);
    expect([a.statusCode, b.statusCode], `${a.body} / ${b.body}`).toEqual([200, 200]);
    const ds = await decisoesDe("aprovacoes_venda", v.id);
    expect(ds.map((d) => [d.decisao, d.versao_documento]), "as duas decisões, da versão que as duas viram").toEqual([["aprovado", versao], ["aprovado", versao]]);
    expect(new Set(ds.map((d) => d.observacao)), "nenhuma decisão perdida").toEqual(new Set(["A", "B"]));
    expect(await versaoDaVenda(v.id), "aprovar não mexe na versão").toBe(versao);
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("AP-10b aprovar × reprovar SIMULTÂNEOS: as duas gravam, em ordem; a vigente é a de id maior, e o /confirm obedece a ela", async () => {
    const v = await venda(await topVendaSempre());
    const versao = await versaoVista(v.id);
    const motivo = "Reprovada na corrida";
    const { respostas: [a, b], esperando } = await emParaleloComBarreira(TRAVA_DA_VENDA, [v.id],
      () => aprovar("vendas", v.id, { version: versao }), () => reprovar("vendas", v.id, { version: versao, motivo }));
    expect(esperando).toBeGreaterThanOrEqual(2);
    semDeadlock(a, b);
    expect([a.statusCode, b.statusCode], `${a.body} / ${b.body}`).toEqual([200, 200]);
    const ds = await decisoesDe("aprovacoes_venda", v.id);
    expect(ds.map((d) => d.decisao).sort()).toEqual(["aprovado", "reprovado"]);
    const ultima = ds[ds.length - 1]!;
    const r = await confirmarVenda(v.id);
    if (ultima.decisao === "aprovado") {
      expect(r.statusCode, `a última é a aprovação: confirma — ${r.body}`).toBe(200);
    } else {
      expect(r.statusCode, r.body).toBe(409);
      expect(erro(r)).toMatchObject({ code: "APROVACAO_REPROVADA", message: MSG.reprovado(motivo) });
      expect(await efeitosDaVenda(v.id)).toEqual(SEM_EFEITO);
    }
  });

  it("AP-10c aprovar × PATCH, PATCH primeiro: a versão sobe e a aprovação perde com 409 — nada gravado", async () => {
    const v = await venda(await topVendaSempre());
    const vista = await versaoVista(v.id);
    const { respostas: [patch, ap], esperando } = await emOrdemComBarreira(TRAVA_DA_VENDA, [v.id],
      () => patchVenda(v.id, { version: vista, note: "corrida" }), () => aprovar("vendas", v.id, { version: vista }));
    expect(esperando, "premissa: o PATCH esperava sozinho, depois os dois").toEqual([1, 2]);
    semDeadlock(patch, ap);
    expect(patch.statusCode, patch.body).toBe(200);
    expect(ap.statusCode, ap.body).toBe(409);
    expect(erro(ap)).toEqual({ code: "CONCURRENCY_CONFLICT", message: MSG.mudou });
    expect(await decisoesDe("aprovacoes_venda", v.id), "nenhuma aprovação de uma versão que ninguém viu").toEqual([]);
    expect(BigInt(await versaoDaVenda(v.id))).toBeGreaterThan(BigInt(vista));
    expect(await ordemNaTrilha(v.id, vista)).toEqual({ decisao: null, saiuDaVersao: expect.any(Number) });
  });

  it("AP-10d aprovar × PATCH, aprovação primeiro: a decisão é DA versão que o aprovador mandou e o documento tinha; o PATCH passa e a venda volta a pendente", async () => {
    const v = await venda(await topVendaSempre());
    const vista = await versaoVista(v.id);
    const { respostas: [ap, patch], esperando } = await emOrdemComBarreira(TRAVA_DA_VENDA, [v.id],
      () => aprovar("vendas", v.id, { version: vista }), () => patchVenda(v.id, { version: vista, note: "corrida" }));
    expect(esperando).toEqual([1, 2]);
    semDeadlock(ap, patch);
    expect([ap.statusCode, patch.statusCode], `${ap.body} / ${patch.body}`).toEqual([200, 200]);
    const ds = await decisoesDe("aprovacoes_venda", v.id);
    expect(ds.map((d) => [d.decisao, d.versao_documento]), "a decisão é da versão que o aprovador mandou").toEqual([["aprovado", vista]]);
    // A versão que o documento TINHA quando a decisão foi gravada: a decisão entra na trilha ANTES do UPDATE que
    // tirou a venda da versão `vista`.
    const trilha = (await auditoriaDe("sales_documents", v.id)).filter((x) => x.action === "approve");
    expect(trilha.map((x) => x.metadata?.versao)).toEqual([vista]);
    const ordem = await ordemNaTrilha(v.id, vista);
    expect(ordem.decisao !== null && ordem.saiuDaVersao !== null && ordem.decisao < ordem.saiuDaVersao,
      `a decisão foi gravada enquanto a venda estava na versão vista: ${JSON.stringify(ordem)}`).toBe(true);
    const atual = await versaoDaVenda(v.id);
    expect(BigInt(atual), "o PATCH subiu a versão depois da decisão").toBeGreaterThan(BigInt(vista));
    expect(ds.some((d) => d.versao_documento === atual), "nenhuma decisão da versão nova, que ninguém aprovou").toBe(false);
    const r = await confirmarVenda(v.id);
    expect(r.statusCode, r.body).toBe(409);
    expect(erro(r).code, "a versão nova está pendente").toBe("APROVACAO_PENDENTE");
  });

  it("AP-10e aprovar × PATCH SIMULTÂNEOS (ordem do escalonador): qualquer que seja, o invariante vale — e ninguém trava para sempre", async () => {
    const v = await venda(await topVendaSempre());
    const vista = await versaoVista(v.id);
    const { respostas: [ap, patch], esperando } = await emParaleloComBarreira(TRAVA_DA_VENDA, [v.id],
      () => aprovar("vendas", v.id, { version: vista }), () => patchVenda(v.id, { version: vista, note: "corrida" }));
    expect(esperando).toBeGreaterThanOrEqual(2);
    semDeadlock(ap, patch);
    expect(patch.statusCode, patch.body).toBe(200);
    const ds = await decisoesDe("aprovacoes_venda", v.id);
    const ordem = await ordemNaTrilha(v.id, vista);
    if (ap.statusCode === 200) {
      // A aprovação ganhou a trava: a decisão é da versão vista E foi gravada antes de a venda sair dela.
      expect(ds.map((d) => d.versao_documento)).toEqual([vista]);
      expect(ordem.decisao !== null && ordem.saiuDaVersao !== null && ordem.decisao < ordem.saiuDaVersao,
        `nunca uma aprovação gravada depois de a versão mudar: ${JSON.stringify(ordem)}`).toBe(true);
    } else {
      expect(erro(ap)).toEqual({ code: "CONCURRENCY_CONFLICT", message: MSG.mudou });
      expect(ds).toEqual([]);
      expect(ordem.decisao).toBeNull();
    }
    expect(erro(await confirmarVenda(v.id)).code, "nas duas ordens, a versão final não tem aprovação").toBe("APROVACAO_PENDENTE");
  });

  it("AP-10f aprovar × /confirm, /confirm primeiro: ele recusa sem efeito; a aprovação grava depois e um /confirm seguinte passa", async () => {
    const v = await venda(await topVendaSempre());
    const vista = await versaoVista(v.id);
    const { respostas: [conf, ap], esperando } = await emOrdemComBarreira(TRAVA_DA_VENDA, [v.id],
      () => confirmarVenda(v.id), () => aprovar("vendas", v.id, { version: vista }));
    expect(esperando).toEqual([1, 2]);
    semDeadlock(conf, ap);
    expect(conf.statusCode, conf.body).toBe(409);
    expect(erro(conf).code).toBe("APROVACAO_PENDENTE");
    expect(ap.statusCode, ap.body).toBe(200);
    expect(await efeitosDaVenda(v.id), "o /confirm que perdeu não deixou efeito").toEqual(SEM_EFEITO);
    const ok = await confirmarVenda(v.id);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await efeitosDaVenda(v.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 1]], titulos: [["receivable", "100.00"]] });
  });

  it("AP-10g aprovar × /confirm, aprovação primeiro: o /confirm espera, encontra a decisão e confirma", async () => {
    const v = await venda(await topVendaSempre());
    const vista = await versaoVista(v.id);
    const { respostas: [ap, conf], esperando } = await emOrdemComBarreira(TRAVA_DA_VENDA, [v.id],
      () => aprovar("vendas", v.id, { version: vista }), () => confirmarVenda(v.id));
    expect(esperando).toEqual([1, 2]);
    semDeadlock(ap, conf);
    expect([ap.statusCode, conf.statusCode], `${ap.body} / ${conf.body}`).toEqual([200, 200]);
    expect(await efeitosDaVenda(v.id)).toEqual({ status: "confirmed", movimentos: [["sale", -1, 1]], titulos: [["receivable", "100.00"]] });
    expect((await decisoesDe("aprovacoes_venda", v.id)).map((d) => [d.decisao, d.versao_documento])).toEqual([["aprovado", vista]]);
  });
});

// ─────────────── AP-11 ───────────────

describe("AP-11 — paridade: exigeAprovacao (domínio) × erp.top_exige_aprovacao (banco)", () => {
  type Caso = { nome: string; configuracao: unknown | null; valor: string | null; esperado: boolean };
  const v1 = (ajuste: (x: ReturnType<typeof configuracaoNeutraTop>) => void) => { const x = configuracaoNeutraTop(); ajuste(x); return x; };
  const v2 = (ajuste: (x: ReturnType<typeof configuracaoNeutraTopV2>) => void) => { const x = configuracaoNeutraTopV2(); ajuste(x); return x; };
  const casos: Caso[] = [
    // Formato 4 — Sempre: exige com qualquer valor, e sem valor.
    { nome: "4 sempre, 0.00", configuracao: cfg4(sempre), valor: "0.00", esperado: true },
    { nome: "4 sempre, 1500.00", configuracao: cfg4(sempre), valor: "1500.00", esperado: true },
    { nome: "4 sempre, valor nulo", configuracao: cfg4(sempre), valor: null, esperado: true },
    // Formato 4 — A partir de 1500.00: igual, acima, abaixo, nulo, extremos.
    { nome: "4 por_valor 1500.00, igual", configuracao: cfg4(porValor("1500.00")), valor: "1500.00", esperado: true },
    { nome: "4 por_valor 1500.00, igual sem casas", configuracao: cfg4(porValor("1500.00")), valor: "1500", esperado: true },
    { nome: "4 por_valor 1500.00, um centavo acima", configuracao: cfg4(porValor("1500.00")), valor: "1500.01", esperado: true },
    { nome: "4 por_valor 1500.00, muito acima", configuracao: cfg4(porValor("1500.00")), valor: "9999999999999999.99", esperado: true },
    { nome: "4 por_valor 1500.00, um centavo abaixo", configuracao: cfg4(porValor("1500.00")), valor: "1499.99", esperado: false },
    { nome: "4 por_valor 1500.00, milésimo abaixo", configuracao: cfg4(porValor("1500.00")), valor: "1499.999", esperado: false },
    { nome: "4 por_valor 1500.00, zero", configuracao: cfg4(porValor("1500.00")), valor: "0.00", esperado: false },
    { nome: "4 por_valor 1500.00, valor nulo (exige)", configuracao: cfg4(porValor("1500.00")), valor: null, esperado: true },
    { nome: "4 por_valor 1500 (sem casas), igual", configuracao: cfg4(porValor("1500")), valor: "1500.00", esperado: true },
    { nome: "4 por_valor 1500 (sem casas), abaixo", configuracao: cfg4(porValor("1500")), valor: "1499.99", esperado: false },
    { nome: "4 por_valor 1500.5, igual a 1500.50", configuracao: cfg4(porValor("1500.5")), valor: "1500.50", esperado: true },
    { nome: "4 por_valor 1500.5, abaixo (1500.49)", configuracao: cfg4(porValor("1500.5")), valor: "1500.49", esperado: false },
    { nome: "4 por_valor 0.01, igual", configuracao: cfg4(porValor("0.01")), valor: "0.01", esperado: true },
    { nome: "4 por_valor 0.01, zero", configuracao: cfg4(porValor("0.01")), valor: "0.00", esperado: false },
    { nome: "4 por_valor no maior limite, igual", configuracao: cfg4(porValor("9999999999999.99")), valor: "9999999999999.99", esperado: true },
    { nome: "4 por_valor no maior limite, abaixo", configuracao: cfg4(porValor("9999999999999.99")), valor: "9999999999999.98", esperado: false },
    // Formato 4 — Sem aprovação.
    { nome: "4 nenhuma, 1500.00", configuracao: cfg4(), valor: "1500.00", esperado: false },
    { nome: "4 nenhuma, valor nulo", configuracao: cfg4(), valor: null, esperado: false },
    // Formato 4 com a confirmação automática não muda a conta.
    { nome: "4 automática + sempre", configuracao: cfg4((x) => { automatica(x); sempre(x); }), valor: "1.00", esperado: true },
    // Formatos 1 a 3 com a aprovação gravada: o corte — nunca exige.
    { nome: "3 sempre", configuracao: cfg3(sempre), valor: "1500.00", esperado: false },
    { nome: "3 sempre, valor nulo", configuracao: cfg3(sempre), valor: null, esperado: false },
    { nome: "3 por_valor 1500.00, acima", configuracao: cfg3(porValor("1500.00")), valor: "2000.00", esperado: false },
    { nome: "2 sempre", configuracao: v2((x) => { x.aprovacao.politica = "sempre"; }), valor: "1500.00", esperado: false },
    { nome: "2 por_valor 1500.00, igual", configuracao: v2((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1500.00"; }), valor: "1500.00", esperado: false },
    { nome: "1 sempre", configuracao: v1((x) => { x.aprovacao.politica = "sempre"; }), valor: "1500.00", esperado: false },
    { nome: "1 por_valor 1500.00, acima, valor nulo", configuracao: v1((x) => { x.aprovacao.politica = "por_valor"; x.aprovacao.valorMinimo = "1500.00"; }), valor: null, esperado: false },
    // Configuração nula: documento sem TOP.
    { nome: "sem TOP (configuração nula), 1500.00", configuracao: null, valor: "1500.00", esperado: false },
    { nome: "sem TOP (configuração nula), valor nulo", configuracao: null, valor: null, esperado: false },
  ];

  it("AP-11 a tabela inteira: o domínio e o banco dão o MESMO resultado, e o resultado é o escrito à mão", async () => {
    const tabela: [string, boolean, boolean, boolean][] = [];
    for (const caso of casos) {
      const regras = regrasGeraisDaVersaoTop(caso.configuracao === null ? null : { codigoBase: "vendas.venda", configuracao: caso.configuracao });
      expect(regras.ok, `premissa: a configuração do caso "${caso.nome}" é legível pelo domínio`).toBe(true);
      const dominio = regras.ok && exigeAprovacao(regras.regras, caso.valor);
      // Pela conexão da APLICAÇÃO (erp_app): é a porta que a fila usa, e a 0041 dá EXECUTE só a ela (e ao dono).
      const banco = (await c.h.db.query<{ e: boolean }>("select erp.top_exige_aprovacao($1::jsonb, $2::numeric) e",
        [caso.configuracao === null ? null : JSON.stringify(caso.configuracao), caso.valor])).rows[0]!.e;
      tabela.push([caso.nome, caso.esperado, dominio, banco]);
    }
    expect(tabela, "cada linha: [caso, esperado, domínio, banco]").toEqual(casos.map((x) => [x.nome, x.esperado, x.esperado, x.esperado]));
    expect(new Set(tabela.map((x) => x[1])), "premissa: a tabela tem os dois resultados").toEqual(new Set([true, false]));
  });
});

// ─────────────── AP-12 ───────────────

type Transicao = { passou: true } | { passou: false; erro: { code?: string; message: string } };
/**
 * UPDATE DIRETO PARA CONFIRMADO pela conexão da APLICAÇÃO (o papel erp_app, sob RLS, com a GUC de organização,
 * usuário e módulo — o caminho de um binário anterior, que não conhece a aprovação), numa transação DESFEITA no fim.
 * Na venda, as marcas da 0023 e da 0024 são postas, para que a ÚNICA guarda em jogo seja a da aprovação (0041).
 */
async function transicaoDireta(alvo: "venda" | "compra" | "estoque", id: string): Promise<Transicao> {
  const cx = await c.h.db.connect();
  try {
    await cx.query("begin");
    const modulo = alvo === "venda" ? "vendas" : alvo === "compra" ? "compras" : "estoque";
    await cx.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', $3, true)",
      [c.h.demo.orgId, c.h.demo.adminUserId, modulo]);
    if (alvo === "venda") {
      await cx.query("select set_config('app.venda_execucao_configurada', $1, true), set_config('app.venda_classificacao_financeira', $1, true)", [id]);
    }
    const sql = alvo === "venda" ? "update erp.sales_documents set status='confirmed' where id=$1"
      : alvo === "compra" ? "update erp.documentos_compra set situacao='confirmado', atualizado_em=now() where id=$1"
        : "update erp.documentos_estoque set situacao='confirmado', confirmado_em=now(), confirmado_por=$2 where id=$1";
    try {
      const r = await cx.query(sql, alvo === "estoque" ? [id, c.h.demo.adminUserId] : [id]);
      expect(r.rowCount, "premissa: o UPDATE alcançou a linha (a RLS a enxerga)").toBe(1);
      return { passou: true };
    } catch (e) {
      return { passou: false, erro: e as { code?: string; message: string } };
    }
  } finally {
    await cx.query("rollback").catch(() => undefined);
    cx.release();
  }
}

/** A recusa da guarda, como o binário (qualquer um) a responde: P0001 → `fromPgError` → 409 CONFLICT, SEM details. */
function respostaDaGuarda(t: Transicao): { status: number; corpo: unknown; pg: string | undefined } {
  expect(t.passou, "o banco recusou").toBe(false);
  if (t.passou) throw new Error("inalcançável");
  const d = fromPgError(t.erro);
  expect(d, `o fromPgError reconhece a recusa: ${t.erro.message}`).not.toBeNull();
  return { status: d!.httpStatus, corpo: JSON.parse(JSON.stringify({ error: d!.toJSON() })), pg: t.erro.code };
}

describe("AP-12 — a GUARDA DO BANCO: entrar em confirmado sem aprovação vigente é CONFLICT (409, sem details)", () => {
  it("AP-12a venda: sem decisão e reprovada → CONFLICT; aprovada → passa; um UPDATE que grava a version aprovada junto com o status continua recusado", async () => {
    const topId = await topVendaSempre();
    const semDecisao = await venda(topId);
    expect(respostaDaGuarda(await transicaoDireta("venda", semDecisao.id))).toEqual({ status: 409, corpo: { error: { code: "CONFLICT", message: MSG.guardaPendente } }, pg: "P0001" });

    const reprovada = await venda(topId);
    expect((await reprovar("vendas", reprovada.id, { version: await versaoVista(reprovada.id), motivo: "Motivo livre que não vai para a guarda" })).statusCode).toBe(200);
    expect(respostaDaGuarda(await transicaoDireta("venda", reprovada.id))).toEqual({ status: 409, corpo: { error: { code: "CONFLICT", message: MSG.guardaReprovado } }, pg: "P0001" });

    // PREMISSA: aprovada, a MESMA transição passa (e é desfeita no fim).
    const aprovada = await venda(topId);
    const vAprovada = await versaoVista(aprovada.id);
    expect((await aprovar("vendas", aprovada.id, { version: vAprovada })).statusCode).toBe(200);
    expect(await transicaoDireta("venda", aprovada.id)).toEqual({ passou: true });
    expect(await situacaoNoBanco("sales_documents", aprovada.id), "a transição de prova foi desfeita").toBe("open");

    // O NEW pode mentir; o OLD não: alterada depois da aprovação, um UPDATE que grava a version APROVADA junto com o
    // status continua recusado (a guarda procura a decisão de OLD.version).
    expect((await patchVenda(aprovada.id, { version: vAprovada, note: "depois" })).statusCode).toBe(200);
    const cx = await c.h.db.connect();
    let mentira: Transicao;
    try {
      await cx.query("begin");
      await cx.query("select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), set_config('app.modulo_empresa', 'vendas', true)", [c.h.demo.orgId, c.h.demo.adminUserId]);
      await cx.query("select set_config('app.venda_execucao_configurada', $1, true), set_config('app.venda_classificacao_financeira', $1, true)", [aprovada.id]);
      try { await cx.query("update erp.sales_documents set status='confirmed', version=$2 where id=$1", [aprovada.id, vAprovada]); mentira = { passou: true }; }
      catch (e) { mentira = { passou: false, erro: e as { code?: string; message: string } }; }
    } finally { await cx.query("rollback").catch(() => undefined); cx.release(); }
    expect(respostaDaGuarda(mentira)).toEqual({ status: 409, corpo: { error: { code: "CONFLICT", message: MSG.guardaPendente } }, pg: "P0001" });
  });

  it("AP-12b compra e estoque: sem decisão e reprovado → CONFLICT; aprovado → passa", async () => {
    const tCompra = await top("compras.compra", { configuracao: cfg4(sempre) });
    const tEstoque = await top("estoque.entrada", { configuracao: cfg4(sempre) });
    const compra = async () => (await compraLancada("compra", corpoCompra([itemCompra((await produto()).id, "1", "10.00")], { tipo_operacao_id: tCompra }))).id;
    const entrada = async () => (await estoqueLancado("entrada", [{ produto_id: (await produto()).id, quantidade: "1", custo_unitario: "1" }], { tipo_operacao_id: tEstoque })).id;
    const alvos = [
      { alvo: "compra" as const, decisao: "compras" as const, novo: compra, tabela: "documentos_compra" as const },
      { alvo: "estoque" as const, decisao: "entrada" as const, novo: entrada, tabela: "documentos_estoque" as const },
    ];
    for (const x of alvos) {
      const semDecisao = await x.novo();
      expect([x.alvo, respostaDaGuarda(await transicaoDireta(x.alvo, semDecisao))])
        .toEqual([x.alvo, { status: 409, corpo: { error: { code: "CONFLICT", message: MSG.guardaPendente } }, pg: "P0001" }]);

      const reprovado = await x.novo();
      expect((await reprovar(x.decisao, reprovado, { motivo: "Não conferido" })).statusCode).toBe(200);
      expect([x.alvo, respostaDaGuarda(await transicaoDireta(x.alvo, reprovado))])
        .toEqual([x.alvo, { status: 409, corpo: { error: { code: "CONFLICT", message: MSG.guardaReprovado } }, pg: "P0001" }]);

      const aprovado = await x.novo();
      expect((await aprovar(x.decisao, aprovado, {})).statusCode).toBe(200);
      expect([x.alvo, await transicaoDireta(x.alvo, aprovado)], "premissa: aprovado, a MESMA transição passa").toEqual([x.alvo, { passou: true }]);
      expect(await situacaoNoBanco(x.tabela, aprovado), "desfeita no fim").toBe("aberto");
    }

    // E pela API nova, quem explica é o passo do planejamento (APROVACAO_PENDENTE com details) — a guarda é o fundo.
    const c1 = await compra();
    expect(erro(await confirmarCompra(c1)).code).toBe("APROVACAO_PENDENTE");
    const e1 = await entrada();
    expect(erro(await confirmarEstoque("entrada", e1)).code).toBe("APROVACAO_PENDENTE");
  });

  it("AP-12c formato 1 a 3 com a aprovação gravada NUNCA é barrado (venda, compra e estoque); formato 4 sem aprovação também não", async () => {
    const comSempre = [
      { nome: "1", configuracao: (() => { const x = configuracaoNeutraTop(); x.aprovacao.politica = "sempre"; return x; })() },
      { nome: "2", configuracao: (() => { const x = configuracaoNeutraTopV2(); x.aprovacao.politica = "sempre"; return x; })() },
      { nome: "3", configuracao: cfg3(sempre) },
      { nome: "4 Sem aprovação", configuracao: cfg4() },
    ];
    for (const f of comSempre) {
      const v = await venda(await top("vendas.venda", { configuracao: f.configuracao }));
      expect([`venda formato ${f.nome}`, await transicaoDireta("venda", v.id)]).toEqual([`venda formato ${f.nome}`, { passou: true }]);
    }
    // Compra e estoque: o formato 3 (o que a porta aceita para eles com regra gravada) e o 4 sem aprovação.
    for (const f of comSempre.slice(2)) {
      const tc = await top("compras.compra", { configuracao: f.configuracao });
      const compra = (await compraLancada("compra", corpoCompra([itemCompra((await produto()).id, "1", "10.00")], { tipo_operacao_id: tc }))).id;
      expect([`compra formato ${f.nome}`, await transicaoDireta("compra", compra)]).toEqual([`compra formato ${f.nome}`, { passou: true }]);
      const te = await top("estoque.entrada", { configuracao: f.configuracao });
      const doc = (await estoqueLancado("entrada", [{ produto_id: (await produto()).id, quantidade: "1", custo_unitario: "1" }], { tipo_operacao_id: te })).id;
      expect([`estoque formato ${f.nome}`, await transicaoDireta("estoque", doc)]).toEqual([`estoque formato ${f.nome}`, { passou: true }]);
    }
  });
});
