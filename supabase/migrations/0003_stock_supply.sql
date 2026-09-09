-- =====================================================================
-- 0003 ESTOQUE (ledger) e SUPRIMENTOS (workflow de compras)
-- Princípio: nenhum saldo é editado diretamente. Todo saldo deriva de erp.stock_movements
-- (ledger append-only). erp.stock_balances é um cache reconciliável mantido por trigger.
-- =====================================================================

-- ---------- Ledger de estoque ----------
create table erp.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  movement_type text not null check (movement_type in (
    'opening_balance','entry','invoice_entry','receipt','devolution','requisition','writeoff','correction_in','correction_out',
    'transfer_out','transfer_in','farm_transfer_out','farm_transfer_in','sale','production_in','production_out','maintenance','fuel_supply','nutrition','reversal'
  )),
  direction smallint not null check (direction in (1,-1)),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_cost numeric(18,6) not null default 0 check (unit_cost >= 0),
  total_cost numeric(18,2) generated always as (round(quantity * unit_cost, 2)) stored,
  balance_after numeric(18,4),             -- saldo do produto no armazém após o lançamento (auditável)
  avg_cost_after numeric(18,6),
  provider_lot text,
  expiration_date date,
  cost_center_id uuid references erp.cost_centers(id),
  harvest_id uuid references erp.harvests(id),
  cultivation_id uuid references erp.cultivations(id),
  source_type text not null,               -- entidade de origem (input_entry, invoice, requisition, ...)
  source_id uuid not null,
  reversed_by uuid references erp.stock_movements(id),
  movement_date date not null,
  note text,
  created_by uuid references erp.users(id),
  created_at timestamptz not null default now()
);
create index on erp.stock_movements (organization_id, warehouse_id, product_id, movement_date);
create index on erp.stock_movements (organization_id, source_type, source_id);
create index on erp.stock_movements (organization_id, movement_date);

-- Saldo agregado (cache) por armazém/produto/lote
create table erp.stock_balances (
  organization_id uuid not null references erp.organizations(id),
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  provider_lot text not null default '',
  quantity numeric(18,4) not null default 0,
  average_cost numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  expiration_date date,
  version bigint not null default 0,        -- controle otimista
  updated_at timestamptz not null default now(),
  primary key (organization_id, warehouse_id, product_id, provider_lot)
);
create index on erp.stock_balances (organization_id, product_id);

-- Aplica um movimento ao saldo, com lock de linha, validando saldo (não permite negativo)
create or replace function erp.apply_stock_movement() returns trigger language plpgsql as $$
declare
  b erp.stock_balances%rowtype;
  new_qty numeric(18,4); new_avg numeric(18,6); new_total numeric(18,2);
  v_lot text := coalesce(new.provider_lot, '');
begin
  insert into erp.stock_balances (organization_id, warehouse_id, product_id, provider_lot, expiration_date)
  values (new.organization_id, new.warehouse_id, new.product_id, v_lot, new.expiration_date)
  on conflict do nothing;
  select * into b from erp.stock_balances
   where organization_id = new.organization_id and warehouse_id = new.warehouse_id and product_id = new.product_id and provider_lot = v_lot
   for update;
  if new.direction = 1 then
    new_qty := b.quantity + new.quantity;
    new_total := b.total_value + round(new.quantity * new.unit_cost, 2);
    new_avg := case when new_qty > 0 then new_total / new_qty else new.unit_cost end;
  else
    if b.quantity < new.quantity then
      raise exception 'INSUFFICIENT_STOCK: saldo % < solicitado % (produto %, armazém %)', b.quantity, new.quantity, new.product_id, new.warehouse_id
        using errcode = 'P0001';
    end if;
    new_qty := b.quantity - new.quantity;
    -- saída sempre a custo médio corrente (regra de custo médio ponderado)
    if new.unit_cost = 0 then new.unit_cost := b.average_cost; end if;
    new_total := case when new_qty = 0 then 0 else b.total_value - round(new.quantity * b.average_cost, 2) end;
    new_avg := case when new_qty > 0 then b.average_cost else 0 end;
  end if;
  update erp.stock_balances set quantity = new_qty, average_cost = new_avg, total_value = new_total, version = version + 1, updated_at = now(),
    expiration_date = coalesce(new.expiration_date, expiration_date)
   where organization_id = new.organization_id and warehouse_id = new.warehouse_id and product_id = new.product_id and provider_lot = v_lot;
  new.balance_after := new_qty; new.avg_cost_after := new_avg;
  -- cache no produto: custo médio consolidado
  update erp.products p set average_cost = coalesce((select sum(total_value)/nullif(sum(quantity),0) from erp.stock_balances sb where sb.product_id = p.id and sb.quantity > 0), p.average_cost)
   where p.id = new.product_id;
  return new;
end $$;
create trigger trg_stock_movement_apply before insert on erp.stock_movements for each row execute function erp.apply_stock_movement();

-- Ledger é append-only: proíbe update/delete
create or replace function erp.forbid_change() returns trigger language plpgsql as $$
begin raise exception 'LEDGER_IMMUTABLE: % não permite % (use estorno)', tg_table_name, tg_op; end $$;
create trigger trg_stock_movement_immutable before update or delete on erp.stock_movements for each row execute function erp.forbid_change();

-- Reconciliação: recalcula saldo a partir do ledger (para auditoria/reparo)
create or replace function erp.reconcile_stock_balance(p_org uuid, p_wh uuid, p_prod uuid) returns void language plpgsql as $$
begin
  update erp.stock_balances sb set
    quantity = coalesce((select sum(direction*quantity) from erp.stock_movements m where m.organization_id=p_org and m.warehouse_id=p_wh and m.product_id=p_prod and m.provider_lot is not distinct from nullif(sb.provider_lot,'')),0),
    updated_at = now()
  where sb.organization_id=p_org and sb.warehouse_id=p_wh and sb.product_id=p_prod;
end $$;

-- ---------- Documentos de estoque ----------
-- Estoque inicial
create table erp.opening_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null check (unit_value >= 0),
  total_value numeric(18,2) not null,
  provider_lot text, expiration_date date, cultivation_id uuid references erp.cultivations(id),
  status text not null default 'confirmed' check (status in ('confirmed','reversed')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on erp.opening_balances (organization_id, warehouse_id, product_id);

-- Entrada de insumos (sem nota fiscal)
create table erp.input_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  entry_date date not null,
  harvest_id uuid references erp.harvests(id),
  proprietary_id uuid references erp.people(id),
  responsible_user_id uuid references erp.users(id),
  note text,
  total_amount numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('draft','confirmed','cancelled')),
  bank_movement_id uuid,
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.input_entry_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references erp.input_entries(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  measurement_id uuid references erp.measurement_units(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null check (unit_value >= 0),
  total_value numeric(18,2) not null,
  generate_stock boolean not null default true,
  warehouse_id uuid references erp.warehouses(id),
  appropriation_type text check (appropriation_type in ('livestock','maintenance','fuel')),
  provider_lot text, expiration_date date, cultivation_id uuid references erp.cultivations(id),
  financial_category_id uuid references erp.financial_categories(id),
  cost_center_id uuid references erp.cost_centers(id),
  position int not null default 0
);

-- Documento fiscal de entrada (NF de compra) — gera estoque + contas a pagar + inventário
create table erp.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  number text not null,
  series text not null default '1',
  access_key text,                              -- chave NFe (44 dígitos) quando importada de XML/DFe
  provider_id uuid not null references erp.people(id),
  branch_id uuid references erp.provider_branches(id),
  proprietary_id uuid references erp.people(id),
  harvest_id uuid references erp.harvests(id),
  emission_date date not null,
  delivery_date date,
  state_code char(2),
  document_type text not null default 'nfe' check (document_type in ('nfe','cte','nfse','nfce','danfe','darf','dare','gru','other')),
  title_type_id uuid,
  classification text not null default 'unclassified' check (classification in ('unclassified','capex','opex')),
  apportionment_type text not null default 'by_value' check (apportionment_type in ('by_value','by_product')),
  note text,
  products_total numeric(18,2) not null default 0,
  discount_total numeric(18,2) not null default 0,
  ipi_total numeric(18,2) not null default 0,
  icms_total numeric(18,2) not null default 0,
  freight numeric(18,2) not null default 0,
  other_expenses numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  origin text not null default 'manual' check (origin in ('manual','xml','dfe','purchase_request')),
  purchase_request_id uuid,
  status text not null default 'confirmed' check (status in ('draft','confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create unique index ux_invoices_doc on erp.invoices (organization_id, provider_id, number, series) where deleted_at is null and status <> 'cancelled';
create unique index ux_invoices_key on erp.invoices (organization_id, access_key) where access_key is not null;
create index on erp.invoices (organization_id, farm_id, emission_date);
create table erp.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references erp.invoices(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  xml_product_description text,
  measurement_id uuid references erp.measurement_units(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null check (unit_value >= 0),
  discount numeric(18,2) not null default 0,
  ipi numeric(18,2) not null default 0,
  icms numeric(18,2) not null default 0,
  total numeric(18,2) not null,
  generate_stock boolean not null default true,
  warehouse_id uuid references erp.warehouses(id),
  appropriation_type text check (appropriation_type in ('livestock','maintenance','fuel')),
  provider_lot text, expiration_date date, cultivation_id uuid references erp.cultivations(id),
  financial_category_id uuid references erp.financial_categories(id),
  cost_center_id uuid references erp.cost_centers(id),
  is_equipment boolean not null default false,
  equipment_id uuid references erp.equipments(id),
  grain_quality jsonb not null default '{}'::jsonb,     -- impurezas, PAU, fundos, catação, aproveitamento, bebida, cor
  position int not null default 0
);
-- Rateio financeiro do documento (categoria/conta contábil/centro de custo/safra)
create table erp.invoice_apportionments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references erp.invoices(id) on delete cascade,
  financial_category_id uuid not null references erp.financial_categories(id),
  chart_account_id uuid references erp.chart_accounts(id),
  cost_center_id uuid not null references erp.cost_centers(id),
  harvest_id uuid references erp.harvests(id),
  percentage numeric(7,4) not null,
  amount numeric(18,2) not null
);

-- Perfis de lançamento por fornecedor (DFe automática)
create table erp.provider_launch_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  provider_id uuid not null references erp.people(id),
  default_destination text not null check (default_destination in ('product_invoice','expense_invoice','animal_invoice')),
  default_title_type_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, provider_id)
);
create table erp.provider_launch_profile_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references erp.provider_launch_profiles(id) on delete cascade,
  financial_category_id uuid not null references erp.financial_categories(id),
  cost_center_id uuid not null references erp.cost_centers(id),
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100)
);

-- DFe recebidas (documentos fiscais eletrônicos capturados da SEFAZ) e rascunhos de aprovação
create table erp.dfe_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid references erp.farms(id),
  access_key text not null,
  document_type text not null default 'nfe' check (document_type in ('nfe','cte','nfse')),
  number text, series text,
  issuer_document text, issuer_name text,
  emission_date date, total numeric(18,2),
  manifest_status text not null default 'none' check (manifest_status in ('none','awareness','confirmed','unknown','not_performed')),
  launch_status text not null default 'pending' check (launch_status in ('pending','draft','launched','ignored')),
  invoice_id uuid references erp.invoices(id),
  xml_object_path text,
  raw jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, access_key)
);
create table erp.dfe_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  dfe_id uuid not null references erp.dfe_documents(id) on delete cascade,
  proposed jsonb not null,           -- documento proposto (itens mapeados por perfil de lançamento)
  status text not null default 'pending' check (status in ('pending','approved','ignored')),
  reviewed_by uuid references erp.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Baixa de estoque (perda, deterioração, roubo, avaria, inventário, ...)
create table erp.stock_writeoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  writeoff_date date not null,
  reason text not null check (reason in ('loss','deterioration','theft','damage','inventory','accounting','burglary','expiration','gift','donation','consumption','payment_with_product','other')),
  reason_note text,
  cost_center_id uuid references erp.cost_centers(id),
  warehouse_id uuid not null references erp.warehouses(id),
  justification text not null,
  total_amount numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  responsible_user_id uuid references erp.users(id),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.stock_writeoff_items (
  id uuid primary key default gen_random_uuid(),
  writeoff_id uuid not null references erp.stock_writeoffs(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  provider_lot text,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0
);

-- Requisição/Saída do estoque (consumo por centro de custo) — status Aguardando Assinatura / Assinado
create table erp.requisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  requisition_date date not null,
  classification text not null default 'unclassified' check (classification in ('unclassified','capex','opex')),
  requester_person_id uuid references erp.people(id),
  responsible_user_id uuid references erp.users(id),
  area_id uuid,
  harvest_id uuid references erp.harvests(id),
  total_amount numeric(18,2) not null default 0,
  signature_status text not null default 'awaiting_signature' check (signature_status in ('awaiting_signature','signed')),
  signed_document_path text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.requisitions (organization_id, farm_id, requisition_date);
create table erp.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references erp.requisitions(id) on delete cascade,
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  provider_lot text,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  cost_center_id uuid references erp.cost_centers(id),
  addressing text
);

-- Devolução/Entrada (retorno ao estoque)
create table erp.devolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  devolution_date date not null,
  responsible_person_id uuid references erp.people(id),
  harvest_id uuid references erp.harvests(id),
  total_amount numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.devolution_items (
  id uuid primary key default gen_random_uuid(),
  devolution_id uuid not null references erp.devolutions(id) on delete cascade,
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  cost_center_id uuid references erp.cost_centers(id)
);

-- Correção de estoque (ajuste positivo/negativo com justificativa)
create table erp.stock_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  correction_date date not null,
  warehouse_id uuid not null references erp.warehouses(id),
  product_id uuid not null references erp.products(id),
  provider_lot text,
  previous_quantity numeric(18,4) not null,
  new_quantity numeric(18,4) not null check (new_quantity >= 0),
  difference numeric(18,4) generated always as (new_quantity - previous_quantity) stored,
  unit_value numeric(18,6) not null default 0,
  justification text not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- Transferência entre armazéns (mesma fazenda) e entre fazendas
create table erp.warehouse_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,
  transfer_date date not null,
  kind text not null check (kind in ('warehouse','farm')),
  origin_farm_id uuid not null references erp.farms(id),
  origin_warehouse_id uuid not null references erp.warehouses(id),
  destination_farm_id uuid not null references erp.farms(id),
  destination_warehouse_id uuid not null references erp.warehouses(id),
  harvest_id uuid references erp.harvests(id),
  generate_financial boolean not null default false,
  total_value numeric(18,2) not null default 0,
  proprietary_id uuid references erp.people(id),
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancelled')),
  responsible_user_id uuid references erp.users(id),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code),
  check (origin_warehouse_id <> destination_warehouse_id)
);
create table erp.warehouse_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references erp.warehouse_transfers(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  provider_lot text,
  quantity numeric(18,4) not null check (quantity > 0),
  unit_value numeric(18,6) not null default 0,
  total_value numeric(18,2) not null default 0,
  cost_center_id uuid references erp.cost_centers(id)
);

-- ---------- SUPRIMENTOS: Solicitação → Cotação → Autorização → Compra → Recebimento ----------
create table erp.supply_status_sla (
  organization_id uuid not null references erp.organizations(id),
  status text not null,
  max_hours int not null default 0 check (max_hours >= 0),
  primary key (organization_id, status)
);

create table erp.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  parent_id uuid references erp.purchase_requests(id),      -- sub-solicitação
  request_date date not null,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  request_type text not null check (request_type in ('product','service','advance','refund','daily','contract','finished_product')),
  requester_user_id uuid not null references erp.users(id),
  authorizer_id uuid references erp.authorizers(id),          -- encarregado inicial
  current_responsible_user_id uuid references erp.users(id),
  status text not null default 'request' check (status in (
    'request','quotation_in_progress','awaiting_approval','awaiting_awareness','not_approved','awaiting_purchase',
    'purchase_done','purchase_received','finished','cancelled','under_review'
  )),
  status_changed_at timestamptz not null default now(),
  description text not null,                 -- Descrição/Chamado
  justification text not null,
  observation text, final_observation text,
  classification text check (classification in ('unclassified','capex','opex')),
  financial_due_date date,
  invoice_number text,
  estimated_total numeric(18,2) not null default 0,
  approved_total numeric(18,2),
  selected_quotation_id uuid,
  invoice_id uuid references erp.invoices(id),
  version int not null default 1,            -- controle otimista
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create index on erp.purchase_requests (organization_id, status, farm_id);
create index on erp.purchase_requests (organization_id, current_responsible_user_id) where status not in ('finished','cancelled');
create trigger trg_pr_updated before update on erp.purchase_requests for each row execute function erp.set_updated_at();
create trigger trg_pr_audit after insert or update or delete on erp.purchase_requests for each row execute function erp.audit_row();

create table erp.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references erp.purchase_requests(id) on delete cascade,
  product_id uuid references erp.products(id),
  description text not null,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  reference_value numeric(18,2),
  amount numeric(18,2),                       -- adiantamento/reembolso/empreita/produto acabado
  observation text,
  extra jsonb not null default '{}'::jsonb,    -- diária: nif, name, phone, daily_quantity, service_description
  position int not null default 0
);

-- Histórico de movimentações (tabela "Movimentações": data, responsável, status, tempo gasto, justificativa)
create table erp.purchase_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references erp.purchase_requests(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id),
  user_id uuid references erp.users(id),
  from_status text, to_status text not null,
  action text not null,                       -- create | advance | back | reject | approve | transfer | comment | cancel | receive
  justification text,
  time_spent_minutes int,
  created_at timestamptz not null default now()
);
create index on erp.purchase_request_events (request_id, created_at);

-- Cotações (por fornecedor) com itens
create table erp.purchase_quotations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references erp.purchase_requests(id) on delete cascade,
  organization_id uuid not null references erp.organizations(id),
  provider_id uuid not null references erp.people(id),
  quotation_date date not null default current_date,
  payment_condition text, delivery_days int, freight numeric(18,2) not null default 0,
  total numeric(18,2) not null default 0,
  is_selected boolean not null default false,
  note text,
  public_token text unique,                   -- link para fornecedor preencher (ex.: pedido de orçamento)
  created_by uuid references erp.users(id), created_at timestamptz not null default now()
);
create table erp.purchase_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references erp.purchase_quotations(id) on delete cascade,
  request_item_id uuid not null references erp.purchase_request_items(id) on delete cascade,
  unit_price numeric(18,6) not null check (unit_price >= 0),
  quantity numeric(18,4) not null check (quantity > 0),
  total numeric(18,2) not null,
  brand text
);
alter table erp.purchase_requests add constraint fk_pr_selected_quotation foreign key (selected_quotation_id) references erp.purchase_quotations(id);

-- Aprovações (níveis de autorização)
create table erp.purchase_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references erp.purchase_requests(id) on delete cascade,
  authorizer_id uuid not null references erp.authorizers(id),
  level int not null default 1,
  decision text not null check (decision in ('approved','rejected','awareness')),
  justification text,
  decided_by uuid references erp.users(id),
  decided_at timestamptz not null default now()
);

-- Anexos de solicitação: usa erp.attachments (entity = 'purchase_request')

-- ---------- Fábrica de ração: formulação e batida ----------
create table erp.feed_formulas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null, name text not null, description text,
  product_id uuid references erp.products(id),       -- produto acabado gerado
  total_quantity numeric(18,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique (organization_id, code)
);
create table erp.feed_formula_items (
  id uuid primary key default gen_random_uuid(),
  formula_id uuid not null references erp.feed_formulas(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  percentage numeric(7,4)
);
create table erp.feed_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  farm_id uuid not null references erp.farms(id),
  code text not null,
  batch_date date not null,
  formula_id uuid not null references erp.feed_formulas(id),
  origin_warehouse_id uuid not null references erp.warehouses(id),
  destination_warehouse_id uuid not null references erp.warehouses(id),
  quantity_produced numeric(18,4) not null check (quantity_produced > 0),
  production_cost numeric(18,2) not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  created_by uuid references erp.users(id), created_at timestamptz not null default now(),
  unique (organization_id, code)
);
create table erp.feed_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references erp.feed_batches(id) on delete cascade,
  product_id uuid not null references erp.products(id),
  quantity numeric(18,4) not null check (quantity > 0),
  unit_cost numeric(18,6) not null default 0,
  total_cost numeric(18,2) not null default 0
);
