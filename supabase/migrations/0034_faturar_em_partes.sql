-- =====================================================================
-- 0034 TOP-CONFIG-06 — FATURAR EM PARTES (um documento de origem vira várias conversões) — decisão 265
--
-- 1) erp.tipos_operacao_versao_destinos.em_partes: a ARESTA origem → destino declara se a conversão pode ser
--    feita em partes. Na aresta, e não no JSON da versão: o JSON do formato 3 é estrito, e uma chave nova
--    quebraria toda versão gravada e o binário anterior durante o deploy. A aresta continua imutável (0022):
--    a coluna nasce com default false e toda aresta existente fica SEM "Em partes" — nada muda no que existe.
-- 2) erp.sales_document_items.origem_item_id: o item gerado aponta o item de origem. O SALDO de um item é
--    quantidade − soma das quantidades ligadas a ele em documentos NÃO cancelados (conta, não coluna: cancelar
--    uma parte devolve o saldo sem ninguém atualizar nada).
-- 3) erp.sales_documents.saldo_encerrado_*: o encerramento manual do saldo (quem, quando, por quê).
-- 4) índice parcial em erp.sales_documents(origin_document_id): hoje a coluna não tem índice nenhum, e a conta
--    do saldo e a lista de derivados passam a consultá-la.
-- 5) INVARIANTE NO BANCO: gatilho em erp.sales_document_items que, para item com origem, trava o item de origem
--    e confere documento, produto e que a soma ligada não passa da quantidade de origem. A API confere antes,
--    com mensagem amigável; o gatilho é a rede.
--
-- SEM BACKFILL: colunas novas nulas/false; nenhuma linha existente muda.
-- JANELA DE DEPLOY: a API anterior não lê nem grava as colunas novas; ordem banco → API → web.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 68) then
    raise exception 'TOP-CONFIG-06: outra transacao ja detem a trava desta migration (2026,68). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.tipos_operacao_versao_destinos') is null then
    raise exception 'TOP-CONFIG-06: erp.tipos_operacao_versao_destinos ausente; a 0022 nao esta aplicada.';
  end if;
  if to_regclass('erp.tipos_operacao_versao_condicoes') is null then
    raise exception 'TOP-CONFIG-06: a 0033 nao esta aplicada (erp.tipos_operacao_versao_condicoes ausente); aplique a 0033 antes.';
  end if;
  if to_regclass('erp.sales_document_items') is null or to_regclass('erp.sales_documents') is null then
    raise exception 'TOP-CONFIG-06: erp.sales_documents/erp.sales_document_items ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp'
              and ((table_name = 'tipos_operacao_versao_destinos' and column_name = 'em_partes')
                or (table_name = 'sales_document_items' and column_name = 'origem_item_id')
                or (table_name = 'sales_documents' and column_name in ('saldo_encerrado_em', 'saldo_encerrado_por', 'saldo_encerrado_motivo')))) then
    raise exception 'TOP-CONFIG-06: colunas de faturar em partes ja existem; a 0034 ja foi aplicada ou ha schema divergente.';
  end if;
end $$;

create temporary table _top06_antes on commit drop as
  select (select count(*) from erp.tipos_operacao_versao_destinos) as arestas,
         (select count(*) from erp.sales_documents) as documentos,
         (select count(*) from erp.sales_document_items) as itens;

-- ---------- 3) a aresta declara "Em partes" ----------
alter table erp.tipos_operacao_versao_destinos
  add column em_partes boolean not null default false;
comment on column erp.tipos_operacao_versao_destinos.em_partes is
  'TOP-CONFIG-06: a conversao por esta aresta pode ser feita em partes (itens e quantidades). Imutavel com a aresta.';

-- ---------- 4) o item gerado aponta o item de origem ----------
alter table erp.sales_document_items
  add column origem_item_id uuid null
    constraint fk_sales_document_items_origem_item references erp.sales_document_items(id) on delete restrict;
comment on column erp.sales_document_items.origem_item_id is
  'TOP-CONFIG-06: item do documento de origem de que esta linha e parte. Saldo = quantidade de origem - soma ligada em documentos nao cancelados.';
create index ix_sales_document_items_origem_item
  on erp.sales_document_items (origem_item_id) where origem_item_id is not null;

-- ---------- 5) o encerramento do saldo ----------
alter table erp.sales_documents
  add column saldo_encerrado_em timestamptz null,
  add column saldo_encerrado_por uuid null references erp.users(id),
  add column saldo_encerrado_motivo text null,
  add constraint ck_sales_documents_saldo_encerrado check (
    (saldo_encerrado_em is null and saldo_encerrado_por is null and saldo_encerrado_motivo is null)
    or (saldo_encerrado_em is not null and saldo_encerrado_por is not null));
comment on column erp.sales_documents.saldo_encerrado_em is 'TOP-CONFIG-06: quando o saldo de um documento convertido em partes foi encerrado.';
comment on column erp.sales_documents.saldo_encerrado_por is 'TOP-CONFIG-06: quem encerrou o saldo.';
comment on column erp.sales_documents.saldo_encerrado_motivo is 'TOP-CONFIG-06: por que o saldo foi encerrado.';

create index ix_sales_documents_origin_document
  on erp.sales_documents (origin_document_id) where origin_document_id is not null;

-- ---------- 6) a invariante do saldo, no banco ----------
create or replace function erp.sales_document_item_origem_guarda() returns trigger
language plpgsql as $$
declare
  v_origem_doc uuid;
  v_item_doc uuid;
  v_item_produto uuid;
  v_item_qtd numeric;
  v_ligado numeric;
begin
  if NEW.origem_item_id is null then
    return NEW;
  end if;
  -- A trava do item de origem serializa duas partes simultâneas sobre o mesmo saldo.
  select i.document_id, i.product_id, i.quantity into v_item_doc, v_item_produto, v_item_qtd
    from erp.sales_document_items i where i.id = NEW.origem_item_id for update;
  select d.origin_document_id into v_origem_doc from erp.sales_documents d where d.id = NEW.document_id;
  if v_item_doc is null or v_origem_doc is null or v_item_doc <> v_origem_doc then
    raise exception 'VALIDATION_ERROR: o item de origem nao pertence ao documento de origem desta parte'
      using errcode = 'P0001';
  end if;
  if v_item_produto <> NEW.product_id then
    raise exception 'VALIDATION_ERROR: o produto da parte difere do produto do item de origem'
      using errcode = 'P0001';
  end if;
  select coalesce(sum(i.quantity), 0) into v_ligado
    from erp.sales_document_items i
    join erp.sales_documents d on d.id = i.document_id
   where i.origem_item_id = NEW.origem_item_id
     and d.status <> 'cancelled'
     and i.id <> NEW.id;
  if v_ligado + NEW.quantity > v_item_qtd then
    raise exception 'VALIDATION_ERROR: a quantidade da parte passa do saldo do item de origem'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;
revoke execute on function erp.sales_document_item_origem_guarda() from public;

create trigger trg_sales_document_items_origem_guarda
  before insert or update of origem_item_id, quantity, product_id on erp.sales_document_items
  for each row when (NEW.origem_item_id is not null)
  execute function erp.sales_document_item_origem_guarda();

-- ---------- 7) pós-condições nomeadas ----------
do $$
declare a record;
begin
  select * into a from _top06_antes;
  if (select count(*) from erp.tipos_operacao_versao_destinos) <> a.arestas or (select count(*) from erp.sales_documents) <> a.documentos
     or (select count(*) from erp.sales_document_items) <> a.itens then
    raise exception 'TOP-CONFIG-06: contagem de arestas/documentos/itens mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.tipos_operacao_versao_destinos where em_partes) then
    raise exception 'TOP-CONFIG-06: aresta existente nasceu com em_partes = true; nada deveria mudar no que existe.';
  end if;
  if exists (select 1 from erp.sales_document_items where origem_item_id is not null)
     or exists (select 1 from erp.sales_documents where saldo_encerrado_em is not null) then
    raise exception 'TOP-CONFIG-06: colunas novas nasceram preenchidas; a migration nao grava dados.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.sales_document_items'::regclass
                  and t.tgname = 'trg_sales_document_items_origem_guarda' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-06: trg_sales_document_items_origem_guarda ausente; a invariante do saldo nao esta no banco.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.tipos_operacao_versao_destinos'::regclass
                  and t.tgname = 'trg_tipos_operacao_versao_destinos_imutavel' and not t.tgisinternal) then
    raise exception 'TOP-CONFIG-06: a imutabilidade das arestas (0022) sumiu.';
  end if;
  if to_regclass('erp.ix_sales_documents_origin_document') is null or to_regclass('erp.ix_sales_document_items_origem_item') is null then
    raise exception 'TOP-CONFIG-06: indices parciais de origem ausentes.';
  end if;
end $$;
