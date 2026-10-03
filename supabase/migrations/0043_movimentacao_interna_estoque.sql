-- =====================================================================
-- 0043 OPERACOES-01 F5a — MOVIMENTAÇÃO INTERNA NO DOCUMENTO DE ESTOQUE — decisão 282 (parte F5a)
--
-- 1) erp.documentos_estoque ganha TRÊS espécies — 'requisicao' (pedido de material), 'consumo' e
--    'devolucao_consumo' — ao lado das quatro da 0040. Famílias: a requisição nova é 'estoque.requisicao_material'
--    (a família 'estoque.requisicao' continua sendo a da tabela antiga erp.requisitions, intocada); as outras duas
--    seguem a regra 'estoque.<espécie>'. O gatilho de conferência passa a derivar a família por um CASE (só a
--    requisição foge da regra); para as quatro de hoje, a recusa tem o MESMO texto de antes.
-- 2) ORIGEM: o consumo que atende uma requisição aponta a requisição no cabeçalho (origem_documento_id) e o item
--    dela em cada linha (origem_item_id); a devolução de consumo aponta o consumo (obrigatório, no cabeçalho e em
--    cada item). FKs COMPOSTAS com a organização para a própria tabela (a chave (id, organization_id) do item
--    nasce aqui). A origem é identidade: não muda depois do lançamento. Mesma empresa e mesmo local de estoque da
--    origem; a origem é lida FOR SHARE (o cancelamento ou o encerramento concorrente da origem esperam).
-- 3) SALDO da requisição = quantidade − soma das quantidades ligadas em consumos NÃO cancelados (conta, não
--    coluna — o desenho da 0034/0037: cancelar o consumo devolve o saldo sem ninguém atualizar nada). A requisição
--    confirmada é a PENDENTE; "pendente / atendida em parte / atendida / saldo encerrado" é calculado pela API.
--    saldo_encerrado_{em,por,motivo}: o encerramento manual do saldo pendente (os três juntos, só na requisição
--    confirmada ou cancelada, motivo não vazio — CHECK); é a ÚNICA mudança que a requisição confirmada aceita além
--    do cancelamento, e uma vez só.
-- 4) INVARIANTE NO BANCO (gatilho novo dos itens, molde da 0037): o item ligado é do documento de origem citado no
--    cabeçalho, do mesmo produto; a soma ligada não passa do saldo do item de origem (consumo ≤ pendente da
--    requisição; devolução ≤ o que o consumo baixou e ainda não voltou). O item de origem é travado FOR UPDATE:
--    duas partes simultâneas sobre o mesmo saldo se enfileiram, e a segunda soma a primeira. Toda linha da
--    devolução tem origem. A API confere antes, com mensagem própria; o gatilho é a rede.
-- 5) TRANSIÇÃO: a requisição com consumo não cancelado não se cancela; o consumo com devolução não cancelada não
--    se cancela. A função de transição passa a SECURITY DEFINER (lê outras linhas da organização, o molde da 0037).
-- 6) DESTINO no cabeçalho (seis dimensões, colunas anuláveis): centro de resultado e safra (da organização);
--    máquina/equipamento, ordem de serviço, lote de animais e área/talhão (da EMPRESA do documento). Só na
--    requisição, no consumo, na saída e na devolução de consumo (CHECK chk_documentos_estoque_apropriacao — o nome
--    não confunde com chk_documentos_estoque_destino da 0040, que é o local de estoque de destino da
--    transferência). O consumo que atende uma requisição leva cada dimensão que a requisição tem; a devolução
--    leva as seis do consumo (gatilho). As referências existem, não estão excluídas e, as de empresa, são da
--    empresa do documento (gatilho); ativo/inativo e centro analítico são da API, como o local de estoque inativo.
--    O razão (erp.stock_movements) ganha as quatro dimensões que faltavam (equipamento_id, ordem_servico_id,
--    lote_animais_id, area_id), com FK composta; cost_center_id e harvest_id já existem (0003) e ficam como estão.
-- 7) SAÍDA: motivo (os 13 da baixa antiga, 0003, na mesma ordem) e justificativa, em par e só na saída (CHECK).
--    O par é OPCIONAL no banco: o web anterior lança a saída sem eles.
-- 8) ENTRADA sem custo: o CHECK chk_documentos_estoque_itens_custo_entrada sai (a confirmação grava o custo médio
--    do produto, como a devolução antiga). Item da requisição sem lote, validade e custo (CHECK): a requisição
--    reserva pelo produto no local de estoque; o lote é escolhido no consumo.
-- 9) RESERVA (a 0035, parte C, no MESMO núcleo): C1 = saldo pendente das requisições confirmadas sem saldo
--    encerrado; C2 = quantidade dos itens ligados de consumos ABERTOS (o análogo exato de A e B do pedido de
--    venda). A guarda das saídas exclui o C2 do PRÓPRIO consumo que está saindo (como exclui a parte B da própria
--    venda); o atalho da guarda e o do flag control_stock passam a conferir também a organização que tem
--    requisição pendente ou consumo aberto ligado; a porta exposta aceita também quem vê ou edita requisição de
--    material. A mensagem da guarda NÃO muda ("reservado para pedidos": a requisição é um pedido de material). O
--    flag control_stock recusa, com mensagem nova, o produto em item de requisição com saldo pendente ou em item
--    ligado de consumo aberto.
-- 10) MENSAGENS que diziam "armazém" passam a dizer "local de estoque" (só o texto; corpo e atributos iguais):
--     erp.apply_stock_movement (0003), erp.products_controle_lote (0029, = MSG_CONTROLE_COM_SALDO da API),
--     erp.documentos_compra_itens_documento_aberto (0036 — tocada SÓ no texto de uma mensagem; o search_path é o
--     da 0038) e erp.documentos_estoque_conferir (0040). Os códigos (INSUFFICIENT_STOCK, VALIDATION_ERROR) não mudam.
-- 11) erp.layouts_documento: o CHECK de família passa a aceitar as sete famílias de estoque (preparação da F5b,
--     layout por TOP na Central de Estoque, sem migration própria). Sem efeito agora: o domínio ainda não dá
--     catálogo de layout ao estoque, e a API recusa antes.
-- 12) As nove funções substituídas vão por CREATE OR REPLACE — mesma assinatura, mesmo dono, mesmos privilégios
--     (o CREATE OR REPLACE preserva a ACL) e mesmos atributos; a única exceção é a transição, que passa a SECURITY
--     DEFINER. A pré-condição 2.3 confere a DEFINIÇÃO VIGENTE de cada uma (md5 do corpo) contra a da migration que
--     a criou: corpo diferente é schema divergente, e a decisão volta para um humano. A 0003, a 0029, a 0035, a
--     0036, a 0040 e a 0041 NÃO se editam.
--
-- SEM BACKFILL: colunas novas nulas; nenhuma linha existente é reescrita.
-- IMPACTO EM DADOS REAIS: nenhum valor muda. Os CHECKs refeitos só ACEITAM mais (espécies novas; o de custo da
-- entrada sai); os CHECKs novos valem para toda linha existente (as colunas deles nascem nulas e as espécies de
-- hoje passam). As chaves (id, organization_id) novas em erp.harvests, erp.equipments, erp.service_orders,
-- erp.batches, erp.areas e erp.documentos_estoque_itens são um índice único cada, sem mudar linha (o id já é
-- único). As FKs novas são validadas sobre colunas todas nulas (leitura). A reserva só muda quando existir
-- requisição confirmada — produção não tem nenhuma (02/10).
-- JANELA DE DEPLOY (pre-deploy, como a 0040 e a 0041; ordem banco → API → web): a API anterior não lê nem grava
-- as colunas novas e só lança as quatro espécies de hoje — o corpo dela continua aceito pelo banco (entrada com
-- custo, saída sem motivo, nenhuma origem, nenhum destino). As mensagens dos gatilhos mudam só o texto ("local de
-- estoque"); os códigos, e portanto os status HTTP da API anterior, não mudam.
-- VOLTA: API e web voltam por redeploy e convivem com a 0043. As colunas ficam (decisão 247: dado não se apaga).
-- Com a API anterior no ar, documento das espécies novas não aparece na lista dela (ela filtra as quatro), e a
-- reserva de requisição confirmada CONTINUA valendo no banco — a guarda é do banco — sem que ninguém a encerre ou
-- a atenda até a API nova voltar (declarado em docs/DEPLOYMENT.md).
-- TRAVAS: ADD COLUMN e ADD CONSTRAINT UNIQUE pegam ACCESS EXCLUSIVE (curto: só catálogo, sem regravar a tabela; o
-- índice único lê a tabela uma vez) em erp.harvests, erp.equipments, erp.service_orders, erp.batches, erp.areas,
-- erp.documentos_estoque, erp.documentos_estoque_itens, erp.stock_movements e erp.layouts_documento; as FKs novas
-- pegam SHARE ROW EXCLUSIVE nas tabelas referenciadas (erp.cost_centers, erp.users e as acima). O lock_timeout de
-- 2s faz a migration desistir em vez de enfileirar as gravações atrás dela.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (a 0041 usou 75; a 76 é a da 0042).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 77) then
    raise exception 'OPERACOES-01 F5: outra transacao ja detem a trava desta migration (2026,77). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_def text;
  v_lista text[];
begin
  -- 2.0 "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência.
  if exists (select 1 from pg_attribute a
              where a.attrelid = to_regclass('erp.documentos_estoque') and a.attname = 'origem_documento_id' and not a.attisdropped)
     or to_regprocedure('erp.documentos_estoque_item_origem_guarda()') is not null then
    raise exception 'OPERACOES-01 F5: erp.documentos_estoque.origem_documento_id ou erp.documentos_estoque_item_origem_guarda() ja existe; a 0043 ja foi aplicada ou ha schema divergente.';
  end if;
  -- 2.1 Antes de ler qualquer tabela: um papel sem bypass de RLS pararia adiante num erro de permissão genérico, e
  -- as funções SECURITY DEFINER (cujo dono é quem aplica) veriam só o recorte de quem chama.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'OPERACOES-01 F5: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam a origem, o destino nem a reserva da organizacao.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'OPERACOES-01 F5: papel erp_app ausente (0007); a porta da reserva e os privilegios nao teriam destinatario.';
  end if;
  -- 2.2 A 0040 (documento de estoque), a 0041 (aprovação) e a 0035 (reserva) aplicadas: as tabelas e as funções
  -- que esta migration substitui ou de que depende.
  if to_regclass('erp.documentos_estoque') is null or to_regclass('erp.documentos_estoque_itens') is null
     or to_regclass('erp.aprovacoes_estoque') is null then
    raise exception 'OPERACOES-01 F5: erp.documentos_estoque/erp.documentos_estoque_itens (0040) ou erp.aprovacoes_estoque (0041) ausente; a 0040 e a 0041 nao estao aplicadas.';
  end if;
  if to_regprocedure('erp.documentos_estoque_conferir()') is null or to_regprocedure('erp.documentos_estoque_transicao()') is null
     or to_regprocedure('erp.documentos_estoque_itens_documento_aberto()') is null or to_regprocedure('erp.documentos_estoque_aprovacao_guarda()') is null
     or to_regprocedure('erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)') is null or to_regprocedure('erp.reserva_estoque(uuid[],uuid[],uuid)') is null
     or to_regprocedure('erp.stock_movement_reserva_guarda()') is null or to_regprocedure('erp.products_controle_estoque_reserva()') is null
     or to_regprocedure('erp.apply_stock_movement()') is null or to_regprocedure('erp.products_controle_lote()') is null
     or to_regprocedure('erp.documentos_compra_itens_documento_aberto()') is null then
    raise exception 'OPERACOES-01 F5: funcao substituida ou chamada por esta migration ausente (documentos_estoque_conferir/transicao/itens_documento_aberto/aprovacao_guarda, reserva_estoque_nucleo, reserva_estoque, stock_movement_reserva_guarda, products_controle_estoque_reserva, apply_stock_movement, products_controle_lote, documentos_compra_itens_documento_aberto); a cadeia de migrations esta fora de ordem.';
  end if;
  -- 2.3 A DEFINIÇÃO VIGENTE de cada uma das nove funções substituídas é a da migration que a criou (md5 do corpo,
  -- calculado num banco migrado até a 0041). Um corpo diferente — um hotfix fora do repositório, uma migration
  -- fora de ordem — seria apagado em silêncio pelo CREATE OR REPLACE abaixo: a decisão volta para um humano.
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.apply_stock_movement()'::regprocedure) is distinct from '4ae47891e483c1ccbdcdc1030959a79c' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.apply_stock_movement nao e a da 0003; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.products_controle_lote()'::regprocedure) is distinct from 'd44d4d23fc3b0a626ef310ae6fb0b7e5' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.products_controle_lote nao e a da 0029; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)'::regprocedure) is distinct from 'e23e668d3ef66bf8d5fa5883ac888efb' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.reserva_estoque_nucleo nao e a da 0035; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure) is distinct from '93ea84d7447e8c2e05a830c96bb49793' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.reserva_estoque nao e a da 0035; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.stock_movement_reserva_guarda()'::regprocedure) is distinct from '5753476dd0b43df7507f7356e98f1227' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.stock_movement_reserva_guarda nao e a da 0035; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.products_controle_estoque_reserva()'::regprocedure) is distinct from '6e7912d328f2e7dd0c19664e4a888b71' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.products_controle_estoque_reserva nao e a da 0035; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.documentos_compra_itens_documento_aberto()'::regprocedure) is distinct from '18f73296d17c985efd4a276bcc9e0c8a' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.documentos_compra_itens_documento_aberto nao e a da 0036; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.documentos_estoque_conferir()'::regprocedure) is distinct from '3784cfb4a54d687fb5a63953f6409692' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.documentos_estoque_conferir nao e a da 0040; schema divergente.';
  end if;
  if (select md5(p.prosrc) from pg_proc p where p.oid = 'erp.documentos_estoque_transicao()'::regprocedure) is distinct from '46b05d06d0ca7d6d1a7bf4c997a93694' then
    raise exception 'OPERACOES-01 F5: a definicao vigente de erp.documentos_estoque_transicao nao e a da 0040; schema divergente.';
  end if;
  -- 2.4 Os CHECKs refeitos abaixo são EXATAMENTE os esperados: as quatro espécies da 0040 (cabeçalho e item), na
  -- coluna especie; o custo obrigatório da entrada (0040); as cinco famílias da 0038, na coluna familia.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_estoque'::regclass and c.conname = 'chk_documentos_estoque_especie' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_estoque'::regclass and attname = 'especie')]::int2[];
  select array_agg(m[1] order by m[1]) into v_lista from regexp_matches(v_def, '''([^'']*)''', 'g') m;
  if v_def is null or v_lista is distinct from array['ajuste', 'entrada', 'saida', 'transferencia'] then
    raise exception 'OPERACOES-01 F5: chk_documentos_estoque_especie diferente do da 0040 (especie in entrada, saida, transferencia, ajuste); schema divergente.';
  end if;
  v_def := null;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_estoque_itens'::regclass and c.conname = 'chk_documentos_estoque_itens_especie' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_estoque_itens'::regclass and attname = 'especie')]::int2[];
  select array_agg(m[1] order by m[1]) into v_lista from regexp_matches(v_def, '''([^'']*)''', 'g') m;
  if v_def is null or v_lista is distinct from array['ajuste', 'entrada', 'saida', 'transferencia'] then
    raise exception 'OPERACOES-01 F5: chk_documentos_estoque_itens_especie diferente do da 0040 (especie in entrada, saida, transferencia, ajuste); schema divergente.';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.documentos_estoque_itens'::regclass and c.conname = 'chk_documentos_estoque_itens_custo_entrada' and c.contype = 'c') then
    raise exception 'OPERACOES-01 F5: chk_documentos_estoque_itens_custo_entrada (0040) ausente; schema divergente.';
  end if;
  v_def := null;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia' and c.contype = 'c'
     and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.layouts_documento'::regclass and attname = 'familia')]::int2[];
  select array_agg(m[1] order by m[1]) into v_lista from regexp_matches(v_def, '''([^'']*)''', 'g') m;
  if v_def is null or v_lista is distinct from array['compras.compra', 'compras.pedido', 'vendas.orcamento', 'vendas.pedido', 'vendas.venda'] then
    raise exception 'OPERACOES-01 F5: chk_layouts_documento_familia diferente do da 0038 (familia in vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido, compras.compra); schema divergente.';
  end if;
  -- 2.5 Os gatilhos EXATOS das duas tabelas, por nome E por função: é sobre eles que o cabeçalho afirma a ordem
  -- de disparo (o item novo dispara DEPOIS do documento aberto, pela ordem alfabética).
  select array_agg(t.tgname || ' -> ' || n.nspname || '.' || p.proname order by t.tgname collate "C") into v_lista
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'erp.documentos_estoque'::regclass and not t.tgisinternal;
  if v_lista is distinct from array['trg_documentos_estoque_aprovacao -> erp.documentos_estoque_aprovacao_guarda',
                                    'trg_documentos_estoque_audit -> erp.audit_row',
                                    'trg_documentos_estoque_conferir -> erp.documentos_estoque_conferir',
                                    'trg_documentos_estoque_transicao -> erp.documentos_estoque_transicao'] then
    raise exception 'OPERACOES-01 F5: gatilhos de erp.documentos_estoque diferentes dos quatro esperados (aprovacao da 0041; audit, conferir e transicao da 0040): %', v_lista;
  end if;
  select array_agg(t.tgname || ' -> ' || n.nspname || '.' || p.proname order by t.tgname collate "C") into v_lista
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'erp.documentos_estoque_itens'::regclass and not t.tgisinternal;
  if v_lista is distinct from array['trg_documentos_estoque_itens_documento_aberto -> erp.documentos_estoque_itens_documento_aberto'] then
    raise exception 'OPERACOES-01 F5: gatilhos de erp.documentos_estoque_itens diferentes do esperado (documento_aberto da 0040): %', v_lista;
  end if;
  -- 2.6 As chaves que as FKs compostas referenciam: as que já existem, na ordem (id, organization_id); e as seis
  -- que esta migration cria ainda não existem (nem como constraint, nem como índice com o mesmo nome).
  if (select count(*) from pg_constraint c
       where c.contype = 'u'
         and ((c.conrelid = 'erp.cost_centers'::regclass and c.conname = 'uq_cost_centers_tenant')
           or (c.conrelid = 'erp.warehouses'::regclass and c.conname = 'uq_warehouses_tenant')
           or (c.conrelid = 'erp.documentos_estoque'::regclass and c.conname = 'uq_documentos_estoque_tenant'))
         and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id'),
                              (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[]) <> 3 then
    raise exception 'OPERACOES-01 F5: chave alvo das FKs compostas ausente (uq_cost_centers_tenant da 0024, uq_warehouses_tenant da 0036, uq_documentos_estoque_tenant da 0040, em (id, organization_id)).';
  end if;
  if exists (select 1 from pg_class c
              where c.relnamespace = 'erp'::regnamespace
                and c.relname in ('uq_harvests_tenant', 'uq_equipments_tenant', 'uq_service_orders_tenant', 'uq_batches_tenant',
                                  'uq_areas_tenant', 'uq_documentos_estoque_itens_tenant'))
     or exists (select 1 from pg_constraint c
                 where c.connamespace = 'erp'::regnamespace
                   and c.conname in ('uq_harvests_tenant', 'uq_equipments_tenant', 'uq_service_orders_tenant', 'uq_batches_tenant',
                                     'uq_areas_tenant', 'uq_documentos_estoque_itens_tenant')) then
    raise exception 'OPERACOES-01 F5: chave (id, organization_id) que esta migration cria ja existe (uq_harvests_tenant, uq_equipments_tenant, uq_service_orders_tenant, uq_batches_tenant, uq_areas_tenant, uq_documentos_estoque_itens_tenant); schema divergente.';
  end if;
  -- 2.7 As colunas que os gatilhos e a API leem (contagem EXATA), e as que esta migration cria ainda não existem.
  if (select count(*) from information_schema.columns
       where table_schema = 'erp'
         and ((table_name = 'cost_centers' and column_name = 'deleted_at')
           or (table_name = 'harvests' and column_name = 'deleted_at')
           or (table_name in ('equipments', 'service_orders', 'batches', 'areas') and column_name in ('empresa_id', 'deleted_at'))
           or (table_name = 'stock_movements' and column_name in ('cost_center_id', 'harvest_id')))) <> 12 then
    raise exception 'OPERACOES-01 F5: coluna lida pelos gatilhos ou pelo razao ausente (cost_centers.deleted_at, harvests.deleted_at, equipments/service_orders/batches/areas.empresa_id/deleted_at, stock_movements.cost_center_id/harvest_id); a cadeia de migrations esta fora de ordem.';
  end if;
  if exists (select 1 from pg_attribute a
              where not a.attisdropped
                and ((a.attrelid = 'erp.stock_movements'::regclass and a.attname in ('equipamento_id', 'ordem_servico_id', 'lote_animais_id', 'area_id'))
                  or (a.attrelid = 'erp.documentos_estoque'::regclass
                      and a.attname in ('centro_custo_id', 'equipamento_id', 'ordem_servico_id', 'lote_animais_id', 'area_id', 'safra_id', 'motivo_saida',
                                        'justificativa', 'saldo_encerrado_em', 'saldo_encerrado_por', 'saldo_encerrado_motivo'))
                  or (a.attrelid = 'erp.documentos_estoque_itens'::regclass and a.attname = 'origem_item_id'))) then
    raise exception 'OPERACOES-01 F5: coluna que esta migration cria ja existe (stock_movements.equipamento_id/ordem_servico_id/lote_animais_id/area_id, documentos_estoque.<destino, motivo, justificativa, saldo encerrado>, documentos_estoque_itens.origem_item_id); schema divergente.';
  end if;
  -- 2.8 O módulo de escopo do documento de estoque (a política da 0040 o lê pela transação).
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'estoque') then
    raise exception 'OPERACOES-01 F5: modulo de escopo empresarial estoque ausente (0011).';
  end if;
end $$;

-- ---------- 3) chaves (id, organization_id): os alvos das FKs compostas ----------
-- O id já é único em cada tabela: a chave nova é só o índice que a FK composta exige (coluna única não prova
-- tenant). Nenhuma linha muda.
alter table erp.harvests add constraint uq_harvests_tenant unique (id, organization_id);
alter table erp.equipments add constraint uq_equipments_tenant unique (id, organization_id);
alter table erp.service_orders add constraint uq_service_orders_tenant unique (id, organization_id);
alter table erp.batches add constraint uq_batches_tenant unique (id, organization_id);
alter table erp.areas add constraint uq_areas_tenant unique (id, organization_id);
alter table erp.documentos_estoque_itens add constraint uq_documentos_estoque_itens_tenant unique (id, organization_id);

-- ---------- 4) cabeçalho: origem, destino, motivo da saída e saldo encerrado ----------
-- Colunas numa instrução, constraints em outra: o leitor de schema dos gates (scripts/lib/schema.mjs) lê o
-- `add column` repetido, e uma `add constraint` no meio dele viraria uma coluna fantasma no dicionário.
alter table erp.documentos_estoque
  add column origem_documento_id uuid,
  add column centro_custo_id uuid,
  add column equipamento_id uuid,
  add column ordem_servico_id uuid,
  add column lote_animais_id uuid,
  add column area_id uuid,
  add column safra_id uuid,
  add column motivo_saida text,
  add column justificativa text,
  add column saldo_encerrado_em timestamptz,
  add column saldo_encerrado_por uuid constraint fk_documentos_estoque_saldo_encerrado_por references erp.users(id),
  add column saldo_encerrado_motivo text;

-- FKs compostas (col, organization_id) → (id, organization_id), sem cascata. O CHECK de espécie é refeito com drop e
-- add na MESMA instrução: não existe instante sem ele.
alter table erp.documentos_estoque
  add constraint fk_documentos_estoque_origem foreign key (origem_documento_id, organization_id) references erp.documentos_estoque (id, organization_id),
  add constraint fk_documentos_estoque_centro_custo foreign key (centro_custo_id, organization_id) references erp.cost_centers (id, organization_id),
  add constraint fk_documentos_estoque_equipamento foreign key (equipamento_id, organization_id) references erp.equipments (id, organization_id),
  add constraint fk_documentos_estoque_ordem_servico foreign key (ordem_servico_id, organization_id) references erp.service_orders (id, organization_id),
  add constraint fk_documentos_estoque_lote_animais foreign key (lote_animais_id, organization_id) references erp.batches (id, organization_id),
  add constraint fk_documentos_estoque_area foreign key (area_id, organization_id) references erp.areas (id, organization_id),
  add constraint fk_documentos_estoque_safra foreign key (safra_id, organization_id) references erp.harvests (id, organization_id),
  drop constraint chk_documentos_estoque_especie,
  add constraint chk_documentos_estoque_especie check (especie in ('entrada','saida','transferencia','ajuste','requisicao','consumo','devolucao_consumo')),
  add constraint chk_documentos_estoque_origem check ((especie in ('consumo','devolucao_consumo') or origem_documento_id is null)
                                                      and (especie <> 'devolucao_consumo' or origem_documento_id is not null)),
  add constraint chk_documentos_estoque_apropriacao check (especie in ('requisicao','consumo','saida','devolucao_consumo')
                                                           or (centro_custo_id is null and equipamento_id is null and ordem_servico_id is null
                                                               and lote_animais_id is null and area_id is null and safra_id is null)),
  add constraint chk_documentos_estoque_motivo_saida check ((motivo_saida is null
                                                             or motivo_saida in ('loss','deterioration','theft','damage','inventory','accounting','burglary','expiration','gift','donation','consumption','payment_with_product','other'))
                                                            and (especie = 'saida' or (motivo_saida is null and justificativa is null))
                                                            and ((motivo_saida is null) = (justificativa is null))
                                                            and (justificativa is null or btrim(justificativa) <> '')),
  add constraint chk_documentos_estoque_saldo_encerrado check ((saldo_encerrado_em is null and saldo_encerrado_por is null and saldo_encerrado_motivo is null)
                                                               or (saldo_encerrado_em is not null and saldo_encerrado_por is not null and saldo_encerrado_motivo is not null
                                                                   and btrim(saldo_encerrado_motivo) <> '' and especie = 'requisicao' and situacao in ('confirmado','cancelado')));

-- A conta do atendimento e a lista dos vinculados leem por aqui; o atalho da guarda e o núcleo da reserva, pelo
-- parcial abaixo (só os documentos que reservam).
create index ix_documentos_estoque_origem on erp.documentos_estoque (origem_documento_id) where origem_documento_id is not null;
create index ix_documentos_estoque_reserva on erp.documentos_estoque (organization_id, armazem_id)
  where (especie = 'requisicao' and situacao = 'confirmado' and saldo_encerrado_em is null)
     or (especie = 'consumo' and situacao = 'aberto' and origem_documento_id is not null);

-- ---------- 5) itens: a ligação com o item de origem ----------
alter table erp.documentos_estoque_itens
  add column origem_item_id uuid;

alter table erp.documentos_estoque_itens
  add constraint fk_documentos_estoque_itens_origem foreign key (origem_item_id, organization_id) references erp.documentos_estoque_itens (id, organization_id),
  drop constraint chk_documentos_estoque_itens_especie,
  add constraint chk_documentos_estoque_itens_especie check (especie in ('entrada','saida','transferencia','ajuste','requisicao','consumo','devolucao_consumo')),
  drop constraint chk_documentos_estoque_itens_custo_entrada,
  add constraint chk_documentos_estoque_itens_origem check ((especie in ('consumo','devolucao_consumo') or origem_item_id is null)
                                                            and (especie <> 'devolucao_consumo' or origem_item_id is not null)),
  add constraint chk_documentos_estoque_itens_requisicao check (especie <> 'requisicao' or (lote is null and validade is null and custo_unitario is null));

create index ix_documentos_estoque_itens_origem on erp.documentos_estoque_itens (origem_item_id) where origem_item_id is not null;

-- ---------- 6) razão: as dimensões de destino que faltavam ----------
alter table erp.stock_movements
  add column equipamento_id uuid,
  add column ordem_servico_id uuid,
  add column lote_animais_id uuid,
  add column area_id uuid;

alter table erp.stock_movements
  add constraint fk_stock_movements_equipamento foreign key (equipamento_id, organization_id) references erp.equipments (id, organization_id),
  add constraint fk_stock_movements_ordem_servico foreign key (ordem_servico_id, organization_id) references erp.service_orders (id, organization_id),
  add constraint fk_stock_movements_lote_animais foreign key (lote_animais_id, organization_id) references erp.batches (id, organization_id),
  add constraint fk_stock_movements_area foreign key (area_id, organization_id) references erp.areas (id, organization_id);

-- ---------- 7) comentários ----------
comment on table erp.documentos_estoque is 'Documento de estoque do Portal de Estoque (ESTOQUE-01, decisão 274; OPERACOES-01 F5a, decisão 282): entrada, saída, transferência, ajuste (inventário), requisição de material, consumo e devolução de consumo, variantes pela coluna especie (famílias estoque.<espécie>; a requisição é estoque.requisicao_material). Nasce aberto; o saldo só muda na confirmação; a requisição confirmada reserva.';
comment on column erp.documentos_estoque.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo estoque; os locais de estoque são desta empresa.';
comment on column erp.documentos_estoque.especie is 'Espécie: entrada, saida, transferencia, ajuste (inventário), requisicao (pedido de material), consumo ou devolucao_consumo. Não muda depois do lançamento.';
comment on column erp.documentos_estoque.armazem_id is 'Local de estoque do documento (origem, na transferência): da empresa do documento, não excluído.';
comment on column erp.documentos_estoque.armazem_destino_id is 'Local de estoque de destino: só na transferência, diferente da origem, da mesma empresa do documento.';
comment on column erp.documentos_estoque.origem_documento_id is 'OPERACOES-01 F5a: documento de origem (FK composta com a organização): a requisição que o consumo atende (opcional) ou o consumo de que a devolução de consumo puxa (obrigatório). Mesma empresa e mesmo local de estoque; não muda depois do lançamento.';
comment on column erp.documentos_estoque.centro_custo_id is 'OPERACOES-01 F5a: destino — centro de resultado (erp.cost_centers, da organização; FK composta). Só na requisição, no consumo, na saída e na devolução de consumo.';
comment on column erp.documentos_estoque.equipamento_id is 'OPERACOES-01 F5a: destino — máquina/equipamento (erp.equipments, da empresa do documento; FK composta).';
comment on column erp.documentos_estoque.ordem_servico_id is 'OPERACOES-01 F5a: destino — ordem de serviço (erp.service_orders, da empresa do documento; FK composta).';
comment on column erp.documentos_estoque.lote_animais_id is 'OPERACOES-01 F5a: destino — lote de animais (erp.batches, da empresa do documento; FK composta).';
comment on column erp.documentos_estoque.area_id is 'OPERACOES-01 F5a: destino — área/talhão (erp.areas, da empresa do documento; FK composta).';
comment on column erp.documentos_estoque.safra_id is 'OPERACOES-01 F5a: destino — safra (erp.harvests, da organização; FK composta).';
comment on column erp.documentos_estoque.motivo_saida is 'OPERACOES-01 F5a: motivo da saída (os 13 da baixa antiga: loss, deterioration, theft, damage, inventory, accounting, burglary, expiration, gift, donation, consumption, payment_with_product, other). Só na saída, em par com a justificativa.';
comment on column erp.documentos_estoque.justificativa is 'OPERACOES-01 F5a: justificativa da saída (não vazia), em par com o motivo. Só na saída.';
comment on column erp.documentos_estoque.saldo_encerrado_em is 'OPERACOES-01 F5a: quando o saldo pendente da requisição foi encerrado (só requisição confirmada; os três campos juntos, uma vez).';
comment on column erp.documentos_estoque.saldo_encerrado_por is 'OPERACOES-01 F5a: quem encerrou o saldo pendente da requisição.';
comment on column erp.documentos_estoque.saldo_encerrado_motivo is 'OPERACOES-01 F5a: por que o saldo pendente da requisição foi encerrado (não vazio).';

comment on table erp.documentos_estoque_itens is 'Itens do documento de estoque (ESTOQUE-01; OPERACOES-01 F5a). Só mudam com o documento aberto (gatilho); a espécie copiada do cabeçalho (FK de três colunas) sustenta o CHECK por espécie; o item do consumo e o da devolução de consumo podem apontar o item de origem.';
comment on column erp.documentos_estoque_itens.especie is 'Cópia da espécie do documento (garantida pela FK composta): entrada, saida, transferencia, ajuste, requisicao, consumo ou devolucao_consumo; é o que deixa o CHECK por espécie no banco.';
comment on column erp.documentos_estoque_itens.custo_unitario is 'Custo unitário (6 casas, precisão do razão): informado na entrada (vazio, a confirmação grava o custo médio do produto) e opcional no ajuste; nas outras espécies, o custo do movimento gravado na confirmação. A requisição não tem custo.';
comment on column erp.documentos_estoque_itens.saldo_na_confirmacao is 'Saldo do balde (local de estoque × produto × lote) lido sob trava na confirmação do ajuste; só no ajuste.';
comment on column erp.documentos_estoque_itens.origem_item_id is 'OPERACOES-01 F5a: item de origem (FK composta com a organização): o item da requisição que esta linha do consumo atende, ou o item do consumo que esta linha da devolução de consumo devolve (obrigatório na devolução). Saldo do item de origem = quantidade − soma ligada em documentos não cancelados.';

comment on column erp.stock_movements.equipamento_id is 'OPERACOES-01 F5a: destino — máquina/equipamento do movimento (FK composta com a organização).';
comment on column erp.stock_movements.ordem_servico_id is 'OPERACOES-01 F5a: destino — ordem de serviço do movimento (FK composta com a organização).';
comment on column erp.stock_movements.lote_animais_id is 'OPERACOES-01 F5a: destino — lote de animais do movimento (FK composta com a organização).';
comment on column erp.stock_movements.area_id is 'OPERACOES-01 F5a: destino — área/talhão do movimento (FK composta com a organização).';

-- ---------- 8) funções ----------
-- 8.1 Conferência do cabeçalho: tudo o que a 0040 fazia, mais a família por CASE, a origem, o destino herdado,
-- as referências do destino e o encerramento do saldo da requisição. SECURITY DEFINER estreita: lê a origem e o
-- cadastro da MESMA organização da linha, devolve só a recusa, sem SQL dinâmico.
-- A origem é lida com TODO o filtro da recusa no WHERE (organização, espécie esperada, empresa e local de
-- estoque do documento): a origem que não serve não é lida nem travada, e responde a MESMA recusa — esta função
-- atravessa a RLS, e uma mensagem própria para "é de outra empresa" diria que aquele id existe na outra. A
-- situação só é dita depois de a empresa e o local de estoque conferirem.
create or replace function erp.documentos_estoque_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_familia text;
  v_origem record;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.especie is distinct from old.especie
       or new.empresa_id is distinct from old.empresa_id or new.codigo is distinct from old.codigo then
      raise exception 'VALIDATION_ERROR: Organização, empresa, espécie e código do documento de estoque não mudam.' using errcode = 'P0001';
    end if;
    if new.tipo_operacao_id is distinct from old.tipo_operacao_id or new.tipo_operacao_versao_id is distinct from old.tipo_operacao_versao_id then
      raise exception 'VALIDATION_ERROR: O tipo de operação e a versão congelada do documento de estoque não mudam depois do lançamento.' using errcode = 'P0001';
    end if;
    -- A origem é identidade do documento, como a TOP: nem aberto ela muda.
    if new.origem_documento_id is distinct from old.origem_documento_id then
      raise exception 'VALIDATION_ERROR: A origem do documento de estoque não muda depois do lançamento.' using errcode = 'P0001';
    end if;
    -- Cancelado é final: nada muda (nem o motivo). O carimbo abaixo não conta como mudança.
    if old.situacao = 'cancelado' and (to_jsonb(new) - 'atualizado_em') is distinct from (to_jsonb(old) - 'atualizado_em') then
      raise exception 'CONFLICT: O documento de estoque está cancelado; o cancelamento é final.' using errcode = 'P0001';
    end if;
    -- Encerrar o saldo é uma mudança só da requisição CONFIRMADA (a pendente), uma vez, e sozinha.
    if (new.saldo_encerrado_em, new.saldo_encerrado_por, new.saldo_encerrado_motivo)
         is distinct from (old.saldo_encerrado_em, old.saldo_encerrado_por, old.saldo_encerrado_motivo) then
      if old.situacao = 'aberto' then
        raise exception 'CONFLICT: Só a requisição confirmada tem o saldo encerrado.' using errcode = 'P0001';
      end if;
      if old.saldo_encerrado_em is not null or old.saldo_encerrado_por is not null or old.saldo_encerrado_motivo is not null then
        raise exception 'CONFLICT: O saldo da requisição já foi encerrado.' using errcode = 'P0001';
      end if;
      if old.especie = 'requisicao'
         and (to_jsonb(new) - 'saldo_encerrado_em' - 'saldo_encerrado_por' - 'saldo_encerrado_motivo' - 'atualizado_em')
             is not distinct from (to_jsonb(old) - 'saldo_encerrado_em' - 'saldo_encerrado_por' - 'saldo_encerrado_motivo' - 'atualizado_em') then
        -- Os três juntos e o motivo não vazio são o CHECK chk_documentos_estoque_saldo_encerrado.
        new.atualizado_em := now();
        return new;
      end if;
      raise exception 'CONFLICT: O documento de estoque está confirmado; só o cancelamento muda.' using errcode = 'P0001';
    end if;
    -- Confirmado: só o cancelamento (situação, quem, quando e o motivo). Locais de estoque, data, observação,
    -- destino e os carimbos da confirmação ficam como a confirmação os deixou.
    if old.situacao = 'confirmado'
       and (to_jsonb(new) - 'situacao' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'atualizado_em')
           is distinct from (to_jsonb(old) - 'situacao' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'atualizado_em') then
      raise exception 'CONFLICT: O documento de estoque está confirmado; só o cancelamento muda.' using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  if tg_op = 'INSERT' then
    if new.situacao <> 'aberto' or new.confirmado_em is not null or new.confirmado_por is not null
       or new.cancelado_em is not null or new.cancelado_por is not null or new.motivo_cancelamento is not null
       or new.saldo_encerrado_em is not null or new.saldo_encerrado_por is not null or new.saldo_encerrado_motivo is not null then
      raise exception 'VALIDATION_ERROR: O documento de estoque nasce aberto; a confirmação e o cancelamento são transições.' using errcode = 'P0001';
    end if;
    -- A família da espécie: estoque.<espécie>, menos a requisição de material (a estoque.requisicao é a da
    -- tabela antiga erp.requisitions).
    v_familia := case new.especie when 'requisicao' then 'estoque.requisicao_material' else 'estoque.' || new.especie end;
    if not exists (select 1 from erp.tipos_operacao t where t.id = new.tipo_operacao_id and t.organization_id = new.organization_id
                    and t.codigo_base = v_familia) then
      raise exception 'VALIDATION_ERROR: O tipo de operação não é da família do documento (%).', v_familia using errcode = 'P0001';
    end if;
    -- A origem do consumo e da devolução (nas outras espécies, quem recusa a origem é o CHECK
    -- chk_documentos_estoque_origem): FOR SHARE segura a origem até o fim da transação — o cancelamento e o
    -- encerramento concorrentes esperam este documento commitar ou desfazer, e então o enxergam.
    if new.origem_documento_id is not null and new.especie in ('consumo', 'devolucao_consumo') then
      select o.situacao, o.saldo_encerrado_em, o.centro_custo_id, o.equipamento_id, o.ordem_servico_id, o.lote_animais_id, o.area_id, o.safra_id
        into v_origem
        from erp.documentos_estoque o
       where o.id = new.origem_documento_id and o.organization_id = new.organization_id
         and o.especie = case new.especie when 'consumo' then 'requisicao' else 'consumo' end
         and o.empresa_id = new.empresa_id and o.armazem_id = new.armazem_id
         for share;
      if new.especie = 'consumo' then
        if not found then
          raise exception 'VALIDATION_ERROR: A origem do consumo precisa ser uma requisição da mesma empresa e do mesmo local de estoque.' using errcode = 'P0001';
        end if;
        if v_origem.situacao <> 'confirmado' then
          raise exception 'CONFLICT: A requisição de origem não está pendente (situação: %).', v_origem.situacao using errcode = 'P0001';
        end if;
        if v_origem.saldo_encerrado_em is not null then
          raise exception 'CONFLICT: O saldo da requisição de origem foi encerrado.' using errcode = 'P0001';
        end if;
      else
        if not found then
          raise exception 'VALIDATION_ERROR: A origem da devolução precisa ser um consumo da mesma empresa e do mesmo local de estoque.' using errcode = 'P0001';
        end if;
        if v_origem.situacao <> 'confirmado' then
          raise exception 'CONFLICT: O consumo de origem não está confirmado (situação: %).', v_origem.situacao using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;
  -- DESTINO HERDADO: o consumo leva cada dimensão que a requisição tem; a devolução leva as seis do consumo. No
  -- INSERT a origem já foi lida acima; no UPDATE que mude o destino de documento com origem, é lida aqui.
  if new.origem_documento_id is not null and new.especie in ('consumo', 'devolucao_consumo')
     and (tg_op = 'INSERT'
          or (new.centro_custo_id, new.equipamento_id, new.ordem_servico_id, new.lote_animais_id, new.area_id, new.safra_id)
             is distinct from (old.centro_custo_id, old.equipamento_id, old.ordem_servico_id, old.lote_animais_id, old.area_id, old.safra_id)) then
    if tg_op = 'UPDATE' then
      select o.situacao, o.saldo_encerrado_em, o.centro_custo_id, o.equipamento_id, o.ordem_servico_id, o.lote_animais_id, o.area_id, o.safra_id
        into v_origem
        from erp.documentos_estoque o
       where o.id = new.origem_documento_id and o.organization_id = new.organization_id
         for share;
    end if;
    if new.especie = 'consumo'
       and ((v_origem.centro_custo_id is not null and new.centro_custo_id is distinct from v_origem.centro_custo_id)
         or (v_origem.equipamento_id is not null and new.equipamento_id is distinct from v_origem.equipamento_id)
         or (v_origem.ordem_servico_id is not null and new.ordem_servico_id is distinct from v_origem.ordem_servico_id)
         or (v_origem.lote_animais_id is not null and new.lote_animais_id is distinct from v_origem.lote_animais_id)
         or (v_origem.area_id is not null and new.area_id is distinct from v_origem.area_id)
         or (v_origem.safra_id is not null and new.safra_id is distinct from v_origem.safra_id)) then
      raise exception 'VALIDATION_ERROR: O destino do consumo é o da requisição de origem.' using errcode = 'P0001';
    end if;
    if new.especie = 'devolucao_consumo'
       and (new.centro_custo_id, new.equipamento_id, new.ordem_servico_id, new.lote_animais_id, new.area_id, new.safra_id)
           is distinct from (v_origem.centro_custo_id, v_origem.equipamento_id, v_origem.ordem_servico_id, v_origem.lote_animais_id, v_origem.area_id, v_origem.safra_id) then
      raise exception 'VALIDATION_ERROR: O destino da devolução de consumo é o do consumo de origem.' using errcode = 'P0001';
    end if;
  end if;
  -- Locais de estoque da EMPRESA do documento (transferência entre empresas fica nas telas antigas), não excluídos.
  if tg_op = 'INSERT' or new.armazem_id is distinct from old.armazem_id then
    if not exists (select 1 from erp.warehouses w where w.id = new.armazem_id and w.organization_id = new.organization_id
                    and w.empresa_id = new.empresa_id and w.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O local de estoque precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  if new.armazem_destino_id is not null and (tg_op = 'INSERT' or new.armazem_destino_id is distinct from old.armazem_destino_id) then
    if not exists (select 1 from erp.warehouses w where w.id = new.armazem_destino_id and w.organization_id = new.organization_id
                    and w.empresa_id = new.empresa_id and w.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O local de estoque de destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  -- Referências do destino (só as informadas; no INSERT ou quando a coluna muda): existem na organização e não
  -- estão excluídas; as de empresa são da empresa do documento. Ativo/inativo e centro analítico são da API.
  if new.centro_custo_id is not null and (tg_op = 'INSERT' or new.centro_custo_id is distinct from old.centro_custo_id) then
    if not exists (select 1 from erp.cost_centers c where c.id = new.centro_custo_id and c.organization_id = new.organization_id
                    and c.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O centro de resultado do destino precisa existir na organização.' using errcode = 'P0001';
    end if;
  end if;
  if new.safra_id is not null and (tg_op = 'INSERT' or new.safra_id is distinct from old.safra_id) then
    if not exists (select 1 from erp.harvests h where h.id = new.safra_id and h.organization_id = new.organization_id
                    and h.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: A safra do destino precisa existir na organização.' using errcode = 'P0001';
    end if;
  end if;
  if new.equipamento_id is not null and (tg_op = 'INSERT' or new.equipamento_id is distinct from old.equipamento_id) then
    if not exists (select 1 from erp.equipments e where e.id = new.equipamento_id and e.organization_id = new.organization_id
                    and e.empresa_id = new.empresa_id and e.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: A máquina/equipamento do destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  if new.ordem_servico_id is not null and (tg_op = 'INSERT' or new.ordem_servico_id is distinct from old.ordem_servico_id) then
    if not exists (select 1 from erp.service_orders s where s.id = new.ordem_servico_id and s.organization_id = new.organization_id
                    and s.empresa_id = new.empresa_id and s.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: A ordem de serviço do destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  if new.lote_animais_id is not null and (tg_op = 'INSERT' or new.lote_animais_id is distinct from old.lote_animais_id) then
    if not exists (select 1 from erp.batches b where b.id = new.lote_animais_id and b.organization_id = new.organization_id
                    and b.empresa_id = new.empresa_id and b.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O lote de animais do destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  if new.area_id is not null and (tg_op = 'INSERT' or new.area_id is distinct from old.area_id) then
    if not exists (select 1 from erp.areas a where a.id = new.area_id and a.organization_id = new.organization_id
                    and a.empresa_id = new.empresa_id and a.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: A área/talhão do destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_estoque_conferir() is
  'ESTOQUE-01 + OPERACOES-01 F5a: TOP da família da espécie (estoque.<especie>; a requisição é estoque.requisicao_material); local de estoque e destino da empresa do documento, não excluídos; organização/empresa/espécie/código/TOP/versão/origem imutáveis; origem do consumo = requisição confirmada sem saldo encerrado, da devolução = consumo confirmado, ambas da mesma empresa e local de estoque (FOR SHARE); destino herdado da origem; referências do destino existentes e da empresa; confirmado só se cancela (ou, na requisição, encerra o saldo uma vez); cancelado não muda; nasce aberto; carimba atualizado_em.';

-- 8.2 Transição de situação: a de hoje, mais a recusa do cancelamento com dependentes vivos. SECURITY DEFINER
-- porque passou a ler outras linhas da organização (o molde da 0037, item 6); o EXECUTE continua só do dono (o
-- CREATE OR REPLACE preserva a ACL).
create or replace function erp.documentos_estoque_transicao() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if new.situacao = old.situacao then
    return new;
  end if;
  if old.situacao = 'cancelado' then
    raise exception 'CONFLICT: O documento de estoque está cancelado; o cancelamento é final.' using errcode = 'P0001';
  end if;
  if old.situacao = 'aberto' and new.situacao = 'confirmado' then
    return new;
  end if;
  if new.situacao = 'cancelado' and old.situacao in ('aberto', 'confirmado') then
    -- O aberto se cancela sem nunca ter sido confirmado: nenhum carimbo de confirmação aparece no caminho.
    if old.situacao = 'aberto' and new.confirmado_em is not null then
      raise exception 'CONFLICT: Documento de estoque aberto não é cancelado como confirmado.' using errcode = 'P0001';
    end if;
    -- A requisição com consumo vivo e o consumo com devolução viva não se cancelam: desfaz-se de baixo para cima.
    if new.especie = 'requisicao' and exists (select 1 from erp.documentos_estoque c
                                               where c.origem_documento_id = new.id and c.organization_id = new.organization_id
                                                 and c.especie = 'consumo' and c.situacao <> 'cancelado') then
      raise exception 'CONFLICT: Esta requisição tem consumos: cancele-os ou encerre o saldo.' using errcode = 'P0001';
    end if;
    if new.especie = 'consumo' and exists (select 1 from erp.documentos_estoque c
                                            where c.origem_documento_id = new.id and c.organization_id = new.organization_id
                                              and c.especie = 'devolucao_consumo' and c.situacao <> 'cancelado') then
      raise exception 'CONFLICT: Este consumo tem devoluções: cancele-as primeiro.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  raise exception 'CONFLICT: Transição de situação inválida no documento de estoque (% para %).', old.situacao, new.situacao using errcode = 'P0001';
end $$;
comment on function erp.documentos_estoque_transicao() is
  'ESTOQUE-01 + OPERACOES-01 F5a: aberto→confirmado, aberto→cancelado, confirmado→cancelado; nada volta; cancelado é final; a requisição com consumo não cancelado e o consumo com devolução não cancelada não se cancelam.';

-- 8.3 A invariante do saldo ligado, no banco (gatilho da origem dos itens; molde da 0037). Ordem das travas:
-- cabeçalho de origem (FOR SHARE) → item de origem (FOR UPDATE) — a mesma da API. O gatilho do documento aberto
-- (0040), que dispara ANTES deste (ordem alfabética), já travou o cabeçalho do item e recusou documento fora do
-- aberto.
create function erp.documentos_estoque_item_origem_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_especie text;
  v_origem_doc uuid;
  v_origem_situacao text;
  v_origem_encerrado timestamptz;
  v_item_doc uuid;
  v_item_produto uuid;
  v_item_qtd numeric;
  v_ligado numeric;
begin
  select d.especie, d.origem_documento_id into v_especie, v_origem_doc
    from erp.documentos_estoque d where d.id = new.documento_id and d.organization_id = new.organization_id;

  if new.origem_item_id is null then
    if v_especie = 'devolucao_consumo' then
      raise exception 'VALIDATION_ERROR: Todo item da devolução de consumo vem de um item do consumo.' using errcode = 'P0001';
    end if;
    -- O consumo que atende uma requisição pode ter item sem origem (item a mais); as outras espécies não ligam.
    return new;
  end if;
  if v_origem_doc is null then
    raise exception 'VALIDATION_ERROR: O item com origem exige o documento de origem no cabeçalho.' using errcode = 'P0001';
  end if;
  select o.situacao, o.saldo_encerrado_em into v_origem_situacao, v_origem_encerrado
    from erp.documentos_estoque o where o.id = v_origem_doc and o.organization_id = new.organization_id for share;
  -- A trava do item de origem serializa duas partes simultâneas sobre o mesmo saldo: a segunda espera a primeira
  -- terminar, e a soma abaixo (comando novo, fotografia nova) já a enxerga.
  select i.documento_id, i.produto_id, i.quantidade into v_item_doc, v_item_produto, v_item_qtd
    from erp.documentos_estoque_itens i
   where i.id = new.origem_item_id and i.organization_id = new.organization_id
     for update;
  if v_item_doc is null or v_item_doc <> v_origem_doc then
    raise exception 'VALIDATION_ERROR: O item de origem não pertence ao documento de origem.' using errcode = 'P0001';
  end if;
  if v_item_produto <> new.produto_id then
    raise exception 'VALIDATION_ERROR: O produto do item difere do produto do item de origem.' using errcode = 'P0001';
  end if;
  if v_especie = 'consumo' then
    if v_origem_situacao is distinct from 'confirmado' or v_origem_encerrado is not null then
      raise exception 'CONFLICT: A requisição de origem não está pendente.' using errcode = 'P0001';
    end if;
    select coalesce(sum(i.quantidade), 0) into v_ligado
      from erp.documentos_estoque_itens i
      join erp.documentos_estoque c on c.id = i.documento_id and c.organization_id = i.organization_id
     where i.origem_item_id = new.origem_item_id and i.organization_id = new.organization_id
       and c.especie = 'consumo' and c.situacao <> 'cancelado'
       and i.id <> new.id;
    if v_ligado + new.quantidade > v_item_qtd then
      raise exception 'VALIDATION_ERROR: A quantidade passa do saldo pendente do item da requisição.' using errcode = 'P0001';
    end if;
  else
    -- Devolução de consumo (os CHECKs de origem prendem a espécie do item com origem).
    if v_origem_situacao is distinct from 'confirmado' then
      raise exception 'CONFLICT: O consumo de origem não está confirmado.' using errcode = 'P0001';
    end if;
    select coalesce(sum(i.quantidade), 0) into v_ligado
      from erp.documentos_estoque_itens i
      join erp.documentos_estoque c on c.id = i.documento_id and c.organization_id = i.organization_id
     where i.origem_item_id = new.origem_item_id and i.organization_id = new.organization_id
       and c.especie = 'devolucao_consumo' and c.situacao <> 'cancelado'
       and i.id <> new.id;
    if v_ligado + new.quantidade > v_item_qtd then
      raise exception 'VALIDATION_ERROR: A quantidade passa do que o item do consumo baixou e ainda não voltou.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_estoque_item_origem_guarda() is
  'OPERACOES-01 F5a: item com origem só com o documento de origem no cabeçalho; o item de origem é desse documento e do mesmo produto (travado FOR UPDATE); consumo: requisição confirmada sem saldo encerrado e soma ligada em consumos não cancelados ≤ quantidade do item; devolução de consumo: todo item com origem, consumo confirmado e soma devolvida em devoluções não canceladas ≤ quantidade do item do consumo.';
create trigger trg_documentos_estoque_itens_origem_guarda
  before insert or update of origem_item_id, quantidade, produto_id on erp.documentos_estoque_itens
  for each row execute function erp.documentos_estoque_item_origem_guarda();

-- 8.4 Reserva (a 0035), parte C. O núcleo: A e B como na 0035, mais C1 e C2, cada parte agregada UMA vez por par e
-- só então juntada aos pares pedidos.
create or replace function erp.reserva_estoque_nucleo(p_org uuid, p_armazens uuid[], p_produtos uuid[], p_excluir_documento uuid)
  returns table (warehouse_id uuid, product_id uuid, reservado numeric)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
#variable_conflict use_column
begin
  return query
  with pares as (
    select distinct x.w as warehouse_id, x.p as product_id
      from unnest(p_armazens, p_produtos) as x(w, p)
     where p_org is not null and x.w is not null and x.p is not null
  ),
  -- A) o saldo a faturar dos pedidos com reserva, abertos e sem saldo encerrado (partes: a mesma conta da 0034);
  --    só item de produto com controle de estoque (o sem controle não tem saldo a prometer)
  a as (
    select oi.warehouse_id, oi.product_id,
           sum(greatest(oi.quantity - coalesce((select sum(pi.quantity)
                                                   from erp.sales_document_items pi
                                                   join erp.sales_documents pd on pd.id = pi.document_id
                                                  where pi.origem_item_id = oi.id and pd.status <> 'cancelled'), 0), 0)) as q
      from erp.sales_documents o
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
      join erp.sales_document_items oi on oi.document_id = o.id
      join pares x on x.warehouse_id = oi.warehouse_id and x.product_id = oi.product_id
      join erp.products p on p.id = oi.product_id and p.organization_id = o.organization_id and p.control_stock
     where o.organization_id = p_org and o.kind = 'order' and o.status in ('open', 'approved')
       and o.saldo_encerrado_em is null and o.deleted_at is null and v.reserva_estoque
       and o.id is distinct from p_excluir_documento
     group by oi.warehouse_id, oi.product_id
  ),
  -- B) as vendas abertas geradas de pedido com reserva; só item de produto com controle de estoque
  b as (
    select si.warehouse_id, si.product_id, sum(si.quantity) as q
      from erp.sales_documents s
      join erp.sales_documents o on o.id = s.origin_document_id and o.organization_id = s.organization_id
      join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
      join erp.sales_document_items si on si.document_id = s.id
      join pares x on x.warehouse_id = si.warehouse_id and x.product_id = si.product_id
      join erp.products p on p.id = si.product_id and p.organization_id = s.organization_id and p.control_stock
     where s.organization_id = p_org and s.kind = 'sale' and s.status in ('open', 'approved') and s.deleted_at is null
       and o.kind = 'order' and v.reserva_estoque
       and s.id is distinct from p_excluir_documento
     group by si.warehouse_id, si.product_id
  ),
  -- C1) o saldo pendente das requisições de material confirmadas (= pendentes) e sem saldo encerrado: quantidade −
  --     consumos NÃO cancelados ligados ao item (a mesma conta de A); só produto com controle de estoque
  c1 as (
    select d.armazem_id as warehouse_id, i.produto_id as product_id,
           sum(greatest(i.quantidade - coalesce((select sum(ci.quantidade)
                                                    from erp.documentos_estoque_itens ci
                                                    join erp.documentos_estoque cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
                                                   where ci.origem_item_id = i.id and ci.organization_id = i.organization_id
                                                     and cd.especie = 'consumo' and cd.situacao <> 'cancelado'), 0), 0)) as q
      from erp.documentos_estoque d
      join erp.documentos_estoque_itens i on i.documento_id = d.id and i.organization_id = d.organization_id
      join pares x on x.warehouse_id = d.armazem_id and x.product_id = i.produto_id
      join erp.products p on p.id = i.produto_id and p.organization_id = d.organization_id and p.control_stock
     where d.organization_id = p_org and d.especie = 'requisicao' and d.situacao = 'confirmado'
       and d.saldo_encerrado_em is null and d.id is distinct from p_excluir_documento
     group by d.armazem_id, i.produto_id
  ),
  -- C2) os itens LIGADOS dos consumos abertos (o consumo ainda não baixou; a parte dele saiu de C1 e não pode
  --     sumir da conta antes da saída); só produto com controle de estoque
  c2 as (
    select d.armazem_id as warehouse_id, i.produto_id as product_id, sum(i.quantidade) as q
      from erp.documentos_estoque d
      join erp.documentos_estoque_itens i on i.documento_id = d.id and i.organization_id = d.organization_id
      join pares x on x.warehouse_id = d.armazem_id and x.product_id = i.produto_id
      join erp.products p on p.id = i.produto_id and p.organization_id = d.organization_id and p.control_stock
     where d.organization_id = p_org and d.especie = 'consumo' and d.situacao = 'aberto'
       and i.origem_item_id is not null and d.id is distinct from p_excluir_documento
     group by d.armazem_id, i.produto_id
  )
  select x.warehouse_id, x.product_id, (coalesce(a.q, 0) + coalesce(b.q, 0) + coalesce(c1.q, 0) + coalesce(c2.q, 0))::numeric(18,4)
    from pares x
    left join a on a.warehouse_id = x.warehouse_id and a.product_id = x.product_id
    left join b on b.warehouse_id = x.warehouse_id and b.product_id = x.product_id
    left join c1 on c1.warehouse_id = x.warehouse_id and c1.product_id = x.product_id
    left join c2 on c2.warehouse_id = x.warehouse_id and c2.product_id = x.product_id;
end $$;
comment on function erp.reserva_estoque_nucleo(uuid, uuid[], uuid[], uuid) is
  'TOP-CONFIG-07 + OPERACOES-01 F5a: reservado por (local de estoque, produto) na organização informada = A (saldo a faturar de pedidos com reserva abertos) + B (itens de vendas abertas geradas deles) + C1 (saldo pendente de requisições de material confirmadas sem saldo encerrado) + C2 (itens ligados de consumos abertos), só produto com controle de estoque. Sem grant: só o dono chama (gatilho de saída e erp.reserva_estoque).';

-- A porta exposta: a mesma, aceitando também quem vê ou edita requisição de material (a prévia e a confirmação
-- da requisição leem o disponível).
create or replace function erp.reserva_estoque(p_armazens uuid[], p_produtos uuid[], p_excluir_documento uuid default null)
  returns table (warehouse_id uuid, product_id uuid, reservado numeric)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null or p_armazens is null or p_produtos is null
     or cardinality(p_armazens) <> cardinality(p_produtos) or cardinality(p_armazens) > 1000 then
    return;
  end if;
  if not (erp.has_permission(v_org, v_user, 'stocks.view')
          or erp.has_permission(v_org, v_user, 'orders.view')
          or erp.has_permission(v_org, v_user, 'orders.create')
          or erp.has_permission(v_org, v_user, 'orders.edit')
          or erp.has_permission(v_org, v_user, 'sales.view')
          or erp.has_permission(v_org, v_user, 'sales.create')
          or erp.has_permission(v_org, v_user, 'sales.edit')
          or erp.has_permission(v_org, v_user, 'requisicoes_estoque.view')
          or erp.has_permission(v_org, v_user, 'requisicoes_estoque.edit')) then
    return;
  end if;
  return query select n.warehouse_id, n.product_id, n.reservado
                 from erp.reserva_estoque_nucleo(v_org, p_armazens, p_produtos, p_excluir_documento) n;
end $$;
comment on function erp.reserva_estoque(uuid[], uuid[], uuid) is
  'TOP-CONFIG-07 + OPERACOES-01 F5a: reservado por (local de estoque, produto) na organização da GUC, em lote. Porta estreita: exige capacidade de estoque, de venda ou de requisição de material (ver ou editar); sem ela, zero linhas. Devolve só números.';

-- A guarda das saídas: VOLÁTIL DE PROPÓSITO (cada instrução tira foto nova — ver a 0035). O atalho passa a sair só
-- quando a organização não tem versão com reserva NEM requisição pendente NEM consumo aberto ligado. A exclusão:
-- a venda que sai tira a própria parte B (como hoje); o consumo que sai tira a própria parte C2. Uma origem que
-- não é venda nem consumo desta organização não exclui nada. A MENSAGEM NÃO MUDA.
create or replace function erp.stock_movement_reserva_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_fisico numeric;
  v_reservado numeric;
  v_excluir uuid;
begin
  if NEW.direction <> -1 or NEW.movement_type in ('correction_out', 'reversal') then
    return null;
  end if;
  -- ATALHO EXATO: A e B exigem uma versão com reserva DA MESMA organização; C1 e C2, uma requisição pendente ou um
  -- consumo aberto ligado (índice parcial ix_documentos_estoque_reserva). Sem nenhum dos dois, o reservado é zero.
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = NEW.organization_id and v.reserva_estoque)
     and not exists (select 1 from erp.documentos_estoque d
                      where d.organization_id = NEW.organization_id
                        and ((d.especie = 'requisicao' and d.situacao = 'confirmado' and d.saldo_encerrado_em is null)
                          or (d.especie = 'consumo' and d.situacao = 'aberto' and d.origem_documento_id is not null))) then
    return null;
  end if;
  if NEW.source_type = 'sales_documents' then
    select s.id into v_excluir from erp.sales_documents s
     where s.id = NEW.source_id and s.organization_id = NEW.organization_id and s.kind = 'sale';
  elsif NEW.source_type = 'documentos_estoque' then
    select d.id into v_excluir from erp.documentos_estoque d
     where d.id = NEW.source_id and d.organization_id = NEW.organization_id and d.especie = 'consumo';
  end if;
  -- CONCORRÊNCIA: trg_stock_movement_apply (BEFORE) já baixou o saldo do lote e travou a linha do produto; o
  -- salvamento do pedido com reserva e a confirmação da requisição travam a MESMA linha antes de conferir. Cada
  -- instrução abaixo tira foto nova (READ COMMITTED): o que comitou durante a espera ENTRA na conta.
  select coalesce(sum(b.quantity), 0) into v_fisico
    from erp.stock_balances b
   where b.organization_id = NEW.organization_id and b.warehouse_id = NEW.warehouse_id and b.product_id = NEW.product_id;
  select coalesce(sum(n.reservado), 0) into v_reservado
    from erp.reserva_estoque_nucleo(NEW.organization_id, array[NEW.warehouse_id], array[NEW.product_id], v_excluir) n;
  if v_fisico < v_reservado then
    raise exception 'INSUFFICIENT_STOCK: disponível % < solicitado % (% reservado para pedidos)',
      replace(trim_scale(v_fisico + NEW.quantity - v_reservado)::text, '.', ','),
      replace(trim_scale(NEW.quantity)::text, '.', ','),
      replace(trim_scale(v_reservado)::text, '.', ',')
      using errcode = 'P0001';
  end if;
  return null;
end $$;
comment on function erp.stock_movement_reserva_guarda() is
  'TOP-CONFIG-07 + OPERACOES-01 F5a: recusa saída (menos correction_out e reversal) que deixaria o físico do local de estoque abaixo do reservado pelos outros (A + B + C; a venda que sai não conta a própria parte B, o consumo que sai não conta a própria parte C2). Não depende da capacidade de quem movimenta.';

-- O flag control_stock: o atalho como na guarda; primeiro A e B, com a mensagem de HOJE; depois C, com mensagem
-- própria. Em C1 conta o item de requisição com saldo PENDENTE (> 0): o atendido por inteiro não reserva nada e,
-- sem situação que o tire dali, travaria o flag para sempre (o pedido de venda sai de A ao virar convertido; a
-- requisição atendida continua confirmada). VOLÁTIL DE PROPÓSITO (ver a 0035).
create or replace function erp.products_controle_estoque_reserva() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  -- ATALHO EXATO: sem versão que reserve e sem requisição pendente nem consumo aberto ligado, A, B e C são vazios.
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = NEW.organization_id and v.reserva_estoque)
     and not exists (select 1 from erp.documentos_estoque d
                      where d.organization_id = NEW.organization_id
                        and ((d.especie = 'requisicao' and d.situacao = 'confirmado' and d.saldo_encerrado_em is null)
                          or (d.especie = 'consumo' and d.situacao = 'aberto' and d.origem_documento_id is not null))) then
    return NEW;
  end if;
  if exists (select 1
               from erp.sales_documents o
               join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
               join erp.sales_document_items oi on oi.document_id = o.id
              where o.organization_id = NEW.organization_id and o.kind = 'order' and o.status in ('open', 'approved')
                and o.saldo_encerrado_em is null and o.deleted_at is null and v.reserva_estoque
                and oi.product_id = NEW.id)
     or exists (select 1
               from erp.sales_documents s
               join erp.sales_documents o on o.id = s.origin_document_id and o.organization_id = s.organization_id
               join erp.tipos_operacao_versoes v on v.id = o.tipo_operacao_versao_id and v.organization_id = o.organization_id
               join erp.sales_document_items si on si.document_id = s.id
              where s.organization_id = NEW.organization_id and s.kind = 'sale' and s.status in ('open', 'approved')
                and s.deleted_at is null and o.kind = 'order' and v.reserva_estoque
                and si.product_id = NEW.id) then
    raise exception 'VALIDATION_ERROR: O produto está em pedido com reserva de estoque em aberto (ou em venda aberta gerada dele): não pode mudar "Controla estoque" agora. Fature, cancele ou encerre o saldo do pedido antes.'
      using errcode = 'P0001';
  end if;
  if exists (select 1
               from erp.documentos_estoque d
               join erp.documentos_estoque_itens i on i.documento_id = d.id and i.organization_id = d.organization_id
              where d.organization_id = NEW.organization_id and i.produto_id = NEW.id
                and d.especie = 'requisicao' and d.situacao = 'confirmado' and d.saldo_encerrado_em is null
                and i.quantidade > coalesce((select sum(ci.quantidade)
                                               from erp.documentos_estoque_itens ci
                                               join erp.documentos_estoque cd on cd.id = ci.documento_id and cd.organization_id = ci.organization_id
                                              where ci.origem_item_id = i.id and ci.organization_id = i.organization_id
                                                and cd.especie = 'consumo' and cd.situacao <> 'cancelado'), 0))
     or exists (select 1
               from erp.documentos_estoque d
               join erp.documentos_estoque_itens i on i.documento_id = d.id and i.organization_id = d.organization_id
              where d.organization_id = NEW.organization_id and i.produto_id = NEW.id
                and d.especie = 'consumo' and d.situacao = 'aberto' and i.origem_item_id is not null) then
    raise exception 'VALIDATION_ERROR: O produto está em requisição de material pendente (ou em consumo aberto que a atende): não pode mudar "Controla estoque" agora. Atenda, encerre o saldo ou cancele a requisição antes.'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;
comment on function erp.products_controle_estoque_reserva() is
  'TOP-CONFIG-07 + OPERACOES-01 F5a: recusa trocar products.control_stock (nas duas direções) enquanto houver item do produto em pedido com reserva aberto ou em venda aberta gerada dele (mensagem da 0035), ou em item de requisição de material confirmada com saldo pendente e sem saldo encerrado, ou em item ligado de consumo aberto (mensagem própria): o flag decide o que a conta da reserva enxerga. Confere a organização inteira; devolve só a recusa.';

-- 8.5 Mensagens que diziam "armazém": só o texto muda; corpo, atributos, dono e privilégios ficam.
-- erp.apply_stock_movement (0003): sem SECURITY DEFINER e sem search_path fixo, como sempre foi.
create or replace function erp.apply_stock_movement() returns trigger language plpgsql as $$
declare
  b erp.stock_balances%rowtype;
  new_qty numeric(18,4); new_avg numeric(18,6); new_total numeric(18,2);
  v_lot text := coalesce(new.provider_lot, '');
begin
  insert into erp.stock_balances (organization_id, warehouse_id, product_id, provider_lot, expiration_date)
  values (new.organization_id, new.warehouse_id, new.product_id, v_lot, new.expiration_date)
  on conflict do nothing;
  select * into b from erp.stock_balances
   where organization_id = new.organization_id and warehouse_id = new.warehouse_id and product_id = new.product_id and provider_lot = v_lot
   for update;
  if new.direction = 1 then
    new_qty := b.quantity + new.quantity;
    new_total := b.total_value + round(new.quantity * new.unit_cost, 2);
    new_avg := case when new_qty > 0 then new_total / new_qty else new.unit_cost end;
  else
    if b.quantity < new.quantity then
      raise exception 'INSUFFICIENT_STOCK: saldo % < solicitado % (produto %, local de estoque %)', b.quantity, new.quantity, new.product_id, new.warehouse_id
        using errcode = 'P0001';
    end if;
    new_qty := b.quantity - new.quantity;
    -- saída sempre a custo médio corrente (regra de custo médio ponderado)
    if new.unit_cost = 0 then new.unit_cost := b.average_cost; end if;
    new_total := case when new_qty = 0 then 0 else b.total_value - round(new.quantity * b.average_cost, 2) end;
    new_avg := case when new_qty > 0 then b.average_cost else 0 end;
  end if;
  update erp.stock_balances set quantity = new_qty, average_cost = new_avg, total_value = new_total, version = version + 1, updated_at = now(),
    expiration_date = coalesce(new.expiration_date, expiration_date)
   where organization_id = new.organization_id and warehouse_id = new.warehouse_id and product_id = new.product_id and provider_lot = v_lot;
  new.balance_after := new_qty; new.avg_cost_after := new_avg;
  -- cache no produto: custo médio consolidado
  update erp.products p set average_cost = coalesce((select sum(total_value)/nullif(sum(quantity),0) from erp.stock_balances sb where sb.product_id = p.id and sb.quantity > 0), p.average_cost)
   where p.id = new.product_id;
  return new;
end $$;

-- erp.products_controle_lote (0029): SECURITY DEFINER com search_path = erp, pg_catalog, como sempre foi. A
-- mensagem é a MSG_CONTROLE_COM_SALDO da API (apps/api/src/lib/produto.ts).
create or replace function erp.products_controle_lote() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if new.controle_lote = 'nenhum' and new.has_lot then new.controle_lote := 'lote'; end if;
  elsif new.controle_lote is distinct from old.controle_lote then
    null;
  elsif new.has_lot is distinct from old.has_lot then
    new.controle_lote := case when new.has_lot then 'lote' else 'nenhum' end;
  end if;
  new.has_lot := new.controle_lote <> 'nenhum';
  if tg_op = 'UPDATE' and new.controle_lote is distinct from old.controle_lote and exists (
       select 1 from erp.stock_balances b
        where b.organization_id = new.organization_id and b.product_id = new.id
        group by b.product_id having sum(b.quantity) <> 0) then
    raise exception 'VALIDATION_ERROR: O produto tem saldo em estoque: zere o saldo em todos os locais de estoque antes de mudar o controle de lote.';
  end if;
  return new;
end $$;

-- erp.documentos_compra_itens_documento_aberto (0036): SECURITY DEFINER com search_path = erp, pg_temp (o da 0038).
-- Tocada SÓ no texto da mensagem do local de estoque do item.
create or replace function erp.documentos_compra_itens_documento_aberto() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_doc record;
  v_id uuid;
  v_org uuid;
begin
  if tg_op = 'UPDATE' and (new.documento_id is distinct from old.documento_id or new.organization_id is distinct from old.organization_id) then
    raise exception 'VALIDATION_ERROR: O item não muda de documento.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then v_id := old.documento_id; v_org := old.organization_id;
  else v_id := new.documento_id; v_org := new.organization_id; end if;
  select d.situacao, d.especie, d.empresa_id into v_doc
    from erp.documentos_compra d where d.id = v_id and d.organization_id = v_org for share;
  if not found then
    raise exception 'NOT_FOUND: Documento de compra não encontrado' using errcode = 'P0001';
  end if;
  if v_doc.situacao <> 'aberto' then
    raise exception 'CONFLICT: Os itens só mudam com o documento de compra aberto (situação: %).', v_doc.situacao using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_doc.especie = 'pedido' and (new.lote is not null or new.validade is not null) then
    raise exception 'VALIDATION_ERROR: Pedido de compra não tem lote nem validade.' using errcode = 'P0001';
  end if;
  if new.armazem_id is not null and (tg_op = 'INSERT' or new.armazem_id is distinct from old.armazem_id) then
    if not exists (select 1 from erp.warehouses w where w.id = new.armazem_id and w.organization_id = new.organization_id
                    and w.empresa_id = v_doc.empresa_id) then
      raise exception 'VALIDATION_ERROR: O local de estoque do item precisa ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_itens_documento_aberto() is
  'COMPRAS-01: item só nasce, muda ou sai com o documento de compra aberto; pedido sem lote/validade; local de estoque da empresa do documento.';

-- 8.6 A função de gatilho nova não é porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos
-- (o laço da 0040; os nomes vêm do catálogo, nada de entrada de usuário). As substituídas mantêm a ACL que tinham.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname = 'documentos_estoque_item_origem_guarda'
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 9) a família do layout: as cinco de hoje e as sete de estoque ----------
-- Drop e add na MESMA instrução (o nome é o mesmo): não existe instante sem o CHECK. O conjunto novo CONTÉM o
-- anterior, então toda linha viva já passa.
alter table erp.layouts_documento
  drop constraint chk_layouts_documento_familia,
  add constraint chk_layouts_documento_familia check (familia in ('vendas.orcamento', 'vendas.pedido', 'vendas.venda', 'compras.pedido', 'compras.compra',
                                                                 'estoque.entrada', 'estoque.saida', 'estoque.transferencia', 'estoque.ajuste',
                                                                 'estoque.requisicao_material', 'estoque.consumo', 'estoque.devolucao_consumo'));

comment on column erp.layouts_documento.familia is 'Família canônica do documento: vendas.orcamento, vendas.pedido, vendas.venda, compras.pedido, compras.compra e as sete de estoque (estoque.entrada, estoque.saida, estoque.transferencia, estoque.ajuste, estoque.requisicao_material, estoque.consumo, estoque.devolucao_consumo — preparação da OPERACOES-01 F5b). Uma TOP só se liga a layout da própria família (gatilho).';

-- ---------- 10) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
declare
  v_lista text[];
begin
  -- As colunas novas, anuláveis, com os tipos do contrato (12 no documento, 1 no item, 4 no razão).
  if (select count(*) from pg_attribute a
       where not a.attisdropped and not a.attnotnull
         and ((a.attrelid = 'erp.documentos_estoque'::regclass
               and (a.attname, format_type(a.atttypid, a.atttypmod)) in (('origem_documento_id', 'uuid'), ('centro_custo_id', 'uuid'), ('equipamento_id', 'uuid'),
                     ('ordem_servico_id', 'uuid'), ('lote_animais_id', 'uuid'), ('area_id', 'uuid'), ('safra_id', 'uuid'), ('motivo_saida', 'text'),
                     ('justificativa', 'text'), ('saldo_encerrado_em', 'timestamp with time zone'), ('saldo_encerrado_por', 'uuid'), ('saldo_encerrado_motivo', 'text')))
           or (a.attrelid = 'erp.documentos_estoque_itens'::regclass and (a.attname, format_type(a.atttypid, a.atttypmod)) = ('origem_item_id', 'uuid'))
           or (a.attrelid = 'erp.stock_movements'::regclass
               and (a.attname, format_type(a.atttypid, a.atttypmod)) in (('equipamento_id', 'uuid'), ('ordem_servico_id', 'uuid'), ('lote_animais_id', 'uuid'), ('area_id', 'uuid'))))) <> 17 then
    raise exception 'OPERACOES-01 F5: colunas novas ausentes, de outro tipo ou obrigatorias (esperadas 17: 12 no documento, 1 no item, 4 no razao, todas anulaveis).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_estoque'::regclass and conname like 'chk_documentos_estoque_%') <> 12 then
    raise exception 'OPERACOES-01 F5: CHECKs de erp.documentos_estoque incompletos (esperados 12).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_estoque_itens'::regclass and conname like 'chk_documentos_estoque_itens_%') <> 11
     or exists (select 1 from pg_constraint where conrelid = 'erp.documentos_estoque_itens'::regclass and conname = 'chk_documentos_estoque_itens_custo_entrada') then
    raise exception 'OPERACOES-01 F5: CHECKs de erp.documentos_estoque_itens incompletos ou com o custo obrigatorio da entrada (esperados 11, sem chk_documentos_estoque_itens_custo_entrada).';
  end if;
  -- As listas dos CHECKs de espécie (as sete) e de família do layout (as doze).
  select array_agg(m[1] order by m[1]) into v_lista
    from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') m
   where c.conrelid = 'erp.documentos_estoque'::regclass and c.conname = 'chk_documentos_estoque_especie';
  if v_lista is distinct from array['ajuste', 'consumo', 'devolucao_consumo', 'entrada', 'requisicao', 'saida', 'transferencia'] then
    raise exception 'OPERACOES-01 F5: chk_documentos_estoque_especie sem as sete especies.';
  end if;
  select array_agg(m[1] order by m[1]) into v_lista
    from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') m
   where c.conrelid = 'erp.documentos_estoque_itens'::regclass and c.conname = 'chk_documentos_estoque_itens_especie';
  if v_lista is distinct from array['ajuste', 'consumo', 'devolucao_consumo', 'entrada', 'requisicao', 'saida', 'transferencia'] then
    raise exception 'OPERACOES-01 F5: chk_documentos_estoque_itens_especie sem as sete especies.';
  end if;
  select array_agg(m[1] order by m[1]) into v_lista
    from pg_constraint c cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g') m
   where c.conrelid = 'erp.layouts_documento'::regclass and c.conname = 'chk_layouts_documento_familia';
  if v_lista is distinct from array['compras.compra', 'compras.pedido', 'estoque.ajuste', 'estoque.consumo', 'estoque.devolucao_consumo', 'estoque.entrada',
                                    'estoque.requisicao_material', 'estoque.saida', 'estoque.transferencia', 'vendas.orcamento', 'vendas.pedido', 'vendas.venda'] then
    raise exception 'OPERACOES-01 F5: chk_layouts_documento_familia sem as doze familias (cinco de venda e compra, sete de estoque).';
  end if;
  -- As doze FKs compostas novas, POR NOME, sem cascata, na forma (coluna, organization_id) → (id, organization_id).
  if (select count(*)
        from (values ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_origem', 'origem_documento_id', 'erp.documentos_estoque'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_centro_custo', 'centro_custo_id', 'erp.cost_centers'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_equipamento', 'equipamento_id', 'erp.equipments'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_ordem_servico', 'ordem_servico_id', 'erp.service_orders'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_lote_animais', 'lote_animais_id', 'erp.batches'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_area', 'area_id', 'erp.areas'::regclass),
                     ('erp.documentos_estoque'::regclass, 'fk_documentos_estoque_safra', 'safra_id', 'erp.harvests'::regclass),
                     ('erp.documentos_estoque_itens'::regclass, 'fk_documentos_estoque_itens_origem', 'origem_item_id', 'erp.documentos_estoque_itens'::regclass),
                     ('erp.stock_movements'::regclass, 'fk_stock_movements_equipamento', 'equipamento_id', 'erp.equipments'::regclass),
                     ('erp.stock_movements'::regclass, 'fk_stock_movements_ordem_servico', 'ordem_servico_id', 'erp.service_orders'::regclass),
                     ('erp.stock_movements'::regclass, 'fk_stock_movements_lote_animais', 'lote_animais_id', 'erp.batches'::regclass),
                     ('erp.stock_movements'::regclass, 'fk_stock_movements_area', 'area_id', 'erp.areas'::regclass)) e(tabela, nome, coluna, alvo)
        join pg_constraint c on c.conrelid = e.tabela and c.conname = e.nome and c.contype = 'f' and c.confrelid = e.alvo
                            and c.confdeltype = 'a' and c.confupdtype = 'a'
                            and c.conkey = array[(select attnum from pg_attribute where attrelid = e.tabela and attname = e.coluna),
                                                 (select attnum from pg_attribute where attrelid = e.tabela and attname = 'organization_id')]::int2[]
                            and c.confkey = array[(select attnum from pg_attribute where attrelid = e.alvo and attname = 'id'),
                                                  (select attnum from pg_attribute where attrelid = e.alvo and attname = 'organization_id')]::int2[]) <> 12 then
    raise exception 'OPERACOES-01 F5: FKs compostas novas (7 do documento, 1 do item, 4 do razao) ausentes, em cascata ou fora da forma (coluna, organization_id) -> (id, organization_id) (esperadas 12).';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.documentos_estoque'::regclass and c.conname = 'fk_documentos_estoque_saldo_encerrado_por'
                    and c.contype = 'f' and c.confrelid = 'erp.users'::regclass) then
    raise exception 'OPERACOES-01 F5: fk_documentos_estoque_saldo_encerrado_por (-> erp.users) ausente.';
  end if;
  if (select count(*) from pg_constraint c
       where c.contype = 'u'
         and ((c.conrelid = 'erp.harvests'::regclass and c.conname = 'uq_harvests_tenant')
           or (c.conrelid = 'erp.equipments'::regclass and c.conname = 'uq_equipments_tenant')
           or (c.conrelid = 'erp.service_orders'::regclass and c.conname = 'uq_service_orders_tenant')
           or (c.conrelid = 'erp.batches'::regclass and c.conname = 'uq_batches_tenant')
           or (c.conrelid = 'erp.areas'::regclass and c.conname = 'uq_areas_tenant')
           or (c.conrelid = 'erp.documentos_estoque_itens'::regclass and c.conname = 'uq_documentos_estoque_itens_tenant'))
         and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'id'),
                              (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id')]::int2[]) <> 6 then
    raise exception 'OPERACOES-01 F5: chaves (id, organization_id) novas ausentes ou fora da ordem (esperadas 6).';
  end if;
  if to_regclass('erp.ix_documentos_estoque_origem') is null or to_regclass('erp.ix_documentos_estoque_reserva') is null
     or to_regclass('erp.ix_documentos_estoque_itens_origem') is null then
    raise exception 'OPERACOES-01 F5: indice da origem ou da reserva do documento de estoque ausente.';
  end if;
  -- O gatilho novo: BEFORE INSERT OR UPDATE OF (origem_item_id, quantidade, produto_id) FOR EACH ROW, ligado, na
  -- função certa, sem WHEN.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'erp.documentos_estoque_itens'::regclass and t.tgname = 'trg_documentos_estoque_itens_origem_guarda'
                    and not t.tgisinternal and t.tgenabled = 'O' and t.tgqual is null
                    and t.tgfoid = 'erp.documentos_estoque_item_origem_guarda()'::regprocedure
                    and t.tgtype = (1 | 2 | 4 | 16)
                    and (select array_agg(x order by x) from unnest(t.tgattr::int2[]) x)
                        = (select array_agg(a.attnum order by a.attnum) from pg_attribute a
                            where a.attrelid = 'erp.documentos_estoque_itens'::regclass and a.attname in ('origem_item_id', 'quantidade', 'produto_id'))) then
    raise exception 'OPERACOES-01 F5: trg_documentos_estoque_itens_origem_guarda ausente, desligado, de outro tipo (BEFORE INSERT OR UPDATE OF origem_item_id, quantidade, produto_id) ou na funcao errada.';
  end if;
  -- Os gatilhos EXATOS das duas tabelas, por nome e função.
  select array_agg(t.tgname || ' -> ' || t.tgfoid::regproc::text order by t.tgname collate "C") into v_lista
    from pg_trigger t where t.tgrelid = 'erp.documentos_estoque'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  if v_lista is distinct from array['trg_documentos_estoque_aprovacao -> ' || 'erp.documentos_estoque_aprovacao_guarda'::regproc::text,
                                    'trg_documentos_estoque_audit -> ' || 'erp.audit_row'::regproc::text,
                                    'trg_documentos_estoque_conferir -> ' || 'erp.documentos_estoque_conferir'::regproc::text,
                                    'trg_documentos_estoque_transicao -> ' || 'erp.documentos_estoque_transicao'::regproc::text] then
    raise exception 'OPERACOES-01 F5: gatilhos de erp.documentos_estoque diferentes de aprovacao, audit, conferir e transicao (ligados, nas funcoes certas).';
  end if;
  select array_agg(t.tgname || ' -> ' || t.tgfoid::regproc::text order by t.tgname collate "C") into v_lista
    from pg_trigger t where t.tgrelid = 'erp.documentos_estoque_itens'::regclass and not t.tgisinternal and t.tgenabled = 'O';
  if v_lista is distinct from array['trg_documentos_estoque_itens_documento_aberto -> ' || 'erp.documentos_estoque_itens_documento_aberto'::regproc::text,
                                    'trg_documentos_estoque_itens_origem_guarda -> ' || 'erp.documentos_estoque_item_origem_guarda'::regproc::text] then
    raise exception 'OPERACOES-01 F5: gatilhos de erp.documentos_estoque_itens diferentes de documento_aberto e origem_guarda (ligados, nas funcoes certas).';
  end if;
  -- SECURITY DEFINER com search_path "erp, pg_temp" nas sete que leem a organização inteira; o núcleo e a porta
  -- estáveis; a guarda e o flag VOLÁTEIS (foto nova por instrução).
  if (select count(*) from pg_proc p
       where p.oid in ('erp.documentos_estoque_conferir()'::regprocedure, 'erp.documentos_estoque_transicao()'::regprocedure,
                       'erp.documentos_estoque_item_origem_guarda()'::regprocedure, 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)'::regprocedure,
                       'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure, 'erp.stock_movement_reserva_guarda()'::regprocedure,
                       'erp.products_controle_estoque_reserva()'::regprocedure)
         and p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) <> 7 then
    raise exception 'OPERACOES-01 F5: funcoes do documento de estoque e da reserva sem SECURITY DEFINER ou sem search_path "erp, pg_temp" (esperadas 7).';
  end if;
  if (select count(*) from pg_proc p
       where (p.oid in ('erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)'::regprocedure, 'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure) and p.provolatile = 's')
          or (p.oid in ('erp.stock_movement_reserva_guarda()'::regprocedure, 'erp.products_controle_estoque_reserva()'::regprocedure) and p.provolatile = 'v')) <> 4 then
    raise exception 'OPERACOES-01 F5: volatilidade das funcoes da reserva errada (nucleo e porta STABLE; guarda e flag VOLATILE).';
  end if;
  -- As de mensagem com os atributos de sempre.
  if not exists (select 1 from pg_proc p where p.oid = 'erp.apply_stock_movement()'::regprocedure and not p.prosecdef and p.proconfig is null)
     or not exists (select 1 from pg_proc p where p.oid = 'erp.products_controle_lote()'::regprocedure and p.prosecdef
                     and p.proconfig = array['search_path=erp, pg_catalog'])
     or not exists (select 1 from pg_proc p where p.oid = 'erp.documentos_compra_itens_documento_aberto()'::regprocedure and p.prosecdef
                     and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'OPERACOES-01 F5: atributos das funcoes de mensagem mudaram (apply_stock_movement sem SECURITY DEFINER nem search_path; products_controle_lote e documentos_compra_itens_documento_aberto SECURITY DEFINER com o search_path de antes).';
  end if;
  -- EXECUTE: só o dono nas funções de gatilho e no núcleo; a porta, só o erp_app (e não PUBLIC).
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.documentos_estoque_conferir()'::regprocedure, 'erp.documentos_estoque_transicao()'::regprocedure,
                              'erp.documentos_estoque_item_origem_guarda()'::regprocedure, 'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)'::regprocedure,
                              'erp.stock_movement_reserva_guarda()'::regprocedure, 'erp.products_controle_estoque_reserva()'::regprocedure,
                              'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
                and not (p.oid = 'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure and a.grantee = 'erp_app'::regrole))
     or not has_function_privilege('erp_app', 'erp.reserva_estoque(uuid[],uuid[],uuid)', 'execute') then
    raise exception 'OPERACOES-01 F5: EXECUTE alem do dono nas funcoes de gatilho ou no nucleo da reserva, ou a porta da reserva sem o erp_app (ou com PUBLIC).';
  end if;
  -- As mensagens dizem "local de estoque": nenhuma função desta migration diz "armazém" (o identificador
  -- armazem_id continua — só o texto acentuado conta), e as quatro de mensagem dizem "local/locais de estoque".
  if exists (select 1 from pg_proc p
              where p.oid in ('erp.apply_stock_movement()'::regprocedure, 'erp.products_controle_lote()'::regprocedure,
                              'erp.documentos_compra_itens_documento_aberto()'::regprocedure, 'erp.documentos_estoque_conferir()'::regprocedure,
                              'erp.documentos_estoque_transicao()'::regprocedure, 'erp.documentos_estoque_item_origem_guarda()'::regprocedure,
                              'erp.reserva_estoque_nucleo(uuid,uuid[],uuid[],uuid)'::regprocedure, 'erp.reserva_estoque(uuid[],uuid[],uuid)'::regprocedure,
                              'erp.stock_movement_reserva_guarda()'::regprocedure, 'erp.products_controle_estoque_reserva()'::regprocedure)
                and p.prosrc ~ '[Aa][Rr][Mm][Aa][Zz][ÉéÊê]')
     or (select count(*) from pg_proc p
          where p.oid in ('erp.apply_stock_movement()'::regprocedure, 'erp.products_controle_lote()'::regprocedure,
                          'erp.documentos_compra_itens_documento_aberto()'::regprocedure, 'erp.documentos_estoque_conferir()'::regprocedure)
            and p.prosrc ~ 'loca(l|is) de estoque') <> 4 then
    raise exception 'OPERACOES-01 F5: mensagem de funcao ainda diz armazem, ou funcao de mensagem sem "local de estoque".';
  end if;
  -- RLS e privilégios das duas tabelas, como a 0040 os deixou.
  if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_estoque') is distinct from array['tenant_e_empresa']
     or (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_estoque_itens') is distinct from array['api_child'] then
    raise exception 'OPERACOES-01 F5: politicas do documento de estoque mudaram (esperadas tenant_e_empresa no cabecalho e api_child nos itens).';
  end if;
  if has_table_privilege('erp_app', 'erp.documentos_estoque', 'delete') or has_table_privilege('erp_app', 'erp.documentos_estoque_itens', 'delete')
     or has_table_privilege('erp_app', 'erp.documentos_estoque', 'truncate') or has_table_privilege('erp_app', 'erp.documentos_estoque_itens', 'truncate')
     or exists (select 1 from unnest(array['erp.documentos_estoque', 'erp.documentos_estoque_itens']) t(tabela)
                 cross join unnest(array['select', 'insert', 'update']) p(privilegio)
                 where not has_table_privilege('erp_app', t.tabela, p.privilegio)) then
    raise exception 'OPERACOES-01 F5: privilegios do erp_app no documento de estoque mudaram (esperado select/insert/update, sem delete nem truncate).';
  end if;
end $$;
