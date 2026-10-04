-- =====================================================================
-- 0055 SAT-06 — RASTER DE VALORES POR PIXEL DA ANÁLISE SATELITAL (arquivo no banco e metadado imutáveis) — decisão 297
--
-- O QUE ESTA MIGRATION FAZ. Dá a uma análise satelital que JÁ EXISTE (erp.analises_satelitais, 0052/0053) a imagem de
-- VALORES do índice pixel a pixel, recortada no polígono — e nada além disso: nenhuma paleta, nenhuma cor, nenhum lote.
-- Duas tabelas NOVAS, as duas imutáveis:
--
--   erp.satelite_raster_arquivos  o ARQUIVO (o PNG de valores, 1 banda, 8 bits). Faz o papel do bucket — o repositório
--                                 não usa Supabase Storage (decisão do Maike): o binário fica no banco, como os anexos
--                                 em erp.attachment_blobs (0009). O endereço é storage_path, na forma
--                                 {organization_id}/{area_id}/{indice}/{AAAA-MM-DD}/{chave_cache}.png (CHECK de forma,
--                                 com o primeiro segmento IGUAL à organização da linha). O BANCO confere que o arquivo é o
--                                 que diz ser: sha256_arquivo = encode(sha256(conteudo), 'hex') e tamanho_bytes =
--                                 octet_length(conteudo), com 1 byte <= conteudo <= 16 MiB. Um caminho por organização
--                                 (unique (organization_id, storage_path)), a chave (organization_id, empresa_id,
--                                 storage_path) e a chave (organization_id, empresa_id, storage_path, sha256_arquivo),
--                                 alvo da FK do metadado.
--                                 SEM AUDITORIA POR LINHA, de propósito: erp.audit_row grava to_jsonb(new) em
--                                 erp.audit_logs — o binário inteiro (até 16 MiB, em hex) iria para o log a cada
--                                 arquivo. A criação do raster é auditada no METADADO (abaixo), que aponta para o arquivo
--                                 e carrega o sha256 dele; o arquivo em si é conferido pelo próprio CHECK do hash.
--   erp.satelite_rasters          o METADADO: de qual análise (FK composta (organização, empresa, área, análise) →
--                                 erp.analises_satelitais (organization_id, empresa_id, area_id, id), a chave
--                                 analises_satelitais_org_empresa_area_key da 0053 — o BANCO confere que o raster é da
--                                 MESMA área da análise), qual arquivo (FK composta (organização, empresa, storage_path,
--                                 sha256_arquivo) → erp.satelite_raster_arquivos: o banco PROÍBE metadado apontando para
--                                 arquivo inexistente, de outra empresa ou com o hash de OUTRO conteúdo — o hash do
--                                 metadado é o do arquivo guardado, e o do arquivo é o do conteúdo, pelo CHECK; duas
--                                 gerações da mesma chave que corram juntas não deixam metadado com o hash do PNG que
--                                 perdeu a corrida), o polígono (geometria_sha256), o índice e o tipo
--                                 ('ndvi', 'valores'), a versão do evalscript, o dia da imagem, as dimensões
--                                 (1..2500 px), o retângulo em EPSG:3857 (quatro colunas, mínimo < máximo), os quatro
--                                 cantos em [lng, lat] (array de 4 pares de números, na ordem que a API grava), a escala
--                                 de decodificação (mínimo < máximo), a resolução em metros, a chave de cache (sha256
--                                 hex; UMA por organização — é ela que o "gerar" reaproveita: on conflict
--                                 (organization_id, chave_cache)) e o PU gasto (anulável). Auditoria de criação
--                                 (erp.audit_row), como a análise da 0052.
--
-- IMUTÁVEIS. UPDATE e DELETE recusados por gatilho de linha e TRUNCATE por gatilho de comando, nas duas tabelas, MESMO
-- para o dono do schema — o gabarito de erp.satelite_consumo_imutavel (0053), numa função PRÓPRIA
-- (erp.satelite_raster_imutavel); a da 0053, que está em produção, não é tocada. E o erp_app só tem SELECT e INSERT.
-- Um raster novo é registrado ao lado do anterior; arquivo sem metadado (a gravação do arquivo passou e a do metadado
-- não) é aceitável e nunca é apagado (decisão 247). Como o arquivo é ALVO da FK do metadado, o TRUNCATE simples dele
-- para na FK (0A000) antes do gatilho; com CASCADE, o gatilho recusa — recusado nos dois caminhos.
--
-- ESCOPO. Tudo aqui é DA ÁREA e responde pelo escopo dela: módulo de escopo empresarial "pecuaria", o mesmo de
-- erp.areas, erp.analises_satelitais e das tabelas da 0053 (scripts/company-rls-modules.json). Categoria A da 0015
-- (empresa obrigatória); a política tenant_e_empresa de cada tabela nova é IDÊNTICA à da 0052 (a pós-condição compara
-- o texto no catálogo, como a 0053 fez). FK de empresa COMPOSTA nas duas — coluna única não prova tenant.
--
-- CONSEQUÊNCIAS DECLARADAS. (1) erp.analises_satelitais passa a ser alvo de mais uma FK (o raster aponta para ela): o
-- TRUNCATE dela já parava na FK da 0053 (0A000), e continua parando. (2) A volta da 0053 (drop da chave
-- analises_satelitais_org_empresa_area_key) passa a exigir a volta da 0055 antes (a FK do raster depende da chave;
-- 2BP01). (3) CRESCIMENTO: o banco passa a guardar imagens — até 16 MiB por arquivo (o PNG de 2500 × 2500 px, 1 byte por
-- pixel, comprimido; fora do polígono é zero e comprime muito). Um arquivo por análise × versão do evalscript × resolução
-- (a chave de cache), só quando alguém pede. O volume entra no backup. Medir o tamanho real em produção: PENDING.
--
-- PRODUÇÃO (decisões 240/247). Duas tabelas NOVAS e VAZIAS e uma função nova. NENHUMA linha existente é escrita,
-- corrigida ou apagada, e nenhuma tabela existente é alterada (nem coluna, nem CHECK, nem índice, nem política). O efeito
-- novo nasce DESLIGADO: nenhuma rota escreve nas tabelas novas até o deploy da API desta fatia, e a geração depende do
-- provedor já configurado da SAT-01 (sem ele, nada é gerado).
--
-- TRAVAS DE TABELA E JANELA. Nenhuma tabela existente pega ACCESS EXCLUSIVE, e nenhuma é lida inteira: a FK criada numa
-- tabela NOVA (vazia) não varre a tabela referenciada. O que trava tabela existente são as FKs:
--   · create table erp.satelite_raster_arquivos — FKs para erp.organizations e erp.empresas: SHARE ROW EXCLUSIVE nas duas;
--   · create table erp.satelite_rasters — FKs para erp.organizations, erp.empresas, erp.users e erp.analises_satelitais:
--     SHARE ROW EXCLUSIVE nas quatro (e na erp.satelite_raster_arquivos, nova).
--   As quatro tabelas existentes ficam com a trava ATÉ O COMMIT: INSERT/UPDATE/DELETE nelas esperam (a leitura não, nem
--   SELECT … FOR UPDATE/FOR KEY SHARE). Índices, gatilhos, RLS, privilégios e comentários são das tabelas novas e não
--   travam nada existente. Cada pedido de trava espera no máximo lock_timeout = 2 s; sem a trava, a migration aborta
--   inteira e o deploy para, sem nada aplicado. O tempo da migration em si é de milissegundos (duas tabelas vazias), mas
--   no pior caso a escrita numa tabela já travada espera a migration obter as seguintes (até ~2 s cada). EXIGE JANELA FORA
--   DO PICO — o mesmo perfil de trava da 0052 e da 0053: todo LOGIN grava erp.users (last_login_at, plugins/auth.ts) e
--   espera; a administração escreve erp.organizations e erp.empresas; erp.analises_satelitais é escrita pela SAT-01 e
--   pelo executor da SAT-03.
--
-- VOLTA. O repositório é forward-only (sem arquivo de descida). O caminho inverso, provado em
-- packages/db/test/sat-06-0055.test.ts (constante SQL_REVERSO), é: conferir que quem desfaz atravessa a RLS, travar as
-- duas tabelas, conferir que as duas estão VAZIAS, dropar erp.satelite_rasters, erp.satelite_raster_arquivos e a função
-- de imutabilidade, e tirar a 0055 do ledger. Nenhuma tabela existente é tocada. FAIL-CLOSED: com QUALQUER raster ou
-- arquivo guardado, a volta para inteira — imagem guardada não se apaga (decisão 247), e o que fazer com ela é decisão
-- humana; e um papel sujeito à RLS (forçada) veria as tabelas vazias e apagaria tudo, por isso ele é recusado antes.
--
-- Trava (2026,89). lock_timeout 2s. O runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 89) then
    raise exception 'SAT-06: outra transacao ja detem a trava desta migration (2026,89). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight (fail-closed: para antes de tocar em qualquer coisa) ----------
do $$
begin
  -- "Já aplicada" ANTES das dependências: na reaplicação, o motivo verdadeiro é este.
  if to_regclass('erp.satelite_raster_arquivos') is not null
     or to_regclass('erp.satelite_rasters') is not null
     or to_regprocedure('erp.satelite_raster_imutavel()') is not null then
    raise exception 'SAT-06: a 0055 ja foi aplicada ou ha schema divergente (satelite_raster_arquivos/satelite_rasters/satelite_raster_imutavel ja existe).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-06: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'SAT-06: funcoes de RLS/auditoria ausentes (tenant_visible, audit_row, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual); a cadeia de migrations esta fora de ordem.';
  end if;
  -- O CHECK do hash do arquivo é calculado pelo banco.
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'SAT-06: funcao sha256(bytea) ausente; o banco nao teria como conferir o hash do arquivo.';
  end if;
  -- A análise (0052) com a chave composta da 0053, alvo da FK do raster: (organização, empresa, área, id), nessa ordem.
  if to_regclass('erp.analises_satelitais') is null then
    raise exception 'SAT-06: erp.analises_satelitais ausente; aplique a 0052 (SAT-01) e a 0053 (SAT-02) antes.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'analises_satelitais'
         and column_name in ('id', 'organization_id', 'empresa_id', 'area_id') and is_nullable = 'NO') <> 4 then
    raise exception 'SAT-06: erp.analises_satelitais sem id/organization_id/empresa_id/area_id obrigatorios; a FK composta do raster exige os quatro.';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'analises_satelitais_org_empresa_area_key' and c.contype = 'u' and c.conrelid = 'erp.analises_satelitais'::regclass
       and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array['organization_id', 'empresa_id', 'area_id', 'id']
  ) then
    raise exception 'SAT-06: chave unica analises_satelitais_org_empresa_area_key (organization_id, empresa_id, area_id, id) ausente em erp.analises_satelitais (0053); a FK composta do raster nao teria alvo.';
  end if;
  -- O raster descreve uma análise que não muda: a imutabilidade da 0052 tem de estar de pé.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O' and t.tgrelid = 'erp.analises_satelitais'::regclass
         and t.tgname in ('trg_analises_satelitais_imutavel', 'trg_analises_satelitais_imutavel_truncate')) <> 2 then
    raise exception 'SAT-06: imutabilidade de erp.analises_satelitais (gatilhos da 0052) ausente ou desligada; o raster apontaria para uma analise que pode mudar.';
  end if;
  -- A política que as tabelas novas copiam, texto a texto.
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa') then
    raise exception 'SAT-06: politica tenant_e_empresa de erp.analises_satelitais ausente (0052); as tabelas novas copiam exatamente essa politica.';
  end if;
  -- A FK de empresa é composta (organização, empresa): o alvo é a chave (organization_id, id) de erp.empresas.
  if to_regclass('erp.empresas') is null or not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('erp.empresas') and c.contype in ('p', 'u')
       and (select array_agg(a.attname::text order by a.attnum)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           @> array['organization_id', 'id']
  ) then
    raise exception 'SAT-06: erp.empresas sem chave (organization_id, id) para a FK composta (0014).';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'SAT-06: modulo de escopo empresarial pecuaria ausente (0011); as tabelas novas nao teriam o escopo da area.';
  end if;
  if to_regclass('erp.users') is null or to_regclass('erp.organizations') is null then
    raise exception 'SAT-06: erp.users ou erp.organizations ausente; criado_por e organization_id nao teriam alvo.';
  end if;
end $$;

-- ---------- 3) erp.satelite_raster_arquivos — o arquivo (SHARE ROW EXCLUSIVE em organizations e empresas) ----------
create table erp.satelite_raster_arquivos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  storage_path text not null,
  conteudo bytea not null,
  sha256_arquivo text not null,
  tamanho_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint fk_satelite_raster_arquivos_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  -- O endereço do arquivo na organização e empresa.
  constraint satelite_raster_arquivos_org_empresa_caminho_key unique (organization_id, empresa_id, storage_path),
  -- Alvo da FK do metadado: o arquivo DA MESMA organização e empresa, naquele caminho, COM aquele hash.
  constraint satelite_raster_arquivos_org_empresa_caminho_sha_key unique (organization_id, empresa_id, storage_path, sha256_arquivo),
  -- Um caminho por organização (o endereço do arquivo não se repete nem entre empresas).
  constraint uq_satelite_raster_arquivos_caminho unique (organization_id, storage_path),
  -- {organization_id}/{area_id}/{indice}/{AAAA-MM-DD}/{chave_cache}.png, com o primeiro segmento = a organização da linha.
  constraint chk_satelite_raster_arquivos_storage_path check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ndvi/[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])/[0-9a-f]{64}[.]png$'
    and split_part(storage_path, '/', 1) = organization_id::text
  ),
  constraint chk_satelite_raster_arquivos_tamanho check (octet_length(conteudo) >= 1 and octet_length(conteudo) <= 16777216),
  -- O BANCO confere que o hash e o tamanho declarados são os do conteúdo gravado.
  constraint chk_satelite_raster_arquivos_sha256 check (sha256_arquivo = encode(sha256(conteudo), 'hex')),
  constraint chk_satelite_raster_arquivos_tamanho_bytes check (tamanho_bytes = octet_length(conteudo))
);

comment on table erp.satelite_raster_arquivos is 'ARQUIVO IMUTÁVEL do raster satelital (SAT-06, decisão 297): o PNG de valores do índice (1 banda, 8 bits) guardado no banco, no papel do bucket (o mesmo de erp.attachment_blobs). O banco confere o hash e o tamanho do conteúdo. Sem auditoria por linha (o binário iria para erp.audit_logs); a criação é auditada no metadado (erp.satelite_rasters). Escopo de empresa = o da área (pecuária).';
comment on column erp.satelite_raster_arquivos.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_raster_arquivos.organization_id is 'Tenant (organização).';
comment on column erp.satelite_raster_arquivos.empresa_id is 'Empresa da área do raster (FK composta).';
comment on column erp.satelite_raster_arquivos.storage_path is 'Endereço do arquivo: {organization_id}/{area_id}/{indice}/{AAAA-MM-DD}/{chave_cache}.png (CHECK de forma; o primeiro segmento é a organização da linha). Único por organização.';
comment on column erp.satelite_raster_arquivos.conteudo is 'O PNG (1 banda, 8 bits: 0 = sem dado; 1..255 = o valor na escala do metadado, de escala_min a escala_max), de 1 byte a 16 MiB.';
comment on column erp.satelite_raster_arquivos.sha256_arquivo is 'SHA-256 (hex) do conteúdo — conferido pelo banco (CHECK = encode(sha256(conteudo), ''hex'')).';
comment on column erp.satelite_raster_arquivos.tamanho_bytes is 'Tamanho do conteúdo em bytes — conferido pelo banco (CHECK = octet_length(conteudo)).';
comment on column erp.satelite_raster_arquivos.created_at is 'Gravação do arquivo.';

-- ---------- 4) erp.satelite_rasters — o metadado (SHARE ROW EXCLUSIVE em organizations, empresas, users e analises_satelitais) ----------
create table erp.satelite_rasters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  analise_id uuid not null,
  geometria_sha256 text not null
    constraint chk_satelite_rasters_geometria_sha256 check (geometria_sha256 ~ '^[0-9a-f]{64}$'),
  -- As listas de valores ficam inline e sozinhas: é a forma que o dicionário de dados lê como "Valores".
  indice text not null
    constraint chk_satelite_rasters_indice check (indice in ('ndvi')),
  tipo text not null
    constraint chk_satelite_rasters_tipo check (tipo in ('valores')),
  versao_evalscript text not null,
  data_imagem date not null,
  storage_path text not null,
  sha256_arquivo text not null
    constraint chk_satelite_rasters_sha256_arquivo check (sha256_arquivo ~ '^[0-9a-f]{64}$'),
  largura integer not null
    constraint chk_satelite_rasters_largura check (largura >= 1 and largura <= 2500),
  altura integer not null
    constraint chk_satelite_rasters_altura check (altura >= 1 and altura <= 2500),
  bbox_min_x numeric not null,
  bbox_min_y numeric not null,
  bbox_max_x numeric not null,
  bbox_max_y numeric not null,
  cantos_lnglat jsonb not null,
  escala_min numeric not null,
  escala_max numeric not null,
  resolucao_m integer not null
    constraint chk_satelite_rasters_resolucao check (resolucao_m > 0),
  chave_cache text not null
    constraint chk_satelite_rasters_chave_cache check (chave_cache ~ '^[0-9a-f]{64}$'),
  pu_gasto numeric(14,4)
    constraint chk_satelite_rasters_pu_gasto check (pu_gasto >= 0),
  criado_por uuid not null references erp.users(id),
  created_at timestamptz not null default now(),
  constraint fk_satelite_rasters_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  -- A análise do raster é da MESMA área (organização, empresa, área, análise) — conferido pelo banco.
  constraint fk_satelite_rasters_analise foreign key (organization_id, empresa_id, area_id, analise_id)
    references erp.analises_satelitais (organization_id, empresa_id, area_id, id),
  -- O arquivo existe, é da MESMA organização e empresa e o hash do metadado é o DELE: metadado sem arquivo, ou com o
  -- hash de outro conteúdo, não entra.
  constraint fk_satelite_rasters_arquivo foreign key (organization_id, empresa_id, storage_path, sha256_arquivo)
    references erp.satelite_raster_arquivos (organization_id, empresa_id, storage_path, sha256_arquivo),
  -- UMA chave de cache por organização: o "gerar" reaproveita (on conflict (organization_id, chave_cache) do nothing).
  constraint uq_satelite_rasters_chave_cache unique (organization_id, chave_cache),
  -- O retângulo em EPSG:3857, não degenerado.
  constraint chk_satelite_rasters_bbox check (bbox_min_x < bbox_max_x and bbox_min_y < bbox_max_y),
  -- Quatro cantos [lng, lat], cada um um array de dois números. Em jsonpath STRICT: o erro de tipo dentro do filtro vira
  -- "desconhecido" (nunca exceção), e o filtro sobre a raiz não desembrulha o array (o modo lax desembrulharia).
  constraint chk_satelite_rasters_cantos check (
    jsonb_path_exists(cantos_lnglat,
      'strict $ ? (@.type() == "array" && @.size() == 4 && !exists(@[*] ? (!(@.type() == "array" && @.size() == 2 && @[0].type() == "number" && @[1].type() == "number"))))')
  ),
  constraint chk_satelite_rasters_escala check (escala_min < escala_max)
);

-- O raster mais recente de cada área (listagem): data da imagem e criação, do mais novo para o mais antigo.
create index ix_satelite_rasters_area_recente on erp.satelite_rasters (organization_id, empresa_id, area_id, indice, data_imagem desc, created_at desc);

comment on table erp.satelite_rasters is 'METADADO IMUTÁVEL do raster satelital de VALORES por pixel (SAT-06, decisão 297): de qual análise (mesma área, FK composta), qual arquivo (FK composta para erp.satelite_raster_arquivos), a grade (dimensões, retângulo EPSG:3857, cantos em lng/lat), a escala de decodificação e a chave de cache (uma por organização). Sem paleta e sem cor. Escopo de empresa = o da área (pecuária).';
comment on column erp.satelite_rasters.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_rasters.organization_id is 'Tenant (organização).';
comment on column erp.satelite_rasters.empresa_id is 'Empresa da área (a mesma da análise e do arquivo).';
comment on column erp.satelite_rasters.area_id is 'Área canônica do raster: a MESMA da análise (FK composta organização, empresa, área, análise).';
comment on column erp.satelite_rasters.analise_id is 'Análise satelital que o raster ilustra (erp.analises_satelitais).';
comment on column erp.satelite_rasters.geometria_sha256 is 'SHA-256 (hex) do polígono recortado (o mesmo hash da análise).';
comment on column erp.satelite_rasters.indice is 'Índice espectral dos valores: ndvi.';
comment on column erp.satelite_rasters.tipo is 'Tipo do raster: valores (o byte codifica o valor; nenhuma cor).';
comment on column erp.satelite_rasters.versao_evalscript is 'Versão do evalscript que gerou os valores. Versões diferentes não se reaproveitam (entra na chave de cache).';
comment on column erp.satelite_rasters.data_imagem is 'Dia (UTC) da imagem: o da observação da análise.';
comment on column erp.satelite_rasters.storage_path is 'Endereço do arquivo em erp.satelite_raster_arquivos (FK composta organização, empresa, caminho, hash).';
comment on column erp.satelite_rasters.sha256_arquivo is 'SHA-256 (hex) do arquivo gravado: o MESMO de erp.satelite_raster_arquivos (a FK composta inclui o hash).';
comment on column erp.satelite_rasters.largura is 'Largura da imagem em pixels (1 a 2500).';
comment on column erp.satelite_rasters.altura is 'Altura da imagem em pixels (1 a 2500).';
comment on column erp.satelite_rasters.bbox_min_x is 'Retângulo da imagem em EPSG:3857: x mínimo (metros).';
comment on column erp.satelite_rasters.bbox_min_y is 'Retângulo da imagem em EPSG:3857: y mínimo (metros).';
comment on column erp.satelite_rasters.bbox_max_x is 'Retângulo da imagem em EPSG:3857: x máximo (metros; maior que o mínimo).';
comment on column erp.satelite_rasters.bbox_max_y is 'Retângulo da imagem em EPSG:3857: y máximo (metros; maior que o mínimo).';
comment on column erp.satelite_rasters.cantos_lnglat is 'Os quatro cantos em [lng, lat] (superior esquerdo, superior direito, inferior direito, inferior esquerdo): array de 4 pares de números.';
comment on column erp.satelite_rasters.escala_min is 'Valor do índice que o byte 1 representa (decodificação: (byte − 1) / 254 × (máx − mín) + mín; byte 0 = sem dado).';
comment on column erp.satelite_rasters.escala_max is 'Valor do índice que o byte 255 representa (maior que escala_min).';
comment on column erp.satelite_rasters.resolucao_m is 'Tamanho do pixel no terreno, em metros (maior que a resolução alvo quando a área grande foi reduzida).';
comment on column erp.satelite_rasters.chave_cache is 'SHA-256 (hex) dos parâmetros que determinam a imagem (polígono, dia, coleção, evalscript, resolução, CRS, formato, escala). Única por organização.';
comment on column erp.satelite_rasters.pu_gasto is 'Processing units cobradas pela geração, como o provedor informou; nulo quando não informado.';
comment on column erp.satelite_rasters.criado_por is 'Usuário que pediu o raster.';
comment on column erp.satelite_rasters.created_at is 'Registro do raster (nunca é a data da imagem).';

-- ---------- 5) gatilhos: imutabilidade das duas tabelas e auditoria do metadado ----------
-- Não lê OLD nem NEW (gabarito da 0052/0053): recusa a operação inteira, até para o dono do schema.
create function erp.satelite_raster_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: O raster satelital registrado (arquivo e metadado) não se altera nem se apaga: um raster novo é registrado ao lado do anterior.' using errcode = 'P0001';
end $$;

comment on function erp.satelite_raster_imutavel() is 'SAT-06: raster imutável — recusa UPDATE e DELETE (gatilho por linha) e TRUNCATE (gatilho por comando) em erp.satelite_raster_arquivos e erp.satelite_rasters com CONFLICT, inclusive para o dono do schema.';
-- Gatilho não precisa de execute de quem grava: ninguém além do dono executa a função (a 0007 dá execute ao erp_app por
-- privilégio padrão; tira-se explicitamente).
revoke execute on function erp.satelite_raster_imutavel() from public, erp_app;

create trigger trg_satelite_raster_arquivos_imutavel
  before update or delete on erp.satelite_raster_arquivos
  for each row execute function erp.satelite_raster_imutavel();

create trigger trg_satelite_raster_arquivos_imutavel_truncate
  before truncate on erp.satelite_raster_arquivos
  for each statement execute function erp.satelite_raster_imutavel();

create trigger trg_satelite_rasters_imutavel
  before update or delete on erp.satelite_rasters
  for each row execute function erp.satelite_raster_imutavel();

create trigger trg_satelite_rasters_imutavel_truncate
  before truncate on erp.satelite_rasters
  for each statement execute function erp.satelite_raster_imutavel();

-- Só o metadado é auditado (o arquivo levaria o binário para erp.audit_logs; ver o cabeçalho).
create trigger trg_satelite_rasters_audit
  after insert on erp.satelite_rasters
  for each row execute function erp.audit_row();

-- ---------- 6) RLS e privilégios (categoria A da 0015; a política é a MESMA da 0052) ----------
alter table erp.satelite_raster_arquivos enable row level security;
alter table erp.satelite_raster_arquivos force row level security;
create policy tenant_e_empresa on erp.satelite_raster_arquivos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.satelite_rasters enable row level security;
alter table erp.satelite_rasters force row level security;
create policy tenant_e_empresa on erp.satelite_rasters for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- A 0007 concede por padrão select/insert/update/delete no schema erp: o que não cabe é revogado EXPLICITAMENTE.
grant select, insert on erp.satelite_raster_arquivos to erp_app;
revoke update, delete, truncate on erp.satelite_raster_arquivos from erp_app;
grant select, insert on erp.satelite_rasters to erp_app;
revoke update, delete, truncate on erp.satelite_rasters from erp_app;

-- ---------- 7) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
declare
  v_tabela text;
  v_ref record;
  v_fk record;
  v_ch record;
begin
  select qual, with_check, roles into v_ref
    from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa';

  foreach v_tabela in array array['satelite_raster_arquivos', 'satelite_rasters'] loop
    if to_regclass('erp.' || v_tabela) is null then
      raise exception 'SAT-06: a tabela erp.% nao foi criada.', v_tabela;
    end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'erp' and c.relname = v_tabela and not (c.relrowsecurity and c.relforcerowsecurity)) then
      raise exception 'SAT-06: erp.% sem RLS habilitada e forcada.', v_tabela;
    end if;
    if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = v_tabela)
       is distinct from array['tenant_e_empresa'] then
      raise exception 'SAT-06: politica de erp.% diferente de tenant_e_empresa (uma so).', v_tabela;
    end if;
    -- A MESMA política da 0052, comparada pelo texto que o catálogo devolve (using, with check e papéis).
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'erp' and p.tablename = v_tabela and p.policyname = 'tenant_e_empresa'
                      and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                      and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
      raise exception 'SAT-06: politica tenant_e_empresa de erp.% diverge da de erp.analises_satelitais (0052).', v_tabela;
    end if;
  end loop;

  -- As colunas, na ordem, com tipo e obrigatoriedade: só pu_gasto é anulável.
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attnum)
        from pg_attribute a where a.attrelid = 'erp.satelite_raster_arquivos'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id uuid not null, organization_id uuid not null, empresa_id uuid not null, storage_path text not null, conteudo bytea not null, '
                      'sha256_arquivo text not null, tamanho_bytes integer not null, created_at timestamp with time zone not null' then
    raise exception 'SAT-06: colunas de erp.satelite_raster_arquivos fora do contrato.';
  end if;
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attnum)
        from pg_attribute a where a.attrelid = 'erp.satelite_rasters'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id uuid not null, organization_id uuid not null, empresa_id uuid not null, area_id uuid not null, analise_id uuid not null, '
                      'geometria_sha256 text not null, indice text not null, tipo text not null, versao_evalscript text not null, data_imagem date not null, '
                      'storage_path text not null, sha256_arquivo text not null, largura integer not null, altura integer not null, '
                      'bbox_min_x numeric not null, bbox_min_y numeric not null, bbox_max_x numeric not null, bbox_max_y numeric not null, '
                      'cantos_lnglat jsonb not null, escala_min numeric not null, escala_max numeric not null, resolucao_m integer not null, '
                      'chave_cache text not null, pu_gasto numeric(14,4), criado_por uuid not null, created_at timestamp with time zone not null' then
    raise exception 'SAT-06: colunas de erp.satelite_rasters fora do contrato.';
  end if;

  -- As FKs, sem cascata e validadas, coluna a coluna (origem e alvo): as compostas de empresa, da análise e do arquivo, e
  -- as de tenant e de usuário.
  for v_fk in
    select * from (values
      ('satelite_raster_arquivos', 'empresas', array['organization_id', 'empresa_id'], array['organization_id', 'id']),
      ('satelite_raster_arquivos', 'organizations', array['organization_id'], array['id']),
      ('satelite_rasters', 'empresas', array['organization_id', 'empresa_id'], array['organization_id', 'id']),
      ('satelite_rasters', 'organizations', array['organization_id'], array['id']),
      ('satelite_rasters', 'users', array['criado_por'], array['id']),
      ('satelite_rasters', 'analises_satelitais', array['organization_id', 'empresa_id', 'area_id', 'analise_id'], array['organization_id', 'empresa_id', 'area_id', 'id']),
      ('satelite_rasters', 'satelite_raster_arquivos', array['organization_id', 'empresa_id', 'storage_path', 'sha256_arquivo'], array['organization_id', 'empresa_id', 'storage_path', 'sha256_arquivo'])
    ) as f(origem, alvo, colunas, colunas_alvo)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.contype = 'f' and c.conrelid = ('erp.' || v_fk.origem)::regclass
         and c.confrelid = ('erp.' || v_fk.alvo)::regclass and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_fk.colunas
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = v_fk.colunas_alvo
    ) then
      raise exception 'SAT-06: FK erp.%(%) -> erp.%(%) (sem cascata, validada) ausente.', v_fk.origem, array_to_string(v_fk.colunas, ', '), v_fk.alvo, array_to_string(v_fk.colunas_alvo, ', ');
    end if;
  end loop;
  if (select count(*) from pg_constraint c where c.contype = 'f' and c.conrelid = 'erp.satelite_raster_arquivos'::regclass) <> 2
     or (select count(*) from pg_constraint c where c.contype = 'f' and c.conrelid = 'erp.satelite_rasters'::regclass) <> 5 then
    raise exception 'SAT-06: as tabelas novas tem FKs alem das declaradas (2 no arquivo, 5 no metadado).';
  end if;

  -- As chaves únicas pelo NOME, coluna a coluna.
  for v_fk in
    select * from (values
      ('satelite_raster_arquivos', 'satelite_raster_arquivos_org_empresa_caminho_key', array['organization_id', 'empresa_id', 'storage_path']),
      ('satelite_raster_arquivos', 'satelite_raster_arquivos_org_empresa_caminho_sha_key', array['organization_id', 'empresa_id', 'storage_path', 'sha256_arquivo']),
      ('satelite_raster_arquivos', 'uq_satelite_raster_arquivos_caminho', array['organization_id', 'storage_path']),
      ('satelite_rasters', 'uq_satelite_rasters_chave_cache', array['organization_id', 'chave_cache'])
    ) as u(tabela, nome, colunas)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conname = v_fk.nome and c.contype = 'u' and c.conrelid = ('erp.' || v_fk.tabela)::regclass
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_fk.colunas
    ) then
      raise exception 'SAT-06: chave unica % de erp.% ausente ou com outras colunas.', v_fk.nome, v_fk.tabela;
    end if;
  end loop;

  -- CHECKs pelo NOME: o conjunto é EXATAMENTE este (nenhum a mais, nenhum a menos, todos validados).
  for v_ch in
    select * from (values
      ('satelite_raster_arquivos', array['chk_satelite_raster_arquivos_sha256', 'chk_satelite_raster_arquivos_storage_path',
                                         'chk_satelite_raster_arquivos_tamanho', 'chk_satelite_raster_arquivos_tamanho_bytes']),
      ('satelite_rasters', array['chk_satelite_rasters_altura', 'chk_satelite_rasters_bbox', 'chk_satelite_rasters_cantos', 'chk_satelite_rasters_chave_cache',
                                 'chk_satelite_rasters_escala', 'chk_satelite_rasters_geometria_sha256', 'chk_satelite_rasters_indice', 'chk_satelite_rasters_largura',
                                 'chk_satelite_rasters_pu_gasto', 'chk_satelite_rasters_resolucao', 'chk_satelite_rasters_sha256_arquivo', 'chk_satelite_rasters_tipo'])
    ) as k(tabela, nomes)
  loop
    if (select array_agg(c.conname::text order by c.conname) from pg_constraint c
         where c.conrelid = ('erp.' || v_ch.tabela)::regclass and c.contype = 'c' and c.convalidated) is distinct from v_ch.nomes then
      raise exception 'SAT-06: CHECKs de erp.% diferentes dos declarados (%).', v_ch.tabela, array_to_string(v_ch.nomes, ', ');
    end if;
  end loop;
  -- Os CHECKs que o arquivo usa para provar o que é olham as colunas certas (o comportamento é provado no teste).
  for v_ch in
    select * from (values
      ('chk_satelite_raster_arquivos_sha256', array['conteudo', 'sha256_arquivo']),
      ('chk_satelite_raster_arquivos_tamanho', array['conteudo']),
      ('chk_satelite_raster_arquivos_tamanho_bytes', array['conteudo', 'tamanho_bytes']),
      ('chk_satelite_raster_arquivos_storage_path', array['organization_id', 'storage_path'])
    ) as k(nome, colunas)
  loop
    if (select array_agg(a.attname::text order by a.attname::text) from pg_constraint c
          cross join lateral unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.conname = v_ch.nome and c.conrelid = 'erp.satelite_raster_arquivos'::regclass) is distinct from v_ch.colunas then
      raise exception 'SAT-06: CHECK % de erp.satelite_raster_arquivos fora do contrato (colunas esperadas: %).', v_ch.nome, array_to_string(v_ch.colunas, ', ');
    end if;
  end loop;

  -- O índice da listagem, com a definição inteira (o schema sai do texto: pg_get_indexdef o omite quando erp está no
  -- search_path de quem aplica).
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('erp.ix_satelite_rasters_area_recente') and i.indisvalid
                    and regexp_replace(pg_get_indexdef(i.indexrelid), ' ON (erp\.)?', ' ON ')
                        = 'CREATE INDEX ix_satelite_rasters_area_recente ON satelite_rasters USING btree (organization_id, empresa_id, area_id, indice, data_imagem DESC, created_at DESC)') then
    raise exception 'SAT-06: indice erp.ix_satelite_rasters_area_recente ausente ou fora do contrato.';
  end if;

  -- Gatilhos: EXATAMENTE estes cinco (nenhum outro, nem desligado), ligados, na função e no momento certos —
  -- imutabilidade (BEFORE UPDATE/DELETE por linha e BEFORE TRUNCATE por comando) nas duas, e auditoria (AFTER INSERT por
  -- linha) SÓ no metadado. tgtype: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32. A função é comparada
  -- pelo OID (o texto de regprocedure depende do search_path de quem aplica).
  if (select array_agg(c.relname || '.' || t.tgname || ' tipo=' || t.tgtype
                       || case t.tgfoid when 'erp.satelite_raster_imutavel()'::regprocedure then ' imutavel'
                                        when 'erp.audit_row()'::regprocedure then ' auditoria' else ' outra' end
                       || case when t.tgenabled = 'O' and t.tgqual is null then '' else ' desligado-ou-condicional' end
                       order by c.relname, t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and t.tgrelid in ('erp.satelite_raster_arquivos'::regclass, 'erp.satelite_rasters'::regclass))
     is distinct from array[
       'satelite_raster_arquivos.trg_satelite_raster_arquivos_imutavel tipo=27 imutavel',
       'satelite_raster_arquivos.trg_satelite_raster_arquivos_imutavel_truncate tipo=34 imutavel',
       'satelite_rasters.trg_satelite_rasters_audit tipo=5 auditoria',
       'satelite_rasters.trg_satelite_rasters_imutavel tipo=27 imutavel',
       'satelite_rasters.trg_satelite_rasters_imutavel_truncate tipo=34 imutavel'] then
    raise exception 'SAT-06: gatilhos das tabelas novas fora do contrato (imutabilidade por linha e por comando nas duas; auditoria so no metadado).';
  end if;
  -- A função de imutabilidade: INVOKER, search_path fixo, sem execute para PUBLIC nem erp_app.
  if not exists (select 1 from pg_proc p where p.oid = 'erp.satelite_raster_imutavel()'::regprocedure
                   and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp'])
     or has_function_privilege('public', 'erp.satelite_raster_imutavel()', 'EXECUTE')
     or has_function_privilege('erp_app', 'erp.satelite_raster_imutavel()', 'EXECUTE') then
    raise exception 'SAT-06: erp.satelite_raster_imutavel() fora do contrato (SECURITY INVOKER, search_path = erp, pg_temp, sem execute para public/erp_app).';
  end if;

  -- Privilégios do erp_app: SELECT e INSERT nas duas, e NADA além disso.
  if not (has_table_privilege('erp_app', 'erp.satelite_raster_arquivos', 'SELECT') and has_table_privilege('erp_app', 'erp.satelite_raster_arquivos', 'INSERT')
          and has_table_privilege('erp_app', 'erp.satelite_rasters', 'SELECT') and has_table_privilege('erp_app', 'erp.satelite_rasters', 'INSERT')) then
    raise exception 'SAT-06: erp_app sem SELECT/INSERT nas tabelas novas; a API nao leria nem gravaria o raster.';
  end if;
  if has_table_privilege('erp_app', 'erp.satelite_raster_arquivos', 'UPDATE') or has_table_privilege('erp_app', 'erp.satelite_raster_arquivos', 'DELETE')
     or has_table_privilege('erp_app', 'erp.satelite_raster_arquivos', 'TRUNCATE')
     or has_table_privilege('erp_app', 'erp.satelite_rasters', 'UPDATE') or has_table_privilege('erp_app', 'erp.satelite_rasters', 'DELETE')
     or has_table_privilege('erp_app', 'erp.satelite_rasters', 'TRUNCATE') then
    raise exception 'SAT-06: erp_app com UPDATE/DELETE/TRUNCATE nas tabelas novas; o raster deixaria de ser imutavel.';
  end if;
end $$;
