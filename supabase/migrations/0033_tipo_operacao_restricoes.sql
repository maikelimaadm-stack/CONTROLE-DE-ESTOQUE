-- =====================================================================
-- 0033 TOP-CONFIG-05 — RESTRIÇÕES COMERCIAIS DA TOP (formato 3) — decisão 263
--
-- 1) erp.tipos_operacao_versao_condicoes: as CONDIÇÕES DE PAGAMENTO PERMITIDAS por uma VERSÃO de TOP.
--    Molde: erp.tipos_operacao_versao_destinos (0022). Tabela, e não UUID dentro do JSON da versão: a FK composta
--    prova tenant e existência, e a versão continua imutável (a lista é tão imutável quanto a versão que a ancora).
--    NENHUMA linha para uma versão = SEM RESTRIÇÃO (todas as condições servem). Só executa em versão do formato 3;
--    a regra mora na API (`apps/api/src/routes/vendas-regras-operacao.ts`) e a lista só é gravada para formato 3.
-- 2) erp.situacao_atraso_cliente(cliente, tolerância): PORTA ESTREITA (SECURITY DEFINER) que devolve SÓ AGREGADOS
--    (quantidade, total, vencimento mais antigo) dos títulos a receber vencidos do cliente em TODAS as empresas da
--    organização. Quem lança venda não precisa enxergar o financeiro — e não passa a enxergar: nenhuma linha de
--    título sai daqui. Organização e usuário vêm SÓ da GUC do servidor; a capacidade de lançar venda é reconferida
--    DENTRO; sem ela, zero linhas. "Hoje" = current_date, o MESMO de "vencidos" em apps/api/src/routes/financial.ts.
--
-- SEM BACKFILL: tabela nova vazia; função nova; nenhuma linha existente muda; nenhuma TOP muda sozinha
-- (as TOPs continuam no formato em que foram gravadas — formato 1/2 é legado para sempre).
-- JANELA DE DEPLOY: a API anterior não conhece a tabela nem a função; ordem banco → API → web.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 67) then
    raise exception 'TOP-CONFIG-05: outra transacao ja detem a trava desta migration (2026,67). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.tipos_operacao_versoes') is null then
    raise exception 'TOP-CONFIG-05: erp.tipos_operacao_versoes ausente; a 0022 nao esta aplicada.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'erp.tipos_operacao_versoes'::regclass and contype = 'u'
                  and pg_get_constraintdef(oid) = 'UNIQUE (id, tipo_operacao_id, organization_id)') then
    raise exception 'TOP-CONFIG-05: erp.tipos_operacao_versoes sem unicidade (id, tipo_operacao_id, organization_id); a FK composta depende dela.';
  end if;
  if to_regclass('erp.condicoes_pagamento') is null
     or not exists (select 1 from pg_constraint where conname = 'uq_condicoes_pagamento_tenant' and conrelid = 'erp.condicoes_pagamento'::regclass) then
    raise exception 'TOP-CONFIG-05: erp.condicoes_pagamento/uq_condicoes_pagamento_tenant ausente; aplique a 0031 antes.';
  end if;
  if to_regclass('erp.layouts_documento') is null then
    raise exception 'TOP-CONFIG-05: a 0032 nao esta aplicada (erp.layouts_documento ausente); aplique a 0032 antes.';
  end if;
  if to_regclass('erp.financial_titles') is null then
    raise exception 'TOP-CONFIG-05: erp.financial_titles ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('erp.has_permission(uuid,uuid,text)') is null or to_regprocedure('erp.current_org_id()') is null
     or to_regprocedure('erp.effective_user_id()') is null then
    raise exception 'TOP-CONFIG-05: erp.has_permission/erp.current_org_id/erp.effective_user_id ausente; a porta estreita depende das tres.';
  end if;
  if to_regclass('erp.tipos_operacao_versao_condicoes') is not null
     or to_regprocedure('erp.situacao_atraso_cliente(uuid,integer)') is not null then
    raise exception 'TOP-CONFIG-05: erp.tipos_operacao_versao_condicoes/erp.situacao_atraso_cliente ja existe; a 0033 ja foi aplicada ou ha schema divergente.';
  end if;
  -- A PORTA ESTREITA SÓ FUNCIONA SE O DONO DA FUNÇÃO ATRAVESSA A RLS: sem isso ela devolveria o recorte de empresa
  -- de quem chama — o contrário do que promete (todas as empresas da organização). Quem aplica é o dono.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'TOP-CONFIG-05: o papel que aplica a migration (dono da funcao) nao atravessa RLS; erp.situacao_atraso_cliente nao teria a visao da organizacao.';
  end if;
end $$;

create temporary table _top05_antes on commit drop as
  select (select count(*) from erp.tipos_operacao_versoes) as versoes,
         (select count(*) from erp.financial_titles) as titulos,
         (select count(*) from erp.sales_documents) as documentos;

-- ---------- 3) erp.tipos_operacao_versao_condicoes ----------
create table erp.tipos_operacao_versao_condicoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  -- A ORIGEM é a versão imutável; as duas colunas viajam juntas para a FK composta provar versão, TOP e tenant.
  origem_versao_id uuid not null,
  origem_tipo_operacao_id uuid not null,
  condicao_pagamento_id uuid not null,
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),

  constraint fk_tipos_operacao_versao_condicoes_origem
    foreign key (origem_versao_id, origem_tipo_operacao_id, organization_id)
    references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id),

  -- FK COMPOSTA com organization_id: coluna única não prova tenant. Sem cascade: a exclusão de condição é lógica.
  constraint fk_tipos_operacao_versao_condicoes_condicao
    foreign key (condicao_pagamento_id, organization_id)
    references erp.condicoes_pagamento (id, organization_id),

  constraint uq_tipos_operacao_versao_condicoes
    unique (origem_versao_id, condicao_pagamento_id)
);

comment on table erp.tipos_operacao_versao_condicoes is
  'Condicoes de pagamento PERMITIDAS por uma versao de TOP (formato 3, TOP-CONFIG-05). Nenhuma linha = sem restricao. Imutavel, como a versao que a ancora.';
comment on column erp.tipos_operacao_versao_condicoes.organization_id is 'Tenant (organizacao).';
comment on column erp.tipos_operacao_versao_condicoes.origem_versao_id is 'Versao da TOP que declara a condicao permitida. FK composta com a TOP e o tenant.';
comment on column erp.tipos_operacao_versao_condicoes.origem_tipo_operacao_id is 'TOP da versao de origem (viaja com a versao na FK composta).';
comment on column erp.tipos_operacao_versao_condicoes.condicao_pagamento_id is 'Condicao de pagamento permitida. FK composta com o tenant.';
comment on column erp.tipos_operacao_versao_condicoes.criado_por is 'Usuario que gravou a versao.';
comment on column erp.tipos_operacao_versao_condicoes.criado_em is 'Gravacao da linha.';

-- A consulta REAL: "quais condições esta versão permite?", com a versão do documento na mão.
create index ix_tipos_operacao_versao_condicoes_origem
  on erp.tipos_operacao_versao_condicoes (origem_versao_id);

-- RLS: política ÚNICA (PERMISSIVE combinam com OR e a mais frouxa valeria). Tabela nova não é alcançada pela 0007.
alter table erp.tipos_operacao_versao_condicoes enable row level security;
alter table erp.tipos_operacao_versao_condicoes force row level security;
create policy tenant_isolation on erp.tipos_operacao_versao_condicoes for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

-- Imutável: os default privileges da 0007 dão os quatro privilégios; a revogação é explícita.
grant select, insert on erp.tipos_operacao_versao_condicoes to erp_app;
revoke update, delete on erp.tipos_operacao_versao_condicoes from erp_app;

-- Imutabilidade em gatilho: regra que só existe no grant não sobrevive a papel com mais privilégio.
create or replace function erp.tipos_operacao_versao_condicao_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'TIPO_OPERACAO_CONDICAO_IMUTAVEL: condicao permitida de versao de tipo de operacao nao aceita % (a edicao cria uma versao nova)', TG_OP
    using errcode = 'P0001';
end $$;
revoke execute on function erp.tipos_operacao_versao_condicao_imutavel() from public;

create trigger trg_tipos_operacao_versao_condicoes_imutavel
  before update or delete on erp.tipos_operacao_versao_condicoes
  for each row execute function erp.tipos_operacao_versao_condicao_imutavel();

-- ---------- 4) erp.situacao_atraso_cliente — a porta estreita ----------
-- · SECURITY DEFINER com search_path FIXO; sem SQL dinâmico.
-- · organização = erp.current_org_id(); usuário = erp.effective_user_id() — NUNCA parâmetro do chamador.
-- · reconfere DENTRO a capacidade de lançar QUALQUER variante de venda; sem ela, zero linhas.
-- · devolve SÓ agregados; tolerância fora de 0..365 não amplia nada: zero linhas.
create function erp.situacao_atraso_cliente(p_cliente uuid, p_tolerancia int)
  returns table (titulos int, total numeric, vencimento_mais_antigo date)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null or p_cliente is null or p_tolerancia is null
     or p_tolerancia < 0 or p_tolerancia > 365 then
    return;
  end if;
  if not (erp.has_permission(v_org, v_user, 'budgets.create')
          or erp.has_permission(v_org, v_user, 'orders.create')
          or erp.has_permission(v_org, v_user, 'sales.create')) then
    return;
  end if;
  return query
    select count(*)::int, coalesce(sum(t.balance), 0)::numeric, min(t.due_date)
      from erp.financial_titles t
     where t.organization_id = v_org
       and t.direction = 'receivable'
       and t.person_id = p_cliente
       and t.status in ('open', 'partially_paid')
       and t.deleted_at is null
       and t.balance > 0
       and t.due_date < current_date - p_tolerancia;
end $$;

comment on function erp.situacao_atraso_cliente(uuid, int) is
  'TOP-CONFIG-05: agregados (quantidade, total, vencimento mais antigo) dos titulos a receber vencidos do cliente, alem da tolerancia, em todas as empresas da organizacao da GUC. Porta estreita: exige capacidade de lancar venda; sem ela, zero linhas.';

revoke execute on function erp.situacao_atraso_cliente(uuid, int) from public;
grant execute on function erp.situacao_atraso_cliente(uuid, int) to erp_app;

-- ---------- 5) pós-condições nomeadas ----------
do $$
declare a record;
begin
  select * into a from _top05_antes;
  if (select count(*) from erp.tipos_operacao_versoes) <> a.versoes or (select count(*) from erp.financial_titles) <> a.titulos
     or (select count(*) from erp.sales_documents) <> a.documentos then
    raise exception 'TOP-CONFIG-05: contagem de versoes/titulos/documentos mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.tipos_operacao_versao_condicoes) then
    raise exception 'TOP-CONFIG-05: tabela nova nasceu com linhas; a migration nao grava dados.';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'erp' and c.relname = 'tipos_operacao_versao_condicoes' and c.relrowsecurity and c.relforcerowsecurity) <> 1 then
    raise exception 'TOP-CONFIG-05: RLS de erp.tipos_operacao_versao_condicoes nao esta habilitada e forcada.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'tipos_operacao_versao_condicoes') <> 1
     or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'tipos_operacao_versao_condicoes' and policyname = 'tenant_isolation') <> 1 then
    raise exception 'TOP-CONFIG-05: erp.tipos_operacao_versao_condicoes sem a politica unica tenant_isolation.';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'erp.tipos_operacao_versao_condicoes'::regclass and contype = 'f'
      and conname in ('fk_tipos_operacao_versao_condicoes_origem', 'fk_tipos_operacao_versao_condicoes_condicao')) <> 2 then
    raise exception 'TOP-CONFIG-05: FKs compostas de erp.tipos_operacao_versao_condicoes ausentes.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app') and (
       not has_table_privilege('erp_app', 'erp.tipos_operacao_versao_condicoes', 'select')
       or not has_table_privilege('erp_app', 'erp.tipos_operacao_versao_condicoes', 'insert')
       or has_table_privilege('erp_app', 'erp.tipos_operacao_versao_condicoes', 'update')
       or has_table_privilege('erp_app', 'erp.tipos_operacao_versao_condicoes', 'delete')) then
    raise exception 'TOP-CONFIG-05: grants de erp_app em erp.tipos_operacao_versao_condicoes fora de select+insert.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'erp' and p.proname = 'situacao_atraso_cliente' and p.prosecdef
                    and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) then
    raise exception 'TOP-CONFIG-05: erp.situacao_atraso_cliente ausente, sem SECURITY DEFINER ou sem search_path fixo.';
  end if;
  if has_function_privilege('public', 'erp.situacao_atraso_cliente(uuid,integer)', 'execute') then
    raise exception 'TOP-CONFIG-05: public ainda executa erp.situacao_atraso_cliente; a porta estreita exige revoke.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app')
     and not has_function_privilege('erp_app', 'erp.situacao_atraso_cliente(uuid,integer)', 'execute') then
    raise exception 'TOP-CONFIG-05: erp_app sem execute em erp.situacao_atraso_cliente.';
  end if;
end $$;
