-- =====================================================================
-- 0004 FINANCEIRO: títulos (pagar/receber) com parcelas, baixas (ledger), movimentos
-- bancários (ledger), rateios, conciliação OFX, contratos, previsão orçamentária, congelamentos.
-- =====================================================================

-- Tipos de título (Boleto, Duplicata, Cheque, NFe, Recibo, Ad.Fornecedor, ...)
create table erp.title_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references erp.organizations(id),   -- null = padrão do sistema
  name text not null,
  is_advance boolean not null default false,
  unique (organization_id, name)
);
alter table erp.invoices add constraint fk_invoices_title_type foreign key (title_type_id) references erp.title_types(id);
alter table erp.provider_launch_profiles add constraint fk_plp_title_type foreign key (default_title_type_id) references erp.title_types(id);

-- Congelamento financeiro por mês (bloqueia lançamentos/alterações no período)
create table erp.financial_freezes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),          -- null = todas as fazendas (parâmetro financial_freeze_scope)
  year int not null, month int not null check (month between 1 and 12),
  is_frozen boolean not null default true,
  responsible_user_id uuid references erp.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, farm_id, year, month)
);
create or replace function erp.assert_period_open(p_org uuid, p_farm uuid, p_date date) returns void language plpgsql as $$
begin
  if exists (select 1 from erp.financial_freezes f where f.organization_id = p_org and f.is_frozen
             and f.year = extract(year from p_date) and f.month = extract(month from p_date)
             and (f.farm_id is null or f.farm_id = p_farm)) then
    raise exception 'PERIOD_FROZEN: período %/% congelado', extract(month from p_date), extract(year from p_date) using errcode='P0001';
  end if;
end $$;

-- ---------- Títulos financeiros (contas a pagar e a receber) ----------
create table erp.financial_titles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  direction text not null check (direction in ('payable','receivable')),
  number text not null,                        -- nº título (documento)
  title_type_id uuid references erp.title_types(id),
  proprietary_id uuid references erp.people(id),
  person_id uuid references erp.people(id),    -- fornecedor (pagar) ou cliente (receber)
  branch_id uuid references erp.provider_branches(id),
  payment_type text not null default 'single' check (payment_type in ('single','installments','recurring','advance','invoice_group')),
  recurrence_type text check (recurrence_type in ('weekly','monthly','quarterly','yearly')),
  classification text not null default 'unclassified' check (classification in ('unclassified','capex','opex')),
  document_type text check (document_type in ('nfe','cte','nfse','nfce','danfe','darf','dare','gru','other')),
  is_deductible boolean not null default false,
  is_tax boolean not null default false,
  amount numeric(18,2) not null check (amount >= 0),
  discount numeric(18,2) not null default 0 check (discount >= 0),
  net_amount numeric(18,2) generated always as (amount - discount) stored,
  emission_date date not null,
  due_date date not null,
  installment_number int not null default 1,
  installment_count int not null default 1,
  group_id uuid,                               -- agrupa parcelas do mesmo lançamento
  appropriation text not null default 'direct' check (appropriation in ('direct','indirect')),
  appropriation_type text check (appropriation_type in ('indirect','livestock','area','maintenance','fuel')),
  note text not null default '',
  harvest_id uuid references erp.harvests(id),
  paid_amount numeric(18,2) not null default 0,   -- cache do ledger de baixas
  balance numeric(18,2) generated always as (amount - discount - paid_amount) stored,
  status text not null default 'open' check (status in ('open','partially_paid','paid','cancelled')),
  source_type text, source_id uuid,            -- invoice, purchase_request, sale, order, earnings, farm_transfer, ...
  version int not null default 1,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, direction, code)
);
create index on erp.financial_titles (organization_id, direction, status, due_date);
create index on erp.financial_titles (organization_id, person_id);
create index on erp.financial_titles (organization_id, farm_id, due_date);
create index on erp.financial_titles (organization_id, source_type, source_id);
create trigger trg_ft_updated before update on erp.financial_titles for each row execute function erp.set_updated_at();
create trigger trg_ft_audit after insert or update or delete on erp.financial_titles for each row execute function erp.audit_row();

-- Rateio do título: categoria / conta contábil / centro de custo / área / safra / % / valor
create table erp.title_apportionments (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references erp.financial_titles(id) on delete cascade,
  financial_category_id uuid not null references erp.financial_categories(id),
  chart_account_id uuid references erp.chart_accounts(id),
  cost_center_id uuid not null references erp.cost_centers(id),
  area_id uuid,
  harvest_id uuid references erp.harvests(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  amount numeric(18,2) not null check (amount >= 0)
);
create index on erp.title_apportionments (title_id);

-- Apropriações específicas (pecuária/área/manutenção/abastecimento)
create table erp.title_appropriations (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references erp.financial_titles(id) on delete cascade,
  kind text not null check (kind in ('livestock','area','maintenance','fuel')),
  target jsonb not null,                       -- {area_id, grazing_id, batch_id, animal_id, operation_id, activity_id, equipment_id, product_id, quantity, hour_meter, mileage}
  amount numeric(18,2) not null check (amount >= 0)
);

-- ---------- Movimentos bancários (ledger) ----------
create table erp.bank_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),
  code text not null,
  bank_account_id uuid not null references erp.bank_accounts(id),
  movement_date date not null,
  type text not null check (type in ('in','out')),
  category_type text not null default 'in' check (category_type in ('in','out','internal_transfer','financing','check_return','opening_balance')),
  destination_account_id uuid references erp.bank_accounts(id),
  transfer_pair_id uuid references erp.bank_movements(id),
  amount numeric(18,2) not null check (amount > 0),
  interest numeric(18,2) not null default 0,
  document text,
  generates_obligation boolean not null default false,
  is_deductible boolean not null default false,
  note text,
  proprietary_id uuid references erp.people(id),
  person_id uuid references erp.people(id),
  harvest_id uuid references erp.harvests(id),
  source_type text, source_id uuid,            -- title_settlement, input_entry, earnings, ...
  reconciled_at timestamptz,
  ofx_transaction_id uuid,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  reversed_by uuid references erp.bank_movements(id),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.bank_movements (organization_id, bank_account_id, movement_date);
create index on erp.bank_movements (organization_id, source_type, source_id);
create trigger trg_bm_audit after insert or update or delete on erp.bank_movements for each row execute function erp.audit_row();

create table erp.bank_movement_apportionments (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references erp.bank_movements(id) on delete cascade,
  financial_category_id uuid not null references erp.financial_categories(id),
  chart_account_id uuid references erp.chart_accounts(id),
  cost_center_id uuid not null references erp.cost_centers(id),
  harvest_id uuid references erp.harvests(id),
  percentage numeric(7,4) not null,
  amount numeric(18,2) not null
);

-- Saldo bancário = saldo inicial + entradas - saídas (view reconciliável)
create or replace view erp.v_bank_account_balances as
select a.id as bank_account_id, a.organization_id,
       a.opening_balance + coalesce(sum(case when m.type='in' then m.amount + m.interest else -(m.amount + m.interest) end) filter (where m.status='confirmed' and m.deleted_at is null), 0) as balance
from erp.bank_accounts a left join erp.bank_movements m on m.bank_account_id = a.id
group by a.id, a.organization_id, a.opening_balance;

-- ---------- Baixas de títulos (ledger de liquidação) ----------
create table erp.title_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  title_id uuid not null references erp.financial_titles(id),
  settlement_date date not null,
  settlement_kind text not null default 'bank_movement' check (settlement_kind in ('bank_movement','cross_settlement','advance_compensation')),
  bank_account_id uuid references erp.bank_accounts(id),
  bank_movement_id uuid references erp.bank_movements(id),
  cross_title_id uuid references erp.financial_titles(id),    -- baixa cruzada (compensa título contrário)
  amount numeric(18,2) not null check (amount > 0),           -- valor baixado do título
  discount numeric(18,2) not null default 0,
  penalty numeric(18,2) not null default 0,
  interest numeric(18,2) not null default 0,
  increase numeric(18,2) not null default 0,
  foreign_amount numeric(18,2), ptax_rate numeric(12,6), exchange_adjustment numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null,                          -- valor líquido movimentado
  note text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  cancelled_at timestamptz, cancelled_by uuid references erp.users(id), cancel_reason text,
  created_by uuid references erp.users(id), created_at timestamptz not null default now()
);
create index on erp.title_settlements (title_id);
create index on erp.title_settlements (organization_id, settlement_date);

-- Mantém paid_amount/status do título a partir das baixas (nunca editado à mão)
create or replace function erp.refresh_title_status(p_title uuid) returns void language plpgsql as $$
declare v_paid numeric(18,2); v_net numeric(18,2); v_status text;
begin
  select coalesce(sum(amount + discount),0) into v_paid from erp.title_settlements where title_id = p_title and status = 'confirmed';
  select amount - discount, status into v_net, v_status from erp.financial_titles where id = p_title for update;
  if v_status = 'cancelled' then return; end if;
  if v_paid > v_net then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: baixas % excedem líquido %', v_paid, v_net using errcode='P0001';
  end if;
  update erp.financial_titles set paid_amount = v_paid,
    status = case when v_paid = 0 then 'open' when v_paid < v_net then 'partially_paid' else 'paid' end,
    version = version + 1
  where id = p_title;
end $$;
create or replace function erp.title_settlement_changed() returns trigger language plpgsql as $$
begin perform erp.refresh_title_status(coalesce(new.title_id, old.title_id)); return coalesce(new, old); end $$;
create trigger trg_settlement_changed after insert or update or delete on erp.title_settlements for each row execute function erp.title_settlement_changed();

-- ---------- Conciliação OFX ----------
create table erp.ofx_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, description text not null,
  bank_account_id uuid not null references erp.bank_accounts(id),
  start_date date not null, end_date date not null,
  file_path text,
  status text not null default 'imported' check (status in ('imported','reconciling','reconciled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.ofx_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references erp.ofx_imports(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id),
  fitid text not null,
  posted_date date not null, amount numeric(18,2) not null, memo text, check_number text,
  bank_movement_id uuid references erp.bank_movements(id),
  status text not null default 'pending' check (status in ('pending','matched','ignored')),
  unique (import_id, fitid)
);
alter table erp.bank_movements add constraint fk_bm_ofx foreign key (ofx_transaction_id) references erp.ofx_transactions(id);

-- ---------- Contratos (insumos a receber por contrato de compra) ----------
create table erp.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null, number text not null,
  contract_date date not null, expiration_date date not null,
  responsible_person_id uuid references erp.people(id),
  provider_id uuid not null references erp.people(id),
  quantity_sacks numeric(18,4) not null default 0, unit_value_sack numeric(18,6) not null default 0,
  amount numeric(18,2) not null default 0, installments int not null default 1,
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.contract_items (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references erp.contracts(id) on delete cascade,
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  received_quantity numeric(18,4) not null default 0
);

-- ---------- Previsão orçamentária anual (categoria x mês) ----------
create table erp.budget_plannings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),
  code text not null, planning_date date not null, year int not null,
  responsible_user_id uuid references erp.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.budget_planning_values (
  planning_id uuid not null references erp.budget_plannings(id) on delete cascade,
  financial_category_id uuid not null references erp.financial_categories(id),
  month int not null check (month between 1 and 12),
  amount numeric(18,2) not null default 0,
  primary key (planning_id, financial_category_id, month)
);

-- ---------- Partida dobrada (lançamentos contábeis manuais) ----------
create table erp.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),
  code text not null, entry_date date not null, history text not null,
  debit_account_id uuid not null references erp.chart_accounts(id),
  credit_account_id uuid not null references erp.chart_accounts(id),
  amount numeric(18,2) not null check (amount > 0),
  source_type text, source_id uuid,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (organization_id, code),
  check (debit_account_id <> credit_account_id)
);
