import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { createPool, type Db } from "@agro/db";
import { harness, TEST_URL, type Harness } from "./setup.js";

/**
 * Importação de cadastros — GRAVAÇÃO (correções R1 da PR #59).
 *
 * O que esta suíte cobra do servidor, sempre pela rota real (`/api/imports/:key`) e sempre conferindo no banco:
 *   - erro de banco numa linha volta com a COLUNA e em português (FK, duplicado, classe 22), e erro do zod sai
 *     traduzido como na tela — nunca a frase em inglês;
 *   - 100 linhas com erro de banco dão 422 com as 100 linhas, não 500;
 *   - o obrigatório condicional (`requiredWhen`) vale no modelo (cabeçalho laranja) e na importação;
 *   - no modelo dos cadastros em árvore, a lista da coluna do auto-relacionamento só AVISA (warning);
 *   - a prévia não reserva ID Global, a importação real reserva na ordem do arquivo, e uma prévia longa de
 *     produtos não trava o cadastro de uma pessoa (que também recebe ID Global).
 */
let h: Harness; let admin: Db;

interface Erro { linha: number; coluna: string | null; mensagem: string }
interface Resposta { linhas: number; gravadas: number; erros: Erro[]; simulacao: boolean }
const j = (r: { body: string }) => JSON.parse(r.body) as Resposta;
const espera = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

const modelo = async (key: string) => {
  const r = await h.app.inject({ method: "GET", url: `/api/imports/${key}/modelo`, headers: h.headers() });
  expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer); return wb;
};
const enviar = async (wb: ExcelJS.Workbook, key: string, simular = false) =>
  h.app.inject({ method: "POST", url: `/api/imports/${key}?simular=${simular ? 1 : 0}`, headers: h.headers({ "content-type": "application/json" }), payload: { arquivo_base64: Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer).toString("base64") } });
const dados = (wb: ExcelJS.Workbook) => wb.getWorksheet("Dados")!;
const cabecalho = (wb: ExcelJS.Workbook) => { const r: string[] = []; dados(wb).getRow(1).eachCell((c) => r.push(String(c.value))); return r; };
/** Número da coluna pelo título EXATO do cabeçalho; título ausente é erro do teste, nunca a coluna 0. */
const col = (wb: ExcelJS.Workbook, titulo: string) => { const n = cabecalho(wb).indexOf(titulo) + 1; if (!n) throw new Error(`coluna "${titulo}" não está no modelo: ${cabecalho(wb).join(" | ")}`); return n; };
const listaDe = (wb: ExcelJS.Workbook, chave: string) => {
  const ws = wb.getWorksheet("Listas")!; let c = 0; ws.getRow(1).eachCell((x, n) => { if (x.value === chave) c = n; });
  if (!c) throw new Error(`lista "${chave}" não está na aba Listas`);
  const out: string[] = []; for (let i = 2; i <= ws.rowCount; i++) { const v = ws.getRow(i).getCell(c).value; if (v) out.push(String(v)); } return out;
};
const preencher = (wb: ExcelJS.Workbook, linha: number, valores: Record<string, ExcelJS.CellValue>) => {
  const row = dados(wb).getRow(linha); for (const [titulo, v] of Object.entries(valores)) row.getCell(col(wb, titulo)).value = v; row.commit();
};
/** Só as colunas VERMELHAS do produto, com o primeiro item de cada lista do próprio modelo. */
const obrigatoriosDoProduto = (wb: ExcelJS.Workbook, descricao: string): Record<string, string> => {
  const primeiro = (lista: string) => { const v = listaDe(wb, lista)[0]; expect(v, `lista ${lista} vazia no modelo`).toBeTruthy(); return v!; };
  return { "Descrição *": descricao, "1ª Un. Medida *": primeiro("1ª Un. Medida"), "Grupo *": primeiro("Grupo") };
};
const textoDaNota = (n: string | ExcelJS.Comment | undefined): string => (typeof n === "string" ? n : (n?.texts ?? []).map((t) => t.text).join(""));
const corDoCabecalho = (wb: ExcelJS.Workbook, titulo: string) => (dados(wb).getRow(1).getCell(col(wb, titulo)).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

const contar = async (tabela: "people" | "products" | "chart_accounts" | "registros_globais") =>
  Number((await admin.query<{ n: string }>(`select count(*) n from erp.${tabela} where organization_id=$1`, [h.demo.orgId])).rows[0]!.n);
/** Contador de ID Global da organização (null = a linha ainda não existe). */
const contador = async () => (await admin.query<{ v: string }>("select ultimo_valor::text v from erp.sequencias_id_global where organization_id=$1", [h.demo.orgId])).rows[0]?.v ?? null;
const idGlobalDe = async (idEntidade: string) => (await admin.query<{ v: string; tipo: string }>("select id_global::text v, tipo_entidade tipo from erp.registros_globais where organization_id=$1 and id_entidade=$2", [h.demo.orgId, idEntidade])).rows[0] ?? null;
const criarPessoa = (nome: string) => h.app.inject({ method: "POST", url: "/api/resources/people", headers: h.headers({ "content-type": "application/json" }), payload: { name: nome } });

beforeAll(async () => { h = await harness(); admin = createPool(TEST_URL, { max: 2 }); }, 180_000);
afterAll(async () => { await admin.end(); await h.app.close(); await h.db.end(); });

describe("erros de gravação: coluna e português", () => {
  it("G1: pessoa com Banco = 999 (FK inexistente) → coluna Banco, 'Valor não encontrado no cadastro de referência.'; nada gravado; com banco real a mesma linha passa", async () => {
    // premissa: 999 NÃO existe em erp.banks, e o cadastro de bancos não está vazio (a FK tem com o que comparar)
    const bancos = (await admin.query<{ code: string }>("select code from erp.banks order by code")).rows.map((b) => b.code);
    expect(bancos).not.toContain("999");
    expect(bancos.length).toBeGreaterThan(0);
    const wb = await modelo("people");
    preencher(wb, 2, { "Nome Social/Fantasia *": "Pessoa Banco Inexistente", "Banco": "999" });
    const antes = await contar("people");
    const r = await enviar(wb, "people");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Banco", mensagem: "Valor não encontrado no cadastro de referência." }]);
    expect(j(r).gravadas).toBe(0);
    expect(await contar("people")).toBe(antes);
    expect((await admin.query("select 1 from erp.people where organization_id=$1 and name='Pessoa Banco Inexistente'", [h.demo.orgId])).rowCount).toBe(0);
    // controle: a MESMA linha com um banco que existe é aceita na prévia — o 422 veio só do 999
    preencher(wb, 2, { "Banco": bancos[0]! });
    const ok = await enviar(wb, "people", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
  });

  it("G2: plano de contas com Código já existente → coluna Código, 'Já existe um registro com este valor.'; o existente fica intacto", async () => {
    const existente = (await admin.query<{ description: string }>("select description from erp.chart_accounts where organization_id=$1 and code='2'", [h.demo.orgId])).rows;
    expect(existente).toEqual([{ description: "PASSIVO" }]);
    const wb = await modelo("chart_accounts");
    preencher(wb, 2, { "Código *": "2", "Descrição *": "Conta Repetida", "Condição *": "Crédito", "Analítica *": "Não" });
    const antes = await contar("chart_accounts");
    const r = await enviar(wb, "chart_accounts");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: "Código", mensagem: "Já existe um registro com este valor." }]);
    expect(await contar("chart_accounts")).toBe(antes);
    expect((await admin.query("select description from erp.chart_accounts where organization_id=$1 and code='2'", [h.demo.orgId])).rows).toEqual([{ description: "PASSIVO" }]);
    // controle: a mesma linha com um código livre é aceita — a recusa foi pela duplicidade
    expect((await admin.query("select 1 from erp.chart_accounts where organization_id=$1 and code='9'", [h.demo.orgId])).rowCount).toBe(0);
    preencher(wb, 2, { "Código *": "9" });
    const ok = await enviar(wb, "chart_accounts", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
  });

  it("G3: Descrição de produto com 121 caracteres → 'Máximo de 120 caracteres' (tradução da tela, nada do zod em inglês); com 120 passa", async () => {
    const longa = "Produto com descrição comprida ".padEnd(121, "x");
    expect(longa.length).toBe(121);
    const wb = await modelo("products");
    preencher(wb, 2, { ...obrigatoriosDoProduto(wb, longa), "Controla estoque": "Não" });
    const antes = await contar("products");
    const r = await enviar(wb, "products");
    expect(r.statusCode, r.body).toBe(422);
    const erros = j(r).erros;
    expect(erros).toEqual([{ linha: 2, coluna: "Descrição", mensagem: "Máximo de 120 caracteres" }]);
    for (const e of erros) expect(e.mensagem).not.toMatch(/Too big|Invalid|expected/);
    expect(await contar("products")).toBe(antes);
    // controle: exatamente no limite (120) a linha é aceita
    preencher(wb, 2, { "Descrição *": longa.slice(0, 120) });
    const ok = await enviar(wb, "products", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
  });

  it("G4: número acima da precisão do banco (Estoque mínimo em numeric(18,4)) → erro de classe 22 com coluna null e a mensagem de limite do banco", async () => {
    // premissa 1: a coluna é mesmo numeric(18,4) — cabem 14 dígitos inteiros
    const tipo = (await admin.query<{ p: number; s: number }>("select numeric_precision p, numeric_scale s from information_schema.columns where table_schema='erp' and table_name='products' and column_name='min_stock'")).rows[0];
    expect(tipo).toEqual({ p: 18, s: 4 });
    // premissa 2: o valor (15 dígitos inteiros) estoura no PostgreSQL com 22003 (numeric_value_out_of_range)
    const grande = 123456789012345;
    await expect(admin.query("select $1::numeric(18,4)", [String(grande)])).rejects.toMatchObject({ code: "22003" });
    const wb = await modelo("products");
    preencher(wb, 2, { ...obrigatoriosDoProduto(wb, "Produto Estoque Enorme"), "Controla estoque": "Não", "Estoque mínimo": grande });
    const antes = await contar("products");
    const r = await enviar(wb, "products");
    expect(r.statusCode, r.body).toBe(422);
    expect(j(r).erros).toEqual([{ linha: 2, coluna: null, mensagem: "Valor fora do limite aceito pelo banco (número grande demais, texto longo demais ou data inválida)." }]);
    expect(await contar("products")).toBe(antes);
    // controle: a mesma linha com um número dentro do limite é aceita
    preencher(wb, 2, { "Estoque mínimo": 1234 });
    const ok = await enviar(wb, "products", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
  });

  it("G5: 100 linhas com o mesmo Código já existente → 422 com os 100 erros (nenhum 500) e a conexão segue saudável", async () => {
    expect((await admin.query("select 1 from erp.chart_accounts where organization_id=$1 and code='3'", [h.demo.orgId])).rowCount).toBe(1);
    const wb = await modelo("chart_accounts");
    for (let i = 0; i < 100; i++) preencher(wb, i + 2, { "Código *": "3", "Descrição *": `Repetida ${i + 1}`, "Condição *": "Ambos", "Analítica *": "Não" });
    const antes = await contar("chart_accounts");
    const r = await enviar(wb, "chart_accounts");
    expect(r.statusCode, r.body.slice(0, 300)).toBe(422);
    const corpo = j(r);
    expect(corpo.linhas).toBe(100);
    expect(corpo.gravadas).toBe(0);
    expect(corpo.erros).toHaveLength(100);
    const esperado = Array.from({ length: 100 }, (_, i) => ({ linha: i + 2, coluna: "Código", mensagem: "Já existe um registro com este valor." }));
    expect([...corpo.erros].sort((a, b) => a.linha - b.linha)).toEqual(esperado);
    expect(await contar("chart_accounts")).toBe(antes);
    // a transação foi desfeita inteira e o pool não ficou com conexão quebrada: uma importação válida em seguida funciona
    const wb2 = await modelo("chart_accounts");
    preencher(wb2, 2, { "Código *": "9", "Descrição *": "Depois das Repetidas", "Condição *": "Ambos", "Analítica *": "Não" });
    const ok = await enviar(wb2, "chart_accounts", true);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(j(ok)).toMatchObject({ linhas: 1, erros: [] });
  });
});

describe("obrigatório condicional (requiredWhen)", () => {
  const TITULO = "Natureza de custo";

  it("G6: modelo de produtos — 'Natureza de custo' laranja FFEF6C00, sem *, nota 'OBRIGATÓRIO quando'; obrigatórias seguem vermelhas FFC62828 com *", async () => {
    const wb = await modelo("products");
    const cab = cabecalho(wb);
    expect(cab).toContain(TITULO);
    expect(cab).not.toContain(`${TITULO} *`);
    expect(corDoCabecalho(wb, TITULO)).toBe("FFEF6C00");
    expect(textoDaNota(dados(wb).getRow(1).getCell(col(wb, TITULO)).note)).toMatch(/^OBRIGATÓRIO quando/);
    // a cor laranja é só da coluna condicional: exatamente uma no modelo de produtos
    expect(cab.filter((t) => corDoCabecalho(wb, t) === "FFEF6C00")).toEqual([TITULO]);
    // as obrigatórias continuam vermelhas e com *, e são exatamente as três do registry (CADASTROS-ESTRUTURA:
    // Categoria e Classe saíram do produto)
    const obrigatorias = cab.filter((t) => t.endsWith(" *"));
    expect(obrigatorias.sort()).toEqual(["1ª Un. Medida *", "Descrição *", "Grupo *"]);
    for (const t of obrigatorias) {
      expect(corDoCabecalho(wb, t), t).toBe("FFC62828");
      expect(textoDaNota(dados(wb).getRow(1).getCell(col(wb, t)).note), t).toMatch(/^OBRIGATÓRIO/);
    }
  });

  it("G7: produto só com as colunas vermelhas (Controla estoque vazio = Sim) → erro na coluna da categoria; com Não → gravado sem categoria; com Sim e categoria → gravado com ela", async () => {
    // 1) só as vermelhas: Controla estoque vazio vale o padrão (Sim) e exige a categoria
    const wb1 = await modelo("products");
    preencher(wb1, 2, obrigatoriosDoProduto(wb1, "Condicional Vazio"));
    const antes = await contar("products");
    const r1 = await enviar(wb1, "products");
    expect(r1.statusCode, r1.body).toBe(422);
    expect(j(r1).erros).toEqual([{ linha: 2, coluna: TITULO, mensagem: "Obrigatório quando “Controla estoque” = Sim." }]);
    expect(await contar("products")).toBe(antes);

    // 2) Controla estoque = Não → aceito e gravado sem categoria
    const wb2 = await modelo("products");
    preencher(wb2, 2, { ...obrigatoriosDoProduto(wb2, "Condicional Nao"), "Controla estoque": "Não" });
    const r2 = await enviar(wb2, "products");
    expect(r2.statusCode, r2.body).toBe(201);
    expect(j(r2)).toMatchObject({ linhas: 1, gravadas: 1, erros: [] });
    expect((await admin.query("select control_stock, financial_category_id from erp.products where organization_id=$1 and description='Condicional Nao'", [h.demo.orgId])).rows)
      .toEqual([{ control_stock: false, financial_category_id: null }]);

    // 3) Controla estoque = Sim com a categoria → aceito e gravado com ela
    const wb3 = await modelo("products");
    const item = listaDe(wb3, TITULO).find((x) => x.startsWith("2.02.001 - "));
    expect(item, "categoria 2.02.001 na lista do modelo").toBeTruthy();
    const categoria = (await admin.query<{ id: string }>("select id from erp.financial_categories where organization_id=$1 and code='2.02.001'", [h.demo.orgId])).rows[0]!.id;
    preencher(wb3, 2, { ...obrigatoriosDoProduto(wb3, "Condicional Sim"), "Controla estoque": "Sim", [TITULO]: item! });
    const r3 = await enviar(wb3, "products");
    expect(r3.statusCode, r3.body).toBe(201);
    expect(j(r3)).toMatchObject({ linhas: 1, gravadas: 1, erros: [] });
    expect((await admin.query("select control_stock, financial_category_id from erp.products where organization_id=$1 and description='Condicional Sim'", [h.demo.orgId])).rows)
      .toEqual([{ control_stock: true, financial_category_id: categoria }]);
    expect(await contar("products")).toBe(antes + 2);
  });
});

describe("árvore: antecessor da mesma planilha", () => {
  it("G8: no modelo dos 5 cadastros em árvore, a lista da coluna do auto-relacionamento é 'warning' e as demais listas são 'stop'", async () => {
    // Lido do arquivo GERADO (validações carregadas pelo ExcelJS a partir do XML), na primeira linha de dados.
    const casos: { key: string; propria: string; demais: string[] }[] = [
      { key: "chart_accounts", propria: "Conta superior", demais: ["Condição *", "Analítica *", "Tipo", "Ativo"] },
      { key: "financial_categories", propria: "Natureza superior", demais: ["Tipo *", "Analítica", "Classificação", "É tributo?", "Ativo"] },
      { key: "cost_centers", propria: "Centro superior", demais: ["Analítica", "Tipo", "Ativo"] },
      { key: "product_groups", propria: "Grupo superior", demais: ["Analítico", "Ativo"] },
      // endereçamento só tem a lista do pai: nenhuma "demais" a conferir aqui (as três acima cobrem o "stop")
      { key: "addressings", propria: "Endereçamento pai", demais: [] },
    ];
    let conferidasStop = 0;
    for (const caso of casos) {
      const wb = await modelo(caso.key);
      const comLista = new Map<string, ExcelJS.DataValidation>();
      for (const t of cabecalho(wb)) {
        const dv: ExcelJS.DataValidation | undefined = dados(wb).getRow(2).getCell(col(wb, t)).dataValidation;
        if (dv?.type === "list") comLista.set(t, dv);
      }
      expect(comLista.get(caso.propria)?.errorStyle, `${caso.key}: ${caso.propria}`).toBe("warning");
      expect([...comLista.keys()], caso.key).toEqual(expect.arrayContaining([caso.propria, ...caso.demais]));
      for (const [t, dv] of comLista) {
        if (t === caso.propria) continue;
        expect(dv.errorStyle, `${caso.key}: ${t}`).toBe("stop");
        conferidasStop += 1;
      }
    }
    expect(conferidasStop).toBeGreaterThanOrEqual(12);
  });
});

describe("ID Global e travas", () => {
  it("G9: a prévia (simular=1) de produtos não reserva ID Global: zero linhas novas em registros_globais e contador igual", async () => {
    // premissa: o contador da organização EXISTE (uma pessoa criada pela API reserva um número), senão
    // "igual antes e depois" seria null === null e não provaria nada
    const p = await criarPessoa("Pessoa Antes da Previa");
    expect(p.statusCode, p.body).toBe(201);
    expect(await idGlobalDe((JSON.parse(p.body) as { id: string }).id)).toMatchObject({ tipo: "people" });
    const contadorAntes = await contador();
    expect(contadorAntes).not.toBeNull();
    const indicesAntes = await contar("registros_globais");
    const produtosAntes = await contar("products");

    const wb = await modelo("products");
    for (const [k, d] of ["Previa Um", "Previa Dois", "Previa Tres"].entries()) preencher(wb, k + 2, { ...obrigatoriosDoProduto(wb, d), "Controla estoque": "Não" });
    const r = await enviar(wb, "products", true);
    expect(r.statusCode, r.body).toBe(200);
    expect(j(r)).toMatchObject({ linhas: 3, gravadas: 0, erros: [], simulacao: true });

    expect(await contar("registros_globais")).toBe(indicesAntes);
    expect(await contador()).toBe(contadorAntes);
    expect(await contar("products")).toBe(produtosAntes);
  });

  it("G10: a importação real dá ID Global a cada produto criado, crescente na ordem das linhas do arquivo", async () => {
    // ordem do arquivo ≠ ordem alfabética, para que ordenar por descrição (ou por uuid) não passe por acaso
    const ordem = ["Numerado Zeta", "Numerado Alfa", "Numerado Meio"];
    const wb = await modelo("products");
    for (const [k, d] of ordem.entries()) preencher(wb, k + 2, { ...obrigatoriosDoProduto(wb, d), "Controla estoque": "Não" });
    const contadorAntes = Number((await contador()) ?? 0);
    const indicesAntes = await contar("registros_globais");
    const r = await enviar(wb, "products");
    expect(r.statusCode, r.body).toBe(201);
    expect(j(r)).toMatchObject({ linhas: 3, gravadas: 3, erros: [] });

    const linhas = (await admin.query<{ description: string; id_global: string | null; tipo: string | null }>(
      `select p.description, g.id_global::text id_global, g.tipo_entidade tipo
         from erp.products p left join erp.registros_globais g on g.organization_id=p.organization_id and g.id_entidade=p.id
        where p.organization_id=$1 and p.description = any($2::text[])`, [h.demo.orgId, ordem])).rows;
    expect(linhas).toHaveLength(3);
    const porDescricao = new Map(linhas.map((l) => [l.description, l]));
    const ids = ordem.map((d) => {
      const l = porDescricao.get(d);
      expect(l?.id_global, `${d} sem ID Global`).not.toBeNull();
      expect(l?.tipo).toBe("products");
      return Number(l!.id_global);
    });
    expect(ids[0]!).toBeLessThan(ids[1]!);
    expect(ids[1]!).toBeLessThan(ids[2]!);
    expect(ids[0]!).toBeGreaterThan(contadorAntes);
    // exatamente os 3 criados foram numerados, e o contador andou 3
    expect(await contar("registros_globais")).toBe(indicesAntes + 3);
    expect(Number(await contador())).toBe(contadorAntes + 3);
  });

  /**
   * G11 — a trava do contador de ID Global.
   *
   * COMO ISTO REPROVA SEM A CORREÇÃO. Antes, o `createOne` de CADA linha chamava `atribuirIdGlobalSeAplicavel`
   * dentro da transação da importação: `erp.proximo_id_global(org)` faz `insert ... on conflict do update` na
   * linha da ORGANIZAÇÃO em `erp.sequencias_id_global`, e essa trava de linha fica presa até o fim da transação
   * (o rollback da prévia, segundos depois). Criar uma pessoa pela API também chama `proximo_id_global` para a
   * mesma organização, então o POST ficava ESPERANDO a prévia acabar. Aqui isso reprova de dois jeitos:
   *   (a) o amostrador de `pg_locks` vê a conexão da prévia segurando trava de escrita (RowExclusiveLock) em
   *       `erp.sequencias_id_global`/`erp.registros_globais` — o que cobre também a corrida da primeira linha,
   *       em que a pessoa pega o contador antes da prévia e é a prévia que espera: nas linhas seguintes a
   *       prévia passa a segurá-lo até o fim, e o amostrador roda durante a prévia inteira;
   *   (b) a pessoa só termina DEPOIS da prévia (`previaRodando` = false no fim da pessoa).
   * Com a correção (ID Global reservado no fim do lote e nunca na prévia), a prévia não toca no contador e
   * a pessoa termina em milissegundos enquanto a prévia ainda grava.
   *
   * DETERMINISMO. A pessoa só é disparada depois de o `pg_locks` mostrar a conexão da prévia com
   * RowExclusiveLock em `erp.products` — isto é, a transação da importação está de fato no laço de gravação
   * (a leitura do XLSX acontece antes e fora da transação). Não há `sleep` para "dar tempo".
   */
  it("G11: enquanto uma prévia grande de produtos grava, criar uma pessoa (que recebe ID Global) termina ANTES da prévia", async () => {
    const N = 1500;
    const wb = await modelo("products");
    const base = obrigatoriosDoProduto(wb, "x");
    for (let i = 0; i < N; i++) preencher(wb, i + 2, { ...base, "Descrição *": `Volume ${String(i + 1).padStart(4, "0")}`, "Controla estoque": "Não" });
    const produtosAntes = await contar("products");
    const contadorAntes = Number((await contador()) ?? 0);
    const indicesAntes = await contar("registros_globais");

    const banco = "(select oid from pg_database where datname = current_database())";
    const pidGravandoProdutos = async () => (await admin.query<{ pid: number }>(
      `select l.pid from pg_locks l join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
        where l.database = ${banco} and n.nspname = 'erp' and c.relname = 'products' and l.mode = 'RowExclusiveLock'
          and l.granted and l.pid <> pg_backend_pid() limit 1`)).rows[0]?.pid ?? null;
    const travasDa = async (pid: number) => (await admin.query<{ tabela: string; modo: string }>(
      `select c.relname tabela, l.mode modo from pg_locks l join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
        where l.database = ${banco} and n.nspname = 'erp' and l.pid = $1`, [pid])).rows;

    const marca: { previaFim: number | null } = { previaFim: null };
    const previa = enviar(wb, "products", true).then((r) => { marca.previaFim = performance.now(); return r; });
    const amostras = { total: 0, gravandoProdutos: 0, comTravaDoIdGlobal: 0 };
    let amostrador: Promise<void> = Promise.resolve();
    try {
      // 1) espera a transação da prévia estar GRAVANDO produtos
      const t0 = performance.now(); let pid: number | null = null;
      while (pid === null && marca.previaFim === null && performance.now() - t0 < 90_000) { pid = await pidGravandoProdutos(); if (pid === null) await espera(5); }
      expect(marca.previaFim, "a prévia terminou antes de ser vista gravando: aumente o volume").toBeNull();
      expect(pid, "a prévia não foi vista gravando em erp.products").not.toBeNull();

      // 2) amostra as travas da conexão da prévia até ela terminar
      const pidPrevia = pid!;
      amostrador = (async () => {
        while (marca.previaFim === null) {
          const t = await travasDa(pidPrevia);
          amostras.total += 1;
          if (t.some((x) => x.tabela === "products" && x.modo === "RowExclusiveLock")) amostras.gravandoProdutos += 1;
          if (t.some((x) => (x.tabela === "sequencias_id_global" || x.tabela === "registros_globais") && x.modo !== "AccessShareLock")) amostras.comTravaDoIdGlobal += 1;
          await espera(10);
        }
      })();

      // 3) só agora a pessoa
      const pessoa = await criarPessoa("Pessoa Durante Previa");
      const pessoaFim = performance.now();
      const previaRodando = marca.previaFim === null;

      const rp = await previa; await amostrador;
      // premissa: a prévia era grande, válida e foi observada gravando
      expect(rp.statusCode, rp.body.slice(0, 300)).toBe(200);
      expect(j(rp)).toMatchObject({ linhas: N, gravadas: 0, erros: [], simulacao: true });
      expect(amostras.total).toBeGreaterThan(0);
      expect(amostras.gravandoProdutos).toBeGreaterThan(0);
      // causa: a prévia nunca segurou o contador de ID Global
      expect(amostras.comTravaDoIdGlobal, "a prévia segurou trava de escrita no ID Global").toBe(0);
      // efeito: a pessoa foi criada, com ID Global, e terminou com a prévia ainda rodando
      expect(pessoa.statusCode, pessoa.body).toBe(201);
      expect(await idGlobalDe((JSON.parse(pessoa.body) as { id: string }).id)).toMatchObject({ tipo: "people" });
      expect(previaRodando, "a pessoa só terminou depois da prévia").toBe(true);
      expect(pessoaFim).toBeLessThan(marca.previaFim!);
      // e a prévia não deixou nada: nem produto, nem índice de produto; o contador andou só o da pessoa
      expect(await contar("products")).toBe(produtosAntes);
      expect(await contar("registros_globais")).toBe(indicesAntes + 1);
      expect(Number(await contador())).toBe(contadorAntes + 1);
    } finally {
      await previa.catch(() => undefined); await amostrador.catch(() => undefined);
    }
  }, 180_000);
});
