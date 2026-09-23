-- =====================================================================
-- 0023 GUARDA DA EXECUÇÃO CONFIGURADA NA CONFIRMAÇÃO DE VENDA (TOP-CONFIG-04A)
--
-- A TOP-CONFIG-04A fez a configuração da TOP (formato 2, bloco `execucao`) passar a DECIDIR o estoque e o
-- financeiro da confirmação de venda. Quem executa é o serviço de vendas da API — e é exatamente aí que
-- mora o risco que esta migration fecha.
--
-- ┌─ O PROBLEMA QUE SÓ O BANCO RESOLVE ─────────────────────────────────────────────────────────────────┐
-- │ Um binário da API ANTERIOR à TOP-CONFIG-04A não lê configuração nenhuma ao confirmar: ele baixa o   │
-- │ estoque e gera as contas a receber pelo código de sempre. Se ele confirmar uma venda cuja versão     │
-- │ congelada declara execução configurada, a venda recebe o comportamento LEGADO em silêncio — o      │
-- │ contrário do que o administrador ativou. Isso acontece de dois jeitos reais:                        │
-- │   (1) uma instância antiga ainda no pool durante a implantação;                                     │
-- │   (2) um ROLLBACK do binário da API depois de a execução configurada estar em uso.                   │
-- │ O gate operacional (`TOP_EFFECTS_RUNTIME_V1_ENABLED`) não protege nenhum dos dois: ele é lido pelo    │
-- │ binário NOVO, e o binário antigo não sabe que ele existe. A invariante "versão configurada nunca é   │
-- │ confirmada pelo legado" é crítica, e invariante crítica mora em gatilho no banco (`CLAUDE.md`).      │
-- └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- COMO. A confirmação de venda sob política configurada, no binário da TOP-CONFIG-04A, grava na PRÓPRIA
-- transação a marca `app.venda_execucao_configurada = <id da venda>` (`set_config(..., true)`, válida só
-- até o fim da transação) antes de mover o status. Este gatilho, quando a venda ENTRA num estado
-- pós-confirmação (`confirmed` ou `invoiced`) vinda de qualquer outro estado, lê a versão congelada e:
--   · sem versão congelada (acervo, cliente anterior à TOP)            → deixa passar;
--   · formato 1                                                        → deixa passar (legado por definição);
--   · formato 2 com os DOIS efeitos em `legado`                        → deixa passar;
--   · qualquer outra coisa (algum efeito configurado, formato futuro)   → exige a marca com o id DESTA venda.
-- Sem a marca, levanta `TIPO_OPERACAO_INDISPONIVEL`, um código que o binário anterior JÁ conhece (0020):
-- ele responde 422 com mensagem clara em vez de um 500, e a transação inteira — estoque e títulos que ele
-- já tivesse postado — é desfeita.
--
-- O QUE ELA NÃO FAZ, e por quê:
--   · NÃO altera dado. Nenhum UPDATE, nenhum backfill, nenhuma versão reescrita, nenhuma ativação: a
--     execução configurada continua exigindo decisão explícita do administrador e o gate ligado.
--   · NÃO cria coluna nem tabela. O dicionário de dados não muda.
--   · NÃO decide a política. Quem decide é o domínio (`resolverPoliticaEfetivaDaVenda`); o gatilho só
--     reconhece "esta versão pede algo que não é legado" — e, por ser fail-closed, reconhece também o
--     formato que ainda não existe.
--   · NÃO é autorização. A marca não é segredo nem credencial: ela existe para barrar CÓDIGO ANTIGO, que
--     não sabe escrevê-la, e é amarrada ao id da venda para não valer para outra na mesma transação.
--
-- IMPLANTAÇÃO. Pode ser aplicada antes ou depois do binário novo: enquanto nenhuma versão declara execução
-- configurada (o gate nasce desligado e a ativação exige o gate), o gatilho deixa passar tudo. O que ela
-- EXIGE é estar aplicada ANTES da fase 2 (ligar o gate) — ver `docs/DEPLOYMENT.md`.
--
-- HISTÓRICO. A cláusula WHEN do gatilho foi corrigida na revisão R1 da PR #56, ANTES do merge e de qualquer
-- aplicação em ambiente compartilhado (produção sem 0023 no ledger em 23/09/2026; DECISIONS 238). Banco local
-- que tenha aplicado a versão anterior precisa ser recriado: o ledger registra só o nome.
--
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra
-- o nome no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (0018 usou 51, 0019 usou 52 e 53, 0020 usou 54, 0021 usou 55, 0022 usou 56).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 57) then
    raise exception 'TOP-CONFIG-04A: outra transacao ja detem a trava desta migration (2026,57). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições estruturais ----------
-- O gatilho lê o ponteiro congelado da venda (0021) e a configuração da versão (0022). Sem os dois, ele
-- não teria o que conferir — e um gatilho que não confere nada é pior do que nenhum, porque parece guarda.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'erp' and table_name = 'sales_documents' and column_name = 'tipo_operacao_versao_id') then
    raise exception 'TOP-CONFIG-04A: erp.sales_documents.tipo_operacao_versao_id nao existe; o snapshot da TOP (0021) nao esta aplicado.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'erp' and table_name = 'tipos_operacao_versoes' and column_name = 'configuracao') then
    raise exception 'TOP-CONFIG-04A: erp.tipos_operacao_versoes.configuracao nao existe; a configuracao versionada (0022) nao esta aplicada.';
  end if;
end $$;

-- ---------- 3) a guarda ----------
-- SECURITY INVOKER (o padrão): o gatilho lê a versão com o papel e a RLS de quem confirma. A versão é do
-- MESMO tenant da venda (FK composta da 0021), então a leitura é sempre possível para quem pode confirmar;
-- se não for, é recusa — nunca "então é legado".
create or replace function erp.venda_execucao_configurada_guarda() returns trigger
language plpgsql
set search_path = pg_catalog, erp
as $$
declare
  v_formato int;
  v_configuracao jsonb;
begin
  select v.configuracao_schema_version, v.configuracao
    into v_formato, v_configuracao
    from erp.tipos_operacao_versoes v
   where v.id = NEW.tipo_operacao_versao_id and v.organization_id = NEW.organization_id;

  if not found then
    raise exception 'TIPO_OPERACAO_INDISPONIVEL: tipo de operacao indisponivel para este documento'
      using errcode = 'P0001';
  end if;

  -- Formato 1 é legado para sempre, seja qual for o conteúdo: ele foi gravado quando nada executava.
  if v_formato = 1 then
    return NEW;
  end if;

  -- Formato 2 sem nada configurado: legado declarado, nos dois efeitos.
  if v_formato = 2
     and v_configuracao -> 'execucao' ->> 'estoque' = 'legado'
     and v_configuracao -> 'execucao' ->> 'financeiro' = 'legado' then
    return NEW;
  end if;

  -- Execução configurada (ou formato que este banco ainda não conhece): só o binário que a executa confirma.
  if current_setting('app.venda_execucao_configurada', true) is distinct from NEW.id::text then
    raise exception 'TIPO_OPERACAO_INDISPONIVEL: a operacao desta venda usa execucao configurada, que este servidor nao executa; a venda nao foi confirmada'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

revoke all on function erp.venda_execucao_configurada_guarda() from public;

drop trigger if exists trg_sales_documents_execucao_configurada on erp.sales_documents;
-- SÓ a ENTRADA no estado pós-confirmação, e só quando há versão congelada (o acervo sem TOP nem chega a
-- executar a função):
--   · qualquer estado → `confirmed` ou `invoiced`  → dispara. É onde os efeitos acontecem, e cobre também
--     o salto direto para `invoiced`, para um binário anterior não contornar a guarda por ele;
--   · `confirmed` → `invoiced`                     → NÃO dispara. O faturamento de uma venda já confirmada
--     não executa estoque nem financeiro de novo; exigir a marca ali quebraria a primeira fatia fiscal,
--     que não é a dona da execução configurada e não tem por que conhecer a marca;
--   · `invoiced` → `confirmed`, e qualquer saída   → NÃO dispara (nenhum efeito de confirmação acontece).
-- Os estados de SAÍDA são listados por exclusão (`is distinct from`), não os de entrada por inclusão: um
-- estado novo que alguém acrescente continua guardado, e `is distinct from` não deixa um NULL pular a
-- guarda como `not in` deixaria.
create trigger trg_sales_documents_execucao_configurada
  before update of status on erp.sales_documents
  for each row
  when (NEW.status in ('confirmed', 'invoiced')
        and OLD.status is distinct from 'confirmed'
        and OLD.status is distinct from 'invoiced'
        and NEW.tipo_operacao_versao_id is not null)
  execute function erp.venda_execucao_configurada_guarda();

-- ---------- 4) pós-condições ----------
-- Um gate que não confere o próprio efeito é um carimbo. Aqui se prova o que a migration prometeu.
do $$
declare
  v_gatilhos int;
begin
  select count(*) into v_gatilhos from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname = 'sales_documents'
     and t.tgname = 'trg_sales_documents_execucao_configurada' and not t.tgisinternal and t.tgenabled = 'O';
  if v_gatilhos <> 1 then
    raise exception 'TOP-CONFIG-04A: o gatilho de guarda da execucao configurada nao foi criado (ou nasceu desabilitado)';
  end if;
end $$;
