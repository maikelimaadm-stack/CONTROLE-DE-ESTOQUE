import { describe, it, expect } from "vitest";
import { AUTORIZACAO_PROPRIETARIO, autorizacaoPorModulo } from "@erp/plataforma";
import { escopoDaPermissao } from "@agro/domain";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPORTS } from "../../src/routes/reports.js";
import type { RequestContext, ServiceCtx } from "../../src/lib/context.js";
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
function fontes(sql: string): { tabela: string; alias: string }[] {
  const out: { tabela: string; alias: string }[] = [];
  const re = /erp\.([a-z_][a-z0-9_]*)(?:\s+as)?\s+([a-z][a-z0-9_]*)/gi;
  const PALAVRAS = new Set(["on", "where", "group", "order", "left", "join", "inner", "right", "set", "using", "and", "or", "limit", "having", "union", "select", "from", "cross", "lateral", "full", "outer", "for", "offset", "with", "returning"]);
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const tabela = m[1]!; const alias = m[2]!;
    if (PALAVRAS.has(alias.toLowerCase())) continue;
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
    for (const [a, b] of arestas) {
      if (a === atual && !seeds.has(b)) { seeds.add(b); fila.push(b); }
      if (b === atual && !seeds.has(a)) { seeds.add(a); fila.push(a); }
    }
  }
  return seeds;
}

const filtrosVazios: Record<string, string> = {};

describe("escopo empresarial dos relatórios", () => {
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
        if (derivados[alias]) {
          if (derivados[alias]!.length < 20) problemas.push(`${def.key}: justificativa curta demais para o alias ${alias}`);
          continue;
        }
        problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} sem recorte de empresa — nem predicado próprio nem junção com fonte recortada`);
      }
      for (const alias of Object.keys(derivados)) {
        if (!fontes(texto).some((f) => f.alias === alias)) problemas.push(`${def.key}: declaração derivada obsoleta para alias ${alias} (não aparece no SQL)`);
      }
    }
    expect(problemas, `relatórios sem recorte de empresa:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("nenhuma consulta de painel escapa do escopo: dashboards.ts usa consultaEscopada ou declara a exceção", () => {
    // Exceções: consultas que não leem NENHUMA tabela de empresa (auditoria de usuários) e o bloco de saldo
    // bancário, que é agregado de ORGANIZAÇÃO e por isso exige capacidade de organização (ver contrato §7).
    const EXCECOES: Record<string, string> = {
      "erp.audit_logs": "auditoria de usuários: organização inteira, sem coluna de empresa",
      "erp.v_bank_account_balances": "saldo bancário é agregado da organização; o bloco só é montado com bank_accounts.view"
    };
    const texto = fs.readFileSync(path.join(here, "../../src/routes/dashboards.ts"), "utf8");
    const problemas: string[] = [];
    const re = /ctx\.tx\.query(?:<[^(]*?>)?\(\s*"((?:[^"\\]|\\.)*)"/g;
    for (let m = re.exec(texto); m; m = re.exec(texto)) {
      const sql = m[1]!;
      const tabelasDeEmpresa = fontes(sql).filter((f) => colunaDeEmpresa(f.tabela) && !NAO_RECORTAVEIS.has(f.tabela));
      const justificada = Object.keys(EXCECOES).some((t) => sql.includes(t));
      if (tabelasDeEmpresa.length && !justificada) {
        problemas.push(`consulta com ctx.tx.query lendo ${tabelasDeEmpresa.map((t) => t.tabela).join(", ")} sem consultaEscopada: ${sql.slice(0, 120)}`);
      }
    }
    expect(problemas, `painéis sem escopo:\n${problemas.join("\n")}`).toEqual([]);
  });
});
