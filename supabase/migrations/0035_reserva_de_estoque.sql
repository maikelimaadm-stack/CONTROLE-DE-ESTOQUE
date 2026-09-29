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
--    SÓ PRODUTO COM CONTROLE DE ESTOQUE (products.control_stock) entra em A e em B: produto sem controle não tem
--    saldo nem movimento (postStock recusa), então reservá-lo seria prometer o que não existe e travaria todo
--    pedido com serviço. Para ele a conta devolve 0 — e a guarda (item 5) nunca o vê, porque ele não tem saída.
-- 3) erp.reserva_estoque_nucleo(org, armazéns[], produtos[], excluir): a conta, num lugar só (só itens de produto
--    com controle de estoque, pelo join em erp.products da MESMA organização do documento). SECURITY DEFINER
--    (lê pedidos e vendas da organização INTEIRA, qualquer que seja o módulo de quem pergunta), search_path fixo,
--    sem SQL dinâmico, devolve SÓ números. SEM grant para ninguém além do dono: só o gatilho de saída e a porta
--    exposta abaixo a chamam.
-- 4) erp.reserva_estoque(armazéns[], produtos[], excluir): a PORTA EXPOSTA à API. Organização e usuário vêm da
--    GUC do servidor, nunca de parâmetro; reconfere DENTRO a capacidade de estoque OU de venda; sem ela, zero
--    linhas. Leitura em LOTE: uma chamada leva os pares de uma página inteira.
-- 5) INVARIANTE NO BANCO: gatilho AFTER INSERT em erp.stock_movements (trg_stock_movement_reserva). AFTER roda
--    depois de TODO gatilho BEFORE — inclusive trg_stock_movement_apply (0003), que já baixou o saldo do lote e
--    travou a linha do produto —, e o nome também ordena depois dele. Em toda saída (direction −1), menos acerto
--    de inventário (correction_out) e estorno (reversal), confere: saldo físico que sobra no armazém (todos os
--    lotes) ≥ reservado pelos OUTROS. Saída de VENDA (source_type 'sales_documents' apontando uma venda da mesma
--    organização) não conta a parte B dela mesma. Não coube → 'INSUFFICIENT_STOCK: …' (código existente, 409).
--    O uso pelo gatilho NÃO depende da capacidade de quem movimenta: quem movimenta já passou pela porta da
--    própria rota. Organização sem nenhuma versão que reserve não paga a conta (A e B são zero por definição).
-- 6) Índices: a conta parte dos documentos VIVOS (abertos, pelo índice (organização, espécie, situação) que já
--    existe) e chega aos itens POR DOCUMENTO — sem o índice por documento, cada saída leria todo o histórico
--    de itens do par. O índice por (produto, armazém) cobre o caso inverso (muitos documentos vivos, par com
--    pouco histórico); o planejador escolhe. O índice parcial das versões que reservam atende o atalho do gatilho.
-- 7) O FLAG NÃO MUDA SOB RESERVA VIVA: products.control_stock decide o que a conta enxerga (item 2) e é lido ao vivo
--    pelo núcleo, pela API e pela guarda. Gatilho BEFORE UPDATE OF control_stock em erp.products
--    (trg_products_controle_estoque_reserva) recusa a troca, nas DUAS direções, enquanto houver item do produto em A
--    ou em B: false→true ativaria reserva que a API nunca conferiu (armazém, empresa, disponível); true→false tiraria
--    em silêncio a reserva prometida (e o ciclo true→false→true pularia a conferência).
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
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'TOP-CONFIG-07: papel erp_app ausente (0007); a porta exposta nao teria a quem ser concedida.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'tipos_operacao_versoes' and column_name = 'reserva_estoque')
     or to_regprocedure('erp.reserva_estoque(uuid[],uuid[],uuid)') is not null
     or to_regprocedure('erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)') is not null
     or to_regprocedure('erp.stock_movement_reserva_guarda()') is not null
     or to_regclass('erp.ix_sales_document_items_reserva') is not null
     or to_regclass('erp.ix_sales_document_items_documento') is not null
     or to_regclass('erp.ix_tipos_operacao_versoes_reserva') is not null
     or to_regprocedure('erp.products_controle_estoque_reserva()') is not null
     or exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass and t.tgname = 'trg_stock_movement_reserva')
     or exists (select 1 from pg_trigger t where t.tgrelid = 'erp.products'::regclass and t.tgname = 'trg_products_controle_estoque_reserva') then
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
         (select count(*) from erp.sales_documents) as documentos,
         (select count(*) from erp.sales_document_items) as itens;

-- ---------- 3) a versão declara "Reservar estoque" ----------
alter table erp.tipos_operacao_versoes
  add column reserva_estoque boolean not null default false;
comment on column erp.tipos_operacao_versoes.reserva_estoque is
  'TOP-CONFIG-07: o pedido criado com esta versao reserva estoque por (armazem, produto). So familia vendas.pedido. Imutavel com a versao.';

-- A família da TOP é imutável (0020, trg_tipos_operacao_identidade_estavel) e a versão também (0020,
-- trg_tipos_operacao_versoes_imutavel): conferir no INSERT basta. SEM security definer: lê a TOP sob a RLS de
-- quem grava — TOP que quem grava não enxerga também é recusada (fail closed).
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

create trigger trg_tipos_operacao_versoes_reserva_familia
  before insert on erp.tipos_operacao_versoes
  for each row when (NEW.reserva_estoque)
  execute function erp.tipos_operacao_versao_reserva_familia();

-- ---------- 4) índices da conta ----------
create index ix_sales_document_items_reserva
  on erp.sales_document_items (product_id, warehouse_id) where warehouse_id is not null;
create index ix_sales_document_items_documento
  on erp.sales_document_items (document_id);
create index ix_tipos_operacao_versoes_reserva
  on erp.tipos_operacao_versoes (organization_id) where reserva_estoque;

-- ---------- 5) a conta, num lugar só (núcleo; só o dono chama) ----------
-- A e B são agregados UMA vez por par e só então juntados aos pares pedidos: uma chamada com 1000 pares custa
-- o mesmo que uma com 1 (a forma com subconsulta por par reexecutava a conta 1000 vezes). PL/pgSQL, e não SQL:
-- a guarda chama a conta em TODA saída, e o plano de uma função SQL é refeito a cada chamada; o do PL/pgSQL fica
-- em cache na conexão. `use_column`: os nomes da saída (warehouse_id, product_id) são sempre as colunas.
create function erp.reserva_estoque_nucleo(p_org uuid, p_armazens uuid[], p_produtos uuid[], p_excluir_documento uuid)
  returns table (warehouse_id uuid, product_id uuid, reservado numeric)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
#variable_conflict use_column
begin
  return query
  with pares as (
    select distinct x.w as warehouse_id, x.p as product_id
      from unnest(p_armazens, p_produtos) as x(w, p)
     where p_org is not null and x.w is not null and x.p is not null
  ),
  -- A) o saldo a faturar dos pedidos com reserva, abertos e sem saldo encerrado (partes: a mesma conta da 0034);
  --    só item de produto com controle de estoque (o sem controle não tem saldo a prometer)
  a as (
    select oi.warehouse_id, oi.product_id,
           sum(greatest(oi.quantity - coalesce((select sum(pi.quantity)
                                                   from erp.sales_document_items pi
                                                   join erp.sales_documents pd on pd.id = pi.document_id
                                                  where pi.origem_item_id = oi.id and pd.status <> 'cancelled'), 0), 0)) as q
      from erp.sales_documents o
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
      join erp.sales_document_items oi on oi.document_id = o.id
      join pares x on x.warehouse_id = oi.warehouse_id and x.product_id = oi.product_id
      join erp.products p on p.id = oi.product_id and p.organization_id = o.organization_id and p.control_stock
     where o.organization_id = p_org and o.kind = 'order' and o.status in ('open', 'approved')
       and o.saldo_encerrado_em is null and o.deleted_at is null and v.reserva_estoque
       and o.id is distinct from p_excluir_documento
     group by oi.warehouse_id, oi.product_id
  ),
  -- B) as vendas abertas geradas de pedido com reserva; só item de produto com controle de estoque
  b as (
    select si.warehouse_id, si.product_id, sum(si.quantity) as q
      from erp.sales_documents s
      join erp.sales_documents o on o.id = s.origin_document_id and o.organization_id = s.organization_id
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
      join erp.sales_document_items si on si.document_id = s.id
      join pares x on x.warehouse_id = si.warehouse_id and x.product_id = si.product_id
      join erp.products p on p.id = si.product_id and p.organization_id = s.organization_id and p.control_stock
     where s.organization_id = p_org and s.kind = 'sale' and s.status in ('open', 'approved') and s.deleted_at is null
       and o.kind = 'order' and v.reserva_estoque
       and s.id is distinct from p_excluir_documento
     group by si.warehouse_id, si.product_id
  )
  select x.warehouse_id, x.product_id, (coalesce(a.q, 0) + coalesce(b.q, 0))::numeric(18,4)
    from pares x
    left join a on a.warehouse_id = x.warehouse_id and a.product_id = x.product_id
    left join b on b.warehouse_id = x.warehouse_id and b.product_id = x.product_id;
end $$;
comment on function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) is
  'TOP-CONFIG-07: reservado por (armazem, produto) na organizacao informada = A (saldo a faturar de pedidos com reserva abertos) + B (itens de vendas abertas geradas deles), so produto com controle de estoque (products.control_stock). Sem grant: so o dono chama (gatilho de saida e erp.reserva_estoque).';

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

-- ---------- 7) a invariante na saída ----------
-- VOLÁTIL DE PROPÓSITO (o padrão, sem `stable`): cada instrução tira foto NOVA. Declarada `stable`, a guarda leria
-- com a foto da própria instrução de INSERT — o saldo de ANTES da baixa e sem o pedido que comitou durante a
-- espera pela trava do produto. A pós-condição confere.
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
  -- ATALHO EXATO: A e B exigem uma versão com reserva DA MESMA organização; sem nenhuma, o reservado é zero e a
  -- saída de quem não usa a reserva não paga a conta.
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = NEW.organization_id and v.reserva_estoque) then
    return null;
  end if;
  -- Só a VENDA que está saindo tira a própria parte B. Uma origem que não é venda desta organização não exclui
  -- nada — um source_id apontando um pedido não pode tirar a reserva do pedido da conta.
  if NEW.source_type = 'sales_documents' then
    select s.id into v_excluir from erp.sales_documents s
     where s.id = NEW.source_id and s.organization_id = NEW.organization_id and s.kind = 'sale';
  end if;
  -- CONCORRÊNCIA: trg_stock_movement_apply (BEFORE) já baixou o saldo do lote e travou a linha do produto
  -- (`update erp.products`); o salvamento de um pedido com reserva trava a MESMA linha (`for update`) antes de
  -- conferir. Cada instrução abaixo tira foto nova (READ COMMITTED): um pedido que comitou enquanto esta saída
  -- esperava a trava do produto ENTRA na conta.
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

create trigger trg_stock_movement_reserva
  after insert on erp.stock_movements
  for each row when (NEW.direction = -1 and NEW.movement_type not in ('correction_out', 'reversal'))
  execute function erp.stock_movement_reserva_guarda();

-- ---------- 7a) o flag control_stock não muda sob reserva viva ----------
-- O flag decide se o item entra na conta, e a API só confere armazém, empresa e disponível do item CONTROLADO.
-- Trocá-lo com documento vivo citando o produto mudaria a reserva por fora da conferência: false→true ativa reserva
-- nunca conferida (armazém de outra empresa, acima do físico: disponível negativo e saídas bloqueadas); true→false
-- tira em silêncio a reserva já prometida. Recusa nas DUAS direções enquanto houver item do produto (com ou sem
-- armazém) em A ou em B — as mesmas condições do núcleo, sem o saldo a faturar (fail closed).
-- · SECURITY DEFINER com search_path fixo: confere a organização INTEIRA da linha (a RLS de quem grava esconderia
--   pedido de outra empresa); devolve só a recusa; sem SQL dinâmico.
-- · VOLÁTIL DE PROPÓSITO (o padrão): o salvamento do pedido trava a linha do produto (`for no key update`) antes de
--   conferir; este UPDATE espera essa trava, e cada instrução abaixo tira foto NOVA — o pedido que comitou durante a
--   espera entra na conferência. Com `stable`, a foto seria a do UPDATE, de antes da espera.
create function erp.products_controle_estoque_reserva() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  -- ATALHO EXATO (índice parcial ix_tipos_operacao_versoes_reserva): sem versão que reserve, A e B são vazios.
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = NEW.organization_id and v.reserva_estoque) then
    return NEW;
  end if;
  if exists (select 1
               from erp.sales_documents o
               join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
               join erp.sales_document_items oi on oi.document_id = o.id
              where o.organization_id = NEW.organization_id and o.kind = 'order' and o.status in ('open', 'approved')
                and o.saldo_encerrado_em is null and o.deleted_at is null and v.reserva_estoque
                and oi.product_id = NEW.id)
     or exists (select 1
               from erp.sales_documents s
               join erp.sales_documents o on o.id = s.origin_document_id and o.organization_id = s.organization_id
               join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
               join erp.sales_document_items si on si.document_id = s.id
              where s.organization_id = NEW.organization_id and s.kind = 'sale' and s.status in ('open', 'approved')
                and s.deleted_at is null and o.kind = 'order' and v.reserva_estoque
                and si.product_id = NEW.id) then
    raise exception 'VALIDATION_ERROR: O produto está em pedido com reserva de estoque em aberto (ou em venda aberta gerada dele): não pode mudar "Controla estoque" agora. Fature, cancele ou encerre o saldo do pedido antes.'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;
comment on function erp.products_controle_estoque_reserva() is
  'TOP-CONFIG-07: recusa trocar products.control_stock (nas duas direcoes) enquanto houver item do produto em pedido com reserva aberto ou em venda aberta gerada dele: o flag decide o que a conta da reserva enxerga. Confere a organizacao inteira; devolve so a recusa.';

create trigger trg_products_controle_estoque_reserva
  before update of control_stock on erp.products
  for each row when (OLD.control_stock is distinct from NEW.control_stock)
  execute function erp.products_controle_estoque_reserva();

-- ---------- 7b) quem executa o quê ----------
-- A 0007 declarou `alter default privileges ... grant execute on functions to erp_app`, e toda função nasce com
-- execute para PUBLIC: sem a revogação o núcleo nasceria executável pela API (e a conferência de capacidade da
-- porta viraria enfeite). Revoga-se de TODO papel além do dono — PUBLIC, erp_app e qualquer outro que um
-- default privilege do ambiente tenha concedido — e só a porta exposta ganha erp_app. Gatilho não precisa de
-- execute de quem grava. (Os nomes vêm do catálogo; nada aqui vem de entrada de usuário.)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('reserva_estoque', 'reserva_estoque_nucleo', 'stock_movement_reserva_guarda', 'tipos_operacao_versao_reserva_familia',
                         'products_controle_estoque_reserva')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;
grant execute on function erp.reserva_estoque(uuid[], uuid[], uuid) to erp_app;

-- ---------- 8) pós-condições nomeadas ----------
do $$
declare a record;
begin
  select * into a from _top07_antes;
  if (select count(*) from erp.tipos_operacao_versoes) <> a.versoes or (select count(*) from erp.stock_movements) <> a.movimentos
     or (select count(*) from erp.stock_balances) <> a.saldos or (select coalesce(sum(quantity), 0) from erp.stock_balances) <> a.quantidade_total
     or (select count(*) from erp.sales_documents) <> a.documentos or (select count(*) from erp.sales_document_items) <> a.itens then
    raise exception 'TOP-CONFIG-07: contagem de versoes/movimentos/saldos/documentos/itens ou a quantidade total em estoque mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.tipos_operacao_versoes where reserva_estoque) then
    raise exception 'TOP-CONFIG-07: versao existente nasceu reservando estoque; nada deveria mudar no que existe.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass
                  and t.tgname = 'trg_stock_movement_reserva' and not t.tgisinternal and t.tgenabled = 'O'
                  and t.tgfoid = 'erp.stock_movement_reserva_guarda()'::regprocedure
                  and (t.tgtype & 2) = 0          -- não BEFORE: AFTER
                  and (t.tgtype & 1) = 1          -- ROW
                  and (t.tgtype & 4) = 4) then    -- INSERT
    raise exception 'TOP-CONFIG-07: trg_stock_movement_reserva ausente, desligado, com outra funcao ou nao e AFTER INSERT FOR EACH ROW; a invariante da reserva nao esta no banco.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.stock_movements'::regclass
                  and t.tgname = 'trg_stock_movement_apply' and not t.tgisinternal and t.tgenabled = 'O'
                  and (t.tgtype & 2) = 2) then
    raise exception 'TOP-CONFIG-07: trg_stock_movement_apply (0003) sumiu, esta desligado ou deixou de ser BEFORE; a guarda leria o saldo antes da baixa.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.tipos_operacao_versoes'::regclass
                  and t.tgname = 'trg_tipos_operacao_versoes_imutavel' and not t.tgisinternal)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.tipos_operacao_versoes'::regclass
                  and t.tgname = 'trg_tipos_operacao_versoes_reserva_familia' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-07: a imutabilidade da versao (0020) ou a guarda de familia da reserva esta ausente.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'erp' and p.proname in ('reserva_estoque', 'reserva_estoque_nucleo', 'stock_movement_reserva_guarda', 'products_controle_estoque_reserva')
         and p.prosecdef
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) <> 4 then
    raise exception 'TOP-CONFIG-07: funcoes da reserva sem SECURITY DEFINER ou sem search_path fixo.';
  end if;
  if (select p.provolatile from pg_proc p where p.oid = 'erp.stock_movement_reserva_guarda()'::regprocedure) <> 'v' then
    raise exception 'TOP-CONFIG-07: a guarda de saida precisa ser VOLATIL (foto nova por instrucao); stable leria o saldo de antes da baixa e perderia o pedido comitado durante a espera.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.products'::regclass
                  and t.tgname = 'trg_products_controle_estoque_reserva' and not t.tgisinternal and t.tgenabled = 'O'
                  and t.tgfoid = 'erp.products_controle_estoque_reserva()'::regprocedure
                  and (t.tgtype & 2) = 2            -- BEFORE
                  and (t.tgtype & 1) = 1            -- ROW
                  and (t.tgtype & 16) = 16          -- UPDATE
                  and (t.tgtype & (4 | 8 | 32)) = 0 -- só UPDATE
                  and array(select unnest(t.tgattr::int2[])) = array[(select c.attnum from pg_attribute c   -- UPDATE OF control_stock
                                                                    where c.attrelid = 'erp.products'::regclass and c.attname = 'control_stock')])
     or (select p.provolatile from pg_proc p where p.oid = 'erp.products_controle_estoque_reserva()'::regprocedure) <> 'v' then
    raise exception 'TOP-CONFIG-07: trg_products_controle_estoque_reserva ausente, desligado, com outra funcao, nao e BEFORE UPDATE OF control_stock FOR EACH ROW ou a funcao nao e VOLATIL; o flag control_stock mudaria sob reserva viva.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
             where n.nspname = 'erp'
               and p.proname in ('reserva_estoque', 'reserva_estoque_nucleo', 'stock_movement_reserva_guarda', 'tipos_operacao_versao_reserva_familia',
                                 'products_controle_estoque_reserva')
               and x.privilege_type = 'EXECUTE' and x.grantee <> p.proowner
               and not (p.proname = 'reserva_estoque' and x.grantee = 'erp_app'::regrole)) then
    raise exception 'TOP-CONFIG-07: papel alem do dono executa a conta da reserva (so erp_app, e so na porta exposta erp.reserva_estoque).';
  end if;
  if not has_function_privilege('erp_app', 'erp.reserva_estoque(uuid[],uuid[],uuid)', 'execute')
     or has_function_privilege('erp_app', 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)', 'execute')
     or has_function_privilege('public', 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)', 'execute')
     or has_function_privilege('public', 'erp.reserva_estoque(uuid[],uuid[],uuid)', 'execute') then
    raise exception 'TOP-CONFIG-07: erp_app deve executar so a porta exposta (erp.reserva_estoque); public, nada.';
  end if;
  if to_regclass('erp.ix_sales_document_items_reserva') is null or to_regclass('erp.ix_sales_document_items_documento') is null
     or to_regclass('erp.ix_tipos_operacao_versoes_reserva') is null then
    raise exception 'TOP-CONFIG-07: indice da conta da reserva ausente.';
  end if;
end $$;
