-- PRE-BASE2-05C-2 — cutover do contador de código da Empresa: entity 'farm' -> 'empresa'
--
-- A 0017 removeu a ponte FÍSICA (colunas, views, gatilhos, funções, FKs, índices) e deixou de pé,
-- de propósito, a última coisa que ainda carregava o nome antigo: a CHAVE PERSISTIDA do contador de
-- código da Empresa, `erp.code_sequences.entity = 'farm'`. Esta migration aposenta essa chave.
--
-- POR QUE ISSO É UMA MIGRATION PRÓPRIA, E NÃO UM DETALHE DA 0017
-- -------------------------------------------------------------
-- `erp.code_sequences` tem chave primária `(organization_id, entity)`. Disso decorre o fato que governa
-- esta fatia inteira: `'farm'` e `'empresa'` NÃO são dois rótulos do mesmo contador — são DUAS LINHAS,
-- dois travamentos de linha e dois valores correntes independentes. E `erp.next_code` é
-- `insert ... values (org, entity, 1) on conflict do update set last_value = last_value + 1`: linha
-- AUSENTE não é erro, é REINÍCIO EM 1. Daí as duas armadilhas, ambas medidas em
-- `apps/api/test/integration/contador-empresa-transicao.test.ts`:
--
--   • COPIAR a linha e manter as duas ativas faz a API antiga e a API nova emitirem O MESMO próximo
--     número; o segundo cadastro morre no `unique (organization_id, code)` de `erp.empresas`;
--   • MOVER a linha enquanto a API antiga ainda serve deixa aquela versão sem contador:
--     `next_code(org,'farm')` cria a linha de novo e devolve 1. O cadastro roda numa ÚNICA transação
--     (`runService` -> `withTx`), então o desfecho depende do acervo: numa organização COM Empresas o
--     `insert` colide no `unique` e a transação inteira volta atrás — nada persiste, e o usuário leva um
--     erro; numa organização SEM Empresa não há com o que colidir, o cadastro COMITA, e aí a chave legada
--     fica gravada depois do cutover, em silêncio. É esse segundo caso que obriga a janela.
--
-- Não existe terceira opção segura em rollout com DUAS versões no ar. Por isso esta migration é uma
-- SUBSTITUIÇÃO (um `update` que renomeia a chave), nunca uma cópia, e por isso ela exige uma janela
-- operacional SINGLE-VERSION — descrita em `docs/PRE-BASE2-05C-2-CUTOVER.md`. O SQL abaixo protege o
-- DADO; ele não consegue proteger a JANELA, e não finge conseguir.
--
-- EXATIDÃO DA CHAVE — 'farm' E SOMENTE 'farm'
-- -------------------------------------------
-- `erp.code_sequences` guarda contadores de VÁRIAS entidades. Uma delas é `'farm_transfer'`
-- (`apps/api/src/routes/stock.ts:374`), que numera a transferência entre empresas e **não** é objeto
-- desta fatia. Por isso todo predicado aqui usa igualdade exata `entity = 'farm'`. Um `like 'farm%'`
-- levaria o contador de transferências junto e renumeraria documentos existentes — e a pós-condição da
-- seção 7 existe para reprovar exatamente esse erro, caso alguém o reintroduza.
--
-- FORMA. O runner (`packages/db/src/migrate.ts`) executa cada arquivo dentro de UMA transação:
-- begin -> arquivo inteiro -> insert no ledger -> commit. Por isso aqui NÃO existe `commit` e NÃO
-- existe `cascade`: ou tudo é aplicado, ou nada é.


-- ---------------------------------------------------------------------------------------------------
-- 0. VISIBILIDADE — esta migration precisa ENXERGAR o acervo, e isso NÃO é automático
-- ---------------------------------------------------------------------------------------------------
-- O DEFEITO QUE ESTA SEÇÃO EXISTE PARA IMPEDIR, medido antes de ela existir: aplicada por um papel sem
-- bypass de RLS, a 0018 COMMITAVA com sucesso, o runner gravava `0018` no ledger, e a chave `'farm'`
-- continuava fisicamente de pé. Nada se movia, e nada reclamava.
--
-- O mecanismo é a soma de duas coisas que, isoladas, são corretas. `0007_rls.sql:62` aplica
-- `force row level security` a TODA tabela do schema `erp` — inclusive para o dono da tabela. E a
-- política `tenant_isolation` é `to erp_app, authenticated` com `erp.tenant_visible(organization_id)`,
-- que é falso sem a GUC de tenant. Logo, um papel fora dessas roles e sem bypass enxerga ZERO linha em
-- `erp.code_sequences` e em `erp.empresas`.
--
-- Com zero linha, TODA conferência desta migration passa por VACUIDADE, e é isso que a torna perigosa:
-- a 5.1 conta 0 contadores canônicos; a 5.2 faz `except` entre dois conjuntos vazios; 5.3 e 5.4 contam
-- 0; na seção 6 `antes` = `{}` = `depois`, o `update` casa 0 linhas e `movidas` = `esperadas` = 0, de
-- modo que nenhuma das TRÊS comparações de preservação dispara; e a pós-condição 7.1 lê "0 linhas
-- 'farm'" porque não vê nenhuma. A aritmética da seção 6 é AUTO-REFERENTE — `esperadas` nasce da mesma
-- leitura filtrada que alimenta o `update` —, então nenhuma asserção daqui é absoluta quanto a o
-- cutover ter feito alguma coisa. É o "verde que não prova nada" do CLAUDE.md na forma literal: zero
-- linhas, zero organizações, asserção vazia, tudo aprovado.
--
-- E a consequência é a pior possível, porque é SILENCIOSA E COM REGISTRO DE SUCESSO: a precondição A3
-- do runbook passa a ler "já aplicada", o binário HEAD entra com `SEQUENCIA_EMPRESA = 'empresa'`,
-- `next_code(org,'empresa')` não acha linha, REINICIA EM 1 sobre um acervo já numerado, e o cadastro de
-- Empresa morre no `unique (organization_id, code)` — exatamente o defeito que esta fatia existe para
-- eliminar, agora com o ledger jurando que o cutover aconteceu.
--
-- SÃO DUAS GUARDAS, e elas provam coisas diferentes:
--
--   (a) o preflight de papel NOMEIA o problema antes de qualquer lock. Sem ele o operador receberia um
--       `42501` críptico lá na seção 5 e teria de deduzir a causa. O repositório já usa este preflight
--       em outro lugar, pelo mesmo motivo: `docs/DEPLOYMENT.md:358` o exige para o backfill de ID
--       Global, porque `DATABASE_URL` conecta como `erp_app`, sem bypass.
--   (b) `row_security = off` é a garantia MECÂNICA, e é ela que fecha o buraco de verdade: a partir
--       daqui, QUALQUER consulta que fosse filtrada por RLS levanta erro em vez de devolver menos
--       linhas. Não depende de eu ter previsto quais tabelas e quais políticas existirão amanhã.
--
-- Por que (b) não basta sozinha e (a) também não: (a) confere um ATRIBUTO DO PAPEL, que é um proxy —
-- (b) confere a CONDIÇÃO REAL, linha a linha. Um papel com bypass mas com a leitura restrita por outro
-- caminho passaria em (a) e seria pego por (b).
--
-- O que esta seção deliberadamente NÃO faz: exigir que o acervo seja não-vazio. Banco recém-criado tem
-- zero Empresa e zero contador legitimamente, e `cutover-0018-fresh.test.ts` cobre esse caso. A
-- distinção que importa é entre VAZIO DE VERDADE (legítimo, atravessa) e INVISÍVEL (defeito, aborta) —
-- e é exatamente essa a linha que `row_security = off` traça.
--
-- Por que é a seção 0 e não a 1: é leitura de catálogo, não custa lock nenhum e decide se o resto faz
-- sentido. Falhar aqui é falhar antes de disputar a trava da seção 1 com quem quer que seja.
do $$
declare
  papel text := current_user;
  enxerga_tudo boolean;
begin
  select rolsuper or rolbypassrls into enxerga_tudo from pg_roles where rolname = current_user;
  if not coalesce(enxerga_tudo, false) then
    -- O NOME DO PAPEL é publicável e é o que o operador precisa (`.claude/rules/security.md`); DSN,
    -- host e senha não aparecem aqui nem em lugar nenhum.
    raise exception 'PRE-BASE2-05C-2: o papel "%" nao tem bypass de RLS (rolsuper/rolbypassrls) e '
                    'enxergaria ZERO linha sob force row level security, fazendo esta migration passar '
                    'por vacuidade sem mover nada. Aplique o cutover pelo papel de migracao. '
                    'Nada foi aplicado.', papel
      using errcode = '42501';
  end if;
end $$;

-- A rede mecânica. Para papel com bypass isto é no-op (a RLS já não se aplicava); para qualquer outro,
-- transforma "ver menos linhas" em ERRO. É o oposto exato do modo de falhar descrito acima.
set local row_security = off;


-- ---------------------------------------------------------------------------------------------------
-- 1. TRAVA DE CONCORRÊNCIA DA FATIA
-- ---------------------------------------------------------------------------------------------------
-- O runner não tem trava própria: dois pre-deploys sobrepostos (retentativa por restart policy, redeploy
-- em cima de outro) leem o ledger, os dois veem esta migration como pendente, e os dois tentam aplicá-la.
--
-- CHAVE PRÓPRIA, NÃO A DA 0017. A 0017 usa `(2026, 51)`. Reaproveitar aquela chave faria esta migration
-- disputar trava com uma fatia que não tem relação nenhuma com ela — e, pior, daria a impressão de
-- proteção mútua onde não há. `(2026, 52)` é o espaço de DOIS inteiros, distinto do espaço `bigint` de
-- `pg_advisory_xact_lock(bigint)` que a rota de notificações usa: não há colisão possível entre os três.
-- O lock é TRANSACIONAL — sai sozinho no commit ou no rollback, sem caminho de vazamento.
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 52) then
    raise exception 'PRE-BASE2-05C-2: outra transacao ja detem a trava do cutover do contador (2026,52). Nada foi aplicado.'
      using errcode = '55P03';
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 2. TETO POR COMANDO
-- ---------------------------------------------------------------------------------------------------
-- `lock_timeout` aborta CADA espera por lock que passe de 2 s. Ele NÃO é teto da janela inteira: a
-- transação pode acumular várias esperas de até 2 s (medido e registrado na decisão 127). Quem reduz a
-- chance de ENTRAR numa espera é o porteiro humano de pré-deploy, não este comando.
set local lock_timeout = '2s';


-- ---------------------------------------------------------------------------------------------------
-- 3. PRÉ-AQUISIÇÃO DETERMINÍSTICA DOS LOCKS
-- ---------------------------------------------------------------------------------------------------
-- Ordem alfabética, sempre a mesma, para que duas execuções nunca se cruzem em ordens opostas.
-- NOWAIT: se qualquer relação estiver ocupada, a migration falha em milissegundos com 55P03 e a
-- transação inteira volta atrás, em vez de ficar pendurada segurando lock nas demais.
--
-- `erp.code_sequences` em ACCESS EXCLUSIVE, e o motivo é preciso: o que precisa ser impedido não é só a
-- escrita numa linha existente — é o `insert ... on conflict` de `erp.next_code` CRIAR uma linha
-- `'farm'` nova no meio da transição. Lock de linha não alcança uma linha que ainda não existe; só o
-- lock de TABELA alcança. O custo é que os outros contadores (product, person, ...) também esperam
-- durante a janela; a janela é de poucos milissegundos sobre uma tabela de uma linha por organização,
-- e está medida em `packages/db/test/cutover-0018-concorrencia.test.ts`.
--
-- `erp.empresas` em SHARE: a pré-condição da seção 5 compara `last_value` com `max(code)`, e essa
-- comparação só vale se ninguém inserir uma Empresa com código explícito no meio do caminho. SHARE
-- bloqueia INSERT/UPDATE/DELETE e continua permitindo leitura — é o mínimo que torna `max(code)`
-- estável, e não precisamos de mais do que isso porque esta migration não escreve em `erp.empresas`.
-- 3.1 AS RELAÇÕES EXISTEM — conferido ANTES do `lock table`, e só por causa da MENSAGEM.
--
-- `lock table` numa relação inexistente falha com o erro genérico do Postgres ("relation ... does not
-- exist"), que não diz ao operador NADA sobre esta fatia. Estes dois `to_regclass` trocam isso por uma
-- recusa nomeada, que é o padrão de todo o resto do arquivo.
--
-- POR QUE ISSO NÃO ABRE TOCTOU: o check não adquire lock nenhum e lê apenas o catálogo. Se a relação for
-- derrubada entre o check e o `lock table`, o lock falha — exatamente como falharia hoje, com a mesma
-- mensagem genérica e a mesma transação abortada. Não existe caminho novo em que a migration PROSSIGA
-- sobre uma relação ausente: o lock continua sendo adquirido antes de qualquer leitura ou escrita de dado,
-- e o `nowait` está intacto. O que muda é só o diagnóstico no caso comum.
do $$
begin
  if to_regclass('erp.code_sequences') is null then
    raise exception 'PRE-BASE2-05C-2: erp.code_sequences nao existe. O contador nao pode ser movido.';
  end if;
  if to_regclass('erp.empresas') is null then
    raise exception 'PRE-BASE2-05C-2: erp.empresas nao existe. Sem o cadastro nao ha como conferir o acervo numerado.';
  end if;
end $$;

lock table erp.code_sequences in access exclusive mode nowait;
lock table erp.empresas in share mode nowait;


-- ---------------------------------------------------------------------------------------------------
-- 4. PRÉ-CONDIÇÕES ESTRUTURAIS — o mundo é o que esta migration supõe?
-- ---------------------------------------------------------------------------------------------------
do $$
declare chave text; n bigint;
begin
  -- 4.2 a chave do contador continua sendo SEMANTICAMENTE (organization_id, entity).
  -- Toda a aritmética desta fatia depende disso. Se a PK tivesse mudado, "mover a chave" significaria
  -- outra coisa, e o `update` abaixo poderia colidir ou duplicar sem que nada aqui percebesse.
  select string_agg(a.attname, ',' order by k.ord) into chave
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality k(att, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
   where c.conrelid = 'erp.code_sequences'::regclass and c.contype = 'p';
  if chave is distinct from 'organization_id,entity' then
    raise exception 'PRE-BASE2-05C-2: a PK de erp.code_sequences e [%], esperada [organization_id,entity]. Nada foi aplicado.',
      coalesce(chave, '<sem PK>');
  end if;

  -- 4.3 o estado estrutural da 05C-1 está presente. Esta fatia é a SEGUINTE; aplicá-la sobre um banco
  -- que ainda tem a ponte física significa que a ordem do roteiro foi quebrada, e o que vem depois
  -- (inclusive o runtime) não vale.
  --
  -- A conferência é ESTRUTURAL, e não pelo ledger, de propósito. O ledger (`public.erp_migrations`) é
  -- escrituração do runner, não estado do schema: consultá-lo aqui acoplaria a migration ao runner e
  -- quebraria todo harness que aplica os arquivos direto — e, pior, deixaria passar um banco onde a linha
  -- existe mas a purga não terminou. A coluna legada é o fato; a linha no ledger é o registro dele.
  select count(*) into n
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'erp' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and a.attname in ('farm_id', 'origin_farm_id', 'destination_farm_id');
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: ainda existem % coluna(s) legada(s) da ponte fisica. A 0017 nao terminou.', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 5. PRÉ-CONDIÇÕES DE DADO — fail-closed, e NUNCA corretivas
-- ---------------------------------------------------------------------------------------------------
-- Nenhuma destas conferências "conserta" nada. Estado impossível ABORTA com mensagem identificável e a
-- correção é humana: um `update` automático aqui estaria escrevendo numeração de cadastro visível ao
-- usuário com base num palpite.
do $$
declare n bigint; detalhe text;
begin
  -- 5.1 NENHUMA linha canônica pode pré-existir. Se existir, "mover" viraria colisão de PK — ou, pior,
  -- um `on conflict` silencioso perderia um dos dois valores. Aqui isso simplesmente para.
  select count(*), string_agg(organization_id::text || '=' || last_value::text, ', ')
    into n, detalhe
    from erp.code_sequences where entity = 'empresa';
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: ja existem % linha(s) entity=''empresa'' [%]. O cutover nao sobrescreve contador canonico pre-existente.',
      n, coalesce(detalhe, '-');
  end if;

  -- 5.2 TODA organização com Empresa numerada precisa de contador legado. `erp.empresas.code` é
  -- `int not null`, então "ter Empresa" é "ter código". Sem a linha legada não há o que mover, e
  -- `next_code(org,'empresa')` começaria em 1 por cima de códigos que já existem.
  select count(*), string_agg(organization_id::text, ', ')
    into n, detalhe
    from (
      select e.organization_id from erp.empresas e group by e.organization_id
      except
      select cs.organization_id from erp.code_sequences cs where cs.entity = 'farm'
    ) faltando;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % organizacao(oes) tem Empresa numerada e NAO tem contador entity=''farm'' [%]. Mover nada deixaria a numeracao reiniciar em 1.',
      n, coalesce(detalhe, '-');
  end if;

  -- 5.3 O contador legado não pode estar ATRÁS do acervo. Se estivesse, o próximo código emitido
  -- colidiria com uma Empresa existente — e o cutover teria transportado um defeito em vez de um valor.
  select count(*), string_agg(format('%s: last_value=%s < max(code)=%s', cs.organization_id, cs.last_value, e.mx), ', ')
    into n, detalhe
    from erp.code_sequences cs
    join (select organization_id, max(code) as mx from erp.empresas group by organization_id) e
      on e.organization_id = cs.organization_id
   where cs.entity = 'farm' and cs.last_value < e.mx;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % contador(es) legado(s) abaixo do maior codigo ja usado [%]. Estado impossivel; a correcao e humana.',
      n, coalesce(detalhe, '-');
  end if;

  -- 5.4 `last_value` negativo não é um contador — é lixo que viraria numeração.
  select count(*) into n from erp.code_sequences where entity = 'farm' and last_value < 0;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % contador(es) entity=''farm'' com last_value negativo. Nada foi aplicado.', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 6. A TRANSIÇÃO — substituição da chave, com prova de preservação no mesmo escopo
-- ---------------------------------------------------------------------------------------------------
-- O `antes`/`depois` é capturado como um MAPA organização -> valor. Comparar os dois mapas prova, numa
-- única asserção, as três coisas que precisam ser verdade ao mesmo tempo: o mesmo CONJUNTO de
-- organizações atravessou, nenhum VALOR mudou, e nenhuma linha foi criada ou perdida no caminho.
-- Comparar só a contagem deixaria passar uma troca de valores entre duas organizações.
do $$
declare
  antes jsonb; depois jsonb; movidas bigint; esperadas bigint;
  outros_antes jsonb; outros_depois jsonb;
begin
  select coalesce(jsonb_object_agg(organization_id::text, last_value), '{}'::jsonb) into antes
    from erp.code_sequences where entity = 'farm';

  -- TODOS OS OUTROS CONTADORES, fotografados agora para serem reconferidos depois. Esta é a prova que
  -- reprova o `like 'farm%'`: `'farm_transfer'` (transferência entre empresas, outra fatia), `'product'`,
  -- `'person'` e os demais têm de sair desta migration exatamente como entraram.
  select coalesce(jsonb_object_agg(organization_id::text || '|' || entity, last_value), '{}'::jsonb)
    into outros_antes
    from erp.code_sequences where entity <> 'farm';

  esperadas := (select count(*) from jsonb_object_keys(antes));

  -- Igualdade EXATA. `like 'farm%'` levaria `'farm_transfer'` junto (ver o cabeçalho).
  update erp.code_sequences set entity = 'empresa' where entity = 'farm';
  get diagnostics movidas = row_count;

  select coalesce(jsonb_object_agg(organization_id::text, last_value), '{}'::jsonb) into depois
    from erp.code_sequences where entity = 'empresa';
  select coalesce(jsonb_object_agg(organization_id::text || '|' || entity, last_value), '{}'::jsonb)
    into outros_depois
    from erp.code_sequences where entity not in ('farm', 'empresa');

  if antes is distinct from depois then
    raise exception 'PRE-BASE2-05C-2: o contador NAO atravessou identico. antes=% depois=%. Nada foi aplicado.',
      antes::text, depois::text;
  end if;
  if movidas <> esperadas then
    raise exception 'PRE-BASE2-05C-2: movidas % linha(s), esperado %. Nada foi aplicado.', movidas, esperadas;
  end if;
  if outros_antes is distinct from outros_depois then
    raise exception 'PRE-BASE2-05C-2: outro(s) contador(es) mudaram. antes=% depois=%. Somente entity=''farm'' pode ser renomeado.',
      outros_antes::text, outros_depois::text;
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 7. PÓS-CONDIÇÕES
-- ---------------------------------------------------------------------------------------------------
do $$
declare n bigint; detalhe text;
begin
  -- 7.1 a chave legada não existe mais
  select count(*) into n from erp.code_sequences where entity = 'farm';
  if n <> 0 then
    raise exception 'PRE-BASE2-05C-2: sobraram % linha(s) entity=''farm'' depois do cutover.', n;
  end if;

  -- 7.2 nenhuma duplicidade por (organização, entidade) — a PK já garante, e conferir aqui é barato:
  -- se alguém tiver trocado a PK entre a seção 4 e agora, isto ainda pega.
  select count(*) into n from (
    select organization_id, entity from erp.code_sequences group by organization_id, entity having count(*) > 1
  ) d;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % par(es) (organizacao, entidade) duplicado(s) em erp.code_sequences.', n;
  end if;

  -- 7.3 nenhuma organização com Empresa ficou sem contador canônico
  select count(*), string_agg(organization_id::text, ', ') into n, detalhe
    from (
      select e.organization_id from erp.empresas e group by e.organization_id
      except
      select cs.organization_id from erp.code_sequences cs where cs.entity = 'empresa'
    ) x;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % organizacao(oes) com Empresa ficaram SEM contador canonico [%].', n, coalesce(detalhe, '-');
  end if;

  -- 7.4 o contador canônico continua na frente do acervo
  select count(*), string_agg(format('%s: last_value=%s < max(code)=%s', cs.organization_id, cs.last_value, e.mx), ', ')
    into n, detalhe
    from erp.code_sequences cs
    join (select organization_id, max(code) as mx from erp.empresas group by organization_id) e
      on e.organization_id = cs.organization_id
   where cs.entity = 'empresa' and cs.last_value < e.mx;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: contador canonico abaixo do acervo depois do cutover [%].', coalesce(detalhe, '-');
  end if;

  -- 7.5 nenhum contador canônico com valor negativo saiu daqui
  select count(*) into n from erp.code_sequences where entity = 'empresa' and last_value < 0;
  if n > 0 then
    raise exception 'PRE-BASE2-05C-2: % contador(es) canonico(s) com last_value negativo.', n;
  end if;
end $$;
