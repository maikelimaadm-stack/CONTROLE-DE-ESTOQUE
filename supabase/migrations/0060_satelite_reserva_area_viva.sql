-- =====================================================================
-- 0060 — HOTFIX-SAT-WORKER-01: reserva só aceita área viva no escopo do criador.
--
-- Causa em produção: erp.satelite_reservar_itens (0054) aceitava o item quando o
-- criador tinha acesso à EMPRESA, sem conferir que erp.areas ainda está viva e
-- visível sob o MESMO módulo. O executor Node (lerArea) exige deleted_at is null
-- + escopo → area_nao_encontrada em cascata, queimando a fila.
--
-- Forward-only. NÃO edita 0054. Trava (2026,94). lock_timeout 2s.
--
-- SSOT do módulo no banco: erp.modulo_satelite_executor() = 'pecuaria'
-- (espelha apps/api MODULO_EXECUTOR = moduloDaPermissao('analises_satelitais.create')).
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 94) then
    raise exception 'HOTFIX-SAT-WORKER-01: outra transacao ja detem a trava desta migration (2026,94). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

do $$
begin
  if to_regprocedure('erp.satelite_reservar_itens(integer,integer,integer,integer,integer)') is null then
    raise exception 'HOTFIX-SAT-WORKER-01: erp.satelite_reservar_itens ausente; aplique a 0054 antes.';
  end if;
  if to_regclass('erp.areas') is null then
    raise exception 'HOTFIX-SAT-WORKER-01: erp.areas ausente.';
  end if;
  if to_regprocedure('erp.modulo_satelite_executor()') is not null then
    raise exception 'HOTFIX-SAT-WORKER-01: a 0060 ja foi aplicada (modulo_satelite_executor ja existe).';
  end if;
end $$;

-- SSOT do módulo do executor satelital (banco). O Node deve espelhar via MODULO_EXECUTOR.
create function erp.modulo_satelite_executor() returns text
language sql immutable parallel safe as $$
  select 'pecuaria'::text
$$;

comment on function erp.modulo_satelite_executor() is
  'HOTFIX-SAT-WORKER-01: módulo de escopo do executor da fila satelital (pecuaria = o da área / analises_satelitais.create). SSOT no banco; o Node espelha em MODULO_EXECUTOR.';

revoke all on function erp.modulo_satelite_executor() from public;
grant execute on function erp.modulo_satelite_executor() to erp_app;

-- Diagnóstico seguro (sem geometria, sem PII): existe no tenant? deletada? visível no escopo do user/módulo?
create function erp.satelite_diagnosticar_area(
  p_organization_id uuid, p_area_id uuid, p_user_id uuid, p_modulo text default null
) returns table (
  area_existe_no_tenant boolean,
  area_deletada boolean,
  area_visivel_no_escopo boolean,
  empresa_id uuid,
  modulo_usado text
)
language plpgsql stable security definer set search_path = erp, pg_temp as $$
declare
  v_mod text := coalesce(nullif(p_modulo, ''), erp.modulo_satelite_executor());
  v_org_e text := current_setting('app.org_id', true);
  v_user_e text := current_setting('app.user_id', true);
  v_mod_e text := current_setting('app.modulo_empresa', true);
  v_emp uuid;
  v_del boolean;
  v_vis boolean;
begin
  select a.empresa_id, (a.deleted_at is not null)
    into v_emp, v_del
    from erp.areas a
   where a.organization_id = p_organization_id and a.id = p_area_id;
  if not found then
    area_existe_no_tenant := false;
    area_deletada := false;
    area_visivel_no_escopo := false;
    empresa_id := null;
    modulo_usado := v_mod;
    return next;
    return;
  end if;

  perform set_config('app.org_id', p_organization_id::text, true),
          set_config('app.user_id', p_user_id::text, true),
          set_config('app.modulo_empresa', v_mod, true);
  v_vis := coalesce(
    erp.tenant_visible(p_organization_id)
    and v_del is not true
    and (erp.escopo_empresa_total(v_mod) or v_emp in (select erp.empresas_do_membro(v_mod))),
    false);
  perform set_config('app.org_id', coalesce(v_org_e, ''), true),
          set_config('app.user_id', coalesce(v_user_e, ''), true),
          set_config('app.modulo_empresa', coalesce(v_mod_e, ''), true);

  area_existe_no_tenant := true;
  area_deletada := v_del;
  area_visivel_no_escopo := v_vis;
  empresa_id := v_emp;
  modulo_usado := v_mod;
  return next;
end $$;

comment on function erp.satelite_diagnosticar_area(uuid, uuid, uuid, text) is
  'HOTFIX-SAT-WORKER-01: diagnóstico da área para o executor (existe/deletada/visível). Sem geometria nem PII.';

revoke all on function erp.satelite_diagnosticar_area(uuid, uuid, uuid, text) from public;
grant execute on function erp.satelite_diagnosticar_area(uuid, uuid, uuid, text) to erp_app;

-- Substitui a reserva: mesmo contrato da 0054 + módulo SSOT + área viva no escopo.
create or replace function erp.satelite_reservar_itens(
  p_limite integer, p_max_simultaneas integer, p_max_minuto_conta integer, p_max_minuto_org integer, p_prazo_segundos integer)
  returns table (organization_id uuid, empresa_id uuid, consulta_id uuid, item_id uuid, criado_por uuid)
language plpgsql volatile security definer set search_path = erp, pg_temp as $$
#variable_conflict use_column
declare
  v_org_entrada text;
  v_user_entrada text;
  v_modulo_entrada text;
  v_modulo text := erp.modulo_satelite_executor();
  v_executando integer;
  v_minuto_ledger integer;
  v_minuto_org integer;
  v_reservados integer := 0;
  v_orgs_no_teto uuid[] := '{}';
  v_consultas_sem_acesso uuid[] := '{}';
  v_consultas_com_acesso uuid[] := '{}';
  v_acesso boolean;
  v_area_ok boolean;
  v_linhas integer;
  v_consulta_travada uuid;
  v_c record;
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'SAT-03: p_limite fora da faixa 1..50 (recebido: %).', coalesce(p_limite::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_simultaneas is null or p_max_simultaneas < 1 then
    raise exception 'SAT-03: p_max_simultaneas precisa ser >= 1 (recebido: %).', coalesce(p_max_simultaneas::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_minuto_conta is null or p_max_minuto_conta < 1 then
    raise exception 'SAT-03: p_max_minuto_conta precisa ser >= 1 (recebido: %).', coalesce(p_max_minuto_conta::text, 'nulo') using errcode = '22023';
  end if;
  if p_max_minuto_org is null or p_max_minuto_org < 1 then
    raise exception 'SAT-03: p_max_minuto_org precisa ser >= 1 (recebido: %).', coalesce(p_max_minuto_org::text, 'nulo') using errcode = '22023';
  end if;
  if p_prazo_segundos is null or p_prazo_segundos < 60 or p_prazo_segundos > 86400 then
    raise exception 'SAT-03: p_prazo_segundos fora da faixa 60..86400 (recebido: %).', coalesce(p_prazo_segundos::text, 'nulo') using errcode = '22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'SAT-03: erp.satelite_reservar_itens exige READ COMMITTED (a transacao esta em %).', current_setting('transaction_isolation') using errcode = '25000';
  end if;

  if not pg_try_advisory_xact_lock(2026, 88001) then
    return;
  end if;

  update erp.satelite_consulta_itens i
     set situacao = 'pendente', proxima_tentativa_em = null
   where i.situacao = 'executando'
     and i.id in (select v.id from erp.satelite_consulta_itens v
                   where v.situacao = 'executando' and (v.proxima_tentativa_em is null or v.proxima_tentativa_em < now())
                   for update skip locked);

  select count(*)::integer into v_executando from erp.satelite_consulta_itens x where x.situacao = 'executando';
  select count(*)::integer into v_minuto_ledger from erp.satelite_consumo s where s.created_at > now() - interval '60 seconds';

  v_org_entrada := current_setting('app.org_id', true);
  v_user_entrada := current_setting('app.user_id', true);
  v_modulo_entrada := current_setting('app.modulo_empresa', true);

  loop
    exit when v_reservados >= p_limite
           or v_executando >= p_max_simultaneas
           or v_minuto_ledger + v_executando >= p_max_minuto_conta;

    select i.id, i.organization_id, i.empresa_id, i.consulta_id, i.area_id, c.criado_por
      into v_c
      from erp.satelite_consulta_itens i
      join erp.satelite_consultas c
        on c.organization_id = i.organization_id and c.empresa_id = i.empresa_id and c.id = i.consulta_id
     where i.situacao = 'pendente'
       and (i.proxima_tentativa_em is null or i.proxima_tentativa_em <= now())
       and not (i.organization_id = any (v_orgs_no_teto))
       and not (i.consulta_id = any (v_consultas_sem_acesso))
     order by i.created_at, i.id
     limit 1
     for update of i skip locked;
    exit when not found;

    if not (v_c.consulta_id = any (v_consultas_com_acesso)) then
      perform set_config('app.org_id', v_c.organization_id::text, true),
              set_config('app.user_id', v_c.criado_por::text, true),
              set_config('app.modulo_empresa', v_modulo, true);
      v_acesso := coalesce(erp.tenant_visible(v_c.organization_id)
                           and exists (select 1 from erp.organizations o where o.id = v_c.organization_id and o.deleted_at is null)
                           and (erp.escopo_empresa_total(v_modulo)
                                or v_c.empresa_id in (select erp.empresas_do_membro(v_modulo))), false);
      perform set_config('app.org_id', coalesce(v_org_entrada, ''), true),
              set_config('app.user_id', coalesce(v_user_entrada, ''), true),
              set_config('app.modulo_empresa', coalesce(v_modulo_entrada, ''), true);
      if not v_acesso then
        select s.id into v_consulta_travada from erp.satelite_consultas s
         where s.id = v_c.consulta_id and s.organization_id = v_c.organization_id
         for update skip locked;
        if found then
          update erp.satelite_consulta_itens i
             set situacao = 'falho', erro = 'criador_sem_acesso', proxima_tentativa_em = null
           where i.situacao = 'pendente'
             and i.id in (select p.id from erp.satelite_consulta_itens p
                           where p.organization_id = v_c.organization_id and p.consulta_id = v_c.consulta_id and p.situacao = 'pendente'
                           for update skip locked);
          with contagem as (
            select count(*) filter (where x.situacao = 'concluido')::int as concluidos,
                   count(*) filter (where x.situacao = 'falho')::int as falhos,
                   count(*) filter (where x.situacao = 'reaproveitado')::int as reaproveitados,
                   count(*) filter (where x.situacao in ('pendente', 'executando'))::int as abertos,
                   count(*) filter (where x.tentativas > 0 or x.situacao in ('executando', 'concluido', 'falho'))::int as comecados
              from erp.satelite_consulta_itens x
             where x.consulta_id = v_c.consulta_id and x.organization_id = v_c.organization_id
          )
          update erp.satelite_consultas s
             set total_concluidos = k.concluidos, total_falhos = k.falhos, total_reaproveitados = k.reaproveitados,
                 situacao = case
                   when s.situacao = 'cancelada' then s.situacao
                   when k.abertos = 0 then case when k.falhos > 0 then 'concluida_com_falhas' else 'concluida' end
                   when k.comecados > 0 then 'executando'
                   else 'pendente' end,
                 concluida_em = case
                   when s.situacao = 'cancelada' then s.concluida_em
                   when k.abertos = 0 then coalesce(s.concluida_em, now())
                   else null end
            from contagem k
           where s.id = v_c.consulta_id and s.organization_id = v_c.organization_id;
          get diagnostics v_linhas = row_count;
          if v_linhas <> 1 then
            raise exception 'SAT-03: a consulta % travada pela reserva nao foi recalculada (% linhas); nada desta rodada foi gravado.', v_c.consulta_id, v_linhas;
          end if;
        end if;
        v_consultas_sem_acesso := v_consultas_sem_acesso || v_c.consulta_id;
        continue;
      end if;
      v_consultas_com_acesso := v_consultas_com_acesso || v_c.consulta_id;
    end if;

    -- HOTFIX: área viva + mesma empresa, no escopo do criador (GUCs do criador; definer vê a linha).
    perform set_config('app.org_id', v_c.organization_id::text, true),
            set_config('app.user_id', v_c.criado_por::text, true),
            set_config('app.modulo_empresa', v_modulo, true);
    select coalesce(
      exists (
        select 1 from erp.areas a
         where a.organization_id = v_c.organization_id
           and a.empresa_id = v_c.empresa_id
           and a.id = v_c.area_id
           and a.deleted_at is null
           and (erp.escopo_empresa_total(v_modulo)
                or a.empresa_id in (select erp.empresas_do_membro(v_modulo)))
      ), false)
      into v_area_ok;
    perform set_config('app.org_id', coalesce(v_org_entrada, ''), true),
            set_config('app.user_id', coalesce(v_user_entrada, ''), true),
            set_config('app.modulo_empresa', coalesce(v_modulo_entrada, ''), true);

    if not v_area_ok then
      -- Não reserva: marca este item como falho area_nao_encontrada (área excluída ou invisível).
      update erp.satelite_consulta_itens i
         set situacao = 'falho', erro = 'area_nao_encontrada', proxima_tentativa_em = null
       where i.id = v_c.id and i.situacao = 'pendente';
      get diagnostics v_linhas = row_count;
      if v_linhas = 1 then
        select s.id into v_consulta_travada from erp.satelite_consultas s
         where s.id = v_c.consulta_id and s.organization_id = v_c.organization_id
         for update skip locked;
        if found then
          with contagem as (
            select count(*) filter (where x.situacao = 'concluido')::int as concluidos,
                   count(*) filter (where x.situacao = 'falho')::int as falhos,
                   count(*) filter (where x.situacao = 'reaproveitado')::int as reaproveitados,
                   count(*) filter (where x.situacao in ('pendente', 'executando'))::int as abertos,
                   count(*) filter (where x.tentativas > 0 or x.situacao in ('executando', 'concluido', 'falho'))::int as comecados
              from erp.satelite_consulta_itens x
             where x.consulta_id = v_c.consulta_id and x.organization_id = v_c.organization_id
          )
          update erp.satelite_consultas s
             set total_concluidos = k.concluidos, total_falhos = k.falhos, total_reaproveitados = k.reaproveitados,
                 situacao = case
                   when s.situacao = 'cancelada' then s.situacao
                   when k.abertos = 0 then case when k.falhos > 0 then 'concluida_com_falhas' else 'concluida' end
                   when k.comecados > 0 then 'executando'
                   else 'pendente' end,
                 concluida_em = case
                   when s.situacao = 'cancelada' then s.concluida_em
                   when k.abertos = 0 then coalesce(s.concluida_em, now())
                   else null end
            from contagem k
           where s.id = v_c.consulta_id and s.organization_id = v_c.organization_id;
        end if;
      end if;
      continue;
    end if;

    select ((select count(*) from erp.satelite_consumo s
              where s.organization_id = v_c.organization_id and s.created_at > now() - interval '60 seconds')
          + (select count(*) from erp.satelite_consulta_itens x
              where x.organization_id = v_c.organization_id and x.situacao = 'executando'))::integer
      into v_minuto_org;
    if v_minuto_org >= p_max_minuto_org then
      v_orgs_no_teto := v_orgs_no_teto || v_c.organization_id;
      continue;
    end if;

    update erp.satelite_consulta_itens i
       set situacao = 'executando',
           tentativas = i.tentativas + 1,
           tentativas_rodada = i.tentativas_rodada + 1,
           proxima_tentativa_em = now() + p_prazo_segundos * interval '1 second'
     where i.id = v_c.id and i.situacao = 'pendente';
    get diagnostics v_linhas = row_count;
    if v_linhas <> 1 then
      raise exception 'SAT-03: o item % travado pela reserva nao foi marcado como executando (% linhas); nada desta rodada foi gravado.', v_c.id, v_linhas;
    end if;

    v_executando := v_executando + 1;
    v_reservados := v_reservados + 1;
    organization_id := v_c.organization_id;
    empresa_id := v_c.empresa_id;
    consulta_id := v_c.consulta_id;
    item_id := v_c.id;
    criado_por := v_c.criado_por;
    return next;
  end loop;
end $$;

comment on function erp.satelite_reservar_itens(integer, integer, integer, integer, integer) is
  'SAT-03 + HOTFIX-SAT-WORKER-01: reserva itens pendentes com acesso do criador no módulo erp.modulo_satelite_executor() e área viva (deleted_at null) no mesmo escopo. Sem isso o executor marcava area_nao_encontrada em cascata.';

do $$
begin
  if erp.modulo_satelite_executor() is distinct from 'pecuaria' then
    raise exception 'HOTFIX-SAT-WORKER-01: modulo_satelite_executor() deve ser pecuaria (veio %).', erp.modulo_satelite_executor();
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'erp' and p.proname = 'satelite_reservar_itens'
       and pg_get_functiondef(p.oid) like '%modulo_satelite_executor%'
       and pg_get_functiondef(p.oid) like '%deleted_at is null%'
  ) then
    raise exception 'HOTFIX-SAT-WORKER-01: satelite_reservar_itens nao usa modulo_satelite_executor/area viva.';
  end if;
end $$;
