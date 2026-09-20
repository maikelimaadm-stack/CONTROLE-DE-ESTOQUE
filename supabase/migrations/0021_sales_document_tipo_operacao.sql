-- =====================================================================
-- 0021 SNAPSHOT DA TOP NO DOCUMENTO DE VENDA (TOP-CONFIG-02)
--
-- A TOP-CONFIG-01 criou a camada configurável (`erp.tipos_operacao` + `erp.tipos_operacao_versoes`). Esta
-- migration faz o PRIMEIRO LANÇAMENTO REAL usá-la: o documento de venda passa a gravar QUAL TOP o usuário
-- escolheu e QUAL VERSÃO dela valia naquele instante.
--
-- POR QUE DOIS PONTEIROS, E NÃO UM. Guardar só `tipo_operacao_id` faria o documento herdar o nome ATUAL da
-- TOP: renomear "Venda de Gado a Prazo" para "Venda de Bovinos a Prazo" reescreveria, em silêncio, o que um
-- documento de 2024 diz que é. O segundo ponteiro trava a versão: o documento cita a linha imutável que
-- existia no dia, e a edição administrativa de amanhã cria a versão N+1 sem tocar no passado. É a razão de
-- `erp.tipos_operacao_versoes` ser TABELA e não coluna (0020, seção 4).
--
-- POR QUE NULLABLE, E POR QUE NÃO HÁ BACKFILL. Duas razões independentes, ambas suficientes:
--   1. ACERVO: documentos criados antes desta fatia não escolheram TOP nenhuma. Inventar uma para eles seria
--      afirmar uma intenção que ninguém teve — e o número inventado ficaria indistinguível do escolhido.
--   2. ROLLING DEPLOY: durante a janela de implantação, web e API antigos continuam criando documentos sem o
--      campo. NOT NULL agora derrubaria a criação de vendas no meio do deploy.
-- Tornar obrigatório é fatia futura, depois de não haver mais cliente legado e com o acervo tratado
-- conscientemente. Está declarado como dívida em docs/TIPO-OPERACAO-CONTRACT.md.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (0018 usou 51, 0019 usou 52 e 53, 0020 usou 54).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 55) then
    raise exception 'TOP-CONFIG-02: outra transacao ja detem a trava desta migration (2026,55). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições estruturais ----------
-- Fail-closed: sem as três tabelas, as chaves estrangeiras abaixo não têm alvo. Criar as colunas assim mesmo
-- produziria ponteiro sem integridade — exatamente o estado impossível que a 0020 fechou do outro lado.
do $$
begin
  if to_regclass('erp.sales_documents') is null then
    raise exception 'TOP-CONFIG-02: erp.sales_documents nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.tipos_operacao') is null or to_regclass('erp.tipos_operacao_versoes') is null then
    raise exception 'TOP-CONFIG-02: a camada de TOP configurada (0020) nao esta aplicada; aplique-a antes.';
  end if;
  -- A FK do pai reaproveita a chave candidata que a 0020 criou. Se ela sumir, a FK falharia com erro cru de
  -- catálogo; aqui a recusa tem nome.
  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_tenant' and contype = 'u') then
    raise exception 'TOP-CONFIG-02: uq_tipos_operacao_tenant (0020) nao existe; sem ela a FK de tenant do pai nao pode ser criada.';
  end if;
end $$;

-- ---------- 3) chave candidata da VERSÃO dentro do tenant ----------
-- A 0020 deu à versão um `id` próprio (chave primária) e um `unique (tipo_operacao_id, organization_id,
-- versao)`. NENHUM dos dois serve de alvo para o que precisamos referenciar daqui: queremos provar, numa
-- única chave estrangeira, as TRÊS coisas ao mesmo tempo —
--   a versão existe · ela pertence ÀQUELA TOP · e as duas pertencem À MESMA ORGANIZAÇÃO.
-- Referenciar só o `id` provaria apenas a primeira: um documento poderia apontar para a versão 3 da TOP
-- 2101 enquanto `tipo_operacao_id` aponta para a 2103, e o nome exibido seria o do vizinho — sem nenhum erro.
-- Coluna única não prova tenant (.claude/rules/security.md, "Isolamento e RLS"), e aqui ela também não prova
-- parentesco.
alter table erp.tipos_operacao_versoes
  add constraint uq_tipos_operacao_versoes_tenant unique (id, tipo_operacao_id, organization_id);

-- ---------- 4) os dois ponteiros no documento ----------
alter table erp.sales_documents
  add column tipo_operacao_id uuid,
  add column tipo_operacao_versao_id uuid;

comment on column erp.sales_documents.tipo_operacao_id is
  'TOP configurada escolhida no lançamento. NULL = documento legado ou criado por cliente anterior à TOP-CONFIG-02.';
comment on column erp.sales_documents.tipo_operacao_versao_id is
  'Versão EXATA da TOP no instante do lançamento. O nome exibido sai daqui, nunca da versão corrente do pai.';

-- ---------- 5) paridade: meia identidade é pior que nenhuma ----------
-- Um documento com o pai preenchido e a versão nula perderia justamente a proteção que esta fatia existe
-- para dar: a leitura cairia de volta no nome atual da TOP. O inverso (versão sem pai) deixaria o ponteiro
-- sem dono. Os dois estados são inválidos, e o banco recusa os dois.
alter table erp.sales_documents
  add constraint sales_documents_tipo_operacao_par check (
    (tipo_operacao_id is null) = (tipo_operacao_versao_id is null)
  );

-- ---------- 6) FK do PAI, composta com o tenant ----------
-- MATCH SIMPLE (o padrão): quando qualquer coluna da chave é NULL, a restrição NÃO é conferida. É esse
-- comportamento que deixa o documento legado (ambos nulos) conviver com a FK sem exceção nenhuma.
--
-- SEM CASCADE, deliberadamente. A exclusão de TOP é LÓGICA (`excluido_em`): a linha continua existindo, e o
-- documento histórico continua legível. Se algum dia alguém tentar um delete físico, a FK TRAVA — que é o
-- comportamento certo. `on delete cascade` apagaria documentos de venda ao apagar uma configuração, e
-- `set null` apagaria a identidade do lançamento em silêncio, que é pior ainda.
alter table erp.sales_documents
  add constraint fk_sales_documents_tipo_operacao
  foreign key (tipo_operacao_id, organization_id)
  references erp.tipos_operacao (id, organization_id);

-- ---------- 7) FK da VERSÃO EXATA ----------
-- A chave de três colunas prova de uma vez: a versão existe, é daquela TOP, e tudo está no mesmo tenant.
--
-- Esta FK torna a da seção 6 tecnicamente redundante (a tabela de versões já tem a sua própria FK composta
-- para o pai). As duas ficam assim mesmo: a do pai declara a intenção — "o documento aponta para uma TOP" —
-- e sobrevive se um dia a modelagem da versão mudar. Redundância barata em integridade referencial é
-- barata; descobrir que a única FK que existia era a errada, não.
alter table erp.sales_documents
  add constraint fk_sales_documents_tipo_operacao_versao
  foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id)
  references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);

-- ---------- 8) índice para o filtro por TOP ----------
-- Justificado por consulta REAL: a listagem do Portal de Vendas filtra por TOP com
--   where d.organization_id = $1 and d.deleted_at is null and d.tipo_operacao_id = $n
-- Parcial em duas frentes porque as duas recortam o que a consulta enxerga: documento excluído nunca aparece
-- na listagem, e documento sem TOP nunca casa um filtro por TOP.
create index ix_sales_documents_tipo_operacao
  on erp.sales_documents (organization_id, tipo_operacao_id)
  where deleted_at is null and tipo_operacao_id is not null;

-- ---------- 9) pós-condições: o que foi prometido existe ----------
-- Migration que "passa" sem ter criado o que prometeu é a falha mais cara de achar depois, porque o deploy
-- fica verde e o defeito só aparece no primeiro lançamento.
do $$
declare
  v_rls record;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='erp' and table_name='sales_documents' and column_name='tipo_operacao_id')
     or not exists (select 1 from information_schema.columns
                  where table_schema='erp' and table_name='sales_documents' and column_name='tipo_operacao_versao_id') then
    raise exception 'TOP-CONFIG-02: as colunas de TOP nao foram criadas em erp.sales_documents';
  end if;

  -- As duas colunas TÊM de continuar aceitando NULL: é o que sustenta acervo e rolling deploy.
  if exists (select 1 from information_schema.columns
              where table_schema='erp' and table_name='sales_documents'
                and column_name in ('tipo_operacao_id','tipo_operacao_versao_id') and is_nullable = 'NO') then
    raise exception 'TOP-CONFIG-02: as colunas de TOP precisam ser NULLABLE nesta fase (acervo e rolling deploy)';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_documents_tipo_operacao_par' and contype = 'c') then
    raise exception 'TOP-CONFIG-02: o CHECK de paridade dos dois ponteiros nao foi criado';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fk_sales_documents_tipo_operacao' and contype = 'f') then
    raise exception 'TOP-CONFIG-02: a FK do pai (fk_sales_documents_tipo_operacao) nao foi criada';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'fk_sales_documents_tipo_operacao_versao' and contype = 'f') then
    raise exception 'TOP-CONFIG-02: a FK da versao exata (fk_sales_documents_tipo_operacao_versao) nao foi criada';
  end if;

  -- Nenhuma das duas FKs pode ter ação de cascata: `a` = NO ACTION.
  if exists (select 1 from pg_constraint
              where conname in ('fk_sales_documents_tipo_operacao','fk_sales_documents_tipo_operacao_versao')
                and (confdeltype <> 'a' or confupdtype <> 'a')) then
    raise exception 'TOP-CONFIG-02: as FKs de TOP nao podem cascatear; apagar configuracao nao apaga lancamento';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_versoes_tenant' and contype = 'u') then
    raise exception 'TOP-CONFIG-02: a chave candidata da versao (uq_tipos_operacao_versoes_tenant) nao foi criada';
  end if;

  -- Acrescentar coluna não mexe em RLS, mas a ausência dela aqui seria catastrófica e silenciosa: conferir
  -- custa uma linha. `erp.sales_documents` nasceu na 0005, ANTES do bloco dinâmico da 0007, então foi
  -- alcançada por ele — esta asserção prova que continua assim.
  select c.relrowsecurity, c.relforcerowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'sales_documents';
  if not v_rls.relrowsecurity or not v_rls.relforcerowsecurity then
    raise exception 'TOP-CONFIG-02: erp.sales_documents perdeu RLS habilitada/forcada';
  end if;

  if not exists (select 1 from pg_indexes where schemaname='erp' and indexname='ix_sales_documents_tipo_operacao') then
    raise exception 'TOP-CONFIG-02: o indice do filtro por TOP nao foi criado';
  end if;
end $$;
