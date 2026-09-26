-- =====================================================================
-- 0031 VENDAS-A4 — CONDIÇÃO DE PAGAMENTO
--
-- Cadastro novo, de ORGANIZAÇÃO (sem empresa_id): erp.condicoes_pagamento — a regra que gera o plano de parcelas
-- de um documento de venda (a conta é ÚNICA e mora no domínio: `packages/domain/src/condicao-pagamento.ts`).
-- Os CHECKs espelham `validarCondicaoPagamento`: a API confere antes e responde no campo; o CHECK é a rede para
-- escrita que não passa pela API.
--   · código sequencial (`codeEntity` "condicao_pagamento"): o contador nasce sob demanda em erp.code_sequences
--     por `erp.next_code` — nada a registrar aqui;
--   · unicidade do código INCLUI os excluídos (o número nunca é reutilizado); a do nome é só entre os vivos;
--   · exclusão é lógica (deleted_at): o DELETE é revogado de erp_app.
-- erp.sales_documents ganha condicao_pagamento_id (FK COMPOSTA com organization_id → prova o mesmo tenant) e
-- parcelas_ajustadas (o plano gravado veio do corpo, não da condição).
--
-- SEM BACKFILL: tabela nova vazia; colunas novas anuláveis ou com default; nenhuma linha existente muda de valor.
--
-- JANELA DE DEPLOY: a API anterior não conhece a tabela nem as colunas e continua gravando erp.sales_documents
-- sem elas (anulável / default false).
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 65) then
    raise exception 'VENDAS-A4: outra transacao ja detem a trava desta migration (2026,65). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'people' and column_name = 'matriz_id') then
    raise exception 'VENDAS-A4: a 0030 nao esta aplicada (erp.people.matriz_id ausente); aplique a 0030 antes.';
  end if;
  if to_regclass('erp.sales_documents') is null then
    raise exception 'VENDAS-A4: erp.sales_documents nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.condicoes_pagamento') is not null then
    raise exception 'VENDAS-A4: erp.condicoes_pagamento ja existe; a 0031 ja foi aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'sales_documents'
               and column_name in ('condicao_pagamento_id', 'parcelas_ajustadas')) then
    raise exception 'VENDAS-A4: erp.sales_documents ja tem condicao_pagamento_id/parcelas_ajustadas; a 0031 ja foi aplicada ou ha schema divergente.';
  end if;
end $$;

create temporary table _a4_antes on commit drop as
  select (select count(*) from erp.sales_documents) as documentos;

-- ---------- 3) erp.condicoes_pagamento ----------
create table erp.condicoes_pagamento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  code text not null,
  nome text not null,
  parcelas int not null default 1 constraint chk_condicoes_pagamento_parcelas check (parcelas between 1 and 120),
  dias_primeira_parcela int not null default 0 constraint chk_condicoes_pagamento_dias check (dias_primeira_parcela between 0 and 366),
  modo text not null default 'intervalo' constraint chk_condicoes_pagamento_modo check (modo in ('intervalo', 'dia_fixo')),
  intervalo_dias int not null default 30 constraint chk_condicoes_pagamento_intervalo check (intervalo_dias between 1 and 366),
  dia_vencimento int constraint chk_condicoes_pagamento_dia_vencimento check (dia_vencimento between 1 and 31),
  entrada boolean not null default false,
  entrada_percentual numeric(5,2) constraint chk_condicoes_pagamento_entrada_percentual check (entrada_percentual > 0 and entrada_percentual < 100),
  observacao text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- "par_" depois das faixas (o Postgres confere os CHECKs em ordem de nome): valor fora da faixa cai no check da faixa.
  constraint chk_condicoes_pagamento_par_dia_fixo check ((modo = 'dia_fixo') = (dia_vencimento is not null)),
  constraint chk_condicoes_pagamento_par_entrada check (entrada = (entrada_percentual is not null)),
  constraint uq_condicoes_pagamento_tenant unique (id, organization_id),
  constraint uq_condicoes_pagamento_codigo unique (organization_id, code)
);
create unique index ux_condicoes_pagamento_nome_vivo on erp.condicoes_pagamento (organization_id, lower(nome)) where deleted_at is null;
create trigger trg_condicoes_pagamento_updated before update on erp.condicoes_pagamento for each row execute function erp.set_updated_at();

comment on table erp.condicoes_pagamento is 'Condição de pagamento (VENDAS-A4): regra de organização que gera o plano de parcelas de um documento de venda. Sem empresa_id. Conta única no domínio (planoDaCondicao).';
comment on column erp.condicoes_pagamento.id is 'Identidade técnica (UUID).';
comment on column erp.condicoes_pagamento.organization_id is 'Tenant (organização).';
comment on column erp.condicoes_pagamento.code is 'Código sequencial gerado pela API (codeEntity condicao_pagamento); único na organização, incluindo os excluídos.';
comment on column erp.condicoes_pagamento.nome is 'Nome da condição; único (sem diferenciar maiúsculas) entre as vivas da organização.';
comment on column erp.condicoes_pagamento.parcelas is 'Quantidade de parcelas, sem contar a entrada (1 a 120).';
comment on column erp.condicoes_pagamento.dias_primeira_parcela is 'Dias da data do documento até a 1ª parcela (0 = na data do documento; até 366).';
comment on column erp.condicoes_pagamento.modo is 'Como vencem as parcelas seguintes: intervalo (a cada intervalo_dias) ou dia_fixo (no dia_vencimento de cada mês).';
comment on column erp.condicoes_pagamento.intervalo_dias is 'Intervalo em dias entre parcelas no modo intervalo (1 a 366).';
comment on column erp.condicoes_pagamento.dia_vencimento is 'Dia do mês do vencimento no modo dia_fixo (1 a 31); obrigatório nesse modo e nulo no outro.';
comment on column erp.condicoes_pagamento.entrada is 'Tem entrada (parcela na data do documento, além das parcelas).';
comment on column erp.condicoes_pagamento.entrada_percentual is 'Percentual da entrada sobre o total (maior que 0 e menor que 100); obrigatório com entrada e nulo sem ela.';
comment on column erp.condicoes_pagamento.observacao is 'Observação livre.';
comment on column erp.condicoes_pagamento.is_active is 'Ativa: só condição ativa é oferecida em documento novo.';
comment on column erp.condicoes_pagamento.created_at is 'Criação do registro.';
comment on column erp.condicoes_pagamento.updated_at is 'Última alteração (erp.set_updated_at).';
comment on column erp.condicoes_pagamento.deleted_at is 'Exclusão lógica; o código continua ocupado.';

-- RLS: a 0007 não alcança tabela criada depois dela. Política ÚNICA (PERMISSIVE combinam com OR).
alter table erp.condicoes_pagamento enable row level security;
alter table erp.condicoes_pagamento force row level security;
create policy tenant_isolation on erp.condicoes_pagamento for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- Os default privileges da 0007 concedem delete; a exclusão é lógica, então o revoke é EXPLÍCITO e vem depois.
grant select, insert, update on erp.condicoes_pagamento to erp_app;
revoke delete on erp.condicoes_pagamento from erp_app;

-- ---------- 4) erp.sales_documents ----------
alter table erp.sales_documents
  add column condicao_pagamento_id uuid,
  add column parcelas_ajustadas boolean not null default false;
alter table erp.sales_documents
  add constraint fk_sales_documents_condicao_pagamento foreign key (condicao_pagamento_id, organization_id)
    references erp.condicoes_pagamento (id, organization_id);
create index ix_sales_documents_condicao_pagamento on erp.sales_documents (organization_id, condicao_pagamento_id)
  where condicao_pagamento_id is not null;

comment on column erp.sales_documents.condicao_pagamento_id is 'Condição de pagamento do documento (VENDAS-A4). FK composta com organization_id: prova o mesmo tenant.';
comment on column erp.sales_documents.parcelas_ajustadas is 'O plano de parcelas gravado veio do corpo (ajustado à mão), não gerado pela condição.';

-- ---------- 5) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _a4_antes;
  if (select count(*) from erp.sales_documents) <> a.documentos then
    raise exception 'VENDAS-A4: contagem de erp.sales_documents mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.sales_documents where condicao_pagamento_id is not null or parcelas_ajustadas) then
    raise exception 'VENDAS-A4: coluna nova de erp.sales_documents com valor; a migration nao faz backfill.';
  end if;
  if exists (select 1 from erp.condicoes_pagamento) then
    raise exception 'VENDAS-A4: erp.condicoes_pagamento nasceu com linhas; a migration nao grava dados.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'condicoes_pagamento' and policyname = 'tenant_isolation') <> 1
     or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'condicoes_pagamento') <> 1 then
    raise exception 'VENDAS-A4: erp.condicoes_pagamento sem a politica unica tenant_isolation.';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'erp' and c.relname = 'condicoes_pagamento' and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception 'VENDAS-A4: RLS de erp.condicoes_pagamento nao esta habilitada e forcada.';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'erp.condicoes_pagamento'::regclass and contype = 'c'
        and conname like 'chk_condicoes_pagamento_%') <> 8 then
    raise exception 'VENDAS-A4: CHECKs de erp.condicoes_pagamento incompletos (esperados 8).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_sales_documents_condicao_pagamento' and contype = 'f' and array_length(conkey, 1) = 2) then
    raise exception 'VENDAS-A4: FK composta fk_sales_documents_condicao_pagamento ausente.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app') and has_table_privilege('erp_app', 'erp.condicoes_pagamento', 'delete') then
    raise exception 'VENDAS-A4: erp_app ainda tem DELETE em erp.condicoes_pagamento; a exclusao e logica.';
  end if;
end $$;
