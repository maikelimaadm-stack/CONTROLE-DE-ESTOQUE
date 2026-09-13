-- =====================================================================================================
-- PRE-BASE2-03 — RLS EMPRESARIAL (parte 2)
--
-- Até aqui o banco isolava ORGANIZAÇÃO. Empresa era regra de aplicação: `empresaScope` monta o semi-join,
-- `exigirEmpresaDeLancamento` valida a escrita. Isso é correto e continua valendo — mas é UMA linha de
-- defesa. Uma consulta nova sem o predicado, um relatório com um `exists` esquecido ou um acesso direto
-- com o papel da aplicação enxergavam a organização inteira. Esta migration desce a segunda linha.
--
-- A autoridade efetiva passa a ser: TENANT (RLS) ∧ ESCOPO DE EMPRESA (RLS) ∧ CAPACIDADE (API).
-- A capacidade continua na API de propósito: ela é por ROTA, e o banco não sabe qual rota está rodando.
--
-- ---------------------------------------------------------------------------------------------------
-- O ERRO QUE ESTA MIGRATION EVITA
--
-- Políticas PERMISSIVE do PostgreSQL combinam com OR. Acrescentar uma política `company_scope` ao lado da
-- `tenant_isolation` que já existe NÃO restringiria nada: a linha continuaria visível pela política antiga.
-- Por isso cada tabela tem a política tenant-only SUBSTITUÍDA por uma política combinada com AND — não
-- somada. `apps/api/test/integration/rls-empresa.test.ts` reintroduz a política tenant-only de propósito e
-- exige que o teste FALHE; sem isso, "a política existe" seria confundido com "a política funciona".
-- ---------------------------------------------------------------------------------------------------
--
-- MÓDULO: vem de `app.modulo_empresa`, que o `runService` define na transação a partir da PERMISSÃO da
-- rota. Nunca do cabeçalho, da URL, do corpo ou do cliente.
--
-- MÓDULO INDEFINIDO: recurso de organização e porta de permissão dinâmica começam a transação sem módulo.
-- Aí o predicado vale a UNIÃO das empresas que o usuário enxerga em ALGUM módulo — o mesmo conjunto que
-- alimenta o seletor de empresa. Nunca "todas": é sempre subconjunto da autorização real, e a API aplica
-- o recorte estrito por módulo por cima. Tratar módulo indefinido como "tudo" reabriria o vazamento;
-- tratá-lo como "nada" quebraria toda rota de organização que lê tabela com empresa.
-- =====================================================================================================

-- ---------- 0) uma view de saldo que não tinha RLS ----------
-- `erp.v_bank_account_balances` foi criada sem `security_invoker`: ela roda com os privilégios e a RLS do
-- DONO. Onde o dono é superusuário (migração local, Supabase), não há RLS nenhuma — sob o papel da
-- aplicação, com `app.org_id` de uma organização, a view devolvia as contas E OS SALDOS de TODAS elas.
-- As duas rotas que a consomem hoje fazem `join erp.bank_accounts a ... where a.organization_id=$1`, e é
-- esse join que vinha segurando o resultado; a view em si era leitura irrestrita do banco inteiro, e
-- qualquer consulta nova sem o join herdaria o vazamento. Medido e provado em
-- `apps/api/test/integration/rls-empresa.test.ts`.
create or replace view erp.v_bank_account_balances with (security_invoker = true) as
  select a.id as bank_account_id, a.organization_id,
         a.opening_balance + coalesce(sum(case when m.type = 'in' then m.amount + m.interest else -(m.amount + m.interest) end)
           filter (where m.status = 'confirmed' and m.deleted_at is null), 0::numeric) as balance
    from erp.bank_accounts a
    left join erp.bank_movements m on m.bank_account_id = a.id
   group by a.id, a.organization_id, a.opening_balance;
comment on view erp.v_bank_account_balances is 'Saldo por conta bancaria. security_invoker = true (PRE-BASE2-03): sem isso a view rodava com a RLS do DONO e expunha o saldo de todas as organizacoes a quem tivesse o papel da aplicacao.';
grant select on erp.v_bank_account_balances to erp_app;

-- ---------- 1) predicados de escopo ----------
-- Parte da decisão NÃO depende da linha lida: proprietário e modo `todas` valem para a tabela inteira.
-- Separá-la em função própria deixa o `or` curto-circuitar antes do `exists` por empresa — é a diferença
-- entre uma varredura barata e um sublink por linha (ver EXPLAIN em docs/COMPANY-RLS-MATRIX.md).
create or replace function erp.escopo_empresa_total(p_modulo text) returns boolean language sql stable as $$
  select exists (
    select 1 from erp.organization_members m
     where m.organization_id = erp.current_org_id() and m.user_id = erp.effective_user_id() and m.is_active
       and (
         m.is_owner
         or exists (
           select 1 from erp.membro_escopos_empresa e
            where e.organization_id = m.organization_id and e.membro_id = m.id and e.modo = 'todas'
              and (p_modulo is null or e.modulo = p_modulo)
         )
       )
  )
$$;
create or replace function erp.escopo_empresa_total() returns boolean language sql stable as $$
  select erp.escopo_empresa_total(erp.modulo_empresa_atual())
$$;
comment on function erp.escopo_empresa_total(text) is 'Parte do escopo que NAO depende da linha: proprietario ou modo todas. Modulo nulo = em ALGUM modulo (rota de organizacao / porta dinamica).';

-- Predicado de LEITURA. A regra por módulo é a da PRE-BASE2-02 e não muda; o que esta migration acrescenta
-- é o comportamento com módulo indefinido (união dos módulos), necessário para que rota de organização e
-- porta de permissão dinâmica continuem lendo tabela com empresa.
create or replace function erp.empresa_no_escopo(p_empresa uuid, p_modulo text) returns boolean language sql stable as $$
  select p_empresa is null
    or erp.escopo_empresa_total(p_modulo)
    or exists (
      select 1 from erp.membro_empresas me
      join erp.organization_members m2 on m2.id = me.membro_id
      where me.organization_id = erp.current_org_id() and m2.user_id = erp.effective_user_id() and m2.is_active
        and (p_modulo is null or me.modulo = p_modulo) and me.empresa_id = p_empresa
    )
$$;
create or replace function erp.empresa_no_escopo(p_empresa uuid) returns boolean language sql stable as $$
  select erp.empresa_no_escopo(p_empresa, erp.modulo_empresa_atual())
$$;

-- Predicado de ESCRITA. A diferença está no NULO: ler um registro sem empresa é legítimo para qualquer um
-- (ele vale para a organização inteira), mas CRIAR um alcança todas as empresas — inclusive as que o autor
-- não enxerga. É ampliação de autorização pela porta da escrita, e é a mesma regra de
-- `exigirEscopoTotalDoModulo` na API (docs/MULTI-COMPANY-CONTRACT.md §7).
create or replace function erp.empresa_escrita_permitida(p_empresa uuid) returns boolean language sql stable as $$
  select case when p_empresa is null then erp.escopo_empresa_total() else erp.empresa_no_escopo(p_empresa) end
$$;
comment on function erp.empresa_escrita_permitida(uuid) is 'WITH CHECK do escopo empresarial. Empresa nula = registro da organizacao inteira: so proprietario ou modo todas pode criar.';

-- CONJUNTO das empresas nomeadas no escopo do membro. Existe por causa do PLANO, não do estilo.
--
-- `erp.empresa_no_escopo(empresa_id, modulo)` é um predicado POR LINHA: dentro de uma política de RLS ele
-- vira um filtro que o executor chama uma vez para CADA linha lida, e cada chamada roda dois `exists`.
-- Medido em base com volume (200 mil movimentações, 100 mil títulos, 30 empresas, `docs/COMPANY-RLS-MATRIX.md`):
-- a listagem de títulos em aberto levava **34,7 s**, com o filtro avaliado 100 mil vezes.
--
-- A forma abaixo diz a MESMA coisa de um jeito que o planejador resolve UMA vez por consulta:
--   - `(select erp.escopo_empresa_total(...))` — sublink escalar sem referência à linha → InitPlan;
--   - `empresa_id in (select erp.empresas_do_membro(...))` — sublink não correlacionado → hashed SubPlan.
-- A mesma listagem passa a **61 ms** (563×), com `loops=1` nos dois. Por isso o predicado de leitura é
-- escrito INLINE na política em vez de chamar `empresa_no_escopo(empresa_id)`: embrulhá-lo numa função
-- devolveria a chamada por linha e o ganho ia embora.
--
-- Só LEITURA precisa dessa forma: `with check` roda por linha ESCRITA, onde uma chamada é uma chamada.
create or replace function erp.empresas_do_membro(p_modulo text) returns setof uuid language sql stable as $$
  select me.empresa_id from erp.membro_empresas me
    join erp.organization_members m2 on m2.id = me.membro_id
   where me.organization_id = erp.current_org_id() and m2.user_id = erp.effective_user_id() and m2.is_active
     and (p_modulo is null or me.modulo = p_modulo)
$$;
comment on function erp.empresas_do_membro(text) is 'Empresas NOMEADAS no escopo do membro (modo selecionadas). Conjunto, nao predicado: usado como sublink nao correlacionado nas politicas para o planejador resolver uma vez por consulta.';

grant execute on function erp.escopo_empresa_total(text), erp.escopo_empresa_total(),
                          erp.empresa_no_escopo(uuid, text), erp.empresa_no_escopo(uuid),
                          erp.empresas_do_membro(text),
                          erp.empresa_escrita_permitida(uuid) to erp_app;

-- ---------- 2) políticas ----------
-- A tabela é varrida do CATÁLOGO, não de uma lista digitada: tabela nova com coluna de empresa entra no
-- contrato sozinha. O que é digitado é a EXCEÇÃO — e toda exceção está classificada e justificada em
-- docs/COMPANY-RLS-MATRIX.md, conferida por gate contra o schema real.
do $$
declare
  r record;
  -- Predicado de LEITURA (ver a nota sobre plano acima de `erp.empresas_do_membro`). `%1$I` é a coluna.
  leitura constant text :=
    '(%1$I is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))'
    ' or %1$I in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))';
  -- C — ORIGEM + DESTINO: regra própria (a leitura vale por qualquer ponta; a escrita responde pela origem).
  pares text[] := array['animal_movements','equipment_transfers','warehouse_transfers'];
  -- E/F — PORTA DINÂMICA, CONFIGURAÇÃO DE AUTORIZAÇÃO, DICA DENORMALIZADA e ARQUIVO MORTO.
  especiais text[] := array['notifications','registros_globais','membro_empresas','legado_escopo_empresa_v0'];
begin
  for r in
    select c.table_name as tabela
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
     where c.table_schema='erp' and c.column_name='empresa_id'
       and exists (select 1 from information_schema.columns o
                    where o.table_schema='erp' and o.table_name=c.table_name and o.column_name='organization_id')
       and not (c.table_name = any(pares)) and not (c.table_name = any(especiais))
     order by c.table_name
  loop
    -- SUBSTITUI a política tenant-only. Somar uma segunda política PERMISSIVE manteria o vazamento: o
    -- PostgreSQL combina políticas permissivas com OR, e a antiga sozinha já liberava a organização inteira.
    execute format('drop policy if exists tenant_isolation on erp.%I', r.tabela);
    execute format('drop policy if exists tenant_e_empresa on erp.%I', r.tabela);
    execute format($f$create policy tenant_e_empresa on erp.%I for all to erp_app, authenticated
        using (erp.tenant_visible(organization_id) and %s)
        with check (erp.tenant_visible(organization_id) and erp.empresa_escrita_permitida(empresa_id))$f$,
        r.tabela, format(leitura, 'empresa_id'));
  end loop;

  -- C — transferências entre empresas. A leitura vale pelas DUAS pontas: quem envia acompanha e quem recebe
  -- precisa ver o que está chegando. A escrita responde pela ORIGEM apenas, de propósito: transferir para
  -- uma empresa que o autor não enxerga é o caso NORMAL do negócio (quem recebe é que aceita) e exigir as
  -- duas pontas quebraria a operação. O destino continua provado pela chave estrangeira composta — tem de
  -- ser empresa DESTA organização — e por `exigirEmpresaDaOrganizacao` na API.
  execute $f$drop policy if exists tenant_isolation on erp.animal_movements$f$;
  execute format($f$create policy tenant_e_empresa on erp.animal_movements for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id) and (%s or %s))
      with check (erp.tenant_visible(organization_id) and erp.empresa_escrita_permitida(empresa_id))$f$,
      format(leitura, 'empresa_id'), format(leitura, 'empresa_destino_id'));
  execute $f$drop policy if exists tenant_isolation on erp.equipment_transfers$f$;
  execute format($f$create policy tenant_e_empresa on erp.equipment_transfers for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id) and (%s or %s))
      with check (erp.tenant_visible(organization_id) and erp.empresa_escrita_permitida(empresa_origem_id))$f$,
      format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
  execute $f$drop policy if exists tenant_isolation on erp.warehouse_transfers$f$;
  execute format($f$create policy tenant_e_empresa on erp.warehouse_transfers for all to erp_app, authenticated
      using (erp.tenant_visible(organization_id) and (%s or %s))
      with check (erp.tenant_visible(organization_id) and erp.empresa_escrita_permitida(empresa_origem_id))$f$,
      format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
end $$;

-- D — a própria tabela de Empresas.
-- O seletor de empresa não pode depender do módulo ativo: a mesma lista alimenta telas de vários módulos, e
-- recortá-la pelo módulo da rota faria a empresa sumir do seletor conforme a tela aberta. A regra é a união
-- — enxerga quem enxerga aquela empresa em ALGUM módulo —, que é exatamente `empresasVisiveisNaOrganizacao`.
-- Isso NÃO é "listagem aberta do tenant": quem não enxerga a empresa em módulo nenhum não a vê aqui.
-- WITH CHECK é só de tenant: criar empresa é ato de ORGANIZAÇÃO (permissão `farms.create`, classificada como
-- recurso de organização) e uma empresa recém-criada não está no escopo de ninguém — exigir escopo para
-- criá-la seria circular. Alterar continua limitado ao que o USING deixa enxergar.
drop policy if exists tenant_isolation on erp.empresas;
create policy tenant_e_empresa on erp.empresas for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(null::text)) or id in (select erp.empresas_do_membro(null::text))))
  with check (erp.tenant_visible(organization_id));

comment on policy tenant_e_empresa on erp.empresas is 'PRE-BASE2-03: empresa visivel = a que o membro enxerga em ALGUM modulo (uniao), nunca a organizacao inteira. Uniao e nao modulo ativo porque o seletor e compartilhado entre telas de modulos diferentes.';
