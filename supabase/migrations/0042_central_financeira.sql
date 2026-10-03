-- =====================================================================
-- 0042 OPERACOES-01 F8 — CENTRAL FINANCEIRA — decisão 285
--
-- 1) Trava própria (2026,76) e lock_timeout de 2s.
-- 2) Pré-condições nomeadas "OPERACOES-01 F8: …", "já aplicada" PRIMEIRO (P1 a P8). A P8 é a única que lê dado: o
--    ACERVO de baixas confirmadas com desconto (ver o item 5.1) — fail-closed, com até 20 ids no diagnóstico.
-- 3) Colunas novas, TODAS anuláveis, nas tabelas do financeiro de hoje, com constraints e índices nomeados:
--      · erp.bank_accounts.data_saldo_inicial — a data do saldo inicial (informativa; ponto de partida do extrato);
--      · erp.financial_titles.data_competencia, .conta_prevista_id (FK composta para a conta), .cancel_reason,
--        .cancelled_at, .cancelled_by — a competência do DRE, a conta prevista do fluxo e a trilha do cancelamento
--        (o motivo deixa de ser descartado);
--      · erp.title_settlements.lote_id, .tarifa, .adiantamento_id (FK composta para o título-adiantamento),
--        .natureza_desconto_id (FK composta para a natureza) — a baixa em lote, a tarifa, o uso do crédito do
--        adiantamento e a natureza do desconto no momento da baixa;
--      · erp.bank_movements.tipo_transferencia, .title_settlement_id (FK composta para a baixa), .componente_baixa,
--        .lote_baixa_id, .cancel_reason, .cancelled_at, .cancelled_by — o rótulo da transferência entre contas, o
--        componente da baixa lançado em separado (juros, multa, acréscimo, tarifa), a tarifa do lote e a trilha do
--        estorno;
--      · erp.financial_categories.grupo_dre — o grupo do DRE gerencial.
--    As chaves alvo das FKs compostas nascem aqui: uq_bank_accounts_tenant, uq_financial_titles_tenant e
--    uq_title_settlements_tenant, todas (id, organization_id). Toda FK nova é SEM ação de exclusão (uma linha
--    referenciada não some em cascata) e, quando aponta para dado do tenant, é COMPOSTA na ordem
--    (coluna, organization_id) → (id, organization_id): coluna única prova que o UUID existe, não que é DESTA
--    organização.
-- 4) Tabela nova erp.financeiro_naturezas_padrao: UMA linha por organização com as naturezas padrão dos
--    componentes da baixa (juros, multa e acréscimo pagos/recebidos, desconto obtido/concedido, tarifa bancária).
--    É configuração da ORGANIZAÇÃO, sem empresa: política tenant_isolation (só tenant), e por isso não entra em
--    scripts/company-rls-modules.json. Auditoria (erp.audit_row, que lê a coluna id) e updated_at por gatilho.
--    SEM gatilho de TRUNCATE: é configuração mutável, não histórico; o que a protege é o privilégio (o erp_app não
--    apaga nem trunca) e a auditoria de cada mudança.
-- 5) Funções e gatilhos:
--    5.1 erp.refresh_title_status(uuid) — MESMA assinatura, linguagem e privilégios; a ÚNICA mudança é a soma das
--        baixas confirmadas: sum(amount) (era sum(amount + discount)). Semântica B, decisão 285: amount é o valor
--        BAIXADO do título e JÁ INCLUI o desconto; o caixa é amount − discount + juros + multa + acréscimo ± ajuste.
--        Antes o desconto contava DUAS vezes (o banco somava amount + discount ao pago, o domínio tirava o desconto
--        do caixa: título 1000, baixa amount 550 discount 50 quitava 600 e movimentava 500). Uma baixa já gravada
--        com desconto > 0 mudaria de sentido — a P8 PARA se houver uma (produção: zero baixas em 02/10).
--    5.2 trg_bm_confirmado_imutavel (BEFORE UPDATE OF as colunas de valor, data, conta, tipo, empresa e rótulo da
--        transferência; WHEN o movimento era 'confirmed' e alguma delas MUDOU) → 'CONFLICT: …'. A correção de um
--        movimento confirmado é estorno + movimento novo. Cancelar (status), conciliar (reconciled_at,
--        ofx_transaction_id), o par da transferência, a trilha do cancelamento e os vínculos da baixa continuam
--        atualizáveis (não estão na lista). Movimento já cancelado não é guardado (old.status <> 'confirmed').
--    5.3 trg_ts_credito_conferir (BEFORE INSERT em title_settlements, WHEN adiantamento_id não nulo): trava o
--        título-adiantamento (FOR UPDATE) e confere que ele é um adiantamento (payment_type 'advance' OU tipo de
--        título com is_advance) vivo, não cancelado, da MESMA organização, direção, parceiro e empresa do título
--        baixado — senão 'NOT_FOUND: …' (a mesma resposta para inexistente, de outro tenant ou de outro parceiro);
--        e que o crédito (paid_amount − usos confirmados) cobre o valor — senão 'PAYMENT_EXCEEDS_BALANCE: …'.
--        INVOKER de propósito: lê sob a RLS de quem grava (o título e o adiantamento são da mesma empresa).
--    5.4 erp.extrato_conta_organizacao(uuid[], date, date) — a porta do extrato de CONTA, no molde de
--        erp.movimentos_conta_organizacao (0015): SECURITY DEFINER ESTREITA (organização e usuário da GUC do
--        servidor; bank_accounts.view E bank_movements.view reconferidas dentro; organization_id explícito nas
--        duas tabelas; search_path fixo; sem SQL dinâmico; EXECUTE revogado de PUBLIC e concedido ao erp_app).
--        RECORTADA PELO ESCOPO DE EMPRESA de quem pergunta no módulo FINANCEIRO (decisão do Maike de 03/10, conserto
--        da revisão final): as MESMAS funções da RLS de erp.bank_movements (erp.escopo_empresa_total e
--        erp.empresas_do_membro, 0015), com o módulo FIXO aqui dentro — nunca da GUC (as rotas de conta abrem a
--        transação sem módulo, e sem módulo a RLS valeria a união das empresas do membro em QUALQUER módulo) nem de
--        parâmetro. Escopo total (proprietário ou modo "todas" no financeiro): todos os movimentos, inclusive os sem
--        empresa. Parcial: só os das empresas dele — o sem empresa é da organização inteira e fica de fora. O recorte
--        é no WHERE da própria função: nada de outra empresa sai dela (linha, texto, documento, valor), e todo total,
--        contagem, saldo e página que a API monta por cima já nasce recortado.
--        Devolve, além das colunas da 0015, o tipo de categoria, o rótulo da transferência, a origem, a
--        conciliação (reconciled_at, ofx_transaction_id), a empresa e o código do movimento.
-- 6) Histórico sem DELETE: o erp_app perde DELETE e TRUNCATE em erp.financial_titles, erp.title_settlements,
--    erp.bank_movements e erp.bank_movement_apportionments, e UPDATE em erp.bank_movement_apportionments (o rateio
--    de um movimento confirmado não se reescreve). erp.title_apportionments continua com DELETE: o PUT do título
--    aberto troca o rateio.
-- 7) EXECUTE só do dono nas duas funções de gatilho novas (a 0007 dá EXECUTE de toda função nova ao erp_app; o
--    laço da 0041 o tira).
-- 8) Pós-condições só de CATÁLOGO (nunca contagem de tabela viva), sob o marcador literal abaixo.
--
-- RLS: as tabelas existentes mantêm as políticas de hoje (nenhuma é tocada). A tabela nova tem RLS habilitada e
-- FORÇADA com tenant_isolation. A função 5.4 é a única porta que atravessa a RLS de empresa — e só para trocar o
-- módulo INDEFINIDO da rota de conta pelo FINANCEIRO, aplicando por dentro o mesmo escopo que a RLS aplicaria nele
-- (com o movimento sem empresa só no escopo total) —, com as cinco propriedades acima.
-- PRIVILÉGIOS: erp_app — financeiro_naturezas_padrao: select, insert, update (sem delete/truncate); o ledger: item 6;
-- erp.extrato_conta_organizacao: execute; funções de gatilho novas: nenhum.
--
-- SEM BACKFILL: nenhuma linha existente é reescrita. Só colunas novas anuláveis (sem default), constraints que o
-- acervo já satisfaz (as colunas são nulas), índices, uma tabela nova vazia, gatilhos novos, uma função nova, a
-- troca do corpo de erp.refresh_title_status (que NÃO recalcula título algum: só vale na próxima baixa ou estorno)
-- e revogação de privilégios.
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web). A API anterior (622f194) sobre este banco:
--   · INSERTs dela ignoram as colunas novas (anuláveis, sem default) e não gravam adiantamento_id, então o gatilho
--     5.3 nunca dispara para ela;
--   · a baixa: ela confere amount + discount ≤ saldo antes de gravar (mais estrita que a semântica B), então nunca
--     estoura; uma baixa COM desconto feita por ela nesta janela quita o título pelo amount (B) e deixa o desconto
--     em aberto — produção não tem baixa (02/10) e a janela é a do deploy;
--   · o PUT de movimento: alterar valor, data ou conta de um movimento confirmado recebe 'CONFLICT' do gatilho 5.2
--     (código que ela conhece: 409); trocar o rateio dele apaga erp.bank_movement_apportionments, que o erp_app não
--     apaga mais (42501 → PERMISSION_DENIED, 403). A web anterior não tem tela de PUT de movimento;
--   · ela não apaga nem trunca as outras três tabelas do ledger (nenhum caminho dela o faz) e não chama a função 5.4.
-- Os ALTER TABLE pedem locks curtos em erp.bank_accounts, erp.financial_titles, erp.title_settlements,
-- erp.bank_movements, erp.financial_categories e erp.users (alvo das FKs da trilha); o lock_timeout de 2s faz a
-- migration desistir em vez de enfileirar as gravações atrás dela.
-- VOLTA: API e web voltam por redeploy e convivem com a 0042 (descrito acima). O banco fica: tudo é aditivo, a
-- tabela nova NUNCA se apaga (dado real, decisão 247), e devolver DELETE ao erp_app ou desligar um gatilho só com
-- uma migration nova, por decisão humana.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (a 0041 usou 75).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 76) then
    raise exception 'OPERACOES-01 F8: outra transacao ja detem a trava desta migration (2026,76). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_ts text[];
  v_bm text[];
  v_ft text[];
  v_ids text;
begin
  -- P1 "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência.
  if to_regclass('erp.financeiro_naturezas_padrao') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'title_settlements' and column_name = 'lote_id')
     or exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'bank_movements' and column_name = 'tipo_transferencia') then
    raise exception 'OPERACOES-01 F8: a 0042 ja foi aplicada ou ha schema divergente (financeiro_naturezas_padrao/lote_id/tipo_transferencia ja existe).';
  end if;
  -- P2 O papel da aplicação é o destinatário dos privilégios (e o que perde DELETE no ledger).
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'OPERACOES-01 F8: papel erp_app ausente (0007); os privilegios da tabela nova e do ledger nao teriam destinatario.';
  end if;
  -- P3 Antes de ler qualquer tabela: um papel sem bypass de RLS veria só o recorte dele no acervo (P8), e a função
  -- SECURITY DEFINER (cujo dono é quem aplica) também.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'OPERACOES-01 F8: o papel que aplica a migration (dono da funcao SECURITY DEFINER do extrato) nao atravessa RLS; o acervo e o extrato seriam lidos pelo recorte dele.';
  end if;
  -- P4 As colunas que os gatilhos, as funções e as constraints novas leem (contagem EXATA: 15 + 9 + 19 + 5 + 2 + 5).
  if (select count(*) from information_schema.columns
       where table_schema = 'erp'
         and ((table_name = 'financial_titles' and column_name in ('id', 'organization_id', 'empresa_id', 'direction', 'person_id', 'title_type_id',
                                                                   'payment_type', 'amount', 'discount', 'paid_amount', 'status', 'deleted_at',
                                                                   'source_type', 'source_id', 'version'))
           or (table_name = 'title_settlements' and column_name in ('id', 'organization_id', 'title_id', 'settlement_kind', 'cross_title_id',
                                                                    'bank_movement_id', 'amount', 'discount', 'status'))
           or (table_name = 'bank_movements' and column_name in ('id', 'organization_id', 'bank_account_id', 'movement_date', 'type', 'category_type',
                                                                 'destination_account_id', 'amount', 'interest', 'empresa_id', 'status', 'reconciled_at',
                                                                 'ofx_transaction_id', 'note', 'document', 'source_type', 'created_at', 'deleted_at', 'code'))
           or (table_name = 'bank_accounts' and column_name in ('id', 'organization_id', 'code', 'opening_balance', 'deleted_at'))
           or (table_name = 'title_types' and column_name in ('id', 'is_advance'))
           or (table_name = 'financial_categories' and column_name in ('id', 'organization_id', 'parent_id', 'nature', 'classification')))) <> 55 then
    raise exception 'OPERACOES-01 F8: coluna lida pela migration ausente (financial_titles: id/organization_id/empresa_id/direction/person_id/title_type_id/payment_type/amount/discount/paid_amount/status/deleted_at/source_type/source_id/version; title_settlements: id/organization_id/title_id/settlement_kind/cross_title_id/bank_movement_id/amount/discount/status; bank_movements: id/organization_id/bank_account_id/movement_date/type/category_type/destination_account_id/amount/interest/empresa_id/status/reconciled_at/ofx_transaction_id/note/document/source_type/created_at/deleted_at/code; bank_accounts: id/organization_id/code/opening_balance/deleted_at; title_types: id/is_advance; financial_categories: id/organization_id/parent_id/nature/classification); a cadeia de migrations esta fora de ordem.';
  end if;
  -- P5 A chave que as FKs compostas para a natureza referenciam (as das outras três tabelas nascem aqui).
  if not exists (select 1 from pg_constraint where conrelid = 'erp.financial_categories'::regclass and conname = 'uq_financial_categories_tenant' and contype = 'u') then
    raise exception 'OPERACOES-01 F8: chave alvo das FKs compostas ausente (uq_financial_categories_tenant de erp.financial_categories).';
  end if;
  -- P6 As funções que os gatilhos e a função nova chamam: o plpgsql só resolve a chamada na execução, e a ausência
  -- viraria erro genérico na primeira baixa.
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.current_org_id()') is null or to_regprocedure('erp.effective_user_id()') is null
     or to_regprocedure('erp.has_permission(uuid,uuid,text)') is null or to_regprocedure('erp.refresh_title_status(uuid)') is null
     or to_regprocedure('erp.title_settlement_changed()') is null or to_regprocedure('erp.set_updated_at()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null then
    raise exception 'OPERACOES-01 F8: funcoes de RLS/auditoria/usuario/baixa/escopo ausentes (tenant_visible, audit_row, current_org_id, effective_user_id, has_permission, refresh_title_status, title_settlement_changed, set_updated_at, escopo_empresa_total, empresas_do_membro).';
  end if;
  -- P7 O conjunto EXATO dos gatilhos de hoje nas três tabelas do ledger: é sobre ele que a pós-condição afirma "os
  -- de hoje e os novos, nenhum outro". Um a mais ou a menos invalida a afirmação, e a decisão volta para um humano.
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_ts from pg_trigger t where t.tgrelid = 'erp.title_settlements'::regclass and not t.tgisinternal;
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_bm from pg_trigger t where t.tgrelid = 'erp.bank_movements'::regclass and not t.tgisinternal;
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_ft from pg_trigger t where t.tgrelid = 'erp.financial_titles'::regclass and not t.tgisinternal;
  if v_ts is distinct from array['trg_settlement_changed'] or v_bm is distinct from array['trg_bm_audit']
     or v_ft is distinct from array['trg_ft_audit', 'trg_ft_updated'] then
    raise exception 'OPERACOES-01 F8: gatilhos do ledger diferentes dos esperados (title_settlements: trg_settlement_changed; bank_movements: trg_bm_audit; financial_titles: trg_ft_audit, trg_ft_updated): title_settlements=% bank_movements=% financial_titles=%', v_ts, v_bm, v_ft;
  end if;
  -- P8 ACERVO (fail-closed): a soma das baixas muda de sentido no item 5.1, e uma baixa confirmada com desconto
  -- passaria a quitar menos do que quitava. Nenhuma linha existente é reescrita; se houver uma, um humano decide.
  select string_agg(x.id::text, ', ' order by x.id) into v_ids
    from (select s.id from erp.title_settlements s where s.status = 'confirmed' and s.discount > 0 order by s.id limit 20) x;
  if v_ids is not null then
    raise exception 'OPERACOES-01 F8: ha baixa confirmada com desconto (a contagem do desconto muda nesta migration): %', v_ids;
  end if;
end $$;

-- ---------- 3) colunas, constraints e índices ----------
alter table erp.bank_accounts add column data_saldo_inicial date;
alter table erp.bank_accounts add constraint uq_bank_accounts_tenant unique (id, organization_id);

alter table erp.financial_titles
  add column data_competencia date,
  add column conta_prevista_id uuid,
  add column cancel_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid;
alter table erp.financial_titles add constraint uq_financial_titles_tenant unique (id, organization_id);
alter table erp.financial_titles add constraint fk_financial_titles_conta_prevista
  foreign key (conta_prevista_id, organization_id) references erp.bank_accounts (id, organization_id);
alter table erp.financial_titles add constraint fk_financial_titles_cancelled_by
  foreign key (cancelled_by) references erp.users (id);
create index idx_financial_titles_conta_prevista on erp.financial_titles (organization_id, conta_prevista_id) where conta_prevista_id is not null;

alter table erp.title_settlements
  add column lote_id uuid,
  add column tarifa numeric(18,2),
  add column adiantamento_id uuid,
  add column natureza_desconto_id uuid;
alter table erp.title_settlements add constraint uq_title_settlements_tenant unique (id, organization_id);
alter table erp.title_settlements add constraint chk_title_settlements_tarifa check (tarifa is null or tarifa >= 0);
alter table erp.title_settlements add constraint chk_title_settlements_adiantamento check (
  adiantamento_id is null or (settlement_kind = 'advance_compensation' and cross_title_id is null
                              and bank_movement_id is null and adiantamento_id <> title_id));
alter table erp.title_settlements add constraint fk_title_settlements_adiantamento
  foreign key (adiantamento_id, organization_id) references erp.financial_titles (id, organization_id);
alter table erp.title_settlements add constraint fk_title_settlements_natureza_desconto
  foreign key (natureza_desconto_id, organization_id) references erp.financial_categories (id, organization_id);
create index idx_title_settlements_lote on erp.title_settlements (organization_id, lote_id) where lote_id is not null;
create index idx_title_settlements_adiantamento on erp.title_settlements (adiantamento_id) where adiantamento_id is not null;

alter table erp.bank_movements
  add column tipo_transferencia text,
  add column title_settlement_id uuid,
  add column componente_baixa text,
  add column lote_baixa_id uuid,
  add column cancel_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid;
alter table erp.bank_movements add constraint chk_bank_movements_tipo_transferencia check (
  tipo_transferencia is null or (tipo_transferencia in ('transferencia', 'deposito', 'saque', 'aplicacao', 'resgate')
                                 and category_type = 'internal_transfer'));
alter table erp.bank_movements add constraint chk_bank_movements_componente_baixa check (
  componente_baixa is null or (componente_baixa in ('juros', 'multa', 'acrescimo', 'tarifa')
                               and (title_settlement_id is not null or lote_baixa_id is not null)));
alter table erp.bank_movements add constraint fk_bank_movements_title_settlement
  foreign key (title_settlement_id, organization_id) references erp.title_settlements (id, organization_id);
alter table erp.bank_movements add constraint fk_bank_movements_cancelled_by
  foreign key (cancelled_by) references erp.users (id);
create index idx_bank_movements_title_settlement on erp.bank_movements (title_settlement_id) where title_settlement_id is not null;
create index idx_bank_movements_lote_baixa on erp.bank_movements (organization_id, lote_baixa_id) where lote_baixa_id is not null;
create index idx_bank_movements_ofx_transaction on erp.bank_movements (ofx_transaction_id) where ofx_transaction_id is not null;

alter table erp.financial_categories add column grupo_dre text;
-- A lista de valores da coluna, sozinha: nulo passa (um CHECK nulo não recusa), e é a forma que o dicionário de
-- dados lê como "Valores" da coluna.
alter table erp.financial_categories add constraint chk_financial_categories_grupo_dre check (
  grupo_dre in ('receitas', 'deducoes', 'custos', 'despesas', 'investimentos'));

comment on column erp.bank_accounts.data_saldo_inicial is 'Data do saldo inicial (opening_balance) da conta (OPERACOES-01 F8). Informativa e ponto de partida padrão do extrato; nada é recalculado por ela. Nula = sem data declarada.';
comment on column erp.financial_titles.data_competencia is 'Competência do título para o DRE gerencial (OPERACOES-01 F8). Nula = a emissão (emission_date).';
comment on column erp.financial_titles.conta_prevista_id is 'Conta bancária ou caixa prevista para a baixa (fluxo de caixa previsto por conta). FK composta com a organização; muda também em título gerado por documento.';
comment on column erp.financial_titles.cancel_reason is 'Motivo do cancelamento do título (antes descartado). Só no cancelado.';
comment on column erp.financial_titles.cancelled_at is 'Momento do cancelamento do título.';
comment on column erp.financial_titles.cancelled_by is 'Usuário que cancelou o título.';
comment on column erp.title_settlements.lote_id is 'Identifica a baixa em lote (settle-batch): todas as baixas do mesmo lote têm o mesmo valor; o estorno do lote cancela todas as baixas com este valor. Nulo = baixa individual.';
comment on column erp.title_settlements.tarifa is 'Tarifa bancária da baixa (numeric, nunca negativa). Lançada como movimento de saída próprio, com a natureza padrão da tarifa; não entra no líquido da baixa. Nula = sem tarifa.';
comment on column erp.title_settlements.adiantamento_id is 'Título-adiantamento cujo crédito esta baixa usa (compensação sem banco: settlement_kind advance_compensation, sem cross_title_id e sem movimento). FK composta; o gatilho trg_ts_credito_conferir confere parceiro, empresa, direção e crédito.';
comment on column erp.title_settlements.natureza_desconto_id is 'Natureza padrão do desconto no momento da baixa (histórico: não muda se a configuração mudar). FK composta com a organização. Nula = sem desconto ou sem natureza configurada.';
comment on column erp.bank_movements.tipo_transferencia is 'Rótulo da transferência entre contas (só em internal_transfer): transferencia; deposito = caixa → banco; saque = banco → caixa; aplicacao = → conta de aplicação; resgate = aplicação →. Nenhum é receita nem despesa.';
comment on column erp.bank_movements.title_settlement_id is 'Baixa de que este movimento é um componente lançado em separado (juros, multa, acréscimo, tarifa) — lançamento próprio com a natureza padrão. FK composta com a organização.';
comment on column erp.bank_movements.componente_baixa is 'Componente da baixa que este movimento lança em separado (juros, multa, acrescimo, tarifa), com a natureza padrão configurada. Nulo = movimento comum.';
comment on column erp.bank_movements.lote_baixa_id is 'Lote de baixa (title_settlements.lote_id) cuja tarifa este movimento lança: a tarifa do lote é um movimento só.';
comment on column erp.bank_movements.cancel_reason is 'Motivo do estorno do movimento (antes descartado). Só no cancelado.';
comment on column erp.bank_movements.cancelled_at is 'Momento do estorno do movimento.';
comment on column erp.bank_movements.cancelled_by is 'Usuário que estornou o movimento.';
comment on column erp.financial_categories.grupo_dre is 'Grupo do DRE gerencial (receitas, deducoes, custos, despesas, investimentos). Nulo = herda do ancestral; sem ancestral marcado = derivado da natureza (receita/despesa).';

-- ---------- 4) tabela nova: naturezas padrão da baixa ----------
create table erp.financeiro_naturezas_padrao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  juros_pagos_id uuid,
  juros_recebidos_id uuid,
  multa_paga_id uuid,
  multa_recebida_id uuid,
  acrescimo_pago_id uuid,
  acrescimo_recebido_id uuid,
  desconto_obtido_id uuid,
  desconto_concedido_id uuid,
  tarifa_bancaria_id uuid,
  updated_by uuid references erp.users(id),
  updated_at timestamptz not null default now(),
  constraint uq_financeiro_naturezas_padrao_org unique (organization_id),
  constraint fk_fnp_juros_pagos foreign key (juros_pagos_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_juros_recebidos foreign key (juros_recebidos_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_multa_paga foreign key (multa_paga_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_multa_recebida foreign key (multa_recebida_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_acrescimo_pago foreign key (acrescimo_pago_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_acrescimo_recebido foreign key (acrescimo_recebido_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_desconto_obtido foreign key (desconto_obtido_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_desconto_concedido foreign key (desconto_concedido_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_fnp_tarifa_bancaria foreign key (tarifa_bancaria_id, organization_id) references erp.financial_categories (id, organization_id)
);
create trigger trg_fnp_audit after insert or update or delete on erp.financeiro_naturezas_padrao for each row execute function erp.audit_row();
create trigger trg_fnp_updated before update on erp.financeiro_naturezas_padrao for each row execute function erp.set_updated_at();
alter table erp.financeiro_naturezas_padrao enable row level security;
alter table erp.financeiro_naturezas_padrao force row level security;
create policy tenant_isolation on erp.financeiro_naturezas_padrao for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- A 0007 dá os quatro privilégios a toda tabela nova; o grant sozinho não tira nada, então o revoke é EXPLÍCITO.
grant select, insert, update on erp.financeiro_naturezas_padrao to erp_app;
revoke delete, truncate on erp.financeiro_naturezas_padrao from erp_app;

comment on table erp.financeiro_naturezas_padrao is 'Naturezas padrão dos componentes da baixa, uma linha por organização (OPERACOES-01 F8, decisão 285): juros, multa e acréscimo viram lançamentos separados com estas naturezas; o desconto grava a sua na baixa; a tarifa exige a sua. Configuração da organização (sem empresa); natureza nula = o componente fica como hoje, dentro do movimento principal.';
comment on column erp.financeiro_naturezas_padrao.id is 'Identidade técnica da linha (a auditoria lê esta coluna).';
comment on column erp.financeiro_naturezas_padrao.organization_id is 'Tenant (organização); uma linha por organização (uq_financeiro_naturezas_padrao_org).';
comment on column erp.financeiro_naturezas_padrao.juros_pagos_id is 'Natureza (despesa) dos juros pagos na baixa de título a pagar. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.juros_recebidos_id is 'Natureza (receita) dos juros recebidos na baixa de título a receber. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.multa_paga_id is 'Natureza (despesa) da multa paga na baixa de título a pagar. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.multa_recebida_id is 'Natureza (receita) da multa recebida na baixa de título a receber. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.acrescimo_pago_id is 'Natureza (despesa) do acréscimo pago na baixa de título a pagar. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.acrescimo_recebido_id is 'Natureza (receita) do acréscimo recebido na baixa de título a receber. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.desconto_obtido_id is 'Natureza (receita) do desconto obtido na baixa de título a pagar. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.desconto_concedido_id is 'Natureza (despesa) do desconto concedido na baixa de título a receber. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.tarifa_bancaria_id is 'Natureza (despesa) da tarifa bancária, na baixa e no lote. Sem ela, baixa com tarifa é recusada. FK composta com a organização.';
comment on column erp.financeiro_naturezas_padrao.updated_by is 'Usuário que alterou a configuração por último.';
comment on column erp.financeiro_naturezas_padrao.updated_at is 'Última alteração (gatilho trg_fnp_updated).';

-- ---------- 5) funções e gatilhos ----------
-- 5.1 A soma das baixas na semântica B. MESMA assinatura, linguagem e corpo da 0004 — só a soma muda. É
-- create or replace: dono e privilégios ficam (a API chama esta função direto, e o erp_app continua executando).
create or replace function erp.refresh_title_status(p_title uuid) returns void language plpgsql as $$
declare v_paid numeric(18,2); v_net numeric(18,2); v_status text;
begin
  select coalesce(sum(amount),0) into v_paid from erp.title_settlements where title_id = p_title and status = 'confirmed';
  select amount - discount, status into v_net, v_status from erp.financial_titles where id = p_title for update;
  if v_status = 'cancelled' then return; end if;
  if v_paid > v_net then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: baixas % excedem líquido %', v_paid, v_net using errcode='P0001';
  end if;
  update erp.financial_titles set paid_amount = v_paid,
    status = case when v_paid = 0 then 'open' when v_paid < v_net then 'partially_paid' else 'paid' end,
    version = version + 1
  where id = p_title;
end $$;

-- 5.2 Movimento confirmado é imutável no que é valor, data, conta, tipo, empresa e rótulo. A mensagem é de NEGÓCIO
-- (uma linha, código conhecido por todo binário: CONFLICT → 409), e é a que o fromPgError entrega ao usuário.
create function erp.bank_movements_confirmado_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: Movimento bancário confirmado não se altera: estorne e lance outro.' using errcode = 'P0001';
end $$;
create trigger trg_bm_confirmado_imutavel
  before update of movement_date, amount, interest, bank_account_id, type, category_type, destination_account_id, empresa_id, tipo_transferencia
  on erp.bank_movements for each row
  when (old.status = 'confirmed'
        and (old.movement_date, old.amount, old.interest, old.bank_account_id, old.type, old.category_type,
             old.destination_account_id, old.empresa_id, old.tipo_transferencia)
            is distinct from
            (new.movement_date, new.amount, new.interest, new.bank_account_id, new.type, new.category_type,
             new.destination_account_id, new.empresa_id, new.tipo_transferencia))
  execute function erp.bank_movements_confirmado_imutavel();

-- 5.3 O crédito do adiantamento (invariante crítica no banco; a API confere antes, este é o fundo). INVOKER: lê sob
-- a RLS de quem grava. O título baixado é lido primeiro (fora do recorte = a mesma NOT_FOUND); o adiantamento é
-- travado FOR UPDATE, então dois usos concorrentes do mesmo crédito se enfileiram e o segundo soma o primeiro (cada
-- comando do plpgsql tira um retrato novo depois da trava). Toda comparação é nula-segura: título ou adiantamento
-- não encontrado nunca vira "passa".
create function erp.baixa_credito_conferir() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
declare
  v_tit record;
  v_adt record;
  v_usado numeric(18,2);
begin
  select t.organization_id, t.direction, t.person_id, t.empresa_id into v_tit
    from erp.financial_titles t where t.id = new.title_id;
  select t.id, t.organization_id, t.direction, t.person_id, t.empresa_id, t.status, t.paid_amount, t.deleted_at,
         (t.payment_type = 'advance' or exists (select 1 from erp.title_types tt where tt.id = t.title_type_id and tt.is_advance)) as eh_adiantamento
    into v_adt
    from erp.financial_titles t where t.id = new.adiantamento_id for update;
  if v_adt.id is null or v_tit.organization_id is null
     or v_tit.organization_id is distinct from new.organization_id or v_adt.organization_id is distinct from new.organization_id
     or v_adt.deleted_at is not null or v_adt.eh_adiantamento is not true or v_adt.status = 'cancelled'
     or v_adt.direction is distinct from v_tit.direction or v_adt.person_id is distinct from v_tit.person_id
     or v_adt.empresa_id is distinct from v_tit.empresa_id then
    raise exception 'NOT_FOUND: Adiantamento não encontrado' using errcode = 'P0001';
  end if;
  select coalesce(sum(s.amount), 0) into v_usado
    from erp.title_settlements s where s.adiantamento_id = new.adiantamento_id and s.status = 'confirmed';
  if v_usado + new.amount > v_adt.paid_amount then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: crédito do adiantamento insuficiente (disponível %, pedido %)', v_adt.paid_amount - v_usado, new.amount using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_ts_credito_conferir before insert on erp.title_settlements for each row
  when (new.adiantamento_id is not null) execute function erp.baixa_credito_conferir();

-- 5.4 A porta do extrato de CONTA, no molde de erp.movimentos_conta_organizacao (0015): a mesma porta estreita, com as
-- colunas que o extrato com saldo real × conciliado precisa — e RECORTADA pelo escopo de empresa de quem pergunta no
-- módulo financeiro (decisão do Maike de 03/10): conta compartilhada por empresas não entrega a quem vê só a empresa A
-- o texto, o documento, a empresa ou o valor dos lançamentos da empresa B.
create function erp.extrato_conta_organizacao(p_contas uuid[] default null, p_de date default null, p_ate date default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, movement_date date, type text, category_type text,
  tipo_transferencia text, amount numeric, interest numeric, note text, document text, source_type text,
  reconciled_at timestamptz, ofx_transaction_id uuid, empresa_id uuid, created_at timestamptz, code text)
language plpgsql stable security definer set search_path = erp, pg_catalog as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
  v_total boolean;
begin
  if v_org is null or v_user is null then
    raise exception 'CONTEXTO_AUSENTE: extrato de conta exige organizacao e usuario na transacao' using errcode = '42501';
  end if;
  -- As MESMAS capacidades da 0015: bank_accounts.view (a de ORGANIZAÇÃO) e bank_movements.view (a financeira por
  -- cima). Sem as duas, esta função não é uma porta.
  if not erp.has_permission(v_org, v_user, 'bank_accounts.view')
     or not erp.has_permission(v_org, v_user, 'bank_movements.view') then
    raise exception 'SEM_CAPACIDADE: extrato organizacional de conta exige bank_accounts.view e bank_movements.view' using errcode = '42501';
  end if;
  -- O ESCOPO DE EMPRESA de quem pergunta, no módulo dos MOVIMENTOS (financeiro, scripts/company-rls-modules.json),
  -- pelas MESMAS funções que a RLS de erp.bank_movements usa (0015), lidas da GUC do servidor (organização e usuário).
  -- O módulo é FIXO aqui: as rotas de conta abrem a transação SEM módulo (bank_accounts.view é capacidade de
  -- organização), e sem módulo o recorte valeria a união das empresas do membro em qualquer módulo. Total
  -- (proprietário ou modo "todas" no financeiro): todos os movimentos, inclusive os sem empresa. Parcial: só os das
  -- empresas nomeadas no financeiro; o movimento sem empresa vale para a organização inteira e fica de fora (a mesma
  -- regra da escrita). Módulo sem configuração: nenhuma empresa (fail-closed). O recorte está no WHERE: o que não
  -- passa não sai desta função de jeito nenhum — nem linha, nem soma, nem contagem.
  v_total := erp.escopo_empresa_total('financeiro') is true;
  return query
    select m.id, m.bank_account_id, a.code, m.movement_date, m.type, m.category_type, m.tipo_transferencia,
           m.amount, m.interest, m.note, m.document, m.source_type, m.reconciled_at, m.ofx_transaction_id,
           m.empresa_id, m.created_at, m.code
      from erp.bank_movements m
      join erp.bank_accounts a on a.id = m.bank_account_id
     where m.organization_id = v_org and a.organization_id = v_org
       and m.status = 'confirmed' and m.deleted_at is null
       and (v_total or m.empresa_id in (select erp.empresas_do_membro('financeiro')))
       and (p_contas is null or m.bank_account_id = any(p_contas))
       and (p_de is null or m.movement_date >= p_de)
       and (p_ate is null or m.movement_date <= p_ate);
end $$;
comment on function erp.extrato_conta_organizacao(uuid[], date, date) is
  'Movimentos CONFIRMADOS das contas bancarias da organizacao atual para o extrato de conta (saldo real x conciliado, fluxo realizado), com tipo de categoria, rotulo da transferencia, origem, conciliacao, empresa e codigo (OPERACOES-01 F8). SECURITY DEFINER estreita no molde de erp.movimentos_conta_organizacao: organizacao da GUC do servidor, capacidades conferidas aqui dentro, tenant por predicado explicito. RECORTADA pelo escopo de empresa de quem pergunta no modulo financeiro (decisao do Maike de 03/10): escopo total (proprietario ou modo todas) ve todos os movimentos, inclusive os sem empresa; parcial, so os das suas empresas. Nao substitui a RLS de erp.bank_movements, que continua recortando por empresa em toda leitura normal.';
revoke execute on function erp.extrato_conta_organizacao(uuid[], date, date) from public;
grant execute on function erp.extrato_conta_organizacao(uuid[], date, date) to erp_app;

comment on function erp.bank_movements_confirmado_imutavel() is 'Gatilho trg_bm_confirmado_imutavel (OPERACOES-01 F8): movimento bancario confirmado nao muda valor, data, conta, tipo, empresa nem rotulo da transferencia; a correcao e estorno + movimento novo.';
comment on function erp.baixa_credito_conferir() is 'Gatilho trg_ts_credito_conferir (OPERACOES-01 F8): a baixa que usa o credito de um adiantamento confere adiantamento vivo, da mesma organizacao, direcao, parceiro e empresa, e credito suficiente (paid_amount menos usos confirmados).';

-- ---------- 6) histórico sem DELETE (o ledger financeiro) ----------
revoke delete, truncate on erp.financial_titles, erp.title_settlements, erp.bank_movements, erp.bank_movement_apportionments from erp_app;
revoke update on erp.bank_movement_apportionments from erp_app;

-- ---------- 7) EXECUTE só do dono nas funções de gatilho novas ----------
-- Não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos (o laço da 0041; os nomes vêm
-- do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('bank_movements_confirmado_imutavel', 'baixa_credito_conferir')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 8) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
begin
  -- As 18 colunas novas nas tabelas de hoje: tipo exato e ANULÁVEIS (sem backfill, nenhuma obrigatória).
  if (select count(*)
        from (values ('erp.bank_accounts'::regclass, 'data_saldo_inicial', 'date'),
                     ('erp.financial_titles'::regclass, 'data_competencia', 'date'),
                     ('erp.financial_titles'::regclass, 'conta_prevista_id', 'uuid'),
                     ('erp.financial_titles'::regclass, 'cancel_reason', 'text'),
                     ('erp.financial_titles'::regclass, 'cancelled_at', 'timestamp with time zone'),
                     ('erp.financial_titles'::regclass, 'cancelled_by', 'uuid'),
                     ('erp.title_settlements'::regclass, 'lote_id', 'uuid'),
                     ('erp.title_settlements'::regclass, 'tarifa', 'numeric(18,2)'),
                     ('erp.title_settlements'::regclass, 'adiantamento_id', 'uuid'),
                     ('erp.title_settlements'::regclass, 'natureza_desconto_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'tipo_transferencia', 'text'),
                     ('erp.bank_movements'::regclass, 'title_settlement_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'componente_baixa', 'text'),
                     ('erp.bank_movements'::regclass, 'lote_baixa_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'cancel_reason', 'text'),
                     ('erp.bank_movements'::regclass, 'cancelled_at', 'timestamp with time zone'),
                     ('erp.bank_movements'::regclass, 'cancelled_by', 'uuid'),
                     ('erp.financial_categories'::regclass, 'grupo_dre', 'text')) e(tabela, coluna, tipo)
        join pg_attribute a on a.attrelid = e.tabela and a.attname = e.coluna and a.attnum > 0 and not a.attisdropped
       where format_type(a.atttypid, a.atttypmod) = e.tipo and not a.attnotnull and not a.atthasdef) <> 18 then
    raise exception 'OPERACOES-01 F8: colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 18 anulaveis sem default).';
  end if;
  -- A tabela nova: existe, com as 13 colunas do contrato, RLS habilitada e forçada, e só a política tenant_isolation.
  if to_regclass('erp.financeiro_naturezas_padrao') is null
     or (select count(*) from pg_attribute where attrelid = 'erp.financeiro_naturezas_padrao'::regclass and attnum > 0 and not attisdropped) <> 13 then
    raise exception 'OPERACOES-01 F8: erp.financeiro_naturezas_padrao ausente ou fora do contrato (13 colunas).';
  end if;
  if not exists (select 1 from pg_class where oid = 'erp.financeiro_naturezas_padrao'::regclass and relrowsecurity and relforcerowsecurity)
     or (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'financeiro_naturezas_padrao')
        is distinct from array['tenant_isolation'] then
    raise exception 'OPERACOES-01 F8: erp.financeiro_naturezas_padrao sem RLS habilitada e forcada, ou com politica diferente de tenant_isolation (uma so).';
  end if;
  -- As chaves (id, organization_id), nessa ordem, e a de organização única da tabela nova.
  if (select count(*) from pg_constraint c
       where c.contype = 'u'
         and ((c.conname in ('uq_bank_accounts_tenant', 'uq_financial_titles_tenant', 'uq_title_settlements_tenant')
               and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id'),
                                    (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[]
               and c.conrelid = case c.conname when 'uq_bank_accounts_tenant' then 'erp.bank_accounts'::regclass
                                               when 'uq_financial_titles_tenant' then 'erp.financial_titles'::regclass
                                               else 'erp.title_settlements'::regclass end)
           or (c.conname = 'uq_financeiro_naturezas_padrao_org' and c.conrelid = 'erp.financeiro_naturezas_padrao'::regclass
               and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[]))) <> 4 then
    raise exception 'OPERACOES-01 F8: chaves unicas (id, organization_id) de bank_accounts/financial_titles/title_settlements ou (organization_id) de financeiro_naturezas_padrao ausentes ou fora da forma.';
  end if;
  -- As 13 FKs COMPOSTAS na ORDEM (coluna, organization_id) → (id, organization_id), no alvo certo e sem ação.
  if (select count(*)
        from (values ('fk_financial_titles_conta_prevista', 'erp.financial_titles'::regclass, 'conta_prevista_id', 'erp.bank_accounts'::regclass),
                     ('fk_title_settlements_adiantamento', 'erp.title_settlements'::regclass, 'adiantamento_id', 'erp.financial_titles'::regclass),
                     ('fk_title_settlements_natureza_desconto', 'erp.title_settlements'::regclass, 'natureza_desconto_id', 'erp.financial_categories'::regclass),
                     ('fk_bank_movements_title_settlement', 'erp.bank_movements'::regclass, 'title_settlement_id', 'erp.title_settlements'::regclass),
                     ('fk_fnp_juros_pagos', 'erp.financeiro_naturezas_padrao'::regclass, 'juros_pagos_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_juros_recebidos', 'erp.financeiro_naturezas_padrao'::regclass, 'juros_recebidos_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_multa_paga', 'erp.financeiro_naturezas_padrao'::regclass, 'multa_paga_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_multa_recebida', 'erp.financeiro_naturezas_padrao'::regclass, 'multa_recebida_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_acrescimo_pago', 'erp.financeiro_naturezas_padrao'::regclass, 'acrescimo_pago_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_acrescimo_recebido', 'erp.financeiro_naturezas_padrao'::regclass, 'acrescimo_recebido_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_desconto_obtido', 'erp.financeiro_naturezas_padrao'::regclass, 'desconto_obtido_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_desconto_concedido', 'erp.financeiro_naturezas_padrao'::regclass, 'desconto_concedido_id', 'erp.financial_categories'::regclass),
                     ('fk_fnp_tarifa_bancaria', 'erp.financeiro_naturezas_padrao'::regclass, 'tarifa_bancaria_id', 'erp.financial_categories'::regclass))
             e(nome, tabela, coluna, alvo)
        join pg_constraint c on c.conname = e.nome and c.conrelid = e.tabela and c.confrelid = e.alvo
       where c.contype = 'f' and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and c.conkey = array[(select attnum from pg_attribute where attrelid = e.tabela and attname = e.coluna),
                              (select attnum from pg_attribute where attrelid = e.tabela and attname = 'organization_id')]::int2[]
         and c.confkey = array[(select attnum from pg_attribute where attrelid = e.alvo and attname = 'id'),
                               (select attnum from pg_attribute where attrelid = e.alvo and attname = 'organization_id')]::int2[]) <> 13 then
    raise exception 'OPERACOES-01 F8: FKs compostas novas ausentes ou fora da forma (coluna, organization_id) -> alvo (id, organization_id), sem cascata (esperadas 13).';
  end if;
  -- As duas FKs da trilha (usuário global, coluna única), sem ação.
  if (select count(*) from pg_constraint c
       where c.contype = 'f' and c.confdeltype = 'a' and c.confupdtype = 'a' and c.confrelid = 'erp.users'::regclass
         and ((c.conname = 'fk_financial_titles_cancelled_by' and c.conrelid = 'erp.financial_titles'::regclass)
           or (c.conname = 'fk_bank_movements_cancelled_by' and c.conrelid = 'erp.bank_movements'::regclass))) <> 2 then
    raise exception 'OPERACOES-01 F8: FKs de cancelled_by (financial_titles, bank_movements) para erp.users ausentes ou com cascata.';
  end if;
  -- Os cinco CHECKs novos, por nome, na tabela certa.
  if (select count(*) from pg_constraint c
       where c.contype = 'c'
         and ((c.conname in ('chk_title_settlements_tarifa', 'chk_title_settlements_adiantamento') and c.conrelid = 'erp.title_settlements'::regclass)
           or (c.conname in ('chk_bank_movements_tipo_transferencia', 'chk_bank_movements_componente_baixa') and c.conrelid = 'erp.bank_movements'::regclass)
           or (c.conname = 'chk_financial_categories_grupo_dre' and c.conrelid = 'erp.financial_categories'::regclass))) <> 5 then
    raise exception 'OPERACOES-01 F8: CHECKs novos (tarifa, adiantamento, tipo_transferencia, componente_baixa, grupo_dre) incompletos (esperados 5).';
  end if;
  -- Os seis índices novos, todos PARCIAIS (só as linhas com a coluna preenchida).
  if (select count(*) from pg_index i
       where i.indexrelid in (to_regclass('erp.idx_financial_titles_conta_prevista'), to_regclass('erp.idx_title_settlements_lote'),
                              to_regclass('erp.idx_title_settlements_adiantamento'), to_regclass('erp.idx_bank_movements_title_settlement'),
                              to_regclass('erp.idx_bank_movements_lote_baixa'), to_regclass('erp.idx_bank_movements_ofx_transaction'))
         and i.indpred is not null) <> 6 then
    raise exception 'OPERACOES-01 F8: indices parciais novos ausentes (conta_prevista, lote, adiantamento, title_settlement, lote_baixa, ofx_transaction; esperados 6).';
  end if;
  -- Gatilhos: o conjunto EXATO por tabela (os de hoje e os novos, nenhum outro), ligados, do tipo e na função certos.
  -- tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE. Os dois novos do ledger têm WHEN; o de imutabilidade
  -- olha exatamente as nove colunas da lista.
  if (select count(*)
        from (values ('erp.title_settlements'::regclass, 'trg_settlement_changed', 1 | 4 | 8 | 16, 'erp.title_settlement_changed()'::regprocedure, false),
                     ('erp.title_settlements'::regclass, 'trg_ts_credito_conferir', 1 | 2 | 4, 'erp.baixa_credito_conferir()'::regprocedure, true),
                     ('erp.bank_movements'::regclass, 'trg_bm_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure, false),
                     ('erp.bank_movements'::regclass, 'trg_bm_confirmado_imutavel', 1 | 2 | 16, 'erp.bank_movements_confirmado_imutavel()'::regprocedure, true),
                     ('erp.financeiro_naturezas_padrao'::regclass, 'trg_fnp_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure, false),
                     ('erp.financeiro_naturezas_padrao'::regclass, 'trg_fnp_updated', 1 | 2 | 16, 'erp.set_updated_at()'::regprocedure, false))
             e(tabela, nome, tipo, funcao, com_when)
        join pg_trigger t on t.tgrelid = e.tabela and t.tgname = e.nome and t.tgtype = e.tipo and t.tgfoid = e.funcao
       where not t.tgisinternal and t.tgenabled = 'O' and (t.tgqual is not null) = e.com_when
         and (e.nome <> 'trg_bm_confirmado_imutavel'
              or (select array_agg(x order by x) from unnest(t.tgattr::int2[]) x)
                 = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                     where a.attrelid = 'erp.bank_movements'::regclass
                       and a.attname in ('movement_date', 'amount', 'interest', 'bank_account_id', 'type', 'category_type',
                                         'destination_account_id', 'empresa_id', 'tipo_transferencia')))) <> 6
     or (select count(*) from pg_trigger t
          where not t.tgisinternal
            and t.tgrelid in ('erp.title_settlements'::regclass, 'erp.bank_movements'::regclass, 'erp.financeiro_naturezas_padrao'::regclass)) <> 6 then
    raise exception 'OPERACOES-01 F8: gatilhos de title_settlements/bank_movements/financeiro_naturezas_padrao ausentes, a mais, desligados, de outro tipo, sem WHEN ou na funcao errada (esperados exatamente 6).';
  end if;
  -- As funções de gatilho novas: INVOKER, search_path fixo, e EXECUTE só do dono.
  if (select count(*) from pg_proc p
       where p.oid in ('erp.bank_movements_confirmado_imutavel()'::regprocedure, 'erp.baixa_credito_conferir()'::regprocedure)
         and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) <> 2
     or exists (select 1 from pg_proc p
                  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid in ('erp.bank_movements_confirmado_imutavel()'::regprocedure, 'erp.baixa_credito_conferir()'::regprocedure)
                   and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'OPERACOES-01 F8: funcoes de gatilho novas fora da forma (sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE so do dono).';
  end if;
  -- A porta do extrato: SECURITY DEFINER estreita, search_path fixo, o erp_app executa e PUBLIC não.
  if not exists (select 1 from pg_proc p
                  where p.oid = 'erp.extrato_conta_organizacao(uuid[],date,date)'::regprocedure
                    and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=erp, pg_catalog'])
     or not has_function_privilege('erp_app', 'erp.extrato_conta_organizacao(uuid[],date,date)', 'execute')
     or has_function_privilege('public', 'erp.extrato_conta_organizacao(uuid[],date,date)', 'execute') then
    raise exception 'OPERACOES-01 F8: erp.extrato_conta_organizacao fora da forma (SECURITY DEFINER estavel, search_path "erp, pg_catalog", EXECUTE do erp_app e nao de PUBLIC).';
  end if;
  -- E recortada pelo escopo de empresa no módulo financeiro (decisão do Maike de 03/10): o total decidido pela função da
  -- RLS e o predicado no WHERE, exatamente — sem eles a porta volta a entregar os movimentos de todas as empresas.
  if position($p$v_total := erp.escopo_empresa_total('financeiro') is true;$p$ in pg_get_functiondef('erp.extrato_conta_organizacao(uuid[],date,date)'::regprocedure)) = 0
     or position($p$and (v_total or m.empresa_id in (select erp.empresas_do_membro('financeiro')))$p$ in pg_get_functiondef('erp.extrato_conta_organizacao(uuid[],date,date)'::regprocedure)) = 0 then
    raise exception 'OPERACOES-01 F8: erp.extrato_conta_organizacao sem o recorte pelo escopo de empresa do modulo financeiro (escopo_empresa_total e empresas_do_membro no WHERE).';
  end if;
  -- A soma das baixas na semântica B, e a API continua chamando a função.
  if position('sum(amount)' in pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure)) = 0
     or position('amount + discount' in pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure)) > 0
     or not has_function_privilege('erp_app', 'erp.refresh_title_status(uuid)', 'execute') then
    raise exception 'OPERACOES-01 F8: erp.refresh_title_status fora da semantica B (sum(amount), sem amount + discount) ou sem EXECUTE do erp_app.';
  end if;
  -- Histórico sem DELETE: o erp_app não apaga nem trunca o ledger, não reescreve o rateio do movimento e, na tabela
  -- nova, só lê, insere e altera.
  if exists (select 1 from unnest(array['erp.financial_titles', 'erp.title_settlements', 'erp.bank_movements', 'erp.bank_movement_apportionments',
                                        'erp.financeiro_naturezas_padrao']) t(tabela)
              where has_table_privilege('erp_app', t.tabela, 'delete') or has_table_privilege('erp_app', t.tabela, 'truncate'))
     or has_table_privilege('erp_app', 'erp.bank_movement_apportionments', 'update')
     -- Um privilégio por chamada: com vários na mesma chamada, has_table_privilege responde "algum deles".
     or not has_table_privilege('erp_app', 'erp.financeiro_naturezas_padrao', 'select')
     or not has_table_privilege('erp_app', 'erp.financeiro_naturezas_padrao', 'insert')
     or not has_table_privilege('erp_app', 'erp.financeiro_naturezas_padrao', 'update') then
    raise exception 'OPERACOES-01 F8: privilegios do erp_app errados (sem delete/truncate no ledger e na tabela nova, sem update no rateio do movimento, select/insert/update na tabela nova).';
  end if;
end $$;
