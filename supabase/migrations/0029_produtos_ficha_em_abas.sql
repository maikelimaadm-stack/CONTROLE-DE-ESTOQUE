-- =====================================================================
-- 0029 PRODUTOS: FICHA EM ABAS (CADASTROS Fase 6)
--
-- O cadastro de Produto vira ficha em abas (mecanismo genérico da Fase 4). A tabela continua erp.products
-- (tabela, colunas, permissões e rotas ficam). Esta migration dá lugar ao que a ficha nova grava:
--   · colunas novas em erp.products: marca, fabricante, tipo_item (lista SPED), estoque_maximo,
--     controle_lote (nenhum · lote · lote_validade), origem (0 a 8), cest (7 dígitos), registro_mapa;
--   · has_lot CONTINUA e passa a ser DERIVADO do controle (gatilho): web anterior que manda has_lot=true
--     grava "lote"; false grava "nenhum";
--   · tabelas 1:N novas: erp.produto_unidades (unidades e embalagens) e erp.produto_fornecedores — com
--     organization_id, FK COMPOSTA (product_id, organization_id) → products, índice por produto e deleted_at;
--     a 2ª unidade de hoje vira a PRIMEIRA linha de produto_unidades (as colunas antigas ficam; product_packages
--     fica como legado);
--   · regras no banco (a API também confere, com a aba e a linha):
--       - movimento de estoque de produto com controle de lote exige lote (entrada e saída); lote + validade
--         exige validade na entrada. Só INSERT: movimentos existentes não mudam. Na SAÍDA sem lote informado a
--         API ESCOLHE os lotes pela validade ANTES do INSERT (R1-1) — o gatilho vê sempre o lote escolhido;
--       - mudar o controle com saldo ≠ 0 na organização é recusado ("zere o saldo em todos os armazéns");
--       - unidade alternativa não repete a padrão; fornecedor do produto só parceiro tipo Fornecedor;
--   · erp.feed_batches.validade (R1-1 c): validade do produto PRODUZIDO; o lote dele (quando tem controle) é o
--     código da produção.
--
-- PRÉ-CONDIÇÃO DE ACERVO (R1-1 h): produto com has_lot e saldo ≠ 0 no balde SEM lote ('') PARA a migration
-- nomeando os produtos — depois dela todo movimento do produto exige lote e esse saldo ficaria preso.
--
-- BACKFILL (UPDATE, nada apagado): controle_lote = 'lote' onde has_lot; cest/origem copiados de taxes quando
-- o valor antigo já tem o formato novo (a chave em taxes FICA).
--
-- JANELA DE DEPLOY: colunas novas anuláveis ou com default; a API anterior continua gravando products sem elas
-- (has_lot vira controle pelo gatilho). O gatilho de lote no movimento vale para a API anterior também.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 63) then
    raise exception 'CADASTROS-F6: outra transacao ja detem a trava desta migration (2026,63). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.products') is null or to_regclass('erp.stock_movements') is null or to_regclass('erp.stock_balances') is null then
    raise exception 'CADASTROS-F6: erp.products/stock_movements/stock_balances nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_people_tenant') then
    raise exception 'CADASTROS-F6: a 0027 nao esta aplicada (uq_people_tenant ausente); aplique a 0027 antes.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'products' and column_name = 'controle_lote') then
    raise exception 'CADASTROS-F6: erp.products.controle_lote ja existe; a 0029 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regclass('erp.feed_batches') is null then
    raise exception 'CADASTROS-F6: erp.feed_batches nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
end $$;

-- 2.1 (R1-1 h) saldo SEM lote de produto com lote: depois desta migration todo movimento do produto exige lote
-- (gatilho 8.2) e nenhuma saída alcança o balde '' — o saldo ficaria preso. Lote só de espaços é "sem lote" para a
-- API (que apara) e para o gatilho (btrim), e prende do mesmo jeito. PARA nomeando os produtos; nada muda.
do $$
declare v_presos text;
begin
  select string_agg(format('%s - %s (%s)', p.code, p.description, p.id), '; ' order by p.code, p.id)
    into v_presos
    from erp.products p
   where p.has_lot
     and exists (select 1 from erp.stock_balances b
                  where b.organization_id = p.organization_id and b.product_id = p.id and btrim(b.provider_lot) = '' and b.quantity <> 0);
  if v_presos is not null then
    raise exception 'CADASTROS-F6: produto com lote e saldo SEM lote (balde vazio): %. Zere esse saldo antes de aplicar a 0029; nada foi aplicado.', v_presos;
  end if;
end $$;

create temporary table _f6_antes on commit drop as
  select (select count(*) from erp.products) as produtos,
         (select count(*) from erp.products where has_lot) as com_lote,
         (select count(*) from erp.stock_movements) as movimentos,
         (select count(*) from erp.product_packages) as embalagens,
         (select count(*) from erp.products where deleted_at is null and second_measurement_id is not null and factor > 0
             and second_measurement_id <> measurement_id) as segundas;

-- ---------- 3) chave candidata de tenant ----------
alter table erp.products add constraint uq_products_tenant unique (id, organization_id);

-- ---------- 4) colunas novas ----------
alter table erp.products
  add column marca text,
  add column fabricante text,
  add column tipo_item text check (tipo_item in ('00','01','02','03','04','05','06','07','08','09','10','99')),
  add column estoque_maximo numeric(18,4) check (estoque_maximo >= 0),
  add column controle_lote text not null default 'nenhum' check (controle_lote in ('nenhum','lote','lote_validade')),
  add column origem smallint check (origem between 0 and 8),
  add column cest text check (cest ~ '^[0-9]{7}$'),
  add column registro_mapa text;

-- R1-1 c: validade do produto PRODUZIDO no lote de produção (opcional; a API a exige quando o produto controla
-- "lote + validade"). Anulável: as produções existentes não mudam.
alter table erp.feed_batches add column validade date;

comment on column erp.products.marca is 'Marca do produto.';
comment on column erp.products.fabricante is 'Fabricante do produto.';
comment on column erp.products.tipo_item is 'Tipo do item (SPED 0200): 00 revenda, 01 matéria-prima, 02 embalagem, 03 em processo, 04 acabado, 05 subproduto, 06 intermediário, 07 uso e consumo, 08 ativo imobilizado, 09 serviços, 10 outros insumos, 99 outras.';
comment on column erp.products.estoque_maximo is 'Estoque máximo (informativo).';
comment on column erp.products.controle_lote is 'Controle de lote: nenhum, lote (lote obrigatório na entrada e na saída) ou lote_validade (também exige validade na entrada). Mudar com saldo ≠ 0 é recusado.';
comment on column erp.products.origem is 'Origem da mercadoria (0 a 8, tabela A da NF-e).';
comment on column erp.products.cest is 'CEST (7 dígitos).';
comment on column erp.products.registro_mapa is 'Registro no MAPA (insumo agropecuário).';
comment on column erp.feed_batches.validade is 'Validade do produto produzido (entra no movimento de produção). Exigida quando o produto controla lote e validade; o lote do produzido com controle é o código da produção.';
comment on column erp.products.has_lot is 'LEGADO derivado de controle_lote (controle ≠ nenhum). Gravar has_lot=true (web anterior) grava controle "lote"; false grava "nenhum".';
comment on column erp.products.taxes is 'Parâmetros fiscais: as MESMAS chaves dos tributos da regra fiscal (cfop_out_internal, cst_csosn, perc_icms, reform…). Chave desconhecida é PRESERVADA na gravação (a API funde; só null remove).';

-- ---------- 5) backfill (nada apagado) ----------
-- o gatilho de controle ainda não existe: estes UPDATEs não passam pela regra de saldo (é o estado de hoje)
update erp.products set controle_lote = 'lote' where has_lot;
update erp.products set cest = taxes->>'cest' where cest is null and taxes->>'cest' ~ '^[0-9]{7}$';
update erp.products set origem = (taxes->>'origin')::smallint where origem is null and taxes->>'origin' ~ '^[0-8]$';

alter table erp.products add constraint chk_products_has_lot_derivado check (has_lot = (controle_lote <> 'nenhum'));

-- ---------- 6) tabelas 1:N ----------
create table erp.produto_unidades (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  measurement_id uuid not null references erp.measurement_units(id),
  tipo_fator text not null default 'multiply' check (tipo_fator in ('multiply','divide')),
  fator numeric(18,6) not null check (fator > 0),
  codigo_barras text,
  uso_compra boolean not null default true,
  uso_venda boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint chk_produto_unidades_uso check (uso_compra or uso_venda),
  constraint fk_produto_unidades_produto foreign key (product_id, organization_id) references erp.products (id, organization_id)
);
create index ix_produto_unidades_produto on erp.produto_unidades (organization_id, product_id) where deleted_at is null;
create unique index ux_produto_unidades_unidade on erp.produto_unidades (product_id, measurement_id) where deleted_at is null;
comment on table erp.produto_unidades is 'Unidades ALTERNATIVAS e embalagens do produto (a padrão é products.measurement_id). Fator: quantas unidades padrão (multiplica) ou fração (divide). erp.product_packages fica como legado.';

create table erp.produto_fornecedores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  product_id uuid not null,
  person_id uuid not null,
  codigo_no_fornecedor text,
  measurement_id uuid references erp.measurement_units(id),
  preferencial boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  constraint fk_produto_fornecedores_produto foreign key (product_id, organization_id) references erp.products (id, organization_id),
  constraint fk_produto_fornecedores_parceiro foreign key (person_id, organization_id) references erp.people (id, organization_id)
);
create index ix_produto_fornecedores_produto on erp.produto_fornecedores (organization_id, product_id) where deleted_at is null;
create unique index ux_produto_fornecedores_parceiro on erp.produto_fornecedores (product_id, person_id) where deleted_at is null;
create unique index ux_produto_fornecedores_preferencial on erp.produto_fornecedores (product_id) where preferencial and deleted_at is null;
comment on table erp.produto_fornecedores is 'Fornecedores do produto: parceiro com tipo Fornecedor, código do produto no fornecedor, unidade de compra e preferencial (no máximo um).';

create trigger trg_produto_unidades_updated before update on erp.produto_unidades for each row execute function erp.set_updated_at();
create trigger trg_produto_fornecedores_updated before update on erp.produto_fornecedores for each row execute function erp.set_updated_at();
create trigger trg_produto_unidades_audit after insert or update or delete on erp.produto_unidades for each row execute function erp.audit_row();
create trigger trg_produto_fornecedores_audit after insert or update or delete on erp.produto_fornecedores for each row execute function erp.audit_row();

-- a 2ª unidade de hoje vira a primeira linha (as colunas antigas ficam)
insert into erp.produto_unidades (organization_id, product_id, measurement_id, tipo_fator, fator, uso_compra, uso_venda)
select p.organization_id, p.id, p.second_measurement_id, coalesce(p.factor_type, 'multiply'), p.factor, true, true
  from erp.products p
 where p.deleted_at is null and p.second_measurement_id is not null and p.factor > 0 and p.second_measurement_id <> p.measurement_id;

-- ---------- 7) RLS e grants ----------
-- Produto é cadastro da ORGANIZAÇÃO (sem empresa): o recorte é o tenant. Política ÚNICA por tabela.
alter table erp.produto_unidades enable row level security;
alter table erp.produto_unidades force row level security;
create policy tenant_isolation on erp.produto_unidades for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
alter table erp.produto_fornecedores enable row level security;
alter table erp.produto_fornecedores force row level security;
create policy tenant_isolation on erp.produto_fornecedores for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update on erp.produto_unidades, erp.produto_fornecedores to erp_app;
revoke delete on erp.produto_unidades, erp.produto_fornecedores from erp_app;

-- ---------- 8) regras no banco ----------
-- 8.1 has_lot derivado do controle; mudar o controle com saldo ≠ 0 é recusado.
-- SECURITY DEFINER estreita: o saldo é conferido na ORGANIZAÇÃO INTEIRA da linha (a RLS de quem grava poderia
-- esconder saldo de outra empresa); devolve só a recusa, sem SQL dinâmico.
create or replace function erp.products_controle_lote() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if new.controle_lote = 'nenhum' and new.has_lot then new.controle_lote := 'lote'; end if;
  elsif new.controle_lote is distinct from old.controle_lote then
    null;
  elsif new.has_lot is distinct from old.has_lot then
    new.controle_lote := case when new.has_lot then 'lote' else 'nenhum' end;
  end if;
  new.has_lot := new.controle_lote <> 'nenhum';
  if tg_op = 'UPDATE' and new.controle_lote is distinct from old.controle_lote and exists (
       select 1 from erp.stock_balances b
        where b.organization_id = new.organization_id and b.product_id = new.id
        group by b.product_id having sum(b.quantity) <> 0) then
    raise exception 'VALIDATION_ERROR: O produto tem saldo em estoque: zere o saldo em todos os armazéns antes de mudar o controle de lote.';
  end if;
  return new;
end $$;
revoke execute on function erp.products_controle_lote() from public;
create trigger trg_products_controle_lote before insert or update on erp.products for each row execute function erp.products_controle_lote();

-- 8.2 movimento de produto com controle de lote exige lote; lote + validade exige validade na entrada.
-- A perna de ENTRADA da transferência carrega o lote da saída.
-- ESTORNO também exige o lote (R1): ele repete o lote do original, e um estorno SEM lote de produto com controle
-- devolveria saldo ao balde '' — o saldo preso que a pré-condição 2.1 recusa, recriado depois do deploy por quem
-- ainda estorna sem conferir (a API anterior, na janela ou numa reversão). A API nova recusa antes (reverseStock);
-- o banco é a autoridade. Só a exigência de LOTE vale para o estorno: a de validade não, porque o estorno não
-- carrega a validade do original (o saldo do lote já a tem).
create or replace function erp.stock_movements_exige_lote() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
declare v_controle text;
begin
  select p.controle_lote into v_controle from erp.products p where p.id = new.product_id and p.organization_id = new.organization_id;
  if v_controle in ('lote','lote_validade') and coalesce(btrim(new.provider_lot), '') = '' then
    if new.movement_type = 'reversal' then
      raise exception 'VALIDATION_ERROR: Estorno de movimento sem lote de produto com controle de lote: o saldo voltaria sem lote e ficaria preso. Registre o acerto do estoque informando o lote (devolução ou correção de estoque).';
    end if;
    raise exception 'VALIDATION_ERROR: O produto controla lote: informe o lote no movimento.';
  end if;
  if new.movement_type = 'reversal' then return new; end if;
  if v_controle = 'lote_validade' and new.direction = 1 and new.expiration_date is null
     and new.movement_type not in ('transfer_in','farm_transfer_in') then
    raise exception 'VALIDATION_ERROR: O produto controla lote e validade: informe a validade na entrada.';
  end if;
  return new;
end $$;
revoke execute on function erp.stock_movements_exige_lote() from public;
create trigger trg_stock_movements_exige_lote before insert on erp.stock_movements for each row execute function erp.stock_movements_exige_lote();

-- 8.3 unidade alternativa ≠ padrão; fornecedor só parceiro tipo Fornecedor (vivo, da mesma organização).
create or replace function erp.produto_detalhes_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if new.deleted_at is not null then return new; end if;
  if tg_table_name = 'produto_unidades' then
    if exists (select 1 from erp.products p where p.id = new.product_id and p.measurement_id = new.measurement_id) then
      raise exception 'VALIDATION_ERROR: A unidade alternativa não pode repetir a unidade padrão do produto.';
    end if;
  else
    if not exists (select 1 from erp.people x where x.id = new.person_id and x.organization_id = new.organization_id
                    and x.is_provider and x.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O fornecedor do produto precisa ser um parceiro do tipo Fornecedor.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function erp.produto_detalhes_conferir() from public;
create trigger trg_produto_unidades_conferir before insert or update on erp.produto_unidades for each row execute function erp.produto_detalhes_conferir();
create trigger trg_produto_fornecedores_conferir before insert or update on erp.produto_fornecedores for each row execute function erp.produto_detalhes_conferir();

-- ---------- 9) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _f6_antes;
  if (select count(*) from erp.products) <> a.produtos or (select count(*) from erp.stock_movements) <> a.movimentos
     or (select count(*) from erp.product_packages) <> a.embalagens then
    raise exception 'CADASTROS-F6: contagem de products/stock_movements/product_packages mudou; a migration deveria ser aditiva.';
  end if;
  if (select count(*) from erp.products where controle_lote <> 'nenhum') <> a.com_lote then
    raise exception 'CADASTROS-F6: controle_lote nao corresponde ao has_lot de antes.';
  end if;
  if (select count(*) from erp.produto_unidades) <> a.segundas then
    raise exception 'CADASTROS-F6: a 2a unidade nao virou exatamente uma linha de produto_unidades por produto.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname in ('produto_unidades','produto_fornecedores')
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'CADASTROS-F6: tabela nova sem RLS forcada.';
  end if;
end $$;
