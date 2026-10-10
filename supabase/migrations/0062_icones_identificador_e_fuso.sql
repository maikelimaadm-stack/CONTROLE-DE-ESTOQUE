-- =====================================================================
-- 0062 — MAPA-MANEJO-02 (decisão 306): o "hoje" da empresa, o identificador do lote e os ícones do mapa.
--
--   CAMADA 1  fuso horário da empresa
--             erp.fuso_horario_valido(text)          o fuso existe em pg_timezone_names (usada no CHECK)
--             erp.dia_no_fuso(timestamptz, text)     o dia de um instante num fuso; nunca lança
--             erp.hoje_na_empresa(uuid)              o dia de hoje no fuso da empresa; nunca lança
--             erp.empresas.fuso_horario              coluna NOVA, default 'America/Sao_Paulo' + chk_empresas_fuso_horario
--             erp.batches_fechar_ocupacao()          recriada IGUAL à 0061, trocando só os 3 current_date
--   CAMADA 2  erp.batches.identificador_nome/_sigla/_cor  colunas NOVAS, nulas, sem backfill + 2 CHECKs
--   CAMADA 3  erp.configuracoes_de_icone            o ícone (imagem e/ou cor) por categoria, por empresa
--             erp.icone_categorias_misto_validas(text[])  a lista do MISTO é canônica (usada no CHECK)
--
-- Só DDL: nenhum INSERT, UPDATE ou DELETE em linha existente. As colunas novas nascem com default
-- (fuso_horario) ou nulas (identificador_*); a tabela nova nasce vazia.
-- SEM PostGIS. Forward-only. Trava (2026,96). lock_timeout 2s. O runner aplica o arquivo em UMA transação:
-- sem commit, sem create index concurrently, sem cascade.
-- =====================================================================

-- ---------- 1) trava ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 96) then
    raise exception 'MAPA-MANEJO-02: outra transacao ja detem a trava desta migration (2026,96). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições (fail-closed; "já aplicada" antes das dependências) ----------
-- O corpo da função de gatilho da 0061 é conferido por um md5 NORMALIZADO (todo espaço em branco vira um
-- espaço só, sem espaço nas pontas): md5(btrim(regexp_replace(prosrc, '[[:space:]]+', ' ', 'g'))). O valor abaixo é o do
-- corpo que a 0061 cria. A seção 7 RECRIA a função; se o corpo em produção não for o da 0061, recriar apagaria em
-- silêncio uma mudança feita fora do repositório — então a migration para antes.
do $$
declare
  v_corpo text;
  v_n int;
begin
  if to_regclass('erp.configuracoes_de_icone') is not null
     or to_regprocedure('erp.hoje_na_empresa(uuid)') is not null
     or to_regprocedure('erp.dia_no_fuso(timestamptz,text)') is not null
     or to_regprocedure('erp.fuso_horario_valido(text)') is not null
     or to_regprocedure('erp.icone_categorias_misto_validas(text[])') is not null
     or exists (select 1 from pg_attribute
                 where attrelid = to_regclass('erp.empresas') and attname = 'fuso_horario' and not attisdropped)
     or exists (select 1 from pg_attribute
                 where attrelid = to_regclass('erp.batches') and not attisdropped
                   and attname in ('identificador_nome', 'identificador_sigla', 'identificador_cor')) then
    raise exception 'MAPA-MANEJO-02: a 0062 ja foi aplicada (erp.empresas.fuso_horario, identificador_* em erp.batches, erp.configuracoes_de_icone ou as funcoes novas ja existem).';
  end if;

  -- A 0061 aplicada e INTACTA: a função de gatilho é a dela, e o gatilho está ligado a ela.
  if to_regclass('erp.ocupacoes_de_area') is null or to_regprocedure('erp.batches_fechar_ocupacao()') is null then
    raise exception 'MAPA-MANEJO-02: a 0061 nao foi aplicada (erp.ocupacoes_de_area ou erp.batches_fechar_ocupacao() ausente); aplique a 0061 antes.';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('erp.batches_fechar_ocupacao()') and p.prosecdef
                    and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'MAPA-MANEJO-02: erp.batches_fechar_ocupacao() nao e SECURITY DEFINER com search_path fixo; a 0061 nao esta intacta.';
  end if;
  select p.prosrc into v_corpo from pg_proc p where p.oid = to_regprocedure('erp.batches_fechar_ocupacao()');
  v_n := (length(lower(v_corpo)) - length(replace(lower(v_corpo), 'current_date', ''))) / length('current_date');
  if v_n <> 3 then
    raise exception 'MAPA-MANEJO-02: o corpo de erp.batches_fechar_ocupacao() tem % ocorrencia(s) de current_date (a 0061 tem 3); a 0061 nao esta intacta.', v_n;
  end if;
  if md5(btrim(regexp_replace(v_corpo, '[[:space:]]+', ' ', 'g'))) <> 'abd1b04a22400f0b3ef76c546a765ecb' then
    raise exception 'MAPA-MANEJO-02: o corpo de erp.batches_fechar_ocupacao() diverge do da 0061 (md5 normalizado %); recriar a funcao apagaria uma mudanca feita fora do repositorio.',
      md5(btrim(regexp_replace(v_corpo, '[[:space:]]+', ' ', 'g')));
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgname = 'trg_batches_fechar_ocupacao' and t.tgrelid = to_regclass('erp.batches') and not t.tgisinternal
                    and t.tgfoid = to_regprocedure('erp.batches_fechar_ocupacao()') and t.tgenabled = 'O') then
    raise exception 'MAPA-MANEJO-02: o gatilho trg_batches_fechar_ocupacao esta ausente de erp.batches, desligado ou fora de erp.batches_fechar_ocupacao(); a 0061 nao esta intacta.';
  end if;

  if not exists (select 1 from pg_attribute
                  where attrelid = to_regclass('erp.empresas') and attname = 'organization_id' and not attisdropped) then
    raise exception 'MAPA-MANEJO-02: erp.empresas ausente ou sem organization_id; cadeia fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'empresas_org_id_key' and conrelid = to_regclass('erp.empresas') and contype = 'u'
                    and pg_get_constraintdef(oid) = 'UNIQUE (organization_id, id)') then
    raise exception 'MAPA-MANEJO-02: erp.empresas sem a unique composta empresas_org_id_key (organization_id, id); a FK composta de empresa nao tem alvo.';
  end if;
  if (select count(*) from pg_timezone_names where name in ('America/Sao_Paulo', 'America/Cuiaba')) <> 2 then
    raise exception 'MAPA-MANEJO-02: America/Sao_Paulo ou America/Cuiaba ausente de pg_timezone_names; o fuso padrao e o de producao seriam recusados.';
  end if;

  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null or to_regprocedure('erp.set_updated_at()') is null then
    raise exception 'MAPA-MANEJO-02: funcoes de RLS/auditoria/updated_at ausentes; cadeia fora de ordem.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'areas' and policyname = 'tenant_e_empresa') then
    raise exception 'MAPA-MANEJO-02: politica tenant_e_empresa de erp.areas ausente (molde da tabela nova).';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'MAPA-MANEJO-02: modulo de escopo pecuaria ausente.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'MAPA-MANEJO-02: papel erp_app ausente (0007).';
  end if;
  -- Os gatilhos SECURITY DEFINER (o de erp.batches e o hoje_na_empresa que ele chama) leem e gravam tabelas de
  -- RLS FORÇADA como o dono: o papel que aplica precisa atravessar a RLS (o mesmo requisito da 0042 e da 0061).
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'MAPA-MANEJO-02: o papel que aplica a migration (%) precisa ser superusuario ou ter BYPASSRLS.', current_user;
  end if;
  -- A função de gatilho recriada (create or replace mantém o dono da 0061) chama erp.hoje_na_empresa, que nasce do papel
  -- que aplica e só o dono executa. Se quem aplica não é o dono da função de gatilho, a migration aplicaria limpa e TODA
  -- gravação de lote falharia por falta de EXECUTE. Em produção o dono é o erp_migrator, o mesmo papel que aplica.
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'erp.batches_fechar_ocupacao()'::regprocedure) <> current_user then
    raise exception 'MAPA-MANEJO-02: o papel que aplica a migration (%) nao e o dono de erp.batches_fechar_ocupacao() (%); a funcao recriada chamaria erp.hoje_na_empresa sem EXECUTE e toda gravacao de lote falharia. Aplique como o dono.',
      current_user, (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'erp.batches_fechar_ocupacao()'::regprocedure);
  end if;
end $$;

-- =====================================================================
-- CAMADA 1 — o "hoje" da empresa
-- =====================================================================
-- O PROBLEMA MEDIDO: a sessão do banco roda em UTC, e o gatilho da 0061 usava current_date — o dia de UTC.
-- Em Cuiabá (UTC−4, sem horário de verão), das 20h às 24h o dia de UTC já é o dia SEGUINTE; em São Paulo
-- (UTC−3), das 21h às 24h. Um lote criado (ou movido) às 21h de Cuiabá abria a ocupação com a data de amanhã, e o
-- fechamento caía no dia seguinte também. A data da ocupação passa a ser o dia NO FUSO DA EMPRESA DA ÁREA.

-- ---------- 3) erp.fuso_horario_valido(text) ----------
-- CHECK do PostgreSQL não aceita subconsulta: a lista de fusos vem por esta função. STABLE de propósito — ela
-- lê o catálogo de fusos do servidor, que muda com o tzdata. Nulo → false (a função não é STRICT: STRICT
-- devolveria nulo, e CHECK com nulo PASSA).
create function erp.fuso_horario_valido(p text) returns boolean
language sql stable set search_path = erp, pg_temp as $$
  select p is not null and exists (select 1 from pg_catalog.pg_timezone_names t where t.name = p)
$$;

comment on function erp.fuso_horario_valido(text) is
  'MAPA-MANEJO-02 (decisão 306): true quando o texto é um nome de fuso de pg_timezone_names (ex.: America/Sao_Paulo, America/Cuiaba); nulo ou desconhecido → false. Usada no CHECK chk_empresas_fuso_horario; quem grava erp.empresas (erp_app) precisa de EXECUTE.';

-- ---------- 4) erp.dia_no_fuso(timestamptz, text) ----------
-- O núcleo testável com instante fixo (o relógio do banco não se ajusta em teste). Nunca lança: fuso nulo,
-- vazio ou que o PostgreSQL não reconhece → o dia de America/Sao_Paulo. Instante nulo → nulo.
create function erp.dia_no_fuso(p_instante timestamptz, p_fuso text) returns date
language plpgsql stable security invoker set search_path = erp, pg_temp as $$
begin
  if p_instante is null then
    return null;
  end if;
  if p_fuso is null or btrim(p_fuso) = '' then
    return (p_instante at time zone 'America/Sao_Paulo')::date;
  end if;
  begin
    return (p_instante at time zone p_fuso)::date;
  exception when others then
    return (p_instante at time zone 'America/Sao_Paulo')::date;
  end;
end $$;

comment on function erp.dia_no_fuso(timestamptz, text) is
  'MAPA-MANEJO-02 (decisão 306): o dia (date) do instante no fuso dado. Nunca lança: fuso nulo, vazio ou não reconhecido → o dia de America/Sao_Paulo; instante nulo → nulo.';

-- ---------- 5) erp.empresas.fuso_horario ----------
-- Coluna NOVA com default: as empresas existentes passam a ler 'America/Sao_Paulo' sem UPDATE nenhum.
alter table erp.empresas add column fuso_horario text not null default 'America/Sao_Paulo';

alter table erp.empresas add constraint chk_empresas_fuso_horario check (erp.fuso_horario_valido(fuso_horario));

comment on column erp.empresas.fuso_horario is
  'MAPA-MANEJO-02 (decisão 306): fuso horário da empresa (nome de pg_timezone_names, ex.: America/Cuiaba). Decide o "hoje" da empresa (erp.hoje_na_empresa) — a data de abertura e de fechamento da ocupação de área. Default America/Sao_Paulo.';

-- ---------- 6) erp.hoje_na_empresa(uuid) ----------
-- SECURITY DEFINER: lê erp.empresas (RLS forçada) sem depender do módulo da rota — quem chama é o gatilho de
-- erp.batches. Empresa inexistente ou fuso ilegível → o dia de São Paulo. Nunca lança.
create function erp.hoje_na_empresa(p_empresa_id uuid) returns date
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_fuso text;
begin
  select e.fuso_horario into v_fuso from erp.empresas e where e.id = p_empresa_id;
  return erp.dia_no_fuso(now(), v_fuso);
exception when others then
  return (now() at time zone 'America/Sao_Paulo')::date;
end $$;

comment on function erp.hoje_na_empresa(uuid) is
  'MAPA-MANEJO-02 (decisão 306): o dia de hoje (instante da transação, now()) no fuso da empresa (erp.empresas.fuso_horario). Empresa inexistente → America/Sao_Paulo. Nunca lança. Só gatilho chama: EXECUTE revogado de PUBLIC e do erp_app.';

-- ---------- 7) erp.batches_fechar_ocupacao() — a da 0061, trocando só os 3 current_date ----------
-- O corpo é o da 0061 linha a linha. As três trocas, e nada mais:
--   · lote CRIADO com área (INSERT):  coalesce(new.entry_date, current_date)  →  coalesce(new.entry_date, erp.hoje_na_empresa(v_empresa_da_area))
--   · fechamento da aberta:           greatest(o.data_inicio, current_date)   →  greatest(o.data_inicio, erp.hoje_na_empresa(o.empresa_id))
--   · abertura da nova:               current_date                            →  erp.hoje_na_empresa(v_empresa_da_area)
-- A empresa que decide o fuso é a da ÁREA (a da ocupação), não a do lote. create or replace mantém o dono, o
-- EXECUTE já revogado pela 0061 e o gatilho trg_batches_fechar_ocupacao.
create or replace function erp.batches_fechar_ocupacao() returns trigger
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
            coalesce(new.entry_date, erp.hoje_na_empresa(v_empresa_da_area)),
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
       set data_fim = greatest(o.data_inicio, erp.hoje_na_empresa(o.empresa_id)),
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
    values (new.organization_id, v_empresa_da_area, new.area_id, new.id, erp.hoje_na_empresa(v_empresa_da_area), 'movimento');
  end if;
  return null;
end $$;

comment on function erp.batches_fechar_ocupacao() is
  'MAPA-MANEJO-01 (decisão 305), fuso pela MAPA-MANEJO-02 (decisão 306): mantém erp.ocupacoes_de_area a partir de erp.batches — fecha a aberta quando a área muda ou o lote encerra/é excluído; abre a nova quando a área muda para não nula com o lote ativo (ou o lote é reativado ou criado com área). Só curral ou módulo não mexe na ocupação. O "hoje" das datas de abertura e fechamento é o dia no fuso da empresa da área (erp.hoje_na_empresa), não o current_date da sessão.';

-- =====================================================================
-- CAMADA 2 — o identificador do lote no mapa
-- =====================================================================

-- ---------- 8) colunas NOVAS em erp.batches (nulas, sem default, sem backfill) ----------
-- Nenhuma rota de escrita nesta fatia. "Preenchido" (domínio) = não nulo e com algo além de espaço.
alter table erp.batches add column identificador_nome text, add column identificador_sigla text, add column identificador_cor text;

alter table erp.batches add constraint chk_batches_identificador_cor check (identificador_cor is null or identificador_cor ~ '^#[0-9A-Fa-f]{6}$');
alter table erp.batches add constraint chk_batches_identificador_sigla check (identificador_sigla is null or char_length(btrim(identificador_sigla)) between 1 and 4);

comment on column erp.batches.identificador_nome is
  'MAPA-MANEJO-02 (decisão 306): nome com que o lote aparece no marcador do mapa. Nulo = sem identificador próprio.';
comment on column erp.batches.identificador_sigla is
  'MAPA-MANEJO-02 (decisão 306): sigla do lote no marcador do mapa, de 1 a 4 caracteres sem contar os espaços das pontas (chk_batches_identificador_sigla). Nula = sem sigla.';
comment on column erp.batches.identificador_cor is
  'MAPA-MANEJO-02 (decisão 306): cor do lote no marcador do mapa, hexadecimal #RRGGBB (chk_batches_identificador_cor). Nula = a cor padrão do domínio.';

-- =====================================================================
-- CAMADA 3 — a configuração de ícone por categoria
-- =====================================================================

-- ---------- 9) erp.icone_categorias_misto_validas(text[]) ----------
-- A lista do MISTO: 2 ou mais elementos, uma dimensão, sem nulo, sem repetição, cada um na forma canônica da
-- categoria (maiúsculas, sem espaço nas pontas, 1 a 60 caracteres). CHECK não aceita subconsulta: a regra mora
-- aqui. IMMUTABLE: depende só do argumento.
create function erp.icone_categorias_misto_validas(p text[]) returns boolean
language plpgsql immutable set search_path = erp, pg_temp as $$
declare
  v text;
begin
  if p is null or array_ndims(p) is distinct from 1 or cardinality(p) < 2 then
    return false;
  end if;
  foreach v in array p loop
    if v is null then
      return false;
    end if;
    if v <> upper(btrim(v)) or char_length(v) not between 1 and 60 then
      return false;
    end if;
  end loop;
  if (select count(distinct x) from unnest(p) x) <> cardinality(p) then
    return false;
  end if;
  return true;
end $$;

comment on function erp.icone_categorias_misto_validas(text[]) is
  'MAPA-MANEJO-02 (decisão 306): true quando a lista do MISTO tem 2 ou mais categorias, uma dimensão, sem nulo, sem repetição e cada uma canônica (upper(btrim(x)) = x, 1 a 60 caracteres). Usada no CHECK chk_icone_misto_so_no_misto; quem grava (erp_app) precisa de EXECUTE.';

-- ---------- 10) erp.configuracoes_de_icone ----------
create table erp.configuracoes_de_icone (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null constraint fk_configuracoes_de_icone_organizacao references erp.organizations (id),
  empresa_id uuid not null,
  tipo_entidade text not null,
  categoria text not null,
  categorias_misto text[],
  icone_url text,
  cor_padrao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint fk_configuracoes_de_icone_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint chk_icone_tipo_entidade check (tipo_entidade in ('lote', 'objeto_de_mapa', 'area')),
  -- A categoria é gravada CANÔNICA (maiúsculas, sem espaço nas pontas): sem isto o unique aceitaria "Boi" e
  -- "BOI" e a resolução do ícone ficaria ambígua. A API recusa (422) o que não vier canônico — nunca traduz.
  constraint chk_icone_categoria_canonica check (categoria = upper(btrim(categoria)) and char_length(categoria) between 1 and 60),
  -- A lista só existe no MISTO; quando existe, é canônica (erp.icone_categorias_misto_validas).
  constraint chk_icone_misto_so_no_misto check (categorias_misto is null or (categoria = 'MISTO' and erp.icone_categorias_misto_validas(categorias_misto))),
  constraint chk_icone_cor_padrao check (cor_padrao is null or cor_padrao ~ '^#[0-9A-Fa-f]{6}$'),
  constraint chk_icone_tem_imagem_ou_cor check (icone_url is not null or cor_padrao is not null),
  constraint chk_icone_url_https check (icone_url is null or icone_url like 'https://%')
);

-- Uma configuração viva por (empresa, tipo de entidade, categoria). O MISTO fica de fora: duas com o mesmo
-- conjunto o banco aceita, e o domínio desempata.
create unique index uq_configuracoes_de_icone_categoria on erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade, categoria)
  where deleted_at is null and categoria <> 'MISTO';
create index ix_configuracoes_de_icone_tipo on erp.configuracoes_de_icone (organization_id, empresa_id, tipo_entidade)
  where ativo and deleted_at is null;

comment on table erp.configuracoes_de_icone is
  'MAPA-MANEJO-02 (decisão 306): o ícone do mapa por categoria, por empresa — imagem (icone_url, https) e/ou cor (cor_padrao). Uma viva por empresa, tipo de entidade e categoria (uq_configuracoes_de_icone_categoria), menos o MISTO. Nenhum nome de ícone mora no banco: a imagem é a URL cadastrada. Sem DELETE: exclusão lógica (deleted_at). RLS por empresa no módulo pecuaria.';
comment on column erp.configuracoes_de_icone.empresa_id is 'Empresa da configuração (FK composta com a organização por empresas_org_id_key). Escopo de empresa do módulo pecuaria.';
comment on column erp.configuracoes_de_icone.tipo_entidade is 'A que o ícone se aplica: lote, objeto_de_mapa ou area (chk_icone_tipo_entidade).';
comment on column erp.configuracoes_de_icone.categoria is 'Categoria na forma canônica (maiúsculas, sem espaço nas pontas, 1 a 60 caracteres). O valor especial MISTO é o ícone de quando há mais de uma categoria.';
comment on column erp.configuracoes_de_icone.categorias_misto is 'Só no MISTO: as categorias do conjunto (2 ou mais, canônicas, sem repetição). Nula fora do MISTO.';
comment on column erp.configuracoes_de_icone.icone_url is 'Endereço https da imagem do ícone. Nulo = só a cor (chk_icone_tem_imagem_ou_cor exige um dos dois).';
comment on column erp.configuracoes_de_icone.cor_padrao is 'Cor hexadecimal #RRGGBB do ícone. Nula = só a imagem.';
comment on column erp.configuracoes_de_icone.ativo is 'Configuração em uso. Inativa continua ocupando a categoria no unique; para liberar, a exclusão lógica (deleted_at).';

alter table erp.configuracoes_de_icone enable row level security;
alter table erp.configuracoes_de_icone force row level security;
create policy tenant_e_empresa on erp.configuracoes_de_icone for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Os default privileges da 0007 concedem delete; a exclusão é lógica, então o revoke é EXPLÍCITO.
grant select, insert, update on erp.configuracoes_de_icone to erp_app;
revoke delete, truncate on erp.configuracoes_de_icone from erp_app;

create trigger trg_configuracoes_de_icone_updated before update on erp.configuracoes_de_icone
  for each row execute function erp.set_updated_at();

create trigger trg_configuracoes_de_icone_audit after insert or update or delete on erp.configuracoes_de_icone
  for each row execute function erp.audit_row();

-- ---------- 11) execute só do dono nas funções novas — menos as duas de CHECK ----------
-- A 0007 dá execute a erp_app por default privilege e toda função nasce executável por PUBLIC. dia_no_fuso e
-- hoje_na_empresa não são porta da API: só o gatilho chama (como o dono). A função de gatilho recriada entra no
-- laço para que a pós-condição prove o estado, não o suponha.
-- EXCEÇÃO: função usada dentro de CHECK é executada com o privilégio de QUEM GRAVA (o PostgreSQL confere EXECUTE
-- ao preparar a expressão, mesmo quando o valor é nulo). erp.empresas e erp.configuracoes_de_icone são gravadas
-- pelo erp_app: as duas funções de CHECK saem de PUBLIC e voltam SÓ para o erp_app.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('fuso_horario_valido', 'dia_no_fuso', 'hoje_na_empresa', 'icone_categorias_misto_validas', 'batches_fechar_ocupacao')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

grant execute on function erp.fuso_horario_valido(text) to erp_app;
grant execute on function erp.icone_categorias_misto_validas(text[]) to erp_app;

-- ---------- 12) pós-condições NOMEADAS POR OBJETO ----------
do $$
declare
  v_ref record;
  v_fn text;
  v_corpo text;
  v_n int;
begin
  -- Funções: segurança, volatilidade e search_path fixo.
  if (select count(*) from pg_proc p
       where (p.oid, p.prosecdef, p.provolatile) in (
               (to_regprocedure('erp.fuso_horario_valido(text)'), false, 's'),
               (to_regprocedure('erp.dia_no_fuso(timestamptz,text)'), false, 's'),
               (to_regprocedure('erp.hoje_na_empresa(uuid)'), true, 's'),
               (to_regprocedure('erp.icone_categorias_misto_validas(text[])'), false, 'i'),
               (to_regprocedure('erp.batches_fechar_ocupacao()'), true, 'v'))
         and p.proconfig = array['search_path=erp, pg_temp']) <> 5 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — funcoes novas (ou a recriada) fora da forma (SECURITY DEFINER/INVOKER, volatilidade ou search_path fixo).';
  end if;

  -- O dono da função de gatilho executa o que ela chama (o mesmo papel: a pré-condição exigiu quem aplica = o dono).
  if not has_function_privilege((select p.proowner from pg_proc p where p.oid = 'erp.batches_fechar_ocupacao()'::regprocedure), 'erp.hoje_na_empresa(uuid)', 'EXECUTE')
     or not has_function_privilege((select p.proowner from pg_proc p where p.oid = 'erp.hoje_na_empresa(uuid)'::regprocedure), 'erp.dia_no_fuso(timestamptz,text)', 'EXECUTE') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — o dono de erp.batches_fechar_ocupacao() nao executa erp.hoje_na_empresa (ou o dono desta nao executa erp.dia_no_fuso).';
  end if;

  -- EXECUTE: ninguém além do dono nas três de gatilho; SÓ o erp_app além do dono nas duas de CHECK.
  foreach v_fn in array array['erp.dia_no_fuso(timestamptz,text)', 'erp.hoje_na_empresa(uuid)', 'erp.batches_fechar_ocupacao()'] loop
    if has_function_privilege('erp_app', v_fn, 'EXECUTE')
       or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = to_regprocedure(v_fn) and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
      raise exception 'MAPA-MANEJO-02: pos-condicao — % ainda executavel por alguem alem do dono.', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['erp.fuso_horario_valido(text)', 'erp.icone_categorias_misto_validas(text[])'] loop
    if not has_function_privilege('erp_app', v_fn, 'EXECUTE')
       or (select coalesce(array_agg(a.grantee::regrole::text order by a.grantee::regrole::text), '{}')
             from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = to_regprocedure(v_fn) and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner and a.grantee <> 0) <> array['erp_app']
       or exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = to_regprocedure(v_fn) and a.privilege_type = 'EXECUTE' and a.grantee = 0) then
      raise exception 'MAPA-MANEJO-02: pos-condicao — % tem de ser executavel pelo erp_app e por mais ninguem alem do dono (nem PUBLIC).', v_fn;
    end if;
  end loop;

  -- O comportamento, com instante FIXO: 2026-10-10T02:00Z é 09/10 em São Paulo (23h) e em Cuiabá (22h) e 10/10 em
  -- UTC; 03:30Z é 10/10 em São Paulo (00h30) e ainda 09/10 em Cuiabá (23h30).
  if erp.dia_no_fuso('2026-10-10T02:00:00Z', 'America/Cuiaba') is distinct from date '2026-10-09'
     or erp.dia_no_fuso('2026-10-10T03:30:00Z', 'America/Cuiaba') is distinct from date '2026-10-09'
     or erp.dia_no_fuso('2026-10-10T03:30:00Z', 'America/Sao_Paulo') is distinct from date '2026-10-10'
     or erp.dia_no_fuso('2026-10-10T02:00:00Z', 'Marte/Olimpo') is distinct from date '2026-10-09'
     or erp.dia_no_fuso('2026-10-10T02:00:00Z', null) is distinct from date '2026-10-09'
     or erp.dia_no_fuso('2026-10-10T02:00:00Z', ' ') is distinct from date '2026-10-09'
     or erp.dia_no_fuso(null, 'America/Cuiaba') is not null then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.dia_no_fuso fora do contrato (Cuiaba, Sao Paulo, fuso invalido/nulo/vazio → Sao Paulo).';
  end if;
  if erp.hoje_na_empresa(null) is distinct from erp.dia_no_fuso(now(), 'America/Sao_Paulo') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.hoje_na_empresa de empresa inexistente nao devolve o dia de Sao Paulo.';
  end if;
  if erp.fuso_horario_valido('America/Cuiaba') is not true or erp.fuso_horario_valido('Marte/Olimpo') is not false
     or erp.fuso_horario_valido(null) is not false then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.fuso_horario_valido fora do contrato.';
  end if;
  if erp.icone_categorias_misto_validas(array['BOI', 'VACA']) is not true
     or erp.icone_categorias_misto_validas(array['BOI']) is not false
     or erp.icone_categorias_misto_validas(array['BOI', 'BOI']) is not false
     or erp.icone_categorias_misto_validas(array['Boi', 'VACA']) is not false
     or erp.icone_categorias_misto_validas(array[' BOI', 'VACA']) is not false
     or erp.icone_categorias_misto_validas(array['BOI', null]) is not false
     or erp.icone_categorias_misto_validas(array['BOI', '']) is not false
     or erp.icone_categorias_misto_validas(array[['BOI', 'VACA'], ['NOVILHA', 'TOURO']]) is not false
     or erp.icone_categorias_misto_validas(null) is not false then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.icone_categorias_misto_validas fora do contrato.';
  end if;

  -- erp.empresas.fuso_horario e o CHECK.
  if not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = 'erp.empresas'::regclass and a.attname = 'fuso_horario' and not a.attisdropped
                    and a.atttypid = 'text'::regtype and a.attnotnull
                    and pg_get_expr(d.adbin, d.adrelid) = '''America/Sao_Paulo''::text') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.empresas.fuso_horario ausente ou fora da forma (text not null default America/Sao_Paulo).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_empresas_fuso_horario' and conrelid = 'erp.empresas'::regclass
                    and contype = 'c' and convalidated and pg_get_constraintdef(oid) = 'CHECK (erp.fuso_horario_valido(fuso_horario))') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — chk_empresas_fuso_horario ausente ou fora da forma.';
  end if;

  -- A função de gatilho recriada: nenhum current_date, 3 chamadas a hoje_na_empresa, e o resto IGUAL ao da 0061 —
  -- desfazendo as três trocas, o md5 normalizado volta a ser o da 0061 (o mesmo da pré-condição).
  select p.prosrc into v_corpo from pg_proc p where p.oid = 'erp.batches_fechar_ocupacao()'::regprocedure;
  v_n := (length(v_corpo) - length(replace(v_corpo, 'erp.hoje_na_empresa(', ''))) / length('erp.hoje_na_empresa(');
  if position('current_date' in lower(v_corpo)) > 0 or v_n <> 3 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.batches_fechar_ocupacao() ainda usa current_date ou nao tem 3 chamadas a erp.hoje_na_empresa (tem %).', v_n;
  end if;
  if md5(btrim(regexp_replace(replace(replace(v_corpo, 'erp.hoje_na_empresa(v_empresa_da_area)', 'current_date'),
                                      'erp.hoje_na_empresa(o.empresa_id)', 'current_date'), '[[:space:]]+', ' ', 'g')))
     <> 'abd1b04a22400f0b3ef76c546a765ecb' then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.batches_fechar_ocupacao() difere da 0061 em algo alem das tres trocas de current_date.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_batches_fechar_ocupacao' and tgrelid = 'erp.batches'::regclass
                    and not tgisinternal and tgenabled = 'O' and tgfoid = 'erp.batches_fechar_ocupacao()'::regprocedure
                    and pg_get_triggerdef(oid) like '%AFTER INSERT OR UPDATE OF area_id, status, exit_date, deleted_at ON erp.batches FOR EACH ROW%') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — trg_batches_fechar_ocupacao desligado ou fora da forma da 0061.';
  end if;

  -- erp.batches: as três colunas e os dois CHECKs.
  if (select count(*) from pg_attribute a
       where a.attrelid = 'erp.batches'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
         and a.atttypid = 'text'::regtype and a.attname in ('identificador_nome', 'identificador_sigla', 'identificador_cor')) <> 3 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — colunas identificador_* de erp.batches ausentes ou fora da forma (text, nula, sem default).';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'erp.batches'::regclass and contype = 'c' and convalidated
         and (conname, pg_get_constraintdef(oid)) in (
               ('chk_batches_identificador_cor', 'CHECK (((identificador_cor IS NULL) OR (identificador_cor ~ ''^#[0-9A-Fa-f]{6}$''::text)))'),
               ('chk_batches_identificador_sigla', 'CHECK (((identificador_sigla IS NULL) OR ((char_length(btrim(identificador_sigla)) >= 1) AND (char_length(btrim(identificador_sigla)) <= 4))))'))) <> 2 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — chk_batches_identificador_cor/chk_batches_identificador_sigla ausentes ou fora da forma.';
  end if;

  -- erp.configuracoes_de_icone.
  if to_regclass('erp.configuracoes_de_icone') is null then
    raise exception 'MAPA-MANEJO-02: pos-condicao — a tabela erp.configuracoes_de_icone nao foi criada.';
  end if;
  if not exists (select 1 from pg_class where oid = 'erp.configuracoes_de_icone'::regclass and relrowsecurity and relforcerowsecurity) then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.configuracoes_de_icone sem RLS habilitada e forcada.';
  end if;
  select qual, with_check, roles into v_ref
    from pg_policies where schemaname = 'erp' and tablename = 'areas' and policyname = 'tenant_e_empresa';
  if (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'configuracoes_de_icone') <> 1
     or not exists (select 1 from pg_policies p
                     where p.schemaname = 'erp' and p.tablename = 'configuracoes_de_icone' and p.policyname = 'tenant_e_empresa'
                       and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                       and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.configuracoes_de_icone tem de ter UMA politica, tenant_e_empresa, igual a de erp.areas.';
  end if;
  -- Um privilégio por chamada: has_table_privilege com uma LISTA responde true se QUALQUER um for concedido.
  if has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'DELETE') or has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'TRUNCATE')
     or not (has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'SELECT') and has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'INSERT')
             and has_table_privilege('erp_app', 'erp.configuracoes_de_icone', 'UPDATE')) then
    raise exception 'MAPA-MANEJO-02: pos-condicao — privilegios de erp_app em erp.configuracoes_de_icone fora de select/insert/update.';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'erp.configuracoes_de_icone'::regclass and convalidated
         and conname in ('fk_configuracoes_de_icone_organizacao', 'fk_configuracoes_de_icone_empresa', 'chk_icone_tipo_entidade',
                         'chk_icone_categoria_canonica', 'chk_icone_misto_so_no_misto', 'chk_icone_cor_padrao',
                         'chk_icone_tem_imagem_ou_cor', 'chk_icone_url_https')) <> 8 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — restricoes nomeadas de erp.configuracoes_de_icone incompletas.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_configuracoes_de_icone_empresa' and conrelid = 'erp.configuracoes_de_icone'::regclass
                    and pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id, empresa_id) REFERENCES erp.empresas(organization_id, id)')
     or not exists (select 1 from pg_constraint where conname = 'fk_configuracoes_de_icone_organizacao' and conrelid = 'erp.configuracoes_de_icone'::regclass
                    and pg_get_constraintdef(oid) = 'FOREIGN KEY (organization_id) REFERENCES erp.organizations(id)') then
    raise exception 'MAPA-MANEJO-02: pos-condicao — FK da organizacao ou FK composta da empresa de erp.configuracoes_de_icone fora da forma.';
  end if;
  if (select count(*) from pg_indexes
       where schemaname = 'erp' and tablename = 'configuracoes_de_icone'
         and (indexname, indexdef) in (
               ('uq_configuracoes_de_icone_categoria', 'CREATE UNIQUE INDEX uq_configuracoes_de_icone_categoria ON erp.configuracoes_de_icone USING btree (organization_id, empresa_id, tipo_entidade, categoria) WHERE ((deleted_at IS NULL) AND (categoria <> ''MISTO''::text))'),
               ('ix_configuracoes_de_icone_tipo', 'CREATE INDEX ix_configuracoes_de_icone_tipo ON erp.configuracoes_de_icone USING btree (organization_id, empresa_id, tipo_entidade) WHERE (ativo AND (deleted_at IS NULL))'))) <> 2 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — uq_configuracoes_de_icone_categoria ou ix_configuracoes_de_icone_tipo ausente ou fora da forma.';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'erp.configuracoes_de_icone'::regclass and not t.tgisinternal) <> 2
     or (select count(*) from pg_trigger t
          where t.tgrelid = 'erp.configuracoes_de_icone'::regclass and not t.tgisinternal and t.tgenabled = 'O'
            and (t.tgname, pg_get_triggerdef(t.oid)) in (
                  ('trg_configuracoes_de_icone_updated', 'CREATE TRIGGER trg_configuracoes_de_icone_updated BEFORE UPDATE ON erp.configuracoes_de_icone FOR EACH ROW EXECUTE FUNCTION erp.set_updated_at()'),
                  ('trg_configuracoes_de_icone_audit', 'CREATE TRIGGER trg_configuracoes_de_icone_audit AFTER INSERT OR DELETE OR UPDATE ON erp.configuracoes_de_icone FOR EACH ROW EXECUTE FUNCTION erp.audit_row()'))) <> 2 then
    raise exception 'MAPA-MANEJO-02: pos-condicao — erp.configuracoes_de_icone tem de ter exatamente os gatilhos de updated_at e de auditoria, ligados.';
  end if;
end $$;
