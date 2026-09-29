-- =====================================================================
-- 0035 TOP-CONFIG-07 — RESERVA DE ESTOQUE PELO PEDIDO — decisão 266
--
-- 1) erp.tipos_operacao_versoes.reserva_estoque: a VERSÃO da TOP declara se o pedido reserva estoque. Numa coluna,
--    e não no JSON do formato 3 (estrito — uma chave nova quebraria toda versão gravada e o binário anterior
--    durante o deploy). Nasce false: toda versão existente continua sem reservar, e nada muda no que existe.
--    Só a família pedido (`vendas.pedido`) pode ligar: um gatilho recusa a versão de outra família com true.
-- 2) O RESERVADO É CONTA, NÃO COLUNA. Por (armazém, produto), a soma de:
--      A) pedidos com reserva, abertos ('open'/'approved') e sem saldo encerrado: o saldo a faturar de cada item
--         (quantidade − partes em documentos não cancelados, TOP-CONFIG-06);
--      B) vendas abertas ('open'/'approved') geradas de pedido com reserva (por partes ou pela conversão inteira):
--         a quantidade dos itens delas.
--    Converter move a reserva de A para B sem mudar o total; confirmar a venda tira a parte dela de B (a saída
--    acontece); cancelar a venda devolve a A se o pedido estiver aberto; cancelar o pedido ou encerrar o saldo
--    tira A. Nenhuma dessas transições atualiza coisa alguma: a conta lê o estado.
-- 3) erp.reserva_estoque_nucleo(org, armazéns[], produtos[], excluir): a conta, num lugar só. SECURITY DEFINER
--    (lê pedidos e vendas da organização INTEIRA, qualquer que seja o módulo de quem pergunta), search_path fixo,
--    sem SQL dinâmico, devolve SÓ números. SEM grant para erp_app: só o dono a chama — o gatilho de saída e a
--    porta exposta abaixo.
-- 4) erp.reserva_estoque(armazéns[], produtos[], excluir): a PORTA EXPOSTA à API. Organização e usuário vêm da
--    GUC do servidor, nunca de parâmetro; reconfere DENTRO a capacidade de estoque OU de venda; sem ela, zero
--    linhas. Leitura em LOTE: uma chamada leva os pares de uma página inteira.
-- 5) INVARIANTE NO BANCO: gatilho AFTER INSERT em erp.stock_movements (trg_stock_movement_reserva). AFTER roda
--    depois de TODO gatilho BEFORE — inclusive trg_stock_movement_apply (0003), que já baixou o saldo do lote —, e
--    o nome também ordena depois dele. Em toda saída (direction −1), menos acerto de inventário (correction_out)
--    e estorno (reversal), confere: saldo físico que sobra no armazém (todos os lotes) ≥ reservado pelos OUTROS.
--    Saída de venda (source_type 'sales_documents') não conta a parte B da própria venda. Não coube →
--    'INSUFFICIENT_STOCK: …' (código existente, 409). O uso pelo gatilho NÃO depende da capacidade de quem
--    movimenta: quem movimenta já passou pela porta da própria rota.
-- 6) Índice parcial em erp.sales_document_items (product_id, warehouse_id): a conta parte dos pares.
--
-- SEM BACKFILL: coluna nova false; nenhum saldo, movimento ou documento muda.
-- JANELA DE DEPLOY: a API anterior não lê a coluna; o gatilho não recusa nada enquanto nenhuma versão reservar.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 69) then
    raise exception 'TOP-CONFIG-07: outra transacao ja detem a trava desta migration (2026,69). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.tipos_operacao_versoes') is null or to_regclass('erp.tipos_operacao') is null then
    raise exception 'TOP-CONFIG-07: erp.tipos_operacao/erp.tipos_operacao_versoes ausente; a 0020 nao esta aplicada.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'sales_document_items' and column_name = 'origem_item_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'sales_documents' and column_name = 'saldo_encerrado_em') then
    raise exception 'TOP-CONFIG-07: a 0034 nao esta aplicada (origem_item_id/saldo_encerrado_em ausente); aplique a 0034 antes.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'sales_documents' and column_name = 'tipo_operacao_versao_id') then
    raise exception 'TOP-CONFIG-07: erp.sales_documents.tipo_operacao_versao_id ausente; a 0021 nao esta aplicada.';
  end if;
  if to_regclass('erp.stock_movements') is null or to_regclass('erp.stock_balances') is null
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass
                     and t.tgname = 'trg_stock_movement_apply' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-07: erp.stock_movements/stock_balances ou trg_stock_movement_apply (0003) ausente; o gatilho da reserva depende do saldo ja aplicado.';
  end if;
  if to_regprocedure('erp.has_permission(uuid,uuid,text)') is null or to_regprocedure('erp.current_org_id()') is null
     or to_regprocedure('erp.effective_user_id()') is null then
    raise exception 'TOP-CONFIG-07: erp.has_permission/erp.current_org_id/erp.effective_user_id ausente; a porta estreita depende das tres.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'tipos_operacao_versoes' and column_name = 'reserva_estoque')
     or to_regprocedure('erp.reserva_estoque(uuid[],uuid[],uuid)') is not null
     or to_regprocedure('erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)') is not null then
    raise exception 'TOP-CONFIG-07: reserva_estoque ja existe; a 0035 ja foi aplicada ou ha schema divergente.';
  end if;
  -- A PORTA ESTREITA SÓ FUNCIONA SE O DONO DA FUNÇÃO ATRAVESSA A RLS: sem isso a conta devolveria o recorte de
  -- empresa de quem chama — e o gatilho deixaria de ver a reserva de um pedido fora do escopo de quem movimenta.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'TOP-CONFIG-07: o papel que aplica a migration (dono das funcoes) nao atravessa RLS; a conta da reserva nao teria a visao da organizacao.';
  end if;
end $$;

create temporary table _top07_antes on commit drop as
  select (select count(*) from erp.tipos_operacao_versoes) as versoes,
         (select count(*) from erp.stock_movements) as movimentos,
         (select count(*) from erp.stock_balances) as saldos,
         (select coalesce(sum(quantity), 0) from erp.stock_balances) as quantidade_total,
         (select count(*) from erp.sales_documents) as documentos;

-- ---------- 3) a versão declara "Reservar estoque" ----------
alter table erp.tipos_operacao_versoes
  add column reserva_estoque boolean not null default false;
comment on column erp.tipos_operacao_versoes.reserva_estoque is
  'TOP-CONFIG-07: o pedido criado com esta versao reserva estoque por (armazem, produto). So familia vendas.pedido. Imutavel com a versao.';

create or replace function erp.tipos_operacao_versao_reserva_familia() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from erp.tipos_operacao t
                  where t.id = NEW.tipo_operacao_id and t.organization_id = NEW.organization_id
                    and t.codigo_base = 'vendas.pedido') then
    raise exception 'VALIDATION_ERROR: so a familia pedido pode reservar estoque'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;
revoke execute on function erp.tipos_operacao_versao_reserva_familia() from public;

create trigger trg_tipos_operacao_versoes_reserva_familia
  before insert on erp.tipos_operacao_versoes
  for each row when (NEW.reserva_estoque)
  execute function erp.tipos_operacao_versao_reserva_familia();

-- ---------- 4) índice da conta ----------
create index ix_sales_document_items_reserva
  on erp.sales_document_items (product_id, warehouse_id) where warehouse_id is not null;

-- ---------- 5) a conta, num lugar só (núcleo; só o dono chama) ----------
create function erp.reserva_estoque_nucleo(p_org uuid, p_armazens uuid[], p_produtos uuid[], p_excluir_documento uuid)
  returns table (warehouse_id uuid, product_id uuid, reservado numeric)
language sql stable security definer set search_path = erp, pg_temp as $$
  with pares as (
    select distinct x.w as warehouse_id, x.p as product_id
      from unnest(p_armazens, p_produtos) as x(w, p)
     where p_org is not null and x.w is not null and x.p is not null
  ),
  -- A) o saldo a faturar dos pedidos com reserva, abertos e sem saldo encerrado
  a as (
    select oi.warehouse_id, oi.product_id,
           greatest(oi.quantity - coalesce((select sum(pi.quantity)
                                               from erp.sales_document_items pi
                                               join erp.sales_documents pd on pd.id = pi.document_id
                                              where pi.origem_item_id = oi.id and pd.status <> 'cancelled'), 0), 0) as q
      from pares x
      join erp.sales_document_items oi on oi.product_id = x.product_id and oi.warehouse_id = x.warehouse_id
      join erp.sales_documents o on o.id = oi.document_id
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
     where o.organization_id = p_org and o.kind = 'order' and o.status in ('open', 'approved')
       and o.saldo_encerrado_em is null and o.deleted_at is null and v.reserva_estoque
       and o.id is distinct from p_excluir_documento
  ),
  -- B) as vendas abertas geradas de pedido com reserva
  b as (
    select si.warehouse_id, si.product_id, si.quantity as q
      from pares x
      join erp.sales_document_items si on si.product_id = x.product_id and si.warehouse_id = x.warehouse_id
      join erp.sales_documents s on s.id = si.document_id
      join erp.sales_documents o on o.id = s.origin_document_id and o.organization_id = s.organization_id
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
     where s.organization_id = p_org and s.kind = 'sale' and s.status in ('open', 'approved') and s.deleted_at is null
       and o.kind = 'order' and v.reserva_estoque
       and s.id is distinct from p_excluir_documento
  )
  select x.warehouse_id, x.product_id,
         (coalesce((select sum(a.q) from a where a.warehouse_id = x.warehouse_id and a.product_id = x.product_id), 0)
        + coalesce((select sum(b.q) from b where b.warehouse_id = x.warehouse_id and b.product_id = x.product_id), 0))::numeric(18,4)
    from pares x
$$;
comment on function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) is
  'TOP-CONFIG-07: reservado por (armazem, produto) na organizacao informada = A (saldo a faturar de pedidos com reserva abertos) + B (itens de vendas abertas geradas deles). Sem grant: so o dono chama (gatilho de saida e erp.reserva_estoque).';
revoke execute on function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) from public;

-- ---------- 6) a porta exposta à API ----------
-- · SECURITY DEFINER com search_path FIXO; sem SQL dinâmico.
-- · organização = erp.current_org_id(); usuário = erp.effective_user_id() — NUNCA parâmetro do chamador.
-- · reconfere DENTRO a capacidade de estoque OU de venda; sem ela, zero linhas.
-- · uma linha por par (armazém, produto) distinto e válido; no máximo 1000 pares por chamada.
create function erp.reserva_estoque(p_armazens uuid[], p_produtos uuid[], p_excluir_documento uuid default null)
  returns table (warehouse_id uuid, product_id uuid, reservado numeric)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null or p_armazens is null or p_produtos is null
     or cardinality(p_armazens) <> cardinality(p_produtos) or cardinality(p_armazens) > 1000 then
    return;
  end if;
  if not (erp.has_permission(v_org, v_user, 'stocks.view')
          or erp.has_permission(v_org, v_user, 'orders.view')
          or erp.has_permission(v_org, v_user, 'orders.create')
          or erp.has_permission(v_org, v_user, 'orders.edit')
          or erp.has_permission(v_org, v_user, 'sales.view')
          or erp.has_permission(v_org, v_user, 'sales.create')
          or erp.has_permission(v_org, v_user, 'sales.edit')) then
    return;
  end if;
  return query select n.warehouse_id, n.product_id, n.reservado
                 from erp.reserva_estoque_nucleo(v_org, p_armazens, p_produtos, p_excluir_documento) n;
end $$;
comment on function erp.reserva_estoque(uuid[], uuid[], uuid) is
  'TOP-CONFIG-07: reservado por (armazem, produto) na organizacao da GUC, em lote. Porta estreita: exige capacidade de estoque ou de venda; sem ela, zero linhas. Devolve so numeros.';
revoke execute on function erp.reserva_estoque(uuid[], uuid[], uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'erp_app') then
    execute 'grant execute on function erp.reserva_estoque(uuid[], uuid[], uuid) to erp_app';
  end if;
end $$;

-- ---------- 7) a invariante na saída ----------
create function erp.stock_movement_reserva_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_fisico numeric;
  v_reservado numeric;
  v_excluir uuid;
begin
  if NEW.direction <> -1 or NEW.movement_type in ('correction_out', 'reversal') then
    return null;
  end if;
  v_excluir := case when NEW.source_type = 'sales_documents' then NEW.source_id end;
  -- O saldo do lote já foi baixado por trg_stock_movement_apply (BEFORE), que também travou a linha do produto:
  -- esta conta roda sob a mesma trava que serializa o salvamento de um pedido com reserva do mesmo produto.
  select coalesce(sum(b.quantity), 0) into v_fisico
    from erp.stock_balances b
   where b.organization_id = NEW.organization_id and b.warehouse_id = NEW.warehouse_id and b.product_id = NEW.product_id;
  select coalesce(sum(n.reservado), 0) into v_reservado
    from erp.reserva_estoque_nucleo(NEW.organization_id, array[NEW.warehouse_id], array[NEW.product_id], v_excluir) n;
  if v_fisico < v_reservado then
    raise exception 'INSUFFICIENT_STOCK: disponível % < solicitado % (% reservado para pedidos)',
      replace(trim_scale(v_fisico + NEW.quantity - v_reservado)::text, '.', ','),
      replace(trim_scale(NEW.quantity)::text, '.', ','),
      replace(trim_scale(v_reservado)::text, '.', ',')
      using errcode = 'P0001';
  end if;
  return null;
end $$;
comment on function erp.stock_movement_reserva_guarda() is
  'TOP-CONFIG-07: recusa saida (menos correction_out e reversal) que deixaria o fisico do armazem abaixo do reservado pelos outros. Nao depende da capacidade de quem movimenta.';
revoke execute on function erp.stock_movement_reserva_guarda() from public;

create trigger trg_stock_movement_reserva
  after insert on erp.stock_movements
  for each row when (NEW.direction = -1 and NEW.movement_type not in ('correction_out', 'reversal'))
  execute function erp.stock_movement_reserva_guarda();

-- ---------- 7b) só a porta exposta é da API ----------
-- A 0007 declarou `alter default privileges ... grant execute on functions to erp_app`: sem este revoke o núcleo
-- nasceria executável pela API, e a conferência de capacidade da porta exposta viraria enfeite.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'erp_app') then
    execute 'revoke execute on function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) from erp_app';
    execute 'revoke execute on function erp.stock_movement_reserva_guarda() from erp_app';
    execute 'revoke execute on function erp.tipos_operacao_versao_reserva_familia() from erp_app';
  end if;
end $$;

-- ---------- 8) pós-condições nomeadas ----------
do $$
declare a record;
begin
  select * into a from _top07_antes;
  if (select count(*) from erp.tipos_operacao_versoes) <> a.versoes or (select count(*) from erp.stock_movements) <> a.movimentos
     or (select count(*) from erp.stock_balances) <> a.saldos or (select coalesce(sum(quantity), 0) from erp.stock_balances) <> a.quantidade_total
     or (select count(*) from erp.sales_documents) <> a.documentos then
    raise exception 'TOP-CONFIG-07: contagem de versoes/movimentos/saldos/documentos ou a quantidade total em estoque mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.tipos_operacao_versoes where reserva_estoque) then
    raise exception 'TOP-CONFIG-07: versao existente nasceu reservando estoque; nada deveria mudar no que existe.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass
                  and t.tgname = 'trg_stock_movement_reserva' and not t.tgisinternal
                  and (t.tgtype & 2) = 0          -- não BEFORE: AFTER
                  and (t.tgtype & 1) = 1          -- ROW
                  and (t.tgtype & 4) = 4) then    -- INSERT
    raise exception 'TOP-CONFIG-07: trg_stock_movement_reserva ausente ou nao e AFTER INSERT FOR EACH ROW; a invariante da reserva nao esta no banco.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass
                  and t.tgname = 'trg_stock_movement_apply' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-07: trg_stock_movement_apply (0003) sumiu.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.tipos_operacao_versoes'::regclass
                  and t.tgname = 'trg_tipos_operacao_versoes_imutavel' and not t.tgisinternal)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.tipos_operacao_versoes'::regclass
                  and t.tgname = 'trg_tipos_operacao_versoes_reserva_familia' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-07: a imutabilidade da versao (0020) ou a guarda de familia da reserva esta ausente.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'erp' and p.proname in ('reserva_estoque', 'reserva_estoque_nucleo', 'stock_movement_reserva_guarda')
         and p.prosecdef
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) <> 3 then
    raise exception 'TOP-CONFIG-07: funcoes da reserva sem SECURITY DEFINER ou sem search_path fixo.';
  end if;
  if has_function_privilege('public', 'erp.reserva_estoque(uuid[],uuid[],uuid)', 'execute')
     or has_function_privilege('public', 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)', 'execute') then
    raise exception 'TOP-CONFIG-07: public ainda executa a conta da reserva; a porta estreita exige revoke.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app') and (
       not has_function_privilege('erp_app', 'erp.reserva_estoque(uuid[],uuid[],uuid)', 'execute')
       or has_function_privilege('erp_app', 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)', 'execute')) then
    raise exception 'TOP-CONFIG-07: erp_app deve executar so a porta exposta (erp.reserva_estoque), nunca o nucleo.';
  end if;
  if to_regclass('erp.ix_sales_document_items_reserva') is null then
    raise exception 'TOP-CONFIG-07: indice da conta da reserva ausente.';
  end if;
end $$;
