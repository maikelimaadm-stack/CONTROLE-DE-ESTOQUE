-- =====================================================================
-- 0056 — SAT-08 (decisão 299): condição da área / análise multi-índice.
--
-- EXPAND-only sobre o acervo SAT-01..SAT-07:
--   1) CHECK de `erp.analises_satelitais.indice` passa a aceitar
--      ndvi, evi2, ndre, ndmi, msavi2, bsi (faixa [-1,1] por índice).
--   2) CHECK de `erp.satelite_consulta_itens.indice_bundle` / `versao_metodo`
--      aceitam o bundle `pastagem_essencial` + método `pastagem-essencial-v1`.
--   3) Tabela NOVA `erp.analises_satelitais_ext`: percentis, histograma,
--      qualidade e indicadores derivados experimentais (1:1 com a análise,
--      imutável, RLS tenant_e_empresa, módulo pecuária).
--
-- Nenhuma linha existente muda. Histórico NDVI (sat01-ndvi-v1 / ndvi-v2) e
-- rasters SAT-06/07 ficam intactos. Trava (2026,90). lock_timeout 2s.
-- Forward-only em produção; SQL reverso só nos testes DB (tabela nova vazia +
-- restaurar CHECKs), sem apagar análise.
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 90) then
    raise exception 'SAT-08: outra transacao ja detem a trava desta migration (2026,90). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight ----------
do $$
begin
  if to_regclass('erp.analises_satelitais_ext') is not null then
    raise exception 'SAT-08: a 0056 ja foi aplicada ou ha schema divergente (analises_satelitais_ext ja existe).';
  end if;
  if to_regclass('erp.analises_satelitais') is null then
    raise exception 'SAT-08: erp.analises_satelitais ausente; aplique a 0052 antes.';
  end if;
  if to_regclass('erp.satelite_consulta_itens') is null then
    raise exception 'SAT-08: erp.satelite_consulta_itens ausente; aplique a 0053 antes.';
  end if;
  if to_regclass('erp.satelite_rasters') is null then
    raise exception 'SAT-08: erp.satelite_rasters ausente; aplique a 0055 (SAT-06) antes.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-08: papel erp_app ausente (0007).';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'SAT-08: funcoes de RLS/auditoria ausentes; cadeia fora de ordem.';
  end if;
  -- Acervo: nenhum índice fora de ndvi ainda (fail-closed se produção divergir).
  if exists (select 1 from erp.analises_satelitais where indice <> 'ndvi') then
    raise exception 'SAT-08: ha analise com indice <> ndvi antes da 0056; acervo divergente — decisao humana. Nada foi aplicado.';
  end if;
  if exists (
    select 1 from erp.satelite_consulta_itens
     where indice_bundle <> 'ndvi' or versao_metodo <> 'ndvi-v2'
  ) then
    raise exception 'SAT-08: ha item de consulta fora de (ndvi, ndvi-v2) antes da 0056; acervo divergente. Nada foi aplicado.';
  end if;
end $$;

-- ---------- 3) travas nas tabelas existentes (mesmo perfil da 0053/0055) ----------
lock table erp.organizations, erp.empresas, erp.users, erp.analises_satelitais, erp.satelite_consulta_itens
  in share row exclusive mode;

-- ---------- 4) ampliar CHECKs (drop + add; nomes estáveis) ----------
alter table erp.analises_satelitais drop constraint chk_analises_satelitais_indice;
alter table erp.analises_satelitais
  add constraint chk_analises_satelitais_indice
  check (indice in ('ndvi', 'evi2', 'ndre', 'ndmi', 'msavi2', 'bsi'));

-- Faixa [-1,1] para todos os índices do bundle (EVI2/MSAVI2/BSI operacionais nesta faixa).
alter table erp.analises_satelitais drop constraint if exists chk_analises_satelitais_faixa_indice;
alter table erp.analises_satelitais
  add constraint chk_analises_satelitais_faixa_indice check (
    valor_minimo is null
    or (
      indice in ('ndvi', 'evi2', 'ndre', 'ndmi', 'msavi2', 'bsi')
      and valor_minimo >= -1 and valor_maximo <= 1
    )
  );

-- O CHECK antigo só citava NDVI; mantemos por compatibilidade de nome… mas a faixa genérica cobre.
-- Se o antigo ainda existir, ele continua válido (subset).

alter table erp.satelite_consulta_itens drop constraint chk_satelite_consulta_itens_indice_bundle;
alter table erp.satelite_consulta_itens
  add constraint chk_satelite_consulta_itens_indice_bundle
  check (indice_bundle in ('ndvi', 'pastagem_essencial'));

alter table erp.satelite_consulta_itens drop constraint chk_satelite_consulta_itens_versao_metodo;
alter table erp.satelite_consulta_itens
  add constraint chk_satelite_consulta_itens_versao_metodo
  check (versao_metodo in ('ndvi-v2', 'pastagem-essencial-v1'));

-- Coerência bundle × versão (não misturar).
alter table erp.satelite_consulta_itens
  add constraint chk_satelite_consulta_itens_bundle_versao check (
    (indice_bundle = 'ndvi' and versao_metodo = 'ndvi-v2')
    or (indice_bundle = 'pastagem_essencial' and versao_metodo = 'pastagem-essencial-v1')
  );

comment on column erp.analises_satelitais.indice is
  'Índice espectral (SAT-08): ndvi, evi2, ndre, ndmi, msavi2, bsi. Catálogo versionado no domínio.';
comment on column erp.satelite_consulta_itens.indice_bundle is
  'Índice ou bundle: ndvi (SAT-02) ou pastagem_essencial (SAT-08 multi-índice).';
comment on column erp.satelite_consulta_itens.versao_metodo is
  'Versão do método do executor: ndvi-v2 ou pastagem-essencial-v1.';

-- ---------- 5) extensão imutável da análise (percentis / histograma / qualidade / indicadores) ----------
create table erp.analises_satelitais_ext (
  analise_id uuid primary key,
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  percentis jsonb,
  histograma jsonb,
  qualidade jsonb not null default '{}'::jsonb,
  indicadores_derivados jsonb,
  versao_distribuicao text not null
    constraint chk_analises_sat_ext_versao check (versao_distribuicao ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  created_at timestamptz not null default now(),
  constraint fk_analises_sat_ext_empresa foreign key (organization_id, empresa_id)
    references erp.empresas (organization_id, id),
  constraint fk_analises_sat_ext_analise foreign key (organization_id, empresa_id, area_id, analise_id)
    references erp.analises_satelitais (organization_id, empresa_id, area_id, id),
  constraint chk_analises_sat_ext_percentis check (percentis is null or jsonb_typeof(percentis) = 'object'),
  constraint chk_analises_sat_ext_histograma check (histograma is null or jsonb_typeof(histograma) = 'object'),
  constraint chk_analises_sat_ext_qualidade check (jsonb_typeof(qualidade) = 'object'),
  constraint chk_analises_sat_ext_indicadores check (
    indicadores_derivados is null or jsonb_typeof(indicadores_derivados) = 'object'
  )
);

create index ix_analises_sat_ext_area on erp.analises_satelitais_ext (organization_id, area_id, created_at desc);

comment on table erp.analises_satelitais_ext is
  'SAT-08: percentis, histograma, qualidade e indicadores derivados experimentais da análise. Imutável. 1:1 com analises_satelitais.';
comment on column erp.analises_satelitais_ext.indicadores_derivados is
  'Heurísticas experimentais (vegetação ativa, solo exposto, condição hídrica). NÃO é biomassa nem diagnóstico de praga.';

create function erp.analises_satelitais_ext_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: O detalhe estatístico da análise satelital não se altera nem se apaga: registre uma análise nova.'
    using errcode = 'P0001';
end $$;
revoke execute on function erp.analises_satelitais_ext_imutavel() from public;

create trigger trg_analises_sat_ext_imutavel
  before update or delete on erp.analises_satelitais_ext
  for each row execute function erp.analises_satelitais_ext_imutavel();
create trigger trg_analises_sat_ext_imutavel_truncate
  before truncate on erp.analises_satelitais_ext
  for each statement execute function erp.analises_satelitais_ext_imutavel();
create trigger trg_analises_sat_ext_audit
  after insert on erp.analises_satelitais_ext
  for each row execute function erp.audit_row();

alter table erp.analises_satelitais_ext enable row level security;
alter table erp.analises_satelitais_ext force row level security;
create policy tenant_e_empresa on erp.analises_satelitais_ext for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))));

grant select, insert on erp.analises_satelitais_ext to erp_app;
revoke update, delete, truncate on erp.analises_satelitais_ext from erp_app;
grant select on erp.analises_satelitais_ext to authenticated;

-- ---------- 6) pós-condições ----------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_analises_satelitais_indice'
       and conrelid = 'erp.analises_satelitais'::regclass
  ) then
    raise exception 'SAT-08: chk_analises_satelitais_indice ausente apos a 0056.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_consulta_itens_bundle_versao'
       and conrelid = 'erp.satelite_consulta_itens'::regclass
  ) then
    raise exception 'SAT-08: chk_satelite_consulta_itens_bundle_versao ausente.';
  end if;
  if to_regclass('erp.analises_satelitais_ext') is null then
    raise exception 'SAT-08: erp.analises_satelitais_ext nao criada.';
  end if;
  if (select array_agg(policyname::text order by policyname)
        from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais_ext')
     is distinct from array['tenant_e_empresa'] then
    raise exception 'SAT-08: politica de erp.analises_satelitais_ext diferente de tenant_e_empresa.';
  end if;
end $$;
