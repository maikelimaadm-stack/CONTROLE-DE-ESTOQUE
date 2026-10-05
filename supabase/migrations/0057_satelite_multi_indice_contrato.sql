-- =====================================================================
-- 0057 — SAT-08 R1 (decisão 300): correção forward-only do contrato multi-índice.
--
-- A 0056 permanece IMUTÁVEL. Esta migration:
--   1) amplia `versao_metodo` / coerência bundle×versão para `pastagem-essencial-v2`
--      (histórico v1 continua aceito);
--   2) substitui o CHECK genérico de faixa [-1,1] por faixas POR ÍNDICE
--      (EVI2 persistível até 2,5 — a fórmula pode ultrapassar +1);
--   3) NÃO apaga, atualiza nem recria tabelas; RLS/FKs intactos;
--   4) zero UPDATE/DELETE de análises.
--
-- Trava (2026,91). lock_timeout 2s. Forward-only em produção.
-- =====================================================================

do $$
begin
  if not pg_try_advisory_xact_lock(2026, 91) then
    raise exception 'SAT-08 R1: outra transacao ja detem a trava desta migration (2026,91). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) preflight ----------
do $$
begin
  if to_regclass('erp.analises_satelitais_ext') is null then
    raise exception 'SAT-08 R1: erp.analises_satelitais_ext ausente; aplique a 0056 antes.';
  end if;
  if to_regclass('erp.analises_satelitais') is null then
    raise exception 'SAT-08 R1: erp.analises_satelitais ausente; aplique a 0052/0056 antes.';
  end if;
  if to_regclass('erp.satelite_consulta_itens') is null then
    raise exception 'SAT-08 R1: erp.satelite_consulta_itens ausente; aplique a 0053/0056 antes.';
  end if;
  -- Já aplicada? (CHECK de versão já contém v2)
  if exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_consulta_itens_versao_metodo'
       and conrelid = 'erp.satelite_consulta_itens'::regclass
       and pg_get_constraintdef(oid) like '%pastagem-essencial-v2%'
  ) then
    raise exception 'SAT-08 R1: a 0057 ja foi aplicada (versao_metodo ja aceita pastagem-essencial-v2).';
  end if;
  -- Acervo: nenhuma análise EVI2 com max > 1 ainda (0056 barrava); se houver, fail-closed.
  if exists (
    select 1 from erp.analises_satelitais
     where indice = 'evi2' and valor_maximo is not null and valor_maximo > 1
  ) then
    raise exception 'SAT-08 R1: ha EVI2 com valor_maximo > 1 antes da 0057; acervo divergente da 0056. Nada foi aplicado.';
  end if;
  -- Acervo: nenhum item com método fora do conjunto atual da 0056.
  if exists (
    select 1 from erp.satelite_consulta_itens
     where versao_metodo not in ('ndvi-v2', 'pastagem-essencial-v1')
  ) then
    raise exception 'SAT-08 R1: ha item com versao_metodo fora de (ndvi-v2, pastagem-essencial-v1) antes da 0057. Nada foi aplicado.';
  end if;
end $$;

-- ---------- 3) travas ----------
lock table erp.analises_satelitais, erp.satelite_consulta_itens
  in share row exclusive mode;

-- ---------- 4) CHECKs: versão do método + coerência bundle×versão ----------
alter table erp.satelite_consulta_itens drop constraint chk_satelite_consulta_itens_versao_metodo;
alter table erp.satelite_consulta_itens
  add constraint chk_satelite_consulta_itens_versao_metodo
  check (versao_metodo in ('ndvi-v2', 'pastagem-essencial-v1', 'pastagem-essencial-v2'));

alter table erp.satelite_consulta_itens drop constraint chk_satelite_consulta_itens_bundle_versao;
alter table erp.satelite_consulta_itens
  add constraint chk_satelite_consulta_itens_bundle_versao check (
    (indice_bundle = 'ndvi' and versao_metodo = 'ndvi-v2')
    or (indice_bundle = 'pastagem_essencial' and versao_metodo in ('pastagem-essencial-v1', 'pastagem-essencial-v2'))
  );

comment on column erp.satelite_consulta_itens.versao_metodo is
  'Versão do método do executor: ndvi-v2, pastagem-essencial-v1 (histórico) ou pastagem-essencial-v2 (ativo, SAT-08 R1).';

-- ---------- 5) faixa persistível POR ÍNDICE (EVI2 até 2,5) ----------
-- Drop do CHECK genérico da 0056; o chk_analises_satelitais_faixa_ndvi da 0052 permanece (subset NDVI).
alter table erp.analises_satelitais drop constraint if exists chk_analises_satelitais_faixa_indice;
alter table erp.analises_satelitais
  add constraint chk_analises_satelitais_faixa_indice check (
    valor_minimo is null
    or (
      (indice in ('ndvi', 'ndre', 'ndmi', 'msavi2', 'bsi')
        and valor_minimo >= -1 and valor_maximo <= 1)
      or (indice = 'evi2'
        and valor_minimo >= -1 and valor_maximo <= 2.5)
    )
  );

comment on constraint chk_analises_satelitais_faixa_indice on erp.analises_satelitais is
  'SAT-08 R1: faixa persistível por índice. EVI2 até 2,5 (fórmula pode >1). Paleta visual NÃO define constraint.';

-- ---------- 6) pós-condições ----------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_satelite_consulta_itens_versao_metodo'
       and conrelid = 'erp.satelite_consulta_itens'::regclass
       and pg_get_constraintdef(oid) like '%pastagem-essencial-v2%'
  ) then
    raise exception 'SAT-08 R1: chk_satelite_consulta_itens_versao_metodo sem pastagem-essencial-v2.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_analises_satelitais_faixa_indice'
       and conrelid = 'erp.analises_satelitais'::regclass
       and pg_get_constraintdef(oid) like '%2.5%'
  ) then
    raise exception 'SAT-08 R1: chk_analises_satelitais_faixa_indice sem teto 2.5 do EVI2.';
  end if;
  -- RLS da ext intacta.
  if (select array_agg(policyname::text order by policyname)
        from pg_policies where schemaname = 'erp' and tablename = 'analises_satelitais_ext')
     is distinct from array['tenant_e_empresa'] then
    raise exception 'SAT-08 R1: politica de erp.analises_satelitais_ext alterada indevidamente.';
  end if;
end $$;
