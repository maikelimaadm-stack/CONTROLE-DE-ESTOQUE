import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { mesmoNcm, TETO_DE_CANDIDATOS_DA_DESCRICAO, type VinculoDoItemDaNota } from "@agro/domain";
import { c, iniciar, encerrar, unico } from "./top-config-08-ajuda.js";
import { conferencia, importada, notaSintetica, type ItemSintetico } from "./f7-ajuda.js";
import {
  prepararXml01, notaImportada, conferenciaLida, vinculoDo, eanNovo, outraOrganizacao, x, type Conferencia,
  criarProdutos, criados, corpoLote, recusa, caminhos, fotografia, produtosNoBanco, unidadeDaOrganizacao, NCM_VIGENTE,
} from "./xml-01-ajuda.js";
import { MSG_ITEM_COM_PRODUTO } from "../../src/routes/compras-importacao.js";
import { sqlMesmoNcm } from "../../src/lib/importacao-nfe-conferencia.js";

/**
 * XML-02 (decisão 314) — O ITEM DA NOTA ENCONTRA O PRODUTO QUE JÁ EXISTE: os caminhos 4 (a REFERÊNCIA do produto) e 5
 * (a DESCRIÇÃO semelhante) da conferência (`vinculosDosItens`), pela API real (GET /api/compras/importacoes/:id, a
 * instância de produção `c.ligada`, sob a RLS do papel da aplicação). A testemunha é o banco (superusuário, sem RLS).
 *
 * A REGRA: identidade primeiro, semelhança depois — lembrado → código no fornecedor → código de barras → referência →
 * descrição; o caminho mais forte que achou decide o item e os de baixo NÃO rodam para ele. A descrição no máximo SUGERE
 * (1 acima do limiar) ou fica AMBÍGUA (>1, ordenada, nada escolhido, no máximo 5); o NCM nunca casa sozinho.
 *
 *   XML2-I1  a nota da FASE 0 (os 12 itens do A0, com os distratores e os concorrentes do seed): G1..G4 código de barras,
 *            M1/M2/M4 descrição (o certo), M3 ambíguo com os 2 "sal mineral", R1/R2 referência, N1/N2 nenhum; nada gravado;
 *   XML2-I2  PRECEDÊNCIA, os 3 pares: lembrado × descrição, GTIN × descrição, referência × descrição (cada par com a
 *            premissa: o mesmo texto, sem a identidade, é sugerido pela descrição a OUTRO produto);
 *   XML2-I3  a referência: 2 produtos ⇒ ambíguo por código (não pela ordem de criação nem pelo id); btrim nos dois lados;
 *            excluído, inativo e de outra organização não contam (e a consulta recorta sozinha, sem a RLS);
 *   XML2-I4  o falso positivo: "ADUBO NPK 04-14-08" ⇒ ambíguo com 3 (o do seed incluído), nada escolhido; o NCM só
 *            reordena o empate;
 *   XML2-I5  o NCM nunca casa sozinho: NCM igual sem lexema comum ⇒ nenhum; NCM igual abaixo do limiar ⇒ nenhum;
 *   XML2-I6  excluído, inativo e de outra organização com a descrição IDÊNTICA nunca são candidatos (e a consulta recorta
 *            sozinha); com o produto vivo ao lado, ele é o sugerido;
 *   XML2-I7  CONSULTAS CONTADAS: nota toda resolvida pelos caminhos 1 a 3 ⇒ ZERO consulta do 4 e do 5; 50 itens pendentes
 *            ⇒ o MESMO número de consultas de 1 item;
 *   XML2-I8  o TETO: 7 acima do limiar ⇒ ambíguo com 5, na ordem do domínio; o corte é no SQL (o NCM decide quem entra);
 *   XML2-I9  a fronteira do limiar no SQL real: exatamente ½ (2/4 e 3/6) não casa; 3/5 casa;
 *   XML2-I10 o "mesmo NCM" do SQL (o desempate do corte) é o `mesmoNcm` do domínio, par a par;
 *   XML2-I11 o LOTE do XML-01 olha só a IDENTIDADE (caminhos 1 a 4): o item que a descrição sugere leva o pré-preenchimento
 *            do `nenhum` (com a unidade) e o lote o CRIA; o sugerido pela referência continua recusado (422, nada criado);
 *            e o lote não faz a consulta da descrição.
 */

beforeAll(async () => { await iniciar(); await prepararXml01(); }, 240_000);
afterAll(encerrar);

// ─────────────── o cadastro (superusuário) ───────────────

interface Produto { id: string; codigo: string; descricao: string }
let seqProduto = 0;
/**
 * Um produto NOVO por SQL (superusuário), no molde de um do seed, com a descrição EXATA; o resto como pedido. Premissa:
 * nasceu como pedido (descrição, ativo, excluído, organização).
 */
async function produtoNovo(descricao: string, o: {
  codigo?: string; id?: string; barcode?: string; reference?: string; ncm?: string; ativo?: boolean; excluido?: boolean; orgId?: string;
} = {}): Promise<Produto> {
  const m = (await c.admin.query<Record<string, string>>("select measurement_id, group_id, category_id, kind_id, financial_category_id from erp.products where id=$1", [c.I.product2])).rows[0]!;
  const orgId = o.orgId ?? c.h.demo.orgId;
  const r = await c.admin.query<{ id: string; code: string; description: string; is_active: boolean; excluido: boolean; organization_id: string }>(
    `insert into erp.products (id, organization_id, code, description, measurement_id, group_id, category_id, kind_id, financial_category_id,
                               control_stock, controle_lote, has_lot, is_active, reference, barcode, ncm_code, deleted_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, true, 'nenhum', false, $10, $11, $12, $13, case when $14 then now() end)
     returning id::text as id, code, description, is_active, deleted_at is not null as excluido, organization_id::text`,
    [o.id ?? null, orgId, o.codigo ?? `X2${String(++seqProduto).padStart(3, "0")}${unico()}`, descricao, m.measurement_id, m.group_id, m.category_id, m.kind_id,
      m.financial_category_id, o.ativo ?? true, o.reference ?? null, o.barcode ?? null, o.ncm ?? null, o.excluido ?? false]);
  const p = r.rows[0]!;
  expect([p.description, p.is_active, p.excluido, p.organization_id], "premissa: o produto nasceu como pedido")
    .toEqual([descricao, o.ativo ?? true, o.excluido ?? false, orgId]);
  return { id: p.id, codigo: p.code, descricao: p.description };
}
/** Um produto do SEED pela descrição exata (premissa: existe um só, vivo e ativo). */
async function doSeed(descricao: string): Promise<Produto> {
  const r = await c.admin.query<Produto>(
    "select id::text as id, code as codigo, description as descricao from erp.products where organization_id=$1 and description=$2 and deleted_at is null and is_active", [c.h.demo.orgId, descricao]);
  expect(r.rows, `premissa: o seed tem UM "${descricao}"`).toHaveLength(1);
  return r.rows[0]!;
}
/** O vínculo LEMBRADO (fornecedor + código + unidade → produto), gravado como o "Gerar compra" grava. */
async function lembrar(fornecedorId: string, codigo: string, unidade: string, produtoId: string): Promise<void> {
  await c.admin.query(
    `insert into erp.produto_fornecedor_vinculos (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor, produto_id, tipo_fator, fator, criado_por)
     values ($1, $2, $3, $4, $5, 'multiply', 1, $6)`, [c.h.demo.orgId, fornecedorId, codigo, unidade, produtoId, x.adminId]);
}
/** O código do produto NO FORNECEDOR (`produto_fornecedores`, o cadastro do produto). */
async function codigoNoFornecedor(produtoId: string, fornecedorId: string, codigo: string): Promise<void> {
  await c.admin.query("insert into erp.produto_fornecedores (organization_id, product_id, person_id, codigo_no_fornecedor) values ($1, $2, $3, $4)",
    [c.h.demo.orgId, produtoId, fornecedorId, codigo]);
}
/** Quantos vínculos lembrados a organização tem (o GET da conferência nunca grava um). */
const vinculosLembrados = async (): Promise<number> =>
  Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.produto_fornecedor_vinculos where organization_id=$1", [c.h.demo.orgId])).rows[0]!.n);

// ─────────────── a nota ───────────────

/** Um item da nota: 2 UN a 10,00, sem GTIN e sem NCM, salvo o pedido. */
const item = (codigo: string, descricao: string, o: Partial<ItemSintetico> = {}): ItemSintetico =>
  ({ codigo, descricao, unidade: "UN", quantidade: "2.0000", valorUnitario: "10.0000000000", valorProdutos: "20.00", ean: "SEM GTIN", ...o });

type Resumo = { situacao: string; origem?: string; produto?: string; candidatos?: string[] };
/** O vínculo reduzido ao que a regra decide: a situação, a origem do sugerido e o(s) produto(s), por id. */
function resumo(v: VinculoDoItemDaNota): Resumo {
  switch (v.situacao) {
    case "lembrado": return { situacao: v.situacao, produto: v.produto.id };
    case "sugerido": return { situacao: v.situacao, origem: v.origem, produto: v.produto.id };
    case "ambiguo": return { situacao: v.situacao, candidatos: v.candidatos.map((p) => p.id) };
    case "nenhum": return { situacao: v.situacao };
  }
}
const resumos = (conf: Conferencia): Resumo[] => conf.itens.map((i) => resumo(i.vinculo));
const sugerido = (origem: string, p: Produto): Resumo => ({ situacao: "sugerido", origem, produto: p.id });
const ambiguo = (...ps: Produto[]): Resumo => ({ situacao: "ambiguo", candidatos: ps.map((p) => p.id) });
const NENHUM: Resumo = { situacao: "nenhum" };

// ─────────────── as consultas (o espião do RG-8, com o que cada uma devolveu) ───────────────

interface Consulta { sql: string; params: unknown[]; linhas: Record<string, unknown>[] }
/** As consultas que a requisição mandou ao banco (texto, parâmetros e as linhas devolvidas), em ordem. */
async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; consultas: Consulta[] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const consultas: Consulta[] = [];
    for (const [k, chamada] of espiao.mock.calls.entries()) {
      const a = chamada[0] as unknown;
      const sql = typeof a === "string" ? a : (a as { text?: unknown } | null)?.text;
      if (typeof sql !== "string") continue;
      const p = Array.isArray(chamada[1]) ? (chamada[1] as unknown[]) : (a as { values?: unknown } | null)?.values;
      let linhas: Record<string, unknown>[] = [];
      try { linhas = ((await (espiao.mock.results[k]?.value as Promise<{ rows?: Record<string, unknown>[] }> | undefined))?.rows) ?? []; } catch { linhas = []; }
      consultas.push({ sql, params: Array.isArray(p) ? p : [], linhas });
    }
    return { r, consultas };
  } finally { espiao.mockRestore(); }
}
/** A consulta do 4º caminho (a referência) e a do 5º (a descrição), pelo texto. */
const CAMINHO_4 = /\bbtrim\(p\.reference\)/;
const CAMINHO_5 = /\bto_tsvector\(/;
const doCaminho = (consultas: Consulta[], forma: RegExp): Consulta[] => consultas.filter((q) => forma.test(q.sql));
/** A conferência lida COM as consultas contadas (200 exigido). */
async function conferenciaContada(id: string): Promise<{ conf: Conferencia; consultas: Consulta[] }> {
  const { r, consultas } = await comConsultas(() => conferencia(id));
  expect(r.statusCode, r.body).toBe(200);
  return { conf: JSON.parse(r.body) as Conferencia, consultas };
}

// ═════════════════════════════════════ XML2-I1 a nota da fase 0 ═════════════════════════════════════

/** A nota da fase 0 (o A0, `apps/web/e2e/xml-02-medicao.spec.ts`): xProd, uCom, NCM e o produto de cada item. */
const FASE_0: readonly { rotulo: string; nota: string; unidade: string; ncm: string; produto: string | null; papel: "g" | "m" | "r" | "n" }[] = [
  { rotulo: "G1", papel: "g", nota: "ESPALHANTE ADESIVO 1L", unidade: "L", ncm: "34029090", produto: "ESPALHANTE ADESIVO AGRICOLA" },
  { rotulo: "G2", papel: "g", nota: "INOCULANTE SOJA TURFOSO 200G", unidade: "UN", ncm: "38249929", produto: "INOCULANTE TURFOSO PARA SOJA" },
  { rotulo: "G3", papel: "g", nota: "ARAME FARPADO 500M", unidade: "UN", ncm: "73130000", produto: "ARAME FARPADO ROLO 500 M" },
  { rotulo: "G4", papel: "g", nota: "MANGUEIRA PVC 1/2 POL 50M", unidade: "UN", ncm: "39173900", produto: "MANGUEIRA DE PVC 1/2" },
  { rotulo: "M1", papel: "m", nota: "RACAO BOVINA ENGORDA 25KG", unidade: "SC", ncm: "23099090", produto: "RAÇÃO BOVINA ENGORDA" },
  { rotulo: "M2", papel: "m", nota: "FERTILIZANTE FOLIAR CALCIO BORO 1L", unidade: "L", ncm: "31059090", produto: "FERTILIZANTE FOLIAR CÁLCIO-BORO" },
  { rotulo: "M3", papel: "m", nota: "PROTEINADO SAL  MINERAL", unidade: "SC", ncm: "23099010", produto: "SAL MINERAL PROTEINADO" },
  { rotulo: "M4", papel: "m", nota: "GLIFOSATO HERBICIDA 480 G/L", unidade: "L", ncm: "38089329", produto: "HERBICIDA GLIFOSATO 480" },
  { rotulo: "R1", papel: "r", nota: "ITEM TECNICO ALFA", unidade: "UN", ncm: "38249929", produto: "PRODUTO REFERENCIADO UM" },
  { rotulo: "R2", papel: "r", nota: "ITEM TECNICO BETA", unidade: "KG", ncm: "31051000", produto: "PRODUTO REFERENCIADO DOIS" },
  { rotulo: "N1", papel: "n", nota: "PARAFUSO SEXTAVADO 3/8", unidade: "UN", ncm: "73181500", produto: null },
  { rotulo: "N2", papel: "n", nota: "LUVA NITRILICA TAM G", unidade: "UN", ncm: "40151900", produto: null },
];
const DISTRATORES_DA_FASE_0: readonly { produto: string; ncm: string }[] = [
  { produto: "RAÇÃO EQUINA MANUTENÇÃO", ncm: "23099090" }, { produto: "SAL COMUM GROSSO", ncm: "25010090" },
  { produto: "HERBICIDA 2,4-D 806", ncm: "38089329" }, { produto: "FERTILIZANTE NPK 20-05-20", ncm: "31052000" },
  { produto: "RAÇÃO BOVINA LACTAÇÃO", ncm: "23099090" },
];

describe("XML2-I1 a nota da fase 0, pela API", () => {
  it("G1..G4 código de barras (o mesmo de antes); M1, M2, M4 descrição (o certo); M3 ambíguo com os 2 sal mineral; R1/R2 referência; N1/N2 nenhum", async () => {
    const rodada = unico().toUpperCase();
    const eans = FASE_0.map((f) => (f.papel === "g" ? eanNovo() : null));
    const codigos = FASE_0.map((f) => (f.papel === "r" ? `FX-778${f.rotulo.slice(1)}-${rodada}` : `X02${f.rotulo}-${rodada}`));
    const doItem = new Map<string, Produto>();
    for (const [k, f] of FASE_0.entries()) {
      if (!f.produto) continue;
      doItem.set(f.rotulo, await produtoNovo(f.produto, { ncm: f.ncm, ...(f.papel === "g" ? { barcode: eans[k]! } : {}), ...(f.papel === "r" ? { reference: codigos[k]! } : {}) }));
    }
    const distratores: Produto[] = [];
    for (const d of DISTRATORES_DA_FASE_0) distratores.push(await produtoNovo(d.produto, { ncm: d.ncm }));
    const salDoSeed = await doSeed("Sal Mineral 80 Proteinado 25kg");
    await doSeed("Adubo NPK 04-14-08 50kg"); await doSeed("Ração Confinamento 18% 40kg");

    const n = await notaImportada(FASE_0.map((f, k) => item(codigos[k]!, f.nota, { unidade: f.unidade, ncm: f.ncm, ean: eans[k] ?? "SEM GTIN",
      quantidade: `${k + 1}.0000`, valorProdutos: `${(k + 1) * 10}.00` })));
    const antes = await vinculosLembrados();
    const conf = await conferenciaLida(n.id);
    expect([conf.parceiro.situacao, conf.fornecedorEscolhido], "premissa: o fornecedor (novo) foi encontrado pelo emitente").toEqual(["encontrado", n.fornecedor]);
    expect(conf.nota.itens.map((i) => i.descricao), "premissa: as 12 linhas da nota como declaradas").toEqual(FASE_0.map((f) => f.nota));
    const p = (r: string) => doItem.get(r)!;
    expect(resumos(conf)).toEqual([
      sugerido("codigo_barras", p("G1")), sugerido("codigo_barras", p("G2")), sugerido("codigo_barras", p("G3")), sugerido("codigo_barras", p("G4")),
      sugerido("descricao", p("M1")), sugerido("descricao", p("M2")), ambiguo(p("M3"), salDoSeed), sugerido("descricao", p("M4")),
      sugerido("reference", p("R1")), sugerido("reference", p("R2")), NENHUM, NENHUM,
    ]);
    // O fator dos caminhos sem unidade é 1 (multiplica): a quantidade interna é a da nota.
    for (const k of [5, 6, 8, 9, 10]) {
      const i = conf.itens.find((x0) => x0.nItem === k)!;
      expect([i.vinculo.situacao === "sugerido" ? [i.vinculo.fator, i.vinculo.tipoFator] : null, i.quantidadeInterna], `item ${k}: fator 1, quantidade da nota`)
        .toEqual([["1", "multiply"], `${k}.0000`]);
    }
    // O ambíguo não escolhe: nenhum produto no vínculo, os candidatos na ordem (o certo, 3/3, antes do seed, 3/5).
    expect(Object.hasOwn(vinculoDo(conf, 7), "produto"), "M3: nada escolhido").toBe(false);
    expect(distratores.some((d) => resumos(conf).some((r) => r.produto === d.id || r.candidatos?.includes(d.id))), "nenhum distrator em vínculo nenhum").toBe(false);
    expect(await vinculosLembrados(), "a conferência não grava vínculo lembrado").toBe(antes);
    const contagem = { D1: conf.itens.filter((i) => ["lembrado", "sugerido"].includes(i.vinculo.situacao)).length,
      D2: conf.itens.filter((i) => i.vinculo.situacao === "ambiguo").length, D3: conf.itens.filter((i) => i.vinculo.situacao === "nenhum").length };
    expect(contagem).toEqual({ D1: 9, D2: 1, D3: 2 });
    const tabela = conf.itens.map((i, k) => {
      const v = i.vinculo;
      return { item: i.nItem, caso: FASE_0[k]!.rotulo, situacao: v.situacao, origem: v.situacao === "sugerido" ? v.origem : null,
        produto: v.situacao === "sugerido" || v.situacao === "lembrado" ? v.produto.descricao : null,
        candidatos: v.situacao === "ambiguo" ? v.candidatos.map((x0) => x0.descricao) : null };
    });
    console.log(`XML-02 A2 FASE0 ${JSON.stringify({ contagem, tabela })}`);
  });
});

// ═════════════════════════════════════ XML2-I2 precedência ═════════════════════════════════════

describe("XML2-I2 PRECEDÊNCIA: a identidade vence a descrição (os 3 pares do prompt e o código no fornecedor)", () => {
  it("lembrado × descrição ⇒ o lembrado; código no fornecedor × descrição ⇒ o código; GTIN × descrição ⇒ o GTIN; referência × descrição ⇒ a referência — e, sem a identidade, o mesmo texto é sugerido a OUTRO produto", async () => {
    const u = unico();
    const dLembrado = `LEMBRADO-VS-DESCRICAO ${unico()} ${unico()}`;
    const dGtin = `GTIN-VS-DESCRICAO ${unico()} ${unico()}`;
    const dReferencia = `REFERENCIA-VS-DESCRICAO ${unico()} ${unico()}`;
    const dCodigo = `CODIGO-VS-DESCRICAO ${unico()} ${unico()}`;
    const lembrado = await produtoNovo(`PRODUTO DO VINCULO ${unico()}`);
    const peloTextoDoLembrado = await produtoNovo(dLembrado);
    const ean = eanNovo();
    const peloGtin = await produtoNovo(`PRODUTO DO CODIGO DE BARRAS ${unico()}`, { barcode: ean });
    const peloTextoDoGtin = await produtoNovo(dGtin);
    const peloCodigo = await produtoNovo(`PRODUTO DA REFERENCIA ${unico()}`, { reference: `P3-${u}` });
    const peloTextoDaReferencia = await produtoNovo(dReferencia);
    const peloCodigoNoFornecedor = await produtoNovo(`PRODUTO DO CODIGO NO FORNECEDOR ${unico()}`);
    const peloTextoDoCodigo = await produtoNovo(dCodigo);
    const n = await notaImportada([
      item(`P1-${u}`, dLembrado), item(`P1B-${u}`, dLembrado),
      item(`P2-${u}`, dGtin, { ean }), item(`P2B-${u}`, dGtin),
      item(`P3-${u}`, dReferencia), item(`P3B-${u}`, dReferencia),
      item(`P4-${u}`, dCodigo), item(`P4B-${u}`, dCodigo),
    ]);
    await lembrar(n.fornecedor!, `P1-${u}`, "UN", lembrado.id);
    await codigoNoFornecedor(peloCodigoNoFornecedor.id, n.fornecedor!, `P4-${u}`);
    const conf = await conferenciaLida(n.id);
    expect(conf.fornecedorEscolhido, "premissa: o fornecedor do vínculo lembrado é o escolhido").toBe(n.fornecedor);
    expect(resumos(conf)).toEqual([
      { situacao: "lembrado", produto: lembrado.id }, sugerido("descricao", peloTextoDoLembrado),
      sugerido("codigo_barras", peloGtin), sugerido("descricao", peloTextoDoGtin),
      sugerido("reference", peloCodigo), sugerido("descricao", peloTextoDaReferencia),
      sugerido("codigo_fornecedor", peloCodigoNoFornecedor), sugerido("descricao", peloTextoDoCodigo),
    ]);
  });
});

// ═════════════════════════════════════ XML2-I3 a referência ═════════════════════════════════════

describe("XML2-I3 o 4º caminho: products.reference = cProd", () => {
  it("2 produtos com a referência ⇒ ambíguo por CÓDIGO (não pela criação, não pelo id); btrim nos dois lados; excluído, inativo e de outra organização não contam", async () => {
    const u = unico().toUpperCase();
    // A ordem por código contra a ordem de criação e a do id: o de código MAIOR nasce primeiro e com o id MENOR.
    const segundo = await produtoNovo(`REFERENCIA DUPLA B ${unico()}`, { codigo: `R${u}-B`, id: "00000000-0000-4000-8000-000000000001", reference: `RD-${u}` });
    const primeiro = await produtoNovo(`REFERENCIA DUPLA A ${unico()}`, { codigo: `R${u}-A`, id: "ffffffff-ffff-4fff-bfff-ffffffffffff", reference: `RD-${u}` });
    const aparado = await produtoNovo(`REFERENCIA COM ESPACOS ${unico()}`, { reference: `   RT-${u}  ` });
    const vivo = await produtoNovo(`REFERENCIA FILTRADA ${unico()}`, { reference: `RF-${u}` });
    const outra = await outraOrganizacao();
    const fora = [
      await produtoNovo(`REFERENCIA FILTRADA EXCLUIDO ${unico()}`, { reference: `RF-${u}`, excluido: true }),
      await produtoNovo(`REFERENCIA FILTRADA INATIVO ${unico()}`, { reference: `RF-${u}`, ativo: false }),
      await produtoNovo(`REFERENCIA FILTRADA OUTRA ORG ${unico()}`, { reference: `RF-${u}`, orgId: outra.orgId }),
    ];
    const n = await notaImportada([item(`RD-${u}`, `ITEM REFERENCIA DUPLA ${unico()}`), item(` RT-${u} `, `ITEM REFERENCIA APARADA ${unico()}`),
      item(`RF-${u}`, `ITEM REFERENCIA FILTRADA ${unico()}`)]);
    const { conf, consultas } = await conferenciaContada(n.id);
    expect(resumos(conf)).toEqual([ambiguo(primeiro, segundo), sugerido("reference", aparado), sugerido("reference", vivo)]);
    expect(Object.hasOwn(vinculoDo(conf, 1), "produto"), "o ambíguo não escolhe").toBe(false);
    // A consulta recorta SOZINHA (sem a RLS): a mesma consulta, pelo superusuário, não traz o excluído, o inativo nem o de outra organização.
    const [q4] = doCaminho(consultas, CAMINHO_4);
    expect(doCaminho(consultas, CAMINHO_4), "UMA consulta da referência para a nota").toHaveLength(1);
    const semRls = (await c.admin.query<{ id: string }>(q4!.sql, q4!.params)).rows.map((r) => r.id);
    expect(semRls.sort(), "sem a RLS, só os vivos, ativos e da organização").toEqual([primeiro.id, segundo.id, aparado.id, vivo.id].sort());
    expect(fora.some((f) => semRls.includes(f.id))).toBe(false);
    const todos = (await c.admin.query<{ id: string }>("select id::text as id from erp.products where btrim(reference) = $1", [`RF-${u}`])).rows.map((r) => r.id);
    expect(todos.sort(), "premissa: os 4 com a referência existem no banco").toEqual([vivo.id, ...fora.map((f) => f.id)].sort());
  });
});

// ═════════════════════════════════════ XML2-I4 o falso positivo ═════════════════════════════════════

describe("XML2-I4 o falso positivo da semelhança", () => {
  it("\"ADUBO NPK 04-14-08\" com \"… ORGANICO\" e o do seed ⇒ ambíguo com 3, nada escolhido; o NCM só reordena o empate 5/6", async () => {
    const f1 = await produtoNovo("ADUBO NPK 04-14-08", { ncm: "31052000" });
    const f2 = await produtoNovo("ADUBO NPK 04-14-08 ORGANICO", { ncm: "31051000" });
    const s5 = await doSeed("Adubo NPK 04-14-08 50kg");
    expect(s5.codigo < f2.codigo, "premissa: sem o NCM, o código põe o do seed antes do orgânico").toBe(true);
    const n = await notaImportada([item(`FP1-${unico()}`, "ADUBO NPK 04-14-08", { ncm: "31059090" }), item(`FP2-${unico()}`, "ADUBO NPK 04-14-08", { ncm: "31051000" })]);
    const conf = await conferenciaLida(n.id);
    expect(resumos(conf)).toEqual([ambiguo(f1, s5, f2), ambiguo(f1, f2, s5)]);
    for (const k of [1, 2]) expect(Object.hasOwn(vinculoDo(conf, k), "produto"), `item ${k}: nada escolhido`).toBe(false);
  });
});

// ═════════════════════════════════════ XML2-I5 o NCM nunca casa sozinho ═════════════════════════════════════

describe("XML2-I5 o NCM nunca casa sozinho", () => {
  it("NCM igual sem lexema comum ⇒ nenhum; NCM igual com 1 lexema comum (abaixo do limiar) ⇒ nenhum; a descrição semelhante ⇒ sugerido", async () => {
    const calcario = await produtoNovo("CALCARIO DOLOMITICO FILLER", { ncm: "25010090" });
    const n = await notaImportada([
      item(`NC1-${unico()}`, "PNEU DIANTEIRO ARO 24", { ncm: "25010090" }),
      item(`NC2-${unico()}`, "CALCARIO EM PO ENSACADO", { ncm: "25010090" }),
      item(`NC3-${unico()}`, "CALCARIO DOLOMITICO FILLER 1T"),
    ]);
    const { conf, consultas } = await conferenciaContada(n.id);
    expect(conf.nota.itens.map((i) => i.ncm), "premissa: os dois primeiros com o NCM do produto").toEqual(["25010090", "25010090", null]);
    expect(resumos(conf)).toEqual([NENHUM, NENHUM, sugerido("descricao", calcario)]);
    // No SQL também: o par que só tem o NCM (ou 1 lexema abaixo do limiar) nem chega ao Node — só o item 3 volta.
    const [q5] = doCaminho(consultas, CAMINHO_5);
    expect(q5!.linhas.map((l) => [l.n_item, l.id]), "a consulta da descrição só devolve o item 3").toEqual([[3, calcario.id]]);
  });
});

// ═════════════════════════════════════ XML2-I6 excluído, inativo, outra organização ═════════════════════════════════════

describe("XML2-I6 a descrição: só produto vivo, ativo e da organização", () => {
  it("excluído, inativo e de outra organização com a descrição IDÊNTICA nunca são candidatos (a consulta recorta sozinha); com o vivo ao lado, ele é o sugerido", async () => {
    const descricao = "GESSO AGRICOLA GRANULADO";
    const outra = await outraOrganizacao();
    const fora = [await produtoNovo(descricao, { excluido: true }), await produtoNovo(descricao, { ativo: false }), await produtoNovo(descricao, { orgId: outra.orgId })];
    const n = await notaImportada([item(`GE-${unico()}`, descricao)]);
    const { conf, consultas } = await conferenciaContada(n.id);
    expect(resumos(conf)).toEqual([NENHUM]);
    // A consulta da descrição, pelo superusuário (sem a RLS): nenhum dos três volta.
    const q5 = doCaminho(consultas, CAMINHO_5);
    expect(q5, "UMA consulta da descrição").toHaveLength(1);
    const semRls = (await c.admin.query<{ id: string }>(q5[0]!.sql, q5[0]!.params)).rows.map((r) => r.id);
    expect(semRls, "sem a RLS, nenhum dos três é candidato").toEqual([]);
    // Premissa: o produto VIVO com a mesma descrição é o sugerido — e só ele (os três continuam fora).
    const vivo = await produtoNovo(descricao);
    const depois = await conferenciaContada(n.id);
    expect(resumos(depois.conf)).toEqual([sugerido("descricao", vivo)]);
    const semRlsDepois = (await c.admin.query<{ id: string }>(doCaminho(depois.consultas, CAMINHO_5)[0]!.sql, doCaminho(depois.consultas, CAMINHO_5)[0]!.params)).rows.map((r) => r.id);
    expect(semRlsDepois).toEqual([vivo.id]);
    expect(fora.map((f) => f.descricao), "premissa: os três têm a descrição idêntica").toEqual([descricao, descricao, descricao]);
  });
});

// ═════════════════════════════════════ XML2-I7 consultas contadas ═════════════════════════════════════

describe("XML2-I7 CONSULTAS CONTADAS", () => {
  it("nota toda resolvida pelos caminhos 1 a 3 ⇒ ZERO consulta da referência e da descrição; com 1 item pendente a mais, UMA de cada", async () => {
    const u = unico();
    const lembrado = await produtoNovo(`CONTADO LEMBRADO ${unico()}`);
    const doCadastro = await produtoNovo(`CONTADO CODIGO NO FORNECEDOR ${unico()}`);
    const ean = eanNovo();
    const peloGtin = await produtoNovo(`CONTADO GTIN ${unico()}`, { barcode: ean });
    const itens = [item(`C1-${u}`, `CONTADO ITEM UM ${unico()}`), item(`C2-${u}`, `CONTADO ITEM DOIS ${unico()}`), item(`C3-${u}`, `CONTADO ITEM TRES ${unico()}`, { ean })];
    const n = await notaImportada(itens);
    await lembrar(n.fornecedor!, `C1-${u}`, "UN", lembrado.id);
    await codigoNoFornecedor(doCadastro.id, n.fornecedor!, `C2-${u}`);
    await conferenciaLida(n.id); // aquece a rota (o cache da autenticação)
    const toda = await conferenciaContada(n.id);
    expect(resumos(toda.conf), "premissa: os 3 itens resolvidos pelos caminhos 1, 2 e 3")
      .toEqual([{ situacao: "lembrado", produto: lembrado.id }, sugerido("codigo_fornecedor", doCadastro), sugerido("codigo_barras", peloGtin)]);
    expect([doCaminho(toda.consultas, CAMINHO_4).length, doCaminho(toda.consultas, CAMINHO_5).length], "ZERO consulta do 4º e do 5º caminho").toEqual([0, 0]);
    // A premissa da identificação: a MESMA nota (o mesmo fornecedor) com um item pendente a mais ⇒ UMA de cada.
    const mais = await importada(notaSintetica({ emitenteCnpj: n.emitente, itens: [...itens, item(`C4-${u}`, `CONTADO PENDENTE ${unico()}`)] }).xml, { empresaId: c.I.empresa });
    await conferenciaLida(mais.id);
    const comPendente = await conferenciaContada(mais.id);
    expect(resumos(comPendente.conf).map((r) => r.situacao)).toEqual(["lembrado", "sugerido", "sugerido", "nenhum"]);
    expect([doCaminho(comPendente.consultas, CAMINHO_4).length, doCaminho(comPendente.consultas, CAMINHO_5).length]).toEqual([1, 1]);
    expect(comPendente.consultas.length - toda.consultas.length, "o pendente custa as 2 consultas novas e a das unidades").toBe(3);
  });

  it("50 itens pendentes (5 pela referência, 5 pela descrição, 40 nenhum) ⇒ o MESMO número de consultas que 1 item", async () => {
    const u = unico();
    const itens: ItemSintetico[] = [];
    const esperado: Resumo[] = [];
    for (let k = 1; k <= 50; k++) {
      const codigo = `L50-${k}-${u}`;
      if (k <= 5) {
        esperado.push(sugerido("reference", await produtoNovo(`LOTE50 REFERENCIA ${unico()}`, { reference: codigo })));
        itens.push(item(codigo, `LOTE50 ITEM ${unico()} ${unico()}`));
      } else if (k <= 10) {
        const [a, b, d] = [unico(), unico(), unico()];
        esperado.push(sugerido("descricao", await produtoNovo(`${a} ${b} ${d}`)));
        itens.push(item(codigo, `${a} ${b} ${d} LOTE50`));
      } else {
        esperado.push(NENHUM);
        itens.push(item(codigo, `LOTE50 SEM PRODUTO ${unico()} ${unico()}`));
      }
    }
    const varios = await notaImportada(itens);
    const umSo = await notaImportada([item(`L01-${u}`, `LOTE01 SEM PRODUTO ${unico()} ${unico()}`)]);
    await conferenciaLida(varios.id); await conferenciaLida(umSo.id); // aquece
    const v = await conferenciaContada(varios.id);
    const s = await conferenciaContada(umSo.id);
    expect(resumos(v.conf), "premissa: os 50 itens passaram pelos caminhos 4 e 5").toEqual(esperado);
    expect(resumos(s.conf)).toEqual([NENHUM]);
    expect([doCaminho(v.consultas, CAMINHO_4).length, doCaminho(v.consultas, CAMINHO_5).length], "50 itens: UMA da referência e UMA da descrição").toEqual([1, 1]);
    expect([doCaminho(s.consultas, CAMINHO_4).length, doCaminho(s.consultas, CAMINHO_5).length], "1 item: as mesmas").toEqual([1, 1]);
    expect(v.consultas.length, "o MESMO número de consultas, 50 itens e 1").toBe(s.consultas.length);
  });
});

// ═════════════════════════════════════ XML2-I8 o teto ═════════════════════════════════════

describe("XML2-I8 o TETO de 5 candidatos, cortado no SQL", () => {
  it("7 produtos acima do limiar ⇒ ambíguo com 5, na ordem (pontuação, mesmo NCM, código); o SQL devolve só os 5 e conta os 7", async () => {
    const base = unico().toUpperCase();
    const ncm = "12019000";
    expect((await c.admin.query("select 1 from erp.ncm where code=$1", [ncm])).rowCount, "premissa: o NCM existe").toBe(1);
    // Criados FORA da ordem esperada; o empate 4/6 (H4, H5, H6) decide-se pelo NCM (só H6 tem o do item) e depois pelo código.
    const h7 = await produtoNovo("SEMENTE MILHO HIBRIDO", { codigo: `H${base}-7` });                              // 3/5
    const h5 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA PENEIRA", { codigo: `H${base}-5` });             // 4/6
    const h3 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA", { codigo: `H${base}-3` });                     // 4/5
    const h6 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA GRAUDA", { codigo: `H${base}-6`, ncm });        // 4/6, mesmo NCM
    const h1 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA PREMIUM", { codigo: `H${base}-1` });             // 5/5
    const h4 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA TRATADA", { codigo: `H${base}-4` });             // 4/6
    const h2 = await produtoNovo("SEMENTE MILHO HIBRIDO SAFRINHA PREMIUM 20KG", { codigo: `H${base}-2` });       // 5/6
    await produtoNovo("SEMENTE SOJA", { codigo: `H${base}-8`, ncm });                                              // 1/6: abaixo, com o NCM
    const n = await notaImportada([item(`TETO-${unico()}`, "SEMENTE MILHO HIBRIDO SAFRINHA PREMIUM", { ncm })]);
    const { conf, consultas } = await conferenciaContada(n.id);
    expect(resumos(conf)).toEqual([ambiguo(h1, h2, h3, h6, h4)]);
    expect(TETO_DE_CANDIDATOS_DA_DESCRICAO, "premissa: o teto do domínio").toBe(5);
    const [q5] = doCaminho(consultas, CAMINHO_5);
    expect(q5!.linhas.map((l) => [l.id, l.posicao, l.acima_do_limiar, l.comuns, l.total]), "o SQL devolve só os 5, com a contagem dos 7")
      .toEqual([[h1.id, 1, 7, 5, 5], [h2.id, 2, 7, 5, 6], [h3.id, 3, 7, 4, 5], [h6.id, 4, 7, 4, 6], [h4.id, 5, 7, 4, 6]]);
    expect([h5.id, h7.id].some((id) => q5!.linhas.some((l) => l.id === id)), "o 6º e o 7º ficam no banco").toBe(false);
  });
});

// ═════════════════════════════════════ XML2-I9 a fronteira do limiar ═════════════════════════════════════

describe("XML2-I9 a fronteira do limiar, no SQL real", () => {
  it("exatamente ½ (2/4 e 3/6) não casa — nem chega ao Node —; 3/5 casa", async () => {
    const enxada = await produtoNovo("ENXADA CABO LONGO");
    const n = await notaImportada([
      item(`LI1-${unico()}`, "ENXADA CABO CURTO"),                         // {cab, enxad} de {cab, curt, enxad, long}: 2/4
      item(`LI2-${unico()}`, "ENXADA CABO LONGO ACO CARBONO TEMPERADO"),   // 3/6
      item(`LI3-${unico()}`, "ENXADA CABO LONGO ACO CARBONO"),             // 3/5
    ]);
    const { conf, consultas } = await conferenciaContada(n.id);
    expect(resumos(conf)).toEqual([NENHUM, NENHUM, sugerido("descricao", enxada)]);
    const [q5] = doCaminho(consultas, CAMINHO_5);
    expect(q5!.linhas.map((l) => [l.n_item, l.id, l.comuns, l.total]), "o SQL só devolve o 3/5: a metade exata não passa do banco").toEqual([[3, enxada.id, 3, 5]]);
  });
});

// ═════════════════════════════════════ XML2-I10 o mesmo NCM no SQL = o do domínio ═════════════════════════════════════

describe("XML2-I10 o \"mesmo NCM\" do SQL é o mesmoNcm do domínio", () => {
  it("par a par: só dígitos, os dois preenchidos e iguais", async () => {
    const pares: [string | null, string | null][] = [
      ["31052000", "31052000"], ["3105.20.00", "31052000"], [" 3105 2000 ", "31052000"], ["NCM 31052000", "31052000"],
      ["31052000", "31052001"], ["3105200", "31052000"], [null, "31052000"], ["31052000", null], [null, null], ["", ""], ["", "31052000"],
      ["abc", "xyz"], ["abc", ""], ["٣١٠٥٢٠٠٠", "31052000"], ["٣١", "٣١"],
    ];
    const r = await c.admin.query<{ igual: boolean }>(
      `select ${sqlMesmoNcm("t.a", "t.b")} as igual from unnest($1::text[], $2::text[]) with ordinality as t(a, b, o) order by t.o`,
      [pares.map((p) => p[0]), pares.map((p) => p[1])]);
    const doDominio = pares.map(([a, b]) => mesmoNcm(a, b));
    expect(r.rows.map((x0) => x0.igual)).toEqual(doDominio);
    expect([doDominio.filter(Boolean).length, doDominio.filter((v) => !v).length], "premissa: os dois lados aparecem").toEqual([4, 11]);
  });
});

// ═════════════════════════════════════ XML2-I11 o lote olha só a identidade ═════════════════════════════════════

describe("XML2-I11 o lote do XML-01 olha só a IDENTIDADE (caminhos 1 a 4)", () => {
  it("o sugerido pela descrição leva o pré-preenchimento com a unidade e o lote o CRIA (sem a consulta da descrição); o sugerido pela referência é recusado e nada é criado", async () => {
    const u = unico();
    const dDescricao = `ROCADEIRA LATERAL GASOLINA ${unico()} ${unico()}`;
    const parecido = await produtoNovo(dDescricao.replace("GASOLINA", "GASOLINA 52CC"));
    const peloCodigo = await produtoNovo(`PRODUTO DA REFERENCIA DO LOTE ${unico()}`, { reference: `LT-${u}` });
    const un = await unidadeDaOrganizacao("UN");
    const n = await notaImportada([
      item(`LD-${u}`, dDescricao, { ncm: NCM_VIGENTE }),
      item(`LT-${u}`, `ITEM PELA REFERENCIA ${unico()}`, { ncm: NCM_VIGENTE }),
    ]);
    const conf = await conferenciaLida(n.id);
    expect(resumos(conf), "premissa: 1 pela descrição, 2 pela referência").toEqual([sugerido("descricao", parecido), sugerido("reference", peloCodigo)]);
    const v1 = vinculoDo(conf, 1) as Extract<VinculoDoItemDaNota, { origem: "descricao" }>;
    expect(v1.preenchimento, "o sugerido pela descrição leva o pré-preenchimento do nenhum, com a unidade do uCom")
      .toEqual({ description: dDescricao, ncm_code: NCM_VIGENTE, barcode: null, measurement_id: un });
    expect(Object.hasOwn(vinculoDo(conf, 2), "preenchimento"), "o sugerido pela identidade NÃO leva pré-preenchimento").toBe(false);

    // O sugerido pela REFERÊNCIA (identidade): recusado no item, nada criado.
    const antes = await fotografia();
    const r2 = await criarProdutos(n.id, corpoLote([{ n_item: 2 }], { fornecedor_id: n.fornecedor }));
    const e2 = recusa(r2, 422, "VALIDATION_ERROR");
    expect([caminhos(e2), (e2.details as { message?: string }[]).map((d) => d.message)]).toEqual([["itens[0].n_item"], [MSG_ITEM_COM_PRODUTO]]);
    expect(await fotografia(), "nada criado").toEqual(antes);

    // O sugerido pela DESCRIÇÃO: o lote o cria, com o que a nota disse — e sem perguntar a descrição.
    const { r: r1, consultas } = await comConsultas(() => criarProdutos(n.id, corpoLote([{ n_item: 1 }], { fornecedor_id: n.fornecedor })));
    const feitos = await criados(r1);
    expect(doCaminho(consultas, CAMINHO_5), "o lote não faz a consulta da descrição").toHaveLength(0);
    expect(doCaminho(consultas, CAMINHO_4), "o lote faz a da referência (identidade)").toHaveLength(1);
    expect([feitos.produtos.length, feitos.itens.map((i) => [i.nItem, i.produto.id])], "um produto, para o item 1")
      .toEqual([1, [[1, feitos.produtos[0]?.id]]]);
    const [novo] = await produtosNoBanco(feitos.produtos.map((p) => p.id));
    expect([novo!.description, novo!.ncm_code, novo!.measurement_id], "nasce com o que a nota disse").toEqual([dDescricao, NCM_VIGENTE, un]);
    expect(novo!.id, "um produto NOVO, não o parecido").not.toBe(parecido.id);
  });
});
