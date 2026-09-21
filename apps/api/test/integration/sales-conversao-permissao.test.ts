import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool } from "@agro/db";
import { escoposDeTodosOsModulos, harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * ═══ A CAPACIDADE COBRADA NA CONVERSÃO É A DO DESTINO REAL (TOP-CONFIG-03) ═══
 *
 * Este arquivo prova UMA frase, e ela tem duas metades que se sustentam mutuamente:
 *
 *   "quem autoriza a conversão é a capacidade do documento que VAI SER CRIADO — nunca a capacidade do
 *    destino que a cadeia antiga escolheria."
 *
 * ┌─ O DEFEITO, COMO ELE REALMENTE ERA — MEDIDO, NÃO SUPOSTO ────────────────────────────────────────────┐
 * │ A primeira linha do handler cobrava `permOf(nextSalesKind(kind)).create`: uma constante do produto,  │
 * │ avaliada antes de ler o documento e a política da versão que ele cita. Quando a organização          │
 * │ configura o orçamento para ir DIRETO À VENDA, o destino real é `sale`, e essa linha exigia           │
 * │ `orders.create` — capacidade sobre uma família que a operação nem toca.                              │
 * │                                                                                                       │
 * │ A medição contra o binário anterior diz exatamente qual era o estrago, e ele tem UMA direção:         │
 * │   · O ramo do GRAFO já cobrava, lá dentro, a capacidade do destino real. A linha de cima não a        │
 * │     substituía: ela SOMAVA. O requisito efetivo virava `orders.create` ∧ `sales.create`.              │
 * │   · Logo o defeito era RECUSAR QUEM PODIA (P1), e não admitir quem não podia. Dizer o contrário       │
 * │     seria inventar um segundo defeito para dar importância a um teste.                                │
 * │                                                                                                       │
 * │ Isso muda o PAPEL de cada prova, e é por isso que está escrito aqui:                                  │
 * │   P1 é a REGRESSÃO CORRIGIDA — vermelho antes, verde agora, e a diferença é observável.                │
 * │   P2 e P3 são ANTI-ESCALAÇÃO: a correção MOVEU uma cobrança, e a forma óbvia de errar ao mover é      │
 * │      apagar a linha de cima sem deixar a de baixo. P2 tranca esse erro no ramo do grafo; P3 o tranca  │
 * │      na PONTE, onde ele seria pior — ali a linha de cima era a ÚNICA cobrança do destino, e sem       │
 * │      substituta qualquer usuário com `budgets.edit` passaria a criar pedidos.                          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * REGRA DE OURO, e é o que P2 mede: o grafo NUNCA autoriza, ele só RESTRINGE o caminho. O administrador
 * habilitar a aresta orçamento → venda não concede `sales.create` a ninguém.
 *
 * ┌─ COMO CADA CASO É PROVADO (a premissa vai junto da conclusão) ────────────────────────────────────────┐
 * │ Um 403 sozinho não prova nada: ele poderia vir de um usuário sem capacidade NENHUMA, de um escopo de  │
 * │ empresa vazio ou de um grafo quebrado. Por isso cada caso afirma, ANTES da conclusão:                 │
 * │   · quais capacidades o usuário REALMENTE tem — exercendo-as contra a rota de criação de cada família; │
 * │   · quais ele REALMENTE não tem — pela mesma rota, com 403 que NOMEIA a chave ausente;                 │
 * │   · que o caminho legítimo funciona — o mesmo grafo, percorrido por quem tem a capacidade certa.        │
 * │                                                                                                        │
 * │ E o efeito é conferido FORA DA ROTA, por consulta direta: uma recusa que já tivesse gravado metade     │
 * │ responderia 403 com o mesmo corpo de uma recusa limpa.                                                 │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

type Hdr = Record<string, string>;
const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string; message: string } };
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

let seq = 0;
const codigo = () => `9${String(++seq).padStart(3, "0")}`;

/**
 * UM USUÁRIO COM EXATAMENTE AS CHAVES PEDIDAS — papel próprio, vínculo próprio, escopo de empresa próprio.
 *
 * O escopo de empresa NÃO é detalhe de conveniência: membro sem escopo configurado não enxerga empresa
 * nenhuma (fail-closed, `PRE-BASE2-02`). Sem ele, TODO caso abaixo responderia a recusa esperada pelo
 * motivo ERRADO — falta de escopo, e não falta de capacidade — e a suíte inteira ficaria verde sem provar
 * uma linha do que promete. `escoposDeTodosOsModulos([])` declara `todas` em cada módulo canônico, que é o
 * estado em que a capacidade passa a ser a ÚNICA variável do experimento.
 */
async function membro(nome: string, email: string, perms: string[]): Promise<Hdr> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(),
    payload: { name: `Perfil ${nome}`, permissions: perms } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(),
    payload: { name: nome, email, password: "Conversao@12345", role_id: j(papel).id, escopos_empresas: escoposDeTodosOsModulos([]) } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "Conversao@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

async function cadastrarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

const corpoDocumento = () => ({
  empresa_id: I.empresa, document_date: "2026-09-01", client_id: I.client,
  items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "2", unit_price: "50.00" }]
});

/** O documento de origem é criado pelo ADMINISTRADOR: o experimento é sobre CONVERTER, não sobre criar. */
async function criarDoc(kind: Variante, tipoOperacaoId: string | null): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { ...corpoDocumento(), tipo_operacao_id: tipoOperacaoId } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}

const converter = (headers: Hdr, kind: Variante, id: string, tipoOperacaoId?: string | null) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers,
    payload: tipoOperacaoId === undefined ? {} : { tipo_operacao_id: tipoOperacaoId } });

/** Exercer a capacidade de criação de uma família É a prova de que o usuário a tem (ou não tem). */
const criarPelaRota = (headers: Hdr, kind: Variante) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers, payload: corpoDocumento() });

/**
 * O ESTADO PERSISTIDO, LIDO FORA DA ROTA. A pergunta "a recusa deixou efeito?" não pode ser feita à mesma
 * superfície que acabou de recusar: ela responderia 403/404 para uma conversão consumada tanto quanto para
 * uma que nunca começou. A conexão é a de superusuário do harness, sem RLS, de propósito — aqui se quer o
 * que EXISTE, não o que o chamador enxergaria.
 */
async function estado(id: string): Promise<{ status: string; derivados: number; movimentos: number; titulos: number }> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    const d = (await c.query<{ status: string }>("select status from erp.sales_documents where id=$1", [id])).rows[0]!;
    const n = async (sql: string) => Number((await c.query<{ n: string }>(sql, [id])).rows[0]!.n);
    return {
      status: d.status,
      derivados: await n("select count(*)::text n from erp.sales_documents where origin_document_id=$1"),
      movimentos: await n("select count(*)::text n from erp.stock_movements where source_type='sales_documents' and source_id=$1"),
      titulos: await n("select count(*)::text n from erp.financial_titles where source_type='sales_documents' and source_id=$1")
    };
  } finally { await c.end(); }
}

/** O DISCRIMINADOR, lido da coluna e não inferido da contagem de arestas — é a premissa de P1/P2 e de P3. */
async function politicaDaVersaoCorrente(tipoOperacaoId: string): Promise<{ destinosConfigurados: boolean; arestas: number }> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    const r = await c.query<{ destinos_configurados: boolean; arestas: string }>(
      `select v.destinos_configurados,
              (select count(*) from erp.tipos_operacao_versao_destinos d where d.origem_versao_id = v.id)::text as arestas
         from erp.tipos_operacao t
         join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual
        where t.id = $1`, [tipoOperacaoId]);
    const linha = r.rows[0]!;
    return { destinosConfigurados: linha.destinos_configurados, arestas: Number(linha.arestas) };
  } finally { await c.end(); }
}

/** O documento derivado, lido direto da tabela: variante, origem e a TOP com que ele nasceu. */
async function derivadoDe(origemId: string): Promise<{ id: string; kind: string; tipo_operacao_id: string | null }[]> {
  const c = createPool(TEST_URL, { max: 1 });
  try {
    return (await c.query<{ id: string; kind: string; tipo_operacao_id: string | null }>(
      "select id, kind, tipo_operacao_id from erp.sales_documents where origin_document_id=$1 order by created_at", [origemId])).rows;
  } finally { await c.end(); }
}

describe("conversão — a capacidade cobrada é a do DESTINO REAL", () => {
  it("P1 — ORÇAMENTO → VENDA DIRETA converte com `sales.create` e SEM `orders.create`", async () => {
    const venda = await cadastrarTop("vendas.venda", "Venda direta P1");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento que vai direto para venda",
      { destinos: [{ tipoOperacaoId: venda, ordem: 0 }] });
    // PREMISSA DA POLÍTICA: a versão declarou destinos e tem UMA aresta. Se ela estivesse com
    // `destinos_configurados = false`, o 201 abaixo viria da PONTE (destino `order`) e o teste estaria
    // medindo P3 achando que mede P1.
    expect(await politicaDaVersaoCorrente(orc)).toEqual({ destinosConfigurados: true, arestas: 1 });
    const doc = await criarDoc("budget", orc);

    const u = await membro("Vendedor sem pedidos", "p1.vendedor.sem.pedidos@teste.com",
      ["budgets.view", "budgets.edit", "sales.create"]);

    // PREMISSA DA CAPACIDADE, exercida e não declarada: ele CRIA venda e NÃO cria pedido.
    const podeVenda = await criarPelaRota(u, "sale");
    expect(podeVenda.statusCode, `premissa: o usuário tem sales.create — ${podeVenda.body}`).toBe(201);
    const naoPodePedido = await criarPelaRota(u, "order");
    expect(naoPodePedido.statusCode, "premissa: o usuário NÃO tem orders.create").toBe(403);
    expect(j(naoPodePedido).error!.message, "e a recusa nomeia exatamente a chave que falta").toContain("orders.create");

    // A CONCLUSÃO, E ELA FOI MEDIDA CONTRA O BINÁRIO ANTERIOR: neste mesmo cenário ele respondia
    // `403 PERMISSION_DENIED — Sem permissão: orders.create`, porque a linha do topo somava a capacidade
    // da cadeia antiga à do destino real. Esta é a linha que vira verde.
    const r = await converter(u, "budget", doc, venda);
    expect(r.statusCode, `converter com a capacidade do destino real: ${r.body}`).toBe(201);
    expect(j(r).kind, "a variante criada é a da TOP escolhida, não a da cadeia antiga").toBe("sale");

    // E o efeito, conferido FORA da rota: um derivado, `sale`, com a TOP escolhida, e a fonte convertida.
    const derivados = await derivadoDe(doc);
    expect(derivados).toHaveLength(1);
    expect([derivados[0]!.kind, derivados[0]!.tipo_operacao_id]).toEqual(["sale", venda]);
    expect((await estado(doc)).status).toBe("converted");
  }, 180_000);

  /**
   * P2 NÃO É UMA REGRESSÃO CORRIGIDA, e vale dizê-lo: o binário anterior já respondia 403 aqui, porque o
   * ramo do grafo sempre cobrou a capacidade do destino real lá dentro. O que P2 tranca é o ERRO DE
   * MOVIMENTO — apagar a cobrança do topo (que P1 exige apagar) e não deixar nenhuma no lugar. Sem P2,
   * esse apagamento passaria P1 com folga e transformaria `budgets.edit` em licença para criar vendas.
   */
  it("P2 — ter `orders.create` NÃO substitui `sales.create`: 403 e zero efeito", async () => {
    const venda = await cadastrarTop("vendas.venda", "Venda direta P2");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento que vai direto para venda (P2)",
      { destinos: [{ tipoOperacaoId: venda, ordem: 0 }] });
    expect(await politicaDaVersaoCorrente(orc)).toEqual({ destinosConfigurados: true, arestas: 1 });
    const doc = await criarDoc("budget", orc);
    const antes = await estado(doc);
    expect([antes.status, antes.derivados], "premissa: a fonte está aberta e sem derivado").toEqual(["open", 0]);

    const u = await membro("Comprador de pedidos", "p2.so.pedidos@teste.com",
      ["budgets.view", "budgets.edit", "orders.create"]);

    // PREMISSA INVERTIDA DE P1: ele tem a capacidade da CADEIA ANTIGA e não a do DESTINO REAL.
    const podePedido = await criarPelaRota(u, "order");
    expect(podePedido.statusCode, `premissa: o usuário TEM orders.create — ${podePedido.body}`).toBe(201);
    const naoPodeVenda = await criarPelaRota(u, "sale");
    expect(naoPodeVenda.statusCode, "premissa: o usuário NÃO tem sales.create").toBe(403);

    const r = await converter(u, "budget", doc, venda);
    // 403 e não 422: falta de capacidade fala do CHAMADOR. O documento existe, é visível para ele, e o
    // destino está no grafo — o que falta é o direito de criar uma venda.
    expect(r.statusCode, r.body).toBe(403);
    expect(j(r).error!.code).toBe("PERMISSION_DENIED");
    // A MENSAGEM É A PROVA DE QUAL CAPACIDADE FOI COBRADA. Sem esta linha, o 403 acima seria compatível
    // com o servidor tendo cobrado `orders.create` e falhado por outro motivo qualquer.
    expect(j(r).error!.message, "a capacidade cobrada é a do destino REAL").toContain("sales.create");
    expect(j(r).error!.message, "e não a do destino da cadeia antiga").not.toContain("orders.create");

    // ZERO EFEITO, lido fora da rota. `toEqual(antes)` cobre de uma vez status, derivados, movimentos e
    // títulos: a recusa acontece antes de `writeDoc`, antes do `converted` e antes de qualquer auditoria.
    expect(await estado(doc), "recusa não deixa efeito parcial").toEqual(antes);
    expect(await derivadoDe(doc)).toHaveLength(0);

    // E O GRAFO NÃO AUTORIZOU NINGUÉM: a MESMA aresta, o MESMO documento, percorrido por quem tem a
    // capacidade do destino real. Sem esta linha, o 403 acima poderia vir de um grafo quebrado.
    const comCapacidade = await membro("Vendedor P2", "p2.vendedor@teste.com",
      ["budgets.view", "budgets.edit", "sales.create"]);
    const ok = await converter(comCapacidade, "budget", doc, venda);
    expect(ok.statusCode, `o caminho legítimo continua valendo: ${ok.body}`).toBe(201);
    expect(j(ok).kind).toBe("sale");
  }, 180_000);

  /**
   * P3 É A PROVA MAIS CARA DAS TRÊS, e o motivo é assimétrico em relação a P2: no binário anterior a
   * PONTE não tinha cobrança própria nenhuma — ela vivia inteiramente da linha do topo que P1 manda
   * remover. Mover a cobrança para dentro do `else` é obrigatório, e esquecer disso não quebraria P1 nem
   * P2: abriria uma porta silenciosa em que qualquer portador de `budgets.edit` cria PEDIDOS.
   */
  it("P3 — a PONTE legada escolhe o destino, não dispensa a capacidade dele", async () => {
    // Orçamento SEM a chave `destinos`: é o acervo no dia do deploy, e é o ÚNICO estado em que a cadeia
    // anterior ainda decide o destino.
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento sem política declarada");
    expect(await politicaDaVersaoCorrente(orc), "premissa: a política nunca foi declarada")
      .toEqual({ destinosConfigurados: false, arestas: 0 });

    const semPedido = await membro("Orçamentista sem pedidos", "p3.sem.pedidos@teste.com",
      ["budgets.view", "budgets.edit"]);
    const naoPodePedido = await criarPelaRota(semPedido, "order");
    expect(naoPodePedido.statusCode, "premissa: o usuário NÃO tem orders.create").toBe(403);

    // DOIS PEDIDOS DE CONVERSÃO, porque são dois caminhos de código: sem TOP alvo (a ponte pura) e com TOP
    // alvo. Nos dois a capacidade é cobrada ANTES de resolver a TOP do destino, e nos dois a resposta é a
    // mesma recusa sem efeito.
    for (const alvo of [undefined, null] as const) {
      const doc = await criarDoc("budget", orc);
      const antes = await estado(doc);
      const r = await converter(semPedido, "budget", doc, alvo);
      expect(r.statusCode, `ponte com alvo ${String(alvo)}: ${r.body}`).toBe(403);
      expect(j(r).error!.code).toBe("PERMISSION_DENIED");
      // A ponte segue `nextSalesKind`, então o destino é `order` — e é `orders.create` que ela cobra.
      expect(j(r).error!.message, "a ponte cobra a capacidade do destino que ELA escolheu").toContain("orders.create");
      expect(await estado(doc), "a ponte não é porta dos fundos: zero efeito").toEqual(antes);
      expect(await derivadoDe(doc)).toHaveLength(0);
    }

    // PREMISSA FINAL: a ponte FUNCIONA para quem tem a capacidade. Sem esta linha, os 403 acima seriam
    // compatíveis com uma ponte simplesmente quebrada, e o teste não provaria nada sobre autorização.
    const comPedido = await membro("Orçamentista com pedidos", "p3.com.pedidos@teste.com",
      ["budgets.view", "budgets.edit", "orders.create"]);
    const doc = await criarDoc("budget", orc);
    const ok = await converter(comPedido, "budget", doc);
    expect(ok.statusCode, `a ponte legítima continua valendo: ${ok.body}`).toBe(201);
    expect(j(ok).kind, "e o destino da ponte é o da cadeia anterior").toBe("order");
    const derivados = await derivadoDe(doc);
    expect(derivados).toHaveLength(1);
    expect(derivados[0]!.kind).toBe("order");
  }, 180_000);
});
