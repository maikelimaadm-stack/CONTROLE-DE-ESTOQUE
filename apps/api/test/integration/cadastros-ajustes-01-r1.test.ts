import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * CADASTROS — AJUSTES 01 · R1 (revisão da PR #63) — testes das correções da API (A-1, A-3, A-4, A-6, A-8, A-9,
 * A-10, A-11) e das guardas que tinham ficado sem teste nas reescritas (T-2, T-4). Os do Zerar (A-2) estão em
 * cadastros-ajustes-01-numeracao.test.ts (ZN-7, ZN-8, ZN-9); A-5 no AR-5a (cadastros-arvore-analitico) e A-7 no CE-1
 * (cadastros-estrutura). Toda recusa confere o BANCO (nada gravado / nada mudado).
 *
 * Reversas dos MÉDIOS (executadas e desfeitas; o relatório do agente T traz a saída):
 *   RV-A1: sem `conferirMatriz` (só "viva e desta organização") → MZ-1 vermelho (Física/inativa/filial/ciclo aceitos);
 *   RV-A3: o Mover volta a gravar num UPDATE só → MV-9 vermelho (409 onde a prévia deu 200).
 */
let h: Harness; let admin: Db;
type Resp = { statusCode: number; body: string };
type Det = { path: string | string[]; message: string; aba?: string | null };
const j = (r: Resp) => JSON.parse(r.body);
const hdr = () => h.headers({ "content-type": "application/json" });
const url = (key: string) => `/api/resources/${key}`;
const get = (u: string) => h.app.inject({ method: "GET", url: u, headers: h.headers() });
const post = (key: string, payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: url(key), headers: hdr(), payload });
const put = (key: string, id: string, payload: Record<string, unknown>) => h.app.inject({ method: "PUT", url: `${url(key)}/${id}`, headers: hdr(), payload });
const criado = (r: Resp) => { expect(r.statusCode, r.body).toBe(201); return j(r) as { id: string; code: string }; };
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows;
const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await admin.query<T>(sql, p)).rows[0];
const detalhes = (r: Resp) => ((j(r).error?.details ?? []) as Det[]).map((d) => ({ path: ([] as (string | number)[]).concat(d.path).join("."), message: d.message, aba: d.aba ?? null }));
const recusaNoCampo = (r: Resp, path: string, message: string) => {
  expect(r.statusCode, r.body).toBe(422);
  expect(detalhes(r).map((d) => [d.path, d.message]), `422 no campo ${path}: ${r.body}`).toContainEqual([path, message]);
};
const previa = (key: string, id: string, superior: string | null) => get(`${url(key)}/${id}/mover/previa?superior=${superior ?? "raiz"}`);
const mover = (key: string, id: string, superior: string | null) => h.app.inject({ method: "POST", url: `${url(key)}/${id}/mover`, headers: hdr(), payload: { superior } });
const codigoDe = async (id: string, tabela = "financial_categories") => (await um<{ code: string | null }>(`select code from erp.${tabela} where id=$1`, [id]))!.code;
const nome = (s: string) => `R1 ${s} ${Math.random().toString(36).slice(2, 8)}`;
const NAT = "financial_categories";
const natureza = (payload: Record<string, unknown>) => post(NAT, { nature: "income", kind: "analytic", ...payload });

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 4 }); }, 240_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

// ───────────────────────────── A-1 MATRIZ ─────────────────────────────
describe("MZ-1 (A-1) a Matriz é viva, ativa, Jurídica, da organização, não ele mesmo e não filial; quem tem filiais não vira filial", () => {
  const pessoa = async (extra: Record<string, unknown> = {}) => criado(await post("people", { name: nome("parceiro"), person_type: "legal", is_client: true, ...extra })).id;
  const matrizDe = async (id: string) => (await um<{ matriz_id: string | null }>("select matriz_id from erp.people where id=$1", [id]))!.matriz_id;
  const porNome = async (x: string) => Number((await um<{ n: string }>("select count(*)::text n from erp.people where organization_id=$1 and name=$2", [h.demo.orgId, x]))!.n);

  it("Física, Estrangeira, inativa, filial de outro → 422 no campo matriz_id (aba Identificação); nada gravado", async () => {
    const fisica = await pessoa({ person_type: "natural" });
    const estrangeira = await pessoa({ person_type: "foreign" });
    const inativa = await pessoa();
    await admin.query("update erp.people set is_active=false where id=$1", [inativa]);
    const matriz = await pessoa();
    const filial = await pessoa({ matriz_id: matriz });
    expect(await matrizDe(filial), "premissa: a filial válida grava").toBe(matriz);
    const casos: [string, string][] = [
      [fisica, "A matriz precisa ser pessoa Jurídica (a escolhida está como Física)."],
      [estrangeira, "A matriz precisa ser pessoa Jurídica (a escolhida está como Estrangeira)."],
      [inativa, "A matriz escolhida está inativa."],
      [filial, "A matriz escolhida é filial de outro parceiro: escolha a matriz dela."]
    ];
    for (const [m, msg] of casos) {
      const x = nome("filial recusada");
      const r = await post("people", { name: x, person_type: "legal", is_client: true, matriz_id: m });
      recusaNoCampo(r, "matriz_id", msg);
      expect(detalhes(r).find((d) => d.path === "matriz_id")?.aba, "a recusa aponta a aba da Matriz").toBe("identificacao");
      expect(await porNome(x), `${msg}: nada gravado`).toBe(0);
    }
  });

  it("ciclo A→B e B→A: B é matriz de A, então B não vira filial de A (nem de ninguém); nada muda", async () => {
    const a = await pessoa(); const b = await pessoa(); const c = await pessoa();
    const ab = await put("people", a, { matriz_id: b });
    expect(ab.statusCode, ab.body).toBe(200);
    recusaNoCampo(await put("people", b, { matriz_id: a }), "matriz_id", "A matriz escolhida é filial de outro parceiro: escolha a matriz dela.");
    recusaNoCampo(await put("people", b, { matriz_id: c }), "matriz_id", "Este parceiro é matriz de outros parceiros e não pode ser filial.");
    expect([await matrizDe(a), await matrizDe(b)]).toEqual([b, null]);
  });

  it("ids em outra caixa: ele mesmo em maiúsculas → 422; a matriz em maiúsculas grava na forma canônica", async () => {
    const a = await pessoa(); const m = await pessoa();
    recusaNoCampo(await put("people", a, { matriz_id: a.toUpperCase() }), "matriz_id", "O parceiro não pode ser a matriz dele mesmo.");
    expect(await matrizDe(a)).toBeNull();
    const ok = await put("people", a, { matriz_id: m.toUpperCase() });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await matrizDe(a), "gravada em minúsculas").toBe(m);
  });

  it("confere SÓ quando a matriz muda: a matriz excluída ou inativada DEPOIS não trava a edição da filial (nem o reenvio da mesma matriz)", async () => {
    const m = await pessoa(); const f = await pessoa({ matriz_id: m });
    await admin.query("update erp.people set deleted_at=now() where id=$1", [m]);
    const renomeia = await put("people", f, { name: nome("filial renomeada") });
    expect(renomeia.statusCode, renomeia.body).toBe(200);
    const reenvia = await put("people", f, { matriz_id: m.toUpperCase(), name: nome("filial reenviada") });
    expect(reenvia.statusCode, `a mesma matriz (em outra caixa) não é trocada: ${reenvia.body}`).toBe(200);
    expect(await matrizDe(f)).toBe(m);
    // trocar para OUTRA matriz excluída continua recusado (a regra vale na mudança)
    const outra = await pessoa();
    await admin.query("update erp.people set deleted_at=now() where id=$1", [outra]);
    recusaNoCampo(await put("people", f, { matriz_id: outra }), "matriz_id", "Matriz não encontrada entre os parceiros ativos.");
    expect(await matrizDe(f)).toBe(m);
  });
});

// ───────────────────────────── A-3 / A-4 / A-6 MOVER ─────────────────────────────
describe("MV-9 (A-3) Mover em duas fases: o cenário que dava 409 com a prévia 200", () => {
  it("L → <destino>.01.001 com o excluído E do galho SEGURANDO esse código: 200; E vira EXC-<id>; prévia = POST = auditoria", async () => {
    const destino = criado(await natureza({ name: nome("MV9 destino"), nature: "both", kind: "synthetic" }));
    const receitas = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1' and deleted_at is null", [h.demo.orgId]))!.id;
    const galho = criado(await natureza({ name: nome("MV9 galho"), parent_id: receitas, kind: "synthetic" }));
    const vivo = criado(await natureza({ name: nome("MV9 vivo L"), parent_id: galho.id }));
    const excluido = criado(await natureza({ name: nome("MV9 excluído E"), parent_id: galho.id }));
    const cd = await codigoDe(destino.id);
    const futuroDoVivo = `${cd}.01.001`;
    expect(await codigoDe(vivo.id), "premissa: L é o primeiro filho do galho").toBe(`${await codigoDe(galho.id)}.001`);
    // o acervo: E (excluído, ainda no galho) segura HOJE o código que L vai receber
    await admin.query("update erp.financial_categories set deleted_at=now(), code=$2 where id=$1", [excluido.id, futuroDoVivo]);
    const p = await previa(NAT, galho.id, destino.id);
    expect(p.statusCode, p.body).toBe(200);
    expect(j(p).codigos).toContainEqual({ id: vivo.id, antes: `${await codigoDe(galho.id)}.001`, depois: futuroDoVivo });
    expect(j(p).codigos).toContainEqual({ id: excluido.id, antes: futuroDoVivo, depois: `EXC-${excluido.id}` });
    const r = await mover(NAT, galho.id, destino.id);
    expect(r.statusCode, `a prévia deu 200 — o POST do MESMO plano também: ${r.body}`).toBe(200);
    expect(j(r).codigos, "prévia = POST").toEqual(j(p).codigos);
    expect([await codigoDe(galho.id), await codigoDe(vivo.id), await codigoDe(excluido.id)]).toEqual([`${cd}.01`, futuroDoVivo, `EXC-${excluido.id}`]);
    expect(await q("select code from erp.financial_categories where code like 'MOVER-%'"), "nenhum código provisório sobra").toEqual([]);
    const log = await um<{ metadata: { codigos: unknown } }>("select metadata from erp.audit_logs where organization_id=$1 and entity='financial_categories' and entity_id=$2 and action='mover' order by id desc limit 1", [h.demo.orgId, galho.id]);
    expect(log?.metadata.codigos, "a auditoria leva o mesmo plano").toEqual(j(r).codigos);
  });
});

describe("MV-10 (A-4) excluídos e o Mover", () => {
  // O código novo do MOVIDO nunca colide (o próximo debaixo do destino conta os excluídos); quem colide é o código
  // RENUMERADO de um descendente — daí o galho com filho.
  const galhoComFilho = async (rotulo: string) => {
    const receitas = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1' and deleted_at is null", [h.demo.orgId]))!.id;
    const destino = criado(await natureza({ name: nome(`${rotulo} destino`), nature: "both", kind: "synthetic" }));
    const galho = criado(await natureza({ name: nome(`${rotulo} galho`), parent_id: receitas, kind: "synthetic" }));
    const vivo = criado(await natureza({ name: nome(`${rotulo} vivo`), parent_id: galho.id }));
    const cd = await codigoDe(destino.id);
    return { destino: destino.id, galho: galho.id, vivo: vivo.id, novoGalho: `${cd}.01`, novoVivo: `${cd}.01.001`, antesGalho: await codigoDe(galho.id), antesVivo: await codigoDe(vivo.id) };
  };
  it("Naturezas: excluído FORA do galho que segura o código novo de um vivo → liberado como EXC-<id> (par no plano, na prévia e na auditoria), em vez de travar o Mover", async () => {
    const g = await galhoComFilho("MV10");
    const fora = (await um<{ id: string }>("insert into erp.financial_categories(organization_id,code,name,nature,kind,deleted_at) values ($1,$2,$3,'both','analytic',now()) returning id", [h.demo.orgId, g.novoVivo, nome("MV10 excluído de fora")]))!.id;
    const esperado = [{ id: g.galho, antes: g.antesGalho, depois: g.novoGalho }, { id: g.vivo, antes: g.antesVivo, depois: g.novoVivo }, { id: fora, antes: g.novoVivo, depois: `EXC-${fora}` }];
    const p = await previa(NAT, g.galho, g.destino);
    expect(p.statusCode, p.body).toBe(200);
    expect(j(p).codigos).toEqual(esperado);
    const r = await mover(NAT, g.galho, g.destino);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).codigos, "prévia = POST").toEqual(esperado);
    expect([await codigoDe(g.galho), await codigoDe(g.vivo), await codigoDe(fora)]).toEqual([g.novoGalho, g.novoVivo, `EXC-${fora}`]);
    expect((await um<{ excluido: boolean }>("select deleted_at is not null as excluido from erp.financial_categories where id=$1", [fora]))!.excluido, "a linha de fora continua lá, excluída").toBe(true);
    const log = await um<{ metadata: { codigos: unknown[] } }>("select metadata from erp.audit_logs where organization_id=$1 and entity_id=$2 and action='mover' order by id desc limit 1", [h.demo.orgId, g.galho]);
    expect(log?.metadata.codigos, "o par do excluído de fora vai na auditoria").toContainEqual({ id: fora, antes: g.novoVivo, depois: `EXC-${fora}` });
  });

  it("Naturezas: VIVO fora do galho segurando o código novo de um descendente continua recusando (422 legível no superior, nunca 409); nada muda", async () => {
    const g = await galhoComFilho("MV10b");
    const vivoDeFora = criado(await natureza({ name: nome("MV10b vivo de fora"), nature: "both" })).id;
    await admin.query("update erp.financial_categories set code=$2 where id=$1", [vivoDeFora, g.novoVivo]);
    const r = await mover(NAT, g.galho, g.destino);
    recusaNoCampo(r, "superior", `O código ${g.novoVivo} já existe neste cadastro.`);
    expect([await codigoDe(g.galho), await codigoDe(g.vivo), await codigoDe(vivoDeFora)]).toEqual([g.antesGalho, g.antesVivo, g.novoVivo]);
  });

  it("Grupos de Produtos (código único só entre VIVOS): excluído — fora ou dentro do galho — não segura código: o vivo recebe o código, o excluído do galho acompanha com o prefixo novo, ninguém vira EXC sem necessidade", async () => {
    const G = "product_groups";
    const raiz1 = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and code='1' and deleted_at is null", [h.demo.orgId]))!.id;
    const raiz2 = (await um<{ id: string }>("select id from erp.product_groups where organization_id=$1 and code='2' and deleted_at is null", [h.demo.orgId]))!.id;
    const destino = criado(await post(G, { name: nome("MV10c destino"), kind: "synthetic", parent_id: raiz1 }));
    const galho = criado(await post(G, { name: nome("MV10c galho"), kind: "synthetic", parent_id: raiz2 }));
    const vivo = criado(await post(G, { name: nome("MV10c vivo"), kind: "analytic", parent_id: galho.id }));
    const exc = criado(await post(G, { name: nome("MV10c excluído do galho"), kind: "analytic", parent_id: galho.id }));
    await admin.query("update erp.product_groups set deleted_at=now() where id=$1", [exc.id]);
    const cd = await codigoDe(destino.id, G);
    const novoGalho = `${cd}.001`;
    const [novoVivo, novoExc] = [`${novoGalho}.0001`, `${novoGalho}.0002`];
    // excluídos de FORA segurando os códigos novos do vivo e do excluído do galho
    const foraDoVivo = (await um<{ id: string }>("insert into erp.product_groups(organization_id,name,code,kind,deleted_at) values ($1,$2,$3,'analytic',now()) returning id", [h.demo.orgId, nome("MV10c fora 1"), novoVivo]))!.id;
    const foraDoExc = (await um<{ id: string }>("insert into erp.product_groups(organization_id,name,code,kind,deleted_at) values ($1,$2,$3,'analytic',now()) returning id", [h.demo.orgId, nome("MV10c fora 2"), novoExc]))!.id;
    const p = await previa(G, galho.id, destino.id);
    expect(p.statusCode, p.body).toBe(200);
    const r = await mover(G, galho.id, destino.id);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r).codigos, "prévia = POST").toEqual(j(p).codigos);
    expect([await codigoDe(galho.id, G), await codigoDe(vivo.id, G), await codigoDe(exc.id, G)], "o excluído do galho ACOMPANHA (não vira EXC)").toEqual([novoGalho, novoVivo, novoExc]);
    expect([await codigoDe(foraDoVivo, G), await codigoDe(foraDoExc, G)], "os excluídos de fora não são liberados sem necessidade").toEqual([novoVivo, novoExc]);
    expect((j(r).codigos as { depois: string }[]).filter((c) => c.depois.startsWith("EXC-")), "nenhuma liberação no plano").toEqual([]);
  });
});

describe("MV-11 (A-6) a auditoria do Mover grava o id CANÔNICO, não o da URL", () => {
  it("POST /mover com o id em maiúsculas: 200 e o histórico do registro (id em minúsculas) acha o Mover", async () => {
    const destino = criado(await natureza({ name: nome("MV11 destino"), nature: "both", kind: "synthetic" }));
    const receitas = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1' and deleted_at is null", [h.demo.orgId]))!.id;
    const folha = criado(await natureza({ name: nome("MV11 folha"), parent_id: receitas }));
    const r = await mover(NAT, folha.id.toUpperCase(), destino.id.toUpperCase());
    expect(r.statusCode, r.body).toBe(200);
    expect(await q("select entity_id from erp.audit_logs where organization_id=$1 and action='mover' and lower(entity_id)=$2", [h.demo.orgId, folha.id]), "um audit, com o id canônico").toEqual([{ entity_id: folha.id }]);
    expect((await um<{ parent_id: string }>("select parent_id from erp.financial_categories where id=$1", [folha.id]))!.parent_id).toBe(destino.id);
  });
});

// ───────────────────────────── A-8 máscara lida sob a trava ─────────────────────────────
describe("MK-2 (A-8) PUT /admin/parameters lê as máscaras ATUAIS sob a trava da geração", () => {
  it("máscara trocada por outra sessão enquanto o PUT espera a trava: o PUT reenviando a máscara antiga é MUDANÇA → 422 (Centros com registros), e a nova não é desfeita", async () => {
    const mascaraAtual = async () => (await um<{ m: string | null }>("select parameters->'mascaras_codigo'->>'cost_centers' m from erp.organizations where id=$1", [h.demo.orgId]))!.m;
    expect(await mascaraAtual(), "premissa: Centros na máscara padrão").toBeNull();
    const vivos = Number((await um<{ n: string }>("select count(*)::text n from erp.cost_centers where organization_id=$1 and deleted_at is null", [h.demo.orgId]))!.n);
    expect(vivos, "premissa: Centros com registros").toBeGreaterThan(0);
    const outra = await admin.connect();
    try {
      await outra.query("begin");
      // outra sessão segura a trava da numeração de Centros e grava uma máscara nova (como um Zerar + troca de máscara)
      await outra.query("select pg_advisory_xact_lock(hashtext('codigo-cadastro:' || 'cost_centers' || ':' || $1))", [h.demo.orgId]);
      await outra.query("update erp.organizations set parameters = jsonb_set(coalesce(parameters, '{}'::jsonb), '{mascaras_codigo}', '{\"cost_centers\":\"9.9.99\"}'::jsonb) where id=$1", [h.demo.orgId]);
      // a tela manda o objeto de máscaras que ela LEU antes (vazio = padrão para todos): pela leitura de antes, "sem mudança"
      const pedido = h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: hdr(), payload: { mascaras_codigo: {} } });
      const esperando = async () => (await q<{ n: number }>("select count(*)::int n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'"))[0]!.n;
      for (let t = 0; t < 100 && (await esperando()) < 1; t++) await new Promise((r) => setTimeout(r, 20));
      expect(await esperando(), "premissa: o PUT espera a outra sessão").toBe(1);
      await outra.query("commit");
      const r = await pedido;
      recusaNoCampo(r, "mascaras_codigo.cost_centers", `Há ${vivos} registros: a máscara só muda com o cadastro vazio.`);
      expect(await mascaraAtual(), "a máscara nova NÃO foi desfeita em silêncio").toBe("9.9.99");
    } finally {
      await outra.query("rollback").catch(() => undefined); outra.release();
      await admin.query("update erp.organizations set parameters = parameters - 'mascaras_codigo' where id=$1", [h.demo.orgId]);
    }
  }, 30_000);
});

describe("MK-3 (A-8, correção da verificação) a leitura das máscaras trava a linha da organização SEM parar as inclusões dela", () => {
  it("PUT /admin/parameters parado DEPOIS de ler a máscara (na contagem dos Centros): a linha da organização está travada, mas uma inclusão da MESMA organização noutra tabela não espera (a FK toma FOR KEY SHARE); o PUT termina com a recusa de sempre", async () => {
    const mascaraAtual = async () => (await um<{ m: string | null }>("select parameters->'mascaras_codigo'->>'cost_centers' m from erp.organizations where id=$1", [h.demo.orgId]))!.m;
    expect(await mascaraAtual(), "premissa: Centros na máscara padrão").toBeNull();
    const vivos = Number((await um<{ n: string }>("select count(*)::text n from erp.cost_centers where organization_id=$1 and deleted_at is null", [h.demo.orgId]))!.n);
    expect(vivos, "premissa: Centros com registros").toBeGreaterThan(0);
    const trava = await admin.connect(); const outra = await admin.connect();
    try {
      // a contagem dos Centros (que vem DEPOIS da leitura da máscara) fica parada enquanto esta sessão segura a tabela
      await trava.query("begin");
      await trava.query("lock table erp.cost_centers in access exclusive mode");
      const pedido = h.app.inject({ method: "PUT", url: "/api/admin/parameters", headers: hdr(), payload: { mascaras_codigo: { cost_centers: "9.9.99" } } });
      const parado = async () => (await q<{ n: number }>("select count(*)::int n from pg_locks where not granted and relation = 'erp.cost_centers'::regclass"))[0]!.n;
      for (let t = 0; t < 150 && (await parado()) < 1; t++) await new Promise((r) => setTimeout(r, 20));
      expect(await parado(), "premissa: o PUT espera na contagem dos Centros").toBe(1);
      // premissa: o PUT JÁ segura a linha da organização (a leitura da máscara vem antes da contagem)
      await expect(outra.query("select 1 from erp.organizations where id=$1 for no key update nowait", [h.demo.orgId]), "premissa: a linha da organização está travada pelo PUT").rejects.toMatchObject({ code: "55P03" });
      // a inclusão da mesma organização (FK → organizations) passa sem esperar a gravação de parâmetros
      await outra.query("begin");
      await outra.query("set local lock_timeout = '2s'");
      const incluido = await outra.query("insert into erp.people(organization_id, code, name, person_type) values ($1, $2, $3, 'legal') returning id", [h.demo.orgId, `MK3-${Date.now()}`, nome("MK-3 inclusão durante o PUT")]);
      expect(incluido.rowCount, "a inclusão não esperou o PUT (FOR NO KEY UPDATE não conflita com o FOR KEY SHARE da FK)").toBe(1);
      await outra.query("rollback");
      await trava.query("commit");
      const r = await pedido;
      recusaNoCampo(r, "mascaras_codigo.cost_centers", `Há ${vivos} registros: a máscara só muda com o cadastro vazio.`);
      expect(await mascaraAtual(), "nada mudou").toBeNull();
    } finally {
      await outra.query("rollback").catch(() => undefined); outra.release();
      await trava.query("rollback").catch(() => undefined); trava.release();
      await admin.query("update erp.organizations set parameters = parameters - 'mascaras_codigo' where id=$1", [h.demo.orgId]);
    }
  }, 30_000);
});

// ───────────────────────────── A-10 ─────────────────────────────
describe("A-10 CAEPF no esquema do campo; página das referências limitada; id malformado no Mover → 404", () => {
  it("CAEPF fora de ^\\d{14}$ → 422 no campo caepf, na aba Identificação, com a mensagem do registry (não a do CHECK do banco); nada gravado", async () => {
    for (const caepf of ["123", "1234567890123A", "12.345.678/0001-9"]) {
      const x = nome("caepf");
      const r = await post("people", { name: x, person_type: "natural", is_client: true, caepf });
      recusaNoCampo(r, "caepf", "Informe os 14 dígitos do CAEPF (só números).");
      expect(detalhes(r).find((d) => d.path === "caepf")?.aba, caepf).toBe("identificacao");
      expect(Number((await um<{ n: string }>("select count(*)::text n from erp.people where organization_id=$1 and name=$2", [h.demo.orgId, x]))!.n), caepf).toBe(0);
    }
    const ok = await post("people", { name: nome("caepf ok"), person_type: "natural", is_client: true, caepf: "12345678901234" });
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("?page acima de 1000 (1e308 dava 500) → 422 no parâmetro; 1000 → 200", async () => {
    for (const page of ["1e308", "1001", "99999999999"]) {
      const r = await get(`/api/referencias/bancos?page=${page}`);
      expect(r.statusCode, `page=${page}: ${r.body}`).toBe(422);
      expect(detalhes(r).map((d) => d.path), page).toContain("page");
    }
    const limite = await get("/api/referencias/bancos?page=1000");
    expect(limite.statusCode, limite.body).toBe(200);
  });

  it("id malformado nas rotas do Mover → a mesma 404 de inexistente (antes, 500 do cast); inexistente → 404", async () => {
    const destino = (await um<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='1'", [h.demo.orgId]))!.id;
    for (const id of ["nao-e-uuid", "123", "00000000-0000-0000-0000-00000000000Z"]) {
      const p = await previa(NAT, id, destino);
      expect(p.statusCode, `prévia ${id}: ${p.body}`).toBe(404);
      const m = await mover(NAT, id, destino);
      expect(m.statusCode, `mover ${id}: ${m.body}`).toBe(404);
      expect(j(m).error.message, "a mesma mensagem da inexistente").toBe(j(await mover(NAT, "00000000-0000-4000-8000-000000000000", destino)).error.message);
    }
  });
});

// ───────────────────────────── A-11 ─────────────────────────────
describe("A-11 0030: CHECK do par latitude/longitude no BANCO (people e parceiro_enderecos)", () => {
  it("par pela metade por SQL direto → 23514 nos dois checks nomeados; par completo e par vazio gravam", async () => {
    const p = criado(await post("people", { name: nome("coords"), person_type: "legal", is_client: true, enderecos: [{ tipo: "entrega", logradouro: "Rua R1" }] })).id;
    const end = (await um<{ id: string }>("select id from erp.parceiro_enderecos where person_id=$1", [p]))!.id;
    const casos: [string, string, string][] = [
      ["update erp.people set latitude=-15.2, longitude=null where id=$1", p, "chk_people_par_coordenadas"],
      ["update erp.people set latitude=null, longitude=-59.3 where id=$1", p, "chk_people_par_coordenadas"],
      ["update erp.parceiro_enderecos set latitude=-15.2, longitude=null where id=$1", end, "chk_parceiro_enderecos_par_coordenadas"],
      ["update erp.parceiro_enderecos set latitude=null, longitude=-59.3 where id=$1", end, "chk_parceiro_enderecos_par_coordenadas"]
    ];
    for (const [sql, id, constraint] of casos) {
      await expect(admin.query(sql, [id]), sql).rejects.toMatchObject({ code: "23514", constraint });
    }
    await admin.query("update erp.people set latitude=-15.2, longitude=-59.3 where id=$1", [p]);
    await admin.query("update erp.parceiro_enderecos set latitude=-15.2, longitude=-59.3 where id=$1", [end]);
    await admin.query("update erp.people set latitude=null, longitude=null where id=$1", [p]);
    // a faixa continua sendo a do check da faixa (o do par é conferido depois, por nome)
    await expect(admin.query("update erp.people set latitude=91, longitude=0 where id=$1", [p])).rejects.toMatchObject({ code: "23514" });
  });
});

// ───────────────────────────── T-2 guardas que tinham ficado sem teste ─────────────────────────────
describe("T-2 importação com código FORA da máscara é recusada (o código da planilha continua conferido)", () => {
  it("Plano de Contas: raiz com dois dígitos e filho com largura errada → 422 na linha, com a máscara e o formato; nada gravado", async () => {
    const m = await h.app.inject({ method: "GET", url: "/api/imports/chart_accounts/modelo", headers: h.headers() });
    expect(m.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(m.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Dados")!; const cab: string[] = []; ws.getRow(1).eachCell((c) => cab.push(String(c.value)));
    const col = (t: string) => { const n = cab.indexOf(t) + 1; if (!n) throw new Error(`coluna ${t}: ${cab.join("|")}`); return n; };
    const antes = Number((await um<{ n: string }>("select count(*)::text n from erp.chart_accounts where organization_id=$1", [h.demo.orgId]))!.n);
    for (const [i, code] of ["12", "1.1"].entries()) {
      const row = ws.getRow(i + 2);
      row.getCell(col("Código *")).value = code; row.getCell(col("Descrição *")).value = `R1 T2 ${code}`; row.getCell(col("Condição *")).value = "Ambos"; row.getCell(col("Analítica *")).value = "Não"; row.commit();
    }
    const r = await h.app.inject({ method: "POST", url: "/api/imports/chart_accounts?simular=0", headers: hdr(), payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
    expect(r.statusCode, r.body).toBe(422);
    const erros = j(r).erros as { linha: number; mensagem: string }[];
    expect(erros.map((e) => e.linha).sort()).toEqual([2, 3]);
    for (const e of erros) expect(e.mensagem, `linha ${e.linha}`).toMatch(/máscara 9\.99\.999\.9999\).* Use o formato 9\.99\.999\.9999\./);
    expect(Number((await um<{ n: string }>("select count(*)::text n from erp.chart_accounts where organization_id=$1", [h.demo.orgId]))!.n), "nada gravado").toBe(antes);
  });
});

describe("T-2 / A-9 PUT de árvore SEM código (Endereçamentos): pai de si mesmo e ciclo → 422, em qualquer caixa", () => {
  const MSG = "O superior não pode ser o próprio registro nem um descendente dele.";
  it("pai de si mesmo (mesma caixa, maiúsculas no corpo ou na URL) e ciclo (neto como superior do avô) → 422 em parent_id; nada muda", async () => {
    const galpao = criado(await post("addressings", { description: nome("galpão") })).id;
    const prateleira = criado(await post("addressings", { description: nome("prateleira"), parent_id: galpao })).id;
    const caixa = criado(await post("addressings", { description: nome("caixa"), parent_id: prateleira })).id;
    const foto = async () => q("select id, parent_id from erp.addressings where id = any($1::uuid[]) order by id", [[galpao, prateleira, caixa]]);
    const antes = await foto();
    const casos: [string, string, string][] = [
      [caixa, caixa, "pai de si mesmo"],
      [caixa, caixa.toUpperCase(), "pai de si mesmo, id em maiúsculas no corpo"],
      [caixa.toUpperCase(), caixa, "pai de si mesmo, id em maiúsculas na URL"],
      [galpao, caixa, "ciclo: o neto como superior do avô"],
      [galpao, caixa.toUpperCase(), "ciclo, id em maiúsculas"]
    ];
    for (const [id, pai, oQue] of casos) {
      const r = await put("addressings", id, { parent_id: pai });
      expect(r.statusCode, `${oQue}: ${r.body}`).toBe(422);
      expect(detalhes(r).map((d) => [d.path, d.message]), oQue).toContainEqual(["parent_id", MSG]);
    }
    expect(await foto(), "nada mudou").toEqual(antes);
    expect(await q("select count(*)::int n from erp.addressings where id = parent_id"), "ninguém é pai de si mesmo").toEqual([{ n: 0 }]);
    // o superior ATUAL reenviado em maiúsculas não é "outro superior": salva normal
    const mesmo = await put("addressings", caixa, { parent_id: prateleira.toUpperCase(), description: nome("caixa renomeada") });
    expect(mesmo.statusCode, mesmo.body).toBe(200);
    expect((await um<{ parent_id: string }>("select parent_id from erp.addressings where id=$1", [caixa]))!.parent_id).toBe(prateleira);
  });
});

// ───────────────────────────── T-4 o caminho de duplicidade (409) ─────────────────────────────
describe("T-4 duplicidade no banco → 409 CONFLICT legível, nada gravado", () => {
  it("o teste genérico perdeu o 409 quando o código passou a ser gerado: Tipo de Título com nome repetido (único por organização) → 409", async () => {
    const x = nome("tipo de título");
    const a = await post("title_types", { name: x });
    expect(a.statusCode, a.body).toBe(201);
    const antes = Number((await um<{ n: string }>("select count(*)::text n from erp.title_types where organization_id=$1", [h.demo.orgId]))!.n);
    const dup = await post("title_types", { name: x });
    expect(dup.statusCode, dup.body).toBe(409);
    expect(j(dup).error).toMatchObject({ code: "CONFLICT", message: "Registro duplicado" });
    expect(Number((await um<{ n: string }>("select count(*)::text n from erp.title_types where organization_id=$1", [h.demo.orgId]))!.n), "nada gravado").toBe(antes);
  });
});
