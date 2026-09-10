-- =====================================================================
-- 0008 PERSONALIZAÇÃO DE TELAS ("modelo base")
-- Preferências de listagem / layout de formulário / filtros por (organização, usuário, módulo, tela).
-- user_id NULL = padrão da organização (definido por administrador); a preferência do usuário tem precedência.
-- O documento JSON é validado pelo mesmo código no cliente e na API (@agro/shared/preferences).
-- =====================================================================
create table erp.user_screen_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  user_id uuid references erp.users(id),
  module text not null check (module ~ '^[a-z0-9_.-]{1,64}$'),
  screen text not null check (screen ~ '^[a-z0-9_.-]{1,64}$'),
  schema_version int not null default 1,
  preferences jsonb not null default '{}'::jsonb,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_column_size(preferences) <= 262144)
);
create unique index ux_user_screen_preferences on erp.user_screen_preferences (organization_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), module, screen);
create index on erp.user_screen_preferences (organization_id, user_id);
create trigger trg_usp_updated before update on erp.user_screen_preferences for each row execute function erp.set_updated_at();

alter table erp.user_screen_preferences enable row level security;
alter table erp.user_screen_preferences force row level security;
create policy tenant_isolation on erp.user_screen_preferences for all to erp_app, authenticated using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update, delete on erp.user_screen_preferences to erp_app;

-- Relatórios personalizados (colunas, filtros, agrupamento) salvos por organização; user_id NULL = compartilhado.
create table erp.saved_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  user_id uuid references erp.users(id),
  resource_key text not null check (resource_key ~ '^[a-z0-9_]{1,64}$'),
  name text not null check (length(name) between 1 and 80),
  definition jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (pg_column_size(definition) <= 262144)
);
create index on erp.saved_reports (organization_id, resource_key);
create trigger trg_saved_reports_updated before update on erp.saved_reports for each row execute function erp.set_updated_at();
alter table erp.saved_reports enable row level security;
alter table erp.saved_reports force row level security;
create policy tenant_isolation on erp.saved_reports for all to erp_app, authenticated using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update, delete on erp.saved_reports to erp_app;
