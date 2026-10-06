import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * MAPA-GERAL (decisão 294) — `GET /api/mapa/analises-satelitais/resumo`: o resumo NDVI de todas as áreas do escopo
 * numa consulta só, sobre o banco real (papel sem bypass de RLS). Prova: capacidade × escopo (empresa, organização,
 * módulo da permissão, seleção de empresa), área excluída fora; a última observação útil, a anterior (OUTRA imagem)
 * e a variação em `numeric`; uma linha por imagem; a última execução mesmo sem observação útil; paginação no
 * servidor; contrato estrito (422); e UMA consulta às análises para a página inteira (contada, não prometida).
 */

let h: Harness;
let admin: Db;
let A = ""; let B = "";
const area: Record<string, string> = {};
let soB: Record<string, string> = {}; let soMapa: Record<string, string> = {};

const quadrado = (lon: number, lat: number, lado: number) =>
  ({ type: "Polygon", coordinates: [[[lon, lat], [lon, lat + lado], [lon + lado, lat + lado], [lon + lado, lat], [lon, lat]]] });

interface Item {
  area_id: string;
  ultima_execucao: { situacao: string; motivo_qualidade: string | null; criado_em: string } | null;
  ultima_observacao: { observacao_inicio: string; valor_medio: string; do_poligono_atual: boolean; [campo: string]: unknown } | null;
  observacao_anterior: { observacao_inicio: string; valor_medio: string } | null;
  variacao: string | null;
}
interface Corpo {
  itens: Item[]; pagina: number; tamanho: number; tem_mais: boolean;
  modo?: string; data_imagem?: string | null; contexto?: string | null; versao_metodo?: string | null;
  error: { code: string; message: string };
}
const j = (r: { json: () => unknown }) => r.json() as Corpo;
const resumo = (query = "", headers = h.headers()) => h.app.inject({ method: "GET", url: `/api/mapa/analises-satelitais/resumo${query}`, headers });
const porArea = (c: Corpo) => new Map(c.itens.map((i) => [i.area_id, i]));

async function novaArea(empresa: string, code: string, org?: string) {
  const r = await admin.query<{ id: string }>(
    `insert into erp.areas (organization_id, empresa_id, code, name, area_ha, usable_area_ha, land_use, status, tenure, geometria)
     values ($1,$2,$3,$4,12,12,'pastagem','ativa','propria',$5) returning id`,
    [org ?? h.demo.orgId, empresa, code, `[TEST] ${code}`, JSON.stringify(quadrado(-56.1, -15.6, 0.01))]);
  return r.rows[0]!.id;
}

/**
 * Uma execução gravada direto no banco, com a janela e o instante de registro EXPLÍCITOS (a ordem das execuções não
 * depende do relógio do teste). `obs` nulo = sem observação útil. O hash é o do polígono atual da área.
 */
async function execucao(areaId: string, janelaInicio: string, criado: string, obs: { inicio: string; media: string } | null, org?: string) {
  const fim = new Date(Date.parse(janelaInicio) + 30 * 86_400_000).toISOString();
  const concluida = obs !== null;
  await admin.query(
    `insert into erp.analises_satelitais (organization_id, empresa_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256,
        janela_inicio, janela_fim, resolucao_m, situacao, motivo_qualidade, observacao_inicio, observacao_fim, valor_medio, valor_minimo,
        valor_maximo, desvio_padrao, pixels_amostra, pixels_sem_dado, pixels_validos, pixels_geometria, cobertura_valida, criado_por, created_at)
     select a.organization_id, a.empresa_id, a.id, 'copernicus_cdse', 'sentinel-2-l2a', 'ndvi', 'sat01-ndvi-v1',
        encode(sha256(convert_to(a.geometria::text, 'UTF8')), 'hex'), $2, $3, 10, $4, $5, $6::timestamptz, $6::timestamptz + interval '1 day',
        $7::numeric, $7::numeric - 0.2, $7::numeric + 0.1, case when $4 = 'concluida' then 0.05 end,
        case when $4 = 'concluida' then 13000 end, case when $4 = 'concluida' then 2000 end, case when $4 = 'concluida' then 11000 end,
        11860, case when $4 = 'concluida' then 0.9275 end, $8, $9
       from erp.areas a where a.id = $1 and a.organization_id = $10`,
    [areaId, janelaInicio, fim, concluida ? "concluida" : "sem_observacao_util", concluida ? null : "sem_aquisicao",
      obs?.inicio ?? null, obs?.media ?? null, h.demo.adminUserId, criado, org ?? h.demo.orgId]);
}

async function membro(nome: string, email: string, escopos: { modulo: string; modo: "todas" | "selecionadas"; empresas: string[] }[]): Promise<Record<string, string>> {
  const papel = await h.app.inject({ method: "POST", url: "/api/admin/roles", headers: h.headers(), payload: { name: `Perfil ${nome}`, permissions: ["analises_satelitais.view"] } });
  expect(papel.statusCode, papel.body).toBe(201);
  const vinculo = await h.app.inject({ method: "POST", url: "/api/admin/members", headers: h.headers(), payload: { name: nome, email, password: "MapaGeral@123", role_id: (papel.json() as { id: string }).id, escopos_empresas: escopos } });
  expect(vinculo.statusCode, vinculo.body).toBe(201);
  const login = await h.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "MapaGeral@123" } });
  expect(login.statusCode, login.body).toBe(200);
  return { authorization: `Bearer ${(login.json() as { token: string }).token}`, "x-org-id": h.demo.orgId };
}

beforeAll(async () => {
  h = await harness();
  admin = createPool(TEST_URL, { max: 2 });
  [A, B] = [h.demo.empresaIds[0]!, h.demo.empresaIds[1]!];
  // Códigos em ordem: a paginação ordena por código (e id), e o teste confere a ordem.
  area["varias"] = await novaArea(A, "MG01-varias");
  area["semUtil"] = await novaArea(A, "MG02-sem-util");
  area["deB"] = await novaArea(B, "MG03-de-b");
  area["semExecucao"] = await novaArea(A, "MG04-sem-execucao");
  area["excluida"] = await novaArea(A, "MG05-excluida");

  // "varias": três imagens; a MAIS RECENTE analisada duas vezes (janelas diferentes) — vale a análise mais recente
  // dela, e a anterior é OUTRA imagem. Depois, a última execução não achou imagem útil.
  await execucao(area["varias"]!, "2026-06-01T00:00:00Z", "2026-06-10T12:00:00Z", { inicio: "2026-06-05T00:00:00Z", media: "0.55" });
  await execucao(area["varias"]!, "2026-07-01T00:00:00Z", "2026-07-10T12:00:00Z", { inicio: "2026-07-05T00:00:00Z", media: "0.60" });
  await execucao(area["varias"]!, "2026-08-01T00:00:00Z", "2026-08-10T12:00:00Z", { inicio: "2026-08-05T00:00:00Z", media: "0.70" });
  await execucao(area["varias"]!, "2026-07-20T00:00:00Z", "2026-08-12T12:00:00Z", { inicio: "2026-08-05T00:00:00Z", media: "0.74" });
  await execucao(area["varias"]!, "2026-08-20T00:00:00Z", "2026-09-01T12:00:00Z", null);
  await execucao(area["semUtil"]!, "2026-08-20T00:00:00Z", "2026-09-02T12:00:00Z", null);
  await execucao(area["deB"]!, "2026-08-01T00:00:00Z", "2026-08-15T12:00:00Z", { inicio: "2026-08-10T00:00:00Z", media: "0.45" });
  await execucao(area["excluida"]!, "2026-08-01T00:00:00Z", "2026-08-15T12:00:00Z", { inicio: "2026-08-10T00:00:00Z", media: "0.50" });
  await admin.query("update erp.areas set deleted_at = now() where id=$1", [area["excluida"]]);

  const outraOrg = (await admin.query<{ id: string }>("insert into erp.organizations (name, slug) values ('[TEST] Outra Mapa geral','outra-mapa-geral') returning id")).rows[0]!.id;
  const empresaOutra = (await admin.query<{ id: string }>("insert into erp.empresas (organization_id, code, name) values ($1, 96, '[TEST] Empresa outra org Mapa geral') returning id", [outraOrg])).rows[0]!.id;
  area["outraOrg"] = await novaArea(empresaOutra, "MG00-outra-org", outraOrg);
  await execucao(area["outraOrg"]!, "2026-08-01T00:00:00Z", "2026-08-15T12:00:00Z", { inicio: "2026-08-10T00:00:00Z", media: "0.80" }, outraOrg);

  soB = await membro("Mapa geral só B", "mapa-geral-so-b@demo.local", [{ modulo: "pecuaria", modo: "selecionadas", empresas: [B] }]);
  soMapa = await membro("Mapa geral só mapa", "mapa-geral-so-mapa@demo.local", [{ modulo: "mapa", modo: "todas", empresas: [] }]);
}, 180_000);

afterAll(async () => {
  await admin?.end();
  await h?.app.close(); await h?.db.end();
});

describe("MAPA-GERAL resumo — o que cada área mostra", () => {
  it("só as áreas do escopo com execução: sem a excluída, sem a de outra organização, sem a área nunca analisada", async () => {
    const r = await resumo();
    expect(r.statusCode, r.body).toBe(200);
    const c = j(r);
    expect(c.itens.map((i) => i.area_id)).toEqual([area["varias"], area["semUtil"], area["deB"]]);
    expect(c).toMatchObject({ pagina: 1, tamanho: 500, tem_mais: false });
  });

  it("última útil = a análise MAIS RECENTE da imagem mais recente; anterior = OUTRA imagem; variação em numeric; última execução sem imagem útil", async () => {
    const i = porArea(j(await resumo())).get(area["varias"]!)!;
    expect(i.ultima_execucao).toEqual({ situacao: "sem_observacao_util", motivo_qualidade: "sem_aquisicao", criado_em: "2026-09-01T12:00:00.000Z" });
    expect(i.ultima_observacao).toEqual({
      observacao_inicio: "2026-08-05T00:00:00.000Z", observacao_fim: "2026-08-06T00:00:00.000Z",
      valor_medio: "0.7400", valor_minimo: "0.5400", valor_maximo: "0.8400", desvio_padrao: "0.0500",
      cobertura_valida: "0.9275", pixels_validos: 11000, do_poligono_atual: true, criado_em: "2026-08-12T12:00:00.000Z"
    });
    expect(i.observacao_anterior).toEqual({ observacao_inicio: "2026-07-05T00:00:00.000Z", valor_medio: "0.6000" });
    expect(i.variacao).toBe("0.1400");
  });

  it("área só com execução sem imagem útil: a execução aparece, nenhum número (nem observação, nem anterior, nem variação)", async () => {
    const i = porArea(j(await resumo())).get(area["semUtil"]!)!;
    expect(i).toEqual({
      area_id: area["semUtil"], ultima_execucao: { situacao: "sem_observacao_util", motivo_qualidade: "sem_aquisicao", criado_em: "2026-09-02T12:00:00.000Z" },
      ultima_observacao: null, observacao_anterior: null, variacao: null
    });
  });

  it("uma imagem só: sem anterior e sem variação; polígono redesenhado → área some do resumo operacional (não pinta valor antigo)", async () => {
    const i = porArea(j(await resumo())).get(area["deB"]!)!;
    expect(i.ultima_observacao).toMatchObject({ valor_medio: "0.4500", do_poligono_atual: true });
    expect(i.observacao_anterior).toBeNull();
    expect(i.variacao).toBeNull();
    // SATÉLITE COMPLETO R1: contorno antigo NÃO coloriza o mapa. Restaura o polígono para não
    // derrubar os testes de escopo/paginação que compartilham a área deB.
    const geomAntes = (await admin.query<{ geometria: unknown }>("select geometria from erp.areas where id=$1", [area["deB"]])).rows[0]!.geometria;
    await admin.query("update erp.areas set geometria=$2 where id=$1", [area["deB"], JSON.stringify(quadrado(-56.1, -15.6, 0.012))]);
    expect(porArea(j(await resumo())).get(area["deB"]!)).toBeUndefined();
    await admin.query("update erp.areas set geometria=$2 where id=$1", [area["deB"], JSON.stringify(geomAntes)]);
    expect(porArea(j(await resumo())).get(area["deB"]!)?.ultima_observacao).toMatchObject({ valor_medio: "0.4500", do_poligono_atual: true });
  });
});

describe("MAPA-GERAL resumo — capacidade × escopo", () => {
  it("escopo só na empresa B: só a área de B", async () => {
    const r = await resumo("", soB);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).itens.map((i) => i.area_id)).toEqual([area["deB"]]);
  });
  it("capacidade com escopo só no módulo `mapa` (nada em pecuária): lista VAZIA, nunca todas — o módulo vem da permissão", async () => {
    const r = await resumo("", soMapa);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toEqual({
      itens: [], pagina: 1, tamanho: 500, tem_mais: false,
      modo: "ultima", data_imagem: null, contexto: null, versao_metodo: null
    });
  });
  it("seleção de empresa (X-Empresa-Id) só diminui: o dono com B selecionada vê só B; empresa proibida → 403", async () => {
    const dono = await resumo("", h.headers({ "x-empresa-id": B }));
    expect(dono.statusCode, dono.body).toBe(200);
    expect(j(dono).itens.map((i) => i.area_id)).toEqual([area["deB"]]);
    const proibida = await resumo("", { ...soB, "x-empresa-id": A });
    expect(proibida.statusCode, proibida.body).toBe(403);
  });
  it("sem a capacidade (operador): 403 PERMISSION_DENIED", async () => {
    const r = await resumo("", h.opHeaders());
    expect(r.statusCode, r.body).toBe(403);
    expect(j(r).error.code).toBe("PERMISSION_DENIED");
  });
});

describe("MAPA-GERAL resumo — paginação, contrato e custo", () => {
  it("página no servidor: tamanho 1 percorre as três áreas na ordem do código, com tem_mais", async () => {
    const vistas: string[] = [];
    for (const [pagina, temMais] of [[1, true], [2, true], [3, false]] as const) {
      const r = await resumo(`?tamanho=1&pagina=${pagina}`);
      expect(r.statusCode, r.body).toBe(200);
      const c = j(r);
      expect(c.itens).toHaveLength(1);
      expect(c).toMatchObject({ pagina, tamanho: 1, tem_mais: temMais });
      vistas.push(c.itens[0]!.area_id);
    }
    expect(vistas).toEqual([area["varias"], area["semUtil"], area["deB"]]);
    expect(j(await resumo("?tamanho=1&pagina=4")).itens).toEqual([]);
  });
  it("contrato estrito: chave desconhecida (inclusive empresa no query), índice desconhecido e tamanho fora da faixa → 422", async () => {
    for (const q of [`?empresa_id=${A}`, "?area_id=x", "?indice=evi", "?tamanho=0", "?tamanho=501", "?pagina=0",
      // número fora da forma canônica é RECUSADO, nunca traduzido (1e2 viraria 100; 0x2 viraria 2)
      "?tamanho=1e2", "?pagina=0x2", "?tamanho=%203", "?tamanho=2.0", "?pagina=01", "?tamanho=-1"]) {
      const r = await resumo(q);
      expect(r.statusCode, `${q}: ${r.body}`).toBe(422);
      expect(j(r).error.code, q).toBe("VALIDATION_ERROR");
    }
  });
  it("UMA consulta às análises para a página inteira, com três áreas — não uma por área", async () => {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let r: Awaited<ReturnType<typeof resumo>>;
    try {
      r = await resumo();
      const consultas = espiao.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : (c[0] as { text?: string } | undefined)?.text ?? ""))
        .filter((sql) => /erp\.analises_satelitais/.test(sql));
      expect(consultas, consultas.map((s) => s.slice(0, 120)).join(" || ")).toHaveLength(1);
      expect(espiao.mock.calls.map((c) => String(typeof c[0] === "string" ? c[0] : "")).filter((sql) => /from erp\.areas/.test(sql))).toHaveLength(1);
    } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).itens, "premissa: a página tem mais de uma área").toHaveLength(3);
  });
  it("o escopo de empresa está em CADA ocorrência de tabela da consulta (usuário com escopo selecionado): 1 em áreas, 4 em análises", async () => {
    const espiao = vi.spyOn(pg.Client.prototype, "query");
    let sql = "";
    let r: Awaited<ReturnType<typeof resumo>>;
    try {
      r = await resumo("", soB);
      sql = espiao.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : "")).find((t) => /erp\.analises_satelitais/.test(t)) ?? "";
    } finally { espiao.mockRestore(); }
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).itens.map((i) => i.area_id), "premissa: o escopo recorta").toEqual([area["deB"]]);
    const conta = (re: RegExp) => (sql.match(re) ?? []).length;
    expect(conta(/from erp\.areas a\b/g), "uma ocorrência de erp.areas").toBe(1);
    expect(conta(/me\.empresa_id=a\.empresa_id/g), "escopo na área").toBe(1);
    expect(conta(/from erp\.analises_satelitais [es]\b/g), "quatro ocorrências de erp.analises_satelitais").toBe(4);
    expect(conta(/me\.empresa_id=e\.empresa_id/g), "escopo no exists e na última execução").toBe(2);
    expect(conta(/me\.empresa_id=s\.empresa_id/g), "escopo nas duas imagens úteis").toBe(2);
  });
});
