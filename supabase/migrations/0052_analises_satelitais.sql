-- =====================================================================
-- 0052 SAT-01 — ANÁLISE SATELITAL POR ÁREA (Copernicus Sentinel-2, NDVI) — decisão 293
--
-- O QUE ESTA MIGRATION FAZ, e é uma coisa só: cria o HISTÓRICO de análises satelitais de uma ÁREA canônica
-- (erp.areas, decisão 292) — erp.analises_satelitais. Cada linha é uma execução registrada: a janela pedida, a
-- observação escolhida (o dia da imagem), a estatística do índice dentro do polígono e as contagens de pixel que
-- dizem quanto da área a imagem realmente enxergou.
--
-- NÃO É UM SEGUNDO CADASTRO DE POLÍGONOS. A tabela não guarda geometria: ela guarda o area_id e o SHA-256 da
-- geometria que foi analisada (calculado pelo banco a partir de erp.areas.geometria). A geometria continua tendo
-- um dono só. O hash prova QUAL polígono gerou o número; se o polígono muda, a análise antiga continua dizendo a
-- verdade sobre o polígono antigo.
--
-- NDVI NÃO É BIOMASSA. Nenhuma coluna aqui é kg de capim, matéria seca, oferta de forragem ou lotação.
--
-- HISTÓRICO IMUTÁVEL. A análise registrada não se altera nem se apaga: UPDATE é recusado pelo gatilho (mesmo para
-- o dono do schema) e UPDATE/DELETE/TRUNCATE são revogados do erp_app. Uma análise nova nunca destrói a anterior.
--
-- ESCOPO. A análise é DA ÁREA e responde pelo escopo dela: módulo de escopo empresarial "pecuaria", o mesmo de
-- erp.areas (scripts/company-rls-modules.json). Um módulo próprio abriria um segundo caminho até a área, com
-- escopo capaz de divergir do primeiro. Categoria A da 0015 (empresa obrigatória), gabarito inline da 0040/0049.
--
-- FK COMPOSTA DA ÁREA. (organization_id, empresa_id, area_id) → erp.areas(organization_id, empresa_id, id): a
-- análise é sempre da MESMA organização e da MESMA empresa da área — coluna única não prova tenant. Para isso a
-- migration acrescenta a chave única areas_org_empresa_key em erp.areas (não altera nenhum dado). Consequência
-- declarada: área com histórico satelital não muda de empresa (a FK recusa) — o histórico pertence à empresa.
--
-- PRODUÇÃO (decisões 240/247). Tabela nova e vazia; nenhum dado existente é escrito, corrigido ou apagado. O
-- efeito novo nasce DESLIGADO: sem COPERNICUS_ENABLED=1 e as credenciais na API, nenhuma análise é pedida.
--
-- Trava (2026,86). lock_timeout 2s. O runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 86) then
    raise exception 'SAT-01: outra transacao ja detem a trava desta migration (2026,86). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight (fail-closed: para antes de tocar em qualquer coisa) ----------
do $$
begin
  -- "Já aplicada" ANTES das dependências: na reaplicação, o motivo verdadeiro é este.
  if to_regclass('erp.analises_satelitais') is not null
     or to_regprocedure('erp.analises_satelitais_conferir()') is not null
     or exists (select 1 from pg_constraint where conname = 'areas_org_empresa_key' and conrelid = 'erp.areas'::regclass) then
    raise exception 'SAT-01: a 0052 ja foi aplicada ou ha schema divergente (analises_satelitais/analises_satelitais_conferir/areas_org_empresa_key ja existe).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-01: papel erp_app ausente (0007); os privilegios da tabela nova nao teriam destinatario.';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'SAT-01: funcoes de RLS/auditoria ausentes (tenant_visible, audit_row, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual); a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'SAT-01: funcao sha256(bytea) ausente; o hash da geometria analisada nao teria como ser calculado pelo banco.';
  end if;
  -- A área canônica, com a geometria da 0051 e a empresa obrigatória.
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'areas'
         and column_name in ('id', 'organization_id', 'empresa_id', 'geometria', 'deleted_at')) <> 5 then
    raise exception 'SAT-01: erp.areas sem as colunas lidas (id, organization_id, empresa_id, geometria, deleted_at); aplique a 0051 antes.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'erp' and table_name = 'areas' and column_name = 'empresa_id' and is_nullable = 'YES') then
    raise exception 'SAT-01: erp.areas.empresa_id e anulavel; a FK composta da analise exige empresa obrigatoria na area.';
  end if;
  -- A FK de empresa é composta (organização, empresa): o alvo é a chave (organization_id, id) de erp.empresas.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'erp.empresas'::regclass and c.contype in ('p', 'u')
       and (select array_agg(a.attname::text order by a.attnum)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           @> array['organization_id', 'id']
  ) then
    raise exception 'SAT-01: erp.empresas sem chave (organization_id, id) para a FK composta (0014).';
  end if;
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'SAT-01: modulo de escopo empresarial pecuaria ausente (0011); a analise nao teria o escopo da area.';
  end if;
  if to_regclass('erp.users') is null then
    raise exception 'SAT-01: erp.users ausente; criado_por nao teria alvo.';
  end if;
end $$;

-- ---------- 3) chave única da área para a FK composta ----------
-- Só uma chave nova sobre colunas que já existem (id já é único): não muda linha nenhuma, não recusa acervo.
alter table erp.areas add constraint areas_org_empresa_key unique (organization_id, empresa_id, id);

-- ---------- 4) tabela ----------
create table erp.analises_satelitais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  -- As listas de valores ficam inline e sozinhas: é a forma que o dicionário de dados lê como "Valores".
  provedor text not null
    constraint chk_analises_satelitais_provedor check (provedor in ('copernicus_cdse')),
  colecao text not null
    constraint chk_analises_satelitais_colecao check (colecao in ('sentinel-2-l2a')),
  indice text not null
    constraint chk_analises_satelitais_indice check (indice in ('ndvi')),
  versao_metodo text not null
    constraint chk_analises_satelitais_versao_metodo check (versao_metodo ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),
  geometria_sha256 text not null
    constraint chk_analises_satelitais_geometria_sha256 check (geometria_sha256 ~ '^[0-9a-f]{64}$'),
  janela_inicio timestamptz not null,
  janela_fim timestamptz not null,
  resolucao_m numeric(6,2) not null
    constraint chk_analises_satelitais_resolucao check (resolucao_m > 0 and resolucao_m <= 1000),
  situacao text not null
    constraint chk_analises_satelitais_situacao check (situacao in ('concluida', 'sem_observacao_util')),
  motivo_qualidade text
    constraint chk_analises_satelitais_motivo check (motivo_qualidade in ('sem_aquisicao', 'cobertura_insuficiente')),
  observacao_inicio timestamptz,
  observacao_fim timestamptz,
  valor_medio numeric(7,4),
  valor_minimo numeric(7,4),
  valor_maximo numeric(7,4),
  desvio_padrao numeric(7,4),
  pixels_amostra integer,
  pixels_sem_dado integer,
  pixels_validos integer,
  pixels_geometria integer,
  cobertura_valida numeric(5,4),
  metadados_provedor jsonb not null default '{}'::jsonb,
  criado_por uuid not null references erp.users(id),
  created_at timestamptz not null default now(),
  constraint fk_analises_satelitais_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_analises_satelitais_area foreign key (organization_id, empresa_id, area_id) references erp.areas (organization_id, empresa_id, id),
  constraint chk_analises_satelitais_janela check (janela_fim > janela_inicio),
  -- Concluída: a observação escolhida (dentro da janela) e a estatística inteira; nenhum motivo de falta.
  -- Sem observação útil: o motivo, e NENHUM número — baixa qualidade nunca vira NDVI fictício.
  constraint chk_analises_satelitais_coerencia check (
    (situacao = 'concluida'
      and motivo_qualidade is null
      and observacao_inicio is not null and observacao_fim is not null
      and observacao_fim > observacao_inicio
      and observacao_inicio >= janela_inicio and observacao_fim <= janela_fim
      and valor_medio is not null and valor_minimo is not null and valor_maximo is not null and desvio_padrao is not null
      and pixels_amostra is not null and pixels_sem_dado is not null and pixels_validos is not null
      and pixels_geometria is not null and cobertura_valida is not null)
    or
    (situacao = 'sem_observacao_util'
      and motivo_qualidade is not null
      and observacao_inicio is null and observacao_fim is null
      and valor_medio is null and valor_minimo is null and valor_maximo is null and desvio_padrao is null)
  ),
  constraint chk_analises_satelitais_estatistica check (
    valor_medio is null
    or (valor_minimo <= valor_medio and valor_medio <= valor_maximo and desvio_padrao >= 0)
  ),
  -- O NDVI é uma razão normalizada: [-1, 1] por definição.
  constraint chk_analises_satelitais_faixa_ndvi check (
    indice <> 'ndvi' or valor_minimo is null or (valor_minimo >= -1 and valor_maximo <= 1)
  ),
  constraint chk_analises_satelitais_pixels check (
    (pixels_amostra is null or pixels_amostra >= 0)
    and (pixels_sem_dado is null or (pixels_sem_dado >= 0 and (pixels_amostra is null or pixels_sem_dado <= pixels_amostra)))
    and (pixels_validos is null or pixels_validos >= 0)
    and (pixels_geometria is null or pixels_geometria >= 0)
    and (pixels_validos is null or pixels_amostra is null or pixels_sem_dado is null or pixels_validos = pixels_amostra - pixels_sem_dado)
  ),
  constraint chk_analises_satelitais_cobertura check (cobertura_valida is null or (cobertura_valida >= 0 and cobertura_valida <= 1)),
  constraint chk_analises_satelitais_metadados check (jsonb_typeof(metadados_provedor) = 'object'),
  -- Uma execução por área, método, polígono e janela: o duplo clique (e a corrida de duas requisições) reaproveita.
  constraint uq_analises_satelitais_janela unique (organization_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256, janela_inicio, janela_fim)
);

create index ix_analises_satelitais_area_observacao on erp.analises_satelitais (organization_id, area_id, indice, observacao_inicio desc)
  where situacao = 'concluida';
create index ix_analises_satelitais_area_criacao on erp.analises_satelitais (organization_id, area_id, indice, created_at desc);

comment on table erp.analises_satelitais is 'Histórico IMUTÁVEL de análises satelitais de uma área canônica (SAT-01, decisão 293): Copernicus Sentinel-2 L2A, NDVI. Uma linha por área, método, polígono (hash) e janela. NDVI não é biomassa. Escopo de empresa = o da área (pecuária).';
comment on column erp.analises_satelitais.id is 'Identidade técnica (UUID).';
comment on column erp.analises_satelitais.organization_id is 'Tenant (organização).';
comment on column erp.analises_satelitais.empresa_id is 'Empresa da área analisada (FK composta com a área).';
comment on column erp.analises_satelitais.area_id is 'Área canônica analisada (erp.areas). A geometria NÃO é copiada: o dono dela continua sendo erp.areas.';
comment on column erp.analises_satelitais.provedor is 'Provedor analítico (copernicus_cdse = Copernicus Data Space Ecosystem / Sentinel Hub).';
comment on column erp.analises_satelitais.colecao is 'Coleção de imagens (sentinel-2-l2a).';
comment on column erp.analises_satelitais.indice is 'Índice espectral calculado (ndvi).';
comment on column erp.analises_satelitais.versao_metodo is 'Versão do método (evalscript + máscara SCL + critério de observação útil). Versões diferentes não se reaproveitam.';
comment on column erp.analises_satelitais.geometria_sha256 is 'SHA-256 (hex) do texto jsonb de erp.areas.geometria no momento da análise, calculado pelo banco. Prova qual polígono gerou o número.';
comment on column erp.analises_satelitais.janela_inicio is 'Início da janela de busca pedida (dia UTC inteiro).';
comment on column erp.analises_satelitais.janela_fim is 'Fim (exclusivo) da janela de busca pedida (dia UTC inteiro).';
comment on column erp.analises_satelitais.resolucao_m is 'Resolução nominal da estatística, em metros.';
comment on column erp.analises_satelitais.situacao is 'concluida = observação útil encontrada; sem_observacao_util = nenhuma imagem da janela enxergou a área o bastante (sem número).';
comment on column erp.analises_satelitais.motivo_qualidade is 'Por que não houve observação útil (nulo quando concluída).';
comment on column erp.analises_satelitais.observacao_inicio is 'Início do intervalo da imagem escolhida, como o provedor o devolveu (nunca a data de criação do registro).';
comment on column erp.analises_satelitais.observacao_fim is 'Fim do intervalo da imagem escolhida, como o provedor o devolveu.';
comment on column erp.analises_satelitais.valor_medio is 'Média do índice nos pixels válidos dentro do polígono.';
comment on column erp.analises_satelitais.valor_minimo is 'Mínimo do índice nos pixels válidos.';
comment on column erp.analises_satelitais.valor_maximo is 'Máximo do índice nos pixels válidos.';
comment on column erp.analises_satelitais.desvio_padrao is 'Desvio-padrão do índice nos pixels válidos.';
comment on column erp.analises_satelitais.pixels_amostra is 'sampleCount do provedor: pixels do retângulo envolvente da requisição.';
comment on column erp.analises_satelitais.pixels_sem_dado is 'noDataCount do provedor: pixels fora do polígono ou excluídos pela máscara.';
comment on column erp.analises_satelitais.pixels_validos is 'pixels_amostra - pixels_sem_dado: pixels dentro do polígono que passaram na máscara.';
comment on column erp.analises_satelitais.pixels_geometria is 'Pixels que cabem no polígono na resolução nominal (área do polígono na grade CRS84 da requisição ÷ área do pixel: os pixels que o provedor rasteriza dentro dele). A origem fica em metadados_provedor.fonte_pixels_geometria.';
comment on column erp.analises_satelitais.cobertura_valida is 'pixels_validos / pixels_geometria (0 a 1): quanto da área a imagem enxergou com clareza.';
comment on column erp.analises_satelitais.metadados_provedor is 'Metadados SANITIZADOS por lista branca (contagens de intervalos, origem da contagem do polígono, situação do provedor). Nunca token, segredo, cabeçalho nem a resposta bruta.';
comment on column erp.analises_satelitais.criado_por is 'Usuário que pediu a análise.';
comment on column erp.analises_satelitais.created_at is 'Registro da análise (nunca é a data da imagem).';

-- ---------- 5) gatilho de conferência ----------
-- INSERT: a área existe, está viva, tem geometria, e o polígono analisado é o polígono de AGORA (hash). UPDATE:
-- recusado — o histórico não se reescreve. Lê erp.areas como o papel que insere (invoker): a RLS da área vale aqui
-- também, e área fora do escopo responde a mesma recusa de área inexistente.
create function erp.analises_satelitais_conferir() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
declare
  v_geometria jsonb;
  v_achou boolean := false;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT: A análise satelital registrada não se altera: uma análise nova é registrada ao lado da anterior.' using errcode = 'P0001';
  end if;
  select true, a.geometria into v_achou, v_geometria
    from erp.areas a
   where a.id = new.area_id and a.organization_id = new.organization_id and a.empresa_id = new.empresa_id
     and a.deleted_at is null;
  if not coalesce(v_achou, false) then
    raise exception 'NOT_FOUND: Área não encontrada' using errcode = 'P0001';
  end if;
  if v_geometria is null then
    raise exception 'VALIDATION_ERROR: A área não tem polígono desenhado; sem geometria não há análise por satélite.' using errcode = 'P0001';
  end if;
  if encode(sha256(convert_to(v_geometria::text, 'UTF8')), 'hex') is distinct from new.geometria_sha256 then
    raise exception 'CONCURRENCY_CONFLICT: O polígono da área mudou durante a análise; peça a análise de novo.' using errcode = 'P0001';
  end if;
  return new;
end $$;

comment on function erp.analises_satelitais_conferir() is 'SAT-01: confere a área (viva, com geometria, mesmo polígono pelo hash) na inserção e recusa qualquer UPDATE (histórico imutável).';
revoke execute on function erp.analises_satelitais_conferir() from public;

create trigger trg_analises_satelitais_conferir
  before insert or update on erp.analises_satelitais
  for each row execute function erp.analises_satelitais_conferir();

create trigger trg_analises_satelitais_audit
  after insert on erp.analises_satelitais
  for each row execute function erp.audit_row();

-- ---------- 6) RLS e privilégios (categoria A da 0015; gabarito inline de 0040/0049) ----------
alter table erp.analises_satelitais enable row level security;
alter table erp.analises_satelitais force row level security;
create policy tenant_e_empresa on erp.analises_satelitais for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

grant select, insert on erp.analises_satelitais to erp_app;
revoke update, delete, truncate on erp.analises_satelitais from erp_app;

-- ---------- 7) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
begin
  if to_regclass('erp.analises_satelitais') is null then
    raise exception 'SAT-01: a tabela erp.analises_satelitais nao foi criada.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname = 'analises_satelitais'
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'SAT-01: erp.analises_satelitais sem RLS habilitada e forcada.';
  end if;
  if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais')
     is distinct from array['tenant_e_empresa'] then
    raise exception 'SAT-01: politica de erp.analises_satelitais diferente de tenant_e_empresa.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_analises_satelitais_area' and contype = 'f'
                   and confdeltype = 'a' and confupdtype = 'a' and array_length(conkey, 1) = 3) then
    raise exception 'SAT-01: FK composta da area (organizacao, empresa, area; sem cascata) ausente.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_analises_satelitais_empresa' and contype = 'f'
                   and confdeltype = 'a' and confupdtype = 'a' and array_length(conkey, 1) = 2) then
    raise exception 'SAT-01: FK composta da empresa (sem cascata) ausente.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'areas_org_empresa_key' and contype = 'u' and conrelid = 'erp.areas'::regclass) then
    raise exception 'SAT-01: chave unica areas_org_empresa_key ausente em erp.areas.';
  end if;
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid = 'erp.analises_satelitais'::regclass
        and t.tgname in ('trg_analises_satelitais_conferir', 'trg_analises_satelitais_audit')) <> 2 then
    raise exception 'SAT-01: gatilhos de erp.analises_satelitais ausentes (conferencia e auditoria).';
  end if;
  if has_table_privilege('erp_app', 'erp.analises_satelitais', 'UPDATE')
     or has_table_privilege('erp_app', 'erp.analises_satelitais', 'DELETE')
     or has_table_privilege('erp_app', 'erp.analises_satelitais', 'TRUNCATE') then
    raise exception 'SAT-01: erp_app com UPDATE/DELETE/TRUNCATE em erp.analises_satelitais; o historico deixaria de ser imutavel.';
  end if;
end $$;
