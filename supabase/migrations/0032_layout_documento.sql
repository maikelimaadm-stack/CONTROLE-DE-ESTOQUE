-- =====================================================================
-- 0032 VENDAS-A3-1 — LAYOUT DO DOCUMENTO POR TOP
--
-- Cadastro novo, de ORGANIZAÇÃO (sem empresa_id): erp.layouts_documento — a estrutura de campos (cabeçalho, rodapé,
-- itens) da Central de vendas para uma família (vendas.orcamento / vendas.pedido / vendas.venda). A conta ÚNICA
-- (catálogo, validação, resolução ligado → padrão → sistema) mora no domínio: `packages/domain/src/layout-documento.ts`.
--   · código sequencial (`codeEntity` "layout_documento") por `erp.next_code` — nada a registrar aqui;
--   · unicidade do código INCLUI os excluídos; a do nome é só entre os vivos;
--   · NO MÁXIMO UM PADRÃO ativo e vivo por (organização, família) — garantia do BANCO (índice parcial);
--   · exclusão é lógica (deleted_at): o DELETE é revogado de erp_app.
-- erp.layout_documento_tops: ligação TOP → layout. tipo_operacao_id é a PK (uma TOP tem no máximo um layout).
--   FKs COMPOSTAS com organization_id (provam o mesmo tenant) e trigger que recusa TOP de família diferente
--   da do layout (invariante crítica no banco; a API confere antes e responde 422).
--   DECISÃO: erp_app tem DELETE na ligação. Desligar uma TOP é apagar a linha de ligação — configuração
--   substituível, não dado de negócio nem histórico (a trilha fica na auditoria da API).
--
-- SEM BACKFILL: tabelas novas vazias; nenhuma linha existente muda.
-- JANELA DE DEPLOY: a API anterior não conhece as tabelas; sem layout, a Central usa o layout do sistema.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 66) then
    raise exception 'VENDAS-A3-1: outra transacao ja detem a trava desta migration (2026,66). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.condicoes_pagamento') is null then
    raise exception 'VENDAS-A3-1: a 0031 nao esta aplicada (erp.condicoes_pagamento ausente); aplique a 0031 antes.';
  end if;
  if to_regclass('erp.tipos_operacao') is null then
    raise exception 'VENDAS-A3-1: erp.tipos_operacao nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_tenant' and conrelid = 'erp.tipos_operacao'::regclass) then
    raise exception 'VENDAS-A3-1: erp.tipos_operacao sem uq_tipos_operacao_tenant (id, organization_id); a FK composta depende dela.';
  end if;
  if to_regclass('erp.layouts_documento') is not null or to_regclass('erp.layout_documento_tops') is not null then
    raise exception 'VENDAS-A3-1: erp.layouts_documento/erp.layout_documento_tops ja existe; a 0032 ja foi aplicada ou ha schema divergente.';
  end if;
end $$;

create temporary table _a31_antes on commit drop as
  select (select count(*) from erp.sales_documents) as documentos,
         (select count(*) from erp.tipos_operacao) as tops;

-- ---------- 3) erp.layouts_documento ----------
create table erp.layouts_documento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,
  nome text not null,
  familia text not null constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda')),
  padrao boolean not null default false,
  estrutura jsonb not null
    constraint chk_layouts_documento_estrutura check (jsonb_typeof(estrutura) = 'object' and octet_length(estrutura::text) <= 65536),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_layouts_documento_tenant unique (id, organization_id),
  constraint uq_layouts_documento_codigo unique (organization_id, code)
);
create unique index ux_layouts_documento_nome_vivo on erp.layouts_documento (organization_id, lower(nome)) where deleted_at is null;
create unique index ux_layouts_documento_padrao on erp.layouts_documento (organization_id, familia)
  where padrao and is_active and deleted_at is null;
create trigger trg_layouts_documento_updated before update on erp.layouts_documento for each row execute function erp.set_updated_at();

comment on table erp.layouts_documento is 'Layout do documento (VENDAS-A3-1): estrutura de campos da Central de vendas por família. Sem empresa_id. Conta única no domínio (layout-documento.ts).';
comment on column erp.layouts_documento.id is 'Identidade técnica (UUID).';
comment on column erp.layouts_documento.organization_id is 'Tenant (organização).';
comment on column erp.layouts_documento.code is 'Código sequencial gerado pela API (codeEntity layout_documento); único na organização, incluindo os excluídos.';
comment on column erp.layouts_documento.nome is 'Nome do layout; único (sem diferenciar maiúsculas) entre os vivos da organização.';
comment on column erp.layouts_documento.familia is 'Família canônica do documento: vendas.orcamento, vendas.pedido ou vendas.venda.';
comment on column erp.layouts_documento.padrao is 'Padrão da família: usado por TOP sem layout ligado. No máximo um ativo e vivo por organização e família.';
comment on column erp.layouts_documento.estrutura is 'EstruturaLayout (versaoSchema 1) validada pelo domínio; objeto JSON de até 64 KiB.';
comment on column erp.layouts_documento.is_active is 'Ativo: layout inativo não é padrão nem é oferecido.';
comment on column erp.layouts_documento.created_at is 'Criação do registro.';
comment on column erp.layouts_documento.updated_at is 'Última alteração (erp.set_updated_at).';
comment on column erp.layouts_documento.deleted_at is 'Exclusão lógica; o código continua ocupado.';

alter table erp.layouts_documento enable row level security;
alter table erp.layouts_documento force row level security;
create policy tenant_isolation on erp.layouts_documento for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- Os default privileges da 0007 concedem delete; a exclusão é lógica, então o revoke é EXPLÍCITO e vem depois.
grant select, insert, update on erp.layouts_documento to erp_app;
revoke delete on erp.layouts_documento from erp_app;

-- ---------- 4) erp.layout_documento_tops ----------
create table erp.layout_documento_tops (
  tipo_operacao_id uuid primary key,
  organization_id uuid not null references erp.organizations(id),
  layout_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint fk_layout_documento_tops_layout foreign key (layout_id, organization_id)
    references erp.layouts_documento (id, organization_id),
  constraint fk_layout_documento_tops_tipo_operacao foreign key (tipo_operacao_id, organization_id)
    references erp.tipos_operacao (id, organization_id)
);
create index ix_layout_documento_tops_layout on erp.layout_documento_tops (organization_id, layout_id);

-- A família da TOP (codigo_base) tem de ser a do layout. SECURITY INVOKER: os lookups valem sob a RLS do chamador;
-- TOP ou layout invisíveis não são encontrados e a gravação é recusada (fail-closed).
create function erp.layout_documento_tops_confere_familia() returns trigger
language plpgsql set search_path = pg_catalog, erp as $$
declare
  v_familia_top text;
  v_familia_layout text;
begin
  select t.codigo_base into v_familia_top from erp.tipos_operacao t
   where t.id = new.tipo_operacao_id and t.organization_id = new.organization_id;
  select l.familia into v_familia_layout from erp.layouts_documento l
   where l.id = new.layout_id and l.organization_id = new.organization_id;
  if v_familia_top is null or v_familia_layout is null or v_familia_top <> v_familia_layout then
    raise exception 'VENDAS-A3-1: a familia da TOP (%) difere da familia do layout (%).', v_familia_top, v_familia_layout
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function erp.layout_documento_tops_confere_familia() from public;
create trigger trg_layout_documento_tops_familia before insert or update on erp.layout_documento_tops
  for each row execute function erp.layout_documento_tops_confere_familia();

comment on table erp.layout_documento_tops is 'Ligação TOP → layout do documento (VENDAS-A3-1). Uma TOP tem no máximo um layout; a família da TOP tem de ser a do layout (trigger).';
comment on column erp.layout_documento_tops.tipo_operacao_id is 'TOP ligada (PK: no máximo um layout por TOP). FK composta com organization_id.';
comment on column erp.layout_documento_tops.organization_id is 'Tenant (organização).';
comment on column erp.layout_documento_tops.layout_id is 'Layout ligado. FK composta com organization_id.';
comment on column erp.layout_documento_tops.created_at is 'Criação da ligação.';
comment on column erp.layout_documento_tops.created_by is 'Usuário que criou a ligação.';

alter table erp.layout_documento_tops enable row level security;
alter table erp.layout_documento_tops force row level security;
create policy tenant_isolation on erp.layout_documento_tops for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update, delete on erp.layout_documento_tops to erp_app;

-- ---------- 5) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _a31_antes;
  if (select count(*) from erp.sales_documents) <> a.documentos or (select count(*) from erp.tipos_operacao) <> a.tops then
    raise exception 'VENDAS-A3-1: contagem de erp.sales_documents/erp.tipos_operacao mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.layouts_documento) or exists (select 1 from erp.layout_documento_tops) then
    raise exception 'VENDAS-A3-1: tabela nova nasceu com linhas; a migration nao grava dados.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'layouts_documento') <> 1
     or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'layouts_documento' and policyname = 'tenant_isolation') <> 1
     or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'layout_documento_tops') <> 1
     or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'layout_documento_tops' and policyname = 'tenant_isolation') <> 1 then
    raise exception 'VENDAS-A3-1: tabelas novas sem a politica unica tenant_isolation.';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'erp' and c.relname in ('layouts_documento', 'layout_documento_tops') and c.relrowsecurity and c.relforcerowsecurity) <> 2 then
    raise exception 'VENDAS-A3-1: RLS das tabelas novas nao esta habilitada e forcada.';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'erp' and indexname = 'ux_layouts_documento_padrao') then
    raise exception 'VENDAS-A3-1: indice ux_layouts_documento_padrao ausente.';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'erp.layout_documento_tops'::regclass and contype = 'f' and array_length(conkey, 1) = 2) <> 2 then
    raise exception 'VENDAS-A3-1: FKs compostas de erp.layout_documento_tops ausentes.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app') and has_table_privilege('erp_app', 'erp.layouts_documento', 'delete') then
    raise exception 'VENDAS-A3-1: erp_app ainda tem DELETE em erp.layouts_documento; a exclusao e logica.';
  end if;
end $$;
