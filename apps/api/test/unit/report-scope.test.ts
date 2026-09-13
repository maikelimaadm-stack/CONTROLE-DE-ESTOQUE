import { describe, it, expect } from "vitest";
import { AUTORIZACAO_PROPRIETARIO, autorizacaoPorModulo } from "@erp/plataforma";
import { escopoDaPermissao } from "@agro/domain";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPORTS } from "../../src/routes/reports.js";
import type { ServiceCtx } from "../../src/lib/context.js";
// @ts-expect-error — parser de migrations em JS puro, compartilhado com os gates de documentação
import { companyColumnsOf, readSchema } from "../../../../scripts/lib/schema.mjs";

/**
 * GATE DE ESCOPO EMPRESARIAL DOS RELATÓRIOS (PRE-BASE2-02 §13-§16).
 *
 * Um relatório company-scoped pode ter várias fontes; proteger uma e vazar duas passaria despercebido em
 * qualquer verificação que só procure "existe um {{escopo}} no texto". Por isso este gate:
 *
 *  1. executa o `sql()` de CADA relatório com um contexto sintético no modo `selecionadas`;
 *  2. extrai do SQL gerado toda tabela `erp.*` e o alias dela;
 *  3. exige, para cada tabela com coluna de empresa, o predicado canônico daquele alias
 *     (`me.empresa_id=<alias>.<coluna>`), que é exatamente o que `empresaScope` emite;
 *  4. aceita ausência do predicado SOMENTE quando o relatório declara aquele alias como DERIVADO — recorte
 *     que chega por junção com uma fonte já protegida — com a justificativa escrita na própria definição.
 *
 * Relatório cuja permissão é de organização não exige predicado; mas se ele ler tabela de empresa, a
 * declaração `organizacao` precisa dizer por quê. Nenhuma linha fica "não auditada": o gate percorre o
 * catálogo inteiro.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const schema = readSchema();
const colunaDeEmpresa = (tabela: string): string | null => {
  const t = schema.get(`erp.${tabela}`);
  const cols = t ? (companyColumnsOf(t) as string[]) : [];
  return cols.length ? cols[0]! : null;
};

/** Tabelas cuja coluna de empresa NÃO é autoridade de recorte (vínculo/índice), tratadas caso a caso. */
/**
 * Tabelas SEM coluna de empresa cujos dados pertencem a uma empresa POR RELAÇÃO. O gate estrutural não as
 * enxergaria (não têm `farm_id`), mas ler `erp.matings` sem nenhum vínculo com a estação ou com a matriz
 * mostra reprodução de qualquer empresa. Aqui a exigência é: a tabela-PAI precisa aparecer na consulta e
 * estar recortada — ou a fonte precisa ser declarada como derivada, com motivo.
 */
const EMPRESA_POR_RELACAO: Record<string, { pai: string; via: string }> = {
  matings: { pai: "breeding_seasons", via: "season_id (not null) — a estação é da empresa" },
  title_settlements: { pai: "financial_titles", via: "title_id" },
  title_apportionments: { pai: "financial_titles", via: "title_id" },
  bank_movement_apportionments: { pai: "bank_movements", via: "movement_id" },
  purchase_request_events: { pai: "purchase_requests", via: "request_id" },
  animal_movement_items: { pai: "animal_movements", via: "movement_id" },
  animal_handling_items: { pai: "animal_handlings", via: "handling_id" },
  weighing_items: { pai: "weighings", via: "weighing_id" },
  maintenance_machines: { pai: "maintenances", via: "maintenance_id" }
};

const NAO_RECORTAVEIS = new Set(["member_farms", "membro_empresas", "registros_globais", "farm_cost_centers", "proprietary_farms", "authorizer_farms", "bank_account_farms"]);

const ctxSintetico = (modulo: string | null): ServiceCtx => ({
  user: { id: "00000000-0000-4000-8000-000000000001", email: "u@x", name: "U" },
  orgId: "00000000-0000-4000-8000-0000000000aa",
  farmId: null,
  moduloEmpresa: modulo,
  membership: {
    orgId: "00000000-0000-4000-8000-0000000000aa", orgName: "t", roleId: null, isOwner: false,
    memberId: "00000000-0000-4000-8000-0000000000bb",
    escopos: modulo ? autorizacaoPorModulo([[modulo, "selecionadas"]]) : AUTORIZACAO_PROPRIETARIO
  },
  permissions: new Set<string>(),
  tx: { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ServiceCtx["tx"]
} as unknown as ServiceCtx);

/** Aliases de `erp.<tabela>` no SQL gerado (o texto é montado por código, então o padrão é regular). */
function fontes(sql: string): { tabela: string; alias: string; semAlias?: boolean }[] {
  const out: { tabela: string; alias: string; semAlias?: boolean }[] = [];
  const re = /erp\.([a-z_][a-z0-9_]*)(?:(?:\s+as)?\s+([a-z][a-z0-9_]*))?/gi;
  const PALAVRAS = new Set(["on", "where", "group", "order", "left", "join", "inner", "right", "set", "using", "and", "or", "limit", "having", "union", "select", "from", "cross", "lateral", "full", "outer", "for", "offset", "with", "returning"]);
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const tabela = m[1]!; const alias = m[2];
    // tabela SEM alias (`from erp.dfe_documents where …`): as colunas dela aparecem sem qualificação
    if (!alias || PALAVRAS.has(alias.toLowerCase())) { out.push({ tabela, alias: tabela, semAlias: true }); continue; }
    out.push({ tabela, alias });
  }
  return out;
}

/**
 * Alcance do recorte por JUNÇÃO. Uma tabela de empresa pode não ter predicado próprio e mesmo assim não
 * vazar: se as linhas dela só existem em função de uma fonte JÁ RECORTADA (`join erp.warehouses w on
 * w.id=m.warehouse_id`, com `m` recortada), o conjunto já está limitado às empresas autorizadas.
 *
 * O gate reconhece isso estruturalmente: monta o grafo de igualdades entre aliases (ignorando igualdade só
 * por `organization_id`, que não recorta empresa nenhuma) e propaga a proteção a partir dos aliases que têm
 * o predicado canônico. O que sobra — alias de tabela de empresa sem predicado e sem ligação com alguém
 * recortado — é vazamento de verdade: é o caso da tabela que DIRIGE a consulta ou a subconsulta.
 */
function protegidos(sql: string): Set<string> {
  // só propaga entre tabelas DE EMPRESA: passar por um cadastro compartilhado (produto, pessoa, categoria)
  // restringe o conjunto por aquele cadastro, não por empresa — e cadastro é o mesmo para todas elas.
  const deEmpresa = new Set(fontes(sql).filter((f) => colunaDeEmpresa(f.tabela) && !NAO_RECORTAVEIS.has(f.tabela)).map((f) => f.alias));
  const seeds = new Set<string>();
  const rePred = /me\.empresa_id=([a-z][a-z0-9_]*)\.[a-z_]+/gi;
  for (let m = rePred.exec(sql); m; m = rePred.exec(sql)) seeds.add(m[1]!);
  const arestas: [string, string][] = [];
  const reEq = /\b([a-z][a-z0-9_]*)\.([a-z_]+)\s*=\s*([a-z][a-z0-9_]*)\.([a-z_]+)/gi;
  for (let m = reEq.exec(sql); m; m = reEq.exec(sql)) {
    const [, a, ca, b, cb] = m;
    if (ca === "organization_id" && cb === "organization_id") continue; // não recorta empresa
    arestas.push([a!, b!]);
  }
  const fila = [...seeds];
  while (fila.length) {
    const atual = fila.shift()!;
    if (!deEmpresa.has(atual) && !seeds.has(atual)) continue;
    for (const [a, b] of arestas) {
      const vizinho = a === atual ? b : b === atual ? a : null;
      if (!vizinho || seeds.has(vizinho)) continue;
      if (!deEmpresa.has(atual) || !deEmpresa.has(vizinho)) continue; // a ponte precisa ser entre tabelas de empresa
      seeds.add(vizinho); fila.push(vizinho);
    }
  }
  return seeds;
}

/** A tabela aparece sem alias nesta consulta? Então as colunas dela são referenciadas sem qualificação. */
const fonteSemAlias = (sql: string, tabela: string): boolean => fontes(sql).some((f) => f.tabela === tabela && f.semAlias);

const filtrosVazios: Record<string, string> = {};

/** Uma linha da matriz por relatório: o que ele lê, com que estratégia e sob qual módulo. */
function linhaDaMatriz(def: typeof REPORTS[number]): string {
  const escopo = escopoDaPermissao(`${def.permission}.view`);
  const modulo = escopo && escopo.tipo === "empresa" ? escopo.modulo : "organização";
  const texto = def.sql(ctxSintetico(escopo && escopo.tipo === "empresa" ? escopo.modulo : null), filtrosVazios).text;
  const derivados = def.escopo?.derivado ?? {};
  const fontesEmpresa = [...new Map(fontes(texto).filter((f) => colunaDeEmpresa(f.tabela) && !NAO_RECORTAVEIS.has(f.tabela)).map((f) => [`${f.tabela}:${f.alias}`, f])).values()];
  const estrategia = fontesEmpresa.length === 0
    ? "sem fonte de empresa"
    : fontesEmpresa.map((f) => {
      const comPredicado = texto.includes(`me.empresa_id=${f.alias}.${colunaDeEmpresa(f.tabela)}`);
      return `${f.tabela} (${comPredicado ? "predicado" : derivados[f.alias] ? "derivado" : "junção"})`;
    }).join(", ");
  const status = escopo && escopo.tipo === "organizacao" && fontesEmpresa.length ? "ORGANIZAÇÃO JUSTIFICADO" : "OK";
  return `| ${def.key} | ${def.permission} | ${modulo} | ${estrategia || "—"} | ${status} |`;
}

describe("escopo empresarial dos relatórios", () => {
  it("a matriz versionada (docs/REPORT-SCOPE-MATRIX.md) está em dia com o catálogo real", () => {
    const cabecalho = [
      "<!-- GERADO por apps/api/test/unit/report-scope.test.ts — rode com UPDATE_REPORT_MATRIX=1 para atualizar -->",
      "# Matriz de escopo empresarial dos relatórios",
      "",
      "Uma linha por relatório do catálogo (`apps/api/src/routes/reports.ts`). `Estratégia` diz, para cada fonte",
      "com coluna de empresa: **predicado** (recorte próprio), **junção** (recorte herdado de uma fonte já",
      "recortada) ou **derivado** (declarado na definição, com justificativa). Nenhuma linha fica sem auditoria.",
      "",
      "| Relatório | Permissão | Módulo | Fontes de empresa (estratégia) | Situação |",
      "| --- | --- | --- | --- | --- |"
    ];
    const conteudo = [...cabecalho, ...REPORTS.map(linhaDaMatriz), ""].join("\n");
    const caminho = path.join(here, "../../../../docs/REPORT-SCOPE-MATRIX.md");
    if (process.env.UPDATE_REPORT_MATRIX) fs.writeFileSync(caminho, conteudo);
    const atual = fs.existsSync(caminho) ? fs.readFileSync(caminho, "utf8") : "";
    expect(atual, "matriz desatualizada: rode UPDATE_REPORT_MATRIX=1 pnpm --filter @agro/api test").toBe(conteudo);
  });

  it("toda fonte com coluna de empresa de um relatório company-scoped tem predicado — ou declaração derivada justificada", () => {
    const problemas: string[] = [];
    for (const def of REPORTS) {
      const escopo = escopoDaPermissao(`${def.permission}.view`);
      expect(escopo, `${def.key}: permissão ${def.permission}.view sem classificação`).toBeTruthy();
      const modulo = escopo!.tipo === "empresa" ? escopo!.modulo : null;
      let texto = "";
      try { texto = def.sql(ctxSintetico(modulo), filtrosVazios).text; }
      catch (e) { problemas.push(`${def.key}: sql() lançou ${(e as Error).message}`); continue; }
      const derivados = def.escopo?.derivado ?? {};
      const recortados = protegidos(texto);
      const vistos = new Set<string>();
      for (const { tabela, alias } of fontes(texto)) {
        const coluna = colunaDeEmpresa(tabela);
        if (!coluna || NAO_RECORTAVEIS.has(tabela)) continue;
        const chave = `${alias}.${coluna}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        if (modulo === null) {
          if (!def.escopo?.organizacao) problemas.push(`${def.key}: permissão de organização lendo ${tabela} (empresa) sem justificativa em escopo.organizacao`);
          continue;
        }
        if (recortados.has(alias)) continue;
        if (fonteSemAlias(texto, tabela) && texto.includes(`me.empresa_id=${coluna}`)) continue;
        if (derivados[alias]) {
          if (derivados[alias]!.length < 20) problemas.push(`${def.key}: justificativa curta demais para o alias ${alias}`);
          continue;
        }
        problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} sem recorte de empresa — nem predicado próprio nem junção com fonte recortada`);
      }
      // fontes cuja empresa vem por RELAÇÃO: o pai precisa estar presente e recortado
      for (const { tabela, alias } of fontes(texto)) {
        const rel = EMPRESA_POR_RELACAO[tabela];
        if (!rel || modulo === null) continue;
        const paiRecortado = fontes(texto).some((f) => f.tabela === rel.pai && recortados.has(f.alias));
        if (paiRecortado || derivados[alias]) continue;
        problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} pertence a uma empresa por ${rel.via}, mas ${rel.pai} não aparece recortada na consulta`);
      }
      for (const alias of Object.keys(derivados)) {
        if (!fontes(texto).some((f) => f.alias === alias)) problemas.push(`${def.key}: declaração derivada obsoleta para alias ${alias} (não aparece no SQL)`);
      }
    }
    expect(problemas, `relatórios sem recorte de empresa:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("nenhuma consulta de painel escapa do escopo: cada fonte de empresa tem predicado ou vem de fonte recortada", () => {
    // Exceções de ORGANIZAÇÃO, com motivo: auditoria de usuários (sem coluna de empresa) e o saldo bancário,
    // que é agregado da conta e por isso só é montado com a capacidade de organização (contrato §7).
    const EXCECOES = ["erp.audit_logs", "erp.v_bank_account_balances"];
    // fontes DERIVADAS de um painel: o conjunto já vem de uma fonte recortada por uma cadeia que passa por
    // tabela sem coluna de empresa (o curral herda a empresa do pátio). Cada uma com o motivo, como nos relatórios.
    const DERIVADOS: { trecho: string; aliases: string[]; motivo: string }[] = [
      {
        trecho: "from erp.animals a join erp.batches b on b.id=a.batch_id where b.corral_id=c.id",
        aliases: ["a", "b"],
        motivo: "ocupação do curral: animais e lotes alcançados pelo curral, que herda a empresa do pátio já recortado (erp.feedlot_yards.farm_id)."
      }
    ];
    const texto = fs.readFileSync(path.join(here, "../../src/routes/dashboards.ts"), "utf8");
    const problemas: string[] = [];
    // consultas escopadas (marcadores) e consultas cruas, analisadas com o MESMO critério dos relatórios
    const re = /(consultaEscopada|ctx\.tx\.query)(?:<[^(]*?>)?\((?:ctx,\s*)?"((?:[^"\\]|\\.)*)"/g;
    for (let m = re.exec(texto); m; m = re.exec(texto)) {
      const cru = m[2]!;
      if (EXCECOES.some((t) => cru.includes(t))) continue;
      // o marcador vira o predicado canônico que `empresaScope` emite, para a análise ser a mesma
      const sql = cru.replace(/\{\{escopo(?:_nulo|_par)?:([^}|]+)(?:\|[a-z_]+)?\}\}/g, (_x, col: string) => `exists (select 1 from erp.membro_empresas me where me.empresa_id=${col.trim()})`);
      const recortados = protegidos(sql);
      for (const { tabela, alias } of fontes(sql)) {
        if (!colunaDeEmpresa(tabela) || NAO_RECORTAVEIS.has(tabela)) continue;
        if (recortados.has(alias) || (fonteSemAlias(sql, tabela) && sql.includes(`me.empresa_id=${colunaDeEmpresa(tabela)}`))) continue;
        const derivado = DERIVADOS.find((d) => sql.includes(d.trecho) && d.aliases.includes(alias));
        if (derivado) continue;
        problemas.push(`${tabela} como ${alias} sem recorte: ${sql.slice(0, 110)}`);
      }
    }
    expect(problemas, `painéis sem escopo:\n${problemas.join("\n")}`).toEqual([]);
  });
});
