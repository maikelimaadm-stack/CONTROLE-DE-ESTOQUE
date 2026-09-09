-- =====================================================================
-- 0001 FOUNDATION: extensões, tenancy (organizações/fazendas), usuários,
-- perfis/permissões, auditoria, sequências de código, idempotência.
-- Convenções: snake_case, uuid PK, timestamps timestamptz, soft delete via deleted_at,
-- todas as tabelas de negócio possuem organization_id (isolamento) e, quando aplicável, farm_id.
-- =====================================================================
create extension if not exists "pgcrypto";
create extension if not exists "citext";

create schema if not exists erp;
comment on schema erp is 'Domínio do ERP agro (reimplementação própria). Isolado do schema public para convivência com outros apps.';

-- ---------- helpers ----------
create or replace function erp.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Contexto de tenant para a API (SET LOCAL app.org_id / app.user_id dentro da transação)
create or replace function erp.current_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
create or replace function erp.current_user_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------- tenancy ----------
create table erp.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  document text,                       -- CNPJ/CPF do contratante
  slug citext unique,
  parameters jsonb not null default '{}'::jsonb,   -- parametrizações do tenant (ex.: calc_icms_desonerado, financial_freeze_scope)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_org_updated before update on erp.organizations for each row execute function erp.set_updated_at();

-- Usuários da aplicação. auth_user_id referencia auth.users do Supabase quando AUTH_MODE=supabase.
create table erp.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email citext not null unique,
  name text not null,
  phone text,
  password_hash text,                  -- somente AUTH_MODE=local (dev/test). Nunca exposto.
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_users_updated before update on erp.users for each row execute function erp.set_updated_at();

-- Fazendas (unidades/filiais) de uma organização
create table erp.farms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code int not null,
  name text not null,
  legal_name text,
  document text,
  state_registration text,
  address_street text, address_number text, address_complement text, address_district text,
  address_city text, address_state char(2), address_zip text,
  area_ha numeric(14,4),
  latitude numeric(10,7), longitude numeric(10,7),
  is_active boolean not null default true,
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.farms (organization_id) where deleted_at is null;
create trigger trg_farms_updated before update on erp.farms for each row execute function erp.set_updated_at();

-- Perfis (roles) por organização, com conjunto de permissões (chaves textuais como no catálogo)
create table erp.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null,
  description text,
  is_system boolean not null default false,   -- "Administrador" não pode ser removido
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, name)
);
create trigger trg_roles_updated before update on erp.roles for each row execute function erp.set_updated_at();

-- Catálogo de permissões (chave => grupo/rótulo). Populado por migration de dados.
create table erp.permissions (
  key text primary key,
  module text not null,
  resource text not null,
  action text not null,
  label text not null
);

create table erp.role_permissions (
  role_id uuid not null references erp.roles(id) on delete cascade,
  permission_key text not null references erp.permissions(key),
  primary key (role_id, permission_key)
);

-- Vínculo usuário x organização (multi-organização) com perfil e escopo de fazendas
create table erp.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  user_id uuid not null references erp.users(id),
  role_id uuid references erp.roles(id),
  is_owner boolean not null default false,     -- proprietário/administrador: todas as permissões
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index on erp.organization_members (user_id);
create trigger trg_members_updated before update on erp.organization_members for each row execute function erp.set_updated_at();

-- Fazendas às quais o membro tem acesso (vazio = todas)
create table erp.member_farms (
  member_id uuid not null references erp.organization_members(id) on delete cascade,
  farm_id uuid not null references erp.farms(id) on delete cascade,
  primary key (member_id, farm_id)
);

-- Favoritos do usuário (atalhos de menu), como no menu "Favoritos"
create table erp.user_favorites (
  user_id uuid not null references erp.users(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id) on delete cascade,
  route text not null,
  label text not null,
  position int not null default 0,
  primary key (user_id, organization_id, route)
);

-- Função de autorização usada por RLS/serviços
create or replace function erp.has_permission(p_org uuid, p_user uuid, p_key text) returns boolean
language sql stable security definer set search_path = erp, pg_temp as $$
  select exists (
    select 1 from erp.organization_members m
    where m.organization_id = p_org and m.user_id = p_user and m.is_active
      and (m.is_owner or exists (select 1 from erp.role_permissions rp where rp.role_id = m.role_id and rp.permission_key = p_key))
  )
$$;

create or replace function erp.is_member(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = erp, pg_temp as $$
  select exists (select 1 from erp.organization_members m where m.organization_id = p_org and m.user_id = p_user and m.is_active)
$$;

-- ---------- sequências de código por organização/entidade ----------
create table erp.code_sequences (
  organization_id uuid not null references erp.organizations(id),
  entity text not null,
  last_value bigint not null default 0,
  primary key (organization_id, entity)
);
-- Próximo código, atômico (row lock). Uso: select erp.next_code(org, 'product')
create or replace function erp.next_code(p_org uuid, p_entity text) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into erp.code_sequences (organization_id, entity, last_value) values (p_org, p_entity, 1)
  on conflict (organization_id, entity) do update set last_value = erp.code_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;

-- ---------- auditoria ----------
create table erp.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  entity text not null,
  entity_id text not null,
  action text not null,               -- create | update | delete | confirm | cancel | reverse | login | ...
  before jsonb,
  after jsonb,
  metadata jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index on erp.audit_logs (organization_id, entity, entity_id);
create index on erp.audit_logs (organization_id, created_at desc);

-- Trigger genérico de auditoria (usado nas tabelas de negócio)
create or replace function erp.audit_row() returns trigger language plpgsql security definer as $$
declare v_org uuid; v_id text;
begin
  if tg_op = 'DELETE' then
    v_org := coalesce((to_jsonb(old)->>'organization_id')::uuid, erp.current_org_id()); v_id := (to_jsonb(old)->>'id');
    insert into erp.audit_logs(organization_id,user_id,entity,entity_id,action,before) values (v_org, erp.current_user_id(), tg_table_name, v_id, 'delete', to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_org := coalesce((to_jsonb(new)->>'organization_id')::uuid, erp.current_org_id()); v_id := (to_jsonb(new)->>'id');
    insert into erp.audit_logs(organization_id,user_id,entity,entity_id,action,before,after) values (v_org, erp.current_user_id(), tg_table_name, v_id, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    v_org := coalesce((to_jsonb(new)->>'organization_id')::uuid, erp.current_org_id()); v_id := (to_jsonb(new)->>'id');
    insert into erp.audit_logs(organization_id,user_id,entity,entity_id,action,after) values (v_org, erp.current_user_id(), tg_table_name, v_id, 'create', to_jsonb(new));
    return new;
  end if;
end $$;

-- ---------- idempotência ----------
create table erp.idempotency_keys (
  organization_id uuid not null references erp.organizations(id),
  key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);

-- ---------- notificações ----------
create table erp.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  user_id uuid references erp.users(id),          -- null = todos da organização
  kind text not null,                             -- purchase_pending | processing_pending | birthday | batch_transfer | stock_min | title_due
  title text not null,
  body text,
  route text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on erp.notifications (organization_id, user_id, read_at);

-- ---------- anexos (Supabase Storage) ----------
create table erp.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  entity text not null,
  entity_id uuid not null,
  bucket text not null default 'erp-attachments',
  object_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  description text,
  uploaded_by uuid references erp.users(id),
  created_at timestamptz not null default now()
);
create index on erp.attachments (organization_id, entity, entity_id);
