-- =====================================================================
-- 0051 CADASTRO-AREAS-02 — UNIFICA MAPA × CADASTRO DE ÁREAS (decisão 292)
--
-- SSOT da área passa a ser erp.areas. O mapa desenha/grava nessa tabela.
-- erp.mapa_areas permanece no schema (version skew / binário antigo ainda a
-- conhece), mas o acervo vivo é migrado para erp.areas e soft-deleted.
--
-- 1) Coluna erp.areas.geometria (GeoJSON Polygon) + validação pelo mesmo
--    predicado de MAPA-01 (erp.mapa_area_geometria_valida).
-- 2) Backfill geometria a partir de kml_geometry quando já for Polygon válido.
-- 3) Migra linhas vivas de erp.mapa_areas → erp.areas (código sequencial por
--    empresa; land_use/status/tenure padrão; usable_area_ha = tamanho).
-- 4) Soft-delete das linhas migradas em mapa_areas (nada é apagado de verdade).
--
-- SEM PostGIS. SEM DROP de mapa_areas. SEM mudar FKs de lote/movimento.
-- Trava (2026,85). lock_timeout 2s. Runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 85) then
    raise exception 'CADASTRO-AREAS-02: outra transacao ja detem a trava desta migration (2026,85). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições ----------
do $$
begin
  if to_regclass('erp.areas') is null or to_regclass('erp.mapa_areas') is null then
    raise exception 'CADASTRO-AREAS-02: erp.areas/mapa_areas ausentes; cadeia fora de ordem.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'usable_area_ha') then
    raise exception 'CADASTRO-AREAS-02: usable_area_ha ausente; aplique a 0050 antes.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'geometria') then
    raise exception 'CADASTRO-AREAS-02: erp.areas.geometria ja existe; a 0051 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.mapa_area_geometria_valida(jsonb)') is null then
    raise exception 'CADASTRO-AREAS-02: erp.mapa_area_geometria_valida ausente; aplique a 0049 antes.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'CADASTRO-AREAS-02: papel erp_app ausente.';
  end if;
end $$;

-- ---------- 3) coluna geometria + cor hex (quando preenchida) ----------
alter table erp.areas
  add column geometria jsonb;

comment on column erp.areas.geometria is 'Polígono GeoJSON Polygon canônico (CADASTRO-AREAS-02 / decisão 292). Validado por gatilho; nulo = área sem desenho no mapa.';

-- cor do mapa (#RRGGBB) — só quando informada
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_areas_color_hex' and conrelid = 'erp.areas'::regclass
  ) then
    alter table erp.areas
      add constraint chk_areas_color_hex
      check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

-- ---------- 4) backfill de kml_geometry válido ----------
update erp.areas
set geometria = kml_geometry
where geometria is null
  and kml_geometry is not null
  and erp.mapa_area_geometria_valida(kml_geometry);

-- kml_geometry inválido (não-Polygon) permanece só em kml_geometry; geometria fica null — fail-closed não inventa polígono.

-- ---------- 5) gatilho de validação ----------
create or replace function erp.areas_geometria_conferir() returns trigger
language plpgsql as $$
begin
  if new.geometria is not null and not erp.mapa_area_geometria_valida(new.geometria) then
    raise exception 'VALIDATION_ERROR: Geometria da área inválida (esperado GeoJSON Polygon com anéis fechados de ao menos 4 posições [lon,lat]).' using errcode = 'P0001';
  end if;
  -- Mantém kml_geometry alinhado quando a geometria canônica muda (legado / fatias antigas).
  if new.geometria is not null and (tg_op = 'INSERT' or new.geometria is distinct from old.geometria) then
    new.kml_geometry := new.geometria;
  end if;
  return new;
end $$;

comment on function erp.areas_geometria_conferir() is 'CADASTRO-AREAS-02: valida geometria canônica em erp.areas e espelha em kml_geometry.';

drop trigger if exists trg_areas_geometria_conferir on erp.areas;
create trigger trg_areas_geometria_conferir
  before insert or update on erp.areas
  for each row execute function erp.areas_geometria_conferir();

revoke execute on function erp.areas_geometria_conferir() from public;

-- ---------- 6) migrar mapa_areas → areas ----------
-- Códigos numéricos por empresa a partir do maior código só-dígitos existente.
with base as (
  select a.empresa_id,
         coalesce(max(nullif(regexp_replace(a.code, '[^0-9]', '', 'g'), '')::int), 0) as max_code
  from erp.areas a
  group by a.empresa_id
),
fonte as (
  select m.*,
         row_number() over (partition by m.empresa_id order by m.created_at, m.id) as rn,
         coalesce(b.max_code, 0) as max_code
  from erp.mapa_areas m
  left join base b on b.empresa_id = m.empresa_id
  where m.deleted_at is null
)
insert into erp.areas (
  organization_id, empresa_id, code, name,
  area_ha, usable_area_ha, color, geometria, kml_geometry,
  land_use, status, tenure, is_active, created_at
)
select
  f.organization_id,
  f.empresa_id,
  lpad((f.max_code + f.rn)::text, 4, '0'),
  f.nome,
  f.tamanho_ha,
  f.tamanho_ha,
  f.cor,
  f.geometria,
  f.geometria,
  'pastagem',
  'ativa',
  'propria',
  true,
  f.created_at
from fonte f;

-- Soft-delete do acervo migrado (mantém a tabela para o binário antigo no skew).
update erp.mapa_areas
set deleted_at = coalesce(deleted_at, now())
where deleted_at is null;

comment on table erp.mapa_areas is 'DEPRECATED (CADASTRO-AREAS-02 / decisão 292): acervo migrado para erp.areas. Mantida só para version skew do binário MAPA-01; a UI nova não grava aqui. Soft delete do legado; sem DROP nesta fatia.';

-- ---------- 7) pós-condições ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'geometria') then
    raise exception 'CADASTRO-AREAS-02: pos-condicao falhou — geometria ausente em erp.areas.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_areas_geometria_conferir') then
    raise exception 'CADASTRO-AREAS-02: pos-condicao falhou — trg_areas_geometria_conferir ausente.';
  end if;
  if exists (select 1 from erp.mapa_areas where deleted_at is null) then
    raise exception 'CADASTRO-AREAS-02: pos-condicao falhou — ainda ha mapa_areas viva apos a migracao.';
  end if;
end $$;
