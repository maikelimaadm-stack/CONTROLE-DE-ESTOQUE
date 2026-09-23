-- Inventário de produção para o go-live (GO-LIVE-01) — SOMENTE LEITURA.
--
-- Como rodar: dentro de uma transação READ ONLY, que o próprio banco faz valer —
--   begin transaction read only;  \i docs/sql/inventario-go-live.sql  rollback;
-- Cada bloco abaixo é um SELECT independente. O arquivo não tem nenhum comando de escrita, e
-- `packages/db/test/inventario-go-live.test.ts` reprova se aparecer um.
--
-- Dados pessoais: só o e-mail do usuário. Nenhuma senha, hash, token ou segredo é lido.
--
-- "É demo" usa o MESMO critério do seed (`packages/db/src/origem-organizacao.ts`, SQL_ORGANIZACAO_DEMO):
-- marca `parameters.origem_seed = 'demo'`, ou, sem marca, razão social e documento que o seed demo antigo
-- gravava fixos. Divergir dali é bug deste arquivo.

-- 1. Organizações
select o.id, o.name, o.slug, o.created_at, o.deleted_at,
       o.parameters->>'origem_seed' as origem_seed,
       (o.parameters->>'origem_seed' = 'demo'
        or (not (o.parameters ? 'origem_seed') and o.legal_name = '[DEMO] Fazendas Modelo Ltda' and o.document = '00000000000191')) as e_demo
from erp.organizations o
order by o.created_at;

-- 2. Usuários (destaque para @demo.local)
select u.email, u.is_active, u.last_login_at,
       (select count(*) from erp.organization_members m where m.user_id = u.id) as organizacoes,
       (select count(*) from erp.organization_members m where m.user_id = u.id and m.is_active) as organizacoes_ativas,
       u.email::text like '%@demo.local' as e_demo_local
from erp.users u
order by e_demo_local desc, u.email;

-- 3. Vínculos por organização
select o.slug as organizacao, u.email, m.is_owner, r.name as perfil, m.is_active
from erp.organization_members m
join erp.organizations o on o.id = m.organization_id
join erp.users u on u.id = m.user_id
left join erp.roles r on r.id = m.role_id
order by o.slug, m.is_owner desc, u.email;

-- 4. Volume por organização: cadastros principais e transações principais
select o.slug as organizacao,
       (select count(*) from erp.empresas x where x.organization_id = o.id) as empresas,
       (select count(*) from erp.people x where x.organization_id = o.id) as pessoas,
       (select count(*) from erp.products x where x.organization_id = o.id) as produtos,
       (select count(*) from erp.warehouses x where x.organization_id = o.id) as armazens,
       (select count(*) from erp.bank_accounts x where x.organization_id = o.id) as contas_bancarias,
       (select count(*) from erp.sales_documents x where x.organization_id = o.id) as documentos_venda,
       (select count(*) from erp.stock_movements x where x.organization_id = o.id) as movimentos_estoque,
       (select count(*) from erp.financial_titles x where x.organization_id = o.id) as titulos,
       (select count(*) from erp.bank_movements x where x.organization_id = o.id) as movimentos_bancarios,
       (select count(*) from erp.purchase_requests x where x.organization_id = o.id) as solicitacoes_compra,
       (select count(*) from erp.animals x where x.organization_id = o.id) as animais
from erp.organizations o
order by o.created_at;

-- 5. Ledger de migrations (esperado: 23, última 0023_venda_execucao_configurada_guarda.sql)
select count(*) as migrations, max(name) as ultima, max(applied_at) as aplicada_em
from public.erp_migrations;

-- 6a. Gatilho da 0023 com a cláusula da R1 (só dispara na ENTRADA em confirmed/invoiced).
--     O Postgres devolve a definição em minúsculas e com cast (`old.status IS DISTINCT FROM 'confirmed'::text`).
select t.tgname,
       lower(pg_get_triggerdef(t.oid)) like '%old.status is distinct from ''confirmed''::text%'
       and lower(pg_get_triggerdef(t.oid)) like '%old.status is distinct from ''invoiced''::text%'
       and lower(pg_get_triggerdef(t.oid)) like '%new.tipo_operacao_versao_id is not null%' as clausula_r1
from pg_trigger t
where t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_execucao_configurada';

-- 6b. Versões de TOP com execução configurada (esperado: 0 enquanto a fase 2 da 04A não acontecer)
select count(*) as versoes_com_execucao_configurada
from erp.tipos_operacao_versoes v
where v.configuracao->'execucao'->>'estoque' = 'configurada'
   or v.configuracao->'execucao'->>'financeiro' = 'configurada';
