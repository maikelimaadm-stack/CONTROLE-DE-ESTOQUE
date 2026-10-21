-- Papel da API no ambiente local de desenvolvimento (Base44).
--
-- Em produção a API conecta como `erp_app`: LOGIN, SEM BYPASSRLS, e não é dona do schema `erp`.
-- A migration 0007 cria esse papel, mas como `nologin` (ela supõe que os papéis de verdade são
-- criados no painel do Supabase). Aqui o papel é o mesmo da produção, só ganha LOGIN e senha
-- local — conectar como superusuário desligaria a RLS (`force row level security` não alcança
-- superusuário nem papel com BYPASSRLS) e o app deixaria de exercitar o isolamento por tenant.
--
-- Idempotente e sem valor de produção: a senha é de sandbox, igual à do compose.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app login password 'erp_app';
  else
    alter role erp_app login password 'erp_app';
  end if;
end $$;

-- Grants do schema: a migration 0007 já os concede e registra as default privileges, mas ela
-- pode tê-lo feito ANTES de o papel existir como login; reconceder aqui é barato e idempotente.
grant usage on schema erp to erp_app;
grant select, insert, update, delete on all tables in schema erp to erp_app;
grant usage, select on all sequences in schema erp to erp_app;
grant execute on all functions in schema erp to erp_app;
