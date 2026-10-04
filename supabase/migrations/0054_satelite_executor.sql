-- =====================================================================
-- 0054 SAT-03 — EXECUTOR DA FILA SATELITAL (reserva, contagem do limite global e ledger com PU desconhecido) — decisão 296
--
-- O QUE ESTA MIGRATION FAZ. Dá ao executor da fila da SAT-02 (0053) o que ele precisa do BANCO, e nada além:
--
--   erp.satelite_consumo          o ledger passa a aceitar a chamada COBRADA cujo PU não foi lido: pu_gasto e creditos
--                                 ficam ANULÁVEIS, sempre JUNTOS (CHECK de par), e a linha sem PU exige origem_cabecalho
--                                 preenchido — o motivo que a API grava ('cabecalho_ausente' ou 'cabecalho_invalido').
--                                 Uma chamada que o provedor respondeu (2xx) gastou mesmo sem o cabeçalho: ela entra no
--                                 ledger (e conta no limite por minuto) com o crédito DESCONHECIDO, em vez de um zero
--                                 inventado (decisão B do Maike). chk_satelite_consumo_creditos (crédito = round(PU × 100, 2))
--                                 e chk_satelite_consumo_pu continuam: com o par nulo, passam (CHECK nulo passa). A
--                                 imutabilidade (gatilhos de linha e de comando da 0053) não muda.
--   erp.satelite_consulta_itens   coluna nova tentativas_rodada (integer not null default 0): as tentativas desde a última
--                                 abertura de rodada — o "reprocessar falhas" zera, o executor para em 3 por rodada.
--                                 tentativas continua o HISTÓRICO (nunca volta). CHECK 0 <= tentativas_rodada <= tentativas.
--   erp.satelite_reservar_itens   porta estreita SECURITY DEFINER do executor (abaixo): reserva os próximos itens da fila
--                                 dentro dos três tetos de chamada, só de criador que AINDA tem acesso.
--   erp.satelite_contar_chamadas  porta estreita SECURITY DEFINER da rota avulsa da SAT-01: só os quatro números do limite.
--   ix_satelite_consumo_recente   índice (created_at) include (organization_id) do ledger: a contagem do ÚLTIMO MINUTO, global
--                                 e por organização, sai de uma faixa curta do índice. Sem ele, cada reserva e cada pedido
--                                 avulso varreriam o ledger inteiro — que só cresce (ix_satelite_consumo_mes começa pela
--                                 organização e não serve à contagem global).
--
-- NÃO TOCA em erp.satelite_consultas (contadores e situação são do executor, sob RLS), na política de nenhuma tabela, em
-- erp.analises_satelitais nem nos gatilhos da 0053.
--
-- A RESERVA — erp.satelite_reservar_itens(p_limite, p_max_simultaneas, p_max_minuto_conta, p_max_minuto_org, p_prazo_segundos).
--   · UMA RESERVA POR VEZ na fila inteira: pg_try_advisory_xact_lock(2026, 88001). Não obteve (outra réplica está
--     reservando agora) → devolve VAZIO, sem esperar. A chave é a trava desta migration (88) × 1000 + 1: fica no espaço
--     de duas chaves (2026, n) das migrations, onde as travas reservadas são números pequenos e sequenciais (51..88 até
--     aqui), então não colide com trava de migration nenhuma; e não colide com o espaço de UMA chave bigint
--     (pg_advisory_xact_lock(hashtext(...)) do GO-LIVE-01), que o PostgreSQL guarda separado. É de TRANSAÇÃO: solta no
--     commit da transação curta do executor.
--   · RECUPERA os vencidos: item 'executando' com o prazo passado (proxima_tentativa_em < now()) volta para 'pendente',
--     pronto já (proxima_tentativa_em nula) — a réplica que o reservou caiu no meio. Também o 'executando' SEM prazo
--     (nenhuma via grava isso; se aparecer, seguraria a vaga para sempre e trancaria a fila). tentativas e
--     tentativas_rodada NÃO mudam: a tentativa interrompida conta, e o executor confere o teto da rodada. FOR UPDATE SKIP
--     LOCKED: o vencido que a réplica viva ainda está gravando não é tocado nem esperado.
--   · CHAMADAS NO ÚLTIMO MINUTO = linhas do ledger com created_at > now() − 60 s + itens 'executando'. Global e por
--     organização (a do item). SIMULTÂNEAS = itens 'executando' na fila inteira. A MESMA conta de
--     erp.satelite_contar_chamadas.
--   · O LAÇO, até p_limite, enquanto executando < p_max_simultaneas e minuto da conta < p_max_minuto_conta: escolhe UM item
--     'pendente' vencido (proxima_tentativa_em nula ou passada), na ordem (created_at, id), FOR UPDATE OF i SKIP LOCKED
--     LIMIT 1, fora das organizações já no teto e das consultas sem acesso desta chamada. Organização no teto
--     (p_max_minuto_org) → a organização sai desta chamada e o laço segue. Criador sem acesso → a CONSULTA sai desta
--     chamada, o item fica 'pendente' (não conta, não gasta) e o laço segue. Senão: 'executando', tentativas + 1,
--     tentativas_rodada + 1, proxima_tentativa_em = now() + p_prazo_segundos (o PRAZO do executando), ROW COUNT conferido,
--     e a linha volta. Cada item candidato que não foi reservado (no máximo um por organização no teto e um por consulta
--     sem acesso) fica travado até o commit da mesma transação curta.
--   · ACESSO DO CRIADOR (fail-closed, o MESMO predicado da política tenant_e_empresa da 0053, sem segunda fonte de
--     verdade): com as GUCs trocadas para o criador — set_config LOCAL de app.org_id = organização do item,
--     app.user_id = criado_por da consulta e app.modulo_empresa = 'pecuaria' —, avalia
--       erp.tenant_visible(org) and (erp.escopo_empresa_total('pecuaria') or empresa in (select erp.empresas_do_membro('pecuaria')))
--     e devolve as três GUCs ao valor de ENTRADA logo em seguida (antes de travar ou gravar qualquer coisa). Uma GUC que
--     não existia na sessão volta como texto vazio — que erp.current_org_id, erp.current_user_id e
--     erp.modulo_empresa_atual leem como nulo, exatamente como antes. Erro no meio desfaz a (sub)transação, e a troca de
--     GUC é desfeita junto. O resultado é guardado por consulta (organização, empresa e criador são da consulta).
--   · Devolve SÓ (organization_id, empresa_id, consulta_id, item_id, criado_por). Sem SQL dinâmico.
--   · PARÂMETROS fora da faixa são erro de quem chama (configuração), nunca "nada a reservar" em silêncio: 22023 com o
--     nome do parâmetro — p_limite 1..50; p_max_simultaneas, p_max_minuto_conta e p_max_minuto_org >= 1; p_prazo_segundos
--     60..86400; nulo em qualquer um também. E a transação TEM de ser READ COMMITTED (25000 fora dela): a contagem sob a
--     trava precisa enxergar o que a reserva anterior acabou de gravar, e numa foto tirada antes ela não enxergaria.
--
-- QUEM EXECUTA. As duas portas: SÓ o dono e o erp_app. EXECUTE revogado de PUBLIC, e de qualquer outro papel que um
-- privilégio padrão tenha dado (laço aclexplode, nomes do catálogo); o grant ao erp_app é explícito. Nada para
-- authenticated nem anon. SECURITY DEFINER com search_path fixo (erp, pg_temp) e DONO QUE ATRAVESSA RLS (superusuário
-- ou BYPASSRLS — a pós-condição confere, como a da 0039): com a GUC vazia, um dono sujeito à RLS forçada não veria fila
-- nenhuma. A contagem toma a organização SÓ da GUC do servidor (erp.current_org_id()); sem GUC, os números da
-- organização são 0. Os números globais são do limite da CONTA, e a API não os devolve a ninguém.
--
-- PRODUÇÃO (decisões 240/247). NENHUMA linha é escrita, corrigida ou apagada. DROP NOT NULL é só catálogo; os dois
-- CHECKs novos do ledger leem a tabela sem regravá-la, e todo o acervo tem PU e crédito preenchidos — passa nos dois, não
-- tem como ser recusado; a coluna nova tem default CONSTANTE (só catálogo, as linhas existentes leem 0 sem regravar) e
-- 0 <= tentativas vale para todo item (CHECK da 0053) — não tem como recusar acervo. O índice novo só monta estrutura. As
-- duas funções nascem sem chamador: quem as chama é o executor da API desta fatia, que nasce DESLIGADO
-- (SATELITE_WORKER_ENABLED), e a rota da SAT-01 só passa a usar a contagem com o deploy da API. Até lá, nenhum item muda
-- de situação por causa desta migration.
--
-- TRAVAS DE TABELA E JANELA. Nenhuma FK nova (nenhuma tabela de terceiros é travada: organizations, empresas, users e
-- areas ficam livres). As funções e os privilégios não travam tabela; vêm PRIMEIRO. Por último, nas duas tabelas da 0053,
-- a FILA ANTES DO LEDGER:
--   · erp.satelite_consulta_itens — ACCESS EXCLUSIVE (add column com default constante: só catálogo; o CHECK inline da
--     coluna LÊ a tabela inteira para validar, sem regravar).
--   · erp.satelite_consumo — ACCESS EXCLUSIVE (alter column … drop not null: só catálogo; add constraint check: LÊ a tabela
--     inteira para validar, sem regravar), e o create index (SHARE, já coberto) lê e ordena a tabela.
--   As duas ficam com a trava até o commit: leitura e escrita delas (histórico e pedido da SAT-02) esperam esse tempo.
--   São tabelas PEQUENAS: o ledger nunca foi escrito em produção (antes desta fatia nenhuma rota grava consumo; a SAT-02
--   só o lê, para o orçamento) e a fila tem até 200 itens por consulta pedida desde a SAT-02. Volumes de produção NÃO
--   medidos: PENDING. A ORDEM importa: o POST da SAT-02 lê a fila (chaves vivas) e DEPOIS o ledger (saldo do mês) na
--   mesma transação; a migration trava na MESMA ordem, então um não fica segurando o que o outro espera (na ordem inversa
--   haveria impasse, e o detector abortaria um dos dois). Cada pedido de trava espera no máximo lock_timeout = 2 s; sem a
--   trava, a migration aborta inteira e o deploy para, sem nada aplicado. NÃO exige janela fora do pico (a escrita parada
--   dura o tempo de ler duas tabelas pequenas); fora do pico continua sendo a folga recomendada, não requisito.
--
-- VOLTA. O repositório é forward-only (sem arquivo de descida). O caminho inverso, provado em
-- packages/db/test/sat-03-0054.test.ts (constante SQL_REVERSO), é: dropar as duas funções, o índice novo, a coluna
-- tentativas_rodada e os dois CHECKs novos; devolver NOT NULL a creditos e pu_gasto; devolver os comentários da 0053; tirar
-- a 0054 do ledger. FAIL-CLOSED: se o ledger já tiver linha com o PU desconhecido (o que só a 0054 permite), o NOT NULL não
-- volta (23502) e a volta inteira para — o ledger é imutável, e o que fazer com essas linhas é decisão humana. A contagem
-- de tentativas por rodada se perde na volta (tentativas, o histórico, fica).
--
-- Trava (2026,88). lock_timeout 2s. O runner aplica o arquivo em UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 88) then
    raise exception 'SAT-03: outra transacao ja detem a trava desta migration (2026,88). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight (fail-closed: para antes de tocar em qualquer coisa) ----------
do $$
begin
  -- "Já aplicada" ANTES das dependências: na reaplicação, o motivo verdadeiro é este.
  if to_regprocedure('erp.satelite_reservar_itens(integer,integer,integer,integer,integer)') is not null
     or to_regprocedure('erp.satelite_contar_chamadas()') is not null
     or to_regclass('erp.ix_satelite_consumo_recente') is not null
     or exists (select 1 from pg_constraint
                 where conname in ('chk_satelite_consumo_pu_creditos_par', 'chk_satelite_consumo_pu_ou_origem', 'chk_satelite_consulta_itens_tentativas_rodada'))
     or exists (select 1 from information_schema.columns
                 where table_schema = 'erp' and table_name = 'satelite_consulta_itens' and column_name = 'tentativas_rodada')
     or exists (select 1 from information_schema.columns
                 where table_schema = 'erp' and table_name = 'satelite_consumo' and column_name in ('pu_gasto', 'creditos') and is_nullable = 'YES') then
    raise exception 'SAT-03: a 0054 ja foi aplicada ou ha schema divergente (satelite_reservar_itens/satelite_contar_chamadas/ix_satelite_consumo_recente/chk_satelite_consumo_pu_creditos_par/chk_satelite_consumo_pu_ou_origem/tentativas_rodada ja existe, ou pu_gasto/creditos do consumo ja anulavel).';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'SAT-03: papel erp_app ausente (0007); as portas novas nao teriam quem as executasse.';
  end if;
  -- O predicado do ACESSO DO CRIADOR chama as funções da RLS (0001/0007/0011/0015) com estas assinaturas.
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.escopo_empresa_total(text)') is null
     or to_regprocedure('erp.empresas_do_membro(text)') is null or to_regprocedure('erp.modulo_empresa_atual()') is null
     or to_regprocedure('erp.current_org_id()') is null or to_regprocedure('erp.current_user_id()') is null
     or to_regprocedure('erp.effective_user_id()') is null then
    raise exception 'SAT-03: funcoes de RLS ausentes (tenant_visible, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual, current_org_id, current_user_id, effective_user_id); a cadeia de migrations esta fora de ordem.';
  end if;
  -- A 0053: as três tabelas que a 0054 lê ou altera.
  if to_regclass('erp.satelite_consultas') is null or to_regclass('erp.satelite_consulta_itens') is null
     or to_regclass('erp.satelite_consumo') is null then
    raise exception 'SAT-03: erp.satelite_consultas, erp.satelite_consulta_itens ou erp.satelite_consumo ausente; aplique a 0053 (SAT-02) antes.';
  end if;
  -- O ledger como a 0053 o criou: PU e crédito obrigatórios nos tipos dela, o CHECK do crédito derivado e a imutabilidade.
  if (select count(*) from pg_attribute a
       where a.attrelid = 'erp.satelite_consumo'::regclass and not a.attisdropped and a.attnotnull
         and ((a.attname = 'pu_gasto' and format_type(a.atttypid, a.atttypmod) = 'numeric(14,4)')
           or (a.attname = 'creditos' and format_type(a.atttypid, a.atttypmod) = 'numeric(16,2)'))) <> 2
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'erp' and table_name = 'satelite_consumo' and column_name = 'origem_cabecalho' and data_type = 'text') then
    raise exception 'SAT-03: erp.satelite_consumo fora da forma da 0053 (pu_gasto numeric(14,4) e creditos numeric(16,2) obrigatorios, origem_cabecalho text); schema divergente.';
  end if;
  if (select count(*) from pg_constraint c
       where c.conrelid = 'erp.satelite_consumo'::regclass and c.contype = 'c' and c.convalidated
         and c.conname in ('chk_satelite_consumo_creditos', 'chk_satelite_consumo_pu')) <> 2 then
    raise exception 'SAT-03: CHECKs chk_satelite_consumo_creditos/chk_satelite_consumo_pu de erp.satelite_consumo ausentes (0053); schema divergente.';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O' and t.tgrelid = 'erp.satelite_consumo'::regclass
         and t.tgname in ('trg_satelite_consumo_imutavel', 'trg_satelite_consumo_imutavel_truncate')) <> 2 then
    raise exception 'SAT-03: imutabilidade de erp.satelite_consumo (gatilhos da 0053) ausente ou desligada; schema divergente.';
  end if;
  -- A fila como a 0053 a criou: as colunas que a reserva lê e grava, e as situações que ela usa.
  if (select count(*) from information_schema.columns
       where table_schema = 'erp' and table_name = 'satelite_consulta_itens' and is_nullable = 'NO'
         and column_name in ('id', 'consulta_id', 'organization_id', 'empresa_id', 'situacao', 'tentativas', 'created_at')) <> 7
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'erp' and table_name = 'satelite_consulta_itens' and column_name = 'proxima_tentativa_em'
                       and data_type = 'timestamp with time zone')
     or (select count(*) from information_schema.columns
          where table_schema = 'erp' and table_name = 'satelite_consultas' and is_nullable = 'NO'
            and column_name in ('id', 'organization_id', 'empresa_id', 'criado_por')) <> 4 then
    raise exception 'SAT-03: erp.satelite_consulta_itens ou erp.satelite_consultas fora da forma da 0053 (colunas da fila e criado_por da consulta); schema divergente.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conname = 'chk_satelite_consulta_itens_situacao' and c.conrelid = 'erp.satelite_consulta_itens'::regclass
                    and pg_get_constraintdef(c.oid) like '%''pendente''%' and pg_get_constraintdef(c.oid) like '%''executando''%')
     or not exists (select 1 from pg_constraint c
                     where c.conname = 'chk_satelite_consulta_itens_tentativas' and c.conrelid = 'erp.satelite_consulta_itens'::regclass) then
    raise exception 'SAT-03: CHECKs de situacao (pendente/executando) ou de tentativas de erp.satelite_consulta_itens ausentes (0053); schema divergente.';
  end if;
  -- O predicado do acesso do criador é o da política tenant_e_empresa da fila: ela tem de ser a da 0053 (a MESMA texto a
  -- texto da de erp.analises_satelitais, como a pós-condição da 0053 conferiu) e chamar as funções que a reserva chama.
  if not exists (
    select 1 from pg_policies p join pg_policies r
        on r.schemaname = 'erp' and r.tablename = 'analises_satelitais' and r.policyname = 'tenant_e_empresa'
     where p.schemaname = 'erp' and p.tablename = 'satelite_consulta_itens' and p.policyname = 'tenant_e_empresa'
       and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE' and p.qual = r.qual and p.with_check = r.with_check
       and position('tenant_visible(organization_id)' in p.qual) > 0 and position('escopo_empresa_total(' in p.qual) > 0
       and position('empresas_do_membro(' in p.qual) > 0 and position('modulo_empresa_atual()' in p.qual) > 0
  ) or (select count(*) from pg_policies where schemaname = 'erp' and tablename = 'satelite_consulta_itens') <> 1 then
    raise exception 'SAT-03: politica tenant_e_empresa de erp.satelite_consulta_itens fora da forma da 0053 (uma so, igual a de erp.analises_satelitais, com tenant_visible/escopo_empresa_total/empresas_do_membro/modulo_empresa_atual); o acesso do criador nao seria o mesmo predicado da RLS.';
  end if;
  if to_regclass('erp.modulos_escopo_empresa') is null
     or not exists (select 1 from erp.modulos_escopo_empresa where chave = 'pecuaria') then
    raise exception 'SAT-03: modulo de escopo empresarial pecuaria ausente (0011); o acesso do criador nao teria o modulo da area.';
  end if;
end $$;

-- ---------- 3) erp.satelite_reservar_itens — a porta estreita do executor (não trava tabela ao ser criada) ----------
create function erp.satelite_reservar_itens(
  p_limite integer, p_max_simultaneas integer, p_max_minuto_conta integer, p_max_minuto_org integer, p_prazo_segundos integer)
  returns table (organization_id uuid, empresa_id uuid, consulta_id uuid, item_id uuid, criado_por uuid)
language plpgsql volatile security definer set search_path = erp, pg_temp as $$
#variable_conflict use_column
declare
  v_org_entrada text;
  v_user_entrada text;
  v_modulo_entrada text;
  v_executando integer;
  v_minuto_ledger integer;
  v_minuto_org integer;
  v_reservados integer := 0;
  v_orgs_no_teto uuid[] := '{}';
  v_consultas_sem_acesso uuid[] := '{}';
  v_consultas_com_acesso uuid[] := '{}';
  v_acesso boolean;
  v_linhas integer;
  v_c record;
begin
  -- Parâmetro fora da faixa é erro de configuração de quem chama: nunca vira "nada a reservar" em silêncio.
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'SAT-03: p_limite fora da faixa 1..50 (recebido: %).', coalesce(p_limite::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_simultaneas is null or p_max_simultaneas < 1 then
    raise exception 'SAT-03: p_max_simultaneas precisa ser >= 1 (recebido: %).', coalesce(p_max_simultaneas::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_minuto_conta is null or p_max_minuto_conta < 1 then
    raise exception 'SAT-03: p_max_minuto_conta precisa ser >= 1 (recebido: %).', coalesce(p_max_minuto_conta::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_minuto_org is null or p_max_minuto_org < 1 then
    raise exception 'SAT-03: p_max_minuto_org precisa ser >= 1 (recebido: %).', coalesce(p_max_minuto_org::text, 'nulo') using errcode = '22023';
  end if;
  if p_prazo_segundos is null or p_prazo_segundos < 60 or p_prazo_segundos > 86400 then
    raise exception 'SAT-03: p_prazo_segundos fora da faixa 60..86400 (recebido: %).', coalesce(p_prazo_segundos::text, 'nulo') using errcode = '22023';
  end if;
  -- A contagem sob a trava tem de enxergar o que a reserva anterior acabou de gravar: foto por instrução.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'SAT-03: erp.satelite_reservar_itens exige READ COMMITTED (a transacao esta em %).', current_setting('transaction_isolation') using errcode = '25000';
  end if;

  -- Uma reserva por vez na fila inteira; outra réplica reservando agora → nada nesta rodada, sem esperar.
  if not pg_try_advisory_xact_lock(2026, 88001) then
    return;
  end if;

  -- Réplica que caiu no meio: o 'executando' vencido (ou sem prazo) volta para 'pendente', pronto já. As tentativas
  -- ficam (a interrompida conta). O vencido que outra transação está gravando agora não é tocado nem esperado.
  update erp.satelite_consulta_itens i
     set situacao = 'pendente', proxima_tentativa_em = null
   where i.situacao = 'executando'
     and i.id in (select v.id from erp.satelite_consulta_itens v
                   where v.situacao = 'executando' and (v.proxima_tentativa_em is null or v.proxima_tentativa_em < now())
                   for update skip locked);

  -- Chamadas no último minuto = ledger do último minuto + 'executando' (global aqui; por organização no laço).
  select count(*)::integer into v_executando from erp.satelite_consulta_itens x where x.situacao = 'executando';
  select count(*)::integer into v_minuto_ledger from erp.satelite_consumo s where s.created_at > now() - interval '60 seconds';

  v_org_entrada := current_setting('app.org_id', true);
  v_user_entrada := current_setting('app.user_id', true);
  v_modulo_entrada := current_setting('app.modulo_empresa', true);

  loop
    exit when v_reservados >= p_limite
           or v_executando >= p_max_simultaneas
           or v_minuto_ledger + v_executando >= p_max_minuto_conta;

    select i.id, i.organization_id, i.empresa_id, i.consulta_id, c.criado_por
      into v_c
      from erp.satelite_consulta_itens i
      join erp.satelite_consultas c
        on c.organization_id = i.organization_id and c.empresa_id = i.empresa_id and c.id = i.consulta_id
     where i.situacao = 'pendente'
       and (i.proxima_tentativa_em is null or i.proxima_tentativa_em <= now())
       and not (i.organization_id = any (v_orgs_no_teto))
       and not (i.consulta_id = any (v_consultas_sem_acesso))
     order by i.created_at, i.id
     limit 1
     for update of i skip locked;
    exit when not found;

    -- Teto por organização: a organização sai desta chamada; o laço segue com as outras.
    select ((select count(*) from erp.satelite_consumo s
              where s.organization_id = v_c.organization_id and s.created_at > now() - interval '60 seconds')
          + (select count(*) from erp.satelite_consulta_itens x
              where x.organization_id = v_c.organization_id and x.situacao = 'executando'))::integer
      into v_minuto_org;
    if v_minuto_org >= p_max_minuto_org then
      v_orgs_no_teto := v_orgs_no_teto || v_c.organization_id;
      continue;
    end if;

    -- Acesso do criador: o predicado da política tenant_e_empresa, com as GUCs do criador; as de entrada voltam já.
    if not (v_c.consulta_id = any (v_consultas_com_acesso)) then
      perform set_config('app.org_id', v_c.organization_id::text, true),
              set_config('app.user_id', v_c.criado_por::text, true),
              set_config('app.modulo_empresa', 'pecuaria', true);
      v_acesso := coalesce(erp.tenant_visible(v_c.organization_id)
                           and (erp.escopo_empresa_total('pecuaria')
                                or v_c.empresa_id in (select erp.empresas_do_membro('pecuaria'))), false);
      perform set_config('app.org_id', coalesce(v_org_entrada, ''), true),
              set_config('app.user_id', coalesce(v_user_entrada, ''), true),
              set_config('app.modulo_empresa', coalesce(v_modulo_entrada, ''), true);
      if not v_acesso then
        v_consultas_sem_acesso := v_consultas_sem_acesso || v_c.consulta_id;
        continue;
      end if;
      v_consultas_com_acesso := v_consultas_com_acesso || v_c.consulta_id;
    end if;

    update erp.satelite_consulta_itens i
       set situacao = 'executando',
           tentativas = i.tentativas + 1,
           tentativas_rodada = i.tentativas_rodada + 1,
           proxima_tentativa_em = now() + p_prazo_segundos * interval '1 second'
     where i.id = v_c.id and i.situacao = 'pendente';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 1 then
      raise exception 'SAT-03: o item % travado pela reserva nao foi marcado como executando (% linhas); nada desta rodada foi gravado.', v_c.id, v_linhas;
    end if;

    v_executando := v_executando + 1;
    v_reservados := v_reservados + 1;
    organization_id := v_c.organization_id;
    empresa_id := v_c.empresa_id;
    consulta_id := v_c.consulta_id;
    item_id := v_c.id;
    criado_por := v_c.criado_por;
    return next;
  end loop;
end $$;

comment on function erp.satelite_reservar_itens(integer, integer, integer, integer, integer) is
  'SAT-03 (decisão 296): porta estreita do executor da fila satelital. Uma reserva por vez (advisory lock de transação (2026, 88001); ocupado → vazio); devolve a "executando" o vencido (sem mudar tentativas); reserva até p_limite itens pendentes vencidos, em ordem (created_at, id), FOR UPDATE SKIP LOCKED, dentro dos tetos de simultâneas, de chamadas por minuto na conta e por organização (ledger do último minuto + executando), só de criador que ainda passa no predicado da política tenant_e_empresa (GUCs do criador, devolvidas ao valor de entrada). Marca executando, tentativas + 1, tentativas_rodada + 1 e o prazo. Devolve só organização, empresa, consulta, item e criador. Só o erp_app executa.';

-- ---------- 4) erp.satelite_contar_chamadas — a porta estreita da rota avulsa da SAT-01 ----------
create function erp.satelite_contar_chamadas()
  returns table (conta_minuto integer, conta_executando integer, org_minuto integer, org_executando integer)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
begin
  return query
  select (select count(*) from erp.satelite_consumo s where s.created_at > now() - interval '60 seconds')::integer,
         (select count(*) from erp.satelite_consulta_itens i where i.situacao = 'executando')::integer,
         (case when v_org is null then 0
               else (select count(*) from erp.satelite_consumo s
                      where s.organization_id = v_org and s.created_at > now() - interval '60 seconds') end)::integer,
         (case when v_org is null then 0
               else (select count(*) from erp.satelite_consulta_itens i
                      where i.organization_id = v_org and i.situacao = 'executando') end)::integer;
end $$;

comment on function erp.satelite_contar_chamadas() is
  'SAT-03 (decisão 296): porta estreita do limite global da rota avulsa da SAT-01. Só números: chamadas no último minuto (linhas do ledger com created_at > now() − 60 s) e itens executando, na conta inteira e na organização da GUC do servidor (sem GUC, os da organização são 0). Só o erp_app executa.';

-- ---------- 5) privilégios das duas portas: o dono e o erp_app, e só ----------
-- PUBLIC executa função nova por padrão, e a 0007 dá EXECUTE ao erp_app por privilégio padrão; outro privilégio padrão
-- (de outro papel) também alcançaria a função nova. Tira-se de todos (o laço da 0040/0043; os nomes vêm do catálogo,
-- nada de entrada de usuário) e devolve-se só ao erp_app, explicitamente.
revoke execute on function erp.satelite_reservar_itens(integer, integer, integer, integer, integer) from public;
revoke execute on function erp.satelite_contar_chamadas() from public;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('satelite_reservar_itens', 'satelite_contar_chamadas')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;
grant execute on function erp.satelite_reservar_itens(integer, integer, integer, integer, integer) to erp_app;
grant execute on function erp.satelite_contar_chamadas() to erp_app;

-- ---------- 6) POR ÚLTIMO: as duas tabelas da 0053 (ACCESS EXCLUSIVE até o commit; ver o cabeçalho) ----------
-- A FILA PRIMEIRO, o ledger depois: a mesma ordem do POST da SAT-02 (lê a fila e depois o ledger na mesma transação).
-- Na ordem inversa, a migration segurando o ledger e esperando a fila, e o POST segurando a fila e esperando o
-- ledger, fariam um impasse.
-- 6.1 As tentativas da rodada. Default CONSTANTE: só catálogo (as linhas existentes leem 0); o CHECK lê a tabela.
alter table erp.satelite_consulta_itens add column tentativas_rodada integer not null default 0
  constraint chk_satelite_consulta_itens_tentativas_rodada check (tentativas_rodada >= 0 and tentativas_rodada <= tentativas);

comment on column erp.satelite_consulta_itens.tentativas is 'Tentativas feitas pelo executor, em todas as rodadas (o histórico: nunca volta).';
comment on column erp.satelite_consulta_itens.tentativas_rodada is 'Tentativas desde a última abertura de rodada (o "reprocessar falhas" zera; o executor para no teto da rodada). Nunca maior que tentativas.';

-- 6.2 O ledger com PU desconhecido. Uma instrução por ação (é a forma que scripts/lib/schema.mjs modela).
alter table erp.satelite_consumo alter column pu_gasto drop not null;
alter table erp.satelite_consumo alter column creditos drop not null;
-- PU e crédito andam JUNTOS: os dois preenchidos (o crédito derivado do PU, chk_satelite_consumo_creditos) ou os dois nulos.
alter table erp.satelite_consumo add constraint chk_satelite_consumo_pu_creditos_par check ((pu_gasto is null) = (creditos is null));
-- Sem PU, o motivo fica escrito: origem_cabecalho não nulo e não em branco.
alter table erp.satelite_consumo add constraint chk_satelite_consumo_pu_ou_origem
  check (pu_gasto is not null or (origem_cabecalho is not null and length(btrim(origem_cabecalho)) > 0));

-- O último minuto (global e por organização) numa faixa curta do índice, sem ler o heap.
create index ix_satelite_consumo_recente on erp.satelite_consumo (created_at) include (organization_id);

comment on table erp.satelite_consumo is 'LEDGER IMUTÁVEL do consumo do provedor satelital (SAT-02, decisão 295; SAT-03, decisão 296): uma linha por chamada cobrada (resposta 2xx), com o PU informado ou, sem ele, o PU e o crédito nulos e o motivo em origem_cabecalho. Não se altera nem se apaga.';
comment on column erp.satelite_consumo.pu_gasto is 'Processing units cobradas, como o provedor informou no cabeçalho. Nula (junto com creditos) quando o cabeçalho não veio ou não era legível: o crédito da chamada é desconhecido, não zero (origem_cabecalho diz o motivo).';
comment on column erp.satelite_consumo.creditos is 'Créditos = round(pu_gasto × 100, 2) (1 crédito = 0,01 PU). Nulo exatamente quando pu_gasto é nulo.';
comment on column erp.satelite_consumo.origem_cabecalho is 'Valor bruto do cabeçalho x-processingunits-spent, quando o PU veio dele; sem PU, o motivo (cabecalho_ausente ou cabecalho_invalido) — obrigatório nesse caso.';

-- ---------- 7) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
declare
  v_ch record;
  v_execucao text[];
begin
  -- O ledger: PU e crédito anuláveis, nos MESMOS tipos; os CHECKs são EXATAMENTE os da 0053 mais os dois novos, validados.
  if (select count(*) from pg_attribute a
       where a.attrelid = 'erp.satelite_consumo'::regclass and not a.attisdropped and not a.attnotnull
         and ((a.attname = 'pu_gasto' and format_type(a.atttypid, a.atttypmod) = 'numeric(14,4)')
           or (a.attname = 'creditos' and format_type(a.atttypid, a.atttypmod) = 'numeric(16,2)'))) <> 2 then
    raise exception 'SAT-03: pu_gasto numeric(14,4) e creditos numeric(16,2) de erp.satelite_consumo nao ficaram anulaveis.';
  end if;
  for v_ch in
    select * from (values
      ('satelite_consumo', array['chk_satelite_consumo_creditos', 'chk_satelite_consumo_item_com_consulta', 'chk_satelite_consumo_operacao',
                                 'chk_satelite_consumo_pu', 'chk_satelite_consumo_pu_creditos_par', 'chk_satelite_consumo_pu_ou_origem']),
      ('satelite_consulta_itens', array['chk_satelite_consulta_itens_chave', 'chk_satelite_consulta_itens_geometria_sha256',
                                        'chk_satelite_consulta_itens_indice_bundle', 'chk_satelite_consulta_itens_janela', 'chk_satelite_consulta_itens_pu_gasto',
                                        'chk_satelite_consulta_itens_situacao', 'chk_satelite_consulta_itens_tentativas', 'chk_satelite_consulta_itens_tentativas_rodada',
                                        'chk_satelite_consulta_itens_versao_metodo'])
    ) as k(tabela, nomes)
  loop
    if (select array_agg(c.conname::text order by c.conname) from pg_constraint c
         where c.conrelid = ('erp.' || v_ch.tabela)::regclass and c.contype = 'c' and c.convalidated) is distinct from v_ch.nomes then
      raise exception 'SAT-03: CHECKs de erp.% diferentes dos declarados (%).', v_ch.tabela, array_to_string(v_ch.nomes, ', ');
    end if;
  end loop;
  -- Os CHECKs novos olham as colunas certas (o comportamento é provado no teste da 0054).
  for v_ch in
    select * from (values
      ('satelite_consumo', 'chk_satelite_consumo_pu_creditos_par', array['creditos', 'pu_gasto']),
      ('satelite_consumo', 'chk_satelite_consumo_pu_ou_origem', array['origem_cabecalho', 'pu_gasto']),
      ('satelite_consulta_itens', 'chk_satelite_consulta_itens_tentativas_rodada', array['tentativas', 'tentativas_rodada'])
    ) as k(tabela, nome, colunas)
  loop
    if (select array_agg(a.attname::text order by a.attname::text) from pg_constraint c
          cross join lateral unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.conname = v_ch.nome and c.conrelid = ('erp.' || v_ch.tabela)::regclass) is distinct from v_ch.colunas then
      raise exception 'SAT-03: CHECK % de erp.% fora do contrato (colunas esperadas: %).', v_ch.nome, v_ch.tabela, array_to_string(v_ch.colunas, ', ');
    end if;
  end loop;
  -- A imutabilidade do ledger continua de pé (os três gatilhos da 0053, ligados, na função de sempre).
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O' and (t.tgrelid, t.tgname, t.tgfoid) in (
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_imutavel_truncate', 'erp.satelite_consumo_imutavel()'::regprocedure),
         ('erp.satelite_consumo'::regclass, 'trg_satelite_consumo_audit', 'erp.audit_row()'::regprocedure))) <> 3 then
    raise exception 'SAT-03: gatilhos de erp.satelite_consumo (imutabilidade por linha e por comando, auditoria) mudaram.';
  end if;

  -- A coluna nova da fila: integer, obrigatória, default 0.
  if not exists (select 1 from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = 'erp.satelite_consulta_itens'::regclass and a.attname = 'tentativas_rodada' and not a.attisdropped
                    and a.attnotnull and a.atttypid = 'integer'::regtype and pg_get_expr(d.adbin, d.adrelid) = '0') then
    raise exception 'SAT-03: erp.satelite_consulta_itens.tentativas_rodada fora do contrato (integer not null default 0).';
  end if;

  -- O índice novo, com a definição inteira (o schema sai do texto: pg_get_indexdef o omite quando erp está no search_path).
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('erp.ix_satelite_consumo_recente') and i.indisvalid
                    and regexp_replace(pg_get_indexdef(i.indexrelid), ' ON (erp\.)?', ' ON ')
                        = 'CREATE INDEX ix_satelite_consumo_recente ON satelite_consumo USING btree (created_at) INCLUDE (organization_id)') then
    raise exception 'SAT-03: indice erp.ix_satelite_consumo_recente ausente ou fora do contrato ((created_at) include (organization_id)).';
  end if;

  -- As duas portas: a assinatura e o retorno do contrato, SECURITY DEFINER, search_path fixo, a volatilidade certa e um
  -- dono que atravessa RLS (senão, com a GUC vazia, a reserva não veria fila nenhuma).
  if not exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
                  where p.oid = 'erp.satelite_reservar_itens(integer,integer,integer,integer,integer)'::regprocedure
                    and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=erp, pg_temp'] and (r.rolsuper or r.rolbypassrls)
                    and pg_get_function_arguments(p.oid) = 'p_limite integer, p_max_simultaneas integer, p_max_minuto_conta integer, p_max_minuto_org integer, p_prazo_segundos integer'
                    and pg_get_function_result(p.oid) = 'TABLE(organization_id uuid, empresa_id uuid, consulta_id uuid, item_id uuid, criado_por uuid)') then
    raise exception 'SAT-03: erp.satelite_reservar_itens fora do contrato (assinatura/retorno, SECURITY DEFINER, VOLATILE, search_path "erp, pg_temp", dono que atravessa RLS).';
  end if;
  if not exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
                  where p.oid = 'erp.satelite_contar_chamadas()'::regprocedure
                    and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=erp, pg_temp'] and (r.rolsuper or r.rolbypassrls)
                    and pg_get_function_result(p.oid) = 'TABLE(conta_minuto integer, conta_executando integer, org_minuto integer, org_executando integer)') then
    raise exception 'SAT-03: erp.satelite_contar_chamadas fora do contrato (retorno, SECURITY DEFINER, STABLE, search_path "erp, pg_temp", dono que atravessa RLS).';
  end if;
  -- EXECUTE: o erp_app sim, PUBLIC não, e nenhum outro papel além do dono.
  if has_function_privilege('public', 'erp.satelite_reservar_itens(integer,integer,integer,integer,integer)', 'execute')
     or has_function_privilege('public', 'erp.satelite_contar_chamadas()', 'execute')
     or not has_function_privilege('erp_app', 'erp.satelite_reservar_itens(integer,integer,integer,integer,integer)', 'execute')
     or not has_function_privilege('erp_app', 'erp.satelite_contar_chamadas()', 'execute') then
    raise exception 'SAT-03: EXECUTE das portas fora do esperado (PUBLIC nao executa; erp_app executa).';
  end if;
  select array_agg(p.proname::text || ' -> ' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by p.proname, a.grantee) into v_execucao
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid in ('erp.satelite_reservar_itens(integer,integer,integer,integer,integer)'::regprocedure, 'erp.satelite_contar_chamadas()'::regprocedure)
     and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
     and a.grantee <> (select r.oid from pg_roles r where r.rolname = 'erp_app');
  if v_execucao is not null then
    raise exception 'SAT-03: EXECUTE das portas concedido alem do dono e do erp_app: %', v_execucao;
  end if;
end $$;
