-- =====================================================================
-- 0005 VENDAS (orçamento → pedido → venda), FROTA (manutenção, abastecimento, preventivas,
-- revisões, transferência), GESTÃO PESSOAL (eventos, faltas, adiantamentos, apuração),
-- ORDENS DE SERVIÇO, PLANEJAMENTO PECUÁRIO.
-- =====================================================================

create table erp.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id),
  name text not null, is_active boolean not null default true,
  unique (organization_id, name)
);

-- Documento comercial unificado: budget (orçamento) → order (pedido) → sale (venda)
create table erp.sales_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  kind text not null check (kind in ('budget','order','sale')),
  code text not null,
  document_date date not null,
  shipping_date date, due_date date,
  responsible_user_id uuid references erp.users(id),
  client_id uuid not null references erp.people(id),
  transporter_id uuid references erp.people(id),
  proprietary_id uuid references erp.people(id),
  driver_name text,
  payment_method_id uuid references erp.payment_methods(id),
  subtotal numeric(18,2) not null default 0,
  freight numeric(18,2) not null default 0,
  freight_icms numeric(18,2) not null default 0,
  other_values numeric(18,2) not null default 0,
  discount numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  note text,
  installment_plan jsonb not null default '{}'::jsonb,   -- has_input, input_date, input_value, installments, first_due, interval, deductible
  origin_document_id uuid references erp.sales_documents(id),   -- pedido gerado de orçamento; venda gerada de pedido
  status text not null default 'open' check (status in ('open','approved','converted','confirmed','invoiced','cancelled')),
  nfe_id uuid,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, kind, code)
);
create index on erp.sales_documents (organization_id, kind, status, document_date);
create index on erp.sales_documents (organization_id, client_id);
create trigger trg_sales_audit after insert or update or delete on erp.sales_documents for each row execute function erp.audit_row();
create table erp.sales_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references erp.sales_documents(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  warehouse_id uuid references erp.warehouses(id),        -- null = sem estoque
  quantity numeric(18,4) not null check (quantity > 0),
  unit_price numeric(18,6) not null check (unit_price >= 0),
  discount numeric(18,2) not null default 0,
  discount_percent numeric(7,4) not null default 0,
  total numeric(18,2) not null,
  note text,
  position int not null default 0
);

-- ---------- Frota ----------
create table erp.maintenances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, maintenance_date date not null,
  responsible_user_id uuid references erp.users(id),
  harvest_id uuid references erp.harvests(id),
  total_parts numeric(18,2) not null default 0, total_services numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.maintenance_machines (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid not null references erp.maintenances(id) on delete cascade,
  equipment_id uuid not null references erp.equipments(id),
  hour_meter numeric(18,2), mileage numeric(18,2),
  maintenance_type text check (maintenance_type in ('employee','provider')),
  executor_person_id uuid references erp.people(id),
  hours numeric(18,2), service_total numeric(18,2) not null default 0, service_description text
);
create table erp.maintenance_items (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references erp.maintenance_machines(id) on delete cascade,
  warehouse_id uuid references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  measurement_id uuid references erp.measurement_units(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0, total numeric(18,2) not null default 0, note text
);
create table erp.fuel_supplies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, supply_date date not null,
  equipment_id uuid not null references erp.equipments(id),
  operator_person_id uuid references erp.people(id),
  warehouse_id uuid references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0, total numeric(18,2) not null default 0,
  hour_meter numeric(18,2), mileage numeric(18,2),
  cost_center_id uuid references erp.cost_centers(id),
  harvest_id uuid references erp.harvests(id),
  origin text not null default 'manual' check (origin in ('manual','cta_smart','import')),
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.fuel_supplies (organization_id, equipment_id, supply_date);
create table erp.preventive_maintenances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  equipment_id uuid not null references erp.equipments(id),
  description text not null,
  trigger_type text not null check (trigger_type in ('hours','km','days')),
  interval_value numeric(18,2) not null check (interval_value > 0),
  last_done_value numeric(18,2), last_done_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.scheduled_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  equipment_id uuid not null references erp.equipments(id),
  scheduled_date date not null, description text not null,
  status text not null default 'scheduled' check (status in ('scheduled','done','cancelled')),
  done_maintenance_id uuid references erp.maintenances(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.equipment_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, transfer_date date not null,
  equipment_id uuid not null references erp.equipments(id),
  origin_farm_id uuid not null references erp.farms(id),
  destination_farm_id uuid not null references erp.farms(id),
  note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (organization_id, code),
  check (origin_farm_id <> destination_farm_id)
);

-- ---------- Gestão pessoal ----------
create table erp.hr_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  name text not null,
  periodicity text not null check (periodicity in ('weekly','biweekly','monthly','quarterly','semiannual')),
  method text not null check (method in ('informed','fixed')),
  condition text not null check (condition in ('add','subtract')),
  is_quick_entry boolean not null default false, quick_entry_order int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.employee_events (            -- Funcionário x Eventos (valores fixos por funcionário)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  person_id uuid not null references erp.people(id),
  event_id uuid not null references erp.hr_events(id),
  amount numeric(18,2) not null default 0,
  is_active boolean not null default true,
  unique (person_id, event_id)
);
create table erp.absences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  person_id uuid not null references erp.people(id),
  absence_date date not null,
  kind text not null default 'absence' check (kind in ('absence','justified','half_day','delay')),
  hours numeric(6,2), note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.salary_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, advance_date date not null,
  person_id uuid not null references erp.people(id),
  amount numeric(18,2) not null check (amount > 0),
  installments int not null default 1,
  note text,
  title_id uuid references erp.financial_titles(id),
  status text not null default 'open' check (status in ('open','settled','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.bonuses (                     -- Registro/Eventos (lançamento de evento informado no período)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  person_id uuid not null references erp.people(id),
  event_id uuid not null references erp.hr_events(id),
  reference_month date not null,
  quantity numeric(18,2) not null default 1, amount numeric(18,2) not null,
  note text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz
);
create table erp.earnings (                    -- Apuração mensal (folha)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, reference_month date not null,
  status text not null default 'open' check (status in ('open','closed','financial_generated')),
  total_earnings numeric(18,2) not null default 0, total_deductions numeric(18,2) not null default 0, total_net numeric(18,2) not null default 0,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, farm_id, reference_month)
);
create table erp.earning_lines (
  id uuid primary key default gen_random_uuid(),
  earning_id uuid not null references erp.earnings(id) on delete cascade,
  person_id uuid not null references erp.people(id),
  event_id uuid references erp.hr_events(id),
  description text not null,
  condition text not null check (condition in ('add','subtract')),
  amount numeric(18,2) not null
);

-- ---------- Ordens de serviço ----------
create table erp.service_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, order_date date not null,
  harvest_id uuid references erp.harvests(id),
  activity_id uuid references erp.activities(id),
  operation_id uuid references erp.operations(id),
  cost_center_id uuid references erp.cost_centers(id),
  responsible_person_id uuid references erp.people(id),
  team_id uuid references erp.teams(id),
  description text, planned_start date, planned_end date, started_at timestamptz, finished_at timestamptz,
  status text not null default 'open' check (status in ('open','in_progress','finished','evaluated','cancelled')),
  rating smallint check (rating between 1 and 5), rating_note text,
  labor_total numeric(18,2) not null default 0, machines_total numeric(18,2) not null default 0, inputs_total numeric(18,2) not null default 0, total numeric(18,2) not null default 0,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.service_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references erp.service_orders(id) on delete cascade,
  section text not null check (section in ('labor','machine','input','production','ppe')),
  person_id uuid references erp.people(id), equipment_id uuid references erp.equipments(id), product_id uuid references erp.products(id), warehouse_id uuid references erp.warehouses(id),
  quantity numeric(18,4) not null default 0, unit_value numeric(18,6) not null default 0, total numeric(18,2) not null default 0,
  hours numeric(18,2), note text
);

-- ---------- Planejamento pecuário ----------
create table erp.livestock_plannings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  harvest_id uuid references erp.harvests(id),
  code text not null, planning_date date not null, description text not null,
  values jsonb not null default '{}'::jsonb,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);

-- ---------- Integrações (configurações) ----------
create table erp.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  provider text not null check (provider in ('dominio','cta_smart','nfe_issuer','dfe_sync','nfse_sync')),
  config jsonb not null default '{}'::jsonb,     -- credenciais devem ser referenciadas por segredo, nunca em claro
  is_active boolean not null default true,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
create table erp.export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  kind text not null,                        -- dominio_bank_movements | dominio_payroll | dominio_titles | dominio_nfse | csv_paid_titles | ...
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  file_path text, error text,
  requested_by uuid references erp.users(id), created_at timestamptz not null default now(), finished_at timestamptz
);
