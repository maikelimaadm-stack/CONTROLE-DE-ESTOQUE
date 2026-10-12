import { expect, vi } from "vitest";
import pg from "pg";
import type { ConferenciaDaImportacaoNfe, PreenchimentoDoProduto, ProdutosCriadosDaNota, VinculoDoItemDaNota } from "@agro/domain";
import { c, j, erro, unico, type Erro, type Hdr, type Resposta } from "./top-config-08-ajuda.js";
import { cnpjComDv, conferencia, importada, fornecedorComDocumento, notaSintetica, type ItemSintetico, type NotaSintetica, type OpcoesNotaSintetica } from "./f7-ajuda.js";

/**
 * XML-01 (decisão 312) — O CENÁRIO DOS TESTES DE INTEGRAÇÃO DO PRODUTO QUE NASCE DA NOTA (`xml-01-*.test.ts`).
 *
 * Sobre o cenário `c` de `./top-config-08-ajuda.js` (cada arquivo sobe o PRÓPRIO harness com `iniciar()`; `c.ligada` é a
 * instância de produção; `c.admin` é a testemunha sem RLS) e sobre a nota SINTÉTICA de `./f7-ajuda.ts` (CNPJ e chave
 * inventados, DV calculado lá). Este arquivo só acrescenta o que a XML-01 precisa:
 *
 *   · o emitente NOVO por caso (a identidade do parceiro não vaza de um caso para outro) e o código de barras NOVO por
 *     item (o vínculo por código de barras é da ORGANIZAÇÃO inteira: um GTIN repetido entre casos viraria "sugerido");
 *   · as chamadas: `POST /api/compras/importacoes/:id/criar-produtos` e o corpo dele (Grupo analítico do seed e a
 *     Natureza de custo `c.I.category`, a analítica de despesa do seed);
 *   · as TESTEMUNHAS (superusuário): os produtos da organização, o contador do código (`erp.code_sequences`, entidade
 *     `product`), o ID Global (`erp.registros_globais`), a trilha (`erp.audit_logs`) e a importação — a `fotografia`
 *     junta tudo, para que "nada foi criado" seja uma IGUALDADE de antes e depois, nunca uma suposição;
 *   · as UNIDADES: a da organização e a do sistema (`organization_id` nulo), e quais casam com um uCom (a regra da
 *     decisão 312: o símbolo aparado, em maiúsculas, igual ao uCom normalizado — nunca "o mais parecido");
 *   · o ESPIÃO das consultas (o molde do RG-8 / LANC-I4: `pg.Client.prototype.query`), para contar a consulta das
 *     unidades e provar que uma recusa não chegou a mandar um INSERT em `erp.products`.
 */

// ─────────────── identidade do caso ───────────────

let seqEmitente = 0;
/** Um CNPJ de emitente NOVO (base fictícia "7…", DV calculado em `cnpjComDv`). */
export const emitenteNovo = (): string =>
  cnpjComDv(`7${String(Date.now() % 1e8).padStart(8, "0")}${String(++seqEmitente % 1000).padStart(3, "0")}`);

let seqEan = 0;
/** Um código de barras NOVO, de 13 posições (o leitor não confere o DV do GTIN): nenhum produto o tem por acaso. */
export const eanNovo = (): string => `78${String(Date.now() % 1e8).padStart(8, "0")}${String(++seqEan % 1000).padStart(3, "0")}`;

/** NCM de 8 dígitos VIGENTE na carga oficial (a premissa é conferida no banco onde importa). */
export const NCM_VIGENTE = "31052000";

/** Um item da nota: 2 unidades a 10,00 (vProd 20,00), sem GTIN, NCM vigente; a descrição leva o código e um sufixo único. */
export const itemNota = (codigo: string, unidade: string, extra: Partial<ItemSintetico> = {}): ItemSintetico => ({
  codigo, descricao: `Produto XML-01 ${codigo} ${unico()}`, unidade, quantidade: "2.0000", valorUnitario: "10.0000000000", valorProdutos: "20.00",
  ean: "SEM GTIN", ncm: NCM_VIGENTE, ...extra,
});

export interface NotaImportada { id: string; emitente: string; fornecedor: string | null; nota: NotaSintetica }
/**
 * Uma nota NOVA importada (201 exigido) na empresa pedida (padrão: a 1ª do seed — o destinatário do seed é ambíguo de
 * propósito). `fornecedor: false` = o emitente SEM cadastro (parceiro `nenhum`: nenhum vínculo é procurado no fornecedor).
 */
export async function notaImportada(itens: ItemSintetico[], o: { fornecedor?: boolean; empresaId?: string; extra?: OpcoesNotaSintetica } = {}): Promise<NotaImportada> {
  const emitente = emitenteNovo();
  const fornecedor = o.fornecedor === false ? null : await fornecedorComDocumento(emitente);
  const nota = notaSintetica({ ...o.extra, emitenteCnpj: emitente, itens });
  const imp = await importada(nota.xml, { empresaId: o.empresaId ?? c.I.empresa });
  return { id: imp.id, emitente, fornecedor, nota };
}

// ─────────────── a conferência ───────────────

export type Conferencia = ConferenciaDaImportacaoNfe;
/** A conferência lida pela rota (200 exigido). */
export async function conferenciaLida(id: string, o: { fornecedorId?: string; headers?: Hdr } = {}): Promise<Conferencia> {
  const r = await conferencia(id, o);
  expect(r.statusCode, `premissa: a conferência é lida — ${r.body}`).toBe(200);
  return j(r) as unknown as Conferencia;
}
/** O vínculo do item `nItem` na conferência (o item tem de estar nela). */
export function vinculoDo(conf: Conferencia, nItem: number): VinculoDoItemDaNota {
  const v = conf.itens.find((i) => i.nItem === nItem)?.vinculo;
  expect(v, `premissa: o item ${nItem} está na conferência`).toBeDefined();
  return v!;
}
/** O pré-preenchimento do item `nItem` — premissa: o item está SEM vínculo (só o `nenhum` traz o pré-preenchimento). */
export function preenchimentoDo(conf: Conferencia, nItem: number): PreenchimentoDoProduto {
  const v = vinculoDo(conf, nItem);
  expect(v.situacao, `premissa: o item ${nItem} está sem vínculo`).toBe("nenhum");
  return (v as Extract<VinculoDoItemDaNota, { situacao: "nenhum" }>).preenchimento;
}

// ─────────────── a rota do lote ───────────────

export const urlCriarProdutos = (id: string): string => `/api/compras/importacoes/${id}/criar-produtos`;
/** POST /api/compras/importacoes/:id/criar-produtos (pela instância de produção); `chave` é a Idempotency-Key. */
export const criarProdutos = (id: string, corpo: Record<string, unknown>, o: { headers?: Hdr; chave?: string } = {}): Promise<Resposta> =>
  c.ligada.inject({ method: "POST", url: urlCriarProdutos(id), headers: { ...(o.headers ?? c.h.headers()), ...(o.chave ? { "idempotency-key": o.chave } : {}) }, payload: corpo });

/** O que o cenário da XML-01 lê do seed uma vez (depois de `iniciar()`). */
export const x = {} as { grupo: string; grupoSintetico: string; naturezaSintetica: string; adminId: string };
export async function prepararXml01(): Promise<void> {
  const um = async (sql: string, params: unknown[]) => {
    const r = await c.admin.query<{ id: string }>(sql, params);
    expect(r.rows, `premissa: o seed tem ${sql}`).toHaveLength(1);
    return r.rows[0]!.id;
  };
  x.grupo = await um("select id::text as id from erp.product_groups where organization_id=$1 and code='1.01' and kind='analytic' and is_active and deleted_at is null", [c.h.demo.orgId]);
  x.grupoSintetico = await um("select id::text as id from erp.product_groups where organization_id=$1 and code='1' and kind='synthetic' and deleted_at is null", [c.h.demo.orgId]);
  x.naturezaSintetica = await um("select id::text as id from erp.financial_categories where organization_id=$1 and nature='expense' and kind='synthetic' order by code limit 1", [c.h.demo.orgId]);
  x.adminId = await um("select id::text as id from erp.users where email=$1", [c.h.demo.adminEmail]);
}

export type ItemDoCorpo = { n_item: number; armazem_id?: string | null } & Record<string, unknown>;
/** O corpo do lote: o Grupo analítico do seed, a Natureza analítica de despesa do seed e os itens dados. */
export const corpoLote = (itens: ItemDoCorpo[], extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ group_id: x.grupo, financial_category_id: c.I.category, itens, ...extra });

export type Criados = ProdutosCriadosDaNota;
/** O 201 do lote (exigido) e o corpo. */
export async function criados(r: Resposta | Promise<Resposta>): Promise<Criados> {
  const x0 = await r;
  expect(x0.statusCode, `o lote cria — ${x0.body}`).toBe(201);
  return j(x0) as unknown as Criados;
}

/** A recusa: o status, o código e o corpo de erro. */
export function recusa(r: Resposta, status: number, codigo: string): Erro {
  expect(r.statusCode, r.body).toBe(status);
  const e = erro(r);
  expect(e.code, r.body).toBe(codigo);
  return e;
}
/** Um `path` de recusa como texto: o de texto como veio; o de lista (`["itens", 1, "n_item"]`) como `itens[1].n_item`. */
function caminhoEmTexto(p: unknown): string {
  if (!Array.isArray(p)) return String(p);
  return p.reduce<string>((a, s) => (typeof s === "number" ? `${a}[${s}]` : a ? `${a}.${String(s)}` : String(s)), "");
}
/** Os caminhos (`path`) dos detalhes de uma recusa, em texto. */
export const caminhos = (e: Erro): string[] => ((Array.isArray(e.details) ? e.details : []) as { path?: unknown }[]).map((d) => caminhoEmTexto(d.path));

// ─────────────── testemunhas (superusuário, sem RLS) ───────────────

/** O código do produto como o contador o formata (5 posições). */
export const codigoDoContador = (n: number): string => String(n).padStart(5, "0");

/** O contador do código de produto da organização (`last_value`; 0 se ainda não existe). */
export async function contadorDoProduto(): Promise<number> {
  const r = await c.admin.query<{ v: string }>("select last_value::text v from erp.code_sequences where organization_id=$1 and entity='product'", [c.h.demo.orgId]);
  return Number(r.rows[0]?.v ?? 0);
}

export interface Fotografia { produtos: number; contador: number; indicesGlobais: number; trilhaDeProdutos: number; trilhaDoLote: number; idempotencia: number }
/**
 * O que um lote muda, contado: os produtos da organização (vivos e excluídos), o contador do código, os índices do ID
 * Global de produto, a trilha de produtos (qualquer ação), a trilha `criar_produtos` das importações e as chaves de
 * idempotência. "Nada criado" é a mesma fotografia antes e depois.
 */
export async function fotografia(): Promise<Fotografia> {
  const n = async (sql: string) => Number((await c.admin.query<{ n: string }>(sql, [c.h.demo.orgId])).rows[0]!.n);
  return {
    produtos: await n("select count(*)::text n from erp.products where organization_id=$1"),
    contador: await contadorDoProduto(),
    indicesGlobais: await n("select count(*)::text n from erp.registros_globais where organization_id=$1 and tipo_entidade='products'"),
    trilhaDeProdutos: await n("select count(*)::text n from erp.audit_logs where organization_id=$1 and entity='products'"),
    trilhaDoLote: await n("select count(*)::text n from erp.audit_logs where organization_id=$1 and entity='importacoes_nfe_compra' and action='criar_produtos'"),
    idempotencia: await n("select count(*)::text n from erp.idempotency_keys where organization_id=$1"),
  };
}

/** A linha INTEIRA do produto (`to_jsonb`), sem as colunas que o próprio registro torna únicas. */
export async function produtoSemIdentidade(id: string): Promise<Record<string, unknown>> {
  const r = await c.admin.query<{ p: Record<string, unknown> }>(
    "select to_jsonb(p) - 'id' - 'code' - 'created_at' - 'updated_at' - 'created_by' as p from erp.products p where p.id=$1", [id]);
  expect(r.rows, `premissa: o produto ${id} existe`).toHaveLength(1);
  return r.rows[0]!.p;
}
export interface ProdutoNoBanco {
  id: string; code: string; description: string; ncm_code: string | null; barcode: string | null; measurement_id: string; group_id: string;
  financial_category_id: string | null; default_warehouse_id: string | null; control_stock: boolean; controle_lote: string; is_active: boolean; created_by: string | null;
  deleted_at: string | null;
}
/** Os produtos pelos ids, na ordem dos ids. */
export async function produtosNoBanco(ids: string[]): Promise<ProdutoNoBanco[]> {
  const r = await c.admin.query<ProdutoNoBanco>(
    `select id::text, code, description, ncm_code, barcode, measurement_id::text, group_id::text, financial_category_id::text, default_warehouse_id::text,
            control_stock, controle_lote, is_active, created_by::text, deleted_at::text
       from erp.products where id = any($1::uuid[])`, [ids]);
  const porId = new Map(r.rows.map((p) => [p.id, p]));
  return ids.map((id) => { const p = porId.get(id); expect(p, `o produto ${id} está no banco`).toBeDefined(); return p!; });
}
/** Quantos produtos da organização têm esta descrição (o item que NÃO foi confirmado não pode ter virado produto). */
export async function produtosComDescricao(descricao: string): Promise<number> {
  return Number((await c.admin.query<{ n: string }>("select count(*)::text n from erp.products where organization_id=$1 and description=$2", [c.h.demo.orgId, descricao])).rows[0]!.n);
}
/** O ID Global dos produtos (tipo `products`), na ordem dos ids; `null` = sem número. */
export async function idsGlobais(ids: string[]): Promise<(number | null)[]> {
  const r = await c.admin.query<{ id: string; n: string }>(
    "select id_entidade::text id, id_global::text n from erp.registros_globais where organization_id=$1 and tipo_entidade='products' and id_entidade = any($2::uuid[])", [c.h.demo.orgId, ids]);
  const m = new Map(r.rows.map((x0) => [x0.id, Number(x0.n)]));
  return ids.map((id) => m.get(id) ?? null);
}
export interface LinhaDaTrilha { entity: string; entity_id: string; action: string; user_id: string | null; metadata: Record<string, unknown> | null }
/** A trilha de uma entidade (todas as ações), em ordem. */
export async function trilhaDe(entity: string, entityIds: string[]): Promise<LinhaDaTrilha[]> {
  return (await c.admin.query<LinhaDaTrilha>(
    "select entity, entity_id, action, user_id::text, metadata from erp.audit_logs where entity=$1 and entity_id = any($2::text[]) order by id", [entity, entityIds])).rows;
}
/** A situação da importação no banco. */
export async function situacaoDaImportacao(id: string): Promise<string> {
  return (await c.admin.query<{ s: string }>("select situacao s from erp.importacoes_nfe_compra where id=$1", [id])).rows[0]!.s;
}

// ─────────────── unidades ───────────────

/** Uma unidade da ORGANIZAÇÃO, com o símbolo EXATAMENTE como dado (espaço e caixa inclusive). */
export async function unidadeDaOrganizacao(simbolo: string): Promise<string> {
  const r = await c.admin.query<{ id: string; symbol: string }>(
    "insert into erp.measurement_units (organization_id, symbol, name, decimals) values ($1, $2, $3, 2) returning id::text as id, symbol", [c.h.demo.orgId, simbolo, `Unidade XML-01 ${unico()}`]);
  expect(r.rows[0]!.symbol, "premissa: o símbolo foi gravado como pedido").toBe(simbolo);
  return r.rows[0]!.id;
}
/** Uma unidade do SISTEMA (`organization_id` nulo), com o símbolo exatamente como dado. */
export async function unidadeNovaDoSistema(simbolo: string): Promise<string> {
  const r = await c.admin.query<{ id: string; symbol: string }>(
    "insert into erp.measurement_units (organization_id, symbol, name, decimals) values (null, $1, $2, 2) returning id::text as id, symbol", [simbolo, `Unidade do sistema XML-01 ${unico()}`]);
  expect(r.rows[0]!.symbol, "premissa: o símbolo foi gravado como pedido").toBe(simbolo);
  return r.rows[0]!.id;
}
/**
 * As unidades que CASAM com o uCom pela regra da decisão 312 (símbolo aparado e em maiúsculas = uCom aparado e em
 * maiúsculas), separadas em da organização e do sistema — a testemunha das premissas.
 */
export async function unidadesQueCasam(uCom: string): Promise<{ organizacao: string[]; sistema: string[] }> {
  const r = await c.admin.query<{ id: string; organization_id: string | null }>(
    "select id::text as id, organization_id::text from erp.measurement_units where upper(btrim(symbol)) = upper(btrim($1)) and (organization_id is null or organization_id = $2) order by id",
    [uCom, c.h.demo.orgId]);
  return { organizacao: r.rows.filter((u) => u.organization_id !== null).map((u) => u.id), sistema: r.rows.filter((u) => u.organization_id === null).map((u) => u.id) };
}

// ─────────────── locais ───────────────

/** Um local de estoque NOVO na empresa dada (ativo ou não, excluído ou não), com a premissa do que foi gravado. */
export async function localNovo(empresaId: string, o: { ativo?: boolean; excluido?: boolean; orgId?: string } = {}): Promise<string> {
  const r = await c.admin.query<{ id: string; is_active: boolean; excluido: boolean }>(
    `insert into erp.warehouses (organization_id, empresa_id, initials, description, type, is_active, deleted_at)
     values ($1, $2, $3, $4, 'inputs', $5, case when $6 then now() else null end) returning id::text as id, is_active, deleted_at is not null as excluido`,
    [o.orgId ?? c.h.demo.orgId, empresaId, `X${unico()}`.slice(0, 10).toUpperCase(), `Local XML-01 ${unico()}`, o.ativo ?? true, o.excluido ?? false]);
  expect([r.rows[0]!.is_active, r.rows[0]!.excluido], "premissa: o local nasceu como pedido").toEqual([o.ativo ?? true, o.excluido ?? false]);
  return r.rows[0]!.id;
}
export interface LocalNoBanco { id: string; organization_id: string; empresa_id: string; is_active: boolean; excluido: boolean }
export async function localNoBanco(id: string): Promise<LocalNoBanco | null> {
  return (await c.admin.query<LocalNoBanco>(
    "select id::text, organization_id::text, empresa_id::text, is_active, deleted_at is not null as excluido from erp.warehouses where id=$1", [id])).rows[0] ?? null;
}

// ─────────────── outra organização ───────────────

/** Uma organização NOVA com uma empresa (o mesmo CNPJ do seed), gravadas por superusuário: o "outro tenant". */
export async function outraOrganizacao(): Promise<{ orgId: string; empresaId: string }> {
  const orgId = (await c.admin.query<{ id: string }>("insert into erp.organizations(name, slug) values ($1, $2) returning id::text as id",
    [`XML-01 outra ${unico()}`, `xml01-outra-${unico()}`.toLowerCase()])).rows[0]!.id;
  const empresaId = (await c.admin.query<{ id: string }>(
    "insert into erp.empresas(organization_id, code, name, document) values ($1, 1, 'Empresa XML-01 outra', '00000000000191') returning id::text as id", [orgId])).rows[0]!.id;
  return { orgId, empresaId };
}

// ─────────────── consultas ───────────────

/** As consultas SQL que a requisição dispara (o texto de cada uma, em ordem, e os parâmetros) — o espião do RG-8. */
export async function comConsultas<T>(f: () => Promise<T>): Promise<{ r: T; sqls: string[]; params: unknown[][] }> {
  const espiao = vi.spyOn(pg.Client.prototype, "query");
  try {
    const r = await f();
    const chamadas = espiao.mock.calls.map((x0) => {
      const a = x0[0] as unknown;
      const sql = typeof a === "string" ? a : (a as { text?: unknown } | null)?.text;
      const p = Array.isArray(x0[1]) ? (x0[1] as unknown[]) : (a as { values?: unknown } | null)?.values;
      return { sql, params: Array.isArray(p) ? p : [] };
    }).filter((x0): x0 is { sql: string; params: unknown[] } => typeof x0.sql === "string");
    return { r, sqls: chamadas.map((x0) => x0.sql), params: chamadas.map((x0) => x0.params) };
  } finally { espiao.mockRestore(); }
}
/** As consultas que tocam a tabela de unidades. */
export const tocamUnidades = (sqls: string[]): string[] => sqls.filter((s) => /\berp\."?measurement_units"?/.test(s));
/** Os INSERT em `erp.products` (a porta genérica escreve `insert into erp."products" (…)`). */
export const insercoesDeProduto = (sqls: string[]): string[] => sqls.filter((s) => /insert\s+into\s+erp\."?products"?\s*\(/i.test(s));
