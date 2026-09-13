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

/**
 * Teto da contagem. NÃO é a janela da caixa (50): é um limite de CUSTO, muito acima de qualquer número que
 * um badge comunique. Medido com `EXPLAIN ANALYZE` sobre 200 mil avisos numa organização: a contagem exata
 * leva ~7,6 s porque avalia `erp.tem_acesso_empresa` linha a linha, e a mesma contagem com teto leva
 * ~130 ms. O contador roda a cada 60 s por aba aberta (a caixa é pollada), então a versão exata viraria
 * varredura de tabela por minuto por usuário. Acima do teto o badge diz "500+", que é honesto — o que não
 * pode é dizer 50 porque a caixa mostra 50.
 */
export const TETO_NAO_LIDAS = 500;

/**
 * Contador de NÃO LIDAS do usuário — a ÚNICA autoridade.
 *
 * Tanto o badge (via /auth/context) quanto a caixa (via GET /admin/notifications) precisam responder o mesmo
 * número; duas redações da mesma regra divergem na primeira vez que alguém editar só uma delas. Por isso a
 * função é dona do próprio array de parâmetros: `visibilidadeNotificacaoSql` numera `$n` pelo TAMANHO
 * corrente do array, então um fragmento reaproveitado entre duas consultas herdaria a numeração da outra —
 * e o alias `l` já é usado pelo `left join` da listagem, que o fragmento sombrearia.
 *
 * Conta SEM o limite da JANELA: a caixa mostra as 50 mais recentes, mas quem tem 80 não lidas vê 80.
 */
export async function contarNaoLidas(ctx: ServiceCtx): Promise<{ total: number; truncado: boolean }> {
  const p: unknown[] = [];
  const visivel = visibilidadeNotificacaoSql(ctx, "n", p);
  const usuario = `$${p.push(ctx.user.id)}`;
  const r = await ctx.tx.query<{ n: string }>(
    `select count(*) n from (
       select 1 from erp.notifications n
        where ${visivel}
          and not exists (select 1 from erp.notificacao_leituras r
                           where r.organization_id = n.organization_id and r.notificacao_id = n.id and r.usuario_id = ${usuario})
        limit ${TETO_NAO_LIDAS + 1}) x`, p);
  const lidos = Number(r.rows[0]?.n ?? 0);
  return lidos > TETO_NAO_LIDAS ? { total: TETO_NAO_LIDAS, truncado: true } : { total: lidos, truncado: false };
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
 * O destinatário específico só permanece se ele REALMENTE enxergaria a linha.
 *
 * Dirigir um aviso a quem nao o ve e pior que nao dirigir: o predicado (A) da leitura elimina todos os
 * outros e o (B) ou o (C) eliminam ele — a linha nasce MORTA, sem erro, sem badge, sem ninguem avisado.
 * Foi o que aconteceu com a solicitacao de compra cujo responsavel tinha escopo de Compras na empresa mas
 * nao tinha `purchase_requests.view`: verificava-se ESCOPO e nunca CAPACIDADE, e o contrato e a INTERSECAO.
 *
 * A pergunta feita aqui e exatamente a que o leitor faz, com o alvo no lugar do usuario da sessao, e quem
 * responde sao as autoridades que ja existem no banco — nada de reimplementar perfil, membro e escopo:
 *   (B) capacidade  -> erp.has_permission (mesma fonte: membro ativo + is_owner ou role_permissions)
 *   (C) escopo      -> organizacao: nada a exigir
 *                      empresa:     erp.tem_acesso_empresa (a MESMA funcao que a leitura chama)
 *                      modulo_todas: proprietario ou modo `todas` no modulo. `tem_acesso_empresa` NAO serve
 *                      aqui: essas linhas tem empresa_id nulo por constraint e a funcao exige empresa nao
 *                      nula, entao responderia "nao" ate para o dono; e passar uma empresa qualquer daria
 *                      "sim" para quem tem `selecionadas`, que e justamente quem NAO consolida o agregado.
 *
 * Quando o alvo nao passa, o aviso vira DIFUSAO (user_id nulo) — nao se perde: ele continua recortado pela
 * propria autorizacao da linha (capacidade da fonte + empresa), entao chega a todos os legitimos.
 */
async function destinatarioQueEnxerga(
  ctx: ServiceCtx, alvo: string, permissionKey: string,
  escopo: EscopoNotificacao, modulo: string | null, empresaId: string | null
): Promise<string | null> {
  const r = await ctx.tx.query<{ ok: boolean }>(
    `select erp.has_permission($1,$2,$3::text)
        and case
          when $4::text = 'organizacao' then true
          when $4::text = 'empresa' then erp.tem_acesso_empresa($1,$2,$5::text,$6::uuid)
          else exists (
            select 1 from erp.organization_members m
             where m.organization_id = $1 and m.user_id = $2 and m.is_active
               and (m.is_owner or exists (
                     select 1 from erp.membro_escopos_empresa e
                      where e.organization_id = $1 and e.membro_id = m.id
                        and e.modulo = $5::text and e.modo = 'todas'))
          )
        end as ok`,
    [ctx.orgId, alvo, permissionKey, escopo, modulo, empresaId]);
  return r.rows[0]?.ok ? alvo : null;
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

  // O destinatario e decidido ANTES da chave de deduplicacao: o `user_id` entra nela, entao rebaixar depois
  // procuraria por uma chave e gravaria outra.
  const destinatario = n.userId ? await destinatarioQueEnxerga(ctx, n.userId, tipo.permissionKey, escopo, modulo, empresaId) : null;

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
    [ctx.orgId, n.kind, destinatario, escopo, modulo, empresaId, chave]);
  if (jaExiste.rowCount) return;

  await ctx.tx.query(
    `insert into erp.notifications
       (organization_id, user_id, kind, title, body, route, escopo_tipo, modulo, empresa_id, permission_key, entidade_origem, id_origem, dedupe_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ctx.orgId, destinatario, n.kind, n.title, n.body ?? null, n.route ?? null,
      escopo, modulo, empresaId, tipo.permissionKey, n.entidadeOrigem ?? null, n.idOrigem ?? null, chave]);
}
