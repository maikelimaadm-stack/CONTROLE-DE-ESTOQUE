/**
 * Regras do PRODUTO (erp.products) — CADASTROS Fase 6, ficha em abas (mecanismo genérico da decisão 253).
 * Chamadas pelo `createOne`/`updateOne` genérico ANTES de qualquer gravação, dentro da mesma transação. O banco
 * (0029) repete o que é invariante (gatilhos): aqui o erro sai antes, apontando a ABA e a LINHA.
 *
 *  · `has_lot` (web anterior) vira o CONTROLE: true → "lote" (ou mantém "lote_validade"), false → "nenhum";
 *  · mudar o controle com saldo ≠ 0 (na ORGANIZAÇÃO inteira) → 422 "zere o saldo em todos os armazéns" — transferir
 *    não resolve: o saldo continua na organização;
 *  · CEST com 7 dígitos (gravado só dígitos);
 *  · Unidades e embalagens: não repete a unidade padrão, sem unidade repetida, fator > 0, compra e/ou venda;
 *  · Compras: fornecedor só parceiro VIVO desta organização com tipo Fornecedor; no máximo um preferencial.
 */
import { getResource, type ResourceDef } from "@agro/domain";
import { validation } from "./errors.js";
import { ident } from "./sql.js";
import { chavesOcultas, detalheDoErro } from "./ficha-em-abas.js";
import type { ServiceCtx } from "./context.js";

type Linha = Record<string, unknown>;
export const MSG_CONTROLE_COM_SALDO = "O produto tem saldo em estoque: zere o saldo em todos os armazéns antes de mudar o controle de lote.";
export const MSG_CEST = "CEST tem 7 dígitos.";
export const MSG_UNIDADE_PADRAO = "A unidade alternativa não pode repetir a unidade padrão do produto.";
export const MSG_FORNECEDOR = "O fornecedor do produto precisa ser um parceiro do tipo Fornecedor.";

const erro = (def: ResourceDef, path: (string | number)[], msg: string) => validation(msg, [detalheDoErro(def, path, msg)]);
const vazio = (v: unknown) => v === null || v === undefined || v === "";

export async function conferirProduto(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null) {
  const def = getResource("products")!;
  // ---- controle de lote (has_lot legado derivado) ----
  const controleAtual = String(atual?.["controle_lote"] ?? "nenhum");
  if ("has_lot" in data) {
    if (!("controle_lote" in data) || vazio(data["controle_lote"])) {
      const quer = data["has_lot"] === true;
      if (atual === null ? quer : quer !== (controleAtual !== "nenhum")) data["controle_lote"] = quer ? "lote" : "nenhum";
    }
    delete data["has_lot"]; // o banco deriva has_lot do controle
  }
  if ("controle_lote" in data && vazio(data["controle_lote"])) data["controle_lote"] = atual === null ? "nenhum" : controleAtual;
  if (atual !== null && id && "controle_lote" in data && data["controle_lote"] !== controleAtual) {
    const r = await ctx.tx.query<{ q: string }>("select coalesce(sum(quantity),0)::text as q from erp.stock_balances where organization_id=$1 and product_id=$2", [ctx.orgId, id]);
    if (Number(r.rows[0]?.q ?? 0) !== 0) throw erro(def, ["controle_lote"], MSG_CONTROLE_COM_SALDO);
  }

  // ---- CEST ----
  if ("cest" in data && !vazio(data["cest"])) {
    const c = String(data["cest"]).replace(/[.\s-]/g, "");
    if (!/^\d{7}$/.test(c)) throw erro(def, ["cest"], MSG_CEST);
    data["cest"] = c;
  }

  // ---- Unidades e embalagens ----
  const padrao = ("measurement_id" in data ? data["measurement_id"] : atual?.["measurement_id"]) as string | null | undefined;
  const unidades = data["unidades"];
  if (Array.isArray(unidades)) {
    const vistas = new Set<string>();
    for (const [i, l] of (unidades as Linha[]).entries()) {
      const u = String(l["measurement_id"] ?? "");
      if (u && u === padrao) throw erro(def, ["unidades", i, "measurement_id"], MSG_UNIDADE_PADRAO);
      if (vistas.has(u)) throw erro(def, ["unidades", i, "measurement_id"], "Unidade repetida na grade.");
      vistas.add(u);
      if (!(Number(l["fator"]) > 0)) throw erro(def, ["unidades", i, "fator"], "O fator deve ser maior que zero.");
      if (l["uso_compra"] === false && l["uso_venda"] === false) throw erro(def, ["unidades", i, "uso_compra"], "Marque o uso: compra e/ou venda.");
    }
  } else if (id && "measurement_id" in data && padrao && padrao !== atual?.["measurement_id"]) {
    const r = await ctx.tx.query("select 1 from erp.produto_unidades where organization_id=$1 and product_id=$2 and measurement_id=$3 and deleted_at is null", [ctx.orgId, id, padrao]);
    if (r.rowCount) throw erro(def, ["measurement_id"], "A nova unidade padrão já está na grade de Unidades e embalagens: remova a linha antes.");
  }

  // ---- Compras: fornecedores do produto ----
  const forn = data["fornecedores"];
  if (Array.isArray(forn) && forn.length) {
    const linhas = forn as Linha[];
    const pessoas = [...new Set(linhas.map((l) => l["person_id"]).filter((x): x is string => typeof x === "string"))];
    const ok = new Set((await ctx.tx.query<{ id: string }>("select id::text from erp.people where organization_id=$1 and id = any($2::uuid[]) and is_provider and deleted_at is null", [ctx.orgId, pessoas])).rows.map((x) => x.id));
    const vistas = new Set<string>(); let preferenciais = 0;
    for (const [i, l] of linhas.entries()) {
      const p = String(l["person_id"] ?? "");
      if (!ok.has(p)) throw erro(def, ["fornecedores", i, "person_id"], MSG_FORNECEDOR);
      if (vistas.has(p)) throw erro(def, ["fornecedores", i, "person_id"], "Fornecedor repetido na grade.");
      vistas.add(p);
      if (l["preferencial"] === true && ++preferenciais > 1) throw erro(def, ["fornecedores", i, "preferencial"], "Só um fornecedor pode ser o preferencial.");
    }
  }
}

/**
 * Campo `json` com `camposJson` (ex.: products.taxes): na EDIÇÃO o objeto enviado é FUNDIDO sobre o gravado —
 * chave desconhecida (que a tela não conhece) é preservada; só `null` remove uma chave.
 */
export function fundirCamposJson(def: ResourceDef, data: Linha, atual: Linha | null) {
  for (const f of def.fields) {
    if (!f.camposJson || !(f.name in data)) continue;
    const novo = data[f.name];
    if (novo === null || typeof novo !== "object" || Array.isArray(novo)) continue;
    const base = atual?.[f.name];
    const fundido: Linha = { ...(base && typeof base === "object" && !Array.isArray(base) ? (base as Linha) : {}), ...(novo as Linha) };
    for (const k of Object.keys(fundido)) if (fundido[k] === null) delete fundido[k];
    data[f.name] = fundido;
  }
}

const RUIDO = new Set(["updated_at", "created_at", "version"]);
/**
 * HISTÓRICO da ficha (aba Histórico): eventos da auditoria (`erp.audit_logs`, gatilho `audit_row`) do registro e
 * das linhas das suas grades — quem, quando, o quê (nomes dos campos alterados; os valores não saem daqui).
 * Quem chama já provou que o registro é visível (mesma 404 da ficha). Consulta pelo índice (org, entity, entity_id).
 */
export async function historicoDoRegistro(ctx: ServiceCtx, def: ResourceDef, id: string, page: number, pageSize: number) {
  const tabelas: string[] = []; const ids: string[] = [];
  const rotulo = new Map<string, { label: string; campos: Map<string, string> }>([[def.table, { label: def.label, campos: new Map(def.fields.map((f) => [f.name, f.label])) }]]);
  const ocultas = chavesOcultas(ctx, def);
  for (const d of def.detalhes ?? []) {
    // grade de aba que o usuário não pode LER (R1-4) também não aparece no histórico
    if (d.chaveNatural || ocultas.has(d.key)) continue;
    // nomes de tabela e coluna vêm só do registry estático
    const r = await ctx.tx.query<{ id: string }>(`select id::text from erp.${ident(d.table)} where ${ident(d.chavePai)} = $1`, [id]);
    tabelas.push(d.table); ids.push(...r.rows.map((x) => x.id));
    rotulo.set(d.table, { label: d.label, campos: new Map(d.fields.map((f) => [f.name, f.label])) });
  }
  const where = "a.organization_id = $1 and ((a.entity = $2 and a.entity_id = $3) or (a.entity = any($4::text[]) and a.entity_id = any($5::text[])))";
  const params = [ctx.orgId, def.table, id, tabelas, ids];
  const total = await ctx.tx.query<{ n: string }>(`select count(*)::text n from erp.audit_logs a where ${where}`, params);
  const r = await ctx.tx.query<{ id: string; entity: string; action: string; before: Linha | null; after: Linha | null; created_at: string; user_name: string | null }>(
    `select a.id::text, a.entity, a.action, a.before, a.after, a.created_at, u.name as user_name
       from erp.audit_logs a left join erp.users u on u.id = a.user_id
      where ${where} order by a.id desc limit ${Math.min(pageSize, 200)} offset ${(Math.max(page, 1) - 1) * Math.min(pageSize, 200)}`, params);
  const items = r.rows.map((x) => {
    const meta = rotulo.get(x.entity);
    const antes = x.before ?? {}; const depois = x.after ?? {};
    const campos = x.action === "update"
      ? [...new Set([...Object.keys(antes), ...Object.keys(depois)])].filter((k) => !RUIDO.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k])).map((k) => meta?.campos.get(k) ?? k)
      : [];
    return { quando: x.created_at, quem: x.user_name, acao: x.action, onde: meta?.label ?? x.entity, campos };
  });
  return { items, total: Number(total.rows[0]!.n), page, pageSize };
}
