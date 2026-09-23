import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPool, seedDemo } from "@agro/db";
import {
  configuracaoNeutraTop, configuracaoNeutraTopV2, configuracaoTopParaEdicao, SECOES_CONFIGURACAO_TOP,
  VERSAO_SCHEMA_CONFIGURACAO_TOP, VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, VERSOES_SCHEMA_CONFIGURACAO_TOP
} from "@agro/domain";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CONFIGURAÇÃO VERSIONADA DA TOP — O QUE ESTE ARQUIVO PRECISA PROVAR.
 *
 * O CRUD já é provado em `tipos-operacao.test.ts`. O que muda aqui é que a TOP passa a carregar um
 * DOCUMENTO — e documento tem três modos de falhar que nenhuma asserção funcional de CRUD nota:
 *
 *   1. COMPATIBILIDADE: o cliente ANTIGO (que não conhece `configuracao`) continua criando e editando, e
 *      o que ele cria nasce NEUTRO — não "com a configuração de alguém" nem sem configuração nenhuma;
 *   2. VERSIONAMENTO: configuração é CONTEÚDO. Mudá-la cria versão; mudar só estado não cria; mudar nome
 *      E configuração juntos cria UMA, não duas — e cada versão guarda a configuração DELA;
 *   3. RECUSA: payload inválido e schema desconhecido são 422 com códigos DIFERENTES, porque o cliente
 *      resolve as duas coisas de formas diferentes — e a recusa não deixa rastro.
 *
 * Nada aqui prova EFEITO de estoque, financeiro ou fiscal. Desde a TOP-CONFIG-04A a configuração PODE
 * executar — mas só com o bloco `execucao` do formato 2 em `configurada`, e isso é provado nos arquivos da
 * própria fatia (`tipos-operacao-execucao.test.ts`, `sales-top-execucao.test.ts`). Aqui, toda
 * configuração leva os dois efeitos em `legado`: este arquivo continua medindo o DOCUMENTO.
 *
 * O FORMATO QUE ESTE ARQUIVO USA MUDOU COM A TOP-CONFIG-04A, E ISSO É CONTRATO, NÃO AFROUXAMENTO: TOP
 * criada sem configuração nasce no formato 2 (legado/legado), e o formato não retrocede — um corpo no
 * formato 1 sobre uma versão no formato 2 é recusado. Por isso a configuração "rica" daqui é a mesma de
 * antes, no formato 2; o caminho do formato 1 (o cliente anterior) tem casos próprios abaixo.
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
async function excluir(id: string, revisao: number, headers = h.headers()) {
  return h.app.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${id}?revisao=${revisao}`, headers });
}
async function versoes(id: string, headers = h.headers()) {
  return h.app.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}/versoes`, headers });
}
async function trilha(id: string): Promise<{ action: string; metadata: Record<string, unknown> | null }[]> {
  const adm = createPool(TEST_URL, { max: 1 });
  try {
    const r = await adm.query<{ action: string; metadata: Record<string, unknown> | null }>(
      "select action, metadata from erp.audit_logs where entity='tipos_operacao' and entity_id=$1 order by created_at, id", [id]);
    return r.rows;
  } finally { await adm.end(); }
}

/** Códigos distintos por caso: a unicidade é por organização e a suíte compartilha uma. */
let sequencia = 0;
const codigo = () => `23${String(++sequencia).padStart(2, "0")}`;

/** Uma configuração DIFERENTE da neutra em TODAS as cinco seções — para `secoesAlteradas` ter o que dizer. */
function configuracaoRicaV1() {
  const c = configuracaoNeutraTop();
  c.geral.exigeParceiro = true;
  c.estoque.atualizacao = "saida";
  c.estoque.exigeArmazem = true;
  c.financeiro.atualizacao = "receber";
  c.financeiro.exigeVencimento = true;
  c.fiscal.habilitado = true;
  c.fiscal.exigeDocumentoFiscal = true;
  c.aprovacao.politica = "por_valor";
  c.aprovacao.valorMinimo = "10000.00";
  return c;
}
/** A mesma configuração rica, no formato 2 e com os dois efeitos em `legado` — o que o editor atual envia. */
const configuracaoRica = () => configuracaoTopParaEdicao(configuracaoRicaV1());

/** Cria uma TOP e devolve o id — o caminho que toda seção abaixo usa como premissa. */
async function nova(corpo: Record<string, unknown> = {}) {
  const r = await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "TOP de configuração", ...corpo });
  expect(r.statusCode, r.body).toBe(201);
  return (j(r) as { id: string }).id;
}

describe("configuração da TOP — descoberta de capacidade", () => {
  it("a API DECLARA o que sabe fazer: versão de contrato, versão de schema e as seções", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.headers() });
    expect(r.statusCode, r.body).toBe(200);
    const d = j(r);
    expect(d.contractVersion).toBe(1);
    // As seções servidas SÃO as do domínio. Uma segunda lista no servidor (ou no cliente) divergiria na
    // primeira seção nova, e a tela nasceria sem a aba sem nada quebrar.
    expect(d.configuracao).toEqual({
      versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP,
      secoes: [...SECOES_CONFIGURACAO_TOP]
    });
  });

  it("perguntar a capacidade exige `view`, não `create`: quem só lê também precisa saber", async () => {
    // A premissa: o papel operador NÃO tem a capacidade administrativa — e recebe 403 na própria rota.
    const r = await h.app.inject({ method: "GET", url: "/api/admin/tipos-operacao/capabilities", headers: h.opHeaders() });
    expect(r.statusCode).toBe(403);
  });
});

describe("configuração da TOP — o cliente ANTIGO continua funcionando", () => {
  it("criar SEM citar `configuracao` nasce NEUTRO — nem ausente, nem herdado — no formato 2, com os dois efeitos em legado", async () => {
    // TOP-CONFIG-04A: o neutro de uma TOP NOVA é o formato 2. Nenhuma TOP nasce executando configuração.
    const id = await nova();
    const d = j(await detalhe(id));
    expect(d.configuracaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP_V2);
    expect(d.configuracao).toEqual({
      suportada: true, versaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2, valor: configuracaoNeutraTopV2()
    });
  });

  it("o cliente anterior cria e edita no FORMATO 1, e o que ele grava continua formato 1 — sem tradução", async () => {
    const v1 = configuracaoRicaV1();
    const id = await nova({ configuracao: v1 });
    const d = j(await detalhe(id));
    expect(d.configuracaoSchema).toBe(VERSAO_SCHEMA_CONFIGURACAO_TOP);
    expect((d.configuracao as { valor: unknown }).valor).toEqual(v1);
    const mudada = configuracaoRicaV1();
    mudada.geral.exigeObservacao = true;
    expect((await editar(id, { configuracao: mudada, revisao: d.revisao })).statusCode).toBe(200);
    const depois = j(await detalhe(id));
    expect([depois.versao, depois.configuracaoSchema]).toEqual([2, VERSAO_SCHEMA_CONFIGURACAO_TOP]);
    expect((depois.configuracao as { valor: unknown }).valor).toEqual(mudada);
  });

  it("editar SEM citar `configuracao` PRESERVA a que existe — ausente não é 'apague'", async () => {
    const rica = configuracaoRica();
    const id = await nova({ configuracao: rica });
    const antes = j(await detalhe(id));

    // Exatamente o corpo do cliente anterior: ele não conhece o campo.
    expect((await editar(id, { nome: "Renomeada pelo cliente antigo", revisao: antes.revisao })).statusCode).toBe(200);

    const depois = j(await detalhe(id));
    expect(depois.nome).toBe("Renomeada pelo cliente antigo");
    // A prova que importa: sem isto, um cliente antigo zeraria em silêncio a configuração de quem usa o novo.
    expect((depois.configuracao as { valor: unknown }).valor).toEqual(rica);
  });
});

describe("configuração da TOP — configuração é CONTEÚDO", () => {
  it("mudar SÓ a configuração cria versão N+1", async () => {
    const id = await nova();
    const antes = j(await detalhe(id));
    expect(antes.versao).toBe(1);

    const r = await editar(id, { configuracao: configuracaoRica(), revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);

    const depois = j(await detalhe(id));
    expect(depois.versao, "configuração nova é conteúdo novo").toBe(2);
    expect(depois.nome, "e o nome não mudou junto").toBe(antes.nome);
  });

  it("mudar SÓ o estado NÃO cria versão, mesmo com configuração rica guardada", async () => {
    const id = await nova({ configuracao: configuracaoRica() });
    const antes = j(await detalhe(id));
    expect((await editar(id, { ativo: false, revisao: antes.revisao })).statusCode).toBe(200);
    const depois = j(await detalhe(id));
    expect([depois.versao, depois.ativo]).toEqual([antes.versao, false]);
    expect((depois.configuracao as { valor: unknown }).valor,
      "ativar/desativar não pode tocar no documento").toEqual((antes.configuracao as { valor: unknown }).valor);
  });

  it("mudar NOME e CONFIGURAÇÃO no mesmo pedido cria UMA versão, não duas", async () => {
    const id = await nova();
    const antes = j(await detalhe(id));
    expect((await editar(id, { nome: "Tudo junto", configuracao: configuracaoRica(), revisao: antes.revisao })).statusCode).toBe(200);
    const depois = j(await detalhe(id));
    // Duas versões aqui significaria que a edição grava em dois passos — e um passo poderia falhar sozinho.
    expect([depois.versao, depois.nome]).toEqual([2, "Tudo junto"]);
  });

  it("reenviar a MESMA configuração é no-op: sem versão, sem revisão, sem auditoria", async () => {
    const rica = configuracaoRica();
    const id = await nova({ configuracao: rica });
    const antes = j(await detalhe(id));
    const eventosAntes = (await trilha(id)).length;

    // Reordenada de propósito: JSON com as mesmas chaves em outra ordem É a mesma configuração. Comparar
    // texto bruto criaria versão a cada salvamento de um editor que serializa diferente.
    const reordenada = JSON.parse(JSON.stringify({ ...rica, aprovacao: rica.aprovacao, geral: rica.geral }));
    const r = await editar(id, { nome: antes.nome, configuracao: reordenada, revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(200);

    const depois = j(await detalhe(id));
    expect(depois.revisao, "a revisão NÃO sobe").toBe(antes.revisao);
    expect(depois.versao, "nenhuma versão nova").toBe(antes.versao);
    expect((await trilha(id)).length, "nenhum evento").toBe(eventosAntes);

    // A PREMISSA do no-op: a mesma rota, com uma mudança REAL de configuração, cria versão.
    const mudada = configuracaoRica();
    mudada.geral.exigeObservacao = true;
    expect((await editar(id, { configuracao: mudada, revisao: antes.revisao })).statusCode).toBe(200);
    expect(j(await detalhe(id)).versao).toBe((antes.versao as number) + 1);
  });
});

describe("configuração da TOP — auditoria diz O QUE mudou", () => {
  it("o evento de edição nomeia as SEÇÕES alteradas e a versão de schema", async () => {
    const id = await nova();
    const antes = j(await detalhe(id));
    const rica = configuracaoRica();
    expect((await editar(id, { configuracao: rica, revisao: antes.revisao })).statusCode).toBe(200);

    const t = await trilha(id);
    const update = t.filter((x) => x.action === "update").at(-1);
    expect(update, "a edição precisa ter deixado um evento").toBeTruthy();
    expect(update!.metadata).toMatchObject({ configuracaoSchema: VERSAO_SCHEMA_CONFIGURACAO_TOP_V2 });
    // As cinco seções mudaram — e a trilha diz quais, não apenas "mudou alguma coisa".
    expect([...(update!.metadata!.secoesAlteradas as string[])].sort()).toEqual([...SECOES_CONFIGURACAO_TOP].sort());
  });

  it("edição que NÃO toca configuração registra `secoesAlteradas` vazio, não nulo nem ausente", async () => {
    const id = await nova({ configuracao: configuracaoRica() });
    const antes = j(await detalhe(id));
    expect((await editar(id, { nome: "Só o nome", revisao: antes.revisao })).statusCode).toBe(200);
    const update = (await trilha(id)).filter((x) => x.action === "update").at(-1);
    expect(update!.metadata!.secoesAlteradas, "lista vazia = 'nada mudou', que é o fato").toEqual([]);
  });
});

describe("configuração da TOP — o histórico mostra a configuração DE CADA VERSÃO", () => {
  it("a versão 1 continua neutra depois que a 2 ficou rica", async () => {
    const id = await nova();
    const rica = configuracaoRica();
    expect((await editar(id, { nome: "Agora configurada", configuracao: rica, revisao: j(await detalhe(id)).revisao })).statusCode).toBe(200);

    const items = (j(await versoes(id)).items) as { versao: number; configuracao: { suportada: boolean; valor?: unknown }; secoesAlteradas: string[] | null }[];
    expect(items.map((v) => v.versao), "da mais nova para a mais antiga").toEqual([2, 1]);
    expect(items[0]!.configuracao.valor).toEqual(rica);
    // Esta é a asserção pela qual a configuração mora na VERSÃO: se ela morasse na TOP, a linha de baixo
    // já leria a configuração rica — e o histórico estaria mentindo com cara de registro.
    expect(items[1]!.configuracao.valor).toEqual(configuracaoNeutraTopV2());
  });

  it("`secoesAlteradas` é derivada por comparação, e a versão mais antiga não tem com o que comparar", async () => {
    const id = await nova();
    const rica = configuracaoRica();
    rica.estoque.atualizacao = "nenhuma"; // deixa estoque IGUAL ao neutro de propósito
    rica.estoque.exigeArmazem = false;
    expect((await editar(id, { configuracao: rica, revisao: j(await detalhe(id)).revisao })).statusCode).toBe(200);

    const items = (j(await versoes(id)).items) as { versao: number; secoesAlteradas: string[] | null }[];
    // Só as seções que REALMENTE mudaram — `estoque` ficou de fora porque foi reenviada igual.
    expect([...items[0]!.secoesAlteradas!].sort()).toEqual(["aprovacao", "financeiro", "fiscal", "geral"]);
    // `null`, e não `[]`: "não há versão anterior" é diferente de "nada mudou".
    expect(items[1]!.secoesAlteradas).toBeNull();
  });

  it("excluir a TOP não apaga a configuração das versões", async () => {
    const id = await nova({ configuracao: configuracaoRica() });
    expect((await excluir(id, j(await detalhe(id)).revisao as number)).statusCode).toBe(200);
    const adm = createPool(TEST_URL, { max: 1 });
    try {
      const r = await adm.query<{ n: string }>(
        "select count(*) n from erp.tipos_operacao_versoes where tipo_operacao_id=$1 and configuracao->'estoque'->>'atualizacao'='saida'", [id]);
      expect(Number(r.rows[0]!.n), "a exclusão é lógica; o documento histórico permanece").toBeGreaterThan(0);
    } finally { await adm.end(); }
  });
});

describe("configuração da TOP — a recusa", () => {
  it("configuração inválida é 422 com código próprio, e NADA é gravado", async () => {
    const id = await nova();
    const antes = j(await detalhe(id));
    const quebrada = configuracaoRica();
    (quebrada.estoque as unknown as Record<string, unknown>).atualizacao = "teletransporte";

    const r = await editar(id, { configuracao: quebrada, revisao: antes.revisao });
    expect(r.statusCode, r.body).toBe(422);
    expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");

    const depois = j(await detalhe(id));
    expect([depois.versao, depois.revisao], "recusa sem efeito parcial").toEqual([antes.versao, antes.revisao]);
  });

  it("versão de schema desconhecida é 422 com código DIFERENTE do de payload inválido", async () => {
    // Não é a mesma situação: aqui o cliente não tem o que corrigir no formulário — ele precisa recarregar.
    // O sentinela é o maior formato conhecido + 1: o 2 passou a existir com a TOP-CONFIG-04A.
    const futura = { ...configuracaoRica(), versaoSchema: Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1 };
    const r = await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Do futuro", configuracao: futura });
    expect(r.statusCode, r.body).toBe(422);
    expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_CONFIGURACAO_SCHEMA_NAO_SUPORTADO");
  });

  it("campo desconhecido DENTRO da configuração é recusado, não descartado em silêncio", async () => {
    // `z.object` descarta chave desconhecida; um documento de configuração que faz isso diz "salvo" sobre
    // uma regra que não existe. O domínio valida estrito exatamente por isto.
    const comLixo = configuracaoRica() as unknown as Record<string, Record<string, unknown>>;
    comLixo.estoque!.baixaAutomaticaDeTudo = true;
    const r = await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Com campo inventado", configuracao: comLixo });
    expect(r.statusCode, r.body).toBe(422);
    expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
  });

  it("configuração que não é objeto é recusada pelo mesmo código", async () => {
    for (const bruta of [null, [], "neutra", 7]) {
      const r = await criar({ codigo: codigo(), codigoBase: FAMILIA, nome: "Forma errada", configuracao: bruta });
      expect(r.statusCode, JSON.stringify(bruta)).toBe(422);
      expect((j(r).error as { code: string }).code).toBe("TIPO_OPERACAO_CONFIGURACAO_INVALIDA");
    }
  });

  it("revisão desatualizada é recusada ANTES da configuração ser gravada", async () => {
    const id = await nova();
    const lida = j(await detalhe(id));
    expect((await editar(id, { nome: "Primeira", revisao: lida.revisao })).statusCode).toBe(200);
    const r = await editar(id, { configuracao: configuracaoRica(), revisao: lida.revisao });
    expect(r.statusCode).toBe(409);
    expect((j(r).error as { code: string }).code).toBe("CONCURRENCY_CONFLICT");
    expect((j(await detalhe(id)).configuracao as { valor: unknown }).valor,
      "a escrita perdida não pode ter deixado metade").toEqual(configuracaoNeutraTopV2());
  });
});

describe("configuração da TOP — isolamento", () => {
  it("CROSS-TENANT: a organização B não lê a configuração de A por nenhuma das duas portas", async () => {
    const id = await nova({ configuracao: configuracaoRica() });

    const adm = createPool(TEST_URL, { max: 1 });
    const o2 = await seedDemo(adm, { orgName: "[TEST] Org TOP CFG", adminEmail: "admin-topcfg@demo.local", adminPassword: "Demo@12345", slug: "orgtopcfg" }, () => {});
    await adm.end();
    const tok = (j(await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-topcfg@demo.local", password: "Demo@12345" } })) as { token: string }).token;
    const B = { authorization: `Bearer ${tok}`, "x-org-id": o2.orgId };

    expect((await detalhe(id, B)).statusCode, "mesma 404 de inexistente").toBe(404);
    expect((await versoes(id, B)).statusCode).toBe(404);
    expect((await editar(id, { configuracao: configuracaoNeutraTop(), revisao: 1 }, B)).statusCode).toBe(404);

    // E o documento de A continua exatamente como era.
    expect((j(await detalhe(id)).configuracao as { valor: unknown }).valor).toEqual(configuracaoRica());
  });
});
