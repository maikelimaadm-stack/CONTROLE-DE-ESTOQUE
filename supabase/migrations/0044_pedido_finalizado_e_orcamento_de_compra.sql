-- =====================================================================
-- 0044 OPERACOES-01 F6a — PEDIDO DE COMPRA FINALIZADO (COM APROVAÇÃO), APROVADO PARA ORÇAMENTO E ORÇAMENTO DE
-- COMPRA — decisão 283 (parte F6a)
--
-- 1) Colunas do PEDIDO: finalizado_em/finalizado_por (a finalização é a confirmação do pedido: quem e quando,
--    gravados SÓ na passagem aberto → finalizado) e aprovado_orcamento_em/aprovado_orcamento_por ("aprovado para
--    orçamento": gravados uma vez, com o pedido aberto). Os dois pares andam juntos e são só do pedido (CHECK).
-- 2) A espécie 'orcamento' em erp.documentos_compra, com vínculo PRÓPRIO ao pedido que ela cota:
--    pedido_orcado_id no cabeçalho e item_pedido_orcado_id no item, FKs COMPOSTAS com a organização para a
--    própria tabela. NÃO por origem_documento_id/origem_item_id: a origem CONSOME saldo (o gatilho da origem da
--    0037 soma tudo o que está ligado ao item do pedido em documentos não cancelados, e a lateral "recebido" da
--    API também), PRENDE o fornecedor do pedido que tem documento com origem (0037, conferência v2), EXIGE o
--    mesmo fornecedor do pedido e é só da compra (CHECK chk_documentos_compra_origem_so_compra). O orçamento é
--    de OUTRO fornecedor, não recebe nada e não pode travar a escolha do vencedor. Campos só do orçamento:
--    prazo_entrega_dias (0 a 3650) e validade_orcamento; a condição é a condicao_pagamento_id de sempre.
--    Um orçamento VIVO por fornecedor em cada pedido e um único 'escolhido' por pedido (índices únicos parciais).
-- 3) Situações e transições (gatilho de transição v3): pedido aberto | finalizado | convertido | cancelado;
--    orçamento aberto | escolhido | nao_escolhido | cancelado; compra como hoje. Passagens novas: pedido
--    aberto → finalizado; (aberto|finalizado) → convertido; convertido → finalizado (a reabertura volta à situação
--    de ANTES de converter: finalizado se finalizado_em existe, aberto se não); finalizado → cancelado (pedido sem
--    compra viva); orçamento aberto → escolhido / nao_escolhido / cancelado. finalizado → aberto não existe, e
--    escolhido/nao_escolhido são finais. Os CHECKs de espécie e de situação são refeitos (drop e add na MESMA
--    instrução) só para ACRESCENTAR valores: o conjunto novo contém o de hoje.
-- 4) A aprovação da TOP vale para o PEDIDO, ao FINALIZAR. A 0041 NÃO se edita: a conferência da decisão passa a
--    ser a v2 (aceita documento de espécie 'compra' OU 'pedido', o resto igual) e uma guarda NOVA, própria, na
--    passagem aberto → finalizado do pedido (molde da guarda da compra da 0041, com mensagens que dizem
--    "finalizado"): a decisão vigente tem de ser 'aprovado' e cobrir o maior valor entre o de antes e o de
--    depois do UPDATE e a versão da TOP de depois.
--    Receber de pedido finalizado: a conferência do cabeçalho (v3) e a guarda da origem dos itens (v2) aceitam o
--    pedido de origem 'aberto' OU 'finalizado'. "Exige finalizar" é regra configurável da TOP: mora na API.
-- 5) Itens do orçamento (gatilho NOVO trg_documentos_compra_itens_orcamento_guarda): todo item do orçamento liga
--    a um item do pedido orçado, com o MESMO produto e a MESMA quantidade, sem lote nem validade; só o orçamento
--    liga; do lado do pedido, o item já orçado (por orçamento não cancelado) não troca de produto nem de
--    quantidade. A linha do pedido é lida FOR SHARE: a troca concorrente da quantidade espera o orçamento.
-- 6) erp.layouts_documento.familia: o CHECK passa a aceitar compras.orcamento ao lado das cinco da 0038 — lista
--    ESTÁTICA, e a pré-condição prova que toda família aceita hoje cabe nela (o coordenador acrescenta as de
--    outras fases no merge).
-- 7) Funções novas com sufixo (_v3, _v2, ou nome novo), os gatilhos de MESMO nome trocados para elas (a ordem de
--    disparo, que é alfabética, não muda), e as antigas removidas SEM cascata — o drop PARA a migration se algo
--    além dos gatilhos trocados apontasse para elas (molde da 0037). Todas SECURITY DEFINER estreitas, com
--    search_path = erp, pg_temp (pg_temp por último) e EXECUTE só do dono. A função
--    erp.documentos_compra_itens_documento_aberto() NÃO muda aqui (outra fase reescreve o corpo dela): ela só é
--    citada, por NOME, nas enumerações.
-- 8) Pré-condições nomeadas "OPERACOES-01 F6a: …" ("já aplicada" primeiro) e pós-condições só de OBJETOS — nunca
--    contagem de tabela viva.
--
-- RLS, PRIVILÉGIOS E AUDITORIA: nada muda. erp.documentos_compra (política tenant_e_empresa, categoria A, módulo
-- compras) e erp.documentos_compra_itens (api_child) já cobrem o orçamento; os grants de tabela cobrem as colunas
-- novas; trg_documentos_compra_audit audita o orçamento. Sem tabela nova.
-- SEM BACKFILL: colunas novas nulas; nenhuma linha existente muda, e nenhuma fica fora dos CHECKs refeitos (eles
-- só ACRESCENTAM valores; os novos só restringem as colunas novas, que nascem nulas).
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web): a API anterior não lê nem grava as colunas novas, não
-- cria orçamento e não finaliza. O que ela grava continua passando: compra e pedido nascem sem finalização e sem
-- vínculo de orçamento, e o pedido aberto continua recebido como hoje. Os gatilhos trocados usam só CONFLICT,
-- VALIDATION_ERROR e NOT_FOUND, que todo binário conhece (409/422/404, nunca 500). As trocas de gatilho e os CHECKs
-- pedem locks curtos em documentos_compra, documentos_compra_itens, aprovacoes_compra e layouts_documento; o
-- lock_timeout de 2s faz a migration desistir em vez de enfileirar as gravações atrás dela.
-- VOLTA: API e web voltam por redeploy e convivem com a 0044. Colunas e linhas nunca se apagam (decisão 247). A
-- API anterior não recebe pedido FINALIZADO (409 "Este pedido não está aberto."), não lista orçamento (espécie
-- fora das portas dela) e não lista pedido na fila de aprovações (espécie compra fixa); as decisões já gravadas
-- ficam. Desligar a guarda ou estreitar os CHECKs só com uma migration nova, por decisão humana.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fase (2026,78).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 78) then
    raise exception 'OPERACOES-01 F6a: outra transacao ja detem a trava desta migration (2026,78). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_lista text[];
  v_def text;
  v_familias text[];
  v_fora text[];
begin
  -- 2.1 "Já aplicada" ANTES das demais: depois da 0044 as funções que ela troca não existem mais, e a reaplicação
  -- precisa dizer o motivo verdadeiro.
  if to_regprocedure('erp.documentos_compra_conferir_v3()') is not null or to_regprocedure('erp.documentos_compra_transicao_v3()') is not null
     or to_regprocedure('erp.documentos_compra_item_origem_guarda_v2()') is not null or to_regprocedure('erp.documentos_compra_item_orcamento_guarda()') is not null
     or to_regprocedure('erp.documentos_compra_finalizacao_guarda()') is not null or to_regprocedure('erp.aprovacoes_compra_conferir_v2()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'erp'
                 and ((table_name = 'documentos_compra' and column_name in ('finalizado_em', 'finalizado_por', 'aprovado_orcamento_em', 'aprovado_orcamento_por',
                                                                            'pedido_orcado_id', 'prazo_entrega_dias', 'validade_orcamento'))
                   or (table_name = 'documentos_compra_itens' and column_name = 'item_pedido_orcado_id'))) then
    raise exception 'OPERACOES-01 F6a: objetos da 0044 ja existem; a 0044 ja foi aplicada ou ha schema divergente.';
  end if;

  -- 2.2 Papéis. O erp_app é quem grava pelos gatilhos; quem aplica é o dono das funções SECURITY DEFINER e tem de
  -- atravessar a RLS (senão os gatilhos veriam só o recorte de quem chama), e isso é conferido antes de ler tabela.
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'OPERACOES-01 F6a: papel erp_app ausente (0007); os gatilhos de compras nao teriam a quem servir.';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'OPERACOES-01 F6a: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam o pedido, o orcamento nem a decisao.';
  end if;

  -- 2.3 Tabelas e as chaves (id, organization_id) que as FKs compostas novas referenciam.
  if to_regclass('erp.documentos_compra') is null or to_regclass('erp.documentos_compra_itens') is null or to_regclass('erp.aprovacoes_compra') is null
     or to_regclass('erp.layouts_documento') is null or to_regclass('erp.tipos_operacao_versoes') is null then
    raise exception 'OPERACOES-01 F6a: tabela ausente (documentos_compra, documentos_compra_itens, aprovacoes_compra, layouts_documento ou tipos_operacao_versoes); a cadeia de migrations esta fora de ordem.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'uq_documentos_compra_tenant' and c.contype = 'u'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[])
     or not exists (select 1 from pg_constraint c
                     where c.conrelid = 'erp.documentos_compra_itens'::regclass and c.conname = 'uq_documentos_compra_itens_tenant' and c.contype = 'u'
                       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'id'),
                                            (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'OPERACOES-01 F6a: chave (id, organization_id) ausente em erp.documentos_compra (uq_documentos_compra_tenant, 0036) ou em erp.documentos_compra_itens (uq_documentos_compra_itens_tenant, 0037); as FKs compostas do orcamento nao teriam alvo.';
  end if;

  -- 2.4 As funções que esta migration substitui e as que as novas chamam (o plpgsql só resolve a chamada na
  -- execução: a ausência viraria erro genérico no primeiro documento).
  if to_regprocedure('erp.documentos_compra_conferir_v2()') is null or to_regprocedure('erp.documentos_compra_transicao_v2()') is null
     or to_regprocedure('erp.documentos_compra_item_origem_guarda()') is null or to_regprocedure('erp.documentos_compra_itens_documento_aberto()') is null
     or to_regprocedure('erp.aprovacoes_compra_conferir()') is null or to_regprocedure('erp.documentos_compra_aprovacao_guarda()') is null
     or to_regprocedure('erp.top_exige_aprovacao(jsonb,numeric)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.current_user_id()') is null or to_regprocedure('erp.current_org_id()') is null
     or to_regprocedure('erp.empresa_escrita_permitida(uuid)') is null then
    raise exception 'OPERACOES-01 F6a: funcao ausente (conferir_v2, transicao_v2, item_origem_guarda e itens_documento_aberto de compras; aprovacoes_compra_conferir, documentos_compra_aprovacao_guarda e top_exige_aprovacao da 0041; audit_row, current_user_id, current_org_id, empresa_escrita_permitida); a cadeia de migrations esta fora de ordem.';
  end if;

  -- 2.5 Os gatilhos trocados existem, são do usuário, estão ligados e apontam para as funções esperadas: a troca
  -- abaixo sabe o que substitui. A guarda da aprovação da compra (0041) fica. Os dois nomes novos não existem.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and ((t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_conferir' and t.tgfoid = to_regprocedure('erp.documentos_compra_conferir_v2()'))
           or (t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_transicao' and t.tgfoid = to_regprocedure('erp.documentos_compra_transicao_v2()'))
           or (t.tgrelid = 'erp.documentos_compra_itens'::regclass and t.tgname = 'trg_documentos_compra_itens_origem_guarda' and t.tgfoid = to_regprocedure('erp.documentos_compra_item_origem_guarda()'))
           or (t.tgrelid = 'erp.aprovacoes_compra'::regclass and t.tgname = 'trg_aprovacoes_compra_conferir' and t.tgfoid = to_regprocedure('erp.aprovacoes_compra_conferir()'))
           or (t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_aprovacao' and t.tgfoid = to_regprocedure('erp.documentos_compra_aprovacao_guarda()')))) <> 5 then
    raise exception 'OPERACOES-01 F6a: gatilhos de compras a trocar (conferir, transicao, itens_origem_guarda, aprovacoes_compra_conferir) ou a guarda da aprovacao ausentes, desligados ou fora das funcoes esperadas; schema divergente.';
  end if;
  if exists (select 1 from pg_trigger t
              where t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass)
                and t.tgname in ('trg_documentos_compra_finalizacao', 'trg_documentos_compra_itens_orcamento_guarda')) then
    raise exception 'OPERACOES-01 F6a: trg_documentos_compra_finalizacao ou trg_documentos_compra_itens_orcamento_guarda ja existe; a 0044 ja foi aplicada ou ha schema divergente.';
  end if;

  -- 2.6 ENUMERAÇÃO PELO CATÁLOGO, pelo NOME: toda SECURITY DEFINER do schema erp que é de compras (documento ou
  -- decisão) tem de ser uma das seis. Uma sétima que ninguém conhece ficaria fora da troca e do endurecimento.
  -- Só pelo nome, de propósito: o corpo de erp.documentos_compra_itens_documento_aberto() pode ser reescrito por
  -- outra fase, e é o nome que esta migration cita. O nome vem de nspname, proname e argumentos (o texto de
  -- regprocedure depende do search_path de quem aplica).
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                   order by (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') collate "C") into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.proname like 'aprovacoes\_compra%');
  if v_lista is distinct from array['erp.aprovacoes_compra_conferir()', 'erp.documentos_compra_aprovacao_guarda()', 'erp.documentos_compra_conferir_v2()',
                                    'erp.documentos_compra_item_origem_guarda()', 'erp.documentos_compra_itens_documento_aberto()', 'erp.documentos_compra_transicao_v2()'] then
    raise exception 'OPERACOES-01 F6a: funcoes SECURITY DEFINER de compras diferentes das seis esperadas (aprovacoes_compra_conferir, documentos_compra_aprovacao_guarda, conferir_v2, item_origem_guarda, itens_documento_aberto, transicao_v2): %', v_lista;
  end if;

  -- 2.7 Donos. Quem aplica é dono (ou membro do papel dono) das seis funções e das quatro tabelas que esta
  -- migration altera (ALTER TABLE, CREATE/DROP TRIGGER, DROP FUNCTION e COMMENT exigem): sem isso ela pararia no
  -- meio com um erro de permissão genérico. E o dono das funções atravessa a RLS.
  if exists (select 1 from pg_proc p
              where p.oid in (to_regprocedure('erp.aprovacoes_compra_conferir()'), to_regprocedure('erp.documentos_compra_aprovacao_guarda()'),
                              to_regprocedure('erp.documentos_compra_conferir_v2()'), to_regprocedure('erp.documentos_compra_item_origem_guarda()'),
                              to_regprocedure('erp.documentos_compra_itens_documento_aberto()'), to_regprocedure('erp.documentos_compra_transicao_v2()'))
                and not pg_has_role(current_user, p.proowner, 'USAGE'))
     or exists (select 1 from pg_class c
                 where c.oid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.aprovacoes_compra'::regclass, 'erp.layouts_documento'::regclass)
                   and not pg_has_role(current_user, c.relowner, 'USAGE')) then
    raise exception 'OPERACOES-01 F6a: o papel que aplica a migration nao e dono das funcoes SECURITY DEFINER de compras ou das tabelas documentos_compra, documentos_compra_itens, aprovacoes_compra e layouts_documento; o ALTER e o DROP seriam recusados.';
  end if;
  if exists (select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
              where p.oid in (to_regprocedure('erp.aprovacoes_compra_conferir()'), to_regprocedure('erp.documentos_compra_aprovacao_guarda()'),
                              to_regprocedure('erp.documentos_compra_conferir_v2()'), to_regprocedure('erp.documentos_compra_item_origem_guarda()'),
                              to_regprocedure('erp.documentos_compra_itens_documento_aberto()'), to_regprocedure('erp.documentos_compra_transicao_v2()'))
                and not (r.rolsuper or r.rolbypassrls)) then
    raise exception 'OPERACOES-01 F6a: o dono de alguma funcao SECURITY DEFINER de compras nao atravessa RLS; os gatilhos nao veriam o pedido nem a decisao.';
  end if;

  -- 2.8 Os CHECKs de hoje: os quinze, e os três que esta migration refaz EXATAMENTE como a 0036/0037 os deixou
  -- (os conjuntos novos contêm estes; um CHECK diferente invalida a afirmação "nenhuma linha fica de fora").
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk\_documentos\_compra\_%') <> 15 then
    raise exception 'OPERACOES-01 F6a: CHECKs de erp.documentos_compra diferentes dos quinze esperados (0036 e 0037); schema divergente.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_especie' and c.contype = 'c';
  if v_def is null or (select array_agg(m[1] order by m[1] collate "C") from regexp_matches(v_def, '''([^'']*)''', 'g') m) is distinct from array['compra', 'pedido'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_especie ausente ou diferente do da 0036 (especie in pedido, compra): %', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_situacao' and c.contype = 'c';
  if v_def is null or (select array_agg(m[1] order by m[1] collate "C") from regexp_matches(v_def, '''([^'']*)''', 'g') m)
                      is distinct from array['aberto', 'cancelado', 'confirmado', 'convertido'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_situacao ausente ou diferente do da 0037 (aberto, confirmado, convertido, cancelado): %', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_situacao_especie' and c.contype = 'c';
  if v_def is null or (select array_agg(x.m[1] order by x.o) from regexp_matches(v_def, '''([^'']*)''', 'g') with ordinality x(m, o))
                      is distinct from array['compra', 'aberto', 'confirmado', 'cancelado', 'pedido', 'aberto', 'convertido', 'cancelado'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_situacao_especie ausente ou diferente do da 0037 (compra aberto/confirmado/cancelado; pedido aberto/convertido/cancelado): %', v_def;
  end if;

  -- 2.9 A família do layout: o CHECK existe, na coluna familia; aceita as cinco da 0038 e ainda não aceita
  -- compras.orcamento; e TODA família que ele aceita hoje está na lista nova (abaixo, estática) — senão o
  -- refazer tiraria uma família que outra migration acrescentou, e a linha gravada dela ficaria fora do CHECK.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.layouts_documento'::regclass and attname = 'familia')]::int2[];
  if v_def is null then
    raise exception 'OPERACOES-01 F6a: chk_layouts_documento_familia ausente ou fora da coluna familia de erp.layouts_documento; schema divergente.';
  end if;
  select array_agg(m[1] order by m[1] collate "C") into v_familias from regexp_matches(v_def, '''([^'']*)''', 'g') m;
  if not (coalesce(v_familias, '{}'::text[]) @> array['compras.compra', 'compras.pedido', 'vendas.orcamento', 'vendas.pedido', 'vendas.venda']) then
    raise exception 'OPERACOES-01 F6a: chk_layouts_documento_familia nao aceita as cinco familias da 0038 (vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido, compras.compra): %', v_def;
  end if;
  if 'compras.orcamento' = any (v_familias) then
    raise exception 'OPERACOES-01 F6a: chk_layouts_documento_familia ja aceita compras.orcamento; a 0044 ja foi aplicada ou ha schema divergente.';
  end if;
  select array_agg(f order by f collate "C") into v_fora from unnest(v_familias) f
   where f <> all (array['vendas.orcamento', 'vendas.pedido', 'vendas.venda', 'compras.pedido', 'compras.compra', 'compras.orcamento']);
  if v_fora is not null then
    raise exception 'OPERACOES-01 F6a: chk_layouts_documento_familia aceita familia que a lista desta migration nao carrega: %', v_fora;
  end if;
end $$;

-- ---------- 3) cabeçalho: finalização, aprovação para orçamento e o orçamento ----------
-- Colunas numa instrução, constraints em outra: o leitor de schema dos gates (scripts/lib/schema.mjs) lê o
-- `add column` repetido, e uma `add constraint` no meio dele viraria uma coluna fantasma no dicionário.
alter table erp.documentos_compra
  add column finalizado_em timestamptz,
  add column finalizado_por uuid constraint fk_documentos_compra_finalizado_por references erp.users(id),
  add column aprovado_orcamento_em timestamptz,
  add column aprovado_orcamento_por uuid constraint fk_documentos_compra_aprovado_orcamento_por references erp.users(id),
  add column pedido_orcado_id uuid,
  add column prazo_entrega_dias integer,
  add column validade_orcamento date;

alter table erp.documentos_compra
  add constraint fk_documentos_compra_pedido_orcado foreign key (pedido_orcado_id, organization_id) references erp.documentos_compra (id, organization_id),
  add constraint chk_documentos_compra_finalizado check (
    (finalizado_em is null and finalizado_por is null)
    or (finalizado_em is not null and finalizado_por is not null and especie = 'pedido' and situacao in ('finalizado','convertido','cancelado'))),
  add constraint chk_documentos_compra_aprovado_orcamento check (
    (aprovado_orcamento_em is null and aprovado_orcamento_por is null)
    or (aprovado_orcamento_em is not null and aprovado_orcamento_por is not null and especie = 'pedido')),
  add constraint chk_documentos_compra_orcamento_do_pedido check ((especie = 'orcamento') = (pedido_orcado_id is not null)),
  add constraint chk_documentos_compra_campos_do_orcamento check (especie = 'orcamento' or (prazo_entrega_dias is null and validade_orcamento is null)),
  add constraint chk_documentos_compra_prazo_entrega check (prazo_entrega_dias is null or prazo_entrega_dias between 0 and 3650);

-- Espécie e situação: drop e add na MESMA instrução (nunca há instante sem CHECK). O conjunto novo CONTÉM o de hoje.
alter table erp.documentos_compra
  drop constraint chk_documentos_compra_especie,
  drop constraint chk_documentos_compra_situacao,
  drop constraint chk_documentos_compra_situacao_especie,
  add constraint chk_documentos_compra_especie check (especie in ('pedido','compra','orcamento')),
  add constraint chk_documentos_compra_situacao check (situacao in ('aberto','confirmado','convertido','cancelado','finalizado','escolhido','nao_escolhido')),
  add constraint chk_documentos_compra_situacao_especie check (
    (especie = 'compra' and situacao in ('aberto','confirmado','cancelado'))
    or (especie = 'pedido' and situacao in ('aberto','finalizado','convertido','cancelado'))
    or (especie = 'orcamento' and situacao in ('aberto','escolhido','nao_escolhido','cancelado')));

-- Os orçamentos de um pedido (a lista e a escolha do vencedor leem por aqui).
create index ix_documentos_compra_pedido_orcado on erp.documentos_compra (pedido_orcado_id) where pedido_orcado_id is not null;
-- Um orçamento VIVO por fornecedor em cada pedido (cancelar libera).
create unique index ux_documentos_compra_orcamento_fornecedor on erp.documentos_compra (organization_id, pedido_orcado_id, fornecedor_id)
  where especie = 'orcamento' and situacao <> 'cancelado';
-- Um vencedor por pedido.
create unique index ux_documentos_compra_orcamento_escolhido on erp.documentos_compra (organization_id, pedido_orcado_id)
  where especie = 'orcamento' and situacao = 'escolhido';

comment on table erp.documentos_compra is 'Documento comercial de compra (COMPRAS-01, decisão 267; orçamento na OPERACOES-01 F6a, decisão 283): pedido de compra, compra e orçamento de compra, variantes pela coluna especie (famílias compras.pedido, compras.compra e compras.orcamento). A compra confirmada dá entrada no estoque e gera os títulos a pagar; o orçamento cota um pedido e não mexe em estoque nem em financeiro.';
comment on column erp.documentos_compra.especie is 'Espécie: pedido (pedido de compra), compra ou orcamento (orçamento de compra, de um fornecedor, ligado ao pedido que cota).';
comment on column erp.documentos_compra.situacao is 'Compra: aberto, confirmado ou cancelado. Pedido: aberto, finalizado (a confirmação do pedido), convertido (saldo recebido por inteiro ou encerrado) ou cancelado. Orçamento: aberto, escolhido (o vencedor), nao_escolhido ou cancelado. Cancelado é final. Transições conferidas por gatilho.';
comment on column erp.documentos_compra.finalizado_em is 'Só pedido: quando foi finalizado (a confirmação do pedido), gravado na passagem aberto → finalizado.';
comment on column erp.documentos_compra.finalizado_por is 'Só pedido: quem finalizou o pedido (gravado junto com finalizado_em).';
comment on column erp.documentos_compra.aprovado_orcamento_em is 'Só pedido: quando foi aprovado para orçamento; gravado uma vez, com o pedido aberto.';
comment on column erp.documentos_compra.aprovado_orcamento_por is 'Só pedido: quem aprovou o pedido para orçamento (gravado junto com aprovado_orcamento_em).';
comment on column erp.documentos_compra.pedido_orcado_id is 'Só orçamento: o pedido de compra que ele cota (FK composta). Não consome saldo nem prende o fornecedor do pedido.';
comment on column erp.documentos_compra.prazo_entrega_dias is 'Só orçamento: prazo de entrega em dias (0 a 3650).';
comment on column erp.documentos_compra.validade_orcamento is 'Só orçamento: até quando o preço vale.';

-- ---------- 4) itens: a ligação do orçamento com o item do pedido ----------
alter table erp.documentos_compra_itens
  add column item_pedido_orcado_id uuid;

alter table erp.documentos_compra_itens
  add constraint fk_documentos_compra_itens_pedido_orcado foreign key (item_pedido_orcado_id, organization_id)
    references erp.documentos_compra_itens (id, organization_id);

-- Uma linha por item do pedido em cada orçamento; e os orçamentos de um item do pedido (a guarda do lado do pedido).
create unique index ux_documentos_compra_itens_pedido_orcado on erp.documentos_compra_itens (documento_id, item_pedido_orcado_id)
  where item_pedido_orcado_id is not null;
create index ix_documentos_compra_itens_pedido_orcado on erp.documentos_compra_itens (item_pedido_orcado_id)
  where item_pedido_orcado_id is not null;

comment on column erp.documentos_compra_itens.item_pedido_orcado_id is 'Só no orçamento: o item do pedido que esta linha cota (mesmo produto e quantidade). Não consome saldo.';

-- ---------- 5) conferência do cabeçalho (v3) ----------
-- O corpo da v2 (0037), com: o pedido do orçamento imutável e conferido no INSERT (pedido ABERTO, APROVADO PARA
-- ORÇAMENTO, da mesma empresa, travado FOR SHARE); o fornecedor do orçamento preso; a finalização e a aprovação
-- para orçamento como transições/carimbos únicos; o documento nasce sem os dois; a origem e o encerramento do
-- saldo aceitam também o pedido FINALIZADO. SECURITY DEFINER estreita: lê o pedido e o cadastro da MESMA
-- organização da linha, devolve só a recusa, sem SQL dinâmico.
create function erp.documentos_compra_conferir_v3() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_especie text;
  v_situacao text;
  v_empresa uuid;
  v_fornecedor uuid;
  v_aprovado_orcamento timestamptz;
  v_fora_do_congelamento text[] := array['situacao', 'atualizado_em'];
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.especie is distinct from old.especie
       or new.empresa_id is distinct from old.empresa_id or new.codigo is distinct from old.codigo then
      raise exception 'VALIDATION_ERROR: Organização, empresa, espécie e código do documento de compra não mudam.' using errcode = 'P0001';
    end if;
    if new.tipo_operacao_id is distinct from old.tipo_operacao_id or new.tipo_operacao_versao_id is distinct from old.tipo_operacao_versao_id then
      raise exception 'VALIDATION_ERROR: O tipo de operação e a versão congelada do documento de compra não mudam depois do lançamento.' using errcode = 'P0001';
    end if;
    -- A origem é identidade da compra, como a TOP: nem aberta ela muda.
    if new.origem_documento_id is distinct from old.origem_documento_id then
      raise exception 'VALIDATION_ERROR: O pedido de origem da compra não muda depois do lançamento.' using errcode = 'P0001';
    end if;
    -- O pedido orçado é identidade do orçamento, do mesmo jeito.
    if new.pedido_orcado_id is distinct from old.pedido_orcado_id then
      raise exception 'VALIDATION_ERROR: O pedido do orçamento de compra não muda depois do lançamento.' using errcode = 'P0001';
    end if;
    -- "Mesmo fornecedor" vale enquanto a ligação existir, dos dois lados; e o orçamento é a proposta DAQUELE
    -- fornecedor (um por fornecedor em cada pedido): trocar o fornecedor seria outro orçamento.
    if new.fornecedor_id is distinct from old.fornecedor_id then
      if new.origem_documento_id is not null then
        raise exception 'VALIDATION_ERROR: O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.' using errcode = 'P0001';
      end if;
      if new.especie = 'pedido' and exists (select 1 from erp.documentos_compra c
                                             where c.origem_documento_id = new.id and c.organization_id = new.organization_id) then
        raise exception 'VALIDATION_ERROR: O fornecedor do pedido de compra não muda depois que o pedido gerou compra.' using errcode = 'P0001';
      end if;
      if new.especie = 'orcamento' then
        raise exception 'VALIDATION_ERROR: O fornecedor do orçamento de compra não muda; cancele o orçamento e lance outro.' using errcode = 'P0001';
      end if;
    end if;
    -- Encerrar o saldo é TRANSIÇÃO: quem, quando e por quê só se gravam na mesma mudança (aberto|finalizado) →
    -- convertido.
    if (new.saldo_encerrado_em, new.saldo_encerrado_por, new.saldo_encerrado_motivo)
         is distinct from (old.saldo_encerrado_em, old.saldo_encerrado_por, old.saldo_encerrado_motivo)
       and not (old.situacao in ('aberto', 'finalizado') and new.situacao = 'convertido') then
      raise exception 'CONFLICT: O saldo do pedido de compra só se encerra na passagem de aberto ou finalizado para convertido.' using errcode = 'P0001';
    end if;
    -- Finalizar é TRANSIÇÃO: quem e quando só se gravam na mesma mudança aberto → finalizado, e nela os dois juntos.
    if old.situacao = 'aberto' and new.situacao = 'finalizado' then
      if new.finalizado_em is null or new.finalizado_por is null then
        raise exception 'CONFLICT: O pedido de compra só registra a finalização na passagem de aberto para finalizado.' using errcode = 'P0001';
      end if;
    elsif (new.finalizado_em, new.finalizado_por) is distinct from (old.finalizado_em, old.finalizado_por) then
      raise exception 'CONFLICT: O pedido de compra só registra a finalização na passagem de aberto para finalizado.' using errcode = 'P0001';
    end if;
    -- A aprovação para orçamento é um carimbo ÚNICO: gravado uma vez, com o pedido aberto, e nunca mais mexido.
    if (new.aprovado_orcamento_em, new.aprovado_orcamento_por) is distinct from (old.aprovado_orcamento_em, old.aprovado_orcamento_por)
       and not (old.situacao = 'aberto' and old.aprovado_orcamento_em is null
                and new.aprovado_orcamento_em is not null and new.aprovado_orcamento_por is not null) then
      raise exception 'CONFLICT: A aprovação para orçamento é registrada uma vez, com o pedido aberto.' using errcode = 'P0001';
    end if;
    -- Cabeçalho CONGELADO fora do aberto: só a situação (e o carimbo abaixo) muda. A única exceção é a do
    -- encerramento do saldo a partir do pedido FINALIZADO, que a regra acima já restringiu à passagem
    -- finalizado → convertido (a partir do aberto, o congelamento nem se aplica).
    if old.situacao = 'finalizado' and new.situacao = 'convertido' then
      v_fora_do_congelamento := v_fora_do_congelamento || array['saldo_encerrado_em', 'saldo_encerrado_por', 'saldo_encerrado_motivo'];
    end if;
    if old.situacao <> 'aberto'
       and (to_jsonb(new) - v_fora_do_congelamento) is distinct from (to_jsonb(old) - v_fora_do_congelamento) then
      raise exception 'CONFLICT: O documento de compra está %; só a situação muda.', old.situacao using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  if tg_op = 'INSERT' and new.situacao <> 'aberto' then
    raise exception 'VALIDATION_ERROR: O documento de compra nasce aberto; a confirmação e o cancelamento são transições.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and (new.finalizado_em is not null or new.finalizado_por is not null
                           or new.aprovado_orcamento_em is not null or new.aprovado_orcamento_por is not null) then
    raise exception 'VALIDATION_ERROR: O documento de compra nasce sem finalização e sem aprovação para orçamento.' using errcode = 'P0001';
  end if;
  -- A origem: um PEDIDO ABERTO OU FINALIZADO da mesma organização, empresa e fornecedor. FOR SHARE segura o pedido
  -- até o fim da transação — o encerramento do saldo e o cancelamento do pedido (que o atualizam) esperam esta
  -- compra commitar ou desfazer, e então a enxergam. A ordem das travas é a da API: pedido primeiro.
  -- Inexistente, compra no lugar de pedido e pedido de OUTRA empresa dão a MESMA recusa: esta função atravessa
  -- a RLS, e uma mensagem própria para "é de outra empresa" diria a quem tem escopo só numa empresa que aquele
  -- id existe na outra. Fornecedor e situação só são ditos depois de a empresa conferir.
  if tg_op = 'INSERT' and new.origem_documento_id is not null then
    select p.especie, p.situacao, p.empresa_id, p.fornecedor_id into v_especie, v_situacao, v_empresa, v_fornecedor
      from erp.documentos_compra p
     where p.id = new.origem_documento_id and p.organization_id = new.organization_id
       for share;
    if v_especie is distinct from 'pedido' or v_empresa is distinct from new.empresa_id then
      raise exception 'VALIDATION_ERROR: A origem da compra precisa ser um pedido de compra da mesma empresa.' using errcode = 'P0001';
    end if;
    if v_fornecedor is distinct from new.fornecedor_id then
      raise exception 'VALIDATION_ERROR: A compra gerada de um pedido é do mesmo fornecedor do pedido.' using errcode = 'P0001';
    end if;
    if v_situacao not in ('aberto', 'finalizado') then
      raise exception 'CONFLICT: O pedido de compra de origem não está aberto (situação: %).', v_situacao using errcode = 'P0001';
    end if;
  end if;
  -- O pedido do orçamento (o CHECK garante: só o orçamento o tem): um PEDIDO da mesma organização e empresa,
  -- ABERTO e APROVADO PARA ORÇAMENTO, travado FOR SHARE como a origem (a finalização, o cancelamento e a escolha
  -- do vencedor, que atualizam o pedido, esperam). Inexistente, outra espécie e outra empresa: a MESMA recusa,
  -- pelo mesmo motivo da origem. Situação e aprovação só são ditas depois de a empresa conferir.
  if tg_op = 'INSERT' and new.pedido_orcado_id is not null then
    select p.especie, p.situacao, p.empresa_id, p.aprovado_orcamento_em into v_especie, v_situacao, v_empresa, v_aprovado_orcamento
      from erp.documentos_compra p
     where p.id = new.pedido_orcado_id and p.organization_id = new.organization_id
       for share;
    if v_especie is distinct from 'pedido' or v_empresa is distinct from new.empresa_id then
      raise exception 'VALIDATION_ERROR: O orçamento de compra precisa ser de um pedido de compra da mesma empresa.' using errcode = 'P0001';
    end if;
    if v_situacao <> 'aberto' then
      raise exception 'CONFLICT: O pedido de compra do orçamento não está aberto (situação: %).', v_situacao using errcode = 'P0001';
    end if;
    if v_aprovado_orcamento is null then
      raise exception 'CONFLICT: O pedido de compra não está aprovado para orçamento.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or new.fornecedor_id is distinct from old.fornecedor_id then
    if not exists (select 1 from erp.people x where x.id = new.fornecedor_id and x.organization_id = new.organization_id
                    and x.is_provider and x.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O fornecedor precisa ser um parceiro do tipo Fornecedor.' using errcode = 'P0001';
    end if;
  end if;
  if new.transportadora_id is not null and (tg_op = 'INSERT' or new.transportadora_id is distinct from old.transportadora_id) then
    if not exists (select 1 from erp.people x where x.id = new.transportadora_id and x.organization_id = new.organization_id
                    and x.is_transporter and x.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: A transportadora precisa ser um parceiro do tipo Transportadora.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from erp.tipos_operacao t where t.id = new.tipo_operacao_id and t.organization_id = new.organization_id
                    and t.codigo_base = 'compras.' || new.especie) then
      raise exception 'VALIDATION_ERROR: O tipo de operação não é da família do documento (compras.%).', new.especie using errcode = 'P0001';
    end if;
  end if;
  if new.forma_pagamento_id is not null and (tg_op = 'INSERT' or new.forma_pagamento_id is distinct from old.forma_pagamento_id) then
    if not exists (select 1 from erp.payment_methods f where f.id = new.forma_pagamento_id
                    and (f.organization_id is null or f.organization_id = new.organization_id)) then
      raise exception 'VALIDATION_ERROR: Forma de pagamento inválida.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_conferir_v3() is
  'OPERACOES-01 F6a (substitui a conferência v2 da 0037): tudo da v2 (parceiros, TOP da família compras.<especie>, forma de pagamento, imutáveis, origem = pedido da mesma empresa e fornecedor FOR SHARE, fornecedor preso à ligação, congelamento fora do aberto, nasce aberto, carimbo atualizado_em) e mais: a origem aceita pedido aberto ou finalizado; o encerramento do saldo vale na passagem (aberto|finalizado) → convertido; pedido_orcado_id imutável e, no INSERT, um pedido aberto, aprovado para orçamento, da mesma empresa (FOR SHARE); fornecedor do orçamento imutável; finalizado_em/por só na passagem aberto → finalizado, os dois juntos; aprovado_orcamento_em/por uma vez, com o pedido aberto; nasce sem finalização e sem aprovação para orçamento.';

-- ---------- 6) transição de situação (v3) ----------
-- SECURITY DEFINER porque lê outras linhas (o pedido com compra ligada não cancelada não se cancela).
create function erp.documentos_compra_transicao_v3() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_antes_de_converter text;
begin
  if new.situacao = old.situacao then
    return new;
  end if;
  if old.situacao = 'cancelado' then
    raise exception 'CONFLICT: O documento de compra está cancelado; o cancelamento é final.' using errcode = 'P0001';
  end if;
  if old.situacao = 'aberto' and new.situacao = 'confirmado' then
    if new.especie = 'orcamento' then
      raise exception 'CONFLICT: Orçamento de compra não é confirmado; ele é escolhido ou não escolhido.' using errcode = 'P0001';
    end if;
    if new.especie <> 'compra' then
      raise exception 'CONFLICT: Pedido de compra não é confirmado.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Finalizar é a confirmação do PEDIDO.
  if old.situacao = 'aberto' and new.situacao = 'finalizado' then
    if new.especie <> 'pedido' then
      raise exception 'CONFLICT: Só o pedido de compra é finalizado.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.situacao in ('aberto', 'finalizado') and new.situacao = 'convertido' then
    if new.especie <> 'pedido' then
      raise exception 'CONFLICT: Só o pedido de compra vira convertido; a compra se confirma.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Reabertura: a compra ligada foi cancelada e o saldo voltou. Com o saldo encerrado, o pedido fica convertido;
  -- sem ele, volta à situação de ANTES de converter — o carimbo da finalização (que nunca se apaga) diz qual.
  if old.situacao = 'convertido' and new.situacao in ('aberto', 'finalizado') then
    if old.saldo_encerrado_em is not null then
      raise exception 'CONFLICT: O saldo deste pedido de compra foi encerrado; ele não reabre.' using errcode = 'P0001';
    end if;
    v_antes_de_converter := case when old.finalizado_em is not null then 'finalizado' else 'aberto' end;
    if new.situacao <> v_antes_de_converter then
      raise exception 'CONFLICT: O pedido de compra reabre na situação de antes de ser convertido (%).', v_antes_de_converter using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.situacao = 'convertido' and new.situacao = 'cancelado' then
    raise exception 'CONFLICT: Pedido de compra convertido não é cancelado; cancele as compras geradas dele.' using errcode = 'P0001';
  end if;
  -- O orçamento sai do aberto escolhido (o vencedor) ou não escolhido; os dois são finais.
  if old.situacao = 'aberto' and new.situacao in ('escolhido', 'nao_escolhido') then
    if new.especie <> 'orcamento' then
      raise exception 'CONFLICT: Só o orçamento de compra é escolhido ou não escolhido.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.situacao = 'cancelado' and old.situacao in ('aberto', 'confirmado', 'finalizado') then
    if new.especie = 'pedido' and exists (select 1 from erp.documentos_compra c
                                           where c.origem_documento_id = new.id and c.organization_id = new.organization_id
                                             and c.situacao <> 'cancelado') then
      raise exception 'CONFLICT: Este pedido tem compras: cancele-as ou encerre o saldo.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'CONFLICT: Transição de situação inválida no documento de compra (% para %).', old.situacao, new.situacao using errcode = 'P0001';
end $$;
comment on function erp.documentos_compra_transicao_v3() is
  'OPERACOES-01 F6a (substitui a transição v2 da 0037): aberto→confirmado (só compra), aberto→finalizado (só pedido), (aberto|finalizado)→convertido (só pedido), convertido→(aberto|finalizado) só sem saldo encerrado e para a situação de antes de converter (finalizado se finalizado_em existe), aberto→escolhido/nao_escolhido (só orçamento), (aberto|confirmado|finalizado)→cancelado (pedido só sem compra ligada não cancelada); convertido→cancelado recusado; finalizado→aberto, escolhido e nao_escolhido e cancelado são finais.';

-- ---------- 7) a guarda da origem nos itens (v2) ----------
-- O corpo da 0037, com UMA mudança: o pedido de origem aceito é o aberto OU o finalizado. Ordem das travas:
-- pedido (FOR SHARE) → item de origem (FOR UPDATE) — a mesma da API.
create function erp.documentos_compra_item_origem_guarda_v2() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_especie text;
  v_origem_doc uuid;
  v_pedido_situacao text;
  v_item_doc uuid;
  v_item_produto uuid;
  v_item_qtd numeric;
  v_ligado numeric;
  v_ligacoes int;
begin
  select d.especie, d.origem_documento_id into v_especie, v_origem_doc
    from erp.documentos_compra d where d.id = new.documento_id and d.organization_id = new.organization_id;

  if v_origem_doc is null then
    if new.origem_item_id is not null then
      raise exception 'VALIDATION_ERROR: Só a compra gerada de um pedido liga item a item de pedido.' using errcode = 'P0001';
    end if;
    -- Item do pedido que já foi recebido: nem menos do que o recebido, nem outro produto.
    if tg_op = 'UPDATE' and v_especie = 'pedido'
       and (new.quantidade is distinct from old.quantidade or new.produto_id is distinct from old.produto_id) then
      select coalesce(sum(i.quantidade), 0), count(*) into v_ligado, v_ligacoes
        from erp.documentos_compra_itens i
        join erp.documentos_compra c on c.id = i.documento_id and c.organization_id = i.organization_id
       where i.origem_item_id = new.id and i.organization_id = new.organization_id and c.situacao <> 'cancelado';
      if v_ligacoes > 0 and new.produto_id is distinct from old.produto_id then
        raise exception 'VALIDATION_ERROR: O item do pedido de compra já recebido não troca de produto.' using errcode = 'P0001';
      end if;
      if v_ligado > new.quantidade then
        raise exception 'VALIDATION_ERROR: A quantidade do item do pedido de compra não fica abaixo do que já foi recebido.' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  if new.origem_item_id is null then
    raise exception 'VALIDATION_ERROR: A compra gerada de um pedido liga todo item a um item do pedido.' using errcode = 'P0001';
  end if;
  select p.situacao into v_pedido_situacao
    from erp.documentos_compra p where p.id = v_origem_doc and p.organization_id = new.organization_id for share;
  -- A trava do item de origem serializa duas partes simultâneas sobre o mesmo saldo: a segunda espera a
  -- primeira terminar, e a soma abaixo (comando novo, fotografia nova) já a enxerga.
  select i.documento_id, i.produto_id, i.quantidade into v_item_doc, v_item_produto, v_item_qtd
    from erp.documentos_compra_itens i
   where i.id = new.origem_item_id and i.organization_id = new.organization_id
     for update;
  if v_item_doc is null or v_item_doc <> v_origem_doc then
    raise exception 'VALIDATION_ERROR: O item de origem não pertence ao pedido de origem desta compra.' using errcode = 'P0001';
  end if;
  if v_item_produto <> new.produto_id then
    raise exception 'VALIDATION_ERROR: O produto do item da compra difere do produto do item do pedido.' using errcode = 'P0001';
  end if;
  if v_pedido_situacao is distinct from 'aberto' and v_pedido_situacao is distinct from 'finalizado' then
    raise exception 'CONFLICT: O pedido de compra de origem não está aberto (situação: %).', v_pedido_situacao using errcode = 'P0001';
  end if;
  select coalesce(sum(i.quantidade), 0) into v_ligado
    from erp.documentos_compra_itens i
    join erp.documentos_compra c on c.id = i.documento_id and c.organization_id = i.organization_id
   where i.origem_item_id = new.origem_item_id and i.organization_id = new.organization_id
     and c.situacao <> 'cancelado'
     and i.id <> new.id;
  if v_ligado + new.quantidade > v_item_qtd then
    raise exception 'VALIDATION_ERROR: A quantidade passa do saldo do item do pedido de compra.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_item_origem_guarda_v2() is
  'OPERACOES-01 F6a (substitui a guarda da origem da 0037): compra com origem liga todo item a um item do pedido citado no cabeçalho (mesmo produto, pedido aberto OU finalizado, item de origem travado FOR UPDATE, soma ligada em compras não canceladas ≤ quantidade); compra sem origem não liga item; item do pedido não fica abaixo do recebido nem troca de produto recebido.';

-- ---------- 8) a guarda dos itens do orçamento (nova) ----------
-- Ordem alfabética dos BEFORE dos itens: …_documento_aberto (documento existe e está aberto) → …_orcamento_guarda
-- → …_origem_guarda. Quando esta roda, o cabeçalho existe e está aberto.
create function erp.documentos_compra_item_orcamento_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_especie text;
  v_pedido uuid;
  v_item_doc uuid;
  v_item_produto uuid;
  v_item_qtd numeric;
begin
  select d.especie, d.pedido_orcado_id into v_especie, v_pedido
    from erp.documentos_compra d where d.id = new.documento_id and d.organization_id = new.organization_id;

  if v_especie is distinct from 'orcamento' then
    if new.item_pedido_orcado_id is not null then
      raise exception 'VALIDATION_ERROR: Só o orçamento de compra liga item a item do pedido orçado.' using errcode = 'P0001';
    end if;
    -- Do lado do pedido: o item já cotado por orçamento não cancelado fica com o produto e a quantidade cotados.
    if tg_op = 'UPDATE' and v_especie = 'pedido'
       and (new.quantidade is distinct from old.quantidade or new.produto_id is distinct from old.produto_id)
       and exists (select 1 from erp.documentos_compra_itens i
                     join erp.documentos_compra o on o.id = i.documento_id and o.organization_id = i.organization_id
                    where i.item_pedido_orcado_id = new.id and i.organization_id = new.organization_id
                      and o.situacao <> 'cancelado') then
      raise exception 'VALIDATION_ERROR: O item do pedido de compra já orçado não troca de produto nem de quantidade.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.item_pedido_orcado_id is null then
    raise exception 'VALIDATION_ERROR: O orçamento de compra liga todo item a um item do pedido.' using errcode = 'P0001';
  end if;
  if new.lote is not null or new.validade is not null then
    raise exception 'VALIDATION_ERROR: Orçamento de compra não tem lote nem validade.' using errcode = 'P0001';
  end if;
  -- FOR SHARE na linha do pedido: a troca concorrente do produto ou da quantidade dela (que a atualiza) espera
  -- este orçamento terminar, e então o enxerga pela guarda do lado do pedido, acima.
  select i.documento_id, i.produto_id, i.quantidade into v_item_doc, v_item_produto, v_item_qtd
    from erp.documentos_compra_itens i
   where i.id = new.item_pedido_orcado_id and i.organization_id = new.organization_id
     for share;
  if v_item_doc is null or v_item_doc is distinct from v_pedido then
    raise exception 'VALIDATION_ERROR: O item orçado não pertence ao pedido do orçamento.' using errcode = 'P0001';
  end if;
  if v_item_produto is distinct from new.produto_id or v_item_qtd is distinct from new.quantidade then
    raise exception 'VALIDATION_ERROR: O item do orçamento tem o produto e a quantidade do item do pedido.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_item_orcamento_guarda() is
  'OPERACOES-01 F6a: o orçamento liga todo item a um item do pedido orçado no cabeçalho (mesmo produto e mesma quantidade, linha do pedido travada FOR SHARE), sem lote nem validade; só o orçamento liga item a item do pedido orçado; o item do pedido cotado por orçamento não cancelado não troca de produto nem de quantidade. Não consome saldo.';

-- ---------- 9) a aprovação do pedido: conferência da decisão (v2) e a guarda da finalização ----------
-- 9.1 O corpo da 0041 com UMA mudança: o documento decidido é de espécie 'compra' OU 'pedido' (no WHERE da leitura
-- FOR SHARE, onde mora todo o filtro da NOT_FOUND). O resto — usuário da GUC → organização da GUC → empresa no
-- escopo de escrita → leitura filtrada → aberto → atribuições → exigência — e as mensagens, iguais.
create function erp.aprovacoes_compra_conferir_v2() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_usuario uuid := erp.current_user_id();
  v_org uuid := erp.current_org_id();
  v_doc record;
  v_configuracao jsonb;
begin
  if v_usuario is null then
    raise exception 'PERMISSION_DENIED: A decisão de aprovação precisa de um usuário identificado.' using errcode = 'P0001';
  end if;
  -- A organização da GUC, nunca a da linha: outra, ou nenhuma, é a NOT_FOUND sem ler nada.
  if v_org is null or new.organization_id is distinct from v_org then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  -- A empresa da linha no escopo de escrita de quem decide, no módulo da transação: fora dele, a NOT_FOUND sem
  -- ler nada.
  if not erp.empresa_escrita_permitida(new.empresa_id) then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  -- O filtro inteiro da NOT_FOUND no WHERE: documento de outra empresa ou orçamento de compra não é lido nem
  -- travado, e a recusa não espera a trava de ninguém.
  select d.situacao, d.valor_total, d.tipo_operacao_id, d.tipo_operacao_versao_id
    into v_doc
    from erp.documentos_compra d
   where d.id = new.documento_id and d.organization_id = v_org
     and d.empresa_id = new.empresa_id and d.especie in ('compra', 'pedido')
     for share;
  -- Inexistente na organização, outra empresa ou orçamento de compra: a MESMA recusa.
  if not found then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  if v_doc.situacao <> 'aberto' then
    raise exception 'CONFLICT: Só documento aberto passa por aprovação.' using errcode = 'P0001';
  end if;
  new.tipo_operacao_id := v_doc.tipo_operacao_id;
  new.tipo_operacao_versao_id := v_doc.tipo_operacao_versao_id;
  new.valor_documento := v_doc.valor_total;
  new.decidido_por := v_usuario;
  new.decidido_em := now();
  select v.configuracao into v_configuracao
    from erp.tipos_operacao_versoes v
   where v.id = v_doc.tipo_operacao_versao_id and v.organization_id = v_org;
  if not erp.top_exige_aprovacao(v_configuracao, v_doc.valor_total) then
    raise exception 'APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.aprovacoes_compra_conferir_v2() is
  'OPERACOES-01 F6a (substitui a conferência da 0041): decisão de compra OU de pedido de compra só com usuário e organização da GUC do servidor (linha de outra organização, ou sem GUC: NOT_FOUND antes de qualquer leitura) e com a empresa da linha no escopo de escrita de quem decide no módulo da transação (erp.empresa_escrita_permitida; fora dele: NOT_FOUND antes de qualquer leitura), para documento de compra de espécie compra ou pedido dessa organização e da empresa da linha (orçamento: NOT_FOUND), aberto, que exige aprovação pelo valor total atual; atribui TOP, versão congelada, valor, decidido_por e decidido_em do documento e da transação.';

-- 9.2 A guarda da finalização: o molde da guarda da compra (0041), lendo a decisão do PEDIDO, com mensagens que
-- dizem "finalizado". Fail-closed na conta: a versão de antes E a de depois, e o MAIOR valor entre os dois. A
-- aprovação só cobre o que aprovou: o valor (≥ o MAIOR dos dois) e a versão da TOP (= a de depois). A organização
-- é a OLD.organization_id da linha que o UPDATE já alcançou (o UPDATE sem GUC continua guardado).
create function erp.documentos_compra_finalizacao_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_decisao text;
  v_valor numeric(18,2);
  v_versao uuid;
begin
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = old.organization_id
                    and v.id in (old.tipo_operacao_versao_id, new.tipo_operacao_versao_id)
                    and erp.top_exige_aprovacao(v.configuracao, greatest(old.valor_total, new.valor_total))) then
    return new;
  end if;
  select a.decisao, a.valor_documento, a.tipo_operacao_versao_id into v_decisao, v_valor, v_versao
    from erp.aprovacoes_compra a
   where a.organization_id = old.organization_id and a.documento_id = old.id
   order by a.id desc
   limit 1;
  if v_decisao is null then
    raise exception 'CONFLICT: Este pedido de compra precisa de aprovação antes de ser finalizado.' using errcode = 'P0001';
  end if;
  if v_decisao <> 'aprovado' then
    raise exception 'CONFLICT: Este pedido de compra foi reprovado e não pode ser finalizado.' using errcode = 'P0001';
  end if;
  -- "is not true": comparação nula não vale como aprovação.
  if (v_valor >= greatest(old.valor_total, new.valor_total)) is not true
     or v_versao is distinct from new.tipo_operacao_versao_id then
    raise exception 'CONFLICT: Este pedido de compra precisa de aprovação antes de ser finalizado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_finalizacao_guarda() is
  'OPERACOES-01 F6a: o pedido de compra que exige aprovação (versão congelada no formato 4 ou maior) só passa de aberto a finalizado com a última decisão aprovada, e só se essa aprovação cobre o que o UPDATE finaliza (valor aprovado >= o maior valor_total entre antes e depois; versão da TOP aprovada = a de depois); senão, CONFLICT com mensagem fixa.';

-- ---------- 10) troca dos gatilhos (mesmos nomes), os dois novos e a remoção das funções antigas ----------
-- Mesmo nome = mesma posição na ordem alfabética de disparo. No cabeçalho, os BEFORE UPDATE passam a ser:
-- aprovacao (0041) → conferir → finalizacao → transicao.
drop trigger trg_documentos_compra_conferir on erp.documentos_compra;
create trigger trg_documentos_compra_conferir
  before insert or update on erp.documentos_compra
  for each row execute function erp.documentos_compra_conferir_v3();

drop trigger trg_documentos_compra_transicao on erp.documentos_compra;
create trigger trg_documentos_compra_transicao
  before update of situacao on erp.documentos_compra
  for each row execute function erp.documentos_compra_transicao_v3();

create trigger trg_documentos_compra_finalizacao
  before update of situacao on erp.documentos_compra
  for each row
  when (OLD.situacao = 'aberto' and NEW.situacao = 'finalizado' and NEW.especie = 'pedido')
  execute function erp.documentos_compra_finalizacao_guarda();

drop trigger trg_documentos_compra_itens_origem_guarda on erp.documentos_compra_itens;
create trigger trg_documentos_compra_itens_origem_guarda
  before insert or update of origem_item_id, quantidade, produto_id on erp.documentos_compra_itens
  for each row execute function erp.documentos_compra_item_origem_guarda_v2();

create trigger trg_documentos_compra_itens_orcamento_guarda
  before insert or update of item_pedido_orcado_id, quantidade, produto_id, lote, validade on erp.documentos_compra_itens
  for each row execute function erp.documentos_compra_item_orcamento_guarda();

drop trigger trg_aprovacoes_compra_conferir on erp.aprovacoes_compra;
create trigger trg_aprovacoes_compra_conferir
  before insert on erp.aprovacoes_compra
  for each row execute function erp.aprovacoes_compra_conferir_v2();

-- Sem cascata: se algo além dos gatilhos trocados apontasse para elas, o drop PARA a migration.
drop function erp.documentos_compra_conferir_v2();
drop function erp.documentos_compra_transicao_v2();
drop function erp.documentos_compra_item_origem_guarda();
drop function erp.aprovacoes_compra_conferir();

comment on table erp.aprovacoes_compra is 'Decisões de aprovação do documento de compra (TOP-CONFIG-08, decisão 277; o pedido na OPERACOES-01 F6a, decisão 283): espécie compra (antes de confirmar) ou pedido (antes de finalizar). Uma linha por decisão, só inserção. A vigente é a última (id desc), enquanto o documento estiver aberto.';
comment on column erp.aprovacoes_compra.documento_id is 'Documento de compra decidido, espécie compra ou pedido (FK composta com a organização).';

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos (o
-- laço da 0037; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('documentos_compra_conferir_v3', 'documentos_compra_transicao_v3', 'documentos_compra_item_origem_guarda_v2',
                         'documentos_compra_item_orcamento_guarda', 'documentos_compra_finalizacao_guarda', 'aprovacoes_compra_conferir_v2')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 11) a família do layout: as cinco da 0038 e compras.orcamento ----------
-- Drop e add na MESMA instrução (o nome é o mesmo): não existe instante sem o CHECK. Lista ESTÁTICA; a
-- pré-condição 2.9 provou que toda família aceita hoje está nela.
alter table erp.layouts_documento
  drop constraint chk_layouts_documento_familia,
  add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda', 'compras.pedido', 'compras.compra', 'compras.orcamento'));

comment on column erp.layouts_documento.familia is 'Família canônica do documento: vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido, compras.compra ou compras.orcamento. Uma TOP só se liga a layout da própria família (gatilho).';

-- ---------- 12) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_lista text[];
  v_def text;
  v_validado boolean;
begin
  -- 12.1 As oito colunas novas: tipo e nulidade.
  select array_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable order by table_name, column_name) into v_lista
    from information_schema.columns
   where table_schema = 'erp'
     and ((table_name = 'documentos_compra' and column_name in ('finalizado_em', 'finalizado_por', 'aprovado_orcamento_em', 'aprovado_orcamento_por',
                                                                'pedido_orcado_id', 'prazo_entrega_dias', 'validade_orcamento'))
       or (table_name = 'documentos_compra_itens' and column_name = 'item_pedido_orcado_id'));
  if v_lista is distinct from array['documentos_compra.aprovado_orcamento_em:timestamp with time zone:YES', 'documentos_compra.aprovado_orcamento_por:uuid:YES',
                                    'documentos_compra.finalizado_em:timestamp with time zone:YES', 'documentos_compra.finalizado_por:uuid:YES',
                                    'documentos_compra.pedido_orcado_id:uuid:YES', 'documentos_compra.prazo_entrega_dias:integer:YES',
                                    'documentos_compra.validade_orcamento:date:YES', 'documentos_compra_itens.item_pedido_orcado_id:uuid:YES'] then
    raise exception 'OPERACOES-01 F6a: colunas novas ausentes ou com tipo/nulidade errados: %', v_lista;
  end if;

  -- 12.2 As FKs: as do vínculo do orçamento compostas (coluna + organização), para a PRÓPRIA tabela, sem cascata; as
  -- dos carimbos, para erp.users.
  if not exists (select 1 from pg_constraint c
                  where c.conname = 'fk_documentos_compra_pedido_orcado' and c.contype = 'f'
                    and c.conrelid = 'erp.documentos_compra'::regclass and c.confrelid = 'erp.documentos_compra'::regclass
                    and c.confdeltype = 'a' and c.confupdtype = 'a'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'pedido_orcado_id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[]
                    and c.confkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'id'),
                                          (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[])
     or not exists (select 1 from pg_constraint c
                     where c.conname = 'fk_documentos_compra_itens_pedido_orcado' and c.contype = 'f'
                       and c.conrelid = 'erp.documentos_compra_itens'::regclass and c.confrelid = 'erp.documentos_compra_itens'::regclass
                       and c.confdeltype = 'a' and c.confupdtype = 'a'
                       and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'item_pedido_orcado_id'),
                                            (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]
                       and c.confkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'id'),
                                             (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'OPERACOES-01 F6a: FK composta do orcamento (pedido_orcado_id, organization_id) -> erp.documentos_compra (id, organization_id) ou (item_pedido_orcado_id, organization_id) -> erp.documentos_compra_itens (id, organization_id), sem cascata, ausente ou diferente.';
  end if;
  if (select count(*) from pg_constraint c
       where c.contype = 'f' and c.conrelid = 'erp.documentos_compra'::regclass and c.confrelid = 'erp.users'::regclass
         and c.confdeltype = 'a' and c.confupdtype = 'a'
         and ((c.conname = 'fk_documentos_compra_finalizado_por'
               and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'finalizado_por')]::int2[])
           or (c.conname = 'fk_documentos_compra_aprovado_orcamento_por'
               and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'aprovado_orcamento_por')]::int2[]))) <> 2 then
    raise exception 'OPERACOES-01 F6a: FK de quem finalizou ou de quem aprovou para orcamento (-> erp.users, sem cascata) ausente.';
  end if;

  -- 12.3 Os CHECKs: vinte (quinze de hoje + cinco novos), todos validados; os três refeitos com os valores novos.
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk\_documentos\_compra\_%') <> 20
     or (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and convalidated
           and conname in ('chk_documentos_compra_finalizado', 'chk_documentos_compra_aprovado_orcamento', 'chk_documentos_compra_orcamento_do_pedido',
                           'chk_documentos_compra_campos_do_orcamento', 'chk_documentos_compra_prazo_entrega')) <> 5
     or exists (select 1 from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk\_documentos\_compra\_%' and not convalidated) then
    raise exception 'OPERACOES-01 F6a: CHECKs de erp.documentos_compra incompletos ou nao validados (esperados 20, com finalizado, aprovado_orcamento, orcamento_do_pedido, campos_do_orcamento e prazo_entrega).';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_especie' and c.contype = 'c';
  if (select array_agg(m[1] order by m[1] collate "C") from regexp_matches(coalesce(v_def, ''), '''([^'']*)''', 'g') m) is distinct from array['compra', 'orcamento', 'pedido'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_especie nao aceita exatamente pedido, compra e orcamento: %', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_situacao' and c.contype = 'c';
  if (select array_agg(m[1] order by m[1] collate "C") from regexp_matches(coalesce(v_def, ''), '''([^'']*)''', 'g') m)
       is distinct from array['aberto', 'cancelado', 'confirmado', 'convertido', 'escolhido', 'finalizado', 'nao_escolhido'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_situacao nao aceita exatamente aberto, confirmado, convertido, cancelado, finalizado, escolhido e nao_escolhido: %', v_def;
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_situacao_especie' and c.contype = 'c';
  if v_def is null or (select array_agg(x.m[1] order by x.o) from regexp_matches(v_def, '''([^'']*)''', 'g') with ordinality x(m, o))
                      is distinct from array['compra', 'aberto', 'confirmado', 'cancelado', 'pedido', 'aberto', 'finalizado', 'convertido', 'cancelado',
                                             'orcamento', 'aberto', 'escolhido', 'nao_escolhido', 'cancelado'] then
    raise exception 'OPERACOES-01 F6a: chk_documentos_compra_situacao_especie diferente do esperado (compra aberto/confirmado/cancelado; pedido aberto/finalizado/convertido/cancelado; orcamento aberto/escolhido/nao_escolhido/cancelado): %', v_def;
  end if;

  -- 12.4 Os índices: os cinco existem; os dois do vencedor/fornecedor e o da linha do orçamento são únicos; todos parciais.
  if to_regclass('erp.ix_documentos_compra_pedido_orcado') is null or to_regclass('erp.ux_documentos_compra_orcamento_fornecedor') is null
     or to_regclass('erp.ux_documentos_compra_orcamento_escolhido') is null or to_regclass('erp.ux_documentos_compra_itens_pedido_orcado') is null
     or to_regclass('erp.ix_documentos_compra_itens_pedido_orcado') is null
     or (select count(*) from pg_index i
          where i.indexrelid in (to_regclass('erp.ux_documentos_compra_orcamento_fornecedor'), to_regclass('erp.ux_documentos_compra_orcamento_escolhido'),
                                 to_regclass('erp.ux_documentos_compra_itens_pedido_orcado'))
            and i.indisunique and i.indpred is not null) <> 3
     or (select count(*) from pg_index i
          where i.indexrelid in (to_regclass('erp.ix_documentos_compra_pedido_orcado'), to_regclass('erp.ix_documentos_compra_itens_pedido_orcado'))
            and not i.indisunique and i.indpred is not null) <> 2 then
    raise exception 'OPERACOES-01 F6a: indices do orcamento (ix_documentos_compra_pedido_orcado, ux_documentos_compra_orcamento_fornecedor, ux_documentos_compra_orcamento_escolhido, ux_documentos_compra_itens_pedido_orcado, ix_documentos_compra_itens_pedido_orcado) ausentes, nao parciais ou sem a unicidade esperada.';
  end if;

  -- 12.5 Os gatilhos: o conjunto EXATO dos do usuário no documento de compra (cabeçalho e itens), por nome E por
  -- função, todos ligados; e a conferência da decisão na v2.
  select array_agg(t.tgname || ' -> ' || p.proname order by t.tgname collate "C") into v_lista
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass);
  if v_lista is distinct from array[
       'trg_documentos_compra_aprovacao -> documentos_compra_aprovacao_guarda', 'trg_documentos_compra_audit -> audit_row',
       'trg_documentos_compra_conferir -> documentos_compra_conferir_v3', 'trg_documentos_compra_finalizacao -> documentos_compra_finalizacao_guarda',
       'trg_documentos_compra_itens_documento_aberto -> documentos_compra_itens_documento_aberto',
       'trg_documentos_compra_itens_orcamento_guarda -> documentos_compra_item_orcamento_guarda',
       'trg_documentos_compra_itens_origem_guarda -> documentos_compra_item_origem_guarda_v2',
       'trg_documentos_compra_transicao -> documentos_compra_transicao_v3']
     or exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'O'
                 and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass)) then
    raise exception 'OPERACOES-01 F6a: gatilhos do documento de compra diferentes do esperado (aprovacao, audit, conferir v3, finalizacao, itens_documento_aberto, itens_orcamento_guarda, itens_origem_guarda v2, transicao v3) ou desligados: %', v_lista;
  end if;
  -- Tipo (tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 16 UPDATE), colunas e WHEN dos trocados e dos novos.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and ((t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_conferir'
               and t.tgfoid = 'erp.documentos_compra_conferir_v3()'::regprocedure
               and t.tgtype = (1 | 2 | 4 | 16) and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null)
           or (t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_transicao'
               and t.tgfoid = 'erp.documentos_compra_transicao_v3()'::regprocedure
               and t.tgtype = (1 | 2 | 16) and t.tgqual is null
               and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'situacao')]::int2[])
           or (t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_finalizacao'
               and t.tgfoid = 'erp.documentos_compra_finalizacao_guarda()'::regprocedure
               and t.tgtype = (1 | 2 | 16) and t.tgqual is not null
               and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'situacao')]::int2[])
           or (t.tgrelid = 'erp.documentos_compra_itens'::regclass and t.tgname = 'trg_documentos_compra_itens_origem_guarda'
               and t.tgfoid = 'erp.documentos_compra_item_origem_guarda_v2()'::regprocedure
               and t.tgtype = (1 | 2 | 4 | 16) and t.tgqual is null
               and (select array_agg(x order by x) from unnest(t.tgattr) x)
                   = (select array_agg(attnum order by attnum) from pg_attribute
                       where attrelid = 'erp.documentos_compra_itens'::regclass and attname in ('origem_item_id', 'quantidade', 'produto_id')))
           or (t.tgrelid = 'erp.documentos_compra_itens'::regclass and t.tgname = 'trg_documentos_compra_itens_orcamento_guarda'
               and t.tgfoid = 'erp.documentos_compra_item_orcamento_guarda()'::regprocedure
               and t.tgtype = (1 | 2 | 4 | 16) and t.tgqual is null
               and (select array_agg(x order by x) from unnest(t.tgattr) x)
                   = (select array_agg(attnum order by attnum) from pg_attribute
                       where attrelid = 'erp.documentos_compra_itens'::regclass and attname in ('item_pedido_orcado_id', 'quantidade', 'produto_id', 'lote', 'validade')))
           or (t.tgrelid = 'erp.aprovacoes_compra'::regclass and t.tgname = 'trg_aprovacoes_compra_conferir'
               and t.tgfoid = 'erp.aprovacoes_compra_conferir_v2()'::regprocedure
               and t.tgtype = (1 | 2 | 4) and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null))) <> 6 then
    raise exception 'OPERACOES-01 F6a: gatilhos trocados ou novos fora da forma (conferir BEFORE INSERT OR UPDATE; transicao e finalizacao BEFORE UPDATE OF situacao, a finalizacao com WHEN; itens_origem_guarda e itens_orcamento_guarda BEFORE INSERT OR UPDATE OF as suas colunas, sem WHEN; aprovacoes_compra_conferir BEFORE INSERT na v2).';
  end if;
  if pg_get_triggerdef((select t.oid from pg_trigger t where t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_finalizacao'))
       not like '%WHEN (((old.situacao = ''aberto''::text) AND (new.situacao = ''finalizado''::text) AND (new.especie = ''pedido''::text)))%' then
    raise exception 'OPERACOES-01 F6a: o WHEN de trg_documentos_compra_finalizacao nao e a passagem aberto -> finalizado do pedido.';
  end if;

  -- 12.6 As funções antigas foram trocadas, não duplicadas.
  if to_regprocedure('erp.documentos_compra_conferir_v2()') is not null or to_regprocedure('erp.documentos_compra_transicao_v2()') is not null
     or to_regprocedure('erp.documentos_compra_item_origem_guarda()') is not null or to_regprocedure('erp.aprovacoes_compra_conferir()') is not null then
    raise exception 'OPERACOES-01 F6a: funcoes substituidas ainda existem (conferir_v2, transicao_v2, item_origem_guarda, aprovacoes_compra_conferir); a troca nao terminou.';
  end if;

  -- 12.7 A enumeração pelo NOME (o mesmo critério da pré-condição 2.6) dá exatamente as oito de agora; as SEIS
  -- novas são SECURITY DEFINER, voláteis, com search_path "erp, pg_temp" e EXECUTE só do dono.
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                   order by (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') collate "C") into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.proname like 'aprovacoes\_compra%');
  if v_lista is distinct from array['erp.aprovacoes_compra_conferir_v2()', 'erp.documentos_compra_aprovacao_guarda()', 'erp.documentos_compra_conferir_v3()',
                                    'erp.documentos_compra_finalizacao_guarda()', 'erp.documentos_compra_item_orcamento_guarda()',
                                    'erp.documentos_compra_item_origem_guarda_v2()', 'erp.documentos_compra_itens_documento_aberto()',
                                    'erp.documentos_compra_transicao_v3()'] then
    raise exception 'OPERACOES-01 F6a: funcoes SECURITY DEFINER de compras diferentes das oito esperadas depois da 0044: %', v_lista;
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('erp.documentos_compra_conferir_v3()'::regprocedure, 'erp.documentos_compra_transicao_v3()'::regprocedure,
                       'erp.documentos_compra_item_origem_guarda_v2()'::regprocedure, 'erp.documentos_compra_item_orcamento_guarda()'::regprocedure,
                       'erp.documentos_compra_finalizacao_guarda()'::regprocedure, 'erp.aprovacoes_compra_conferir_v2()'::regprocedure)
         and p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=erp, pg_temp']) <> 6 then
    raise exception 'OPERACOES-01 F6a: funcoes novas de compras sem SECURITY DEFINER, nao volateis ou sem search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.documentos_compra_conferir_v3()'::regprocedure, 'erp.documentos_compra_transicao_v3()'::regprocedure,
                              'erp.documentos_compra_item_origem_guarda_v2()'::regprocedure, 'erp.documentos_compra_item_orcamento_guarda()'::regprocedure,
                              'erp.documentos_compra_finalizacao_guarda()'::regprocedure, 'erp.aprovacoes_compra_conferir_v2()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'OPERACOES-01 F6a: EXECUTE das funcoes de gatilho novas de compras ainda concedido alem do dono.';
  end if;

  -- 12.8 A família do layout: validado, na coluna familia, com as seis famílias EXATAS.
  select pg_get_constraintdef(c.oid), c.convalidated into v_def, v_validado
    from pg_constraint c
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.layouts_documento'::regclass and attname = 'familia')]::int2[];
  if v_def is null or not v_validado
     or (select array_agg(m[1] order by m[1] collate "C") from regexp_matches(v_def, '''([^'']*)''', 'g') m)
        is distinct from array['compras.compra', 'compras.orcamento', 'compras.pedido', 'vendas.orcamento', 'vendas.pedido', 'vendas.venda'] then
    raise exception 'OPERACOES-01 F6a: chk_layouts_documento_familia ausente, fora da coluna familia, nao validado ou sem exatamente as seis familias: %', v_def;
  end if;
end $$;
