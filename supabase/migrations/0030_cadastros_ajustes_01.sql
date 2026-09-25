-- =====================================================================
-- 0030 CADASTROS — AJUSTES 01 (ficha do Parceiro, decisão 257)
--
-- A ficha do Parceiro ganha os campos que faltavam para o padrão de tela combinado (C-4/C-5). A tabela continua
-- erp.people (tabela, colunas, permissões e rotas ficam). Esta migration só ACRESCENTA:
--   · erp.people: matriz_id (a matriz de uma filial — FK COMPOSTA (matriz_id, organization_id) → people, nunca o
--     próprio id), rg, caepf (14 dígitos), sexo (F/M), site, caixa_postal, latitude/longitude (graus decimais,
--     −90..90 / −180..180), email_nfe (citext) e calcula_funrural (boolean, default false);
--   · erp.parceiro_enderecos: latitude/longitude, com os mesmos checks.
-- As regras que dependem do tipo de pessoa (Matriz só em Jurídica; RG, CAEPF e Sexo só em Física; latitude e
-- longitude juntas) são da API (`apps/api/src/lib/parceiro.ts`), que devolve o erro no campo e na aba.
--
-- SEM BACKFILL: tudo anulável ou com default; nenhuma linha existente muda de valor.
--
-- JANELA DE DEPLOY: a API anterior não conhece as colunas e continua gravando erp.people sem elas (anuláveis ou
-- com default); a API nova com a web anterior não recebe essas chaves e não as toca.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 64) then
    raise exception 'CADASTROS-AJ01: outra transacao ja detem a trava desta migration (2026,64). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.people') is null or to_regclass('erp.parceiro_enderecos') is null then
    raise exception 'CADASTROS-AJ01: erp.people/erp.parceiro_enderecos nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_people_tenant') then
    raise exception 'CADASTROS-AJ01: a 0027 nao esta aplicada (uq_people_tenant ausente); aplique a 0027 antes.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'products' and column_name = 'controle_lote') then
    raise exception 'CADASTROS-AJ01: a 0029 nao esta aplicada (erp.products.controle_lote ausente); aplique a 0029 antes.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'people' and column_name = 'matriz_id') then
    raise exception 'CADASTROS-AJ01: erp.people.matriz_id ja existe; a 0030 ja foi aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'parceiro_enderecos' and column_name = 'latitude') then
    raise exception 'CADASTROS-AJ01: erp.parceiro_enderecos.latitude ja existe; a 0030 ja foi aplicada ou ha schema divergente.';
  end if;
end $$;

create temporary table _aj01_antes on commit drop as
  select (select count(*) from erp.people) as parceiros,
         (select count(*) from erp.parceiro_enderecos) as enderecos;

-- ---------- 3) colunas novas em erp.people ----------
alter table erp.people
  add column matriz_id uuid,
  add column rg text,
  add column caepf text constraint chk_people_caepf check (caepf ~ '^[0-9]{14}$'),
  add column sexo text constraint chk_people_sexo check (sexo in ('F','M')),
  add column site text,
  add column caixa_postal text,
  add column latitude numeric(9,6) constraint chk_people_latitude check (latitude between -90 and 90),
  add column longitude numeric(9,6) constraint chk_people_longitude check (longitude between -180 and 180),
  add column email_nfe citext,
  add column calcula_funrural boolean not null default false;

alter table erp.people
  add constraint fk_people_matriz foreign key (matriz_id, organization_id) references erp.people (id, organization_id),
  add constraint chk_people_matriz_nao_ele_mesmo check (matriz_id is null or matriz_id <> id);
create index ix_people_matriz on erp.people (organization_id, matriz_id) where matriz_id is not null;

comment on column erp.people.matriz_id is 'Matriz do parceiro (filial → matriz). Só Jurídica (regra da API); parceiro vivo da mesma organização (FK composta) e nunca ele mesmo.';
comment on column erp.people.rg is 'RG (Física; a API recusa em Jurídica).';
comment on column erp.people.caepf is 'CAEPF — Cadastro de Atividade Econômica da Pessoa Física (14 dígitos; só Física).';
comment on column erp.people.sexo is 'Sexo (F ou M; só Física).';
comment on column erp.people.site is 'Site do parceiro.';
comment on column erp.people.caixa_postal is 'Caixa postal do endereço principal.';
comment on column erp.people.latitude is 'Latitude do endereço principal em graus decimais (−90 a 90); informada junto com a longitude.';
comment on column erp.people.longitude is 'Longitude do endereço principal em graus decimais (−180 a 180); informada junto com a latitude.';
comment on column erp.people.email_nfe is 'E-mail que recebe o XML/DANFE da NF-e.';
comment on column erp.people.calcula_funrural is 'Calcula FUNRURAL: fornecedor produtor rural — a compra retém o FUNRURAL.';

-- ---------- 4) colunas novas em erp.parceiro_enderecos ----------
alter table erp.parceiro_enderecos
  add column latitude numeric(9,6) constraint chk_parceiro_enderecos_latitude check (latitude between -90 and 90),
  add column longitude numeric(9,6) constraint chk_parceiro_enderecos_longitude check (longitude between -180 and 180);

comment on column erp.parceiro_enderecos.latitude is 'Latitude do endereço em graus decimais (−90 a 90); informada junto com a longitude.';
comment on column erp.parceiro_enderecos.longitude is 'Longitude do endereço em graus decimais (−180 a 180); informada junto com a latitude.';

-- ---------- 5) pós-condições ----------
do $$
declare a record;
begin
  select * into a from _aj01_antes;
  if (select count(*) from erp.people) <> a.parceiros or (select count(*) from erp.parceiro_enderecos) <> a.enderecos then
    raise exception 'CADASTROS-AJ01: contagem de people/parceiro_enderecos mudou; a migration deveria ser aditiva.';
  end if;
  if exists (select 1 from erp.people where matriz_id is not null or rg is not null or caepf is not null or sexo is not null
                or site is not null or caixa_postal is not null or latitude is not null or longitude is not null
                or email_nfe is not null or calcula_funrural) then
    raise exception 'CADASTROS-AJ01: coluna nova de erp.people com valor; a migration nao faz backfill.';
  end if;
  if exists (select 1 from erp.parceiro_enderecos where latitude is not null or longitude is not null) then
    raise exception 'CADASTROS-AJ01: coluna nova de erp.parceiro_enderecos com valor; a migration nao faz backfill.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_people_matriz' and contype = 'f' and array_length(conkey, 1) = 2) then
    raise exception 'CADASTROS-AJ01: FK composta fk_people_matriz ausente.';
  end if;
end $$;
