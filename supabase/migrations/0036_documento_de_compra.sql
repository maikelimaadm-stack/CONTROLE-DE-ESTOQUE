-- =====================================================================
-- 0036 COMPRAS-01 — DOCUMENTO DE COMPRA (PEDIDO DE COMPRA E COMPRA) — decisão 267
--
-- 1) erp.documentos_compra: o cabeçalho do documento comercial de compra, com duas espécies ('pedido' e
--    'compra') numa tabela só — as famílias compras.pedido e compras.compra são VARIANTES dela pela coluna
--    `especie`, como as de venda são variantes de erp.sales_documents por `kind`. Tabela PRÓPRIA (e não mais
--    uma espécie de erp.sales_documents): parceiro, natureza financeira, sentido do estoque e do título são
--    outros, e misturar as duas faria toda consulta de venda carregar um filtro que um esquecimento anula.
--    TOP OBRIGATÓRIA desde o nascimento (NOT NULL, FKs compostas no desenho da 0021): não existe acervo de
--    compra sem TOP a preservar, então a janela anulável da venda não se repete aqui.
-- 2) erp.documentos_compra_itens: os itens, com organização própria e FK composta para o cabeçalho.
-- 3) Situação por espécie: 'aberto' | 'confirmado' | 'cancelado'; o pedido nunca é confirmado (CHECK) e as
--    transições são do banco (gatilho): aberto→confirmado (só compra), aberto→cancelado, confirmado→cancelado;
--    cancelado é final. Todo documento nasce aberto — a confirmação é que gera estoque e títulos.
--    Item só nasce, muda ou sai com o documento ABERTO (gatilho, com FOR SHARE no cabeçalho: espera a
--    confirmação concorrente terminar em vez de ler o 'aberto' de antes dela).
-- 4) Parceiros: fornecedor precisa ser parceiro Fornecedor (is_provider) vivo; transportadora, parceiro
--    Transportadora (is_transporter) vivo — padrão da 0029, conferido quando o ponteiro nasce ou muda.
--    A TOP precisa ser da família da espécie (compras.<espécie>): o banco recusa a TOP de venda na compra.
-- 5) Natureza e centro em PAR (padrão 0024); condição de pagamento com FK composta (0031); plano de parcelas
--    em jsonb e `parcelas_ajustadas` como na venda.
-- 6) Nota do fornecedor: única entre compras não canceladas por (organização, fornecedor, número, série), com a
--    série vazia valendo "1". Cancelar libera a nota. Número, série e data de entrada só existem na compra.
-- 7) Chave (id, organization_id) em erp.warehouses, para a FK composta do armazém do item (como a 0027 fez em
--    erp.people). O armazém do item precisa ser da empresa do documento (gatilho do item).
--    FORMA DE PAGAMENTO: erp.payment_methods tem linhas GLOBAIS (organization_id nulo, semeadas para todas as
--    organizações). Uma FK composta (id, organization_id) recusaria justamente elas. A FK é simples (prova que
--    existe) e o gatilho do cabeçalho confere o tenant: global OU da organização do documento.
-- 8) RLS: cabeçalho com a política de empresa da 0015 (categoria A — empresa obrigatória; módulo compras em
--    scripts/company-rls-modules.json); itens com `api_child` pela junção com o cabeçalho — que já passa pela
--    RLS dele, então o item HERDA o escopo de empresa do documento. erp.audit_row no cabeçalho. Sem DELETE
--    para erp_app (revoke explícito, como a 0031): documento se cancela, não se apaga.
-- 9) Numeração: chaves 'compras_pedido' e 'compras_compra' de erp.next_code, que cria a linha na primeira
--    chamada; unique (organization_id, especie, codigo) — o discriminador está dentro da chave única.
--
-- SEM BACKFILL: tabelas novas, vazias; a chave nova em armazéns não muda dado.
-- JANELA DE DEPLOY: a API anterior não conhece as tabelas.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 70) then
    raise exception 'COMPRAS-01: outra transacao ja detem a trava desta migration (2026,70). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'tipos_operacao_versoes' and column_name = 'reserva_estoque') then
    raise exception 'COMPRAS-01: a 0035 nao esta aplicada (tipos_operacao_versoes.reserva_estoque ausente); aplique a 0035 antes.';
  end if;
  if to_regclass('erp.documentos_compra') is not null or to_regclass('erp.documentos_compra_itens') is not null then
    raise exception 'COMPRAS-01: erp.documentos_compra/erp.documentos_compra_itens ja existe; a 0036 ja foi aplicada ou ha schema divergente.';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_versoes_tenant' and contype = 'u') then
    raise exception 'COMPRAS-01: chave candidata da TOP ou da versao ausente (0020/0021).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_people_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_products_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_financial_categories_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_cost_centers_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_condicoes_pagamento_tenant' and contype = 'u') then
    raise exception 'COMPRAS-01: chave (id, organization_id) ausente em pessoas/produtos/naturezas/centros/condicoes (0024/0027/0029/0031).';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'erp' and table_name = 'warehouses' and column_name = 'empresa_id') then
    raise exception 'COMPRAS-01: erp.warehouses.empresa_id ausente; a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('erp.audit_row()') is null or to_regprocedure('erp.tenant_visible(uuid)') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'COMPRAS-01: funcoes de auditoria/RLS (0001/0007/0015) ausentes.';
  end if;
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'compras') then
    raise exception 'COMPRAS-01: modulo de escopo empresarial compras ausente (0011).';
  end if;
end $$;

-- ---------- 3) chave (id, organization_id) em armazéns, se faltar ----------
do $$
begin
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.warehouses'::regclass and c.contype in ('u', 'p')
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.warehouses'::regclass and attname = 'id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.warehouses'::regclass and attname = 'organization_id')]::int2[]) then
    alter table erp.warehouses add constraint uq_warehouses_tenant unique (id, organization_id);
  end if;
end $$;

-- ---------- 4) cabeçalho ----------
create table erp.documentos_compra (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  especie text not null constraint chk_documentos_compra_especie check (especie in ('pedido','compra')),
  codigo text not null,
  situacao text not null default 'aberto' constraint chk_documentos_compra_situacao check (situacao in ('aberto','confirmado','cancelado')),
  tipo_operacao_id uuid not null,
  tipo_operacao_versao_id uuid not null,
  fornecedor_id uuid not null,
  transportadora_id uuid,
  data_documento date not null,
  data_entrada date,
  data_vencimento date,
  numero_nota text,
  serie_nota text,
  categoria_financeira_id uuid,
  centro_custo_id uuid,
  condicao_pagamento_id uuid,
  parcelas_ajustadas boolean not null default false,
  plano_parcelas jsonb,
  forma_pagamento_id uuid references erp.payment_methods(id),
  valor_itens numeric(18,2) not null default 0 constraint chk_documentos_compra_valor_itens check (valor_itens >= 0),
  frete numeric(18,2) not null default 0 constraint chk_documentos_compra_frete check (frete >= 0),
  outras_despesas numeric(18,2) not null default 0 constraint chk_documentos_compra_outras_despesas check (outras_despesas >= 0),
  desconto numeric(18,2) not null default 0 constraint chk_documentos_compra_desconto check (desconto >= 0),
  valor_total numeric(18,2) not null default 0 constraint chk_documentos_compra_valor_total check (valor_total >= 0),
  observacao text,
  criado_por uuid references erp.users(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (organization_id, especie, codigo),
  constraint uq_documentos_compra_tenant unique (id, organization_id),
  constraint chk_documentos_compra_situacao_especie check (especie = 'compra' or situacao in ('aberto','cancelado')),
  constraint chk_documentos_compra_campos_da_compra check (especie = 'compra' or (data_entrada is null and numero_nota is null and serie_nota is null)),
  constraint chk_documentos_compra_nota check ((numero_nota is null or btrim(numero_nota) <> '') and (serie_nota is null or numero_nota is not null)),
  constraint chk_documentos_compra_classificacao_par check ((categoria_financeira_id is null) = (centro_custo_id is null)),
  constraint chk_documentos_compra_plano check (plano_parcelas is null or jsonb_typeof(plano_parcelas) in ('object','array')),
  constraint fk_documentos_compra_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_documentos_compra_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id),
  constraint fk_documentos_compra_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id),
  constraint fk_documentos_compra_fornecedor foreign key (fornecedor_id, organization_id) references erp.people (id, organization_id),
  constraint fk_documentos_compra_transportadora foreign key (transportadora_id, organization_id) references erp.people (id, organization_id),
  constraint fk_documentos_compra_categoria_financeira foreign key (categoria_financeira_id, organization_id) references erp.financial_categories (id, organization_id),
  constraint fk_documentos_compra_centro_custo foreign key (centro_custo_id, organization_id) references erp.cost_centers (id, organization_id),
  constraint fk_documentos_compra_condicao_pagamento foreign key (condicao_pagamento_id, organization_id) references erp.condicoes_pagamento (id, organization_id)
);

create index ix_documentos_compra_situacao on erp.documentos_compra (organization_id, especie, situacao);
create index ix_documentos_compra_empresa on erp.documentos_compra (organization_id, empresa_id, data_documento);
create index ix_documentos_compra_fornecedor on erp.documentos_compra (organization_id, fornecedor_id);
create index ix_documentos_compra_tipo_operacao on erp.documentos_compra (organization_id, tipo_operacao_id);
-- Nota do fornecedor: única entre compras VIVAS; série vazia/nula vale "1". Cancelar a compra libera a nota.
create unique index ux_documentos_compra_nota on erp.documentos_compra
  (organization_id, fornecedor_id, numero_nota, coalesce(nullif(serie_nota, ''), '1'))
  where especie = 'compra' and situacao <> 'cancelado' and numero_nota is not null;

comment on table erp.documentos_compra is 'Documento comercial de compra (COMPRAS-01, decisão 267): pedido de compra e compra, variantes pela coluna especie (famílias compras.pedido e compras.compra). A compra confirmada dá entrada no estoque e gera os títulos a pagar.';
comment on column erp.documentos_compra.id is 'Identidade técnica (UUID).';
comment on column erp.documentos_compra.organization_id is 'Tenant (organização).';
comment on column erp.documentos_compra.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo compras.';
comment on column erp.documentos_compra.especie is 'Espécie: pedido (pedido de compra) ou compra.';
comment on column erp.documentos_compra.codigo is 'Código sequencial por espécie (next_code compras_pedido / compras_compra); único na organização e espécie.';
comment on column erp.documentos_compra.situacao is 'aberto, confirmado (só compra) ou cancelado (final). Transições conferidas por gatilho.';
comment on column erp.documentos_compra.tipo_operacao_id is 'TOP do lançamento (obrigatória), da família compras.<espécie>.';
comment on column erp.documentos_compra.tipo_operacao_versao_id is 'Versão EXATA da TOP congelada no lançamento (FK de três colunas).';
comment on column erp.documentos_compra.fornecedor_id is 'Fornecedor: parceiro do tipo Fornecedor, vivo, da mesma organização.';
comment on column erp.documentos_compra.transportadora_id is 'Transportadora (opcional): parceiro do tipo Transportadora, vivo, da mesma organização.';
comment on column erp.documentos_compra.data_documento is 'Data do documento.';
comment on column erp.documentos_compra.data_entrada is 'Data de entrada no estoque (só compra); sem ela, a entrada usa a data do documento.';
comment on column erp.documentos_compra.data_vencimento is 'Vencimento do título quando não há condição de pagamento.';
comment on column erp.documentos_compra.numero_nota is 'Número da nota do fornecedor (só compra).';
comment on column erp.documentos_compra.serie_nota is 'Série da nota do fornecedor (só compra); vazia vale "1" na unicidade.';
comment on column erp.documentos_compra.categoria_financeira_id is 'Natureza de despesa dos títulos a pagar. Anda em PAR com centro_custo_id.';
comment on column erp.documentos_compra.centro_custo_id is 'Centro de custo dos títulos a pagar. Anda em PAR com categoria_financeira_id.';
comment on column erp.documentos_compra.condicao_pagamento_id is 'Condição de pagamento (FK composta com a organização).';
comment on column erp.documentos_compra.parcelas_ajustadas is 'O plano de parcelas gravado veio do corpo (ajustado à mão), não gerado pela condição.';
comment on column erp.documentos_compra.plano_parcelas is 'Plano de parcelas gravado no lançamento (jsonb).';
comment on column erp.documentos_compra.forma_pagamento_id is 'Forma de pagamento: global ou da organização do documento (conferido por gatilho).';
comment on column erp.documentos_compra.valor_itens is 'Soma dos totais dos itens.';
comment on column erp.documentos_compra.frete is 'Frete (entra no custo de entrada).';
comment on column erp.documentos_compra.outras_despesas is 'Outras despesas (entram no custo de entrada).';
comment on column erp.documentos_compra.desconto is 'Desconto do documento (sai do custo de entrada).';
comment on column erp.documentos_compra.valor_total is 'Total: itens + frete + outras despesas − desconto.';
comment on column erp.documentos_compra.observacao is 'Observação livre.';
comment on column erp.documentos_compra.criado_por is 'Usuário que lançou.';
comment on column erp.documentos_compra.criado_em is 'Criação do registro.';
comment on column erp.documentos_compra.atualizado_em is 'Última alteração (gatilho).';

-- ---------- 5) itens ----------
create table erp.documentos_compra_itens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  documento_id uuid not null,
  produto_id uuid not null,
  armazem_id uuid,
  quantidade numeric(18,4) not null constraint chk_documentos_compra_itens_quantidade check (quantidade > 0),
  valor_unitario numeric(18,4) not null default 0 constraint chk_documentos_compra_itens_valor_unitario check (valor_unitario >= 0),
  desconto numeric(18,2) not null default 0 constraint chk_documentos_compra_itens_desconto check (desconto >= 0),
  desconto_percentual numeric(9,4) not null default 0 constraint chk_documentos_compra_itens_desconto_percentual check (desconto_percentual >= 0),
  valor_total numeric(18,2) not null default 0 constraint chk_documentos_compra_itens_valor_total check (valor_total >= 0),
  lote text,
  validade date,
  observacao text,
  posicao int not null,
  constraint fk_documentos_compra_itens_documento foreign key (documento_id, organization_id) references erp.documentos_compra (id, organization_id),
  constraint fk_documentos_compra_itens_produto foreign key (produto_id, organization_id) references erp.products (id, organization_id),
  constraint fk_documentos_compra_itens_armazem foreign key (armazem_id, organization_id) references erp.warehouses (id, organization_id)
);
create index ix_documentos_compra_itens_documento on erp.documentos_compra_itens (documento_id, posicao);
create index ix_documentos_compra_itens_produto on erp.documentos_compra_itens (organization_id, produto_id);

comment on table erp.documentos_compra_itens is 'Itens do documento de compra (COMPRAS-01). Só mudam com o documento aberto (gatilho).';
comment on column erp.documentos_compra_itens.id is 'Identidade técnica (UUID).';
comment on column erp.documentos_compra_itens.organization_id is 'Tenant (organização); igual ao do documento (FK composta).';
comment on column erp.documentos_compra_itens.documento_id is 'Documento de compra (FK composta com a organização).';
comment on column erp.documentos_compra_itens.produto_id is 'Produto (FK composta com a organização).';
comment on column erp.documentos_compra_itens.armazem_id is 'Armazém de entrada (da empresa do documento); nulo para produto sem controle de estoque.';
comment on column erp.documentos_compra_itens.quantidade is 'Quantidade (> 0).';
comment on column erp.documentos_compra_itens.valor_unitario is 'Valor unitário.';
comment on column erp.documentos_compra_itens.desconto is 'Desconto em valor do item.';
comment on column erp.documentos_compra_itens.desconto_percentual is 'Desconto percentual do item.';
comment on column erp.documentos_compra_itens.valor_total is 'Total do item (quantidade × unitário − descontos).';
comment on column erp.documentos_compra_itens.lote is 'Lote do fornecedor (só compra).';
comment on column erp.documentos_compra_itens.validade is 'Validade do lote (só compra).';
comment on column erp.documentos_compra_itens.observacao is 'Observação do item.';
comment on column erp.documentos_compra_itens.posicao is 'Ordem do item no documento.';

-- ---------- 6) gatilhos do cabeçalho ----------
-- 6.1 Conferência de parceiros, TOP, forma de pagamento e campos imutáveis. SECURITY DEFINER estreita: lê o
-- cadastro da MESMA organização da linha, devolve só a recusa, sem SQL dinâmico.
create or replace function erp.documentos_compra_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.especie is distinct from old.especie
       or new.empresa_id is distinct from old.empresa_id or new.codigo is distinct from old.codigo then
      raise exception 'VALIDATION_ERROR: Organização, empresa, espécie e código do documento de compra não mudam.' using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  if tg_op = 'INSERT' and new.situacao <> 'aberto' then
    raise exception 'VALIDATION_ERROR: O documento de compra nasce aberto; a confirmação e o cancelamento são transições.' using errcode = 'P0001';
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
  if tg_op = 'INSERT' or new.tipo_operacao_id is distinct from old.tipo_operacao_id then
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
comment on function erp.documentos_compra_conferir() is
  'COMPRAS-01: fornecedor is_provider, transportadora is_transporter (vivos, da organização), TOP da família compras.<especie>, forma de pagamento global ou da organização; organização/empresa/espécie/código imutáveis; nasce aberto; carimba atualizado_em.';
create trigger trg_documentos_compra_conferir
  before insert or update on erp.documentos_compra
  for each row execute function erp.documentos_compra_conferir();

-- 6.2 Transição de situação.
create or replace function erp.documentos_compra_transicao() returns trigger
language plpgsql set search_path = erp, pg_catalog as $$
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
  if new.situacao = 'cancelado' and old.situacao in ('aberto', 'confirmado') then
    return new;
  end if;
  raise exception 'CONFLICT: Transição de situação inválida no documento de compra (% para %).', old.situacao, new.situacao using errcode = 'P0001';
end $$;
comment on function erp.documentos_compra_transicao() is
  'COMPRAS-01: aberto→confirmado (só compra), aberto→cancelado, confirmado→cancelado; cancelado é final.';
create trigger trg_documentos_compra_transicao
  before update of situacao on erp.documentos_compra
  for each row execute function erp.documentos_compra_transicao();

create trigger trg_documentos_compra_audit
  after insert or update or delete on erp.documentos_compra
  for each row execute function erp.audit_row();

-- ---------- 7) gatilho dos itens: só com o documento aberto ----------
-- FOR SHARE no cabeçalho: se uma confirmação concorrente já travou o documento (FOR UPDATE / UPDATE de
-- situação), o item espera ela terminar e lê a situação NOVA — sem isso, entraria item em compra confirmada.
create or replace function erp.documentos_compra_itens_documento_aberto() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
declare
  v_doc record;
  v_ids uuid[];
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
      raise exception 'VALIDATION_ERROR: O armazém do item precisa ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_itens_documento_aberto() is
  'COMPRAS-01: item só nasce, muda ou sai com o documento de compra aberto; pedido sem lote/validade; armazém da empresa do documento.';
create trigger trg_documentos_compra_itens_documento_aberto
  before insert or update or delete on erp.documentos_compra_itens
  for each row execute function erp.documentos_compra_itens_documento_aberto();

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
       and p.proname in ('documentos_compra_conferir', 'documentos_compra_transicao', 'documentos_compra_itens_documento_aberto')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 8) RLS e privilégios ----------
-- Cabeçalho: categoria A da 0015 (empresa obrigatória) — o MESMO gabarito inline (InitPlan + hashed SubPlan).
alter table erp.documentos_compra enable row level security;
alter table erp.documentos_compra force row level security;
create policy tenant_e_empresa on erp.documentos_compra for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Itens: api_child pela junção com o cabeçalho. A subconsulta passa pela RLS do cabeçalho: o item herda o
-- escopo de empresa do documento, e a organização do item precisa ser a do documento.
alter table erp.documentos_compra_itens enable row level security;
alter table erp.documentos_compra_itens force row level security;
create policy api_child on erp.documentos_compra_itens for all to erp_app
  using (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_compra p where p.id = documentos_compra_itens.documento_id and p.organization_id = documentos_compra_itens.organization_id))
  with check (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_compra p where p.id = documentos_compra_itens.documento_id and p.organization_id = documentos_compra_itens.organization_id));

grant select, insert, update on erp.documentos_compra, erp.documentos_compra_itens to erp_app;
revoke delete, truncate on erp.documentos_compra, erp.documentos_compra_itens from erp_app;

-- ---------- 9) pós-condições nomeadas ----------
do $$
begin
  if to_regclass('erp.documentos_compra') is null or to_regclass('erp.documentos_compra_itens') is null then
    raise exception 'COMPRAS-01: as tabelas do documento de compra nao foram criadas.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname in ('documentos_compra', 'documentos_compra_itens')
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'COMPRAS-01: tabela nova sem RLS habilitada e forcada.';
  end if;
  if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_compra') is distinct from array['tenant_e_empresa']
     or (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_compra_itens') is distinct from array['api_child'] then
    raise exception 'COMPRAS-01: politicas das tabelas novas diferentes de tenant_e_empresa (cabecalho) e api_child (itens).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_warehouses_tenant' and contype = 'u')
     and not exists (select 1 from pg_constraint c where c.conrelid = 'erp.warehouses'::regclass and c.contype = 'u' and array_length(c.conkey, 1) = 2) then
    raise exception 'COMPRAS-01: chave (id, organization_id) de erp.warehouses ausente.';
  end if;
  if (select count(*) from pg_constraint where contype = 'f' and confdeltype = 'a' and confupdtype = 'a'
        and conname in ('fk_documentos_compra_empresa', 'fk_documentos_compra_tipo_operacao', 'fk_documentos_compra_tipo_operacao_versao',
                        'fk_documentos_compra_fornecedor', 'fk_documentos_compra_transportadora', 'fk_documentos_compra_categoria_financeira',
                        'fk_documentos_compra_centro_custo', 'fk_documentos_compra_condicao_pagamento', 'fk_documentos_compra_itens_documento',
                        'fk_documentos_compra_itens_produto', 'fk_documentos_compra_itens_armazem')
        and array_length(conkey, 1) >= 2) <> 11 then
    raise exception 'COMPRAS-01: FKs compostas (sem cascata) incompletas (esperadas 11).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_compra'::regclass and conname like 'chk_documentos_compra_%') <> 12 then
    raise exception 'COMPRAS-01: CHECKs de erp.documentos_compra incompletos (esperados 12).';
  end if;
  if to_regclass('erp.ux_documentos_compra_nota') is null then
    raise exception 'COMPRAS-01: indice unico parcial da nota ausente.';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and ((t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname in ('trg_documentos_compra_conferir', 'trg_documentos_compra_transicao', 'trg_documentos_compra_audit'))
           or (t.tgrelid = 'erp.documentos_compra_itens'::regclass and t.tgname = 'trg_documentos_compra_itens_documento_aberto'))) <> 4 then
    raise exception 'COMPRAS-01: gatilhos do documento de compra ausentes ou desligados (esperados 4).';
  end if;
  if exists (select 1 from pg_roles where rolname = 'erp_app')
     and (has_table_privilege('erp_app', 'erp.documentos_compra', 'delete') or has_table_privilege('erp_app', 'erp.documentos_compra_itens', 'delete')
          or exists (select 1 from unnest(array['erp.documentos_compra', 'erp.documentos_compra_itens']) t(tabela)
                      cross join unnest(array['select', 'insert', 'update']) p(privilegio)
                      where not has_table_privilege('erp_app', t.tabela, p.privilegio))) then
    raise exception 'COMPRAS-01: privilegios do erp_app errados (esperado select/insert/update, sem delete).';
  end if;
end $$;
