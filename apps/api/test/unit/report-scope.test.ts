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
 * Alcance do recorte por JUNÇÃO. Uma tabela pode não ter predicado próprio e mesmo assim não vazar: se as
 * linhas dela só existem em função de uma fonte JÁ RECORTADA (`join erp.stock_balances sb on
 * sb.warehouse_id=w.id`, com `w` recortada), o conjunto já está limitado às empresas autorizadas.
 *
 * Mas essa herança só é sólida em dois casos, e o gate exige um deles:
 *
 *  (a) a tabela vizinha NÃO TEM coluna de empresa própria — ela pertence a uma empresa por RELAÇÃO, então o
 *      recorte do pai é o único recorte que existe (`erp.title_apportionments` pelo título);
 *  (b) a igualdade é entre as PRÓPRIAS COLUNAS DE EMPRESA das duas (`a.farm_id=b.farm_id`), que transporta
 *      o recorte de uma para a outra.
 *
 * Juntar duas tabelas QUE TÊM coluna de empresa por qualquer outra chave NÃO recorta nada: nada no banco
 * impede que o abastecimento da empresa B aponte para o equipamento da empresa A (`s.equipment_id=e.id`),
 * ou que o título da empresa B seja rateado para a área da empresa A (`ta.area_id=ar.id`). Quem tem coluna
 * de empresa própria responde pela coluna própria — ou declara o derivado com motivo.
 */
function protegidos(sql: string): Set<string> {
  const colunaDoAlias = new Map<string, string | null>();
  for (const f of fontes(sql)) if (!colunaDoAlias.has(f.alias)) colunaDoAlias.set(f.alias, NAO_RECORTAVEIS.has(f.tabela) ? null : colunaDeEmpresa(f.tabela));
  const seeds = new Set<string>();
  const rePred = /me\.empresa_id=([a-z][a-z0-9_]*)\.[a-z_]+/gi;
  for (let m = rePred.exec(sql); m; m = rePred.exec(sql)) seeds.add(m[1]!);
  const arestas: { a: string; b: string; porEmpresa: boolean }[] = [];
  const reEq = /\b([a-z][a-z0-9_]*)\.([a-z_]+)\s*=\s*([a-z][a-z0-9_]*)\.([a-z_]+)/gi;
  for (let m = reEq.exec(sql); m; m = reEq.exec(sql)) {
    const [, a, ca, b, cb] = m;
    if (ca === "organization_id" && cb === "organization_id") continue; // não recorta empresa
    const colA = colunaDoAlias.get(a!) ?? null, colB = colunaDoAlias.get(b!) ?? null;
    arestas.push({ a: a!, b: b!, porEmpresa: !!colA && !!colB && ca === colA && cb === colB });
  }
  const fila = [...seeds];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const e of arestas) {
      const vizinho = e.a === atual ? e.b : e.b === atual ? e.a : null;
      if (!vizinho || seeds.has(vizinho)) continue;
      if (colunaDoAlias.get(vizinho) && !e.porEmpresa) continue; // (a) e (b) do cabeçalho
      seeds.add(vizinho); fila.push(vizinho);
    }
  }
  return seeds;
}

/** A tabela aparece sem alias nesta consulta? Então as colunas dela são referenciadas sem qualificação. */
const fonteSemAlias = (sql: string, tabela: string): boolean => fontes(sql).some((f) => f.tabela === tabela && f.semAlias);

/**
 * PONTO CEGO FECHADO: a análise por ALIAS enxerga a consulta inteira, então ler a MESMA tabela DUAS vezes
 * com o MESMO alias — uma recortada, outra não — passava despercebido. Foi assim que o `exists` do HAVING
 * do painel de rebanho leu `erp.herd_lots h` sem predicado enquanto a subconsulta escalar, com o mesmo
 * alias `h`, carregava o marcador: o alias já estava "semeado" como protegido.
 *
 * A contagem fecha isso: um alias que se protege pelo PRÓPRIO predicado precisa ter, no mínimo, tantos
 * predicados quantas forem as vezes em que a tabela dele aparece. Herança por junção continua tratada pelo
 * caminho de `protegidos()` — aqui só se cobra de quem respondeu "tenho predicado próprio".
 */
function ocorrenciasSemRecorte(sql: string): string[] {
  const faltas: string[] = [];
  const porAlias = new Map<string, { tabela: string; n: number }>();
  for (const { tabela, alias } of fontes(sql)) {
    const coluna = colunaDeEmpresa(tabela);
    if (!coluna || NAO_RECORTAVEIS.has(tabela)) continue;
    const atual = porAlias.get(alias);
    porAlias.set(alias, { tabela, n: (atual?.n ?? 0) + 1 });
  }
  for (const [alias, { tabela, n }] of porAlias) {
    if (n < 2) continue;
    const coluna = colunaDeEmpresa(tabela)!;
    const qualificado = sql.split(`me.empresa_id=${alias}.${coluna}`).length - 1;
    const nu = sql.split(`me.empresa_id=${coluna}`).length - 1 - qualificado;
    const predicados = qualificado + (fonteSemAlias(sql, tabela) ? nu : 0);
    if (predicados > 0 && predicados < n) faltas.push(`${tabela} aparece ${n}x como ${alias} mas só ${predicados}x com predicado próprio — leitura repetida com o mesmo alias esconde a que ficou sem recorte`);
  }
  return faltas;
}

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
      const coluna = colunaDeEmpresa(f.tabela);
      // tabela sem alias (`from erp.dfe_documents where …`) tem o predicado na coluna NÃO qualificada
      const comPredicado = texto.includes(`me.empresa_id=${f.alias}.${coluna}`)
        || (f.semAlias === true && texto.includes(`me.empresa_id=${coluna}`));
      // relatório de organização não tem módulo a respeitar: dizer "junção" ali seria enganoso
      if (modulo === "organização") return `${f.tabela} (organização)`;
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
        // Chegar aqui significa que a tabela TEM coluna de empresa própria. Nesse caso "derivado" não é
        // desculpa aceitável: quem tem `farm_id` responde pelo próprio `farm_id`. A declaração derivada
        // existe para a tabela que NÃO tem coluna de empresa (o laço de EMPRESA_POR_RELACAO, abaixo).
        if (derivados[alias]) {
          problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} foi DECLARADA derivada, mas tem coluna de empresa própria (${coluna}) — declaração não substitui predicado`);
          continue;
        }
        problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} sem recorte de empresa — nem predicado próprio nem junção por coluna de empresa`);
      }
      // fontes cuja empresa vem por RELAÇÃO: o pai precisa estar presente e recortado
      for (const { tabela, alias } of fontes(texto)) {
        const rel = EMPRESA_POR_RELACAO[tabela];
        if (!rel || modulo === null) continue;
        const paiRecortado = fontes(texto).some((f) => f.tabela === rel.pai && recortados.has(f.alias));
        if (paiRecortado || derivados[alias]) continue;
        problemas.push(`${def.key} (${modulo}): ${tabela} como ${alias} pertence a uma empresa por ${rel.via}, mas ${rel.pai} não aparece recortada na consulta`);
      }
      for (const falta of ocorrenciasSemRecorte(texto)) problemas.push(`${def.key} (${modulo}): ${falta}`);
      for (const alias of Object.keys(derivados)) {
        const fonte = fontes(texto).find((f) => f.alias === alias);
        if (!fonte) { problemas.push(`${def.key}: declaração derivada obsoleta para alias ${alias} (não aparece no SQL)`); continue; }
        // a declaração só vale para tabela SEM coluna de empresa: com coluna própria ela é, na melhor das
        // hipóteses, documentação enganosa (o recorte real é o predicado) e, na pior, a desculpa de um vazamento.
        if (colunaDeEmpresa(fonte.tabela) && !NAO_RECORTAVEIS.has(fonte.tabela)) problemas.push(`${def.key}: declaração derivada indevida para ${fonte.tabela} como ${alias} — a tabela tem coluna de empresa própria e responde por ela`);
        else if (derivados[alias]!.length < 20) problemas.push(`${def.key}: justificativa curta demais para o alias ${alias}`);
      }
    }
    expect(problemas, `relatórios sem recorte de empresa:\n${problemas.join("\n")}`).toEqual([]);
  });

  /**
   * MESMO CRITÉRIO NAS ROTAS OPERACIONAIS. O vazamento por junção em chave de negócio não é privilégio de
   * relatório: qualquer consulta que já se declara escopada (usa `{{escopo…}}`) e lê uma segunda tabela de
   * empresa sem recorte próprio mostra dado de empresa que o usuário não enxerga. O que sobra aqui é
   * DECLARADO, com motivo, e o gate falha se aparecer um caso novo.
   */
  it("nenhuma consulta escopada das rotas operacionais lê fonte de empresa sem recorte próprio (ou está declarada)", () => {
    /** Cada entrada: o alias tolerado, o arquivo, e por que a exceção é legítima. */
    const DECLARADOS: { arquivo: string; trecho: string; aliases: string[]; motivo: string }[] = [
      {
        arquivo: "fleet-hr.ts", trecho: "from erp.equipment_transfers t join erp.equipments e on e.id=t.equipment_id", aliases: ["e"],
        motivo: "transferência de equipamento ENTRE empresas: o equipamento é o objeto do documento que o usuário já está autorizado a ver (origem ou destino dentro do escopo). Recortá-lo esconderia o próprio objeto da transferência."
      },
      {
        arquivo: "stock.ts", trecho: "from erp.warehouse_transfers d join erp.warehouses wo on wo.id=d.origin_warehouse_id", aliases: ["wo", "wd"],
        motivo: "transferência de armazém ENTRE empresas: origem e destino são as duas pontas do documento já autorizado. Recortar a contraparte deixaria a transferência sem destino legível."
      },
      {
        arquivo: "livestock.ts", trecho: "from erp.herd_lots h join erp.animal_categories c on c.id=h.category_id", aliases: ["bt"],
        motivo: "rótulo do lote do próprio conjunto já recortado (h.farm_id): mostra o nome do lote a que o conjunto pertence."
      },
      {
        arquivo: "livestock.ts", trecho: "from erp.processings p left join erp.animal_movements m on m.id=p.purchase_movement_id", aliases: ["m", "b"],
        motivo: "rótulos da compra e do pré-lote que ORIGINARAM o processamento já recortado (p.farm_id): são a procedência do registro autorizado."
      },
      {
        arquivo: "livestock.ts", trecho: "from erp.feed_deliveries d left join erp.feedlot_corrals c on c.id=d.corral_id", aliases: ["b"],
        motivo: "rótulo do lote tratado pelo próprio trato já recortado (d.farm_id)."
      }
    ];
    const dir = path.join(here, "../../src/routes");
    const problemas: string[] = [];
    for (const arquivo of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "reports.ts" && f !== "dashboards.ts")) {
      const texto = fs.readFileSync(path.join(dir, arquivo), "utf8");
      const re = /(consultaEscopada|ctx\.tx\.query|tx\.query)(?:<[^(]*?>)?\((?:ctx,\s*)?"((?:[^"\\]|\\.)*)"/g;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        const cru = m[2]!;
        if (!cru.includes("{{escopo")) continue; // consulta que não se diz escopada é de organização e tem gate próprio
        const sql = cru.replace(/\{\{escopo(?:_nulo|_par)?:([^}|]+)(?:\|[a-z_]+)?\}\}/g, (_x, cols: string) => cols.split(",").map((c) => `exists (select 1 from erp.membro_empresas me where me.empresa_id=${c.trim()})`).join(" and "));
        const recortados = protegidos(sql);
        for (const { tabela, alias } of fontes(sql)) {
          const coluna = colunaDeEmpresa(tabela);
          if (!coluna || NAO_RECORTAVEIS.has(tabela) || tabela === "farms") continue;
          if (recortados.has(alias) || (fonteSemAlias(sql, tabela) && sql.includes(`me.empresa_id=${coluna}`))) continue;
          if (DECLARADOS.some((d) => d.arquivo === arquivo && sql.includes(d.trecho) && d.aliases.includes(alias))) continue;
          problemas.push(`${arquivo}: ${tabela} como ${alias} sem recorte próprio — ${sql.slice(0, 120)}`);
        }
        for (const falta of ocorrenciasSemRecorte(sql)) problemas.push(`${arquivo}: ${falta}`);
      }
    }
    expect(problemas, `rotas operacionais sem escopo:\n${problemas.join("\n")}`).toEqual([]);
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
      for (const falta of ocorrenciasSemRecorte(sql)) problemas.push(`${falta} — ${sql.slice(0, 90)}`);
    }
    expect(problemas, `painéis sem escopo:\n${problemas.join("\n")}`).toEqual([]);
  });
});
