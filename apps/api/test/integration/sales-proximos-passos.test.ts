import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { harness, ids, type Harness } from "./setup.js";

/**
 * A CONVERSÃO DECIDIDA PELO GRAFO (TOP-CONFIG-03).
 *
 * Até aqui a variante de destino saía de uma constante do produto: orçamento virava pedido, pedido virava
 * venda, e ponto. O que este arquivo prova é que a decisão passou para a POLÍTICA CONFIGURADA, e que ela é
 * lida do lugar certo:
 *
 *   1. os próximos passos vêm da VERSÃO que o documento cita — editar a TOP depois não muda o leque dele;
 *   2. destino desativado some da oferta SEM alterar a versão da origem;
 *   3. destino fora do grafo é RECUSADO na conversão;
 *   4. a variante criada é a da TOP ESCOLHIDA — orçamento pode ir direto para venda, se configurado;
 *   5. origem SEM grafo nenhum continua funcionando exatamente como antes (a ponte de compatibilidade).
 */
let h: Harness; let I: Awaited<ReturnType<typeof ids>>;
beforeAll(async () => { h = await harness(); I = await ids(h); }, 180_000);
afterAll(async () => { await h.app.close(); await h.db.end(); });

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown> & { error?: { code: string } };
const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

let seq = 0;
const codigo = () => `8${String(++seq).padStart(3, "0")}`;

async function cadastrarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers: h.headers(),
    payload: { codigo: codigo(), codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
async function revisaoTop(id: string) {
  return j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() })).revisao as number;
}
const editarTop = (id: string, corpo: Record<string, unknown>) =>
  h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers(), payload: corpo });

async function criarDoc(kind: Variante, tipoOperacaoId: string | null) {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-01", client_id: I.client,
      tipo_operacao_id: tipoOperacaoId,
      items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "2", unit_price: "50.00" }] } });
  expect(r.statusCode, r.body).toBe(201);
  return j(r).id as string;
}
const passos = (kind: Variante, id: string) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}/proximos-passos`, headers: h.headers() });
const converter = (kind: Variante, id: string, tipoOperacaoId?: string | null) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers: h.headers(),
    payload: tipoOperacaoId === undefined ? {} : { tipo_operacao_id: tipoOperacaoId } });

describe("próximos passos — a política vem da VERSÃO do documento", () => {
  it("o leque configurado aparece, com nome e variante do destino", async () => {
    const pedido = await cadastrarTop("vendas.pedido", "Pedido normal");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento com destino", { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const doc = await criarDoc("budget", orc);

    const r = j(await passos("budget", doc));
    expect(r.contractVersion).toBe(1);
    expect(r.items).toMatchObject([{ tipoOperacaoId: pedido, nome: "Pedido normal", variante: "order" }]);
  });

  it("DUAS TOPs de destino aparecem AS DUAS, e o servidor não escolhe por você", async () => {
    const aVista = await cadastrarTop("vendas.venda", "Venda à vista");
    const aPrazo = await cadastrarTop("vendas.venda", "Venda a prazo");
    const ped = await cadastrarTop("vendas.pedido", "Pedido com dois destinos",
      { destinos: [{ tipoOperacaoId: aVista, ordem: 0 }, { tipoOperacaoId: aPrazo, ordem: 1 }] });
    const doc = await criarDoc("order", ped);

    const items = j(await passos("order", doc)).items as { tipoOperacaoId: string }[];
    expect(items.map((x) => x.tipoOperacaoId), "na ordem declarada pelo administrador").toEqual([aVista, aPrazo]);

    // E o servidor RECUSA converter sem escolha: com duas opções, escolher por conta própria seria decidir
    // no lugar do usuário qual operação a organização executou.
    const r = await converter("order", doc);
    expect(r.statusCode).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_INDISPONIVEL");
  });

  it("EDITAR A TOP DEPOIS NÃO MUDA O LEQUE DO DOCUMENTO — a política é congelada na versão", async () => {
    const antigo = await cadastrarTop("vendas.pedido", "Pedido da política antiga");
    const novo = await cadastrarTop("vendas.pedido", "Pedido da política nova");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento que será reconfigurado",
      { destinos: [{ tipoOperacaoId: antigo, ordem: 0 }] });
    const doc = await criarDoc("budget", orc);

    // A TOP ganha a versão 2 com OUTRO destino.
    expect((await editarTop(orc, { destinos: [{ tipoOperacaoId: novo, ordem: 0 }], revisao: await revisaoTop(orc) })).statusCode).toBe(200);

    // O documento nasceu sob a versão 1 e continua enxergando a política DELA. Se os passos fossem lidos da
    // versão CORRENTE da origem, esta asserção já traria `novo` — e a conversão de um documento de ontem
    // mudaria de significado por uma edição de hoje.
    const items = j(await passos("budget", doc)).items as { tipoOperacaoId: string }[];
    expect(items.map((x) => x.tipoOperacaoId)).toEqual([antigo]);

    // E um documento NOVO, criado agora, já nasce com a política nova.
    const docNovo = await criarDoc("budget", orc);
    expect((j(await passos("budget", docNovo)).items as { tipoOperacaoId: string }[]).map((x) => x.tipoOperacaoId)).toEqual([novo]);
  });

  it("destino DESATIVADO deixa de ser oferecido — sem versionar a origem e sem cair para um vizinho", async () => {
    const some = await cadastrarTop("vendas.pedido", "Pedido que será desativado");
    const fica = await cadastrarTop("vendas.venda", "Venda que permanece");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento com dois caminhos",
      { destinos: [{ tipoOperacaoId: some, ordem: 0 }, { tipoOperacaoId: fica, ordem: 1 }] });
    const doc = await criarDoc("budget", orc);
    expect((j(await passos("budget", doc)).items as unknown[]), "premissa: os dois são oferecidos").toHaveLength(2);

    expect((await editarTop(some, { ativo: false, revisao: await revisaoTop(some) })).statusCode).toBe(200);

    const depois = j(await passos("budget", doc)).items as { tipoOperacaoId: string }[];
    // NÃO escolhe vizinho, NÃO cai para padrão: some exatamente um, e o outro continua.
    expect(depois.map((x) => x.tipoOperacaoId)).toEqual([fica]);

    // E converter para o desativado é recusado pela MESMA superfície de recusa.
    const r = await converter("budget", doc, some);
    expect(r.statusCode).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_INDISPONIVEL");
  });

  it("documento LEGADO (sem TOP) não tem próximos passos — ausência não vira configuração", async () => {
    const doc = await criarDoc("budget", null);
    expect(j(await passos("budget", doc)).items).toEqual([]);
  });
});

describe("conversão — o grafo é autoridade quando existe", () => {
  it("converte para a TOP ESCOLHIDA e cria a variante DELA, pulando a etapa intermediária", async () => {
    const venda = await cadastrarTop("vendas.venda", "Venda direta");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento que vira venda",
      { destinos: [{ tipoOperacaoId: venda, ordem: 0 }] });
    const doc = await criarDoc("budget", orc);

    const r = await converter("budget", doc, venda);
    expect(r.statusCode, r.body).toBe(201);
    // ESTA É A LINHA QUE PROVA QUE A CADEIA FIXA CAIU: com `nextSalesKind`, um orçamento só podia virar
    // `order`. Aqui ele vira `sale`, porque foi isso que a organização configurou.
    expect(j(r).kind).toBe("sale");

    const criado = j(await h.app.inject({ method: "GET", url: `/api/sales/sales/${j(r).id}`, headers: h.headers() }));
    expect((criado.tipo_operacao as { id: string }).id, "a TOP do destino é a escolhida").toBe(venda);
  });

  it("destino FORA do grafo é recusado, e a fonte NÃO fica convertida", async () => {
    const autorizado = await cadastrarTop("vendas.pedido", "Pedido autorizado");
    const intruso = await cadastrarTop("vendas.pedido", "Pedido não configurado");
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento restrito",
      { destinos: [{ tipoOperacaoId: autorizado, ordem: 0 }] });
    const doc = await criarDoc("budget", orc);

    const r = await converter("budget", doc, intruso);
    expect(r.statusCode).toBe(422);
    expect(j(r).error!.code).toBe("TIPO_OPERACAO_INDISPONIVEL");

    // A recusa não pode deixar efeito parcial: a fonte continua aberta e convertível.
    const fonte = j(await h.app.inject({ method: "GET", url: `/api/sales/budgets/${doc}`, headers: h.headers() }));
    expect(fonte.status, "a fonte não virou `converted`").toBe("open");
    expect((await converter("budget", doc, autorizado)).statusCode, "e o caminho autorizado continua valendo").toBe(201);
  });
});

describe("conversão — a PONTE: origem sem grafo continua funcionando", () => {
  it("origem SEM destinos configurados segue a cadeia anterior, com TOP do destino", async () => {
    const pedido = await cadastrarTop("vendas.pedido", "Pedido pela ponte");
    // Orçamento SEM `destinos`: é o acervo inteiro no dia do deploy.
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento sem política");
    const doc = await criarDoc("budget", orc);

    expect(j(await passos("budget", doc)).items, "a tela nova não oferece nada").toEqual([]);

    // Mas a API continua honrando o contrato anterior: orçamento → pedido.
    const r = await converter("budget", doc, pedido);
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).kind).toBe("order");
  });

  it("origem SEM destinos e SEM TOP alvo continua criando o derivado legado", async () => {
    const orc = await cadastrarTop("vendas.orcamento", "Orçamento sem política nem alvo");
    const doc = await criarDoc("budget", orc);
    const r = await converter("budget", doc);
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).kind).toBe("order");
  });
});
