-- =====================================================================
-- 0042 CADASTRO-AREAS-01 — RETIRO, TIPO DE USO, ÁREA ÚTIL E CLASSIFICADORES
--
-- Estrutura cadastral de área: retiro (agrupador gerencial opcional), tipo de uso
-- fechado (land_use), área útil, situação, posse e classificados de pastagem/solo.
-- Módulo de pastejo ganha planejamento do rodízio; forrageira ganha espécie/cultivar.
--
-- Listas de land_use / status / tenure / pasture_type / soil_texture / relief /
-- grazing_method / main_activity espelham packages/domain/src/tipos-de-uso-da-area.ts
-- (UM dono). Teste lê a CHECK do banco e confere o conjunto.
--
-- BACKFILL (linhas existentes de erp.areas):
--   usable_area_ha = area_ha; land_use = 'pastagem'; status coerente com is_active;
--   tenure = 'propria'. Depois NOT NULL + defaults.
--
-- SEM PostGIS, SEM mexer em kml_geometry, SEM seed de forrageiras, SEM tela do mapa.
-- Trava (2026,76). lock_timeout 2s. Runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 76) then
    raise exception 'CADASTRO-AREAS-01: outra transacao ja detem a trava desta migration (2026,76). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.areas') is null or to_regclass('erp.grazing_modules') is null or to_regclass('erp.fodders') is null then
    raise exception 'CADASTRO-AREAS-01: erp.areas/grazing_modules/fodders ausentes; cadeia de migrations fora de ordem.';
  end if;
  if to_regclass('erp.retiros') is not null then
    raise exception 'CADASTRO-AREAS-01: erp.retiros ja existe; a 0042 ja foi aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'land_use') then
    raise exception 'CADASTRO-AREAS-01: erp.areas.land_use ja existe; a 0042 ja foi aplicada ou ha schema divergente.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'empresa_id') then
    raise exception 'CADASTRO-AREAS-01: erp.areas.empresa_id ausente; aplique a cadeia PRE-BASE2 antes.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'grazing_modules' and column_name = 'empresa_id') then
    raise exception 'CADASTRO-AREAS-01: erp.grazing_modules.empresa_id ausente; aplique a cadeia PRE-BASE2 antes.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'CADASTRO-AREAS-01: papel erp_app ausente.';
  end if;
end $$;

-- ---------- 3) erp.retiros ----------
create table erp.retiros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  code text not null,
  name text not null,
  responsible_person_id uuid references erp.people(id),
  main_activity text not null default 'cria',
  cost_center_id uuid references erp.cost_centers(id),
  color text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_retiros_main_activity check (main_activity in ('cria','recria','engorda','ciclo_completo','leite','lavoura','misto')),
  constraint uq_retiros_empresa_code unique (empresa_id, code),
  constraint retiros_org_id_key unique (organization_id, id),
  constraint retiros_org_empresa_key unique (organization_id, empresa_id, id),
  constraint fk_retiros_empresa foreign key (organization_id, empresa_id) references erp.empresas(organization_id, id)
);

create trigger trg_retiros_updated before update on erp.retiros
  for each row execute function erp.set_updated_at();

comment on table erp.retiros is 'Retiro: setor gerencial opcional da empresa que agrupa pastos (CADASTRO-AREAS-01).';
comment on column erp.retiros.code is 'Código sequencial por empresa (codeEntity retiro).';
comment on column erp.retiros.main_activity is 'Atividade principal do retiro (lista fechada).';
comment on column erp.retiros.responsible_person_id is 'Retireiro/encarregado (erp.people).';
comment on column erp.retiros.cost_center_id is 'Centro de resultado padrão do retiro.';
comment on column erp.retiros.deleted_at is 'Exclusão lógica; o código continua ocupado.';

alter table erp.retiros enable row level security;
alter table erp.retiros force row level security;
create policy tenant_e_empresa on erp.retiros for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));
grant select, insert, update on erp.retiros to erp_app;
revoke delete on erp.retiros from erp_app;
revoke truncate on erp.retiros from erp_app;

-- ---------- 4) erp.grazing_modules — unique composta + colunas de planejamento ----------
alter table erp.grazing_modules
  add constraint grazing_modules_org_empresa_key unique (organization_id, empresa_id, id);

alter table erp.grazing_modules
  add column retiro_id uuid,
  add column grazing_method text not null default 'rotacionado',
  add column rest_days int,
  add column occupation_days int,
  add column planned_paddocks int,
  add column reserve_area_ha numeric(14,4),
  add column support_capacity_rainy_ua_ha numeric(8,3),
  add column support_capacity_dry_ua_ha numeric(8,3),
  add column target_category text,
  add column is_active boolean not null default true;

alter table erp.grazing_modules
  add constraint chk_grazing_modules_method check (grazing_method in ('continuo','rotacionado','alternado','diferido','prv','faixas')),
  add constraint chk_grazing_modules_rest_days check (rest_days is null or rest_days between 1 and 365),
  add constraint chk_grazing_modules_occupation_days check (occupation_days is null or occupation_days between 1 and 365),
  add constraint chk_grazing_modules_planned_paddocks check (planned_paddocks is null or planned_paddocks between 2 and 60),
  add constraint chk_grazing_modules_target_category check (target_category is null or target_category in ('cria','recria','engorda','ciclo_completo','leite')),
  add constraint fk_grazing_modules_retiro foreign key (organization_id, empresa_id, retiro_id)
    references erp.retiros (organization_id, empresa_id, id);

create index ix_grazing_modules_retiro on erp.grazing_modules (retiro_id) where retiro_id is not null;

comment on column erp.grazing_modules.grazing_method is 'Método de pastejo planejado (lista fechada).';
comment on column erp.grazing_modules.rest_days is 'Dias de descanso planejados.';
comment on column erp.grazing_modules.occupation_days is 'Dias de ocupação planejados.';
comment on column erp.grazing_modules.planned_paddocks is 'Nº de piquetes planejado (digitado; não calculado).';
comment on column erp.grazing_modules.retiro_id is 'Retiro opcional do módulo (mesma empresa).';

-- ---------- 5) erp.fodders — espécie, cultivar, descanso de referência ----------
alter table erp.fodders
  add column species text,
  add column cultivar text,
  add column rest_days_min int,
  add column rest_days_max int;

alter table erp.fodders
  add constraint chk_fodders_rest_days check (rest_days_min is null or rest_days_max is null or rest_days_min <= rest_days_max);

comment on column erp.fodders.species is 'Espécie forrageira (texto; sem seed de catálogo nesta fatia).';
comment on column erp.fodders.cultivar is 'Cultivar.';
comment on column erp.fodders.rest_days_min is 'Descanso mínimo de referência (dias).';
comment on column erp.fodders.rest_days_max is 'Descanso máximo de referência (dias).';

-- ---------- 6) erp.areas — colunas novas (anuláveis), backfill, NOT NULL, restrições ----------
alter table erp.areas
  add column retiro_id uuid,
  add column land_use text,
  add column usable_area_ha numeric(14,4),
  add column declared_area_ha numeric(14,4),
  add column status text,
  add column tenure text,
  add column pasture_type text,
  add column formation_year int,
  add column support_capacity_rainy_ua_ha numeric(8,3),
  add column support_capacity_dry_ua_ha numeric(8,3),
  add column max_stocking_ua numeric(10,2),
  add column soil_class text,
  add column soil_texture text,
  add column relief text,
  add column color text,
  add column notes text;

-- Backfill do acervo existente (fail-closed: só preenche NULL; não apaga dado).
update erp.areas set usable_area_ha = area_ha where usable_area_ha is null;
update erp.areas set land_use = 'pastagem' where land_use is null;
update erp.areas set status = case when is_active then 'ativa' else 'inativa' end where status is null;
update erp.areas set tenure = 'propria' where tenure is null;

-- Preflight: nenhuma linha pode ficar sem os obrigatórios após o backfill.
do $$
begin
  if exists (select 1 from erp.areas where usable_area_ha is null or land_use is null or status is null or tenure is null) then
    raise exception 'CADASTRO-AREAS-01: backfill incompleto em erp.areas (usable_area_ha/land_use/status/tenure ainda nulos).';
  end if;
  if exists (select 1 from erp.areas where usable_area_ha > area_ha) then
    raise exception 'CADASTRO-AREAS-01: acervo com usable_area_ha > area_ha; migration recusada (fail-closed).';
  end if;
end $$;

alter table erp.areas alter column usable_area_ha set not null;
alter table erp.areas alter column land_use set not null;
alter table erp.areas alter column status set not null;
alter table erp.areas alter column tenure set not null;
alter table erp.areas alter column land_use set default 'pastagem';
alter table erp.areas alter column status set default 'ativa';
alter table erp.areas alter column tenure set default 'propria';

-- FK composta do módulo: troca a FK simples (organization_id+empresa_id+módulo).
alter table erp.areas drop constraint if exists areas_grazing_module_id_fkey;

alter table erp.areas
  add constraint chk_areas_land_use check (land_use in (
    'pastagem','lavoura','ilp','ilpf','silvipastoril','floresta','confinamento',
    'reserva_legal','app','uso_restrito','vegetacao_nativa','benfeitoria','curral',
    'estrada','aguada','degradada','nao_produtiva'
  )),
  add constraint chk_areas_status check (status in ('ativa','em_formacao','em_reforma','vedada','inativa')),
  add constraint chk_areas_tenure check (tenure in ('propria','arrendada','parceria','comodato')),
  add constraint chk_areas_pasture_type check (pasture_type is null or pasture_type in (
    'nativa','cultivada_perene','cultivada_anual','consorciada','inverno'
  )),
  add constraint chk_areas_soil_texture check (soil_texture is null or soil_texture in (
    'arenosa','media','argilosa','muito_argilosa'
  )),
  add constraint chk_areas_relief check (relief is null or relief in (
    'plano','suave_ondulado','ondulado','forte_ondulado','montanhoso'
  )),
  add constraint chk_areas_usable_area check (usable_area_ha >= 0 and usable_area_ha <= area_ha),
  add constraint chk_areas_declared_area check (declared_area_ha is null or declared_area_ha >= 0),
  add constraint chk_areas_formation_year check (formation_year is null or formation_year between 1900 and 2200),
  add constraint chk_areas_modulo_so_pecuario check (
    grazing_module_id is null
    or land_use in ('pastagem','ilp','ilpf','silvipastoril','confinamento')
  ),
  add constraint fk_areas_retiro foreign key (organization_id, empresa_id, retiro_id)
    references erp.retiros (organization_id, empresa_id, id),
  add constraint fk_areas_grazing_module foreign key (organization_id, empresa_id, grazing_module_id)
    references erp.grazing_modules (organization_id, empresa_id, id);

create index ix_areas_org_empresa_land_use on erp.areas (organization_id, empresa_id, land_use);
create index ix_areas_retiro on erp.areas (retiro_id) where retiro_id is not null;
create index ix_areas_org_empresa_status on erp.areas (organization_id, empresa_id, status);

comment on column erp.areas.land_use is 'Tipo de uso (lista fechada; SSOT no domínio).';
comment on column erp.areas.usable_area_ha is 'Área pastejável/arável (denominador de lotação e custo/ha).';
comment on column erp.areas.declared_area_ha is 'Área de documento (matrícula/CAR), para conciliar.';
comment on column erp.areas.status is 'Situação cadastral da área.';
comment on column erp.areas.tenure is 'Posse da área.';
comment on column erp.areas.retiro_id is 'Retiro opcional (mesma empresa da área).';
comment on column erp.areas.area_ha is 'Área total do polígono (não confundir com usable_area_ha nem declared_area_ha).';

-- ---------- 7) pós-condições ----------
do $$
begin
  if to_regclass('erp.retiros') is null then
    raise exception 'CADASTRO-AREAS-01: pos-condicao falhou — erp.retiros ausente.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'usable_area_ha' and is_nullable = 'NO') then
    raise exception 'CADASTRO-AREAS-01: pos-condicao falhou — usable_area_ha deveria ser NOT NULL.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_areas_land_use' and contype = 'c') then
    raise exception 'CADASTRO-AREAS-01: pos-condicao falhou — chk_areas_land_use ausente.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grazing_modules_org_empresa_key' and contype = 'u') then
    raise exception 'CADASTRO-AREAS-01: pos-condicao falhou — grazing_modules_org_empresa_key ausente.';
  end if;
end $$;
