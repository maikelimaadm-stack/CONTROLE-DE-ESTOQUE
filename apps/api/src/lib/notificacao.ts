import { tipoNotificacao, type EscopoNotificacao } from "@agro/domain";
import { validation } from "./errors.js";
import type { ServiceCtx } from "./context.js";

/**
 * NOTIFICAÇÃO: CRIAÇÃO E LEITURA AUTORIZADAS (PRE-BASE2-02).
 *
 * Duas responsabilidades, uma verdade cada:
 *
 *  1. `criarNotificacao` é a ÚNICA porta de criação em runtime. `insert into erp.notifications` solto
 *     em rota é falha de gate (scripts/notification-insert-audit.mjs) — foi assim que o processamento de
 *     animais e a transferência de lote nasceram sem empresa nem módulo.
 *  2. `visibilidadeNotificacaoSql` é a ÚNICA regra de visibilidade, usada IGUALMENTE pela listagem, pelo
 *     contador de não lidas, pelo "marcar como lida" e pelo "marcar todas". Contador e lista divergirem
 *     é como o badge acaba mostrando aviso que a caixa não mostra.
 */

/** Quem enxerga a linha? CAPACIDADE ∩ ESCOPO, resolvido em SQL (nunca linha a linha em memória). */
export function visibilidadeNotificacaoSql(ctx: ServiceCtx, alias: string, params: unknown[]): string {
  // Só entra no array o parâmetro REALMENTE usado no texto: parâmetro empurrado e não referenciado deixa o
  // Postgres sem como inferir o tipo ("could not determine data type of parameter"), e o proprietário não
  // usa nem a lista de permissões nem o membro.
  const p = (v: unknown) => `$${params.push(v)}`;
  const proprietario = ctx.membership.isOwner;
  const org = p(ctx.orgId);
  const usuario = p(ctx.user.id);
  const perms = proprietario ? "" : p([...ctx.permissions]);
  const membro = proprietario ? "" : p(ctx.membership.memberId);
  return `
    ${alias}.organization_id = ${org}
    -- (A) destinatário: aviso é de todos ou meu
    and (${alias}.user_id is null or ${alias}.user_id = ${usuario})
    -- (B) CAPACIDADE: a permissão é a da FONTE do aviso, não a da caixa. Sem ramo para capacidade ausente:
    -- a coluna é NOT NULL justamente para que "não declarada" nunca signifique "todo mundo vê".
    ${proprietario ? "" : `and ${alias}.permission_key = any(${perms}::text[])`}
    -- (C) ESCOPO
    and (
      ${alias}.escopo_tipo = 'organizacao'
      or (${alias}.escopo_tipo = 'empresa'
          and erp.tem_acesso_empresa(${org}, ${usuario}, ${alias}.modulo, ${alias}.empresa_id))
      or (${alias}.escopo_tipo = 'modulo_todas' and ${proprietario ? "true" : `exists (
            select 1 from erp.membro_escopos_empresa me
             where me.organization_id = ${org} and me.membro_id = ${membro}
               and me.modulo = ${alias}.modulo and me.modo = 'todas')`})
    )`;
}

interface NovaNotificacao {
  kind: string;
  title: string;
  body?: string | null;
  route?: string | null;
  /** destinatário específico; nulo = todos os que estiverem autorizados */
  userId?: string | null;
  /** obrigatório quando o escopo efetivo é `empresa` */
  empresaId?: string | null;
  /** documento sem empresa vira aviso da organização: o tipo declara `empresa`, o registro decide */
  escopoOverride?: EscopoNotificacao;
  entidadeOrigem?: string | null;
  idOrigem?: string | null;
  /** chave extra de deduplicação do dia (além de kind + destinatário + escopo + módulo + empresa) */
  dedupe?: string | null;
}

/**
 * Cria a notificação já classificada. Idempotente no dia por (tipo, destinatário, escopo, módulo,
 * EMPRESA e rota): sem a empresa na chave, o aviso da Empresa A impediria o da Empresa B no mesmo dia.
 */
export async function criarNotificacao(ctx: ServiceCtx, n: NovaNotificacao): Promise<void> {
  const tipo = tipoNotificacao(n.kind);
  if (!tipo) throw validation(`Tipo de notificação desconhecido: ${n.kind}`);

  // Rebaixar escopo é decisão do TIPO, não de quem chama: só um tipo que declara empresa opcional pode
  // virar aviso de organização (documento sem empresa). Sem isso, uma chamada distraída passando
  // `escopoOverride: "organizacao"` num aviso de compra publicaria o código da solicitação para a
  // organização inteira. O banco recusa igualmente (erp.tipos_notificacao), mas o erro aqui tem nome.
  if (n.escopoOverride && n.escopoOverride !== tipo.escopo && !tipo.empresaOpcional)
    throw validation(`Notificação ${n.kind}: escopo ${tipo.escopo} não pode ser rebaixado para ${n.escopoOverride}`);
  const escopo: EscopoNotificacao = n.escopoOverride ?? tipo.escopo;
  const modulo = escopo === "organizacao" ? null : tipo.modulo;
  const empresaId = escopo === "empresa" ? (n.empresaId ?? null) : null;

  // As invariantes também são constraint no banco; aqui o erro sai com nome, não como violação de check.
  if (escopo !== "organizacao" && !modulo) throw validation(`Notificação ${n.kind}: escopo ${escopo} exige módulo`);
  if (escopo === "empresa" && !empresaId) throw validation(`Notificação ${n.kind}: escopo empresa exige a empresa de origem`);
  if (escopo === "organizacao" && n.empresaId) throw validation(`Notificação ${n.kind}: escopo organização não carrega empresa`);

  // A chave precisa distinguir o que é realmente distinto. Deduplicar por ROTA não serve: todos os
  // aniversariantes do dia compartilham a mesma rota, e o aviso do primeiro engolia o dos outros.
  // `is not distinct from` só onde o valor pode mesmo ser nulo (destinatário, módulo e empresa): ele NÃO é
  // indexável, e usá-lo na chave de deduplicação — que nunca é nula, porque cai no título quando falta tudo
  // — trocava o índice `notifications_dedupe_idx` por varredura com filtro, uma vez por candidato do refresh.
  const chave = n.dedupe ?? n.route ?? n.title;
  const jaExiste = await ctx.tx.query(
    `select 1 from erp.notifications
      where organization_id=$1 and kind=$2 and dedupe_key=$7 and created_at::date = current_date
        and user_id is not distinct from $3 and escopo_tipo=$4
        and modulo is not distinct from $5 and empresa_id is not distinct from $6
      limit 1`,
    [ctx.orgId, n.kind, n.userId ?? null, escopo, modulo, empresaId, chave]);
  if (jaExiste.rowCount) return;

  await ctx.tx.query(
    `insert into erp.notifications
       (organization_id, user_id, kind, title, body, route, escopo_tipo, modulo, empresa_id, permission_key, entidade_origem, id_origem, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ctx.orgId, n.userId ?? null, n.kind, n.title, n.body ?? null, n.route ?? null,
      escopo, modulo, empresaId, tipo.permissionKey, n.entidadeOrigem ?? null, n.idOrigem ?? null, chave]);
}
