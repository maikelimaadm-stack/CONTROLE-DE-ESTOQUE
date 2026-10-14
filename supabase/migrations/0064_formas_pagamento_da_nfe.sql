-- =====================================================================
-- 0064 XML-04 — A FORMA DE PAGAMENTO DA NOTA (a ligação do código tPag da NF-e a uma forma de pagamento) — decisão 318
--
-- "O fator vem do cadastro, a forma vem da nota, e a duplicata diz por quê." A nota fiscal eletrônica diz COMO foi
-- paga no grupo de pagamento (detPag/tPag: 01 dinheiro, 15 boleto, 17 Pix dinâmico, 20 Pix estático…). O código é da
-- SEFAZ, e a forma de pagamento é do ERP (erp.payment_methods). Esta migration cria só a PONTE entre os dois, por
-- organização — quem lê a nota e escolhe a forma é a API (decisão 318); a lista dos códigos e o rótulo moram no domínio
-- (`CODIGOS_TPAG_DA_NFE` e `rotuloDoTPag` em `packages/domain/src/nfe-leitura.ts`).
--
-- 1) erp.formas_pagamento_da_nfe — cadastro de ORGANIZAÇÃO (sem empresa_id: é configuração, como erp.payment_methods):
--    · codigo_tpag text not null, CHECK de dois dígitos: o banco recusa o que não tem forma de código da nota; QUAIS
--      códigos existem é regra do domínio (a lista da SEFAZ cresce sem migration), e a API confere contra ela;
--    · forma_pagamento_id → erp.payment_methods(id): a forma que o código vira;
--    · created_at/updated_at (erp.set_updated_at) e deleted_at, como erp.condicoes_pagamento (0031); SEM is_active:
--      desligar a ligação é EXCLUIR (lógica, deleted_at), e o DELETE é revogado do erp_app;
--    · auditoria pela erp.audit_row (AFTER, como os cadastros de configuração da 0041 e da 0061): a ligação decide a
--      forma do financeiro de toda nota que chega depois, e o histórico do cadastro genérico lê erp.audit_logs.
-- 2) UMA FORMA POR CÓDIGO POR ORGANIZAÇÃO: índice único PARCIAL (organization_id, codigo_tpag) where deleted_at is
--    null. O código da nota tem de virar EXATAMENTE uma forma: duas ligações vivas para o mesmo código obrigariam a API
--    a escolher "a primeira" de novo — o mesmo palpite que a decisão 318 tira do caminho. A excluída não conta: excluir
--    libera o código para uma ligação nova, e a excluída fica como histórico. A MESMA forma PODE receber vários códigos
--    (17 Pix dinâmico e 20 Pix estático → a mesma forma Pix), por isso nada é único na forma.
-- 3) A FORMA É DA ORGANIZAÇÃO OU DO SISTEMA. erp.payment_methods tem organization_id NULÁVEL (as formas do sistema
--    têm organização nula; na produção as dez são do sistema), então a chave estrangeira COMPOSTA — o jeito de sempre de
--    provar o tenant (security.md) — é impossível: a forma do sistema não tem o par (id, organization_id) a casar. A FK
--    simples só prova que a forma EXISTE, em QUALQUER organização. Quem prova o tenant é o gatilho
--    `trg_formas_pagamento_da_nfe_forma` (BEFORE INSERT OR UPDATE, por linha): recusa a forma que não é da MESMA
--    organização da ligação nem do sistema, com `VALIDATION_ERROR:` e errcode P0001 — o `fromPgError` da API
--    (apps/api/src/lib/errors.ts) devolve 422 legível, nunca 500. A forma INEXISTENTE e a de OUTRA organização recebem a
--    MESMA recusa, antes da FK (o BEFORE roda antes dela): negar não revela existência.
--    A função é SECURITY INVOKER, com search_path fixo `erp, pg_temp`: o erp_app lê erp.payment_methods pela política
--    ref_payment_methods da 0007 (`organization_id is null or erp.tenant_visible(organization_id)`), que mostra as do
--    sistema e as da própria organização — exatamente as que a ligação aceita. A de outra organização fica invisível e
--    cai na recusa; o dono da migration (sem RLS) vê todas, e a comparação explícita de organization_id recusa do mesmo
--    jeito. Nada a atravessar, então nada de SECURITY DEFINER. O EXECUTE sai de todo papel além do dono (o default
--    privilege da 0007 o dá ao erp_app): gatilho não precisa de EXECUTE de quem grava, e a função não é porta.
--    Excluir nunca é bloqueado: o UPDATE que deixa a linha excluída sem trocar a forma nem a organização passa sem
--    conferir (a ligação excluída não decide nada; o índice e a API só leem as vivas). Todo INSERT confere — inclusive o
--    de linha já excluída, senão a FK diria se a forma de outra organização existe.
-- 4) RLS habilitada e FORÇADA, política ÚNICA tenant_isolation (a mesma de erp.condicoes_pagamento, conferida pelo
--    catálogo na pós-condição). Grants: select, insert e update ao erp_app; delete e truncate revogados (o default
--    privilege da 0007 dá delete).
--
-- SEM BACKFILL e SEM SEMENTE: tabela nova e vazia — nenhuma ligação nasce aqui (nenhum INSERT de dado). Sem ligação, a
-- API não escolhe forma pela nota; quem liga é a organização, pelo cadastro.
-- JANELA DE DEPLOY (pre-deploy, banco → API → web): a API anterior não conhece a tabela; nada do que ela grava passa por
-- aqui. VOLTA: API e web voltam por redeploy e convivem com a 0064 (a tabela vazia não recusa nada do caminho anterior).
-- Tirar a tabela do banco é decisão humana, com migration própria.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome no
-- ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fatia (2026,98).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 98) then
    raise exception 'XML-04: outra transacao ja detem a trava desta migration (2026,98). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  -- "Já aplicada" ANTES de TODAS as demais: depois da 0064 a tabela existe, e a reaplicação precisa dizer o motivo
  -- verdadeiro.
  if to_regclass('erp.formas_pagamento_da_nfe') is not null then
    raise exception 'XML-04: erp.formas_pagamento_da_nfe ja existe; a 0064 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.formas_pagamento_da_nfe_forma_guarda()') is not null then
    raise exception 'XML-04: a funcao erp.formas_pagamento_da_nfe_forma_guarda() ja existe; schema divergente.';
  end if;
  if to_regclass('erp.ux_formas_pagamento_da_nfe_codigo_vivo') is not null then
    raise exception 'XML-04: ja existe uma relacao erp.ux_formas_pagamento_da_nfe_codigo_vivo; schema divergente.';
  end if;
  -- A anterior da cadeia: a 0063 (EDITAR-02) deixa erp.documentos_compra.version.
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('erp.documentos_compra') and a.attname = 'version' and not a.attisdropped) then
    raise exception 'XML-04: a 0063 nao esta aplicada (erp.documentos_compra.version ausente); a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regclass('erp.organizations') is null then
    raise exception 'XML-04: erp.organizations ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  -- A premissa do gatilho: a forma tem id uuid e organization_id uuid (nulo = do sistema). to_regclass, e não
  -- ::regclass: com a tabela ausente o cast pararia com "relation does not exist", e não com o motivo nomeado.
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('erp.payment_methods') and a.attname = 'id' and not a.attisdropped
                    and a.atttypid = 'uuid'::regtype)
     or not exists (select 1 from pg_attribute a
                     where a.attrelid = to_regclass('erp.payment_methods') and a.attname = 'organization_id' and not a.attisdropped
                       and a.atttypid = 'uuid'::regtype) then
    raise exception 'XML-04: erp.payment_methods ausente ou sem id/organization_id uuid; o gatilho da forma nao teria o que conferir.';
  end if;
  if to_regprocedure('erp.set_updated_at()') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.tenant_visible(uuid)') is null then
    raise exception 'XML-04: erp.set_updated_at(), erp.audit_row() ou erp.tenant_visible(uuid) ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  -- A política de referência: a pós-condição confere que a da tabela nova é IGUAL à de erp.condicoes_pagamento (0031).
  if not exists (select 1 from pg_policies p
                  where p.schemaname = 'erp' and p.tablename = 'condicoes_pagamento' and p.policyname = 'tenant_isolation') then
    raise exception 'XML-04: a politica tenant_isolation de erp.condicoes_pagamento (0031), referencia da tabela nova, esta ausente.';
  end if;
  if not exists (select 1 from pg_roles r where r.rolname = 'erp_app') then
    raise exception 'XML-04: o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente.';
  end if;
  -- Sem isso a migration pararia no meio com um erro de permissão genérico, em vez do motivo nomeado aqui.
  if not has_schema_privilege(current_user, 'erp', 'CREATE') then
    raise exception 'XML-04: o papel que aplica a migration nao cria objetos no schema erp; o CREATE TABLE seria recusado.';
  end if;
  if not has_table_privilege(current_user, 'erp.organizations', 'REFERENCES')
     or not has_table_privilege(current_user, 'erp.payment_methods', 'REFERENCES') then
    raise exception 'XML-04: o papel que aplica a migration nao tem REFERENCES em erp.organizations ou erp.payment_methods; as chaves estrangeiras seriam recusadas.';
  end if;
end $$;

-- ---------- 3) erp.formas_pagamento_da_nfe ----------
create table erp.formas_pagamento_da_nfe (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null constraint fk_formas_pagamento_da_nfe_organizacao references erp.organizations(id),
  codigo_tpag text not null constraint chk_formas_pagamento_da_nfe_codigo_tpag check (codigo_tpag ~ '^[0-9]{2}$'),
  forma_pagamento_id uuid not null constraint fk_formas_pagamento_da_nfe_forma references erp.payment_methods(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Uma forma por código por organização, entre as VIVAS (ver o cabeçalho, item 2). Nada é único na forma.
create unique index ux_formas_pagamento_da_nfe_codigo_vivo on erp.formas_pagamento_da_nfe (organization_id, codigo_tpag)
  where deleted_at is null;

comment on table erp.formas_pagamento_da_nfe is 'Forma de pagamento da NF-e (XML-04, decisão 318): ligação, por organização, do código tPag da nota a uma forma de pagamento (erp.payment_methods, da organização ou do sistema). Uma forma por código entre as vivas; a mesma forma pode receber vários códigos. Sem empresa_id; sem is_active (desligar = excluir).';
comment on column erp.formas_pagamento_da_nfe.id is 'Identidade técnica (UUID).';
comment on column erp.formas_pagamento_da_nfe.organization_id is 'Tenant (organização).';
comment on column erp.formas_pagamento_da_nfe.codigo_tpag is 'Código do meio de pagamento da NF-e (detPag/tPag), dois dígitos; quais códigos existem é regra do domínio (CODIGOS_TPAG_DA_NFE).';
comment on column erp.formas_pagamento_da_nfe.forma_pagamento_id is 'Forma de pagamento que o código vira: da mesma organização ou do sistema (organization_id nulo), conferido pelo gatilho trg_formas_pagamento_da_nfe_forma.';
comment on column erp.formas_pagamento_da_nfe.created_at is 'Criação do registro.';
comment on column erp.formas_pagamento_da_nfe.updated_at is 'Última alteração (erp.set_updated_at).';
comment on column erp.formas_pagamento_da_nfe.deleted_at is 'Exclusão lógica: a ligação excluída não decide nada e libera o código para outra ligação.';

-- ---------- 4) a guarda da forma ----------
-- SECURITY INVOKER (o padrão): a política de erp.payment_methods já mostra ao erp_app as formas do sistema e as da
-- própria organização (ver o cabeçalho, item 3).
create function erp.formas_pagamento_da_nfe_forma_guarda() returns trigger
  language plpgsql
  set search_path = erp, pg_temp
as $$
begin
  -- Excluir nunca é bloqueado: a linha que fica excluída sem trocar a forma nem a organização passa sem conferir.
  if tg_op = 'UPDATE' and new.deleted_at is not null
     and new.forma_pagamento_id = old.forma_pagamento_id and new.organization_id = old.organization_id then
    return new;
  end if;
  -- A inexistente e a de outra organização: a MESMA recusa (negar não revela existência).
  if not exists (select 1 from erp.payment_methods p
                  where p.id = new.forma_pagamento_id
                    and (p.organization_id is null or p.organization_id = new.organization_id)) then
    raise exception 'VALIDATION_ERROR: A forma de pagamento precisa existir e ser desta organização ou do sistema.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

comment on function erp.formas_pagamento_da_nfe_forma_guarda() is 'XML-04 (decisão 318): gatilho BEFORE INSERT OR UPDATE de erp.formas_pagamento_da_nfe; recusa (VALIDATION_ERROR, P0001) a forma de pagamento que não é da organização da ligação nem do sistema. A FK simples não prova tenant: as formas do sistema têm organization_id nulo.';

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todo
-- papel além do dono (o mesmo laço da 0063; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'erp.formas_pagamento_da_nfe_forma_guarda()'::regprocedure
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- Sem lista de colunas e sem WHEN: todo INSERT e todo UPDATE passam pela guarda (a exceção da exclusão mora no corpo).
create trigger trg_formas_pagamento_da_nfe_forma
  before insert or update on erp.formas_pagamento_da_nfe
  for each row execute function erp.formas_pagamento_da_nfe_forma_guarda();
create trigger trg_formas_pagamento_da_nfe_updated
  before update on erp.formas_pagamento_da_nfe
  for each row execute function erp.set_updated_at();
create trigger trg_formas_pagamento_da_nfe_audit
  after insert or update or delete on erp.formas_pagamento_da_nfe
  for each row execute function erp.audit_row();

-- ---------- 5) RLS e privilégios ----------
-- A 0007 não alcança tabela criada depois dela. Política ÚNICA (PERMISSIVE combinam com OR).
alter table erp.formas_pagamento_da_nfe enable row level security;
alter table erp.formas_pagamento_da_nfe force row level security;
create policy tenant_isolation on erp.formas_pagamento_da_nfe for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
-- Os default privileges da 0007 concedem delete; a exclusão é lógica, então o revoke é EXPLÍCITO e vem depois.
grant select, insert, update on erp.formas_pagamento_da_nfe to erp_app;
revoke delete, truncate on erp.formas_pagamento_da_nfe from erp_app;

-- ---------- 6) pós-condições nomeadas (catálogo, nunca contagem de tabela viva) ----------
do $$
declare
  v_t oid := 'erp.formas_pagamento_da_nfe'::regclass;
  v_colunas text[];
  v_ref record;
  v_unicos text[];
  v_gatilhos text[];
begin
  if not exists (select 1 from pg_class c where c.oid = v_t and c.relkind = 'r'
                    and c.relnamespace = 'erp'::regnamespace) then
    raise exception 'XML-04: erp.formas_pagamento_da_nfe nao e uma tabela comum do schema erp.';
  end if;
  -- As colunas EXATAS, na ordem: nome, tipo, not null e default. Sem is_active, sem empresa_id.
  select array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
                   || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') order by a.attnum) into v_colunas
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = v_t and a.attnum > 0 and not a.attisdropped;
  if v_colunas is distinct from array[
       'id uuid not null default gen_random_uuid()',
       'organization_id uuid not null',
       'codigo_tpag text not null',
       'forma_pagamento_id uuid not null',
       'created_at timestamp with time zone not null default now()',
       'updated_at timestamp with time zone not null default now()',
       'deleted_at timestamp with time zone'] then
    raise exception 'XML-04: colunas de erp.formas_pagamento_da_nfe fora da forma: %', v_colunas;
  end if;
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = v_t and k.contype = 'p'
                    and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = v_t and a.attname = 'id')]) then
    raise exception 'XML-04: chave primaria de erp.formas_pagamento_da_nfe ausente ou fora de id.';
  end if;
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = v_t and k.conname = 'chk_formas_pagamento_da_nfe_codigo_tpag' and k.contype = 'c' and k.convalidated
                    and pg_get_constraintdef(k.oid) = 'CHECK ((codigo_tpag ~ ''^[0-9]{2}$''::text))') then
    raise exception 'XML-04: CHECK chk_formas_pagamento_da_nfe_codigo_tpag (dois digitos) ausente ou fora da forma.';
  end if;
  -- As duas FKs, coluna a coluna pelo catálogo (o texto de pg_get_constraintdef depende do search_path).
  if not exists (select 1 from pg_constraint k
                  where k.conrelid = v_t and k.conname = 'fk_formas_pagamento_da_nfe_forma' and k.contype = 'f' and k.convalidated
                    and k.confrelid = 'erp.payment_methods'::regclass
                    and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = v_t and a.attname = 'forma_pagamento_id')]
                    and k.confkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'erp.payment_methods'::regclass and a.attname = 'id')])
     or not exists (select 1 from pg_constraint k
                  where k.conrelid = v_t and k.conname = 'fk_formas_pagamento_da_nfe_organizacao' and k.contype = 'f' and k.convalidated
                    and k.confrelid = 'erp.organizations'::regclass
                    and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = v_t and a.attname = 'organization_id')]
                    and k.confkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'erp.organizations'::regclass and a.attname = 'id')])
     or (select count(*) from pg_constraint k where k.conrelid = v_t and k.contype = 'f') <> 2 then
    raise exception 'XML-04: chaves estrangeiras de erp.formas_pagamento_da_nfe fora da forma (forma -> payment_methods.id, organizacao -> organizations.id, so as duas).';
  end if;
  -- Os índices ÚNICOS: a chave primária e o parcial do código vivo — nada único na forma.
  select array_agg(pg_get_indexdef(i.indexrelid) order by c.relname collate "C") into v_unicos
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where i.indrelid = v_t and i.indisunique;
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                  where i.indrelid = v_t and c.relname = 'ux_formas_pagamento_da_nfe_codigo_vivo'
                    and c.relnamespace = 'erp'::regnamespace
                    and i.indisunique and i.indisvalid and i.indexprs is null and i.indnkeyatts = 2
                    and i.indkey[0] = (select a.attnum from pg_attribute a where a.attrelid = v_t and a.attname = 'organization_id')
                    and i.indkey[1] = (select a.attnum from pg_attribute a where a.attrelid = v_t and a.attname = 'codigo_tpag')
                    and pg_get_expr(i.indpred, i.indrelid) = '(deleted_at IS NULL)')
     or (select count(*) from pg_index i where i.indrelid = v_t and i.indisunique) <> 2 then
    raise exception 'XML-04: indice unico parcial ux_formas_pagamento_da_nfe_codigo_vivo (organization_id, codigo_tpag) where deleted_at is null ausente, fora da forma, ou ha outro indice unico: %', v_unicos;
  end if;
  -- A guarda: plpgsql, retornando trigger, SECURITY INVOKER, search_path fixo, sem EXECUTE além do dono.
  if not exists (select 1 from pg_proc p
                  where p.oid = 'erp.formas_pagamento_da_nfe_forma_guarda()'::regprocedure
                    and not p.prosecdef
                    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
                    and p.prorettype = 'trigger'::regtype
                    and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'XML-04: erp.formas_pagamento_da_nfe_forma_guarda() nao e plpgsql, retornando trigger, SECURITY INVOKER, com search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'erp.formas_pagamento_da_nfe_forma_guarda()'::regprocedure
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'XML-04: EXECUTE de erp.formas_pagamento_da_nfe_forma_guarda() concedido alem do dono.';
  end if;
  -- Os gatilhos EXATOS da tabela: nome, tipo (máscara tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE), função,
  -- ligados como 'O', sem lista de colunas, sem WHEN, sem argumento.
  select array_agg(t.tgname || ' ' || t.tgtype::text || ' ' || t.tgfoid::regprocedure::text order by t.tgname collate "C") into v_gatilhos
    from pg_trigger t
   where t.tgrelid = v_t and not t.tgisinternal
     and t.tgenabled = 'O' and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null and t.tgnargs = 0;
  if v_gatilhos is distinct from array[
       'trg_formas_pagamento_da_nfe_audit ' || (1 | 4 | 8 | 16)::text || ' ' || 'erp.audit_row()'::regprocedure::text,
       'trg_formas_pagamento_da_nfe_forma ' || (1 | 2 | 4 | 16)::text || ' ' || 'erp.formas_pagamento_da_nfe_forma_guarda()'::regprocedure::text,
       'trg_formas_pagamento_da_nfe_updated ' || (1 | 2 | 16)::text || ' ' || 'erp.set_updated_at()'::regprocedure::text]
     or (select count(*) from pg_trigger t where t.tgrelid = v_t and not t.tgisinternal) <> 3 then
    raise exception 'XML-04: gatilhos de erp.formas_pagamento_da_nfe fora da forma (guarda da forma, updated_at e auditoria): %', v_gatilhos;
  end if;
  -- RLS habilitada e forçada; política ÚNICA, igual à de erp.condicoes_pagamento.
  if not exists (select 1 from pg_class c where c.oid = v_t and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception 'XML-04: RLS de erp.formas_pagamento_da_nfe nao esta habilitada e forcada.';
  end if;
  select p.qual, p.with_check, p.roles into v_ref
    from pg_policies p where p.schemaname = 'erp' and p.tablename = 'condicoes_pagamento' and p.policyname = 'tenant_isolation';
  if (select count(*) from pg_policies p where p.schemaname = 'erp' and p.tablename = 'formas_pagamento_da_nfe') <> 1
     or not exists (select 1 from pg_policies p
                     where p.schemaname = 'erp' and p.tablename = 'formas_pagamento_da_nfe' and p.policyname = 'tenant_isolation'
                       and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
                       and p.qual = v_ref.qual and p.with_check = v_ref.with_check and p.roles = v_ref.roles) then
    raise exception 'XML-04: erp.formas_pagamento_da_nfe sem a politica unica tenant_isolation igual a de erp.condicoes_pagamento.';
  end if;
  -- Privilégios do erp_app: select, insert e update; nada de delete, truncate, references ou trigger.
  if not has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'SELECT')
     or not has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'INSERT')
     or not has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'UPDATE')
     or has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'DELETE')
     or has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'TRUNCATE')
     or has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'REFERENCES')
     or has_table_privilege('erp_app', 'erp.formas_pagamento_da_nfe', 'TRIGGER') then
    raise exception 'XML-04: privilegios do erp_app em erp.formas_pagamento_da_nfe fora de select/insert/update.';
  end if;
end $$;
