/**
 * Regras do PARCEIRO (erp.people) — CADASTROS Fase 4, decisão 253. Chamadas pelo `createOne`/`updateOne`
 * genérico ANTES de qualquer gravação, dentro da mesma transação.
 *
 *  · pelo menos UM tipo (Cliente, Fornecedor, Transportadora, Funcionário, Proprietário) — 422;
 *  · CPF/CNPJ válido quando informado (regra ÚNICA de `@agro/domain/documento`, inclusive CNPJ alfanumérico),
 *    gravado NORMALIZADO; estrangeiro: livre (só aparado);
 *  · único entre VIVOS da organização (o índice ux_people_documento_normalizado é a autoridade; aqui o 409
 *    sai antes, com o código e o nome do existente);
 *  · situação na Receita: copiada do cache da consulta de CNPJ da própria API (nunca do cliente).
 */
import { validarDocumento } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

export const TIPOS_DE_PARCEIRO = ["is_client", "is_provider", "is_transporter", "is_employee", "is_proprietary"] as const;
export const MSG_SEM_TIPO = "Marque pelo menos um tipo: Cliente, Fornecedor, Transportadora, Funcionário ou Proprietário.";

type Linha = Record<string, unknown>;
const valor = (data: Linha, atual: Linha | null, campo: string) => (campo in data ? data[campo] : atual?.[campo]);

export async function conferirParceiro(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null) {
  // Na edição a regra vale quando a gravação mexe nos tipos (a web manda todos); um PUT que só troca o
  // telefone de um parceiro antigo sem tipo não fica refém de uma regra que ele não tocou.
  const mexeNosTipos = atual === null || TIPOS_DE_PARCEIRO.some((t) => t in data);
  if (mexeNosTipos && !TIPOS_DE_PARCEIRO.some((t) => valor(data, atual, t) === true)) throw validation(MSG_SEM_TIPO, [{ path: "is_client", message: MSG_SEM_TIPO, aba: "identificacao" }]);

  if (!("document" in data) && !("person_type" in data)) return;
  const bruto = valor(data, atual, "document");
  if (bruto === null || bruto === undefined || String(bruto).trim() === "") { if ("document" in data) data["document"] = null; return; }
  const estrangeiro = valor(data, atual, "person_type") === "foreign";
  let doc: string;
  if (estrangeiro) doc = String(bruto).trim();
  else {
    const r = validarDocumento(String(bruto));
    if (!r.valido) throw validation(`CPF/CNPJ: ${r.motivo}`, [{ path: "document", message: r.motivo, aba: "identificacao" }]);
    doc = r.normalizado;
  }
  data["document"] = doc;

  const dup = await ctx.tx.query<{ id: string; code: string; name: string }>(
    `select id::text, code, name from erp.people
      where organization_id = $1 and deleted_at is null and document is not null
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace($2, '[^0-9A-Za-z]', '', 'g'))
        and ($3::uuid is null or id <> $3::uuid) limit 1`, [ctx.orgId, doc, id]);
  const x = dup.rows[0];
  if (x) throw new DomainError("CONFLICT", `CPF/CNPJ já cadastrado no parceiro ${x.code} - ${x.name}`, [{ path: "document", message: `Já cadastrado: ${x.code} - ${x.name}`, aba: "identificacao", existente: { id: x.id, code: x.code, name: x.name } }]);

}

/**
 * Situação na Receita do parceiro gravado: a última consulta de CNPJ que a PRÓPRIA API fez (cache global da
 * Fase 3). Os campos são somente leitura no contrato — o cliente nunca os envia. Sem consulta: fica como está.
 */
export async function atualizarSituacaoReceita(ctx: ServiceCtx, id: string) {
  await ctx.tx.query(
    `update erp.people p set situacao_receita = upper(c.dados->'situacao'->>'descricao'), situacao_receita_consultada_em = c.consultado_em
       from erp.consulta_cnpj_cache c
      where p.id = $1 and p.organization_id = $2 and p.person_type <> 'foreign' and length(p.document) = 14 and c.cnpj = p.document
        and c.dados->'situacao'->>'descricao' is not null
        and p.situacao_receita_consultada_em is distinct from c.consultado_em`, [id, ctx.orgId]);
}
