import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo, type Db } from "@agro/db";
import { harness, ids, TEST_URL, type Harness } from "./setup.js";

/**
 * O GRAFO DE PRÓXIMAS OPERAÇÕES, PELA PORTA DA API.
 *
 * O que precisa ser provado aqui não é "dá para salvar uma lista de destinos". É o conjunto de coisas que,
 * quebradas, não apareceriam em tela nenhuma:
 *
 *   1. a política é CONGELADA pela versão: editar a TOP hoje não muda o leque de um documento de ontem;
 *   2. a disponibilidade é do PRESENTE: desativar um destino tira a oferta SEM tocar na versão da origem;
 *   3. o destino é conferido contra banco E registry, com superfície ÚNICA de recusa;
 *   4. a conversão só aceita destino AUTORIZADO pela versão da origem — quando a origem tem grafo;
 *   5. LEGADO (nunca declarado) e VAZIO EXPLÍCITO (declarado sem destino) são estados DIFERENTES, e a
 *      diferença entre eles é a única coisa que separa "converte pela cadeia antiga" de "não converte".
 */
let h: Harness;
let I: Awaited<ReturnType<typeof ids>>;
/**
 * A CONEXÃO DE OBSERVAÇÃO — fora da rota, de propósito.
 *
 * Uma recusa que gravasse METADE responderia 422 exatamente como uma recusa limpa, e a própria API
 * continuaria contando a história dela. Por isso o estado da fonte e a contagem de derivados são lidos
 * direto da tabela: é a única testemunha que não é a parte interessada.
 */
let admin: Db;
beforeAll(async () => { h = await harness(); I = await ids(h); admin = createPool(TEST_URL, { max: 2 }); });
afterAll(async () => { await h.app.close(); await h.db.end(); await admin.end(); });

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

const ROTA = { budget: "budgets", order: "orders", sale: "sales" } as const;
type Variante = keyof typeof ROTA;

/** Um documento de venda nascido sob a versão CORRENTE da TOP — é ele que carrega a política para a conversão. */
async function criarDocumento(kind: Variante, tipoOperacaoId: string) {
  const r = await h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}`, headers: h.headers(),
    payload: { empresa_id: I.empresa, document_date: "2026-09-01", client_id: I.client,
      tipo_operacao_id: tipoOperacaoId,
      items: [{ product_id: I.product, warehouse_id: I.warehouse, quantity: "1", unit_price: "10.00" }] } });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}
const proximosPassos = (kind: Variante, id: string) =>
  h.app.inject({ method: "GET", url: `/api/sales/${ROTA[kind]}/${id}/proximos-passos`, headers: h.headers() });
/** `alvo` AUSENTE manda `{}`: é o pedido de conversão que não escolheu nada, e não o mesmo que escolher nulo. */
const converter = (kind: Variante, id: string, alvo?: string) =>
  h.app.inject({ method: "POST", url: `/api/sales/${ROTA[kind]}/${id}/convert`, headers: h.headers(),
    payload: alvo === undefined ? {} : { tipo_operacao_id: alvo } });

/** A VERSÃO CORRENTE COMO O BANCO A GUARDA — a coluna, não o que a rota deduz dela. */
async function versaoCorrenteNoBanco(tipoOperacaoId: string) {
  const r = await admin.query<{ id: string; versao: number; destinos_configurados: boolean }>(
    `select v.id, v.versao, v.destinos_configurados
       from erp.tipos_operacao_versoes v
       join erp.tipos_operacao t on t.id = v.tipo_operacao_id and t.versao_atual = v.versao
      where t.id = $1`, [tipoOperacaoId]);
  expect(r.rows, "premissa: a TOP tem exatamente uma versão corrente").toHaveLength(1);
  return r.rows[0]!;
}
/** O estado da FONTE e quantos documentos ela gerou — as duas metades que uma recusa suja deixaria trocadas. */
async function documentoNoBanco(documentoId: string) {
  const r = await admin.query<{ status: string; tipo_operacao_versao_id: string | null; derivados: string }>(
    `select d.status, d.tipo_operacao_versao_id,
            (select count(*) from erp.sales_documents f where f.origin_document_id = d.id)::text as derivados
       from erp.sales_documents d where d.id = $1`, [documentoId]);
  return r.rows[0]!;
}
/** As arestas gravadas para TODAS as versões desta TOP — é o número que prova a CÓPIA, e não a herança. */
async function arestasNoBanco(tipoOperacaoId: string) {
  const r = await admin.query<{ n: string }>(
    "select count(*)::text n from erp.tipos_operacao_versao_destinos where origem_tipo_operacao_id = $1",
    [tipoOperacaoId]);
  return Number(r.rows[0]!.n);
}
const trilhaDaTop = async (id: string) => (await admin.query<{ action: string }>(
  "select action from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 order by created_at, id",
  [id])).rows.map((x) => x.action);

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

/**
 * ═══ LEGADO (NUNCA DECLARADO) × VAZIO EXPLÍCITO (DECLARADO SEM DESTINO) ═══
 *
 * Os dois estados produzem a MESMA lista vazia, e é por isso que contar arestas nunca os separou. O que
 * os separa é `destinos_configurados`, gravado na VERSÃO — e a consequência de confundi-los não é
 * cosmética: com `passos.length > 0` decidindo, o administrador que declarava "esta operação não gera
 * próxima operação" via a web obedecer e uma chamada direta à API de conversão converter assim mesmo.
 * A política vazia deixava de existir na prática, sem erro em lugar nenhum.
 *
 * Cada caso abaixo afirma a PREMISSA junto da conclusão: antes de afirmar que a conversão é recusada,
 * afirma que o caminho legítimo funciona; antes de afirmar que o booleano subiu, afirma que ele estava
 * embaixo. Um verde sobre premissa não provada seria o mesmo verde de um teste que não testa nada.
 */
describe("grafo — legado nunca declarado × vazio declarado de propósito", () => {
  it("A1 LEGADO AUSENTE — `destinos` ausente nasce NÃO DECLARADO, e a ponte da cadeia antiga continua convertendo", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido pela ponte legada");
    // O CORPO DO CLIENTE ANTERIOR À FATIA: ele não conhece o campo. É o acervo inteiro no dia do deploy.
    const orc = await criarTop("vendas.orcamento", "Orçamento nunca configurado");

    const d = j(await detalhe(orc));
    expect(d.destinosConfigurados, "ausência da chave é o estado LEGADO").toBe(false);
    expect(d.destinos, "e legado nasce sem aresta nenhuma — o mesmo zero do vazio explícito").toEqual([]);
    const versao = await versaoCorrenteNoBanco(orc);
    expect(versao.destinos_configurados, "a coluna da VERSÃO é quem guarda; o detalhe só a publica").toBe(false);

    const doc = await criarDocumento("budget", orc);
    expect((await documentoNoBanco(doc)).tipo_operacao_versao_id,
      "o documento cita ESTA versão — é dela que a conversão vai ler a política").toBe(versao.id);

    const p = j(await proximosPassos("budget", doc));
    expect(p.items, "a tela nova não oferece nada: não há política a exibir").toEqual([]);
    expect(p.politicaConfigurada, "e o discriminador diz que ninguém declarou").toBe(false);

    // A PONTE. Sem política declarada, a cadeia anterior (orçamento → pedido) continua valendo — e é esta
    // linha que torna a recusa de A2 uma decisão, e não uma quebra geral da conversão.
    const r = await converter("budget", doc, pedido);
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r).kind, "a cadeia anterior leva o orçamento ao pedido").toBe("order");
    const depois = await documentoNoBanco(doc);
    expect([depois.status, depois.derivados], "fonte convertida e UM derivado, lidos fora da rota")
      .toEqual(["converted", "1"]);
  });

  it("A2 VAZIO EXPLÍCITO — `destinos: []` RECUSA a conversão, e a recusa não deixa metade gravada", async () => {
    // A TOP de pedido existe e é um destino perfeitamente válido para a CADEIA ANTIGA: é exatamente ela
    // que o HEAD anterior aceitava, caindo na ponte porque a lista de passos estava vazia.
    const pedido = await criarTop("vendas.pedido", "Pedido que ninguém autorizou");
    const orc = await criarTop("vendas.orcamento", "Orçamento que não gera nada", { destinos: [] });

    const d = j(await detalhe(orc));
    expect(d.destinosConfigurados, "lista vazia é DECLARAÇÃO, não silêncio").toBe(true);
    expect(d.destinos, "e a declaração é de que não há próxima operação").toEqual([]);
    const versao = await versaoCorrenteNoBanco(orc);
    expect(versao.destinos_configurados, "gravado na versão, que é imutável").toBe(true);

    const doc = await criarDocumento("budget", orc);
    expect((await documentoNoBanco(doc)).tipo_operacao_versao_id).toBe(versao.id);

    const p = j(await proximosPassos("budget", doc));
    // `items` é IDÊNTICO ao de A1. Só o discriminador distingue os dois — é literalmente por isso que ele existe.
    expect(p.items).toEqual([]);
    expect(p.politicaConfigurada, "aqui alguém declarou, e declarou o vazio").toBe(true);

    // AS DUAS FORMAS DE PEDIR A CONVERSÃO SÃO RECUSADAS: sem escolher nada, e escolhendo o destino que a
    // cadeia antiga geraria. A segunda é a que o HEAD anterior convertia com 201.
    for (const alvo of [undefined, pedido]) {
      const r = await converter("budget", doc, alvo);
      expect(r.statusCode, r.body).toBe(422);
      expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_INDISPONIVEL");
    }

    // LIDO FORA DA ROTA: uma recusa que gravasse metade responderia 422 igual a uma recusa limpa.
    const depois = await documentoNoBanco(doc);
    expect([depois.status, depois.derivados], "fonte segue `open` e nenhum derivado nasceu")
      .toEqual(["open", "0"]);
  });

  it("A2 (complemento) `destinos: null` é PRESENÇA da chave — equivale à lista vazia, nunca à ausência", async () => {
    // JSON não transporta `undefined`; `null` é algo que o cliente ESCREVEU. Se ele caísse em "ausente", um
    // editor que limpasse o campo mandaria `null` e receberia de volta o estado legado, sem nada indicar.
    const orc = await criarTop("vendas.orcamento", "Orçamento declarado com nulo", { destinos: null });
    const d = j(await detalhe(orc));
    expect([d.destinosConfigurados, d.destinos]).toEqual([true, []]);
  });

  it("A4 EDIT LEGADO -> VAZIO EXPLÍCITO — declarar o vazio é conteúdo, e o histórico guarda as duas leituras", async () => {
    const orc = await criarTop("vendas.orcamento", "Orçamento que será fechado");
    const antes = j(await detalhe(orc));
    // PREMISSA: o ponto de partida é o legado — não declarado E sem aresta. Sem ela, o `true` lá embaixo
    // não prova transição nenhuma, porque poderia já estar `true` desde o começo.
    expect([antes.versao, antes.destinosConfigurados, antes.destinos]).toEqual([1, false, []]);

    const r = await editar(orc, { destinos: [], revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);

    const depois = j(await detalhe(orc));
    // AS ARESTAS SÃO AS MESMAS (nenhuma, antes e depois). O que mudou foi a DECLARAÇÃO — e é conteúdo,
    // porque muda o que a conversão de um documento futuro vai fazer.
    expect(depois.versao, "declarar o vazio cria a versão N+1").toBe(2);
    expect(depois.destinosConfigurados).toBe(true);
    expect(depois.revisao, "e a revisão sobe, como em toda escrita").toBe((antes.revisao as number) + 1);
    expect(depois.destinos, "sem ganhar aresta nenhuma").toEqual([]);

    const items = j(await versoes(orc)).items as { versao: number; destinosConfigurados: boolean; destinos: unknown[] }[];
    // O HISTÓRICO É A RAZÃO DE A COLUNA MORAR NA VERSÃO: um documento emitido sob a versão 1 continua
    // explicado por "naquela época ninguém tinha declarado nada", e não pela decisão tomada depois.
    expect(items.map((x) => [x.versao, x.destinosConfigurados, x.destinos.length]))
      .toEqual([[2, true, 0], [1, false, 0]]);
  });

  it("A5 PUT SEM `destinos` — preserva o booleano E as arestas, nos DOIS estados", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido preservado no silêncio");
    const declarada = await criarTop("vendas.orcamento", "Orçamento declarado",
      { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const legada = await criarTop("vendas.orcamento", "Orçamento silencioso");
    // PREMISSA: um de cada estado, para que a preservação seja provada nos dois sentidos.
    expect([j(await detalhe(declarada)).destinosConfigurados, j(await detalhe(legada)).destinosConfigurados])
      .toEqual([true, false]);

    // O CORPO DO CLIENTE ANTIGO durante o rolling deploy: ele mexe noutro campo e não conhece `destinos`.
    expect((await editar(declarada, { ativo: false, revisao: await revisao(declarada) })).statusCode).toBe(200);
    expect((await editar(legada, { ativo: false, revisao: await revisao(legada) })).statusCode).toBe(200);

    const d = j(await detalhe(declarada));
    expect(d.destinosConfigurados, "silêncio não desfaz decisão").toBe(true);
    expect((d.destinos as { tipoOperacaoId: string }[]).map((x) => x.tipoOperacaoId),
      "e não apaga política que ninguém pediu para apagar").toEqual([pedido]);
    expect(d.versao, "mudar só o estado não versiona").toBe(1);

    // O OUTRO SENTIDO, que é o que impede o booleano de subir sozinho: silêncio também não DECLARA.
    expect(j(await detalhe(legada)).destinosConfigurados).toBe(false);
  });

  it("A6 alteração de NOME com `destinos` ausente — a versão N+1 COPIA booleano e arestas da anterior", async () => {
    const pedido = await criarTop("vendas.pedido", "Pedido herdado pela versão nova");
    const orc = await criarTop("vendas.orcamento", "Orçamento antes do nome novo",
      { destinos: [{ tipoOperacaoId: pedido, ordem: 0 }] });
    const antes = j(await detalhe(orc));
    expect([antes.versao, antes.destinosConfigurados, (antes.destinos as unknown[]).length],
      "premissa: versão 1 declarada, com UMA aresta").toEqual([1, true, 1]);
    expect(await arestasNoBanco(orc), "premissa: uma aresta gravada ao todo").toBe(1);

    // SÓ O NOME MUDA — e nome é conteúdo, então nasce a versão 2. `destinos` continua ausente.
    expect((await editar(orc, { nome: "Orçamento renomeado", revisao: antes.revisao })).statusCode).toBe(200);

    const items = j(await versoes(orc)).items as {
      versao: number; nome: string; destinosConfigurados: boolean; destinos: { tipoOperacaoId: string }[]
    }[];
    // A VERSÃO NOVA É AUTOSSUFICIENTE: ela declara a política inteira. Se herdasse por referência, ler a
    // versão 2 dependeria de a versão 1 existir, e o histórico deixaria de se explicar sozinho.
    expect(items[0]).toMatchObject({ versao: 2, nome: "Orçamento renomeado", destinosConfigurados: true });
    expect(items[0]!.destinos.map((x) => x.tipoOperacaoId)).toEqual([pedido]);
    expect(items[1], "e a versão 1 continua com a dela").toMatchObject({ versao: 1, destinosConfigurados: true });
    expect(items[1]!.destinos.map((x) => x.tipoOperacaoId)).toEqual([pedido]);
    // O NÚMERO É A PROVA DA CÓPIA: duas linhas de aresta, uma por versão. Uma só significaria herança.
    expect(await arestasNoBanco(orc)).toBe(2);
  });

  it("A7 NO-OP REAL — redeclarar o MESMO vazio não versiona, não sobe revisão e não audita", async () => {
    const orc = await criarTop("vendas.orcamento", "Orçamento já fechado", { destinos: [] });
    const antes = j(await detalhe(orc));
    // PREMISSA: já declarado, e vazio. É o caso em que A4 acabou — e aqui ele NÃO pode gerar versão de novo.
    expect([antes.versao, antes.destinosConfigurados, antes.destinos]).toEqual([1, true, []]);
    expect(await trilhaDaTop(orc), "premissa: só a criação está na trilha").toEqual(["create"]);

    const r = await editar(orc, { destinos: [], revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);

    const depois = j(await detalhe(orc));
    // A REVISÃO É A MOEDA DA CONCORRÊNCIA: subi-la sem mudança faria toda outra aba aberta receber 409
    // por uma alteração que não existiu.
    expect([depois.versao, depois.revisao], "nem versão, nem revisão").toEqual([antes.versao, antes.revisao]);
    expect(await trilhaDaTop(orc), "e nenhum evento novo na trilha").toEqual(["create"]);
  });
});
