import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import { CODIGOS_TIPO_OPERACAO } from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * TOP CONFIGURADA — O QUE ESTE ARQUIVO PRECISA PROVAR.
 *
 * Não que "o CRUD funciona": isso é o de menos, e um teste que só faz o caminho feliz passaria igual se a
 * autorização estivesse desligada. O que se prova aqui é o conjunto de coisas que, quebradas, não seriam
 * visíveis em nenhuma tela:
 *
 *   1. a família canônica é conferida CONTRA O REGISTRY — e não contra uma lista copiada;
 *   2. identidade (código, família) não muda depois de criada, nem pela rota nem por dentro;
 *   3. editar conteúdo CRIA versão; mudar estado NÃO cria — e a versão antiga continua legível;
 *   4. nunca existem duas padrão na mesma família, inclusive sob concorrência real;
 *   5. a organização A não lê, não altera e não exclui a TOP da B — e não descobre que ela existe.
 */
let h: Harness;
beforeAll(async () => { h = await harness(); });
afterAll(async () => { await h.app.close(); await h.db.end(); });

const j = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;
const FAMILIA = "vendas.venda";

async function criar(corpo: Record<string, unknown>, headers = h.headers()) {
  return h.app.inject({ method: "POST", url: "/api/admin/tipos-operacao", headers, payload: corpo });
}
async function detalhe(id: string, headers = h.headers()) {
  return h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers });
}
async function editar(id: string, corpo: Record<string, unknown>, headers = h.headers()) {
  return h.app.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers, payload: corpo });
}
/** A exclusão também é escrita otimista: sem a revisão da linha na mão, ela não acontece. */
async function excluir(id: string, revisao: number | string, headers = h.headers()) {
  return h.app.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${id}?revisao=${revisao}`, headers });
}
/** Trilha de auditoria de UMA linha, na ordem em que aconteceu (`id` desempata dentro do mesmo instante). */
async function trilha(id: string): Promise<{ action: string; metadata: Record<string, unknown> | null }[]> {
  const adm = createPool(TEST_URL, { max: 1 });
  try {
    const r = await adm.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 order by created_at, id", [id]);
    return r.rows;
  } finally { await adm.end(); }
}
const acoes = (t: { action: string }[]) => t.map((x) => x.action);

/** Códigos distintos por caso: a unicidade é por organização e a suíte compartilha uma. */
let sequencia = 0;
const codigo = () => `21${String(++sequencia).padStart(2, "0")}`;

describe("TOP configurada — família canônica", () => {
  it("aceita uma família que o REGISTRY declara", async () => {
    const r = await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Venda de Gado a Prazo" });
    expect(r.statusCode, r.body).toBe(201);
    const d = j(await detalhe((j(r) as { id: string }).id));
    expect(d.familia).toMatchObject({ codigo: FAMILIA, modulo: "vendas" });
    // O rótulo vem do catálogo pt-BR pela chave do registry — não está guardado na linha.
    expect((d.familia as { rotulo: string }).rotulo).toBe("Venda");
  });

  it("RECUSA família inexistente com código estável, e não grava nada", async () => {
    const r = await criar({ codigo: codigo(), codigoBase: "vendas.inexistente", nome: "Qualquer" });
    expect(r.statusCode).toBe(422);
    expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_BASE_DESCONHECIDA");
    const lista = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao?search=Qualquer", headers: h.headers() }));
    expect(lista.total, "recusa não pode deixar rastro").toBe(0);
  });

  it("a lista de famílias servida pela API É a do registry — não uma cópia", async () => {
    // Se alguém criar uma segunda lista (no servidor ou no cliente), ela divergirá deste conjunto na
    // primeira família nova. Comparar com o registry é o que torna a divergência barulhenta.
    const r = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/familias", headers: h.headers() }));
    const servidos = (r.items as { codigo: string }[]).map((x) => x.codigo).sort();
    expect(servidos).toEqual([...CODIGOS_TIPO_OPERACAO].sort());
  });
});

describe("TOP configurada — identidade estável", () => {
  it("a rota RECUSA troca de código e de família em vez de ignorar o campo", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Original" })) as { id: string }).id;
    const atual = j(await detalhe(id));

    for (const corpo of [
      { codigo: "9999", revisao: atual.revisao },
      { codigoBase: "estoque.baixa", revisao: atual.revisao }
    ]) {
      const r = await editar(id, corpo);
      expect(r.statusCode, JSON.stringify(corpo)).toBe(409);
      expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_IDENTIDADE_IMUTAVEL");
    }
    // E nada mudou de verdade — a recusa não pode ter efeito parcial.
    const depois = j(await detalhe(id));
    expect([depois.codigo, (depois.familia as { codigo: string }).codigo]).toEqual([atual.codigo, FAMILIA]);
  });

  it("o GATILHO barra a troca de família por dentro do banco, não só pela rota", async () => {
    // Uma regra que só existe na API não sobrevive a um acesso direto. Aqui se prova a outra metade.
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Protegida" })) as { id: string }).id;
    const adm = createPool(TEST_URL, { max: 1 });
    try {
      await expect(adm.query("update erp.tipos_operacao set codigo_base='estoque.baixa' where id=$1", [id]))
        .rejects.toThrow(/TIPO_OPERACAO_IDENTIDADE_IMUTAVEL/);
    } finally { await adm.end(); }
  });

  it("o GATILHO torna a versão imutável: nem update nem delete", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Historico" })) as { id: string }).id;
    const adm = createPool(TEST_URL, { max: 1 });
    try {
      await expect(adm.query("update erp.tipos_operacao_versoes set nome='outro' where tipo_operacao_id=$1", [id]))
        .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
      await expect(adm.query("delete from erp.tipos_operacao_versoes where tipo_operacao_id=$1", [id]))
        .rejects.toThrow(/TIPO_OPERACAO_VERSAO_IMUTAVEL/);
    } finally { await adm.end(); }
  });
});

describe("TOP configurada — versionamento", () => {
  it("editar o NOME cria versão N+1 e preserva a anterior legível", async () => {
    const c = codigo();
    const id = (j(await criar({ codigo: c, codigoBase: FAMILIA, nome: "Nome inicial", descricao: "primeira" })) as { id: string }).id;
    const v1 = j(await detalhe(id));
    expect(v1.versao).toBe(1);

    const e = await editar(id, { nome: "Nome corrigido", revisao: v1.revisao });
    expect(e.statusCode, e.body).toBe(200);

    const v2 = j(await detalhe(id));
    expect([v2.versao, v2.nome]).toEqual([2, "Nome corrigido"]);

    const hist = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: h.headers() }));
    const versoes = hist.items as { versao: number; nome: string; descricao: string | null }[];
    expect(versoes.map((v) => v.versao), "histórico da mais nova para a mais antiga").toEqual([2, 1]);
    // A prova que importa: a versão 1 continua dizendo o que dizia. Se a edição tivesse sobrescrito, este
    // nome já seria "Nome corrigido" e nenhuma asserção funcional acima teria notado.
    expect(versoes[1]).toMatchObject({ nome: "Nome inicial", descricao: "primeira" });
  });

  it("mudar só o ESTADO não cria versão — ativo e padrão não são conteúdo", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Estavel" })) as { id: string }).id;
    const antes = j(await detalhe(id));
    await editar(id, { ativo: false, revisao: antes.revisao });
    const depois = j(await detalhe(id));
    expect([depois.versao, depois.ativo]).toEqual([antes.versao, false]);
    expect(depois.revisao, "a revisão sobe mesmo sem versão nova").toBe((antes.revisao as number) + 1);
  });

  it("revisão desatualizada é recusada — sem perda silenciosa de escrita", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Disputada" })) as { id: string }).id;
    const lida = j(await detalhe(id));
    expect((await editar(id, { nome: "Primeira escrita", revisao: lida.revisao })).statusCode).toBe(200);
    // A segunda aba ainda tem a revisão antiga na mão.
    const r = await editar(id, { nome: "Segunda escrita", revisao: lida.revisao });
    expect(r.statusCode).toBe(409);
    expect((j(r).error as { code: string }).code).toBe("CONCURRENCY_CONFLICT");
    expect(j(await detalhe(id)).nome, "a primeira escrita permanece").toBe("Primeira escrita");
  });
});

describe("TOP configurada — padrão por família", () => {
  it("definir padrão tira o padrão anterior na mesma transação", async () => {
    const a = (j(await criar({ codigo: codigo(), codigoBase: "estoque.baixa", nome: "Baixa A", padrao: true })) as { id: string }).id;
    const b = (j(await criar({ codigo: codigo(), codigoBase: "estoque.baixa", nome: "Baixa B" })) as { id: string }).id;
    expect(j(await detalhe(a)).padrao).toBe(true);

    const rb = j(await detalhe(b));
    expect((await editar(b, { padrao: true, revisao: rb.revisao })).statusCode).toBe(200);

    expect(j(await detalhe(b)).padrao).toBe(true);
    expect(j(await detalhe(a)).padrao, "a anterior perde o posto").toBe(false);
  });

  it("desativar quem é padrão tira o posto junto", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: "compras.solicitacao", nome: "Solicitação padrão", padrao: true })) as { id: string }).id;
    const r = j(await detalhe(id));
    await editar(id, { ativo: false, revisao: r.revisao });
    const d = j(await detalhe(id));
    expect([d.ativo, d.padrao]).toEqual([false, false]);
  });

  it("CONCORRÊNCIA REAL: dois pedidos simultâneos de padrão deixam exatamente UMA", async () => {
    const familia = "financeiro.conta_a_pagar";
    const ids = [] as string[];
    for (let i = 0; i < 4; i++) {
      ids.push((j(await criar({ codigo: codigo(), codigoBase: familia, nome: `Pagar ${i}` })) as { id: string }).id);
    }
    const revisoes = await Promise.all(ids.map(async (id) => (j(await detalhe(id)).revisao as number)));
    // Em paralelo de verdade: o índice único parcial e o `for update` decidem quem vence.
    const respostas = await Promise.all(ids.map((id, i) => editar(id, { padrao: true, revisao: revisoes[i]! })));
    expect(respostas.some((r) => r.statusCode === 200), "pelo menos um pedido precisa vencer").toBe(true);

    const adm = createPool(TEST_URL, { max: 1 });
    try {
      const n = await adm.query<{ n: string }>(
        "select count(*) n from erp.tipos_operacao where organization_id=$1 and codigo_base=$2 and padrao and ativo and excluido_em is null",
        [h.demo.orgId, familia]);
      expect(Number(n.rows[0]!.n), "nunca duas padrão na mesma família").toBe(1);
    } finally { await adm.end(); }
  });

  it("o BANCO recusa duas padrão mesmo sem passar pela rota", async () => {
    const familia = "estoque.devolucao";
    const a = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Dev A", padrao: true })) as { id: string }).id;
    const b = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Dev B" })) as { id: string }).id;
    const adm = createPool(TEST_URL, { max: 1 });
    try {
      await expect(adm.query("update erp.tipos_operacao set padrao=true where id=$1", [b]))
        .rejects.toThrow(/ux_tipos_operacao_padrao|duplicate key/);
      expect(a).toBeTruthy();
    } finally { await adm.end(); }
  });
});

describe("TOP configurada — exclusão e unicidade de código", () => {
  it("código duplicado na mesma organização é conflito", async () => {
    const c = codigo();
    expect((await criar({ codigo: c, codigoBase: FAMILIA, nome: "Primeira" })).statusCode).toBe(201);
    const r = await criar({ codigo: c, codigoBase: FAMILIA, nome: "Segunda" });
    expect(r.statusCode).toBe(409);
    expect((j(r).error as { code: string }).code).toBe("CONFLICT");
  });

  it("excluir é lógico, preserva versões e NÃO libera o código", async () => {
    const c = codigo();
    const id = (j(await criar({ codigo: c, codigoBase: FAMILIA, nome: "Para excluir" })) as { id: string }).id;
    expect((await excluir(id, j(await detalhe(id)).revisao as number)).statusCode).toBe(200);
    expect((await detalhe(id)).statusCode, "excluído responde a mesma 404 de inexistente").toBe(404);

    const adm = createPool(TEST_URL, { max: 1 });
    try {
      const v = await adm.query<{ n: string }>("select count(*) n from erp.tipos_operacao_versoes where tipo_operacao_id=$1", [id]);
      expect(Number(v.rows[0]!.n), "excluir a TOP não apaga o histórico").toBeGreaterThan(0);
    } finally { await adm.end(); }

    // Reaproveitar o código faria um relatório antigo apontar para outra identidade.
    expect((await criar({ codigo: c, codigoBase: FAMILIA, nome: "Reaproveitando" })).statusCode).toBe(409);
  });
});

describe("TOP configurada — autorização", () => {
  it("sem capacidade: 403 nas quatro ações, e o servidor é quem nega", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Protegida por permissão" })) as { id: string }).id;
    const op = h.opHeaders();
    const r = await Promise.all([
      h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao", headers: op }),
      criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Nao deve nascer" }, op),
      editar(id, { nome: "Nao deve mudar", revisao: 1 }, op),
      excluir(id, 1, op)
    ]);
    // Pedidos BEM FORMADOS: o 403 tem de vir da capacidade que falta, não de um 422 de entrada.
    expect(r.map((x) => x.statusCode)).toEqual([403, 403, 403, 403]);
  });

  it("CROSS-TENANT: a organização B não lê, não altera e não exclui a TOP de A", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Só da organização A" })) as { id: string }).id;

    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org TOP", adminEmail: "admin-top@demo.local", adminPassword: "Demo@12345", slug: "orgtop" }, () => {});
    await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-top@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const B = { authorization: `Bearer ${tok}`, "x-org-id": o2.orgId };

    // MESMA 404 de inexistente: fora de escopo não se distingue de não existir.
    expect((await detalhe(id, B)).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers: B })).statusCode).toBe(404);
    expect((await editar(id, { nome: "invadido", revisao: 1 }, B)).statusCode).toBe(404);
    // A revisão REAL da linha de A, na mão de B: mesmo assim 404. A ordem "404 antes de 409" é o que impede
    // que a diferença entre os dois códigos vire um oráculo de existência.
    expect((await excluir(id, j(await detalhe(id)).revisao as number, B)).statusCode).toBe(404);

    // E o registro de A continua intacto e invisível na lista de B.
    expect(j(await detalhe(id)).nome).toBe("Só da organização A");
    const listaB = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao", headers: B }));
    expect(listaB.total, "a organização B começa sem nenhuma TOP").toBe(0);
  });
});

/**
 * A TRILHA RESPONDE "QUEM?" PARA TODA MUDANÇA DE ESTADO (bloqueador B da R1).
 *
 * A troca de padrão altera DUAS linhas — a que assume e a que abdica. Só a primeira tinha evento. A segunda
 * mudava de `padrao` e de `revisao` sem autor nenhum, e a pergunta óbvia do administrador ("quem tirou o
 * padrão da 2101?") não tinha resposta em lugar nenhum: nem na trilha, nem na linha, nem na versão — porque
 * `padrao` não é conteúdo e não gera versão.
 *
 * O que se mede aqui é a trilha da linha QUE PERDEU, que é justamente a que ninguém pensa em consultar.
 */
describe("TOP configurada — trilha de auditoria do padrão", () => {
  it("A) B vira padrão e A era padrão: A registra unset_default, B registra set_default", async () => {
    const familia = "estoque.transferencia_entre_armazens";
    const a = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Transferência A", padrao: true })) as { id: string }).id;
    const b = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Transferência B" })) as { id: string }).id;

    expect((await editar(b, { padrao: true, revisao: j(await detalhe(b)).revisao as number })).statusCode).toBe(200);

    expect(acoes(await trilha(b)), "quem assume").toEqual(["create", "set_default"]);
    const trilhaA = await trilha(a);
    expect(acoes(trilhaA), "quem ABDICA — o evento que faltava").toEqual(["create", "set_default", "unset_default"]);
    // E o evento diz para QUEM o posto foi: sem isso, a trilha registra a perda e não explica a causa.
    expect(trilhaA[2]!.metadata).toMatchObject({ novoPadraoId: b });
  });

  it("B) criar já padrão havendo anterior: a anterior perde o posto COM autor", async () => {
    const familia = "estoque.transferencia_entre_empresas";
    const anterior = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Entre empresas antiga", padrao: true })) as { id: string }).id;
    const nova = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Entre empresas nova", padrao: true })) as { id: string }).id;

    expect(j(await detalhe(anterior)).padrao).toBe(false);
    expect(acoes(await trilha(anterior))).toEqual(["create", "set_default", "unset_default"]);
    expect(acoes(await trilha(nova)), "nascer padrão também é set_default explícito").toEqual(["create", "set_default"]);
  });

  it("C) a PRIMEIRA padrão da família: create + set_default, e ninguém perde nada", async () => {
    const familia = "estoque.producao_de_racao";
    const primeira = (j(await criar({ codigo: codigo(), codigoBase: familia, nome: "Ração padrão", padrao: true })) as { id: string }).id;
    expect(acoes(await trilha(primeira))).toEqual(["create", "set_default"]);
    // NÃO INVENTAR EVENTO é a outra metade do bloqueador: auditar a INTENÇÃO (e não o `returning`)
    // registraria uma perda que não aconteceu, e a trilha passaria a mentir exatamente onde é consultada.
    const adm = createPool(TEST_URL, { max: 1 });
    try {
      const n = await adm.query<{ n: string }>(
        "select count(*) n from erp.audit_logs where entity='tipos_operacao' and action='unset_default' and metadata->>'codigoBase'=$1", [familia]);
      expect(Number(n.rows[0]!.n), "sem padrão anterior, nenhum unset_default é inventado").toBe(0);
    } finally { await adm.end(); }
  });

  it("D) desativar a padrão registra deactivate E unset_default", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: "vendas.orcamento", nome: "Orçamento padrão", padrao: true })) as { id: string }).id;
    expect((await editar(id, { ativo: false, revisao: j(await detalhe(id)).revisao as number })).statusCode).toBe(200);
    // Duas coisas aconteceram com a linha, e a trilha registra as duas: uma ação por mudança.
    expect(acoes(await trilha(id))).toEqual(["create", "set_default", "deactivate", "unset_default"]);
  });

  it("E) excluir a padrão registra unset_default E delete", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: "financeiro.conta_a_receber", nome: "Receber padrão", padrao: true })) as { id: string }).id;
    expect((await excluir(id, j(await detalhe(id)).revisao as number)).statusCode).toBe(200);
    // Sem o unset_default, a família fica sem padrão e a trilha só mostra um `delete` — de onde ninguém
    // deduz que o posto vagou.
    expect(acoes(await trilha(id))).toEqual(["create", "set_default", "unset_default", "delete"]);
  });
});

/**
 * SALVAR SEM ALTERAR NÃO É ESCRITA (bloqueador C.1 da R1).
 *
 * O custo do `update` inútil não é o `update`: é a REVISÃO. Ela é a moeda do controle de concorrência, e
 * incrementá-la sem motivo invalidava toda outra aba aberta na mesma TOP — que passava a receber 409 por
 * uma mudança que nunca existiu. Junto vinha um `update` sem diff na trilha, que ninguém sabe ler.
 */
describe("TOP configurada — no-op", () => {
  it("reenviar o mesmo conteúdo não grava, não versiona, não incrementa e não audita", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Imutada", descricao: "igual" })) as { id: string }).id;
    const antes = j(await detalhe(id));
    const eventosAntes = (await trilha(id)).length;

    const r = await editar(id, {
      nome: antes.nome, descricao: antes.descricao, ativo: antes.ativo, padrao: antes.padrao, revisao: antes.revisao
    });
    expect(r.statusCode, r.body).toBe(200);

    const depois = j(await detalhe(id));
    expect(depois.revisao, "a revisão NÃO sobe").toBe(antes.revisao);
    expect(depois.versao, "nenhuma versão nova").toBe(antes.versao);
    expect(depois.atualizadoEm, "`atualizado_em` intacto").toBe(antes.atualizadoEm);
    expect((await trilha(id)).length, "nenhum evento de auditoria").toBe(eventosAntes);
    expect(j(r).revisao, "a resposta devolve o estado atual, não um estado novo").toBe(antes.revisao);

    // A PREMISSA: a mesma rota, com uma mudança de verdade, SOBE a revisão. Sem este par, um handler que
    // simplesmente não gravasse nada passaria no teste acima.
    expect((await editar(id, { nome: "Agora mudou", revisao: antes.revisao as number })).statusCode).toBe(200);
    expect(j(await detalhe(id)).revisao).toBe((antes.revisao as number) + 1);
  });

  it("o no-op não consome a revisão: a aba ao lado continua podendo editar", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Duas abas" })) as { id: string }).id;
    const lida = j(await detalhe(id));
    // Aba 1 salva sem mexer em nada.
    expect((await editar(id, { nome: lida.nome, revisao: lida.revisao })).statusCode).toBe(200);
    // Aba 2, aberta antes, ainda tem a MESMA revisão — e tem de continuar valendo.
    const r = await editar(id, { nome: "Escrita legítima da aba 2", revisao: lida.revisao });
    expect(r.statusCode, "o no-op não pode ter invalidado a outra aba").toBe(200);
    expect(j(await detalhe(id)).nome).toBe("Escrita legítima da aba 2");
  });
});

/**
 * CONTRATO DE ENTRADA NÃO CANÔNICO É RECUSADO (bloqueador C.2 da R1).
 *
 * `z.object` descarta chave desconhecida EM SILÊNCIO. `{"ativoo": false}` virava 200 com o campo ignorado:
 * o administrador lia "salvo" e a TOP continuava ativa. Num cadastro de configuração isso é especialmente
 * caro, porque ninguém confere o efeito depois.
 */
describe("TOP configurada — entrada estrita", () => {
  it("campo desconhecido na criação é 422, e nada é gravado", async () => {
    const c = codigo();
    const r = await criar({ codigo: c, codigoBase: FAMILIA, nome: "Com typo", ativoo: false });
    expect(r.statusCode, r.body).toBe(422);
    const lista = j(await h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao?search=${c}`, headers: h.headers() }));
    expect(lista.total, "recusa não deixa rastro").toBe(0);
  });

  it("campo desconhecido na edição é 422 — e o estado NÃO muda", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Estrita", ativo: true })) as { id: string }).id;
    const antes = j(await detalhe(id));
    const r = await editar(id, { ativoo: false, revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(422);
    const depois = j(await detalhe(id));
    // O defeito original: 200 com o campo descartado. A TOP seguia ATIVA e a revisão subia mesmo assim.
    expect([depois.ativo, depois.revisao]).toEqual([true, antes.revisao]);
  });

  it("revisão ausente na exclusão é 422 — a porta que tinha ficado aberta", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Sem revisão" })) as { id: string }).id;
    const r = await h.app.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${id}`, headers: h.headers() });
    expect(r.statusCode, r.body).toBe(422);
    expect((await detalhe(id)).statusCode, "a TOP continua lá").toBe(200);
  });
});

/**
 * EXCLUIR TAMBÉM PERDE PARA UMA EDIÇÃO MAIS NOVA (bloqueador C.3 da R1).
 *
 * Era o único caminho de escrita sem `revisao`: o administrador A lia a revisão 5, o B editava (virava 6), e
 * o A excluía com a tela velha. A exclusão vencia em silêncio uma alteração que o A nunca viu — o mesmo
 * lost update que o PUT já impedia, pela porta que tinha sobrado.
 */
describe("TOP configurada — concorrência na exclusão", () => {
  it("revisão velha é 409 e a TOP CONTINUA existindo", async () => {
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Disputada na exclusão" })) as { id: string }).id;
    const lida = j(await detalhe(id));

    // O administrador B edita primeiro.
    expect((await editar(id, { nome: "Edição que o A não viu", revisao: lida.revisao })).statusCode).toBe(200);

    const r = await excluir(id, lida.revisao as number);
    expect(r.statusCode, r.body).toBe(409);
    expect((j(r).error as { code: string }).code).toBe("CONCURRENCY_CONFLICT");
    // A conclusão que importa: a edição do B sobreviveu.
    expect((await detalhe(id)).statusCode).toBe(200);
    expect(j(await detalhe(id)).nome).toBe("Edição que o A não viu");
  });

  it("com a revisão corrente, a exclusão acontece", async () => {
    // A PREMISSA do caso acima: sem ela, um handler que recusasse SEMPRE passaria no 409 provando nada.
    const id = (j(await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Recarregada" })) as { id: string }).id;
    const r = await excluir(id, j(await detalhe(id)).revisao as number);
    expect(r.statusCode, r.body).toBe(200);
    expect((await detalhe(id)).statusCode).toBe(404);
  });

  it("id inexistente responde 404 mesmo com revisão errada — 409 não vira oráculo", async () => {
    const r = await excluir("00000000-0000-0000-0000-000000000000", 999);
    expect(r.statusCode).toBe(404);
  });
});

describe("TOP configurada — listagem", () => {
  it("filtra por família e por módulo, e o módulo sai do registry", async () => {
    const c = codigo();
    await criar({ codigo: c, codigoBase: "frota_ativos.abastecimento", nome: "Abastecimento configurado" });

    const porFamilia = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao?codigoBase=frota_ativos.abastecimento", headers: h.headers() }));
    expect((porFamilia.items as unknown[]).length).toBeGreaterThan(0);

    const porModulo = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao?modulo=frota_ativos", headers: h.headers() }));
    const codigos = (porModulo.items as { codigo: string }[]).map((x) => x.codigo);
    expect(codigos).toContain(c);
    // Um módulo sem nenhuma TOP configurada devolve vazio — e não "todas", que é o erro clássico.
    const vazio = j(await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao?modulo=ordens_servico", headers: h.headers() }));
    expect(vazio.total).toBe(0);
  });
});
