-- =====================================================================
-- 0058 — SATÉLITE COMPLETO (decisão 301): raster Process API multi-índice.
--
-- Expande o CHECK de `indice` em erp.satelite_rasters e o CHECK de forma do
-- `storage_path` em erp.satelite_raster_arquivos (antes só 'ndvi') para o
-- bundle essencial: ndvi, evi2, ndre, ndmi, msavi2, bsi.
--
-- NÃO cria tabela nova. NÃO altera RLS/políticas. NÃO toca acervo NDVI.
-- Forward-only. Trava (2026,92). lock_timeout 2s.
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 92) then
    raise exception 'SAT-FINAL: outra transacao ja detem a trava desta migration (2026,92). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

do $$
begin
  if to_regclass('erp.satelite_rasters') is null or to_regclass('erp.satelite_raster_arquivos') is null then
    raise exception 'SAT-FINAL: erp.satelite_rasters/arquivos ausentes; aplique a 0055 antes.';
  end if;
  -- Já aplicada? (CHECK de índice já contém evi2)
  if exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_rasters_indice'
       and conrelid = 'erp.satelite_rasters'::regclass
       and pg_get_constraintdef(oid) like '%evi2%'
  ) then
    raise exception 'SAT-FINAL: a 0058 ja foi aplicada (chk_satelite_rasters_indice ja aceita evi2).';
  end if;
  -- Acervo: nenhum raster com índice fora de ndvi (0055 só permitia ndvi).
  if exists (
    select 1 from erp.satelite_rasters where indice <> 'ndvi'
  ) then
    raise exception 'SAT-FINAL: ha raster com indice <> ndvi antes da 0058; acervo divergente. Nada foi aplicado.';
  end if;
end $$;

lock table erp.satelite_rasters, erp.satelite_raster_arquivos in share row exclusive mode;

alter table erp.satelite_rasters drop constraint chk_satelite_rasters_indice;
alter table erp.satelite_rasters
  add constraint chk_satelite_rasters_indice
  check (indice in ('ndvi', 'evi2', 'ndre', 'ndmi', 'msavi2', 'bsi'));

alter table erp.satelite_raster_arquivos drop constraint chk_satelite_raster_arquivos_storage_path;
alter table erp.satelite_raster_arquivos
  add constraint chk_satelite_raster_arquivos_storage_path check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(ndvi|evi2|ndre|ndmi|msavi2|bsi)/[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/[0-9a-f]{64}[.]png$'
    and split_part(storage_path, '/', 1) = organization_id::text
  );

comment on column erp.satelite_rasters.indice is
  'Índice do raster de valores (SAT-06 NDVI + SATÉLITE COMPLETO multi-índice): ndvi|evi2|ndre|ndmi|msavi2|bsi.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_rasters_indice'
       and pg_get_constraintdef(oid) like '%evi2%'
       and pg_get_constraintdef(oid) like '%bsi%'
  ) then
    raise exception 'SAT-FINAL: pos-condicao falhou — chk_satelite_rasters_indice sem evi2/bsi.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_raster_arquivos_storage_path'
       and pg_get_constraintdef(oid) like '%msavi2%'
  ) then
    raise exception 'SAT-FINAL: pos-condicao falhou — storage_path sem msavi2.';
  end if;
end $$;
