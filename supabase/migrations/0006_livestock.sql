-- =====================================================================
-- 0006 PECUÁRIA: espécies/categorias/raças, animais (individual e sem identificação),
-- lotes, módulos de pastejo/áreas, cochos, movimentações (compra/venda/nascimento/morte/perda),
-- transferências, manejo (processamento, pesagem, nutrição, sanitário, desmama, apartação),
-- reprodução (estação de monta, touros/sêmen, protocolos, acasalamentos, diagnóstico),
-- confinamento (pátios, setores, currais, dietas, fases, bateladas, trato, leitura de cocho).
-- =====================================================================

create table erp.animal_species (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id), name text not null,
  unique (organization_id, name)
);
create table erp.animal_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id),
  species_id uuid not null references erp.animal_species(id),
  name text not null, sex text check (sex in ('M','F')),
  min_age_months int, max_age_months int, ua_factor numeric(6,3) not null default 1,
  next_category_id uuid references erp.animal_categories(id),   -- evolução automática de rebanho
  unique (species_id, name)
);
create table erp.breeds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id), species_id uuid references erp.animal_species(id), name text not null,
  unique (organization_id, species_id, name)
);
create table erp.identification_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id), name text not null,
  unique (organization_id, name)
);
create table erp.fodders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), description text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.weight_parameters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, param_date date not null, responsible text, description text not null,
  initial_weight numeric(10,2) not null, final_weight numeric(10,2) not null check (final_weight >= initial_weight),
  created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);

-- Módulos de pastejo e áreas (piquetes)
create table erp.grazing_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, module_date date not null, responsible text, description text not null,
  fodder_id uuid references erp.fodders(id),
  color text, control_productivity boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  grazing_module_id uuid references erp.grazing_modules(id),
  code text not null, name text not null, area_ha numeric(14,4) not null default 0,
  kml_geometry jsonb, fodder_id uuid references erp.fodders(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (farm_id, code)
);
alter table erp.requisitions add constraint fk_req_area foreign key (area_id) references erp.areas(id);
alter table erp.title_apportionments add constraint fk_ta_area foreign key (area_id) references erp.areas(id);

-- Confinamento: pátio > setor > curral
create table erp.feedlot_yards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  code text not null, name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), deleted_at timestamptz, unique (farm_id, code)
);
create table erp.feedlot_sectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), yard_id uuid not null references erp.feedlot_yards(id),
  code text not null, name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), deleted_at timestamptz, unique (yard_id, code)
);
create table erp.feedlot_corrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), sector_id uuid not null references erp.feedlot_sectors(id),
  code text not null, name text not null, capacity int not null default 0, area_m2 numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), deleted_at timestamptz, unique (sector_id, code)
);
create table erp.troughs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, type text not null check (type in ('covered','uncovered','drinker')), description text not null,
  length_cm numeric(10,2),
  grazing_module_id uuid references erp.grazing_modules(id), area_id uuid references erp.areas(id), corral_id uuid references erp.feedlot_corrals(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), deleted_at timestamptz, unique (organization_id, code)
);

-- Lotes de animais
create table erp.batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, batch_date date not null, responsible text, description text not null,
  species_id uuid references erp.animal_species(id),
  weight_parameter_id uuid references erp.weight_parameters(id),
  batch_type text not null default 'pasture' check (batch_type in ('pasture','feedlot','breeding','pre_batch')),
  grazing_module_id uuid references erp.grazing_modules(id), area_id uuid references erp.areas(id), corral_id uuid references erp.feedlot_corrals(id),
  diet_id uuid, feeding_phase_id uuid,
  entry_date date, exit_date date,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.batches (organization_id, farm_id, status);
create table erp.batch_categories (
  batch_id uuid not null references erp.batches(id) on delete cascade,
  category_id uuid not null references erp.animal_categories(id),
  primary key (batch_id, category_id)
);

-- Animais (individuais). Animais "sem identificação" são representados por lotes de quantidade (herd_lots)
create table erp.animals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  species_id uuid not null references erp.animal_species(id),
  category_id uuid not null references erp.animal_categories(id),
  breed_id uuid references erp.breeds(id),
  batch_id uuid references erp.batches(id),
  sex text check (sex in ('M','F')),
  entry_date date not null,
  birth_date date,
  reproductive_stage text check (reproductive_stage in ('lactation','multiparous','heifer','nulliparous','primiparous')),
  reproductive_status text check (reproductive_status in ('pregnant','empty','calved')),
  current_weight numeric(10,2), entry_weight numeric(10,2),
  price_kg_alive numeric(18,4), price_arroba_alive numeric(18,4), unit_value numeric(18,2), ua numeric(6,3),
  mother_id uuid references erp.animals(id), father_id uuid references erp.animals(id),
  mother_ref text, father_ref text,
  fur_description text, birth_forecast date,
  proprietary_id uuid references erp.people(id), origin_provider_id uuid references erp.people(id),
  note text,
  depreciation jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','sold','dead','lost','transferred','inventoried')),
  exit_date date,
  photo_path text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on erp.animals (organization_id, farm_id, status);
create index on erp.animals (organization_id, batch_id);
create trigger trg_animals_audit after insert or update or delete on erp.animals for each row execute function erp.audit_row();
create table erp.animal_identifications (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid not null references erp.animals(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id),
  identification_type_id uuid not null references erp.identification_types(id),
  value text not null,
  is_primary boolean not null default false,
  unique (organization_id, identification_type_id, value)
);
-- Rebanho sem identificação: quantidade por categoria/lote (ledger de quantidade)
create table erp.herd_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  batch_id uuid references erp.batches(id),
  species_id uuid not null references erp.animal_species(id),
  category_id uuid not null references erp.animal_categories(id),
  breed_id uuid references erp.breeds(id),
  quantity int not null check (quantity >= 0),
  average_weight numeric(10,2), unit_value numeric(18,2),
  entry_date date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Movimentações de rebanho (ledger) — compra, venda, nascimento, morte, perda, evolução, transferências
create table erp.animal_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  movement_type text not null check (movement_type in ('purchase','sale','birth','death','loss','evolution','batch_transfer','farm_transfer','module_area_transfer','inventory','weaning','separation','processing')),
  movement_date date not null,
  person_id uuid references erp.people(id),          -- fornecedor (compra) / cliente (venda)
  batch_id uuid references erp.batches(id),
  destination_batch_id uuid references erp.batches(id),
  destination_farm_id uuid references erp.farms(id),
  destination_module_id uuid references erp.grazing_modules(id), destination_area_id uuid references erp.areas(id),
  quantity int not null default 0,
  total_weight numeric(12,2), total_value numeric(18,2) not null default 0,
  cause text,                                        -- causa morte/perda
  note text,
  invoice_number text,
  financial_title_id uuid references erp.financial_titles(id),
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, movement_type, code)
);
create index on erp.animal_movements (organization_id, movement_type, movement_date);
create table erp.animal_movement_items (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references erp.animal_movements(id) on delete cascade,
  animal_id uuid references erp.animals(id),
  herd_lot_id uuid references erp.herd_lots(id),
  category_id uuid references erp.animal_categories(id),
  new_category_id uuid references erp.animal_categories(id),
  quantity int not null default 1,
  weight numeric(10,2), unit_value numeric(18,2), total numeric(18,2)
);

-- Processamentos (entrada em lote: pré-lote → processar animais com identificação/pesagem)
create table erp.processings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, processing_date date not null,
  purchase_movement_id uuid references erp.animal_movements(id),
  pre_batch_id uuid references erp.batches(id),
  expected_quantity int not null default 0, processed_quantity int not null default 0,
  status text not null default 'pending' check (status in ('pending','in_progress','finished','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- Manejo: pesagens, nutrição, sanitário, desmama, apartação, localização, pastagem
create table erp.weighings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, weighing_date date not null,
  batch_id uuid references erp.batches(id),
  responsible text, note text,
  animals_count int not null default 0, total_weight numeric(12,2) not null default 0,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.weighing_items (
  id uuid primary key default gen_random_uuid(),
  weighing_id uuid not null references erp.weighings(id) on delete cascade,
  animal_id uuid not null references erp.animals(id),
  weight numeric(10,2) not null check (weight > 0),
  previous_weight numeric(10,2), gmd numeric(8,3)       -- ganho médio diário calculado
);
create index on erp.weighing_items (animal_id);
create table erp.animal_handlings (               -- nutrição, sanitário (aplicações), desmama, apartação
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  handling_type text not null check (handling_type in ('nutrition','sanitary','weaning','separation','pasture','locate')),
  handling_date date not null,
  batch_id uuid references erp.batches(id),
  product_id uuid references erp.products(id), warehouse_id uuid references erp.warehouses(id),
  quantity numeric(18,4), unit_value numeric(18,6), total numeric(18,2) not null default 0,
  withdrawal_until date,                          -- carência
  responsible text, note text,
  animals_count int not null default 0,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.animal_handling_items (
  id uuid primary key default gen_random_uuid(),
  handling_id uuid not null references erp.animal_handlings(id) on delete cascade,
  animal_id uuid references erp.animals(id),
  herd_lot_id uuid references erp.herd_lots(id),
  quantity numeric(18,4) not null default 1,
  dose numeric(18,4),
  new_batch_id uuid references erp.batches(id),
  new_category_id uuid references erp.animal_categories(id)
);

-- Reprodução
create table erp.breeding_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  code text not null, name text not null, start_date date not null, end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(), deleted_at timestamptz, unique (organization_id, code)
);
create table erp.breeding_season_batches (
  season_id uuid not null references erp.breeding_seasons(id) on delete cascade,
  batch_id uuid not null references erp.batches(id),
  primary key (season_id, batch_id)
);
create table erp.breeding_sires (              -- Touros/Sêmen/Embrião
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  season_id uuid not null references erp.breeding_seasons(id) on delete cascade,
  sire_type text not null check (sire_type in ('bull','semen','embryo')),
  animal_id uuid references erp.animals(id), name text, doses int, unit_cost numeric(18,2),
  created_at timestamptz not null default now()
);
create table erp.breeding_protocols (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  season_id uuid not null references erp.breeding_seasons(id) on delete cascade,
  name text not null, description text, steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table erp.matings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  season_id uuid not null references erp.breeding_seasons(id),
  dam_id uuid not null references erp.animals(id),
  sire_id uuid references erp.breeding_sires(id),
  protocol_id uuid references erp.breeding_protocols(id),
  mating_type text not null check (mating_type in ('natural','ai','fta','embryo_transfer')),
  mating_date date not null,
  inseminator_person_id uuid references erp.people(id),
  result text check (result in ('pending','pregnant','empty')),
  diagnosis_date date, expected_birth date,
  note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now()
);
create index on erp.matings (organization_id, season_id, dam_id);

-- Confinamento: dietas, fases, bateladas, trato diário, leitura de cocho
create table erp.diets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, name text not null, description text,
  dry_matter_percent numeric(6,2), cost_per_kg numeric(18,6) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.diet_items (
  id uuid primary key default gen_random_uuid(),
  diet_id uuid not null references erp.diets(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  dry_matter_percent numeric(6,2)
);
create table erp.feeding_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, diet_id uuid references erp.diets(id),
  days_in_phase int, next_phase_id uuid references erp.feeding_phases(id),
  rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), deleted_at timestamptz
);
alter table erp.batches add constraint fk_batches_diet foreign key (diet_id) references erp.diets(id);
alter table erp.batches add constraint fk_batches_phase foreign key (feeding_phase_id) references erp.feeding_phases(id);
create table erp.diet_batches (                -- Batelada (produção de dieta na fábrica/vagão)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  code text not null, batch_date date not null, diet_id uuid not null references erp.diets(id),
  warehouse_id uuid references erp.warehouses(id), equipment_id uuid references erp.equipments(id),
  quantity_kg numeric(18,4) not null check (quantity_kg > 0), total_cost numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), unique (organization_id, code)
);
create table erp.diet_batch_items (
  id uuid primary key default gen_random_uuid(),
  diet_batch_id uuid not null references erp.diet_batches(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  quantity_kg numeric(18,4) not null, unit_cost numeric(18,6) not null default 0, total_cost numeric(18,2) not null default 0
);
create table erp.feed_deliveries (             -- Trato diário (fornecimento por curral/lote)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  delivery_date date not null, delivery_time time,
  diet_batch_id uuid references erp.diet_batches(id), diet_id uuid references erp.diets(id),
  corral_id uuid references erp.feedlot_corrals(id), batch_id uuid references erp.batches(id),
  quantity_kg numeric(18,4) not null check (quantity_kg > 0), cost numeric(18,2) not null default 0,
  created_by uuid references erp.users(id), created_at timestamptz not null default now()
);
create index on erp.feed_deliveries (organization_id, delivery_date, corral_id);
create table erp.trough_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  reading_date date not null, corral_id uuid not null references erp.feedlot_corrals(id),
  score smallint not null check (score between -1 and 4),   -- escala de leitura de cocho
  leftover_kg numeric(18,4), note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (corral_id, reading_date)
);

-- Custo retroativo de animais (ajuste de custo por período)
create table erp.animal_retroactive_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id), farm_id uuid not null references erp.farms(id),
  batch_id uuid references erp.batches(id), period_start date not null, period_end date not null,
  amount numeric(18,2) not null, description text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now()
);
