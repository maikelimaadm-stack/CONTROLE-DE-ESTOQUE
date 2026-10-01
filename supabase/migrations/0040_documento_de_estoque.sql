-- =====================================================================
-- 0040 ESTOQUE-01 — DOCUMENTO DE ESTOQUE (ENTRADA, SAÍDA, TRANSFERÊNCIA E AJUSTE) — decisão 274
--
-- 1) erp.documentos_estoque: o cabeçalho do documento de estoque do Portal de Estoque, com quatro espécies
--    ('entrada', 'saida', 'transferencia', 'ajuste') numa tabela só — as famílias estoque.entrada, estoque.saida,
--    estoque.transferencia e estoque.ajuste são VARIANTES dela pela coluna `especie`, como as de compra são
--    variantes de erp.documentos_compra. Tabela PRÓPRIA (e não TOP nas tabelas antigas de estoque): as telas
--    antigas continuam como estão até uma fatia própria trocá-las, e o ledger (erp.stock_movements) nunca recebe
--    TOP — ele recebe o movimento, com source_type 'documentos_estoque' e source_id = id do documento.
--    TOP OBRIGATÓRIA desde o nascimento (NOT NULL, FKs compostas no desenho da 0036): não existe acervo a
--    preservar (zero documento de estoque por TOP em produção).
-- 2) erp.documentos_estoque_itens: os itens, com organização própria e FK composta de TRÊS colunas para o
--    cabeçalho (documento, organização, ESPÉCIE). A espécie copiada no item é o que deixa o CHECK por espécie
--    morar no banco: quantidade (> 0) na entrada, na saída e na transferência; quantidade contada (≥ 0) só no
--    ajuste — um ou outro, nunca os dois; custo unitário INFORMADO e obrigatório na entrada (nas outras espécies
--    a API o grava na confirmação, com o custo do movimento); saldo na confirmação e diferença só no ajuste, em
--    par, e a diferença é sempre contada − saldo. A FK garante que a cópia não diverge do cabeçalho.
-- 3) Situação: 'aberto' | 'confirmado' | 'cancelado'. Transições do banco (gatilho): aberto→confirmado,
--    aberto→cancelado, confirmado→cancelado; nada volta, e cancelado é final. Todo documento nasce aberto — o
--    saldo só muda na CONFIRMAÇÃO, nunca ao salvar.
--    CABEÇALHO CONGELADO fora do aberto: confirmado só muda para cancelado (situação, cancelado_em/por, motivo);
--    cancelado não muda mais nada. Organização, empresa, espécie, código, TOP e versão congelada NUNCA mudam
--    depois do INSERT (nem aberto). Carimbos de confirmação e de cancelamento em par com a situação (CHECK).
--    Item só nasce, muda ou sai com o documento ABERTO (gatilho, com FOR SHARE no cabeçalho: espera a
--    confirmação concorrente terminar em vez de ler o 'aberto' de antes dela). A confirmação grava o custo, o
--    saldo e a diferença dos itens ENQUANTO o cabeçalho ainda está aberto, e só depois vira a situação.
-- 4) A TOP precisa ser da família da espécie (estoque.<espécie>): o banco recusa a TOP de compra ou de venda
--    num documento de estoque, e a de uma espécie na outra.
-- 5) Armazém (e destino, só na transferência e diferente da origem): existentes, não excluídos e DA EMPRESA DO
--    DOCUMENTO — transferência entre empresas fica nas telas antigas. Ativo/inativo é conferência da API (o
--    armazém inativado depois do lançamento não pode travar o cancelamento). Produto do item: da organização
--    (FK composta), não excluído e com controle de estoque no lançamento; deixar de controlar depois é
--    conferido pela API na confirmação.
-- 6) RLS: cabeçalho com a política de empresa da 0015 (categoria A — empresa obrigatória; módulo estoque em
--    scripts/company-rls-modules.json); itens com `api_child` pela junção com o cabeçalho — que já passa pela
--    RLS dele, então o item HERDA o escopo de empresa do documento. erp.audit_row no cabeçalho. Sem DELETE
--    para erp_app (revoke explícito, como a 0036): documento se cancela, não se apaga.
-- 7) Numeração: chaves 'estoque_entrada', 'estoque_saida', 'estoque_transferencia' e 'estoque_ajuste' de
--    erp.next_code, que cria a linha na primeira chamada; unique (organization_id, especie, codigo) — o
--    discriminador está dentro da chave única.
-- 8) Ledger: NADA muda em erp.stock_movements nem em erp.stock_balances. Os movimentos usam tipos que já existem
--    no CHECK da 0003 (entrada 'entry'; saída 'writeoff'; transferência 'transfer_out' + 'transfer_in'; ajuste
--    'correction_in' / 'correction_out'; estorno 'reversal'), e a guarda da reserva (0035) já vale para
--    writeoff/transfer_out e, por desenho, não vale para correction_out.
-- 9) Funções de gatilho SECURITY DEFINER com `search_path = erp, pg_temp` (pg_temp por último, padrão da 0035 e
--    da 0038) e EXECUTE só do dono.
--
-- SEM BACKFILL: tabelas novas, vazias; nenhuma linha existente muda.
-- JANELA DE DEPLOY (pre-deploy, como a 0036): a API anterior não conhece as tabelas e não as lê; a nova só as
-- usa depois do banco. Ordem banco → API → web.
-- VOLTA: a API anterior convive com a 0040. Remover as tabelas só é possível sem documento gravado — é decisão
-- humana, com migration própria (dado de produção não se apaga).
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 74) then
    raise exception 'ESTOQUE-01: outra transacao ja detem a trava desta migration (2026,74). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
begin
  -- "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência.
  if to_regclass('erp.documentos_estoque') is not null or to_regclass('erp.documentos_estoque_itens') is not null then
    raise exception 'ESTOQUE-01: erp.documentos_estoque/erp.documentos_estoque_itens ja existe; a 0040 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.documentos_estoque_conferir()') is not null or to_regprocedure('erp.documentos_estoque_transicao()') is not null
     or to_regprocedure('erp.documentos_estoque_itens_documento_aberto()') is not null then
    raise exception 'ESTOQUE-01: funcoes do documento de estoque ja existem; a 0040 ja foi aplicada ou ha schema divergente.';
  end if;
  -- Antes de ler qualquer tabela: um papel sem bypass de RLS pararia adiante num erro de permissão genérico.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'ESTOQUE-01: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; as conferencias dos gatilhos nao veriam o cadastro da organizacao.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'ESTOQUE-01: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
  end if;
  -- A chave (id, organization_id) de armazéns é da 0036, e é o alvo das FKs compostas de origem e destino.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.warehouses'::regclass and c.conname = 'uq_warehouses_tenant' and c.contype = 'u'
                    and c.conkey = array[(select attnum from pg_attribute where attrelid = 'erp.warehouses'::regclass and attname = 'id'),
                                         (select attnum from pg_attribute where attrelid = 'erp.warehouses'::regclass and attname = 'organization_id')]::int2[]) then
    raise exception 'ESTOQUE-01: chave uq_warehouses_tenant (id, organization_id) de erp.warehouses ausente; a 0036 nao esta aplicada ou ha schema divergente.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'erp.products'::regclass and conname = 'uq_products_tenant' and contype = 'u') then
    raise exception 'ESTOQUE-01: chave uq_products_tenant (id, organization_id) de erp.products ausente (0029).';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conname = 'uq_tipos_operacao_versoes_tenant' and contype = 'u') then
    raise exception 'ESTOQUE-01: chave candidata da TOP ou da versao ausente (0020/0021).';
  end if;
  -- A FK de empresa é composta (organização, empresa): coluna única não prova tenant.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.empresas'::regclass and c.contype in ('u', 'p')
                    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'organization_id']) then
    raise exception 'ESTOQUE-01: chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa nao teria alvo.';
  end if;
  -- As colunas que os gatilhos leem: empresa e exclusão do armazém, controle de estoque e exclusão do produto,
  -- família da TOP.
  if (select count(*) from information_schema.columns
       where table_schema = 'erp'
         and ((table_name = 'warehouses' and column_name in ('empresa_id', 'deleted_at'))
           or (table_name = 'products' and column_name in ('control_stock', 'deleted_at'))
           or (table_name = 'tipos_operacao' and column_name = 'codigo_base'))) <> 5 then
    raise exception 'ESTOQUE-01: coluna lida pelos gatilhos ausente (warehouses.empresa_id/deleted_at, products.control_stock/deleted_at, tipos_operacao.codigo_base); a cadeia de migrations esta fora de ordem.';
  end if;
  if to_regprocedure('erp.audit_row()') is null or to_regprocedure('erp.tenant_visible(uuid)') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null then
    raise exception 'ESTOQUE-01: funcoes de auditoria/RLS (0001/0007/0015) ausentes.';
  end if;
  if not exists (select 1 from erp.modulos_escopo_empresa where chave = 'estoque') then
    raise exception 'ESTOQUE-01: modulo de escopo empresarial estoque ausente (0011).';
  end if;
end $$;

-- ---------- 3) cabeçalho ----------
create table erp.documentos_estoque (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  especie text not null constraint chk_documentos_estoque_especie check (especie in ('entrada','saida','transferencia','ajuste')),
  codigo text not null,
  situacao text not null default 'aberto' constraint chk_documentos_estoque_situacao check (situacao in ('aberto','confirmado','cancelado')),
  tipo_operacao_id uuid not null,
  tipo_operacao_versao_id uuid not null,
  armazem_id uuid not null,
  armazem_destino_id uuid,
  data_documento date not null,
  observacao text,
  criado_por uuid references erp.users(id),
  confirmado_em timestamptz,
  confirmado_por uuid references erp.users(id),
  cancelado_em timestamptz,
  cancelado_por uuid references erp.users(id),
  motivo_cancelamento text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint uq_documentos_estoque_codigo unique (organization_id, especie, codigo),
  constraint uq_documentos_estoque_tenant unique (id, organization_id),
  constraint uq_documentos_estoque_especie unique (id, organization_id, especie),
  constraint chk_documentos_estoque_destino check ((especie = 'transferencia') = (armazem_destino_id is not null)),
  constraint chk_documentos_estoque_destino_distinto check (armazem_destino_id is null or armazem_destino_id <> armazem_id),
  constraint chk_documentos_estoque_confirmacao check ((confirmado_em is null) = (confirmado_por is null)),
  constraint chk_documentos_estoque_cancelamento check ((situacao = 'cancelado') = (cancelado_em is not null)),
  constraint chk_documentos_estoque_confirmacao_situacao check ((situacao = 'aberto' and confirmado_em is null)
                                                             or (situacao = 'confirmado' and confirmado_em is not null)
                                                             or situacao = 'cancelado'),
  constraint chk_documentos_estoque_cancelamento_campos check (situacao = 'cancelado' or (cancelado_por is null and motivo_cancelamento is null)),
  constraint fk_documentos_estoque_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_documentos_estoque_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id),
  constraint fk_documentos_estoque_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id),
  constraint fk_documentos_estoque_armazem foreign key (armazem_id, organization_id) references erp.warehouses (id, organization_id),
  constraint fk_documentos_estoque_armazem_destino foreign key (armazem_destino_id, organization_id) references erp.warehouses (id, organization_id)
);

create index ix_documentos_estoque_situacao on erp.documentos_estoque (organization_id, especie, situacao);
create index ix_documentos_estoque_empresa on erp.documentos_estoque (organization_id, empresa_id, data_documento);
create index ix_documentos_estoque_tipo_operacao on erp.documentos_estoque (organization_id, tipo_operacao_id);
create index ix_documentos_estoque_armazem on erp.documentos_estoque (organization_id, armazem_id);
create index ix_documentos_estoque_armazem_destino on erp.documentos_estoque (organization_id, armazem_destino_id) where armazem_destino_id is not null;

comment on table erp.documentos_estoque is 'Documento de estoque do Portal de Estoque (ESTOQUE-01, decisão 274): entrada, saída, transferência e ajuste (inventário), variantes pela coluna especie (famílias estoque.<espécie>). Nasce aberto; o saldo só muda na confirmação.';
comment on column erp.documentos_estoque.id is 'Identidade técnica (UUID).';
comment on column erp.documentos_estoque.organization_id is 'Tenant (organização).';
comment on column erp.documentos_estoque.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo estoque; os armazéns são desta empresa.';
comment on column erp.documentos_estoque.especie is 'Espécie: entrada, saida, transferencia ou ajuste (inventário). Não muda depois do lançamento.';
comment on column erp.documentos_estoque.codigo is 'Código sequencial por espécie (next_code estoque_<espécie>); único na organização e espécie.';
comment on column erp.documentos_estoque.situacao is 'aberto, confirmado (o saldo mudou) ou cancelado (final). Transições conferidas por gatilho.';
comment on column erp.documentos_estoque.tipo_operacao_id is 'TOP do lançamento (obrigatória), da família estoque.<espécie>. Não muda.';
comment on column erp.documentos_estoque.tipo_operacao_versao_id is 'Versão EXATA da TOP congelada no lançamento (FK de três colunas). Não muda.';
comment on column erp.documentos_estoque.armazem_id is 'Armazém do documento (origem, na transferência): da empresa do documento, não excluído.';
comment on column erp.documentos_estoque.armazem_destino_id is 'Armazém de destino: só na transferência, diferente da origem, da mesma empresa do documento.';
comment on column erp.documentos_estoque.data_documento is 'Data do documento; é a data dos movimentos da confirmação e a do período conferido.';
comment on column erp.documentos_estoque.observacao is 'Observação livre (obrigatória quando a versão da TOP exige).';
comment on column erp.documentos_estoque.criado_por is 'Usuário que lançou.';
comment on column erp.documentos_estoque.confirmado_em is 'Momento da confirmação (em par com confirmado_por).';
comment on column erp.documentos_estoque.confirmado_por is 'Usuário que confirmou (em par com confirmado_em).';
comment on column erp.documentos_estoque.cancelado_em is 'Momento do cancelamento; preenchido se e somente se a situação é cancelado.';
comment on column erp.documentos_estoque.cancelado_por is 'Usuário que cancelou (só no cancelado).';
comment on column erp.documentos_estoque.motivo_cancelamento is 'Motivo do cancelamento (só no cancelado).';
comment on column erp.documentos_estoque.created_at is 'Criação do registro. Nome exigido pelo contrato do ID Global: o backfill lê created_at do registro fonte.';
comment on column erp.documentos_estoque.atualizado_em is 'Última alteração (gatilho).';

-- ---------- 4) itens ----------
create table erp.documentos_estoque_itens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id),
  documento_id uuid not null,
  especie text not null constraint chk_documentos_estoque_itens_especie check (especie in ('entrada','saida','transferencia','ajuste')),
  posicao integer not null constraint chk_documentos_estoque_itens_posicao check (posicao >= 0),
  produto_id uuid not null,
  lote text constraint chk_documentos_estoque_itens_lote check (lote is null or (btrim(lote) <> '' and lote = btrim(lote))),
  validade date,
  quantidade numeric(18,4) constraint chk_documentos_estoque_itens_quantidade check (quantidade is null or quantidade > 0),
  quantidade_contada numeric(18,4) constraint chk_documentos_estoque_itens_quantidade_contada check (quantidade_contada is null or quantidade_contada >= 0),
  custo_unitario numeric(18,6) constraint chk_documentos_estoque_itens_custo_unitario check (custo_unitario is null or custo_unitario >= 0),
  saldo_na_confirmacao numeric(18,4),
  diferenca numeric(18,4),
  observacao text,
  created_at timestamptz not null default now(),
  constraint uq_documentos_estoque_itens_posicao unique (documento_id, posicao),
  constraint chk_documentos_estoque_itens_quantidades check ((especie = 'ajuste' and quantidade is null and quantidade_contada is not null)
                                                          or (especie <> 'ajuste' and quantidade is not null and quantidade_contada is null)),
  constraint chk_documentos_estoque_itens_custo_entrada check (especie <> 'entrada' or custo_unitario is not null),
  constraint chk_documentos_estoque_itens_ajuste check (especie = 'ajuste' or (saldo_na_confirmacao is null and diferenca is null)),
  constraint chk_documentos_estoque_itens_diferenca check ((saldo_na_confirmacao is null) = (diferenca is null)
                                                        and (diferenca is null or diferenca = quantidade_contada - saldo_na_confirmacao)),
  constraint fk_documentos_estoque_itens_documento foreign key (documento_id, organization_id, especie) references erp.documentos_estoque (id, organization_id, especie),
  constraint fk_documentos_estoque_itens_produto foreign key (produto_id, organization_id) references erp.products (id, organization_id)
);

create index ix_documentos_estoque_itens_produto on erp.documentos_estoque_itens (organization_id, produto_id);

comment on table erp.documentos_estoque_itens is 'Itens do documento de estoque (ESTOQUE-01). Só mudam com o documento aberto (gatilho); a espécie copiada do cabeçalho (FK de três colunas) sustenta o CHECK por espécie.';
comment on column erp.documentos_estoque_itens.id is 'Identidade técnica (UUID).';
comment on column erp.documentos_estoque_itens.organization_id is 'Tenant (organização); igual ao do documento (FK composta).';
comment on column erp.documentos_estoque_itens.documento_id is 'Documento de estoque (FK composta com a organização e a espécie).';
comment on column erp.documentos_estoque_itens.especie is 'Cópia da espécie do documento (garantida pela FK composta); é o que deixa o CHECK por espécie no banco.';
comment on column erp.documentos_estoque_itens.posicao is 'Ordem do item no documento (≥ 0, única no documento).';
comment on column erp.documentos_estoque_itens.produto_id is 'Produto (FK composta com a organização); controla estoque e não está excluído no lançamento.';
comment on column erp.documentos_estoque_itens.lote is 'Lote do item; sem espaço nas pontas. Na saída e na transferência sem lote, a confirmação escolhe por validade.';
comment on column erp.documentos_estoque_itens.validade is 'Validade do lote.';
comment on column erp.documentos_estoque_itens.quantidade is 'Quantidade (> 0) na entrada, na saída e na transferência; nula no ajuste.';
comment on column erp.documentos_estoque_itens.quantidade_contada is 'Quantidade contada (≥ 0), só no ajuste (inventário).';
comment on column erp.documentos_estoque_itens.custo_unitario is 'Custo unitário (6 casas, precisão do ledger): informado e obrigatório na entrada; nas outras espécies, o custo do movimento gravado na confirmação.';
comment on column erp.documentos_estoque_itens.saldo_na_confirmacao is 'Saldo do balde (armazém × produto × lote) lido sob trava na confirmação do ajuste; só no ajuste.';
comment on column erp.documentos_estoque_itens.diferenca is 'Diferença do ajuste: quantidade contada − saldo na confirmação (CHECK); só no ajuste.';
comment on column erp.documentos_estoque_itens.observacao is 'Observação do item.';
comment on column erp.documentos_estoque_itens.created_at is 'Criação do registro.';

-- ---------- 5) gatilhos do cabeçalho ----------
-- 5.1 Conferência de TOP, armazéns e campos imutáveis. SECURITY DEFINER estreita: lê o cadastro da MESMA
-- organização da linha, devolve só a recusa, sem SQL dinâmico.
create function erp.documentos_estoque_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id or new.especie is distinct from old.especie
       or new.empresa_id is distinct from old.empresa_id or new.codigo is distinct from old.codigo then
      raise exception 'VALIDATION_ERROR: Organização, empresa, espécie e código do documento de estoque não mudam.' using errcode = 'P0001';
    end if;
    if new.tipo_operacao_id is distinct from old.tipo_operacao_id or new.tipo_operacao_versao_id is distinct from old.tipo_operacao_versao_id then
      raise exception 'VALIDATION_ERROR: O tipo de operação e a versão congelada do documento de estoque não mudam depois do lançamento.' using errcode = 'P0001';
    end if;
    -- Cancelado é final: nada muda (nem o motivo). O carimbo abaixo não conta como mudança.
    if old.situacao = 'cancelado' and (to_jsonb(new) - 'atualizado_em') is distinct from (to_jsonb(old) - 'atualizado_em') then
      raise exception 'CONFLICT: O documento de estoque está cancelado; o cancelamento é final.' using errcode = 'P0001';
    end if;
    -- Confirmado: só o cancelamento (situação, quem, quando e o motivo). Armazéns, data, observação e os carimbos
    -- da confirmação ficam como a confirmação os deixou.
    if old.situacao = 'confirmado'
       and (to_jsonb(new) - 'situacao' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'atualizado_em')
           is distinct from (to_jsonb(old) - 'situacao' - 'cancelado_em' - 'cancelado_por' - 'motivo_cancelamento' - 'atualizado_em') then
      raise exception 'CONFLICT: O documento de estoque está confirmado; só o cancelamento muda.' using errcode = 'P0001';
    end if;
    new.atualizado_em := now();
  end if;
  if tg_op = 'INSERT' then
    if new.situacao <> 'aberto' or new.confirmado_em is not null or new.confirmado_por is not null
       or new.cancelado_em is not null or new.cancelado_por is not null or new.motivo_cancelamento is not null then
      raise exception 'VALIDATION_ERROR: O documento de estoque nasce aberto; a confirmação e o cancelamento são transições.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from erp.tipos_operacao t where t.id = new.tipo_operacao_id and t.organization_id = new.organization_id
                    and t.codigo_base = 'estoque.' || new.especie) then
      raise exception 'VALIDATION_ERROR: O tipo de operação não é da família do documento (estoque.%).', new.especie using errcode = 'P0001';
    end if;
  end if;
  -- Armazéns da EMPRESA do documento (transferência entre empresas fica nas telas antigas), não excluídos.
  if tg_op = 'INSERT' or new.armazem_id is distinct from old.armazem_id then
    if not exists (select 1 from erp.warehouses w where w.id = new.armazem_id and w.organization_id = new.organization_id
                    and w.empresa_id = new.empresa_id and w.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O armazém precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  if new.armazem_destino_id is not null and (tg_op = 'INSERT' or new.armazem_destino_id is distinct from old.armazem_destino_id) then
    if not exists (select 1 from erp.warehouses w where w.id = new.armazem_destino_id and w.organization_id = new.organization_id
                    and w.empresa_id = new.empresa_id and w.deleted_at is null) then
      raise exception 'VALIDATION_ERROR: O armazém de destino precisa existir e ser da empresa do documento.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_estoque_conferir() is
  'ESTOQUE-01: TOP da família estoque.<especie>; armazém e destino da empresa do documento, não excluídos; organização/empresa/espécie/código/TOP/versão imutáveis; confirmado só se cancela; cancelado não muda; nasce aberto; carimba atualizado_em.';
create trigger trg_documentos_estoque_conferir
  before insert or update on erp.documentos_estoque
  for each row execute function erp.documentos_estoque_conferir();

-- 5.2 Transição de situação.
create function erp.documentos_estoque_transicao() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
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
    return new;
  end if;
  raise exception 'CONFLICT: Transição de situação inválida no documento de estoque (% para %).', old.situacao, new.situacao using errcode = 'P0001';
end $$;
comment on function erp.documentos_estoque_transicao() is
  'ESTOQUE-01: aberto→confirmado, aberto→cancelado, confirmado→cancelado; nada volta; cancelado é final.';
create trigger trg_documentos_estoque_transicao
  before update of situacao on erp.documentos_estoque
  for each row execute function erp.documentos_estoque_transicao();

create trigger trg_documentos_estoque_audit
  after insert or update or delete on erp.documentos_estoque
  for each row execute function erp.audit_row();

-- ---------- 6) gatilho dos itens: só com o documento aberto ----------
-- FOR SHARE no cabeçalho: se uma confirmação concorrente já travou o documento (FOR UPDATE / UPDATE de
-- situação), o item espera ela terminar e lê a situação NOVA — sem isso, entraria item em documento confirmado.
-- O UPDATE da confirmação (custo, saldo e diferença) acontece com o cabeçalho ainda aberto e passa por aqui.
create function erp.documentos_estoque_itens_documento_aberto() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_situacao text;
  v_id uuid;
  v_org uuid;
begin
  if tg_op = 'UPDATE' and (new.documento_id is distinct from old.documento_id or new.organization_id is distinct from old.organization_id
                           or new.especie is distinct from old.especie) then
    raise exception 'VALIDATION_ERROR: O item não muda de documento.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then v_id := old.documento_id; v_org := old.organization_id;
  else v_id := new.documento_id; v_org := new.organization_id; end if;
  select d.situacao into v_situacao
    from erp.documentos_estoque d where d.id = v_id and d.organization_id = v_org for share;
  if not found then
    raise exception 'NOT_FOUND: Documento de estoque não encontrado' using errcode = 'P0001';
  end if;
  if v_situacao <> 'aberto' then
    raise exception 'CONFLICT: Os itens só mudam com o documento de estoque aberto (situação: %).', v_situacao using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Produto que não controla estoque não tem saldo nem movimento: não entra em documento de estoque.
  if tg_op = 'INSERT' or new.produto_id is distinct from old.produto_id then
    if not exists (select 1 from erp.products p where p.id = new.produto_id and p.organization_id = new.organization_id
                    and p.deleted_at is null and p.control_stock) then
      raise exception 'VALIDATION_ERROR: O produto do item precisa existir e controlar estoque.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.documentos_estoque_itens_documento_aberto() is
  'ESTOQUE-01: item só nasce, muda ou sai com o documento de estoque aberto (FOR SHARE no cabeçalho); não muda de documento; produto não excluído e com controle de estoque.';
create trigger trg_documentos_estoque_itens_documento_aberto
  before insert or update or delete on erp.documentos_estoque_itens
  for each row execute function erp.documentos_estoque_itens_documento_aberto();

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
       and p.proname in ('documentos_estoque_conferir', 'documentos_estoque_transicao', 'documentos_estoque_itens_documento_aberto')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- ---------- 7) RLS e privilégios ----------
-- Cabeçalho: categoria A da 0015 (empresa obrigatória) — o MESMO gabarito inline (InitPlan + hashed SubPlan).
alter table erp.documentos_estoque enable row level security;
alter table erp.documentos_estoque force row level security;
create policy tenant_e_empresa on erp.documentos_estoque for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Itens: api_child pela junção com o cabeçalho. A subconsulta passa pela RLS do cabeçalho: o item herda o
-- escopo de empresa do documento, e a organização do item precisa ser a do documento.
alter table erp.documentos_estoque_itens enable row level security;
alter table erp.documentos_estoque_itens force row level security;
create policy api_child on erp.documentos_estoque_itens for all to erp_app
  using (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_estoque p where p.id = documentos_estoque_itens.documento_id and p.organization_id = documentos_estoque_itens.organization_id))
  with check (erp.tenant_visible(organization_id)
         and exists (select 1 from erp.documentos_estoque p where p.id = documentos_estoque_itens.documento_id and p.organization_id = documentos_estoque_itens.organization_id));

grant select, insert, update on erp.documentos_estoque, erp.documentos_estoque_itens to erp_app;
revoke delete, truncate on erp.documentos_estoque, erp.documentos_estoque_itens from erp_app;

-- ---------- 8) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
begin
  if to_regclass('erp.documentos_estoque') is null or to_regclass('erp.documentos_estoque_itens') is null then
    raise exception 'ESTOQUE-01: as tabelas do documento de estoque nao foram criadas.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname in ('documentos_estoque', 'documentos_estoque_itens')
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'ESTOQUE-01: tabela nova sem RLS habilitada e forcada.';
  end if;
  if (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_estoque') is distinct from array['tenant_e_empresa']
     or (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = 'documentos_estoque_itens') is distinct from array['api_child'] then
    raise exception 'ESTOQUE-01: politicas das tabelas novas diferentes de tenant_e_empresa (cabecalho) e api_child (itens).';
  end if;
  if (select count(*) from pg_constraint where contype = 'f' and confdeltype = 'a' and confupdtype = 'a'
        and conname in ('fk_documentos_estoque_empresa', 'fk_documentos_estoque_tipo_operacao', 'fk_documentos_estoque_tipo_operacao_versao',
                        'fk_documentos_estoque_armazem', 'fk_documentos_estoque_armazem_destino',
                        'fk_documentos_estoque_itens_documento', 'fk_documentos_estoque_itens_produto')
        and array_length(conkey, 1) >= 2) <> 7 then
    raise exception 'ESTOQUE-01: FKs compostas (sem cascata) incompletas (esperadas 7).';
  end if;
  -- A FK do item cobre a ESPÉCIE: é ela que impede a cópia de divergir do cabeçalho.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.documentos_estoque_itens'::regclass and c.conname = 'fk_documentos_estoque_itens_documento'
                    and c.confrelid = 'erp.documentos_estoque'::regclass and array_length(c.conkey, 1) = 3
                    and (select attnum from pg_attribute where attrelid = 'erp.documentos_estoque_itens'::regclass and attname = 'especie') = any (c.conkey)) then
    raise exception 'ESTOQUE-01: FK do item para o cabecalho sem a especie (documento, organizacao, especie).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_estoque'::regclass and conname like 'chk_documentos_estoque_%') <> 8 then
    raise exception 'ESTOQUE-01: CHECKs de erp.documentos_estoque incompletos (esperados 8).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c' and conrelid = 'erp.documentos_estoque_itens'::regclass and conname like 'chk_documentos_estoque_itens_%') <> 10 then
    raise exception 'ESTOQUE-01: CHECKs de erp.documentos_estoque_itens incompletos (esperados 10).';
  end if;
  if (select count(*) from pg_constraint where contype = 'u'
        and conname in ('uq_documentos_estoque_codigo', 'uq_documentos_estoque_tenant', 'uq_documentos_estoque_especie', 'uq_documentos_estoque_itens_posicao')) <> 4 then
    raise exception 'ESTOQUE-01: chaves unicas do documento de estoque incompletas (esperadas 4).';
  end if;
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and ((t.tgrelid = 'erp.documentos_estoque'::regclass and t.tgname in ('trg_documentos_estoque_conferir', 'trg_documentos_estoque_transicao', 'trg_documentos_estoque_audit'))
           or (t.tgrelid = 'erp.documentos_estoque_itens'::regclass and t.tgname = 'trg_documentos_estoque_itens_documento_aberto'))) <> 4 then
    raise exception 'ESTOQUE-01: gatilhos do documento de estoque ausentes ou desligados (esperados 4).';
  end if;
  -- Tipo dos gatilhos (tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE) e a função de cada um.
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_estoque_itens'::regclass
                    and t.tgname = 'trg_documentos_estoque_itens_documento_aberto'
                    and t.tgfoid = 'erp.documentos_estoque_itens_documento_aberto()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 4 | 8 | 16)) then
    raise exception 'ESTOQUE-01: gatilho do item nao e BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW com a funcao certa.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_estoque'::regclass
                    and t.tgname = 'trg_documentos_estoque_transicao'
                    and t.tgfoid = 'erp.documentos_estoque_transicao()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 16)
                    and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_estoque'::regclass and attname = 'situacao')]::int2[]) then
    raise exception 'ESTOQUE-01: gatilho de transicao nao e BEFORE UPDATE OF situacao FOR EACH ROW com a funcao certa.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_estoque'::regclass
                    and t.tgname = 'trg_documentos_estoque_conferir'
                    and t.tgfoid = 'erp.documentos_estoque_conferir()'::regprocedure
                    and (t.tgtype & 31) = (1 | 2 | 4 | 16) and cardinality(t.tgattr::int2[]) = 0) then
    raise exception 'ESTOQUE-01: gatilho de conferencia nao e BEFORE INSERT OR UPDATE FOR EACH ROW (todas as colunas) com a funcao certa.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'erp.documentos_estoque'::regclass
                    and t.tgname = 'trg_documentos_estoque_audit'
                    and t.tgfoid = 'erp.audit_row()'::regprocedure
                    and (t.tgtype & 31) = (1 | 4 | 8 | 16)) then
    raise exception 'ESTOQUE-01: gatilho de auditoria nao e AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW com erp.audit_row().';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('erp.documentos_estoque_conferir()'::regprocedure, 'erp.documentos_estoque_itens_documento_aberto()'::regprocedure)
         and p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) <> 2
     or not exists (select 1 from pg_proc p where p.oid = 'erp.documentos_estoque_transicao()'::regprocedure
                     and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'ESTOQUE-01: funcoes de conferencia/item sem SECURITY DEFINER, ou funcoes sem search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.documentos_estoque_conferir()'::regprocedure, 'erp.documentos_estoque_transicao()'::regprocedure,
                              'erp.documentos_estoque_itens_documento_aberto()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'ESTOQUE-01: EXECUTE das funcoes de gatilho ainda concedido alem do dono.';
  end if;
  if has_table_privilege('erp_app', 'erp.documentos_estoque', 'delete') or has_table_privilege('erp_app', 'erp.documentos_estoque_itens', 'delete')
     or has_table_privilege('erp_app', 'erp.documentos_estoque', 'truncate') or has_table_privilege('erp_app', 'erp.documentos_estoque_itens', 'truncate')
     or exists (select 1 from unnest(array['erp.documentos_estoque', 'erp.documentos_estoque_itens']) t(tabela)
                 cross join unnest(array['select', 'insert', 'update']) p(privilegio)
                 where not has_table_privilege('erp_app', t.tabela, p.privilegio)) then
    raise exception 'ESTOQUE-01: privilegios do erp_app errados (esperado select/insert/update, sem delete nem truncate).';
  end if;
end $$;
