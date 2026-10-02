-- =====================================================================
-- 0045 OPERACOES-01 F9 — FINANCEIRO PELA TOP E LCDPR — decisão 286 (parte F9a)
--
-- 1) Trava própria (2026,79) e lock_timeout de 2s.
-- 2) Pré-condições nomeadas "OPERACOES-01 F9: …", "já aplicada" PRIMEIRO (P1 a P10). Nenhuma lê dado do ledger: a
--    única tabela viva lida é o catálogo de módulos de escopo (P7).
-- 3) Duas tabelas novas:
--      · erp.imoveis_rurais — o cadastro "Imóvel rural" do LCDPR (nome, CIB/NIRF do ITR, CAEPF, inscrição estadual,
--        tipo de exploração, % de participação), POR EMPRESA (categoria A da 0015: empresa obrigatória, FK
--        COMPOSTA (organization_id, empresa_id) → erp.empresas (organization_id, id), política tenant_e_empresa).
--        O imóvel PADRÃO da empresa é a marca `padrao` (no máximo um vivo por empresa, índice único parcial): a
--        baixa e o movimento da empresa o usam quando nenhum é informado. As colunas de infraestrutura ficam em
--        inglês (is_active, created_at, updated_at, deleted_at) porque o motor genérico de cadastro
--        (apps/api/src/routes/resources.ts) as exige — o precedente é a F8 (updated_at). Exclusão é LÓGICA
--        (deleted_at): o erp_app não apaga nem trunca (dado real, decisão 247). Auditoria e updated_at por gatilho;
--      · erp.tipos_operacao_versao_financeiro — os PADRÕES FINANCEIROS de uma VERSÃO de TOP (natureza, centro de
--        resultado, tipo de título, forma de pagamento e conta), no molde de erp.tipos_operacao_versao_condicoes
--        (0033): uma linha por versão, imutável como a versão (gatilho por linha contra UPDATE/DELETE e por comando
--        contra TRUNCATE, que vale também para o dono), só tenant (tenant_isolation), erp_app só lê e insere. As
--        regras da seção "financeiroPadrao" do formato 5 (provisão, o documento troca, sem classificação) moram no
--        JSON da versão; os ALVOS concretos (UUIDs) moram aqui (regra 4 do ponto de extensão do formato 5).
--        tipo_titulo_id e forma_pagamento_id têm FK de COLUNA ÚNICA: erp.title_types e erp.payment_methods têm
--        linhas do SISTEMA (organization_id nulo, 0004 e 0005), e não existe chave (id, organization_id) que as
--        cubra; a API confere organização = a da sessão OU nula (sistema) antes de gravar.
-- 4) Colunas novas, TODAS anuláveis e sem default, com constraints e índices nomeados:
--      · erp.financial_titles.tipo_operacao_id, .tipo_operacao_versao_id — a TOP e a versão de origem do título
--        (FK de três colunas para a versão, o par inteiro ou nada);
--      · erp.title_settlements.imovel_rural_id — o imóvel do LCDPR da baixa (FK composta com a organização);
--      · erp.bank_movements.imovel_rural_id — o imóvel do LCDPR do movimento (FK composta com a EMPRESA e a
--        organização: prova que o imóvel é da empresa do movimento); CHECK: imóvel só com empresa e nunca em
--        transferência entre contas nem saldo inicial (fora do LCDPR);
--      · erp.bank_movements.tipo_operacao_id, .tipo_operacao_versao_id — a TOP e a versão do movimento;
--      · erp.financial_categories.tipo_lcdpr — o tipo da natureza no LCDPR (receita = 1, custeio_investimento = 2,
--        produto_adiantado = 3, fora = fora do livro); nulo = pendência na conferência.
--    E o CHECK de situação do título (financial_titles_status_check, o MESMO nome) passa a aceitar 'previsto', com
--    chk_financial_titles_previsto: o previsto não tem nada pago e tem SEMPRE uma origem de documento (nunca
--    avulso). O título previsto é a PROVISÃO da TOP: fica fora das baixas e dá lugar ao título de verdade quando o
--    documento é faturado; encerrar o saldo ou cancelar o documento o CANCELA (com trilha; nunca se apaga).
-- 5) Funções e gatilhos:
--    5.1 erp.refresh_title_status(uuid) — MESMA assinatura, linguagem, privilégios e corpo da 0042 (sum(amount)),
--        com UMA linha nova logo depois do retorno no cancelado: título previsto levanta 'CONFLICT: …'. Toda baixa
--        passa por ela (trg_settlement_changed), então a baixa de um previsto — por qualquer binário, inclusive a
--        API anterior — morre no banco com 409.
--    5.2 trg_ft_previsto_guarda (BEFORE UPDATE por linha, com WHEN) → erp.financial_titles_previsto_guarda():
--        o previsto só sai da previsão CANCELADO; valor, desconto, pago, parceiro, empresa, direção e origem dele
--        não mudam; e nenhum título vira previsto por UPDATE (o previsto nasce no INSERT da provisão). O resto
--        (vencimento, observação, conta prevista, trilha do cancelamento, versão) continua atualizável.
--    5.3 trg_tovf_imutavel / trg_tovf_imutavel_truncate → erp.tipos_operacao_versao_financeiro_imutavel(): os
--        padrões de uma versão não aceitam UPDATE, DELETE nem TRUNCATE (a edição da TOP cria uma versão nova).
--    5.4 EXECUTE só do dono nas duas funções de gatilho novas (a 0007 dá EXECUTE de toda função nova ao erp_app; o
--        laço da 0041/0042 o tira).
-- 6) RLS e privilégios: imoveis_rurais com RLS habilitada e FORÇADA e a política ÚNICA tenant_e_empresa (o MESMO
--    gabarito inline da 0040/0041, letra por letra); tipos_operacao_versao_financeiro com RLS habilitada e FORÇADA
--    e a política ÚNICA tenant_isolation. Nenhuma função SECURITY DEFINER nova; nenhuma política existente tocada.
-- 7) Pós-condições só de CATÁLOGO (nunca contagem de tabela viva), sob o marcador literal abaixo.
--
-- PRIVILÉGIOS: erp_app — imoveis_rurais: select, insert, update (sem delete/truncate: exclusão lógica);
-- tipos_operacao_versao_financeiro: select, insert (sem update/delete/truncate: histórico da versão); funções de
-- gatilho novas: nenhum; erp.refresh_title_status: o EXECUTE de hoje (create or replace mantém dono e privilégios).
--
-- SEM BACKFILL: nenhuma linha existente é reescrita. Tabelas novas vazias; colunas novas anuláveis sem default;
-- o CHECK de situação ALARGADO (o acervo, sem 'previsto', já o satisfaz); CHECKs novos que o acervo satisfaz por ter
-- as colunas nulas e nenhum previsto; índices; gatilhos e funções. A troca do corpo de erp.refresh_title_status não
-- recalcula título algum. Toda TOP de hoje continua com a provisão DESLIGADA (o neutro da seção nova): nenhum
-- previsto nasce até alguém ligar a provisão numa TOP gravada no formato 5.
-- JANELA DE DEPLOY (pre-deploy; ordem banco → API → web). A API anterior (622f194) sobre este banco:
--   · os INSERTs dela não citam as colunas novas (anuláveis, sem default) e nunca gravam 'previsto';
--   · o CHECK alargado não muda nada para ela; ela não lê nem grava as tabelas novas;
--   · só depois que alguém LIGAR a provisão numa TOP (API e web novos) existe previsto. Se a API voltar para a
--     anterior com previstos gravados, a lista antiga os mostraria como "A vencer" e os relatórios antigos os
--     somariam, mas NENHUMA baixa neles passa (5.1: CONFLICT → 409, código que todo binário conhece), e nenhuma
--     alteração de valor (5.2).
-- Os ALTER TABLE pedem locks curtos ACCESS EXCLUSIVE em erp.financial_titles (a validação do CHECK alargado lê a
-- tabela), erp.title_settlements, erp.bank_movements e erp.financial_categories, e as FKs novas pedem SHARE ROW
-- EXCLUSIVE nas referenciadas (organizations, empresas, users, tipos_operacao_versoes, financial_categories,
-- cost_centers, bank_accounts, title_types, payment_methods e a própria imoveis_rurais); o lock_timeout de 2s faz a
-- migration desistir em vez de enfileirar as gravações atrás dela.
-- O gatilho BEFORE TRUNCATE da tabela nova da versão faz qualquer TRUNCATE … CASCADE a partir das tabelas que ela
-- referencia (tipos_operacao_versoes, financial_categories, cost_centers, bank_accounts, title_types,
-- payment_methods, users, organizations) falhar. É desejado (decisão 247: histórico não se trunca); para as que já
-- chegavam em cascata às tabelas de aprovação da 0041 (a versão da TOP, a organização, o usuário, e a natureza e o
-- centro pela venda), isso já acontecia.
-- VOLTA: API e web voltam por redeploy e convivem com a 0045 (descrito acima). O banco fica: tudo é aditivo, as
-- tabelas novas NUNCA se apagam (dado real, decisão 247), os previstos ficam como linhas (canceláveis), e desligar
-- um gatilho ou devolver privilégio só com uma migration nova, por decisão humana.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (a 0042 usou 76; 77 e 78 são da 0043 e da 0044).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 79) then
    raise exception 'OPERACOES-01 F9: outra transacao ja detem a trava desta migration (2026,79). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_def text;
  v_ft text[];
  v_refresh text;
begin
  -- P1 "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência.
  if to_regclass('erp.imoveis_rurais') is not null
     or to_regclass('erp.tipos_operacao_versao_financeiro') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'financial_titles' and column_name = 'tipo_operacao_id')
     or exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'financial_categories' and column_name = 'tipo_lcdpr')
     or to_regprocedure('erp.financial_titles_previsto_guarda()') is not null then
    raise exception 'OPERACOES-01 F9: a 0045 ja foi aplicada ou ha schema divergente (imoveis_rurais/tipos_operacao_versao_financeiro/tipo_operacao_id/tipo_lcdpr/financial_titles_previsto_guarda ja existe).';
  end if;
  -- P2 O papel da aplicação é o destinatário dos privilégios das tabelas novas.
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'OPERACOES-01 F9: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
  end if;
  -- P3 Quem aplica é o dono do schema (atravessa RLS); o papel da aplicação não cria tabela nem altera o ledger, e
  -- pararia adiante num erro de permissão genérico, no meio do arquivo.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'OPERACOES-01 F9: o papel que aplica a migration nao atravessa RLS (e o papel da aplicacao ou outro sem bypass); as tabelas novas, os gatilhos e as constraints do ledger sao do dono do schema.';
  end if;
  -- P4 As colunas que as constraints, os índices, os gatilhos e as funções novas leem (contagem EXATA:
  -- 12 + 5 + 5 + 2 + 2 + 2 + 2 + 2 + 3 = 35).
  if (select count(*) from information_schema.columns
       where table_schema = 'erp'
         and ((table_name = 'financial_titles' and column_name in ('id', 'organization_id', 'empresa_id', 'direction', 'person_id', 'amount',
                                                                   'discount', 'paid_amount', 'status', 'source_type', 'source_id', 'version'))
           or (table_name = 'title_settlements' and column_name in ('id', 'organization_id', 'title_id', 'amount', 'status'))
           or (table_name = 'bank_movements' and column_name in ('id', 'organization_id', 'empresa_id', 'category_type', 'movement_date'))
           or (table_name = 'financial_categories' and column_name in ('id', 'organization_id'))
           or (table_name = 'cost_centers' and column_name in ('id', 'organization_id'))
           or (table_name = 'bank_accounts' and column_name in ('id', 'organization_id'))
           or (table_name = 'title_types' and column_name in ('id', 'organization_id'))
           or (table_name = 'payment_methods' and column_name in ('id', 'organization_id'))
           or (table_name = 'tipos_operacao_versoes' and column_name in ('id', 'tipo_operacao_id', 'organization_id')))) <> 35 then
    raise exception 'OPERACOES-01 F9: coluna lida pela migration ausente (financial_titles: id/organization_id/empresa_id/direction/person_id/amount/discount/paid_amount/status/source_type/source_id/version; title_settlements: id/organization_id/title_id/amount/status; bank_movements: id/organization_id/empresa_id/category_type/movement_date; financial_categories, cost_centers, bank_accounts, title_types, payment_methods: id/organization_id; tipos_operacao_versoes: id/tipo_operacao_id/organization_id); a cadeia de migrations esta fora de ordem.';
  end if;
  -- P5 As chaves que as FKs compostas novas referenciam (as de erp.imoveis_rurais nascem aqui).
  if not exists (select 1 from pg_constraint where conrelid = 'erp.tipos_operacao_versoes'::regclass and conname = 'uq_tipos_operacao_versoes_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.financial_categories'::regclass and conname = 'uq_financial_categories_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.cost_centers'::regclass and conname = 'uq_cost_centers_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.bank_accounts'::regclass and conname = 'uq_bank_accounts_tenant' and contype = 'u') then
    raise exception 'OPERACOES-01 F9: chave alvo das FKs compostas ausente (uq_tipos_operacao_versoes_tenant da 0021, uq_financial_categories_tenant e uq_cost_centers_tenant da 0024, uq_bank_accounts_tenant da 0042).';
  end if;
  -- A FK de empresa do imóvel é composta (organização, empresa): coluna única não prova tenant.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.empresas'::regclass and c.contype in ('u', 'p')
                    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'organization_id']) then
    raise exception 'OPERACOES-01 F9: chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa do imovel rural nao teria alvo.';
  end if;
  -- P6 As funções que as políticas e os gatilhos chamam: o plpgsql e a política só resolvem a chamada na execução,
  -- e a ausência viraria erro genérico na primeira gravação.
  if to_regprocedure('erp.tenant_visible(uuid)') is null or to_regprocedure('erp.audit_row()') is null
     or to_regprocedure('erp.set_updated_at()') is null or to_regprocedure('erp.escopo_empresa_total(text)') is null
     or to_regprocedure('erp.empresas_do_membro(text)') is null or to_regprocedure('erp.modulo_empresa_atual()') is null
     or to_regprocedure('erp.refresh_title_status(uuid)') is null or to_regprocedure('erp.title_settlement_changed()') is null then
    raise exception 'OPERACOES-01 F9: funcoes de RLS/auditoria/baixa ausentes (tenant_visible, audit_row, set_updated_at, escopo_empresa_total, empresas_do_membro, modulo_empresa_atual, refresh_title_status, title_settlement_changed).';
  end if;
  -- P7 O módulo de escopo do imóvel rural (scripts/company-rls-modules.json: financeiro).
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'financeiro') then
    raise exception 'OPERACOES-01 F9: modulo de escopo empresarial financeiro ausente (0011); o imovel rural nao teria modulo.';
  end if;
  -- P8 O CHECK de situação do título é EXATAMENTE o de hoje: a lista alargada com 'previsto' é escrita sobre ele, com
  -- o MESMO nome. Uma lista diferente (um valor a mais ou a menos) seria trocada sem ninguém decidir.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'erp.financial_titles'::regclass and c.conname = 'financial_titles_status_check' and c.contype = 'c';
  if v_def is distinct from 'CHECK ((status = ANY (ARRAY[''open''::text, ''partially_paid''::text, ''paid''::text, ''cancelled''::text])))' then
    raise exception 'OPERACOES-01 F9: o CHECK financial_titles_status_check de erp.financial_titles nao e o de hoje (open, partially_paid, paid, cancelled); a lista com previsto seria escrita sobre outra regra: %', v_def;
  end if;
  -- P9 O conjunto EXATO dos gatilhos de hoje no título: é sobre ele que a pós-condição afirma "os de hoje e a guarda
  -- do previsto, nenhum outro".
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_ft
    from pg_trigger t where t.tgrelid = 'erp.financial_titles'::regclass and not t.tgisinternal;
  if v_ft is distinct from array['trg_ft_audit', 'trg_ft_updated'] then
    raise exception 'OPERACOES-01 F9: gatilhos de erp.financial_titles diferentes dos esperados (trg_ft_audit, trg_ft_updated): %', v_ft;
  end if;
  -- P10 erp.refresh_title_status é a da 0042 (a soma B, o retorno no cancelado, nenhum previsto): a linha nova é
  -- escrita sobre ESSE corpo, e um corpo diferente seria substituído sem ninguém decidir.
  v_refresh := pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure);
  if position('sum(amount)' in v_refresh) = 0
     or position('if v_status = ''cancelled'' then return;' in v_refresh) = 0
     or position('previsto' in v_refresh) > 0 then
    raise exception 'OPERACOES-01 F9: erp.refresh_title_status nao e a da 0042 (sum(amount), retorno no cancelado, sem previsto); a linha do previsto seria escrita sobre outro corpo.';
  end if;
end $$;

-- ---------- 3) tabelas novas ----------
create table erp.imoveis_rurais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  nome text not null,
  cib text,
  caepf text,
  inscricao_estadual text,
  -- A lista de valores da coluna, inline e sozinha: é a forma que o dicionário de dados lê como "Valores".
  tipo_exploracao text default 'individual' not null
    constraint chk_imoveis_rurais_tipo_exploracao check (tipo_exploracao in ('individual', 'condominio', 'arrendado', 'parceria', 'comodato', 'outros')),
  participacao numeric(5,2) not null default 100,
  padrao boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint uq_imoveis_rurais_tenant unique (id, organization_id),
  constraint uq_imoveis_rurais_empresa unique (id, empresa_id, organization_id),
  constraint fk_imoveis_rurais_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint chk_imoveis_rurais_nome check (length(btrim(nome)) between 1 and 120),
  constraint chk_imoveis_rurais_cib check (cib ~ '^[0-9]{8}$'),
  constraint chk_imoveis_rurais_caepf check (caepf ~ '^[0-9]{14}$'),
  constraint chk_imoveis_rurais_inscricao_estadual check (length(inscricao_estadual) <= 20),
  constraint chk_imoveis_rurais_participacao check (participacao > 0 and participacao <= 100)
);
create unique index ux_imoveis_rurais_padrao on erp.imoveis_rurais (organization_id, empresa_id) where padrao and deleted_at is null;
create unique index ux_imoveis_rurais_cib on erp.imoveis_rurais (organization_id, empresa_id, cib) where cib is not null and deleted_at is null;
create index ix_imoveis_rurais_empresa on erp.imoveis_rurais (organization_id, empresa_id);
create trigger trg_imoveis_rurais_audit after insert or update or delete on erp.imoveis_rurais for each row execute function erp.audit_row();
create trigger trg_imoveis_rurais_updated before update on erp.imoveis_rurais for each row execute function erp.set_updated_at();

comment on table erp.imoveis_rurais is 'Imóvel rural do LCDPR (OPERACOES-01 F9, decisão 286): nome, CIB/NIRF do ITR, CAEPF, inscrição estadual, tipo de exploração e % de participação, por empresa (RLS por empresa, módulo financeiro). O imóvel marcado padrao é o que a baixa e o movimento da empresa usam quando nenhum é informado. Exclusão lógica (deleted_at); nunca se apaga.';
comment on column erp.imoveis_rurais.id is 'Identidade técnica do imóvel (a auditoria lê esta coluna).';
comment on column erp.imoveis_rurais.organization_id is 'Tenant (organização).';
comment on column erp.imoveis_rurais.empresa_id is 'Empresa dona do imóvel (FK composta com a organização). Escopo de empresa do módulo financeiro.';
comment on column erp.imoveis_rurais.nome is 'Nome do imóvel (1 a 120 caracteres além dos espaços).';
comment on column erp.imoveis_rurais.cib is 'CIB / NIRF do imóvel na Receita Federal (ITR): 8 dígitos, só números. Único por empresa entre os imóveis vivos. Nulo = não informado.';
comment on column erp.imoveis_rurais.caepf is 'CAEPF do produtor no imóvel: 14 dígitos, só números (a validação do dígito é da API). Nulo = não informado.';
comment on column erp.imoveis_rurais.inscricao_estadual is 'Inscrição estadual do produtor no imóvel (até 20 caracteres). Nula = não informada.';
comment on column erp.imoveis_rurais.tipo_exploracao is 'Tipo de exploração do LCDPR: individual = 1, condominio = 2, arrendado = 3, parceria = 4, comodato = 5, outros = 6.';
comment on column erp.imoveis_rurais.participacao is 'Percentual de participação do produtor no imóvel (maior que 0 e até 100, duas casas).';
comment on column erp.imoveis_rurais.padrao is 'A baixa e o movimento da empresa usam este imóvel quando nenhum é informado; um por empresa entre os imóveis vivos (ux_imoveis_rurais_padrao).';
comment on column erp.imoveis_rurais.is_active is 'Ativo (o inativo continua no histórico e não é oferecido em lançamento novo).';
comment on column erp.imoveis_rurais.created_at is 'Criação do registro.';
comment on column erp.imoveis_rurais.updated_at is 'Última alteração (gatilho trg_imoveis_rurais_updated).';
comment on column erp.imoveis_rurais.deleted_at is 'Exclusão lógica (o registro fica; o erp_app não apaga).';

create table erp.tipos_operacao_versao_financeiro (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  origem_versao_id uuid not null,
  origem_tipo_operacao_id uuid not null,
  natureza_id uuid,
  centro_custo_id uuid,
  tipo_titulo_id uuid,
  forma_pagamento_id uuid,
  conta_bancaria_id uuid,
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),
  constraint uq_tipos_operacao_versao_financeiro unique (origem_versao_id),
  constraint fk_tipos_operacao_versao_financeiro_origem foreign key (origem_versao_id, origem_tipo_operacao_id, organization_id)
    references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id),
  constraint fk_tipos_operacao_versao_financeiro_natureza foreign key (natureza_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_tipos_operacao_versao_financeiro_centro foreign key (centro_custo_id, organization_id) references erp.cost_centers (id, organization_id),
  constraint fk_tipos_operacao_versao_financeiro_tipo_titulo foreign key (tipo_titulo_id) references erp.title_types (id),
  constraint fk_tipos_operacao_versao_financeiro_forma foreign key (forma_pagamento_id) references erp.payment_methods (id),
  constraint fk_tipos_operacao_versao_financeiro_conta foreign key (conta_bancaria_id, organization_id) references erp.bank_accounts (id, organization_id),
  constraint chk_tipos_operacao_versao_financeiro_algum check (num_nonnulls(natureza_id, centro_custo_id, tipo_titulo_id, forma_pagamento_id, conta_bancaria_id) > 0)
);

comment on table erp.tipos_operacao_versao_financeiro is 'Padrões financeiros de uma VERSÃO de TOP (OPERACOES-01 F9, decisão 286): natureza, centro de resultado, tipo de título, forma de pagamento e conta que o lançamento da operação usa quando o documento não informa. Uma linha por versão (só quando há algum padrão), imutável como a versão; as regras da seção financeiroPadrao do formato 5 moram no JSON da versão.';
comment on column erp.tipos_operacao_versao_financeiro.id is 'Identidade técnica da linha (a auditoria lê esta coluna).';
comment on column erp.tipos_operacao_versao_financeiro.organization_id is 'Tenant (organização).';
comment on column erp.tipos_operacao_versao_financeiro.origem_versao_id is 'Versão da TOP que declara os padrões (uma linha por versão). FK composta com a TOP e o tenant.';
comment on column erp.tipos_operacao_versao_financeiro.origem_tipo_operacao_id is 'TOP da versão de origem (viaja com a versão na FK composta).';
comment on column erp.tipos_operacao_versao_financeiro.natureza_id is 'Natureza financeira padrão (analítica, do tipo da operação: conferido pela API ao gravar). FK composta com o tenant. Nula = sem padrão.';
comment on column erp.tipos_operacao_versao_financeiro.centro_custo_id is 'Centro de resultado padrão (analítico: conferido pela API ao gravar). FK composta com o tenant. Nulo = sem padrão.';
comment on column erp.tipos_operacao_versao_financeiro.tipo_titulo_id is 'Tipo de título padrão. FK de coluna única: erp.title_types tem linhas do sistema (organização nula); a API confere organização = a da sessão OU nula antes de gravar. Nulo = sem padrão.';
comment on column erp.tipos_operacao_versao_financeiro.forma_pagamento_id is 'Forma de pagamento padrão. FK de coluna única: erp.payment_methods tem linhas do sistema (organização nula); a API confere organização = a da sessão OU nula, e ativa, antes de gravar. Nula = sem padrão.';
comment on column erp.tipos_operacao_versao_financeiro.conta_bancaria_id is 'Conta bancária ou caixa padrão (a conta prevista do título; a conta do movimento). FK composta com o tenant. Nula = sem padrão.';
comment on column erp.tipos_operacao_versao_financeiro.criado_por is 'Usuário que gravou a versão.';
comment on column erp.tipos_operacao_versao_financeiro.criado_em is 'Gravação da linha.';

-- ---------- 4) colunas novas, CHECKs e índices (todas anuláveis, sem default) ----------
alter table erp.financial_titles add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
alter table erp.financial_titles add constraint fk_financial_titles_tipo_operacao_versao
  foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.financial_titles add constraint chk_financial_titles_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null));
create index idx_financial_titles_tipo_operacao on erp.financial_titles (organization_id, tipo_operacao_id) where tipo_operacao_id is not null;
-- A lista de valores da coluna, sozinha e com o MESMO nome (o dicionário de dados a lê como "Valores"; a P8 garantiu
-- que a de antes era exatamente a de hoje).
alter table erp.financial_titles drop constraint financial_titles_status_check,
  add constraint financial_titles_status_check check (status in ('open', 'partially_paid', 'paid', 'cancelled', 'previsto'));
alter table erp.financial_titles add constraint chk_financial_titles_previsto check (
  status <> 'previsto' or (paid_amount = 0 and source_type is not null and source_type <> 'manual' and source_id is not null));
create index idx_financial_titles_previsto_origem on erp.financial_titles (organization_id, source_type, source_id) where status = 'previsto';

alter table erp.title_settlements add column imovel_rural_id uuid;
alter table erp.title_settlements add constraint fk_title_settlements_imovel_rural
  foreign key (imovel_rural_id, organization_id) references erp.imoveis_rurais (id, organization_id);
create index idx_title_settlements_imovel_rural on erp.title_settlements (imovel_rural_id) where imovel_rural_id is not null;

alter table erp.bank_movements add column imovel_rural_id uuid, add column tipo_operacao_id uuid, add column tipo_operacao_versao_id uuid;
-- O imóvel do movimento é da EMPRESA do movimento: a FK inclui a empresa (prova tenant E empresa). Com MATCH SIMPLE,
-- empresa nula não seria conferida: o CHECK proíbe imóvel sem empresa, e em transferência ou saldo inicial (fora do LCDPR).
alter table erp.bank_movements add constraint fk_bank_movements_imovel_rural
  foreign key (imovel_rural_id, empresa_id, organization_id) references erp.imoveis_rurais (id, empresa_id, organization_id);
alter table erp.bank_movements add constraint chk_bank_movements_imovel_rural check (
  imovel_rural_id is null or (empresa_id is not null and category_type not in ('internal_transfer', 'opening_balance')));
alter table erp.bank_movements add constraint fk_bank_movements_tipo_operacao_versao
  foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id);
alter table erp.bank_movements add constraint chk_bank_movements_tipo_operacao_par check ((tipo_operacao_id is null) = (tipo_operacao_versao_id is null));
create index idx_bank_movements_imovel_rural on erp.bank_movements (organization_id, imovel_rural_id, movement_date) where imovel_rural_id is not null;

alter table erp.financial_categories add column tipo_lcdpr text;
-- A lista de valores da coluna, sozinha: nulo passa (um CHECK nulo não recusa), e é a forma que o dicionário de
-- dados lê como "Valores" da coluna.
alter table erp.financial_categories add constraint chk_financial_categories_tipo_lcdpr check (
  tipo_lcdpr in ('receita', 'custeio_investimento', 'produto_adiantado', 'fora'));

comment on column erp.financial_titles.tipo_operacao_id is 'TOP de origem do título (OPERACOES-01 F9): a do documento que o gerou ou a escolhida no lançamento avulso. Anda em par com tipo_operacao_versao_id (os dois ou nenhum). Nula = sem TOP (acervo e geradores que não citam TOP).';
comment on column erp.financial_titles.tipo_operacao_versao_id is 'Versão da TOP de origem do título (FK de três colunas com a TOP e o tenant). Nula = sem TOP.';
comment on column erp.title_settlements.imovel_rural_id is 'Imóvel rural do LCDPR da baixa (OPERACOES-01 F9). Padrão = o imóvel padrão da empresa do título; nulo = sem imóvel. FK composta só com a organização (a baixa não tem empresa): o imóvel da empresa do título e a compensação sem imóvel são conferidos pela API; o LCDPR lê o movimento, cuja FK inclui a empresa.';
comment on column erp.bank_movements.imovel_rural_id is 'Imóvel rural do LCDPR do movimento (OPERACOES-01 F9). FK composta com a EMPRESA e a organização (o imóvel é da empresa do movimento); só em movimento com empresa e fora de transferência entre contas e saldo inicial. Nulo = sem imóvel.';
comment on column erp.bank_movements.tipo_operacao_id is 'TOP do movimento (família do movimento bancário), em par com tipo_operacao_versao_id. Nula = sem TOP.';
comment on column erp.bank_movements.tipo_operacao_versao_id is 'Versão da TOP do movimento (FK de três colunas com a TOP e o tenant). Nula = sem TOP.';
comment on column erp.financial_categories.tipo_lcdpr is 'Tipo da natureza no LCDPR (OPERACOES-01 F9): receita = 1 (receita da atividade rural), custeio_investimento = 2 (despesa de custeio e investimento), produto_adiantado = 3 (produto entregue de adiantamento), fora = fora do livro. Nulo = não classificada (pendência na conferência).';

-- ---------- 5) funções e gatilhos ----------
-- 5.1 O previsto não recebe baixa. MESMA assinatura, linguagem e corpo da 0042 — só a linha do previsto é nova. É
-- create or replace: dono e privilégios ficam (a API chama esta função direto, e o erp_app continua executando).
create or replace function erp.refresh_title_status(p_title uuid) returns void language plpgsql as $$
declare v_paid numeric(18,2); v_net numeric(18,2); v_status text;
begin
  select coalesce(sum(amount),0) into v_paid from erp.title_settlements where title_id = p_title and status = 'confirmed';
  select amount - discount, status into v_net, v_status from erp.financial_titles where id = p_title for update;
  if v_status = 'cancelled' then return; end if;
  if v_status = 'previsto' then raise exception 'CONFLICT: Título previsto não recebe baixa: ele dá lugar ao título de verdade quando o documento é faturado.' using errcode = 'P0001'; end if;
  if v_paid > v_net then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: baixas % excedem líquido %', v_paid, v_net using errcode='P0001';
  end if;
  update erp.financial_titles set paid_amount = v_paid,
    status = case when v_paid = 0 then 'open' when v_paid < v_net then 'partially_paid' else 'paid' end,
    version = version + 1
  where id = p_title;
end $$;
comment on function erp.refresh_title_status(uuid) is 'Recalcula pago e situação do título pelas baixas confirmadas (semântica B da 0042: sum(amount)). Título cancelado: nada. Título previsto (OPERACOES-01 F9): CONFLICT — o previsto não recebe baixa.';

-- 5.2 O previsto só sai da previsão cancelado. A mensagem é de NEGÓCIO (uma linha, código conhecido por todo binário:
-- CONFLICT → 409). INVOKER e sem ler tabela: só recusa; o WHEN do gatilho diz quando.
create function erp.financial_titles_previsto_guarda() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: Título previsto não se altera: ele só sai da previsão cancelado, e o título de verdade nasce do documento.' using errcode = 'P0001';
end $$;
comment on function erp.financial_titles_previsto_guarda() is 'Gatilho trg_ft_previsto_guarda (OPERACOES-01 F9): o titulo previsto so muda para cancelado, sem mudar valor, desconto, pago, parceiro, empresa, direcao nem origem; e nenhum titulo vira previsto por UPDATE.';
create trigger trg_ft_previsto_guarda
  before update on erp.financial_titles for each row
  when ((old.status = 'previsto'
         and (new.status not in ('previsto', 'cancelled')
              or (old.amount, old.discount, old.paid_amount, old.person_id, old.empresa_id, old.direction, old.source_type, old.source_id)
                 is distinct from
                 (new.amount, new.discount, new.paid_amount, new.person_id, new.empresa_id, new.direction, new.source_type, new.source_id)))
        or (old.status <> 'previsto' and new.status = 'previsto'))
  execute function erp.financial_titles_previsto_guarda();

-- 5.3 Os padrões de uma versão são histórico imutável, como a versão (o molde da 0020/0041): nem UPDATE, nem DELETE,
-- nem TRUNCATE, de ninguém. Um gatilho POR LINHA (UPDATE OR DELETE) e um POR COMANDO (TRUNCATE não passa pelos de
-- linha). A função não lê OLD nem NEW (nulos no gatilho por comando): só recusa, nomeando a operação.
create function erp.tipos_operacao_versao_financeiro_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: Os padrões financeiros de uma versão de TOP não aceitam % (a edição cria uma versão nova).', tg_op
    using errcode = 'P0001';
end $$;
comment on function erp.tipos_operacao_versao_financeiro_imutavel() is 'Gatilhos trg_tovf_imutavel e trg_tovf_imutavel_truncate (OPERACOES-01 F9): os padroes financeiros de uma versao de TOP sao so insercao; recusa UPDATE e DELETE (por linha) e TRUNCATE (por comando) com a mesma CONFLICT; nao le OLD nem NEW.';
create trigger trg_tovf_imutavel
  before update or delete on erp.tipos_operacao_versao_financeiro
  for each row execute function erp.tipos_operacao_versao_financeiro_imutavel();
create trigger trg_tovf_imutavel_truncate
  before truncate on erp.tipos_operacao_versao_financeiro
  for each statement execute function erp.tipos_operacao_versao_financeiro_imutavel();
create trigger trg_tovf_audit
  after insert on erp.tipos_operacao_versao_financeiro
  for each row execute function erp.audit_row();

-- 5.4 EXECUTE só do dono nas funções de gatilho novas. Não são porta de ninguém: a 0007 dá EXECUTE por padrão ao
-- erp_app; tira-se de todos (o laço da 0041/0042; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('financial_titles_previsto_guarda', 'tipos_operacao_versao_financeiro_imutavel')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 6) RLS e privilégios ----------
-- Categoria A da 0015 (empresa obrigatória) — o MESMO gabarito inline da 0040/0041 (InitPlan + hashed SubPlan).
alter table erp.imoveis_rurais enable row level security;
alter table erp.imoveis_rurais force row level security;
create policy tenant_e_empresa on erp.imoveis_rurais for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Só tenant (o molde da 0033): os padrões são da TOP, que é da organização inteira.
alter table erp.tipos_operacao_versao_financeiro enable row level security;
alter table erp.tipos_operacao_versao_financeiro force row level security;
create policy tenant_isolation on erp.tipos_operacao_versao_financeiro for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));

-- A 0007 dá os quatro privilégios a toda tabela nova; o grant sozinho não tira nada, então o revoke é EXPLÍCITO.
-- Imóvel: exclusão lógica (dado real, decisão 247). Padrões da versão: só inserção (histórico).
grant select, insert, update on erp.imoveis_rurais to erp_app;
revoke delete, truncate on erp.imoveis_rurais from erp_app;
grant select, insert on erp.tipos_operacao_versao_financeiro to erp_app;
revoke update, delete, truncate on erp.tipos_operacao_versao_financeiro from erp_app;

-- ---------- 7) pós-condições nomeadas (objetos de catálogo, nunca contagem de tabela viva) ----------
do $$
begin
  -- As duas tabelas novas, com as colunas do contrato (14 e 11), RLS habilitada e forçada e a política única.
  if to_regclass('erp.imoveis_rurais') is null
     or (select count(*) from pg_attribute where attrelid = 'erp.imoveis_rurais'::regclass and attnum > 0 and not attisdropped) <> 14
     or to_regclass('erp.tipos_operacao_versao_financeiro') is null
     or (select count(*) from pg_attribute where attrelid = 'erp.tipos_operacao_versao_financeiro'::regclass and attnum > 0 and not attisdropped) <> 11 then
    raise exception 'OPERACOES-01 F9: erp.imoveis_rurais (14 colunas) ou erp.tipos_operacao_versao_financeiro (11 colunas) ausente ou fora do contrato.';
  end if;
  if (select count(*) from pg_class
       where oid in ('erp.imoveis_rurais'::regclass, 'erp.tipos_operacao_versao_financeiro'::regclass)
         and relrowsecurity and relforcerowsecurity) <> 2
     or (select array_agg(policyname::text || '/' || cmd order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'imoveis_rurais')
        is distinct from array['tenant_e_empresa/ALL']
     or (select array_agg(policyname::text || '/' || cmd order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'tipos_operacao_versao_financeiro')
        is distinct from array['tenant_isolation/ALL'] then
    raise exception 'OPERACOES-01 F9: tabelas novas sem RLS habilitada e forcada, ou com politica diferente da unica esperada (imoveis_rurais: tenant_e_empresa; tipos_operacao_versao_financeiro: tenant_isolation).';
  end if;
  -- O gabarito da categoria A, letra por letra: o predicado do imóvel é o MESMO da decisão de aprovação da 0041.
  if (select array[p.qual, p.with_check] from pg_policies p where p.schemaname = 'erp' and p.tablename = 'imoveis_rurais' and p.policyname = 'tenant_e_empresa')
     is distinct from (select array[p.qual, p.with_check] from pg_policies p where p.schemaname = 'erp' and p.tablename = 'aprovacoes_venda' and p.policyname = 'tenant_e_empresa') then
    raise exception 'OPERACOES-01 F9: a politica tenant_e_empresa de erp.imoveis_rurais nao e o gabarito da categoria A (o mesmo predicado de erp.aprovacoes_venda, 0041).';
  end if;
  -- As 7 colunas novas nas tabelas de hoje: tipo exato e ANULÁVEIS sem default (sem backfill, nenhuma obrigatória).
  if (select count(*)
        from (values ('erp.financial_titles'::regclass, 'tipo_operacao_id', 'uuid'),
                     ('erp.financial_titles'::regclass, 'tipo_operacao_versao_id', 'uuid'),
                     ('erp.title_settlements'::regclass, 'imovel_rural_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'imovel_rural_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'tipo_operacao_id', 'uuid'),
                     ('erp.bank_movements'::regclass, 'tipo_operacao_versao_id', 'uuid'),
                     ('erp.financial_categories'::regclass, 'tipo_lcdpr', 'text')) e(tabela, coluna, tipo)
        join pg_attribute a on a.attrelid = e.tabela and a.attname = e.coluna and a.attnum > 0 and not a.attisdropped
       where format_type(a.atttypid, a.atttypmod) = e.tipo and not a.attnotnull and not a.atthasdef) <> 7 then
    raise exception 'OPERACOES-01 F9: colunas novas ausentes, de outro tipo, obrigatorias ou com default (esperadas 7 anulaveis sem default).';
  end if;
  -- As chaves únicas novas, com as colunas NA ORDEM declarada.
  if (select count(*)
        from (values ('uq_imoveis_rurais_tenant', 'erp.imoveis_rurais'::regclass, array['id', 'organization_id']),
                     ('uq_imoveis_rurais_empresa', 'erp.imoveis_rurais'::regclass, array['id', 'empresa_id', 'organization_id']),
                     ('uq_tipos_operacao_versao_financeiro', 'erp.tipos_operacao_versao_financeiro'::regclass, array['origem_versao_id'])) e(nome, tabela, colunas)
        join pg_constraint c on c.conname = e.nome and c.conrelid = e.tabela and c.contype = 'u'
       where c.conkey = (select array_agg(a.attnum order by o.n) from unnest(e.colunas) with ordinality o(coluna, n)
                           join pg_attribute a on a.attrelid = e.tabela and a.attname = o.coluna)) <> 3 then
    raise exception 'OPERACOES-01 F9: chaves unicas novas ausentes ou fora da forma (uq_imoveis_rurais_tenant (id, organization_id), uq_imoveis_rurais_empresa (id, empresa_id, organization_id), uq_tipos_operacao_versao_financeiro (origem_versao_id)).';
  end if;
  -- As 11 FKs novas: alvo certo, colunas NA ORDEM declarada dos dois lados, sem ação e validadas. As de tipo de título
  -- e forma de pagamento são de coluna única (linhas do sistema); todas as outras são compostas com a organização.
  if (select count(*)
        from (values ('fk_imoveis_rurais_empresa', 'erp.imoveis_rurais'::regclass, array['organization_id', 'empresa_id'],
                      'erp.empresas'::regclass, array['organization_id', 'id']),
                     ('fk_tipos_operacao_versao_financeiro_origem', 'erp.tipos_operacao_versao_financeiro'::regclass, array['origem_versao_id', 'origem_tipo_operacao_id', 'organization_id'],
                      'erp.tipos_operacao_versoes'::regclass, array['id', 'tipo_operacao_id', 'organization_id']),
                     ('fk_tipos_operacao_versao_financeiro_natureza', 'erp.tipos_operacao_versao_financeiro'::regclass, array['natureza_id', 'organization_id'],
                      'erp.financial_categories'::regclass, array['id', 'organization_id']),
                     ('fk_tipos_operacao_versao_financeiro_centro', 'erp.tipos_operacao_versao_financeiro'::regclass, array['centro_custo_id', 'organization_id'],
                      'erp.cost_centers'::regclass, array['id', 'organization_id']),
                     ('fk_tipos_operacao_versao_financeiro_tipo_titulo', 'erp.tipos_operacao_versao_financeiro'::regclass, array['tipo_titulo_id'],
                      'erp.title_types'::regclass, array['id']),
                     ('fk_tipos_operacao_versao_financeiro_forma', 'erp.tipos_operacao_versao_financeiro'::regclass, array['forma_pagamento_id'],
                      'erp.payment_methods'::regclass, array['id']),
                     ('fk_tipos_operacao_versao_financeiro_conta', 'erp.tipos_operacao_versao_financeiro'::regclass, array['conta_bancaria_id', 'organization_id'],
                      'erp.bank_accounts'::regclass, array['id', 'organization_id']),
                     ('fk_financial_titles_tipo_operacao_versao', 'erp.financial_titles'::regclass, array['tipo_operacao_versao_id', 'tipo_operacao_id', 'organization_id'],
                      'erp.tipos_operacao_versoes'::regclass, array['id', 'tipo_operacao_id', 'organization_id']),
                     ('fk_title_settlements_imovel_rural', 'erp.title_settlements'::regclass, array['imovel_rural_id', 'organization_id'],
                      'erp.imoveis_rurais'::regclass, array['id', 'organization_id']),
                     ('fk_bank_movements_imovel_rural', 'erp.bank_movements'::regclass, array['imovel_rural_id', 'empresa_id', 'organization_id'],
                      'erp.imoveis_rurais'::regclass, array['id', 'empresa_id', 'organization_id']),
                     ('fk_bank_movements_tipo_operacao_versao', 'erp.bank_movements'::regclass, array['tipo_operacao_versao_id', 'tipo_operacao_id', 'organization_id'],
                      'erp.tipos_operacao_versoes'::regclass, array['id', 'tipo_operacao_id', 'organization_id']))
             e(nome, tabela, colunas, alvo, colunas_alvo)
        join pg_constraint c on c.conname = e.nome and c.conrelid = e.tabela and c.confrelid = e.alvo
       where c.contype = 'f' and c.confdeltype = 'a' and c.confupdtype = 'a' and c.convalidated
         and c.conkey = (select array_agg(a.attnum order by o.n) from unnest(e.colunas) with ordinality o(coluna, n)
                           join pg_attribute a on a.attrelid = e.tabela and a.attname = o.coluna)
         and c.confkey = (select array_agg(a.attnum order by o.n) from unnest(e.colunas_alvo) with ordinality o(coluna, n)
                            join pg_attribute a on a.attrelid = e.alvo and a.attname = o.coluna)) <> 11 then
    raise exception 'OPERACOES-01 F9: FKs novas ausentes ou fora da forma (colunas na ordem declarada, alvo certo, sem acao, validadas; esperadas 11).';
  end if;
  -- Os 12 CHECKs novos, por nome, na tabela certa; e o de situação do título EXATAMENTE com o 'previsto'.
  if (select count(*) from pg_constraint c
       where c.contype = 'c' and c.convalidated
         and ((c.conrelid = 'erp.imoveis_rurais'::regclass
               and c.conname in ('chk_imoveis_rurais_nome', 'chk_imoveis_rurais_cib', 'chk_imoveis_rurais_caepf', 'chk_imoveis_rurais_inscricao_estadual',
                                 'chk_imoveis_rurais_tipo_exploracao', 'chk_imoveis_rurais_participacao'))
           or (c.conrelid = 'erp.tipos_operacao_versao_financeiro'::regclass and c.conname = 'chk_tipos_operacao_versao_financeiro_algum')
           or (c.conrelid = 'erp.financial_titles'::regclass and c.conname in ('chk_financial_titles_tipo_operacao_par', 'chk_financial_titles_previsto'))
           or (c.conrelid = 'erp.bank_movements'::regclass and c.conname in ('chk_bank_movements_imovel_rural', 'chk_bank_movements_tipo_operacao_par'))
           or (c.conrelid = 'erp.financial_categories'::regclass and c.conname = 'chk_financial_categories_tipo_lcdpr'))) <> 12
     or (select pg_get_constraintdef(c.oid) from pg_constraint c
          where c.conrelid = 'erp.financial_titles'::regclass and c.conname = 'financial_titles_status_check' and c.contype = 'c')
        is distinct from 'CHECK ((status = ANY (ARRAY[''open''::text, ''partially_paid''::text, ''paid''::text, ''cancelled''::text, ''previsto''::text])))' then
    raise exception 'OPERACOES-01 F9: CHECKs novos incompletos (esperados 12: imovel rural, padroes da versao, par da TOP, previsto, imovel do movimento, tipo LCDPR) ou financial_titles_status_check sem previsto.';
  end if;
  -- Os sete índices novos: os únicos do imóvel (padrão e CIB) e os parciais onde declarados; o da empresa inteiro.
  if (select count(*) from pg_index i
       where (i.indexrelid in (to_regclass('erp.ux_imoveis_rurais_padrao'), to_regclass('erp.ux_imoveis_rurais_cib')) and i.indisunique and i.indpred is not null)
          or (i.indexrelid = to_regclass('erp.ix_imoveis_rurais_empresa') and not i.indisunique and i.indpred is null)
          or (i.indexrelid in (to_regclass('erp.idx_financial_titles_tipo_operacao'), to_regclass('erp.idx_financial_titles_previsto_origem'),
                               to_regclass('erp.idx_title_settlements_imovel_rural'), to_regclass('erp.idx_bank_movements_imovel_rural'))
              and not i.indisunique and i.indpred is not null)) <> 7 then
    raise exception 'OPERACOES-01 F9: indices novos ausentes ou fora da forma (ux_imoveis_rurais_padrao e ux_imoveis_rurais_cib unicos e parciais, ix_imoveis_rurais_empresa, e os parciais de tipo_operacao, previsto_origem, imovel_rural da baixa e do movimento; esperados 7).';
  end if;
  -- Gatilhos: o conjunto EXATO por tabela (os de hoje e os novos, nenhum outro), ligados, do tipo e na função certos.
  -- tgtype: 1 ROW (0 = por comando), 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE. Só a guarda do previsto
  -- tem WHEN.
  if (select count(*)
        from (values ('erp.financial_titles'::regclass, 'trg_ft_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure, false),
                     ('erp.financial_titles'::regclass, 'trg_ft_updated', 1 | 2 | 16, 'erp.set_updated_at()'::regprocedure, false),
                     ('erp.financial_titles'::regclass, 'trg_ft_previsto_guarda', 1 | 2 | 16, 'erp.financial_titles_previsto_guarda()'::regprocedure, true),
                     ('erp.imoveis_rurais'::regclass, 'trg_imoveis_rurais_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure, false),
                     ('erp.imoveis_rurais'::regclass, 'trg_imoveis_rurais_updated', 1 | 2 | 16, 'erp.set_updated_at()'::regprocedure, false),
                     ('erp.tipos_operacao_versao_financeiro'::regclass, 'trg_tovf_audit', 1 | 4, 'erp.audit_row()'::regprocedure, false),
                     ('erp.tipos_operacao_versao_financeiro'::regclass, 'trg_tovf_imutavel', 1 | 2 | 8 | 16, 'erp.tipos_operacao_versao_financeiro_imutavel()'::regprocedure, false),
                     ('erp.tipos_operacao_versao_financeiro'::regclass, 'trg_tovf_imutavel_truncate', 2 | 32, 'erp.tipos_operacao_versao_financeiro_imutavel()'::regprocedure, false))
             e(tabela, nome, tipo, funcao, com_when)
        join pg_trigger t on t.tgrelid = e.tabela and t.tgname = e.nome and t.tgtype = e.tipo and t.tgfoid = e.funcao
       where not t.tgisinternal and t.tgenabled = 'O' and cardinality(t.tgattr::int2[]) = 0 and (t.tgqual is not null) = e.com_when) <> 8
     or (select count(*) from pg_trigger t
          where not t.tgisinternal
            and t.tgrelid in ('erp.financial_titles'::regclass, 'erp.imoveis_rurais'::regclass, 'erp.tipos_operacao_versao_financeiro'::regclass)) <> 8 then
    raise exception 'OPERACOES-01 F9: gatilhos de financial_titles/imoveis_rurais/tipos_operacao_versao_financeiro ausentes, a mais, desligados, de outro tipo, com ou sem WHEN fora do esperado ou na funcao errada (esperados exatamente 8).';
  end if;
  -- As funções de gatilho novas: INVOKER, search_path fixo, e EXECUTE só do dono.
  if (select count(*) from pg_proc p
       where p.oid in ('erp.financial_titles_previsto_guarda()'::regprocedure, 'erp.tipos_operacao_versao_financeiro_imutavel()'::regprocedure)
         and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) <> 2
     or exists (select 1 from pg_proc p
                  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid in ('erp.financial_titles_previsto_guarda()'::regprocedure, 'erp.tipos_operacao_versao_financeiro_imutavel()'::regprocedure)
                   and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'OPERACOES-01 F9: funcoes de gatilho novas fora da forma (sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE so do dono).';
  end if;
  -- A baixa do previsto morre no banco, na soma B da 0042, e a API continua chamando a função.
  if position('previsto' in pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure)) = 0
     or position('sum(amount)' in pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure)) = 0
     or position('amount + discount' in pg_get_functiondef('erp.refresh_title_status(uuid)'::regprocedure)) > 0
     or not has_function_privilege('erp_app', 'erp.refresh_title_status(uuid)', 'execute') then
    raise exception 'OPERACOES-01 F9: erp.refresh_title_status sem a recusa do previsto, fora da semantica B (sum(amount), sem amount + discount) ou sem EXECUTE do erp_app.';
  end if;
  -- Privilégios do erp_app (um por chamada: com vários na mesma chamada, has_table_privilege responde "algum deles").
  if not has_table_privilege('erp_app', 'erp.imoveis_rurais', 'select')
     or not has_table_privilege('erp_app', 'erp.imoveis_rurais', 'insert')
     or not has_table_privilege('erp_app', 'erp.imoveis_rurais', 'update')
     or has_table_privilege('erp_app', 'erp.imoveis_rurais', 'delete')
     or has_table_privilege('erp_app', 'erp.imoveis_rurais', 'truncate')
     or not has_table_privilege('erp_app', 'erp.tipos_operacao_versao_financeiro', 'select')
     or not has_table_privilege('erp_app', 'erp.tipos_operacao_versao_financeiro', 'insert')
     or has_table_privilege('erp_app', 'erp.tipos_operacao_versao_financeiro', 'update')
     or has_table_privilege('erp_app', 'erp.tipos_operacao_versao_financeiro', 'delete')
     or has_table_privilege('erp_app', 'erp.tipos_operacao_versao_financeiro', 'truncate') then
    raise exception 'OPERACOES-01 F9: privilegios do erp_app errados (imoveis_rurais: select/insert/update sem delete/truncate; tipos_operacao_versao_financeiro: select/insert sem update/delete/truncate).';
  end if;
end $$;
