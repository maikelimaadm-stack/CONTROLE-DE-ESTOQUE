-- =====================================================================
-- 0059 — SAT-COND-01 (decisão 302): mapa categórico integrado da condição do pasto.
--
-- Tabela DEDICADA (não reusa erp.satelite_rasters.analise_id): a classificação
-- combina seis índices da MESMA observação; apontar para uma análise NDVI
-- mentiria sobre a origem. Nenhuma tabela existente é alterada. Sem DELETE.
-- Forward-only. Trava (2026,93). lock_timeout 2s.
--
--   erp.satelite_mapas_condicao_arquivos  PNG UINT8 0..6 (nodata=0)
--   erp.satelite_mapas_condicao           metadado + resumo por classe (jsonb)
--
-- Identidade: organização, área, geometria_sha256, data_imagem,
-- versao_classificador, versao_evalscript, resolucao_m.
-- RLS = tenant_e_empresa da pecuária (cópia da 0052/0055). Imutável.
-- Efeito novo DESLIGADO até o deploy da API desta fatia.
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 93) then
    raise exception 'SAT-COND-01: outra transacao ja detem a trava desta migration (2026,93). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

do $$
begin
  if to_regclass('erp.satelite_mapas_condicao') is not null
     or to_regclass('erp.satelite_mapas_condicao_arquivos') is not null
     or to_regprocedure('erp.satelite_mapa_condicao_imutavel()') is not null then
    raise exception 'SAT-COND-01: a 0059 ja foi aplicada ou ha schema divergente (satelite_mapas_condicao ja existe).';
  end if;
  if to_regclass('erp.satelite_rasters') is null or to_regclass('erp.areas') is null then
    raise exception 'SAT-COND-01: erp.satelite_rasters/areas ausentes; aplique 0050–0058 antes.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_rasters_indice'
       and conrelid = 'erp.satelite_rasters'::regclass
       and pg_get_constraintdef(oid) like '%evi2%'
  ) then
    raise exception 'SAT-COND-01: a 0058 nao esta aplicada (chk_satelite_rasters_indice sem evi2).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-COND-01: papel erp_app ausente (0007).';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'SAT-COND-01: funcoes de RLS/auditoria ausentes; cadeia fora de ordem.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa') then
    raise exception 'SAT-COND-01: politica tenant_e_empresa de erp.analises_satelitais ausente (0052).';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'SAT-COND-01: modulo pecuaria ausente.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'SAT-COND-01: funcao sha256(bytea) ausente.';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'areas_org_empresa_key' and contype = 'u' and conrelid = 'erp.areas'::regclass
  ) then
    raise exception 'SAT-COND-01: chave unica areas_org_empresa_key ausente em erp.areas (0052).';
  end if;
end $$;

create table erp.satelite_mapas_condicao_arquivos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  storage_path text not null,
  conteudo bytea not null,
  sha256_arquivo text not null,
  tamanho_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint fk_satelite_mapas_condicao_arquivos_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint satelite_mapas_condicao_arquivos_org_empresa_caminho_key unique (organization_id, empresa_id, storage_path),
  constraint satelite_mapas_condicao_arquivos_org_empresa_caminho_sha_key unique (organization_id, empresa_id, storage_path, sha256_arquivo),
  constraint uq_satelite_mapas_condicao_arquivos_caminho unique (organization_id, storage_path),
  constraint chk_satelite_mapas_condicao_arquivos_storage_path check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/condicao_pasto/[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/[0-9a-f]{64}[.]png$'
    and split_part(storage_path, '/', 1) = organization_id::text
  ),
  constraint chk_satelite_mapas_condicao_arquivos_tamanho check (octet_length(conteudo) >= 1 and octet_length(conteudo) <= 16777216),
  constraint chk_satelite_mapas_condicao_arquivos_sha256 check (sha256_arquivo = encode(sha256(conteudo), 'hex')),
  constraint chk_satelite_mapas_condicao_arquivos_tamanho_bytes check (tamanho_bytes = octet_length(conteudo))
);

comment on table erp.satelite_mapas_condicao_arquivos is
  'ARQUIVO IMUTÁVEL do mapa categórico da condição do pasto (SAT-COND-01): PNG UINT8 0..6. Sem auditoria por linha (o binário iria ao log). Escopo pecuária.';

create table erp.satelite_mapas_condicao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  geometria_sha256 text not null
    constraint chk_satelite_mapas_condicao_geometria_sha256 check (geometria_sha256 ~ '^[0-9a-f]{64}$'),
  mapa text not null
    constraint chk_satelite_mapas_condicao_mapa check (mapa = 'condicao_pasto'),
  tipo text not null
    constraint chk_satelite_mapas_condicao_tipo check (tipo = 'classificacao'),
  versao_classificador text not null,
  versao_evalscript text not null,
  data_imagem date not null,
  observacao_inicio timestamptz not null,
  observacao_fim timestamptz not null,
  storage_path text not null,
  sha256_arquivo text not null
    constraint chk_satelite_mapas_condicao_sha256_arquivo check (sha256_arquivo ~ '^[0-9a-f]{64}$'),
  largura integer not null
    constraint chk_satelite_mapas_condicao_largura check (largura >= 1 and largura <= 2500),
  altura integer not null
    constraint chk_satelite_mapas_condicao_altura check (altura >= 1 and altura <= 2500),
  bbox_min_x numeric not null,
  bbox_min_y numeric not null,
  bbox_max_x numeric not null,
  bbox_max_y numeric not null,
  cantos_lnglat jsonb not null,
  resolucao_m integer not null
    constraint chk_satelite_mapas_condicao_resolucao check (resolucao_m > 0),
  chave_cache text not null
    constraint chk_satelite_mapas_condicao_chave_cache check (chave_cache ~ '^[0-9a-f]{64}$'),
  area_total_ha numeric not null
    constraint chk_satelite_mapas_condicao_area_total check (area_total_ha >= 0),
  resumo jsonb not null
    constraint chk_satelite_mapas_condicao_resumo check (jsonb_typeof(resumo) = 'object'),
  pu_gasto numeric(14,4)
    constraint chk_satelite_mapas_condicao_pu_gasto check (pu_gasto >= 0),
  criado_por uuid not null references erp.users(id),
  created_at timestamptz not null default now(),
  constraint fk_satelite_mapas_condicao_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_satelite_mapas_condicao_area foreign key (organization_id, empresa_id, area_id)
    references erp.areas (organization_id, empresa_id, id),
  constraint fk_satelite_mapas_condicao_arquivo foreign key (organization_id, empresa_id, storage_path, sha256_arquivo)
    references erp.satelite_mapas_condicao_arquivos (organization_id, empresa_id, storage_path, sha256_arquivo),
  constraint uq_satelite_mapas_condicao_chave_cache unique (organization_id, chave_cache),
  constraint uq_satelite_mapas_condicao_identidade unique (organization_id, area_id, geometria_sha256, data_imagem, versao_classificador, versao_evalscript, resolucao_m),
  constraint chk_satelite_mapas_condicao_bbox check (bbox_min_x < bbox_max_x and bbox_min_y < bbox_max_y),
  constraint chk_satelite_mapas_condicao_janela check (observacao_fim > observacao_inicio),
  constraint chk_satelite_mapas_condicao_cantos check (
    jsonb_path_exists(cantos_lnglat,
      'strict $ ? (@.type() == "array" && @.size() == 4 && !exists(@[*] ? (!(@.type() == "array" && @.size() == 2 && @[0].type() == "number" && @[1].type() == "number"))))')
  ),
  constraint chk_satelite_mapas_condicao_caminho_coerente check (
    storage_path = organization_id::text || '/' || area_id::text || '/' || mapa || '/' || to_char(data_imagem::timestamp, 'YYYY-MM-DD')
                   || '/' || chave_cache || '.png'
  )
);

create index ix_satelite_mapas_condicao_area_recente
  on erp.satelite_mapas_condicao (organization_id, empresa_id, area_id, data_imagem desc, created_at desc);

comment on table erp.satelite_mapas_condicao is
  'METADADO IMUTÁVEL do mapa categórico da condição do pasto (SAT-COND-01, decisão 302). Sem FK para uma única análise de índice: a classificação é multi-índice da mesma observação. Escopo pecuária.';
comment on column erp.satelite_mapas_condicao.resumo is
  'Resumo por classe (pixels, hectares estimados, percentuais). Hectares NÃO são cadastro subpixel.';
comment on column erp.satelite_mapas_condicao.versao_classificador is
  'Versão do classificador (condicao-pasto-v1). Mudar a versão não reaproveita o mapa antigo.';

create function erp.satelite_mapa_condicao_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: O mapa de condição do pasto registrado (arquivo e metadado) não se altera nem se apaga: um mapa novo é registrado ao lado do anterior.' using errcode = 'P0001';
end $$;

comment on function erp.satelite_mapa_condicao_imutavel() is
  'SAT-COND-01: recusa UPDATE/DELETE/TRUNCATE em erp.satelite_mapas_condicao e arquivos.';
revoke execute on function erp.satelite_mapa_condicao_imutavel() from public, erp_app;

create trigger trg_satelite_mapas_condicao_arquivos_imutavel
  before update or delete on erp.satelite_mapas_condicao_arquivos
  for each row execute function erp.satelite_mapa_condicao_imutavel();
create trigger trg_satelite_mapas_condicao_arquivos_imutavel_truncate
  before truncate on erp.satelite_mapas_condicao_arquivos
  for each statement execute function erp.satelite_mapa_condicao_imutavel();
create trigger trg_satelite_mapas_condicao_imutavel
  before update or delete on erp.satelite_mapas_condicao
  for each row execute function erp.satelite_mapa_condicao_imutavel();
create trigger trg_satelite_mapas_condicao_imutavel_truncate
  before truncate on erp.satelite_mapas_condicao
  for each statement execute function erp.satelite_mapa_condicao_imutavel();
create trigger trg_satelite_mapas_condicao_audit
  after insert on erp.satelite_mapas_condicao
  for each row execute function erp.audit_row();

alter table erp.satelite_mapas_condicao_arquivos enable row level security;
alter table erp.satelite_mapas_condicao_arquivos force row level security;
create policy tenant_e_empresa on erp.satelite_mapas_condicao_arquivos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.satelite_mapas_condicao enable row level security;
alter table erp.satelite_mapas_condicao force row level security;
create policy tenant_e_empresa on erp.satelite_mapas_condicao for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

grant select, insert on erp.satelite_mapas_condicao_arquivos to erp_app;
revoke update, delete, truncate on erp.satelite_mapas_condicao_arquivos from erp_app;
grant select, insert on erp.satelite_mapas_condicao to erp_app;
revoke update, delete, truncate on erp.satelite_mapas_condicao from erp_app;

do $$
declare
  v_tabela text;
  v_ref record;
begin
  select qual, with_check, roles into v_ref
    from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa';

  foreach v_tabela in array array['satelite_mapas_condicao_arquivos', 'satelite_mapas_condicao'] loop
    if to_regclass('erp.' || v_tabela) is null then
      raise exception 'SAT-COND-01: a tabela erp.% nao foi criada.', v_tabela;
    end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'erp' and c.relname = v_tabela and not (c.relrowsecurity and c.relforcerowsecurity)) then
      raise exception 'SAT-COND-01: erp.% sem RLS habilitada e forcada.', v_tabela;
    end if;
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'erp' and p.tablename = v_tabela and p.policyname = 'tenant_e_empresa'
                      and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                      and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
      raise exception 'SAT-COND-01: politica tenant_e_empresa de erp.% diverge da de erp.analises_satelitais.', v_tabela;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'uq_satelite_mapas_condicao_identidade' and c.contype = 'u'
       and c.conrelid = 'erp.satelite_mapas_condicao'::regclass
  ) then
    raise exception 'SAT-COND-01: unicidade de identidade ausente.';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'fk_satelite_mapas_condicao_arquivo' and c.contype = 'f' and c.convalidated
  ) then
    raise exception 'SAT-COND-01: FK do arquivo ausente.';
  end if;
  if to_regclass('erp.satelite_rasters') is null then
    raise exception 'SAT-COND-01: pos-condicao: erp.satelite_rasters desapareceu.';
  end if;
end $$;
