-- =====================================================================
-- 0011 PERMISSÕES POR EMPRESA E MÓDULO (PRE-BASE2-02).
--
-- ESTRITAMENTE ADITIVA. Nada é renomeado nem removido: `erp.farms`, `farm_id`, `erp.member_farms` e o
-- cabeçalho `X-Farm-Id` continuam exatamente como estão — a migração física de nomenclatura é PRE-BASE2-03.
-- O que muda é QUEM É A AUTORIDADE: a partir daqui a autorização de empresa é lida daqui, e `member_farms`
-- deixa de ser consultada pelo runtime (fica como dado legado até a 03).
--
-- O MODELO. A autorização tem duas dimensões e a permissão efetiva é a INTERSEÇÃO delas:
--   CAPACIDADE  — o perfil permite a ação?             (erp.role_permissions)
--   ESCOPO      — em quais empresas ele pode fazê-la?  (estas tabelas, POR MÓDULO DE NEGÓCIO)
-- Um usuário pode ter Estoque na empresa A e Financeiro na empresa B; por isso o escopo é por módulo, e não
-- um único conjunto global de empresas.
--
-- SEM SENTINELA. `modo` é explícito: 'todas' = todas as empresas da organização; 'selecionadas' = apenas as
-- listadas em `erp.membro_empresas` — e nenhuma linha ali significa NENHUMA empresa. Módulo sem configuração
-- significa NENHUMA empresa (fail-closed), inclusive para módulos criados depois do cadastro do membro.
--
-- NOMENCLATURA (docs/DOMAIN-NAMING-STANDARD.md): estrutura nova nasce com o nome canônico em português.
-- `organization_id` permanece em inglês pela mesma exceção registrada na 0010.
-- =====================================================================

-- ---------- 0) chaves auxiliares para integridade referencial por tenant ----------
-- Aditivas: permitem FK COMPOSTA (organization_id, id), que é o que impede um vínculo cross-tenant de
-- existir no banco — não apenas de ser evitado pela aplicação.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organization_members_org_id_key') then
    alter table erp.organization_members add constraint organization_members_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'farms_org_id_key') then
    alter table erp.farms add constraint farms_org_id_key unique (organization_id, id);
  end if;
end $$;

-- ---------- 1) catálogo dos módulos de escopo empresarial ----------
-- NÃO é uma árvore de navegação (isso é apps/web/nav.registry.mjs) e não substitui áreas nem rotas: é apenas
-- a lista canônica dos DOMÍNIOS DE AUTORIZAÇÃO em que o acesso por empresa é configurado.
-- Início, Relatórios e Configurações não estão aqui de propósito: um relatório financeiro respeita o escopo
-- FINANCEIRO, um painel pecuário respeita PECUÁRIA — nenhum deles é um escopo próprio.
create table if not exists erp.modulos_escopo_empresa (
  chave text primary key,
  nome text not null,
  ordem int not null,
  constraint modulos_escopo_empresa_chave_check check (chave ~ '^[a-z][a-z_]*$'),
  constraint modulos_escopo_empresa_ordem_key unique (ordem)
);

comment on table erp.modulos_escopo_empresa is 'Catálogo dos módulos de negócio em que o acesso por empresa é configurado. Espelha @agro/domain MODULOS_ESCOPO_EMPRESA (gate de consistência em apps/api/test/unit).';

insert into erp.modulos_escopo_empresa (chave, nome, ordem) values
  ('compras', 'Compras', 1),
  ('estoque', 'Estoque', 2),
  ('financeiro', 'Financeiro', 3),
  ('vendas', 'Vendas', 4),
  ('pecuaria', 'Pecuária', 5),
  ('confinamento', 'Confinamento', 6),
  ('frota_ativos', 'Frota e Ativos', 7),
  ('pessoas_rh', 'Pessoas e RH', 8),
  ('ordens_servico', 'Ordens de Serviço', 9),
  ('fiscal', 'Fiscal', 10),
  ('documentos', 'Documentos', 11)
on conflict (chave) do update set nome = excluded.nome, ordem = excluded.ordem;

-- ---------- 2) modo do membro em cada módulo ----------
create table if not exists erp.membro_escopos_empresa (
  organization_id uuid not null references erp.organizations(id),
  membro_id uuid not null references erp.organization_members(id) on delete cascade,
  modulo text not null references erp.modulos_escopo_empresa(chave),
  modo text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references erp.users(id),
  primary key (organization_id, membro_id, modulo),
  constraint membro_escopos_empresa_modo_check check (modo in ('todas', 'selecionadas')),
  -- o membro precisa pertencer À MESMA organização do escopo: cross-tenant impossível por construção
  constraint membro_escopos_empresa_membro_fk foreign key (organization_id, membro_id)
    references erp.organization_members (organization_id, id) on delete cascade,
  -- chave referenciada por erp.membro_empresas: empresa escolhida só existe em escopo 'selecionadas'
  constraint membro_escopos_empresa_modo_key unique (organization_id, membro_id, modulo, modo)
);

comment on table erp.membro_escopos_empresa is 'Modo de acesso do membro por módulo: todas as empresas da organização ou apenas as selecionadas. Ausência de linha = nenhuma empresa (fail-closed).';
comment on column erp.membro_escopos_empresa.modo is '"todas" = todas as empresas da organização; "selecionadas" = somente erp.membro_empresas (lista vazia = nenhuma).';

-- ---------- 3) empresas escolhidas ----------
create table if not exists erp.membro_empresas (
  organization_id uuid not null references erp.organizations(id),
  membro_id uuid not null references erp.organization_members(id) on delete cascade,
  modulo text not null,
  empresa_id uuid not null references erp.farms(id) on delete cascade,
  -- fixo: a linha só existe para escopo 'selecionadas', garantido pela FK composta abaixo
  modo text not null default 'selecionadas',
  criado_em timestamptz not null default now(),
  primary key (organization_id, membro_id, modulo, empresa_id),
  constraint membro_empresas_modo_check check (modo = 'selecionadas'),
  constraint membro_empresas_escopo_fk foreign key (organization_id, membro_id, modulo, modo)
    references erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo) on delete cascade,
  -- a empresa precisa pertencer À MESMA organização
  constraint membro_empresas_empresa_fk foreign key (organization_id, empresa_id)
    references erp.farms (organization_id, id) on delete cascade
);

comment on table erp.membro_empresas is 'Empresas autorizadas ao membro dentro de um módulo (só existe quando o modo é "selecionadas"). Empresa é hoje materializada por erp.farms; a renomeação física é PRE-BASE2-03.';

-- "quais membros enxergam a empresa X" (administração e diagnóstico); o caminho quente
-- (membro × módulo × empresa) já é a própria chave primária.
create index if not exists membro_empresas_empresa_idx on erp.membro_empresas (organization_id, empresa_id);

-- ---------- 4) RLS e privilégios ----------
alter table erp.membro_escopos_empresa enable row level security;
alter table erp.membro_escopos_empresa force row level security;
alter table erp.membro_empresas enable row level security;
alter table erp.membro_empresas force row level security;
alter table erp.modulos_escopo_empresa enable row level security;
alter table erp.modulos_escopo_empresa force row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='erp' and tablename='membro_escopos_empresa' and policyname='tenant_isolation') then
    create policy tenant_isolation on erp.membro_escopos_empresa for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='erp' and tablename='membro_empresas' and policyname='tenant_isolation') then
    create policy tenant_isolation on erp.membro_empresas for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id)) with check (erp.tenant_visible(organization_id));
  end if;
  -- catálogo global de módulos: leitura para todos; escrita só por migration (nenhum grant de insert/update)
  if not exists (select 1 from pg_policies where schemaname='erp' and tablename='modulos_escopo_empresa' and policyname='catalogo_leitura') then
    create policy catalogo_leitura on erp.modulos_escopo_empresa for select to erp_app, authenticated using (true);
  end if;
end $$;

grant select, insert, update, delete on erp.membro_escopos_empresa, erp.membro_empresas to erp_app;
grant select on erp.modulos_escopo_empresa to erp_app;

-- ---------- 5) autoridade de acesso por empresa (base do RLS empresarial da PRE-BASE2-03) ----------
-- Verdadeiro quando o usuário pode operar NAQUELA empresa DENTRO DAQUELE MÓDULO. Fail-closed em tudo que
-- não for explicitamente permitido: membro inativo, módulo inexistente, módulo sem configuração, empresa de
-- outra organização e empresa excluída resultam em falso.
create or replace function erp.tem_acesso_empresa(p_org uuid, p_user uuid, p_modulo text, p_empresa uuid)
returns boolean language sql stable as $$
  select p_org is not null and p_user is not null and p_modulo is not null and p_empresa is not null
    -- a empresa tem de existir, pertencer à organização e não estar excluída
    and exists (
      select 1 from erp.farms f
      where f.id = p_empresa and f.organization_id = p_org and f.deleted_at is null
    )
    -- e o módulo tem de ser canônico (string livre nunca autoriza)
    and exists (select 1 from erp.modulos_escopo_empresa mm where mm.chave = p_modulo)
    and exists (
      select 1 from erp.organization_members m
      where m.organization_id = p_org and m.user_id = p_user and m.is_active
        and (
          m.is_owner   -- proprietário: todas as empresas da organização, em todos os módulos
          or exists (
            select 1 from erp.membro_escopos_empresa e
            where e.organization_id = p_org and e.membro_id = m.id and e.modulo = p_modulo
              and (
                e.modo = 'todas'
                or exists (
                  select 1 from erp.membro_empresas me
                  where me.organization_id = p_org and me.membro_id = m.id
                    and me.modulo = p_modulo and me.empresa_id = p_empresa
                )
              )
          )
        )
    )
$$;

comment on function erp.tem_acesso_empresa(uuid, uuid, text, uuid) is 'Autoridade de acesso por empresa e módulo (PRE-BASE2-02). Base do RLS empresarial que a PRE-BASE2-03 aplicará às tabelas de negócio.';

grant execute on function erp.tem_acesso_empresa(uuid, uuid, text, uuid) to erp_app;

-- ---------- 6) backfill: o estado atual vira configuração explícita ----------
-- Regra de equivalência com o mecanismo legado (erp.member_farms):
--   sem linhas  → 'todas'        (a convenção antiga "lista vazia = todas")
--   com linhas  → 'selecionadas' + exatamente as mesmas empresas
-- Aplicado a TODOS os módulos canônicos, para que nenhum usuário perca nem ganhe acesso no merge. A partir
-- daqui o administrador diferencia módulo a módulo.
--
-- Antes de copiar, a integridade do legado é auditada: vínculo apontando para empresa de OUTRA organização
-- (ou para empresa/membro inexistente) não é mascarado — a migration falha com mensagem clara.
do $$
declare
  v_invalidos int;
  v_owner_restrito int;
  v_membros int;
  v_escopos int;
  v_empresas int;
begin
  select count(*) into v_invalidos
  from erp.member_farms mf
  left join erp.organization_members m on m.id = mf.member_id
  left join erp.farms f on f.id = mf.farm_id
  where m.id is null or f.id is null or f.organization_id <> m.organization_id;

  if v_invalidos > 0 then
    raise exception 'member_farms tem % vínculo(s) inconsistente(s) (membro/empresa inexistente ou empresa de outra organização). Corrija antes de migrar: o backfill não pode mascarar autorização inválida.', v_invalidos;
  end if;

  -- proprietário passa a enxergar todas as empresas da organização (contrato PRE-BASE2-02). Se algum
  -- proprietário estava restrito por member_farms, isso é uma AMPLIAÇÃO consciente: fica registrada aqui e
  -- o escopo legado dele é preservado nas tabelas novas (vale se ele deixar de ser proprietário).
  select count(distinct m.id) into v_owner_restrito
  from erp.organization_members m join erp.member_farms mf on mf.member_id = m.id
  where m.is_owner;
  if v_owner_restrito > 0 then
    raise notice 'PRE-BASE2-02: % proprietário(s) tinham restrição de empresa em member_farms; pelo contrato o proprietário passa a enxergar todas as empresas da organização.', v_owner_restrito;
  end if;

  insert into erp.membro_escopos_empresa (organization_id, membro_id, modulo, modo)
  select m.organization_id, m.id, mm.chave,
         case when exists (select 1 from erp.member_farms mf where mf.member_id = m.id) then 'selecionadas' else 'todas' end
  from erp.organization_members m
  cross join erp.modulos_escopo_empresa mm
  where m.is_active
  on conflict (organization_id, membro_id, modulo) do nothing;
  get diagnostics v_escopos = row_count;

  insert into erp.membro_empresas (organization_id, membro_id, modulo, empresa_id)
  select m.organization_id, m.id, mm.chave, mf.farm_id
  from erp.organization_members m
  join erp.member_farms mf on mf.member_id = m.id
  cross join erp.modulos_escopo_empresa mm
  where m.is_active
  on conflict (organization_id, membro_id, modulo, empresa_id) do nothing;
  get diagnostics v_empresas = row_count;

  select count(*) into v_membros from erp.organization_members where is_active;
  raise notice 'PRE-BASE2-02 backfill: % membro(s) ativo(s), % escopo(s) de módulo, % vínculo(s) de empresa.', v_membros, v_escopos, v_empresas;
end $$;
