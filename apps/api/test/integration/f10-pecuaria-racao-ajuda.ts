import { expect } from "vitest";
import { CHAVES_MODULO_EMPRESA, familiaDoModuloComTop, type ConfiguracaoTipoOperacaoV5, type ModuloComTop } from "@agro/domain";
import { c, j, top, unico, type Hdr, type Resposta } from "./estoque-01-ajuda.js";
import { cfg5 } from "./f5a-ajuda.js";

export {
  c, iniciar, encerrar, top, produto, armazem, saldoInicial, saldo, membro, j, unico, DATA,
  type Hdr, type Resposta, type Erro,
} from "./estoque-01-ajuda.js";
export { cfg5, loteAnimaisNovo, equipamentoNovo } from "./f5a-ajuda.js";

/**
 * OPERACOES-01 F10 (decisão 287) — O CENÁRIO DOS TESTES DE API DO MANEJO, DA BATELADA, DA PRODUÇÃO DE RAÇÃO E DA
 * TRANSFERÊNCIA DE REBANHO ENTRE EMPRESAS (`f10-pecuaria-racao.test.ts`).
 *
 * Em cima do cenário do ESTOQUE-01 (`estoque-01-ajuda.ts`: o harness com banco próprio, a instância `ligada` por onde as
 * TOPs dos formatos 3 a 5 nascem, os ids do seed já conferidos, os produtos e locais de estoque novos por caso, o saldo
 * inicial pela API e as pessoas), este arquivo acrescenta o que os módulos da pecuária e da ração precisam:
 *   · a TOP de cada módulo na família que o REGISTRY declara (`familiaDoModuloComTop`) — nenhum código de família
 *     escrito aqui; um módulo sem família no registry para o caso na premissa;
 *   · o acervo de rebanho (animais e rebanho de contagem por SQL, num lote de animais da empresa pedida) e a OUTRA
 *     organização (empresa, lote, equipamento e dieta válidos LÁ), para as recusas de referência;
 *   · as testemunhas no banco, por conexão própria de superusuário (sem RLS): o contador do código (a recusa não
 *     queima número), os movimentos do razão pela origem, as linhas dos registros e a auditoria.
 * O estado é do módulo (o vitest isola os módulos por arquivo), preenchido por `iniciar()` no `beforeAll`.
 */

/** A família do módulo, perguntada ao registry. Sem família, o módulo não tem TOP: o caso para aqui. */
export function familiaDo(modulo: ModuloComTop): string {
  const f = familiaDoModuloComTop(modulo);
  expect(f, `premissa: o registry declara a família do módulo ${modulo}`).toEqual(expect.any(String));
  return f!;
}

/**
 * Uma TOP do módulo pela porta administrativa: no FORMATO 5 (o neutro do domínio, com o ajuste do caso) por padrão, ou
 * no formato de criação da porta (`formato1: true`, sem configuração). `padrao` a marca como a padrão da família.
 */
export function topDoModulo(modulo: ModuloComTop, opcoes: { ajuste?: (x: ConfiguracaoTipoOperacaoV5) => void; formato1?: boolean; padrao?: boolean } = {}): Promise<string> {
  return top(familiaDo(modulo), {
    ...(opcoes.formato1 ? {} : { configuracao: cfg5(opcoes.ajuste) }),
    ...(opcoes.padrao ? { padrao: true } : {}),
  });
}

/** A versão CORRENTE da TOP (a que o servidor congela no lançamento). */
export async function versaoCorrente(topId: string): Promise<{ id: string; nome: string; versao: number }> {
  const r = await c.admin.query<{ id: string; nome: string; versao: number }>(
    `select v.id, v.nome, v.versao from erp.tipos_operacao t
       join erp.tipos_operacao_versoes v on v.tipo_operacao_id = t.id and v.organization_id = t.organization_id and v.versao = t.versao_atual
      where t.id = $1`, [topId]);
  expect(r.rowCount, "premissa: a TOP tem a versão corrente").toBe(1);
  return r.rows[0]!;
}

// ─────────────── a porta HTTP ───────────────

export const post = (url: string, payload: Record<string, unknown>, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "POST", url, headers, payload }) as unknown as Promise<Resposta>;
export const get = (url: string, headers: Hdr = c.h.headers()): Promise<Resposta> =>
  c.h.app.inject({ method: "GET", url, headers }) as unknown as Promise<Resposta>;

/** As chaves do objeto, em ordem: a prova de que a resposta tem EXATAMENTE as chaves do contrato. */
export const chaves = (o: unknown): string[] => Object.keys(o as Record<string, unknown>).sort();

/** O 201 com o id. */
export function criado(r: Resposta, oque: string): string {
  expect(r.statusCode, `premissa: ${oque} é gravado — ${r.body}`).toBe(201);
  return (j(r) as { id: string }).id;
}

/** O 422 de exigência da TOP: os caminhos e as mensagens de `details.exigencias`. */
export function exigencias(r: Resposta): { caminho: string; mensagem: string }[] {
  const d = j(r).error?.details as { exigencias?: { caminho: string; mensagem: string }[] } | undefined;
  return d?.exigencias ?? [];
}
/** Os `[path, message]` de um 422 de campo. */
export function detalhes(r: Resposta): [string, string][] {
  const d = j(r).error?.details;
  return Array.isArray(d) ? (d as { path: string; message: string }[]).map((x) => [x.path, x.message]) : [];
}

// ─────────────── pessoas e escopo ───────────────

/** Todos os módulos com todas as empresas — menos a pecuária, só com as empresas dadas. */
export const escoposComPecuaria = (empresas: string[]) =>
  CHAVES_MODULO_EMPRESA.map((modulo) => modulo === "pecuaria"
    ? { modulo, modo: "selecionadas" as const, empresas: [...empresas] }
    : { modulo, modo: "todas" as const, empresas: [] });

// ─────────────── acervo (por SQL, superusuário) ───────────────

const inserir = async (sql: string, params: unknown[]): Promise<string> => (await c.admin.query<{ id: string }>(sql, params)).rows[0]!.id;

/** A espécie e a categoria dos animais do acervo (do seed de referência). */
async function especieECategoria(): Promise<{ especie: string; categoria: string }> {
  const categoria = (await c.admin.query<{ id: string }>("select id from erp.animal_categories where name='Garrote' limit 1")).rows[0]?.id;
  const especie = (await c.admin.query<{ id: string }>("select id from erp.animal_species where organization_id is null order by name limit 1")).rows[0]?.id;
  expect(categoria, "premissa: o seed tem a categoria Garrote").toEqual(expect.any(String));
  expect(especie, "premissa: o seed tem a espécie").toEqual(expect.any(String));
  return { especie: especie!, categoria: categoria! };
}

/** Um animal ATIVO no lote, na empresa pedida (1ª por padrão), da organização pedida (a do harness por padrão). */
export async function animalNovo(lote: string | null, o: { empresa?: string; org?: string } = {}): Promise<string> {
  const { especie, categoria } = await especieECategoria();
  return inserir("insert into erp.animals(organization_id,empresa_id,category_id,species_id,batch_id,sex,status,entry_date) values ($1,$2,$3,$4,$5,'M','active','2026-01-10') returning id",
    [o.org ?? c.h.demo.orgId, o.empresa ?? c.I.empresa, categoria, especie, lote]);
}

/** Um rebanho de CONTAGEM (sem identificação) com `cabecas` cabeças no lote, na 1ª empresa. */
export async function rebanhoNovo(lote: string, cabecas: number): Promise<string> {
  const { especie, categoria } = await especieECategoria();
  return inserir("insert into erp.herd_lots(organization_id,empresa_id,batch_id,species_id,category_id,quantity,entry_date) values ($1,$2,$3,$4,$5,$6,'2026-01-10') returning id",
    [c.h.demo.orgId, c.I.empresa, lote, especie, categoria, cabecas]);
}

/** Um lote de animais ativo na empresa e na organização pedidas. */
export const loteEm = (org: string, empresa: string) => inserir(
  "insert into erp.batches(organization_id,empresa_id,code,batch_date,description,status) values ($1,$2,$3,'2026-01-10',$4,'active') returning id",
  [org, empresa, `F10L${unico()}`, `Lote F10 ${unico()}`]);

/** A OUTRA organização, com uma empresa sua: tudo o que nasce nela é perfeitamente válido LÁ. */
export async function outraOrganizacao(): Promise<{ org: string; empresa: string }> {
  const marca = unico();
  const org = await inserir("insert into erp.organizations(name,slug) values ($1,$2) returning id", [`[TEST] F10 outra ${marca}`, `f10-outra-${marca}`]);
  const empresa = await inserir("insert into erp.empresas(organization_id,code,name) values ($1,91,$2) returning id", [org, `Empresa F10 ${marca}`]);
  return { org, empresa };
}

/** Um equipamento ativo na empresa e na organização pedidas. */
export const equipamentoEm = (org: string, empresa: string) => inserir(
  "insert into erp.equipments(organization_id,empresa_id,code,description,status) values ($1,$2,$3,$4,'active') returning id",
  [org, empresa, `F10E${unico()}`, `Vagão F10 ${unico()}`]);

/** Uma dieta da organização pedida com os ingredientes dados (`diet_items` não tem porta de API: o cenário vai por SQL). */
export async function dietaEm(org: string, ingredientes: { produto: string; percentual: string }[]): Promise<string> {
  const dieta = await inserir("insert into erp.diets(organization_id,code,name) values ($1,$2,$3) returning id", [org, `F10D${unico()}`, `Dieta F10 ${unico()}`]);
  for (const i of ingredientes) await c.admin.query("insert into erp.diet_items(diet_id,product_id,percentage) values ($1,$2,$3)", [dieta, i.produto, i.percentual]);
  return dieta;
}

// ─────────────── testemunhas (superusuário, sem RLS) ───────────────

/** O último valor do contador de código da entidade na organização ("0" se ele nunca foi usado). */
export async function contador(entidade: string): Promise<string> {
  return (await c.admin.query<{ v: string }>(
    "select coalesce((select last_value from erp.code_sequences where organization_id=$1 and entity=$2), 0)::text v", [c.h.demo.orgId, entidade])).rows[0]!.v;
}
/** Um `count(*)` como número. */
export async function contar(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await c.admin.query<{ n: string }>(sql, params)).rows[0]!.n);
}
/** Quantos movimentos do razão o produto tem (qualquer origem): a recusa não move estoque. */
export const movimentosDoProduto = (produto: string) => contar("select count(*)::text n from erp.stock_movements where product_id=$1", [produto]);

export interface MovimentoDaOrigem {
  movement_type: string; direction: number; product_id: string; warehouse_id: string; quantity: string; unit_cost: string; total_cost: string;
  lote_animais_id: string | null; equipamento_id: string | null;
}
/** Os movimentos de uma origem do razão (`source_type`, `source_id`), na ordem do produto e da direção. */
export async function movimentosDaOrigem(sourceType: string, sourceId: string): Promise<MovimentoDaOrigem[]> {
  return (await c.admin.query<MovimentoDaOrigem>(
    `select movement_type, direction, product_id, warehouse_id, quantity::text, unit_cost::text, total_cost::text, lote_animais_id, equipamento_id
       from erp.stock_movements where source_type=$1 and source_id=$2 order by direction, product_id, id`, [sourceType, sourceId])).rows;
}

/** A TOP gravada num registro do módulo (as duas colunas novas). */
export async function topGravada(tabela: "animal_handlings" | "diet_batches" | "feed_batches", id: string): Promise<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null }> {
  return (await c.admin.query<{ tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null }>(
    `select tipo_operacao_id, tipo_operacao_versao_id from erp.${tabela} where id=$1`, [id])).rows[0]!;
}

/** As auditorias do registro (ação e metadados). */
export async function auditorias(entidade: string, id: string): Promise<{ action: string; metadata: unknown }[]> {
  return (await c.admin.query<{ action: string; metadata: unknown }>(
    "select action, metadata from erp.audit_logs where entity=$1 and entity_id=$2 order by created_at", [entidade, id])).rows;
}
