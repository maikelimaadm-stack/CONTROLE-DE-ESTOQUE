-- =====================================================================
-- 0049 MAPA-01 — MAPA DE MANEJO: CADASTRO DE ÁREAS (neutro) — decisão 289
--
-- O QUE ESTA MIGRATION FAZ, e é uma coisa só: cria o módulo NEUTRO "mapa" (Mapa de Manejo) e a tabela
-- erp.mapa_areas, a área desenhada no mapa. Neutro de propósito: a área serve LAVOURA e PECUÁRIA, então
-- esta fatia NÃO fala de gado, lote, forragem nem UA. Os únicos campos de negócio são o nome, o tamanho em
-- hectares e a cor; a geometria (o polígono) é um GeoJSON em jsonb, validado no banco.
--
-- POR QUE UM MÓDULO NOVO. O escopo por empresa (PRE-BASE2-02/03) é configurado POR MÓDULO. A área é de uma
-- empresa, logo precisa de um módulo canônico para o RLS empresarial recortar. Nenhum módulo existente serve
-- sem colar o nicho (pecuaria/confinamento falam de gado). O módulo "mapa" entra na ordem 12, ao lado dos
-- outros em erp.modulos_escopo_empresa, e ESPELHA @agro/domain MODULOS_ESCOPO_EMPRESA (o gate de consistência
-- em apps/api/test/unit e scripts/company-schema-sync.mjs cobram a paridade).
--
-- FAIL-CLOSED (CLAUDE.md "Dados"/"Segurança"; docs/MULTI-COMPANY-CONTRACT.md). Módulo novo nasce SEM escopo
-- configurado para ninguém: o proprietário (is_owner) enxerga todas as empresas por regra de destino, e os
-- demais membros NÃO veem nenhuma área até um administrador configurar o escopo de "mapa" para eles. Esta
-- migration NÃO faz backfill de escopo (não copia o escopo de outro módulo nem concede "todas"): copiar
-- ampliaria autorização em silêncio, e isso o contrato proíbe. Módulo sem configuração = NENHUMA empresa.
--
-- PRODUÇÃO (docs/DECISIONS.md 240/247). A tabela nasce vazia; esta migration não preenche nem corrige dado.
-- Nada é apagado. A área exclui-se por soft delete (deleted_at); DELETE/TRUNCATE são revogados do erp_app.
--
-- RLS. Categoria A da 0015 (empresa obrigatória): o MESMO gabarito inline (InitPlan + hashed SubPlan) de
-- erp.documentos_estoque (0040). tenant ∧ escopo de empresa, combinados com AND; o módulo da transação vem
-- de app.modulo_empresa (runService), lido por erp.modulo_empresa_atual().
--
-- GEOMETRIA. GeoJSON Polygon canônico em jsonb: { "type": "Polygon", "coordinates": [ anel, ... ] }, cada
-- anel com ≥ 4 posições [lon, lat] (a primeira igual à última) e lon∈[-180,180], lat∈[-90,90]. Sem PostGIS
-- (o CI usa postgres:16 puro): a invariante mora num gatilho em plpgsql, e entrada não canônica é RECUSADA
-- (VALIDATION_ERROR → 422), nunca corrigida em silêncio. A ÁREA em hectares é calculada no cliente
-- (google.maps.geometry) e pode ser ajustada à mão; o banco só exige tamanho_ha ≥ 0.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 83) then
    raise exception 'MAPA-01: outra transacao ja detem a trava desta migration (2026,83). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight (fail-closed: para antes de tocar em qualquer coisa) ----------
do $$
begin
  -- "Já aplicada" ANTES das dependências: na reaplicação, o motivo verdadeiro é este.
  if to_regclass('erp.mapa_areas') is not null then
    raise exception 'MAPA-01: erp.mapa_areas ja existe; a 0049 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.mapa_areas_conferir()') is not null then
    raise exception 'MAPA-01: funcao erp.mapa_areas_conferir() ja existe; a 0049 ja foi aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from erp.modulos_escopo_empresa where chave = 'mapa') then
    raise exception 'MAPA-01: modulo de escopo empresarial mapa ja existe; a 0049 ja foi aplicada ou ha schema divergente.';
  end if;
  -- O papel da aplicação é o destinatário dos privilégios.
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'MAPA-01: papel erp_app ausente (0007); os privilegios da tabela nova nao teriam destinatario.';
  end if;
  -- As funções de RLS/auditoria das migrations anteriores (0001/0007/0011/0015).
  if to_regprocedure('erp.tenant_visible(uuid)') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'MAPA-01: funcoes de RLS empresarial (0011/0015) ausentes; a cadeia de migrations esta fora de ordem.';
  end if;
  -- A FK de empresa é composta (organização, empresa): coluna única não prova tenant. O alvo é a chave
  -- (organization_id, id) de erp.empresas.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'erp.empresas'::regclass and c.contype in ('p', 'u')
       and (select array_agg(a.attname::text order by a.attnum)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           @> array['organization_id', 'id']
  ) then
    raise exception 'MAPA-01: erp.empresas sem chave (organization_id, id) para a FK composta (0014).';
  end if;
end $$;

-- ---------- 3) validação da geometria (GeoJSON Polygon), sem PostGIS ----------
-- Função pura (não lê tabela): é a invariante do polígono, chamada pelo gatilho de conferência. Imutável
-- para o planejador; sem SQL dinâmico.
create or replace function erp.mapa_area_geometria_valida(p jsonb) returns boolean
language plpgsql immutable as $$
declare
  aneis jsonb;
  anel jsonb;
  pos jsonb;
  n int;
begin
  if p is null then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' or coalesce(p->>'type', '') <> 'Polygon' then
    return false;
  end if;
  aneis := p->'coordinates';
  if aneis is null or jsonb_typeof(aneis) <> 'array' or jsonb_array_length(aneis) < 1 then
    return false;
  end if;
  for anel in select value from jsonb_array_elements(aneis) loop
    if jsonb_typeof(anel) <> 'array' then
      return false;
    end if;
    n := jsonb_array_length(anel);
    if n < 4 then
      return false;
    end if;
    -- anel fechado: primeira posição igual à última.
    if (anel->0) is distinct from (anel->(n - 1)) then
      return false;
    end if;
    for pos in select value from jsonb_array_elements(anel) loop
      if jsonb_typeof(pos) <> 'array' or jsonb_array_length(pos) <> 2
         or jsonb_typeof(pos->0) <> 'number' or jsonb_typeof(pos->1) <> 'number'
         or (pos->>0)::numeric < -180 or (pos->>0)::numeric > 180
         or (pos->>1)::numeric < -90  or (pos->>1)::numeric > 90 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

comment on function erp.mapa_area_geometria_valida(jsonb) is 'Valida um GeoJSON Polygon canônico (type Polygon; aneis com >=4 posicoes [lon,lat] fechadas; lon/lat na faixa). Pura e imutavel; usada pelo gatilho de conferencia de erp.mapa_areas.';

-- ---------- 4) tabela ----------
create table erp.mapa_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  nome text not null constraint chk_mapa_areas_nome check (btrim(nome) <> '' and nome = btrim(nome)),
  tamanho_ha numeric(14,4) not null default 0 constraint chk_mapa_areas_tamanho check (tamanho_ha >= 0),
  cor text constraint chk_mapa_areas_cor check (cor is null or cor ~ '^#[0-9A-Fa-f]{6}$'),
  geometria jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fk_mapa_areas_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id)
);

create index ix_mapa_areas_empresa on erp.mapa_areas (organization_id, empresa_id) where deleted_at is null;

comment on table erp.mapa_areas is 'Área do Mapa de Manejo (MAPA-01, decisão 289): polígono neutro (serve lavoura e pecuária). Módulo de escopo empresarial "mapa". Soft delete por deleted_at; o saldo/estoque não é tocado aqui.';
comment on column erp.mapa_areas.id is 'Identidade técnica (UUID).';
comment on column erp.mapa_areas.organization_id is 'Tenant (organização).';
comment on column erp.mapa_areas.empresa_id is 'Empresa da área (FK composta com a organização). Escopo de empresa do módulo mapa.';
comment on column erp.mapa_areas.nome is 'Nome da área (sem espaço nas pontas, não vazio).';
comment on column erp.mapa_areas.tamanho_ha is 'Tamanho em hectares (>= 0). Calculado no cliente pelo polígono (google.maps.geometry) e ajustável à mão.';
comment on column erp.mapa_areas.cor is 'Cor de exibição no mapa, no formato #RRGGBB (ou nula).';
comment on column erp.mapa_areas.geometria is 'Polígono da área como GeoJSON Polygon canônico ({type:"Polygon", coordinates:[anel...]}); validado por gatilho. Nula enquanto a área não foi desenhada.';
comment on column erp.mapa_areas.deleted_at is 'Soft delete: preenchido quando a área é excluída; fora de escopo e excluída respondem a mesma 404 na API.';
comment on column erp.mapa_areas.created_at is 'Criação do registro.';
comment on column erp.mapa_areas.atualizado_em is 'Última alteração (gatilho).';

-- ---------- 5) gatilho de conferência ----------
-- Valida a geometria, carimba atualizado_em e protege organização/empresa/criação contra alteração. Não lê
-- tabela nenhuma (só NEW/OLD): plpgsql comum, sem SECURITY DEFINER.
create function erp.mapa_areas_conferir() returns trigger
language plpgsql as $$
begin
  if new.geometria is not null and not erp.mapa_area_geometria_valida(new.geometria) then
    raise exception 'VALIDATION_ERROR: Geometria da área inválida (esperado GeoJSON Polygon com anéis fechados de ao menos 4 posições [lon,lat]).' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.empresa_id is distinct from old.empresa_id
       or new.created_at is distinct from old.created_at then
      raise exception 'VALIDATION_ERROR: Organização, empresa e data de criação da área não mudam.' using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  return new;
end $$;

comment on function erp.mapa_areas_conferir() is 'Conferência de erp.mapa_areas: geometria canônica, imutabilidade de organização/empresa/criação, carimbo de atualizado_em.';

create trigger trg_mapa_areas_conferir
  before insert or update on erp.mapa_areas
  for each row execute function erp.mapa_areas_conferir();

-- ---------- 6) RLS e privilégios (categoria A da 0015; gabarito inline de 0040) ----------
alter table erp.mapa_areas enable row level security;
alter table erp.mapa_areas force row level security;
create policy tenant_e_empresa on erp.mapa_areas for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

grant select, insert, update on erp.mapa_areas to erp_app;
revoke delete, truncate on erp.mapa_areas from erp_app;

-- ---------- 7) módulo de escopo empresarial ----------
insert into erp.modulos_escopo_empresa (chave, nome, ordem) values ('mapa', 'Mapa de Manejo', 12);

-- ---------- 8) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
begin
  if to_regclass('erp.mapa_areas') is null then
    raise exception 'MAPA-01: a tabela erp.mapa_areas nao foi criada.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname = 'mapa_areas'
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'MAPA-01: erp.mapa_areas sem RLS habilitada e forcada.';
  end if;
  if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'mapa_areas')
     is distinct from array['tenant_e_empresa'] then
    raise exception 'MAPA-01: politica de erp.mapa_areas diferente de tenant_e_empresa.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_mapa_areas_empresa' and contype = 'f'
                   and confdeltype = 'a' and confupdtype = 'a' and array_length(conkey, 1) = 2) then
    raise exception 'MAPA-01: FK composta de empresa (sem cascata) ausente.';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.mapa_areas'::regclass and conname like 'chk_mapa_areas_%') <> 3 then
    raise exception 'MAPA-01: CHECKs de erp.mapa_areas incompletos (esperados 3: nome, tamanho, cor).';
  end if;
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal and t.tgrelid = 'erp.mapa_areas'::regclass
                    and t.tgname = 'trg_mapa_areas_conferir') then
    raise exception 'MAPA-01: gatilho de conferencia de erp.mapa_areas ausente.';
  end if;
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'mapa' and ordem = 12) then
    raise exception 'MAPA-01: modulo mapa (ordem 12) nao registrado.';
  end if;
end $$;
