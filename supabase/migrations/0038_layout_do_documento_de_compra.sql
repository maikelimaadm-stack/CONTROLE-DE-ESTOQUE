-- =====================================================================
-- 0038 COMPRAS-03 — LAYOUT DO DOCUMENTO DE COMPRA (CAMPOS POR TOP, COMO EM VENDAS) — decisão 269
--
-- 1) erp.layouts_documento.familia: o CHECK passa a aceitar as duas famílias de compra (compras.pedido e
--    compras.compra) ao lado das três de venda. É o mesmo cadastro de ORGANIZAÇÃO da 0032: o mecanismo de
--    layout (catálogo, validação, resolução ligado → padrão → sistema) é um só e mora no domínio
--    (`packages/domain/src/layout-documento.ts`), com um catálogo por família. Drop e add na MESMA instrução:
--    não existe instante sem o CHECK. O novo conjunto CONTÉM o anterior, então toda linha viva já passa — a
--    validação do ADD é só leitura, e NOT VALID não compraria nada além de um CHECK que o catálogo diz "não
--    conferido".
--    O gatilho que confere "família da TOP = família do layout" (erp.layout_documento_tops_confere_familia,
--    0032) já é genérico — compara `tipos_operacao.codigo_base` com `layouts_documento.familia` — e NÃO muda:
--    TOP de compra em layout de venda (e o inverso) já é recusada por ele.
--    O índice "no máximo um padrão ativo e vivo por (organização, família)" também não muda: a família faz
--    parte da chave, e cada família de compra ganha o seu padrão sem tocar no das de venda.
-- 2) Item 0 e) da revisão da COMPRAS-02: as funções SECURITY DEFINER do documento de compra passam a fixar
--    `search_path = erp, pg_catalog, pg_temp`, com pg_temp POR ÚLTIMO. Sem pg_temp na lista, o PostgreSQL
--    procura as tabelas TEMPORÁRIAS da sessão ANTES de qualquer schema: uma função definer que citasse uma
--    tabela sem schema leria a tabela temporária de quem a chama — com os privilégios do DONO, que atravessa
--    a RLS. Hoje toda referência dessas funções é qualificada (`erp.`), então nada muda no comportamento: é o
--    endurecimento que fecha a porta antes de alguém escrever a primeira referência sem schema. Vai por
--    ALTER FUNCTION (sem `create or replace`): o corpo, o dono, os privilégios e os gatilhos que apontam
--    para elas ficam exatamente como estão. As funções são as SECURITY DEFINER de compras VIVAS depois da
--    0037, enumeradas pelo catálogo na pré-condição (a lista abaixo tem de ser o catálogo inteiro, nem mais
--    nem menos):
--      · erp.documentos_compra_itens_documento_aberto()  (0036, a única da 0036 que a 0037 não substituiu);
--      · erp.documentos_compra_conferir_v2()              (0037);
--      · erp.documentos_compra_transicao_v2()             (0037);
--      · erp.documentos_compra_item_origem_guarda()       (0037).
--    As da 0036 que a 0037 removeu (conferir e transicao) não existem mais; a transição da 0036 nem era
--    definer.
--
-- SEM BACKFILL: nenhuma linha muda. O CHECK novo só ACEITA mais; nenhum dado existente fica de fora dele.
-- JANELA DE DEPLOY (pre-deploy): a API anterior só cria layout das famílias de venda (o domínio dela não
-- conhece catálogo de compra) e não lê layout de compra; o CHECK mais largo não muda nada do que ela grava
-- ou lê. As funções de gatilho mudam só o search_path. Ordem banco → API → web.
-- VOLTA: a API anterior convive com a 0038. Voltar o CHECK às três famílias de venda só é possível sem layout
-- de compra gravado — é decisão humana, com migration própria (dado de produção não se apaga).
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 72) then
    raise exception 'COMPRAS-03: outra transacao ja detem a trava desta migration (2026,72). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_def text;
  v_definer text[];
begin
  if to_regclass('erp.layouts_documento') is null or to_regclass('erp.layout_documento_tops') is null then
    raise exception 'COMPRAS-03: erp.layouts_documento/erp.layout_documento_tops ausente; a 0032 nao esta aplicada.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia' and c.contype = 'c';
  if v_def is null then
    raise exception 'COMPRAS-03: CHECK chk_layouts_documento_familia ausente em erp.layouts_documento; schema divergente.';
  end if;
  -- "Já aplicada" ANTES das demais: depois da 0038 o CHECK já cita as famílias de compra, e a reaplicação
  -- precisa dizer o motivo verdadeiro.
  if v_def like '%''compras.%' then
    raise exception 'COMPRAS-03: chk_layouts_documento_familia ja aceita familia de compra; a 0038 ja foi aplicada ou ha schema divergente.';
  end if;
  -- O CHECK que a 0038 substitui é EXATAMENTE o da 0032 (as três famílias de venda, na coluna familia).
  if (select array_agg(m[1] order by m[1]) from regexp_matches(v_def, '''([^'']*)''', 'g') m)
       is distinct from array['vendas.orcamento', 'vendas.pedido', 'vendas.venda']
     or (select c.conkey from pg_constraint c where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia')
       is distinct from array[(select attnum from pg_attribute where attrelid = 'erp.layouts_documento'::regclass and attname = 'familia')]::int2[] then
    raise exception 'COMPRAS-03: chk_layouts_documento_familia diferente do da 0032 (familia in vendas.orcamento, vendas.pedido, vendas.venda): %', v_def;
  end if;
  -- A 0037 está aplicada: as três funções dela existem, e as duas da 0036 que ela removeu não.
  if to_regprocedure('erp.documentos_compra_conferir_v2()') is null or to_regprocedure('erp.documentos_compra_transicao_v2()') is null
     or to_regprocedure('erp.documentos_compra_item_origem_guarda()') is null
     or to_regprocedure('erp.documentos_compra_itens_documento_aberto()') is null then
    raise exception 'COMPRAS-03: funcoes do documento de compra da 0036/0037 ausentes; a 0037 nao esta aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.documentos_compra_conferir()') is not null or to_regprocedure('erp.documentos_compra_transicao()') is not null then
    raise exception 'COMPRAS-03: funcoes da 0036 que a 0037 substituiu ainda existem; a 0037 nao terminou ou ha schema divergente.';
  end if;
  -- O gatilho da família (0032) está no lugar, com a função de sempre: é ele que recusa TOP de compra em layout
  -- de venda, e a 0038 depende dele sem tocá-lo.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'erp.layout_documento_tops'::regclass and t.tgname = 'trg_layout_documento_tops_familia'
                    and not t.tgisinternal and t.tgenabled = 'O'
                    and t.tgfoid = to_regprocedure('erp.layout_documento_tops_confere_familia()')) then
    raise exception 'COMPRAS-03: gatilho trg_layout_documento_tops_familia ausente, desligado ou fora de erp.layout_documento_tops_confere_familia(); schema divergente.';
  end if;
  -- ENUMERAÇÃO PELO CATÁLOGO: toda função SECURITY DEFINER do schema erp que é do documento de compra (pelo
  -- nome ou por ler as tabelas dele) tem de ser uma das quatro. Uma quinta que ninguém conhece ficaria com o
  -- search_path antigo, e o endurecimento seria só aparente.
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) into v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.prosrc like '%documentos\_compra%');
  if v_definer is distinct from array['erp.documentos_compra_conferir_v2()', 'erp.documentos_compra_item_origem_guarda()',
                                      'erp.documentos_compra_itens_documento_aberto()', 'erp.documentos_compra_transicao_v2()'] then
    raise exception 'COMPRAS-03: funcoes SECURITY DEFINER de compras diferentes das quatro esperadas (conferir_v2, item_origem_guarda, itens_documento_aberto, transicao_v2): %', v_definer;
  end if;
  -- O DONO das quatro atravessa a RLS: é com os privilégios dele que elas leem o pedido de origem, as compras
  -- ligadas e o cadastro da organização. E quem aplica pode alterá-las (é o dono, ou membro do papel dono).
  if exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
              where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                              'erp.documentos_compra_item_origem_guarda()'::regprocedure, 'erp.documentos_compra_itens_documento_aberto()'::regprocedure)
                and not (r.rolsuper or r.rolbypassrls)) then
    raise exception 'COMPRAS-03: o dono de alguma funcao SECURITY DEFINER de compras nao atravessa RLS; os gatilhos nao veriam o pedido de origem nem o cadastro da organizacao.';
  end if;
  if exists (select 1 from pg_proc p
              where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                              'erp.documentos_compra_item_origem_guarda()'::regprocedure, 'erp.documentos_compra_itens_documento_aberto()'::regprocedure)
                and not pg_has_role(current_user, p.proowner, 'MEMBER')) then
    raise exception 'COMPRAS-03: o papel que aplica a migration nao e dono das funcoes SECURITY DEFINER de compras; o ALTER FUNCTION seria recusado.';
  end if;
end $$;

-- ---------- 3) a família do layout: as três de venda e as duas de compra ----------
-- Drop e add na MESMA instrução (o nome é o mesmo): não existe instante sem o CHECK.
alter table erp.layouts_documento
  drop constraint chk_layouts_documento_familia,
  add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda', 'compras.pedido', 'compras.compra'));

comment on table erp.layouts_documento is 'Layout do documento (VENDAS-A3-1; compras na COMPRAS-03): estrutura de campos da Central de vendas e da Central de compras por família. Sem empresa_id. Conta única no domínio (layout-documento.ts), com um catálogo por família.';
comment on column erp.layouts_documento.familia is 'Família canônica do documento: vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido ou compras.compra. Uma TOP só se liga a layout da própria família (gatilho).';

-- ---------- 4) search_path das funções SECURITY DEFINER de compras, com pg_temp por último ----------
alter function erp.documentos_compra_itens_documento_aberto() set search_path = erp, pg_catalog, pg_temp;
alter function erp.documentos_compra_conferir_v2() set search_path = erp, pg_catalog, pg_temp;
alter function erp.documentos_compra_transicao_v2() set search_path = erp, pg_catalog, pg_temp;
alter function erp.documentos_compra_item_origem_guarda() set search_path = erp, pg_catalog, pg_temp;

-- ---------- 5) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_def text;
  v_validado boolean;
  v_ruins text[];
begin
  select pg_get_constraintdef(c.oid), c.convalidated into v_def, v_validado
    from pg_constraint c
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.layouts_documento'::regclass and attname = 'familia')]::int2[];
  if v_def is null or not v_validado then
    raise exception 'COMPRAS-03: chk_layouts_documento_familia ausente, fora da coluna familia ou nao validado.';
  end if;
  if (select array_agg(m[1] order by m[1]) from regexp_matches(v_def, '''([^'']*)''', 'g') m)
       is distinct from array['compras.compra', 'compras.pedido', 'vendas.orcamento', 'vendas.pedido', 'vendas.venda'] then
    raise exception 'COMPRAS-03: chk_layouts_documento_familia nao aceita exatamente as cinco familias (tres de venda, duas de compra): %', v_def;
  end if;
  -- O gatilho da família continua o da 0032, ligado, antes de INSERT e UPDATE, por linha.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'erp.layout_documento_tops'::regclass and t.tgname = 'trg_layout_documento_tops_familia'
                    and not t.tgisinternal and t.tgenabled = 'O'
                    and t.tgfoid = 'erp.layout_documento_tops_confere_familia()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 4 | 16)) then
    raise exception 'COMPRAS-03: gatilho trg_layout_documento_tops_familia mudou; a 0038 nao deveria toca-lo.';
  end if;
  -- Toda função SECURITY DEFINER de compras (o catálogo inteiro, não a lista acima) tem o search_path novo,
  -- EXATO, com pg_temp por último.
  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) into v_ruins
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.prosrc like '%documentos\_compra%')
     and coalesce(p.proconfig, '{}'::text[]) is distinct from array['search_path=erp, pg_catalog, pg_temp'];
  if v_ruins is not null then
    raise exception 'COMPRAS-03: funcoes SECURITY DEFINER de compras sem search_path "erp, pg_catalog, pg_temp": %', v_ruins;
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                       'erp.documentos_compra_item_origem_guarda()'::regprocedure, 'erp.documentos_compra_itens_documento_aberto()'::regprocedure)
         and p.prosecdef and p.proconfig = array['search_path=erp, pg_catalog, pg_temp']) <> 4 then
    raise exception 'COMPRAS-03: as quatro funcoes de gatilho de compras nao estao todas SECURITY DEFINER com o search_path novo.';
  end if;
  -- ALTER FUNCTION não mexe em privilégio: o EXECUTE continua só do dono (a 0036/0037 tiraram de todos).
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                              'erp.documentos_compra_item_origem_guarda()'::regprocedure, 'erp.documentos_compra_itens_documento_aberto()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'COMPRAS-03: EXECUTE das funcoes de gatilho de compras concedido alem do dono.';
  end if;
end $$;
