-- =====================================================================
-- 0039 EDITAR-01 — VERSÃO DO DOCUMENTO DE VENDA (orçamento, pedido e venda) — decisão 272, item 1.1
--
-- 1) erp.sales_documents.version (bigint, not null, default 0): o número que a edição do documento salvo usa
--    como trava otimista — quem abriu a versão N só grava se o documento ainda estiver na versão N.
--    ADD COLUMN com default CONSTANTE é só metadado desde o PostgreSQL 11: o valor fica no catálogo
--    (attmissingval) e a tabela NÃO é regravada; toda linha que existe hoje passa a ler 0. O lock é o
--    AccessExclusive do próprio ALTER, curto, e o lock_timeout de 2s faz a migration desistir em vez de
--    enfileirar as gravações de venda atrás dela.
-- 2) A VERSÃO MUDA QUANDO O CABEÇALHO DO DOCUMENTO MUDA — em QUALQUER UPDATE da linha de erp.sales_documents, de
--    QUALQUER caminho: editar, confirmar, cancelar, converter (a origem muda de situação), encerrar saldo, um
--    script de suporte. Quem soma é o gatilho `trg_sales_documents_versao` (BEFORE UPDATE, por linha, sem lista de
--    colunas e sem WHEN), e não cada rota da API lembrando de somar: a rota que esquecesse deixaria o
--    documento mudar com a versão parada, e a trava otimista aceitaria uma gravação feita sobre o estado
--    velho. A função ignora o que o UPDATE mandou na coluna: `new.version := old.version + 1` sempre —
--    um `SET version = 999` explícito vira old+1, e um UPDATE que não muda nada (`set note = note`) também
--    soma 1 (o UPDATE aconteceu; o gatilho não tenta adivinhar se "valeu").
--    FATURAR EM PARTES (apps/api/src/routes/sales.ts, conversão com `emPartes`): a parte gerada é INSERT e nasce
--    0. A ORIGEM só soma quando a parte ZERA o saldo dela — é aí, e só aí, que a conversão faz o UPDATE da origem
--    (`status='converted'`). A parte que não zera o saldo não faz UPDATE na origem (só a trava, com SELECT ... FOR
--    UPDATE, que não dispara gatilho), e a versão da origem fica PARADA, embora o saldo dela tenha mudado: o saldo
--    é conta sobre as partes, não coluna do cabeçalho. Cancelar uma parte que devolve a origem a `open` é UPDATE
--    da origem e soma.
--    A VERSÃO É DO CABEÇALHO: escrita só em itens (erp.sales_document_items) não soma. Na API toda escrita de
--    item de documento que já existe passa por `writeDoc`, que faz, na MESMA transação, o UPDATE do cabeçalho
--    (e é esse UPDATE que soma); uma escrita só em itens, fora do `writeDoc` (um script, uma rota
--    futura), deixaria a versão parada — quem a fizer tem de tocar o cabeçalho na mesma transação.
--    O INSERT não passa pelo gatilho: o documento nasce com o default (0). Um INSERT que citasse a coluna
--    gravaria o valor dele — nenhuma rota cita, e a trava continua valendo, porque ela compara igualdade e
--    todo UPDATE seguinte soma 1 a partir dali.
-- 3) erp.situacao_atraso_cliente(uuid, int) (0033, porta estreita SECURITY DEFINER do atraso do cliente) passa
--    a aceitar também quem EDITA: budgets.edit, orders.edit e sales.edit, além das três .create. Hoje ela só
--    responde a quem LANÇA venda; quem só tem `<perm>.edit` recebe ZERO linhas — e zero linhas a API lê como
--    "cliente em dia". O `GET /edicao` (que exige só `.edit`) mostraria devedor como em dia, e a conferência de
--    atraso da gravação (PATCH/PUT) quando o cliente muda ficaria aberta para quem edita sem lançar: fail-open.
--    Vai por CREATE OR REPLACE com a MESMA assinatura, o MESMO retorno, `stable security definer`, o MESMO
--    search_path (`erp, pg_temp`) e o MESMO corpo — só a reconferência de capacidade ganha as três .edit
--    (lançar OU editar qualquer variante de venda). O resto da porta não muda: organização e usuário só da GUC,
--    tolerância 0..365, só agregados, fora da capacidade zero linhas. CREATE OR REPLACE conserva o dono e os
--    privilégios, e mesmo assim o revoke de PUBLIC e o grant ao erp_app são reafirmados (a porta PRECISA do
--    EXECUTE do erp_app; o laço de revogação da função da versão, abaixo, só olha aquela função).
--    Pré-condição: a função existe, é SECURITY DEFINER, e o corpo é EXATAMENTE o da 0033 — md5 do prosrc inteiro
--    = 'd55df1291552c3fdd19b7c0eecf4d22c' (conferido na produção, só leitura, e no banco de teste com a 0033
--    aplicada). Não é heurística de trecho: qualquer divergência, dentro ou fora da lista de capacidades (uma .edit
--    a mais, uma .create a menos, a tolerância 365 trocada), recusa com o motivo nomeado; o dono atravessa RLS
--    (senão a porta veria o recorte de quem chama) e quem aplica pode substituí-la.
--    Pós-condição: EXECUTE da porta SÓ do dono e do erp_app (laço aclexplode; qualquer outro grantee, PUBLIC
--    inclusive, recusa) — o CREATE OR REPLACE conserva a ACL, e um grant antigo a outro papel passaria a abrir
--    a porta a mais gente.
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
--   · EXISTE — primeiro, com motivo nomeado: sem ele nenhuma das perguntas abaixo faz sentido, e a porta do
--     atraso ficaria sem quem a execute;
--   · não é dono de erp.sales_documents nem MEMBRO do papel dono → não faz ALTER TABLE ... DISABLE TRIGGER,
--     não faz DROP TRIGGER. Aqui a pergunta é 'MEMBER', e não 'USAGE': o erp_app nasce NOINHERIT (0007), e
--     um membro que não herda ainda pode fazer SET ROLE para o dono e desligar o gatilho;
--   · não é superusuário e não tem SET em session_replication_role → não liga o modo `replica`, em que os
--     gatilhos ligados como 'O' (origem, o padrão) deixam de disparar;
--   · não tem TRIGGER em erp.sales_documents → não cria um gatilho que ordene depois deste e desfaça a soma;
--   · não é MEMBRO — de qualquer forma, direta ou em cadeia, com ou sem herança (pg_has_role ... 'MEMBER') — de
--     NENHUM papel que seja superusuário, tenha SET em session_replication_role ou tenha TRIGGER em
--     erp.sales_documents: o membro NOINHERIT não usa o privilégio do papel pelas funções has_*_privilege, mas
--     faz SET ROLE para ele e passa a ter tudo o que ele tem;
--   · não tem session_replication_role em pg_db_role_setting que alcance a sessão dele (ALTER ROLE erp_app SET,
--     em qualquer banco, ou o ajuste de banco/ALTER ROLE ALL, setrole = 0): a sessão nasceria em `replica`,
--     com o gatilho desligado, sem o erp_app pedir nada.
--   E o `SET version = x` explícito que ele mande é sobrescrito por old+1. A função é SECURITY INVOKER (não
--   lê tabela nenhuma: só soma), com search_path fixo `erp, pg_temp`, e o EXECUTE sai de TODO papel além do
--   dono (PUBLIC e o erp_app que o default privilege da 0007 concede): gatilho não precisa de EXECUTE de
--   quem grava, e a função não é porta de ninguém.
--
-- SEM BACKFILL: nenhum UPDATE nesta migration. As linhas de hoje leem 0 pelo default do catálogo; o gatilho
-- nasce depois do ADD COLUMN e não roda para elas. A porta do atraso não grava nada.
-- JANELA DE DEPLOY (pre-deploy, banco → API → web): a API anterior grava o documento por UPDATE sem citar a
-- coluna, e o gatilho só soma — nada do que ela grava muda de sentido por causa da versão. O `d.*` do GET
-- anterior passa a trazer `version` na resposta: campo a mais, aditivo, que a web anterior ignora. Criar
-- documento (INSERT sem a coluna) continua igual: nasce 0. A porta do atraso passa a responder a MAIS
-- gente (quem edita), e isso ALCANÇA a API anterior: o PUT dela roda com `<perm>.edit` e chama a porta quando
-- a edição troca o cliente. Quem tem alguma `.edit` de venda e nenhuma das três `.create` deixa de receber o
-- falso "em dia" e, sob TOP cuja política de atraso bloqueia, passa a ser recusado ao trocar para um cliente
-- devedor — o efeito pretendido (a regra configurada deixa de falhar aberta), declarado na decisão 272.
-- VOLTA: API e web voltam por redeploy e convivem com a 0039 (a coluna e o gatilho não recusam nada; a porta
-- do atraso só responde a mais capacidades). Tirar o gatilho, a função ou a coluna do banco, ou voltar a porta
-- às três .create, é decisão humana, com migration própria.
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
  v_atraso oid;
  v_src text;
  v_dono_atraso oid;
  v_app oid;
  v_perigosos text[];
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
  -- tgtype é uma máscara; 1, 2 e 16 são os VALORES das flags (não posições de bit): 1 = ROW (por linha),
  -- 2 = BEFORE, 16 = UPDATE (TRIGGER_TYPE_ROW, TRIGGER_TYPE_BEFORE e TRIGGER_TYPE_UPDATE do PostgreSQL).
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
  -- O papel da aplicação não desliga nem contorna o gatilho (ver o cabeçalho). A EXISTÊNCIA vem primeiro: sem
  -- ela, o primeiro pg_has_role abaixo pararia com "role erp_app does not exist", e não com o motivo nomeado.
  select r.oid into v_app from pg_roles r where r.rolname = 'erp_app';
  if v_app is null then
    raise exception 'EDITAR-01: o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente (a porta do atraso ficaria sem quem a execute).';
  end if;
  -- Superusuário vem ANTES das perguntas de papel: para ele toda pergunta de papel responde sim, e o motivo
  -- nomeado tem de ser o verdadeiro.
  if (select r.rolsuper from pg_roles r where r.oid = v_app)
     or has_parameter_privilege(v_app, 'session_replication_role', 'SET') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) e superusuario ou pode trocar session_replication_role; poderia desligar o gatilho da versao.';
  end if;
  -- 'MEMBER' (e não 'USAGE'): o erp_app é NOINHERIT (0007), e ser membro sem herdar ainda permite SET ROLE
  -- para o dono.
  if pg_has_role(v_app, v_owner, 'MEMBER') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) e dono de erp.sales_documents ou membro do papel dono; poderia desligar o gatilho da versao.';
  end if;
  if has_table_privilege(v_app, 'erp.sales_documents', 'TRIGGER') then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) tem TRIGGER em erp.sales_documents; poderia criar um gatilho depois do da versao.';
  end if;
  -- Os papéis de que o erp_app é MEMBRO (direto ou em cadeia, com ou sem herança, com ou sem SET): as has_*_privilege
  -- acima não veem o que ele só alcança por SET ROLE. A direção é esta — os papéis ACIMA do erp_app; quem é membro
  -- DELE (o login de teste erp_app_test, por exemplo) não entra. Ele mesmo fica de fora (pg_has_role de si é sempre sim).
  select array_agg(r.rolname::text order by r.rolname collate "C") into v_perigosos
    from pg_roles r
   where r.oid <> v_app
     and pg_has_role(v_app, r.oid, 'MEMBER')
     and (r.rolsuper
          or has_parameter_privilege(r.oid, 'session_replication_role', 'SET')
          or has_table_privilege(r.oid, 'erp.sales_documents', 'TRIGGER'));
  if v_perigosos is not null then
    raise exception 'EDITAR-01: o papel da aplicacao (erp_app) e membro (com ou sem heranca) de papel superusuario, com SET em session_replication_role ou com TRIGGER em erp.sales_documents: %; faria SET ROLE e poderia desligar o gatilho da versao.', v_perigosos;
  end if;
  -- O ajuste guardado que a sessão do erp_app herdaria ao conectar: o do papel (em qualquer banco) e o de todos
  -- os papéis (setrole = 0: ALTER DATABASE ... SET, ALTER ROLE ALL SET).
  if exists (select 1 from pg_db_role_setting s
               cross join lateral unnest(s.setconfig) c(ajuste)
              where s.setrole in (v_app, 0)
                and lower(split_part(c.ajuste, '=', 1)) = 'session_replication_role') then
    raise exception 'EDITAR-01: ha session_replication_role em pg_db_role_setting para o erp_app (ALTER ROLE erp_app SET, ALTER ROLE ALL SET ou ALTER DATABASE SET); a sessao dele nasceria com o gatilho da versao desligado.';
  end if;
  -- A porta do atraso (item 3 do cabeçalho): existe, é SECURITY DEFINER, e o corpo é EXATAMENTE o da 0033 — o
  -- md5 do prosrc inteiro, conferido na produção (só leitura) e no banco de teste com a 0033 aplicada. Qualquer
  -- divergência recusa, dentro ou fora da lista de capacidades; depois da 0039 o corpo é outro, e a reaplicação
  -- diz isso.
  select p.oid, p.prosrc, p.proowner into v_atraso, v_src, v_dono_atraso
    from pg_proc p
   where p.oid = to_regprocedure('erp.situacao_atraso_cliente(uuid,integer)') and p.prosecdef;
  if v_atraso is null then
    raise exception 'EDITAR-01: erp.situacao_atraso_cliente(uuid, integer) ausente ou sem SECURITY DEFINER; a 0033 nao esta aplicada ou ha schema divergente.';
  end if;
  if md5(v_src) <> 'd55df1291552c3fdd19b7c0eecf4d22c' then
    raise exception 'EDITAR-01: o corpo de erp.situacao_atraso_cliente nao e o da 0033 (md5 do corpo inteiro diferente de d55df1291552c3fdd19b7c0eecf4d22c); a 0039 ja foi aplicada ou ha schema divergente.';
  end if;
  -- O DONO atravessa a RLS: é com os privilégios dele que a porta soma os títulos de TODAS as empresas da
  -- organização. E quem aplica pode substituí-la (é o dono, ou herda dele) — senão o CREATE OR REPLACE pararia
  -- com um erro de permissão genérico.
  if not exists (select 1 from pg_roles r where r.oid = v_dono_atraso and (r.rolsuper or r.rolbypassrls)) then
    raise exception 'EDITAR-01: o dono de erp.situacao_atraso_cliente nao atravessa RLS; a porta veria so o recorte de quem chama.';
  end if;
  if not pg_has_role(current_user, v_dono_atraso, 'USAGE') then
    raise exception 'EDITAR-01: o papel que aplica a migration nao e dono de erp.situacao_atraso_cliente; o CREATE OR REPLACE seria recusado.';
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

-- ---------- 5) a porta do atraso aceita também quem edita (item 3 do cabeçalho) ----------
-- MESMA assinatura, retorno, volatilidade, SECURITY DEFINER, search_path e corpo da 0033; só a reconferência de
-- capacidade ganha as três .edit (as três linhas novas vêm DEPOIS das .create, e o resto do texto é idêntico —
-- o teste confere tirando as três e comparando com o corpo da 0033). Sem comentário dentro do corpo, de propósito.
create or replace function erp.situacao_atraso_cliente(p_cliente uuid, p_tolerancia int)
  returns table (titulos int, total numeric, vencimento_mais_antigo date)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null or p_cliente is null or p_tolerancia is null
     or p_tolerancia < 0 or p_tolerancia > 365 then
    return;
  end if;
  if not (erp.has_permission(v_org, v_user, 'budgets.create')
          or erp.has_permission(v_org, v_user, 'orders.create')
          or erp.has_permission(v_org, v_user, 'sales.create')
          or erp.has_permission(v_org, v_user, 'budgets.edit')
          or erp.has_permission(v_org, v_user, 'orders.edit')
          or erp.has_permission(v_org, v_user, 'sales.edit')) then
    return;
  end if;
  return query
    select count(*)::int, coalesce(sum(t.balance), 0)::numeric, min(t.due_date)
      from erp.financial_titles t
     where t.organization_id = v_org
       and t.direction = 'receivable'
       and t.person_id = p_cliente
       and t.status in ('open', 'partially_paid')
       and t.deleted_at is null
       and t.balance > 0
       and t.due_date < current_date - p_tolerancia;
end $$;

comment on function erp.situacao_atraso_cliente(uuid, int) is
  'TOP-CONFIG-05 (EDITAR-01: tambem quem edita): agregados (quantidade, total, vencimento mais antigo) dos titulos a receber vencidos do cliente, alem da tolerancia, em todas as empresas da organizacao da GUC. Porta estreita: exige capacidade de lancar OU editar venda (budgets/orders/sales .create ou .edit); sem ela, zero linhas.';

-- Reafirmados (CREATE OR REPLACE já conserva os privilégios): PUBLIC não executa; o erp_app executa.
revoke execute on function erp.situacao_atraso_cliente(uuid, int) from public;
grant execute on function erp.situacao_atraso_cliente(uuid, int) to erp_app;

-- ---------- 6) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_depois text[];
  v_execucao text[];
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
  -- A porta do atraso: as SEIS capacidades no corpo, SECURITY DEFINER, stable, search_path fixo, dono que atravessa
  -- RLS, PUBLIC sem EXECUTE e erp_app com EXECUTE.
  if not exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
                  where p.oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure
                    and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=erp, pg_temp']
                    and (r.rolsuper or r.rolbypassrls)
                    and position('''budgets.create''' in p.prosrc) > 0 and position('''orders.create''' in p.prosrc) > 0
                    and position('''sales.create''' in p.prosrc) > 0 and position('''budgets.edit''' in p.prosrc) > 0
                    and position('''orders.edit''' in p.prosrc) > 0 and position('''sales.edit''' in p.prosrc) > 0) then
    raise exception 'EDITAR-01: erp.situacao_atraso_cliente sem as seis capacidades (budgets/orders/sales .create e .edit), sem SECURITY DEFINER, sem search_path "erp, pg_temp" ou com dono que nao atravessa RLS.';
  end if;
  if has_function_privilege('public', 'erp.situacao_atraso_cliente(uuid,integer)', 'execute')
     or not has_function_privilege('erp_app', 'erp.situacao_atraso_cliente(uuid,integer)', 'execute') then
    raise exception 'EDITAR-01: EXECUTE de erp.situacao_atraso_cliente fora do esperado (PUBLIC nao executa; erp_app executa).';
  end if;
  -- EXECUTE da porta SÓ do dono e do erp_app: o mesmo laço aclexplode da função da versão, aqui como RECUSA (não
  -- revoga: um grantee a mais é schema divergente, e a decisão volta para um humano). O CREATE OR REPLACE
  -- conservou a ACL de antes, e um grant antigo a outro papel abriria a porta, agora maior, a mais gente.
  select array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by a.grantee) into v_execucao
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'erp.situacao_atraso_cliente(uuid,integer)'::regprocedure
     and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
     and a.grantee <> (select r.oid from pg_roles r where r.rolname = 'erp_app');
  if v_execucao is not null then
    raise exception 'EDITAR-01: EXECUTE de erp.situacao_atraso_cliente concedido alem do dono e do erp_app: %', v_execucao;
  end if;
end $$;
