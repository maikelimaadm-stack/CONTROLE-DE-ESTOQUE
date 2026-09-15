-- PRE-BASE2-05C-1 — purga física da ponte estrutural legada (farm → empresa)
--
-- Esta é a primeira migration do repositório que APAGA estrutura. Ela remove a ponte de compatibilidade
-- criada pela 0014 (colunas legadas espelhadas, gatilhos de espelho, views de nome antigo, FKs e índices
-- de coluna única) e deixa o modelo canônico `empresa_id` sozinho de pé.
--
-- FORMA. O runner (`packages/db/src/migrate.ts`) executa cada arquivo dentro de UMA transação:
-- begin → arquivo inteiro → insert no ledger → commit. Por isso aqui NÃO existe `commit`, NÃO existe
-- `create index concurrently` e NÃO existe `cascade`: ou tudo é aplicado, ou nada é, e o ledger só recebe
-- a linha se o arquivo inteiro passar.
--
-- LISTAS ESTÁTICAS, NÃO SQL DINÂMICO. Todo objeto removido está nomeado, um a um, na ordem de remoção.
-- Antes de qualquer `drop`, a migration confere que o catálogo contém EXATAMENTE os objetos listados —
-- nem um a mais, nem um a menos. Um objeto legado que alguém tenha acrescentado depois desta lista faz a
-- migration ABORTAR, em vez de sobreviver escondido à purga.
--
-- COMO REPRODUZIR CADA LISTA (as mesmas consultas rodam nas pré-condições abaixo):
--   colunas legadas : pg_attribute, schema erp, relkind 'r', attname in (farm_id, origin_farm_id, destination_farm_id)
--   FKs legadas     : pg_constraint contype 'f' e array_length(conkey,1)=1 sobre coluna legada
--   gatilhos espelho: pg_trigger não interno cuja função é erp.sincronizar_empresa%
--   índices legados : pg_index cujo indkey contém coluna legada
--   views legadas   : as cinco de nome antigo, nomeadas aqui
--
-- O QUE ESTA MIGRATION NÃO FAZ, de propósito:
--   - não toca em `erp.code_sequences` nem em `erp.next_code`. O contador de transição continua com
--     `entity = 'farm'`. Trocá-lo é a 05C-2, outra fatia;
--   - não remove nada por conter a palavra "farm": `erp.farm_transfers`, `animal_farm_transfer`,
--     `batch_farm_transfer`, preferências de usuário, nomes de fazenda em cadastro de cliente e chaves de
--     permissão continuam onde estão. O escopo é a PONTE FÍSICA, não o vocabulário;
--   - não cria índice novo: os oito índices legados já têm gêmeo canônico criado pela 0014, e a
--     pré-condição abaixo exige que os oito gêmeos existam ANTES de remover os legados.


-- ---------------------------------------------------------------------------------------------------
-- 1. TRAVA DE CONCORRÊNCIA DA FATIA
-- ---------------------------------------------------------------------------------------------------
-- O runner não tem trava própria: dois pre-deploys sobrepostos (retentativa por restart policy, redeploy
-- em cima de outro) leem o ledger, os dois veem esta migration como pendente, e os dois tentam aplicá-la.
-- O lock é TRANSACIONAL: sai sozinho no commit ou no rollback, sem caminho de vazamento.
-- Chave (2026, 51) no espaço de DOIS inteiros — espaço distinto do `pg_advisory_xact_lock(bigint)` que a
-- rota de notificações usa, então não há colisão possível entre os dois.
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 51) then
    raise exception 'PRE-BASE2-05C-1: outra transacao ja detem a trava da purga (2026,51). Nada foi aplicado.'
      using errcode = '55P03';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 2. TETO POR COMANDO
-- ---------------------------------------------------------------------------------------------------
-- `lock_timeout` aborta CADA espera por lock que passe de 2 s — de tabela, de índice ou de objeto de
-- catálogo. Ele NÃO é teto da janela inteira: a transação pode acumular várias esperas de até 2 s.
-- Quem reduz a chance de ENTRAR numa espera é o porteiro humano de pré-deploy
-- (docs/PRE-BASE2-05C-1-PREFLIGHT.md, P7.1), não este comando.
set local lock_timeout = '2s';

-- ---------------------------------------------------------------------------------------------------
-- 3. PRÉ-AQUISIÇÃO DETERMINÍSTICA DOS LOCKS DE RELAÇÃO
-- ---------------------------------------------------------------------------------------------------
-- Ordem alfabética, sempre a mesma, para que duas execuções nunca se cruzem em ordens opostas.
-- NOWAIT: se qualquer uma das relações estiver ocupada, a migration falha em milissegundos com 55P03 e a
-- transação inteira volta atrás, em vez de ficar pendurada segurando ACCESS EXCLUSIVE nas demais.
-- A view erp.farms arrasta erp.empresas junto, que por isso também está nomeada aqui.
lock table
     erp.animal_handlings,
     erp.animal_movements,
     erp.animal_retroactive_costs,
     erp.animals,
     erp.areas,
     erp.authorizer_empresas,
     erp.authorizer_farms,
     erp.bank_account_empresas,
     erp.bank_account_farms,
     erp.bank_movements,
     erp.batches,
     erp.breeding_seasons,
     erp.budget_plannings,
     erp.contracts,
     erp.devolutions,
     erp.dfe_documents,
     erp.diet_batches,
     erp.documents,
     erp.earnings,
     erp.empresa_cost_centers,
     erp.empresas,
     erp.equipment_transfers,
     erp.equipments,
     erp.farm_cost_centers,
     erp.farms,
     erp.feed_batches,
     erp.feed_deliveries,
     erp.feedlot_yards,
     erp.financial_freezes,
     erp.financial_titles,
     erp.fuel_supplies,
     erp.grazing_modules,
     erp.herd_lots,
     erp.input_entries,
     erp.invoices,
     erp.journal_entries,
     erp.livestock_plannings,
     erp.maintenances,
     erp.opening_balances,
     erp.processings,
     erp.proprietary_empresas,
     erp.proprietary_farms,
     erp.purchase_requests,
     erp.rainfalls,
     erp.requisitions,
     erp.salary_advances,
     erp.sales_documents,
     erp.service_orders,
     erp.stock_corrections,
     erp.stock_movements,
     erp.stock_writeoffs,
     erp.trough_readings,
     erp.warehouse_transfers,
     erp.warehouses,
     erp.weighings
  in access exclusive mode nowait;

-- ---------------------------------------------------------------------------------------------------
-- 4. PRÉ-CONDIÇÕES — a migration para se o banco não for o que ela pressupõe
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  faltando text;
  sobrando text;
begin
  -- 4.1 colunas legadas: o catálogo tem exatamente as 52 listadas?
  with esperado(tabela, coluna) as (values
    ('animal_handlings', 'farm_id'),
    ('animal_movements', 'destination_farm_id'),
    ('animal_movements', 'farm_id'),
    ('animal_retroactive_costs', 'farm_id'),
    ('animals', 'farm_id'),
    ('areas', 'farm_id'),
    ('authorizer_empresas', 'farm_id'),
    ('bank_account_empresas', 'farm_id'),
    ('bank_movements', 'farm_id'),
    ('batches', 'farm_id'),
    ('breeding_seasons', 'farm_id'),
    ('budget_plannings', 'farm_id'),
    ('contracts', 'farm_id'),
    ('devolutions', 'farm_id'),
    ('dfe_documents', 'farm_id'),
    ('diet_batches', 'farm_id'),
    ('documents', 'farm_id'),
    ('earnings', 'farm_id'),
    ('empresa_cost_centers', 'farm_id'),
    ('equipment_transfers', 'destination_farm_id'),
    ('equipment_transfers', 'origin_farm_id'),
    ('equipments', 'farm_id'),
    ('feed_batches', 'farm_id'),
    ('feed_deliveries', 'farm_id'),
    ('feedlot_yards', 'farm_id'),
    ('financial_freezes', 'farm_id'),
    ('financial_titles', 'farm_id'),
    ('fuel_supplies', 'farm_id'),
    ('grazing_modules', 'farm_id'),
    ('herd_lots', 'farm_id'),
    ('input_entries', 'farm_id'),
    ('invoices', 'farm_id'),
    ('journal_entries', 'farm_id'),
    ('livestock_plannings', 'farm_id'),
    ('maintenances', 'farm_id'),
    ('opening_balances', 'farm_id'),
    ('processings', 'farm_id'),
    ('proprietary_empresas', 'farm_id'),
    ('purchase_requests', 'farm_id'),
    ('rainfalls', 'farm_id'),
    ('requisitions', 'farm_id'),
    ('salary_advances', 'farm_id'),
    ('sales_documents', 'farm_id'),
    ('service_orders', 'farm_id'),
    ('stock_corrections', 'farm_id'),
    ('stock_movements', 'farm_id'),
    ('stock_writeoffs', 'farm_id'),
    ('trough_readings', 'farm_id'),
    ('warehouse_transfers', 'destination_farm_id'),
    ('warehouse_transfers', 'origin_farm_id'),
    ('warehouses', 'farm_id'),
    ('weighings', 'farm_id')
  ), atual as (
    select c.relname::text, a.attname::text from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
       and a.attname in ('farm_id','origin_farm_id','destination_farm_id')
  )
  select string_agg(format('%s.%s', tabela, coluna), ', '),
         (select string_agg(format('%s.%s', relname, attname), ', ')
            from atual a2 where not exists (select 1 from esperado e2
                 where e2.tabela = a2.relname and e2.coluna = a2.attname))
    into faltando, sobrando
    from esperado e where not exists (select 1 from atual a where a.relname = e.tabela and a.attname = e.coluna);
  if faltando is not null or sobrando is not null then
    raise exception 'PRE-BASE2-05C-1: inventario de COLUNAS legadas divergente. Faltando no banco: [%]. Presente no banco e fora da lista: [%].', coalesce(faltando,'-'), coalesce(sobrando,'-');
  end if;
end $$;

do $$
declare faltando text; sobrando text;
begin
  -- 4.2 FKs legadas de coluna única
  with esperado(tabela, restricao) as (values
    ('animal_handlings', 'animal_handlings_farm_id_fkey'),
    ('animal_movements', 'animal_movements_destination_farm_id_fkey'),
    ('animal_movements', 'animal_movements_farm_id_fkey'),
    ('animal_retroactive_costs', 'animal_retroactive_costs_farm_id_fkey'),
    ('animals', 'animals_farm_id_fkey'),
    ('areas', 'areas_farm_id_fkey'),
    ('authorizer_empresas', 'authorizer_farms_farm_id_fkey'),
    ('bank_account_empresas', 'bank_account_farms_farm_id_fkey'),
    ('bank_movements', 'bank_movements_farm_id_fkey'),
    ('batches', 'batches_farm_id_fkey'),
    ('breeding_seasons', 'breeding_seasons_farm_id_fkey'),
    ('budget_plannings', 'budget_plannings_farm_id_fkey'),
    ('contracts', 'contracts_farm_id_fkey'),
    ('devolutions', 'devolutions_farm_id_fkey'),
    ('dfe_documents', 'dfe_documents_farm_id_fkey'),
    ('diet_batches', 'diet_batches_farm_id_fkey'),
    ('documents', 'documents_farm_id_fkey'),
    ('earnings', 'earnings_farm_id_fkey'),
    ('empresa_cost_centers', 'farm_cost_centers_farm_id_fkey'),
    ('equipment_transfers', 'equipment_transfers_destination_farm_id_fkey'),
    ('equipment_transfers', 'equipment_transfers_origin_farm_id_fkey'),
    ('equipments', 'equipments_farm_id_fkey'),
    ('feed_batches', 'feed_batches_farm_id_fkey'),
    ('feed_deliveries', 'feed_deliveries_farm_id_fkey'),
    ('feedlot_yards', 'feedlot_yards_farm_id_fkey'),
    ('financial_freezes', 'financial_freezes_farm_id_fkey'),
    ('financial_titles', 'financial_titles_farm_id_fkey'),
    ('fuel_supplies', 'fuel_supplies_farm_id_fkey'),
    ('grazing_modules', 'grazing_modules_farm_id_fkey'),
    ('herd_lots', 'herd_lots_farm_id_fkey'),
    ('input_entries', 'input_entries_farm_id_fkey'),
    ('invoices', 'invoices_farm_id_fkey'),
    ('journal_entries', 'journal_entries_farm_id_fkey'),
    ('livestock_plannings', 'livestock_plannings_farm_id_fkey'),
    ('maintenances', 'maintenances_farm_id_fkey'),
    ('opening_balances', 'opening_balances_farm_id_fkey'),
    ('processings', 'processings_farm_id_fkey'),
    ('proprietary_empresas', 'proprietary_farms_farm_id_fkey'),
    ('purchase_requests', 'purchase_requests_farm_id_fkey'),
    ('rainfalls', 'rainfalls_farm_id_fkey'),
    ('requisitions', 'requisitions_farm_id_fkey'),
    ('salary_advances', 'salary_advances_farm_id_fkey'),
    ('sales_documents', 'sales_documents_farm_id_fkey'),
    ('service_orders', 'service_orders_farm_id_fkey'),
    ('stock_corrections', 'stock_corrections_farm_id_fkey'),
    ('stock_movements', 'stock_movements_farm_id_fkey'),
    ('stock_writeoffs', 'stock_writeoffs_farm_id_fkey'),
    ('trough_readings', 'trough_readings_farm_id_fkey'),
    ('warehouse_transfers', 'warehouse_transfers_destination_farm_id_fkey'),
    ('warehouse_transfers', 'warehouse_transfers_origin_farm_id_fkey'),
    ('warehouses', 'warehouses_farm_id_fkey'),
    ('weighings', 'weighings_farm_id_fkey')
  ), atual as (
    select c.relname::text, k.conname::text from pg_constraint k
      join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where n.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 1
       and a.attname in ('farm_id','origin_farm_id','destination_farm_id')
  )
  select string_agg(format('%s.%s', tabela, restricao), ', '),
         (select string_agg(format('%s.%s', relname, conname), ', ')
            from atual a2 where not exists (select 1 from esperado e2
                 where e2.tabela = a2.relname and e2.restricao = a2.conname))
    into faltando, sobrando
    from esperado e where not exists (select 1 from atual a where a.relname = e.tabela and a.conname = e.restricao);
  if faltando is not null or sobrando is not null then
    raise exception 'PRE-BASE2-05C-1: inventario de FKs legadas divergente. Faltando: [%]. Fora da lista: [%].', coalesce(faltando,'-'), coalesce(sobrando,'-');
  end if;
end $$;

do $$
declare faltando text; sobrando text;
begin
  -- 4.3 gatilhos de espelho
  with esperado(tabela, gatilho) as (values
    ('animal_handlings', 'trg_sync_empresa_id'),
    ('animal_movements', 'trg_sync_empresa_destino_id'),
    ('animal_movements', 'trg_sync_empresa_id'),
    ('animal_retroactive_costs', 'trg_sync_empresa_id'),
    ('animals', 'trg_sync_empresa_id'),
    ('areas', 'trg_sync_empresa_id'),
    ('authorizer_empresas', 'trg_sync_empresa_id'),
    ('bank_account_empresas', 'trg_sync_empresa_id'),
    ('bank_movements', 'trg_sync_empresa_id'),
    ('batches', 'trg_sync_empresa_id'),
    ('breeding_seasons', 'trg_sync_empresa_id'),
    ('budget_plannings', 'trg_sync_empresa_id'),
    ('contracts', 'trg_sync_empresa_id'),
    ('devolutions', 'trg_sync_empresa_id'),
    ('dfe_documents', 'trg_sync_empresa_id'),
    ('diet_batches', 'trg_sync_empresa_id'),
    ('documents', 'trg_sync_empresa_id'),
    ('earnings', 'trg_sync_empresa_id'),
    ('empresa_cost_centers', 'trg_sync_empresa_id'),
    ('equipment_transfers', 'trg_sync_empresa_destino_id'),
    ('equipment_transfers', 'trg_sync_empresa_origem_id'),
    ('equipments', 'trg_sync_empresa_id'),
    ('feed_batches', 'trg_sync_empresa_id'),
    ('feed_deliveries', 'trg_sync_empresa_id'),
    ('feedlot_yards', 'trg_sync_empresa_id'),
    ('financial_freezes', 'trg_sync_empresa_id'),
    ('financial_titles', 'trg_sync_empresa_id'),
    ('fuel_supplies', 'trg_sync_empresa_id'),
    ('grazing_modules', 'trg_sync_empresa_id'),
    ('herd_lots', 'trg_sync_empresa_id'),
    ('input_entries', 'trg_sync_empresa_id'),
    ('invoices', 'trg_sync_empresa_id'),
    ('journal_entries', 'trg_sync_empresa_id'),
    ('livestock_plannings', 'trg_sync_empresa_id'),
    ('maintenances', 'trg_sync_empresa_id'),
    ('opening_balances', 'trg_sync_empresa_id'),
    ('processings', 'trg_sync_empresa_id'),
    ('proprietary_empresas', 'trg_sync_empresa_id'),
    ('purchase_requests', 'trg_sync_empresa_id'),
    ('rainfalls', 'trg_sync_empresa_id'),
    ('requisitions', 'trg_sync_empresa_id'),
    ('salary_advances', 'trg_sync_empresa_id'),
    ('sales_documents', 'trg_sync_empresa_id'),
    ('service_orders', 'trg_sync_empresa_id'),
    ('stock_corrections', 'trg_sync_empresa_id'),
    ('stock_movements', 'trg_sync_empresa_id'),
    ('stock_writeoffs', 'trg_sync_empresa_id'),
    ('trough_readings', 'trg_sync_empresa_id'),
    ('warehouse_transfers', 'trg_sync_empresa_destino_id'),
    ('warehouse_transfers', 'trg_sync_empresa_origem_id'),
    ('warehouses', 'trg_sync_empresa_id'),
    ('weighings', 'trg_sync_empresa_id')
  ), atual as (
    select c.relname::text, t.tgname::text from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal and p.proname like 'sincronizar_empresa%'
  )
  select string_agg(format('%s.%s', tabela, gatilho), ', '),
         (select string_agg(format('%s.%s', relname, tgname), ', ')
            from atual a2 where not exists (select 1 from esperado e2
                 where e2.tabela = a2.relname and e2.gatilho = a2.tgname))
    into faltando, sobrando
    from esperado e where not exists (select 1 from atual a where a.relname = e.tabela and a.tgname = e.gatilho);
  if faltando is not null or sobrando is not null then
    raise exception 'PRE-BASE2-05C-1: inventario de GATILHOS de espelho divergente. Faltando: [%]. Fora da lista: [%].', coalesce(faltando,'-'), coalesce(sobrando,'-');
  end if;
end $$;

do $$
declare faltando text; sobrando text; sem_gemeo text;
begin
  -- 4.4 índices legados, E o gêmeo canônico de cada um tem de já existir
  with esperado(indice) as (values
    ('animals_organization_id_farm_id_status_idx'),
    ('batches_organization_id_farm_id_status_idx'),
    ('equipments_organization_id_farm_id_status_idx'),
    ('financial_titles_organization_id_farm_id_due_date_idx'),
    ('invoices_organization_id_farm_id_emission_date_idx'),
    ('purchase_requests_organization_id_status_farm_id_idx'),
    ('requisitions_organization_id_farm_id_requisition_date_idx'),
    ('warehouses_organization_id_farm_id_idx')
  ), atual as (
    select ic.relname::text from pg_index i
      join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and exists (
       select 1 from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
         and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))
  )
  select string_agg(indice, ', '),
         (select string_agg(relname, ', ') from atual a2
           where not exists (select 1 from esperado e2 where e2.indice = a2.relname))
    into faltando, sobrando
    from esperado e where not exists (select 1 from atual a where a.relname = e.indice);
  if faltando is not null or sobrando is not null then
    raise exception 'PRE-BASE2-05C-1: inventario de INDICES legados divergente. Faltando: [%]. Fora da lista: [%].', coalesce(faltando,'-'), coalesce(sobrando,'-');
  end if;

  -- o gêmeo canônico: mesma tabela, mesma definição com a coluna canônica no lugar da legada
  select string_agg(l.idx, ', ') into sem_gemeo
    from (select c.relname tab, ic.relname idx,
                 replace(replace(replace(replace(pg_get_indexdef(i.indexrelid), ic.relname, '<idx>'),
                   'destination_farm_id','empresa_destino_id'),'origin_farm_id','empresa_origem_id'),
                   'farm_id','empresa_id') as def_canonica
            from pg_index i join pg_class c on c.oid = i.indrelid join pg_class ic on ic.oid = i.indexrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'erp' and exists (
             select 1 from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey::int2[])
               and a.attname in ('farm_id','origin_farm_id','destination_farm_id'))) l
   where not exists (
     select 1 from pg_index i2 join pg_class c2 on c2.oid = i2.indrelid
       join pg_class ic2 on ic2.oid = i2.indexrelid join pg_namespace n2 on n2.oid = c2.relnamespace
      where n2.nspname = 'erp' and c2.relname = l.tab and ic2.relname <> l.idx
        -- comparação da definição INTEIRA, só com o NOME do índice normalizado: assim `unique`, o método
        -- (`using btree`) e um eventual `where` entram na conta. Comparar apenas a lista de colunas
        -- aceitaria como gêmeo um índice de método diferente — e a purga apagaria um caminho de acesso.
        and replace(pg_get_indexdef(i2.indexrelid), ic2.relname, '<idx>') = l.def_canonica);
  if sem_gemeo is not null then
    raise exception 'PRE-BASE2-05C-1: indice legado SEM gemeo canonico: [%]. Remover aqui apagaria um caminho de acesso.', sem_gemeo;
  end if;
end $$;

do $$
declare v text; f text;
begin
  -- 4.5 as cinco views e as três funções de sincronia existem
  select string_agg(e.nome, ', ') into v from (values ('authorizer_farms'),('bank_account_farms'),
    ('farm_cost_centers'),('farms'),('proprietary_farms')) e(nome)
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'erp' and c.relkind = 'v' and c.relname = e.nome);
  if v is not null then
    raise exception 'PRE-BASE2-05C-1: view legada ausente: [%].', v;
  end if;
  select string_agg(e.nome, ', ') into f from (values ('sincronizar_empresa_destino_legado'),
    ('sincronizar_empresa_legado'),('sincronizar_empresa_origem_legado')) e(nome)
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'erp' and p.proname = e.nome);
  if f is not null then
    raise exception 'PRE-BASE2-05C-1: funcao de sincronia ausente: [%].', f;
  end if;
end $$;

do $$
declare par record; divergentes bigint; exemplos text; total bigint := 0;
begin
  -- 4.6 FAIL CLOSED SOBRE O ACERVO: nenhum par legado/canônico pode divergir.
  -- Se divergir, a purga apagaria o lado que talvez fosse o certo. A decisão é humana: a migration PARA,
  -- com tabela, coluna, contagem e ids de exemplo. Nunca corrige em silêncio.
  -- A lista é ESTÁTICA (a mesma do item 4.1); `format` com %I só formata identificadores dessa lista.
  for par in
    with pares(tabela, legada, canonica, chave) as (values
      ('animal_handlings', 'farm_id', 'empresa_id', 'id::text'),
    ('animal_movements', 'destination_farm_id', 'empresa_destino_id', 'id::text'),
    ('animal_movements', 'farm_id', 'empresa_id', 'id::text'),
    ('animal_retroactive_costs', 'farm_id', 'empresa_id', 'id::text'),
    ('animals', 'farm_id', 'empresa_id', 'id::text'),
    ('areas', 'farm_id', 'empresa_id', 'id::text'),
    ('authorizer_empresas', 'farm_id', 'empresa_id', 'concat_ws(''/'', authorizer_id::text, empresa_id::text)'),
    ('bank_account_empresas', 'farm_id', 'empresa_id', 'concat_ws(''/'', bank_account_id::text, empresa_id::text)'),
    ('bank_movements', 'farm_id', 'empresa_id', 'id::text'),
    ('batches', 'farm_id', 'empresa_id', 'id::text'),
    ('breeding_seasons', 'farm_id', 'empresa_id', 'id::text'),
    ('budget_plannings', 'farm_id', 'empresa_id', 'id::text'),
    ('contracts', 'farm_id', 'empresa_id', 'id::text'),
    ('devolutions', 'farm_id', 'empresa_id', 'id::text'),
    ('dfe_documents', 'farm_id', 'empresa_id', 'id::text'),
    ('diet_batches', 'farm_id', 'empresa_id', 'id::text'),
    ('documents', 'farm_id', 'empresa_id', 'id::text'),
    ('earnings', 'farm_id', 'empresa_id', 'id::text'),
    ('empresa_cost_centers', 'farm_id', 'empresa_id', 'concat_ws(''/'', empresa_id::text, cost_center_id::text)'),
    ('equipment_transfers', 'destination_farm_id', 'empresa_destino_id', 'id::text'),
    ('equipment_transfers', 'origin_farm_id', 'empresa_origem_id', 'id::text'),
    ('equipments', 'farm_id', 'empresa_id', 'id::text'),
    ('feed_batches', 'farm_id', 'empresa_id', 'id::text'),
    ('feed_deliveries', 'farm_id', 'empresa_id', 'id::text'),
    ('feedlot_yards', 'farm_id', 'empresa_id', 'id::text'),
    ('financial_freezes', 'farm_id', 'empresa_id', 'id::text'),
    ('financial_titles', 'farm_id', 'empresa_id', 'id::text'),
    ('fuel_supplies', 'farm_id', 'empresa_id', 'id::text'),
    ('grazing_modules', 'farm_id', 'empresa_id', 'id::text'),
    ('herd_lots', 'farm_id', 'empresa_id', 'id::text'),
    ('input_entries', 'farm_id', 'empresa_id', 'id::text'),
    ('invoices', 'farm_id', 'empresa_id', 'id::text'),
    ('journal_entries', 'farm_id', 'empresa_id', 'id::text'),
    ('livestock_plannings', 'farm_id', 'empresa_id', 'id::text'),
    ('maintenances', 'farm_id', 'empresa_id', 'id::text'),
    ('opening_balances', 'farm_id', 'empresa_id', 'id::text'),
    ('processings', 'farm_id', 'empresa_id', 'id::text'),
    ('proprietary_empresas', 'farm_id', 'empresa_id', 'concat_ws(''/'', person_id::text, empresa_id::text)'),
    ('purchase_requests', 'farm_id', 'empresa_id', 'id::text'),
    ('rainfalls', 'farm_id', 'empresa_id', 'id::text'),
    ('requisitions', 'farm_id', 'empresa_id', 'id::text'),
    ('salary_advances', 'farm_id', 'empresa_id', 'id::text'),
    ('sales_documents', 'farm_id', 'empresa_id', 'id::text'),
    ('service_orders', 'farm_id', 'empresa_id', 'id::text'),
    ('stock_corrections', 'farm_id', 'empresa_id', 'id::text'),
    ('stock_movements', 'farm_id', 'empresa_id', 'id::text'),
    ('stock_writeoffs', 'farm_id', 'empresa_id', 'id::text'),
    ('trough_readings', 'farm_id', 'empresa_id', 'id::text'),
    ('warehouse_transfers', 'destination_farm_id', 'empresa_destino_id', 'id::text'),
    ('warehouse_transfers', 'origin_farm_id', 'empresa_origem_id', 'id::text'),
    ('warehouses', 'farm_id', 'empresa_id', 'id::text'),
    ('weighings', 'farm_id', 'empresa_id', 'id::text')
    ) select * from pares order by tabela, legada
  loop
    -- `chave` e uma expressao da lista estatica acima (id, ou a PK composta): nem toda tabela do escopo
    -- tem coluna `id` — quatro sao tabelas de ligacao com PK composta.
    execute format(
      'select count(*), (select string_agg(k, '', '') from (select %s as k from erp.%I where %I is distinct from %I limit 5) s) from erp.%I where %I is distinct from %I',
      par.chave, par.tabela, par.legada, par.canonica, par.tabela, par.legada, par.canonica)
      into divergentes, exemplos;
    if divergentes > 0 then
      raise exception 'PRE-BASE2-05C-1: acervo divergente em erp.%.% vs %: % linha(s). Exemplos: [%]. Nada foi aplicado; a correcao e humana.',
        par.tabela, par.legada, par.canonica, divergentes, coalesce(exemplos,'-');
    end if;
    total := total + 1;
  end loop;
  if total <> 52 then
    raise exception 'PRE-BASE2-05C-1: esperava conferir 52 pares legado/canonico, conferiu %.', total;
  end if;
end $$;

do $$
declare n bigint;
begin
  -- 4.7 a invariante canônica de transferência tem de ser verdadeira ANTES de virar CHECK
  select count(*) into n from erp.equipment_transfers where empresa_origem_id = empresa_destino_id;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-1: % transferencia(s) de equipamento com origem = destino nas colunas canonicas. O CHECK canonico nao pode ser criado sobre acervo invalido.', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 5. INVARIANTE CANÔNICA ANTES DE REMOVER A LEGADA
-- ---------------------------------------------------------------------------------------------------
-- O CHECK histórico de erp.equipment_transfers nasceu em 0005_sales_fleet_hr.sql:142 sobre as colunas
-- LEGADAS. Se as colunas caíssem primeiro, a única proteção contra transferir um equipamento de uma
-- empresa para ela mesma desapareceria junto — por isso o canônico nasce ANTES, e já validado: como o
-- `add constraint ... check` roda a verificação na hora e a transação já segura ACCESS EXCLUSIVE na
-- tabela, não existe janela entre criar e validar.
alter table erp.equipment_transfers
  add constraint equipment_transfers_empresa_origem_destino_check
  check (empresa_origem_id <> empresa_destino_id);

-- ---------------------------------------------------------------------------------------------------
-- 6. RLS: a última política que ainda decidia por coluna legada
-- ---------------------------------------------------------------------------------------------------
-- `api_child` era a única política do schema cujo predicado citava uma coluna legada. Ela é SUBSTITUÍDA,
-- não acompanhada: duas políticas PERMISSIVE no mesmo comando combinam com OR, e a mais frouxa acabaria
-- valendo. Continua uma única política por comando, com o mesmo predicado dos dois lados (leitura e
-- escrita fazem a mesma pergunta), agora sobre `empresa_id`.
-- `to erp_app` NÃO é detalhe: sem essa cláusula a política nasce para PUBLIC, e uma política PERMISSIVE
-- que alcança todo mundo é mais frouxa que a que ela substitui (0007_rls.sql:113 é `for all to erp_app`).
-- A pós-condição abaixo confere o conjunto de papéis, para que esquecer isto REPROVE em vez de passar.
drop policy api_child on erp.empresa_cost_centers;
create policy api_child on erp.empresa_cost_centers for all to erp_app
  using (exists (select 1 from erp.empresas p
                  where p.id = empresa_cost_centers.empresa_id and erp.tenant_visible(p.organization_id)))
  with check (exists (select 1 from erp.empresas p
                  where p.id = empresa_cost_centers.empresa_id and erp.tenant_visible(p.organization_id)));

-- ---------------------------------------------------------------------------------------------------
-- 7. VIEWS DE NOME ANTIGO
-- ---------------------------------------------------------------------------------------------------
-- Primeiro as views: elas leem as colunas legadas, e `drop column` sem `cascade` recusaria enquanto
-- existissem. Nenhuma depende de outra (verificado em pg_depend), então a ordem entre elas é livre;
-- alfabética por disciplina.
drop view erp.authorizer_farms;
drop view erp.bank_account_farms;
drop view erp.farm_cost_centers;
drop view erp.farms;
drop view erp.proprietary_farms;

-- ---------------------------------------------------------------------------------------------------
-- 8. GATILHOS DE ESPELHO
-- ---------------------------------------------------------------------------------------------------
-- Com as views fora, os 52 gatilhos que copiavam um lado no outro perdem a razão de existir. Eles saem
-- ANTES das funções que executam, senão o `drop function` esbarraria na dependência.
drop trigger trg_sync_empresa_id on erp.animal_handlings;
drop trigger trg_sync_empresa_destino_id on erp.animal_movements;
drop trigger trg_sync_empresa_id on erp.animal_movements;
drop trigger trg_sync_empresa_id on erp.animal_retroactive_costs;
drop trigger trg_sync_empresa_id on erp.animals;
drop trigger trg_sync_empresa_id on erp.areas;
drop trigger trg_sync_empresa_id on erp.authorizer_empresas;
drop trigger trg_sync_empresa_id on erp.bank_account_empresas;
drop trigger trg_sync_empresa_id on erp.bank_movements;
drop trigger trg_sync_empresa_id on erp.batches;
drop trigger trg_sync_empresa_id on erp.breeding_seasons;
drop trigger trg_sync_empresa_id on erp.budget_plannings;
drop trigger trg_sync_empresa_id on erp.contracts;
drop trigger trg_sync_empresa_id on erp.devolutions;
drop trigger trg_sync_empresa_id on erp.dfe_documents;
drop trigger trg_sync_empresa_id on erp.diet_batches;
drop trigger trg_sync_empresa_id on erp.documents;
drop trigger trg_sync_empresa_id on erp.earnings;
drop trigger trg_sync_empresa_id on erp.empresa_cost_centers;
drop trigger trg_sync_empresa_destino_id on erp.equipment_transfers;
drop trigger trg_sync_empresa_origem_id on erp.equipment_transfers;
drop trigger trg_sync_empresa_id on erp.equipments;
drop trigger trg_sync_empresa_id on erp.feed_batches;
drop trigger trg_sync_empresa_id on erp.feed_deliveries;
drop trigger trg_sync_empresa_id on erp.feedlot_yards;
drop trigger trg_sync_empresa_id on erp.financial_freezes;
drop trigger trg_sync_empresa_id on erp.financial_titles;
drop trigger trg_sync_empresa_id on erp.fuel_supplies;
drop trigger trg_sync_empresa_id on erp.grazing_modules;
drop trigger trg_sync_empresa_id on erp.herd_lots;
drop trigger trg_sync_empresa_id on erp.input_entries;
drop trigger trg_sync_empresa_id on erp.invoices;
drop trigger trg_sync_empresa_id on erp.journal_entries;
drop trigger trg_sync_empresa_id on erp.livestock_plannings;
drop trigger trg_sync_empresa_id on erp.maintenances;
drop trigger trg_sync_empresa_id on erp.opening_balances;
drop trigger trg_sync_empresa_id on erp.processings;
drop trigger trg_sync_empresa_id on erp.proprietary_empresas;
drop trigger trg_sync_empresa_id on erp.purchase_requests;
drop trigger trg_sync_empresa_id on erp.rainfalls;
drop trigger trg_sync_empresa_id on erp.requisitions;
drop trigger trg_sync_empresa_id on erp.salary_advances;
drop trigger trg_sync_empresa_id on erp.sales_documents;
drop trigger trg_sync_empresa_id on erp.service_orders;
drop trigger trg_sync_empresa_id on erp.stock_corrections;
drop trigger trg_sync_empresa_id on erp.stock_movements;
drop trigger trg_sync_empresa_id on erp.stock_writeoffs;
drop trigger trg_sync_empresa_id on erp.trough_readings;
drop trigger trg_sync_empresa_destino_id on erp.warehouse_transfers;
drop trigger trg_sync_empresa_origem_id on erp.warehouse_transfers;
drop trigger trg_sync_empresa_id on erp.warehouses;
drop trigger trg_sync_empresa_id on erp.weighings;

-- ---------------------------------------------------------------------------------------------------
-- 9. FUNÇÕES DE SINCRONIA
-- ---------------------------------------------------------------------------------------------------
drop function erp.sincronizar_empresa_destino_legado();
drop function erp.sincronizar_empresa_legado();
drop function erp.sincronizar_empresa_origem_legado();

-- ---------------------------------------------------------------------------------------------------
-- 10. O CHECK LEGADO
-- ---------------------------------------------------------------------------------------------------
-- Removido explicitamente, e não de carona no `drop column`: a substituição canônica já está de pé desde
-- o item 5, e o que sai daqui tem de estar inventariado.
alter table erp.equipment_transfers drop constraint equipment_transfers_check;

-- ---------------------------------------------------------------------------------------------------
-- 11. CHAVES ESTRANGEIRAS DE COLUNA ÚNICA
-- ---------------------------------------------------------------------------------------------------
-- As 52 FKs legadas apontam erp.empresas por UMA coluna. Coluna única não prova tenant: quem fica são as
-- 50 compostas (organization_id, empresa_*), criadas pela 0014. Alguns nomes preservam a grafia antiga da
-- tabela (por exemplo farm_cost_centers_farm_id_fkey em erp.empresa_cost_centers) — nome é história, o
-- que importa é a coluna que a restrição governa.
alter table erp.animal_handlings drop constraint animal_handlings_farm_id_fkey;
alter table erp.animal_movements drop constraint animal_movements_destination_farm_id_fkey;
alter table erp.animal_movements drop constraint animal_movements_farm_id_fkey;
alter table erp.animal_retroactive_costs drop constraint animal_retroactive_costs_farm_id_fkey;
alter table erp.animals drop constraint animals_farm_id_fkey;
alter table erp.areas drop constraint areas_farm_id_fkey;
alter table erp.authorizer_empresas drop constraint authorizer_farms_farm_id_fkey;
alter table erp.bank_account_empresas drop constraint bank_account_farms_farm_id_fkey;
alter table erp.bank_movements drop constraint bank_movements_farm_id_fkey;
alter table erp.batches drop constraint batches_farm_id_fkey;
alter table erp.breeding_seasons drop constraint breeding_seasons_farm_id_fkey;
alter table erp.budget_plannings drop constraint budget_plannings_farm_id_fkey;
alter table erp.contracts drop constraint contracts_farm_id_fkey;
alter table erp.devolutions drop constraint devolutions_farm_id_fkey;
alter table erp.dfe_documents drop constraint dfe_documents_farm_id_fkey;
alter table erp.diet_batches drop constraint diet_batches_farm_id_fkey;
alter table erp.documents drop constraint documents_farm_id_fkey;
alter table erp.earnings drop constraint earnings_farm_id_fkey;
alter table erp.empresa_cost_centers drop constraint farm_cost_centers_farm_id_fkey;
alter table erp.equipment_transfers drop constraint equipment_transfers_destination_farm_id_fkey;
alter table erp.equipment_transfers drop constraint equipment_transfers_origin_farm_id_fkey;
alter table erp.equipments drop constraint equipments_farm_id_fkey;
alter table erp.feed_batches drop constraint feed_batches_farm_id_fkey;
alter table erp.feed_deliveries drop constraint feed_deliveries_farm_id_fkey;
alter table erp.feedlot_yards drop constraint feedlot_yards_farm_id_fkey;
alter table erp.financial_freezes drop constraint financial_freezes_farm_id_fkey;
alter table erp.financial_titles drop constraint financial_titles_farm_id_fkey;
alter table erp.fuel_supplies drop constraint fuel_supplies_farm_id_fkey;
alter table erp.grazing_modules drop constraint grazing_modules_farm_id_fkey;
alter table erp.herd_lots drop constraint herd_lots_farm_id_fkey;
alter table erp.input_entries drop constraint input_entries_farm_id_fkey;
alter table erp.invoices drop constraint invoices_farm_id_fkey;
alter table erp.journal_entries drop constraint journal_entries_farm_id_fkey;
alter table erp.livestock_plannings drop constraint livestock_plannings_farm_id_fkey;
alter table erp.maintenances drop constraint maintenances_farm_id_fkey;
alter table erp.opening_balances drop constraint opening_balances_farm_id_fkey;
alter table erp.processings drop constraint processings_farm_id_fkey;
alter table erp.proprietary_empresas drop constraint proprietary_farms_farm_id_fkey;
alter table erp.purchase_requests drop constraint purchase_requests_farm_id_fkey;
alter table erp.rainfalls drop constraint rainfalls_farm_id_fkey;
alter table erp.requisitions drop constraint requisitions_farm_id_fkey;
alter table erp.salary_advances drop constraint salary_advances_farm_id_fkey;
alter table erp.sales_documents drop constraint sales_documents_farm_id_fkey;
alter table erp.service_orders drop constraint service_orders_farm_id_fkey;
alter table erp.stock_corrections drop constraint stock_corrections_farm_id_fkey;
alter table erp.stock_movements drop constraint stock_movements_farm_id_fkey;
alter table erp.stock_writeoffs drop constraint stock_writeoffs_farm_id_fkey;
alter table erp.trough_readings drop constraint trough_readings_farm_id_fkey;
alter table erp.warehouse_transfers drop constraint warehouse_transfers_destination_farm_id_fkey;
alter table erp.warehouse_transfers drop constraint warehouse_transfers_origin_farm_id_fkey;
alter table erp.warehouses drop constraint warehouses_farm_id_fkey;
alter table erp.weighings drop constraint weighings_farm_id_fkey;

-- ---------------------------------------------------------------------------------------------------
-- 12. ÍNDICES LEGADOS
-- ---------------------------------------------------------------------------------------------------
-- Os oito gêmeos canônicos (*_org_empresa_*) já existem desde a 0014 e a pré-condição 4.4 exigiu a
-- presença de cada um deles. Nenhum caminho de acesso é perdido aqui.
drop index erp.animals_organization_id_farm_id_status_idx;
drop index erp.batches_organization_id_farm_id_status_idx;
drop index erp.equipments_organization_id_farm_id_status_idx;
drop index erp.financial_titles_organization_id_farm_id_due_date_idx;
drop index erp.invoices_organization_id_farm_id_emission_date_idx;
drop index erp.purchase_requests_organization_id_status_farm_id_idx;
drop index erp.requisitions_organization_id_farm_id_requisition_date_idx;
drop index erp.warehouses_organization_id_farm_id_idx;

-- ---------------------------------------------------------------------------------------------------
-- 13. AS 52 COLUNAS LEGADAS
-- ---------------------------------------------------------------------------------------------------
-- Sem `cascade`: a esta altura nada mais depende delas — views, gatilhos, CHECK, FKs e índices já saíram,
-- cada um nomeado. Se alguma dependência tivesse escapado do inventário, o `drop column` falharia aqui e
-- a transação inteira voltaria atrás, que é exatamente o comportamento desejado.
alter table erp.animal_handlings drop column farm_id;
alter table erp.animal_movements drop column destination_farm_id;
alter table erp.animal_movements drop column farm_id;
alter table erp.animal_retroactive_costs drop column farm_id;
alter table erp.animals drop column farm_id;
alter table erp.areas drop column farm_id;
alter table erp.authorizer_empresas drop column farm_id;
alter table erp.bank_account_empresas drop column farm_id;
alter table erp.bank_movements drop column farm_id;
alter table erp.batches drop column farm_id;
alter table erp.breeding_seasons drop column farm_id;
alter table erp.budget_plannings drop column farm_id;
alter table erp.contracts drop column farm_id;
alter table erp.devolutions drop column farm_id;
alter table erp.dfe_documents drop column farm_id;
alter table erp.diet_batches drop column farm_id;
alter table erp.documents drop column farm_id;
alter table erp.earnings drop column farm_id;
alter table erp.empresa_cost_centers drop column farm_id;
alter table erp.equipment_transfers drop column destination_farm_id;
alter table erp.equipment_transfers drop column origin_farm_id;
alter table erp.equipments drop column farm_id;
alter table erp.feed_batches drop column farm_id;
alter table erp.feed_deliveries drop column farm_id;
alter table erp.feedlot_yards drop column farm_id;
alter table erp.financial_freezes drop column farm_id;
alter table erp.financial_titles drop column farm_id;
alter table erp.fuel_supplies drop column farm_id;
alter table erp.grazing_modules drop column farm_id;
alter table erp.herd_lots drop column farm_id;
alter table erp.input_entries drop column farm_id;
alter table erp.invoices drop column farm_id;
alter table erp.journal_entries drop column farm_id;
alter table erp.livestock_plannings drop column farm_id;
alter table erp.maintenances drop column farm_id;
alter table erp.opening_balances drop column farm_id;
alter table erp.processings drop column farm_id;
alter table erp.proprietary_empresas drop column farm_id;
alter table erp.purchase_requests drop column farm_id;
alter table erp.rainfalls drop column farm_id;
alter table erp.requisitions drop column farm_id;
alter table erp.salary_advances drop column farm_id;
alter table erp.sales_documents drop column farm_id;
alter table erp.service_orders drop column farm_id;
alter table erp.stock_corrections drop column farm_id;
alter table erp.stock_movements drop column farm_id;
alter table erp.stock_writeoffs drop column farm_id;
alter table erp.trough_readings drop column farm_id;
alter table erp.warehouse_transfers drop column destination_farm_id;
alter table erp.warehouse_transfers drop column origin_farm_id;
alter table erp.warehouses drop column farm_id;
alter table erp.weighings drop column farm_id;

-- ---------------------------------------------------------------------------------------------------
-- 14. PÓS-CONDIÇÕES — a migration confere o próprio resultado antes de deixar o commit acontecer
-- ---------------------------------------------------------------------------------------------------
do $$
declare n bigint; txt text;
begin
  select count(*) into n from pg_attribute a join pg_class c on c.oid = a.attrelid
    join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and a.attname in ('farm_id','origin_farm_id','destination_farm_id');
  if n <> 0 then raise exception 'PRE-BASE2-05C-1: sobraram % coluna(s) legada(s).', n; end if;

  select count(*) into n from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'erp' and c.relkind = 'v'
     and c.relname in ('farms','proprietary_farms','authorizer_farms','bank_account_farms','farm_cost_centers');
  if n <> 0 then raise exception 'PRE-BASE2-05C-1: sobraram % view(s) de nome antigo.', n; end if;

  select count(*) into n from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and p.proname like 'sincronizar_empresa%';
  if n <> 0 then raise exception 'PRE-BASE2-05C-1: sobraram % gatilho(s) de espelho.', n; end if;

  select count(*) into n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'erp' and p.proname like 'sincronizar_empresa%';
  if n <> 0 then raise exception 'PRE-BASE2-05C-1: sobraram % funcao(oes) de sincronia.', n; end if;

  -- as 50 compostas canônicas continuam de pé, e VALIDADAS
  select count(*) into n from pg_constraint k join pg_class c on c.oid = k.conrelid
    join pg_namespace n2 on n2.oid = c.relnamespace
   where n2.nspname = 'erp' and k.contype = 'f' and array_length(k.conkey,1) = 2
     and k.confrelid = 'erp.empresas'::regclass and k.convalidated;
  if n <> 50 then raise exception 'PRE-BASE2-05C-1: esperava 50 FKs compostas canonicas validadas, encontrou %.', n; end if;

  -- o CHECK canônico existe e está validado
  select count(*) into n from pg_constraint
   where conrelid = 'erp.equipment_transfers'::regclass and contype = 'c'
     and conname = 'equipment_transfers_empresa_origem_destino_check' and convalidated;
  if n <> 1 then raise exception 'PRE-BASE2-05C-1: CHECK canonico de transferencia ausente ou nao validado.'; end if;

  -- a policy reescrita alcança EXATAMENTE quem alcançava antes. Sem esta conferência, um `create policy`
  -- sem `to` passaria despercebido e ampliaria o alcance para PUBLIC no meio de uma migration de PURGA.
  select string_agg(policyname, ', ') into txt from pg_policies
   where schemaname = 'erp' and roles::text[] @> array['public'];
  if txt is not null then
    raise exception 'PRE-BASE2-05C-1: policy alcancando PUBLIC apos a purga: [%]. Nenhuma politica deste schema pode valer para public.', txt;
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'erp' and tablename = 'empresa_cost_centers' and policyname = 'api_child'
     and roles::text[] = array['erp_app'];
  if n <> 1 then
    raise exception 'PRE-BASE2-05C-1: api_child de empresa_cost_centers deveria alcancar exatamente {erp_app}.';
  end if;

  -- nenhuma policy do schema decide mais por coluna legada
  select string_agg(format('%s.%s', schemaname, policyname), ', ') into txt from pg_policies
   where schemaname = 'erp'
     and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(farm_id|origin_farm_id|destination_farm_id)';
  if txt is not null then raise exception 'PRE-BASE2-05C-1: policy ainda cita coluna legada: [%].', txt; end if;

  -- o contador de transição NÃO foi tocado por esta fatia
  if to_regclass('erp.code_sequences') is null then
    raise exception 'PRE-BASE2-05C-1: erp.code_sequences sumiu. Esta fatia nao pode tocar no contador.';
  end if;
end $$;

