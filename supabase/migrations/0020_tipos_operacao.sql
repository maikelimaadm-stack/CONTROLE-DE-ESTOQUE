-- =====================================================================
-- 0020 TIPOS DE OPERAÇÃO CONFIGURÁVEIS (TOP-CONFIG-01)
--
-- DUAS CAMADAS, NUNCA UMA. A FAMÍLIA CANÔNICA de operação (`vendas.venda`, `estoque.baixa`, …) continua
-- morando em `packages/domain/src/tipo-operacao.ts`, em Git, imutável em runtime: é a espécie operacional
-- que o PRODUTO conhece. O que nasce aqui é outra coisa — a TOP CONFIGURADA da organização: o "2103 — Venda
-- de Gado a Prazo" que o administrador cadastra e que APONTA para uma família canônica.
--
-- Por que não materializar as famílias como linhas: seriam duas fontes de verdade para a mesma lista, e a
-- segunda envelhece em silêncio (docs/TIPO-OPERACAO-CONTRACT.md §10). Aqui não há cópia do registry — há uma
-- coluna `codigo_base` cujo conteúdo é VALIDADO PELO DOMÍNIO contra `CODIGOS_TIPO_OPERACAO` antes de chegar
-- ao banco. O banco garante forma e integridade de tenant; o domínio garante que a família existe.
--
-- POR QUE VERSÃO É TABELA, E NÃO COLUNA: o nome de uma TOP é o que o documento vai citar quando a
-- TOP-CONFIG-02 ligar lançamento e TOP. Se a edição sobrescrevesse o nome, um documento de 2024 passaria a
-- exibir o nome de 2026 — histórico reescrito sem ninguém pedir. Por isso conteúdo (nome, descrição) é
-- IMUTÁVEL e versionado, e estado operacional (ativo, padrão) mora no pai, onde muda.
--
-- Nomenclatura: superfície nova nasce em português (docs/DOMAIN-NAMING-STANDARD.md §1.6). `organization_id`
-- permanece em inglês pela exceção já registrada naquele documento — é a convenção transversal das políticas
-- de RLS (`erp.tenant_visible(organization_id)`), e divergir aqui criaria uma segunda convenção de tenant.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia, transacional, nunca reaproveitada (0018 usou 51, 0019 usou 52 e 53).
-- Dois runners simultâneos (dois deploys, ou deploy + operador) não podem criar as mesmas tabelas em
-- paralelo: o segundo falha com mensagem nomeada em vez de erro cru de catálogo.
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 54) then
    raise exception 'TOP-CONFIG-01: outra transacao ja detem a trava desta migration (2026,54). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições estruturais ----------
-- Fail-closed: as duas tabelas referenciam organização e usuário, e a política de RLS depende de
-- `erp.tenant_visible`. Se qualquer um faltar, a migration PARA — criar as tabelas assim mesmo produziria
-- tabela sem isolamento de tenant, que é pior do que não ter tabela.
do $$
begin
  if to_regclass('erp.organizations') is null then
    raise exception 'TOP-CONFIG-01: erp.organizations nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.users') is null then
    raise exception 'TOP-CONFIG-01: erp.users nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('erp.tenant_visible(uuid)') is null then
    raise exception 'TOP-CONFIG-01: erp.tenant_visible(uuid) nao existe; sem ela a politica de RLS nao pode ser criada.';
  end if;
end $$;

-- Gatilho de carimbo em PORTUGUÊS. `erp.set_updated_at()` escreve `NEW.updated_at`, coluna que estas tabelas
-- não têm — usá-la aqui faria TODO update falhar com "record new has no field updated_at". Esta é a irmã
-- dela para a nomenclatura de destino; a antiga permanece intocada, servindo as tabelas que já existem.
create or replace function erp.set_atualizado_em() returns trigger
language plpgsql as $$
begin
  NEW.atualizado_em := now();
  return NEW;
end $$;

-- ---------- 3) identidade estável da TOP configurada ----------
-- `codigo` e `codigo_base` são ESTÁVEIS depois da criação. O banco não consegue exprimir "imutável depois de
-- inserido" sem gatilho; a regra é cobrada na API (rota recusa a troca) E pelo gatilho da seção 6, porque
-- uma regra que só existe na aplicação não sobrevive a um `psql` de madrugada.
--
-- `codigo` é TEXT e não integer: "0101" e "101" são códigos diferentes para o usuário, e o zero à esquerda
-- morre num integer. A forma é restrita para não virar campo livre.
create table erp.tipos_operacao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  codigo text not null check (codigo ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  codigo_base text not null check (codigo_base ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  ativo boolean not null default true,
  padrao boolean not null default false,
  -- Número da versão de CONTEÚDO vigente. Aponta para `erp.tipos_operacao_versoes.versao`.
  versao_atual int not null default 1 check (versao_atual >= 1),
  -- Token de concorrência otimista. Incrementa em QUALQUER escrita — inclusive nas que não geram versão de
  -- conteúdo (ativar, desativar, definir padrão). Sem ele, dois administradores editando estado ao mesmo
  -- tempo perderiam uma das escritas em silêncio.
  revisao int not null default 1 check (revisao >= 1),
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  excluido_em timestamptz
);

-- CÓDIGO ÚNICO POR ORGANIZAÇÃO, E NÃO REUTILIZÁVEL APÓS EXCLUSÃO.
-- O índice NÃO tem `where excluido_em is null` de propósito: um código já exposto ao usuário não pode
-- apontar para duas identidades diferentes ao longo do tempo. Um relatório antigo que cita "2103" tem de
-- continuar significando uma coisa só. Reaproveitar código excluído é o tipo de economia que vira incidente
-- de auditoria anos depois.
create unique index ux_tipos_operacao_codigo on erp.tipos_operacao (organization_id, codigo);

-- NO MÁXIMO UMA PADRÃO POR FAMÍLIA, e a garantia é do BANCO.
-- Parcial de propósito: só disputa o posto quem está ativo, é padrão e não foi excluído. A aplicação troca o
-- padrão na mesma transação (rota `padrao`), mas a invariante crítica mora aqui — validação de aplicação é
-- complemento, nunca a autoridade (CLAUDE.md, "Dados").
create unique index ux_tipos_operacao_padrao on erp.tipos_operacao (organization_id, codigo_base)
  where padrao and ativo and excluido_em is null;

-- Listagem: o filtro sempre começa por organização, e quase sempre recorta por família ou por ativo.
create index ix_tipos_operacao_listagem on erp.tipos_operacao (organization_id, codigo_base, ativo)
  where excluido_em is null;

create trigger trg_tipos_operacao_atualizado before update on erp.tipos_operacao
  for each row execute function erp.set_atualizado_em();

comment on table erp.tipos_operacao is
  'TOP CONFIGURADA da organização (TOP-CONFIG-01): identidade estável que aponta para uma FAMÍLIA CANÔNICA de packages/domain/src/tipo-operacao.ts. Não é a família; não duplica o registry. Conteúdo versionado em erp.tipos_operacao_versoes.';
comment on column erp.tipos_operacao.codigo_base is
  'Código da família canônica (ex.: vendas.venda). A existência da família é validada pelo DOMÍNIO contra CODIGOS_TIPO_OPERACAO; o banco só garante a forma. Imutável depois da criação.';
comment on column erp.tipos_operacao.revisao is
  'Token de concorrência otimista; incrementa em toda escrita, inclusive nas que não geram versão de conteúdo.';

-- ---------- 4) versões imutáveis de conteúdo ----------
-- Sem `excluido_em`: versão não se exclui. Excluir a TOP (soft delete no pai) preserva o histórico inteiro —
-- é exatamente para isso que ele existe.
create table erp.tipos_operacao_versoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  tipo_operacao_id uuid not null references erp.tipos_operacao(id) on delete restrict,
  versao int not null check (versao >= 1),
  nome text not null check (length(btrim(nome)) between 1 and 120),
  descricao text check (length(descricao) <= 500),
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),
  -- A chave candidata inclui a organização porque é ela que a FK da versão CORRENTE referencia (seção 4.1):
  -- sem `organization_id` na chave, a FK do pai poderia ser satisfeita por uma versão de outro tenant.
  unique (tipo_operacao_id, organization_id, versao)
);

-- Histórico de UMA TOP, da mais recente para a mais antiga.
create index ix_tipos_operacao_versoes_historico on erp.tipos_operacao_versoes (tipo_operacao_id, versao desc);

-- CHAVE ESTRANGEIRA COMPOSTA DE TENANT. Coluna única não prova tenant: sem isto, uma versão da organização A
-- poderia apontar para uma TOP da organização B e o vazamento seria invisível na leitura normal
-- (.claude/rules/security.md, "Isolamento e RLS").
alter table erp.tipos_operacao add constraint uq_tipos_operacao_tenant unique (id, organization_id);
alter table erp.tipos_operacao_versoes add constraint fk_tipos_operacao_versoes_tenant
  foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id);

-- ---------- 4.1) a VERSÃO CORRENTE tem de existir ----------
-- `versao_atual` era só um inteiro, e o runtime confia nele para montar o `join` que devolve nome e
-- descrição. Um `update ... set versao_atual = 999` produzia um ESTADO IMPOSSÍVEL: a identidade existe e o
-- conteúdo corrente não. A leitura não falhava — ela simplesmente DEVOLVIA ZERO LINHAS, e a TOP sumia da
-- listagem e do detalhe sem erro nenhum. Invariante crítica mora no banco; a aplicação é complemento.
--
-- DEFERRABLE INITIALLY DEFERRED porque a criação insere o PAI antes da versão 1, na mesma transação: a
-- checagem imediata reprovaria a ordem natural da escrita. Adiada para o COMMIT, ela aceita a transação
-- correta e recusa a que terminasse com a versão apontada inexistente.
--
-- A tripla inclui `organization_id` dos dois lados: uma versão de OUTRO tenant não pode satisfazer a
-- versão corrente desta TOP — é a mesma razão da chave estrangeira composta acima.
alter table erp.tipos_operacao add constraint fk_tipos_operacao_versao_atual
  foreign key (id, organization_id, versao_atual)
  references erp.tipos_operacao_versoes (tipo_operacao_id, organization_id, versao)
  deferrable initially deferred;

comment on table erp.tipos_operacao_versoes is
  'Conteúdo IMUTÁVEL e versionado de uma TOP configurada. Editar cria versão N+1; nenhuma versão é sobrescrita ou apagada, porque o documento que citar a versão precisa continuar significando o que significava.';

-- ---------- 5) RLS e grants ----------
-- O bloco genérico de 0007 já rodou; tabela criada depois dele NÃO é alcançada retroativamente. Toda
-- migration pós-0007 declara a própria RLS (0008, 0009, 0010, 0011, 0012, 0014) e esta segue o mesmo padrão.
-- Política ÚNICA por tabela: políticas PERMISSIVE combinam com OR, e duas políticas conviventes valeriam
-- sempre pela mais frouxa.
alter table erp.tipos_operacao enable row level security;
alter table erp.tipos_operacao force row level security;
create policy tenant_isolation on erp.tipos_operacao for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
grant select, insert, update, delete on erp.tipos_operacao to erp_app;

alter table erp.tipos_operacao_versoes enable row level security;
alter table erp.tipos_operacao_versoes force row level security;
create policy tenant_isolation on erp.tipos_operacao_versoes for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- VERSÃO É HISTÓRICO IMUTÁVEL, E O GRANT TEM DE DIZER ISSO — MAS `grant` SOZINHO NÃO BASTA.
-- A 0007 declarou `alter default privileges in schema erp grant select, insert, update, delete ... to
-- erp_app`, então toda tabela nova JÁ NASCE com os quatro privilégios. Conceder aqui "apenas select e
-- insert" é aditivo: não tira nada, e o papel continuaria podendo apagar histórico. Medido — o teste de
-- schema encontrou `DELETE, INSERT, SELECT, UPDATE` onde este arquivo prometia dois. Por isso a revogação
-- é EXPLÍCITA, e vem depois do grant.
grant select, insert on erp.tipos_operacao_versoes to erp_app;
revoke update, delete on erp.tipos_operacao_versoes from erp_app;

-- ---------- 6) invariantes críticas em gatilho ----------
-- Regra que só existe na aplicação não sobrevive a um acesso direto ao banco. As duas invariantes que
-- MUDARIAM O SIGNIFICADO DO HISTÓRICO moram aqui.

-- 6.1 versão é imutável
create or replace function erp.tipos_operacao_versao_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'TIPO_OPERACAO_VERSAO_IMUTAVEL: versao de tipo de operacao nao aceita % (a edicao cria uma versao nova)', TG_OP
    using errcode = 'P0001';
end $$;

create trigger trg_tipos_operacao_versoes_imutavel
  before update or delete on erp.tipos_operacao_versoes
  for each row execute function erp.tipos_operacao_versao_imutavel();

-- 6.2 código e família são estáveis depois da criação
-- Trocar a família de uma TOP já usada reclassificaria retroativamente todo lançamento que a citasse — é
-- reescrita de histórico com outro nome.
create or replace function erp.tipos_operacao_identidade_estavel() returns trigger
language plpgsql as $$
begin
  if NEW.codigo is distinct from OLD.codigo then
    raise exception 'TIPO_OPERACAO_IDENTIDADE_IMUTAVEL: o codigo de um tipo de operacao nao muda depois da criacao (%s -> %s)', OLD.codigo, NEW.codigo
      using errcode = 'P0001';
  end if;
  if NEW.codigo_base is distinct from OLD.codigo_base then
    raise exception 'TIPO_OPERACAO_IDENTIDADE_IMUTAVEL: a familia canonica de um tipo de operacao nao muda depois da criacao (%s -> %s)', OLD.codigo_base, NEW.codigo_base
      using errcode = 'P0001';
  end if;
  if NEW.organization_id is distinct from OLD.organization_id then
    raise exception 'TIPO_OPERACAO_IDENTIDADE_IMUTAVEL: a organizacao de um tipo de operacao nao muda'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

create trigger trg_tipos_operacao_identidade_estavel
  before update on erp.tipos_operacao
  for each row execute function erp.tipos_operacao_identidade_estavel();

-- ---------- 7) pós-condições ----------
-- Um gate que não confere o próprio efeito é um carimbo. Aqui se prova o que a migration prometeu.
do $$
declare
  v_rls int;
  v_politicas int;
  v_gatilhos int;
begin
  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname in ('tipos_operacao', 'tipos_operacao_versoes')
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 2 then
    raise exception 'TOP-CONFIG-01: esperava RLS habilitada E forcada nas 2 tabelas, encontrei %', v_rls;
  end if;

  select count(*) into v_politicas from pg_policies
   where schemaname = 'erp' and tablename in ('tipos_operacao', 'tipos_operacao_versoes');
  if v_politicas <> 2 then
    raise exception 'TOP-CONFIG-01: esperava exatamente 1 politica por tabela (2 no total), encontrei % — politicas PERMISSIVE combinam com OR e a mais frouxa venceria', v_politicas;
  end if;

  -- A FK da versão corrente é a diferença entre "o conteúdo atual existe" e "o runtime confia num inteiro".
  if not exists (select 1 from pg_constraint where conname = 'fk_tipos_operacao_versao_atual' and contype = 'f') then
    raise exception 'TOP-CONFIG-01: a FK da versao corrente (fk_tipos_operacao_versao_atual) nao foi criada';
  end if;

  select count(*) into v_gatilhos from pg_trigger t join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and not t.tgisinternal
     and t.tgname in ('trg_tipos_operacao_versoes_imutavel', 'trg_tipos_operacao_identidade_estavel', 'trg_tipos_operacao_atualizado');
  if v_gatilhos <> 3 then
    raise exception 'TOP-CONFIG-01: esperava os 3 gatilhos de invariante, encontrei %', v_gatilhos;
  end if;

  raise notice 'TOP-CONFIG-01: erp.tipos_operacao e erp.tipos_operacao_versoes criadas, RLS forcada, 1 politica por tabela, 3 gatilhos.';
end $$;
