-- =====================================================================
-- 0024 CLASSIFICAÇÃO FINANCEIRA NO DOCUMENTO DE VENDA (VENDAS-A1)
--
-- Até aqui a confirmação de venda classificava TODO título a receber pela PRIMEIRA categoria de receita
-- analítica e pelo PRIMEIRO centro de custo analítico da organização, pela ordem do código. O documento de
-- venda não tinha onde guardar a escolha do usuário. Esta migration dá esse lugar: um PAR
-- (categoria_financeira_id, centro_custo_id) no próprio documento.
--
-- POR QUE NULLABLE E SEM BACKFILL (mesma razão da 0021):
--   1. ACERVO: documento antigo não escolheu classificação nenhuma. Preencher com a "primeira por código"
--      afirmaria uma escolha que ninguém fez, indistinguível da escolhida.
--   2. JANELA DE DEPLOY: web e API anteriores continuam criando documentos sem os campos. NOT NULL
--      derrubaria a criação de vendas no meio do deploy.
--   Documento sem classificação continua confirmando pelo recuo antigo, e isso é visível na auditoria.
--
-- POR QUE UM PAR. Categoria sem centro (ou o inverso) seria meia escolha: a confirmação teria de completar a
-- outra metade pela ordem do código, misturando decisão do usuário com padrão automático no mesmo título.
--
-- A GUARDA (seção 7), no molde da 0023: um binário da API ANTERIOR a esta fatia confirmaria uma venda
-- classificada pela "primeira por código", em silêncio (instância antiga no pool durante o deploy, ou
-- rollback do binário). Invariante crítica mora no banco: venda classificada só entra em confirmed/invoiced
-- com a marca `app.venda_classificacao_financeira = <id da venda>`, que só o binário novo grava.
--
-- NATUREZA: aditiva. Nenhum UPDATE, nenhum DELETE, nenhuma linha muda (pós-condição da seção 8 prova).
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (0017 a 0023 usaram 51 a 57).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 58) then
    raise exception 'VENDAS-A1: outra transacao ja detem a trava desta migration (2026,58). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.sales_documents') is null then
    raise exception 'VENDAS-A1: erp.sales_documents nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.financial_categories') is null or to_regclass('erp.cost_centers') is null then
    raise exception 'VENDAS-A1: erp.financial_categories ou erp.cost_centers nao existe.';
  end if;
  -- A 0023 é a guarda irmã desta; sem ela a ordem de aplicação está errada.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'sales_documents' and t.tgname = 'trg_sales_documents_execucao_configurada') then
    raise exception 'VENDAS-A1: a guarda da 0023 nao esta aplicada; aplique a 0023 antes.';
  end if;
end $$;

-- ---------- 3) chaves candidatas de tenant ----------
-- Coluna única não prova tenant (.claude/rules/security.md). A FK composta abaixo precisa de um alvo
-- (id, organization_id); a chave primária sozinha deixaria a venda da organização A apontar para a
-- categoria da organização B.
alter table erp.financial_categories
  add constraint uq_financial_categories_tenant unique (id, organization_id);
alter table erp.cost_centers
  add constraint uq_cost_centers_tenant unique (id, organization_id);

-- ---------- 4) as colunas ----------
alter table erp.sales_documents
  add column categoria_financeira_id uuid,
  add column centro_custo_id uuid;

comment on column erp.sales_documents.categoria_financeira_id is
  'Categoria financeira (receita, analítica) dos títulos a receber gerados pela confirmação. NULL = documento sem classificação (anterior à VENDAS-A1 ou criado sem os campos): a confirmação usa o padrão legado.';
comment on column erp.sales_documents.centro_custo_id is
  'Centro de custo (analítico) dos títulos a receber gerados pela confirmação. Anda em PAR com categoria_financeira_id.';

-- ---------- 5) o PAR ----------
alter table erp.sales_documents
  add constraint sales_documents_classificacao_par check (
    (categoria_financeira_id is null) = (centro_custo_id is null)
  );

-- ---------- 6) FKs compostas com o tenant ----------
-- MATCH SIMPLE (padrão): nulo passa, o que deixa o acervo sem classificação conviver com a FK. SEM cascade e
-- SEM set null: a exclusão de categoria/centro é lógica; delete físico de uma classificação usada TRAVA.
alter table erp.sales_documents
  add constraint fk_sales_documents_categoria_financeira
  foreign key (categoria_financeira_id, organization_id)
  references erp.financial_categories (id, organization_id);

alter table erp.sales_documents
  add constraint fk_sales_documents_centro_custo
  foreign key (centro_custo_id, organization_id)
  references erp.cost_centers (id, organization_id);

-- Sem índice novo: nenhuma consulta desta fatia filtra ou agrupa documento por categoria/centro (listagens e
-- relatórios ficaram de fora). O GET do documento faz o join pelo id da categoria/centro, que já é PK do alvo.

-- ---------- 7) a guarda ----------
create or replace function erp.venda_classificacao_financeira_guarda() returns trigger
language plpgsql
set search_path = pg_catalog, erp
as $$
begin
  if current_setting('app.venda_classificacao_financeira', true) is distinct from NEW.id::text then
    -- VALIDATION_ERROR: código que QUALQUER binário anterior já mapeia para 422.
    raise exception 'VALIDATION_ERROR: esta venda tem classificacao financeira, que este servidor nao aplica; a venda nao foi confirmada'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

revoke all on function erp.venda_classificacao_financeira_guarda() from public;

drop trigger if exists trg_sales_documents_classificacao_financeira on erp.sales_documents;
-- Mesma cláusula da 0023 (DECISIONS 238): só a ENTRADA em confirmed/invoiced vinda de outro estado;
-- confirmed → invoiced e as saídas não disparam. Só venda classificada executa a função.
create trigger trg_sales_documents_classificacao_financeira
  before update of status on erp.sales_documents
  for each row
  when (NEW.status in ('confirmed', 'invoiced')
        and OLD.status is distinct from 'confirmed'
        and OLD.status is distinct from 'invoiced'
        and NEW.categoria_financeira_id is not null)
  execute function erp.venda_classificacao_financeira_guarda();

-- ---------- 8) pós-condições ----------
do $$
declare
  v_n int;
begin
  if (select count(*) from information_schema.columns
       where table_schema='erp' and table_name='sales_documents'
         and column_name in ('categoria_financeira_id','centro_custo_id') and is_nullable = 'YES') <> 2 then
    raise exception 'VENDAS-A1: as duas colunas de classificacao precisam existir e aceitar NULL';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_documents_classificacao_par' and contype = 'c') then
    raise exception 'VENDAS-A1: o CHECK do par nao foi criado';
  end if;
  if (select count(*) from pg_constraint where conname in ('uq_financial_categories_tenant','uq_cost_centers_tenant') and contype = 'u') <> 2 then
    raise exception 'VENDAS-A1: as chaves candidatas de tenant nao foram criadas';
  end if;
  if (select count(*) from pg_constraint
       where conname in ('fk_sales_documents_categoria_financeira','fk_sales_documents_centro_custo')
         and contype = 'f' and confdeltype = 'a' and confupdtype = 'a' and array_length(conkey, 1) = 2) <> 2 then
    raise exception 'VENDAS-A1: as FKs compostas (sem cascata) nao foram criadas';
  end if;
  select count(*) into v_n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'sales_documents'
     and t.tgname = 'trg_sales_documents_classificacao_financeira' and not t.tgisinternal and t.tgenabled = 'O';
  if v_n <> 1 then
    raise exception 'VENDAS-A1: o gatilho de guarda nao foi criado (ou nasceu desabilitado)';
  end if;
  -- aditiva de verdade: nenhuma linha nasce classificada
  if exists (select 1 from erp.sales_documents where categoria_financeira_id is not null or centro_custo_id is not null) then
    raise exception 'VENDAS-A1: ha documento classificado logo apos a migration; ela nao pode alterar dado';
  end if;
end $$;
