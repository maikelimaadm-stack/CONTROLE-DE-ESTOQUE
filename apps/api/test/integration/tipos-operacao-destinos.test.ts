import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * O GRAFO DE PRÓXIMAS OPERAÇÕES, PELA PORTA DA API.
 *
 * O que precisa ser provado aqui não é "dá para salvar uma lista de destinos". É o conjunto de coisas que,
 * quebradas, não apareceriam em tela nenhuma:
 *
 *   1. a política é CONGELADA pela versão: editar a TOP hoje não muda o leque de um documento de ontem;
 *   2. a disponibilidade é do PRESENTE: desativar um destino tira a oferta SEM tocar na versão da origem;
 *   3. o destino é conferido contra banco E registry, com superfície ÚNICA de recusa;
 *   4. a conversão só aceita destino AUTORIZADO pela versão da origem — quando a origem tem grafo.
 */
let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.app.close(); await h.db.end(); });

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;

let seq = 0;
const codigo = () => `24${String(++seq).padStart(2, "0")}`;

async function criarTop(codigoBase: string, nome: string, extra: Record<string, unknown> = {}, headers = h.headers()) {
  const r = await h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers,
    payload: { codigo: codigo(), codigoBase, nome, ...extra } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const detalhe = (id: string, headers = h.headers()) =>
  h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers });
const editar = (id: string, corpo: Record<string, unknown>, headers = h.headers()) =>
  h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers, payload: corpo });
const versoes = (id: string) =>
  h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() });

async function revisao(id: string) { return j(await detalhe(id)).revisao as number; }

describe("grafo — capability e leque de destinos possíveis", () => {
  it("a capability DECLARA o suporte a destinos com o teto", async () => {
    const d = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() }));
    expect(d.destinos).toMatchObject({ suportado: true });
    expect((d.destinos as { limite: number }).limite).toBeGreaterThan(0);
  });

  it("destinos-possiveis exclui a PRÓPRIA família e inclui as outras famílias executáveis", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido alvo");
    const orcamento = await criarTop("vendas.orcamento", "Orçamento irmão");
    const r = j(await h.app.inject({ method: "GET",
      url: "/api/admin/tipos-operacao/destinos-possiveis?codigoBase=vendas.orcamento", headers: h.headers() }));
    const ids = (r.items as { id: string }[]).map((x) => x.id);
    expect(ids, "pedido é destino válido de um orçamento").toContain(pedido);
    // Mesma família seria CÓPIA de documento, não conversão — e cópia é outra funcionalidade.
    expect(ids, "outro orçamento NÃO é próxima operação de um orçamento").not.toContain(orcamento);
  });

  it("família que o produto não sabe criar como documento de venda devolve leque VAZIO, nunca 'todas'", async () => {
    await criarTop("estoque.baixa", "Baixa de estoque");
    const r = j(await h.app.inject({ method: "GET",
      url: "/api/admin/tipos-operacao/destinos-possiveis?codigoBase=estoque.baixa", headers: h.headers() }));
    expect(r.items).toEqual([]);
  });
});

describe("grafo — destinos são CONTEÚDO", () => {
  it("criar com destinos grava a política na versão 1", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido destino");
    const orc = await criarTop("vendas.orcamento", "Orçamento com destino", { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const d = j(await detalhe(orc));
    expect(d.versao).toBe(1);
    expect((d.destinos as { tipoOperacaoId: string; nome: string; disponivel: boolean }[]))
      .toMatchObject([{ tipoOperacaoId: pedido, disponivel: true }]);
    // Nunca UUID como rótulo: o nome do destino viaja resolvido.
    expect((d.destinos as { nome: string }[])[0]!.nome).toBe("Pedido destino");
  });

  it("mudar SÓ os destinos cria versão N+1", async () => {
    const a = await criarTop("vendas.pedido", "Pedido A");
    const orc = await criarTop("vendas.orcamento", "Orçamento evolutivo");
    expect(j(await detalhe(orc)).versao).toBe(1);
    expect((await editar(orc, { destinos: [{ tipoOperacaoId: a, ordem: 0 }], revisao: await revisao(orc) })).statusCode).toBe(200);
    expect(j(await detalhe(orc)).versao, "política nova é conteúdo novo").toBe(2);
  });

  it("reenviar a MESMA política — inclusive noutra ordem de envio — é no-op", async () => {
    const a = await criarTop("vendas.pedido", "Pedido X");
    const b = await criarTop("vendas.venda", "Venda Y");
    const orc = await criarTop("vendas.orcamento", "Orçamento estável",
      { destinos: [{ tipoOperacaoId: a, ordem: 0 }, { tipoOperacaoId: b, ordem: 1 }] });
    const antes = j(await detalhe(orc));

    // A MESMA política, enviada com `ordem` esparsa e na ordem inversa do array: a normalização do domínio
    // tem de reduzir os dois ao mesmo, senão salvar duas vezes sem mudar nada criaria versão falsa.
    const r = await editar(orc, {
      destinos: [{ tipoOperacaoId: b, ordem: 17 }, { tipoOperacaoId: a, ordem: 4 }],
      revisao: antes.revisao
    });
    expect(r.statusCode, r.body).toBe(200);
    const depois = j(await detalhe(orc));
    expect([depois.versao, depois.revisao], "nem versão, nem revisão").toEqual([antes.versao, antes.revisao]);

    // PREMISSA: INVERTER de verdade a ordem É uma mudança, porque a ordem é parte da política.
    const inv = await editar(orc, {
      destinos: [{ tipoOperacaoId: b, ordem: 0 }, { tipoOperacaoId: a, ordem: 1 }],
      revisao: antes.revisao
    });
    expect(inv.statusCode, inv.body).toBe(200);
    expect(j(await detalhe(orc)).versao).toBe((antes.versao as number) + 1);
  });

  it("editar SEM citar destinos PRESERVA a política — é o cliente antigo no rolling deploy", async () => {
    const a = await criarTop("vendas.pedido", "Pedido preservado");
    const orc = await criarTop("vendas.orcamento", "Orçamento antigo", { destinos: [{ tipoOperacaoId: a, ordem: 0 }] });
    expect((await editar(orc, { nome: "Renomeado pelo cliente antigo", revisao: await revisao(orc) })).statusCode).toBe(200);
    expect((j(await detalhe(orc)).destinos as unknown[]), "ausente não é 'apague'").toHaveLength(1);
  });

  it("a versão N+1 carrega a política INTEIRA, e a versão N continua com a dela", async () => {
    const a = await criarTop("vendas.pedido", "Pedido primeiro");
    const b = await criarTop("vendas.venda", "Venda segunda");
    const orc = await criarTop("vendas.orcamento", "Orçamento histórico", { destinos: [{ tipoOperacaoId: a, ordem: 0 }] });
    expect((await editar(orc, { destinos: [{ tipoOperacaoId: b, ordem: 0 }], revisao: await revisao(orc) })).statusCode).toBe(200);

    const items = (j(await versoes(orc)).items) as { versao: number; destinos: { tipoOperacaoId: string }[] }[];
    expect(items.map((x) => x.versao)).toEqual([2, 1]);
    expect(items[0]!.destinos.map((x) => x.tipoOperacaoId)).toEqual([b]);
    // A prova pela qual a aresta pendura na VERSÃO: se pendurasse na TOP, esta linha já leria `b`.
    expect(items[1]!.destinos.map((x) => x.tipoOperacaoId)).toEqual([a]);
  });
});

describe("grafo — a recusa", () => {
  it("lista malformada é 422 com código próprio, e nada é gravado", async () => {
    const orc = await criarTop("vendas.orcamento", "Orçamento intacto");
    const antes = j(await detalhe(orc));
    for (const destinos of [{ nao: "lista" }, [{ id: "errado" }], [{ tipoOperacaoId: "nao-e-uuid", ordem: 0 }]]) {
      const r = await editar(orc, { destinos, revisao: antes.revisao });
      expect(r.statusCode, JSON.stringify(destinos)).toBe(422);
      expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_DESTINO_INVALIDO");
    }
    expect(j(await detalhe(orc)).versao).toBe(antes.versao);
  });

  it("destino de família INCOMPATÍVEL e destino INEXISTENTE caem na MESMA recusa", async () => {
    const estoque = await criarTop("estoque.baixa", "Baixa incompatível");
    const orc = await criarTop("vendas.orcamento", "Orçamento exigente");
    const rev = await revisao(orc);
    const inexistente = "00000000-0000-4000-8000-00000000dead";

    const respostas = await Promise.all([
      editar(orc, { destinos: [{ tipoOperacaoId: estoque, ordem: 0 }], revisao: rev }),
      editar(orc, { destinos: [{ tipoOperacaoId: inexistente, ordem: 0 }], revisao: rev })
    ]);
    // MESMO código e MESMA mensagem: distinguir "existe mas não serve" de "não existe" transformaria o
    // editor num oráculo de quais TOPs a organização tem.
    const codigos = respostas.map((r) => (j(r).error as { code: string }).code);
    const mensagens = respostas.map((r) => (j(r).error as { message: string }).message);
    expect(respostas.map((r) => r.statusCode)).toEqual([422, 422]);
    expect(codigos).toEqual(["TIPO_OPERACAO_INDISPONIVEL", "TIPO_OPERACAO_INDISPONIVEL"]);
    expect(mensagens[0]).toBe(mensagens[1]);
  });

  it("CROSS-TENANT: a TOP da organização B não pode ser destino na organização A", async () => {
    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org grafo API", adminEmail: "admin-grafo@demo.local", adminPassword: "Demo@12345", slug: "orggrafoapi" }, () => {});
    await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-grafo@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const B = { authorization: `Bearer ${tok}`, "x-org-id": o2.orgId };

    const daOrgB = await criarTop("vendas.pedido", "Pedido da organização B", {}, B);
    const orcA = await criarTop("vendas.orcamento", "Orçamento da organização A");
    const r = await editar(orcA, { destinos: [{ tipoOperacaoId: daOrgB, ordem: 0 }], revisao: await revisao(orcA) });
    expect(r.statusCode).toBe(422);
    expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_INDISPONIVEL");
    expect((j(await detalhe(orcA)).destinos as unknown[]), "nada foi gravado").toHaveLength(0);
  });

  it("destino DESATIVADO some da oferta SEM alterar a versão da origem", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido que será desativado");
    const orc = await criarTop("vendas.orcamento", "Orçamento observador", { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const antes = j(await detalhe(orc));

    expect((await editar(pedido, { ativo: false, revisao: await revisao(pedido) })).statusCode).toBe(200);

    const depois = j(await detalhe(orc));
    // A VERSÃO NÃO MUDOU: a política continua registrando que o caminho existiu. O que mudou é a
    // disponibilidade, que é pergunta do presente.
    expect(depois.versao, "desativar o destino não versiona a origem").toBe(antes.versao);
    expect((depois.destinos as { disponivel: boolean }[])[0]!.disponivel).toBe(false);
  });
});
