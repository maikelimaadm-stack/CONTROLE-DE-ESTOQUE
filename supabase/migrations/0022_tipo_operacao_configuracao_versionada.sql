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

-- ---------- 5) pós-condições ----------
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
end $$;
