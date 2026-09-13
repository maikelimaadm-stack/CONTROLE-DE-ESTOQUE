-- =====================================================================
-- 0010 FUNDAÇÃO DE PLATAFORMA (PRE-BASE2-01): idioma e ID Global.
--
-- ESTRITAMENTE ADITIVA. Não altera, renomeia nem remove nada existente; nenhuma estrutura da infraestrutura
-- que hoje materializa Empresa é tocada (a migração de nomes é PRE-BASE2-02/03, com plano próprio).
--
-- 1) IDIOMA: idioma padrão da organização + idioma opcional do usuário (precedência usuário › organização
--    › padrão do sistema). Guarda apenas a PREFERÊNCIA; tradução nunca é gravada como dado de negócio.
-- 2) ID GLOBAL: sequência ÚNICA por organização (compartilhada por todas as empresas dela, independente
--    entre organizações) + índice que resolve #N no registro real.
--
-- NOMENCLATURA (docs/DOMAIN-NAMING-STANDARD.md): estrutura nova e inteiramente nossa nasce com o nome
-- canônico em português, antes do primeiro merge — é o momento barato. Exceção consciente e documentada:
-- `organization_id` permanece em inglês porque é convenção transversal das 176 tabelas e das políticas de
-- RLS; converge junto com todas elas em DATA-GOV, não isoladamente aqui.
-- =====================================================================

-- ---------- 1) preferência de idioma ----------
alter table erp.organizations add column if not exists idioma_padrao text not null default 'pt-BR';
alter table erp.users add column if not exists idioma text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_idioma_padrao_check') then
    alter table erp.organizations add constraint organizations_idioma_padrao_check
      check (idioma_padrao ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_idioma_check') then
    alter table erp.users add constraint users_idioma_check
      check (idioma is null or idioma ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})*$');
  end if;
end $$;

comment on column erp.organizations.idioma_padrao is 'Idioma padrão da organização (BCP 47). Reserva de todo usuário sem idioma próprio.';
comment on column erp.users.idioma is 'Idioma preferido do usuário (BCP 47). Nulo = usa o idioma da organização.';

-- ---------- 2) ID Global ----------
-- Sequência por organização. Mesmo padrão atômico das sequências de código (upsert com trava de linha), em
-- tabela própria porque o ciclo de vida é outro: código é por entidade, ID Global é por organização.
create table if not exists erp.sequencias_id_global (
  organization_id uuid primary key references erp.organizations(id),
  ultimo_valor bigint not null default 0
);
comment on table erp.sequencias_id_global is 'Contador do ID Global por organização. Nunca compartilhado entre organizações.';

create or replace function erp.proximo_id_global(p_org uuid) returns bigint language plpgsql as $$
declare v bigint;
begin
  if p_org is null then raise exception 'organização obrigatória para alocar ID Global'; end if;
  insert into erp.sequencias_id_global (organization_id, ultimo_valor) values (p_org, 1)
  on conflict (organization_id) do update set ultimo_valor = erp.sequencias_id_global.ultimo_valor + 1
  returning ultimo_valor into v;
  return v;
end $$;
comment on function erp.proximo_id_global(uuid) is 'Aloca o próximo ID Global da organização (atômico sob concorrência). O ID é sempre do banco, nunca do cliente.';

-- Índice de resolução: #N -> registro real. Uma linha por registro elegível (registry em @erp/plataforma).
create table if not exists erp.registros_globais (
  organization_id uuid not null references erp.organizations(id),
  id_global bigint not null,
  tipo_entidade text not null,
  id_entidade uuid not null,
  empresa_id uuid references erp.farms(id),
  modulo text not null,
  rota_canonica text not null,
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),
  primary key (organization_id, id_global),
  unique (organization_id, tipo_entidade, id_entidade)
);
comment on table erp.registros_globais is 'Resolve o ID Global no registro real (organização, empresa, tipo, identificador, módulo, rota canônica).';
comment on column erp.registros_globais.empresa_id is 'Empresa dona do registro. Nulo = registro da organização inteira (cadastro compartilhado).';
comment on column erp.registros_globais.rota_canonica is 'Rota de detalhe resolvida na criação: a URL deriva do registro, nunca o contrário. Entidade com variantes é reresolvida na leitura, a partir do próprio registro.';

create index if not exists registros_globais_tipo_idx on erp.registros_globais (organization_id, tipo_entidade);
create index if not exists registros_globais_empresa_idx on erp.registros_globais (organization_id, empresa_id);

-- ---------- RLS ----------
-- O laço genérico de 0007 já rodou: tabelas novas declaram a própria política, com a mesma regra de tenant.
alter table erp.sequencias_id_global enable row level security;
alter table erp.sequencias_id_global force row level security;
drop policy if exists tenant_isolation on erp.sequencias_id_global;
create policy tenant_isolation on erp.sequencias_id_global for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

alter table erp.registros_globais enable row level security;
alter table erp.registros_globais force row level security;
drop policy if exists tenant_isolation on erp.registros_globais;
create policy tenant_isolation on erp.registros_globais for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

grant select, insert, update, delete on erp.sequencias_id_global, erp.registros_globais to erp_app;
grant execute on function erp.proximo_id_global(uuid) to erp_app;
