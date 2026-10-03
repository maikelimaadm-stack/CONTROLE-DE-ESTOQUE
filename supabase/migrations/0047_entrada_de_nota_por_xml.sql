-- =====================================================================
-- 0047 OPERACOES-01 F7 — ENTRADA DE NOTA POR XML NA CENTRAL DE COMPRAS — decisão 284
--
-- 1) Chaves (id, organization_id) novas em erp.chart_accounts, erp.dfe_documents e erp.purchase_requests: o alvo das
--    FKs COMPOSTAS que a compra e as tabelas novas apontam para a conta contábil, a DF-e e a solicitação. Aditivas: o
--    id já é único, nenhuma linha é reescrita.
-- 2) erp.notas_fiscais_xml — o ORIGINAL do XML da nota, guardado no servidor: imutável (sem UPDATE, DELETE nem
--    TRUNCATE), da empresa DESTINATÁRIA (FK composta), com o sha256 e o tamanho conferidos por CHECK. Uma linha por
--    conteúdo (organização + chave + sha256); a importação e a DF-e apontam para ela.
-- 3) erp.importacoes_nfe_compra — a importação do XML (a conferência sobrevive a recarregar a tela): nasce
--    'pendente' e é decidida uma vez — 'gerada' (com a COMPRA da mesma empresa e da mesma chave) ou 'descartada'.
--    Uma pendente por chave na organização; uma importação por compra. Nunca se apaga (decisão 247).
-- 4) erp.produto_fornecedor_vinculos — o vínculo LEMBRADO: fornecedor + código + unidade do fornecedor → produto +
--    fator (multiplica ou divide). Cadastro da organização (sem empresa), RLS de tenant, sem DELETE.
-- 5) A COMPRA ganha o que a nota antiga tinha: chave de acesso, UF, tipo de documento fiscal, IPI, ICMS-ST, seguro,
--    tipo de título, classificação CAPEX/OPEX, tipo de rateio, parcelas da nota (duplicatas), o vínculo com a DF-e e
--    com a solicitação de compra (12 colunas, todas anuláveis, SÓ da espécie compra). O CHECK do total é refeito na
--    MESMA instrução: + IPI + ICMS-ST + seguro (coalesce: nas linhas de hoje as colunas são nulas e a equação é a de
--    antes). O ITEM ganha "gera estoque", imobilizado e o bem criado, natureza e centro por item, IPI e ICMS-ST do
--    item e os dados do item NA NOTA (número, código, descrição, unidade, quantidade e o fator da conversão).
-- 6) erp.documentos_compra_rateio — o rateio POR VALOR da compra (natureza, centro, conta contábil e safra, com o
--    percentual): só da compra ABERTA com rateio_tipo = 'por_valor', e imutável depois de gravado.
-- 7) erp.dfe_documents.xml_id — o XML guardado da DF-e (FK composta); gravado uma vez, da mesma chave e empresa.
-- 8) A NOTA REPETIDA barrada NO BANCO: entre compras vivas pelo índice único parcial ux_documentos_compra_chave
--    (cancelar libera); entre compra e nota antiga (erp.invoices), nos DOIS sentidos, por duas SECURITY DEFINER
--    estreitas que travam a chave (pg_advisory_xact_lock de hashtextextended('nfe-chave:' || org || ':' || chave,
--    284)) e levantam DUPLICATE_DOCUMENT. O índice ux_invoices_key de hoje (nota × nota) fica como está. A guarda da
--    compra também deixa os dados fiscais imutáveis depois do lançamento e confere tipo de título, DF-e e
--    solicitação da MESMA organização (e empresa).
-- 9) Pré-condições nomeadas "OPERACOES-01 F7: …" ("já aplicada" primeiro) e pós-condições só de OBJETOS — nunca
--    contagem de tabela viva.
--
-- RLS, PRIVILÉGIOS E AUDITORIA: notas_fiscais_xml e importacoes_nfe_compra com o gabarito inline tenant_e_empresa
-- (categoria A, empresa obrigatória; módulos em scripts/company-rls-modules.json); produto_fornecedor_vinculos com
-- tenant_isolation (cadastro da organização, molde 0029); documentos_compra_rateio com api_child pela junção com o
-- cabeçalho (molde 0040). Nenhuma tabela nova tem DELETE para o erp_app; o XML e o rateio também não têm UPDATE.
-- audit_row nas quatro tabelas novas (o XML: UMA cópia no audit_logs por XML, no INSERT — custo declarado). As
-- funções de gatilho não são porta de ninguém: EXECUTE só do dono. Só as duas guardas da chave são SECURITY
-- DEFINER (leem a outra tabela por cima da RLS de quem chama); as demais são de invoker, com search_path fixo.
-- SEM BACKFILL: colunas novas nulas; nenhuma linha existente muda, e nenhuma fica de fora do CHECK refeito do total
-- (as colunas que ele soma a mais nascem nulas) nem dos CHECKs novos (que só restringem as colunas novas).
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web): a API anterior não lê nem grava nada novo; o que ela
-- grava continua passando (compra sem chave: a guarda nova nem dispara no UPDATE de situação, porque é UPDATE OF
-- as colunas fiscais; o CHECK do total é o mesmo com as colunas novas nulas). Diferença visível à API anterior: a
-- nota antiga com a chave de uma compra viva recebe 409 DUPLICATE_DOCUMENT (código que ela conhece). Os gatilhos
-- novos usam só VALIDATION_ERROR, CONFLICT e DUPLICATE_DOCUMENT (422/409, nunca 500). Locks curtos em
-- documentos_compra, documentos_compra_itens, invoices, dfe_documents, purchase_requests e chart_accounts; o
-- lock_timeout de 2s faz a migration desistir em vez de enfileirar as gravações atrás dela.
-- VOLTA: API e web voltam por redeploy e convivem com a 0047; nada se apaga (decisão 247). A API anterior que
-- confirmar uma compra gravada pela nova: IPI, ICMS-ST e seguro entram no custo (ela rateia valor_total, que já os
-- inclui), mas ela IGNORA gera_estoque = false, imobilizado, parcelas_nota (título único no data_vencimento),
-- tipo_titulo_id, classificacao_gasto e o rateio (com rateio o cabeçalho não tem natureza/centro, e a confirmação
-- dela recusa com "Informe a natureza…", sem efeito parcial). Desligar as guardas ou estreitar os CHECKs só com uma
-- migration nova, por decisão humana.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave reservada para esta fase (2026,81).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 81) then
    raise exception 'OPERACOES-01 F7: outra transacao ja detem a trava desta migration (2026,81). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_lista text[];
  v_def text;
begin
  -- 2.1 "Já aplicada" ANTES das demais: tabelas, funções, colunas, gatilhos e índice desta migration.
  if to_regclass('erp.notas_fiscais_xml') is not null or to_regclass('erp.importacoes_nfe_compra') is not null
     or to_regclass('erp.produto_fornecedor_vinculos') is not null or to_regclass('erp.documentos_compra_rateio') is not null
     or to_regclass('erp.ux_documentos_compra_chave') is not null
     or to_regprocedure('erp.notas_fiscais_xml_imutavel()') is not null or to_regprocedure('erp.importacoes_nfe_compra_guarda()') is not null
     or to_regprocedure('erp.importacoes_nfe_compra_imutavel()') is not null or to_regprocedure('erp.documentos_compra_rateio_guarda()') is not null
     or to_regprocedure('erp.dfe_documents_xml_guarda()') is not null or to_regprocedure('erp.documentos_compra_nota_guarda()') is not null
     or to_regprocedure('erp.invoices_chave_nota_guarda()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'erp'
                 and ((table_name = 'documentos_compra' and column_name in ('chave_acesso', 'uf_nota', 'tipo_documento_fiscal', 'valor_ipi', 'valor_icms_st',
                        'seguro', 'tipo_titulo_id', 'classificacao_gasto', 'rateio_tipo', 'parcelas_nota', 'dfe_id', 'solicitacao_compra_id'))
                   or (table_name = 'documentos_compra_itens' and column_name in ('gera_estoque', 'imobilizado', 'bem_id', 'categoria_financeira_id',
                        'centro_custo_id', 'valor_ipi', 'valor_icms_st', 'n_item_nota', 'codigo_produto_nota', 'descricao_produto_nota', 'unidade_nota',
                        'quantidade_nota', 'fator_conversao', 'tipo_fator_conversao'))
                   or (table_name = 'dfe_documents' and column_name = 'xml_id')))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('trg_documentos_compra_nota', 'trg_invoices_chave_nota', 'trg_dfe_documents_xml')) then
    raise exception 'OPERACOES-01 F7: objetos da 0047 ja existem; a 0047 ja foi aplicada ou ha schema divergente.';
  end if;

  -- 2.2 Papéis. O erp_app é quem grava pelos gatilhos; quem aplica é o dono das duas SECURITY DEFINER novas e tem de
  -- atravessar a RLS (senão as guardas da chave veriam só o recorte de quem chama).
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'OPERACOES-01 F7: papel erp_app ausente (0007); as tabelas novas nao teriam a quem servir.';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'OPERACOES-01 F7: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; as guardas da chave de acesso nao veriam a nota antiga nem a compra de outra empresa.';
  end if;

  -- 2.3 Tabelas lidas, alteradas ou referenciadas.
  if to_regclass('erp.documentos_compra') is null or to_regclass('erp.documentos_compra_itens') is null or to_regclass('erp.invoices') is null
     or to_regclass('erp.dfe_documents') is null or to_regclass('erp.purchase_requests') is null or to_regclass('erp.people') is null
     or to_regclass('erp.products') is null or to_regclass('erp.empresas') is null or to_regclass('erp.financial_categories') is null
     or to_regclass('erp.cost_centers') is null or to_regclass('erp.chart_accounts') is null or to_regclass('erp.harvests') is null
     or to_regclass('erp.title_types') is null or to_regclass('erp.equipments') is null or to_regclass('erp.users') is null
     or to_regclass('erp.organizations') is null then
    raise exception 'OPERACOES-01 F7: tabela ausente (documentos_compra, documentos_compra_itens, invoices, dfe_documents, purchase_requests, people, products, empresas, financial_categories, cost_centers, chart_accounts, harvests, title_types, equipments, users ou organizations); a cadeia de migrations esta fora de ordem.';
  end if;

  -- 2.4 As chaves que as FKs compostas novas referenciam, pela COLUNA (conkey na ordem), não só pelo nome.
  select array_agg(v.t || '.' || v.n order by v.t collate "C") into v_lista
    from (values ('documentos_compra', 'uq_documentos_compra_tenant'), ('documentos_compra_itens', 'uq_documentos_compra_itens_tenant'),
                 ('people', 'uq_people_tenant'), ('products', 'uq_products_tenant'), ('financial_categories', 'uq_financial_categories_tenant'),
                 ('cost_centers', 'uq_cost_centers_tenant'), ('harvests', 'uq_harvests_tenant'), ('equipments', 'uq_equipments_tenant')) v(t, n)
   where not exists (select 1 from pg_constraint c
                      where c.conrelid = to_regclass('erp.' || v.t) and c.conname = v.n and c.contype = 'u'
                        and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'id'),
                                             (select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'organization_id')]::int2[]);
  if v_lista is not null then
    raise exception 'OPERACOES-01 F7: chave (id, organization_id) ausente ou em outras colunas; as FKs compostas novas nao teriam alvo: %', v_lista;
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.empresas'::regclass and c.contype in ('u', 'p')
                    and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'organization_id'),
                                         (select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'id')]::int2[]) then
    raise exception 'OPERACOES-01 F7: chave (organization_id, id) ausente em erp.empresas; as FKs de empresa das tabelas novas nao teriam alvo.';
  end if;
  -- As três que esta migration cria ainda não existem com NENHUM nome (outro nome = schema divergente: duas chaves iguais).
  select array_agg(r.relname || '.' || c.conname order by r.relname || '.' || c.conname collate "C") into v_lista
    from pg_constraint c join pg_class r on r.oid = c.conrelid
   where c.conrelid in ('erp.chart_accounts'::regclass, 'erp.dfe_documents'::regclass, 'erp.purchase_requests'::regclass)
     and c.contype in ('u', 'p')
     and (select array_agg(k order by k) from unnest(c.conkey) k)
         = (select array_agg(a.attnum order by a.attnum) from pg_attribute a where a.attrelid = c.conrelid and a.attname in ('id', 'organization_id'));
  if v_lista is not null then
    raise exception 'OPERACOES-01 F7: chave (id, organization_id) ja existe em chart_accounts, dfe_documents ou purchase_requests; a 0047 a cria (ja aplicada ou schema divergente): %', v_lista;
  end if;

  -- 2.5 Os CHECKs do cabeçalho: os vinte de depois da 0044, e o do total EXATAMENTE o da 0036 — o refazer só é seguro
  -- sobre ele (a equação nova é a de antes com as colunas novas nulas).
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk\_documentos\_compra\_%') <> 20 then
    raise exception 'OPERACOES-01 F7: CHECKs de erp.documentos_compra diferentes dos vinte esperados (0036, 0037 e 0044); schema divergente.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_total_conferido' and c.contype = 'c';
  if v_def is distinct from 'CHECK ((valor_total = (((valor_itens + frete) + outras_despesas) - desconto)))' then
    raise exception 'OPERACOES-01 F7: chk_documentos_compra_total_conferido ausente ou diferente do da 0036 (valor_total = valor_itens + frete + outras_despesas - desconto): %', v_def;
  end if;

  -- 2.6 Os gatilhos do usuário no documento de compra: EXATAMENTE os oito da 0044 (nome → função), todos ligados.
  -- O da guarda nova (trg_documentos_compra_nota) dispara entre finalizacao e transicao (ordem alfabética).
  select array_agg(t.tgname || ' -> ' || p.proname order by t.tgname collate "C") into v_lista
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal and t.tgenabled = 'O' and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass);
  if v_lista is distinct from array[
       'trg_documentos_compra_aprovacao -> documentos_compra_aprovacao_guarda', 'trg_documentos_compra_audit -> audit_row',
       'trg_documentos_compra_conferir -> documentos_compra_conferir_v3', 'trg_documentos_compra_finalizacao -> documentos_compra_finalizacao_guarda',
       'trg_documentos_compra_itens_documento_aberto -> documentos_compra_itens_documento_aberto',
       'trg_documentos_compra_itens_orcamento_guarda -> documentos_compra_item_orcamento_guarda',
       'trg_documentos_compra_itens_origem_guarda -> documentos_compra_item_origem_guarda_v2',
       'trg_documentos_compra_transicao -> documentos_compra_transicao_v3']
     or exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'O'
                 and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass)) then
    raise exception 'OPERACOES-01 F7: gatilhos do documento de compra diferentes dos oito da 0044 ou desligados; schema divergente: %', v_lista;
  end if;

  -- 2.7 ENUMERAÇÃO PELO CATÁLOGO, pelo NOME: toda SECURITY DEFINER do schema erp que é de compras é uma das oito de
  -- depois da 0044. Uma nona que ninguém conhece ficaria fora desta conta e do endurecimento.
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                   order by (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') collate "C") into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.proname like 'aprovacoes\_compra%');
  if v_lista is distinct from array['erp.aprovacoes_compra_conferir_v2()', 'erp.documentos_compra_aprovacao_guarda()', 'erp.documentos_compra_conferir_v3()',
                                    'erp.documentos_compra_finalizacao_guarda()', 'erp.documentos_compra_item_orcamento_guarda()',
                                    'erp.documentos_compra_item_origem_guarda_v2()', 'erp.documentos_compra_itens_documento_aberto()',
                                    'erp.documentos_compra_transicao_v3()'] then
    raise exception 'OPERACOES-01 F7: funcoes SECURITY DEFINER de compras diferentes das oito da 0044: %', v_lista;
  end if;

  -- 2.8 As funções que as políticas e os gatilhos novos chamam (o plpgsql só resolve a chamada na execução: a
  -- ausência viraria erro genérico na primeira gravação).
  if to_regprocedure('erp.audit_row()') is null or to_regprocedure('erp.current_user_id()') is null or to_regprocedure('erp.current_org_id()') is null
     or to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.escopo_empresa_total(text)') is null
     or to_regprocedure('erp.empresas_do_membro(text)') is null or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'OPERACOES-01 F7: funcao ausente (audit_row, current_user_id, current_org_id, tenant_visible, escopo_empresa_total, empresas_do_membro ou modulo_empresa_atual); a cadeia de migrations esta fora de ordem.';
  end if;

  -- 2.9 Donos. ALTER TABLE e CREATE TRIGGER nas seis tabelas alteradas exigem que quem aplica seja dono (ou membro do
  -- papel dono): sem isso a migration pararia no meio com um erro de permissão genérico.
  if exists (select 1 from pg_class c
              where c.oid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.invoices'::regclass,
                              'erp.dfe_documents'::regclass, 'erp.purchase_requests'::regclass, 'erp.chart_accounts'::regclass)
                and not pg_has_role(current_user, c.relowner, 'USAGE')) then
    raise exception 'OPERACOES-01 F7: o papel que aplica a migration nao e dono de documentos_compra, documentos_compra_itens, invoices, dfe_documents, purchase_requests ou chart_accounts; o ALTER TABLE e o CREATE TRIGGER seriam recusados.';
  end if;

  -- 2.10 As colunas que as guardas novas leem, com o tipo esperado.
  select array_agg(c.table_name || '.' || c.column_name || ':' || c.data_type order by c.table_name || '.' || c.column_name collate "C") into v_lista
    from information_schema.columns c
   where c.table_schema = 'erp'
     and ((c.table_name = 'invoices' and c.column_name in ('organization_id', 'access_key', 'status', 'deleted_at'))
       or (c.table_name = 'dfe_documents' and c.column_name in ('organization_id', 'access_key', 'empresa_id'))
       or (c.table_name = 'purchase_requests' and c.column_name in ('organization_id', 'empresa_id', 'deleted_at'))
       or (c.table_name = 'title_types' and c.column_name = 'organization_id'));
  if v_lista is distinct from array['dfe_documents.access_key:text', 'dfe_documents.empresa_id:uuid', 'dfe_documents.organization_id:uuid',
                                    'invoices.access_key:text', 'invoices.deleted_at:timestamp with time zone', 'invoices.organization_id:uuid',
                                    'invoices.status:text', 'purchase_requests.deleted_at:timestamp with time zone',
                                    'purchase_requests.empresa_id:uuid', 'purchase_requests.organization_id:uuid', 'title_types.organization_id:uuid'] then
    raise exception 'OPERACOES-01 F7: colunas lidas pelas guardas novas ausentes ou com outro tipo: %', v_lista;
  end if;
end $$;

-- ---------- 3) chaves (id, organization_id) novas nas tabelas antigas ----------
-- Aditivas: o id já é a chave primária, a unique composta não recusa linha nenhuma. São o alvo das FKs compostas
-- (a conta contábil do rateio, a DF-e da compra e da importação, a solicitação da compra).
alter table erp.chart_accounts add constraint uq_chart_accounts_tenant unique (id, organization_id);
alter table erp.dfe_documents add constraint uq_dfe_documents_tenant unique (id, organization_id);
alter table erp.purchase_requests add constraint uq_purchase_requests_tenant unique (id, organization_id);

-- ---------- 4) erp.notas_fiscais_xml — o ORIGINAL guardado ----------
create table erp.notas_fiscais_xml (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  chave_acesso text not null,
  xml_original text not null,
  xml_sha256 text not null,
  tamanho_bytes integer not null,
  nome_arquivo text,
  recebido_por uuid not null references erp.users(id),
  recebido_em timestamptz not null default now(),
  constraint chk_notas_fiscais_xml_chave check (chave_acesso ~ '^[0-9]{44}$'),
  constraint chk_notas_fiscais_xml_tamanho check (tamanho_bytes between 1 and 2097152 and octet_length(xml_original) = tamanho_bytes),
  constraint chk_notas_fiscais_xml_sha check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  constraint chk_notas_fiscais_xml_nome check (nome_arquivo is null or length(nome_arquivo) between 1 and 255),
  constraint uq_notas_fiscais_xml_tenant unique (id, organization_id),
  constraint uq_notas_fiscais_xml_conteudo unique (organization_id, chave_acesso, xml_sha256),
  constraint fk_notas_fiscais_xml_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id)
);
create index ix_notas_fiscais_xml_chave on erp.notas_fiscais_xml (organization_id, chave_acesso);

create function erp.notas_fiscais_xml_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: O XML original da nota não muda nem é apagado.' using errcode = 'P0001';
end $$;
comment on function erp.notas_fiscais_xml_imutavel() is
  'OPERACOES-01 F7: o XML original da nota é só inserção; recusa UPDATE e DELETE (gatilho por linha) e TRUNCATE (gatilho por comando) com CONFLICT; não lê OLD nem NEW.';
create trigger trg_notas_fiscais_xml_imutavel
  before update or delete on erp.notas_fiscais_xml
  for each row execute function erp.notas_fiscais_xml_imutavel();
create trigger trg_notas_fiscais_xml_imutavel_truncate
  before truncate on erp.notas_fiscais_xml
  for each statement execute function erp.notas_fiscais_xml_imutavel();
create trigger trg_notas_fiscais_xml_audit
  after insert or update or delete on erp.notas_fiscais_xml
  for each row execute function erp.audit_row();

comment on table erp.notas_fiscais_xml is 'O XML ORIGINAL da NF-e recebida (OPERACOES-01 F7, decisão 284), guardado no servidor como chegou: imutável (sem UPDATE, DELETE nem TRUNCATE), da empresa destinatária. A importação na Central de Compras e a DF-e apontam para ele.';
comment on column erp.notas_fiscais_xml.id is 'Identidade técnica (UUID).';
comment on column erp.notas_fiscais_xml.organization_id is 'Tenant (organização).';
comment on column erp.notas_fiscais_xml.empresa_id is 'A empresa DESTINATÁRIA da nota, resolvida no servidor pelo CNPJ/CPF do destinatário dentro do escopo (FK composta com a organização).';
comment on column erp.notas_fiscais_xml.chave_acesso is 'Chave de acesso da NF-e (44 dígitos, DV conferido na leitura).';
comment on column erp.notas_fiscais_xml.xml_original is 'O texto do XML exatamente como recebido (até 2 MB).';
comment on column erp.notas_fiscais_xml.xml_sha256 is 'SHA-256 do XML original (hexadecimal minúsculo); com a organização e a chave, identifica o conteúdo.';
comment on column erp.notas_fiscais_xml.tamanho_bytes is 'Tamanho do XML original em bytes (CHECK com octet_length).';
comment on column erp.notas_fiscais_xml.nome_arquivo is 'Nome do arquivo enviado (XML ou o XML de dentro do ZIP), quando houver.';
comment on column erp.notas_fiscais_xml.recebido_por is 'Usuário que enviou o XML.';
comment on column erp.notas_fiscais_xml.recebido_em is 'Quando o XML foi recebido.';

-- ---------- 5) erp.importacoes_nfe_compra — a importação (pendente → gerada | descartada) ----------
create table erp.importacoes_nfe_compra (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  xml_id uuid not null,
  chave_acesso text not null,
  numero text not null,
  serie text not null,
  data_emissao date not null,
  emitente_documento text not null,
  emitente_nome text not null,
  valor_total numeric(18,2) not null,
  origem text not null,
  dfe_id uuid,
  situacao text not null default 'pendente',
  documento_compra_id uuid,
  criado_por uuid not null references erp.users(id),
  criado_em timestamptz not null default now(),
  decidido_por uuid references erp.users(id),
  decidido_em timestamptz,
  constraint chk_importacoes_nfe_compra_chave check (chave_acesso ~ '^[0-9]{44}$'),
  constraint chk_importacoes_nfe_compra_valor check (valor_total >= 0),
  constraint chk_importacoes_nfe_compra_origem check (origem in ('arquivo','dfe') and ((origem = 'dfe') = (dfe_id is not null))),
  constraint chk_importacoes_nfe_compra_situacao check (situacao in ('pendente','gerada','descartada')),
  constraint chk_importacoes_nfe_compra_documento check ((situacao = 'gerada') = (documento_compra_id is not null)),
  constraint chk_importacoes_nfe_compra_decisao check (((situacao = 'pendente') = (decidido_em is null)) and ((decidido_em is null) = (decidido_por is null))),
  constraint uq_importacoes_nfe_compra_tenant unique (id, organization_id),
  constraint fk_importacoes_nfe_compra_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_importacoes_nfe_compra_xml foreign key (xml_id, organization_id) references erp.notas_fiscais_xml (id, organization_id),
  constraint fk_importacoes_nfe_compra_dfe foreign key (dfe_id, organization_id) references erp.dfe_documents (id, organization_id),
  constraint fk_importacoes_nfe_compra_documento foreign key (documento_compra_id, organization_id) references erp.documentos_compra (id, organization_id)
);
-- Uma importação PENDENTE por chave na organização (reimportar devolve a pendente); uma importação por compra.
create unique index ux_importacoes_nfe_compra_pendente on erp.importacoes_nfe_compra (organization_id, chave_acesso) where situacao = 'pendente';
create unique index ux_importacoes_nfe_compra_documento on erp.importacoes_nfe_compra (documento_compra_id) where documento_compra_id is not null;
create index ix_importacoes_nfe_compra_empresa on erp.importacoes_nfe_compra (organization_id, empresa_id, criado_em desc);

-- Guarda da importação (invoker: lê o XML, a DF-e e a compra pela RLS de quem grava — a mesma empresa).
create function erp.importacoes_nfe_compra_guarda() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
declare
  v_decisao text[] := array['situacao', 'documento_compra_id', 'decidido_por', 'decidido_em'];
begin
  if tg_op = 'INSERT' then
    if new.situacao <> 'pendente' or new.documento_compra_id is not null or new.decidido_por is not null or new.decidido_em is not null then
      raise exception 'VALIDATION_ERROR: A importação nasce pendente.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from erp.notas_fiscais_xml x
                    where x.id = new.xml_id and x.organization_id = new.organization_id
                      and x.empresa_id = new.empresa_id and x.chave_acesso = new.chave_acesso) then
      raise exception 'VALIDATION_ERROR: O XML guardado não é desta importação.' using errcode = 'P0001';
    end if;
    if new.dfe_id is not null
       and not exists (select 1 from erp.dfe_documents d
                        where d.id = new.dfe_id and d.organization_id = new.organization_id and d.access_key = new.chave_acesso
                          and d.xml_id = new.xml_id and (d.empresa_id is null or d.empresa_id = new.empresa_id)) then
      raise exception 'VALIDATION_ERROR: A DF-e não é desta nota.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- UPDATE: só a decisão é registrada, uma vez.
  if (to_jsonb(new) - v_decisao) is distinct from (to_jsonb(old) - v_decisao) then
    raise exception 'VALIDATION_ERROR: A importação não muda; só a decisão é registrada.' using errcode = 'P0001';
  end if;
  if (new.situacao, new.documento_compra_id, new.decidido_por, new.decidido_em)
       is not distinct from (old.situacao, old.documento_compra_id, old.decidido_por, old.decidido_em) then
    return new;
  end if;
  if old.situacao <> 'pendente' then
    raise exception 'CONFLICT: A importação já foi decidida (situação: %).', old.situacao using errcode = 'P0001';
  end if;
  if new.situacao not in ('gerada', 'descartada') then
    raise exception 'VALIDATION_ERROR: A importação pendente só passa a gerada ou descartada.' using errcode = 'P0001';
  end if;
  if new.situacao = 'gerada'
     and not exists (select 1 from erp.documentos_compra c
                      where c.id = new.documento_compra_id and c.organization_id = new.organization_id and c.especie = 'compra'
                        and c.empresa_id = new.empresa_id and c.chave_acesso = new.chave_acesso and c.situacao <> 'cancelado') then
    raise exception 'VALIDATION_ERROR: A compra gerada não é desta nota.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.importacoes_nfe_compra_guarda() is
  'OPERACOES-01 F7: a importação nasce pendente, com o XML guardado da MESMA organização, empresa e chave (e, vinda da DF-e, a DF-e da mesma chave, do mesmo XML e sem empresa ou da mesma empresa); no UPDATE só a decisão muda, uma vez: pendente → gerada (com a compra viva da mesma empresa e chave) ou descartada. Invoker: lê pela RLS de quem grava.';

create function erp.importacoes_nfe_compra_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: A importação não é apagada (decisão 247).' using errcode = 'P0001';
end $$;
comment on function erp.importacoes_nfe_compra_imutavel() is
  'OPERACOES-01 F7: a importação nunca se apaga; recusa DELETE (gatilho por linha) e TRUNCATE (gatilho por comando) com CONFLICT.';

create trigger trg_importacoes_nfe_compra_guarda
  before insert or update on erp.importacoes_nfe_compra
  for each row execute function erp.importacoes_nfe_compra_guarda();
create trigger trg_importacoes_nfe_compra_imutavel
  before delete on erp.importacoes_nfe_compra
  for each row execute function erp.importacoes_nfe_compra_imutavel();
create trigger trg_importacoes_nfe_compra_imutavel_truncate
  before truncate on erp.importacoes_nfe_compra
  for each statement execute function erp.importacoes_nfe_compra_imutavel();
create trigger trg_importacoes_nfe_compra_audit
  after insert or update or delete on erp.importacoes_nfe_compra
  for each row execute function erp.audit_row();

comment on table erp.importacoes_nfe_compra is 'Importação do XML de uma NF-e na Central de Compras (OPERACOES-01 F7, decisão 284): a conferência pendente, decidida uma vez — gerada (a COMPRA ABERTA criada dela) ou descartada. Nunca se apaga.';
comment on column erp.importacoes_nfe_compra.id is 'Identidade técnica (UUID).';
comment on column erp.importacoes_nfe_compra.organization_id is 'Tenant (organização).';
comment on column erp.importacoes_nfe_compra.empresa_id is 'Empresa destinatária da nota, que vira a empresa da compra (FK composta com a organização). Escopo de empresa do módulo compras.';
comment on column erp.importacoes_nfe_compra.xml_id is 'O XML original guardado (FK composta), da mesma organização, empresa e chave (gatilho).';
comment on column erp.importacoes_nfe_compra.chave_acesso is 'Chave de acesso da NF-e (44 dígitos). Uma importação pendente por chave na organização.';
comment on column erp.importacoes_nfe_compra.numero is 'Número da nota (nNF).';
comment on column erp.importacoes_nfe_compra.serie is 'Série da nota.';
comment on column erp.importacoes_nfe_compra.data_emissao is 'Data de emissão da nota.';
comment on column erp.importacoes_nfe_compra.emitente_documento is 'CNPJ/CPF do emitente, normalizado (só dígitos).';
comment on column erp.importacoes_nfe_compra.emitente_nome is 'Razão social do emitente, como está na nota.';
comment on column erp.importacoes_nfe_compra.valor_total is 'Valor total da nota (vNF).';
comment on column erp.importacoes_nfe_compra.origem is 'arquivo (enviado na Central de Compras) ou dfe (aberto pelo "Lançar" da DF-e, com dfe_id).';
comment on column erp.importacoes_nfe_compra.dfe_id is 'Só na origem dfe: a DF-e da mesma chave e do mesmo XML (FK composta).';
comment on column erp.importacoes_nfe_compra.situacao is 'pendente | gerada | descartada. Decidida uma vez (gatilho); gerada e descartada são finais.';
comment on column erp.importacoes_nfe_compra.documento_compra_id is 'Só na gerada: a compra criada da nota (FK composta), da mesma empresa e chave. Uma importação por compra.';
comment on column erp.importacoes_nfe_compra.criado_por is 'Usuário que importou.';
comment on column erp.importacoes_nfe_compra.criado_em is 'Quando foi importada.';
comment on column erp.importacoes_nfe_compra.decidido_por is 'Quem gerou a compra ou descartou (junto com decidido_em).';
comment on column erp.importacoes_nfe_compra.decidido_em is 'Quando foi decidida; nula enquanto pendente.';

-- ---------- 6) erp.produto_fornecedor_vinculos — o vínculo lembrado ----------
create table erp.produto_fornecedor_vinculos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  fornecedor_id uuid not null,
  codigo_fornecedor text not null,
  unidade_fornecedor text not null,
  produto_id uuid not null,
  tipo_fator text not null default 'multiply',
  fator numeric(18,6) not null,
  criado_por uuid not null references erp.users(id),
  criado_em timestamptz not null default now(),
  atualizado_por uuid references erp.users(id),
  atualizado_em timestamptz,
  constraint chk_produto_fornecedor_vinculos_codigo check (codigo_fornecedor = btrim(codigo_fornecedor) and length(codigo_fornecedor) between 1 and 60),
  constraint chk_produto_fornecedor_vinculos_unidade check (unidade_fornecedor = upper(btrim(unidade_fornecedor)) and length(unidade_fornecedor) between 1 and 6),
  constraint chk_produto_fornecedor_vinculos_fator check (fator > 0 and tipo_fator in ('multiply','divide')),
  constraint chk_produto_fornecedor_vinculos_atualizado check ((atualizado_em is null) = (atualizado_por is null)),
  constraint uq_produto_fornecedor_vinculos unique (organization_id, fornecedor_id, codigo_fornecedor, unidade_fornecedor),
  constraint fk_produto_fornecedor_vinculos_fornecedor foreign key (fornecedor_id, organization_id) references erp.people (id, organization_id),
  constraint fk_produto_fornecedor_vinculos_produto foreign key (produto_id, organization_id) references erp.products (id, organization_id)
);
create index ix_produto_fornecedor_vinculos_produto on erp.produto_fornecedor_vinculos (organization_id, produto_id);
create trigger trg_produto_fornecedor_vinculos_audit
  after insert or update or delete on erp.produto_fornecedor_vinculos
  for each row execute function erp.audit_row();

comment on table erp.produto_fornecedor_vinculos is 'Vínculo LEMBRADO do produto do fornecedor (OPERACOES-01 F7, decisão 284): fornecedor + código + unidade do fornecedor na nota → produto + fator. Gravado ao gerar a compra da nota e sugerido nas notas seguintes. Cadastro da organização (sem empresa); não se apaga.';
comment on column erp.produto_fornecedor_vinculos.id is 'Identidade técnica (UUID).';
comment on column erp.produto_fornecedor_vinculos.organization_id is 'Tenant (organização).';
comment on column erp.produto_fornecedor_vinculos.fornecedor_id is 'O fornecedor (parceiro) da nota (FK composta com a organização).';
comment on column erp.produto_fornecedor_vinculos.codigo_fornecedor is 'Código do produto na nota do fornecedor (cProd), sem espaços nas pontas.';
comment on column erp.produto_fornecedor_vinculos.unidade_fornecedor is 'Unidade comercial do fornecedor na nota (uCom), em maiúsculas.';
comment on column erp.produto_fornecedor_vinculos.produto_id is 'O nosso produto (FK composta com a organização).';
comment on column erp.produto_fornecedor_vinculos.tipo_fator is 'multiply (quantidade interna = quantidade da nota × fator) ou divide (÷ fator).';
comment on column erp.produto_fornecedor_vinculos.fator is 'Fator de conversão da unidade do fornecedor para a do produto (maior que zero).';
comment on column erp.produto_fornecedor_vinculos.criado_por is 'Quem gravou o vínculo.';
comment on column erp.produto_fornecedor_vinculos.criado_em is 'Quando o vínculo foi gravado.';
comment on column erp.produto_fornecedor_vinculos.atualizado_por is 'Quem trocou o produto ou o fator por último (junto com atualizado_em).';
comment on column erp.produto_fornecedor_vinculos.atualizado_em is 'Quando o produto ou o fator foi trocado por último.';

-- ---------- 7) colunas novas da COMPRA (cabeçalho) e o CHECK do total refeito ----------
-- Colunas numa instrução, constraints em outra: o leitor de schema dos gates (scripts/lib/schema.mjs) lê o
-- `add column` repetido, e uma `add constraint` no meio dele viraria uma coluna fantasma no dicionário.
alter table erp.documentos_compra
  add column chave_acesso text,
  add column uf_nota text,
  add column tipo_documento_fiscal text,
  add column valor_ipi numeric(18,2),
  add column valor_icms_st numeric(18,2),
  add column seguro numeric(18,2),
  add column tipo_titulo_id uuid constraint fk_documentos_compra_tipo_titulo references erp.title_types(id),
  add column classificacao_gasto text,
  add column rateio_tipo text,
  add column parcelas_nota jsonb,
  add column dfe_id uuid,
  add column solicitacao_compra_id uuid;

-- O total: drop e add na MESMA instrução (nunca há instante sem o CHECK). Nas linhas de hoje as três colunas
-- somadas a mais são nulas → a equação é a de antes, nenhuma linha fica de fora. As parcelas da nota: o CASE evita
-- que jsonb_array_length seja avaliado sobre um objeto (o AND do SQL não garante a ordem), o que viraria erro em vez
-- de recusa do CHECK.
alter table erp.documentos_compra
  add constraint fk_documentos_compra_dfe foreign key (dfe_id, organization_id) references erp.dfe_documents (id, organization_id),
  add constraint fk_documentos_compra_solicitacao foreign key (solicitacao_compra_id, organization_id) references erp.purchase_requests (id, organization_id),
  add constraint chk_documentos_compra_campos_fiscais check (especie = 'compra' or (chave_acesso is null and uf_nota is null and tipo_documento_fiscal is null
      and valor_ipi is null and valor_icms_st is null and seguro is null and tipo_titulo_id is null and classificacao_gasto is null
      and rateio_tipo is null and parcelas_nota is null and dfe_id is null and solicitacao_compra_id is null)),
  add constraint chk_documentos_compra_chave_acesso check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$'),
  add constraint chk_documentos_compra_uf_nota check (uf_nota is null or uf_nota ~ '^[A-Z]{2}$'),
  add constraint chk_documentos_compra_tipo_documento_fiscal check (tipo_documento_fiscal is null or tipo_documento_fiscal in ('nfe','cte','nfse','nfce','danfe','darf','dare','gru','other')),
  add constraint chk_documentos_compra_valor_ipi check (valor_ipi is null or valor_ipi >= 0),
  add constraint chk_documentos_compra_valor_icms_st check (valor_icms_st is null or valor_icms_st >= 0),
  add constraint chk_documentos_compra_seguro check (seguro is null or seguro >= 0),
  add constraint chk_documentos_compra_classificacao_gasto check (classificacao_gasto is null or classificacao_gasto in ('capex','opex')),
  add constraint chk_documentos_compra_rateio_tipo check (rateio_tipo is null or (rateio_tipo in ('por_valor','por_produto') and categoria_financeira_id is null and centro_custo_id is null)),
  add constraint chk_documentos_compra_parcelas_nota check (parcelas_nota is null or (plano_parcelas is null
      and case when jsonb_typeof(parcelas_nota) = 'array' then jsonb_array_length(parcelas_nota) between 1 and 120 else false end)),
  drop constraint chk_documentos_compra_total_conferido,
  add constraint chk_documentos_compra_total_conferido check (valor_total = valor_itens + frete + outras_despesas - desconto
      + coalesce(valor_ipi, 0) + coalesce(valor_icms_st, 0) + coalesce(seguro, 0));

-- A nota repetida entre COMPRAS VIVAS (cancelar libera, como ux_documentos_compra_nota).
create unique index ux_documentos_compra_chave on erp.documentos_compra (organization_id, chave_acesso)
  where especie = 'compra' and situacao <> 'cancelado' and chave_acesso is not null;
create index ix_documentos_compra_dfe on erp.documentos_compra (dfe_id) where dfe_id is not null;
create index ix_documentos_compra_solicitacao on erp.documentos_compra (solicitacao_compra_id) where solicitacao_compra_id is not null;

comment on column erp.documentos_compra.valor_total is 'Total: itens + frete + outras despesas − desconto + IPI + ICMS-ST + seguro (CHECK; os três últimos nulos valem zero).';
comment on column erp.documentos_compra.chave_acesso is 'Só compra: chave de acesso da NF-e (44 dígitos). Única entre compras não canceladas da organização (índice) e cruzada com a nota antiga nos dois sentidos (gatilho, DUPLICATE_DOCUMENT). Não muda depois do lançamento.';
comment on column erp.documentos_compra.uf_nota is 'Só compra: UF da nota (duas letras maiúsculas).';
comment on column erp.documentos_compra.tipo_documento_fiscal is 'Só compra: tipo do documento fiscal (nfe, cte, nfse, nfce, danfe, darf, dare, gru, other).';
comment on column erp.documentos_compra.valor_ipi is 'Só compra: IPI da nota (entra no total e no custo de entrada).';
comment on column erp.documentos_compra.valor_icms_st is 'Só compra: ICMS-ST da nota (entra no total e no custo de entrada).';
comment on column erp.documentos_compra.seguro is 'Só compra: seguro da nota (entra no total e no custo de entrada).';
comment on column erp.documentos_compra.tipo_titulo_id is 'Só compra: tipo de título dos títulos a pagar (global ou da organização, conferido por gatilho).';
comment on column erp.documentos_compra.classificacao_gasto is 'Só compra: classificação do gasto, capex ou opex (vai ao título).';
comment on column erp.documentos_compra.rateio_tipo is 'Só compra: por_valor (linhas em documentos_compra_rateio) ou por_produto (natureza e centro de cada item). Com rateio, o cabeçalho não tem natureza nem centro.';
comment on column erp.documentos_compra.parcelas_nota is 'Só compra: as parcelas das duplicatas da nota (jsonb, lista de 1 a 120); exclusivas com plano_parcelas.';
comment on column erp.documentos_compra.dfe_id is 'Só compra: a DF-e de onde a nota veio (FK composta), da mesma chave e sem empresa ou da mesma empresa (gatilho).';
comment on column erp.documentos_compra.solicitacao_compra_id is 'Só compra: a solicitação de compra atendida (FK composta), da mesma empresa (gatilho).';

-- ---------- 8) colunas novas do ITEM da compra ----------
alter table erp.documentos_compra_itens
  add column gera_estoque boolean,
  add column imobilizado boolean,
  add column bem_id uuid,
  add column categoria_financeira_id uuid,
  add column centro_custo_id uuid,
  add column valor_ipi numeric(18,2),
  add column valor_icms_st numeric(18,2),
  add column n_item_nota integer,
  add column codigo_produto_nota text,
  add column descricao_produto_nota text,
  add column unidade_nota text,
  add column quantidade_nota numeric(18,4),
  add column fator_conversao numeric(18,6),
  add column tipo_fator_conversao text;

alter table erp.documentos_compra_itens
  add constraint fk_documentos_compra_itens_bem foreign key (bem_id, organization_id) references erp.equipments (id, organization_id),
  add constraint fk_documentos_compra_itens_categoria foreign key (categoria_financeira_id, organization_id) references erp.financial_categories (id, organization_id),
  add constraint fk_documentos_compra_itens_centro foreign key (centro_custo_id, organization_id) references erp.cost_centers (id, organization_id),
  add constraint chk_documentos_compra_itens_classificacao_par check ((categoria_financeira_id is null) = (centro_custo_id is null)),
  add constraint chk_documentos_compra_itens_valor_ipi check (valor_ipi is null or valor_ipi >= 0),
  add constraint chk_documentos_compra_itens_valor_icms_st check (valor_icms_st is null or valor_icms_st >= 0),
  add constraint chk_documentos_compra_itens_bem check (bem_id is null or imobilizado is true),
  add constraint chk_documentos_compra_itens_n_item_nota check (n_item_nota is null or n_item_nota between 1 and 990),
  add constraint chk_documentos_compra_itens_conversao check (
    (unidade_nota is null and quantidade_nota is null and fator_conversao is null and tipo_fator_conversao is null)
    or (unidade_nota is not null and quantidade_nota is not null and fator_conversao is not null and tipo_fator_conversao is not null
        and quantidade_nota > 0 and fator_conversao > 0 and tipo_fator_conversao in ('multiply','divide')));

comment on column erp.documentos_compra_itens.gera_estoque is 'Só compra: o item dá entrada no estoque na confirmação (nulo = sim, como hoje; false = não move estoque).';
comment on column erp.documentos_compra_itens.imobilizado is 'Só compra: o item é imobilizado — a confirmação cria o bem (equipamento).';
comment on column erp.documentos_compra_itens.bem_id is 'O bem criado na confirmação do item imobilizado (FK composta).';
comment on column erp.documentos_compra_itens.categoria_financeira_id is 'Rateio por produto: natureza de despesa do item. Anda em PAR com centro_custo_id (FK composta).';
comment on column erp.documentos_compra_itens.centro_custo_id is 'Rateio por produto: centro de custo do item. Anda em PAR com categoria_financeira_id (FK composta).';
comment on column erp.documentos_compra_itens.valor_ipi is 'IPI do item na nota (entra no custo do item).';
comment on column erp.documentos_compra_itens.valor_icms_st is 'ICMS-ST do item na nota (entra no custo do item).';
comment on column erp.documentos_compra_itens.n_item_nota is 'Número do item na nota (nItem, 1 a 990).';
comment on column erp.documentos_compra_itens.codigo_produto_nota is 'Código do produto na nota do fornecedor (cProd).';
comment on column erp.documentos_compra_itens.descricao_produto_nota is 'Descrição do produto na nota do fornecedor (xProd).';
comment on column erp.documentos_compra_itens.unidade_nota is 'Unidade comercial na nota (uCom). Anda junto com quantidade_nota e o fator.';
comment on column erp.documentos_compra_itens.quantidade_nota is 'Quantidade comercial na nota (qCom), antes da conversão.';
comment on column erp.documentos_compra_itens.fator_conversao is 'Fator que converteu a quantidade da nota na do produto (maior que zero).';
comment on column erp.documentos_compra_itens.tipo_fator_conversao is 'multiply (quantidade = quantidade_nota × fator) ou divide (÷ fator).';

-- ---------- 9) erp.documentos_compra_rateio — o rateio POR VALOR da compra ----------
create table erp.documentos_compra_rateio (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id),
  documento_id uuid not null,
  posicao integer not null,
  categoria_financeira_id uuid not null,
  centro_custo_id uuid not null,
  conta_contabil_id uuid,
  safra_id uuid,
  percentual numeric(9,4) not null,
  constraint chk_documentos_compra_rateio_posicao check (posicao >= 0),
  constraint chk_documentos_compra_rateio_percentual check (percentual > 0 and percentual <= 100),
  constraint uq_documentos_compra_rateio_posicao unique (documento_id, posicao),
  constraint fk_documentos_compra_rateio_documento foreign key (documento_id, organization_id) references erp.documentos_compra (id, organization_id),
  constraint fk_documentos_compra_rateio_categoria foreign key (categoria_financeira_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_documentos_compra_rateio_centro foreign key (centro_custo_id, organization_id) references erp.cost_centers (id, organization_id),
  constraint fk_documentos_compra_rateio_conta foreign key (conta_contabil_id, organization_id) references erp.chart_accounts (id, organization_id),
  constraint fk_documentos_compra_rateio_safra foreign key (safra_id, organization_id) references erp.harvests (id, organization_id)
);
create index ix_documentos_compra_rateio_documento on erp.documentos_compra_rateio (organization_id, documento_id);

-- Uma função, três gatilhos: INSERT só na compra aberta com rateio por valor (cabeçalho lido FOR SHARE: a
-- confirmação e o cancelamento concorrentes esperam); UPDATE, DELETE e TRUNCATE recusados. Invoker: lê o cabeçalho
-- pela RLS de quem grava.
create function erp.documentos_compra_rateio_guarda() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'CONFLICT: O rateio da compra não muda; cancele a compra e lance outra.' using errcode = 'P0001';
  end if;
  perform 1 from erp.documentos_compra c
    where c.id = new.documento_id and c.organization_id = new.organization_id
      and c.especie = 'compra' and c.situacao = 'aberto' and c.rateio_tipo = 'por_valor'
    for share;
  if not found then
    raise exception 'VALIDATION_ERROR: O rateio por valor é da compra aberta com rateio por valor.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_rateio_guarda() is
  'OPERACOES-01 F7: a linha do rateio por valor só entra na compra ABERTA da mesma organização com rateio_tipo = por_valor (cabeçalho FOR SHARE) e nunca muda: UPDATE, DELETE e TRUNCATE recusados com CONFLICT. Invoker.';
create trigger trg_documentos_compra_rateio_guarda
  before insert on erp.documentos_compra_rateio
  for each row execute function erp.documentos_compra_rateio_guarda();
create trigger trg_documentos_compra_rateio_imutavel
  before update or delete on erp.documentos_compra_rateio
  for each row execute function erp.documentos_compra_rateio_guarda();
create trigger trg_documentos_compra_rateio_imutavel_truncate
  before truncate on erp.documentos_compra_rateio
  for each statement execute function erp.documentos_compra_rateio_guarda();
create trigger trg_documentos_compra_rateio_audit
  after insert or update or delete on erp.documentos_compra_rateio
  for each row execute function erp.audit_row();

comment on table erp.documentos_compra_rateio is 'Rateio POR VALOR da compra (OPERACOES-01 F7, decisão 284): natureza, centro de custo, conta contábil e safra com o percentual, gravado com a compra aberta e imutável depois. A soma de 100% é conferida pela API ao salvar e na confirmação.';
comment on column erp.documentos_compra_rateio.id is 'Identidade técnica (sequencial).';
comment on column erp.documentos_compra_rateio.organization_id is 'Tenant (organização).';
comment on column erp.documentos_compra_rateio.documento_id is 'A compra (FK composta); o escopo de empresa vem dela (política api_child).';
comment on column erp.documentos_compra_rateio.posicao is 'Ordem da linha no rateio (única por compra).';
comment on column erp.documentos_compra_rateio.categoria_financeira_id is 'Natureza de despesa da linha (FK composta).';
comment on column erp.documentos_compra_rateio.centro_custo_id is 'Centro de custo da linha (FK composta).';
comment on column erp.documentos_compra_rateio.conta_contabil_id is 'Conta contábil da linha, opcional (FK composta).';
comment on column erp.documentos_compra_rateio.safra_id is 'Safra da linha, opcional (FK composta).';
comment on column erp.documentos_compra_rateio.percentual is 'Percentual da linha (maior que zero, até 100).';

-- ---------- 10) erp.dfe_documents.xml_id — o XML guardado da DF-e ----------
alter table erp.dfe_documents add column xml_id uuid;
alter table erp.dfe_documents add constraint fk_dfe_documents_xml foreign key (xml_id, organization_id) references erp.notas_fiscais_xml (id, organization_id);

-- Invoker: lê o XML pela RLS de quem grava. Dispara também na troca da chave ou da empresa, para o XML já ligado
-- nunca ficar de outra chave ou de outra empresa.
create function erp.dfe_documents_xml_guarda() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.xml_id is not null and new.xml_id is distinct from old.xml_id then
    raise exception 'CONFLICT: O XML guardado da DF-e não muda.' using errcode = 'P0001';
  end if;
  if new.xml_id is not null
     and not exists (select 1 from erp.notas_fiscais_xml x
                      where x.id = new.xml_id and x.organization_id = new.organization_id and x.chave_acesso = new.access_key
                        and (new.empresa_id is null or x.empresa_id = new.empresa_id)) then
    raise exception 'VALIDATION_ERROR: O XML guardado não é desta DF-e.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.dfe_documents_xml_guarda() is
  'OPERACOES-01 F7: o XML guardado da DF-e é gravado uma vez e é da mesma organização, da mesma chave e (com empresa na DF-e) da mesma empresa; a troca da chave ou da empresa com o XML ligado é conferida de novo. Invoker.';
create trigger trg_dfe_documents_xml
  before insert or update of xml_id, access_key, empresa_id on erp.dfe_documents
  for each row execute function erp.dfe_documents_xml_guarda();

comment on column erp.dfe_documents.xml_id is 'O XML original guardado da DF-e (FK composta com erp.notas_fiscais_xml), gravado uma vez; mesma chave e empresa (gatilho). A coluna xml_object_path antiga fica como está.';

-- ---------- 11) a CHAVE DE ACESSO barrada no banco — compra × nota antiga ----------
-- Duas SECURITY DEFINER estreitas: cada uma lê a OUTRA tabela por cima da RLS de quem grava (a nota antiga de outra
-- empresa também barra), com search_path fixo, organização da PRÓPRIA linha, sem SQL dinâmico, e só devolve a
-- recusa. A trava da chave (a mesma das duas portas e da API) serializa a compra e a nota antiga da mesma chave:
-- a segunda espera a primeira terminar e, com fotografia nova, a enxerga.
create function erp.documentos_compra_nota_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if (new.chave_acesso, new.uf_nota, new.tipo_documento_fiscal, new.valor_ipi, new.valor_icms_st, new.seguro, new.tipo_titulo_id,
        new.classificacao_gasto, new.rateio_tipo, new.parcelas_nota, new.dfe_id, new.solicitacao_compra_id)
       is distinct from
       (old.chave_acesso, old.uf_nota, old.tipo_documento_fiscal, old.valor_ipi, old.valor_icms_st, old.seguro, old.tipo_titulo_id,
        old.classificacao_gasto, old.rateio_tipo, old.parcelas_nota, old.dfe_id, old.solicitacao_compra_id) then
      raise exception 'VALIDATION_ERROR: Os dados fiscais da compra não mudam depois do lançamento.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.tipo_titulo_id is not null
     and not exists (select 1 from erp.title_types t
                      where t.id = new.tipo_titulo_id and (t.organization_id is null or t.organization_id = new.organization_id)) then
    raise exception 'VALIDATION_ERROR: Tipo de título inválido.' using errcode = 'P0001';
  end if;
  if new.dfe_id is not null
     and (new.chave_acesso is null
          or not exists (select 1 from erp.dfe_documents d
                          where d.id = new.dfe_id and d.organization_id = new.organization_id
                            and (d.empresa_id is null or d.empresa_id = new.empresa_id) and d.access_key = new.chave_acesso)) then
    raise exception 'VALIDATION_ERROR: A DF-e vinculada precisa ser da mesma empresa e ter a mesma chave de acesso.' using errcode = 'P0001';
  end if;
  if new.solicitacao_compra_id is not null
     and not exists (select 1 from erp.purchase_requests r
                      where r.id = new.solicitacao_compra_id and r.organization_id = new.organization_id
                        and r.empresa_id = new.empresa_id and r.deleted_at is null) then
    raise exception 'VALIDATION_ERROR: A solicitação de compra precisa ser da mesma empresa.' using errcode = 'P0001';
  end if;
  if new.chave_acesso is not null then
    perform pg_advisory_xact_lock(hashtextextended('nfe-chave:' || new.organization_id::text || ':' || new.chave_acesso, 284));
    if exists (select 1 from erp.invoices i
                where i.organization_id = new.organization_id and i.access_key = new.chave_acesso
                  and i.status <> 'cancelled' and i.deleted_at is null) then
      raise exception 'DUPLICATE_DOCUMENT: Esta nota (chave de acesso) já foi lançada nesta organização.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_nota_guarda() is
  'OPERACOES-01 F7: no INSERT da compra, tipo de título global ou da organização; DF-e da mesma organização, sem empresa ou da mesma empresa e da MESMA chave (a chave vem junto); solicitação viva da mesma empresa; e, com chave, a trava nfe-chave (284) e a recusa DUPLICATE_DOCUMENT se uma nota antiga viva (não cancelada, não excluída) da organização já tem a chave. No UPDATE, as doze colunas fiscais não mudam. SECURITY DEFINER estreita: lê a nota antiga por cima da RLS, organização da própria linha, sem SQL dinâmico.';

create function erp.invoices_chave_nota_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if new.access_key is null or new.status = 'cancelled' or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.access_key, new.status, new.deleted_at) is not distinct from (old.access_key, old.status, old.deleted_at) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfe-chave:' || new.organization_id::text || ':' || new.access_key, 284));
  if exists (select 1 from erp.documentos_compra c
              where c.organization_id = new.organization_id and c.especie = 'compra' and c.situacao <> 'cancelado'
                and c.chave_acesso = new.access_key) then
    raise exception 'DUPLICATE_DOCUMENT: Esta nota (chave de acesso) já está numa compra desta organização.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.invoices_chave_nota_guarda() is
  'OPERACOES-01 F7: a nota antiga viva (com chave, não cancelada, não excluída) não entra — nem volta a viver — com a chave de uma compra não cancelada da organização: trava nfe-chave (284) e DUPLICATE_DOCUMENT. SECURITY DEFINER estreita: lê a compra por cima da RLS, organização da própria linha, sem SQL dinâmico.';

-- Ordem de disparo BEFORE no cabeçalho (alfabética): aprovacao → conferir → finalizacao → nota → transicao.
create trigger trg_documentos_compra_nota
  before insert or update of chave_acesso, uf_nota, tipo_documento_fiscal, valor_ipi, valor_icms_st, seguro, tipo_titulo_id,
    classificacao_gasto, rateio_tipo, parcelas_nota, dfe_id, solicitacao_compra_id on erp.documentos_compra
  for each row execute function erp.documentos_compra_nota_guarda();
create trigger trg_invoices_chave_nota
  before insert or update of access_key, status, deleted_at on erp.invoices
  for each row execute function erp.invoices_chave_nota_guarda();

-- ---------- 12) EXECUTE, RLS e privilégios ----------
-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos menos
-- do dono (o laço da 0044; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('notas_fiscais_xml_imutavel', 'importacoes_nfe_compra_guarda', 'importacoes_nfe_compra_imutavel',
                         'documentos_compra_rateio_guarda', 'dfe_documents_xml_guarda', 'documentos_compra_nota_guarda', 'invoices_chave_nota_guarda')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- Categoria A da 0015 (empresa obrigatória) — o MESMO gabarito inline da 0040/0041/0045 (InitPlan + hashed SubPlan).
alter table erp.notas_fiscais_xml enable row level security;
alter table erp.notas_fiscais_xml force row level security;
create policy tenant_e_empresa on erp.notas_fiscais_xml for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.importacoes_nfe_compra enable row level security;
alter table erp.importacoes_nfe_compra force row level security;
create policy tenant_e_empresa on erp.importacoes_nfe_compra for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Cadastro da ORGANIZAÇÃO (sem empresa): o recorte é o tenant (molde 0029). Política única.
alter table erp.produto_fornecedor_vinculos enable row level security;
alter table erp.produto_fornecedor_vinculos force row level security;
create policy tenant_isolation on erp.produto_fornecedor_vinculos for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

-- Linhas do rateio: api_child pela junção com o cabeçalho (molde 0040). A subconsulta passa pela RLS do cabeçalho:
-- a linha herda o escopo de empresa da compra, e a organização da linha precisa ser a da compra.
alter table erp.documentos_compra_rateio enable row level security;
alter table erp.documentos_compra_rateio force row level security;
create policy api_child on erp.documentos_compra_rateio for all to erp_app
  using (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_compra p where p.id = documentos_compra_rateio.documento_id and p.organization_id = documentos_compra_rateio.organization_id))
  with check (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_compra p where p.id = documentos_compra_rateio.documento_id and p.organization_id = documentos_compra_rateio.organization_id));

-- A 0007 dá os quatro privilégios a toda tabela nova; o grant sozinho não tira nada, então o revoke é EXPLÍCITO e
-- vem depois. Nenhuma tabela nova tem DELETE; o XML e o rateio também não têm UPDATE.
grant select, insert on erp.notas_fiscais_xml, erp.documentos_compra_rateio to erp_app;
revoke update, delete, truncate on erp.notas_fiscais_xml, erp.documentos_compra_rateio from erp_app;
grant select, insert, update on erp.importacoes_nfe_compra, erp.produto_fornecedor_vinculos to erp_app;
revoke delete, truncate on erp.importacoes_nfe_compra, erp.produto_fornecedor_vinculos from erp_app;

-- ---------- 13) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_lista text[];
  v_def text;
begin
  -- 13.1 As 27 colunas novas: tipo e nulidade (todas anuláveis).
  select array_agg(c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || c.is_nullable order by c.table_name || '.' || c.column_name collate "C") into v_lista
    from information_schema.columns c
   where c.table_schema = 'erp'
     and ((c.table_name = 'documentos_compra' and c.column_name in ('chave_acesso', 'uf_nota', 'tipo_documento_fiscal', 'valor_ipi', 'valor_icms_st',
            'seguro', 'tipo_titulo_id', 'classificacao_gasto', 'rateio_tipo', 'parcelas_nota', 'dfe_id', 'solicitacao_compra_id'))
       or (c.table_name = 'documentos_compra_itens' and c.column_name in ('gera_estoque', 'imobilizado', 'bem_id', 'categoria_financeira_id',
            'centro_custo_id', 'valor_ipi', 'valor_icms_st', 'n_item_nota', 'codigo_produto_nota', 'descricao_produto_nota', 'unidade_nota',
            'quantidade_nota', 'fator_conversao', 'tipo_fator_conversao'))
       or (c.table_name = 'dfe_documents' and c.column_name = 'xml_id'));
  if v_lista is distinct from array[
       'dfe_documents.xml_id:uuid:YES',
       'documentos_compra.chave_acesso:text:YES', 'documentos_compra.classificacao_gasto:text:YES', 'documentos_compra.dfe_id:uuid:YES',
       'documentos_compra.parcelas_nota:jsonb:YES', 'documentos_compra.rateio_tipo:text:YES', 'documentos_compra.seguro:numeric:YES',
       'documentos_compra.solicitacao_compra_id:uuid:YES', 'documentos_compra.tipo_documento_fiscal:text:YES', 'documentos_compra.tipo_titulo_id:uuid:YES',
       'documentos_compra.uf_nota:text:YES', 'documentos_compra.valor_icms_st:numeric:YES', 'documentos_compra.valor_ipi:numeric:YES',
       'documentos_compra_itens.bem_id:uuid:YES', 'documentos_compra_itens.categoria_financeira_id:uuid:YES', 'documentos_compra_itens.centro_custo_id:uuid:YES',
       'documentos_compra_itens.codigo_produto_nota:text:YES', 'documentos_compra_itens.descricao_produto_nota:text:YES',
       'documentos_compra_itens.fator_conversao:numeric:YES', 'documentos_compra_itens.gera_estoque:boolean:YES', 'documentos_compra_itens.imobilizado:boolean:YES',
       'documentos_compra_itens.n_item_nota:integer:YES', 'documentos_compra_itens.quantidade_nota:numeric:YES',
       'documentos_compra_itens.tipo_fator_conversao:text:YES', 'documentos_compra_itens.unidade_nota:text:YES',
       'documentos_compra_itens.valor_icms_st:numeric:YES', 'documentos_compra_itens.valor_ipi:numeric:YES'] then
    raise exception 'OPERACOES-01 F7: colunas novas ausentes ou com tipo/nulidade errados: %', v_lista;
  end if;

  -- 13.2 As quatro tabelas novas: RLS habilitada e FORÇADA, com a política EXATA de cada uma.
  select array_agg(c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':'
                   || coalesce((select string_agg(p.polname || '/' || p.polcmd::text, ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), '')
                   order by c.relname collate "C") into v_lista
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'erp' and c.relname in ('notas_fiscais_xml', 'importacoes_nfe_compra', 'produto_fornecedor_vinculos', 'documentos_compra_rateio');
  if v_lista is distinct from array['documentos_compra_rateio:true:true:api_child/*', 'importacoes_nfe_compra:true:true:tenant_e_empresa/*',
                                    'notas_fiscais_xml:true:true:tenant_e_empresa/*', 'produto_fornecedor_vinculos:true:true:tenant_isolation/*'] then
    raise exception 'OPERACOES-01 F7: tabelas novas ausentes, sem RLS forcada ou com politicas diferentes de tenant_e_empresa / tenant_isolation / api_child: %', v_lista;
  end if;

  -- 13.3 As FKs nomeadas: colunas e alvo NA ORDEM, sem cascata (a nenhuma ação, 'a', no DELETE e no UPDATE).
  select array_agg(x.d order by x.d collate "C") into v_lista from (
    select c.conname || ' ' || r.relname || '('
             || (select string_agg(a.attname, ',' order by k.o) from unnest(c.conkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n)
             || ') -> ' || fr.relname || '('
             || (select string_agg(a.attname, ',' order by k.o) from unnest(c.confkey) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n)
             || ') ' || c.confdeltype::text || c.confupdtype::text as d
      from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_class fr on fr.oid = c.confrelid
     where c.contype = 'f'
       and c.conname in ('fk_notas_fiscais_xml_empresa', 'fk_importacoes_nfe_compra_empresa', 'fk_importacoes_nfe_compra_xml',
                         'fk_importacoes_nfe_compra_dfe', 'fk_importacoes_nfe_compra_documento', 'fk_produto_fornecedor_vinculos_fornecedor',
                         'fk_produto_fornecedor_vinculos_produto', 'fk_documentos_compra_tipo_titulo', 'fk_documentos_compra_dfe',
                         'fk_documentos_compra_solicitacao', 'fk_documentos_compra_itens_bem', 'fk_documentos_compra_itens_categoria',
                         'fk_documentos_compra_itens_centro', 'fk_documentos_compra_rateio_documento', 'fk_documentos_compra_rateio_categoria',
                         'fk_documentos_compra_rateio_centro', 'fk_documentos_compra_rateio_conta', 'fk_documentos_compra_rateio_safra',
                         'fk_dfe_documents_xml')) x;
  if v_lista is distinct from array[
       'fk_dfe_documents_xml dfe_documents(xml_id,organization_id) -> notas_fiscais_xml(id,organization_id) aa',
       'fk_documentos_compra_dfe documentos_compra(dfe_id,organization_id) -> dfe_documents(id,organization_id) aa',
       'fk_documentos_compra_itens_bem documentos_compra_itens(bem_id,organization_id) -> equipments(id,organization_id) aa',
       'fk_documentos_compra_itens_categoria documentos_compra_itens(categoria_financeira_id,organization_id) -> financial_categories(id,organization_id) aa',
       'fk_documentos_compra_itens_centro documentos_compra_itens(centro_custo_id,organization_id) -> cost_centers(id,organization_id) aa',
       'fk_documentos_compra_rateio_categoria documentos_compra_rateio(categoria_financeira_id,organization_id) -> financial_categories(id,organization_id) aa',
       'fk_documentos_compra_rateio_centro documentos_compra_rateio(centro_custo_id,organization_id) -> cost_centers(id,organization_id) aa',
       'fk_documentos_compra_rateio_conta documentos_compra_rateio(conta_contabil_id,organization_id) -> chart_accounts(id,organization_id) aa',
       'fk_documentos_compra_rateio_documento documentos_compra_rateio(documento_id,organization_id) -> documentos_compra(id,organization_id) aa',
       'fk_documentos_compra_rateio_safra documentos_compra_rateio(safra_id,organization_id) -> harvests(id,organization_id) aa',
       'fk_documentos_compra_solicitacao documentos_compra(solicitacao_compra_id,organization_id) -> purchase_requests(id,organization_id) aa',
       'fk_documentos_compra_tipo_titulo documentos_compra(tipo_titulo_id) -> title_types(id) aa',
       'fk_importacoes_nfe_compra_dfe importacoes_nfe_compra(dfe_id,organization_id) -> dfe_documents(id,organization_id) aa',
       'fk_importacoes_nfe_compra_documento importacoes_nfe_compra(documento_compra_id,organization_id) -> documentos_compra(id,organization_id) aa',
       'fk_importacoes_nfe_compra_empresa importacoes_nfe_compra(organization_id,empresa_id) -> empresas(organization_id,id) aa',
       'fk_importacoes_nfe_compra_xml importacoes_nfe_compra(xml_id,organization_id) -> notas_fiscais_xml(id,organization_id) aa',
       'fk_notas_fiscais_xml_empresa notas_fiscais_xml(organization_id,empresa_id) -> empresas(organization_id,id) aa',
       'fk_produto_fornecedor_vinculos_fornecedor produto_fornecedor_vinculos(fornecedor_id,organization_id) -> people(id,organization_id) aa',
       'fk_produto_fornecedor_vinculos_produto produto_fornecedor_vinculos(produto_id,organization_id) -> products(id,organization_id) aa'] then
    raise exception 'OPERACOES-01 F7: FKs novas ausentes, fora das colunas compostas esperadas ou com cascata: %', v_lista;
  end if;
  -- E as três chaves (id, organization_id) novas, pelas colunas.
  if (select count(*) from pg_constraint c
       where c.contype = 'u'
         and ((c.conrelid = 'erp.chart_accounts'::regclass and c.conname = 'uq_chart_accounts_tenant')
           or (c.conrelid = 'erp.dfe_documents'::regclass and c.conname = 'uq_dfe_documents_tenant')
           or (c.conrelid = 'erp.purchase_requests'::regclass and c.conname = 'uq_purchase_requests_tenant'))
         and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'id'),
                              (select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'organization_id')]::int2[]) <> 3 then
    raise exception 'OPERACOES-01 F7: chaves (id, organization_id) novas (uq_chart_accounts_tenant, uq_dfe_documents_tenant, uq_purchase_requests_tenant) ausentes ou em outras colunas.';
  end if;

  -- 13.4 Os CHECKs do cabeçalho: trinta (os vinte de antes, o do total refeito, e dez novos), todos validados; o total
  -- com a equação nova; e os dos itens e das tabelas novas, validados.
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk\_documentos\_compra\_%') <> 30
     or (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and convalidated
           and conname in ('chk_documentos_compra_campos_fiscais', 'chk_documentos_compra_chave_acesso', 'chk_documentos_compra_uf_nota',
                           'chk_documentos_compra_tipo_documento_fiscal', 'chk_documentos_compra_valor_ipi', 'chk_documentos_compra_valor_icms_st',
                           'chk_documentos_compra_seguro', 'chk_documentos_compra_classificacao_gasto', 'chk_documentos_compra_rateio_tipo',
                           'chk_documentos_compra_parcelas_nota', 'chk_documentos_compra_total_conferido')) <> 11
     or exists (select 1 from pg_constraint where contype = 'c' and not convalidated
                 and conrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.notas_fiscais_xml'::regclass,
                                  'erp.importacoes_nfe_compra'::regclass, 'erp.produto_fornecedor_vinculos'::regclass, 'erp.documentos_compra_rateio'::regclass)) then
    raise exception 'OPERACOES-01 F7: CHECKs de erp.documentos_compra incompletos ou nao validados (esperados 30, com os dez novos e o total refeito), ou CHECK nao validado nos itens e nas tabelas novas.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'erp.documentos_compra'::regclass and c.conname = 'chk_documentos_compra_total_conferido' and c.contype = 'c';
  if v_def is distinct from 'CHECK ((valor_total = ((((((valor_itens + frete) + outras_despesas) - desconto) + COALESCE(valor_ipi, (0)::numeric)) + COALESCE(valor_icms_st, (0)::numeric)) + COALESCE(seguro, (0)::numeric))))' then
    raise exception 'OPERACOES-01 F7: chk_documentos_compra_total_conferido ausente ou sem a equacao nova (itens + frete + outras - desconto + IPI + ICMS-ST + seguro): %', v_def;
  end if;
  select array_agg(r.relname || '.' || c.conname order by r.relname || '.' || c.conname collate "C") into v_lista
    from pg_constraint c join pg_class r on r.oid = c.conrelid
   where c.contype = 'c'
     and ((c.conrelid = 'erp.documentos_compra_itens'::regclass and c.conname in ('chk_documentos_compra_itens_classificacao_par', 'chk_documentos_compra_itens_valor_ipi',
            'chk_documentos_compra_itens_valor_icms_st', 'chk_documentos_compra_itens_bem', 'chk_documentos_compra_itens_n_item_nota', 'chk_documentos_compra_itens_conversao'))
       or (c.conrelid in ('erp.notas_fiscais_xml'::regclass, 'erp.importacoes_nfe_compra'::regclass, 'erp.produto_fornecedor_vinculos'::regclass,
                          'erp.documentos_compra_rateio'::regclass) and c.conname like 'chk\_%'));
  if v_lista is distinct from array[
       'documentos_compra_itens.chk_documentos_compra_itens_bem', 'documentos_compra_itens.chk_documentos_compra_itens_classificacao_par',
       'documentos_compra_itens.chk_documentos_compra_itens_conversao', 'documentos_compra_itens.chk_documentos_compra_itens_n_item_nota',
       'documentos_compra_itens.chk_documentos_compra_itens_valor_icms_st', 'documentos_compra_itens.chk_documentos_compra_itens_valor_ipi',
       'documentos_compra_rateio.chk_documentos_compra_rateio_percentual', 'documentos_compra_rateio.chk_documentos_compra_rateio_posicao',
       'importacoes_nfe_compra.chk_importacoes_nfe_compra_chave', 'importacoes_nfe_compra.chk_importacoes_nfe_compra_decisao',
       'importacoes_nfe_compra.chk_importacoes_nfe_compra_documento', 'importacoes_nfe_compra.chk_importacoes_nfe_compra_origem',
       'importacoes_nfe_compra.chk_importacoes_nfe_compra_situacao', 'importacoes_nfe_compra.chk_importacoes_nfe_compra_valor',
       'notas_fiscais_xml.chk_notas_fiscais_xml_chave', 'notas_fiscais_xml.chk_notas_fiscais_xml_nome', 'notas_fiscais_xml.chk_notas_fiscais_xml_sha',
       'notas_fiscais_xml.chk_notas_fiscais_xml_tamanho',
       'produto_fornecedor_vinculos.chk_produto_fornecedor_vinculos_atualizado', 'produto_fornecedor_vinculos.chk_produto_fornecedor_vinculos_codigo',
       'produto_fornecedor_vinculos.chk_produto_fornecedor_vinculos_fator', 'produto_fornecedor_vinculos.chk_produto_fornecedor_vinculos_unidade'] then
    raise exception 'OPERACOES-01 F7: CHECKs dos itens ou das tabelas novas ausentes: %', v_lista;
  end if;

  -- 13.5 Os índices: colunas, unicidade e predicado (pg_get_expr: sem nome de schema, igual em qualquer search_path).
  select array_agg(x.d order by x.d collate "C") into v_lista from (
    select ic.relname || ' ' || tc.relname || '('
             || (select string_agg(a.attname, ',' order by k.o) from unnest(i.indkey::int2[]) with ordinality k(n, o)
                   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n)
             || ')' || case when i.indisunique then ' unica' else '' end
             || coalesce(' where ' || pg_get_expr(i.indpred, i.indrelid), '') as d
      from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid
      join pg_namespace n on n.oid = ic.relnamespace
     where n.nspname = 'erp'
       and ic.relname in ('ux_documentos_compra_chave', 'ix_documentos_compra_dfe', 'ix_documentos_compra_solicitacao', 'ix_notas_fiscais_xml_chave',
                          'uq_notas_fiscais_xml_conteudo', 'ux_importacoes_nfe_compra_pendente', 'ux_importacoes_nfe_compra_documento',
                          'ix_importacoes_nfe_compra_empresa', 'uq_produto_fornecedor_vinculos', 'ix_produto_fornecedor_vinculos_produto',
                          'uq_documentos_compra_rateio_posicao', 'ix_documentos_compra_rateio_documento')) x;
  if v_lista is distinct from array[
       'ix_documentos_compra_dfe documentos_compra(dfe_id) where (dfe_id IS NOT NULL)',
       'ix_documentos_compra_rateio_documento documentos_compra_rateio(organization_id,documento_id)',
       'ix_documentos_compra_solicitacao documentos_compra(solicitacao_compra_id) where (solicitacao_compra_id IS NOT NULL)',
       'ix_importacoes_nfe_compra_empresa importacoes_nfe_compra(organization_id,empresa_id,criado_em)',
       'ix_notas_fiscais_xml_chave notas_fiscais_xml(organization_id,chave_acesso)',
       'ix_produto_fornecedor_vinculos_produto produto_fornecedor_vinculos(organization_id,produto_id)',
       'uq_documentos_compra_rateio_posicao documentos_compra_rateio(documento_id,posicao) unica',
       'uq_notas_fiscais_xml_conteudo notas_fiscais_xml(organization_id,chave_acesso,xml_sha256) unica',
       'uq_produto_fornecedor_vinculos produto_fornecedor_vinculos(organization_id,fornecedor_id,codigo_fornecedor,unidade_fornecedor) unica',
       'ux_documentos_compra_chave documentos_compra(organization_id,chave_acesso) unica where ((especie = ''compra''::text) AND (situacao <> ''cancelado''::text) AND (chave_acesso IS NOT NULL))',
       'ux_importacoes_nfe_compra_documento importacoes_nfe_compra(documento_compra_id) unica where (documento_compra_id IS NOT NULL)',
       'ux_importacoes_nfe_compra_pendente importacoes_nfe_compra(organization_id,chave_acesso) unica where (situacao = ''pendente''::text)'] then
    raise exception 'OPERACOES-01 F7: indices novos ausentes, com outras colunas, sem a unicidade ou sem o predicado esperado: %', v_lista;
  end if;

  -- 13.6 Os gatilhos do usuário, EXATOS (nome → função : tgtype : colunas do UPDATE OF), todos ligados, no documento
  -- de compra, na nota antiga, na DF-e e nas quatro tabelas novas. tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE,
  -- 16 UPDATE, 32 TRUNCATE.
  select array_agg(x.d order by x.d collate "C") into v_lista from (
    select r.relname || '.' || t.tgname || ' -> ' || p.proname || ':' || t.tgtype || ':'
             || coalesce((select string_agg(a.attname, ',' order by k.o) from unnest(t.tgattr::int2[]) with ordinality k(n, o)
                            join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.n), '') as d
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class r on r.oid = t.tgrelid
     where not t.tgisinternal
       and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.invoices'::regclass, 'erp.dfe_documents'::regclass,
                         'erp.notas_fiscais_xml'::regclass, 'erp.importacoes_nfe_compra'::regclass, 'erp.produto_fornecedor_vinculos'::regclass,
                         'erp.documentos_compra_rateio'::regclass)) x;
  if v_lista is distinct from array[
       'dfe_documents.trg_dfe_documents_xml -> dfe_documents_xml_guarda:23:xml_id,access_key,empresa_id',
       'documentos_compra.trg_documentos_compra_aprovacao -> documentos_compra_aprovacao_guarda:19:situacao',
       'documentos_compra.trg_documentos_compra_audit -> audit_row:29:',
       'documentos_compra.trg_documentos_compra_conferir -> documentos_compra_conferir_v3:23:',
       'documentos_compra.trg_documentos_compra_finalizacao -> documentos_compra_finalizacao_guarda:19:situacao',
       'documentos_compra.trg_documentos_compra_nota -> documentos_compra_nota_guarda:23:chave_acesso,uf_nota,tipo_documento_fiscal,valor_ipi,valor_icms_st,seguro,tipo_titulo_id,classificacao_gasto,rateio_tipo,parcelas_nota,dfe_id,solicitacao_compra_id',
       'documentos_compra.trg_documentos_compra_transicao -> documentos_compra_transicao_v3:19:situacao',
       'documentos_compra_itens.trg_documentos_compra_itens_documento_aberto -> documentos_compra_itens_documento_aberto:31:',
       'documentos_compra_itens.trg_documentos_compra_itens_orcamento_guarda -> documentos_compra_item_orcamento_guarda:23:item_pedido_orcado_id,quantidade,produto_id,lote,validade',
       'documentos_compra_itens.trg_documentos_compra_itens_origem_guarda -> documentos_compra_item_origem_guarda_v2:23:origem_item_id,quantidade,produto_id',
       'documentos_compra_rateio.trg_documentos_compra_rateio_audit -> audit_row:29:',
       'documentos_compra_rateio.trg_documentos_compra_rateio_guarda -> documentos_compra_rateio_guarda:7:',
       'documentos_compra_rateio.trg_documentos_compra_rateio_imutavel -> documentos_compra_rateio_guarda:27:',
       'documentos_compra_rateio.trg_documentos_compra_rateio_imutavel_truncate -> documentos_compra_rateio_guarda:34:',
       'importacoes_nfe_compra.trg_importacoes_nfe_compra_audit -> audit_row:29:',
       'importacoes_nfe_compra.trg_importacoes_nfe_compra_guarda -> importacoes_nfe_compra_guarda:23:',
       'importacoes_nfe_compra.trg_importacoes_nfe_compra_imutavel -> importacoes_nfe_compra_imutavel:11:',
       'importacoes_nfe_compra.trg_importacoes_nfe_compra_imutavel_truncate -> importacoes_nfe_compra_imutavel:34:',
       'invoices.trg_invoices_chave_nota -> invoices_chave_nota_guarda:23:access_key,status,deleted_at',
       'notas_fiscais_xml.trg_notas_fiscais_xml_audit -> audit_row:29:',
       'notas_fiscais_xml.trg_notas_fiscais_xml_imutavel -> notas_fiscais_xml_imutavel:27:',
       'notas_fiscais_xml.trg_notas_fiscais_xml_imutavel_truncate -> notas_fiscais_xml_imutavel:34:',
       'produto_fornecedor_vinculos.trg_produto_fornecedor_vinculos_audit -> audit_row:29:']
     or exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'O'
                 and t.tgrelid in ('erp.documentos_compra'::regclass, 'erp.documentos_compra_itens'::regclass, 'erp.invoices'::regclass,
                                   'erp.dfe_documents'::regclass, 'erp.notas_fiscais_xml'::regclass, 'erp.importacoes_nfe_compra'::regclass,
                                   'erp.produto_fornecedor_vinculos'::regclass, 'erp.documentos_compra_rateio'::regclass)) then
    raise exception 'OPERACOES-01 F7: gatilhos do documento de compra, da nota antiga, da DF-e ou das tabelas novas diferentes do esperado ou desligados: %', v_lista;
  end if;

  -- 13.7 A enumeração das SECURITY DEFINER de compras pelo NOME (o critério da 2.7) dá as nove: as oito da 0044 e a
  -- guarda da nota. As duas definer novas e as cinco invoker novas: voláteis, search_path "erp, pg_temp".
  select array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                   order by (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') collate "C") into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.prosecdef
     and (p.proname like 'documentos\_compra%' or p.proname like 'aprovacoes\_compra%');
  if v_lista is distinct from array['erp.aprovacoes_compra_conferir_v2()', 'erp.documentos_compra_aprovacao_guarda()', 'erp.documentos_compra_conferir_v3()',
                                    'erp.documentos_compra_finalizacao_guarda()', 'erp.documentos_compra_item_orcamento_guarda()',
                                    'erp.documentos_compra_item_origem_guarda_v2()', 'erp.documentos_compra_itens_documento_aberto()',
                                    'erp.documentos_compra_nota_guarda()', 'erp.documentos_compra_transicao_v3()'] then
    raise exception 'OPERACOES-01 F7: funcoes SECURITY DEFINER de compras diferentes das nove esperadas depois da 0047: %', v_lista;
  end if;
  select array_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text || ':'
                   || coalesce(array_to_string(p.proconfig, ';'), '') order by p.proname collate "C") into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp'
     and p.proname in ('notas_fiscais_xml_imutavel', 'importacoes_nfe_compra_guarda', 'importacoes_nfe_compra_imutavel', 'documentos_compra_rateio_guarda',
                       'dfe_documents_xml_guarda', 'documentos_compra_nota_guarda', 'invoices_chave_nota_guarda');
  if v_lista is distinct from array['dfe_documents_xml_guarda:invoker:v:search_path=erp, pg_temp', 'documentos_compra_nota_guarda:definer:v:search_path=erp, pg_temp',
                                    'documentos_compra_rateio_guarda:invoker:v:search_path=erp, pg_temp', 'importacoes_nfe_compra_guarda:invoker:v:search_path=erp, pg_temp',
                                    'importacoes_nfe_compra_imutavel:invoker:v:search_path=erp, pg_temp', 'invoices_chave_nota_guarda:definer:v:search_path=erp, pg_temp',
                                    'notas_fiscais_xml_imutavel:invoker:v:search_path=erp, pg_temp'] then
    raise exception 'OPERACOES-01 F7: funcoes novas fora da forma (so as guardas da chave SECURITY DEFINER; todas volateis com search_path "erp, pg_temp"): %', v_lista;
  end if;
  -- 13.8 EXECUTE só do dono, e o dono das duas definer atravessa a RLS.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where n.nspname = 'erp'
                and p.proname in ('notas_fiscais_xml_imutavel', 'importacoes_nfe_compra_guarda', 'importacoes_nfe_compra_imutavel', 'documentos_compra_rateio_guarda',
                                  'dfe_documents_xml_guarda', 'documentos_compra_nota_guarda', 'invoices_chave_nota_guarda')
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'OPERACOES-01 F7: EXECUTE das funcoes de gatilho novas ainda concedido alem do dono.';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
              where n.nspname = 'erp' and p.proname in ('documentos_compra_nota_guarda', 'invoices_chave_nota_guarda')
                and not (r.rolsuper or r.rolbypassrls)) then
    raise exception 'OPERACOES-01 F7: o dono de uma guarda da chave de acesso nao atravessa RLS; ela nao veria a nota antiga nem a compra de outra empresa.';
  end if;

  -- 13.9 Privilégios do erp_app nas quatro tabelas novas: sem DELETE nem TRUNCATE em nenhuma; sem UPDATE no XML e no rateio.
  select array_agg(x.t || ':' || x.p order by x.t collate "C", x.p collate "C") into v_lista
    from (values ('notas_fiscais_xml'), ('importacoes_nfe_compra'), ('produto_fornecedor_vinculos'), ('documentos_compra_rateio')) v(t)
    cross join lateral (select v.t as t, pr.p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr(p)
                         where has_table_privilege('erp_app', to_regclass('erp.' || v.t), pr.p)) x;
  if v_lista is distinct from array['documentos_compra_rateio:INSERT', 'documentos_compra_rateio:SELECT', 'importacoes_nfe_compra:INSERT',
                                    'importacoes_nfe_compra:SELECT', 'importacoes_nfe_compra:UPDATE', 'notas_fiscais_xml:INSERT', 'notas_fiscais_xml:SELECT',
                                    'produto_fornecedor_vinculos:INSERT', 'produto_fornecedor_vinculos:SELECT', 'produto_fornecedor_vinculos:UPDATE'] then
    raise exception 'OPERACOES-01 F7: privilegios do erp_app nas tabelas novas diferentes do esperado (sem DELETE; sem UPDATE no XML e no rateio): %', v_lista;
  end if;

  -- 13.10 Documentação no banco: as quatro tabelas novas e todas as colunas delas e as 27 novas, comentadas.
  select array_agg(x.o order by x.o collate "C") into v_lista from (
    select r.relname as o
      from pg_class r join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'erp' and r.relname in ('notas_fiscais_xml', 'importacoes_nfe_compra', 'produto_fornecedor_vinculos', 'documentos_compra_rateio')
       and obj_description(r.oid, 'pg_class') is null
    union all
    select r.relname || '.' || a.attname
      from pg_class r join pg_namespace n on n.oid = r.relnamespace
      join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'erp' and col_description(r.oid, a.attnum) is null
       and (r.relname in ('notas_fiscais_xml', 'importacoes_nfe_compra', 'produto_fornecedor_vinculos', 'documentos_compra_rateio')
         or (r.relname = 'documentos_compra' and a.attname in ('chave_acesso', 'uf_nota', 'tipo_documento_fiscal', 'valor_ipi', 'valor_icms_st', 'seguro',
               'tipo_titulo_id', 'classificacao_gasto', 'rateio_tipo', 'parcelas_nota', 'dfe_id', 'solicitacao_compra_id'))
         or (r.relname = 'documentos_compra_itens' and a.attname in ('gera_estoque', 'imobilizado', 'bem_id', 'categoria_financeira_id', 'centro_custo_id',
               'valor_ipi', 'valor_icms_st', 'n_item_nota', 'codigo_produto_nota', 'descricao_produto_nota', 'unidade_nota', 'quantidade_nota',
               'fator_conversao', 'tipo_fator_conversao'))
         or (r.relname = 'dfe_documents' and a.attname = 'xml_id'))) x;
  if v_lista is not null then
    raise exception 'OPERACOES-01 F7: tabela ou coluna nova sem comentario: %', v_lista;
  end if;
end $$;
