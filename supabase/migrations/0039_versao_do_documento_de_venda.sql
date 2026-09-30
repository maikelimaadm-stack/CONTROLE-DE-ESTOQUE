-- =====================================================================
-- 0039 EDITAR-01 — VERSÃO DO DOCUMENTO DE VENDA (orçamento, pedido e venda) — decisão 272
-- ESQUELETO do coordenador: o dono (B1) completa cabeçalho, pré e pós-condições no estilo da 0038.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 73) then
    raise exception 'EDITAR-01: outra transacao ja detem a trava desta migration (2026,73). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 3) coluna ----------
alter table erp.sales_documents add column version bigint not null default 0;

-- ---------- 4) gatilho ----------
create function erp.sales_documents_versao() returns trigger
  language plpgsql
  set search_path = erp, pg_temp
as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;

revoke all on function erp.sales_documents_versao() from public;

create trigger trg_sales_documents_versao
  before update on erp.sales_documents
  for each row execute function erp.sales_documents_versao();
