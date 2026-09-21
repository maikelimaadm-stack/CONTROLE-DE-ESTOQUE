-- =====================================================================
-- 0022 CONFIGURAÇÃO OPERACIONAL VERSIONADA DA TOP (TOP-CONFIG-03)
--
-- A 0020 criou a TOP configurável e a versão imutável; a versão guardava NOME e DESCRIÇÃO. Esta migration
-- faz a versão guardar também a CONFIGURAÇÃO OPERACIONAL: o que a operação declara sobre estoque,
-- financeiro, fiscal, aprovação e exigências de preenchimento.
--
-- CONFIGURAR ≠ EXECUTAR. Nada passa a acontecer por causa destas colunas. Nenhum serviço as lê nesta
-- fatia: a confirmação de venda, a baixa de estoque e a geração financeira continuam exatamente como
-- estavam. Ligar os efeitos é a TOP-CONFIG-04, e ela terá contrato de cutover próprio — declarado em
-- docs/TIPO-OPERACAO-CONTRACT.md. Uma coluna preenchida não autoriza comportamento.
--
-- POR QUE NA VERSÃO, E NÃO NO PAI. A configuração é a REGRA que explica o efeito de um documento. Se ela
-- morasse em `erp.tipos_operacao`, editá-la reescreveria a explicação de todo documento já emitido: um
-- lançamento de 2024 passaria a ser lido sob uma regra de 2026, e a auditoria ficaria impossível. Morando
-- na versão, editar cria a versão N+1 e a N continua dizendo o que dizia. O documento já grava qual versão
-- valia (0021), então ele continua enxergando a regra do dia dele sem nenhuma mudança de código.
--
-- ┌─ POR QUE `DEFAULT`, E POR QUE ELE FICA (as duas decisões mais importantes deste arquivo) ───────────┐
-- │ (1) O BACKFILL NÃO PODE SER `UPDATE`. A 0020 instalou `trg_tipos_operacao_versoes_imutavel`, um     │
-- │     gatilho BEFORE UPDATE OR DELETE que levanta exceção incondicionalmente. Um `update ... set      │
-- │     configuracao = ...` nas linhas existentes seria recusado pelo próprio banco — e desligar o      │
-- │     gatilho para contornar seria abrir, por conveniência de migration, exatamente a porta que ele   │
-- │     existe para trancar. `ADD COLUMN ... DEFAULT` é DDL: preenche as linhas existentes sem UPDATE,  │
-- │     sem disparar gatilho de linha e sem reescrever a tabela (Postgres 11+).                         │
-- │                                                                                                      │
-- │ (2) O DEFAULT PERMANECE DEPOIS DA MIGRATION, de propósito. Durante o rolling deploy a API ANTIGA    │
-- │     continua inserindo versões sem citar estas colunas. Sem default, esse INSERT falharia por        │
-- │     NOT NULL e a criação/edição de TOP quebraria no meio da implantação. Com default, a versão      │
-- │     criada pelo binário antigo nasce NEUTRA — que é a leitura honesta de "quem inseriu não declarou │
-- │     configuração nenhuma".                                                                           │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- O NEUTRO TEM UM DONO, E ELE NÃO É ESTE ARQUIVO. A verdade é `configuracaoNeutraTop()` em
-- `packages/domain/src/tipo-operacao-configuracao.ts`. O literal abaixo é uma CÓPIA inevitável: SQL não
-- importa TypeScript. A fronteira está coberta por teste — `packages/domain/test/
-- tipo-operacao-configuracao.test.ts` lê ESTE arquivo e compara o literal com a função, então divergir
-- reprova o gate em vez de envelhecer em silêncio.
--
-- POR QUE O NEUTRO É A ÚNICA ESCOLHA HONESTA PARA O ACERVO. Seria tentador deduzir "toda TOP da família
-- de venda certamente baixava estoque" e backfillar isso. Seria invenção: o efeito daqueles documentos
-- veio do CÓDIGO da época, não de configuração — que não existia. Atribuir a eles uma intenção que
-- ninguém declarou tornaria o passado indistinguível do que foi de fato escolhido. O cutover entre "o
-- código decide" e "a configuração decide" é assunto da TOP-CONFIG-04, com contrato próprio.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra
-- o nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (0018 usou 51, 0019 usou 52 e 53, 0020 usou 54, 0021 usou 55).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 56) then
    raise exception 'TOP-CONFIG-03: outra transacao ja detem a trava desta migration (2026,56). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições estruturais ----------
-- Fail-closed: sem a camada da 0020 não há onde pendurar a configuração, e criar a coluna assim mesmo
-- produziria configuração órfã — estado impossível que ninguém consegue corrigir depois.
do $$
begin
  if to_regclass('erp.tipos_operacao_versoes') is null then
    raise exception 'TOP-CONFIG-03: erp.tipos_operacao_versoes nao existe; a camada de TOP (0020) nao esta aplicada.';
  end if;
  -- O gatilho de imutabilidade é PREMISSA desta migration: é por causa dele que o preenchimento das linhas
  -- antigas é feito por DEFAULT e não por UPDATE. Se ele tiver sumido, a decisão de desenho perdeu a razão
  -- de ser e alguém precisa reavaliar antes de seguir.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'erp' and c.relname = 'tipos_operacao_versoes'
       and t.tgname = 'trg_tipos_operacao_versoes_imutavel' and not t.tgisinternal
  ) then
    raise exception 'TOP-CONFIG-03: trg_tipos_operacao_versoes_imutavel (0020) nao existe; a imutabilidade da versao e premissa desta fatia.';
  end if;
end $$;

-- ---------- 3) as colunas ----------
-- A VERSÃO DE SCHEMA VIAJA JUNTO COM O PAYLOAD, e é o que permite evoluir sem reinterpretar o passado.
-- Ler um payload com o dicionário errado é como decodificar bytes na codificação errada: não dá erro, dá
-- significado trocado. Com a versão gravada ao lado, um payload v2 chega a um leitor v1 e é RECUSADO em
-- vez de mal interpretado.
alter table erp.tipos_operacao_versoes
  add column if not exists configuracao_schema_version int not null default 1;

alter table erp.tipos_operacao_versoes
  add column if not exists configuracao jsonb not null default '{
    "versaoSchema": 1,
    "geral": {
      "confirmacao": "manual",
      "exigeParceiro": false,
      "exigeCentroResultado": false,
      "exigeObservacao": false,
      "alteracaoAposConfirmacao": "bloqueada",
      "documentoSemItens": "proibido"
    },
    "estoque": {
      "atualizacao": "nenhuma",
      "momento": "confirmacao",
      "exigeArmazem": false,
      "saldoNegativo": "bloquear"
    },
    "financeiro": {
      "atualizacao": "nenhuma",
      "modo": "incluir",
      "momento": "confirmacao",
      "exigeFormaPagamento": false,
      "exigeVencimento": false,
      "exigeCentroResultado": false
    },
    "fiscal": {
      "habilitado": false,
      "exigeDocumentoFiscal": false,
      "exigeNaturezaOperacao": false,
      "exigeRegraTributaria": false,
      "calculoTributario": "nao_aplicar"
    },
    "aprovacao": {
      "politica": "nenhuma",
      "valorMinimo": null,
      "momento": "antes_da_confirmacao"
    }
  }'::jsonb;

-- A POLÍTICA DE PRÓXIMAS OPERAÇÕES CHEGOU A SER DECLARADA? — o discriminador que a CARDINALIDADE não dá.
--
-- O grafo da seção 5 responde "quais destinos", e NUNCA "alguém já decidiu isto". Sem esta coluna, as duas
-- frases abaixo são a MESMA linha no banco — zero arestas nas duas:
--
--   "ninguém nunca declarou política para esta operação"        (acervo, compatibilidade)
--   "declarei que esta operação NÃO gera próxima operação"      (decisão explícita do administrador)
--
-- E elas exigem comportamentos OPOSTOS na conversão: a primeira precisa continuar caindo na cadeia antiga,
-- ou toda conversão de toda organização quebra no instante do deploy; a segunda tem de RECUSAR a conversão,
-- porque recusar foi exatamente o que o administrador declarou. Contar arestas não distingue as duas, e um
-- servidor que não distingue obedece à tela nova e desobedece à chamada direta da API.
--
-- ┌─ POR QUE O DEFAULT É `false`, E POR QUE ELE FICA ───────────────────────────────────────────────────┐
-- │ `false` é a leitura honesta em DUAS frentes ao mesmo tempo, e nenhuma das duas é suposição:         │
-- │                                                                                                      │
-- │  (a) ACERVO. Toda versão que já existia antes desta migration nasceu antes de existir onde declarar  │
-- │      política. Nenhuma delas declarou nada — não porque escolheram o vazio, mas porque não havia     │
-- │      escolha a fazer. Marcá-las como declaradas inventaria uma decisão que ninguém tomou e faria o   │
-- │      acervo inteiro parar de converter.                                                              │
-- │                                                                                                      │
-- │  (b) ROLLING DEPLOY. O binário ANTIGO insere versão sem citar esta coluna, e ele tampouco sabe       │
-- │      declarar política: nascer `false` é a descrição exata do que aconteceu naquele INSERT.          │
-- │                                                                                                      │
-- │ O DEFAULT PERMANECE depois da migration, pelo mesmo motivo dos outros DEFAULTs deste arquivo (bloco  │
-- │ (2) do cabeçalho): sem ele, o INSERT do binário antigo falharia por NOT NULL e a criação/edição de   │
-- │ TOP quebraria no meio da implantação. E, como lá, `ADD COLUMN ... DEFAULT` preenche as linhas        │
-- │ existentes sem UPDATE — que o gatilho de imutabilidade da 0020 recusaria de todo modo.               │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- A COLUNA HERDA A IMUTABILIDADE DA VERSÃO, e por isso NENHUM gatilho novo é criado aqui: ela mora em
-- `erp.tipos_operacao_versoes`, e `trg_tipos_operacao_versoes_imutavel` (0020) já recusa UPDATE e DELETE
-- sobre a tabela INTEIRA. Um segundo gatilho seria uma segunda verdade sobre a mesma regra. Declarar
-- política é, como mudar nome ou configuração, criar a versão N+1.
--
-- E É NA VERSÃO, NÃO NO PAI, pela razão do cabeçalho deste arquivo: isto é política HISTÓRICA. Um documento
-- emitido sob a versão 3 continua explicado pelo que a versão 3 declarava — inclusive por "a versão 3 não
-- declarava nada".
alter table erp.tipos_operacao_versoes
  add column if not exists destinos_configurados boolean not null default false;

-- ---------- 4) checks de FORMA (e só de forma) ----------
-- O QUE O BANCO CONFERE, E O QUE ELE DELIBERADAMENTE NÃO CONFERE.
--
-- Aqui ficam as invariantes que sobrevivem a qualquer evolução de schema: é objeto, tem as cinco seções,
-- a versão declarada é positiva e bate com a coluna. São baratas e pegam corrupção grosseira.
--
-- A VALIDAÇÃO SEMÂNTICA NÃO É DUPLICADA EM SQL — nem os enums, nem as dependências entre campos. Copiar
-- `atualizacao in ('nenhuma','entrada','saida','transferencia')` para cá criaria uma SEGUNDA definição do
-- contrato, e a segunda lista não fica desatualizada com barulho: envelhece em silêncio. No dia em que o
-- domínio ganhasse um valor novo, o banco recusaria sem explicação, ou pior — o check sairia do ar sozinho
-- num `versaoSchema` futuro que o banco não conhece. A autoridade semântica é o domínio (`lerConfiguracaoTop`),
-- exercido na borda de escrita da API.
alter table erp.tipos_operacao_versoes
  drop constraint if exists tipos_operacao_versoes_configuracao_forma;
alter table erp.tipos_operacao_versoes
  add constraint tipos_operacao_versoes_configuracao_forma check (
    jsonb_typeof(configuracao) = 'object'
    and configuracao ? 'versaoSchema'
    and configuracao ? 'geral'
    and configuracao ? 'estoque'
    and configuracao ? 'financeiro'
    and configuracao ? 'fiscal'
    and configuracao ? 'aprovacao'
  );

alter table erp.tipos_operacao_versoes
  drop constraint if exists tipos_operacao_versoes_configuracao_schema;
alter table erp.tipos_operacao_versoes
  add constraint tipos_operacao_versoes_configuracao_schema check (
    configuracao_schema_version >= 1
    -- A coluna e o payload não podem discordar: são duas afirmações sobre a MESMA coisa, e divergir
    -- deixaria o leitor escolher em qual acreditar.
    and (configuracao -> 'versaoSchema') = to_jsonb(configuracao_schema_version)
  );

-- ---------- 5) O GRAFO VERSIONADO DE PRÓXIMAS OPERAÇÕES ----------
-- A segunda metade desta fatia: uma versão da TOP declara QUAIS TOPs podem ser geradas A PARTIR de um
-- documento dela. É o que tira da interface a cadeia "orçamento vira pedido vira venda" e devolve essa
-- decisão para quem configura a operação.
--
-- ┌─ POR QUE TABELA, E NÃO UMA LISTA DENTRO DO JSON ────────────────────────────────────────────────────┐
-- │ O payload de configuração é um DOCUMENTO: o banco confere que ele é um objeto e nada mais. Uma      │
-- │ lista de UUIDs lá dentro seria um ponteiro sem integridade — apontaria para TOP inexistente, para   │
-- │ TOP de OUTRA ORGANIZAÇÃO, ou para uma linha apagada, e nada no banco reclamaria. A checagem cairia  │
-- │ inteira sobre a aplicação, que é exatamente onde ela não sobrevive a um acesso direto.              │
-- │                                                                                                      │
-- │ Como TABELA, cada aresta do grafo ganha duas chaves estrangeiras COMPOSTAS COM O TENANT, e o        │
-- │ estado impossível deixa de ser representável: não existe aresta para TOP de outro tenant, não       │
-- │ existe aresta para versão que não é da TOP de origem, não existe aresta órfã.                       │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ A SEMÂNTICA HISTÓRICA, QUE É O CORAÇÃO DO DESENHO ─────────────────────────────────────────────────┐
-- │ A aresta pendura na VERSÃO da origem, não na TOP da origem. Consequência direta e pretendida:       │
-- │                                                                                                      │
-- │   POLÍTICA DA ORIGEM  = congelada pela versão que o documento cita (0021).                          │
-- │   DISPONIBILIDADE DO DESTINO = avaliada no momento da ação.                                          │
-- │                                                                                                      │
-- │ Um orçamento emitido sob a versão 3 continua oferecendo os destinos que a versão 3 declarava, mesmo │
-- │ depois de a TOP ganhar a versão 4 com outros destinos. Se a política morasse na TOP, editar o       │
-- │ cadastro hoje mudaria retroativamente o que um documento de ontem pode virar — e ninguém            │
-- │ conseguiria explicar, meses depois, por que aquele orçamento virou aquele pedido.                    │
-- │                                                                                                      │
-- │ O DESTINO, porém, é IDENTIDADE ESTÁVEL (`tipos_operacao.id`), não versão. Congelar a versão do      │
-- │ destino seria pior: o documento novo nasceria sob uma regra velha que o administrador já corrigiu.  │
-- │ O destino entra na ação com a versão CORRENTE dele — e por isso precisa estar vivo AGORA.           │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
create table erp.tipos_operacao_versao_destinos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  -- A ORIGEM é a versão imutável. As duas colunas seguintes viajam juntas para a FK composta provar, de
  -- uma vez, que a versão existe, que ela é DAQUELA TOP e que tudo está no mesmo tenant.
  origem_versao_id uuid not null,
  origem_tipo_operacao_id uuid not null,
  -- O DESTINO é a identidade estável da TOP. Nunca a versão dela: ver o bloco acima.
  destino_tipo_operacao_id uuid not null,
  -- Ordem de APRESENTAÇÃO. Não tem significado de negócio: existe para o administrador decidir o que
  -- aparece primeiro quando há vários destinos, em vez de a ordem sair do acaso do `insert`.
  ordem int not null default 0 check (ordem >= 0),
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),

  constraint fk_tipos_operacao_versao_destinos_origem
    foreign key (origem_versao_id, origem_tipo_operacao_id, organization_id)
    references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id),

  -- SEM CASCADE, pelo mesmo motivo da 0021: exclusão de TOP é LÓGICA. Se algum dia um delete físico for
  -- tentado, a FK TRAVA — que é o comportamento certo. `cascade` apagaria em silêncio a política que
  -- explica por que um documento pôde virar outro.
  constraint fk_tipos_operacao_versao_destinos_destino
    foreign key (destino_tipo_operacao_id, organization_id)
    references erp.tipos_operacao (id, organization_id),

  -- Uma aresta por par. Duplicar o destino não acrescenta política nenhuma e faria a tela oferecer a
  -- mesma opção duas vezes.
  constraint uq_tipos_operacao_versao_destinos
    unique (origem_versao_id, destino_tipo_operacao_id),

  -- LAÇO SOBRE SI MESMA NÃO É POLÍTICA, É ENGANO. "Deste pedido gere outro pedido desta mesma TOP" não
  -- descreve nenhuma operação de negócio; descreve um clique que o usuário pode repetir para sempre. O
  -- banco recusa o único caso de ciclo que é sempre absurdo; ciclos mais longos entre TOPs DIFERENTES
  -- não são barrados aqui porque podem ser legítimos (devolução que gera reentrada, por exemplo) — a
  -- compatibilidade de família é conferida na borda, contra o registry canônico.
  constraint ck_tipos_operacao_versao_destinos_sem_laco
    check (destino_tipo_operacao_id <> origem_tipo_operacao_id)
);

comment on table erp.tipos_operacao_versao_destinos is
  'Grafo dirigido de proximas operacoes: a VERSAO de uma TOP declara para quais TOPs (identidade estavel) um documento dela pode ser convertido. Imutavel, como a versao que a ancora.';

-- Consulta REAL que este índice serve: montar `Próximos passos` do detalhe de um documento, que chega com
-- a versão de origem na mão (o documento a gravou em 0021) e precisa dos destinos na ordem de exibição.
create index ix_tipos_operacao_versao_destinos_origem
  on erp.tipos_operacao_versao_destinos (origem_versao_id, ordem);

-- Consulta reversa, usada pela administração: "quem aponta para esta TOP?". Sem ela, desativar uma TOP
-- exigiria varredura completa para dizer quais operações deixarão de ter aquele próximo passo.
create index ix_tipos_operacao_versao_destinos_destino
  on erp.tipos_operacao_versao_destinos (organization_id, destino_tipo_operacao_id);

-- 5.1 RLS e grants — mesmo padrão da 0020, pelos mesmos motivos.
-- Tabela criada depois do bloco genérico da 0007 NÃO é alcançada por ele: a RLS é declarada aqui.
-- Política ÚNICA: políticas PERMISSIVE combinam com OR e a mais frouxa acabaria valendo.
alter table erp.tipos_operacao_versao_destinos enable row level security;
alter table erp.tipos_operacao_versao_destinos force row level security;
create policy tenant_isolation on erp.tipos_operacao_versao_destinos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

-- A ARESTA É TÃO IMUTÁVEL QUANTO A VERSÃO QUE A ANCORA, e o grant precisa dizer isso. Como em 0020, o
-- `grant` sozinho não basta: a 0007 declarou default privileges com os QUATRO privilégios, então a tabela
-- nova já nasce podendo sofrer update e delete. A revogação é EXPLÍCITA e vem depois.
grant select, insert on erp.tipos_operacao_versao_destinos to erp_app;
revoke update, delete on erp.tipos_operacao_versao_destinos from erp_app;

-- 5.2 imutabilidade em gatilho
-- Regra que só existe no grant não sobrevive a um papel com mais privilégio. Editar a política de destinos
-- de uma versão JÁ EMITIDA reescreveria a explicação de conversões que já aconteceram — é a mesma reescrita
-- de histórico que a 0020 fechou para nome e descrição. Editar a TOP cria a versão N+1, e a N+1 recebe as
-- arestas novas.
create or replace function erp.tipos_operacao_versao_destino_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'TIPO_OPERACAO_DESTINO_IMUTAVEL: destino de versao de tipo de operacao nao aceita % (a edicao cria uma versao nova)', TG_OP
    using errcode = 'P0001';
end $$;

create trigger trg_tipos_operacao_versao_destinos_imutavel
  before update or delete on erp.tipos_operacao_versao_destinos
  for each row execute function erp.tipos_operacao_versao_destino_imutavel();

-- ---------- 6) pós-condições ----------
-- Um gate que não confere o próprio efeito é um carimbo. Aqui se prova o que a migration prometeu —
-- inclusive que ela NÃO desfez nada da 0020.
do $$
declare
  v_colunas int;
  v_checks int;
  v_linhas_sem_config int;
  v_rls int;
  v_gatilho int;
  v_grants_indevidos int;
  v_destinos_flag int;
  v_fks int;
  v_politicas int;
begin
  select count(*) into v_colunas from information_schema.columns
   where table_schema = 'erp' and table_name = 'tipos_operacao_versoes'
     and column_name in ('configuracao', 'configuracao_schema_version');
  if v_colunas <> 2 then
    raise exception 'TOP-CONFIG-03: esperava as 2 colunas de configuracao, encontrei %', v_colunas;
  end if;

  select count(*) into v_checks from pg_constraint
   where conname in ('tipos_operacao_versoes_configuracao_forma', 'tipos_operacao_versoes_configuracao_schema')
     and contype = 'c';
  if v_checks <> 2 then
    raise exception 'TOP-CONFIG-03: esperava os 2 checks de forma, encontrei %', v_checks;
  end if;

  -- O BACKFILL ACONTECEU DE FATO. `not null` já garantiria isso, mas a asserção explícita é o que separa
  -- "a coluna existe" de "o acervo inteiro tem configuração legível".
  select count(*) into v_linhas_sem_config from erp.tipos_operacao_versoes
   where configuracao is null or jsonb_typeof(configuracao) <> 'object';
  if v_linhas_sem_config <> 0 then
    raise exception 'TOP-CONFIG-03: % versao(oes) sem configuracao valida apos o backfill', v_linhas_sem_config;
  end if;

  -- O DISCRIMINADOR DE POLITICA DECLARADA EXISTE — e existe com as DUAS metades do desenho.
  -- Conferir so a presenca da coluna deixaria passar exatamente os dois modos de falha de que a decisao da
  -- ponte depende: sem NOT NULL apareceria uma TERCEIRA leitura ("nao se sabe se declarou"), que nenhum
  -- caminho do servidor trata; sem DEFAULT o INSERT do binario ANTIGO — que nao cita a coluna — quebraria
  -- no meio do rolling deploy, e a criacao de TOP cairia junto.
  select count(*) into v_destinos_flag from information_schema.columns
   where table_schema = 'erp' and table_name = 'tipos_operacao_versoes'
     and column_name = 'destinos_configurados';
  if v_destinos_flag <> 1 then
    raise exception 'TOP-CONFIG-03: a coluna destinos_configurados nao foi criada em tipos_operacao_versoes';
  end if;

  select count(*) into v_destinos_flag
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
   where n.nspname = 'erp' and c.relname = 'tipos_operacao_versoes'
     and a.attname = 'destinos_configurados' and not a.attisdropped
     and a.attnotnull
     and pg_get_expr(ad.adbin, ad.adrelid) = 'false';
  if v_destinos_flag <> 1 then
    raise exception 'TOP-CONFIG-03: destinos_configurados precisa ser NOT NULL e manter DEFAULT false';
  end if;

  -- O ACERVO INTEIRO NASCEU COMO NUNCA DECLARADO. `not null` garante que ha valor; esta asercao garante
  -- QUAL valor — e e ela que separa "a coluna existe" de "nenhuma versao antiga foi promovida a declarada".
  -- Uma linha `true` aqui seria uma politica que ninguem escreveu, e o efeito dela e recusar conversao.
  select count(*) into v_destinos_flag from erp.tipos_operacao_versoes where destinos_configurados;
  if v_destinos_flag <> 0 then
    raise exception 'TOP-CONFIG-03: % versao(oes) do acervo nasceram com destinos_configurados = true', v_destinos_flag;
  end if;

  -- A 0020 continua de pé: RLS forçada, gatilho de imutabilidade vivo e nenhum privilégio de escrita
  -- destrutiva devolvido à aplicação. Uma migration que conserta uma coisa e afrouxa outra é regressão.
  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'tipos_operacao_versoes'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'TOP-CONFIG-03: RLS deixou de estar habilitada E forcada em tipos_operacao_versoes';
  end if;

  select count(*) into v_gatilho from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'tipos_operacao_versoes'
     and t.tgname = 'trg_tipos_operacao_versoes_imutavel' and not t.tgisinternal;
  if v_gatilho <> 1 then
    raise exception 'TOP-CONFIG-03: o gatilho de imutabilidade da versao sumiu';
  end if;

  select count(*) into v_grants_indevidos from information_schema.role_table_grants
   where table_schema = 'erp' and table_name = 'tipos_operacao_versoes'
     and grantee = 'erp_app' and privilege_type in ('UPDATE', 'DELETE');
  if v_grants_indevidos <> 0 then
    raise exception 'TOP-CONFIG-03: erp_app voltou a ter UPDATE/DELETE em tipos_operacao_versoes (% grants)', v_grants_indevidos;
  end if;

  -- ----- o grafo de proximas operacoes -----
  if to_regclass('erp.tipos_operacao_versao_destinos') is null then
    raise exception 'TOP-CONFIG-03: a tabela do grafo de proximas operacoes nao foi criada';
  end if;

  -- AS DUAS FKs COMPOSTAS SAO O DESENHO INTEIRO. Sem elas a tabela e uma lista de UUIDs com outro nome,
  -- e o estado impossivel (aresta para TOP de outro tenant) volta a ser representavel.
  select count(*) into v_fks from pg_constraint
   where conname in ('fk_tipos_operacao_versao_destinos_origem', 'fk_tipos_operacao_versao_destinos_destino')
     and contype = 'f';
  if v_fks <> 2 then
    raise exception 'TOP-CONFIG-03: esperava as 2 FKs compostas do grafo de destinos, encontrei %', v_fks;
  end if;

  -- Nenhuma das duas pode cascatear: apagar configuracao nao apaga a politica que explica conversoes
  -- ja feitas. 'a' = NO ACTION.
  if exists (select 1 from pg_constraint
              where conname in ('fk_tipos_operacao_versao_destinos_origem', 'fk_tipos_operacao_versao_destinos_destino')
                and (confdeltype <> 'a' or confupdtype <> 'a')) then
    raise exception 'TOP-CONFIG-03: as FKs do grafo de destinos nao podem cascatear';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_versao_destinos' and contype = 'u') then
    raise exception 'TOP-CONFIG-03: a unicidade origem-versionada + destino nao foi criada';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ck_tipos_operacao_versao_destinos_sem_laco' and contype = 'c') then
    raise exception 'TOP-CONFIG-03: o check que recusa o laco sobre a propria TOP nao foi criado';
  end if;

  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'tipos_operacao_versao_destinos'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'TOP-CONFIG-03: o grafo de destinos nasceu sem RLS habilitada E forcada';
  end if;

  -- UMA politica, nao duas: PERMISSIVE combinam com OR e a mais frouxa valeria.
  select count(*) into v_politicas from pg_policies
   where schemaname = 'erp' and tablename = 'tipos_operacao_versao_destinos';
  if v_politicas <> 1 then
    raise exception 'TOP-CONFIG-03: o grafo de destinos precisa de exatamente 1 politica de RLS, encontrei %', v_politicas;
  end if;

  select count(*) into v_gatilho from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'tipos_operacao_versao_destinos'
     and t.tgname = 'trg_tipos_operacao_versao_destinos_imutavel' and not t.tgisinternal;
  if v_gatilho <> 1 then
    raise exception 'TOP-CONFIG-03: o gatilho de imutabilidade do grafo de destinos nao foi criado';
  end if;

  -- A REVOGACAO EXPLICITA ACONTECEU. Medido em 0020: o grant sozinho nao basta, porque os default
  -- privileges da 0007 ja concedem os quatro privilegios a toda tabela nova do schema.
  select count(*) into v_grants_indevidos from information_schema.role_table_grants
   where table_schema = 'erp' and table_name = 'tipos_operacao_versao_destinos'
     and grantee = 'erp_app' and privilege_type in ('UPDATE', 'DELETE');
  if v_grants_indevidos <> 0 then
    raise exception 'TOP-CONFIG-03: erp_app ficou com UPDATE/DELETE no grafo de destinos (% grants)', v_grants_indevidos;
  end if;
end $$;
