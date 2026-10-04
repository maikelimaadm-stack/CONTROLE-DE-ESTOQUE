import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, type Db } from "../src/pool.js";
import { resetSchema, listMigrations, MIGRATIONS_DIR } from "../src/migrate.js";
import { TEST_URL } from "./setup.js";

/**
 * A PURGA FÍSICA (0017) EM BANCO NOVO — PRE-BASE2-05C-1.
 *
 * Um banco recém-criado é o cenário mais fácil de aprovar e o mais fácil de aprovar SEM PROVAR NADA: toda
 * contagem de objeto legado dá zero num schema que nunca teve a ponte de compatibilidade de pé. Por isso
 * este arquivo não começa no fim. Ele sobe 0001..0016 primeiro, MEDE a ponte inteira montada (52 colunas,
 * 5 views, 52 gatilhos, 3 funções, 52 FKs de coluna única, 8 índices, 1 policy legada), e só então aplica a
 * 0017 pelo runner real. Cada zero do "depois" tem um número diferente de zero no "antes" ao lado — é isso
 * que separa "a purga removeu" de "nunca existiu".
 *
 * Toda contagem é comparada com um número ESPERADO EXPLÍCITO. Nenhum `>= 0`, nenhum `toBeGreaterThan`
 * frouxo: um piso aprova a remoção de dezenas de objetos que deveriam ter ficado.
 *
 * O ALVO das FKs compostas é comparado por OID (`erp.empresas`::regclass), nunca pelo texto de
 * `pg_get_constraintdef`: aquele texto qualifica o schema ou não conforme o `search_path` da sessão, então
 * um teste que casa string passa ou falha por causa de uma variável de ambiente, não por causa do schema.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA: que a 0017 preserva ACERVO. Banco zero não tem linha nenhuma, e um
 * `drop column` apaga dado sem reclamar. Essa é a pergunta do `purga-0017-upgrade.test.ts`, que semeia
 * antes e confere linha a linha depois. Os dois arquivos juntos é que cobrem a fatia.
 */
let db: Db;

/** A migration sob teste. Nomeada uma vez: o resto do arquivo se refere a ela por esta constante. */
const ALVO = "0017_purge_farm_legacy.sql";

/** Inventário da ponte com a 0016 aplicada — medido de verdade, não copiado de documento. */
type Inventario = {
  colunasLegadas: number;
  viewsLegadas: number;
  gatilhosEspelho: number;
  funcoesSincronia: number;
  fksLegadas: number;
  indicesLegados: number;
  policiesComColunaLegada: number;
  checkLegado: number;
  checkCanonico: number;
  tabelas: number;
};

let antes: Inventario;
let depois: Inventario;
let aplicadasAte16: string[] = [];
let aplicadasNaPurga: string[] = [];

async function num(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}

/** As mesmas consultas de catálogo que a própria migration usa nas pré e pós-condições. */
async function inventariar(): Promise<Inventario> {
  return {
    colunasLegadas: await num(`select count(*)::text n from pg_attribute a
        join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
         and a.attname in ('farm_id','origin_farm_id','destination_farm_id')`),
    viewsLegadas: await num(`select count(*)::text n from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and c.relkind = 'v'
         and c.relname in ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers')`),
    gatilhosEspelho: await num(`select count(*)::text n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and p.proname like 'sincronizar_empresa%'`),
    funcoesSincronia: await num(`select count(*)::text n from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'erp' and p.proname like 'sincronizar_empresa%'`),
    fksLegadas: await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 1
         and a.attname in ('farm_id','origin_farm_id','destination_farm_id')`),
    indicesLegados: await num(`select count(*)::text n from pg_index i
        join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and exists (select 1 from pg_attribute a
              where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
                and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))`),
    policiesComColunaLegada: await num(`select count(*)::text n from pg_policies
       where schemaname = 'erp'
         and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(farm_id|origin_farm_id|destination_farm_id)'`),
    checkLegado: await num(`select count(*)::text n from pg_constraint
       where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
         and conname = 'equipment_transfers_check'`),
    checkCanonico: await num(`select count(*)::text n from pg_constraint
       where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
         and conname = 'equipment_transfers_empresa_origem_destino_check' and convalidated`),
    tabelas: await num(`select count(*)::text n from information_schema.tables
       where table_schema = 'erp' and table_type = 'BASE TABLE'`),
  };
}

/**
 * Sobe o banco só até a 0016. `MIGRATIONS_DIR` é lido na CARGA do módulo `migrate.js`, então a única forma
 * honesta de apontar o runner para outro diretório é recarregá-lo — mesmo mecanismo de
 * `runner-forward-only.test.ts`. O módulo importado estaticamente no topo deste arquivo continua apontado
 * para `supabase/migrations`, e é ele que aplica a 0017 no passo seguinte.
 */
async function subirAte16(): Promise<string[]> {
  return aplicarSubconjunto((nome) => nome < ALVO, 16, "sem a purga", (m) => expect(m, "e ele NÃO conhece a 0017").not.toContain(ALVO));
}

/**
 * Aplica a 0017 e PARA — mesmo mecanismo, com teto na própria purga.
 *
 * Antes da PRE-BASE2-05C-2 este passo era `migrate(db)` do módulo estático, e funcionava porque a 0017 era
 * a última do diretório. Com a 0018 versionada, aquela chamada passaria a aplicar as DUAS, e este arquivo
 * — que existe para medir a purga — começaria a medir a purga MAIS o que viesse depois. Não é afrouxamento
 * nenhum: o teto é explícito e nomeado, e a contagem continua exata (`toBe`, nunca `>=`). O que muda é que
 * o arquivo volta a medir só o seu assunto, em vez de absorver toda migration futura de carona.
 */
async function subirAte17(): Promise<string[]> {
  return aplicarSubconjunto((nome) => nome <= ALVO, 17, "até a purga, inclusive", (m) => expect(m, "e ele conhece a 0017").toContain(ALVO));
}

async function aplicarSubconjunto(
  incluir: (nome: string) => boolean, quantas: number, rotulo: string,
  conferir: (nomes: string[]) => void,
): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purga-fresh-"));
  const anterior = process.env.MIGRATIONS_DIR;
  try {
    const selecionadas = listMigrations().map((m) => m.name).filter(incluir);
    expect(selecionadas.length, `o diretório real precisa ter ${quantas} migrations ${rotulo}`).toBe(quantas);
    for (const nome of selecionadas) fs.copyFileSync(path.join(MIGRATIONS_DIR, nome), path.join(dir, nome));

    process.env.MIGRATIONS_DIR = dir;
    vi.resetModules();
    const runner = await import("../src/migrate.js");
    expect(runner.MIGRATIONS_DIR, `o módulo recarregado enxerga o diretório ${rotulo}`).toBe(dir);
    conferir(runner.listMigrations().map((m) => m.name));
    return await runner.migrate(db, () => {});
  } finally {
    if (anterior === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = anterior;
    vi.resetModules();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  db = createPool(TEST_URL, { max: 4 });
  await resetSchema(db);

  aplicadasAte16 = await subirAte16();
  antes = await inventariar();

  // Teto na própria purga: o ledger já tem 16 linhas, então só a 0017 fica pendente NESTE recorte.
  aplicadasNaPurga = await subirAte17();
  depois = await inventariar();
}, 300_000);

afterAll(async () => { await db?.end(); });

describe("0017 em banco zero: a sequência inteira aplica e o ledger fecha na purga", () => {
  it("o diretório tem 30 migrations e a purga é a 17ª", () => {
    const noDisco = listMigrations().map((m) => m.name);
    // Números explícitos de propósito: este é o gate da fatia destrutiva, e uma migration nova precisa
    // passar por aqui conscientemente — não entrar de carona num `>= 16`. A 05C-2 passou: acrescentou a
    // 0018, e a afirmação "a purga é a ÚLTIMA" — que era verdadeira e deixou de ser — virou a afirmação
    // que continua verdadeira e é a que este arquivo precisa: a purga ocupa a POSIÇÃO 17. O hotfix da
    // numeração de transferências é a terceira a passar por aqui, e acrescenta a própria linha: o que o
    // arquivo trava é a POSIÇÃO da purga, e ela continua sendo a 17ª. A TOP-CONFIG-01 é a quarta: a 0020
    // cria tabelas novas e não toca em nada que a purga leia, então a posição 17 segue intacta. A
    // TOP-CONFIG-02 é a quinta: a 0021 só ACRESCENTA duas colunas nulas a `erp.sales_documents` e uma chave
    // candidata às versões de TOP — nada que a purga leia, e a posição 17 segue intacta. A TOP-CONFIG-03 é a
    // sexta: a 0022 acrescenta duas colunas à VERSÃO da TOP e cria a tabela do grafo de próximas operações.
    // Nenhuma das duas coisas existe no recorte que a purga lê (o acervo legado de fazenda), e nenhuma
    // altera tabela que a purga toque — a posição 17 segue intacta. A TOP-CONFIG-04A é a sétima: a 0023 só
    // cria um GATILHO em `erp.sales_documents` (guarda da execução configurada), sem coluna, sem dado e sem
    // tocar o recorte que a purga lê — a posição 17 segue intacta. A VENDAS-A1 é a oitava: a 0024 acrescenta
    // duas colunas nulas e um gatilho a `erp.sales_documents` e chaves candidatas de tenant às categorias e
    // centros — nada no recorte que a purga lê, e a posição 17 segue intacta. A CADASTROS-ESTRUTURA é a nona:
    // a 0025 acrescenta colunas de árvore a `erp.product_groups` e solta o NOT NULL de categoria/classe do
    // produto — cadastros de organização, fora do recorte que a purga lê; a posição 17 segue intacta. A CADASTROS
    // FASE 3 é a décima: a 0026 carrega referências GLOBAIS (municípios, bancos, NCM, CBO) e cria caches
    // globais das consultas — nada no recorte que a purga lê; a posição 17 segue intacta. A CADASTROS FASE 4 é
    // a décima primeira: a 0027 acrescenta colunas a `erp.people`, o limite a `erp.client_profiles`, três
    // tabelas de detalhe do parceiro e um índice único de documento — cadastros de organização, fora do
    // recorte que a purga lê; a posição 17 segue intacta. As CADASTROS FASES 5 e 6 são a décima segunda e a décima
    // terceira: a 0028 (RH) e a 0029 (produtos: colunas, grades e gatilhos de lote) — cadastros de organização e um
    // gatilho de INSERT no ledger que não reescreve nada do acervo; a posição 17 segue intacta. A CADASTROS AJUSTES 01
    // é a décima quarta: a 0030 só ACRESCENTA colunas anuláveis (ou com default) a `erp.people` e
    // `erp.parceiro_enderecos`, com checks e a FK composta da matriz — cadastros de organização, fora do recorte
    // que a purga lê; a posição 17 segue intacta. A VENDAS-A4 é a décima quinta: a 0031 cria o cadastro de
    // organização `erp.condicoes_pagamento` e acrescenta duas colunas (anulável / com default) a
    // `erp.sales_documents` — fora do recorte que a purga lê; a posição 17 segue intacta. A VENDAS-A3-1 é a décima
    // sexta: a 0032 cria os cadastros de organização `erp.layouts_documento` e `erp.layout_documento_tops` —
    // tabelas novas, fora do recorte que a purga lê; a posição 17 segue intacta. A TOP-CONFIG-05 é a décima sétima:
    // a 0033 cria `erp.tipos_operacao_versao_condicoes` (tabela nova, vazia) e a função `erp.situacao_atraso_cliente` —
    // fora do recorte que a purga lê; a posição 17 segue intacta. A TOP-CONFIG-06 é a décima oitava: a 0034 acrescenta
    // colunas (arestas "em partes", ligação de item, saldo encerrado) e o gatilho do saldo — fora do recorte da purga.
    // A TOP-CONFIG-07 é a décima nona: a 0035 acrescenta a coluna de reserva à versão da TOP, a conta do reservado
    // (funções), o gatilho de saída em `erp.stock_movements` e índices — nada no recorte que a purga lê.
    // A COMPRAS-01 é a vigésima: a 0036 cria `erp.documentos_compra` e `erp.documentos_compra_itens` (tabelas novas,
    // vazias) e a chave (id, organization_id) de `erp.warehouses` — nada no recorte que a purga lê.
    // A COMPRAS-02 é a vigésima primeira: a 0037 acrescenta colunas (origem da compra, ligação do item, saldo
    // encerrado do pedido) e gatilhos às tabelas de compra da 0036 — nada no recorte que a purga lê.
    // A COMPRAS-03 é a vigésima segunda: a 0038 alarga o CHECK de família de `erp.layouts_documento` (cadastro de
    // organização da 0032) e fixa o search_path das funções de gatilho de compra — nada no recorte que a purga lê.
    // A EDITAR-01 é a vigésima terceira: a 0039 acrescenta a coluna `version` (default constante, sem regravar a
    // tabela) e o gatilho que a soma a `erp.sales_documents` — nada no recorte que a purga lê.
    // A ESTOQUE-01 é a vigésima quarta: a 0040 cria `erp.documentos_estoque` e `erp.documentos_estoque_itens`
    // (tabelas novas, vazias) — nada no recorte que a purga lê.
    // A TOP-CONFIG-08 é a vigésima quinta: a 0041 cria `erp.aprovacoes_venda`, `erp.aprovacoes_compra` e
    // `erp.aprovacoes_estoque` (tabelas novas, vazias), a função `erp.top_exige_aprovacao` e as guardas de aprovação
    // dos três documentos — nada no recorte que a purga lê.
    // A OPERACOES-01 F8 é a vigésima sexta: a 0042 acrescenta colunas anuláveis ao financeiro (contas, títulos,
    // baixas, movimentos, naturezas), cria `erp.financeiro_naturezas_padrao` (tabela nova, vazia), dois gatilhos, a
    // função do extrato, troca a soma de `erp.refresh_title_status` e tira DELETE do ledger — nada no recorte que a
    // purga lê.
    // A OPERACOES-01 F5a é a vigésima sétima: a 0043 acrescenta colunas anuláveis ao documento de estoque e ao razão,
    // chaves (id, organization_id) em cadastros, refaz CHECKs que só aceitam mais e substitui funções de gatilho e da
    // reserva — nada no recorte que a purga lê.
    // A OPERACOES-01 F6a é a vigésima oitava: a 0044 acrescenta colunas (finalização e aprovação para orçamento do
    // pedido, o vínculo do orçamento de compra) e troca gatilhos de `erp.documentos_compra`, de
    // `erp.documentos_compra_itens` e de `erp.aprovacoes_compra` — nada no recorte que a purga lê.
    // A OPERACOES-01 F9 é a vigésima nona: a 0045 cria `erp.imoveis_rurais` e `erp.tipos_operacao_versao_financeiro`
    // (tabelas novas, vazias), acrescenta colunas anuláveis ao financeiro (títulos, baixas, movimentos, naturezas), alarga
    // o CHECK de situação do título com 'previsto' e acrescenta a guarda do previsto — nada no recorte que a purga lê.
    // A OPERACOES-01 F10 é a trigésima: a 0046 acrescenta a TOP (colunas anuláveis) aos seis registros de módulo, a
    // observação da manutenção e troca a política de `erp.maintenance_items` — nada no recorte que a purga lê.
    // A OPERACOES-01 F7 é a trigésima primeira: a 0047 cria as tabelas da entrada de nota por XML, acrescenta colunas
    // anuláveis à compra e as guardas da chave de acesso — nada no recorte que a purga lê.
    // A OPERACOES-01 F12 é a trigésima segunda: a 0048 fixa o search_path de `erp.audit_row` — nada no recorte que a purga lê.
    // A MAPA-01 (#91, já na main e em produção) é a 0049: cria `erp.mapa_areas` (tabela nova) e o módulo `mapa` — nada
    // no recorte que a purga lê. No disco ela vem depois da 0047 (ordem por nome); em produção foi aplicada ANTES das
    // 0042–0047 (a prova da ordem real está em operacoes-01-ordem-real.test.ts).
    // A CADASTRO-AREAS-01 (0050) cria `erp.retiros` e colunas em `areas`; a CADASTRO-AREAS-02 (0051) unifica
    // `geometria` em `erp.areas`; a SAT-01 (0052) cria `erp.analises_satelitais`; a SAT-02 (0053) cria a fila, o
    // consumo e o orçamento satelitais e colunas anuláveis em `erp.analises_satelitais`; a SAT-03 (0054) dá ao executor da
    // fila a reserva e a contagem do limite (só tabelas satelitais); a SAT-06 (0055) cria o arquivo e o metadado do raster
    // satelital (só tabelas satelitais novas) — nada no recorte que a purga lê.
    expect(noDisco.length, "55 migrations no repositório").toBe(55);
    expect(noDisco[16], "a purga é a 17ª da ordem").toBe(ALVO);
    expect(noDisco[17], "e a 18ª é o cutover do contador (PRE-BASE2-05C-2)").toBe("0018_empresa_code_sequence.sql");
    expect(noDisco[18], "e a 19ª é o hotfix da numeração de transferências").toBe("0019_warehouse_transfer_code_sequence.sql");
    expect(noDisco[19], "e a 20ª é o cadastro de TOP configurada (TOP-CONFIG-01)").toBe("0020_tipos_operacao.sql");
    expect(noDisco[20], "e a 21ª é o snapshot da TOP no documento de venda (TOP-CONFIG-02)").toBe("0021_sales_document_tipo_operacao.sql");
    expect(noDisco[21], "e a 22ª é a configuração versionada da TOP (TOP-CONFIG-03)").toBe("0022_tipo_operacao_configuracao_versionada.sql");
    expect(noDisco[22], "e a 23ª é a guarda da execução configurada da venda (TOP-CONFIG-04A)").toBe("0023_venda_execucao_configurada_guarda.sql");
    expect(noDisco[23], "e a 24ª é a classificação financeira do documento de venda (VENDAS-A1)").toBe("0024_venda_classificacao_financeira.sql");
    expect(noDisco[24], "e a 25ª é o Grupo de Produtos em árvore (CADASTROS-ESTRUTURA)").toBe("0025_grupo_de_produtos_arvore.sql");
    expect(noDisco[25], "e a 26ª são as referências oficiais (CADASTROS Fase 3)").toBe("0026_referencias_oficiais.sql");
    expect(noDisco[26], "e a 27ª é a ficha de Parceiros (CADASTROS Fase 4)").toBe("0027_parceiros_ficha_em_abas.sql");
    expect(noDisco[27], "e a 28ª é a ficha de RH / funcionários (CADASTROS Fase 5)").toBe("0028_rh_funcionarios.sql");
    expect(noDisco[28], "e a 29ª é a ficha de Produtos (CADASTROS Fase 6)").toBe("0029_produtos_ficha_em_abas.sql");
    expect(noDisco[29], "e a 30ª são os ajustes do Parceiro (CADASTROS AJUSTES 01)").toBe("0030_cadastros_ajustes_01.sql");
    expect(noDisco[30], "e a 31ª é a condição de pagamento (VENDAS-A4)").toBe("0031_vendas_condicao_pagamento.sql");
    expect(noDisco[31], "e a 32ª é o layout do documento por TOP (VENDAS-A3-1)").toBe("0032_layout_documento.sql");
    expect(noDisco[32], "e a 33ª são as restrições da TOP no formato 3 (TOP-CONFIG-05)").toBe("0033_tipo_operacao_restricoes.sql");
    expect(noDisco[33], "e a 34ª é faturar em partes (TOP-CONFIG-06)").toBe("0034_faturar_em_partes.sql");
    expect(noDisco[34], "e a 35ª é a reserva de estoque pelo pedido (TOP-CONFIG-07)").toBe("0035_reserva_de_estoque.sql");
    expect(noDisco[35], "e a 36ª é o documento de compra (COMPRAS-01)").toBe("0036_documento_de_compra.sql");
    expect(noDisco[36], "e a 37ª é receber o pedido de compra (COMPRAS-02)").toBe("0037_receber_pedido_de_compra.sql");
    expect(noDisco[37], "e a 38ª é o layout do documento de compra (COMPRAS-03)").toBe("0038_layout_do_documento_de_compra.sql");
    expect(noDisco[38], "e a 39ª é a versão do documento de venda (EDITAR-01)").toBe("0039_versao_do_documento_de_venda.sql");
    expect(noDisco[39], "e a 40ª é o documento de estoque (ESTOQUE-01)").toBe("0040_documento_de_estoque.sql");
    expect(noDisco[40], "e a 41ª são as regras gerais e a aprovação da TOP (TOP-CONFIG-08)").toBe("0041_regras_gerais_e_aprovacao_da_top.sql");
    expect(noDisco[41], "e a 42ª é a Central Financeira (OPERACOES-01 F8)").toBe("0042_central_financeira.sql");
    expect(noDisco[42], "e a 43ª é a movimentação interna no documento de estoque (OPERACOES-01 F5a)").toBe("0043_movimentacao_interna_estoque.sql");
    expect(noDisco[43], "e a 44ª é o pedido de compra finalizado e o orçamento de compra (OPERACOES-01 F6a)").toBe("0044_pedido_finalizado_e_orcamento_de_compra.sql");
    expect(noDisco[44], "e a 45ª é o financeiro pela TOP e o LCDPR (OPERACOES-01 F9)").toBe("0045_financeiro_pela_top_e_lcdpr.sql");
    expect(noDisco[45], "e a 46ª são os módulos com TOP (OPERACOES-01 F10)").toBe("0046_modulos_com_top.sql");
    expect(noDisco[46], "e a 47ª é a entrada de nota por XML (OPERACOES-01 F7)").toBe("0047_entrada_de_nota_por_xml.sql");
    expect(noDisco[47], "e a 48ª é o caminho fixo da auditoria (OPERACOES-01 F12)").toBe("0048_search_path_da_auditoria.sql");
    expect(noDisco[48], "e a 49ª é o Mapa de Manejo (MAPA-01, #91)").toBe("0049_mapa_de_manejo.sql");
  });

  it("as 16 anteriores aplicam, e a 0017 aplica sozinha em seguida", () => {
    expect(aplicadasAte16.length, "0001..0016 aplicadas em banco zero").toBe(16);
    expect(aplicadasAte16[15]).toBe("0016_global_id_activation.sql");
    expect(aplicadasNaPurga, "só a purga estava pendente, e ela aplicou").toEqual([ALVO]);
  });

  it("o ledger tem 17 entradas e cobre exatamente o diretório", async () => {
    const ledger = (await db.query<{ name: string }>(
      "select name from public.erp_migrations order by name")).rows.map((r) => r.name);
    expect(ledger.length, "17 linhas no ledger").toBe(17);
    expect(ledger[16], "a última entrada é a purga").toBe(ALVO);
    // O recorte é explícito: este arquivo mede a purga, e o ledger dele fecha NELA. As migrations
    // posteriores existem no diretório e são medidas pelas suítes das próprias fatias.
    expect(ledger, "ledger idêntico ao diretório ATÉ a purga")
      .toEqual(listMigrations().map((m) => m.name).filter((nome) => nome <= ALVO));
  });
});

describe("a premissa: com a 0016 aplicada a ponte legada estava INTEIRA", () => {
  // Sem este bloco, todo o bloco seguinte passaria num banco que nunca teve ponte nenhuma.
  it("52 colunas legadas, 5 views, 52 gatilhos, 3 funções, 52 FKs, 8 índices, 1 policy, 1 CHECK", () => {
    expect(antes.colunasLegadas, "farm_id 47 + destination_farm_id 3 + origin_farm_id 2").toBe(52);
    expect(antes.viewsLegadas).toBe(5);
    expect(antes.gatilhosEspelho).toBe(52);
    expect(antes.funcoesSincronia).toBe(3);
    expect(antes.fksLegadas).toBe(52);
    expect(antes.indicesLegados).toBe(8);
    expect(antes.policiesComColunaLegada, "erp.empresa_cost_centers.api_child").toBe(1);
    expect(antes.checkLegado, "equipment_transfers_check sobre as colunas legadas").toBe(1);
    expect(antes.checkCanonico, "o CHECK canônico ainda NÃO existia antes da purga").toBe(0);
  });
});

describe("depois da 0017: zero ponte legada", () => {
  it("nenhuma coluna legada em nenhuma tabela do schema erp", () => {
    expect(depois.colunasLegadas).toBe(0);
  });

  it("nenhuma das 5 views de nome antigo", async () => {
    expect(depois.viewsLegadas).toBe(0);
    const sobreviventes = (await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'erp' and c.relname in
              ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers')`)).rows;
    expect(sobreviventes.map((r) => r.relname), "nem como tabela, nem com outro relkind").toEqual([]);
  });

  it("nenhum gatilho de espelho e nenhuma função de sincronia", () => {
    expect(depois.gatilhosEspelho).toBe(0);
    expect(depois.funcoesSincronia).toBe(0);
  });

  it("nenhuma FK legada de coluna única e nenhum índice legado", () => {
    expect(depois.fksLegadas).toBe(0);
    expect(depois.indicesLegados).toBe(0);
  });

  it("nenhuma policy do schema decide mais por coluna legada", () => {
    expect(depois.policiesComColunaLegada).toBe(0);
  });
});

describe("o que a purga tinha de PRESERVAR", () => {
  it("as 50 FKs compostas canônicas continuam de pé e VALIDADAS", async () => {
    // O alvo é comparado por OID: `confrelid = 'erp.empresas'::regclass`. Casar o texto de
    // pg_get_constraintdef ('REFERENCES empresas' vs 'REFERENCES erp.empresas') dependeria do search_path.
    const total = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and k.convalidated`);
    expect(total, "45 empresa_id + 2 empresa_origem_id + 3 empresa_destino_id").toBe(50);

    const naoValidadas = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and not k.convalidated`);
    expect(naoValidadas, "NOT VALID aceitaria linha nova fora de escopo").toBe(0);
  });

  it("e cada uma delas prova TENANT: a primeira coluna é organization_id", async () => {
    const porColuna = (await db.query<{ attname: string; n: string }>(
      `select a.attname, count(*)::text n from pg_constraint k
         join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[2]
        where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
          and k.confrelid = 'erp.empresas'::regclass
        group by a.attname order by a.attname`)).rows;
    expect(porColuna.map((r) => [r.attname, Number(r.n)])).toEqual([
      ["empresa_destino_id", 3], ["empresa_id", 45], ["empresa_origem_id", 2],
    ]);

    const semTenant = await num(`select count(*)::text n from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
         and k.confrelid = 'erp.empresas'::regclass and a.attname <> 'organization_id'`);
    expect(semTenant, "coluna única não prova tenant — a composta começa em organization_id").toBe(0);
  });

  it("o CHECK canônico de erp.equipment_transfers existe, está validado, e o legado saiu", async () => {
    expect(depois.checkCanonico).toBe(1);
    expect(depois.checkLegado).toBe(0);
    const def = (await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) def from pg_constraint
        where conrelid = 'erp.equipment_transfers'::regclass
          and conname = 'equipment_transfers_empresa_origem_destino_check'`)).rows[0]!.def;
    expect(def, "a invariante é sobre as colunas canônicas").toContain("empresa_origem_id");
    expect(def).toContain("empresa_destino_id");
    expect(def, "e não sobre as legadas").not.toContain("farm_id");
  });

  it("erp.empresa_cost_centers tem UMA policy api_child, canônica", async () => {
    const policies = (await db.query<{ policyname: string; cmd: string; permissive: string; qual: string; with_check: string | null }>(
      `select policyname, cmd, permissive, qual, with_check from pg_policies
        where schemaname = 'erp' and tablename = 'empresa_cost_centers' order by policyname`)).rows;
    // UMA só: duas PERMISSIVE no mesmo comando combinariam com OR e a mais frouxa acabaria valendo.
    expect(policies.length, "uma única policy na tabela").toBe(1);
    const p = policies[0]!;
    expect(p.policyname).toBe("api_child");
    expect(p.cmd).toBe("ALL");
    expect(p.qual, "leitura decide por empresa_id").toContain("empresa_cost_centers.empresa_id");
    expect(p.qual).not.toContain("farm_id");
    expect(p.with_check, "escrita faz a MESMA pergunta — sem with_check, INSERT passaria livre").toBeTruthy();
    expect(p.with_check!).toContain("empresa_cost_centers.empresa_id");
    expect(p.with_check!).not.toContain("farm_id");
  });

  it("erp.v_bank_account_balances sobreviveu — a purga não levou view inocente junto", async () => {
    const r = (await db.query<{ relkind: string }>(
      `select c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'erp' and c.relname = 'v_bank_account_balances'`)).rows;
    expect(r.length, "a view existe").toBe(1);
    expect(r[0]!.relkind).toBe("v");
    // Existir no catálogo não é o bastante: uma view pode ficar de pé e quebrada. Consultar prova que a
    // definição dela continua resolvendo contra o schema pós-purga.
    expect(await num("select count(*)::text n from erp.v_bank_account_balances"), "banco zero: 0 linhas, mas a consulta RESOLVE").toBe(0);
  });

  it("o contador de transição não foi tocado: erp.code_sequences e erp.next_code continuam", async () => {
    const r = (await db.query<{ tabela: string | null; funcao: string | null; col: string }>(
      `select to_regclass('erp.code_sequences')::text tabela,
              to_regprocedure('erp.next_code(uuid,text)')::text funcao,
              (select count(*)::text from pg_attribute a
                 where a.attrelid = 'erp.code_sequences'::regclass and a.attname = 'entity'
                   and a.attnum > 0 and not a.attisdropped) col`)).rows[0]!;
    expect(r.tabela).toBe("erp.code_sequences");
    expect(r.funcao, "a função do contador continua com a mesma assinatura").toBe("erp.next_code(uuid,text)");
    expect(Number(r.col), "a coluna que guarda entity='farm' continua lá").toBe(1);
  });

  it("nenhuma tabela do schema erp caiu", () => {
    expect(antes.tabelas, "premissa: o schema subiu inteiro antes da purga").toBe(181);
    expect(depois.tabelas, "igualdade exata — um piso toleraria a queda de dezenas").toBe(antes.tabelas);
  });
});
