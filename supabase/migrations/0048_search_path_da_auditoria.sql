-- =====================================================================
-- 0048 OPERACOES-01 F12 — search_path FIXO NA FUNÇÃO DE AUDITORIA (erp.audit_row) — decisão 288 (F12, dívidas de
-- segurança)
--
-- O QUE FAZ, e é uma coisa só: `alter function erp.audit_row() set search_path = erp, pg_temp`.
--
-- POR QUÊ. erp.audit_row (0001) é o gatilho de auditoria das tabelas de negócio e é SECURITY DEFINER SEM search_path
-- (proconfig nulo): roda com os direitos do DONO (que atravessa a RLS de erp.audit_logs) e resolve os nomes NÃO
-- qualificados do corpo — to_jsonb, o operador ->>, o tipo uuid do cast — no search_path de QUEM grava. Uma sessão
-- que ponha um schema seu ANTES do pg_catalog e crie nele uma to_jsonb(anyelement) homônima faz o dono executar o
-- código dela e falsifica o before/after da auditoria (o teste da 0048 prova isso ANTES dela, e prova que depois
-- dela não acontece). Com o caminho fixo, o pg_catalog é buscado primeiro (implícito) e o pg_temp por último: nada
-- que a sessão crie ou ponha no caminho dela entra no corpo.
--
-- O CORPO NÃO MUDA (sem create or replace: o ALTER não reescreve o prosrc). Ele usa só objetos do erp
-- (erp.audit_logs, erp.current_org_id(), erp.current_user_id(), todos qualificados) e do pg_catalog (to_jsonb, ->>,
-- coalesce, uuid, text; tg_op e tg_table_name são variáveis do PL/pgSQL) — conferido sobre o corpo da 0001, que
-- nenhuma migration posterior redefiniu. Por isso a pré-condição exige o corpo EXATO da 0001 (md5 do prosrc): outro
-- corpo não foi conferido, e fixar o caminho às cegas sobre ele poderia quebrar a auditoria. A pós-condição confere
-- o MESMO md5 depois. Nenhuma linha é tocada; dono, privilégios, volatilidade e gatilhos ficam como estão.
--
-- ORDEM REAL DE PRODUÇÃO. Em produção a 0049 (MAPA-01, da main) foi aplicada ANTES das 0042–0048 desta PR. A 0048
-- não lê nem cria nada da 0049 (que não usa erp.audit_row), e nada nela depende de a 0049 estar ou não estar lá.
--
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web): a API anterior não percebe — o gatilho grava a mesma
-- linha, com o mesmo conteúdo, para quem grava com o search_path de sempre. O ALTER FUNCTION não pega lock de
-- tabela (só a linha da função no catálogo); o lock_timeout de 2s é o do molde: se outra transação estiver alterando
-- a mesma função, a migration desiste em vez de esperar.
-- VOLTA: nenhuma necessária — API e web voltam por redeploy e convivem com a 0048. Desfazer (`reset search_path`)
-- só por migration nova, por decisão humana, e reabriria a dívida.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome no
-- ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fase (2026,82).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 82) then
    raise exception 'OPERACOES-01 F12: outra transacao ja detem a trava desta migration (2026,82). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_fn regprocedure := to_regprocedure('erp.audit_row()');
  v_config text[];
  v_definer boolean;
  v_dono oid;
  v_md5 text;
begin
  -- 2.1 "Já aplicada" ANTES das demais: o search_path de erp.audit_row já fixado.
  if v_fn is not null and exists (select 1 from pg_proc p cross join lateral unnest(p.proconfig) c(cfg)
                                    where p.oid = v_fn and c.cfg like 'search\_path=%') then
    raise exception 'OPERACOES-01 F12: erp.audit_row ja tem search_path fixo; a 0048 ja foi aplicada ou ha schema divergente.';
  end if;

  -- 2.2 A função existe na forma da 0001: sem argumento, de gatilho, em PL/pgSQL.
  if v_fn is null or not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                                  where p.oid = v_fn and p.prorettype = 'trigger'::regtype and l.lanname = 'plpgsql') then
    raise exception 'OPERACOES-01 F12: funcao erp.audit_row() ausente ou fora da forma (gatilho em plpgsql, da 0001); a cadeia de migrations esta fora de ordem.';
  end if;

  select p.proconfig, p.prosecdef, p.proowner, md5(p.prosrc) into v_config, v_definer, v_dono, v_md5
    from pg_proc p where p.oid = v_fn;

  -- 2.3 É SECURITY DEFINER (é a combinação "definer sem caminho" que esta migration fecha).
  if not v_definer then
    raise exception 'OPERACOES-01 F12: erp.audit_row() nao e SECURITY DEFINER; schema divergente (a 0001 a cria definer).';
  end if;

  -- 2.4 Nenhuma outra configuração na função: a pós-condição exige o proconfig EXATO.
  if v_config is not null then
    raise exception 'OPERACOES-01 F12: erp.audit_row() ja tem configuracao propria; schema divergente: %', v_config;
  end if;

  -- 2.5 O dono atravessa a RLS (é o que deixa a auditoria gravar em erp.audit_logs por qualquer escopo), e quem
  -- aplica é o dono ou membro dele (o ALTER FUNCTION exige; sem isso pararia com um erro de permissão genérico).
  if not exists (select 1 from pg_roles r where r.oid = v_dono and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'OPERACOES-01 F12: o dono de erp.audit_row() nao atravessa RLS; schema divergente (a auditoria nao gravaria fora do escopo de quem grava).';
  end if;
  if not pg_has_role(current_user, v_dono, 'USAGE') then
    raise exception 'OPERACOES-01 F12: o papel que aplica a migration nao e dono de erp.audit_row() (nem membro do papel dono); o ALTER FUNCTION seria recusado.';
  end if;

  -- 2.6 O corpo é EXATAMENTE o da 0001 (o único conferido: só objetos do erp e do pg_catalog).
  if v_md5 is distinct from 'd2f094910e177fca30a3d9fab6f6672e' then
    raise exception 'OPERACOES-01 F12: o corpo de erp.audit_row() nao e o da 0001 (md5 %); o caminho fixo so foi conferido para aquele corpo.', v_md5;
  end if;
end $$;

-- ---------- 3) o caminho fixo ----------
alter function erp.audit_row() set search_path = erp, pg_temp;

-- ---------- 4) pós-condições (só de catálogo) ----------
do $$
declare
  v_config text[];
  v_definer boolean;
  v_md5 text;
begin
  select p.proconfig, p.prosecdef, md5(p.prosrc) into v_config, v_definer, v_md5
    from pg_proc p where p.oid = to_regprocedure('erp.audit_row()');
  if v_config is distinct from array['search_path=erp, pg_temp'] then
    raise exception 'OPERACOES-01 F12: configuracao de erp.audit_row() diferente de search_path "erp, pg_temp" depois da 0048: %', v_config;
  end if;
  if v_definer is distinct from true then
    raise exception 'OPERACOES-01 F12: erp.audit_row() deixou de ser SECURITY DEFINER depois da 0048.';
  end if;
  -- O MESMO md5 da pré-condição 2.6: o corpo não mudou.
  if v_md5 is distinct from 'd2f094910e177fca30a3d9fab6f6672e' then
    raise exception 'OPERACOES-01 F12: o corpo de erp.audit_row() mudou na 0048 (md5 %); ela so fixa o caminho.', v_md5;
  end if;
end $$;
