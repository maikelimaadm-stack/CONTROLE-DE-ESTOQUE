-- =====================================================================
-- 0037 COMPRAS-02 — RECEBER O PEDIDO DE COMPRA (INTEIRO OU EM PARTES) E ENCERRAR O SALDO — decisão 268
--
-- 1) erp.documentos_compra.origem_documento_id: a compra gerada de um pedido aponta o pedido. Só a compra tem
--    origem (CHECK), e a FK é COMPOSTA com a organização para o próprio erp.documentos_compra (coluna única não
--    prova tenant). O gatilho de conferência confere, no INSERT, que a origem é um PEDIDO ABERTO da mesma
--    empresa e do mesmo fornecedor, e trava o pedido (FOR SHARE) até o fim da transação: o encerramento do
--    saldo ou o cancelamento concorrente do pedido esperam, em vez de acontecer ao lado de uma compra que ainda
--    não commitou. A origem NÃO muda depois do INSERT (como a TOP): ela é parte da identidade da compra.
--    O fornecedor também não muda depois que a ligação existe, dos dois lados (compra com origem; pedido que
--    gerou compra) — senão "mesmo fornecedor" valeria só no instante do INSERT.
-- 2) erp.documentos_compra.saldo_encerrado_{em,por,motivo}: o encerramento manual do saldo do pedido (quem,
--    quando, por quê). Os três juntos ou nenhum, só no pedido, só convertido, motivo não vazio (CHECK). Mudam
--    SÓ na MESMA mudança aberto → convertido (gatilho): encerrar é uma transição, não uma edição.
-- 3) Situação do pedido: aberto | convertido | cancelado ('convertido' só no pedido; 'confirmado' só na compra —
--    os CHECKs de situação são refeitos só para ACRESCENTAR 'convertido' ao pedido). Transições novas
--    (gatilho): pedido aberto → convertido; pedido convertido → aberto (a reabertura, quando uma compra ligada é
--    cancelada) SÓ sem saldo encerrado; convertido → cancelado RECUSADO (o pedido convertido se desfaz
--    cancelando as compras dele); pedido com compra ligada NÃO cancelada não é cancelado. O congelamento da
--    COMPRAS-01 continua: fora do aberto, só a situação muda.
-- 4) erp.documentos_compra_itens: chave (id, organization_id) e origem_item_id, com FK composta para o próprio
--    erp.documentos_compra_itens. O SALDO de um item do pedido é quantidade − soma das quantidades ligadas a ele
--    em compras NÃO canceladas (conta, não coluna: cancelar a compra devolve o saldo sem ninguém atualizar
--    nada — o mesmo desenho da 0034). O saldo é só de QUANTIDADE: preço e desconto são os da nota.
-- 5) INVARIANTE NO BANCO (gatilho da origem, padrão da 0034): compra COM origem liga TODO item a um item do
--    pedido citado no cabeçalho, com o mesmo produto, e a soma ligada não passa da quantidade de origem; compra
--    SEM origem não liga item nenhum. O item de origem é travado FOR UPDATE: duas partes simultâneas sobre o
--    mesmo saldo se enfileiram, e a segunda soma a primeira. A API confere antes, com mensagem amigável; o
--    gatilho é a rede. Do lado do pedido: o item não baixa a quantidade para menos do que já foi recebido, nem
--    troca de produto depois de recebido.
-- 6) Funções da 0036 que mudam: novas com sufixo _v2, os gatilhos (MESMOS nomes, e portanto a mesma ordem de
--    disparo) trocados para elas, e as antigas removidas — sem `create or replace`: a pré-condição prova que a
--    função nova não existe, e o `drop function` sem cascata prova que nada mais apontava para a antiga.
--
-- SEM BACKFILL: colunas novas nulas; nenhuma linha existente muda, e nenhuma linha existente fica fora dos
-- CHECKs refeitos (eles só acrescentam 'convertido'; o CHECK anterior já prendia o acervo).
-- JANELA DE DEPLOY (pre-deploy): a API anterior não lê nem grava as colunas novas. A compra que ela lança não
-- tem origem, e o gatilho da origem exige justamente origem_item_id nulo nesse caso — que é o que ela grava.
-- Nenhum pedido vira convertido sem a API nova. Ordem banco → API → web.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 71) then
    raise exception 'COMPRAS-02: outra transacao ja detem a trava desta migration (2026,71). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.documentos_compra') is null or to_regclass('erp.documentos_compra_itens') is null then
    raise exception 'COMPRAS-02: erp.documentos_compra/erp.documentos_compra_itens ausente; a 0036 nao esta aplicada.';
  end if;
  -- "Já aplicada" ANTES de "a 0036 falta": depois da 0037 as funções da 0036 não existem mais, e a reaplicação
  -- precisa dizer o motivo verdadeiro.
  if to_regprocedure('erp.documentos_compra_conferir_v2()') is not null or to_regprocedure('erp.documentos_compra_transicao_v2()') is not null
     or to_regprocedure('erp.documentos_compra_item_origem_guarda()') is not null then
    raise exception 'COMPRAS-02: funcoes da 0037 ja existem; a 0037 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.documentos_compra_conferir()') is null or to_regprocedure('erp.documentos_compra_transicao()') is null
     or to_regprocedure('erp.documentos_compra_itens_documento_aberto()') is null then
    raise exception 'COMPRAS-02: funcoes de gatilho da 0036 ausentes; a 0036 nao esta aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'erp'
              and ((table_name = 'documentos_compra' and column_name in ('origem_documento_id', 'saldo_encerrado_em', 'saldo_encerrado_por', 'saldo_encerrado_motivo'))
                or (table_name = 'documentos_compra_itens' and column_name = 'origem_item_id'))) then
    raise exception 'COMPRAS-02: colunas do recebimento do pedido ja existem; a 0037 ja foi aplicada ou ha schema divergente.';
  end if;
  -- Os gatilhos que serão trocados existem e apontam para as funções da 0036: a troca abaixo sabe o que substitui.
  if (select count(*) from pg_trigger t
       where t.tgrelid = 'erp.documentos_compra'::regclass and not t.tgisinternal
         and ((t.tgname = 'trg_documentos_compra_conferir' and t.tgfoid = to_regprocedure('erp.documentos_compra_conferir()'))
           or (t.tgname = 'trg_documentos_compra_transicao' and t.tgfoid = to_regprocedure('erp.documentos_compra_transicao()')))) <> 2 then
    raise exception 'COMPRAS-02: trg_documentos_compra_conferir/trg_documentos_compra_transicao ausentes ou fora das funcoes da 0036; schema divergente.';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_compra_itens'::regclass and t.tgname = 'trg_documentos_compra_itens_origem_guarda') then
    raise exception 'COMPRAS-02: trg_documentos_compra_itens_origem_guarda ja existe; a 0037 ja foi aplicada ou ha schema divergente.';
  end if;
  -- A FK composta da origem aponta para (id, organization_id) do próprio cabeçalho: a chave precisa existir (0036).
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'uq_documentos_compra_tenant' and c.contype = 'u'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'COMPRAS-02: chave uq_documentos_compra_tenant (id, organization_id) ausente em erp.documentos_compra (0036).';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra_itens'::regclass and conname = 'uq_documentos_compra_itens_tenant') then
    raise exception 'COMPRAS-02: erp.documentos_compra_itens.uq_documentos_compra_itens_tenant ja existe; a 0037 ja foi aplicada ou ha schema divergente.';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and contype = 'c'
        and conname in ('chk_documentos_compra_situacao', 'chk_documentos_compra_situacao_especie')) <> 2 then
    raise exception 'COMPRAS-02: CHECKs de situacao da 0036 ausentes; schema divergente.';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'COMPRAS-02: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam o pedido de origem nem as compras ligadas a ele.';
  end if;
end $$;

-- ---------- 3) cabeçalho: origem e encerramento do saldo ----------
-- Colunas numa instrução, constraints em outra: o leitor de schema dos gates (scripts/lib/schema.mjs) lê o
-- `add column` repetido, e uma `add constraint` no meio dele viraria uma coluna fantasma no dicionário.
alter table erp.documentos_compra
  add column origem_documento_id uuid,
  add column saldo_encerrado_em timestamptz,
  add column saldo_encerrado_por uuid constraint fk_documentos_compra_saldo_encerrado_por references erp.users(id),
  add column saldo_encerrado_motivo text;

alter table erp.documentos_compra
  add constraint fk_documentos_compra_origem foreign key (origem_documento_id, organization_id) references erp.documentos_compra (id, organization_id),
  add constraint chk_documentos_compra_origem_so_compra check (especie = 'compra' or origem_documento_id is null),
  add constraint chk_documentos_compra_saldo_encerrado check (
    (saldo_encerrado_em is null and saldo_encerrado_por is null and saldo_encerrado_motivo is null)
    or (saldo_encerrado_em is not null and saldo_encerrado_por is not null and saldo_encerrado_motivo is not null
        and btrim(saldo_encerrado_motivo) <> '' and especie = 'pedido' and situacao = 'convertido'));

-- Situação: 'convertido' entra SÓ no pedido. Drop e add na mesma instrução: não existe instante sem o CHECK.
alter table erp.documentos_compra
  drop constraint chk_documentos_compra_situacao,
  drop constraint chk_documentos_compra_situacao_especie,
  add constraint chk_documentos_compra_situacao check (situacao in ('aberto','confirmado','convertido','cancelado')),
  add constraint chk_documentos_compra_situacao_especie check (
    (especie = 'compra' and situacao in ('aberto','confirmado','cancelado'))
    or (especie = 'pedido' and situacao in ('aberto','convertido','cancelado')));

-- A conta do saldo e a lista das compras geradas leem por aqui.
create index ix_documentos_compra_origem
  on erp.documentos_compra (origem_documento_id) where origem_documento_id is not null;

comment on column erp.documentos_compra.situacao is 'aberto, confirmado (só compra), convertido (só pedido: saldo recebido por inteiro ou encerrado) ou cancelado (final). Transições conferidas por gatilho.';
comment on column erp.documentos_compra.origem_documento_id is 'COMPRAS-02: pedido de compra de que esta compra foi gerada (só compra; FK composta com a organização). Mesma empresa e mesmo fornecedor; não muda depois do lançamento.';
comment on column erp.documentos_compra.saldo_encerrado_em is 'COMPRAS-02: quando o saldo do pedido foi encerrado (só pedido convertido; gravado na passagem aberto → convertido).';
comment on column erp.documentos_compra.saldo_encerrado_por is 'COMPRAS-02: quem encerrou o saldo do pedido.';
comment on column erp.documentos_compra.saldo_encerrado_motivo is 'COMPRAS-02: por que o saldo do pedido foi encerrado (não vazio).';

-- ---------- 4) itens: a ligação com o item do pedido ----------
alter table erp.documentos_compra_itens add constraint uq_documentos_compra_itens_tenant unique (id, organization_id);

alter table erp.documentos_compra_itens
  add column origem_item_id uuid;

alter table erp.documentos_compra_itens
  add constraint fk_documentos_compra_itens_origem foreign key (origem_item_id, organization_id) references erp.documentos_compra_itens (id, organization_id);

create index ix_documentos_compra_itens_origem
  on erp.documentos_compra_itens (origem_item_id) where origem_item_id is not null;

comment on column erp.documentos_compra_itens.origem_item_id is 'COMPRAS-02: item do pedido de compra de que esta linha da compra é recebimento. Saldo do item do pedido = quantidade − soma ligada em compras não canceladas.';

-- ---------- 5) gatilho de conferência do cabeçalho (v2) ----------
-- Tudo o que a 0036 conferia, e mais: a origem (pedido aberto, mesma empresa, mesmo fornecedor, travado FOR
-- SHARE), a origem imutável, o fornecedor preso à ligação, e o encerramento do saldo só na passagem aberto →
-- convertido. SECURITY DEFINER estreita: lê o pedido e o cadastro da MESMA organização da linha, devolve só a
-- recusa, sem SQL dinâmico.
create function erp.documentos_compra_conferir_v2() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
declare
  v_especie text;
  v_situacao text;
  v_empresa uuid;
  v_fornecedor uuid;
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
    -- "Mesmo fornecedor" vale enquanto a ligação existir, dos dois lados.
    if new.fornecedor_id is distinct from old.fornecedor_id then
      if new.origem_documento_id is not null then
        raise exception 'VALIDATION_ERROR: O fornecedor da compra gerada de um pedido é o do pedido; ele não muda.' using errcode = 'P0001';
      end if;
      if new.especie = 'pedido' and exists (select 1 from erp.documentos_compra c
                                             where c.origem_documento_id = new.id and c.organization_id = new.organization_id) then
        raise exception 'VALIDATION_ERROR: O fornecedor do pedido de compra não muda depois que o pedido gerou compra.' using errcode = 'P0001';
      end if;
    end if;
    -- Encerrar o saldo é TRANSIÇÃO: quem, quando e por quê só se gravam na mesma mudança aberto → convertido.
    if (new.saldo_encerrado_em, new.saldo_encerrado_por, new.saldo_encerrado_motivo)
         is distinct from (old.saldo_encerrado_em, old.saldo_encerrado_por, old.saldo_encerrado_motivo)
       and not (old.situacao = 'aberto' and new.situacao = 'convertido') then
      raise exception 'CONFLICT: O saldo do pedido de compra só se encerra na passagem de aberto para convertido.' using errcode = 'P0001';
    end if;
    -- Cabeçalho CONGELADO fora do aberto: só a situação (e o carimbo abaixo) muda.
    if old.situacao <> 'aberto'
       and (to_jsonb(new) - 'situacao' - 'atualizado_em') is distinct from (to_jsonb(old) - 'situacao' - 'atualizado_em') then
      raise exception 'CONFLICT: O documento de compra está %; só a situação muda.', old.situacao using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  if tg_op = 'INSERT' and new.situacao <> 'aberto' then
    raise exception 'VALIDATION_ERROR: O documento de compra nasce aberto; a confirmação e o cancelamento são transições.' using errcode = 'P0001';
  end if;
  -- A origem: um PEDIDO ABERTO da mesma organização, empresa e fornecedor. FOR SHARE segura o pedido até o fim
  -- da transação — o encerramento do saldo e o cancelamento do pedido (que o atualizam) esperam esta compra
  -- commitar ou desfazer, e então a enxergam. A ordem das travas é a da API: pedido primeiro.
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
    if v_situacao <> 'aberto' then
      raise exception 'CONFLICT: O pedido de compra de origem não está aberto (situação: %).', v_situacao using errcode = 'P0001';
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
comment on function erp.documentos_compra_conferir_v2() is
  'COMPRAS-02 (substitui a conferência da 0036): fornecedor is_provider, transportadora is_transporter (vivos, da organização), TOP da família compras.<especie>, forma de pagamento global ou da organização; organização/empresa/espécie/código/TOP/versão/origem imutáveis; origem = pedido aberto da mesma empresa e fornecedor (FOR SHARE); fornecedor preso à ligação; saldo encerrado só na passagem aberto→convertido; fora do aberto só a situação muda; nasce aberto; carimba atualizado_em.';

-- ---------- 6) gatilho de transição de situação (v2) ----------
-- SECURITY DEFINER porque passou a ler outras linhas: o pedido com compra ligada não cancelada não se cancela.
create function erp.documentos_compra_transicao_v2() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if new.situacao = old.situacao then
    return new;
  end if;
  if old.situacao = 'cancelado' then
    raise exception 'CONFLICT: O documento de compra está cancelado; o cancelamento é final.' using errcode = 'P0001';
  end if;
  if old.situacao = 'aberto' and new.situacao = 'confirmado' then
    if new.especie <> 'compra' then
      raise exception 'CONFLICT: Pedido de compra não é confirmado.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.situacao = 'aberto' and new.situacao = 'convertido' then
    if new.especie <> 'pedido' then
      raise exception 'CONFLICT: Só o pedido de compra vira convertido; a compra se confirma.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Reabertura: a compra ligada foi cancelada e o saldo voltou. Com o saldo encerrado, o pedido fica convertido.
  if old.situacao = 'convertido' and new.situacao = 'aberto' then
    if old.saldo_encerrado_em is not null then
      raise exception 'CONFLICT: O saldo deste pedido de compra foi encerrado; ele não reabre.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.situacao = 'convertido' and new.situacao = 'cancelado' then
    raise exception 'CONFLICT: Pedido de compra convertido não é cancelado; cancele as compras geradas dele.' using errcode = 'P0001';
  end if;
  if new.situacao = 'cancelado' and old.situacao in ('aberto', 'confirmado') then
    if new.especie = 'pedido' and exists (select 1 from erp.documentos_compra c
                                           where c.origem_documento_id = new.id and c.organization_id = new.organization_id
                                             and c.situacao <> 'cancelado') then
      raise exception 'CONFLICT: Este pedido tem compras: cancele-as ou encerre o saldo.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'CONFLICT: Transição de situação inválida no documento de compra (% para %).', old.situacao, new.situacao using errcode = 'P0001';
end $$;
comment on function erp.documentos_compra_transicao_v2() is
  'COMPRAS-02 (substitui a transição da 0036): aberto→confirmado (só compra), aberto→convertido (só pedido), convertido→aberto (só sem saldo encerrado), aberto→cancelado (pedido só sem compra ligada não cancelada), confirmado→cancelado; convertido→cancelado recusado; cancelado é final.';

-- ---------- 7) troca dos gatilhos (mesmos nomes) e remoção das funções da 0036 ----------
-- Mesmo nome = mesma posição na ordem alfabética de disparo (conferir antes de transicao), como na 0036.
drop trigger trg_documentos_compra_conferir on erp.documentos_compra;
create trigger trg_documentos_compra_conferir
  before insert or update on erp.documentos_compra
  for each row execute function erp.documentos_compra_conferir_v2();

drop trigger trg_documentos_compra_transicao on erp.documentos_compra;
create trigger trg_documentos_compra_transicao
  before update of situacao on erp.documentos_compra
  for each row execute function erp.documentos_compra_transicao_v2();

-- Sem cascata: se algo além dos dois gatilhos trocados apontasse para elas, o drop PARA a migration.
drop function erp.documentos_compra_conferir();
drop function erp.documentos_compra_transicao();

-- ---------- 8) a invariante do saldo, no banco (gatilho da origem) ----------
-- Padrão da 0034 (erp.sales_document_item_origem_guarda), com duas diferenças deliberadas:
--   · SEM cláusula WHEN: o gatilho precisa ver também a linha SEM origem — compra com origem liga TODO item, e
--     compra sem origem não liga nenhum; um WHEN (origem não nula) deixaria passar a linha que falta;
--   · o lado do pedido: o item do pedido não baixa a quantidade para menos do que já foi recebido, nem troca de
--     produto depois de recebido — senão "soma ≤ quantidade" valeria só no instante da ligação.
-- Ordem das travas: pedido (FOR SHARE) → item de origem (FOR UPDATE) — a mesma da API (pedido → contador do
-- ID Global → itens de origem). O gatilho do documento aberto (0036), que dispara ANTES deste (ordem
-- alfabética), já recusou cabeçalho inexistente ou fora do aberto.
create function erp.documentos_compra_item_origem_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
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
  if v_pedido_situacao is distinct from 'aberto' then
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
comment on function erp.documentos_compra_item_origem_guarda() is
  'COMPRAS-02: compra com origem liga todo item a um item do pedido citado no cabeçalho (mesmo produto, pedido aberto, item de origem travado FOR UPDATE, soma ligada em compras não canceladas ≤ quantidade); compra sem origem não liga item; item do pedido não fica abaixo do recebido nem troca de produto recebido.';
create trigger trg_documentos_compra_itens_origem_guarda
  before insert or update of origem_item_id, quantidade, produto_id on erp.documentos_compra_itens
  for each row execute function erp.documentos_compra_item_origem_guarda();

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('documentos_compra_conferir_v2', 'documentos_compra_transicao_v2', 'documentos_compra_item_origem_guarda')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 9) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_cols text[];
begin
  select array_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable order by table_name, column_name) into v_cols
    from information_schema.columns
   where table_schema = 'erp'
     and ((table_name = 'documentos_compra' and column_name in ('origem_documento_id', 'saldo_encerrado_em', 'saldo_encerrado_por', 'saldo_encerrado_motivo'))
       or (table_name = 'documentos_compra_itens' and column_name = 'origem_item_id'));
  if v_cols is distinct from array['documentos_compra.origem_documento_id:uuid:YES', 'documentos_compra.saldo_encerrado_em:timestamp with time zone:YES',
                                    'documentos_compra.saldo_encerrado_motivo:text:YES', 'documentos_compra.saldo_encerrado_por:uuid:YES',
                                    'documentos_compra_itens.origem_item_id:uuid:YES'] then
    raise exception 'COMPRAS-02: colunas novas ausentes ou com tipo/nulidade errados: %', v_cols;
  end if;
  -- As FKs da ligação: compostas (coluna + organização), para a PRÓPRIA tabela, sem cascata.
  if not exists (select 1 from pg_constraint c
                  where c.conname = 'fk_documentos_compra_origem' and c.contype = 'f'
                    and c.conrelid = 'erp.documentos_compra'::regclass and c.confrelid = 'erp.documentos_compra'::regclass
                    and c.confdeltype = 'a' and c.confupdtype = 'a'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'origem_documento_id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[]
                    and c.confkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'id'),
                                          (select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'COMPRAS-02: fk_documentos_compra_origem ausente ou diferente de (origem_documento_id, organization_id) -> erp.documentos_compra (id, organization_id) sem cascata.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conname = 'fk_documentos_compra_itens_origem' and c.contype = 'f'
                    and c.conrelid = 'erp.documentos_compra_itens'::regclass and c.confrelid = 'erp.documentos_compra_itens'::regclass
                    and c.confdeltype = 'a' and c.confupdtype = 'a'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'origem_item_id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]
                    and c.confkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'id'),
                                          (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'COMPRAS-02: fk_documentos_compra_itens_origem ausente ou diferente de (origem_item_id, organization_id) -> erp.documentos_compra_itens (id, organization_id) sem cascata.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conname = 'uq_documentos_compra_itens_tenant' and c.contype = 'u' and c.conrelid = 'erp.documentos_compra_itens'::regclass
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.documentos_compra_itens'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'COMPRAS-02: chave uq_documentos_compra_itens_tenant ausente ou com colunas diferentes de (id, organization_id).';
  end if;
  if not exists (select 1 from pg_constraint c where c.conname = 'fk_documentos_compra_saldo_encerrado_por' and c.contype = 'f'
                    and c.conrelid = 'erp.documentos_compra'::regclass and c.confrelid = 'erp.users'::regclass) then
    raise exception 'COMPRAS-02: fk_documentos_compra_saldo_encerrado_por ausente.';
  end if;
  -- Os CHECKs: os dois novos, e os dois de situação refeitos COM 'convertido' (e o pedido sem 'confirmado').
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk_documentos_compra_%') <> 15
     or not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and conname = 'chk_documentos_compra_origem_so_compra' and contype = 'c')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and conname = 'chk_documentos_compra_saldo_encerrado' and contype = 'c'
                     and pg_get_constraintdef(oid) like '%btrim(saldo_encerrado_motivo)%' and pg_get_constraintdef(oid) like '%''convertido''%') then
    raise exception 'COMPRAS-02: CHECKs de erp.documentos_compra incompletos (esperados 15, com origem so da compra e saldo encerrado so do pedido convertido).';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and conname = 'chk_documentos_compra_situacao' and contype = 'c'
                  and pg_get_constraintdef(oid) like '%''convertido''%')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and conname = 'chk_documentos_compra_situacao_especie' and contype = 'c'
                     and pg_get_constraintdef(oid) like '%''pedido''%''convertido''%') then
    raise exception 'COMPRAS-02: CHECKs de situacao sem convertido no pedido.';
  end if;
  if to_regclass('erp.ix_documentos_compra_origem') is null or to_regclass('erp.ix_documentos_compra_itens_origem') is null then
    raise exception 'COMPRAS-02: indices parciais da origem ausentes.';
  end if;
  -- As funções da 0036 foram trocadas, não duplicadas.
  if to_regprocedure('erp.documentos_compra_conferir()') is not null or to_regprocedure('erp.documentos_compra_transicao()') is not null then
    raise exception 'COMPRAS-02: funcoes da 0036 ainda existem; a troca pela v2 nao terminou.';
  end if;
  -- O conjunto EXATO de gatilhos do usuário nas duas tabelas, ligados.
  if (select array_agg(t.tgname::text order by t.tgname) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass))
     is distinct from array['trg_documentos_compra_audit', 'trg_documentos_compra_conferir', 'trg_documentos_compra_itens_documento_aberto',
                            'trg_documentos_compra_itens_origem_guarda', 'trg_documentos_compra_transicao'] then
    raise exception 'COMPRAS-02: gatilhos do documento de compra diferentes do esperado (audit, conferir, transicao, item documento aberto, item origem).';
  end if;
  -- Tipo dos gatilhos (tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE) e a função de cada um.
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_compra'::regclass
                    and t.tgname = 'trg_documentos_compra_conferir'
                    and t.tgfoid = 'erp.documentos_compra_conferir_v2()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 4 | 16) and cardinality(t.tgattr::int2[]) = 0) then
    raise exception 'COMPRAS-02: gatilho de conferencia nao e BEFORE INSERT OR UPDATE FOR EACH ROW (todas as colunas) com a funcao v2.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_compra'::regclass
                    and t.tgname = 'trg_documentos_compra_transicao'
                    and t.tgfoid = 'erp.documentos_compra_transicao_v2()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 16)
                    and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'situacao')]::int2[]) then
    raise exception 'COMPRAS-02: gatilho de transicao nao e BEFORE UPDATE OF situacao FOR EACH ROW com a funcao v2.';
  end if;
  -- O gatilho da origem: BEFORE INSERT OR UPDATE OF (origem_item_id, quantidade, produto_id), por linha, SEM WHEN.
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_compra_itens'::regclass
                    and t.tgname = 'trg_documentos_compra_itens_origem_guarda'
                    and t.tgfoid = 'erp.documentos_compra_item_origem_guarda()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 4 | 16)
                    and t.tgqual is null
                    and (select array_agg(x order by x) from unnest(t.tgattr) x)
                        = (select array_agg(attnum order by attnum) from pg_attribute
                            where attrelid = 'erp.documentos_compra_itens'::regclass and attname in ('origem_item_id', 'quantidade', 'produto_id'))) then
    raise exception 'COMPRAS-02: gatilho da origem nao e BEFORE INSERT OR UPDATE OF origem_item_id, quantidade, produto_id FOR EACH ROW sem WHEN com a funcao certa.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                       'erp.documentos_compra_item_origem_guarda()'::regprocedure)
         and p.prosecdef
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) <> 3 then
    raise exception 'COMPRAS-02: funcoes novas sem SECURITY DEFINER ou sem search_path fixo.';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.documentos_compra_conferir_v2()'::regprocedure, 'erp.documentos_compra_transicao_v2()'::regprocedure,
                              'erp.documentos_compra_item_origem_guarda()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'COMPRAS-02: EXECUTE das funcoes de gatilho ainda concedido alem do dono.';
  end if;
end $$;
