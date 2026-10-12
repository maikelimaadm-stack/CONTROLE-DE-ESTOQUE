-- =====================================================================
-- 0063 EDITAR-02 — VERSÃO DO DOCUMENTO DE COMPRA (pedido de compra, compra e orçamento de compra) — decisão 313
--
-- O MOLDE é a parte de versão da 0039 (EDITAR-01, decisão 272, item 1.1, em erp.sales_documents), repetida aqui em
-- erp.documentos_compra: a mesma coluna, a mesma regra de soma, o mesmo gatilho último por nome, as mesmas perguntas
-- sobre o papel da aplicação. Nada de vendas é tocado.
--
-- 1) erp.documentos_compra.version (bigint, not null, default 0): o número que a edição do documento salvo usa
--    como trava otimista — quem abriu a versão N só grava se o documento ainda estiver na versão N.
--    ADD COLUMN com default CONSTANTE é só metadado desde o PostgreSQL 11: o valor fica no catálogo
--    (attmissingval) e a tabela NÃO é regravada; toda linha que existe hoje passa a ler 0. O lock é o
--    AccessExclusive do próprio ALTER, curto, e o lock_timeout de 2s faz a migration desistir em vez de
--    enfileirar as gravações de compra atrás dela.
--    As três espécies da tabela (pedido, compra e orçamento) ganham a coluna: ela é do CABEÇALHO, e não de uma
--    espécie. Quais espécies e situações a API deixa editar é regra da decisão 313, que mora na API; o banco só soma.
-- 2) A VERSÃO MUDA QUANDO O CABEÇALHO DO DOCUMENTO MUDA — em QUALQUER UPDATE da linha de erp.documentos_compra, de
--    QUALQUER caminho: editar, confirmar, cancelar, finalizar, converter, reabrir, encerrar o saldo, aprovar para
--    orçamento, escolher ou não escolher o orçamento, o pedido que recebe o fornecedor do orçamento escolhido, o PUT
--    do orçamento, um script de suporte. Quem soma é o gatilho `trg_documentos_compra_versao` (BEFORE UPDATE, por
--    linha, sem lista de colunas e sem WHEN), e não cada rota da API lembrando de somar: a rota que esquecesse
--    deixaria o documento mudar com a versão parada, e a trava otimista aceitaria uma gravação feita sobre o estado
--    velho. A função ignora o que o UPDATE mandou na coluna: `new.version := old.version + 1` sempre — um
--    `SET version = 999` explícito vira old+1, e um UPDATE que não muda nada (`set observacao = observacao`) também
--    soma 1 (o UPDATE aconteceu; o gatilho não tenta adivinhar se "valeu").
--    FORA DO ABERTO a conferência v3 (0044) vem ANTES e congela a linha inteira (ver a ordem, abaixo): um UPDATE que
--    mande em `version` um valor diferente do atual, num documento confirmado, cancelado, finalizado, convertido,
--    escolhido ou não escolhido, é RECUSADO por ela ("só a situação muda") antes de chegar à soma. As duas saídas
--    fecham a mesma porta: no aberto o valor mandado vira old+1, fora dele o UPDATE é recusado — a versão nunca é
--    a que a aplicação escreveu.
--    RECEBER O PEDIDO (apps/api/src/routes/compras-recebimento.ts): a compra gerada é INSERT e nasce 0. O PEDIDO só
--    soma quando é ele o UPDATE — virar convertido quando a compra zera o saldo, encerrar o saldo, reabrir quando a
--    compra que o converteu é cancelada. A compra que NÃO zera o saldo só trava o pedido (FOR SHARE, na conferência
--    v3 do cabeçalho e na guarda da origem dos itens), e trava não dispara gatilho: a versão do pedido fica PARADA,
--    embora agora exista compra viva dele. "Pedido com compra viva" é pergunta que a edição faz sob a trava da
--    linha, não uma mudança de versão.
--    A VERSÃO É DO CABEÇALHO: escrita só em itens (erp.documentos_compra_itens) não soma — como na 0039. Quem grava
--    item de documento que já existe toca o cabeçalho na MESMA transação (os totais moram nele), e é esse UPDATE que
--    soma; uma escrita só em itens, sem o UPDATE do cabeçalho (um script, uma rota futura), deixaria a versão
--    parada — quem a fizer tem de tocar o cabeçalho na mesma transação. Cada UPDATE do cabeçalho soma 1: a rota que
--    o atualizar duas vezes na mesma transação deixa a versão +2, e a versão que ela devolve é a da última linha.
--    O INSERT não passa pelo gatilho: o documento nasce com o default (0). Um INSERT que citasse a coluna
--    gravaria o valor dele — nenhuma rota cita (COLUNAS_INSERCAO de compras.ts e COLUNAS_DO_ORCAMENTO de
--    compras-orcamento.ts não a têm), e a trava continua valendo, porque ela compara igualdade e todo UPDATE
--    seguinte soma 1 a partir dali.
--
-- A ORDEM ENTRE OS GATILHOS BEFORE UPDATE. O PostgreSQL dispara os gatilhos do mesmo momento na ordem do
-- NOME (byte a byte, collation "C"), e cada BEFORE vê o NEW que os anteriores deixaram — inclusive na
-- cláusula WHEN. Hoje a tabela tem EXATAMENTE cinco BEFORE UPDATE por linha (a pré-condição confere pelo
-- catálogo, por nome e por função):
--   · trg_documentos_compra_aprovacao   (0041) → erp.documentos_compra_aprovacao_guarda();
--   · trg_documentos_compra_conferir    (0044) → erp.documentos_compra_conferir_v3();
--   · trg_documentos_compra_finalizacao (0044) → erp.documentos_compra_finalizacao_guarda();
--   · trg_documentos_compra_nota        (0047) → erp.documentos_compra_nota_guarda();
--   · trg_documentos_compra_transicao   (0044) → erp.documentos_compra_transicao_v3().
-- `trg_documentos_compra_versao` ordena DEPOIS dos cinco ('v' > 't' > 'n' > 'f' > 'c' > 'a' depois do prefixo
-- comum), então a versão muda por último, e o nome foi escolhido por isso. O que cada guarda compara (lido no
-- arquivo):
--   · 0041 documentos_compra_aprovacao_guarda: UPDATE OF situacao, WHEN aberto → confirmado; compara COLUNAS
--     (organization_id, id, tipo_operacao_versao_id e valor_total, de OLD e NEW).
--   · 0044 documentos_compra_conferir_v3: compara COLUNAS e, FORA DO ABERTO, a LINHA INTEIRA —
--     `(to_jsonb(new) - situacao, atualizado_em [, saldo_encerrado_*])` contra o mesmo recorte de `to_jsonb(old)`.
--     É ESTA guarda que torna "a versão por último" uma exigência, e não só uma proteção: se a soma rodasse antes
--     dela, todo UPDATE de documento fora do aberto veria a versão mudada e seria recusado — cancelar a compra
--     confirmada, converter ou cancelar o pedido finalizado, reabrir o pedido convertido. Ela também carimba
--     atualizado_em, que não é a versão e não muda de sentido.
--   · 0044 documentos_compra_finalizacao_guarda: UPDATE OF situacao, WHEN aberto → finalizado do pedido; compara
--     COLUNAS (organization_id, id, tipo_operacao_versao_id e valor_total).
--   · 0047 documentos_compra_nota_guarda: UPDATE OF as doze colunas fiscais; compara AS DOZE, nada de linha inteira.
--   · 0044 documentos_compra_transicao_v3: UPDATE OF situacao; compara COLUNAS (situacao, especie, finalizado_em,
--     saldo_encerrado_em, id e organization_id).
--   Quem lê a linha inteira DEPOIS é a auditoria (trg_documentos_compra_audit, erp.audit_row: to_jsonb(old) e
--   to_jsonb(new)), e ela é AFTER: grava o antes e o depois já com a versão somada.
--   Por isso a pré-condição exige o conjunto EXATO de hoje e a pós-condição confere que a versão é o último BEFORE
--   UPDATE por nome: um gatilho novo que ordene depois de `trg_documentos_compra_versao` tem de ser decidido na
--   migration dele, à vista.
--
-- NÃO PODE SER CONTORNADO PELO PAPEL DA APLICAÇÃO (erp_app, com que a API conecta). A pré-condição confere,
-- pelo catálogo, que o erp_app:
--   · EXISTE — primeiro, com motivo nomeado: sem ele nenhuma das perguntas abaixo faz sentido;
--   · não é dono de erp.documentos_compra nem MEMBRO do papel dono → não faz ALTER TABLE ... DISABLE TRIGGER,
--     não faz DROP TRIGGER. Aqui a pergunta é 'MEMBER', e não 'USAGE': o erp_app nasce NOINHERIT (0007), e
--     um membro que não herda ainda pode fazer SET ROLE para o dono e desligar o gatilho;
--   · não é superusuário e não tem SET em session_replication_role → não liga o modo `replica`, em que os
--     gatilhos ligados como 'O' (origem, o padrão) deixam de disparar;
--   · não tem TRIGGER em erp.documentos_compra → não cria um gatilho que ordene depois deste e desfaça a soma;
--   · não é MEMBRO — de qualquer forma, direta ou em cadeia, com ou sem herança (pg_has_role ... 'MEMBER') — de
--     NENHUM papel que seja superusuário, tenha SET em session_replication_role ou tenha TRIGGER em
--     erp.documentos_compra: o membro NOINHERIT não usa o privilégio do papel pelas funções has_*_privilege, mas
--     faz SET ROLE para ele e passa a ter tudo o que ele tem;
--   · não tem session_replication_role em pg_db_role_setting que alcance a sessão dele (ALTER ROLE erp_app SET,
--     em qualquer banco, ou o ajuste de banco/ALTER ROLE ALL, setrole = 0): a sessão nasceria em `replica`,
--     com o gatilho desligado, sem o erp_app pedir nada.
--   E o `SET version = x` explícito que ele mande é sobrescrito por old+1 (no aberto) ou recusado pela conferência
--   v3 (fora dele). A função é SECURITY INVOKER (não lê tabela nenhuma: só soma), com search_path fixo
--   `erp, pg_temp`, e o EXECUTE sai de TODO papel além do dono (PUBLIC e o erp_app que o default privilege da 0007
--   concede): gatilho não precisa de EXECUTE de quem grava, e a função não é porta de ninguém.
--   LEITURA: o erp_app lê a coluna pelo grant de TABELA da 0036 (`grant select, insert, update on
--   erp.documentos_compra to erp_app`), que vale para toda coluna, inclusive a que nasce depois — como a 0039, sem
--   grant novo. A pós-condição confere o SELECT da coluna pelo erp_app (has_column_privilege): um grant por coluna,
--   no lugar do de tabela, deixaria a API sem ler a versão.
--
-- O QUE DA 0039 NÃO SE REPETE: a porta do atraso do cliente (item 3 da 0039, erp.situacao_atraso_cliente). Compras
-- não tem porta SECURITY DEFINER que reconfira capacidade de lançar (nenhuma função do banco cita capacidade de
-- compras), então não há porta a abrir para quem só edita. Nenhum objeto de vendas, estoque ou financeiro muda.
--
-- SEM BACKFILL: nenhum UPDATE nesta migration. As linhas de hoje leem 0 pelo default do catálogo; o gatilho
-- nasce depois do ADD COLUMN e não roda para elas.
-- JANELA DE DEPLOY (pre-deploy, banco → API → web): a API anterior grava o documento por UPDATE sem citar a
-- coluna, e o gatilho só soma — nada do que ela grava muda de sentido por causa da versão. O `d.*` do GET
-- anterior (`GET /compras/:id`) passa a trazer `version` na resposta: campo a mais, aditivo, que a web anterior
-- ignora. Criar documento (INSERT sem a coluna) continua igual: nasce 0.
-- VOLTA: API e web voltam por redeploy e convivem com a 0063 (a coluna e o gatilho não recusam nada que a API
-- anterior faça). Tirar o gatilho, a função ou a coluna do banco é decisão humana, com migration própria.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o
-- nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fatia (2026,97).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 97) then
    raise exception 'EDITAR-02: outra transacao ja detem a trava desta migration (2026,97). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_owner oid;
  v_antes text[];
  v_app oid;
  v_perigosos text[];
begin
  -- "Já aplicada" ANTES de TODAS as demais: depois da 0063 a coluna, a função e o gatilho existem, e a reaplicação
  -- precisa dizer o motivo verdadeiro. A pergunta não depende da tabela existir (to_regclass nulo: nenhuma linha).
  if exists (select 1 from pg_attribute a
              where a.attrelid = to_regclass('erp.documentos_compra') and a.attname = 'version' and not a.attisdropped) then
    raise exception 'EDITAR-02: erp.documentos_compra.version ja existe; a 0063 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regclass('erp.documentos_compra') is null then
    raise exception 'EDITAR-02: erp.documentos_compra ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('erp.documentos_compra_versao()') is not null then
    raise exception 'EDITAR-02: a funcao erp.documentos_compra_versao() ja existe; schema divergente.';
  end if;
  if exists (select 1 from pg_trigger t
              where t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_versao') then
    raise exception 'EDITAR-02: o gatilho trg_documentos_compra_versao ja existe em erp.documentos_compra; schema divergente.';
  end if;
  -- O conjunto EXATO dos BEFORE UPDATE por linha, por nome E por função: é sobre ele que o cabeçalho afirma o que
  -- cada guarda compara e que "a versão é a última". Um gatilho a mais (ou a menos, ou o mesmo nome apontando para
  -- outra função) invalida a afirmação, e a decisão volta para um humano.
  -- O nome da função vem de nspname e proname, e não de regprocedure::text (que depende do search_path).
  -- tgtype é uma máscara; 1, 2 e 16 são os VALORES das flags (não posições de bit): 1 = ROW (por linha),
  -- 2 = BEFORE, 16 = UPDATE (TRIGGER_TYPE_ROW, TRIGGER_TYPE_BEFORE e TRIGGER_TYPE_UPDATE do PostgreSQL).
  select array_agg(t.tgname || ' -> ' || n.nspname || '.' || p.proname order by t.tgname collate "C") into v_antes
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'erp.documentos_compra'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_antes is distinct from array[
       'trg_documentos_compra_aprovacao -> erp.documentos_compra_aprovacao_guarda',
       'trg_documentos_compra_conferir -> erp.documentos_compra_conferir_v3',
       'trg_documentos_compra_finalizacao -> erp.documentos_compra_finalizacao_guarda',
       'trg_documentos_compra_nota -> erp.documentos_compra_nota_guarda',
       'trg_documentos_compra_transicao -> erp.documentos_compra_transicao_v3'] then
    raise exception 'EDITAR-02: gatilhos BEFORE UPDATE por linha de erp.documentos_compra diferentes dos cinco esperados (aprovacao da 0041, conferir/finalizacao/transicao da 0044, nota da 0047): %', v_antes;
  end if;
  -- ALTER TABLE, CREATE TRIGGER e COMMENT exigem os privilégios do DONO da tabela. 'USAGE' é a pergunta que o
  -- próprio PostgreSQL faz ao conferir dono (ser o dono, herdar dele, ou superusuário); 'MEMBER' aceitaria
  -- um membro NOINHERIT, que ainda seria recusado pelo ALTER sem SET ROLE. Sem isso a migration pararia no
  -- meio com um erro de permissão genérico, em vez do motivo nomeado aqui.
  select c.relowner into v_owner from pg_class c where c.oid = 'erp.documentos_compra'::regclass;
  if not pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception 'EDITAR-02: o papel que aplica a migration nao e dono de erp.documentos_compra; o ALTER TABLE e o CREATE TRIGGER seriam recusados.';
  end if;
  if not has_schema_privilege(current_user, 'erp', 'CREATE') then
    raise exception 'EDITAR-02: o papel que aplica a migration nao cria objetos no schema erp; o CREATE FUNCTION seria recusado.';
  end if;
  -- O papel da aplicação não desliga nem contorna o gatilho (ver o cabeçalho). A EXISTÊNCIA vem primeiro: sem
  -- ela, o primeiro pg_has_role abaixo pararia com "role erp_app does not exist", e não com o motivo nomeado.
  select r.oid into v_app from pg_roles r where r.rolname = 'erp_app';
  if v_app is null then
    raise exception 'EDITAR-02: o papel erp_app nao existe; a 0007 nao esta aplicada ou ha schema divergente.';
  end if;
  -- Superusuário vem ANTES das perguntas de papel: para ele toda pergunta de papel responde sim, e o motivo
  -- nomeado tem de ser o verdadeiro.
  if (select r.rolsuper from pg_roles r where r.oid = v_app)
     or has_parameter_privilege(v_app, 'session_replication_role', 'SET') then
    raise exception 'EDITAR-02: o papel da aplicacao (erp_app) e superusuario ou pode trocar session_replication_role; poderia desligar o gatilho da versao.';
  end if;
  -- 'MEMBER' (e não 'USAGE'): o erp_app é NOINHERIT (0007), e ser membro sem herdar ainda permite SET ROLE
  -- para o dono.
  if pg_has_role(v_app, v_owner, 'MEMBER') then
    raise exception 'EDITAR-02: o papel da aplicacao (erp_app) e dono de erp.documentos_compra ou membro do papel dono; poderia desligar o gatilho da versao.';
  end if;
  if has_table_privilege(v_app, 'erp.documentos_compra', 'TRIGGER') then
    raise exception 'EDITAR-02: o papel da aplicacao (erp_app) tem TRIGGER em erp.documentos_compra; poderia criar um gatilho depois do da versao.';
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
          or has_table_privilege(r.oid, 'erp.documentos_compra', 'TRIGGER'));
  if v_perigosos is not null then
    raise exception 'EDITAR-02: o papel da aplicacao (erp_app) e membro (com ou sem heranca) de papel superusuario, com SET em session_replication_role ou com TRIGGER em erp.documentos_compra: %; faria SET ROLE e poderia desligar o gatilho da versao.', v_perigosos;
  end if;
  -- O ajuste guardado que a sessão do erp_app herdaria ao conectar: o do papel (em qualquer banco) e o de todos
  -- os papéis (setrole = 0: ALTER DATABASE ... SET, ALTER ROLE ALL SET).
  if exists (select 1 from pg_db_role_setting s
               cross join lateral unnest(s.setconfig) c(ajuste)
              where s.setrole in (v_app, 0)
                and lower(split_part(c.ajuste, '=', 1)) = 'session_replication_role') then
    raise exception 'EDITAR-02: ha session_replication_role em pg_db_role_setting para o erp_app (ALTER ROLE erp_app SET, ALTER ROLE ALL SET ou ALTER DATABASE SET); a sessao dele nasceria com o gatilho da versao desligado.';
  end if;
end $$;

-- ---------- 3) coluna ----------
-- Default constante: só metadado, sem regravar a tabela (ver o cabeçalho).
alter table erp.documentos_compra add column version bigint not null default 0;

comment on column erp.documentos_compra.version is 'Versão do documento de compra (EDITAR-02, decisão 313): trava otimista da edição. Nasce 0; o gatilho trg_documentos_compra_versao soma 1 em TODO UPDATE do cabeçalho, de qualquer caminho, e ignora o valor que o UPDATE mandar (fora do aberto, a conferência v3 recusa o valor mandado antes).';

-- ---------- 4) a função e o gatilho ----------
-- SECURITY INVOKER (o padrão): não lê tabela nenhuma, só soma; não há o que atravessar de RLS.
create function erp.documentos_compra_versao() returns trigger
  language plpgsql
  set search_path = erp, pg_temp
as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;

comment on function erp.documentos_compra_versao() is 'EDITAR-02 (decisão 313): gatilho BEFORE UPDATE de erp.documentos_compra; new.version := old.version + 1 em todo UPDATE. Tem de ser o último BEFORE UPDATE por nome (depois da conferência v3, que congela a linha inteira fora do aberto).';

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todo
-- papel além do dono (o mesmo laço da 0039; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = 'erp.documentos_compra_versao()'::regprocedure
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- Sem lista de colunas e sem WHEN: TODO update soma. O nome ordena depois das cinco guardas (ver o cabeçalho).
create trigger trg_documentos_compra_versao
  before update on erp.documentos_compra
  for each row execute function erp.documentos_compra_versao();

-- ---------- 5) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_depois text[];
begin
  if not exists (select 1 from pg_attribute a
                   join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = 'erp.documentos_compra'::regclass and a.attname = 'version' and not a.attisdropped
                    and format_type(a.atttypid, a.atttypmod) = 'bigint' and a.attnotnull
                    and a.attgenerated = '' and a.attidentity = ''
                    and pg_get_expr(d.adbin, d.adrelid) = '0') then
    raise exception 'EDITAR-02: erp.documentos_compra.version nao e bigint not null default 0 (sem identity, sem generated).';
  end if;
  -- O papel da aplicação LÊ a coluna (pelo grant de tabela da 0036, que vale para a coluna nova).
  if not has_column_privilege('erp_app', 'erp.documentos_compra', 'version', 'SELECT') then
    raise exception 'EDITAR-02: o papel da aplicacao (erp_app) nao le erp.documentos_compra.version; a edicao nao conferiria a versao.';
  end if;
  if not exists (select 1 from pg_proc p
                  where p.oid = 'erp.documentos_compra_versao()'::regprocedure
                    and not p.prosecdef
                    and p.prolang = (select l.oid from pg_language l where l.lanname = 'plpgsql')
                    and p.prorettype = 'trigger'::regtype
                    and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'EDITAR-02: erp.documentos_compra_versao() nao e plpgsql, retornando trigger, SECURITY INVOKER, com search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = 'erp.documentos_compra_versao()'::regprocedure
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'EDITAR-02: EXECUTE de erp.documentos_compra_versao() concedido alem do dono.';
  end if;
  -- BEFORE, por linha, SÓ UPDATE (tgtype exatamente 1|2|16), sem lista de colunas, sem WHEN, sem argumento,
  -- ligado como 'O', na função certa.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_versao'
                    and not t.tgisinternal and t.tgenabled = 'O'
                    and t.tgfoid = 'erp.documentos_compra_versao()'::regprocedure
                    and t.tgtype = (1 | 2 | 16)
                    and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null and t.tgnargs = 0) then
    raise exception 'EDITAR-02: gatilho trg_documentos_compra_versao ausente, desligado, de outro tipo (antes de UPDATE, por linha, sem coluna e sem WHEN) ou fora de erp.documentos_compra_versao().';
  end if;
  -- A ORDEM: os BEFORE UPDATE por linha são as cinco guardas e a versão, e a versão é a ÚLTIMA por nome.
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_depois
    from pg_trigger t
   where t.tgrelid = 'erp.documentos_compra'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_depois is distinct from array['trg_documentos_compra_aprovacao', 'trg_documentos_compra_conferir', 'trg_documentos_compra_finalizacao',
                                     'trg_documentos_compra_nota', 'trg_documentos_compra_transicao', 'trg_documentos_compra_versao'] then
    raise exception 'EDITAR-02: o gatilho da versao nao e o ultimo BEFORE UPDATE por linha de erp.documentos_compra (ordem por nome): %', v_depois;
  end if;
end $$;
