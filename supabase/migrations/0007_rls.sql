-- =====================================================================
-- 0007 RLS / SEGURANÇA
-- Modelo:
--  * A API (Railway) conecta com o papel erp_app (sem BYPASSRLS) e define, por transação,
--    SET LOCAL app.org_id / app.user_id. As políticas usam erp.current_org_id().
--  * Clientes Supabase (anon/authenticated) só acessam tabelas-raiz do tenant do qual são membros
--    (mapeamento auth.uid() -> erp.users.auth_user_id). Tabelas-filho (itens) não têm política
--    direta: acesso somente via API.
--  * Tabelas de referência (estados, cidades, bancos, NCM, permissões) são somente-leitura.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app nologin noinherit;
  end if;
end $$;
grant usage on schema erp to erp_app;
grant select, insert, update, delete on all tables in schema erp to erp_app;
grant usage, select on all sequences in schema erp to erp_app;
grant execute on all functions in schema erp to erp_app;
alter default privileges in schema erp grant select, insert, update, delete on tables to erp_app;
alter default privileges in schema erp grant usage, select on sequences to erp_app;
alter default privileges in schema erp grant execute on functions to erp_app;

-- Papéis do Supabase (existem apenas no Supabase; criados aqui condicionalmente para ambientes locais)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema erp to authenticated;

-- Usuário ERP a partir do auth.uid() do Supabase (quando disponível) ou do contexto da API
create or replace function erp.effective_user_id() returns uuid language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare v uuid; a uuid;
begin
  v := erp.current_user_id();
  if v is not null then return v; end if;
  if to_regproc('auth.uid') is not null then
    execute 'select auth.uid()' into a;
    if a is not null then select id into v from erp.users where auth_user_id = a; end if;
  end if;
  return v;
end $$;

-- Política padrão: org do contexto (API) ou membro (Supabase)
create or replace function erp.tenant_visible(p_org uuid) returns boolean language sql stable as $$
  select p_org is not null and (
    p_org = erp.current_org_id()
    or (erp.current_org_id() is null and erp.is_member(p_org, erp.effective_user_id()))
  )
$$;

do $$
declare r record;
begin
  for r in
    select c.relname as tbl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'erp' and c.relkind = 'r'
  loop
    execute format('alter table erp.%I enable row level security', r.tbl);
    execute format('alter table erp.%I force row level security', r.tbl);
    if exists (select 1 from information_schema.columns where table_schema='erp' and table_name=r.tbl and column_name='organization_id')
       and r.tbl not in ('organization_members','organizations') then
      execute format('drop policy if exists tenant_isolation on erp.%I', r.tbl);
      execute format('create policy tenant_isolation on erp.%I for all to erp_app, authenticated using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id))', r.tbl);
    end if;
  end loop;
end $$;

-- Tabelas sem organization_id: filhos (acesso via API com política por join no pai) e referência
-- Filhos: a API opera dentro do contexto do tenant; políticas por join garantem isolamento mesmo para erp_app.
create policy child_via_parent on erp.product_packages for all to erp_app using (erp.tenant_visible(organization_id));
create policy ref_read_states on erp.states for select to erp_app, authenticated, anon using (true);
create policy ref_read_cities on erp.cities for select to erp_app, authenticated, anon using (true);
create policy ref_read_banks on erp.banks for select to erp_app, authenticated, anon using (true);
create policy ref_read_ncm on erp.ncm for select to erp_app, authenticated using (true);
create policy ref_read_permissions on erp.permissions for select to erp_app, authenticated using (true);
create policy ref_units on erp.measurement_units for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_title_types on erp.title_types for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_payment_methods on erp.payment_methods for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_species on erp.animal_species for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_categories on erp.animal_categories for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_breeds on erp.breeds for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_idtypes on erp.identification_types for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
create policy ref_eqfam on erp.equipment_families for all to erp_app, authenticated using (organization_id is null or erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

-- Organizações e membros: visíveis para os próprios membros; API vê a org do contexto
create policy org_visible on erp.organizations for select to erp_app, authenticated using (erp.tenant_visible(id));
create policy org_update on erp.organizations for update to erp_app using (id = erp.current_org_id());
create policy org_insert on erp.organizations for insert to erp_app with check (true);
create policy members_visible on erp.organization_members for select to erp_app, authenticated using (erp.tenant_visible(organization_id) or user_id = erp.effective_user_id());
create policy members_write on erp.organization_members for all to erp_app using (organization_id = erp.current_org_id() or erp.current_org_id() is null) with check (organization_id = erp.current_org_id() or erp.current_org_id() is null);
-- Usuários: a API precisa localizar usuários por e-mail no login (sem contexto de org)
create policy users_api on erp.users for all to erp_app using (true) with check (true);
create policy users_self on erp.users for select to authenticated using (id = erp.effective_user_id());
-- Tabelas-filho sem organization_id: política por JOIN com a tabela-pai (primeira FK para tabela com organization_id).
do $$
declare r record; v_parent text; v_col text;
begin
  for r in select c.relname as tbl, c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='erp' and c.relkind='r'
             and not exists (select 1 from information_schema.columns where table_schema='erp' and table_name=c.relname and column_name='organization_id')
             and c.relname not in ('states','cities','banks','ncm','permissions','users','role_permissions','member_farms')
  loop
    select pc.relname, a.attname into v_parent, v_col
    from pg_constraint k join pg_class pc on pc.oid = k.confrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.conrelid = r.oid and k.contype = 'f'
      and exists (select 1 from information_schema.columns where table_schema='erp' and table_name=pc.relname and column_name='organization_id')
    order by k.oid limit 1;
    execute format('drop policy if exists api_child on erp.%I', r.tbl);
    if v_parent is not null then
      execute format('create policy api_child on erp.%I for all to erp_app using (exists (select 1 from erp.%I p where p.id = %I.%I and erp.tenant_visible(p.organization_id))) with check (exists (select 1 from erp.%I p where p.id = %I.%I and erp.tenant_visible(p.organization_id)))', r.tbl, v_parent, r.tbl, v_col, v_parent, r.tbl, v_col);
    else
      execute format('create policy api_child on erp.%I for all to erp_app using (true) with check (true)', r.tbl);
    end if;
    v_parent := null; v_col := null;
  end loop;
end $$;
create policy rp_api on erp.role_permissions for all to erp_app using (true) with check (true);
create policy mf_api on erp.member_farms for all to erp_app using (true) with check (true);
-- Nunca conceder nada ao papel anon além de referência pública.
revoke all on all tables in schema erp from anon;
grant select on erp.states, erp.cities, erp.banks to anon;
