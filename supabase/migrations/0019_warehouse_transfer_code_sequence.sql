-- HOTFIX PRÉ-BASE2-03 — numeração de `erp.warehouse_transfers`: um contador por NAMESPACE DE UNICIDADE
--
-- O DEFEITO
-- ---------
-- `erp.warehouse_transfers` tem `unique (organization_id, code)` (0003_stock_supply.sql). A unicidade
-- NÃO inclui `kind`, logo existe UM namespace de código por organização para a tabela inteira.
--
-- Mas `POST /api/stock/transfers` numerava com DOIS contadores independentes:
--
--   kind = 'warehouse' -> erp.next_code(org, 'warehouse_transfer')
--   kind = 'farm'      -> erp.next_code(org, 'farm_transfer')
--
-- `erp.code_sequences` tem PK `(organization_id, entity)`: duas chaves são DUAS LINHAS, com dois
-- `last_value` independentes. Os dois contadores começam em 1 e sobem sozinhos, então os dois emitem
-- `0001`, `0002`, ... para a MESMA coluna com unicidade compartilhada. A segunda variante criada numa
-- organização morre no `unique (organization_id, code)` com 409 — e numa organização nova isso acontece
-- logo no primeiro documento da segunda variante. É a transferência ENTRE EMPRESAS que quebra: a
-- operação que atravessa exatamente a fronteira que o contrato multiempresa existe para proteger.
--
-- A BASE2-02 encontrou o defeito (o E2E da variante foi a primeira coisa do repositório a criar as duas
-- variantes na mesma organização), documentou-o e NÃO o corrigiu, porque corrigir numeração visível de
-- documento é EXECUTAR e estava fora da fronteira daquela fatia. Este hotfix é a PR própria que o
-- roteiro passou a exigir antes da BASE2-03.
--
-- O PRINCÍPIO, E POR QUE ELE NÃO É ARBITRÁRIO
-- -------------------------------------------
-- A sequência acompanha o NAMESPACE DE UNICIDADE DA TABELA, não a variante funcional.
--
-- O repositório já obedecia a esse princípio nas outras duas tabelas que numeram por variante — e é por
-- isso que elas NÃO têm este defeito:
--
--   erp.financial_titles   unique (organization_id, direction, code)   contadores title_payable / title_receivable
--   erp.sales_documents    unique (organization_id, kind, code)        contadores sales_budget / sales_order / sales_sale
--   erp.animal_movements   unique (organization_id, movement_type, code)
--
-- Nos três, o discriminador está DENTRO da chave única, então contador por variante é correto: cada
-- variante tem o seu próprio namespace. `erp.warehouse_transfers` é a única tabela do schema que numera
-- por variante SEM o discriminador na chave — e é exatamente por isso que é a única que colide.
-- (`scripts/sequencia-namespace-audit.mjs`, encadeado no `pnpm lint`, transforma esta frase em gate:
-- nenhuma tabela pode voltar a numerar por variante fora do seu namespace de unicidade.)
--
-- A TOP continua com DUAS operações (`estoque.transferencia_entre_armazens` e
-- `estoque.transferencia_entre_empresas`): classificação e numeração são coisas diferentes, e este
-- hotfix não toca na primeira.
--
-- POR QUE O ALIAS EM `erp.next_code`, E POR QUE ELE EVITA UMA JANELA COMO A DA 05C-2
-- ---------------------------------------------------------------------------------
-- O pre-deploy da Railway aplica a migration ANTES de o container antigo ser drenado. Durante a janela
-- de rolling deploy o binário BASE continua no ar e continua pedindo `farm_transfer`.
--
-- E `erp.next_code` é `insert ... on conflict do update set last_value = last_value + 1`: linha AUSENTE
-- não é erro, é REINÍCIO EM 1. Então apagar `farm_transfer` e confiar que o container velho suma é
-- exatamente o modo de falhar que a 0018 documentou em detalhe: a chave ressuscita começando em 1 sobre
-- um acervo já numerado, e o estrago é silencioso enquanto o número estiver livre.
--
-- Daí a compatibilidade morar no BANCO, e não no calendário de deploy: `erp.next_code` passa a
-- CANONICALIZAR `farm_transfer` para `warehouse_transfer`. O binário BASE pede a chave antiga e recebe
-- número do contador canônico — mesmo contador, mesma sequência, sem linha legada nova. O binário HEAD
-- pede a chave canônica diretamente. Os dois runtimes ficam corretos contra o mesmo banco, que é o que
-- torna o AUTODEPLOY NORMAL seguro e dispensa a janela single-version que a 05C-2 precisou.
--
-- O alias também é o caminho de ROLLBACK: se um deploy HEAD falhar depois desta migration, voltar ao
-- binário BASE continua correto. Por isso ele NÃO é removido nesta fatia — sai quando não houver mais
-- versão viva pedindo `farm_transfer`, em fatia própria.
--
-- A CHAVE LEGADA ERA SOBRECARREGADA — E POR ISSO O ALIAS SOZINHO NÃO BASTARIA
-- --------------------------------------------------------------------------
-- `'farm_transfer'` não servia só a `erp.warehouse_transfers`. DUAS tabelas, com namespaces de unicidade
-- DIFERENTES, pediam o MESMO contador:
--
--   erp.warehouse_transfers   unique (organization_id, code)                 POST /stock/transfers
--   erp.animal_movements      unique (organization_id, movement_type, code)  POST /livestock/transfers/to-farm
--
-- Isso não produzia colisão (um contador só sobe, e as tabelas são distintas), mas um ALIAS não sabe quem
-- chamou. Canonicalizar `'farm_transfer'` sem mais nada mandaria a numeração do REBANHO para o contador de
-- ESTOQUE, e a seção 6 apagaria a linha que é o contador do rebanho. O hotfix consertaria uma tabela
-- quebrando outra.
--
-- Por isso a 0019 DIVIDE o histórico compartilhado antes de apagar a linha legada: o valor dela entra no
-- baseline das DUAS chaves canônicas, cada uma combinada com o `max(code)` da SUA tabela. A chave do
-- rebanho segue a convenção que a própria rota já usava nas outras movimentações (`animal_<tipo>`), e o
-- runtime a lê de `apps/api/src/lib/sequencia-transferencia-rebanho.ts`.
--
-- RISCO RESIDUAL, DECLARADO: o binário BASE pede `'farm_transfer'` para as DUAS rotas, e o alias só pode
-- acertar uma — ele acerta a de ESTOQUE, que é o assunto desta fatia. Durante a janela de rolling deploy,
-- uma transferência de REBANHO atendida pelo binário anterior recebe número do contador de estoque; ela
-- comita em segurança (esse contador fica, por construção, acima de todo código de rebanho já emitido), e
-- o resíduo é que o contador de rebanho, subindo depois, pode um dia alcançar aquele número e produzir UM
-- 409 que se resolve na tentativa seguinte. Medido em `packages/db/test/hotfix-0019-upgrade.test.ts`.
--
-- FORMA. O runner (`packages/db/src/migrate.ts`) executa cada arquivo dentro de UMA transação:
-- begin -> arquivo inteiro -> insert no ledger -> commit. Por isso aqui NÃO existe `commit` e NÃO
-- existe `cascade`: ou tudo é aplicado, ou nada é.
--
-- IDEMPOTÊNCIA. O ledger impede a reaplicação, mas esta migration é naturalmente idempotente mesmo
-- assim: o `GREATEST` inclui o próprio valor canônico (só sobe ou fica), e o `delete` de uma chave que
-- já não existe casa zero linhas. Rodá-la de novo à mão não estraga nada — provado em
-- `packages/db/test/hotfix-0019-upgrade.test.ts`.


-- ---------------------------------------------------------------------------------------------------
-- 0. VISIBILIDADE — esta migration precisa ENXERGAR o acervo, e isso NÃO é automático
-- ---------------------------------------------------------------------------------------------------
-- Mesmo mecanismo que a 0018 documentou: `0007_rls.sql` aplica `force row level security` a TODA tabela
-- do schema `erp`, inclusive para o dono. Um papel sem bypass enxerga ZERO linha em
-- `erp.code_sequences` e em `erp.warehouse_transfers` — e aí TODA conferência daqui passaria por
-- VACUIDADE: zero contadores a reconciliar, zero códigos no `max`, zero linhas legadas a apagar, tudo
-- "aprovado", ledger gravando sucesso, e o contador canônico continuando abaixo do acervo real.
--
-- A consequência seria pior que o defeito original, porque viria com registro de sucesso: o binário HEAD
-- entraria pedindo `warehouse_transfer` sobre um contador não reconciliado e colidiria com o acervo.
--
-- São duas guardas. O preflight NOMEIA o problema antes de qualquer lock; `row_security = off` é a rede
-- mecânica, que para papel com bypass é no-op e para qualquer outro transforma "ver menos linhas" em
-- erro. O que esta seção deliberadamente NÃO faz é exigir acervo não-vazio: banco recém-criado tem zero
-- transferência e zero contador legitimamente, e esse caso é coberto pelos testes de matriz.
do $$
declare
  papel text := current_user;
  enxerga_tudo boolean;
begin
  select rolsuper or rolbypassrls into enxerga_tudo from pg_roles where rolname = current_user;
  if not coalesce(enxerga_tudo, false) then
    -- O NOME DO PAPEL é publicável e é o que o operador precisa (`.claude/rules/security.md`); DSN,
    -- host e senha não aparecem aqui nem em lugar nenhum.
    raise exception 'HOTFIX-0019: o papel "%" nao tem bypass de RLS (rolsuper/rolbypassrls) e '
                    'enxergaria ZERO linha sob force row level security, fazendo esta migration '
                    'reconciliar nada e gravar sucesso. Aplique pelo papel de migracao. Nada foi aplicado.', papel
      using errcode = '42501';
  end if;
end $$;

set local row_security = off;


-- ---------------------------------------------------------------------------------------------------
-- 1. TRAVA DE CONCORRÊNCIA DA FATIA
-- ---------------------------------------------------------------------------------------------------
-- O runner não tem trava própria: dois pre-deploys sobrepostos (retentativa por restart policy, redeploy
-- em cima de outro) leem o ledger, os dois veem esta migration como pendente, e os dois tentam aplicá-la.
--
-- CHAVE PRÓPRIA: a 0017 usa `(2026, 51)` e a 0018 usa `(2026, 52)`. `(2026, 53)` é desta fatia. O espaço
-- de DOIS inteiros é distinto do espaço `bigint` de `pg_advisory_xact_lock(bigint)` que a rota de
-- notificações usa (`apps/api/src/routes/admin.ts`): não há colisão possível entre os três.
-- O lock é TRANSACIONAL — sai sozinho no commit ou no rollback, sem caminho de vazamento.
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 53) then
    raise exception 'HOTFIX-0019: outra transacao ja detem a trava deste hotfix (2026,53). Nada foi aplicado.'
      using errcode = '55P03';
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 2. TETO POR COMANDO
-- ---------------------------------------------------------------------------------------------------
-- `lock_timeout` aborta CADA espera por lock que passe de 2 s. Não é teto da janela inteira.
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
-- `'farm_transfer'` nova no meio da reconciliação, depois de ela já ter sido apagada. Lock de linha não
-- alcança uma linha que ainda não existe; só o lock de TABELA alcança.
--
-- `erp.warehouse_transfers` em SHARE: a reconciliação da seção 6 compara `last_value` com
-- `max(code::bigint)`, e essa comparação só vale se ninguém inserir transferência no meio do caminho.
-- SHARE bloqueia INSERT/UPDATE/DELETE e continua permitindo leitura — é o mínimo que torna `max(code)`
-- estável, e é tudo que se precisa, porque esta migration NÃO escreve em `erp.warehouse_transfers`.
--
-- 3.1 AS RELAÇÕES EXISTEM — conferido ANTES do `lock table`, e só por causa da MENSAGEM: `lock table`
-- numa relação inexistente falha com o erro genérico do Postgres, que não diz ao operador nada sobre
-- esta fatia. Não abre TOCTOU: o check só lê catálogo, e se a relação sumir entre o check e o lock, o
-- lock falha — como falharia hoje.
do $$
begin
  if to_regclass('erp.code_sequences') is null then
    raise exception 'HOTFIX-0019: erp.code_sequences nao existe. Nao ha contador para reconciliar.';
  end if;
  if to_regclass('erp.warehouse_transfers') is null then
    raise exception 'HOTFIX-0019: erp.warehouse_transfers nao existe. Sem a tabela nao ha acervo para conferir.';
  end if;
end $$;

lock table erp.code_sequences in access exclusive mode nowait;
lock table erp.warehouse_transfers in share mode nowait;


-- ---------------------------------------------------------------------------------------------------
-- 4. PRÉ-CONDIÇÕES ESTRUTURAIS — o mundo é o que esta migration supõe?
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  pk text[];
  n int;
begin
  -- 4.1 A PK de code_sequences é o que faz "duas chaves = dois contadores". Se ela mudar, toda a
  -- premissa desta migration muda junto, e reconciliar por (organization_id, entity) deixa de fazer
  -- sentido.
  select array_agg(a.attname order by k.ord)
    into pk
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'erp.code_sequences'::regclass and c.contype = 'p';

  if pk is distinct from array['organization_id','entity'] then
    raise exception 'HOTFIX-0019: a PK de erp.code_sequences e [%], esperada [organization_id,entity]. Nada foi aplicado.',
      coalesce(array_to_string(pk, ','), '<sem PK>');
  end if;

  -- 4.2 A função que esta migration substitui precisa existir com a assinatura esperada. Substituir
  -- uma assinatura diferente criaria uma SOBRECARGA nova em vez de trocar o corpo, e o alias nunca
  -- entraria em vigor — falha silenciosa exatamente do tipo que este arquivo recusa.
  -- Comparação por TIPO, não por texto: `pg_get_function_identity_arguments` devolve os NOMES dos
  -- parâmetros junto ("p_org uuid, p_entity text"), então casar string quebraria numa renomeação de
  -- parâmetro que não muda assinatura nenhuma. `proargtypes` é o que de fato identifica a função.
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'erp' and p.proname = 'next_code'
    and p.pronargs = 2
    and p.proargtypes[0] = 'uuid'::regtype
    and p.proargtypes[1] = 'text'::regtype;
  if n <> 1 then
    raise exception 'HOTFIX-0019: esperava exatamente 1 erp.next_code(uuid, text), encontrei %. '
                    'Substituir assinatura diferente criaria SOBRECARGA em vez de trocar o corpo, e o alias '
                    'nunca entraria em vigor. Nada foi aplicado.', n;
  end if;

  -- 4.3 A unicidade que dá sentido ao contador único. Se ela incluísse `kind`, dois contadores seriam
  -- CORRETOS e este hotfix estaria errado — então isto não é formalidade: é a premissa central.
  select count(*) into n
  from pg_constraint c
  where c.conrelid = 'erp.warehouse_transfers'::regclass
    and c.contype = 'u'
    and pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, code)';
  if n <> 1 then
    raise exception 'HOTFIX-0019: erp.warehouse_transfers nao tem exatamente 1 UNIQUE (organization_id, code) (encontrei %). '
                    'Um contador unico so e correto se o namespace de unicidade for esse. Nada foi aplicado.', n;
  end if;

  -- 4.4 As colunas que a reconciliação lê.
  select count(*) into n
  from information_schema.columns
  where table_schema = 'erp' and table_name = 'warehouse_transfers'
    and column_name in ('organization_id','code','kind');
  if n <> 3 then
    raise exception 'HOTFIX-0019: erp.warehouse_transfers nao tem as 3 colunas esperadas (organization_id, code, kind); encontrei %.', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 5. PRÉ-CONDIÇÕES DE DADO — fail-closed, e NUNCA corretivas
-- ---------------------------------------------------------------------------------------------------
do $$
declare n int; amostra text;
begin
  -- 5.1 Contador negativo é estado impossível: a correção é humana, não automática.
  select count(*), coalesce(string_agg(distinct entity, ','), '')
    into n, amostra
  from erp.code_sequences
  where entity in ('warehouse_transfer','farm_transfer') and last_value < 0;
  if n > 0 then
    raise exception 'HOTFIX-0019: % contador(es) [%] com last_value negativo. Estado impossivel; a correcao e humana. Nada foi aplicado.', n, amostra;
  end if;

  -- 5.2 Duplicidade em (organization_id, code) não pode existir — a UNIQUE a impede. Se existir, o
  -- schema não é o que a seção 4.3 conferiu, e reconciliar por cima seria construir sobre areia.
  select count(*) into n
  from (select organization_id, code from erp.warehouse_transfers group by 1,2 having count(*) > 1) d;
  if n > 0 then
    raise exception 'HOTFIX-0019: % par(es) (organization_id, code) duplicado(s) em erp.warehouse_transfers. Nada foi aplicado.', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 6. RECONCILIAÇÃO — o contador canônico passa a cobrir tudo que já foi emitido
-- ---------------------------------------------------------------------------------------------------
-- O baseline de cada organização é o MAIOR entre três coisas, e as três precisam entrar:
--
--   canonical.last_value   o que o contador canônico já emitiu;
--   legacy.last_value      o que o contador legado já emitiu — some como LINHA, não como HISTÓRICO;
--   max(code::bigint)      o que o ACERVO já ocupa, que é a única autoridade sobre o que colide.
--
-- Deixar o acervo de fora é o erro clássico: os dois contadores podem estar atrás do maior código já
-- gravado (restauração parcial, importação, correção manual), e aí o contador "reconciliado" emitiria
-- um número que já existe. `max(code)` é o piso real.
--
-- CÓDIGO NÃO NUMÉRICO é ignorado no `max` de propósito, e isso é seguro: `erp.next_code` só produz
-- dígitos (`nextCode` faz `padStart`), então um código não numérico jamais colide com um código gerado.
-- Ele continua ocupando o namespace e continua intocado — esta migration não reescreve código nenhum.
--
-- O conjunto de organizações é a UNIÃO de quem tem transferência, contador canônico ou contador legado.
-- Organização sem nada dos três não ganha linha: contador só nasce quando o primeiro documento nasce,
-- que é o comportamento de `erp.next_code` e não é assunto deste hotfix.
do $$
declare
  acervo_antes text;
  acervo_depois text;
  outros_antes text;
  outros_depois text;
  legadas_esperadas int;
  legadas_apagadas int;
  reconciliadas int;
  rebanho_reconciliado int;
begin
  -- FOTOGRAFIA. Duas provas de preservação, tiradas ANTES de qualquer escrita e conferidas depois:
  -- o acervo inteiro (nenhum documento renumerado) e os contadores das OUTRAS entidades (o alias e a
  -- reconciliação não podem tocar `product`, `person`, `title_payable`, ...).
  select md5(coalesce(string_agg(organization_id::text || '|' || code, ',' order by organization_id, code), ''))
    into acervo_antes from erp.warehouse_transfers;

  -- As entidades que esta migration NÃO pode tocar. As três do hotfix ficam de fora da fotografia por
  -- construção: `warehouse_transfer` e `animal_farm_transfer` sobem, `farm_transfer` desaparece. Qualquer
  -- outra que se mexa é defeito.
  select md5(coalesce(string_agg(organization_id::text || '|' || entity || '|' || last_value::text, ',' order by organization_id, entity), ''))
    into outros_antes from erp.code_sequences
   where entity not in ('warehouse_transfer','farm_transfer','animal_farm_transfer');

  select count(*) into legadas_esperadas from erp.code_sequences where entity = 'farm_transfer';

  -- 6.1 UPSERT do contador canônico no baseline. `GREATEST` com `coalesce` em cada parcela: nenhuma das
  -- três pode ser NULL silenciosamente, e o resultado nunca DESCE — inclui o próprio valor canônico.
  with alvo as (
    select organization_id from erp.warehouse_transfers
    union
    select organization_id from erp.code_sequences where entity in ('warehouse_transfer','farm_transfer')
  ),
  baseline as (
    select
      a.organization_id,
      greatest(
        coalesce((select cs.last_value from erp.code_sequences cs
                   where cs.organization_id = a.organization_id and cs.entity = 'warehouse_transfer'), 0),
        coalesce((select cs.last_value from erp.code_sequences cs
                   where cs.organization_id = a.organization_id and cs.entity = 'farm_transfer'), 0),
        coalesce((select max(wt.code::bigint) from erp.warehouse_transfers wt
                   where wt.organization_id = a.organization_id and wt.code ~ '^[0-9]+$'), 0)
      ) as novo_last_value
    from alvo a
  )
  -- `b.` obrigatório: com `on conflict do update`, a tabela-alvo entra no escopo do SELECT e
  -- `organization_id` sozinho fica ambíguo entre `baseline` e `erp.code_sequences`.
  insert into erp.code_sequences (organization_id, entity, last_value)
  select b.organization_id, 'warehouse_transfer', b.novo_last_value from baseline b
  on conflict (organization_id, entity) do update
    set last_value = greatest(erp.code_sequences.last_value, excluded.last_value);
  get diagnostics reconciliadas = row_count;

  -- 6.2 A OUTRA METADE DO HISTÓRICO COMPARTILHADO: o contador da TRANSFERÊNCIA DE REBANHO.
  --
  -- `erp.animal_movements` tem namespace próprio (`unique (organization_id, movement_type, code)`) e
  -- numerava com a MESMA chave legada. Se ela apenas sumisse, a rota de rebanho passaria a depender do
  -- alias — isto é, do contador de ESTOQUE — e as duas numerações se intercalariam para sempre.
  --
  -- O baseline é o maior entre o que a chave legada já emitiu e o que o acervo DE REBANHO já ocupa. O
  -- `max` é restrito a `movement_type = 'farm_transfer'` porque é esse o namespace: os outros tipos têm
  -- contadores próprios (`animal_batch_transfer`, `evolution`, ...) e não são assunto desta migration.
  --
  -- `on conflict do update ... greatest` e não `insert` puro: se a chave canônica do rebanho já existir
  -- (banco que recebeu a 0019 e voltou atrás, ou binário novo que já a criou), o valor só pode SUBIR.
  with alvo as (
    select organization_id from erp.code_sequences where entity in ('farm_transfer','animal_farm_transfer')
    union
    select organization_id from erp.animal_movements where movement_type = 'farm_transfer'
  ),
  baseline as (
    select
      a.organization_id,
      greatest(
        coalesce((select cs.last_value from erp.code_sequences cs
                   where cs.organization_id = a.organization_id and cs.entity = 'animal_farm_transfer'), 0),
        coalesce((select cs.last_value from erp.code_sequences cs
                   where cs.organization_id = a.organization_id and cs.entity = 'farm_transfer'), 0),
        coalesce((select max(am.code::bigint) from erp.animal_movements am
                   where am.organization_id = a.organization_id
                     and am.movement_type = 'farm_transfer' and am.code ~ '^[0-9]+$'), 0)
      ) as novo_last_value
    from alvo a
  )
  insert into erp.code_sequences (organization_id, entity, last_value)
  select b.organization_id, 'animal_farm_transfer', b.novo_last_value from baseline b
  on conflict (organization_id, entity) do update
    set last_value = greatest(erp.code_sequences.last_value, excluded.last_value);
  get diagnostics rebanho_reconciliado = row_count;

  -- 6.3 A chave legada deixa de existir como LINHA. O histórico dela já foi absorvido nas DUAS chaves
  -- canônicas (6.1 e 6.2), e o alias da seção 7 garante que nenhum binário a recrie.
  delete from erp.code_sequences where entity = 'farm_transfer';
  get diagnostics legadas_apagadas = row_count;

  if legadas_apagadas <> legadas_esperadas then
    raise exception 'HOTFIX-0019: apaguei % linha(s) farm_transfer, esperava %. Nada foi aplicado.', legadas_apagadas, legadas_esperadas;
  end if;

  -- 6.4 PROVA DE PRESERVAÇÃO — as duas fotografias, conferidas no MESMO escopo transacional.
  select md5(coalesce(string_agg(organization_id::text || '|' || code, ',' order by organization_id, code), ''))
    into acervo_depois from erp.warehouse_transfers;
  if acervo_depois is distinct from acervo_antes then
    raise exception 'HOTFIX-0019: o acervo de warehouse_transfers MUDOU durante a reconciliacao. Nenhum documento pode ser renumerado. Nada foi aplicado.';
  end if;

  select md5(coalesce(string_agg(organization_id::text || '|' || entity || '|' || last_value::text, ',' order by organization_id, entity), ''))
    into outros_depois from erp.code_sequences
   where entity not in ('warehouse_transfer','farm_transfer','animal_farm_transfer');
  if outros_depois is distinct from outros_antes then
    raise exception 'HOTFIX-0019: contador(es) de OUTRAS entidades mudaram. Somente warehouse_transfer/farm_transfer/animal_farm_transfer podem ser tocados. Nada foi aplicado.';
  end if;

  raise notice 'HOTFIX-0019: % organizacao(oes) com contador de estoque reconciliado, % com contador de rebanho reconciliado, % linha(s) farm_transfer removida(s).', reconciliadas, rebanho_reconciliado, legadas_apagadas;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 7. COMPATIBILIDADE TEMPORAL — `farm_transfer` vira ALIAS, não contador
-- ---------------------------------------------------------------------------------------------------
-- Uma linha a mais no corpo, e ela é a razão de este hotfix dispensar janela operacional. Todo o resto
-- da função é IDÊNTICO ao da 0001: mesma semântica para as outras 20 entidades, mesmo `on conflict`,
-- mesmo retorno. O `erp.code_sequences` continua qualificado com schema, então nenhuma manipulação de
-- `search_path` redireciona a escrita.
--
-- O alias é o que impede a chave legada de RESSUSCITAR: com ele, `next_code(org,'farm_transfer')` nunca
-- insere `farm_transfer` — reescreve para a canônica antes do `insert`. Sem ele, o primeiro pedido do
-- binário BASE depois da seção 6 recriaria a linha começando em 1, sobre um acervo já numerado.
create or replace function erp.next_code(p_org uuid, p_entity text) returns bigint language plpgsql as $$
declare
  v bigint;
  e text;
begin
  -- HOTFIX-0019: `farm_transfer` foi absorvido pelo contador canônico da tabela. Aceitar a chave antiga
  -- mantém o binário anterior correto durante o rolling deploy e no rollback de binário.
  e := case when p_entity = 'farm_transfer' then 'warehouse_transfer' else p_entity end;

  insert into erp.code_sequences (organization_id, entity, last_value) values (p_org, e, 1)
  on conflict (organization_id, entity) do update set last_value = erp.code_sequences.last_value + 1
  returning last_value into v;
  return v;
end $$;


-- ---------------------------------------------------------------------------------------------------
-- 8. PÓS-CONDIÇÕES — o estado final é o prometido, e o alias funciona de verdade
-- ---------------------------------------------------------------------------------------------------
do $$
declare n int; amostra text; v1 bigint; v2 bigint; org_teste uuid; valor_antes bigint; valor_depois bigint;
begin
  -- 8.1 Zero linhas legadas.
  select count(*) into n from erp.code_sequences where entity = 'farm_transfer';
  if n > 0 then
    raise exception 'HOTFIX-0019: sobraram % linha(s) entity=''farm_transfer'' depois da reconciliacao.', n;
  end if;

  -- 8.2 No máximo uma linha canônica por organização (a PK já garante; a asserção documenta a invariante).
  select count(*) into n
  from (select organization_id from erp.code_sequences where entity = 'warehouse_transfer'
        group by 1 having count(*) > 1) d;
  if n > 0 then
    raise exception 'HOTFIX-0019: % organizacao(oes) com mais de uma linha canonica. Estado impossivel.', n;
  end if;

  -- 8.3 O contador canônico cobre o acervo. Esta é a asserção que impede o defeito de voltar pela porta
  -- de trás: contador abaixo do maior código já emitido significa 409 na próxima criação.
  -- `a.` obrigatório: o join traz `cs.organization_id` para o escopo e o nome sozinho fica ambíguo.
  select count(*), coalesce(string_agg(a.organization_id::text, ','), '')
    into n, amostra
  from (
    select wt.organization_id, max(wt.code::bigint) as maior
    from erp.warehouse_transfers wt
    where wt.code ~ '^[0-9]+$'
    group by wt.organization_id
  ) a
  left join erp.code_sequences cs
    on cs.organization_id = a.organization_id and cs.entity = 'warehouse_transfer'
  where coalesce(cs.last_value, -1) < a.maior;
  if n > 0 then
    raise exception 'HOTFIX-0019: % organizacao(oes) [%] com contador canonico ABAIXO do maior codigo existente. A proxima criacao colidiria.', n, amostra;
  end if;

  -- 8.4 O CONTADOR DO REBANHO COBRE O ACERVO DO REBANHO.
  -- Espelho exato da 8.3, para a outra tabela que dividia a chave legada. Sem esta asserção, a divisão da
  -- seção 6.2 poderia deixar o contador do rebanho ATRÁS dos códigos que ele próprio já emitiu, e a
  -- próxima transferência de rebanho morreria em `unique (organization_id, movement_type, code)`.
  select count(*), coalesce(string_agg(a.organization_id::text, ','), '')
    into n, amostra
  from (
    select am.organization_id, max(am.code::bigint) as maior
    from erp.animal_movements am
    where am.movement_type = 'farm_transfer' and am.code ~ '^[0-9]+$'
    group by am.organization_id
  ) a
  left join erp.code_sequences cs
    on cs.organization_id = a.organization_id and cs.entity = 'animal_farm_transfer'
  where coalesce(cs.last_value, -1) < a.maior;
  if n > 0 then
    raise exception 'HOTFIX-0019: % organizacao(oes) [%] com contador de rebanho ABAIXO do maior codigo de transferencia de rebanho existente. A proxima criacao colidiria.', n, amostra;
  end if;

  -- 8.5 O ALIAS NAO CAPTUROU O CONTADOR DO REBANHO. A chave canonica do rebanho existe onde havia
  -- historico, e ela e uma LINHA PROPRIA — nao um apelido para a de estoque.
  select count(*) into n
  from erp.animal_movements am
  where am.movement_type = 'farm_transfer'
    and not exists (select 1 from erp.code_sequences cs
                     where cs.organization_id = am.organization_id and cs.entity = 'animal_farm_transfer');
  if n > 0 then
    raise exception 'HOTFIX-0019: existe transferencia de rebanho sem contador canonico proprio (% movimento(s)). A divisao da secao 6.2 nao alcancou essas organizacoes.', n;
  end if;

  -- 8.6 O ALIAS FUNCIONA — e isto é provado EXECUTANDO, não lendo o catálogo.
  --
  -- Por que executar: uma `create or replace` que criasse sobrecarga em vez de substituir (seção 4.2
  -- existe para impedir), ou um corpo com o `case` invertido, passariam por qualquer conferência que só
  -- olhasse `pg_proc`. O que precisa ser verdade é COMPORTAMENTAL: pedir a chave antiga e a nova tem de
  -- mexer no MESMO contador, e a chave antiga não pode nascer como linha.
  --
  -- POR QUE NUMA ORGANIZAÇÃO REAL, E POR QUE ISSO NÃO DEIXA RASTRO. `erp.code_sequences` TEM chave
  -- estrangeira para `erp.organizations` (`code_sequences_organization_id_fkey`), então um UUID
  -- sintético não serve: o `insert` de dentro de `erp.next_code` morreria na FK e derrubaria a
  -- migration inteira por um artefato do próprio teste.
  --
  -- A alocação é feita numa organização existente e desfeita por SUBTRANSAÇÃO: o bloco interno aloca,
  -- mede, e então levanta um erro de código próprio (`ZZ019`) só para forçar o rollback do subbloco. O
  -- `exception when sqlstate 'ZZ019'` o captura, e o PL/pgSQL desfaz as ESCRITAS do bloco sem desfazer
  -- as VARIÁVEIS — `v1`, `v2` e `n` são memória, não linha, e sobrevivem para serem asseridos aqui
  -- fora. Qualquer outro erro NÃO casa com o handler e continua propagando, que é o que mantém a
  -- migration fail-closed. Depois a 8.7 confere que o contador real voltou exatamente ao valor de
  -- antes: a prova do alias não pode consumir número de ninguém.
  select cs_org.id into org_teste from erp.organizations cs_org order by cs_org.id limit 1;

  if org_teste is null then
    -- Banco recém-criado, sem nenhuma organização: não há onde alocar sem violar a FK, e inventar uma
    -- organização para testar seria a migration escrevendo dado de negócio. A prova comportamental do
    -- alias nesse caso é a de `packages/db/test/hotfix-0019-upgrade.test.ts`, que semeia as próprias.
    raise notice 'HOTFIX-0019: nenhuma organizacao no banco; a prova em linha do alias foi PULADA (a suite hotfix-0019-upgrade a cobre semeando organizacao).';
  else
    select last_value into valor_antes
    from erp.code_sequences where organization_id = org_teste and entity = 'warehouse_transfer';

    begin
      v1 := erp.next_code(org_teste, 'warehouse_transfer');
      v2 := erp.next_code(org_teste, 'farm_transfer');   -- DEVE continuar a MESMA sequência: v1 + 1
      select count(*) into n
      from erp.code_sequences where organization_id = org_teste and entity = 'farm_transfer';
      raise exception 'HOTFIX-0019: desfazendo a prova do alias (esperado, nunca escapa deste bloco).'
        using errcode = 'ZZ019';
    exception when sqlstate 'ZZ019' then
      -- As duas alocações acabam de ser desfeitas. `v1`, `v2` e `n` permanecem: são memória.
      null;
    end;

    if v1 is null or v2 is null then
      raise exception 'HOTFIX-0019: a prova do alias nao chegou a medir (v1=%, v2=%). Assercao vazia e reprovacao.', v1, v2;
    end if;

    if v2 <> v1 + 1 then
      raise exception 'HOTFIX-0019: o alias NAO esta em vigor. next_code(warehouse_transfer)=% e next_code(farm_transfer)=%, '
                      'esperado %. As duas chaves precisam compartilhar o contador canonico.', v1, v2, v1 + 1;
    end if;

    if n > 0 then
      raise exception 'HOTFIX-0019: pedir farm_transfer RECRIOU a linha legada. O alias precisa reescrever a chave ANTES do insert.';
    end if;

    -- 8.7 A PROVA NÃO DEIXOU RASTRO. Se o subbloco não tivesse sido desfeito, o contador da organização
    -- teria avançado duas casas — e uma migration que consome número de documento é, ela própria, um
    -- defeito de numeração.
    select last_value into valor_depois
    from erp.code_sequences where organization_id = org_teste and entity = 'warehouse_transfer';
    if valor_depois is distinct from valor_antes then
      raise exception 'HOTFIX-0019: a prova do alias avancou o contador real da organizacao (% -> %). O subbloco deveria ter sido desfeito.',
        coalesce(valor_antes::text, '<sem linha>'), coalesce(valor_depois::text, '<sem linha>');
    end if;
  end if;
end $$;
