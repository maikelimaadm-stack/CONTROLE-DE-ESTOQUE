import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  configuracaoNeutraTopV5, exigeAprovacao, familiaOperacionalDeDocumentoVenda, lerConfiguracaoTop, regrasGeraisDaVersaoTop,
  type ConfiguracaoTipoOperacaoV5,
} from "@agro/domain";
import { freshDb, TEST_URL } from "./setup.js";
import { createPool, withTx, type Db, type TenantContext } from "../src/pool.js";
import type { DemoOrg } from "../src/seed.js";

/**
 * OPERACOES-01 F4 (decisão 281) — O FORMATO 5 NO BANCO, SEM MIGRATION (plano F4 §1.1 e §4; B5-1 e B5-2).
 *
 * O formato 5 nasce sem DDL, e a prova é contra o banco com TODAS as migrations aplicadas (a 0041 inclusive, intocada):
 *   · B5-1 uma versão com a configuração no 5 (`configuracaoNeutraTopV5()` do domínio) entra pelos CHECKs da 0022 — o
 *          de forma só exige a PRESENÇA das cinco seções e de `versaoSchema`; o de schema, que a coluna e o payload
 *          concordem (`>= 1`, sem teto). A premissa: a MESMA linha com a coluna 4 e o JSON 5 é recusada (23514), e um 5
 *          sem a seção `aprovacao` também — o 5 continua preso às mesmas garantias;
 *   · B5-2 `erp.top_exige_aprovacao` (0041) sobre a LINHA GRAVADA (`select … from erp.tipos_operacao_versoes v where
 *          v.id = $1`): o 5 é tratado como ≥ 4 — Sempre, "A partir de 1000.00" (999.99 não, 1000.00 sim, valor nulo
 *          sim) e "Sem aprovação". Ao lado de cada linha, a premissa: o MESMO JSON com `versaoSchema` 3 → falso (o
 *          corte < 4 continua) e com 4 → o mesmo resultado do 5; e o domínio (`exigeAprovacao`) dá a mesma resposta
 *          sobre a mesma linha.
 *
 * Duas conexões, no molde da `top-config-08-0041.test.ts`: `db` (superusuário: monta o cenário) e `app` (papel da
 * aplicação, SEM bypass de RLS, com as GUCs da transação — o caminho que a API percorre). A versão é GRAVADA e LIDA
 * pelo papel da aplicação.
 */
let db: Db; let app: Db; let demo: DemoOrg;
let seq = 0;

const FAMILIA_VENDA = familiaOperacionalDeDocumentoVenda("sale")!;
const ctx = (): TenantContext => ({ orgId: demo.orgId, userId: demo.adminUserId, modulo: "vendas" });

beforeAll(async () => {
  ({ db, demo } = await freshDb());
  await db.query("do $$ begin if not exists (select 1 from pg_roles where rolname='erp_app_test') then create role erp_app_test login password 'erp_app_test' in role erp_app; end if; end $$;");
  app = createPool(process.env.TEST_DATABASE_URL_APP ?? TEST_URL.replace("postgres@", "erp_app_test:erp_app_test@"), { max: 3 });
}, 300_000);
afterAll(async () => { await app?.end(); await db?.end(); });

type Aprovacao = ConfiguracaoTipoOperacaoV5["aprovacao"];
/** O neutro do 5 do DOMÍNIO, só com a aprovação do caso. */
function cfg5(aprovacao: Partial<Aprovacao> = {}): ConfiguracaoTipoOperacaoV5 {
  const x = configuracaoNeutraTopV5();
  x.aprovacao = { ...x.aprovacao, ...aprovacao };
  return x;
}

/** Um código de TOP novo. */
const codigoNovo = () => `F5B${++seq}`;
/** TOP + versão 1 com `configuracao` e a coluna `coluna`, pelo papel da aplicação, numa transação (a FK da versão atual é adiada). */
async function gravarVersao(configuracao: object, coluna: number, codigo = codigoNovo()): Promise<{ codigo: string; versao: string }> {
  return withTx(app, ctx(), async (tx) => {
    const top = (await tx.query<{ id: string }>("insert into erp.tipos_operacao (organization_id, codigo, codigo_base) values ($1,$2,$3) returning id",
      [demo.orgId, codigo, FAMILIA_VENDA])).rows[0]!.id;
    const versao = (await tx.query<{ id: string }>(
      `insert into erp.tipos_operacao_versoes (organization_id, tipo_operacao_id, versao, nome, configuracao, configuracao_schema_version)
       values ($1,$2,1,$3,$4::jsonb,$5) returning id`,
      [demo.orgId, top, `TOP formato 5 ${seq}`, JSON.stringify(configuracao), coluna])).rows[0]!.id;
    return { codigo, versao };
  });
}
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try { await p; } catch (e) { return e as { code?: string; constraint?: string; message: string }; }
  throw new Error("esperava a recusa, e o banco aceitou");
}
const topsComCodigo = async (codigo: string) => (await db.query("select 1 from erp.tipos_operacao where organization_id=$1 and codigo=$2", [demo.orgId, codigo])).rowCount;

describe("B5-1 — o formato 5 entra sem migration", () => {
  it("B5-1 a versão com o neutro do 5 (Sempre) e a coluna 5 passa pelos CHECKs da 0022 e volta 5 nas duas; premissa: coluna 4 com JSON 5 → 23514 (schema), e o 5 sem `aprovacao` → 23514 (forma)", async () => {
    const corpo = cfg5({ politica: "sempre", valorMinimo: null });
    expect(corpo.versaoSchema, "premissa: o neutro do domínio é do formato 5").toBe(5);

    // PREMISSA: o CHECK de schema está de pé — a coluna e o payload que discordam (4 × 5) são recusados, e nada fica.
    const codigoDiscorda = codigoNovo();
    const discorda = await erroDe(gravarVersao(corpo, 4, codigoDiscorda));
    expect([discorda.code, discorda.constraint]).toEqual(["23514", "tipos_operacao_versoes_configuracao_schema"]);
    expect(await topsComCodigo(codigoDiscorda), "a transação recusada não deixou a TOP").toBe(0);
    // PREMISSA: o CHECK de forma também — um 5 sem uma das cinco seções é recusado.
    const { aprovacao: _semAprovacao, ...semAprovacao } = corpo;
    const codigoForma = codigoNovo();
    const forma = await erroDe(gravarVersao(semAprovacao, 5, codigoForma));
    expect([forma.code, forma.constraint]).toEqual(["23514", "tipos_operacao_versoes_configuracao_forma"]);
    expect(await topsComCodigo(codigoForma)).toBe(0);

    // O 5 de verdade: entra, e a linha lida (pelo papel da aplicação) diz 5 na coluna e no payload.
    const { codigo, versao } = await gravarVersao(corpo, 5);
    expect(await topsComCodigo(codigo)).toBe(1);
    const linha = await withTx(app, ctx(), async (tx) => (await tx.query<{ coluna: number; payload: number; configuracao: unknown }>(
      `select configuracao_schema_version coluna, (configuracao ->> 'versaoSchema')::int payload, configuracao
         from erp.tipos_operacao_versoes where id = $1`, [versao])).rows);
    expect(linha, "a versão é visível para o papel da aplicação").toHaveLength(1);
    expect([linha[0]!.coluna, linha[0]!.payload]).toEqual([5, 5]);
    expect(linha[0]!.configuracao, "o banco guarda o 5 como veio").toEqual(corpo);
    // E o domínio lê a linha gravada como 5 (nunca 4).
    const lida = lerConfiguracaoTop(linha[0]!.configuracao);
    expect(lida.ok && lida.valor.versaoSchema).toBe(5);
  });
});

/**
 * A TABELA DE CASOS: [caso, aprovação do 5, valor do documento, esperado no 5]. Ao lado de cada linha o teste mede, sobre a
 * MESMA linha gravada, o JSON com `versaoSchema` 4 (o mesmo resultado) e 3 (sempre falso: o corte), e o domínio.
 */
const CASOS: [string, Partial<Aprovacao>, string | null, boolean][] = [
  ["Sempre", { politica: "sempre", valorMinimo: null }, "100.00", true],
  ["Sempre, valor nulo (o documento de estoque)", { politica: "sempre", valorMinimo: null }, null, true],
  ["A partir de 1000.00, abaixo (999.99)", { politica: "por_valor", valorMinimo: "1000.00" }, "999.99", false],
  ["A partir de 1000.00, igual (1000.00)", { politica: "por_valor", valorMinimo: "1000.00" }, "1000.00", true],
  ["A partir de 1000.00, valor nulo", { politica: "por_valor", valorMinimo: "1000.00" }, null, true],
  ["Sem aprovação", { politica: "nenhuma", valorMinimo: null }, "100.00", false],
];

describe("B5-2 — erp.top_exige_aprovacao sobre a LINHA gravada no 5", () => {
  it("B5-2 Sempre → true; a partir de 1000.00: 999.99 false, 1000.00 true; nenhuma → false; a mesma linha com versaoSchema 4 dá o mesmo, com 3 dá false; o domínio concorda", async () => {
    expect(CASOS.filter((x) => x[3]).length, "premissa: a tabela tem casos verdadeiros").toBeGreaterThanOrEqual(3);
    expect(CASOS.filter((x) => !x[3]).length, "e falsos").toBeGreaterThanOrEqual(2);
    const obtidos: [string, boolean, boolean, boolean, boolean][] = [];
    for (const [caso, aprovacao, valor] of CASOS) {
      const { versao } = await gravarVersao(cfg5(aprovacao), 5);
      const r = await withTx(app, ctx(), async (tx) => (await tx.query<{ no5: boolean; no4: boolean; no3: boolean; coluna: number; configuracao: unknown }>(
        `select erp.top_exige_aprovacao(v.configuracao, $2::numeric) no5,
                erp.top_exige_aprovacao(jsonb_set(v.configuracao, '{versaoSchema}', '4'::jsonb), $2::numeric) no4,
                erp.top_exige_aprovacao(jsonb_set(v.configuracao, '{versaoSchema}', '3'::jsonb), $2::numeric) no3,
                v.configuracao_schema_version coluna, v.configuracao
           from erp.tipos_operacao_versoes v where v.id = $1`, [versao, valor])).rows);
      expect(r, `${caso}: a linha gravada é visível para o papel da aplicação`).toHaveLength(1);
      expect(r[0]!.coluna, `${caso}: premissa — a linha está no 5`).toBe(5);
      // O domínio, sobre a MESMA linha: a regra que a execução usa (regrasGeraisDaVersaoTop + exigeAprovacao).
      const regras = regrasGeraisDaVersaoTop({ codigoBase: FAMILIA_VENDA, configuracao: r[0]!.configuracao });
      if (!regras.ok) throw new Error(`${caso}: o domínio não lê a linha gravada no 5 (${regras.motivo})`);
      obtidos.push([caso, r[0]!.no5, r[0]!.no4, r[0]!.no3, exigeAprovacao(regras.regras, valor)]);
    }
    // Conclusão: o 5 = o 4, o 3 nunca exige, e o domínio diz o que o banco diz.
    expect(obtidos).toEqual(CASOS.map(([caso, , , esperado]) => [caso, esperado, esperado, false, esperado]));
  });
});
