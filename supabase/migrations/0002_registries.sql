-- =====================================================================
-- 0002 CADASTROS BASE: centros de custo, safras, produtos (grupo/categoria/classe),
-- unidades, NCM, endereçamentos, armazéns, rateios, pessoas unificadas
-- (fornecedor/cliente/funcionário/proprietário), contas bancárias, categorias
-- financeiras, plano de contas, fiscais, RH, bens/ativos, agrícolas, pecuários.
-- =====================================================================

-- ---------- Localidades (referência, sem tenant) ----------
create table erp.states (code char(2) primary key, name text not null, ibge_code int);
create table erp.cities (
  id int primary key,                 -- código IBGE
  name text not null,
  state_code char(2) not null references erp.states(code)
);
create index on erp.cities (state_code, name);

create table erp.banks (code text primary key, name text not null);

create table erp.measurement_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id),    -- null = padrão do sistema
  symbol text not null,
  name text not null,
  decimals smallint not null default 2 check (decimals between 0 and 6),
  unique (organization_id, symbol)
);

create table erp.ncm (code text primary key, description text not null);

-- ---------- Centros de custo (hierárquico, código 1.01.001.0001) ----------
create table erp.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  parent_id uuid references erp.cost_centers(id),
  code text not null,
  name text not null,
  kind text not null default 'analytic' check (kind in ('synthetic','analytic')),
  activity_type text check (activity_type in ('custeio','investimento','a_definir')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.cost_centers (organization_id, parent_id);
create trigger trg_cc_updated before update on erp.cost_centers for each row execute function erp.set_updated_at();
create trigger trg_cc_audit after insert or update or delete on erp.cost_centers for each row execute function erp.audit_row();

-- Vínculo fazenda x centros de custo (tela Fazendas: "centers[]")
create table erp.farm_cost_centers (
  farm_id uuid not null references erp.farms(id) on delete cascade,
  cost_center_id uuid not null references erp.cost_centers(id) on delete cascade,
  primary key (farm_id, cost_center_id)
);

-- ---------- Safras ----------
create table erp.harvests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  description text not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  herd_control text not null default 'individual' check (herd_control in ('individual','batch')),
  auto_evolution boolean not null default true,
  first_semester_month smallint check (first_semester_month between 1 and 12),
  second_semester_month smallint check (second_semester_month between 1 and 12),
  is_active boolean not null default true,
  is_current boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on erp.harvests (organization_id);
create trigger trg_harvests_updated before update on erp.harvests for each row execute function erp.set_updated_at();

-- ---------- Produtos: grupo > categoria > classe ----------
create table erp.product_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, is_active boolean not null default true,
  unique (organization_id, name)
);
create table erp.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  group_id uuid not null references erp.product_groups(id),
  name text not null, is_active boolean not null default true,
  unique (group_id, name)
);
create table erp.product_kinds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  category_id uuid not null references erp.product_categories(id),
  name text not null, is_active boolean not null default true,
  unique (category_id, name)
);

-- Endereçamentos (setor > corredor > prateleira > nível)
create table erp.addressings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  parent_id uuid references erp.addressings(id),
  description text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on erp.addressings (organization_id, parent_id);

-- Armazéns (por fazenda)
create table erp.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  initials text not null,
  description text not null,
  type text not null default 'inputs' check (type in ('inputs','production','formulation')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (farm_id, initials)
);
create index on erp.warehouses (organization_id, farm_id);
create trigger trg_wh_updated before update on erp.warehouses for each row execute function erp.set_updated_at();

-- Categorias financeiras (hierárquico, código 2.01.001.0001; receita/despesa)
create table erp.financial_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  parent_id uuid references erp.financial_categories(id),
  code text not null,
  name text not null,
  nature text not null check (nature in ('income','expense','both')),
  kind text not null default 'analytic' check (kind in ('synthetic','analytic')),
  classification text check (classification in ('capex','opex','unclassified')),
  is_tax boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.financial_categories (organization_id, parent_id);

-- Plano de contas (contábil)
create table erp.chart_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  parent_id uuid references erp.chart_accounts(id),
  code text not null, description text not null,
  condition text not null check (condition in ('debit','credit','both')),
  kind text not null check (kind in ('synthetic','analytic')),
  type text check (type in ('capex','opex')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);

-- Regras fiscais e naturezas de operação
create table erp.tax_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, is_active boolean not null default true,
  cbenef text, cfop_out_internal text, cfop_out_external text,
  cst_csosn text, cst_pis text, cst_cofins text, cst_ipi text, cenq_ipi text,
  perc_icms numeric(7,4) default 0, perc_pis numeric(7,4) default 0, perc_cofins numeric(7,4) default 0, perc_ipi numeric(7,4) default 0,
  cest text, percent_reduction numeric(7,4) default 0, modality_bc text, origin text, cst_csosn_export text,
  reform jsonb not null default '{}'::jsonb,       -- IBS/CBS/IS (reforma tributária): c_class_trib, cst_ibs_cbs, perc_ibs_uf, ...
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.nature_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  description text not null,
  type text not null check (type in ('in','out')),
  cfop_out_internal text, cfop_out_external text, cfop_in_internal text, cfop_in_external text, cfop_out_export text, cfop_in_export text,
  is_active boolean not null default true,
  overrides_product_cfop boolean not null default false,
  overrides_product_info boolean not null default false,
  skip_financial boolean not null default false,
  auto_icms boolean not null default false,
  tax_rule_id uuid references erp.tax_rules(id),
  additional_info_id uuid,
  taxes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.additional_infos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  description text not null, info text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
alter table erp.nature_operations add constraint fk_natop_addinfo foreign key (additional_info_id) references erp.additional_infos(id);

-- ---------- Produtos ----------
create table erp.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,                                 -- sequencial formatado (00001)
  reference text,                                     -- código do produto no fornecedor
  description text not null,
  ncm_code text references erp.ncm(code),
  measurement_id uuid not null references erp.measurement_units(id),
  second_measurement_id uuid references erp.measurement_units(id),
  factor_type text check (factor_type in ('multiply','divide')),
  factor numeric(18,6),
  group_id uuid not null references erp.product_groups(id),
  category_id uuid not null references erp.product_categories(id),
  kind_id uuid not null references erp.product_kinds(id),
  cultivation_id uuid,
  quality text,
  has_lot boolean not null default false,
  control_stock boolean not null default true,
  min_stock numeric(18,4),
  last_purchase_date date,
  average_cost numeric(18,6) not null default 0,     -- cache reconciliável do ledger
  reference_price numeric(18,2) not null default 0,
  is_active boolean not null default true,
  allow_pointing boolean not null default false,
  financial_category_id uuid references erp.financial_categories(id),
  default_cost_center_id uuid references erp.cost_centers(id),
  default_warehouse_id uuid references erp.warehouses(id),
  active_principle text,
  withdrawal_period_days int,
  is_equipment boolean not null default false,
  addressing_id uuid references erp.addressings(id),
  is_fiscal boolean not null default false,
  tax_rule_id uuid references erp.tax_rules(id),
  barcode text,
  taxes jsonb not null default '{}'::jsonb,           -- cfop/cst/perc/cest/origem/reforma (mesmas chaves do catálogo de campos)
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.products (organization_id, description);
create index on erp.products (organization_id, group_id, category_id, kind_id);
create index on erp.products (organization_id, is_active) where deleted_at is null;
create trigger trg_products_updated before update on erp.products for each row execute function erp.set_updated_at();
create trigger trg_products_audit after insert or update or delete on erp.products for each row execute function erp.audit_row();
-- Regra: financial_category obrigatória quando controla estoque (help observado)
alter table erp.products add constraint chk_product_fin_cat check (not control_stock or financial_category_id is not null);

-- Embalagens (aba "Embalagens")
create table erp.product_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  product_id uuid not null references erp.products(id) on delete cascade,
  description text not null,
  quantity numeric(18,4) not null check (quantity > 0),
  barcode text
);

-- Agrupamento de produtos (ação "Agrupar" na listagem: unifica duplicados em um produto principal)
create table erp.product_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  target_product_id uuid not null references erp.products(id),
  merged_product_id uuid not null references erp.products(id),
  merged_by uuid references erp.users(id),
  created_at timestamptz not null default now()
);

-- Categorias de rateio
create table erp.apportionment_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.apportionment_category_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references erp.apportionment_categories(id) on delete cascade,
  cost_center_id uuid not null references erp.cost_centers(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100)
);

-- ---------- Pessoas unificadas ----------
create table erp.people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,
  document text,                       -- CPF/CNPJ normalizado (somente dígitos)
  person_type text not null default 'legal' check (person_type in ('natural','legal','foreign')),
  name text not null,                  -- Nome social/fantasia
  legal_name text,                     -- Razão social/nome completo
  email citext, phone text, cellphone text,
  zip_code text, address text, address_number text, district text, city_id int references erp.cities(id),
  state_registration text, city_registration text,
  contact_name text, contact_phone text,
  bank_code text references erp.banks(code), bank_account_type text check (bank_account_type in ('checking','savings')), bank_agency text, bank_account text,
  pix_type text check (pix_type in ('document','phone','email','random')), pix_key text,
  -- papéis
  is_provider boolean not null default false,
  is_client boolean not null default false,
  is_employee boolean not null default false,
  is_proprietary boolean not null default false,
  is_transporter boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create unique index ux_people_document on erp.people (organization_id, document) where document is not null and deleted_at is null;
create index on erp.people (organization_id, name);
create trigger trg_people_updated before update on erp.people for each row execute function erp.set_updated_at();
create trigger trg_people_audit after insert or update or delete on erp.people for each row execute function erp.audit_row();

create table erp.provider_profiles (
  person_id uuid primary key references erp.people(id) on delete cascade,
  provider_type text not null default 'provider' check (provider_type in ('provider','employee','outsourced','transporter','commissioned')),
  commission_percent numeric(7,4), hour_value numeric(18,2),
  default_cost_center_id uuid references erp.cost_centers(id),
  is_active boolean not null default true
);
create table erp.provider_branches (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references erp.people(id) on delete cascade,
  name text, document text, state_registration text, zip_code text, address text, city_id int references erp.cities(id)
);
create table erp.provider_sellers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references erp.people(id) on delete cascade,
  name text not null, email citext, phone text
);
create table erp.client_profiles (
  person_id uuid primary key references erp.people(id) on delete cascade,
  final_customer boolean not null default false,
  taxpayer boolean not null default true,
  country_code text, foreign_id text, farm_name text,
  state_registrations text[] not null default '{}',
  is_active boolean not null default true
);
create table erp.proprietary_profiles (
  person_id uuid primary key references erp.people(id) on delete cascade,
  is_active boolean not null default true
);
-- participação do proprietário por fazenda (percentual)
create table erp.proprietary_farms (
  person_id uuid not null references erp.people(id) on delete cascade,
  farm_id uuid not null references erp.farms(id) on delete cascade,
  registration_number text,
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  primary key (person_id, farm_id)
);

-- RH: funções (cargos), equipes, funcionários
create table erp.job_functions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, cbo_code text, description text,
  base_salary numeric(18,2) not null default 0, monthly_hours int not null default 220, hour_value numeric(18,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.employee_profiles (
  person_id uuid primary key references erp.people(id) on delete cascade,
  office text, function_id uuid references erp.job_functions(id),
  commission_percent numeric(7,4), hour_value numeric(18,2), base_salary numeric(18,2), goal_salary numeric(18,2),
  cost_center_id uuid references erp.cost_centers(id),
  birthday date, admission_date date, dismissal_date date,
  user_id uuid references erp.users(id),
  is_active boolean not null default true
);
create table erp.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, description text,
  leader_person_id uuid references erp.people(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.team_members (
  team_id uuid not null references erp.teams(id) on delete cascade,
  person_id uuid not null references erp.people(id),
  member_type text not null check (member_type in ('employee','outsourced')),
  is_active boolean not null default true,
  primary key (team_id, person_id)
);

-- Autorizadores (workflow de suprimentos)
create table erp.authorizers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  user_id uuid not null references erp.users(id),
  max_value numeric(18,2) not null default 0,
  is_active boolean not null default true,
  is_conditional boolean not null default false,
  expense_organizer boolean not null default false,
  min_quotes int not null default 1 check (min_quotes >= 0),
  levels int[] not null default '{1}',
  rules jsonb not null default '[]'::jsonb,       -- [{type:'request_type', value:'product', apply_on:'before_quote'}]
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, user_id)
);
create table erp.authorizer_farms (
  authorizer_id uuid not null references erp.authorizers(id) on delete cascade,
  farm_id uuid not null references erp.farms(id) on delete cascade,
  primary key (authorizer_id, farm_id)
);
-- Encarregados (bosses) de um usuário: quem aprova/recebe solicitações dele
create table erp.user_bosses (
  organization_id uuid not null references erp.organizations(id),
  user_id uuid not null references erp.users(id),
  boss_user_id uuid not null references erp.users(id),
  primary key (organization_id, user_id, boss_user_id)
);

-- ---------- Contas bancárias ----------
create table erp.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,                       -- sigla
  description text not null,
  bank_code text references erp.banks(code),
  agency text, account_number text,
  type text not null check (type in ('checking','savings','investment','cash')),
  use_cash_book boolean not null default false,
  issues_boleto boolean not null default false,
  boleto_wallet text, boleto_agreement text, cnab_type text check (cnab_type in ('240','400')),
  credit_limit numeric(18,2) not null default 0,
  investment_account_id uuid references erp.bank_accounts(id),
  opening_balance numeric(18,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.bank_account_farms (
  bank_account_id uuid not null references erp.bank_accounts(id) on delete cascade,
  farm_id uuid not null references erp.farms(id) on delete cascade,
  primary key (bank_account_id, farm_id)
);
create table erp.bank_account_proprietaries (
  bank_account_id uuid not null references erp.bank_accounts(id) on delete cascade,
  person_id uuid not null references erp.people(id) on delete cascade,
  primary key (bank_account_id, person_id)
);

-- ---------- Documentos ----------
create table erp.document_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  parent_id uuid references erp.document_types(id),
  name text not null, position int not null default 0, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),
  document_type_id uuid not null references erp.document_types(id),
  title text not null, description text,
  issue_date date, expiration_date date,
  status text not null default 'active' check (status in ('active','expired','archived')),
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index on erp.documents (organization_id, expiration_date);

-- ---------- Agrícola ----------
create table erp.operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, position int not null default 0, grouper_id uuid references erp.operations(id), description text,
  use_in text not null default 'both' check (use_in in ('both','agriculture','livestock')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null, description text, value_per_hectare numeric(18,2) not null default 0,
  use_in text not null default 'both' check (use_in in ('both','agriculture','fruit','beef')),
  type text not null default 'custeio' check (type in ('custeio','investimento','a_definir')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.activity_operations (
  activity_id uuid not null references erp.activities(id) on delete cascade,
  operation_id uuid not null references erp.operations(id) on delete cascade,
  primary key (activity_id, operation_id)
);
create table erp.cultivations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  crop text not null, variety text not null, is_active boolean not null default true,
  unique (organization_id, crop, variety)
);
alter table erp.products add constraint fk_products_cultivation foreign key (cultivation_id) references erp.cultivations(id);

-- ---------- Bens/Ativos (inventário) ----------
create table erp.equipment_families (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id),
  name text not null, default_life_years int, default_depreciation_percent numeric(7,4)
);
create table erp.equipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, description text not null,
  family_id uuid references erp.equipment_families(id),
  equipment_type text check (equipment_type in ('own','outsourced')),
  proprietary_id uuid references erp.people(id),
  hour_value numeric(18,2) not null default 0,
  hour_meter numeric(18,2),
  year_model text, brand text, model text, patrimony text, chassis text, renavam text, serial_number text, plate text, plate_state char(2), color text,
  has_depreciation boolean not null default false,
  acquisition_value numeric(18,2) not null default 0,
  acquisition_date date,
  depreciation_type text check (depreciation_type in ('with_residual','without_residual')),
  residual_percent numeric(7,4), life_years numeric(7,2), depreciation_percent numeric(7,4),
  residual_value numeric(18,2), depreciable_value numeric(18,2), depreciated_value numeric(18,2) not null default 0,
  status text not null default 'active' check (status in ('active','inactive','sold','written_off')),
  provider_id uuid references erp.people(id),
  product_id uuid references erp.products(id),
  use_fiscal boolean not null default false,
  features text[] not null default '{}',        -- supply | maintenance | batch | pointing
  specification text,
  vehicle jsonb not null default '{}'::jsonb,   -- rntrc, body_type, wheel_type, tara, capacity, owner_*
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.equipments (organization_id, farm_id, status);
create table erp.equipment_cost_centers (
  equipment_id uuid not null references erp.equipments(id) on delete cascade,
  cost_center_id uuid not null references erp.cost_centers(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  primary key (equipment_id, cost_center_id)
);
-- Depreciação mensal (ledger)
create table erp.depreciations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  equipment_id uuid not null references erp.equipments(id),
  period_month date not null,                -- primeiro dia do mês
  amount numeric(18,2) not null check (amount >= 0),
  accumulated numeric(18,2) not null,
  status text not null default 'confirmed' check (status in ('confirmed','reversed')),
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now(),
  unique (equipment_id, period_month)
);

-- ---------- Pluviometria ----------
create table erp.rainfalls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  date date not null, millimeters numeric(8,2) not null check (millimeters >= 0), note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (farm_id, date)
);

-- ---------- Parametrizações (por tenant) — já em organizations.parameters ----------
