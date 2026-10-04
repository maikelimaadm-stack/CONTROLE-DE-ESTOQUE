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
--                               chave: o mesmo polígono, na mesma janela e no mesmo método, não se processa duas vezes.
--                               'reaproveitado', 'falho' e 'cancelado' podem repetir a chave (a consulta seguinte que
--                               reaproveitou registra o item ao lado, e o que falhou pode ser pedido de novo).
--   erp.satelite_consumo        o LEDGER de consumo do provedor (PU = processing units; 1 crédito = 0,01 PU): só
--                               acrescenta. UPDATE e DELETE recusados por gatilho de linha e TRUNCATE por gatilho de
--                               comando, mesmo para o dono do schema (gabarito da 0052/0047).
--   erp.satelite_orcamentos     o limite de créditos por empresa e mês. SEM LINHA = SEM LIMITE; nenhum valor padrão é
--                               inventado aqui. Nenhuma rota escreve orçamento nesta fatia (erp_app só lê).
--   erp.analises_satelitais     ganha três colunas ANULÁVEIS (o item da fila que a produziu, a resolução nativa e o
--                               sha256 do evalscript) e a chave única (organization_id, empresa_id, id), alvo da FK
--                               composta do item → análise.
--
-- NENHUMA ROTA DESTA FATIA CHAMA O PROVEDOR. A fila nasce para um executor futuro; até lá ela só é escrita pela
-- API (pedido e itens) e lida pelo histórico.
--
-- ESCOPO. Tudo aqui é DA ÁREA e responde pelo escopo dela: módulo de escopo empresarial "pecuaria", o mesmo de
-- erp.areas e de erp.analises_satelitais (scripts/company-rls-modules.json). Categoria A da 0015 (empresa
-- obrigatória); a política tenant_e_empresa de cada tabela nova é IDÊNTICA à da 0052 (a pós-condição compara o
-- texto das duas no catálogo). FKs de empresa COMPOSTAS em tudo: item → consulta, item → área, item → análise,
-- consumo → item/consulta, análise → item — coluna única não prova tenant nem empresa.
--
-- AUDITORIA (erp.audit_row). Consulta e orçamento: criação, alteração e exclusão (o costume das tabelas de negócio).
-- Consumo: a criação (como a análise da 0052; o ledger não muda depois). Itens da fila: SEM auditoria por linha — são
-- até 200 por consulta e mudam de situação a cada tentativa; a história deles está na consulta auditada, no próprio
-- item e no ledger de consumo (gabarito da 0040: auditoria no cabeçalho, não no item).
--
-- CONSEQUÊNCIAS DECLARADAS. (1) Área com item na fila não muda de empresa (a FK composta item → área recusa, 23503),
-- como a área com análise da 0052. (2) A análise continua imutável: as colunas novas só se preenchem na INSERÇÃO de
-- uma análise nova (as antigas ficam com NULL para sempre). (3) erp.analises_satelitais passa a ser ALVO de FK (o
-- item aponta para ela): o TRUNCATE simples dela para na FK (0A000) antes de chegar ao gatilho de comando da 0052; com
-- CASCADE, o gatilho recusa — continua recusado nos dois caminhos.
--
-- PRODUÇÃO (decisões 240/247). Quatro tabelas NOVAS e VAZIAS; três colunas ANULÁVEIS, sem default, em
-- erp.analises_satelitais (ADD COLUMN sem default não regrava a tabela nem escreve linha: as linhas existentes ganham
-- NULL pelo catálogo, e o gatilho de imutabilidade da 0052 — que é de linha — não é acionado por DDL); uma chave única
-- NOVA sobre colunas que já existem (id já é único: não tem como recusar acervo). NENHUM dado existente é escrito,
-- corrigido ou apagado. O efeito novo nasce DESLIGADO: nenhuma rota desta fatia chama o provedor.
--
-- TRAVAS DE TABELA. As tabelas novas pedem SHARE ROW EXCLUSIVE em erp.organizations, erp.empresas, erp.users e
-- erp.areas (alvos das FKs). O que pega ACCESS EXCLUSIVE em tabela existente — as colunas novas e a chave única de
-- erp.analises_satelitais, e as duas FKs que dependem dela — é a ÚLTIMA coisa do arquivo: a janela em que leitura e
-- escrita de análises esperam é só a do catálogo e da construção do índice (tabela pequena), nunca a espera pelas
-- outras travas. Cada pedido de trava espera no máximo lock_timeout = 2 s; se não conseguir, a migration aborta
-- inteira e o deploy para, sem nada aplicado.
--
-- VOLTA. O repositório é forward-only (sem arquivo de descida). O caminho inverso, provado em
-- packages/db/test/sat-02-0053.test.ts (constante SQL_REVERSO), é: soltar a FK análise → item, dropar as quatro
-- tabelas (consumo, itens, consultas, orçamentos), a função de imutabilidade do consumo, a chave única nova e as três
-- colunas de erp.analises_satelitais, e tirar a 0053 do ledger. Só por decisão humana: apagaria a fila e o consumo.
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
     or exists (select 1 from pg_constraint where conname = 'analises_satelitais_org_empresa_key')
     or exists (select 1 from information_schema.columns
                 where table_schema = 'erp' and table_name = 'analises_satelitais'
                   and column_name in ('consulta_item_id', 'resolucao_nativa_m', 'evalscript_sha256')) then
    raise exception 'SAT-02: a 0053 ja foi aplicada ou ha schema divergente (satelite_consultas/satelite_consulta_itens/satelite_consumo/satelite_orcamentos/satelite_consumo_imutavel/analises_satelitais_org_empresa_key ou coluna nova de analises_satelitais ja existe).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-02: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
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
         and column_name in ('id', 'organization_id', 'empresa_id') and is_nullable = 'NO') <> 3 then
    raise exception 'SAT-02: erp.analises_satelitais sem id/organization_id/empresa_id obrigatorios; a chave unica composta nova exige os tres.';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgrelid = to_regclass('erp.analises_satelitais')
         and t.tgname in ('trg_analises_satelitais_conferir', 'trg_analises_satelitais_imutavel', 'trg_analises_satelitais_imutavel_truncate')) <> 3 then
    raise exception 'SAT-02: gatilhos da 0052 (conferencia e imutabilidade de erp.analises_satelitais) ausentes; schema divergente.';
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
  constraint satelite_consulta_itens_org_empresa_key unique (organization_id, empresa_id, id),
  constraint chk_satelite_consulta_itens_janela check (
    janela_fim >= janela_inicio and (data_alvo is null or (data_alvo >= janela_inicio and data_alvo <= janela_fim))
  )
);

-- UM item VIVO por chave. O predicado é o MESMO que a API escreve no `on conflict (chave_idempotencia) where …`.
create unique index uq_satelite_consulta_itens_chave on erp.satelite_consulta_itens (chave_idempotencia)
  where situacao in ('pendente', 'executando', 'concluido');
create index ix_satelite_consulta_itens_fila on erp.satelite_consulta_itens (situacao, proxima_tentativa_em);
create index ix_satelite_consulta_itens_consulta on erp.satelite_consulta_itens (organization_id, empresa_id, consulta_id, created_at, id);

comment on table erp.satelite_consulta_itens is 'A FILA da consulta satelital em lote (SAT-02, decisão 295): um item por área × janela × índice. UM item vivo (pendente/executando/concluido) por chave de idempotência; reaproveitado, falho e cancelado podem repetir a chave.';
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
comment on column erp.satelite_consulta_itens.analise_id is 'Análise registrada pelo item (FK composta para erp.analises_satelitais).';
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
  constraint fk_satelite_consumo_item foreign key (organization_id, empresa_id, consulta_item_id)
    references erp.satelite_consulta_itens (organization_id, empresa_id, id),
  constraint fk_satelite_consumo_consulta foreign key (organization_id, empresa_id, consulta_id)
    references erp.satelite_consultas (organization_id, empresa_id, id),
  constraint chk_satelite_consumo_pu check (pu_gasto >= 0),
  -- 1 crédito = 0,01 PU. O crédito é DERIVADO do PU gravado; os dois nunca divergem.
  constraint chk_satelite_consumo_creditos check (creditos = round(pu_gasto * 100, 2))
);

create index ix_satelite_consumo_mes on erp.satelite_consumo (organization_id, empresa_id, created_at);

comment on table erp.satelite_consumo is 'LEDGER IMUTÁVEL do consumo do provedor satelital (SAT-02, decisão 295): uma linha por cobrança informada. Não se altera nem se apaga.';
comment on column erp.satelite_consumo.id is 'Identidade técnica (UUID).';
comment on column erp.satelite_consumo.organization_id is 'Tenant (organização).';
comment on column erp.satelite_consumo.empresa_id is 'Empresa que consumiu (a da consulta).';
comment on column erp.satelite_consumo.consulta_item_id is 'Item da fila que gerou o consumo (FK composta), quando houver.';
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
  after insert or update or delete on erp.satelite_consultas
  for each row execute function erp.audit_row();

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
-- Três colunas ANULÁVEIS e SEM default: só catálogo. Nenhuma linha é regravada nem escrita (as existentes leem NULL),
-- e o gatilho de imutabilidade da 0052, que é de linha, não é acionado por DDL. Os CHECKs novos só olham as colunas
-- novas (NULL passa). Como a análise é imutável, as colunas novas só se preenchem na INSERÇÃO de uma análise nova.
alter table erp.analises_satelitais
  add column consulta_item_id uuid,
  add column resolucao_nativa_m integer
    constraint chk_analises_satelitais_resolucao_nativa check (resolucao_nativa_m > 0),
  add column evalscript_sha256 text
    constraint chk_analises_satelitais_evalscript_sha256 check (evalscript_sha256 ~ '^[0-9a-f]{64}$');

comment on column erp.analises_satelitais.consulta_item_id is 'Item da fila da consulta em lote que produziu a análise (SAT-02; FK composta). Nulo nas análises avulsas e nas anteriores à 0053.';
comment on column erp.analises_satelitais.resolucao_nativa_m is 'Resolução nativa da coleção usada pelo executor, em metros (SAT-02). Nulo nas anteriores à 0053.';
comment on column erp.analises_satelitais.evalscript_sha256 is 'SHA-256 (hex) do evalscript enviado ao provedor (SAT-02). Nulo nas anteriores à 0053.';

-- Só uma chave nova sobre colunas que já existem (id já é único; organization_id e empresa_id são obrigatórios): não
-- muda linha nenhuma e não tem como recusar acervo.
alter table erp.analises_satelitais add constraint analises_satelitais_org_empresa_key unique (organization_id, empresa_id, id);

alter table erp.satelite_consulta_itens add constraint fk_satelite_consulta_itens_analise
  foreign key (organization_id, empresa_id, analise_id) references erp.analises_satelitais (organization_id, empresa_id, id);

alter table erp.analises_satelitais add constraint fk_analises_satelitais_consulta_item
  foreign key (organization_id, empresa_id, consulta_item_id) references erp.satelite_consulta_itens (organization_id, empresa_id, id);

-- ---------- 10) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_tabela text;
  v_ref record;
  v_fk record;
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

  -- As FKs compostas entre as tabelas (e com a área e a análise), sem cascata, coluna a coluna.
  for v_fk in
    select * from (values
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_consulta', 'satelite_consultas', array['organization_id', 'empresa_id', 'consulta_id']),
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_area', 'areas', array['organization_id', 'empresa_id', 'area_id']),
      ('satelite_consulta_itens', 'fk_satelite_consulta_itens_analise', 'analises_satelitais', array['organization_id', 'empresa_id', 'analise_id']),
      ('satelite_consumo', 'fk_satelite_consumo_item', 'satelite_consulta_itens', array['organization_id', 'empresa_id', 'consulta_item_id']),
      ('satelite_consumo', 'fk_satelite_consumo_consulta', 'satelite_consultas', array['organization_id', 'empresa_id', 'consulta_id']),
      ('analises_satelitais', 'fk_analises_satelitais_consulta_item', 'satelite_consulta_itens', array['organization_id', 'empresa_id', 'consulta_item_id'])
    ) as f(origem, nome, alvo, colunas)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conname = v_fk.nome and c.contype = 'f' and c.conrelid = ('erp.' || v_fk.origem)::regclass
         and c.confrelid = ('erp.' || v_fk.alvo)::regclass and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) = v_fk.colunas
         and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) = array['organization_id', 'empresa_id', 'id']
    ) then
      raise exception 'SAT-02: FK composta % (erp.% -> erp.%(organizacao, empresa, id); sem cascata) ausente.', v_fk.nome, v_fk.origem, v_fk.alvo;
    end if;
  end loop;

  -- As chaves únicas (organização, empresa, id) que as FKs compostas usam, e a do orçamento por mês.
  if (select count(*) from pg_constraint c
       where c.contype = 'u' and (c.conrelid, c.conname) in (
         ('erp.satelite_consultas'::regclass, 'satelite_consultas_org_empresa_key'),
         ('erp.satelite_consulta_itens'::regclass, 'satelite_consulta_itens_org_empresa_key'),
         ('erp.analises_satelitais'::regclass, 'analises_satelitais_org_empresa_key'),
         ('erp.satelite_orcamentos'::regclass, 'uq_satelite_orcamentos_mes'))) <> 4 then
    raise exception 'SAT-02: chaves unicas ausentes (satelite_consultas_org_empresa_key, satelite_consulta_itens_org_empresa_key, analises_satelitais_org_empresa_key, uq_satelite_orcamentos_mes).';
  end if;

  -- UM item vivo por chave: índice ÚNICO, PARCIAL, só na chave, com o predicado das três situações vivas.
  if not exists (
    select 1 from pg_index i
     where i.indexrelid = to_regclass('erp.uq_satelite_consulta_itens_chave')
       and i.indrelid = 'erp.satelite_consulta_itens'::regclass and i.indisunique and i.indisvalid
       -- indkey é int2vector (base 0): uma coluna só, e é a chave.
       and i.indnatts = 1
       and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'erp.satelite_consulta_itens'::regclass and attname = 'chave_idempotencia')
       and pg_get_expr(i.indpred, i.indrelid) = '(situacao = ANY (ARRAY[''pendente''::text, ''executando''::text, ''concluido''::text]))'
  ) then
    raise exception 'SAT-02: indice unico parcial uq_satelite_consulta_itens_chave (chave_idempotencia) where situacao in (pendente, executando, concluido) ausente.';
  end if;

  -- As colunas novas da análise: anuláveis e sem default (nenhuma linha existente muda).
  if (select count(*) from pg_attribute a
       where a.attrelid = 'erp.analises_satelitais'::regclass and not a.attisdropped and not a.attnotnull and not a.atthasdef
         and ((a.attname = 'consulta_item_id' and a.atttypid = 'uuid'::regtype)
           or (a.attname = 'resolucao_nativa_m' and a.atttypid = 'integer'::regtype)
           or (a.attname = 'evalscript_sha256' and a.atttypid = 'text'::regtype))) <> 3 then
    raise exception 'SAT-02: colunas novas de erp.analises_satelitais (consulta_item_id uuid, resolucao_nativa_m integer, evalscript_sha256 text) ausentes ou fora do contrato (anulaveis, sem default).';
  end if;

  -- Gatilhos: imutabilidade do ledger (linha e comando), updated_at e auditoria.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and (t.tgrelid, t.tgname, t.tgfoid) in (
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel_truncate', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_audit', 'erp.audit_row()'::regprocedure),
         ('erp.satelite_consultas'::regclass, 'trg_satelite_consultas_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_consultas'::regclass, 'trg_satelite_consultas_audit', 'erp.audit_row()'::regprocedure),
         ('erp.satelite_consulta_itens'::regclass, 'trg_satelite_consulta_itens_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_orcamentos'::regclass, 'trg_satelite_orcamentos_updated', 'erp.set_updated_at()'::regprocedure),
         ('erp.satelite_orcamentos'::regclass, 'trg_satelite_orcamentos_audit', 'erp.audit_row()'::regprocedure))) <> 8 then
    raise exception 'SAT-02: gatilhos das tabelas novas ausentes (imutabilidade do consumo por linha e por comando, updated_at, auditoria).';
  end if;
  -- A imutabilidade do ledger cobre UPDATE e DELETE por linha (tgtype: ROW=1, DELETE=8, UPDATE=16) e TRUNCATE por comando (32).
  if not exists (select 1 from pg_trigger where tgrelid = 'erp.satelite_consumo'::regclass and tgname = 'trg_satelite_consumo_imutavel'
                   and tgtype & (1 | 8 | 16) = (1 | 8 | 16) and tgenabled = 'O')
     or not exists (select 1 from pg_trigger where tgrelid = 'erp.satelite_consumo'::regclass and tgname = 'trg_satelite_consumo_imutavel_truncate'
                      and tgtype & 32 = 32 and tgtype & 1 = 0 and tgenabled = 'O') then
    raise exception 'SAT-02: imutabilidade de erp.satelite_consumo fora do contrato (UPDATE/DELETE por linha e TRUNCATE por comando, habilitados).';
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
