import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedDemo } from "@agro/db";
import {
  CAMPOS_DESTINO_ESTOQUE, ESPECIES_COM_DESTINO_PELA_TOP, LAYOUT_DO_SISTEMA, RECURSO_DA_ESPECIE_ESTOQUE, TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  regrasDaOperacaoDoEstoque,
  type CampoDoLayout, type ColunaDoLayout, type ColunaDestinoEstoque, type DimensaoDestinoEstoque, type EspecieEstoque, type EstruturaLayout,
} from "@agro/domain";
import {
  c, iniciar, encerrar, top, topDe, topV5, familia, segmento, produto, armazem, saldoInicial, membro, escopos, j, unico, lancarDoc, lancadoDoc,
  confirmadoDoc, itensNoBanco, cabecalho, detalhes, contarDocumentos, type Hdr, type Resposta,
} from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F5b (decisão 282) — A API DA TELA DO ESTOQUE: as três rotas de LEITURA que a Central de Estoque (no
 * motor da Central) usa, com o contrato das Centrais de Vendas e de Compras.
 *
 *   · RT-1..RT-3 `GET /api/estoque/<segmento>/regras-da-operacao?tipo_operacao_id=` — a MESMA 404 para toda TOP que não
 *          serve; 403 sem `<recurso>.create`; o neutro (formatos 1 a 4, e o 5 no neutro: nada novo é exigido); no
 *          formato 5, a resposta é a do domínio (`regrasDaOperacaoDoEstoque`) e o POST cobra exatamente o que ela diz;
 *   · LE-1 `GET /api/estoque/<segmento>/layout-efetivo?tipo_operacao_id=` — o contrato de vendas e compras (sistema,
 *          ligado, padrão da família, o Local de estoque padrão por registro), a mesma 404;
 *   · LE-2 o admin de layouts (`/api/admin/layouts-documento`) aceita as famílias de estoque, com as recusas do domínio;
 *   · DO-1..DO-3 `GET /api/estoque/<segmento>/destino/opcoes` (só saída, requisição e consumo) — só os alvos VÁLIDOS
 *          voltam, na ordem do servidor, com busca e limite; as recusas dos parâmetros, da empresa e da porta; e a
 *          RÉGUA ÚNICA: toda opção devolvida é aceita no POST de uma saída, e todo alvo inválido é recusado com a
 *          mensagem da F5a.
 *
 * O QUE CONTA COMO PROVA: cada caso afirma a PREMISSA (o alvo inválido EXISTE no banco, a TOP válida responde 200, o
 * mesmo membro com a capacidade abre…). Os valores esperados — o neutro, as mensagens, as colunas do layout do
 * sistema, os rótulos — estão escritos AQUI, à mão: um domínio errado não se aprova sozinho. As gravações (POST) são
 * lidas no banco pela testemunha (superusuário, sem RLS).
 */

/** O cabeçalho da outra organização (a TOP de outro tenant). */
let outra: Hdr;

beforeAll(async () => {
  await iniciar();
  const o = await seedDemo(c.admin, { orgName: "[TEST] Org F5b", adminEmail: "admin-f5b@demo.local", adminPassword: "Demo@12345", slug: "orgf5btela" }, () => {});
  const login = await c.h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin-f5b@demo.local", password: "Demo@12345" } });
  expect(login.statusCode, login.body).toBe(200);
  outra = { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": o.orgId };
}, 240_000);
afterAll(encerrar);

const NAO_ACHADO = "00000000-0000-4000-8000-000000000000";
/** A 404 da TOP que não serve — o corpo inteiro, escrito à mão. */
const CORPO_DA_404 = { error: { code: "NOT_FOUND", message: "Tipo de operação não encontrado" } };
/** A 404 de ROTA (a rota não existe nesta espécie). */
const CORPO_DA_ROTA_INEXISTENTE = { error: { code: "NOT_FOUND", message: "Rota não encontrada" } };

const item = (produtoId: string, quantidade: string, extra: Record<string, unknown> = {}) => ({ produto_id: produtoId, quantidade, ...extra });
const perms = (especie: EspecieEstoque, acoes: string[]) => acoes.map((a) => `${RECURSO_DA_ESPECIE_ESTOQUE[especie]}.${a}`);

const regras = (especie: EspecieEstoque, query: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/regras-da-operacao${query}`, headers });
const efetivo = (especie: EspecieEstoque, query: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/layout-efetivo${query}`, headers });
const comTop = (id: string) => `?tipo_operacao_id=${id}`;

// ─────────────── a TOP que não serve ───────────────

/** Uma TOP da família, INATIVADA pela porta administrativa. Premissa: o banco diz inativa. */
async function topInativa(codigoBase: string): Promise<string> {
  const id = await top(codigoBase);
  const rev = j(await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: c.h.headers() })).revisao as number;
  const r = await c.ligada.inject({ method: "PUT", url: `/api/admin/tipos-operacao/${id}`, headers: c.h.headers(), payload: { ativo: false, revisao: rev } });
  expect(r.statusCode, r.body).toBe(200);
  const b = (await c.admin.query<{ ativo: boolean }>("select ativo from erp.tipos_operacao where id = $1", [id])).rows[0]!;
  expect(b.ativo, "premissa: a TOP está inativa no banco").toBe(false);
  return id;
}
/** Uma TOP da família, EXCLUÍDA pela porta administrativa. Premissa: o banco diz excluída. */
async function topExcluida(codigoBase: string): Promise<string> {
  const id = await top(codigoBase);
  const rev = j(await c.ligada.inject({ method: "GET", url: `/api/admin/tipos-operacao/${id}`, headers: c.h.headers() })).revisao as number;
  const r = await c.ligada.inject({ method: "DELETE", url: `/api/admin/tipos-operacao/${id}?revisao=${rev}`, headers: c.h.headers() });
  expect(r.statusCode, r.body).toBe(200);
  const b = (await c.admin.query<{ excluida: boolean }>("select excluido_em is not null as excluida from erp.tipos_operacao where id = $1", [id])).rows[0]!;
  expect(b.excluida, "premissa: a TOP está excluída no banco").toBe(true);
  return id;
}

/**
 * Os casos da MESMA 404 na porta da SAÍDA, com a TOP VÁLIDA ao lado (a premissa). A TOP de outra organização vem com o
 * cabeçalho dela, para a premissa de que ela responde lá (a 404 aqui é recorte de tenant, não TOP quebrada).
 */
async function casosDaMesma404(): Promise<{ casos: [string, string][]; valida: string; deOutraOrg: string }> {
  const valida = await top(familia("saida"));
  const deOutraOrg = await top(familia("saida"), {}, outra);
  const casos: [string, string][] = [
    ["ausente", ""],
    ["malformada", "?tipo_operacao_id=nao-e-uuid"],
    ["inexistente", comTop(NAO_ACHADO)],
    ["repetida", `?tipo_operacao_id=${valida}&tipo_operacao_id=${valida}`],
    ["de outra família (a entrada na porta da saída)", comTop(topDe("entrada"))],
    ["de outra família (a requisição na porta da saída)", comTop(topDe("requisicao"))],
    ["de vendas", comTop(await top("vendas.pedido"))],
    ["inativa", comTop(await topInativa(familia("saida")))],
    ["excluída", comTop(await topExcluida(familia("saida")))],
    ["de outra organização", comTop(deOutraOrg)],
  ];
  return { casos, valida, deOutraOrg };
}

// ─────────────── o que se espera, escrito à mão ───────────────

const DESTINO_NEUTRO = { centroCusto: "nao_usada", equipamento: "nao_usada", ordemServico: "nao_usada", loteAnimais: "nao_usada", area: "nao_usada", safra: "nao_usada" };
const FLUXO_NEUTRO = { exigeRequisicao: "nao", permiteParcial: true };
/** O neutro de cada espécie: o Destino só onde a TOP o configura (saída, requisição e consumo); o Fluxo, só no consumo. */
const NEUTRO_DA_ESPECIE: Readonly<Record<EspecieEstoque, { destino: unknown; fluxo: unknown }>> = {
  entrada: { destino: null, fluxo: null },
  saida: { destino: DESTINO_NEUTRO, fluxo: null },
  transferencia: { destino: null, fluxo: null },
  ajuste: { destino: null, fluxo: null },
  requisicao: { destino: DESTINO_NEUTRO, fluxo: null },
  consumo: { destino: DESTINO_NEUTRO, fluxo: FLUXO_NEUTRO },
  devolucao_consumo: { destino: null, fluxo: null },
};

/** A configuração da versão ATUAL da TOP, lida no banco (o que o domínio recebe). */
async function configuracaoAtual(topId: string): Promise<{ configuracao: unknown; formato: number }> {
  const r = await c.admin.query<{ configuracao: unknown; formato: number }>(
    `select v.configuracao, v.configuracao_schema_version as formato from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.versao = t.versao_atual where t.id = $1`, [topId]);
  expect(r.rows, "premissa: a TOP tem a versão atual").toHaveLength(1);
  return r.rows[0]!;
}

// ═══════════════════════════════ RT — regras da operação ═══════════════════════════════

describe("RT-1 — /regras-da-operacao: a MESMA 404 para toda TOP que não serve; 403 sem a porta; parâmetro estranho 422", () => {
  it("RT-1a ausente, malformada, repetida, inexistente, de outra família, de vendas, inativa, excluída e de outra organização → o MESMO corpo 404; premissa: a válida responde 200", async () => {
    const { casos, valida, deOutraOrg } = await casosDaMesma404();
    for (const [caso, query] of casos) {
      const r = await regras("saida", query);
      expect(r.statusCode, `${caso}: ${r.body}`).toBe(404);
      expect(JSON.parse(r.body), caso).toEqual(CORPO_DA_404);
    }
    // PREMISSAS: a válida responde 200 na porta dela; a da outra organização responde 200 lá.
    expect((await regras("saida", comTop(valida))).statusCode).toBe(200);
    expect((await regras("saida", comTop(deOutraOrg), outra)).statusCode).toBe(200);
    // A TOP da SAÍDA na porta da ENTRADA também é a mesma 404 (a família é a da rota).
    const naEntrada = await regras("entrada", comTop(valida));
    expect(JSON.parse(naEntrada.body)).toEqual(CORPO_DA_404);
    expect(naEntrada.statusCode).toBe(404);
  });

  it("RT-1b sem `<recurso>.create` → 403 (ver não basta; a porta de outra espécie não serve); premissa: com a porta da espécie, 200", async () => {
    const t = topDe("saida");
    const soVe = await membro("Vê Saída F5b", perms("saida", ["view"]));
    const outraEspecie = await membro("Lança Entrada F5b", perms("entrada", ["view", "create"]));
    for (const [quem, headers] of [["só view", soVe], ["outra espécie", outraEspecie]] as const) {
      const r = await regras("saida", comTop(t), headers);
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(403);
      expect(j(r).error?.code, quem).toBe("PERMISSION_DENIED");
      expect(r.body, `${quem}: nada da TOP sai na recusa`).not.toContain("destino");
    }
    const lanca = await membro("Lança Saída F5b", perms("saida", ["create"]));
    expect((await regras("saida", comTop(t), lanca)).statusCode, "premissa: com `saidas_estoque.create`, abre").toBe(200);
  });

  it("RT-1c parâmetro que não é `tipo_operacao_id` → 422 no parâmetro (recusado, nunca ignorado); premissa: sem ele, 200", async () => {
    const t = topDe("consumo");
    const r = await regras("consumo", `${comTop(t)}&empresa_id=${c.I.empresa}`);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error?.code).toBe("VALIDATION_ERROR");
    expect(detalhes(r)).toEqual([["empresa_id", "Parâmetro não reconhecido"]]);
    expect((await regras("consumo", comTop(t))).statusCode).toBe(200);
  });
});

describe("RT-2 — o NEUTRO: TOP sem as seções (formato 1) e formato 5 no neutro respondem o comportamento de hoje", () => {
  it("RT-2a as sete espécies, com a TOP sem configuração: exigências [], regras gerais { false, false }, Destino e Fluxo só onde a TOP os configura, no neutro", async () => {
    for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) {
      const t = topDe(especie);
      const { configuracao, formato } = await configuracaoAtual(t);
      expect(formato, `premissa: a TOP de ${especie} não está no formato 5 (sem as seções Destino e Fluxo)`).toBeLessThan(5);
      const r = await regras(especie, comTop(t));
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(200);
      const corpo = j(r);
      expect(corpo, especie).toEqual({
        contractVersion: 1, exigencias: [], regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false }, ...NEUTRO_DA_ESPECIE[especie],
      });
      // Chave a chave, na ordem do contrato — e é a resposta do domínio para a configuração do banco.
      expect(Object.keys(corpo), especie).toEqual(["contractVersion", "exigencias", "regrasGerais", "destino", "fluxo"]);
      expect(Object.keys(corpo.regrasGerais as object), especie).toEqual(["confirmacaoAutomatica", "aceitaSemItens"]);
      expect(corpo, `${especie}: = regrasDaOperacaoDoEstoque`).toEqual(regrasDaOperacaoDoEstoque(familia(especie), configuracao));
    }
  });

  it("RT-2b o formato 5 NO NEUTRO responde o mesmo neutro (as regras que travam nascem desligadas)", async () => {
    for (const especie of ESPECIES_COM_DESTINO_PELA_TOP) {
      const t = await topV5(especie);
      expect((await configuracaoAtual(t)).formato, `premissa: a TOP de ${especie} está no formato 5`).toBe(5);
      const r = await regras(especie, comTop(t));
      expect(r.statusCode, r.body).toBe(200);
      expect(j(r), especie).toEqual({
        contractVersion: 1, exigencias: [], regrasGerais: { confirmacaoAutomatica: false, aceitaSemItens: false }, ...NEUTRO_DA_ESPECIE[especie],
      });
    }
  });
});

describe("RT-3 — formato 5 com as regras ligadas: a resposta é a do domínio, e o POST cobra exatamente o que ela diz", () => {
  it("RT-3 consumo com centro obrigatório, Fluxo \"todos\", Exigir observação e Automática: a tela e o servidor dizem o mesmo", async () => {
    const t = await topV5("consumo", (x) => {
      x.destino.centroCusto = "obrigatoria";
      x.fluxo.exigeRequisicao = "todos";
      x.geral.exigeObservacao = true;
      x.geral.confirmacao = "automatica";
    });
    const { configuracao, formato } = await configuracaoAtual(t);
    expect(formato, "premissa: a TOP do consumo está no formato 5").toBe(5);
    const r = await regras("consumo", comTop(t));
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({
      contractVersion: 1,
      exigencias: ["observacao"],
      regrasGerais: { confirmacaoAutomatica: true, aceitaSemItens: false },
      destino: { ...DESTINO_NEUTRO, centroCusto: "obrigatoria" },
      fluxo: { exigeRequisicao: "todos", permiteParcial: true },
    });
    expect(j(r), "= regrasDaOperacaoDoEstoque da configuração do banco").toEqual(regrasDaOperacaoDoEstoque(familia("consumo"), configuracao));

    // O POST da MESMA TOP cobra cada regra declarada, uma de cada vez (nada gravado em nenhuma recusa).
    const p = await produto(); await saldoInicial(p.id, "10");
    const req = await lancadoDoc("requisicao", [item(p.id, "4")]); await confirmadoDoc("requisicao", req);
    const itemReq = (await itensNoBanco(req))[0]!.id;
    const ligado = [item(p.id, "4", { origem_item_id: itemReq })];
    const centro = (await c.admin.query<{ id: string }>(
      "insert into erp.cost_centers (organization_id, code, name, kind, is_active) values ($1,$2,$3,'analytic',true) returning id",
      [c.h.demo.orgId, `RT3${unico()}`, `Centro RT-3 ${unico()}`])).rows[0]!.id;
    const antes = await contarDocumentos();

    const semCentro = await lancarDoc("consumo", ligado, { tipo_operacao_id: t, origem_documento_id: req, observacao: "Para o trato" });
    expect(semCentro.statusCode, semCentro.body).toBe(422);
    expect(detalhes(semCentro), "Destino: centro obrigatório").toEqual([["centro_custo_id", "Esta operação exige centro de resultado."]]);

    const semRequisicao = await lancarDoc("consumo", [item(p.id, "1")], { tipo_operacao_id: t, centro_custo_id: centro, observacao: "Para o trato" });
    expect(semRequisicao.statusCode, semRequisicao.body).toBe(422);
    expect(detalhes(semRequisicao), "Fluxo: exige requisição").toEqual([["origem_documento_id", "Esta operação exige requisição: informe a requisição de origem."]]);

    const semObservacao = await lancarDoc("consumo", ligado, { tipo_operacao_id: t, origem_documento_id: req, centro_custo_id: centro });
    expect(semObservacao.statusCode, semObservacao.body).toBe(422);
    expect(j(semObservacao).error, "exigência: a observação").toEqual({
      code: "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", message: "A operação exige dados que o documento não tem.",
      details: { exigencias: [{ caminho: "observacao", mensagem: "Observação é obrigatório nesta operação." }] },
    });
    expect(await contarDocumentos(), "nenhuma recusa gravou").toBe(antes);

    // PREMISSA: com tudo o que a resposta pediu, salva — e confirma sozinho (Automática), levando o centro.
    const ok = await lancarDoc("consumo", ligado, { tipo_operacao_id: t, origem_documento_id: req, centro_custo_id: centro, observacao: "Para o trato" });
    expect(ok.statusCode, ok.body).toBe(201);
    const corpo = j(ok) as { id: string; situacao: string; confirmacaoAutomatica?: unknown };
    expect([corpo.situacao, corpo.confirmacaoAutomatica], "confirmação automática").toEqual(["confirmado", { confirmado: true }]);
    expect(await cabecalho(corpo.id)).toMatchObject({ situacao: "confirmado", centro_custo_id: centro, origem_documento_id: req });
  });
});

// ═══════════════════════════════ LE — layout efetivo ═══════════════════════════════

const LAYOUTS = "/api/admin/layouts-documento";

/** O layout do sistema da família, ajustado, gravado e (opcionalmente) ligado às TOPs dadas. */
async function layout(codigoBase: string, ajuste: (e: EstruturaLayout) => void, tops: string[] = []): Promise<{ id: string; nome: string; estrutura: EstruturaLayout }> {
  const estrutura = structuredClone(LAYOUT_DO_SISTEMA(codigoBase));
  ajuste(estrutura);
  const nome = `F5b ${codigoBase} ${unico()}`;
  const r = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: codigoBase, nome, estrutura } });
  expect(r.statusCode, `premissa: o layout de ${codigoBase} grava — ${r.body}`).toBe(201);
  const id = j(r).id as string;
  if (tops.length) {
    const l = await c.h.app.inject({ method: "PUT", url: `${LAYOUTS}/${id}/tops`, headers: c.h.headers(), payload: { tipoOperacaoIds: tops } });
    expect(l.statusCode, l.body).toBe(200);
  }
  return { id, nome, estrutura };
}
function campo(e: EstruturaLayout, chave: string): CampoDoLayout {
  const x = e.cabecalho.find((y) => y.campo === chave);
  if (!x) throw new Error(`campo ${chave} fora do cabeçalho`);
  return x;
}
function coluna(e: EstruturaLayout, chave: string): ColunaDoLayout {
  const x = e.itens.find((y) => y.campo === chave);
  if (!x) throw new Error(`coluna ${chave} fora dos itens`);
  return x;
}
const contarLayouts = async () =>
  Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.layouts_documento where organization_id = $1", [c.h.demo.orgId])).rows[0]!.n);

/**
 * As colunas e os campos do LAYOUT DO SISTEMA de cada espécie, à mão (a tabela do plano F5b §1.2a): o ajuste informa a
 * quantidade CONTADA; custo só na entrada e no ajuste; a requisição sem lote nem validade; validade só onde o saldo
 * entra; o Local de estoque no cabeçalho (na transferência, o de origem e o de destino).
 */
const SISTEMA_DA_ESPECIE: Readonly<Record<EspecieEstoque, { cabecalho: string[]; itens: string[] }>> = {
  entrada: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade", "custo_unitario", "lote", "validade"] },
  saida: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade", "lote"] },
  transferencia: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "armazem_destino_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade", "lote"] },
  ajuste: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade_contada", "custo_unitario", "lote", "validade"] },
  requisicao: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade"] },
  consumo: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade", "lote"] },
  devolucao_consumo: { cabecalho: ["empresa_id", "data_documento", "armazem_id", "observacao"], itens: ["codigo", "produto_id", "estoque", "quantidade", "lote", "validade"] },
};

describe("LE-1 — /layout-efetivo: o contrato de vendas e compras nas sete espécies", () => {
  it("LE-1a sem layout → o do SISTEMA da família (as colunas de hoje, à mão), sem os mapas; ligado → o ligado, com id e nome", async () => {
    for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) {
      const t = await top(familia(especie));
      const s = await efetivo(especie, comTop(t));
      expect(s.statusCode, `${especie}: ${s.body}`).toBe(200);
      expect(j(s), especie).toEqual({ estrutura: LAYOUT_DO_SISTEMA(familia(especie)), origem: "sistema", nome: null, id: null });
      const e = j(s).estrutura as EstruturaLayout;
      expect([e.cabecalho.map((x) => x.campo), e.itens.map((x) => x.campo), e.rodape], `${especie}: o layout do sistema`)
        .toEqual([SISTEMA_DA_ESPECIE[especie].cabecalho, SISTEMA_DA_ESPECIE[especie].itens, []]);
    }
    // LIGADO: o rótulo da coluna Lote trocado na saída.
    const t = await top(familia("saida"));
    const l = await layout(familia("saida"), (e) => { coluna(e, "lote").rotulo = "Lote do fornecedor"; }, [t]);
    const g = await efetivo("saida", comTop(t));
    expect(g.statusCode, g.body).toBe(200);
    expect(j(g)).toEqual({ estrutura: l.estrutura, origem: "ligado", nome: l.nome, id: l.id });
    expect(coluna(j(g).estrutura as EstruturaLayout, "lote").rotulo).toBe("Lote do fornecedor");
  });

  it("LE-1b padrão ATIVO da família vale para a TOP sem layout ligado; desativado, volta o do sistema", async () => {
    const especie: EspecieEstoque = "devolucao_consumo";
    const t = await top(familia(especie));
    expect(j(await efetivo(especie, comTop(t))), "premissa: sem layout, o do sistema").toMatchObject({ origem: "sistema", id: null });
    const l = await layout(familia(especie), (e) => { coluna(e, "lote").rotulo = "Lote devolvido"; });
    try {
      const p = await c.h.app.inject({ method: "POST", url: `${LAYOUTS}/${l.id}/padrao`, headers: c.h.headers(), payload: {} });
      expect(p.statusCode, p.body).toBe(200);
      expect(j(await efetivo(especie, comTop(t)))).toEqual({ estrutura: l.estrutura, origem: "padrao_da_familia", nome: l.nome, id: l.id });
    } finally {
      const d = await c.h.app.inject({ method: "POST", url: `${LAYOUTS}/${l.id}/ativo`, headers: c.h.headers(), payload: { ativo: false } });
      expect(d.statusCode, d.body).toBe(200);
    }
    expect(j(await efetivo(especie, comTop(t)))).toEqual({ estrutura: LAYOUT_DO_SISTEMA(familia(especie)), origem: "sistema", nome: null, id: null });
  });

  it("LE-1c o Local de estoque PADRÃO por registro: sai da estrutura e vem em `padroesDeCadastro.armazem_id` com a empresa; inativo, vira `padroesInvalidos`", async () => {
    const local = await armazem();
    const descricao = (await c.admin.query<{ d: string }>("select description as d from erp.warehouses where id = $1", [local])).rows[0]!.d;
    const t = await top(familia("entrada"));
    const l = await layout(familia("entrada"), (e) => { campo(e, "armazem_id").valorPadrao = { tipo: "registro", id: local }; }, [t]);
    const semPadrao = structuredClone(l.estrutura);
    delete campo(semPadrao, "armazem_id").valorPadrao;
    const g = await efetivo("entrada", comTop(t));
    expect(g.statusCode, g.body).toBe(200);
    expect(j(g)).toEqual({
      estrutura: semPadrao, origem: "ligado", nome: l.nome, id: l.id,
      padroesDeCadastro: { armazem_id: { id: local, rotulo: descricao, empresaId: c.I.empresa } }, padroesInvalidos: [],
    });
    // O local INATIVO deixa de valer: a chave passa a `padroesInvalidos`, e a estrutura continua sem o padrão.
    await c.admin.query("update erp.warehouses set is_active = false where id = $1", [local]);
    expect(j(await efetivo("entrada", comTop(t)))).toEqual({
      estrutura: semPadrao, origem: "ligado", nome: l.nome, id: l.id, padroesDeCadastro: {}, padroesInvalidos: ["armazem_id"],
    });
  });

  it("LE-1d a MESMA 404 de RT-1 (corpo inteiro) e 403 sem `<recurso>.create`; premissa: a válida responde 200", async () => {
    const { casos, valida, deOutraOrg } = await casosDaMesma404();
    for (const [caso, query] of casos) {
      const r = await efetivo("saida", query);
      expect(r.statusCode, `${caso}: ${r.body}`).toBe(404);
      expect(JSON.parse(r.body), caso).toEqual(CORPO_DA_404);
    }
    expect((await efetivo("saida", comTop(valida))).statusCode).toBe(200);
    expect((await efetivo("saida", comTop(deOutraOrg), outra)).statusCode).toBe(200);
    const soVe = await membro("Vê Requisição F5b", perms("requisicao", ["view"]));
    const t = topDe("requisicao");
    const negado = await efetivo("requisicao", comTop(t), soVe);
    expect(negado.statusCode, negado.body).toBe(403);
    expect(j(negado).error?.code).toBe("PERMISSION_DENIED");
    const lanca = await membro("Lança Requisição F5b", perms("requisicao", ["create"]));
    expect((await efetivo("requisicao", comTop(t), lanca)).statusCode, "premissa: com `requisicoes_estoque.create`, abre").toBe(200);
  });
});

describe("LE-2 — o admin de layouts aceita as famílias de estoque, com as recusas do domínio", () => {
  it("LE-2 a saída grava com o layout do sistema; custo obrigatório, Dados adicionais, cabeçalho reordenado e Observação fora → 422 no caminho; ligar a TOP de outro movimento → 422; nada gravado nas recusas", async () => {
    const nome = `F5b saída ${unico()}`;
    const r = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: familia("saida"), nome } });
    expect(r.statusCode, r.body).toBe(201);
    const gravado = (await c.admin.query<{ familia: string; nome: string; estrutura: EstruturaLayout }>(
      "select familia, nome, estrutura from erp.layouts_documento where id = $1", [j(r).id])).rows[0]!;
    expect(gravado).toEqual({ familia: "estoque.saida", nome, estrutura: LAYOUT_DO_SISTEMA(familia("saida")) });

    const antes = await contarLayouts();
    // CUSTO obrigatório na entrada: o layout do estoque não cria obrigatório.
    const custo = structuredClone(LAYOUT_DO_SISTEMA(familia("entrada")));
    const iCusto = custo.itens.findIndex((x) => x.campo === "custo_unitario");
    expect(iCusto, "premissa: a entrada tem a coluna de custo").toBeGreaterThanOrEqual(0);
    custo.itens[iCusto]!.obrigatorio = true;
    const comCusto = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: familia("entrada"), nome: `F5b ${unico()}`, estrutura: custo } });
    expect(comCusto.statusCode, comCusto.body).toBe(422);
    expect(detalhes(comCusto)).toEqual([[`itens[${iCusto}].obrigatorio`, "\"Custo unitário\" é opcional no documento de estoque: o layout não o torna obrigatório."]]);
    // DADOS ADICIONAIS: todo campo do estoque fica nos Dados principais.
    const adicionais = structuredClone(LAYOUT_DO_SISTEMA(familia("saida")));
    const iObs = adicionais.cabecalho.findIndex((x) => x.campo === "observacao");
    adicionais.cabecalho[iObs]!.grupo = "adicionais";
    const emAdicionais = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: familia("saida"), nome: `F5b ${unico()}`, estrutura: adicionais } });
    expect(emAdicionais.statusCode, emAdicionais.body).toBe(422);
    expect(detalhes(emAdicionais)).toEqual([[`cabecalho[${iObs}].campo`, "\"Observação\" fica nos Dados principais do layout neste movimento: a Central de Estoque a mostra na aba Observações."]]);
    // O CABEÇALHO QUE A CENTRAL DESENHA (I-2 da revisão da fase): a ordem é fixa e a Observação não sai do layout.
    const reordenado = structuredClone(LAYOUT_DO_SISTEMA(familia("saida")));
    expect(reordenado.cabecalho.map((x) => x.campo), "premissa: a ordem do sistema").toEqual(["empresa_id", "data_documento", "armazem_id", "observacao"]);
    reordenado.cabecalho = [reordenado.cabecalho[1]!, reordenado.cabecalho[0]!, ...reordenado.cabecalho.slice(2)];
    const comOrdemNova = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: familia("saida"), nome: `F5b ${unico()}`, estrutura: reordenado } });
    expect(comOrdemNova.statusCode, comOrdemNova.body).toBe(422);
    expect(detalhes(comOrdemNova)).toEqual([["cabecalho", "A ordem do cabeçalho é fixa neste movimento (a da Central de Estoque): Empresa, Data do documento, Local de estoque, Observação."]]);
    const semObservacao = structuredClone(LAYOUT_DO_SISTEMA(familia("saida")));
    semObservacao.cabecalho = semObservacao.cabecalho.filter((x) => x.campo !== "observacao");
    const tirada = await c.h.app.inject({ method: "POST", url: LAYOUTS, headers: c.h.headers(), payload: { familia: familia("saida"), nome: `F5b ${unico()}`, estrutura: semObservacao } });
    expect(tirada.statusCode, tirada.body).toBe(422);
    expect(detalhes(tirada)).toEqual([["cabecalho", "\"Observação\" não sai do layout neste movimento: a Central de Estoque sempre a mostra (quem a exige é a operação, em Exigir observação, na aba Geral da TOP)."]]);
    expect(await contarLayouts(), "as recusas não gravaram").toBe(antes);

    // LIGAR a TOP da ENTRADA ao layout da SAÍDA → a recusa de hoje ("TOP de outro movimento"), nada ligado.
    const ligar = await c.h.app.inject({ method: "PUT", url: `${LAYOUTS}/${j(r).id}/tops`, headers: c.h.headers(), payload: { tipoOperacaoIds: [topDe("entrada")] } });
    expect(ligar.statusCode, ligar.body).toBe(422);
    expect(j(ligar).error?.message).toBe("TOP de outro movimento");
    expect(detalhes(ligar)).toEqual([["tipoOperacaoIds.0", "A TOP não é do movimento estoque.saida deste layout."]]);
    const ligadas = await c.admin.query("select 1 from erp.layout_documento_tops where layout_id = $1", [j(r).id]);
    expect(ligadas.rowCount, "nada ligado").toBe(0);
    // PREMISSA: a TOP da SAÍDA liga.
    const saida = await c.h.app.inject({ method: "PUT", url: `${LAYOUTS}/${j(r).id}/tops`, headers: c.h.headers(), payload: { tipoOperacaoIds: [await top(familia("saida"))] } });
    expect(saida.statusCode, saida.body).toBe(200);
  });
});

// ═══════════════════════════════ DO — opções do destino ═══════════════════════════════

type Opcao = { id: string; codigo: string | null; rotulo: string };
const opcoes = (especie: EspecieEstoque, query: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url: `/api/estoque/${segmento(especie)}/destino/opcoes?${query}`, headers });
const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
async function itens(especie: EspecieEstoque, p: Record<string, string>, headers?: Hdr): Promise<Opcao[]> {
  const r = await opcoes(especie, q(p), headers);
  expect(r.statusCode, r.body).toBe(200);
  expect(Object.keys(j(r)), "a resposta é `{ itens }`").toEqual(["itens"]);
  return j(r).itens as Opcao[];
}

const inserir = async (sql: string, params: unknown[]): Promise<string> => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;

/** O cenário de UMA dimensão: dois alvos VÁLIDOS (na ordem que o servidor deve devolver) e os INVÁLIDOS, todos com o token. */
interface CenarioDaDimensao {
  coluna: ColunaDestinoEstoque;
  /** O token do código (e, na safra, do rótulo): a busca por ele traz o cenário inteiro, e só ele. */
  token: string;
  /** Um token que só existe no RÓTULO do segundo válido. */
  soNoRotulo: string;
  validos: Opcao[];
  invalidos: string[];
  /** O alvo válido na OUTRA empresa (só nas dimensões da empresa). */
  daOutraEmpresa: Opcao | null;
}

/**
 * Cria os alvos de uma dimensão, por SQL (testemunha): o válido "A" é criado DEPOIS do "B" e vem PRIMEIRO na lista (a
 * ordem é do servidor — `codigo nulls last, rotulo, id` —, não a de inserção). Os inválidos: o centro sintético, inativo e
 * excluído; a máquina inativa, vendida, excluída e de outra empresa; a OS encerrada, cancelada, excluída e de outra
 * empresa; o lote fechado, excluído e de outra empresa; a área inativa, excluída e de outra empresa; a safra inativa e
 * excluída. Premissa: todos existem no banco.
 */
async function cenarioDaDimensao(dimensao: DimensaoDestinoEstoque): Promise<CenarioDaDimensao> {
  const T = `DO${unico()}`.toUpperCase();
  const R = `rl${unico()}`;
  const org = c.h.demo.orgId; const e1 = c.I.empresa; const e2 = c.I.empresa2;
  const coluna = CAMPOS_DESTINO_ESTOQUE.find((x) => x.chave === dimensao)!.coluna;
  const montar = async (tabela: string, criar: (codigo: string, rotulo: string, estado: string, empresa: string, excluido: boolean) => Promise<string>,
    estados: { valido: string; invalidos: string[] }, porEmpresa: boolean, rotuloA: (codigo: string) => string): Promise<CenarioDaDimensao> => {
    const idB = await criar(`${T}-B`, `Destino ${T} B ${R}`, estados.valido, e1, false);
    const idA = await criar(`${T}-A`, rotuloA(`${T}-A`), estados.valido, e1, false);
    const invalidos: string[] = [];
    for (const [i, estado] of estados.invalidos.entries()) invalidos.push(await criar(`${T}-X${i}`, `Destino ${T} X${i}`, estado, e1, false));
    invalidos.push(await criar(`${T}-XE`, `Destino ${T} excluído`, estados.valido, e1, true));
    let daOutraEmpresa: Opcao | null = null;
    if (porEmpresa) {
      const id = await criar(`${T}-XO`, `Destino ${T} outra empresa`, estados.valido, e2, false);
      invalidos.push(id);
      daOutraEmpresa = { id, codigo: `${T}-XO`, rotulo: `Destino ${T} outra empresa` };
    }
    const n = await c.admin.query<{ n: string }>(`select count(*)::text n from ${tabela} where id = any($1::uuid[])`, [invalidos]);
    expect(Number(n.rows[0]!.n), `premissa (${dimensao}): os alvos inválidos existem no banco`).toBe(invalidos.length);
    return {
      coluna, token: T, soNoRotulo: R, invalidos, daOutraEmpresa,
      validos: [{ id: idA, codigo: `${T}-A`, rotulo: rotuloA(`${T}-A`) }, { id: idB, codigo: `${T}-B`, rotulo: `Destino ${T} B ${R}` }],
    };
  };
  const excluidoEm = (excluido: boolean) => (excluido ? new Date().toISOString() : null);
  switch (dimensao) {
    case "centroCusto": {
      // O "estado" do centro: `analytic` (válido), `synthetic`, ou `inativo` (analítico e inativo).
      const criar = (codigo: string, rotulo: string, estado: string, _empresa: string, excluido: boolean) => inserir(
        "insert into erp.cost_centers (organization_id, code, name, kind, is_active, deleted_at) values ($1,$2,$3,$4,$5,$6) returning id",
        [org, codigo, rotulo, estado === "inativo" ? "analytic" : estado, estado !== "inativo", excluidoEm(excluido)]);
      return montar("erp.cost_centers", criar, { valido: "analytic", invalidos: ["synthetic", "inativo"] }, false, () => `Destino ${T} A`);
    }
    case "equipamento": {
      const criar = (codigo: string, rotulo: string, estado: string, empresa: string, excluido: boolean) => inserir(
        "insert into erp.equipments (organization_id, empresa_id, code, description, status, deleted_at) values ($1,$2,$3,$4,$5,$6) returning id",
        [org, empresa, codigo, rotulo, estado, excluidoEm(excluido)]);
      return montar("erp.equipments", criar, { valido: "active", invalidos: ["inactive", "sold"] }, true, () => `Destino ${T} A`);
    }
    case "ordemServico": {
      // O "A" sem descrição: o rótulo é o código (`coalesce(nullif(description, ''), code)`). Válidas: aberta e em andamento.
      const criar = (codigo: string, rotulo: string, estado: string, empresa: string, excluido: boolean) => inserir(
        "insert into erp.service_orders (organization_id, empresa_id, code, order_date, status, description, deleted_at) values ($1,$2,$3,'2026-09-10',$4,$5,$6) returning id",
        [org, empresa, codigo, codigo === `${T}-B` ? "in_progress" : estado, codigo === `${T}-A` ? "" : rotulo, excluidoEm(excluido)]);
      return montar("erp.service_orders", criar, { valido: "open", invalidos: ["finished", "cancelled"] }, true, (codigo) => codigo);
    }
    case "loteAnimais": {
      const criar = (codigo: string, rotulo: string, estado: string, empresa: string, excluido: boolean) => inserir(
        "insert into erp.batches (organization_id, empresa_id, code, batch_date, description, status, deleted_at) values ($1,$2,$3,'2026-09-10',$4,$5,$6) returning id",
        [org, empresa, codigo, rotulo, estado, excluidoEm(excluido)]);
      return montar("erp.batches", criar, { valido: "active", invalidos: ["closed"] }, true, () => `Destino ${T} A`);
    }
    case "area": {
      const criar = (codigo: string, rotulo: string, estado: string, empresa: string, excluido: boolean) => inserir(
        "insert into erp.areas (organization_id, empresa_id, code, name, is_active, deleted_at) values ($1,$2,$3,$4,$5,$6) returning id",
        [org, empresa, codigo, rotulo, estado === "ativa", excluidoEm(excluido)]);
      return montar("erp.areas", criar, { valido: "ativa", invalidos: ["inativa"] }, true, () => `Destino ${T} A`);
    }
    case "safra": {
      // A safra NÃO tem código: o token vai no rótulo (a descrição), e o código da lista é `null`.
      const criar = async (codigo: string, rotulo: string, estado: string, _empresa: string, excluido: boolean) => inserir(
        "insert into erp.harvests (organization_id, description, start_date, end_date, is_active, deleted_at) values ($1,$2,'2026-01-01','2026-12-31',$3,$4) returning id",
        [org, codigo === `${T}-A` ? `Safra ${T} A` : codigo === `${T}-B` ? `Safra ${T} B ${R}` : `Safra ${T} ${codigo}`, estado === "ativa", excluidoEm(excluido)]);
      const cenario = await montar("erp.harvests", criar, { valido: "ativa", invalidos: ["inativa"] }, false, () => `Safra ${T} A`);
      return { ...cenario, validos: [{ id: cenario.validos[0]!.id, codigo: null, rotulo: `Safra ${T} A` }, { id: cenario.validos[1]!.id, codigo: null, rotulo: `Safra ${T} B ${R}` }] };
    }
  }
}

/** A recusa da F5a para a referência inválida de cada dimensão, à mão. */
const RECUSA_DA_F5A: Readonly<Record<DimensaoDestinoEstoque, string>> = {
  centroCusto: "Centro de resultado inválido: escolha um centro de resultado analítico e ativo da organização",
  equipamento: "Máquina/equipamento inválido: escolha uma máquina/equipamento ativo da empresa do documento",
  ordemServico: "Ordem de serviço inválida: escolha uma ordem de serviço aberta ou em andamento da empresa do documento",
  loteAnimais: "Lote de animais inválido: escolha um lote de animais ativo da empresa do documento",
  area: "Área/talhão inválida: escolha uma área/talhão ativa da empresa do documento",
  safra: "Safra inválida: escolha uma safra ativa da organização",
};
const DIMENSOES = CAMPOS_DESTINO_ESTOQUE.map((x) => x.chave);

describe("DO-1 — /destino/opcoes: só os alvos válidos, na ordem do servidor, com busca e limite", () => {
  it("DO-1a por dimensão: a busca pelo token traz EXATAMENTE os dois válidos (ids, códigos e rótulos), nunca os inválidos que existem", async () => {
    expect(DIMENSOES, "premissa: as seis dimensões").toEqual(["centroCusto", "equipamento", "ordemServico", "loteAnimais", "area", "safra"]);
    for (const dimensao of DIMENSOES) {
      const cen = await cenarioDaDimensao(dimensao);
      const lista = await itens("saida", { dimensao, empresa_id: c.I.empresa, busca: cen.token });
      expect(lista, dimensao).toEqual(cen.validos);
      for (const id of cen.invalidos) expect(lista.map((x) => x.id), `${dimensao}: o inválido ${id} não é oferecido`).not.toContain(id);
    }
  });

  it("DO-1b busca por CÓDIGO e por RÓTULO (sem caixa), o curinga da busca é literal, `limite` corta na ordem, e a empresa pedida recorta as dimensões da empresa", async () => {
    for (const dimensao of DIMENSOES) {
      const cen = await cenarioDaDimensao(dimensao);
      const [a, b] = cen.validos as [Opcao, Opcao];
      const base = { dimensao, empresa_id: c.I.empresa };
      // por RÓTULO (o token só existe no rótulo do "B"), em MAIÚSCULAS: a busca não diferencia caixa.
      expect(await itens("saida", { ...base, busca: cen.soNoRotulo.toUpperCase() }), `${dimensao}: pelo rótulo`).toEqual([b]);
      // por CÓDIGO (a safra não tem código: o "A" pelo rótulo).
      expect(await itens("saida", { ...base, busca: dimensao === "safra" ? `Safra ${cen.token} A` : `${cen.token}-A` }), `${dimensao}: pelo código`).toEqual([a]);
      // O `%` e o `_` da busca são literais: nenhum código ou rótulo do cenário os tem.
      expect(await itens("saida", { ...base, busca: `${cen.token}%` }), `${dimensao}: % literal`).toEqual([]);
      expect(await itens("saida", { ...base, busca: `${cen.token}_A` }), `${dimensao}: _ literal`).toEqual([]);
      // `limite`: o primeiro na ordem do servidor.
      expect(await itens("saida", { ...base, busca: cen.token, limite: "1" }), `${dimensao}: limite 1`).toEqual([a]);
      // A OUTRA empresa: nas dimensões da empresa, só o alvo dela; nas da organização, os mesmos válidos.
      const naOutra = await itens("saida", { dimensao, empresa_id: c.I.empresa2, busca: cen.token });
      expect(naOutra, `${dimensao}: na 2ª empresa`).toEqual(cen.daOutraEmpresa ? [cen.daOutraEmpresa] : cen.validos);
    }
  });

  it("DO-1c a mesma lista na saída, na requisição e no consumo; sem busca e sem limite, as 20 primeiras válidas (o padrão), na ordem", async () => {
    const cen = await cenarioDaDimensao("centroCusto");
    const p = { dimensao: "centroCusto", empresa_id: c.I.empresa, busca: cen.token };
    for (const especie of ESPECIES_COM_DESTINO_PELA_TOP) expect(await itens(especie, p), especie).toEqual(cen.validos);
    // Mais de 20 centros válidos na organização: o padrão de 20 tem de cortar.
    await c.admin.query(
      "insert into erp.cost_centers (organization_id, code, name, kind, is_active) select $1, $2 || lpad(n::text, 2, '0'), 'Centro em massa ' || n, 'analytic', true from generate_series(1, 21) n",
      [c.h.demo.orgId, `M${unico()}`]);
    const testemunha = await c.admin.query<{ id: string }>(
      `select id from erp.cost_centers where organization_id = $1 and is_active and kind = 'analytic' and deleted_at is null
        order by code nulls last, name, id`, [c.h.demo.orgId]);
    expect(testemunha.rowCount, "premissa: há mais de 20 centros válidos").toBeGreaterThan(20);
    const semBusca = await itens("consumo", { dimensao: "centroCusto", empresa_id: c.I.empresa });
    expect(semBusca.map((x) => x.id), "as 20 primeiras na ordem `codigo, rotulo, id`").toEqual(testemunha.rows.slice(0, 20).map((x) => x.id));
    for (const id of cen.invalidos) expect(semBusca.map((x) => x.id)).not.toContain(id);
  });
});

describe("DO-2 — /destino/opcoes: as recusas dos parâmetros, da empresa, da porta e da espécie", () => {
  it("DO-2a parâmetro desconhecido, repetido, dimensão fora da lista, ausente, empresa malformada, busca e limite fora da faixa → 422 no parâmetro; premissa: o corpo correto responde 200", async () => {
    const ok = { dimensao: "area", empresa_id: c.I.empresa };
    expect((await opcoes("saida", q(ok))).statusCode, "premissa: os parâmetros corretos respondem 200").toBe(200);
    const casos: [string, string, string][] = [
      ["desconhecido", `${q(ok)}&ordem=codigo`, "ordem"],
      ["repetido", `${q(ok)}&dimensao=safra`, "dimensao"],
      ["dimensão fora da lista", q({ ...ok, dimensao: "armazem" }), "dimensao"],
      ["dimensão ausente", q({ empresa_id: c.I.empresa }), "dimensao"],
      ["empresa ausente", q({ dimensao: "area" }), "empresa_id"],
      ["empresa malformada", q({ ...ok, empresa_id: "nao-e-uuid" }), "empresa_id"],
      ["busca acima de 100", q({ ...ok, busca: "x".repeat(101) }), "busca"],
      ["limite 0", q({ ...ok, limite: "0" }), "limite"],
      ["limite 51", q({ ...ok, limite: "51" }), "limite"],
      ["limite não numérico", q({ ...ok, limite: "dez" }), "limite"],
    ];
    for (const [caso, query, parametro] of casos) {
      const r = await opcoes("saida", query);
      expect(r.statusCode, `${caso}: ${r.body}`).toBe(422);
      expect(j(r).error?.code, caso).toBe("VALIDATION_ERROR");
      expect(detalhes(r).map(([p]) => p), caso).toEqual([parametro]);
    }
    expect(detalhes(await opcoes("saida", `${q(ok)}&ordem=codigo`))).toEqual([["ordem", "Parâmetro não reconhecido"]]);
    expect(detalhes(await opcoes("saida", `${q(ok)}&dimensao=safra`))).toEqual([["dimensao", "Parâmetro repetido: informe um valor só"]]);
  });

  it("DO-2b empresa fora do escopo de estoque do membro → 422 (a empresa é PEDIDO); premissa: a dele responde 200", async () => {
    const so2 = await membro("Saída da 2ª F5b", perms("saida", ["view", "create"]), escopos([c.I.empresa2]));
    const r = await opcoes("saida", q({ dimensao: "centroCusto", empresa_id: c.I.empresa }), so2);
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).error).toMatchObject({ code: "VALIDATION_ERROR", message: "Sem acesso à empresa informada" });
    expect(r.body, "nada da lista sai na recusa").not.toContain("itens");
    expect((await opcoes("saida", q({ dimensao: "centroCusto", empresa_id: c.I.empresa2 }), so2)).statusCode).toBe(200);
  });

  it("DO-2c sem `<recurso>.create` → 403 (ver não basta; a porta de outra espécie não serve); premissa: com a porta, 200", async () => {
    const p = q({ dimensao: "safra", empresa_id: c.I.empresa });
    const soVe = await membro("Vê Consumo F5b", perms("consumo", ["view"]));
    const outraEspecie = await membro("Lança Saída Só F5b", perms("saida", ["create"]));
    for (const [quem, headers] of [["só view", soVe], ["outra espécie", outraEspecie]] as const) {
      const r = await opcoes("consumo", p, headers);
      expect(r.statusCode, `${quem}: ${r.body}`).toBe(403);
      expect(j(r).error?.code).toBe("PERMISSION_DENIED");
    }
    const lanca = await membro("Lança Consumo F5b", perms("consumo", ["create"]));
    expect((await opcoes("consumo", p, lanca)).statusCode).toBe(200);
  });

  it("DO-2d nas espécies cujo destino a TOP NÃO configura a rota não existe (404 de rota); premissa: nas três, 200", async () => {
    const p = q({ dimensao: "centroCusto", empresa_id: c.I.empresa });
    const sem = TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE.filter((e) => !ESPECIES_COM_DESTINO_PELA_TOP.includes(e));
    expect(sem, "premissa: as quatro sem destino pela TOP").toEqual(["entrada", "transferencia", "ajuste", "devolucao_consumo"]);
    for (const especie of sem) {
      const r = await opcoes(especie, p);
      expect(r.statusCode, `${especie}: ${r.body}`).toBe(404);
      expect(JSON.parse(r.body), especie).toEqual(CORPO_DA_ROTA_INEXISTENTE);
    }
    for (const especie of ESPECIES_COM_DESTINO_PELA_TOP) expect((await opcoes(especie, p)).statusCode, especie).toBe(200);
  });
});

describe("DO-3 — uma régua só: o que a lista oferece o POST aceita, e o que o POST recusa a lista não oferece", () => {
  it("DO-3 para cada dimensão: TODA opção devolvida é aceita na saída (201, a coluna gravada) e TODO alvo inválido é recusado com a mensagem da F5a", async () => {
    const t = await topV5("saida", (x) => { for (const d of DIMENSOES) x.destino[d] = "opcional"; });
    const p = await produto();
    for (const dimensao of DIMENSOES) {
      const cen = await cenarioDaDimensao(dimensao);
      const lista = await itens("saida", { dimensao, empresa_id: c.I.empresa, busca: cen.token });
      expect(lista.length, `premissa (${dimensao}): a lista oferece os válidos`).toBe(2);
      for (const opcao of lista) {
        const id = await lancadoDoc("saida", [item(p.id, "1")], { tipo_operacao_id: t, [cen.coluna]: opcao.id });
        expect((await cabecalho(id))[cen.coluna], `${dimensao}: a opção gravada`).toBe(opcao.id);
      }
      const antes = await contarDocumentos();
      for (const invalido of cen.invalidos) {
        expect(lista.map((x) => x.id), `${dimensao}: o inválido não está na lista`).not.toContain(invalido);
        const r = await lancarDoc("saida", [item(p.id, "1")], { tipo_operacao_id: t, [cen.coluna]: invalido });
        expect(r.statusCode, `${dimensao}: ${r.body}`).toBe(422);
        expect(detalhes(r), dimensao).toEqual([[cen.coluna, RECUSA_DA_F5A[dimensao]]]);
      }
      expect(await contarDocumentos(), `${dimensao}: nenhuma recusa gravou`).toBe(antes);
    }
  });
});
