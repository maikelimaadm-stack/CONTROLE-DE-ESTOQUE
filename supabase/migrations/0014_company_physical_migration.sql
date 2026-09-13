-- =====================================================================================================
-- PRE-BASE2-03 — MIGRAÇÃO FÍSICA FAZENDA → EMPRESA (parte 1: schema canônico + compatibilidade)
--
-- Até aqui a Empresa existia como CONTRATO (docs/MULTI-COMPANY-CONTRACT.md) sobre um schema que ainda
-- falava "fazenda": `erp.farms`, `farm_id`, `origin_farm_id`, `destination_farm_id`. Esta migration
-- materializa o conceito — e faz isso sem exigir uma troca atômica impossível entre três serviços
-- (banco, API e web) que sobem em momentos diferentes.
--
-- ESTRATÉGIA: EXPAND. O nome canônico passa a existir; o nome legado continua existindo e apontando para
-- o MESMO dado, com sincronização garantida pelo banco. A remoção do legado é missão futura, quando
-- nenhuma versão viva o usar mais.
--
--   1. `erp.farms` é RENOMEADA para `erp.empresas` (preserva OID, dados, FKs, índices, políticas) e o
--      nome antigo volta como VIEW de compatibilidade `security_invoker` — que NÃO contorna a RLS.
--   2. Cada tabela com `farm_id` ganha `empresa_id`; `origin_farm_id`/`destination_farm_id` ganham
--      `empresa_origem_id`/`empresa_destino_id`. O valor é copiado e passa a ser sincronizado por gatilho.
--   3. Divergência entre o par legado e o canônico na MESMA operação é RECUSADA. Escolher um dos dois em
--      silêncio seria pior que falhar: gravaria empresa diferente da que o cliente pediu.
--   4. A referência canônica é COMPOSTA — `(organization_id, empresa_id)` → `erp.empresas(organization_id, id)`.
--      A FK de coluna única prova que o UUID é uma empresa; não prova que é uma empresa DESTA organização.
--   5. `erp.member_farms`, que deixou de ser autoridade na PRE-BASE2-02, é APOSENTADA: o conteúdo vai para
--      um arquivo morto com nome neutro e a tabela sai do schema ativo.
--
-- AUTORIDADE CONCEITUAL: `empresa_id`. `farm_id` é ESPELHO DE COMPATIBILIDADE, não uma segunda verdade —
-- runtime novo lê e escreve o canônico; nenhuma regra nova pode eleger o legado como fonte.
--
-- A RLS empresarial vem na 0015, separada de propósito: schema e política têm riscos e reversões
-- diferentes, e misturá-las tornaria as duas irreversíveis juntas.
-- =====================================================================================================

-- ---------- 0) PREFLIGHT: auditar o acervo ANTES de restringir ----------
-- Uma migration que "conserta" dado calado troca um problema visível por um invisível. Se existir linha
-- cuja empresa pertence a OUTRA organização, isso é incidente de isolamento: a FK de coluna única nunca
-- proibiu, e a linha pode estar sendo lida por quem não deveria. Anular ou reatribuir a empresa aqui
-- destruiria a evidência e mudaria o significado do lançamento. A migration PARA e entrega o diagnóstico.
do $$
declare r record; total bigint := 0; detalhe text := '';
begin
  for r in
    select c.table_name as tabela, c.column_name as coluna
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'erp'
       and c.column_name in ('farm_id','origin_farm_id','destination_farm_id')
       and exists (select 1 from information_schema.columns o
                    where o.table_schema='erp' and o.table_name=c.table_name and o.column_name='organization_id')
     order by c.table_name, c.column_name
  loop
    declare n bigint;
    begin
      execute format(
        'select count(*) from erp.%I x join erp.farms f on f.id = x.%I where x.%I is not null and f.organization_id is distinct from x.organization_id',
        r.tabela, r.coluna, r.coluna) into n;
      if n > 0 then
        total := total + n;
        detalhe := detalhe || format(' · erp.%s.%s: %s linha(s)', r.tabela, r.coluna, n);
      end if;
    end;
  end loop;
  if total > 0 then
    raise exception
      'PRE-BASE2-03: % linha(s) apontam para empresa de OUTRA organizacao.%  Nenhuma correcao automatica foi aplicada: anular ou reatribuir a empresa apagaria a evidencia de um incidente de isolamento e mudaria o significado do lancamento. Liste os casos por tabela com: select x.id, x.organization_id, x.<coluna>, f.organization_id as org_da_empresa from erp.<tabela> x join erp.farms f on f.id = x.<coluna> where f.organization_id is distinct from x.organization_id; decida caso a caso e reaplique esta migration.',
      total, detalhe;
  end if;
end $$;

-- ---------- 1) erp.farms → erp.empresas ----------
-- RENAME, não CREATE+COPY: preserva OID, dados, chaves estrangeiras que apontam para cá, índices,
-- políticas de RLS e privilégios. Copiar exigiria recriar 53 chaves estrangeiras e abriria uma janela em
-- que as duas tabelas divergem.
alter table erp.farms rename to empresas;
alter table erp.empresas rename constraint farms_pkey to empresas_pkey;
alter table erp.empresas rename constraint farms_org_id_key to empresas_org_id_key;
alter table erp.empresas rename constraint farms_organization_id_code_key to empresas_organization_id_code_key;

comment on table erp.empresas is 'EMPRESA: entidade operacional/juridica dona do registro (PRE-BASE2-03). Antes chamada erp.farms, nome herdado do nicho agro. A organizacao (organization_id) continua sendo o tenant; empresa e escopo DENTRO dela.';

-- View de compatibilidade. `security_invoker = true` é OBRIGATÓRIO e não é detalhe: sem ele a view roda
-- com os privilégios do DONO e a RLS do dono — e o dono é superusuário, que NÃO tem RLS. A view viraria
-- uma porta dos fundos para a organização inteira. Comprovado em `packages/db/test/empresa-compat.test.ts`,
-- que lê pelos dois nomes sob o papel da aplicação e exige o MESMO conjunto de linhas.
-- Sendo view simples sobre UMA tabela, é automaticamente atualizável: INSERT/UPDATE/DELETE e os DEFAULT
-- da tabela base funcionam pelo nome antigo enquanto a versão anterior da API estiver viva.
create view erp.farms with (security_invoker = true) as select * from erp.empresas;
comment on view erp.farms is 'COMPATIBILIDADE (PRE-BASE2-03): nome legado de erp.empresas. security_invoker = true faz a RLS da tabela base valer para quem consulta. Runtime novo NAO usa este nome.';
grant select, insert, update, delete on erp.farms to erp_app;
grant select on erp.farms to authenticated;

-- ---------- 2) colunas canônicas + espelho sincronizado ----------
-- Três funções de gatilho, uma por par de colunas. São PL/pgSQL com acesso direto ao campo (NEW.empresa_id),
-- o que funciona em qualquer tabela que tenha o par e evita o custo de to_jsonb/jsonb_populate_record linha
-- a linha. A regra é a mesma nas três:
--   INSERT  → o lado informado preenche o outro; ambos informados e DIFERENTES = recusa.
--   UPDATE  → o lado que MUDOU manda; os dois mudando para valores diferentes = recusa.
-- Recusar é o ponto: escolher um dos dois calado gravaria uma empresa que o cliente não pediu, e o erro
-- só apareceria num relatório meses depois.
create or replace function erp.sincronizar_empresa_legado() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.empresa_id is null and NEW.farm_id is not null then NEW.empresa_id := NEW.farm_id;
    elsif NEW.farm_id is null and NEW.empresa_id is not null then NEW.farm_id := NEW.empresa_id;
    elsif NEW.empresa_id is distinct from NEW.farm_id then
      raise exception 'VALIDATION_ERROR: empresa_id (%) e farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_id, NEW.farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  else
    if NEW.empresa_id is distinct from OLD.empresa_id and NEW.farm_id is not distinct from OLD.farm_id then
      NEW.farm_id := NEW.empresa_id;
    elsif NEW.farm_id is distinct from OLD.farm_id and NEW.empresa_id is not distinct from OLD.empresa_id then
      NEW.empresa_id := NEW.farm_id;
    elsif NEW.empresa_id is distinct from NEW.farm_id then
      raise exception 'VALIDATION_ERROR: empresa_id (%) e farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_id, NEW.farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;

create or replace function erp.sincronizar_empresa_origem_legado() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.empresa_origem_id is null and NEW.origin_farm_id is not null then NEW.empresa_origem_id := NEW.origin_farm_id;
    elsif NEW.origin_farm_id is null and NEW.empresa_origem_id is not null then NEW.origin_farm_id := NEW.empresa_origem_id;
    elsif NEW.empresa_origem_id is distinct from NEW.origin_farm_id then
      raise exception 'VALIDATION_ERROR: empresa_origem_id (%) e origin_farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_origem_id, NEW.origin_farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  else
    if NEW.empresa_origem_id is distinct from OLD.empresa_origem_id and NEW.origin_farm_id is not distinct from OLD.origin_farm_id then
      NEW.origin_farm_id := NEW.empresa_origem_id;
    elsif NEW.origin_farm_id is distinct from OLD.origin_farm_id and NEW.empresa_origem_id is not distinct from OLD.empresa_origem_id then
      NEW.empresa_origem_id := NEW.origin_farm_id;
    elsif NEW.empresa_origem_id is distinct from NEW.origin_farm_id then
      raise exception 'VALIDATION_ERROR: empresa_origem_id (%) e origin_farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_origem_id, NEW.origin_farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;

create or replace function erp.sincronizar_empresa_destino_legado() returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.empresa_destino_id is null and NEW.destination_farm_id is not null then NEW.empresa_destino_id := NEW.destination_farm_id;
    elsif NEW.destination_farm_id is null and NEW.empresa_destino_id is not null then NEW.destination_farm_id := NEW.empresa_destino_id;
    elsif NEW.empresa_destino_id is distinct from NEW.destination_farm_id then
      raise exception 'VALIDATION_ERROR: empresa_destino_id (%) e destination_farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_destino_id, NEW.destination_farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  else
    if NEW.empresa_destino_id is distinct from OLD.empresa_destino_id and NEW.destination_farm_id is not distinct from OLD.destination_farm_id then
      NEW.destination_farm_id := NEW.empresa_destino_id;
    elsif NEW.destination_farm_id is distinct from OLD.destination_farm_id and NEW.empresa_destino_id is not distinct from OLD.empresa_destino_id then
      NEW.empresa_destino_id := NEW.destination_farm_id;
    elsif NEW.empresa_destino_id is distinct from NEW.destination_farm_id then
      raise exception 'VALIDATION_ERROR: empresa_destino_id (%) e destination_farm_id (%) divergentes em erp.%: informe apenas um, ou os dois com o mesmo valor', NEW.empresa_destino_id, NEW.destination_farm_id, TG_TABLE_NAME using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;

comment on function erp.sincronizar_empresa_legado() is 'PRE-BASE2-03: mantem empresa_id e farm_id iguais durante a janela de compatibilidade. Divergencia na mesma operacao e recusada (VALIDATION_ERROR), nunca resolvida por escolha silenciosa.';

-- As 52 colunas canônicas, UMA A UMA.
--
-- Poderiam sair de um laço sobre o catálogo do banco, e a primeira versão desta migration fazia isso. Não
-- serve: o dicionário de dados, o inventário e os gates estruturais leem o SCHEMA A PARTIR DO TEXTO das
-- migrations (scripts/lib/schema.mjs) — é assim que a documentação não tem como divergir do banco. Coluna
-- criada dentro de `do $$ … execute format(…)` é invisível para eles, e a documentação passaria a mentir
-- silenciosamente. Explícito também é o que permite REVISAR a lista, que é o pedido central desta migração:
-- nada de substituição cega. Tabela NOVA com `farm_id` não entra aqui sozinha — de propósito: quem cobra
-- isso é o gate `company-schema-sync`, que falha o CI, e não uma migration que já rodou.
-- Todas nascem ANULÁVEIS: `add column ... not null` sem default é recusado em tabela QUE JÁ TEM LINHAS,
-- e este é o caso real de quem faz upgrade (o banco fresh, vazio, esconderia o problema). O NOT NULL entra
-- depois da cópia, só nas que o legado já exigia.
alter table erp.animal_handlings add column empresa_id uuid;
alter table erp.animal_movements add column empresa_destino_id uuid;
alter table erp.animal_movements add column empresa_id uuid;
alter table erp.animal_retroactive_costs add column empresa_id uuid;
alter table erp.animals add column empresa_id uuid;
alter table erp.areas add column empresa_id uuid;
alter table erp.authorizer_farms add column empresa_id uuid;
alter table erp.bank_account_farms add column empresa_id uuid;
alter table erp.bank_movements add column empresa_id uuid;
alter table erp.batches add column empresa_id uuid;
alter table erp.breeding_seasons add column empresa_id uuid;
alter table erp.budget_plannings add column empresa_id uuid;
alter table erp.contracts add column empresa_id uuid;
alter table erp.devolutions add column empresa_id uuid;
alter table erp.dfe_documents add column empresa_id uuid;
alter table erp.diet_batches add column empresa_id uuid;
alter table erp.documents add column empresa_id uuid;
alter table erp.earnings add column empresa_id uuid;
alter table erp.equipment_transfers add column empresa_destino_id uuid;
alter table erp.equipment_transfers add column empresa_origem_id uuid;
alter table erp.equipments add column empresa_id uuid;
alter table erp.farm_cost_centers add column empresa_id uuid;
alter table erp.feed_batches add column empresa_id uuid;
alter table erp.feed_deliveries add column empresa_id uuid;
alter table erp.feedlot_yards add column empresa_id uuid;
alter table erp.financial_freezes add column empresa_id uuid;
alter table erp.financial_titles add column empresa_id uuid;
alter table erp.fuel_supplies add column empresa_id uuid;
alter table erp.grazing_modules add column empresa_id uuid;
alter table erp.herd_lots add column empresa_id uuid;
alter table erp.input_entries add column empresa_id uuid;
alter table erp.invoices add column empresa_id uuid;
alter table erp.journal_entries add column empresa_id uuid;
alter table erp.livestock_plannings add column empresa_id uuid;
alter table erp.maintenances add column empresa_id uuid;
alter table erp.opening_balances add column empresa_id uuid;
alter table erp.processings add column empresa_id uuid;
alter table erp.proprietary_farms add column empresa_id uuid;
alter table erp.purchase_requests add column empresa_id uuid;
alter table erp.rainfalls add column empresa_id uuid;
alter table erp.requisitions add column empresa_id uuid;
alter table erp.salary_advances add column empresa_id uuid;
alter table erp.sales_documents add column empresa_id uuid;
alter table erp.service_orders add column empresa_id uuid;
alter table erp.stock_corrections add column empresa_id uuid;
alter table erp.stock_movements add column empresa_id uuid;
alter table erp.stock_writeoffs add column empresa_id uuid;
alter table erp.trough_readings add column empresa_id uuid;
alter table erp.warehouse_transfers add column empresa_destino_id uuid;
alter table erp.warehouse_transfers add column empresa_origem_id uuid;
alter table erp.warehouses add column empresa_id uuid;
alter table erp.weighings add column empresa_id uuid;

-- Cópia do valor legado + gatilho de sincronização + referência canônica.
do $$
declare r record; canonico text; funcao text; gatilho text; tem_org boolean;
begin
  for r in
    select c.table_name as tabela, c.column_name as coluna
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
     where c.table_schema='erp'
       and c.column_name in ('farm_id','origin_farm_id','destination_farm_id')
       and c.table_name <> 'member_farms'   -- aposentada na seção 4
     order by c.table_name, c.column_name
  loop
    canonico := case r.coluna when 'farm_id' then 'empresa_id'
                              when 'origin_farm_id' then 'empresa_origem_id'
                              else 'empresa_destino_id' end;
    funcao   := case r.coluna when 'farm_id' then 'erp.sincronizar_empresa_legado'
                              when 'origin_farm_id' then 'erp.sincronizar_empresa_origem_legado'
                              else 'erp.sincronizar_empresa_destino_legado' end;
    gatilho  := 'trg_sync_' || canonico;

    execute format('update erp.%I set %I = %I', r.tabela, canonico, r.coluna);
    execute format('comment on column erp.%I.%I is %L', r.tabela, canonico,
      'EMPRESA do registro (PRE-BASE2-03). Coluna CANONICA: e ela que o runtime novo le e grava.');
    execute format('comment on column erp.%I.%I is %L', r.tabela, r.coluna,
      'LEGADO / ESPELHO DE COMPATIBILIDADE (PRE-BASE2-03) de ' || canonico || '. Mantida igual por gatilho enquanto a versao anterior da API estiver viva; NAO e autoridade e nenhuma regra nova deve le-la.');

    execute format('drop trigger if exists %I on erp.%I', gatilho, r.tabela);
    execute format('create trigger %I before insert or update on erp.%I for each row execute function %s()', gatilho, r.tabela, funcao);

    -- Referência canônica: COMPOSTA quando a tabela tem organization_id (prova o tenant), simples quando não
    -- tem (tabelas de vínculo, que herdam a organização do pai — classificadas na matriz de RLS).
    select exists (select 1 from information_schema.columns o
                    where o.table_schema='erp' and o.table_name=r.tabela and o.column_name='organization_id')
      into tem_org;
    if tem_org then
      execute format('alter table erp.%I add constraint %I foreign key (organization_id, %I) references erp.empresas (organization_id, id)',
                     r.tabela, r.tabela || '_' || canonico || '_org_fkey', canonico);
    else
      execute format('alter table erp.%I add constraint %I foreign key (%I) references erp.empresas (id) on delete cascade',
                     r.tabela, r.tabela || '_' || canonico || '_fkey', canonico);
    end if;
  end loop;
end $$;

-- Agora que o valor foi copiado, a obrigatoriedade acompanha exatamente a da coluna legada.
alter table erp.animal_handlings alter column empresa_id set not null;
alter table erp.animal_movements alter column empresa_id set not null;
alter table erp.animal_retroactive_costs alter column empresa_id set not null;
alter table erp.animals alter column empresa_id set not null;
alter table erp.areas alter column empresa_id set not null;
alter table erp.authorizer_farms alter column empresa_id set not null;
alter table erp.bank_account_farms alter column empresa_id set not null;
alter table erp.batches alter column empresa_id set not null;
alter table erp.breeding_seasons alter column empresa_id set not null;
alter table erp.contracts alter column empresa_id set not null;
alter table erp.devolutions alter column empresa_id set not null;
alter table erp.diet_batches alter column empresa_id set not null;
alter table erp.earnings alter column empresa_id set not null;
alter table erp.equipment_transfers alter column empresa_destino_id set not null;
alter table erp.equipment_transfers alter column empresa_origem_id set not null;
alter table erp.equipments alter column empresa_id set not null;
alter table erp.farm_cost_centers alter column empresa_id set not null;
alter table erp.feed_batches alter column empresa_id set not null;
alter table erp.feed_deliveries alter column empresa_id set not null;
alter table erp.feedlot_yards alter column empresa_id set not null;
alter table erp.financial_titles alter column empresa_id set not null;
alter table erp.fuel_supplies alter column empresa_id set not null;
alter table erp.grazing_modules alter column empresa_id set not null;
alter table erp.herd_lots alter column empresa_id set not null;
alter table erp.input_entries alter column empresa_id set not null;
alter table erp.invoices alter column empresa_id set not null;
alter table erp.livestock_plannings alter column empresa_id set not null;
alter table erp.maintenances alter column empresa_id set not null;
alter table erp.opening_balances alter column empresa_id set not null;
alter table erp.processings alter column empresa_id set not null;
alter table erp.proprietary_farms alter column empresa_id set not null;
alter table erp.purchase_requests alter column empresa_id set not null;
alter table erp.rainfalls alter column empresa_id set not null;
alter table erp.requisitions alter column empresa_id set not null;
alter table erp.salary_advances alter column empresa_id set not null;
alter table erp.sales_documents alter column empresa_id set not null;
alter table erp.service_orders alter column empresa_id set not null;
alter table erp.stock_corrections alter column empresa_id set not null;
alter table erp.stock_movements alter column empresa_id set not null;
alter table erp.stock_writeoffs alter column empresa_id set not null;
alter table erp.trough_readings alter column empresa_id set not null;
alter table erp.warehouse_transfers alter column empresa_destino_id set not null;
alter table erp.warehouse_transfers alter column empresa_origem_id set not null;
alter table erp.warehouses alter column empresa_id set not null;
alter table erp.weighings alter column empresa_id set not null;

-- Chaves PRIMÁRIAS e ÚNICAS passam para a coluna CANÔNICA.
-- As duas colunas são provadamente iguais, então a regra de unicidade é a MESMA — o que muda é onde ela
-- está DECLARADA. Precisa mudar: `insert ... on conflict (empresa_id, initials)` exige um índice único
-- sobre o par canônico, e mantê-lo na coluna legada obrigaria todo código novo a citar o nome antigo para
-- resolver conflito — exatamente a dependência que esta missão remove. Duplicar (uma chave em cada par)
-- pagaria dois B-tree por escrita para garantir a mesma coisa duas vezes.
-- CONSEQUÊNCIA ASSUMIDA: `on conflict` sobre o par LEGADO deixa de encontrar índice. Nenhuma rota da API
-- usa esse padrão (só o seed usava, e ele migrou junto); está registrado em docs/DEPLOYMENT.md.
do $$
declare r record; def text; novo text;
begin
  for r in
    select con.oid, con.conname, con.contype, con.conrelid::regclass::text as tabela,
           pg_get_constraintdef(con.oid) as definicao
      from pg_constraint con
     where con.connamespace = 'erp'::regnamespace and con.contype in ('p','u')
       and pg_get_constraintdef(con.oid) ~ '\mfarm_id\M|\morigin_farm_id\M|\mdestination_farm_id\M'
       and con.conrelid <> 'erp.member_farms'::regclass   -- aposentada na seção 4; não ganha coluna canônica
     order by con.conname
  loop
    def := replace(replace(replace(r.definicao,
             'destination_farm_id', 'empresa_destino_id'),
             'origin_farm_id', 'empresa_origem_id'),
             'farm_id', 'empresa_id');
    novo := replace(replace(replace(r.conname,
             'destination_farm_id', 'empresa_destino_id'),
             'origin_farm_id', 'empresa_origem_id'),
             'farm_id', 'empresa_id');
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabela, novo, def);
  end loop;
end $$;

-- Índices canônicos: equivalentes dos índices de leitura que hoje lideram por `farm_id`. Só estes — o
-- caminho novo consulta `empresa_id`, e um índice em `farm_id` não serve para ele; criar índice canônico
-- em TODAS as 50 tabelas seria custo de escrita sem consulta correspondente. As chaves UNIQUE continuam
-- na coluna legada de propósito: as duas colunas são provadamente iguais, então a unicidade já é a mesma,
-- e duplicá-la pagaria duas vezes o mesmo B-tree em cada escrita.
create index if not exists animals_org_empresa_status_idx on erp.animals (organization_id, empresa_id, status);
create index if not exists batches_org_empresa_status_idx on erp.batches (organization_id, empresa_id, status);
create index if not exists equipments_org_empresa_status_idx on erp.equipments (organization_id, empresa_id, status);
create index if not exists financial_titles_org_empresa_due_idx on erp.financial_titles (organization_id, empresa_id, due_date);
create index if not exists invoices_org_empresa_emission_idx on erp.invoices (organization_id, empresa_id, emission_date);
create index if not exists purchase_requests_org_status_empresa_idx on erp.purchase_requests (organization_id, status, empresa_id);
create index if not exists requisitions_org_empresa_date_idx on erp.requisitions (organization_id, empresa_id, requisition_date);
create index if not exists warehouses_org_empresa_idx on erp.warehouses (organization_id, empresa_id);

-- ---------- 3) tabelas de VÍNCULO cujo NOME carrega "farm" ----------
-- Quatro tabelas ligam um cadastro a empresas e trazem "farm" no próprio nome. Aqui trocamos SOMENTE esse
-- termo: `authorizer_farms` → `authorizer_empresas`, e não `autorizador_empresas`. Traduzir "authorizer",
-- "bank_account", "cost_centers" e "proprietary" de carona seria governança de nomenclatura (DATA-GOV), que
-- tem missão própria; cada termo extra traduzido aqui viraria mais uma compatibilidade para manter, sem
-- relação com a dependência de FARM que é o objetivo desta.
-- Cada nome antigo volta como view `security_invoker` — mesma razão e mesma prova de `erp.farms`.
-- Explícito, e não em laço, pela mesma razão das colunas: o dicionário e os gates leem o TEXTO da migration.
alter table erp.authorizer_farms rename to authorizer_empresas;
alter table erp.authorizer_empresas rename constraint authorizer_farms_pkey to authorizer_empresas_pkey;
create view erp.authorizer_farms with (security_invoker = true) as select * from erp.authorizer_empresas;
grant select, insert, update, delete on erp.authorizer_farms to erp_app;
create index if not exists authorizer_empresas_empresa_idx on erp.authorizer_empresas (empresa_id);

alter table erp.bank_account_farms rename to bank_account_empresas;
alter table erp.bank_account_empresas rename constraint bank_account_farms_pkey to bank_account_empresas_pkey;
create view erp.bank_account_farms with (security_invoker = true) as select * from erp.bank_account_empresas;
grant select, insert, update, delete on erp.bank_account_farms to erp_app;
create index if not exists bank_account_empresas_empresa_idx on erp.bank_account_empresas (empresa_id);

alter table erp.farm_cost_centers rename to empresa_cost_centers;
alter table erp.empresa_cost_centers rename constraint farm_cost_centers_pkey to empresa_cost_centers_pkey;
create view erp.farm_cost_centers with (security_invoker = true) as select * from erp.empresa_cost_centers;
grant select, insert, update, delete on erp.farm_cost_centers to erp_app;
create index if not exists empresa_cost_centers_empresa_idx on erp.empresa_cost_centers (empresa_id);

alter table erp.proprietary_farms rename to proprietary_empresas;
alter table erp.proprietary_empresas rename constraint proprietary_farms_pkey to proprietary_empresas_pkey;
create view erp.proprietary_farms with (security_invoker = true) as select * from erp.proprietary_empresas;
grant select, insert, update, delete on erp.proprietary_farms to erp_app;
create index if not exists proprietary_empresas_empresa_idx on erp.proprietary_empresas (empresa_id);

comment on view erp.authorizer_farms is 'COMPATIBILIDADE (PRE-BASE2-03): nome legado de erp.authorizer_empresas. security_invoker = true preserva a RLS da tabela base.';
comment on view erp.bank_account_farms is 'COMPATIBILIDADE (PRE-BASE2-03): nome legado de erp.bank_account_empresas.';
comment on view erp.farm_cost_centers is 'COMPATIBILIDADE (PRE-BASE2-03): nome legado de erp.empresa_cost_centers.';
comment on view erp.proprietary_farms is 'COMPATIBILIDADE (PRE-BASE2-03): nome legado de erp.proprietary_empresas.';

-- ---------- 4) aposentadoria de erp.member_farms ----------
-- Desde a PRE-BASE2-02 a autoridade é `erp.membro_escopos_empresa` + `erp.membro_empresas`, e o gate
-- `scripts/member-farms-audit.mjs` impede que o runtime volte a lê-la. O que faltava era o passo físico.
--
-- APOSENTAR, NÃO APAGAR: o conteúdo vai para um arquivo morto com nome neutro, com a organização
-- materializada (a tabela original não tinha `organization_id`, então sem o join a linha arquivada não
-- diria de quem é) e sob a mesma RLS de tenant das demais. Assim a volta atrás é uma consulta, não um
-- backup externo. A tabela sai do schema ativo para que ninguém a encontre por engano.
create table erp.legado_escopo_empresa_v0 (
  organization_id uuid not null references erp.organizations(id),
  membro_id uuid not null,
  empresa_id uuid not null,
  arquivado_em timestamptz not null default now(),
  primary key (membro_id, empresa_id)
);
comment on table erp.legado_escopo_empresa_v0 is 'ARQUIVO MORTO (PRE-BASE2-03): conteudo de erp.member_farms no momento da aposentadoria. Nao e autoridade de nada; existe para que a migracao seja reversivel sem backup externo. A autoridade e erp.membro_escopos_empresa + erp.membro_empresas (PRE-BASE2-02).';

insert into erp.legado_escopo_empresa_v0 (organization_id, membro_id, empresa_id)
select m.organization_id, mf.member_id, mf.farm_id
  from erp.member_farms mf
  join erp.organization_members m on m.id = mf.member_id
on conflict do nothing;

alter table erp.legado_escopo_empresa_v0 enable row level security;
alter table erp.legado_escopo_empresa_v0 force row level security;
create policy tenant_isolation on erp.legado_escopo_empresa_v0 for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select on erp.legado_escopo_empresa_v0 to erp_app;

drop table erp.member_farms;

-- ---------- 5) funções SQL passam a falar Empresa ----------
-- Semântica INALTERADA — a PRE-BASE2-02 certificou estas regras e esta migration não as revisita. O que
-- muda é a tabela e a coluna que elas leem.
create or replace function erp.tem_acesso_empresa(p_org uuid, p_user uuid, p_modulo text, p_empresa uuid)
returns boolean language sql stable as $$
  select p_org is not null and p_user is not null and p_modulo is not null and p_empresa is not null
    -- a empresa tem de existir, pertencer à organização e não estar excluída
    and exists (
      select 1 from erp.empresas f
      where f.id = p_empresa and f.organization_id = p_org and f.deleted_at is null
    )
    -- e o módulo tem de ser canônico (string livre nunca autoriza)
    and exists (select 1 from erp.modulos_escopo_empresa mm where mm.chave = p_modulo)
    and exists (
      select 1 from erp.organization_members m
      where m.organization_id = p_org and m.user_id = p_user and m.is_active
        and (
          m.is_owner   -- proprietário: todas as empresas da organização, em todos os módulos
          or exists (
            select 1 from erp.membro_escopos_empresa e
            where e.organization_id = p_org and e.membro_id = m.id and e.modulo = p_modulo
              and (
                e.modo = 'todas'
                or exists (
                  select 1 from erp.membro_empresas me
                  where me.organization_id = p_org and me.membro_id = m.id
                    and me.modulo = p_modulo and me.empresa_id = p_empresa
                )
              )
          )
        )
    )
$$;

-- Congelamento de período: `financial_freezes` agora tem a coluna canônica; o parâmetro passa a se chamar
-- empresa. A regra (nulo = congela a organização inteira) é a mesma.
drop function if exists erp.assert_period_open(uuid, uuid, date);
create or replace function erp.assert_period_open(p_org uuid, p_empresa uuid, p_date date) returns void language plpgsql as $$
begin
  if exists (select 1 from erp.financial_freezes f where f.organization_id = p_org and f.is_frozen
             and f.year = extract(year from p_date) and f.month = extract(month from p_date)
             and (f.empresa_id is null or f.empresa_id = p_empresa)) then
    raise exception 'PERIOD_FROZEN: período %/% congelado', extract(month from p_date), extract(year from p_date) using errcode='P0001';
  end if;
end $$;
grant execute on function erp.assert_period_open(uuid, uuid, date) to erp_app;
grant execute on function erp.tem_acesso_empresa(uuid, uuid, text, uuid) to erp_app;
grant execute on function erp.sincronizar_empresa_legado() to erp_app;
grant execute on function erp.sincronizar_empresa_origem_legado() to erp_app;
grant execute on function erp.sincronizar_empresa_destino_legado() to erp_app;
