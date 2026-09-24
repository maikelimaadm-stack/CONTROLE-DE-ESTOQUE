/**
 * Regras do PARCEIRO (erp.people) — CADASTROS Fase 4, decisão 253. Chamadas pelo `createOne`/`updateOne`
 * genérico ANTES de qualquer gravação, dentro da mesma transação.
 *
 *  · pelo menos UM tipo (Cliente, Fornecedor, Transportadora, Funcionário, Proprietário) — 422;
 *  · CPF/CNPJ válido quando informado (regra ÚNICA de `@agro/domain/documento`, inclusive CNPJ alfanumérico),
 *    gravado NORMALIZADO; estrangeiro: livre (só aparado);
 *  · TIPO DE PESSOA × DOCUMENTO (R1-6): Física usa CPF, Jurídica usa CNPJ (inclusive alfanumérico), Estrangeira
 *    livre — conferido quando o corpo manda o documento OU o tipo, contra o valor que a linha TERÁ;
 *  · a recusa aponta a aba da ficha de QUEM CHAMA (`def`): em Parceiros o documento está em Identificação; na ficha
 *    de RH (`funcionarios`), em Pessoal — e ela não tem o tipo de pessoa, então a mensagem diz onde ele se acerta;
 *  · único entre VIVOS da organização (o índice ux_people_documento_normalizado é a autoridade; aqui o 409
 *    sai antes, com o código e o nome do existente, e com o MESMO filtro do índice: normalizado não vazio);
 *  · situação na Receita: copiada do cache da consulta de CNPJ da própria API (nunca do cliente).
 */
import { getResource, recusaDoTipoDePessoa, validarDocumento, type ResourceDef } from "@agro/domain";
import { DomainError } from "@agro/shared";
import { notFound, validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";
import { abaDe } from "./ficha-em-abas.js";

export const TIPOS_DE_PARCEIRO = ["is_client", "is_provider", "is_transporter", "is_employee", "is_proprietary"] as const;
export const MSG_SEM_TIPO = "Marque pelo menos um tipo: Cliente, Fornecedor, Transportadora, Funcionário ou Proprietário.";

type Linha = Record<string, unknown>;
const valor = (data: Linha, atual: Linha | null, campo: string) => (campo in data ? data[campo] : atual?.[campo]);

/** O campo `person_type` do cadastro de parceiros (registry): padrão e rótulos das opções. */
function campoTipoDePessoa() {
  const f = getResource("people")?.fields.find((x) => x.name === "person_type");
  if (!f || typeof f.default !== "string") throw new DomainError("INTERNAL_ERROR", "cadastro de parceiros sem o tipo de pessoa padrão");
  return { padrao: f.default, opcoes: f.options ?? [] };
}
const rotuloDoTipo = (tipo: string) => campoTipoDePessoa().opcoes.find((o) => o.value === tipo)?.label ?? tipo;

/**
 * O tipo de pessoa que a linha TERÁ depois da gravação: o do corpo; na edição, o GRAVADO (lido do banco quando
 * quem chama não o traz em `atual` — ex.: a ficha de `funcionarios`, cuja definição não tem o campo); na criação
 * sem o campo, o PADRÃO do registry, que é o mesmo `default 'legal'` da coluna (0002). `padrao` diz se veio dele.
 */
async function tipoResultante(ctx: ServiceCtx, id: string | null, data: Linha, atual: Linha | null): Promise<{ tipo: string; padrao: boolean }> {
  const doCorpo = data["person_type"];
  if (typeof doCorpo === "string") return { tipo: doCorpo, padrao: false };
  if (atual && typeof atual["person_type"] === "string") return { tipo: atual["person_type"], padrao: false };
  if (id) {
    const r = await ctx.tx.query<{ person_type: string }>("select person_type from erp.people where id = $1 and organization_id = $2", [id, ctx.orgId]);
    const t = r.rows[0]?.person_type;
    if (!t) throw notFound("Parceiro");
    return { tipo: t, padrao: false };
  }
  return { tipo: campoTipoDePessoa().padrao, padrao: true };
}

export async function conferirParceiro(ctx: ServiceCtx, def: ResourceDef, id: string | null, data: Linha, atual: Linha | null) {
  // Na edição a regra vale quando a gravação mexe nos tipos (a web manda todos); um PUT que só troca o
  // telefone de um parceiro antigo sem tipo não fica refém de uma regra que ele não tocou.
  const mexeNosTipos = atual === null || TIPOS_DE_PARCEIRO.some((t) => t in data);
  if (mexeNosTipos && !TIPOS_DE_PARCEIRO.some((t) => valor(data, atual, t) === true)) throw validation(MSG_SEM_TIPO, [{ path: "is_client", message: MSG_SEM_TIPO, aba: "identificacao" }]);

  // Documento e tipo só são conferidos quando o corpo manda um dos dois: um PUT que não mexe em nenhum não é
  // recusado por dado antigo (o parceiro gravado antes da regra só é cobrado quando alguém mexer no tipo ou no
  // documento — a web manda os dois em toda gravação da ficha, então a próxima edição pela tela cobra).
  if (!("document" in data) && !("person_type" in data)) return;
  const bruto = valor(data, atual, "document");
  if (bruto === null || bruto === undefined || String(bruto).trim() === "") { if ("document" in data) data["document"] = null; return; }
  const { tipo, padrao } = await tipoResultante(ctx, id, data, atual);
  // aba do erro = a aba em que o campo aparece NA FICHA DE QUEM CHAMA (nunca uma aba que ela não tem)
  const abaDoDocumento = abaDe(def, { campo: "document" });
  let doc: string;
  if (tipo === "foreign") doc = String(bruto).trim();
  else {
    // tipo × documento ANTES do dígito: "Pessoa jurídica usa CNPJ" diz o que fazer; "CPF inválido" não
    const recusa = recusaDoTipoDePessoa(tipo, String(bruto));
    if (recusa) {
      // o campo certo: o documento, quando veio; senão o tipo (só o tipo mudou contra o documento gravado)
      const campo = "document" in data ? "document" : "person_type";
      // ficha SEM o campo do tipo (RH): o tipo gravado não se acerta nela — a mensagem diz qual é e onde se acerta
      const semOTipo = !def.fields.some((f) => f.name === "person_type");
      const msg = padrao ? `${recusa} (tipo de pessoa não informado vale ${rotuloDoTipo(tipo)})`
        : semOTipo ? `${recusa} — o parceiro está como ${rotuloDoTipo(tipo)}; acerte o tipo de pessoa no cadastro de parceiros` : recusa;
      throw validation(`${campo === "document" ? "CPF/CNPJ" : "Tipo de pessoa"}: ${msg}`, [{ path: campo, message: msg, aba: abaDe(def, { campo }) }]);
    }
    const r = validarDocumento(String(bruto));
    if (!r.valido) throw validation(`CPF/CNPJ: ${r.motivo}`, [{ path: "document", message: r.motivo, aba: abaDoDocumento }]);
    doc = r.normalizado;
  }
  data["document"] = doc;

  // mesmo filtro do índice (0027): documento que fica vazio depois de normalizar não conta como duplicado
  const dup = await ctx.tx.query<{ id: string; code: string; name: string }>(
    `select id::text, code, name from erp.people
      where organization_id = $1 and deleted_at is null and document is not null
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) <> ''
        and upper(regexp_replace(document, '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace($2, '[^0-9A-Za-z]', '', 'g'))
        and ($3::uuid is null or id <> $3::uuid) limit 1`, [ctx.orgId, doc, id]);
  const x = dup.rows[0];
  if (x) throw new DomainError("CONFLICT", `CPF/CNPJ já cadastrado no parceiro ${x.code} - ${x.name}`, [{ path: "document", message: `Já cadastrado: ${x.code} - ${x.name}`, aba: abaDoDocumento, existente: { id: x.id, code: x.code, name: x.name } }]);

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
