-- =====================================================================
-- 0010 FUNDAÇÃO DE PLATAFORMA (PRE-BASE2-01): idioma e ID Global.
--
-- ESTRITAMENTE ADITIVA. Não altera, renomeia nem remove nada existente; nenhuma estrutura relacionada a
-- `erp.farms`/`farm_id` é tocada (a migração empresa ↔ fazenda é PRE-BASE2-02/03, com plano próprio).
--
-- 1) IDIOMA: idioma padrão da organização + idioma opcional do usuário (precedência usuário › organização
--    › padrão do sistema). Guarda apenas a PREFERÊNCIA; tradução nunca é gravada como dado de negócio.
-- 2) ID GLOBAL: sequência ÚNICA por organização (compartilhada por todas as empresas dela, independente
--    entre organizações) + índice que resolve #N no registro real.
--
-- Nomenclatura: a coluna de empresa das ESTRUTURAS NOVAS já nasce como `empresa_id`
-- (docs/DOMAIN-NAMING-STANDARD.md). A chave estrangeira aponta para `erp.farms` porque é a tabela que
-- hoje materializa Empresa; a renomeação da tabela acontece na migração coordenada, sem afetar esta coluna.
-- =====================================================================

-- ---------- 1) preferência de idioma ----------
alter table erp.organizations add column if not exists default_language text not null default 'pt-BR';
alter table erp.users add column if not exists language text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_default_language_check') then
    alter table erp.organizations add constraint organizations_default_language_check
      check (default_language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_language_check') then
    alter table erp.users add constraint users_language_check
      check (language is null or language ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})*$');
  end if;
end $$;

comment on column erp.organizations.default_language is 'Idioma padrão da organização (BCP 47). Fallback de todo usuário sem idioma próprio.';
comment on column erp.users.language is 'Idioma preferido do usuário (BCP 47). Nulo = usa o idioma da organização.';

-- ---------- 2) ID Global ----------
-- Sequência por organização. Mesmo padrão atômico de erp.next_code (upsert com row lock), em tabela própria
-- porque o ciclo de vida é outro: código é por entidade, ID Global é por organização.
create table if not exists erp.global_id_sequences (
  organization_id uuid primary key references erp.organizations(id),
  last_value bigint not null default 0
);
comment on table erp.global_id_sequences is 'Contador do ID Global por organização. Nunca compartilhado entre organizações.';

create or replace function erp.next_global_id(p_org uuid) returns bigint language plpgsql as $$
declare v bigint;
begin
  if p_org is null then raise exception 'organização obrigatória para alocar ID Global'; end if;
  insert into erp.global_id_sequences (organization_id, last_value) values (p_org, 1)
  on conflict (organization_id) do update set last_value = erp.global_id_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;
comment on function erp.next_global_id(uuid) is 'Aloca o próximo ID Global da organização (atômico sob concorrência). O ID é sempre do banco, nunca do cliente.';

-- Índice de resolução: #N -> registro real. Uma linha por registro elegível (registry em @agro/platform).
create table if not exists erp.global_records (
  organization_id uuid not null references erp.organizations(id),
  global_id bigint not null,
  entity_type text not null,
  entity_id uuid not null,
  empresa_id uuid references erp.farms(id),
  module text not null,
  canonical_route text not null,
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, global_id),
  unique (organization_id, entity_type, entity_id)
);
comment on table erp.global_records is 'Resolve o ID Global no registro real (organização, empresa, tipo, UUID, módulo, rota canônica).';
comment on column erp.global_records.empresa_id is 'Empresa dona do registro (hoje erp.farms). Nulo = registro da organização inteira (cadastro compartilhado).';
comment on column erp.global_records.canonical_route is 'Rota de detalhe resolvida na criação: a URL deriva do registro, nunca o contrário.';

create index if not exists global_records_entity_idx on erp.global_records (organization_id, entity_type);
create index if not exists global_records_empresa_idx on erp.global_records (organization_id, empresa_id);

-- ---------- RLS ----------
-- O laço genérico de 0007 já rodou: tabelas novas declaram a própria política, com a mesma regra de tenant.
alter table erp.global_id_sequences enable row level security;
alter table erp.global_id_sequences force row level security;
drop policy if exists tenant_isolation on erp.global_id_sequences;
create policy tenant_isolation on erp.global_id_sequences for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

alter table erp.global_records enable row level security;
alter table erp.global_records force row level security;
drop policy if exists tenant_isolation on erp.global_records;
create policy tenant_isolation on erp.global_records for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

grant select, insert, update, delete on erp.global_id_sequences, erp.global_records to erp_app;
grant execute on function erp.next_global_id(uuid) to erp_app;
