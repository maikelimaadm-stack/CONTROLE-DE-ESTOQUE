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
--
-- ---------------------------------------------------------------------------------------------------
-- POR QUE AS POLÍTICAS SÃO SEPARADAS POR COMANDO
--
-- Uma política `for all` tem UM `using` e UM `with check`. O PostgreSQL os aplica assim:
--
--     SELECT → using
--     INSERT → with check
--     UPDATE → using na linha ANTIGA, with check na linha NOVA
--     DELETE → using                     (não existe `with check` para DELETE)
--
-- Enquanto a regra de leitura for IGUAL à de escrita, `for all` diz a coisa certa. Quando elas divergem,
-- ele passa a dizer que PODER LER É PODER APAGAR — e que uma linha que se pode ler pode ser TRANSFORMADA
-- em qualquer linha que passe no `with check`. Dois casos reais desta migração divergem:
--
--   B) empresa anulável: nulo significa "da ORGANIZAÇÃO inteira". Ler é legítimo para quem enxerga parte
--      das empresas; ESCREVER alcança todas elas. Com `for all`, quem enxerga só a empresa A satisfazia o
--      `using` da linha global (`empresa_id is null`) e podia APAGÁ-LA — ou, no UPDATE, pegá-la pelo
--      `using` e transformá-la numa linha da empresa A, que passa no `with check`.
--
--   C) transferência: lê-se por QUALQUER ponta (quem recebe precisa ver o que está chegando), mas
--      escreve-se pela ORIGEM. Com `for all`, quem enxergava só o DESTINO satisfazia o `using` e podia
--      apagar a transferência — ou reescrever a origem para uma empresa sua.
--
-- Por isso, onde leitura ≠ escrita, cada comando tem a sua política. Onde leitura = escrita (categoria A,
-- empresa obrigatória), `for all` continua — dividir ali seria repetir a mesma expressão quatro vezes e
-- criar quatro lugares para ela envelhecer.
--
-- A FORMA do predicado não muda: `(select …)` para a parte que não depende da linha (InitPlan) e
-- `col in (select …)` para o conjunto (hashed SubPlan), os dois resolvidos UMA vez por consulta. Trocar
-- isso por uma chamada de função por linha custava 34 s onde hoje custa 55 ms (medição no topo do arquivo).
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  n text;
  -- LEITURA: registro sem empresa é da organização e continua visível para quem enxerga parte dela.
  leitura constant text :=
    '(%1$I is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))'
    ' or %1$I in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))';
  -- ESCRITA: o nulo NÃO é permissivo. Criar, alterar ou apagar um registro sem empresa alcança todas elas,
  -- então exige escopo TOTAL do módulo — a mesma regra de `erp.empresa_escrita_permitida`, escrita inline
  -- para que UPDATE e DELETE, que avaliam por linha varrida, não paguem uma chamada de função por linha.
  escrita constant text :=
    '((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))'
    ' or (%1$I is not null and %1$I in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))';
  tenant constant text := 'erp.tenant_visible(organization_id)';
  -- C — ORIGEM + DESTINO: regra própria (a leitura vale por qualquer ponta; a escrita responde pela origem).
  pares text[] := array['animal_movements','equipment_transfers','warehouse_transfers'];
  -- E/F — PORTA DINÂMICA, CONFIGURAÇÃO DE AUTORIZAÇÃO, DICA DENORMALIZADA e ARQUIVO MORTO.
  especiais text[] := array['notifications','registros_globais','membro_empresas','legado_escopo_empresa_v0'];
  -- Todo nome que esta migração possa ter criado antes, para que reaplicá-la não deixe duas políticas
  -- PERMISSIVE do mesmo comando convivendo — que é justamente como o OR devolveria o vazamento.
  nomes text[] := array['tenant_isolation', 'tenant_e_empresa', 'tenant_e_empresa_select',
                        'tenant_e_empresa_insert', 'tenant_e_empresa_update', 'tenant_e_empresa_delete'];
begin
  for r in
    select c.table_name as tabela, (c.is_nullable = 'YES') as anulavel
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
     where c.table_schema='erp' and c.column_name='empresa_id'
       and exists (select 1 from information_schema.columns o
                    where o.table_schema='erp' and o.table_name=c.table_name and o.column_name='organization_id')
       and not (c.table_name = any(pares)) and not (c.table_name = any(especiais))
     order by c.table_name
  loop
    foreach n in array nomes loop execute format('drop policy if exists %I on erp.%I', n, r.tabela); end loop;

    if r.anulavel then
      -- B — leitura ≠ escrita por causa do NULO: uma política por comando.
      execute format('create policy tenant_e_empresa_select on erp.%I for select to erp_app, authenticated using (%s and %s)',
                     r.tabela, tenant, format(leitura, 'empresa_id'));
      execute format('create policy tenant_e_empresa_insert on erp.%I for insert to erp_app, authenticated with check (%s and %s)',
                     r.tabela, tenant, format(escrita, 'empresa_id'));
      execute format('create policy tenant_e_empresa_update on erp.%I for update to erp_app, authenticated using (%s and %s) with check (%s and %s)',
                     r.tabela, tenant, format(escrita, 'empresa_id'), tenant, format(escrita, 'empresa_id'));
      execute format('create policy tenant_e_empresa_delete on erp.%I for delete to erp_app, authenticated using (%s and %s)',
                     r.tabela, tenant, format(escrita, 'empresa_id'));
    else
      -- A — empresa obrigatória: o ramo do nulo é inalcançável nas duas expressões, então leitura e
      -- escrita são a MESMA regra (`empresa no escopo`) e uma política única a diz uma vez só.
      execute format('create policy tenant_e_empresa on erp.%I for all to erp_app, authenticated using (%s and %s) with check (%s and %s)',
                     r.tabela, tenant, format(leitura, 'empresa_id'), tenant, format(escrita, 'empresa_id'));
    end if;
  end loop;

  -- C — transferências entre empresas.
  --
  -- A leitura vale pelas DUAS pontas: quem envia acompanha e quem recebe precisa ver o que está chegando.
  --
  -- A escrita NÃO é "só a origem", e essa foi a lição cara desta rodada. O destinatário tem dois atos
  -- legítimos e centrais no domínio: ACEITAR a transferência de lote (`POST /livestock/transfers/:id/process`,
  -- que é literalmente "processar na empresa destino") e CANCELAR a transferência de armazém
  -- (`POST /stock/transfers/:id/cancel`, que a API autoriza por origem OU destino). Os dois mudam `status`.
  -- Um `using` de UPDATE restrito à origem não os recusa com erro: ele os transforma em UPDATE de ZERO
  -- linhas, e as rotas não conferem `rowCount` — o usuário veria "confirmado" sem nada ter mudado.
  -- Trocar um buraco por um no-op silencioso é piorar.
  --
  -- Então a RLS delimita o ENVELOPE (a linha continua entre as mesmas duas pontas, e pelo menos uma delas é
  -- do autor) e o que a RLS não sabe dizer — "as pontas não mudaram" — fica com um GATILHO, que é quem
  -- enxerga OLD e NEW. Ser destinatário passa a significar exatamente: pode mexer no andamento, NÃO pode
  -- redirecionar o envio (gatilho) e NÃO pode apagá-lo (o `delete` responde pela origem).
  -- O destino continua provado pela chave estrangeira composta — tem de ser empresa DESTA organização —
  -- e por `exigirEmpresaDaOrganizacao` na API.
  for r in select unnest(pares) as tabela loop
    foreach n in array nomes loop execute format('drop policy if exists %I on erp.%I', n, r.tabela); end loop;
  end loop;

  -- `animal_movements` nomeia a origem como `empresa_id` (o lote sai da empresa do movimento);
  -- `equipment_transfers` e `warehouse_transfers` nomeiam `empresa_origem_id`.
  execute format('create policy tenant_e_empresa_select on erp.animal_movements for select to erp_app, authenticated using (%s and (%s or %s))',
                 tenant, format(leitura, 'empresa_id'), format(leitura, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_insert on erp.animal_movements for insert to erp_app, authenticated with check (%s and %s)',
                 tenant, format(escrita, 'empresa_id'));
  execute format('create policy tenant_e_empresa_update on erp.animal_movements for update to erp_app, authenticated using (%s and (%s or %s)) with check (%s and (%s or %s))',
                 tenant, format(leitura, 'empresa_id'), format(leitura, 'empresa_destino_id'),
                 tenant, format(leitura, 'empresa_id'), format(leitura, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_delete on erp.animal_movements for delete to erp_app, authenticated using (%s and %s)',
                 tenant, format(escrita, 'empresa_id'));

  for r in select unnest(array['equipment_transfers','warehouse_transfers']) as tabela loop
    execute format('create policy tenant_e_empresa_select on erp.%I for select to erp_app, authenticated using (%s and (%s or %s))',
                   r.tabela, tenant, format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
    execute format('create policy tenant_e_empresa_insert on erp.%I for insert to erp_app, authenticated with check (%s and %s)',
                   r.tabela, tenant, format(escrita, 'empresa_origem_id'));
    execute format('create policy tenant_e_empresa_update on erp.%I for update to erp_app, authenticated using (%s and (%s or %s)) with check (%s and (%s or %s))',
                   r.tabela, tenant, format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'),
                   tenant, format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
    execute format('create policy tenant_e_empresa_delete on erp.%I for delete to erp_app, authenticated using (%s and %s)',
                   r.tabela, tenant, format(escrita, 'empresa_origem_id'));
  end loop;
end $$;

-- ---------- 2b) o que a RLS não sabe dizer: "as pontas não mudaram" ----------
-- `with check` enxerga só a linha NOVA. "O destinatário não pode redirecionar o envio" é uma comparação
-- entre a linha VELHA e a NOVA — e isso é um gatilho, não uma política. Sem ele, quem enxerga o destino
-- passaria no `using` (pela ponta dele) e no `with check` (a linha continua tendo aquele destino) enquanto
-- reescreve a ORIGEM para uma empresa sua: a transferência mudaria de remetente sem que ninguém recusasse.
--
-- A recusa é `VALIDATION_ERROR` (P0001), que a API já traduz para 422 — erro de negócio legível, não 500.
create or replace function erp.travar_pontas_transferencia_origem() returns trigger language plpgsql as $$
begin
  if NEW.empresa_origem_id is distinct from OLD.empresa_origem_id
     or NEW.empresa_destino_id is distinct from OLD.empresa_destino_id then
    if not erp.empresa_escrita_permitida(OLD.empresa_origem_id) or not erp.empresa_escrita_permitida(NEW.empresa_origem_id) then
      raise exception 'VALIDATION_ERROR: mudar a origem ou o destino de uma transferencia exige autoridade sobre a empresa de ORIGEM' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;
-- `erp.animal_movements` chama a origem de `empresa_id` (o movimento sai da empresa dele).
create or replace function erp.travar_pontas_movimento_animal() returns trigger language plpgsql as $$
begin
  if NEW.empresa_id is distinct from OLD.empresa_id
     or NEW.empresa_destino_id is distinct from OLD.empresa_destino_id then
    if not erp.empresa_escrita_permitida(OLD.empresa_id) or not erp.empresa_escrita_permitida(NEW.empresa_id) then
      raise exception 'VALIDATION_ERROR: mudar a origem ou o destino de uma movimentacao exige autoridade sobre a empresa de ORIGEM' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_travar_pontas on erp.equipment_transfers;
create trigger trg_travar_pontas before update on erp.equipment_transfers for each row execute function erp.travar_pontas_transferencia_origem();
drop trigger if exists trg_travar_pontas on erp.warehouse_transfers;
create trigger trg_travar_pontas before update on erp.warehouse_transfers for each row execute function erp.travar_pontas_transferencia_origem();
drop trigger if exists trg_travar_pontas on erp.animal_movements;
create trigger trg_travar_pontas before update on erp.animal_movements for each row execute function erp.travar_pontas_movimento_animal();

-- D — a própria tabela de Empresas.
-- O seletor de empresa não pode depender do módulo ativo: a mesma lista alimenta telas de vários módulos, e
-- recortá-la pelo módulo da rota faria a empresa sumir do seletor conforme a tela aberta. A regra é a união
-- — enxerga quem enxerga aquela empresa em ALGUM módulo —, que é exatamente `empresasVisiveisNaOrganizacao`.
-- Isso NÃO é "listagem aberta do tenant": quem não enxerga a empresa em módulo nenhum não a vê aqui.
--
-- INSERT é só de tenant: criar empresa é ato de ORGANIZAÇÃO (permissão `farms.create`, classificada como
-- recurso de organização) e uma empresa recém-criada não está no escopo de ninguém — exigir escopo para
-- criá-la seria circular. Quem pode criar é decidido na API por `exigirEscopoTotalDaOrganizacao`, que faz a
-- MESMA pergunta do `using` daqui (`escopo_empresa_total(null)`): sem isso o INSERT passaria e a leitura de
-- volta não acharia a própria linha, devolvendo 404 e desfazendo a transação inteira.
-- UPDATE e DELETE continuam limitados ao que o `using` deixa enxergar.
drop policy if exists tenant_isolation on erp.empresas;
drop policy if exists tenant_e_empresa on erp.empresas;
drop policy if exists tenant_e_empresa_select on erp.empresas;
drop policy if exists tenant_e_empresa_insert on erp.empresas;
drop policy if exists tenant_e_empresa_update on erp.empresas;
drop policy if exists tenant_e_empresa_delete on erp.empresas;
create policy tenant_e_empresa_select on erp.empresas for select to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(null::text)) or id in (select erp.empresas_do_membro(null::text))));
create policy tenant_e_empresa_insert on erp.empresas for insert to erp_app, authenticated
  with check (erp.tenant_visible(organization_id));
create policy tenant_e_empresa_update on erp.empresas for update to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(null::text)) or id in (select erp.empresas_do_membro(null::text))))
  with check (erp.tenant_visible(organization_id));
create policy tenant_e_empresa_delete on erp.empresas for delete to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(null::text)) or id in (select erp.empresas_do_membro(null::text))));

comment on policy tenant_e_empresa_select on erp.empresas is 'PRE-BASE2-03: empresa visivel = a que o membro enxerga em ALGUM modulo (uniao), nunca a organizacao inteira. Uniao e nao modulo ativo porque o seletor e compartilhado entre telas de modulos diferentes.';

-- =====================================================================================================
-- AGREGADO ORGANIZACIONAL DA CONTA BANCÁRIA
--
-- O CONTRATO (docs/AUTHORIZATION.md, docs/MULTI-COMPANY-CONTRACT.md §7, DECISIONS #36f): saldo, fluxo e
-- extrato de CONTA BANCÁRIA são números da ORGANIZAÇÃO. A conta é cadastro da organização, o
-- `opening_balance` dela não tem empresa, e recortar por empresa devolveria um extrato que NÃO FECHA. Por
-- isso as três portas exigem a capacidade de ORGANIZAÇÃO (`bank_accounts.view`) por cima da permissão
-- financeira — ninguém passa a ver o que não via antes.
--
-- O QUE A RLS EMPRESARIAL FEZ COM ELE
--
-- `erp.bank_movements` tem `empresa_id` anulável e virou categoria B: company-scoped, corretamente. Mas as
-- rotas de CONTA abrem a transação SEM módulo (são recursos de organização), e sem módulo o predicado vale
-- a UNIÃO das empresas do membro — que não é "todas as empresas da organização". Resultado medido:
--
--     opening_balance ....... 100  (da organização: `bank_accounts` não tem empresa)
--   + movimento da empresa A .. 10  (visível)
--   + movimento da empresa B .. 20  (INVISÍVEL para quem só enxerga A)
--   = saldo devolvido ....... 110, quando o extrato do banco diz 130.
--
-- Segurança mais restritiva não pode produzir número financeiro FALSO. Um saldo que não bate com o banco é
-- pior que um saldo negado: ninguém desconfia dele.
--
-- A SAÍDA, E POR QUE ESTA E NÃO OUTRA
--
-- Não dá para resolver afrouxando a RLS de `erp.bank_movements` (o recorte por empresa está certo para a
-- listagem de movimentos), nem somando uma política permissiva condicionada à capacidade (políticas
-- PERMISSIVE se combinam com OR: a listagem de movimentos também abriria), nem com uma GUC de "modo
-- organizacional" (uma chave que desliga o recorte é uma chave que alguém vai esquecer ligada).
--
-- A saída é uma função ESTREITA: ela não é uma porta para consultar tabela arbitrária, é a única leitura
-- organizacional de movimento de conta que existe. Cinco propriedades a tornam segura:
--   1. não recebe organização por parâmetro — lê da GUC que o servidor define (`erp.current_org_id()`);
--   2. confere as capacidades DE NOVO aqui dentro, e levanta erro se faltarem (a API já confere; esta é a
--      segunda linha, para o dia em que alguém chamar a função de outro lugar);
--   3. filtra `organization_id = <organização atual>` nas DUAS tabelas — o tenant nunca depende da RLS
--      desligada, é predicado explícito;
--   4. `search_path` fixo e nenhum SQL dinâmico;
--   5. `execute` revogado de `public` e concedido só ao papel da aplicação.
-- =====================================================================================================

create or replace function erp.movimentos_conta_organizacao(
  p_contas uuid[] default null, p_de date default null, p_ate date default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, movement_date date, type text,
  amount numeric, interest numeric, note text, document text, categories text, created_at timestamptz)
language plpgsql stable security definer set search_path = erp, pg_catalog as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
begin
  if v_org is null or v_user is null then
    raise exception 'CONTEXTO_AUSENTE: agregado de conta exige organizacao e usuario na transacao' using errcode = '42501';
  end if;
  -- As MESMAS capacidades que a rota exige. `bank_accounts.view` é a de ORGANIZAÇÃO; `bank_movements.view`
  -- é a financeira por cima. Sem as duas, esta função não é uma porta.
  if not erp.has_permission(v_org, v_user, 'bank_accounts.view')
     or not erp.has_permission(v_org, v_user, 'bank_movements.view') then
    raise exception 'SEM_CAPACIDADE: agregado organizacional de conta exige bank_accounts.view e bank_movements.view' using errcode = '42501';
  end if;
  return query
    select m.id, m.bank_account_id, a.code, m.movement_date, m.type, m.amount, m.interest, m.note, m.document,
           (select string_agg(fc.name, ', ') from erp.bank_movement_apportionments ap
              join erp.financial_categories fc on fc.id = ap.financial_category_id
             where ap.movement_id = m.id) as categories,
           m.created_at
      from erp.bank_movements m
      join erp.bank_accounts a on a.id = m.bank_account_id
     where m.organization_id = v_org and a.organization_id = v_org
       and m.status = 'confirmed' and m.deleted_at is null
       and (p_contas is null or m.bank_account_id = any(p_contas))
       and (p_de is null or m.movement_date >= p_de)
       and (p_ate is null or m.movement_date <= p_ate);
end $$;
comment on function erp.movimentos_conta_organizacao(uuid[], date, date) is
  'Movimentos CONFIRMADOS das contas bancarias da organizacao atual, para o agregado ORGANIZACIONAL (saldo, fluxo, extrato). SECURITY DEFINER estreita: organizacao vem da GUC do servidor, capacidades conferidas aqui dentro, tenant por predicado explicito. Nao substitui a RLS de erp.bank_movements, que continua recortando por empresa em toda leitura normal.';
revoke execute on function erp.movimentos_conta_organizacao(uuid[], date, date) from public;
grant execute on function erp.movimentos_conta_organizacao(uuid[], date, date) to erp_app;
