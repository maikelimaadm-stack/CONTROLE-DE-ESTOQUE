-- =====================================================================
-- OPERACOES-01 F10 — AS CENTRAIS DOS MÓDULOS COM PRODUTO: A TOP NOS SEIS MÓDULOS — decisão 287
--
-- 1) TOP NOS MÓDULOS. erp.fuel_supplies (abastecimento), erp.maintenances (manutenção), erp.service_orders (ordem
--    de serviço), erp.animal_handlings (manejo), erp.diet_batches (batelada) e erp.feed_batches (produção de ração)
--    ganham o PAR tipo_operacao_id + tipo_operacao_versao_id (anuláveis), no desenho da venda (0021): a TOP
--    escolhida e a versão EXATA dela no instante do lançamento. CHECK de par (os dois ou nenhum); FKs COMPOSTAS com
--    a organização — (tipo_operacao_id, organization_id) → erp.tipos_operacao (id, organization_id) e
--    (tipo_operacao_versao_id, tipo_operacao_id, organization_id) → erp.tipos_operacao_versoes (id, tipo_operacao_id,
--    organization_id): a versão é DAQUELA TOP e as duas são da organização do lançamento. Sem cascata. Sem índice:
--    nenhuma consulta destes módulos filtra pela TOP (a listagem é por empresa e data), e o índice das FKs do lado
--    referenciado já existe (as chaves uq_tipos_operacao_tenant e uq_tipos_operacao_versoes_tenant).
--    Lançamento SEM TOP continua exatamente como hoje: NULL é o lançamento de antes e o de quem não escolhe TOP.
-- 2) A CONFERÊNCIA NO BANCO (rede da API, que confere antes com mensagem própria): o gatilho estreito
--    erp.modulo_top_conferir(), um por tabela, com a FAMÍLIA da tabela no argumento:
--      · com TOP, a família da TOP (erp.tipos_operacao.codigo_base) é a da tabela — senão VALIDATION_ERROR, com o
--        MESMO texto para TOP de outra família, de outra organização ou inexistente (não revela existência);
--      · a TOP do lançamento não muda depois de gravada (nem de nenhuma para alguma) — CONFLICT.
--    SECURITY INVOKER: lê erp.tipos_operacao pela RLS de quem grava (tenant_isolation, só a organização — a API grava
--    com a GUC da organização). EXECUTE só do dono (o privilégio de função de gatilho é conferido no CREATE TRIGGER,
--    não a cada disparo). Os códigos (CONFLICT, VALIDATION_ERROR) são os que todo binário da API já conhece.
-- 3) erp.maintenances ganha note (observação, anulável, sem CHECK — a API limita o tamanho): o web já a enviava e a
--    API a descartava por falta da coluna.
-- 4) erp.maintenance_items: a política api_child (uma só, `for all`) dá lugar a QUATRO políticas por comando
--    (api_child_select/_insert/_update/_delete), porque ler e gravar deixam de ser a mesma pergunta. A da 0007
--    (gerada pelo laço de tabelas-filho, que escolhe a primeira FK para tabela com organização) correlacionava pelo
--    LOCAL DE ESTOQUE (warehouse_id): o item sem local — peça comprada fora, que a API já aceitava — era recusado
--    pela RLS; o item cujo local está fora do escopo de empresa do módulo sumia do detalhe e dos relatórios da
--    própria manutenção; e o item da manutenção de uma empresa fora do escopo aparecia se o local estivesse dentro.
--    Agora:
--      · LER, ALTERAR e APAGAR (USING): o item herda o escopo da MANUTENÇÃO pela máquina, como a máquina já herdava
--        (a política de erp.maintenance_machines correlaciona pela manutenção);
--      · GRAVAR (WITH CHECK do insert e do update): a manutenção visível E o local — sem local (o item que a 0007
--        recusava) ou um local VISÍVEL no tenant e no escopo do módulo, a MESMA guarda que a 0007 já fazia. A FK
--        maintenance_items.warehouse_id é de coluna única (0005): sem esta guarda, o banco aceitaria o local de outra
--        organização, e só a API o barraria.
--    DROP e CREATE na mesma transação: não há instante sem política; a RLS continua habilitada e forçada.
--
-- SEM BACKFILL: colunas novas nulas; nenhuma linha existente é reescrita. As seis tabelas continuam sem auditoria
-- por gatilho (a auditoria delas é da API, audit()).
-- IMPACTO EM DADOS REAIS: nenhum valor muda. O CHECK de par vale para as linhas existentes (as duas colunas nascem
-- nulas); as FKs novas são validadas sobre colunas todas nulas (leitura). As políticas novas de erp.maintenance_items
-- gravam tudo o que a de antes gravava para itens com local visível cuja manutenção está no escopo, e passam a gravar
-- o item sem local; a leitura passa a seguir o escopo da manutenção (não mais o do local). É a única parte NÃO
-- aditiva da migration (troca de política existente). Produção tem ZERO abastecimentos, manutenções e OS (02/10).
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web): a API anterior não lê nem grava as colunas novas — o
-- INSERT dela, sem TOP, passa pelo CHECK (as duas nulas) e pelo gatilho (só age com TOP); ela não faz UPDATE dessas
-- colunas. O `select *` dela passa a trazer tipo_operacao_id, tipo_operacao_versao_id (nulas) e note — chaves a
-- mais que o web ignora. O item de manutenção sem local, que a tela de antes já mandava, passa a gravar; o item com
-- local continua exigindo o local visível (a guarda da 0007, agora só na gravação).
-- VOLTA: API e web voltam por redeploy e convivem com esta migration. Colunas, gatilhos e política ficam (decisão
-- 247: dado não se apaga); desfazer qualquer um deles só com uma migration nova, por decisão humana.
-- TRAVAS: ADD COLUMN e ADD CONSTRAINT pegam ACCESS EXCLUSIVE (curto: só catálogo, sem regravar a tabela; o CHECK e as
-- FKs leem a tabela uma vez) nas seis tabelas; as FKs pegam SHARE ROW EXCLUSIVE em erp.tipos_operacao e
-- erp.tipos_operacao_versoes; CREATE TRIGGER pega SHARE ROW EXCLUSIVE nas seis; DROP/CREATE POLICY pega ACCESS
-- EXCLUSIVE em erp.maintenance_items. O lock_timeout de 2s faz a migration desistir em vez de enfileirar as
-- gravações atrás dela. A trava de concorrência é de transação: não há nada a liberar à mão.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fase (2026,80).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 80) then
    raise exception 'OPERACOES-01 F10: outra transacao ja detem a trava desta migration (2026,80). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_tabelas constant text[] := array['fuel_supplies', 'maintenances', 'service_orders', 'animal_handlings', 'diet_batches', 'feed_batches'];
  v_lista text[];
begin
  -- 2.0 "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência. Qualquer
  -- objeto que esta migration cria conta (coluna, função, gatilho ou constraint): um só, criado à mão ou por uma
  -- aplicação pela metade, é schema divergente.
  if exists (select 1 from unnest(v_tabelas) t(nome)
               join pg_attribute a on a.attrelid = to_regclass('erp.' || t.nome)
              where not a.attisdropped and a.attname in ('tipo_operacao_id', 'tipo_operacao_versao_id'))
     or exists (select 1 from pg_attribute a
                 where a.attrelid = to_regclass('erp.maintenances') and a.attname = 'note' and not a.attisdropped)
     or to_regprocedure('erp.modulo_top_conferir()') is not null
     or exists (select 1 from unnest(v_tabelas) t(nome)
                  join pg_trigger g on g.tgrelid = to_regclass('erp.' || t.nome) and g.tgname = 'trg_' || t.nome || '_top_conferir')
     or exists (select 1 from unnest(v_tabelas) t(nome)
                  join pg_constraint c on c.conrelid = to_regclass('erp.' || t.nome)
                                      and c.conname in ('chk_' || t.nome || '_tipo_operacao_par', 'fk_' || t.nome || '_tipo_operacao',
                                                        'fk_' || t.nome || '_tipo_operacao_versao')) then
    raise exception 'OPERACOES-01 F10: erp.<modulo>.tipo_operacao_id/tipo_operacao_versao_id, erp.maintenances.note, erp.modulo_top_conferir(), gatilho trg_<modulo>_top_conferir ou constraint chk/fk de TOP de modulo ja existe; a migration dos modulos com TOP ja foi aplicada ou ha schema divergente.';
  end if;
  -- 2.1 O destinatário da política nova e a função que ela chama (0007).
  if not exists (select 1 from pg_roles where rolname = 'erp_app') or to_regprocedure('erp.tenant_visible(uuid)') is null then
    raise exception 'OPERACOES-01 F10: papel erp_app ou erp.tenant_visible(uuid) ausente (0007); a politica nova nao teria destinatario.';
  end if;
  -- 2.2 As seis tabelas de módulo existem e têm organization_id uuid obrigatório (o gatilho e as FKs compostas o
  -- leem). A ausência das colunas novas já foi conferida em 2.0.
  if (select count(*) from unnest(v_tabelas) t(nome)
        join pg_attribute a on a.attrelid = to_regclass('erp.' || t.nome)
       where a.attname = 'organization_id' and not a.attisdropped and a.attnotnull and a.atttypid = 'uuid'::regtype) <> 6 then
    raise exception 'OPERACOES-01 F10: tabela de modulo ausente ou sem organization_id (fuel_supplies, maintenances, service_orders, animal_handlings, diet_batches, feed_batches); a cadeia de migrations esta fora de ordem.';
  end if;
  -- 2.3 Os alvos das FKs compostas, NA ORDEM das colunas: (id, organization_id) em erp.tipos_operacao (0020) e
  -- (id, tipo_operacao_id, organization_id) em erp.tipos_operacao_versoes (0021); e a família que o gatilho lê.
  if (select count(*) from pg_constraint c
       where c.contype = 'u'
         and ((c.conrelid = to_regclass('erp.tipos_operacao') and c.conname = 'uq_tipos_operacao_tenant'
               and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id'),
                                    (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[])
           or (c.conrelid = to_regclass('erp.tipos_operacao_versoes') and c.conname = 'uq_tipos_operacao_versoes_tenant'
               and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id'),
                                    (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'tipo_operacao_id'),
                                    (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[]))) <> 2
     or not exists (select 1 from pg_attribute a
                     where a.attrelid = to_regclass('erp.tipos_operacao') and a.attname = 'codigo_base' and not a.attisdropped) then
    raise exception 'OPERACOES-01 F10: chave alvo das FKs da TOP ausente ou fora da ordem (uq_tipos_operacao_tenant (id, organization_id) da 0020, uq_tipos_operacao_versoes_tenant (id, tipo_operacao_id, organization_id) da 0021) ou erp.tipos_operacao.codigo_base ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  -- 2.4 A política de erp.maintenance_items é EXATAMENTE a gerada pela 0007 (uma só, api_child, ALL, para erp_app,
  -- pelo local de estoque); e as colunas das correlações novas (máquina → manutenção; o local da gravação) existem. Qualquer outra é uma decisão que alguém tomou
  -- fora daqui, e trocá-la em silêncio apagaria essa decisão.
  select array_agg(p.policyname::text order by p.policyname) into v_lista
    from pg_policies p where p.schemaname = 'erp' and p.tablename = 'maintenance_items';
  if v_lista is distinct from array['api_child']
     or not exists (select 1 from pg_policies p
                     where p.schemaname = 'erp' and p.tablename = 'maintenance_items' and p.policyname = 'api_child'
                       and p.permissive = 'PERMISSIVE' and p.roles = array['erp_app']::name[] and p.cmd = 'ALL'
                       and p.qual like '%erp.warehouses%' and p.qual like '%maintenance_items.warehouse_id%' and p.qual like '%tenant_visible%'
                       and p.with_check = p.qual)
     or (select count(*) from pg_attribute a
          where not a.attisdropped
            and ((a.attrelid = to_regclass('erp.maintenance_items') and a.attname in ('machine_id', 'warehouse_id'))
              or (a.attrelid = to_regclass('erp.maintenance_machines') and a.attname in ('id', 'maintenance_id'))
              or (a.attrelid = to_regclass('erp.maintenances') and a.attname in ('id', 'organization_id'))
              or (a.attrelid = to_regclass('erp.warehouses') and a.attname in ('id', 'organization_id')))) <> 8 then
    raise exception 'OPERACOES-01 F10: a politica de erp.maintenance_items nao e a da 0007 (correlacao pelo local de estoque); schema divergente, a decisao volta para um humano.';
  end if;
end $$;

-- ---------- 3) colunas ----------
-- Colunas numa instrução, constraints em outra: o leitor de schema dos gates (scripts/lib/schema.mjs) lê o
-- `add column` repetido, e uma `add constraint` no meio dele viraria uma coluna fantasma no dicionário.
alter table erp.fuel_supplies    add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
alter table erp.maintenances     add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid, add column note text;
alter table erp.service_orders   add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
alter table erp.animal_handlings add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
alter table erp.diet_batches     add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
alter table erp.feed_batches     add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;

-- O par e as duas FKs compostas, sem cascata (NO ACTION nas duas pontas): a TOP e a versão referenciadas não se
-- apagam (a TOP se desativa ou se exclui logicamente, decisão 247).
alter table erp.fuel_supplies
  add constraint chk_fuel_supplies_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_fuel_supplies_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_fuel_supplies_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.maintenances
  add constraint chk_maintenances_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_maintenances_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_maintenances_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.service_orders
  add constraint chk_service_orders_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_service_orders_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_service_orders_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.animal_handlings
  add constraint chk_animal_handlings_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_animal_handlings_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_animal_handlings_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.diet_batches
  add constraint chk_diet_batches_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_diet_batches_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_diet_batches_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.feed_batches
  add constraint chk_feed_batches_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null)),
  add constraint fk_feed_batches_tipo_operacao foreign key (tipo_operacao_id, organization_id)
      references erp.tipos_operacao (id, organization_id),
  add constraint fk_feed_batches_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
      references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);

-- ---------- 4) comentários ----------
comment on column erp.fuel_supplies.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.fuel_supplies.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';
comment on column erp.maintenances.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.maintenances.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';
comment on column erp.maintenances.note is 'OPERACOES-01 F10: observação da manutenção (o web já a enviava; a API a descartava por falta da coluna).';
comment on column erp.service_orders.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.service_orders.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';
comment on column erp.animal_handlings.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.animal_handlings.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';
comment on column erp.diet_batches.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.diet_batches.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';
comment on column erp.feed_batches.tipo_operacao_id is 'OPERACOES-01 F10 (decisão 287): TOP escolhida no lançamento do módulo (FK composta com a organização). NULL = lançamento sem TOP (o de antes, o de hoje). Não muda depois de gravada.';
comment on column erp.feed_batches.tipo_operacao_versao_id is 'OPERACOES-01 F10: versão EXATA da TOP no instante do lançamento (congelada pelo servidor); par com tipo_operacao_id.';

-- ---------- 5) a conferência da TOP no registro do módulo ----------
-- plpgsql, SECURITY INVOKER, search_path fixo. Lê só a família da TOP, pela RLS de quem grava. Sem SQL dinâmico; o
-- argumento é a família da tabela, fixado no CREATE TRIGGER (nunca vem da linha nem do cliente).
create function erp.modulo_top_conferir() returns trigger
  language plpgsql
  set search_path = erp, pg_temp
as $$
declare
  v_familia text;
begin
  if tg_op = 'UPDATE' and (new.tipo_operacao_id is distinct from old.tipo_operacao_id
                           or new.tipo_operacao_versao_id is distinct from old.tipo_operacao_versao_id) then
    raise exception 'CONFLICT: O tipo de operação do lançamento não muda depois de gravado.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.tipo_operacao_id is not null then
    select t.codigo_base into v_familia
      from erp.tipos_operacao t
     where t.id = new.tipo_operacao_id and t.organization_id = new.organization_id;
    -- TOP inexistente, de outra organização (invisível pela RLS ou de organização diferente da linha) ou de outra
    -- família: a MESMA recusa. Gatilho sem argumento também recusa (fail closed).
    if v_familia is distinct from tg_argv[0] then
      raise exception 'VALIDATION_ERROR: Tipo de operação indisponível para este lançamento.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

comment on function erp.modulo_top_conferir() is 'OPERACOES-01 F10 (decisão 287): rede da API nos seis módulos com TOP. Com TOP, a família (codigo_base) é a do argumento do gatilho; senão VALIDATION_ERROR, a mesma para TOP de outra família, de outra organização ou inexistente. A TOP do lançamento não muda depois de gravada (CONFLICT). SECURITY INVOKER: lê erp.tipos_operacao pela RLS de quem grava (tenant_isolation, só a organização).';

create trigger trg_fuel_supplies_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.fuel_supplies
  for each row execute function erp.modulo_top_conferir('frota_ativos.abastecimento');
create trigger trg_maintenances_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.maintenances
  for each row execute function erp.modulo_top_conferir('frota_ativos.manutencao');
create trigger trg_service_orders_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.service_orders
  for each row execute function erp.modulo_top_conferir('ordens_servico.ordem_de_servico');
create trigger trg_animal_handlings_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.animal_handlings
  for each row execute function erp.modulo_top_conferir('pecuaria.manejo');
create trigger trg_diet_batches_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.diet_batches
  for each row execute function erp.modulo_top_conferir('confinamento.batelada');
create trigger trg_feed_batches_top_conferir before insert or update of tipo_operacao_id, tipo_operacao_versao_id on erp.feed_batches
  for each row execute function erp.modulo_top_conferir('estoque.producao_de_racao');

-- A função de gatilho não é porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app, e PUBLIC o tem por padrão;
-- tira-se de todos (o laço da 0040/0041; os nomes vêm do catálogo, nada de entrada de usuário).
revoke execute on function erp.modulo_top_conferir() from public;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'erp.modulo_top_conferir()'::regprocedure
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 6) erp.maintenance_items: as políticas por comando ----------
-- O item herda o escopo da manutenção: a subconsulta lê erp.maintenance_machines e erp.maintenances pela RLS de quem
-- consulta (a da manutenção é tenant_e_empresa, com o módulo ativo da transação). Na GRAVAÇÃO, o local citado também
-- é conferido: nulo, ou visível pela RLS de quem grava (erp.warehouses é tenant_e_empresa) e da organização da
-- transação — a guarda da 0007, que a correlação pela máquina sozinha perderia. Ler e gravar são perguntas diferentes:
-- por isso uma política por comando, nunca `for all`.
drop policy api_child on erp.maintenance_items;
create policy api_child_select on erp.maintenance_items for select to erp_app
  using (exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id
                  where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id)));
create policy api_child_insert on erp.maintenance_items for insert to erp_app
  with check (exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id
                       where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id))
              and (maintenance_items.warehouse_id is null
                   or exists (select 1 from erp.warehouses w
                               where w.id = maintenance_items.warehouse_id and erp.tenant_visible(w.organization_id))));
create policy api_child_update on erp.maintenance_items for update to erp_app
  using (exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id
                  where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id)))
  with check (exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id
                       where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id))
              and (maintenance_items.warehouse_id is null
                   or exists (select 1 from erp.warehouses w
                               where w.id = maintenance_items.warehouse_id and erp.tenant_visible(w.organization_id))));
create policy api_child_delete on erp.maintenance_items for delete to erp_app
  using (exists (select 1 from erp.maintenance_machines mm join erp.maintenances p on p.id = mm.maintenance_id
                  where mm.id = maintenance_items.machine_id and erp.tenant_visible(p.organization_id)));

comment on policy api_child_select on erp.maintenance_items is 'OPERACOES-01 F10 (decisão 287): ler o item da manutenção = a MÁQUINA → MANUTENÇÃO visível (o item herda o escopo dela). A da 0007 (api_child, for all) correlacionava pelo local de estoque e escondia o item cujo local estava fora do escopo do módulo.';
comment on policy api_child_insert on erp.maintenance_items is 'OPERACOES-01 F10 (decisão 287): gravar o item = a manutenção visível pela máquina E o local nulo (peça comprada fora, que a 0007 recusava) ou visível no tenant e no escopo (a guarda da 0007: a FK warehouse_id é de coluna única).';
comment on policy api_child_update on erp.maintenance_items is 'OPERACOES-01 F10 (decisão 287): alterar o item = o da manutenção visível (USING), e a linha nova com a manutenção visível E o local nulo ou visível (WITH CHECK, a mesma pergunta do insert).';
comment on policy api_child_delete on erp.maintenance_items is 'OPERACOES-01 F10 (decisão 287): apagar o item = o da manutenção visível pela máquina (a mesma pergunta da leitura; a 0007 também permitia o DELETE).';

-- ---------- 7) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
declare
  v_tabelas constant text[] := array['fuel_supplies', 'maintenances', 'service_orders', 'animal_handlings', 'diet_batches', 'feed_batches'];
  v_lista text[];
begin
  -- As treze colunas novas: uuid nas seis tabelas (o par) e text em maintenances.note; anuláveis e sem default.
  if (select count(*)
        from (select t.nome as tabela, c.coluna, 'uuid'::text as tipo
                from unnest(v_tabelas) t(nome) cross join unnest(array['tipo_operacao_id', 'tipo_operacao_versao_id']) c(coluna)
              union all select 'maintenances', 'note', 'text') e
        join pg_attribute a on a.attrelid = to_regclass('erp.' || e.tabela) and a.attname = e.coluna
       where not a.attisdropped and not a.attnotnull and not a.atthasdef and format_type(a.atttypid, a.atttypmod) = e.tipo) <> 13 then
    raise exception 'OPERACOES-01 F10: colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 13: tipo_operacao_id e tipo_operacao_versao_id uuid nas seis tabelas e maintenances.note text, todas anulaveis).';
  end if;
  if (select count(*)
        from (select t.nome as tabela, c.coluna
                from unnest(v_tabelas) t(nome) cross join unnest(array['tipo_operacao_id', 'tipo_operacao_versao_id']) c(coluna)
              union all select 'maintenances', 'note') e
        join pg_attribute a on a.attrelid = to_regclass('erp.' || e.tabela) and a.attname = e.coluna
       where col_description(a.attrelid, a.attnum) is not null) <> 13 then
    raise exception 'OPERACOES-01 F10: coluna nova sem comentario (esperadas 13 comentadas).';
  end if;
  -- Os seis CHECKs de par, validados, sobre as DUAS colunas e com a expressão do par (espaços e parênteses à parte).
  if (select count(*) from unnest(v_tabelas) t(nome)
        join pg_constraint c on c.conrelid = to_regclass('erp.' || t.nome) and c.conname = 'chk_' || t.nome || '_tipo_operacao_par'
       where c.contype = 'c' and c.convalidated
         and (select array_agg(x order by x) from unnest(c.conkey) x)
             = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                 where a.attrelid = c.conrelid and a.attname in ('tipo_operacao_id', 'tipo_operacao_versao_id'))
         and regexp_replace(pg_get_constraintdef(c.oid), '[[:space:]()]', '', 'g') = 'CHECKtipo_operacao_idISNULL=tipo_operacao_versao_idISNULL') <> 6 then
    raise exception 'OPERACOES-01 F10: CHECKs de par da TOP (chk_<modulo>_tipo_operacao_par) ausentes, nao validados ou diferentes de (tipo_operacao_id is null) = (tipo_operacao_versao_id is null) (esperados 6).';
  end if;
  -- As doze FKs compostas, POR NOME, sem cascata, validadas, não adiáveis, alvo e ordem das colunas exatos.
  if (select count(*) from unnest(v_tabelas) t(nome)
        cross join (values ('tipo_operacao', 'erp.tipos_operacao', array['tipo_operacao_id', 'organization_id'], array['id', 'organization_id']),
                           ('tipo_operacao_versao', 'erp.tipos_operacao_versoes', array['tipo_operacao_versao_id', 'tipo_operacao_id', 'organization_id'],
                            array['id', 'tipo_operacao_id', 'organization_id'])) f(sufixo, alvo, colunas, colunas_alvo)
        join pg_constraint c on c.conrelid = to_regclass('erp.' || t.nome) and c.conname = 'fk_' || t.nome || '_' || f.sufixo
       where c.contype = 'f' and c.confrelid = to_regclass(f.alvo) and c.confdeltype = 'a' and c.confupdtype = 'a'
         and c.convalidated and not c.condeferrable
         and c.conkey = (select array_agg(a.attnum order by k.ord) from unnest(f.colunas) with ordinality k(coluna, ord)
                           join pg_attribute a on a.attrelid = c.conrelid and a.attname = k.coluna)
         and c.confkey = (select array_agg(a.attnum order by k.ord) from unnest(f.colunas_alvo) with ordinality k(coluna, ord)
                            join pg_attribute a on a.attrelid = c.confrelid and a.attname = k.coluna)) <> 12 then
    raise exception 'OPERACOES-01 F10: FKs compostas da TOP ausentes, em cascata ou fora da forma (tipo_operacao_id, organization_id) -> erp.tipos_operacao (id, organization_id) e (tipo_operacao_versao_id, tipo_operacao_id, organization_id) -> erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id) (esperadas 12).';
  end if;
  -- A função: plpgsql, SECURITY INVOKER, volátil, search_path "erp, pg_temp".
  if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                  where p.oid = to_regprocedure('erp.modulo_top_conferir()') and l.lanname = 'plpgsql' and p.prorettype = 'trigger'::regtype
                    and not p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'OPERACOES-01 F10: erp.modulo_top_conferir() ausente, SECURITY DEFINER, nao volatil, fora de plpgsql ou sem search_path "erp, pg_temp".';
  end if;
  -- EXECUTE só do dono (nem PUBLIC, nem erp_app).
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = to_regprocedure('erp.modulo_top_conferir()') and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner)
     or has_function_privilege('erp_app', 'erp.modulo_top_conferir()', 'execute') then
    raise exception 'OPERACOES-01 F10: EXECUTE de erp.modulo_top_conferir() concedido alem do dono.';
  end if;
  -- Os seis gatilhos: um por tabela, ligados, BEFORE INSERT OR UPDATE OF as duas colunas da TOP, FOR EACH ROW, sem
  -- WHEN, na função certa, com a família da tabela como ÚNICO argumento; e nenhum outro gatilho usa a função.
  if (select count(*)
        from (values ('fuel_supplies', 'frota_ativos.abastecimento'), ('maintenances', 'frota_ativos.manutencao'),
                     ('service_orders', 'ordens_servico.ordem_de_servico'), ('animal_handlings', 'pecuaria.manejo'),
                     ('diet_batches', 'confinamento.batelada'), ('feed_batches', 'estoque.producao_de_racao')) e(tabela, familia)
        join pg_trigger g on g.tgrelid = to_regclass('erp.' || e.tabela) and g.tgname = 'trg_' || e.tabela || '_top_conferir'
       where not g.tgisinternal and g.tgenabled = 'O' and g.tgqual is null
         and g.tgfoid = to_regprocedure('erp.modulo_top_conferir()')
         and g.tgtype = (1 | 2 | 4 | 16)
         and g.tgnargs = 1 and g.tgargs = convert_to(e.familia, 'UTF8') || decode('00', 'hex')
         and (select array_agg(x order by x) from unnest(g.tgattr::int2[]) x)
             = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                 where a.attrelid = g.tgrelid and a.attname in ('tipo_operacao_id', 'tipo_operacao_versao_id'))) <> 6
     or (select count(*) from pg_trigger g where g.tgfoid = to_regprocedure('erp.modulo_top_conferir()')) <> 6 then
    raise exception 'OPERACOES-01 F10: gatilhos trg_<modulo>_top_conferir ausentes, desligados, fora da forma (BEFORE INSERT OR UPDATE OF tipo_operacao_id, tipo_operacao_versao_id, FOR EACH ROW, sem WHEN) ou com a familia errada no argumento (esperados 6, e so eles na funcao).';
  end if;
  -- erp.maintenance_items: QUATRO políticas, uma por comando, PERMISSIVE, só para erp_app. USING (select, update e
  -- delete) = a MESMA pergunta, pela máquina → manutenção e sem o local; o insert não tem USING. WITH CHECK (insert e
  -- update) = a MESMA pergunta, que CONTÉM a do USING e acrescenta o local (nulo ou visível); select e delete não têm.
  select array_agg(p.policyname::text order by p.policyname) into v_lista
    from pg_policies p where p.schemaname = 'erp' and p.tablename = 'maintenance_items';
  if v_lista is distinct from array['api_child_delete', 'api_child_insert', 'api_child_select', 'api_child_update']
     or (select count(*) from pg_policies p
          where p.schemaname = 'erp' and p.tablename = 'maintenance_items'
            and p.permissive = 'PERMISSIVE' and p.roles = array['erp_app']::name[]
            and (p.policyname::text, p.cmd::text) in (values ('api_child_select', 'SELECT'), ('api_child_insert', 'INSERT'),
                                                             ('api_child_update', 'UPDATE'), ('api_child_delete', 'DELETE'))
            and case when p.cmd = 'INSERT' then p.qual is null
                     else p.qual like '%erp.maintenance_machines%' and p.qual like '%erp.maintenances%'
                          and p.qual like '%maintenance_items.machine_id%' and p.qual like '%tenant_visible%'
                          and p.qual not like '%warehouse%' end
            and case when p.cmd in ('INSERT', 'UPDATE') then p.with_check like '%erp.maintenance_machines%'
                          and p.with_check like '%maintenance_items.machine_id%' and p.with_check like '%erp.warehouses%'
                          and p.with_check like '%(warehouse_id IS NULL)%'
                          and p.with_check like '%= maintenance_items.warehouse_id%'
                     else p.with_check is null end) <> 4
     or (select count(distinct p.qual) from pg_policies p
          where p.schemaname = 'erp' and p.tablename = 'maintenance_items' and p.cmd <> 'INSERT') <> 1
     or (select count(distinct p.with_check) from pg_policies p
          where p.schemaname = 'erp' and p.tablename = 'maintenance_items' and p.cmd in ('INSERT', 'UPDATE')) <> 1
     or not exists (select 1 from pg_policies u join pg_policies c on c.schemaname = u.schemaname and c.tablename = u.tablename
                     where u.schemaname = 'erp' and u.tablename = 'maintenance_items' and u.cmd = 'SELECT' and c.cmd = 'INSERT'
                       and position(u.qual in c.with_check) > 0) then
    raise exception 'OPERACOES-01 F10: politicas de erp.maintenance_items diferentes de api_child_select/_insert/_update/_delete (uma por comando, PERMISSIVE, para erp_app; ler pela maquina -> manutencao; gravar pela manutencao E pelo local nulo ou visivel).';
  end if;
  -- RLS habilitada e forçada nas sete tabelas que esta migration toca.
  if (select count(*) from pg_class c
       where c.oid in (select to_regclass('erp.' || t.nome) from unnest(v_tabelas || array['maintenance_items']) t(nome))
         and c.relrowsecurity and c.relforcerowsecurity) <> 7 then
    raise exception 'OPERACOES-01 F10: RLS desligada ou nao forcada numa das sete tabelas (as seis dos modulos e erp.maintenance_items).';
  end if;
end $$;
