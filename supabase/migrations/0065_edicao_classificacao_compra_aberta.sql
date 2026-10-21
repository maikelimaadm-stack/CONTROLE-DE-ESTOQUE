-- =====================================================================
-- 0065 EDITAR-02B — CLASSIFICAÇÃO E RATEIO EDITÁVEIS NA COMPRA ABERTA — decisão 324
--
-- A 0047 (OPERACOES-01 F7) congelou `tipo_titulo_id`, `classificacao_gasto` e `rateio_tipo` no UPDATE
-- (`documentos_compra_nota_guarda`) e tornou as linhas de `documentos_compra_rateio` imutáveis (sem UPDATE/DELETE).
-- A decisão 323 adia natureza/centro no Gerar compra do XML: a compra nasce ABERTA sem classificação. Sem destravar
-- a edição ABERTA, "classificar depois" era impossível de ponta a ponta.
--
-- Esta migration NÃO mexe em fato fiscal: chave, UF, tipo de documento, IPI, ICMS-ST, seguro, parcelas_nota, dfe_id e
-- solicitacao_compra_id continuam imutáveis depois do lançamento. Só libera, na compra `aberto`, a classificação
-- gerencial (tipo de título, CAPEX/OPEX, tipo de rateio) e a substituição das linhas do rateio por valor (DELETE +
-- INSERT, ainda só com cabeçalho aberto e `rateio_tipo = por_valor`).
--
-- Forward-only no sentido de que o gatilho novo é o contrato; a volta é redeploy da função antiga + revoke DELETE
-- (decisão humana). Trava (2026,99). lock_timeout 2s. Sem backfill, sem coluna nova.
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 99) then
    raise exception 'EDITAR-02B: outra transacao ja detem a trava desta migration (2026,99). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- pré-condições ----------
do $$
begin
  if to_regprocedure('erp.documentos_compra_nota_guarda()') is null then
    raise exception 'EDITAR-02B: erp.documentos_compra_nota_guarda() ausente; a 0047 precisa estar aplicada.';
  end if;
  if to_regprocedure('erp.documentos_compra_rateio_guarda()') is null then
    raise exception 'EDITAR-02B: erp.documentos_compra_rateio_guarda() ausente; a 0047 precisa estar aplicada.';
  end if;
  if to_regclass('erp.documentos_compra_rateio') is null then
    raise exception 'EDITAR-02B: erp.documentos_compra_rateio ausente; a 0047 precisa estar aplicada.';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('erp.documentos_compra') and a.attname = 'version' and not a.attisdropped) then
    raise exception 'EDITAR-02B: erp.documentos_compra.version ausente; a 0063 precisa estar aplicada.';
  end if;
end $$;

-- ---------- 1) nota_guarda: classificação gerencial editável na compra ABERTA ----------
create or replace function erp.documentos_compra_nota_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    -- Fato fiscal e vínculos de origem: imutáveis em qualquer situação.
    if (new.chave_acesso, new.uf_nota, new.tipo_documento_fiscal, new.valor_ipi, new.valor_icms_st, new.seguro,
        new.parcelas_nota, new.dfe_id, new.solicitacao_compra_id)
       is distinct from
       (old.chave_acesso, old.uf_nota, old.tipo_documento_fiscal, old.valor_ipi, old.valor_icms_st, old.seguro,
        old.parcelas_nota, old.dfe_id, old.solicitacao_compra_id) then
      raise exception 'VALIDATION_ERROR: Os dados fiscais da compra não mudam depois do lançamento.' using errcode = 'P0001';
    end if;
    -- Classificação gerencial (tipo de título, CAPEX/OPEX, rateio): só na compra ABERTA.
    if (new.tipo_titulo_id, new.classificacao_gasto, new.rateio_tipo)
       is distinct from
       (old.tipo_titulo_id, old.classificacao_gasto, old.rateio_tipo) then
      if new.especie is distinct from 'compra' or new.situacao is distinct from 'aberto' then
        raise exception 'VALIDATION_ERROR: Os dados fiscais da compra não mudam depois do lançamento.' using errcode = 'P0001';
      end if;
    end if;
    -- Tipo de título continua validado quando muda (INSERT já validava; UPDATE ABERTA também).
    if new.tipo_titulo_id is distinct from old.tipo_titulo_id and new.tipo_titulo_id is not null
       and not exists (select 1 from erp.title_types t
                        where t.id = new.tipo_titulo_id and (t.organization_id is null or t.organization_id = new.organization_id)) then
      raise exception 'VALIDATION_ERROR: Tipo de título inválido.' using errcode = 'P0001';
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
  'OPERACOES-01 F7 / EDITAR-02B (decisão 324): no INSERT, tipo de título, DF-e, solicitação e chave (trava nfe-chave 284). No UPDATE, fato fiscal (chave, UF, tipo, IPI, ICMS-ST, seguro, parcelas_nota, dfe_id, solicitacao) imutável; tipo_titulo_id, classificacao_gasto e rateio_tipo só mudam na compra ABERTA. SECURITY DEFINER estreita.';

-- ---------- 2) rateio_guarda: DELETE permitido na compra ABERTA (substituir linhas) ----------
create or replace function erp.documentos_compra_rateio_guarda() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
declare
  v_ok boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT: O rateio da compra não muda; cancele a compra e lance outra.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    select exists (
      select 1 from erp.documentos_compra c
       where c.id = old.documento_id and c.organization_id = old.organization_id
         and c.especie = 'compra' and c.situacao = 'aberto' and c.rateio_tipo = 'por_valor'
    ) into v_ok;
    if not v_ok then
      raise exception 'CONFLICT: O rateio da compra não muda; cancele a compra e lance outra.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'CONFLICT: O rateio da compra não muda; cancele a compra e lance outra.' using errcode = 'P0001';
  end if;
  -- INSERT: só compra aberta com rateio por valor (cabeçalho FOR SHARE).
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
  'OPERACOES-01 F7 / EDITAR-02B (decisão 324): INSERT só na compra ABERTA com rateio_tipo = por_valor (cabeçalho FOR SHARE); DELETE só na mesma condição (substituir linhas na edição ABERTA); UPDATE e TRUNCATE recusados. Invoker.';

-- ---------- 3) privilégio DELETE nas linhas do rateio (só a guarda decide) ----------
grant delete on erp.documentos_compra_rateio to erp_app;

-- ---------- pós-condições ----------
do $$
declare
  v_lista text[];
begin
  if not has_table_privilege('erp_app', 'erp.documentos_compra_rateio', 'DELETE') then
    raise exception 'EDITAR-02B: erp_app sem DELETE em documentos_compra_rateio.';
  end if;
  if not has_table_privilege('erp_app', 'erp.documentos_compra_rateio', 'INSERT')
     or not has_table_privilege('erp_app', 'erp.documentos_compra_rateio', 'SELECT') then
    raise exception 'EDITAR-02B: erp_app perdeu SELECT/INSERT em documentos_compra_rateio.';
  end if;
  if has_table_privilege('erp_app', 'erp.documentos_compra_rateio', 'UPDATE') then
    raise exception 'EDITAR-02B: erp_app não pode ter UPDATE em documentos_compra_rateio (substituir = DELETE+INSERT).';
  end if;
  select array_agg(p.proname order by p.proname) into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'erp' and p.proname in ('documentos_compra_nota_guarda', 'documentos_compra_rateio_guarda');
  if v_lista is distinct from array['documentos_compra_nota_guarda', 'documentos_compra_rateio_guarda'] then
    raise exception 'EDITAR-02B: funções esperadas ausentes: %', v_lista;
  end if;
end $$;
