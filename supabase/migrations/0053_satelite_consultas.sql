-- =====================================================================
-- 0053 SAT-02 — CONSULTA SATELITAL EM LOTE (fila, ledger de consumo e orçamento) — decisão 295
--
-- O QUE ESTA MIGRATION FAZ. Dá à análise satelital da SAT-01 (0052) o pedido EM LOTE: várias áreas × vários períodos
-- × índices numa consulta só, com a estimativa de créditos gravada antes de qualquer processamento.
--
--   erp.satelite_consultas      o PEDIDO: os parâmetros como chegaram, a faixa estimada de créditos (mínimo e máximo),
--                               a situação e os contadores. Muda de estado (pendente → executando → concluída…).
--   erp.satelite_consulta_itens a FILA: um item por área × janela × índice, com a chave de idempotência (sha256 da
--                               origem legível, calculado na API). UM item VIVO (pendente/executando/concluido) por
--                               organização e chave: o mesmo polígono, na mesma janela e no mesmo método, não se
--                               processa duas vezes.
--                               'reaproveitado', 'falho' e 'cancelado' podem repetir a chave (a consulta seguinte que
--                               reaproveitou registra o item ao lado, e o que falhou pode ser pedido de novo).
--   erp.satelite_consumo        o LEDGER de consumo do provedor (PU = processing units; 1 crédito = 0,01 PU): só
--                               acrescenta. UPDATE e DELETE recusados por gatilho de linha e TRUNCATE por gatilho de
--                               comando, mesmo para o dono do schema (gabarito da 0052/0047).
--   erp.satelite_orcamentos     o limite de créditos por empresa e mês. SEM LINHA = SEM LIMITE; nenhum valor padrão é
--                               inventado aqui. Nenhuma rota escreve orçamento nesta fatia (erp_app só lê).
--   erp.analises_satelitais     ganha quatro colunas ANULÁVEIS (o item da fila que a produziu, a resolução nativa, o
--                               sha256 do evalscript e a data alvo do slot) e a chave única (organization_id,
--                               empresa_id, area_id, id), alvo da FK composta do item → análise (a análise de um item é
--                               sempre da área do item). A unicidade uq_analises_satelitais_janela é REFEITA com O MESMO
--                               NOME, agora com data_alvo e NULLS NOT DISTINCT: dois slots da mesma janela com datas alvo
--                               diferentes deixam de colidir, e a análise avulsa da SAT-01 (data_alvo nula) continua com
--                               exatamente a mesma unicidade de antes — a rota da SAT-01, a desta versão e a da versão
--                               ANTERIOR (job de skew), usa `on conflict on constraint uq_analises_satelitais_janela`, e
--                               por isso o nome não muda. NULLS NOT DISTINCT exige PostgreSQL 15+ (o preflight confere).
--
-- NENHUMA ROTA DESTA FATIA CHAMA O PROVEDOR. A fila nasce para um executor futuro; até lá ela só é escrita pela
-- API (pedido e itens) e lida pelo histórico.
--
-- ESCOPO. Tudo aqui é DA ÁREA e responde pelo escopo dela: módulo de escopo empresarial "pecuaria", o mesmo de
-- erp.areas e de erp.analises_satelitais (scripts/company-rls-modules.json). Categoria A da 0015 (empresa
-- obrigatória); a política tenant_e_empresa de cada tabela nova é IDÊNTICA à da 0052 (a pós-condição compara o
-- texto das duas no catálogo). FKs de empresa COMPOSTAS em tudo — coluna única não prova tenant nem empresa — e os
-- VÍNCULOS IMUTÁVEIS conferidos pelo BANCO, não pela aplicação: item → consulta e item → área na mesma (organização,
-- empresa); item → análise e análise → item pela MESMA ÁREA (organização, empresa, área, id); consumo → item pela
-- MESMA CONSULTA (organização, empresa, consulta, item), e consumo com item exige a consulta.
--
-- AUDITORIA (erp.audit_row). Orçamento: criação, alteração e exclusão (o costume das tabelas de negócio). Consulta:
-- criação e exclusão sempre; alteração SÓ quando a situação muda — o executor (SAT-03) avança os contadores item a item,
-- e cada avanço viraria uma linha de auditoria com o antes e o depois inteiros (parâmetros incluídos). Consumo: a
-- criação (como a análise da 0052; o ledger não muda depois). Itens da fila: SEM auditoria por linha — são
-- até 200 por consulta e mudam de situação a cada tentativa; a história deles está na consulta auditada, no próprio
-- item e no ledger de consumo (gabarito da 0040: auditoria no cabeçalho, não no item).
--
-- CONSEQUÊNCIAS DECLARADAS. (1) Área com item na fila não muda de empresa (a FK composta item → área recusa, 23503),
-- como a área com análise da 0052. (2) A análise continua imutável: as colunas novas só se preenchem na INSERÇÃO de
-- uma análise nova (as antigas ficam com NULL para sempre). (3) erp.analises_satelitais passa a ser ALVO de FK (o
-- item aponta para ela): o TRUNCATE simples dela para na FK (0A000) antes de chegar ao gatilho de comando da 0052; com
-- CASCADE, o gatilho recusa — continua recusado nos dois caminhos.
--
-- PRODUÇÃO (decisões 240/247). Quatro tabelas NOVAS e VAZIAS; quatro colunas ANULÁVEIS, sem default, em
-- erp.analises_satelitais; uma chave única NOVA sobre colunas que já existem (id já é único: não tem como recusar
-- acervo); a unicidade da janela refeita com data_alvo (nula em todo o acervo, e NULLS NOT DISTINCT: é a MESMA
-- unicidade que o acervo já cumpre — não tem como recusá-lo). NADA é regravado nem escrito: ADD COLUMN sem default
-- não regrava a tabela (as linhas existentes leem NULL pelo catálogo), e o gatilho de imutabilidade da 0052, que é de
-- linha, não é acionado por DDL. NENHUM dado existente é escrito, corrigido ou apagado. O efeito novo nasce DESLIGADO:
-- nenhuma rota desta fatia chama o provedor.
--
-- TRAVAS DE TABELA E JANELA.
--   · Os CREATE TABLE com FK pegam SHARE ROW EXCLUSIVE em erp.organizations, erp.empresas, erp.users e erp.areas e a
--     SEGURAM ATÉ O COMMIT: durante a migration, INSERT/UPDATE/DELETE nessas quatro tabelas esperam (a leitura não).
--     Cada pedido de trava espera no máximo lock_timeout = 2 s, então no pior caso a escrita nelas fica parada por até
--     ~2 s além do tempo da própria migration. Aplicar FORA DO PICO.
--   · O que pega ACCESS EXCLUSIVE em tabela EXISTENTE — as colunas novas, os CHECKs delas, a chave única nova de
--     erp.analises_satelitais, a unicidade da janela refeita (DROP + ADD CONSTRAINT na mesma transação: o índice dela é
--     RECONSTRUÍDO) e as duas FKs que dependem da chave nova — é a ÚLTIMA coisa do arquivo, depois de todas as outras
--     travas obtidas. NÃO é "só catálogo": o ADD COLUMN com CHECK e o CHECK da data alvo (conferir) e as duas chaves
--     únicas (montar o índice) LEEM a tabela inteira sob ACCESS EXCLUSIVE — sem regravar —, e leitura e escrita de
--     análises esperam até o commit. O volume de erp.analises_satelitais em produção NÃO foi medido: PENDING
--     (esperado pequeno — uma linha por análise pedida desde a SAT-01). Sem a trava em 2 s, a migration aborta inteira
--     e o deploy para, sem nada aplicado.
--
-- VOLTA. O repositório é forward-only (sem arquivo de descida). O caminho inverso, provado em
-- packages/db/test/sat-02-0053.test.ts (constante SQL_REVERSO), é: soltar a FK análise → item, dropar as quatro
-- tabelas (consumo, itens, consultas, orçamentos), a função de imutabilidade do consumo, a chave única nova, devolver
-- a uq_analises_satelitais_janela da 0052, dropar as quatro colunas de erp.analises_satelitais e tirar a 0053 do
-- ledger. Só por decisão humana: apagaria a fila e o consumo. FAIL-CLOSED: se já houver duas análises na mesma janela
-- com datas alvo diferentes (o que só a 0053 permite), a unicidade da 0052 não se reconstrói (23505) e a volta inteira
-- para — análise não se apaga, e o que fazer com esse acervo é decisão humana.
--
-- Trava (2026,87). lock_timeout 2s. O runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 87) then
    raise exception 'SAT-02: outra transacao ja detem a trava desta migration (2026,87). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight (fail-closed: para antes de tocar em qualquer coisa) ----------
do $$
begin
  -- "Já aplicada" ANTES das dependências: na reaplicação, o motivo verdadeiro é este.
  if to_regclass('erp.satelite_consultas') is not null
     or to_regclass('erp.satelite_consulta_itens') is not null
     or to_regclass('erp.satelite_consumo') is not null
     or to_regclass('erp.satelite_orcamentos') is not null
     or to_regprocedure('erp.satelite_consumo_imutavel()') is not null
     or exists (select 1 from pg_constraint where conname = 'analises_satelitais_org_empresa_area_key')
     or exists (select 1 from information_schema.columns
                 where table_schema = 'erp' and table_name = 'analises_satelitais'
                   and column_name in ('consulta_item_id', 'resolucao_nativa_m', 'evalscript_sha256', 'data_alvo')) then
    raise exception 'SAT-02: a 0053 ja foi aplicada ou ha schema divergente (satelite_consultas/satelite_consulta_itens/satelite_consumo/satelite_orcamentos/satelite_consumo_imutavel/analises_satelitais_org_empresa_area_key ou coluna nova de analises_satelitais ja existe).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-02: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
  end if;
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'SAT-02: PostgreSQL % sem UNIQUE NULLS NOT DISTINCT (exige 15+); a unicidade da janela com data_alvo nao teria como ser criada.', current_setting('server_version');
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.set_updated_at()') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'SAT-02: funcoes de RLS/auditoria ausentes (tenant_visible, audit_row, set_updated_at, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual); a cadeia de migrations esta fora de ordem.';
  end if;
  -- A 0052: o histórico de análises, com a empresa obrigatória, a imutabilidade e a política que as tabelas novas copiam.
  if to_regclass('erp.analises_satelitais') is null then
    raise exception 'SAT-02: erp.analises_satelitais ausente; aplique a 0052 (SAT-01) antes.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'analises_satelitais'
         and column_name in ('id', 'organization_id', 'empresa_id', 'area_id') and is_nullable = 'NO') <> 4 then
    raise exception 'SAT-02: erp.analises_satelitais sem id/organization_id/empresa_id/area_id obrigatorios; a chave unica composta nova exige os quatro.';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgrelid = to_regclass('erp.analises_satelitais')
         and t.tgname in ('trg_analises_satelitais_conferir', 'trg_analises_satelitais_imutavel', 'trg_analises_satelitais_imutavel_truncate')) <> 3 then
    raise exception 'SAT-02: gatilhos da 0052 (conferencia e imutabilidade de erp.analises_satelitais) ausentes; schema divergente.';
  end if;
  -- A unicidade da janela EXATAMENTE como a 0052 a criou (é ela que a 0053 refaz com o mesmo nome).
  if not exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid = c.conindid
     where c.conname = 'uq_analises_satelitais_janela' and c.contype = 'u' and c.conrelid = to_regclass('erp.analises_satelitais')
       and not i.indnullsnotdistinct
       and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['organization_id', 'area_id', 'provedor', 'colecao', 'indice', 'versao_metodo', 'geometria_sha256', 'janela_inicio', 'janela_fim']
  ) then
    raise exception 'SAT-02: uq_analises_satelitais_janela de erp.analises_satelitais fora da forma da 0052 (9 colunas, nulos distintos); schema divergente.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa') then
    raise exception 'SAT-02: politica tenant_e_empresa de erp.analises_satelitais ausente (0052); as tabelas novas copiam exatamente essa politica.';
  end if;
  -- A área canônica: empresa obrigatória e a chave única (organização, empresa, id) que a 0052 criou para a FK composta.
  if to_regclass('erp.areas') is null or exists (
       select 1 from information_schema.columns
        where table_schema = 'erp' and table_name = 'areas' and column_name = 'empresa_id' and is_nullable = 'YES') then
    raise exception 'SAT-02: erp.areas ausente ou com empresa_id anulavel; a FK composta do item exige empresa obrigatoria na area.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'areas_org_empresa_key' and contype = 'u' and conrelid = to_regclass('erp.areas')) then
    raise exception 'SAT-02: chave unica areas_org_empresa_key ausente em erp.areas (0052); a FK composta do item nao teria alvo.';
  end if;
  -- O pedido por retiro lê erp.areas.retiro_id (0050).
  if to_regclass('erp.retiros') is null or not exists (
       select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'areas' and column_name = 'retiro_id') then
    raise exception 'SAT-02: erp.retiros ou erp.areas.retiro_id ausente (0050); a consulta por retiro nao teria de onde ler.';
  end if;
  -- A FK de empresa é composta (organização, empresa): o alvo é a chave (organization_id, id) de erp.empresas.
  if to_regclass('erp.empresas') is null or not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('erp.empresas') and c.contype in ('p', 'u')
       and (select array_agg(a.attname::text order by a.attnum)
              from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k)
           @> array['organization_id', 'id']
  ) then
    raise exception 'SAT-02: erp.empresas sem chave (organization_id, id) para a FK composta (0014).';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'SAT-02: modulo de escopo empresarial pecuaria ausente (0011); as tabelas novas nao teriam o escopo da area.';
  end if;
  if to_regclass('erp.users') is null or to_regclass('erp.organizations') is null then
    raise exception 'SAT-02: erp.users ou erp.organizations ausente; criado_por e organization_id nao teriam alvo.';
  end if;
end $$;

-- ---------- 3) erp.satelite_consultas — o pedido ----------
create table erp.satelite_consultas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  criado_por uuid not null references erp.users(id),
  parametros jsonb not null,
  estimativa_creditos numeric(16,2) not null,
  estimativa_creditos_minima numeric(16,2) not null,
  -- As listas de valores ficam inline e sozinhas: é a forma que o dicionário de dados lê como "Valores".
  situacao text not null default 'pendente'
    constraint chk_satelite_consultas_situacao check (situacao in ('pendente', 'executando', 'concluida', 'concluida_com_falhas', 'cancelada')),
  total_itens integer not null default 0,
  total_concluidos integer not null default 0,
  total_falhos integer not null default 0,
  total_reaproveitados integer not null default 0,
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_satelite_consultas_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint satelite_consultas_org_empresa_key unique (organization_id, empresa_id, id),
  constraint chk_satelite_consultas_parametros check (jsonb_typeof(parametros) = 'object'),
  -- A faixa inteira fica gravada: o máximo é o que reserva orçamento, o mínimo é o que a tela mostra junto.
  constraint chk_satelite_consultas_estimativa check (estimativa_creditos_minima >= 0 and estimativa_creditos_minima <= estimativa_creditos),
  constraint chk_satelite_consultas_contadores check (
    total_itens >= 0 and total_concluidos >= 0 and total_falhos >= 0 and total_reaproveitados >= 0
    and total_concluidos + total_falhos + total_reaproveitados <= total_itens
  ),
  constraint chk_satelite_consultas_concluida_em check (concluida_em is null or situacao in ('concluida', 'concluida_com_falhas', 'cancelada'))
);

create index ix_satelite_consultas_historico on erp.satelite_consultas (organization_id, empresa_id, created_at desc, id desc);
-- O histórico SEM empresa fixa (escopo de várias empresas): a ordem da página sem depender do recorte por empresa.
create index ix_satelite_consultas_historico_org on erp.satelite_consultas (organization_id, created_at desc, id desc);

comment on table erp.satelite_consultas is 'Pedido de consulta satelital EM LOTE (SAT-02, decisão 295): áreas × períodos × índices, com a faixa estimada de créditos gravada antes de qualquer processamento. Muda de estado; escopo de empresa = o da área (pecuária).';
comment on column erp.satelite_consultas.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_consultas.organization_id is 'Tenant (organização).';
comment on column erp.satelite_consultas.empresa_id is 'Empresa das áreas pedidas: uma consulta é de UMA empresa (FK composta).';
comment on column erp.satelite_consultas.criado_por is 'Usuário que confirmou a consulta.';
comment on column erp.satelite_consultas.parametros is 'O corpo do pedido como chegou (alvo, período, índices). Objeto JSON.';
comment on column erp.satelite_consultas.estimativa_creditos is 'MÁXIMO da faixa estimada de créditos (1 crédito = 0,01 PU) dos itens novos; é o que reserva orçamento.';
comment on column erp.satelite_consultas.estimativa_creditos_minima is 'MÍNIMO da faixa estimada de créditos dos itens novos (≤ estimativa_creditos).';
comment on column erp.satelite_consultas.situacao is 'pendente, executando, concluida, concluida_com_falhas ou cancelada.';
comment on column erp.satelite_consultas.total_itens is 'Itens da consulta (áreas × janelas × índices), reaproveitados incluídos.';
comment on column erp.satelite_consultas.total_concluidos is 'Itens concluídos pelo executor.';
comment on column erp.satelite_consultas.total_falhos is 'Itens que falharam em definitivo.';
comment on column erp.satelite_consultas.total_reaproveitados is 'Itens cuja chave já tinha item vivo: não consomem crédito.';
comment on column erp.satelite_consultas.concluida_em is 'Quando a consulta terminou (só em concluida, concluida_com_falhas ou cancelada).';
comment on column erp.satelite_consultas.created_at is 'Registro do pedido.';
comment on column erp.satelite_consultas.updated_at is 'Última mudança (gatilho erp.set_updated_at).';

-- ---------- 4) erp.satelite_consulta_itens — a fila (a FK da análise entra no fim, junto da chave única que ela exige) ----------
create table erp.satelite_consulta_itens (
  id uuid primary key default gen_random_uuid(),
  consulta_id uuid not null,
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  area_id uuid not null,
  geometria_sha256 text not null
    constraint chk_satelite_consulta_itens_geometria_sha256 check (geometria_sha256 ~ '^[0-9a-f]{64}$'),
  indice_bundle text not null
    constraint chk_satelite_consulta_itens_indice_bundle check (indice_bundle in ('ndvi')),
  versao_metodo text not null
    constraint chk_satelite_consulta_itens_versao_metodo check (versao_metodo in ('ndvi-v2')),
  data_alvo date,
  janela_inicio date not null,
  janela_fim date not null,
  situacao text not null default 'pendente'
    constraint chk_satelite_consulta_itens_situacao check (situacao in ('pendente', 'executando', 'concluido', 'reaproveitado', 'falho', 'cancelado')),
  tentativas integer not null default 0
    constraint chk_satelite_consulta_itens_tentativas check (tentativas >= 0),
  proxima_tentativa_em timestamptz,
  erro text,
  analise_id uuid,
  pu_gasto numeric(14,4)
    constraint chk_satelite_consulta_itens_pu_gasto check (pu_gasto >= 0),
  chave_idempotencia text not null
    constraint chk_satelite_consulta_itens_chave check (chave_idempotencia ~ '^[0-9a-f]{64}$'),
  chave_idempotencia_origem text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_satelite_consulta_itens_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_satelite_consulta_itens_consulta foreign key (organization_id, empresa_id, consulta_id)
    references erp.satelite_consultas (organization_id, empresa_id, id),
  constraint fk_satelite_consulta_itens_area foreign key (organization_id, empresa_id, area_id)
    references erp.areas (organization_id, empresa_id, id),
  -- Alvos das FKs que provam o VÍNCULO, não só a empresa: o consumo aponta para o item DA MESMA CONSULTA, e a
  -- análise aponta para o item DA MESMA ÁREA.
  constraint satelite_consulta_itens_consulta_key unique (organization_id, empresa_id, consulta_id, id),
  constraint satelite_consulta_itens_area_key unique (organization_id, empresa_id, area_id, id),
  constraint chk_satelite_consulta_itens_janela check (
    janela_fim >= janela_inicio and (data_alvo is null or (data_alvo >= janela_inicio and data_alvo <= janela_fim))
  )
);

-- UM item VIVO por organização e chave. O predicado é o MESMO que a API escreve no
-- `on conflict (organization_id, chave_idempotencia) where …`. A organização na chave do índice: a unicidade nunca
-- atravessa o tenant (uma linha de outra organização não barra, nem revela, nada desta).
create unique index uq_satelite_consulta_itens_chave on erp.satelite_consulta_itens (organization_id, chave_idempotencia)
  where situacao in ('pendente', 'executando', 'concluido');
-- A fila do executor: só o que ainda vai ser processado (concluído, reaproveitado, falho e cancelado não entram).
create index ix_satelite_consulta_itens_fila on erp.satelite_consulta_itens (situacao, proxima_tentativa_em)
  where situacao in ('pendente', 'executando');
create index ix_satelite_consulta_itens_consulta on erp.satelite_consulta_itens (organization_id, empresa_id, consulta_id, created_at, id);

comment on table erp.satelite_consulta_itens is 'A FILA da consulta satelital em lote (SAT-02, decisão 295): um item por área × janela × índice. UM item vivo (pendente/executando/concluido) por organização e chave de idempotência; reaproveitado, falho e cancelado podem repetir a chave.';
comment on column erp.satelite_consulta_itens.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_consulta_itens.consulta_id is 'Consulta a que o item pertence (FK composta: mesma organização e empresa).';
comment on column erp.satelite_consulta_itens.organization_id is 'Tenant (organização).';
comment on column erp.satelite_consulta_itens.empresa_id is 'Empresa da área (a mesma da consulta).';
comment on column erp.satelite_consulta_itens.area_id is 'Área canônica (erp.areas). A geometria NÃO é copiada.';
comment on column erp.satelite_consulta_itens.geometria_sha256 is 'SHA-256 (hex) do texto jsonb de erp.areas.geometria no pedido, calculado pelo banco (mesma expressão da 0052).';
comment on column erp.satelite_consulta_itens.indice_bundle is 'Índice (ou conjunto de índices) pedido: ndvi.';
comment on column erp.satelite_consulta_itens.versao_metodo is 'Versão do método do executor (ndvi-v2). Versões diferentes não se reaproveitam.';
comment on column erp.satelite_consulta_itens.data_alvo is 'Dia pedido (período por data); nulo = a imagem útil mais recente dentro da janela.';
comment on column erp.satelite_consulta_itens.janela_inicio is 'Primeiro dia (UTC) da janela de busca, inclusivo.';
comment on column erp.satelite_consulta_itens.janela_fim is 'Último dia (UTC) da janela de busca, inclusivo.';
comment on column erp.satelite_consulta_itens.situacao is 'pendente, executando, concluido, reaproveitado, falho ou cancelado.';
comment on column erp.satelite_consulta_itens.tentativas is 'Tentativas feitas pelo executor.';
comment on column erp.satelite_consulta_itens.proxima_tentativa_em is 'Quando o executor pode tentar de novo (nulo = já).';
comment on column erp.satelite_consulta_itens.erro is 'Motivo da última falha, sanitizado (nunca token, cabeçalho nem resposta bruta).';
comment on column erp.satelite_consulta_itens.analise_id is 'Análise registrada pelo item: da MESMA área do item (FK composta organização, empresa, área, análise).';
comment on column erp.satelite_consulta_itens.pu_gasto is 'Processing units gastas pelo item, como o provedor informou.';
comment on column erp.satelite_consulta_itens.chave_idempotencia is 'SHA-256 (hex) de chave_idempotencia_origem, calculado pela API.';
comment on column erp.satelite_consulta_itens.chave_idempotencia_origem is 'A origem legível da chave (organização|área|geometria|índice|data@janela|versão), para depurar.';
comment on column erp.satelite_consulta_itens.created_at is 'Entrada na fila.';
comment on column erp.satelite_consulta_itens.updated_at is 'Última mudança (gatilho erp.set_updated_at).';

-- ---------- 5) erp.satelite_consumo — o ledger de consumo (só acrescenta) ----------
create table erp.satelite_consumo (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  consulta_item_id uuid,
  consulta_id uuid,
  operacao text not null
    constraint chk_satelite_consumo_operacao check (operacao in ('process', 'statistical', 'catalog')),
  pu_gasto numeric(14,4) not null,
  creditos numeric(16,2) not null,
  origem_cabecalho text,
  created_at timestamptz not null default now(),
  constraint fk_satelite_consumo_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  -- O item do consumo é um item DA CONSULTA do consumo (não só da mesma empresa).
  constraint fk_satelite_consumo_item foreign key (organization_id, empresa_id, consulta_id, consulta_item_id)
    references erp.satelite_consulta_itens (organization_id, empresa_id, consulta_id, id),
  constraint fk_satelite_consumo_consulta foreign key (organization_id, empresa_id, consulta_id)
    references erp.satelite_consultas (organization_id, empresa_id, id),
  -- Com MATCH SIMPLE, consulta nula desligaria a FK do item: consumo com item exige a consulta.
  constraint chk_satelite_consumo_item_com_consulta check (consulta_item_id is null or consulta_id is not null),
  constraint chk_satelite_consumo_pu check (pu_gasto >= 0),
  -- 1 crédito = 0,01 PU. O crédito é DERIVADO do PU gravado; os dois nunca divergem.
  constraint chk_satelite_consumo_creditos check (creditos = round(pu_gasto * 100, 2))
);

-- A soma do consumo do mês (orçamento) sai só do índice: o crédito vai junto (include).
create index ix_satelite_consumo_mes on erp.satelite_consumo (organization_id, empresa_id, created_at) include (creditos);
-- O gasto DE UMA consulta (a reserva do orçamento é a estimativa menos o já gasto pela consulta), também só do índice.
create index ix_satelite_consumo_consulta on erp.satelite_consumo (organization_id, empresa_id, consulta_id) include (creditos)
  where consulta_id is not null;

comment on table erp.satelite_consumo is 'LEDGER IMUTÁVEL do consumo do provedor satelital (SAT-02, decisão 295): uma linha por cobrança informada. Não se altera nem se apaga.';
comment on column erp.satelite_consumo.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_consumo.organization_id is 'Tenant (organização).';
comment on column erp.satelite_consumo.empresa_id is 'Empresa que consumiu (a da consulta).';
comment on column erp.satelite_consumo.consulta_item_id is 'Item da fila que gerou o consumo, quando houver: um item DA consulta_id (FK composta organização, empresa, consulta, item); exige consulta_id.';
comment on column erp.satelite_consumo.consulta_id is 'Consulta que gerou o consumo (FK composta), quando houver.';
comment on column erp.satelite_consumo.operacao is 'Operação cobrada pelo provedor: process, statistical ou catalog.';
comment on column erp.satelite_consumo.pu_gasto is 'Processing units cobradas.';
comment on column erp.satelite_consumo.creditos is 'Créditos = round(pu_gasto × 100, 2) (1 crédito = 0,01 PU).';
comment on column erp.satelite_consumo.origem_cabecalho is 'Valor bruto do cabeçalho x-processingunits-spent, quando veio dele.';
comment on column erp.satelite_consumo.created_at is 'Registro do consumo.';

-- ---------- 6) erp.satelite_orcamentos — limite por empresa e mês ----------
create table erp.satelite_orcamentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  mes_referencia date not null,
  limite_creditos numeric(16,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_satelite_orcamentos_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint uq_satelite_orcamentos_mes unique (organization_id, empresa_id, mes_referencia),
  constraint chk_satelite_orcamentos_mes check (extract(day from mes_referencia) = 1),
  constraint chk_satelite_orcamentos_limite check (limite_creditos >= 0)
);

comment on table erp.satelite_orcamentos is 'Limite de créditos satelitais por empresa e mês (SAT-02, decisão 295). SEM LINHA = SEM LIMITE: nenhum valor padrão.';
comment on column erp.satelite_orcamentos.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_orcamentos.organization_id is 'Tenant (organização).';
comment on column erp.satelite_orcamentos.empresa_id is 'Empresa limitada.';
comment on column erp.satelite_orcamentos.mes_referencia is 'Primeiro dia do mês (UTC) a que o limite vale.';
comment on column erp.satelite_orcamentos.limite_creditos is 'Créditos disponíveis no mês (1 crédito = 0,01 PU).';
comment on column erp.satelite_orcamentos.created_at is 'Registro do orçamento.';
comment on column erp.satelite_orcamentos.updated_at is 'Última mudança (gatilho erp.set_updated_at).';

-- ---------- 7) gatilhos: imutabilidade do ledger, updated_at e auditoria ----------
-- O consumo não se reescreve nem se apaga, nem pelo dono do schema: não lê OLD nem NEW (gabarito da 0052/0047).
create function erp.satelite_consumo_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: O consumo satelital registrado não se altera nem se apaga: um consumo novo é registrado ao lado do anterior.' using errcode = 'P0001';
end $$;

comment on function erp.satelite_consumo_imutavel() is 'SAT-02: ledger imutável — recusa UPDATE e DELETE (gatilho por linha) e TRUNCATE (gatilho por comando) em erp.satelite_consumo com CONFLICT, inclusive para o dono do schema.';
-- Gatilho não precisa de execute de quem grava: ninguém além do dono executa a função.
revoke execute on function erp.satelite_consumo_imutavel() from public, erp_app;

create trigger trg_satelite_consumo_imutavel
  before update or delete on erp.satelite_consumo
  for each row execute function erp.satelite_consumo_imutavel();

create trigger trg_satelite_consumo_imutavel_truncate
  before truncate on erp.satelite_consumo
  for each statement execute function erp.satelite_consumo_imutavel();

create trigger trg_satelite_consumo_audit
  after insert on erp.satelite_consumo
  for each row execute function erp.audit_row();

create trigger trg_satelite_consultas_updated
  before update on erp.satelite_consultas
  for each row execute function erp.set_updated_at();

create trigger trg_satelite_consultas_audit
  after insert or delete on erp.satelite_consultas
  for each row execute function erp.audit_row();

-- Alteração: só a mudança de SITUAÇÃO é auditada; o avanço dos contadores (o executor, item a item) não.
create trigger trg_satelite_consultas_audit_situacao
  after update on erp.satelite_consultas
  for each row when (old.situacao is distinct from new.situacao) execute function erp.audit_row();

create trigger trg_satelite_consulta_itens_updated
  before update on erp.satelite_consulta_itens
  for each row execute function erp.set_updated_at();

create trigger trg_satelite_orcamentos_updated
  before update on erp.satelite_orcamentos
  for each row execute function erp.set_updated_at();

create trigger trg_satelite_orcamentos_audit
  after insert or update or delete on erp.satelite_orcamentos
  for each row execute function erp.audit_row();

-- ---------- 8) RLS e privilégios (categoria A da 0015; a política é a MESMA da 0052) ----------
alter table erp.satelite_consultas enable row level security;
alter table erp.satelite_consultas force row level security;
create policy tenant_e_empresa on erp.satelite_consultas for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.satelite_consulta_itens enable row level security;
alter table erp.satelite_consulta_itens force row level security;
create policy tenant_e_empresa on erp.satelite_consulta_itens for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.satelite_consumo enable row level security;
alter table erp.satelite_consumo force row level security;
create policy tenant_e_empresa on erp.satelite_consumo for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.satelite_orcamentos enable row level security;
alter table erp.satelite_orcamentos force row level security;
create policy tenant_e_empresa on erp.satelite_orcamentos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- A 0007 concede por padrão select/insert/update/delete no schema erp: o que não cabe é revogado EXPLICITAMENTE.
grant select, insert, update on erp.satelite_consultas to erp_app;
revoke delete, truncate on erp.satelite_consultas from erp_app;
grant select, insert, update on erp.satelite_consulta_itens to erp_app;
revoke delete, truncate on erp.satelite_consulta_itens from erp_app;
grant select, insert on erp.satelite_consumo to erp_app;
revoke update, delete, truncate on erp.satelite_consumo from erp_app;
grant select on erp.satelite_orcamentos to erp_app;
revoke insert, update, delete, truncate on erp.satelite_orcamentos from erp_app;

-- ---------- 9) POR ÚLTIMO: erp.analises_satelitais (ACCESS EXCLUSIVE) e as FKs que dependem da chave única nova ----------
-- Quatro colunas ANULÁVEIS e SEM default: nenhuma linha é regravada nem escrita (as existentes leem NULL), e o gatilho
-- de imutabilidade da 0052, que é de linha, não é acionado por DDL. Os CHECKs novos só olham as colunas novas (NULL
-- passa), mas conferi-los LÊ a tabela inteira sob ACCESS EXCLUSIVE (ver o cabeçalho). Como a análise é imutável, as
-- colunas novas só se preenchem na INSERÇÃO de uma análise nova.
alter table erp.analises_satelitais
  add column consulta_item_id uuid,
  add column resolucao_nativa_m integer
    constraint chk_analises_satelitais_resolucao_nativa check (resolucao_nativa_m > 0),
  add column evalscript_sha256 text
    constraint chk_analises_satelitais_evalscript_sha256 check (evalscript_sha256 ~ '^[0-9a-f]{64}$'),
  add column data_alvo date;

-- A data alvo cai DENTRO da janela, na convenção que a 0052 documenta para ela (dias UTC inteiros; janela_fim é a
-- meia-noite UTC seguinte ao último dia, EXCLUSIVA — erp.analises_satelitais.janela_fim e janelaPadrao da SAT-01).
alter table erp.analises_satelitais add constraint chk_analises_satelitais_data_alvo check (
  data_alvo is null
  or (data_alvo >= (janela_inicio at time zone 'UTC')::date and data_alvo < (janela_fim at time zone 'UTC')::date)
);

comment on column erp.analises_satelitais.consulta_item_id is 'Item da fila da consulta em lote que produziu a análise (SAT-02): da MESMA área da análise (FK composta organização, empresa, área, item). Nulo nas análises avulsas e nas anteriores à 0053.';
comment on column erp.analises_satelitais.resolucao_nativa_m is 'Resolução nativa da coleção usada pelo executor, em metros (SAT-02). Nulo nas anteriores à 0053.';
comment on column erp.analises_satelitais.evalscript_sha256 is 'SHA-256 (hex) do evalscript enviado ao provedor (SAT-02). Nulo nas anteriores à 0053.';
comment on column erp.analises_satelitais.data_alvo is 'Dia pedido pelo slot da consulta em lote (período por data), dentro da janela; nulo = a imagem útil mais recente da janela (e em toda análise avulsa da SAT-01). Entra na unicidade da janela (NULLS NOT DISTINCT).';

-- A unicidade da janela, refeita com O MESMO NOME (as rotas usam `on conflict on constraint uq_analises_satelitais_janela`)
-- e com data_alvo: dois slots da mesma janela com datas alvo diferentes não colidem; NULLS NOT DISTINCT mantém a análise
-- de data alvo nula (toda a SAT-01) com a unicidade de antes — duas nulas na mesma janela continuam colidindo. O índice
-- é reconstruído aqui, sob a ACCESS EXCLUSIVE que a tabela já tem.
alter table erp.analises_satelitais drop constraint uq_analises_satelitais_janela;
alter table erp.analises_satelitais add constraint uq_analises_satelitais_janela unique nulls not distinct
  (organization_id, area_id, provedor, colecao, indice, versao_metodo, geometria_sha256, janela_inicio, janela_fim, data_alvo);

-- Só uma chave nova sobre colunas que já existem (id já é único; organization_id, empresa_id e area_id são
-- obrigatórios): não muda linha nenhuma e não tem como recusar acervo. Inclui a ÁREA porque é ela que a FK do item
-- confere: a análise de um item é sempre da área do item.
alter table erp.analises_satelitais add constraint analises_satelitais_org_empresa_area_key unique (organization_id, empresa_id, area_id, id);

alter table erp.satelite_consulta_itens add constraint fk_satelite_consulta_itens_analise
  foreign key (organization_id, empresa_id, area_id, analise_id) references erp.analises_satelitais (organization_id, empresa_id, area_id, id);

alter table erp.analises_satelitais add constraint fk_analises_satelitais_consulta_item
  foreign key (organization_id, empresa_id, area_id, consulta_item_id) references erp.satelite_consulta_itens (organization_id, empresa_id, area_id, id);

-- ---------- 10) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_tabela text;
  v_ref record;
  v_fk record;
  v_ch record;
  v_ix record;
begin
  select qual, with_check, roles into v_ref
    from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais' and policyname = 'tenant_e_empresa';

  foreach v_tabela in array array['satelite_consultas', 'satelite_consulta_itens', 'satelite_consumo', 'satelite_orcamentos'] loop
    if to_regclass('erp.' || v_tabela) is null then
      raise exception 'SAT-02: a tabela erp.% nao foi criada.', v_tabela;
    end if;
    if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'erp' and c.relname = v_tabela and not (c.relrowsecurity and c.relforcerowsecurity)) then
      raise exception 'SAT-02: erp.% sem RLS habilitada e forcada.', v_tabela;
    end if;
    if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = v_tabela)
       is distinct from array['tenant_e_empresa'] then
      raise exception 'SAT-02: politica de erp.% diferente de tenant_e_empresa (uma so).', v_tabela;
    end if;
    -- A MESMA política da 0052, comparada pelo texto que o catálogo devolve (using, with check e papéis).
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'erp' and p.tablename = v_tabela and p.policyname = 'tenant_e_empresa'
                      and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                      and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
      raise exception 'SAT-02: politica tenant_e_empresa de erp.% diverge da de erp.analises_satelitais (0052).', v_tabela;
    end if;
    -- FK composta da empresa, sem cascata, na ordem (organização, empresa) → erp.empresas(organização, id).
    if not exists (
      select 1 from pg_constraint c
       where c.conname = 'fk_' || v_tabela || '_empresa' and c.contype = 'f' and c.conrelid = ('erp.' || v_tabela)::regclass
         and c.confrelid = 'erp.empresas'::regclass and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = array['organization_id', 'empresa_id']
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array['organization_id', 'id']
    ) then
      raise exception 'SAT-02: FK composta da empresa de erp.% ausente (fk_%_empresa).', v_tabela, v_tabela;
    end if;
  end loop;

  -- As FKs compostas dos VÍNCULOS, sem cascata, coluna a coluna (origem e alvo).
  for v_fk in
    select * from (values
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_consulta', 'satelite_consultas',
        array['organization_id', 'empresa_id', 'consulta_id'], array['organization_id', 'empresa_id', 'id']),
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_area', 'areas',
        array['organization_id', 'empresa_id', 'area_id'], array['organization_id', 'empresa_id', 'id']),
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_analise', 'analises_satelitais',
        array['organization_id', 'empresa_id', 'area_id', 'analise_id'], array['organization_id', 'empresa_id', 'area_id', 'id']),
      ('satelite_consumo', 'fk_satelite_consumo_item', 'satelite_consulta_itens',
        array['organization_id', 'empresa_id', 'consulta_id', 'consulta_item_id'], array['organization_id', 'empresa_id', 'consulta_id', 'id']),
      ('satelite_consumo', 'fk_satelite_consumo_consulta', 'satelite_consultas',
        array['organization_id', 'empresa_id', 'consulta_id'], array['organization_id', 'empresa_id', 'id']),
      ('analises_satelitais', 'fk_analises_satelitais_consulta_item', 'satelite_consulta_itens',
        array['organization_id', 'empresa_id', 'area_id', 'consulta_item_id'], array['organization_id', 'empresa_id', 'area_id', 'id'])
    ) as f(origem, nome, alvo, colunas, colunas_alvo)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conname = v_fk.nome and c.contype = 'f' and c.conrelid = ('erp.' || v_fk.origem)::regclass
         and c.confrelid = ('erp.' || v_fk.alvo)::regclass and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_fk.colunas
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = v_fk.colunas_alvo
    ) then
      raise exception 'SAT-02: FK composta % (erp.% -> erp.%; sem cascata) ausente ou com outras colunas.', v_fk.nome, v_fk.origem, v_fk.alvo;
    end if;
  end loop;

  -- As chaves únicas que as FKs usam, e a do orçamento por mês, coluna a coluna.
  for v_fk in
    select * from (values
      ('satelite_consultas', 'satelite_consultas_org_empresa_key', array['organization_id', 'empresa_id', 'id']),
      ('satelite_consulta_itens', 'satelite_consulta_itens_consulta_key', array['organization_id', 'empresa_id', 'consulta_id', 'id']),
      ('satelite_consulta_itens', 'satelite_consulta_itens_area_key', array['organization_id', 'empresa_id', 'area_id', 'id']),
      ('analises_satelitais', 'analises_satelitais_org_empresa_area_key', array['organization_id', 'empresa_id', 'area_id', 'id']),
      ('satelite_orcamentos', 'uq_satelite_orcamentos_mes', array['organization_id', 'empresa_id', 'mes_referencia'])
    ) as u(tabela, nome, colunas)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conname = v_fk.nome and c.contype = 'u' and c.conrelid = ('erp.' || v_fk.tabela)::regclass
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_fk.colunas
    ) then
      raise exception 'SAT-02: chave unica % de erp.% ausente ou com outras colunas.', v_fk.nome, v_fk.tabela;
    end if;
  end loop;

  -- CHECKs pelo NOME. Nas tabelas novas, o conjunto é EXATAMENTE este (nenhum a mais, nenhum a menos, todos validados);
  -- na análise, os dois novos (os 15 da 0052 são conferidos pela 0052).
  for v_ch in
    select * from (values
      ('satelite_consultas', array['chk_satelite_consultas_concluida_em', 'chk_satelite_consultas_contadores', 'chk_satelite_consultas_estimativa',
                                   'chk_satelite_consultas_parametros', 'chk_satelite_consultas_situacao']),
      ('satelite_consulta_itens', array['chk_satelite_consulta_itens_chave', 'chk_satelite_consulta_itens_geometria_sha256',
                                        'chk_satelite_consulta_itens_indice_bundle', 'chk_satelite_consulta_itens_janela', 'chk_satelite_consulta_itens_pu_gasto',
                                        'chk_satelite_consulta_itens_situacao', 'chk_satelite_consulta_itens_tentativas', 'chk_satelite_consulta_itens_versao_metodo']),
      ('satelite_consumo', array['chk_satelite_consumo_creditos', 'chk_satelite_consumo_item_com_consulta', 'chk_satelite_consumo_operacao',
                                 'chk_satelite_consumo_pu']),
      ('satelite_orcamentos', array['chk_satelite_orcamentos_limite', 'chk_satelite_orcamentos_mes'])
    ) as k(tabela, nomes)
  loop
    if (select array_agg(c.conname::text order by c.conname) from pg_constraint c
         where c.conrelid = ('erp.' || v_ch.tabela)::regclass and c.contype = 'c' and c.convalidated) is distinct from v_ch.nomes then
      raise exception 'SAT-02: CHECKs de erp.% diferentes dos declarados (%).', v_ch.tabela, array_to_string(v_ch.nomes, ', ');
    end if;
  end loop;
  if (select count(*) from pg_constraint c
       where c.conrelid = 'erp.analises_satelitais'::regclass and c.contype = 'c' and c.convalidated
         and c.conname in ('chk_analises_satelitais_resolucao_nativa', 'chk_analises_satelitais_evalscript_sha256', 'chk_analises_satelitais_data_alvo')) <> 3 then
    raise exception 'SAT-02: CHECKs novos de erp.analises_satelitais ausentes (chk_analises_satelitais_resolucao_nativa, chk_analises_satelitais_evalscript_sha256, chk_analises_satelitais_data_alvo).';
  end if;

  -- A unicidade da janela refeita: o MESMO nome, as 10 colunas na ordem, NULLS NOT DISTINCT, índice válido.
  if not exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid = c.conindid
     where c.conname = 'uq_analises_satelitais_janela' and c.contype = 'u' and c.conrelid = 'erp.analises_satelitais'::regclass
       and i.indnullsnotdistinct and i.indisunique and i.indisvalid
       and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['organization_id', 'area_id', 'provedor', 'colecao', 'indice', 'versao_metodo', 'geometria_sha256', 'janela_inicio', 'janela_fim', 'data_alvo']
  ) then
    raise exception 'SAT-02: uq_analises_satelitais_janela fora do contrato (10 colunas com data_alvo, NULLS NOT DISTINCT).';
  end if;

  -- Índices novos pelo NOME, com a definição inteira (colunas, ordem, unicidade, INCLUDE e predicado). O schema sai do
  -- texto antes de comparar: pg_get_indexdef o omite quando erp está no search_path de quem aplica.
  for v_ix in
    select * from (values
      ('uq_satelite_consulta_itens_chave', 'CREATE UNIQUE INDEX uq_satelite_consulta_itens_chave ON satelite_consulta_itens USING btree (organization_id, chave_idempotencia) WHERE (situacao = ANY (ARRAY[''pendente''::text, ''executando''::text, ''concluido''::text]))'),
      ('ix_satelite_consulta_itens_fila', 'CREATE INDEX ix_satelite_consulta_itens_fila ON satelite_consulta_itens USING btree (situacao, proxima_tentativa_em) WHERE (situacao = ANY (ARRAY[''pendente''::text, ''executando''::text]))'),
      ('ix_satelite_consulta_itens_consulta', 'CREATE INDEX ix_satelite_consulta_itens_consulta ON satelite_consulta_itens USING btree (organization_id, empresa_id, consulta_id, created_at, id)'),
      ('ix_satelite_consultas_historico', 'CREATE INDEX ix_satelite_consultas_historico ON satelite_consultas USING btree (organization_id, empresa_id, created_at DESC, id DESC)'),
      ('ix_satelite_consultas_historico_org', 'CREATE INDEX ix_satelite_consultas_historico_org ON satelite_consultas USING btree (organization_id, created_at DESC, id DESC)'),
      ('ix_satelite_consumo_mes', 'CREATE INDEX ix_satelite_consumo_mes ON satelite_consumo USING btree (organization_id, empresa_id, created_at) INCLUDE (creditos)'),
      ('ix_satelite_consumo_consulta', 'CREATE INDEX ix_satelite_consumo_consulta ON satelite_consumo USING btree (organization_id, empresa_id, consulta_id) INCLUDE (creditos) WHERE (consulta_id IS NOT NULL)')
    ) as x(nome, definicao)
  loop
    if not exists (select 1 from pg_index i
                    where i.indexrelid = to_regclass('erp.' || v_ix.nome) and i.indisvalid
                      and regexp_replace(pg_get_indexdef(i.indexrelid), ' ON (erp\.)?', ' ON ') = v_ix.definicao) then
      raise exception 'SAT-02: indice erp.% ausente ou fora do contrato (esperado: %).', v_ix.nome, v_ix.definicao;
    end if;
  end loop;

  -- As colunas novas da análise: anuláveis e sem default (nenhuma linha existente muda).
  if (select count(*) from pg_attribute a
       where a.attrelid = 'erp.analises_satelitais'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
         and ((a.attname = 'consulta_item_id' and a.atttypid = 'uuid'::regtype)
           or (a.attname = 'resolucao_nativa_m' and a.atttypid = 'integer'::regtype)
           or (a.attname = 'evalscript_sha256' and a.atttypid = 'text'::regtype)
           or (a.attname = 'data_alvo' and a.atttypid = 'date'::regtype))) <> 4 then
    raise exception 'SAT-02: colunas novas de erp.analises_satelitais (consulta_item_id uuid, resolucao_nativa_m integer, evalscript_sha256 text, data_alvo date) ausentes ou fora do contrato (anulaveis, sem default).';
  end if;

  -- Gatilhos: imutabilidade do ledger (linha e comando), updated_at e auditoria.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O' and (t.tgrelid, t.tgname, t.tgfoid) in (
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel_truncate', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_audit', 'erp.audit_row()'::regprocedure),
         ('erp.satelite_consultas'::regclass, 'trg_satelite_consultas_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_consultas'::regclass, 'trg_satelite_consultas_audit', 'erp.audit_row()'::regprocedure),
         ('erp.satelite_consultas'::regclass, 'trg_satelite_consultas_audit_situacao', 'erp.audit_row()'::regprocedure),
         ('erp.satelite_consulta_itens'::regclass, 'trg_satelite_consulta_itens_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_orcamentos'::regclass, 'trg_satelite_orcamentos_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_orcamentos'::regclass, 'trg_satelite_orcamentos_audit', 'erp.audit_row()'::regprocedure))) <> 9 then
    raise exception 'SAT-02: gatilhos das tabelas novas ausentes ou desabilitados (imutabilidade do consumo por linha e por comando, updated_at, auditoria).';
  end if;
  -- tgtype: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
  -- A imutabilidade do ledger cobre UPDATE e DELETE por linha e TRUNCATE por comando.
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.satelite_consumo'::regclass and tgname = 'trg_satelite_consumo_imutavel'
                   and tgtype & (1 | 8 | 16) = (1 | 8 | 16))
     or not exists (select 1 from pg_trigger where tgrelid = 'erp.satelite_consumo'::regclass and tgname = 'trg_satelite_consumo_imutavel_truncate'
                      and tgtype & 32 = 32 and tgtype & 1 = 0) then
    raise exception 'SAT-02: imutabilidade de erp.satelite_consumo fora do contrato (UPDATE/DELETE por linha e TRUNCATE por comando).';
  end if;
  -- A auditoria da consulta: AFTER INSERT/DELETE sempre (sem UPDATE), e AFTER UPDATE só quando a situação muda.
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.satelite_consultas'::regclass and tgname = 'trg_satelite_consultas_audit'
                   and tgtype = (1 | 4 | 8) and tgqual is null)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.satelite_consultas'::regclass and t.tgname = 'trg_satelite_consultas_audit_situacao'
                      and t.tgtype = (1 | 16) and t.tgqual is not null
                      and pg_get_triggerdef(t.oid) like '%WHEN ((old.situacao IS DISTINCT FROM new.situacao))%') then
    raise exception 'SAT-02: auditoria de erp.satelite_consultas fora do contrato (INSERT/DELETE sempre; UPDATE so quando a situacao muda).';
  end if;
  -- A função de imutabilidade: INVOKER, search_path fixo, sem execute para PUBLIC nem erp_app.
  if not exists (select 1 from pg_proc p where p.oid = 'erp.satelite_consumo_imutavel()'::regprocedure
                   and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp'])
     or has_function_privilege('erp_app', 'erp.satelite_consumo_imutavel()', 'EXECUTE') then
    raise exception 'SAT-02: erp.satelite_consumo_imutavel() fora do contrato (SECURITY INVOKER, search_path = erp, pg_temp, sem execute para public/erp_app).';
  end if;

  -- Privilégios do erp_app: o que a API usa, e NADA além disso.
  if not (has_table_privilege('erp_app', 'erp.satelite_consultas', 'SELECT') and has_table_privilege('erp_app', 'erp.satelite_consultas', 'INSERT')
          and has_table_privilege('erp_app', 'erp.satelite_consultas', 'UPDATE')
          and has_table_privilege('erp_app', 'erp.satelite_consulta_itens', 'SELECT') and has_table_privilege('erp_app', 'erp.satelite_consulta_itens', 'INSERT')
          and has_table_privilege('erp_app', 'erp.satelite_consulta_itens', 'UPDATE')
          and has_table_privilege('erp_app', 'erp.satelite_consumo', 'SELECT') and has_table_privilege('erp_app', 'erp.satelite_consumo', 'INSERT')
          and has_table_privilege('erp_app', 'erp.satelite_orcamentos', 'SELECT')) then
    raise exception 'SAT-02: erp_app sem os privilegios que a API usa (consultas e itens: select/insert/update; consumo: select/insert; orcamentos: select).';
  end if;
  if has_table_privilege('erp_app', 'erp.satelite_consultas', 'DELETE') or has_table_privilege('erp_app', 'erp.satelite_consultas', 'TRUNCATE')
     or has_table_privilege('erp_app', 'erp.satelite_consulta_itens', 'DELETE') or has_table_privilege('erp_app', 'erp.satelite_consulta_itens', 'TRUNCATE')
     or has_table_privilege('erp_app', 'erp.satelite_consumo', 'UPDATE') or has_table_privilege('erp_app', 'erp.satelite_consumo', 'DELETE')
     or has_table_privilege('erp_app', 'erp.satelite_consumo', 'TRUNCATE')
     or has_table_privilege('erp_app', 'erp.satelite_orcamentos', 'INSERT') or has_table_privilege('erp_app', 'erp.satelite_orcamentos', 'UPDATE')
     or has_table_privilege('erp_app', 'erp.satelite_orcamentos', 'DELETE') or has_table_privilege('erp_app', 'erp.satelite_orcamentos', 'TRUNCATE') then
    raise exception 'SAT-02: erp_app com privilegio alem do contrato (delete/truncate em consultas e itens; update/delete/truncate no consumo; escrita em orcamentos).';
  end if;
end $$;
