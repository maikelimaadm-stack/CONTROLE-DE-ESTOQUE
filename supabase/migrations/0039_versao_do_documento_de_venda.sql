-- =====================================================================
-- 0039 EDITAR-01 — VERSÃO DO DOCUMENTO DE VENDA (orçamento, pedido e venda) — decisão 272, item 1.1
--
-- 1) erp.sales_documents.version (bigint, not null, default 0): o número que a edição do documento salvo usa
--    como trava otimista — quem abriu a versão N só grava se o documento ainda estiver na versão N.
--    ADD COLUMN com default CONSTANTE é só metadado desde o PostgreSQL 11: o valor fica no catálogo
--    (attmissingval) e a tabela NÃO é regravada; toda linha que existe hoje passa a ler 0. O lock é o
--    AccessExclusive do próprio ALTER, curto, e o lock_timeout de 2s faz a migration desistir em vez de
--    enfileirar as gravações de venda atrás dela.
-- 2) A VERSÃO MUDA QUANDO O DOCUMENTO MUDA — em QUALQUER UPDATE, de QUALQUER caminho: editar, confirmar,
--    cancelar, converter (a origem muda de situação), encerrar saldo, faturar em partes, um script de
--    suporte. Quem soma é o gatilho `trg_sales_documents_versao` (BEFORE UPDATE, por linha, sem lista de
--    colunas e sem WHEN), e não cada rota da API lembrando de somar: a rota que esquecesse deixaria o
--    documento mudar com a versão parada, e a trava otimista aceitaria uma gravação feita sobre o estado
--    velho. A função ignora o que o UPDATE mandou na coluna: `new.version := old.version + 1` sempre —
--    um `SET version = 999` explícito vira old+1, e um UPDATE que não muda nada (`set note = note`) também
--    soma 1 (o UPDATE aconteceu; o gatilho não tenta adivinhar se "valeu").
--    O INSERT não passa pelo gatilho: o documento nasce com o default (0). Um INSERT que citasse a coluna
--    gravaria o valor dele — nenhuma rota cita, e a trava continua valendo, porque ela compara igualdade e
--    todo UPDATE seguinte soma 1 a partir dali.
--
-- A ORDEM ENTRE OS GATILHOS BEFORE UPDATE. O PostgreSQL dispara os gatilhos do mesmo momento na ordem do
-- NOME (byte a byte, collation "C"), e cada BEFORE vê o NEW que os anteriores deixaram — inclusive na
-- cláusula WHEN. Hoje a tabela tem EXATAMENTE dois BEFORE UPDATE por linha (a pré-condição confere pelo
-- catálogo, por nome e por função):
--   · trg_sales_documents_classificacao_financeira (0024) → erp.venda_classificacao_financeira_guarda();
--   · trg_sales_documents_execucao_configurada     (0023) → erp.venda_execucao_configurada_guarda().
-- `trg_sales_documents_versao` ordena DEPOIS dos dois ('v' > 'e' > 'c' depois do prefixo comum), então a
-- versão muda por último, e o nome foi escolhido por isso. O que cada guarda compara (lido no arquivo):
--   · 0023 venda_execucao_configurada_guarda: compara COLUNAS — o WHEN usa NEW.status, OLD.status e
--     NEW.tipo_operacao_versao_id; a função lê NEW.tipo_operacao_versao_id, NEW.organization_id e NEW.id
--     (contra a GUC app.venda_execucao_configurada). Nada de linha inteira.
--   · 0024 venda_classificacao_financeira_guarda: compara COLUNAS — o WHEN usa NEW.status, OLD.status e
--     NEW.categoria_financeira_id; a função compara NEW.id com a GUC app.venda_classificacao_financeira.
--   · 0024 venda_classificacao_financeira_conversao_guarda: é BEFORE INSERT (não entra nesta ordem) e
--     compara COLUNAS (NEW.origin_document_id, NEW.categoria_financeira_id e, na origem,
--     categoria_financeira_id).
--   Nenhum BEFORE UPDATE de hoje compara a linha inteira (`new is distinct from old`, `row(new.*)`,
--   `to_jsonb(new)`). Quem lê a linha inteira é a auditoria (0005, erp.audit_row: to_jsonb(old) e
--   to_jsonb(new)), e ela é AFTER: grava o antes e o depois já com a versão somada, em qualquer ordem.
--   Ser o ÚLTIMO é, portanto, a regra que protege a próxima guarda: uma guarda BEFORE que comparasse a
--   linha inteira (para reconhecer "nada mudou", por exemplo) veria a versão já somada se a versão rodasse
--   antes dela, e todo UPDATE pareceria mudança. Por isso a pré-condição exige o conjunto EXATO de hoje e
--   a pós-condição confere que a versão é o último BEFORE UPDATE por nome: um gatilho novo que ordene depois
--   de `trg_sales_documents_versao` tem de ser decidido na migration dele, à vista.
--
-- NÃO PODE SER CONTORNADO PELO PAPEL DA APLICAÇÃO (erp_app, com que a API conecta). A pré-condição confere,
-- pelo catálogo, que o erp_app:
--   · não é dono de erp.sales_documents nem MEMBRO do papel dono → não faz ALTER TABLE ... DISABLE TRIGGER,
--     não faz DROP TRIGGER. Aqui a pergunta é 'MEMBER', e não 'USAGE': o erp_app nasce NOINHERIT (0007), e
--     um membro que não herda ainda pode fazer SET ROLE para o dono e desligar o gatilho;
--   · não é superusuário e não tem SET em session_replication_role → não liga o modo `replica`, em que os
--     gatilhos ligados como 'O' (origem, o padrão) deixam de disparar;
--   · não tem TRIGGER em erp.sales_documents → não cria um gatilho que ordene depois deste e desfaça a soma.
--   E o `SET version = x` explícito que ele mande é sobrescrito por old+1. A função é SECURITY INVOKER (não
--   lê tabela nenhuma: só soma), com search_path fixo `erp, pg_temp`, e o EXECUTE sai de TODO papel além do
--   dono (PUBLIC e o erp_app que o default privilege da 0007 concede): gatilho não precisa de EXECUTE de
--   quem grava, e a função não é porta de ninguém.
--
-- SEM BACKFILL: nenhum UPDATE nesta migration. As linhas de hoje leem 0 pelo default do catálogo; o gatilho
-- nasce depois do ADD COLUMN e não roda para elas.
-- JANELA DE DEPLOY (pre-deploy, banco → API → web): a API anterior grava o documento por UPDATE sem citar a
-- coluna, e o gatilho só soma — nada do que ela grava muda de sentido nem é recusado. O `d.*` do GET
-- anterior passa a trazer `version` na resposta: campo a mais, aditivo, que a web anterior ignora. Criar
-- documento (INSERT sem a coluna) continua igual: nasce 0.
-- VOLTA: API e web voltam por redeploy e convivem com a 0039 (a coluna e o gatilho não recusam nada). Tirar
-- o gatilho, a função ou a coluna do banco é decisão humana, com migration própria.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (a 0038 usou 72).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 73) then
    raise exception 'EDITAR-01: outra transacao ja detem a trava desta migration (2026,73). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_owner oid;
  v_antes text[];
begin
  if to_regclass('erp.sales_documents') is null then
    raise exception 'EDITAR-01: erp.sales_documents ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  -- "Já aplicada" ANTES das demais: depois da 0039 a coluna, a função e o gatilho existem, e a reaplicação
  -- precisa dizer o motivo verdadeiro.
  if exists (select 1 from pg_attribute a
              where a.attrelid = 'erp.sales_documents'::regclass and a.attname = 'version' and not a.attisdropped) then
    raise exception 'EDITAR-01: erp.sales_documents.version ja existe; a 0039 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.sales_documents_versao()') is not null then
    raise exception 'EDITAR-01: a funcao erp.sales_documents_versao() ja existe; schema divergente.';
  end if;
  if exists (select 1 from pg_trigger t
              where t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_versao') then
    raise exception 'EDITAR-01: o gatilho trg_sales_documents_versao ja existe em erp.sales_documents; schema divergente.';
  end if;
  -- O conjunto EXATO dos BEFORE UPDATE por linha, por nome E por função: é sobre ele que o cabeçalho afirma
  -- "nenhuma guarda compara a linha inteira" e "a versão é a última". Um gatilho a mais (ou a menos, ou o
  -- mesmo nome apontando para outra função) invalida a afirmação, e a decisão volta para um humano.
  -- O nome da função vem de nspname e proname, e não de regprocedure::text (que depende do search_path).
  -- tgtype: bit 1 = por linha, bit 2 = BEFORE, bit 16 = UPDATE.
  select array_agg(t.tgname || ' -> ' || n.nspname || '.' || p.proname order by t.tgname collate "C") into v_antes
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'erp.sales_documents'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_antes is distinct from array[
       'trg_sales_documents_classificacao_financeira -> erp.venda_classificacao_financeira_guarda',
       'trg_sales_documents_execucao_configurada -> erp.venda_execucao_configurada_guarda'] then
    raise exception 'EDITAR-01: gatilhos BEFORE UPDATE por linha de erp.sales_documents diferentes dos dois esperados (classificacao_financeira da 0024, execucao_configurada da 0023): %', v_antes;
  end if;
  -- ALTER TABLE, CREATE TRIGGER e COMMENT exigem os privilégios do DONO da tabela. 'USAGE' é a pergunta que o
  -- próprio PostgreSQL faz ao conferir dono (ser o dono, herdar dele, ou superusuário); 'MEMBER' aceitaria
  -- um membro NOINHERIT, que ainda seria recusado pelo ALTER sem SET ROLE. Sem isso a migration pararia no
  -- meio com um erro de permissão genérico, em vez do motivo nomeado aqui.
  select c.relowner into v_owner from pg_class c where c.oid = 'erp.sales_documents'::regclass;
  if not pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception 'EDITAR-01: o papel que aplica a migration nao e dono de erp.sales_documents; o ALTER TABLE e o CREATE TRIGGER seriam recusados.';
  end if;
  if not has_schema_privilege(current_user, 'erp', 'CREATE') then
    raise exception 'EDITAR-01: o papel que aplica a migration nao cria objetos no schema erp; o CREATE FUNCTION seria recusado.';
  end if;
  -- O papel da aplicação não desliga nem contorna o gatilho (ver o cabeçalho). Se o erp_app não existir,
  -- o próprio pg_has_role recusa ("role erp_app does not exist") e nada é aplicado. Superusuário vem
  -- PRIMEIRO: para ele toda pergunta de papel responde sim, e o motivo nomeado tem de ser o verdadeiro.
  if (select r.rolsuper from pg_roles r where r.rolname = 'erp_app')
     or has_parameter_privilege('erp_app', 'session_replication_role', 'SET') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) e superusuario ou pode trocar session_replication_role; poderia desligar o gatilho da versao.';
  end if;
  -- 'MEMBER' (e não 'USAGE'): o erp_app é NOINHERIT (0007), e ser membro sem herdar ainda permite SET ROLE
  -- para o dono.
  if pg_has_role('erp_app', v_owner, 'MEMBER') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) e dono de erp.sales_documents ou membro do papel dono; poderia desligar o gatilho da versao.';
  end if;
  if has_table_privilege('erp_app', 'erp.sales_documents', 'TRIGGER') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) tem TRIGGER em erp.sales_documents; poderia criar um gatilho depois do da versao.';
  end if;
end $$;

-- ---------- 3) coluna ----------
-- Default constante: só metadado, sem regravar a tabela (ver o cabeçalho).
alter table erp.sales_documents add column version bigint not null default 0;

comment on column erp.sales_documents.version is 'Versão do documento (EDITAR-01, decisão 272): trava otimista da edição. Nasce 0; o gatilho trg_sales_documents_versao soma 1 em TODO UPDATE, de qualquer caminho, e ignora o valor que o UPDATE mandar.';

-- ---------- 4) a função e o gatilho ----------
-- SECURITY INVOKER (o padrão): não lê tabela nenhuma, só soma; não há o que atravessar de RLS.
create function erp.sales_documents_versao() returns trigger
  language plpgsql
  set search_path = erp, pg_temp
as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;

comment on function erp.sales_documents_versao() is 'EDITAR-01 (decisão 272): gatilho BEFORE UPDATE de erp.sales_documents; new.version := old.version + 1 em todo UPDATE. Tem de ser o último BEFORE UPDATE por nome.';

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todo
-- papel além do dono (o mesmo laço da 0035/0036/0037; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'erp.sales_documents_versao()'::regprocedure
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- Sem lista de colunas e sem WHEN: TODO update soma. O nome ordena depois das duas guardas (ver o cabeçalho).
create trigger trg_sales_documents_versao
  before update on erp.sales_documents
  for each row execute function erp.sales_documents_versao();

-- ---------- 5) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_depois text[];
begin
  if not exists (select 1 from pg_attribute a
                   join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = 'erp.sales_documents'::regclass and a.attname = 'version' and not a.attisdropped
                    and format_type(a.atttypid, a.atttypmod) = 'bigint' and a.attnotnull
                    and a.attgenerated = '' and a.attidentity = ''
                    and pg_get_expr(d.adbin, d.adrelid) = '0') then
    raise exception 'EDITAR-01: erp.sales_documents.version nao e bigint not null default 0 (sem identity, sem generated).';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = 'erp.sales_documents_versao()'::regprocedure
                    and not p.prosecdef
                    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
                    and p.prorettype = 'trigger'::regtype
                    and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'EDITAR-01: erp.sales_documents_versao() nao e plpgsql, retornando trigger, SECURITY INVOKER, com search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'erp.sales_documents_versao()'::regprocedure
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'EDITAR-01: EXECUTE de erp.sales_documents_versao() concedido alem do dono.';
  end if;
  -- BEFORE, por linha, SÓ UPDATE (tgtype exatamente 1|2|16), sem lista de colunas, sem WHEN, sem argumento,
  -- ligado como 'O', na função certa.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_versao'
                    and not t.tgisinternal and t.tgenabled = 'O'
                    and t.tgfoid = 'erp.sales_documents_versao()'::regprocedure
                    and t.tgtype = (1 | 2 | 16)
                    and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null and t.tgnargs = 0) then
    raise exception 'EDITAR-01: gatilho trg_sales_documents_versao ausente, desligado, de outro tipo (antes de UPDATE, por linha, sem coluna e sem WHEN) ou fora de erp.sales_documents_versao().';
  end if;
  -- A ORDEM: os BEFORE UPDATE por linha são as duas guardas e a versão, e a versão é a ÚLTIMA por nome.
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_depois
    from pg_trigger t
   where t.tgrelid = 'erp.sales_documents'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_depois is distinct from array['trg_sales_documents_classificacao_financeira', 'trg_sales_documents_execucao_configurada',
                                     'trg_sales_documents_versao'] then
    raise exception 'EDITAR-01: o gatilho da versao nao e o ultimo BEFORE UPDATE por linha de erp.sales_documents (ordem por nome): %', v_depois;
  end if;
end $$;
