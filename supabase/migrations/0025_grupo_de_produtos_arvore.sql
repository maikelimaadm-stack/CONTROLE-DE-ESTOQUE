-- =====================================================================
-- 0025 GRUPO DE PRODUTOS EM ÁRVORE (CADASTROS-ESTRUTURA, entrega B)
--
-- Até aqui o produto era classificado em TRÊS cadastros planos obrigatórios (product_groups →
-- product_categories → product_kinds; products.group_id, category_id e kind_id NOT NULL). Esta migration
-- transforma o Grupo de Produtos numa ÁRVORE com código hierárquico (mesmo mecanismo da decisão 244) e
-- solta a obrigatoriedade de categoria e classe no produto.
--
-- O QUE MUDA:
--   · erp.product_groups ganha code, parent_id, kind ('synthetic'|'analytic', padrão 'analytic') e deleted_at;
--   · chave candidata (id, organization_id) e FK COMPOSTA do parent_id com o tenant (coluna única não
--     prova tenant — .claude/rules/security.md), SEM cascade e SEM set null;
--   · código único por organização entre os VIVOS (índice parcial);
--   · nome único entre IRMÃOS vivos (mesmo pai), no lugar da unique (organization_id, name) da 0002;
--   · erp.products.category_id e kind_id deixam de ser NOT NULL.
--
-- POR QUE code FICA NULL NO BANCO. O acervo não tem código (produção: 1 grupo, "teste", sem código) e a
-- decisão 240(3) proíbe inventar dado. A API exige o código para CRIAR e para EDITAR um grupo; NULL só
-- existe no acervo, e a listagem mostra esse grupo como raiz, no fim.
--
-- A RAIZ NA UNICIDADE DE NOME. Numa unique comum, NULL é distinto de NULL: duas raízes (parent_id nulo) com
-- o mesmo nome passariam. O índice usa `coalesce(parent_id, <uuid nulo>)`, o que põe TODAS as raízes da
-- organização sob o mesmo "pai" sentinela — duas raízes com o mesmo nome colidem como dois irmãos. O uuid
-- nulo (00000000-…) nunca é id de grupo (gen_random_uuid gera v4). A comparação é SEM diferenciar
-- maiúsculas (`lower(name)`): "Rações" e "rações" sob o mesmo pai são o mesmo grupo para quem lê a árvore.
-- Como isso é MAIS estrito que a 0002 para duas raízes que só diferem na caixa, a pré-condição 2 confere
-- o acervo antes e PARA nomeando os grupos em conflito — nada é renomeado aqui.
--
-- A unique (organization_id, name) DA 0002 SAI: com a árvore, "Rações" pode existir sob "Pecuária" e sob
-- "Aves". É um relaxamento (nenhuma linha muda). O único usuário do `on conflict (organization_id, name)`
-- era o seed de demonstração (packages/db/src/seed.ts), ajustado nesta fatia. O binário ANTERIOR da API
-- não usa esse `on conflict` em runtime (conferido em .api-anterior/apps/api/src: nenhuma ocorrência); a
-- API grava grupo pelo insert genérico do Resource Registry, sem `on conflict`.
--
-- product_categories E product_kinds FICAM (sem drop, sem apagar coluna): legado fora de uso. A web
-- anterior ainda usa os lookups deles durante a janela de deploy.
--
-- NATUREZA: aditiva/relaxante. Nenhum UPDATE, nenhum DELETE, nenhuma linha existente muda de valor (as
-- colunas novas nascem com o padrão; a pós-condição da seção 9 prova que nenhuma linha ganhou código,
-- pai ou exclusão).
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (0017 a 0024 usaram 51 a 58).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 59) then
    raise exception 'CADASTROS-ESTRUTURA: outra transacao ja detem a trava desta migration (2026,59). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_dup text;
begin
  if to_regclass('erp.product_groups') is null or to_regclass('erp.products') is null then
    raise exception 'CADASTROS-ESTRUTURA: erp.product_groups ou erp.products nao existe; a cadeia de migrations esta fora de ordem.';
  end if;
  -- A 0024 é a anterior na cadeia; sem ela a ordem de aplicação está errada.
  if not exists (select 1 from pg_constraint where conname = 'uq_financial_categories_tenant' and contype = 'u') then
    raise exception 'CADASTROS-ESTRUTURA: a 0024 nao esta aplicada; aplique a 0024 antes.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'erp' and table_name = 'product_groups'
                and column_name in ('code', 'parent_id', 'kind', 'deleted_at')) then
    raise exception 'CADASTROS-ESTRUTURA: erp.product_groups ja tem coluna de arvore; a migration nao e reaplicavel.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_groups_organization_id_name_key' and contype = 'u') then
    raise exception 'CADASTROS-ESTRUTURA: a unique (organization_id, name) da 0002 nao foi encontrada com o nome esperado.';
  end if;
  -- Hoje todo grupo é raiz. A unicidade nova (irmãos, sem diferenciar maiúsculas) é mais estrita que a da
  -- 0002 para nomes que só diferem na caixa: PARA nomeando os grupos. Nada é renomeado aqui.
  select string_agg(format('%s (organizacao %s)', nomes, organization_id), '; ')
    into v_dup
    from (select organization_id, string_agg(quote_literal(name), ', ' order by name) as nomes
            from erp.product_groups
           group by organization_id, lower(name)
          having count(*) > 1) d;
  if v_dup is not null then
    raise exception 'CADASTROS-ESTRUTURA: grupos de produtos com o mesmo nome (sem diferenciar maiusculas) na mesma organizacao: %. Renomeie um deles antes; nada foi aplicado.', v_dup;
  end if;
end $$;

-- ---------- 3) as colunas da árvore ----------
alter table erp.product_groups
  add column code text,
  add column parent_id uuid,
  add column kind text not null default 'analytic',
  add column deleted_at timestamptz;

alter table erp.product_groups
  add constraint product_groups_kind_check check (kind in ('synthetic', 'analytic'));

comment on column erp.product_groups.code is
  'Código hierárquico (máscara em parameters.mascaras_codigo.product_groups). NULL só no acervo anterior à CADASTROS-ESTRUTURA: a API exige código para criar e editar.';
comment on column erp.product_groups.parent_id is
  'Grupo superior (sintético), da mesma organização. NULL = raiz.';
comment on column erp.product_groups.kind is
  'analytic = recebe produto; synthetic = só agrupa (tem filhos).';

-- ---------- 4) chave candidata de tenant e FK composta do pai ----------
alter table erp.product_groups
  add constraint uq_product_groups_tenant unique (id, organization_id);

-- MATCH SIMPLE (padrão): parent_id nulo (raiz) passa. SEM cascade e SEM set null: a exclusão é lógica e a
-- API recusa excluir grupo com filhos vivos; delete físico de um pai TRAVA.
alter table erp.product_groups
  add constraint fk_product_groups_parent
  foreign key (parent_id, organization_id)
  references erp.product_groups (id, organization_id);

create index ix_product_groups_parent on erp.product_groups (organization_id, parent_id);

-- ---------- 5) unicidade de código ----------
-- Entre os VIVOS: código de grupo excluído pode ser reaproveitado. NULL (acervo) não colide.
create unique index uq_product_groups_code_vivo
  on erp.product_groups (organization_id, code)
  where deleted_at is null;

-- ---------- 6) unicidade de nome entre irmãos ----------
-- Ver o cabeçalho: o coalesce põe todas as raízes sob o mesmo pai sentinela.
alter table erp.product_groups drop constraint product_groups_organization_id_name_key;

create unique index uq_product_groups_nome_irmaos
  on erp.product_groups (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where deleted_at is null;

-- ---------- 7) categoria e classe deixam de ser obrigatórias no produto ----------
-- Nada é apagado: as colunas e os valores do acervo ficam. A web anterior continua mandando os dois.
alter table erp.products alter column category_id drop not null;
alter table erp.products alter column kind_id drop not null;

-- ---------- 8) documentação ----------
comment on table erp.product_categories is
  'LEGADO (CADASTROS-ESTRUTURA): fora da navegação e da importação. Mantida para o acervo e para a web anterior na janela de deploy.';
comment on table erp.product_kinds is
  'LEGADO (CADASTROS-ESTRUTURA): fora da navegação e da importação. Mantida para o acervo e para a web anterior na janela de deploy.';

-- ---------- 9) pós-condições ----------
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'product_groups'
         and ((column_name in ('code', 'parent_id', 'deleted_at') and is_nullable = 'YES')
           or (column_name = 'kind' and is_nullable = 'NO'))) <> 4 then
    raise exception 'CADASTROS-ESTRUTURA: as colunas da arvore nao foram criadas como esperado';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_product_groups_tenant' and contype = 'u') then
    raise exception 'CADASTROS-ESTRUTURA: a chave candidata de tenant nao foi criada';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'fk_product_groups_parent' and contype = 'f'
                    and confdeltype = 'a' and confupdtype = 'a' and array_length(conkey, 1) = 2) then
    raise exception 'CADASTROS-ESTRUTURA: a FK composta do pai (sem cascata) nao foi criada';
  end if;
  if exists (select 1 from pg_constraint where conname = 'product_groups_organization_id_name_key') then
    raise exception 'CADASTROS-ESTRUTURA: a unique (organization_id, name) da 0002 continua ativa';
  end if;
  if (select count(*) from pg_indexes
       where schemaname = 'erp' and tablename = 'product_groups'
         and indexname in ('uq_product_groups_code_vivo', 'uq_product_groups_nome_irmaos')) <> 2 then
    raise exception 'CADASTROS-ESTRUTURA: os indices de unicidade (codigo e nome entre irmaos) nao foram criados';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'products'
         and column_name in ('category_id', 'kind_id') and is_nullable = 'YES') <> 2 then
    raise exception 'CADASTROS-ESTRUTURA: category_id e kind_id do produto continuam NOT NULL';
  end if;
  if to_regclass('erp.product_categories') is null or to_regclass('erp.product_kinds') is null then
    raise exception 'CADASTROS-ESTRUTURA: os cadastros legados de categoria e classe precisam continuar existindo';
  end if;
  -- aditiva de verdade: nenhum grupo do acervo ganha código, pai, exclusão ou vira sintético
  if exists (select 1 from erp.product_groups
              where code is not null or parent_id is not null or deleted_at is not null or kind <> 'analytic') then
    raise exception 'CADASTROS-ESTRUTURA: ha grupo com dado de arvore logo apos a migration; ela nao pode alterar dado';
  end if;
end $$;
