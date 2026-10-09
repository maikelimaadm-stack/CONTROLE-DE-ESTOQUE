-- =====================================================================
-- 0061 — MAPA-MANEJO-01 (decisão 305): fundação operacional do Mapa de Manejo.
--
-- Dá ao mapa os DADOS que ele não tem. A tela não entra nesta fatia.
--
--   CAMADA 1  erp.ocupacoes_de_area   a posição do rebanho COM HISTÓRIA (lote × área × período)
--             erp.objetos_de_mapa     objetos de ponto no mapa (cocho, depósito a pasto)
--             erp.objeto_de_mapa_geometria_valida(jsonb, text)  validador NOVO (Point/LineString)
--             trg_batches_fechar_ocupacao  o gatilho que mantém a história íntegra
--             backfill: UMA ocupação aberta por lote ativo com área (SÓ INSERT na tabela nova)
--   CAMADA 2  erp.animal_handlings.area_id e erp.weighings.area_id (colunas NOVAS, nulas)
--             gatilho BEFORE INSERT: a área da ocupação do lote NA DATA do documento
--             backfill: o ÚNICO UPDATE em tabela existente desta fatia — e só na coluna nova
--   CAMADA 5  5.1 o unique (empresa_id, code) de erp.areas (confere; cria só se faltar e não houver duplicata)
--             5.3 erp.areas deixa de conceder DELETE ao erp_app (a exclusão é lógica)
--
-- SEM PostGIS: geometria continua GeoJSON em jsonb validado por plpgsql (0049:29, 0050:16, 0051:15).
-- NÃO toca erp.mapa_areas, kml_geometry nem o módulo de escopo 'mapa'.
-- Forward-only. Trava (2026,95). lock_timeout 2s. O runner aplica o arquivo em UMA transação:
-- sem commit, sem create index concurrently, sem cascade.
-- =====================================================================

-- ---------- 1) trava ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 95) then
    raise exception 'MAPA-MANEJO-01: outra transacao ja detem a trava desta migration (2026,95). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições (fail-closed; "já aplicada" antes das dependências) ----------
do $$
begin
  if to_regclass('erp.ocupacoes_de_area') is not null or to_regclass('erp.objetos_de_mapa') is not null
     or to_regprocedure('erp.objeto_de_mapa_geometria_valida(jsonb,text)') is not null then
    raise exception 'MAPA-MANEJO-01: a 0061 ja foi aplicada (erp.ocupacoes_de_area, erp.objetos_de_mapa ou o validador ja existe).';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'erp' and column_name = 'area_id' and table_name in ('animal_handlings', 'weighings')) then
    raise exception 'MAPA-MANEJO-01: a 0061 ja foi aplicada ou ha schema divergente (area_id ja existe em animal_handlings/weighings).';
  end if;
  if to_regclass('erp.areas') is null or to_regclass('erp.batches') is null or to_regclass('erp.animal_movements') is null
     or to_regclass('erp.animal_handlings') is null or to_regclass('erp.weighings') is null or to_regclass('erp.troughs') is null then
    raise exception 'MAPA-MANEJO-01: tabelas de pecuaria ausentes (areas/batches/animal_movements/animal_handlings/weighings/troughs); cadeia fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'areas_org_empresa_key' and conrelid = 'erp.areas'::regclass and contype = 'u'
                    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, empresa_id, id)') then
    raise exception 'MAPA-MANEJO-01: areas_org_empresa_key (organization_id, empresa_id, id) ausente em erp.areas; aplique a 0052 antes.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'uq_batches_tenant' and conrelid = 'erp.batches'::regclass and contype = 'u'
                    and pg_get_constraintdef(oid) = 'UNIQUE (id, organization_id)') then
    raise exception 'MAPA-MANEJO-01: erp.batches sem a unique composta (id, organization_id) uq_batches_tenant; a FK composta do lote nao tem alvo.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'erp' and table_name = 'areas' and column_name = 'usable_area_ha' and is_nullable = 'NO') then
    raise exception 'MAPA-MANEJO-01: erp.areas.usable_area_ha ausente ou anulavel; aplique a 0050 antes.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'batches'
         and column_name in ('area_id', 'status', 'exit_date', 'entry_date', 'deleted_at', 'empresa_id')) <> 6 then
    raise exception 'MAPA-MANEJO-01: erp.batches sem as colunas area_id/status/exit_date/entry_date/deleted_at/empresa_id.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'animal_movements_movement_type_check' and conrelid = 'erp.animal_movements'::regclass
                    and pg_get_constraintdef(oid) like '%module_area_transfer%') then
    raise exception 'MAPA-MANEJO-01: animal_movements sem o tipo module_area_transfer; o backfill nao tem como achar a data do movimento.';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null or to_regprocedure('erp.set_updated_at()') is null then
    raise exception 'MAPA-MANEJO-01: funcoes de RLS/auditoria/updated_at ausentes; cadeia fora de ordem.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'areas' and policyname = 'tenant_e_empresa') then
    raise exception 'MAPA-MANEJO-01: politica tenant_e_empresa de erp.areas ausente (molde das tabelas novas).';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'MAPA-MANEJO-01: modulo de escopo pecuaria ausente.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'MAPA-MANEJO-01: papel erp_app ausente (0007).';
  end if;
  -- O backfill grava em tabela com RLS FORÇADA e os gatilhos SECURITY DEFINER gravam como o dono: o papel que
  -- aplica precisa atravessar a RLS (o mesmo requisito da 0042).
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'MAPA-MANEJO-01: o papel que aplica a migration (%) precisa ser superusuario ou ter BYPASSRLS.', current_user;
  end if;
end $$;

-- =====================================================================
-- CAMADA 1
-- =====================================================================

-- ---------- 3) validador NOVO de geometria de objeto (não toca erp.mapa_area_geometria_valida) ----------
-- Aceita só o que a FORMA pede: ponto = Point [lon,lat]; linha = LineString com 2+ posições [lon,lat].
-- O validador JÁ aceita linha sem haver tipo de linha (decisão 305): quando "cerca" chegar, a mudança é
-- acrescentar o tipo na lista do CHECK chk_objetos_forma_bate_com_tipo — não trocar o validador.
create function erp.objeto_de_mapa_geometria_valida(p jsonb, p_forma text) returns boolean
language plpgsql immutable security definer set search_path = erp, pg_temp as $$
declare
  v_tipo text;
  v_coords jsonb;
  v_pos jsonb;
  v_posicoes jsonb;
begin
  if p is null or p_forma is null then
    return false;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  v_tipo := p->>'type';
  v_coords := p->'coordinates';
  if v_coords is null then
    return false;
  end if;
  if jsonb_typeof(v_coords) <> 'array' then
    return false;
  end if;
  if p_forma = 'ponto' and v_tipo = 'Point' then
    v_posicoes := jsonb_build_array(v_coords);
  elsif p_forma = 'linha' and v_tipo = 'LineString' then
    if jsonb_array_length(v_coords) < 2 then
      return false;
    end if;
    v_posicoes := v_coords;
  else
    -- Polygon, MultiPolygon, type desconhecido, ou type que não bate com a forma.
    return false;
  end if;
  -- Uma posição por vez, um teste por vez: o cast para numeric só acontece depois de provado que é número
  -- (num AND/OR o Postgres não garante a ordem de avaliação).
  for v_pos in select value from jsonb_array_elements(v_posicoes) loop
    if jsonb_typeof(v_pos) <> 'array' then
      return false;
    end if;
    if jsonb_array_length(v_pos) <> 2 then
      return false;
    end if;
    if jsonb_typeof(v_pos->0) <> 'number' or jsonb_typeof(v_pos->1) <> 'number' then
      return false;
    end if;
    if (v_pos->>0)::numeric < -180 or (v_pos->>0)::numeric > 180
       or (v_pos->>1)::numeric < -90 or (v_pos->>1)::numeric > 90 then
      return false;
    end if;
  end loop;
  return true;
end $$;

comment on function erp.objeto_de_mapa_geometria_valida(jsonb, text) is
  'MAPA-MANEJO-01 (decisão 305): valida a geometria de um objeto de mapa pela FORMA: ponto = GeoJSON Point [lon,lat]; linha = LineString com 2+ posicoes [lon,lat]. Recusa Polygon, MultiPolygon, outro type, lon fora de [-180,180], lat fora de [-90,90], coordenada nao numerica e array mal formado. Ja aceita linha para que "cerca" seja mudar a lista do CHECK, nao o validador.';

-- ---------- 4) erp.ocupacoes_de_area ----------
create table erp.ocupacoes_de_area (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  batch_id uuid not null,
  data_inicio date not null,
  data_fim date,
  cabecas_na_entrada integer,
  ua_na_entrada numeric(10,2),
  origem_da_data text not null,
  motivo_saida text,
  movimento_entrada_id uuid,
  movimento_saida_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint fk_ocupacoes_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_ocupacoes_area foreign key (organization_id, empresa_id, area_id) references erp.areas (organization_id, empresa_id, id),
  constraint fk_ocupacoes_lote foreign key (batch_id, organization_id) references erp.batches (id, organization_id),
  constraint fk_ocupacoes_movimento_entrada foreign key (movimento_entrada_id) references erp.animal_movements (id),
  constraint fk_ocupacoes_movimento_saida foreign key (movimento_saida_id) references erp.animal_movements (id),
  constraint chk_ocupacoes_periodo check (data_fim is null or data_fim >= data_inicio),
  constraint chk_ocupacoes_cabecas check (cabecas_na_entrada is null or cabecas_na_entrada >= 0),
  constraint chk_ocupacoes_ua check (ua_na_entrada is null or ua_na_entrada >= 0),
  constraint chk_ocupacoes_origem_da_data check (origem_da_data in ('movimento', 'entrada_do_lote', 'criacao_do_lote', 'informada')),
  constraint chk_ocupacoes_motivo_saida check (motivo_saida is null or motivo_saida in ('transferencia', 'encerramento_do_lote', 'correcao'))
);

-- A invariante central: UM lote tem no máximo UMA ocupação aberta. VÁRIOS lotes na mesma área ao mesmo
-- tempo é permitido de propósito (não há unique por área).
create unique index uq_ocupacao_aberta_por_lote on erp.ocupacoes_de_area (organization_id, batch_id)
  where data_fim is null and deleted_at is null;
create index ix_ocupacoes_area_inicio on erp.ocupacoes_de_area (organization_id, empresa_id, area_id, data_inicio desc);
create index ix_ocupacoes_lote_inicio on erp.ocupacoes_de_area (organization_id, empresa_id, batch_id, data_inicio desc);

comment on table erp.ocupacoes_de_area is
  'MAPA-MANEJO-01 (decisão 305): posição do rebanho COM HISTÓRIA — qual lote ocupou qual área (piquete) em qual período. Período [data_inicio, data_fim], inclusivo nos dois lados; data_fim nula = ocupação ABERTA. Um lote tem no máximo uma aberta (uq_ocupacao_aberta_por_lote); vários lotes na mesma área ao mesmo tempo é permitido. Mantida pelo gatilho trg_batches_fechar_ocupacao em erp.batches; a API enriquece (movimentos, cabeças, UA, data do movimento). Sem DELETE: a exclusão é lógica (deleted_at).';
comment on column erp.ocupacoes_de_area.empresa_id is 'Empresa da ÁREA (FK composta com a área por areas_org_empresa_key). Escopo de empresa do módulo pecuaria.';
comment on column erp.ocupacoes_de_area.batch_id is 'Lote (FK composta com a organização por uq_batches_tenant).';
comment on column erp.ocupacoes_de_area.data_inicio is 'Primeiro dia do lote na área. Ver origem_da_data: pode ser medida (movimento) ou estimada (criação do lote).';
comment on column erp.ocupacoes_de_area.data_fim is 'Último dia do lote na área; nula = ocupação aberta.';
comment on column erp.ocupacoes_de_area.cabecas_na_entrada is 'Cabeças do lote na entrada (animais ativos + soma de erp.herd_lots.quantity), congeladas. Nulas no backfill: não se inventa retroativo.';
comment on column erp.ocupacoes_de_area.ua_na_entrada is 'Unidades animais na entrada (UA = 450 kg; sem peso, o fator da categoria), CONGELADA: não recalcula quando o rebanho muda depois. Nula no backfill.';
comment on column erp.ocupacoes_de_area.origem_da_data is
  'De onde veio data_inicio: movimento (registrada por um movimento ou mudança do lote — MEDIDA), entrada_do_lote (erp.batches.entry_date — declarada no cadastro), criacao_do_lote (data de created_at do lote — ESTIMATIVA), informada (digitada por alguém). Existe para que ninguém leia "47 dias de ocupação" como número medido quando é estimativa pela criação do lote.';
comment on column erp.ocupacoes_de_area.motivo_saida is 'Por que a ocupação fechou: transferencia (o lote mudou de área), encerramento_do_lote (lote fechado ou com data de saída), correcao (lote excluído ou ajuste manual). Nulo enquanto aberta.';
comment on column erp.ocupacoes_de_area.movimento_entrada_id is 'Movimento (erp.animal_movements) que trouxe o lote para a área, quando houver.';
comment on column erp.ocupacoes_de_area.movimento_saida_id is 'Movimento que tirou o lote da área, quando houver.';

alter table erp.ocupacoes_de_area enable row level security;
alter table erp.ocupacoes_de_area force row level security;
create policy tenant_e_empresa on erp.ocupacoes_de_area for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Os default privileges da 0007 concedem delete; a exclusão é lógica, então o revoke é EXPLÍCITO.
grant select, insert, update on erp.ocupacoes_de_area to erp_app;
revoke delete, truncate on erp.ocupacoes_de_area from erp_app;

create trigger trg_ocupacoes_de_area_updated before update on erp.ocupacoes_de_area
  for each row execute function erp.set_updated_at();

-- Conferência da linha: a identidade (organização, empresa, área, lote) não muda depois de gravada, e o
-- movimento ligado tem de ser DESTA organização e DESTE lote — a FK de coluna única prova que o movimento
-- existe, não que é do mesmo tenant. SECURITY DEFINER: lê animal_movements sem depender do módulo da rota.
create function erp.ocupacoes_de_area_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id is distinct from old.organization_id or new.empresa_id is distinct from old.empresa_id
                           or new.area_id is distinct from old.area_id or new.batch_id is distinct from old.batch_id) then
    raise exception 'CONFLICT: A área, o lote e a empresa de uma ocupação não mudam depois de gravados.' using errcode = 'P0001';
  end if;
  if new.movimento_entrada_id is not null and (tg_op = 'INSERT' or new.movimento_entrada_id is distinct from old.movimento_entrada_id)
     and not exists (select 1 from erp.animal_movements m
                      where m.id = new.movimento_entrada_id and m.organization_id = new.organization_id
                        and m.batch_id is not distinct from new.batch_id) then
    raise exception 'VALIDATION_ERROR: Movimento de entrada indisponível para esta ocupação.' using errcode = 'P0001';
  end if;
  if new.movimento_saida_id is not null and (tg_op = 'INSERT' or new.movimento_saida_id is distinct from old.movimento_saida_id)
     and not exists (select 1 from erp.animal_movements m
                      where m.id = new.movimento_saida_id and m.organization_id = new.organization_id
                        and m.batch_id is not distinct from new.batch_id) then
    raise exception 'VALIDATION_ERROR: Movimento de saída indisponível para esta ocupação.' using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function erp.ocupacoes_de_area_conferir() is
  'MAPA-MANEJO-01: identidade imutável da ocupação e movimentos ligados da mesma organização e do mesmo lote.';

create trigger trg_ocupacoes_de_area_conferir before insert or update on erp.ocupacoes_de_area
  for each row execute function erp.ocupacoes_de_area_conferir();

-- ---------- 5) erp.objetos_de_mapa — ponto no mapa ----------
create table erp.objetos_de_mapa (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid,
  tipo text not null,
  forma text not null,
  geometria jsonb not null,
  code text,
  name text not null,
  descricao text,
  capacidade numeric(12,3),
  unidade_capacidade text,
  trough_id uuid references erp.troughs (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint fk_objetos_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_objetos_area foreign key (organization_id, empresa_id, area_id) references erp.areas (organization_id, empresa_id, id),
  constraint chk_objetos_tipo check (tipo in ('cocho', 'deposito_a_pasto')),
  constraint chk_objetos_forma check (forma in ('ponto', 'linha')),
  -- A lista ENTRE CHAVES é a dos tipos de LINHA (hoje vazia: os dois tipos são de ponto). Acrescentar "cerca"
  -- é acrescentar o nome nessa lista (e em chk_objetos_tipo) — a regra não muda: tipo de linha ⇔ forma linha.
  constraint chk_objetos_forma_bate_com_tipo check ((tipo = any ('{}'::text[])) = (forma = 'linha')),
  constraint chk_objetos_capacidade check (capacidade is null or capacidade >= 0),
  constraint chk_objetos_unidade check (unidade_capacidade is null or unidade_capacidade in ('m', 't', 'kg', 'sc')),
  -- Só cocho liga a erp.troughs.
  constraint chk_objetos_cocho_so_para_cocho check (trough_id is null or tipo = 'cocho'),
  constraint chk_objetos_nome check (btrim(name) <> '')
);

create unique index uq_objetos_de_mapa_codigo on erp.objetos_de_mapa (organization_id, empresa_id, tipo, code)
  where code is not null and deleted_at is null;
create index ix_objetos_de_mapa_area on erp.objetos_de_mapa (organization_id, empresa_id, area_id);

comment on table erp.objetos_de_mapa is
  'MAPA-MANEJO-01 (decisão 305): objeto de ponto no mapa (cocho, depósito a pasto), dentro ou fora de uma área. Geometria GeoJSON validada por erp.objeto_de_mapa_geometria_valida pela FORMA. Sem PostGIS. Sem DELETE: exclusão lógica (deleted_at). Ícones: fornecidos depois; nenhum nome de ícone mora no banco.';
comment on column erp.objetos_de_mapa.area_id is 'Área (piquete) onde o objeto está; nula = fora de área. Quando preenchida, mesma organização e empresa (FK composta).';
comment on column erp.objetos_de_mapa.forma is 'ponto ou linha; tem de bater com o tipo (chk_objetos_forma_bate_com_tipo).';
comment on column erp.objetos_de_mapa.geometria is 'GeoJSON: Point [lon,lat] para ponto; LineString com 2+ posições para linha.';
comment on column erp.objetos_de_mapa.capacidade is 'Capacidade física: cocho em metros (m); depósito a pasto em toneladas (t).';
comment on column erp.objetos_de_mapa.trough_id is 'Cocho cadastrado (erp.troughs, que existe sem coordenada). erp.troughs é recurso de ORGANIZAÇÃO: o gatilho trg_objetos_de_mapa_cocho_conferir recusa cocho de outra organização ou ligado a área de outra empresa.';

alter table erp.objetos_de_mapa enable row level security;
alter table erp.objetos_de_mapa force row level security;
create policy tenant_e_empresa on erp.objetos_de_mapa for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

grant select, insert, update on erp.objetos_de_mapa to erp_app;
revoke delete, truncate on erp.objetos_de_mapa from erp_app;

create trigger trg_objetos_de_mapa_updated before update on erp.objetos_de_mapa
  for each row execute function erp.set_updated_at();

create trigger trg_objetos_de_mapa_audit after insert or update or delete on erp.objetos_de_mapa
  for each row execute function erp.audit_row();

-- Geometria: no formato do trg_areas_geometria_conferir (0051:77-95). Inválida = VALIDATION_ERROR/P0001 → 422.
create function erp.objetos_de_mapa_geometria_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if not erp.objeto_de_mapa_geometria_valida(new.geometria, new.forma) then
    raise exception 'VALIDATION_ERROR: Geometria do objeto inválida (esperado GeoJSON Point [lon,lat] para ponto, ou LineString com ao menos 2 posições [lon,lat] para linha).' using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function erp.objetos_de_mapa_geometria_conferir() is 'MAPA-MANEJO-01: valida a geometria do objeto de mapa pela forma.';

create trigger trg_objetos_de_mapa_geometria_conferir
  before insert or update on erp.objetos_de_mapa
  for each row execute function erp.objetos_de_mapa_geometria_conferir();

-- 5.2 (dívida): erp.troughs não tem empresa e está fora da matriz de RLS de empresa. O cocho ligado tem de
-- ser desta organização e, se estiver numa área, a área tem de ser da MESMA empresa do objeto — senão o
-- trough_id vira caminho entre empresas. SECURITY DEFINER: enxerga a área de outra empresa para RECUSAR.
create function erp.objetos_de_mapa_cocho_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if new.trough_id is not null and (tg_op = 'INSERT' or new.trough_id is distinct from old.trough_id
                                    or new.empresa_id is distinct from old.empresa_id) then
    if not exists (select 1 from erp.troughs t
                     left join erp.areas a on a.id = t.area_id
                    where t.id = new.trough_id and t.organization_id = new.organization_id and t.deleted_at is null
                      and (t.area_id is null or (a.organization_id = new.organization_id and a.empresa_id = new.empresa_id))) then
      raise exception 'VALIDATION_ERROR: Cocho indisponível para este objeto.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

comment on function erp.objetos_de_mapa_cocho_conferir() is
  'MAPA-MANEJO-01 (5.2): o cocho ligado é desta organização e, quando está numa área, a área é da mesma empresa do objeto.';

create trigger trg_objetos_de_mapa_cocho_conferir
  before insert or update on erp.objetos_de_mapa
  for each row execute function erp.objetos_de_mapa_cocho_conferir();

-- ---------- 6) o gatilho que protege a invariante: erp.batches → erp.ocupacoes_de_area ----------
-- POR QUE NO GATILHO: qualquer caminho que mova o lote — a rota de hoje, uma futura, um UPDATE manual —
-- mantém a história íntegra. O serviço enriquece; o gatilho garante que o registro exista.
-- LOTE ATIVO, em TODA esta migration (gatilho, backfill e pós-condições): status 'active', deleted_at nulo e
-- exit_date nula. Uma definição só: exit_date preenchida É encerramento (a regra do gatilho), então o backfill
-- e a reabertura também a respeitam — senão o backfill abriria ocupação que o próprio gatilho trata como fechada.
--   · área mudou, lote encerrado (status 'closed' ou exit_date preenchida) ou excluído → fecha a aberta:
--     data_fim = greatest(data_inicio, current_date); motivo transferencia | encerramento_do_lote | correcao.
--   · área mudou para valor não nulo, com o lote ativo → abre a nova: data_inicio = current_date,
--     origem 'movimento' (a API, na mesma transação, liga o movimento e ajusta a data do movimento).
--   · lote reativado (fechado/excluído/com saída → ativo) com área → abre a nova, origem 'movimento'.
--   · só curral ou módulo mudou → NADA (a ocupação é de ÁREA).
--   · lote CRIADO já com área e ativo → abre: data_inicio = entry_date (entrada_do_lote) ou o dia
--     (criacao_do_lote) — a mesma regra do backfill, sem movimento.
-- SECURITY DEFINER: grava na tabela de RLS forçada como o dono; o filtro de tenant é explícito (NEW).
create function erp.batches_fechar_ocupacao() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_area_mudou boolean;
  v_excluido boolean;
  v_encerrando boolean;
  v_ativo_depois boolean;
  v_reativou boolean;
  v_empresa_da_area uuid;
begin
  if tg_op = 'INSERT' then
    if new.area_id is null or new.status <> 'active' or new.deleted_at is not null or new.exit_date is not null then
      return null;
    end if;
    select a.empresa_id into v_empresa_da_area
      from erp.areas a where a.id = new.area_id and a.organization_id = new.organization_id;
    if v_empresa_da_area is null then
      raise exception 'VALIDATION_ERROR: Área indisponível para o lote.' using errcode = 'P0001';
    end if;
    insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, origem_da_data)
    values (new.organization_id, v_empresa_da_area, new.area_id, new.id,
            coalesce(new.entry_date, current_date),
            case when new.entry_date is not null then 'entrada_do_lote' else 'criacao_do_lote' end);
    return null;
  end if;

  v_area_mudou := new.area_id is distinct from old.area_id;
  v_excluido := new.deleted_at is not null and old.deleted_at is null;
  v_encerrando := (new.status = 'closed' and old.status is distinct from 'closed')
                  or (new.exit_date is not null and old.exit_date is null)
                  or v_excluido;
  v_ativo_depois := new.status = 'active' and new.deleted_at is null and new.exit_date is null and not v_encerrando;
  v_reativou := v_ativo_depois and (old.status is distinct from 'active' or old.deleted_at is not null or old.exit_date is not null);

  if v_area_mudou or v_encerrando then
    update erp.ocupacoes_de_area o
       set data_fim = greatest(o.data_inicio, current_date),
           motivo_saida = case when v_area_mudou then 'transferencia'
                               when v_excluido then 'correcao'
                               else 'encerramento_do_lote' end
     where o.organization_id = new.organization_id
       and o.batch_id = new.id
       and o.data_fim is null
       and o.deleted_at is null;
  end if;

  if new.area_id is not null and v_ativo_depois and (v_area_mudou or v_reativou) then
    select a.empresa_id into v_empresa_da_area
      from erp.areas a where a.id = new.area_id and a.organization_id = new.organization_id;
    if v_empresa_da_area is null then
      raise exception 'VALIDATION_ERROR: Área indisponível para o lote.' using errcode = 'P0001';
    end if;
    insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, origem_da_data)
    values (new.organization_id, v_empresa_da_area, new.area_id, new.id, current_date, 'movimento');
  end if;
  return null;
end $$;

comment on function erp.batches_fechar_ocupacao() is
  'MAPA-MANEJO-01 (decisão 305): mantém erp.ocupacoes_de_area a partir de erp.batches — fecha a aberta quando a área muda ou o lote encerra/é excluído; abre a nova quando a área muda para não nula com o lote ativo (ou o lote é reativado ou criado com área). Só curral ou módulo não mexe na ocupação.';

-- ---------- 7) backfill da ocupação: UMA aberta por lote ativo com área (SÓ INSERT na tabela nova) ----------
-- Lote ativo = status 'active', deleted_at nulo e exit_date nula (a definição única da seção 6).
-- data_inicio, nesta ordem: o movement_date do module_area_transfer MAIS RECENTE (não cancelado, não excluído)
-- deste lote para a área atual → 'movimento'; senão entry_date → 'entrada_do_lote'; senão a data de
-- created_at → 'criacao_do_lote'. cabecas_na_entrada e ua_na_entrada ficam NULAS: não se inventa retroativo.
-- Vem ANTES do gatilho (seção 8): o gatilho não existe enquanto o backfill grava.
insert into erp.ocupacoes_de_area (organization_id, empresa_id, area_id, batch_id, data_inicio, origem_da_data, movimento_entrada_id)
select b.organization_id,
       a.empresa_id,
       b.area_id,
       b.id,
       coalesce(m.movement_date, b.entry_date, b.created_at::date),
       case when m.id is not null then 'movimento'
            when b.entry_date is not null then 'entrada_do_lote'
            else 'criacao_do_lote' end,
       m.id
  from erp.batches b
  join erp.areas a on a.id = b.area_id and a.organization_id = b.organization_id
  left join lateral (
    select am.id, am.movement_date
      from erp.animal_movements am
     where am.organization_id = b.organization_id
       and am.batch_id = b.id
       and am.movement_type = 'module_area_transfer'
       and am.destination_area_id = b.area_id
       and am.deleted_at is null
       and am.status <> 'cancelled'
     order by am.movement_date desc, am.created_at desc, am.id desc
     limit 1
  ) m on true
 where b.area_id is not null
   and b.deleted_at is null
   and b.status = 'active'
   and b.exit_date is null;

-- ---------- 8) o gatilho de erp.batches (depois do backfill) ----------
create trigger trg_batches_fechar_ocupacao
  after insert or update of area_id, status, exit_date, deleted_at on erp.batches
  for each row execute function erp.batches_fechar_ocupacao();

-- O backfill acima não gera linha de auditoria (o registro é a própria migration); daqui em diante, toda
-- escrita na ocupação é auditada.
create trigger trg_ocupacoes_de_area_audit after insert or update or delete on erp.ocupacoes_de_area
  for each row execute function erp.audit_row();

-- =====================================================================
-- CAMADA 2 — manejo e pesagem passam a saber o piquete
-- =====================================================================

-- ---------- 9) colunas NOVAS (nulas), FK composta e índice de leitura ----------
alter table erp.animal_handlings add column area_id uuid;
alter table erp.weighings add column area_id uuid;

alter table erp.animal_handlings
  add constraint fk_animal_handlings_area foreign key (organization_id, empresa_id, area_id)
  references erp.areas (organization_id, empresa_id, id);
alter table erp.weighings
  add constraint fk_weighings_area foreign key (organization_id, empresa_id, area_id)
  references erp.areas (organization_id, empresa_id, id);

create index ix_animal_handlings_area_data on erp.animal_handlings (organization_id, empresa_id, area_id, handling_date desc)
  where area_id is not null;
create index ix_weighings_area_data on erp.weighings (organization_id, empresa_id, area_id, weighing_date desc)
  where area_id is not null;

comment on column erp.animal_handlings.area_id is
  'MAPA-MANEJO-01: área (piquete) que recebeu o manejo — a da ocupação do lote NA DATA do manejo (gatilho), não a posição atual do lote. Nula quando não havia ocupação naquela data: não se chuta.';
comment on column erp.weighings.area_id is
  'MAPA-MANEJO-01: área (piquete) da pesagem — a da ocupação do lote NA DATA da pesagem (gatilho). Nula quando não havia ocupação naquela data.';

-- ---------- 10) gatilho BEFORE INSERT: a área da ocupação do lote NA DATA do documento ----------
-- A coluna de data vem do argumento do gatilho (handling_date / weighing_date). A ocupação escolhida é a do
-- MESMO lote e da MESMA empresa do documento (a FK composta exige área da mesma empresa) cujo período
-- [data_inicio, data_fim] contém a data; no dia da troca (fim de uma = início da outra) vence a que começou
-- por último. Sem ocupação na data → NULL. SECURITY DEFINER com filtro explícito de organização e empresa.
create function erp.area_da_ocupacao_na_data() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_data date;
begin
  if new.area_id is not null or new.batch_id is null then
    return new;
  end if;
  v_data := (to_jsonb(new) ->> tg_argv[0])::date;
  if v_data is null then
    return new;
  end if;
  select o.area_id into new.area_id
    from erp.ocupacoes_de_area o
   where o.organization_id = new.organization_id
     and o.empresa_id = new.empresa_id
     and o.batch_id = new.batch_id
     and o.deleted_at is null
     and o.data_inicio <= v_data
     and (o.data_fim is null or o.data_fim >= v_data)
   order by o.data_inicio desc, o.created_at desc, o.id desc
   limit 1;
  return new;
end $$;

comment on function erp.area_da_ocupacao_na_data() is
  'MAPA-MANEJO-01: preenche area_id do manejo/pesagem com a área da ocupação do lote NA DATA do documento (argumento = coluna da data). Sem ocupação naquela data, fica NULL.';

create trigger trg_animal_handlings_area_da_ocupacao before insert on erp.animal_handlings
  for each row execute function erp.area_da_ocupacao_na_data('handling_date');
create trigger trg_weighings_area_da_ocupacao before insert on erp.weighings
  for each row execute function erp.area_da_ocupacao_na_data('weighing_date');

-- ---------- 11) backfill da camada 2 — o ÚNICO UPDATE em tabela existente desta fatia ----------
-- Escreve SÓ na coluna NOVA (nasceu nula nesta transação), SÓ em linha viva com lote, e SÓ onde existe
-- ocupação que contém a data — pelo MESMO critério do gatilho. Nenhuma outra coluna muda. As contagens saem
-- no NOTICE (preenchidas × nulas).
with alvo as (
  select h.id,
         (select o.area_id
            from erp.ocupacoes_de_area o
           where o.organization_id = h.organization_id and o.empresa_id = h.empresa_id and o.batch_id = h.batch_id
             and o.deleted_at is null and o.data_inicio <= h.handling_date
             and (o.data_fim is null or o.data_fim >= h.handling_date)
           order by o.data_inicio desc, o.created_at desc, o.id desc
           limit 1) as area_id
    from erp.animal_handlings h
   where h.area_id is null and h.batch_id is not null and h.deleted_at is null
)
update erp.animal_handlings h
   set area_id = alvo.area_id
  from alvo
 where alvo.id = h.id and alvo.area_id is not null;

with alvo as (
  select w.id,
         (select o.area_id
            from erp.ocupacoes_de_area o
           where o.organization_id = w.organization_id and o.empresa_id = w.empresa_id and o.batch_id = w.batch_id
             and o.deleted_at is null and o.data_inicio <= w.weighing_date
             and (o.data_fim is null or o.data_fim >= w.weighing_date)
           order by o.data_inicio desc, o.created_at desc, o.id desc
           limit 1) as area_id
    from erp.weighings w
   where w.area_id is null and w.batch_id is not null and w.deleted_at is null
)
update erp.weighings w
   set area_id = alvo.area_id
  from alvo
 where alvo.id = w.id and alvo.area_id is not null;

do $$
declare
  v_mp int; v_mn int; v_pp int; v_pn int;
  v_ab int; v_mov int; v_ent int; v_cri int;
begin
  select count(*) filter (where area_id is not null), count(*) filter (where area_id is null) into v_mp, v_mn
    from erp.animal_handlings where deleted_at is null;
  select count(*) filter (where area_id is not null), count(*) filter (where area_id is null) into v_pp, v_pn
    from erp.weighings where deleted_at is null;
  select count(*), count(*) filter (where origem_da_data = 'movimento'),
         count(*) filter (where origem_da_data = 'entrada_do_lote'), count(*) filter (where origem_da_data = 'criacao_do_lote')
    into v_ab, v_mov, v_ent, v_cri
    from erp.ocupacoes_de_area;
  raise notice 'MAPA-MANEJO-01: backfill — ocupacoes abertas=% (movimento=%, entrada_do_lote=%, criacao_do_lote=%); animal_handlings com area=%, sem area=%; weighings com area=%, sem area=%.',
    v_ab, v_mov, v_ent, v_cri, v_mp, v_mn, v_pp, v_pn;
end $$;

-- =====================================================================
-- CAMADA 5 — dívidas do banco no caminho
-- =====================================================================

-- ---------- 12) 5.1 — o unique de código por empresa em erp.areas ----------
-- Num banco migrado do zero ele EXISTE: areas_empresa_id_code_key (empresa_id, code), recriado pela 0014
-- (0014:451-476 passa toda chave UNIQUE da coluna legada para empresa_id) antes de a 0017 apagar a legada. Aqui só
-- se CONFERE. Se faltar (produção divergente), conta as duplicatas: sem duplicata cria o índice; com
-- duplicata NÃO cria, avisa os códigos e segue — a decisão é do Maike, não desta migration.
do $$
declare
  v_dup text;
begin
  if exists (
    select 1 from pg_index i
     where i.indrelid = 'erp.areas'::regclass and i.indisunique and i.indpred is null
       and (select array_agg(a.attname::text order by a.attname::text)
              from unnest(i.indkey::int2[]) k join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k)
           = array['code', 'empresa_id']
  ) then
    raise notice 'MAPA-MANEJO-01 (5.1): erp.areas ja tem unique (empresa_id, code); nada a criar.';
  else
    select string_agg(format('empresa %s codigo %s (%s linhas)', d.empresa_id, d.code, d.n), '; ' order by d.empresa_id, d.code)
      into v_dup
      from (select empresa_id, code, count(*) as n from erp.areas group by empresa_id, code having count(*) > 1) d;
    if v_dup is null then
      create unique index uq_areas_empresa_codigo on erp.areas (empresa_id, code);
      raise notice 'MAPA-MANEJO-01 (5.1): unique (empresa_id, code) ausente em erp.areas e sem duplicatas; uq_areas_empresa_codigo criado.';
    else
      raise warning 'MAPA-MANEJO-01 (5.1): erp.areas SEM unique (empresa_id, code) e COM duplicatas; o indice NAO foi criado. Duplicados: %', v_dup;
    end if;
  end if;
end $$;

-- ---------- 13) 5.3 — erp.areas sem DELETE para o erp_app ----------
-- Herdado da 0007 (grant em todas as tabelas + default privileges). A exclusão da área é lógica
-- (registries: softDelete), como retiros (0050) e mapa_areas (0049), que já revogam.
revoke delete, truncate on erp.areas from erp_app;

-- ---------- 14) execute só do dono nas funções novas ----------
-- A 0007 dá execute a erp_app por default privilege e toda função nasce executável por PUBLIC. Nenhuma
-- destas é porta da API: o validador roda dentro dos gatilhos (como o dono) e gatilho não precisa de
-- execute de quem grava.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('objeto_de_mapa_geometria_valida', 'ocupacoes_de_area_conferir', 'objetos_de_mapa_geometria_conferir',
                         'objetos_de_mapa_cocho_conferir', 'batches_fechar_ocupacao', 'area_da_ocupacao_na_data')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 15) pós-condições NOMEADAS POR OBJETO ----------
do $$
declare
  v_tabela text;
  v_ref record;
  v_fn text;
  v_ids text;
begin
  select qual, with_check, roles into v_ref
    from pg_policies where schemaname = 'erp' and tablename = 'areas' and policyname = 'tenant_e_empresa';

  foreach v_tabela in array array['ocupacoes_de_area', 'objetos_de_mapa'] loop
    if to_regclass('erp.' || v_tabela) is null then
      raise exception 'MAPA-MANEJO-01: pos-condicao — a tabela erp.% nao foi criada.', v_tabela;
    end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'erp' and c.relname = v_tabela and not (c.relrowsecurity and c.relforcerowsecurity)) then
      raise exception 'MAPA-MANEJO-01: pos-condicao — erp.% sem RLS habilitada e forcada.', v_tabela;
    end if;
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'erp' and p.tablename = v_tabela and p.policyname = 'tenant_e_empresa'
                      and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                      and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
      raise exception 'MAPA-MANEJO-01: pos-condicao — politica tenant_e_empresa de erp.% diverge da de erp.areas.', v_tabela;
    end if;
    if has_table_privilege('erp_app', 'erp.' || v_tabela, 'DELETE') or has_table_privilege('erp_app', 'erp.' || v_tabela, 'TRUNCATE')
       or not has_table_privilege('erp_app', 'erp.' || v_tabela, 'SELECT, INSERT, UPDATE') then
      raise exception 'MAPA-MANEJO-01: pos-condicao — privilegios de erp_app em erp.% fora de select/insert/update.', v_tabela;
    end if;
  end loop;

  if (select count(*) from pg_constraint
       where conrelid = 'erp.ocupacoes_de_area'::regclass
         and conname in ('fk_ocupacoes_empresa', 'fk_ocupacoes_area', 'fk_ocupacoes_lote', 'fk_ocupacoes_movimento_entrada',
                         'fk_ocupacoes_movimento_saida', 'chk_ocupacoes_periodo', 'chk_ocupacoes_cabecas', 'chk_ocupacoes_ua',
                         'chk_ocupacoes_origem_da_data', 'chk_ocupacoes_motivo_saida')
         and convalidated) <> 10 then
    raise exception 'MAPA-MANEJO-01: pos-condicao — restricoes nomeadas de erp.ocupacoes_de_area incompletas.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_ocupacoes_area' and conrelid = 'erp.ocupacoes_de_area'::regclass
                    and pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id, empresa_id, area_id) REFERENCES erp.areas(organization_id, empresa_id, id)')
     or not exists (select 1 from pg_constraint where conname = 'fk_ocupacoes_lote' and conrelid = 'erp.ocupacoes_de_area'::regclass
                    and pg_get_constraintdef(oid) = 'FOREIGN KEY (batch_id, organization_id) REFERENCES erp.batches(id, organization_id)') then
    raise exception 'MAPA-MANEJO-01: pos-condicao — FK composta da area ou do lote fora da forma.';
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where c.relname = 'uq_ocupacao_aberta_por_lote' and i.indrelid = 'erp.ocupacoes_de_area'::regclass and i.indisunique
                    and pg_get_expr(i.indpred, i.indrelid) = '((data_fim IS NULL) AND (deleted_at IS NULL))') then
    raise exception 'MAPA-MANEJO-01: pos-condicao — uq_ocupacao_aberta_por_lote ausente ou fora da forma.';
  end if;
  if to_regclass('erp.ix_ocupacoes_area_inicio') is null or to_regclass('erp.ix_ocupacoes_lote_inicio') is null then
    raise exception 'MAPA-MANEJO-01: pos-condicao — indices de leitura de erp.ocupacoes_de_area ausentes.';
  end if;

  if (select count(*) from pg_constraint
       where conrelid = 'erp.objetos_de_mapa'::regclass
         and conname in ('fk_objetos_empresa', 'fk_objetos_area', 'chk_objetos_tipo', 'chk_objetos_forma', 'chk_objetos_forma_bate_com_tipo',
                         'chk_objetos_capacidade', 'chk_objetos_unidade', 'chk_objetos_cocho_so_para_cocho', 'chk_objetos_nome')
         and convalidated) <> 9 then
    raise exception 'MAPA-MANEJO-01: pos-condicao — restricoes nomeadas de erp.objetos_de_mapa incompletas.';
  end if;
  if to_regclass('erp.uq_objetos_de_mapa_codigo') is null or to_regclass('erp.ix_objetos_de_mapa_area') is null then
    raise exception 'MAPA-MANEJO-01: pos-condicao — indices de erp.objetos_de_mapa ausentes.';
  end if;

  foreach v_fn in array array['erp.objeto_de_mapa_geometria_valida(jsonb,text)', 'erp.ocupacoes_de_area_conferir()',
                               'erp.objetos_de_mapa_geometria_conferir()', 'erp.objetos_de_mapa_cocho_conferir()',
                               'erp.batches_fechar_ocupacao()', 'erp.area_da_ocupacao_na_data()'] loop
    if not exists (select 1 from pg_proc p where p.oid = to_regprocedure(v_fn) and p.prosecdef
                      and p.proconfig = array['search_path=erp, pg_temp']) then
      raise exception 'MAPA-MANEJO-01: pos-condicao — % sem SECURITY DEFINER e search_path fixo.', v_fn;
    end if;
    if has_function_privilege('erp_app', v_fn, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = to_regprocedure(v_fn) and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
      raise exception 'MAPA-MANEJO-01: pos-condicao — % ainda executavel por PUBLIC ou erp_app.', v_fn;
    end if;
  end loop;
  if erp.objeto_de_mapa_geometria_valida('{"type":"Point","coordinates":[-56.1,-15.6]}', 'ponto') is not true
     or erp.objeto_de_mapa_geometria_valida('{"type":"Polygon","coordinates":[[[-56.1,-15.6],[-56.1,-15.59],[-56.09,-15.59],[-56.1,-15.6]]]}', 'ponto') is not false then
    raise exception 'MAPA-MANEJO-01: pos-condicao — o validador nao aceita Point ou nao recusa Polygon.';
  end if;

  if (select count(*) from pg_trigger t
       where not t.tgisinternal and (t.tgrelid, t.tgname) in (
         ('erp.batches'::regclass, 'trg_batches_fechar_ocupacao'),
         ('erp.ocupacoes_de_area'::regclass, 'trg_ocupacoes_de_area_conferir'),
         ('erp.ocupacoes_de_area'::regclass, 'trg_ocupacoes_de_area_updated'),
         ('erp.ocupacoes_de_area'::regclass, 'trg_ocupacoes_de_area_audit'),
         ('erp.objetos_de_mapa'::regclass, 'trg_objetos_de_mapa_geometria_conferir'),
         ('erp.objetos_de_mapa'::regclass, 'trg_objetos_de_mapa_cocho_conferir'),
         ('erp.objetos_de_mapa'::regclass, 'trg_objetos_de_mapa_updated'),
         ('erp.objetos_de_mapa'::regclass, 'trg_objetos_de_mapa_audit'),
         ('erp.animal_handlings'::regclass, 'trg_animal_handlings_area_da_ocupacao'),
         ('erp.weighings'::regclass, 'trg_weighings_area_da_ocupacao'))) <> 10 then
    raise exception 'MAPA-MANEJO-01: pos-condicao — gatilhos nomeados incompletos.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_batches_fechar_ocupacao' and tgrelid = 'erp.batches'::regclass
                    and tgfoid = 'erp.batches_fechar_ocupacao()'::regprocedure
                    and pg_get_triggerdef(oid) like '%AFTER INSERT OR UPDATE OF area_id, status, exit_date, deleted_at ON erp.batches FOR EACH ROW%') then
    raise exception 'MAPA-MANEJO-01: pos-condicao — trg_batches_fechar_ocupacao fora da forma (AFTER INSERT OR UPDATE OF area_id, status, exit_date, deleted_at).';
  end if;

  if (select count(*) from pg_constraint
       where conname in ('fk_animal_handlings_area', 'fk_weighings_area') and contype = 'f' and convalidated
         and pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id, empresa_id, area_id) REFERENCES erp.areas(organization_id, empresa_id, id)') <> 2 then
    raise exception 'MAPA-MANEJO-01: pos-condicao — FK composta de area em animal_handlings/weighings ausente.';
  end if;
  if to_regclass('erp.ix_animal_handlings_area_data') is null or to_regclass('erp.ix_weighings_area_data') is null then
    raise exception 'MAPA-MANEJO-01: pos-condicao — indices de area em animal_handlings/weighings ausentes.';
  end if;

  if has_table_privilege('erp_app', 'erp.areas', 'DELETE') then
    raise exception 'MAPA-MANEJO-01: pos-condicao (5.3) — erp_app ainda pode apagar erp.areas.';
  end if;

  -- O backfill: todo lote elegível tem EXATAMENTE uma ocupação aberta, na área atual dele; nenhuma aberta sobra
  -- para lote não elegível ou em outra área.
  select string_agg(b.id::text, ', ' order by b.id) into v_ids
    from erp.batches b
   where b.area_id is not null and b.deleted_at is null and b.status = 'active' and b.exit_date is null
     and (select count(*) from erp.ocupacoes_de_area o
           where o.organization_id = b.organization_id and o.batch_id = b.id and o.area_id = b.area_id
             and o.data_fim is null and o.deleted_at is null) <> 1;
  if v_ids is not null then
    raise exception 'MAPA-MANEJO-01: pos-condicao do backfill — lote elegivel sem exatamente uma ocupacao aberta na area atual: %', v_ids;
  end if;
  select string_agg(o.id::text, ', ' order by o.id) into v_ids
    from erp.ocupacoes_de_area o
    join erp.batches b on b.id = o.batch_id and b.organization_id = o.organization_id
   where o.data_fim is null and o.deleted_at is null
     and not (b.area_id is not distinct from o.area_id and b.deleted_at is null and b.status = 'active' and b.exit_date is null);
  if v_ids is not null then
    raise exception 'MAPA-MANEJO-01: pos-condicao do backfill — ocupacao aberta para lote nao elegivel ou fora da area atual: %', v_ids;
  end if;
end $$;
