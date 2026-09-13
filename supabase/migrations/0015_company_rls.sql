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

  -- C — transferências entre empresas. TRÊS DOMÍNIOS, TRÊS CONTRATOS.
  --
  -- As três tabelas têm a mesma FORMA (duas colunas de empresa) e semânticas diferentes. Tratá-las como uma
  -- categoria só fez a regra mais permissiva das três virar a regra de todas — e a RLS passou a certificar
  -- uma autoridade que NENHUMA das operações reais precisa. A exceção de domínio tem de ser tão estreita
  -- quanto a ação de domínio.
  --
  --   C1 `animal_movements`  — a origem emite; o destino ACEITA. O aceite move animais que ainda são da
  --                            ORIGEM, então ele não cabe no UPDATE normal: é a função privilegiada
  --                            `erp.processar_transferencia_pecuaria_destino` (seção 2c). UPDATE normal e
  --                            DELETE respondem pela ORIGEM. O destino lê, e só.
  --   C2 `warehouse_transfers` — a criação já lança no ledger das DUAS empresas (e pode gerar título nos
  --                            dois lados), e a rota exige `assertFarm` nas duas pontas. O cancelamento
  --                            precisa ESTORNAR os dois lados, e `reverseStock` lê `erp.stock_movements`
  --                            pela RLS normal: quem enxerga uma ponta só estornaria metade do ledger.
  --                            Por isso INSERT/UPDATE/DELETE exigem as DUAS pontas — o banco não certifica
  --                            um contrato mais largo do que a operação.
  --   C3 `equipment_transfers` — a criação move o bem na hora e exige origem E destino; NÃO existe rota de
  --                            aceite posterior. Nada a alterar depois pelo destino: UPDATE/DELETE são da
  --                            ORIGEM, INSERT exige as duas pontas.
  --
  -- Em todas as três a LEITURA vale pelas duas pontas: quem recebe precisa ver o que está chegando.
  -- VISIBILIDADE BILATERAL NÃO É AUTORIDADE DE MUTAÇÃO BILATERAL.
  for r in select unnest(pares) as tabela loop
    foreach n in array nomes loop execute format('drop policy if exists %I on erp.%I', n, r.tabela); end loop;
  end loop;

  -- C1 — `animal_movements` nomeia a origem como `empresa_id` (o lote sai da empresa do movimento).
  -- O destino LÊ pelo envelope; alterar a linha é da ORIGEM. O aceite não é um UPDATE do destinatário:
  -- é a operação privilegiada da seção 2c, que move os ativos e só então confirma.
  execute format('create policy tenant_e_empresa_select on erp.animal_movements for select to erp_app, authenticated using (%s and (%s or %s))',
                 tenant, format(leitura, 'empresa_id'), format(leitura, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_insert on erp.animal_movements for insert to erp_app, authenticated with check (%s and %s)',
                 tenant, format(escrita, 'empresa_id'));
  execute format('create policy tenant_e_empresa_update on erp.animal_movements for update to erp_app, authenticated using (%s and %s) with check (%s and %s)',
                 tenant, format(escrita, 'empresa_id'), tenant, format(escrita, 'empresa_id'));
  execute format('create policy tenant_e_empresa_delete on erp.animal_movements for delete to erp_app, authenticated using (%s and %s)',
                 tenant, format(escrita, 'empresa_id'));

  -- C2 — `warehouse_transfers`: a operação toca as DUAS empresas, então a autoridade é das duas.
  execute format('create policy tenant_e_empresa_select on erp.warehouse_transfers for select to erp_app, authenticated using (%s and (%s or %s))',
                 tenant, format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_insert on erp.warehouse_transfers for insert to erp_app, authenticated with check (%s and %s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'), format(escrita, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_update on erp.warehouse_transfers for update to erp_app, authenticated using (%s and %s and %s) with check (%s and %s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'), format(escrita, 'empresa_destino_id'),
                 tenant, format(escrita, 'empresa_origem_id'), format(escrita, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_delete on erp.warehouse_transfers for delete to erp_app, authenticated using (%s and %s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'), format(escrita, 'empresa_destino_id'));

  -- C3 — `equipment_transfers`: criar exige as duas pontas (o bem muda de dono na hora); depois disso não
  -- há aceite nenhum, então alterar e apagar respondem pela ORIGEM.
  execute format('create policy tenant_e_empresa_select on erp.equipment_transfers for select to erp_app, authenticated using (%s and (%s or %s))',
                 tenant, format(leitura, 'empresa_origem_id'), format(leitura, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_insert on erp.equipment_transfers for insert to erp_app, authenticated with check (%s and %s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'), format(escrita, 'empresa_destino_id'));
  execute format('create policy tenant_e_empresa_update on erp.equipment_transfers for update to erp_app, authenticated using (%s and %s) with check (%s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'), tenant, format(escrita, 'empresa_origem_id'));
  execute format('create policy tenant_e_empresa_delete on erp.equipment_transfers for delete to erp_app, authenticated using (%s and %s)',
                 tenant, format(escrita, 'empresa_origem_id'));
end $$;

-- ---------- 2b) o que a RLS não sabe dizer: "as pontas não mudaram" ----------
-- `with check` enxerga só a linha NOVA: "a origem e o destino continuam os mesmos" é uma comparação entre a
-- linha VELHA e a NOVA, e isso é gatilho, não política.
--
-- Depois de estreitar o UPDATE para a ORIGEM (C1/C3) e para as DUAS pontas (C2), o gatilho deixou de ser a
-- única coisa entre o destinatário e o redirecionamento do envio — e é por isso que ele FICA: uma invariante
-- de ponta não deve depender de a política de UPDATE continuar estreita. Ele é defesa em profundidade, não
-- justificativa para abrir as demais colunas a quem só recebe.
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

-- ---------- 2c) o aceite do destinatário: operação ESTREITA, não autoridade ampla ----------
--
-- O aceite pecuário é a única exceção legítima de mutação pelo destinatário, e ela tem uma razão exata: o
-- destinatário ainda NÃO possui os animais, porque é justamente o aceite que os traz para o escopo dele.
-- Resolver isso abrindo o UPDATE de `erp.animals` seria dar-lhe autoridade sobre TODO o rebanho da origem.
--
-- O que a rota fazia antes era pior que um bypass: ela tentava o `update` normal, a RLS devolvia ZERO
-- linhas, e o `update` seguinte marcava `status='confirmed'` assim mesmo. O resultado não era "acesso
-- negado", era uma transferência CONFIRMADA com os animais ainda na origem — corrupção de estado que
-- ninguém reclama no dia e ninguém explica no fechamento.
--
-- Esta função é a porta, e ela é estreita de propósito: sabe QUAL transferência, QUAIS entidades, QUAL
-- origem, QUAL destino e QUAL ação. Não recebe organização do cliente, não monta SQL, não devolve registro
-- da origem, e confere capacidade E escopo do destino ANTES de mover qualquer coisa. Ou tudo acontece —
-- ativos, lote de destino e status — ou nada acontece.
create or replace function erp.processar_transferencia_pecuaria_destino(
  p_movimento uuid, p_lote_destino uuid default null)
returns table (animais integer, rebanhos integer, cabecas integer)
language plpgsql security definer set search_path = erp, pg_catalog as $$
declare
  v_org uuid := erp.current_org_id();
  v_user uuid := erp.effective_user_id();
  v_origem uuid; v_destino uuid; v_status text; v_lote uuid;
  v_esp_animais integer; v_esp_rebanhos integer; v_esp_cabecas integer;
  v_mov_animais integer; v_mov_rebanhos integer; v_mov_cabecas integer;
begin
  if v_org is null or v_user is null then
    raise exception 'CONTEXTO_AUSENTE: aceite de transferencia exige organizacao e usuario na transacao' using errcode = '42501';
  end if;
  -- a MESMA capacidade que a rota exige, reconferida aqui: a função é a porta, não um atalho da rota
  if not erp.has_permission(v_org, v_user, 'batch_farm_transfer.process') then
    raise exception 'PERMISSION_DENIED: aceitar transferencia de rebanho exige batch_farm_transfer.process' using errcode = 'P0001';
  end if;

  -- a transferência é identificada pelo PRÓPRIO id; origem e destino saem dela, nunca do payload
  select m.empresa_id, m.empresa_destino_id, m.status, m.destination_batch_id
    into v_origem, v_destino, v_status, v_lote
    from erp.animal_movements m
   where m.id = p_movimento and m.organization_id = v_org
     and m.movement_type = 'farm_transfer' and m.deleted_at is null
   for update;
  if not found then
    raise exception 'NOT_FOUND: transferencia de rebanho nao encontrada nesta organizacao' using errcode = 'P0001';
  end if;
  if v_status <> 'pending' then
    raise exception 'ALREADY_CONFIRMED: transferencia ja processada' using errcode = 'P0001';
  end if;
  if v_destino is null or v_destino = v_origem then
    raise exception 'VALIDATION_ERROR: transferencia sem empresa de destino distinta da origem' using errcode = 'P0001';
  end if;
  if not exists (select 1 from erp.empresas e
                  where e.id = v_destino and e.organization_id = v_org and e.deleted_at is null) then
    raise exception 'VALIDATION_ERROR: empresa de destino nao pertence a esta organizacao' using errcode = 'P0001';
  end if;
  -- quem aceita é o DESTINATÁRIO: acesso real à empresa de destino, no módulo do domínio
  if not erp.tem_acesso_empresa(v_org, v_user, 'pecuaria', v_destino) then
    raise exception 'PERMISSION_DENIED: aceitar exige acesso a empresa de destino no modulo pecuaria' using errcode = 'P0001';
  end if;

  v_lote := coalesce(p_lote_destino, v_lote);
  if v_lote is not null and not exists (
        select 1 from erp.batches b
         where b.id = v_lote and b.organization_id = v_org
           and b.empresa_id = v_destino and b.status = 'active' and b.deleted_at is null) then
    raise exception 'VALIDATION_ERROR: lote de destino invalido, inativo ou de outra empresa' using errcode = 'P0001';
  end if;

  -- O QUE a transferência carrega: só o que está EXPLICITAMENTE vinculado a ela.
  select count(*) filter (where i.animal_id is not null),
         count(*) filter (where i.herd_lot_id is not null),
         coalesce(sum(i.quantity), 0)
    into v_esp_animais, v_esp_rebanhos, v_esp_cabecas
    from erp.animal_movement_items i where i.movement_id = p_movimento;
  if v_esp_animais + v_esp_rebanhos = 0 then
    raise exception 'VALIDATION_ERROR: transferencia sem animais ou rebanhos vinculados' using errcode = 'P0001';
  end if;

  -- Move SÓ o que está vinculado e SÓ o que ainda está na ORIGEM. O predicado da origem é o que impede
  -- que um acervo mexido por fora entre carona no aceite.
  -- `status` e `deleted_at` são reconferidos AQUI, e não só na emissão: entre emitir e aceitar o animal pode
  -- ter sido vendido, morto, perdido ou excluído. Sem esta releitura o aceite moveria de empresa um animal
  -- que não existe mais operacionalmente — e o faria por dentro de um SECURITY DEFINER, sem RLS no caminho.
  -- Quem cair fora do predicado não entra na contagem, e o confronto esperado × efetivo derruba tudo.
  with movidos as (
    update erp.animals a set empresa_id = v_destino, batch_id = v_lote, updated_at = now()
     where a.organization_id = v_org and a.empresa_id = v_origem
       and a.status = 'active' and a.deleted_at is null
       and a.id in (select i.animal_id from erp.animal_movement_items i
                     where i.movement_id = p_movimento and i.animal_id is not null)
    returning 1)
  select count(*)::integer into v_mov_animais from movidos;

  with movidos as (
    update erp.herd_lots l set empresa_id = v_destino, batch_id = v_lote, updated_at = now()
     where l.organization_id = v_org and l.empresa_id = v_origem and l.quantity > 0
       and l.id in (select i.herd_lot_id from erp.animal_movement_items i
                     where i.movement_id = p_movimento and i.herd_lot_id is not null)
    returning l.quantity)
  select count(*)::integer, coalesce(sum(quantity), 0)::integer into v_mov_rebanhos, v_mov_cabecas from movidos;

  -- ROW COUNT: esperado × efetivo. Divergir aqui é rollback total — nunca "confirmado com o que deu".
  if v_mov_animais <> v_esp_animais or v_mov_rebanhos <> v_esp_rebanhos then
    raise exception 'VALIDATION_ERROR: a transferencia esperava % animal(is) e % rebanho(s) na empresa de origem; moveu % e %. Nada foi alterado.',
      v_esp_animais, v_esp_rebanhos, v_mov_animais, v_mov_rebanhos using errcode = 'P0001';
  end if;
  if v_mov_animais + v_mov_cabecas <> v_esp_cabecas then
    raise exception 'VALIDATION_ERROR: a transferencia esperava % cabeca(s) e moveu %. Nada foi alterado.',
      v_esp_cabecas, v_mov_animais + v_mov_cabecas using errcode = 'P0001';
  end if;

  -- só DEPOIS do efeito completo o documento vira confirmado
  update erp.animal_movements
     set status = 'confirmed', destination_batch_id = v_lote, updated_at = now()
   where id = p_movimento;

  animais := v_mov_animais; rebanhos := v_mov_rebanhos; cabecas := v_mov_animais + v_mov_cabecas;
  return next;
end $$;
comment on function erp.processar_transferencia_pecuaria_destino(uuid, uuid) is
  'ACEITE da transferencia de rebanho pela empresa de DESTINO (PRE-BASE2-03). SECURITY DEFINER estreita: organizacao e usuario vem da GUC do servidor, capacidade e escopo do destino conferidos aqui dentro, move SOMENTE os itens vinculados a esta transferencia que ainda estao na empresa de ORIGEM, confere row counts e so entao confirma. Nao e uma porta generica: nao recebe organizacao, nao monta SQL e nao devolve registro algum da origem.';
revoke execute on function erp.processar_transferencia_pecuaria_destino(uuid, uuid) from public;
grant execute on function erp.processar_transferencia_pecuaria_destino(uuid, uuid) to erp_app;

-- A EXISTÊNCIA de uma empresa na organização NÃO é uma pergunta de escopo.
--
-- `erp.empresas` é lida pelo escopo (categoria D), e é assim que tem de ser para o seletor. Mas "este UUID é
-- uma empresa da MINHA organização?" é outra pergunta: é ela que a emissão de uma transferência faz sobre o
-- DESTINO — que o remetente legitimamente não enxerga, porque quem aceita é o destinatário. Respondê-la pela
-- política de leitura transformava "não vejo" em "não existe", e a rota recusava com 422 uma transferência
-- perfeitamente válida. Esta função responde só isso, dentro do tenant do servidor, e nada mais: não devolve
-- nome, nem lista, nem qualquer atributo da empresa.
create or replace function erp.empresa_da_organizacao_atual(p_empresa uuid) returns boolean
language sql stable security definer set search_path = erp, pg_catalog as $$
  select p_empresa is not null and erp.current_org_id() is not null and exists (
    select 1 from erp.empresas e
     where e.id = p_empresa and e.organization_id = erp.current_org_id() and e.deleted_at is null)
$$;
comment on function erp.empresa_da_organizacao_atual(uuid) is
  'A empresa existe NESTA organizacao? (PRE-BASE2-03) Pergunta de TENANT, nao de escopo: usada na emissao de transferencia para validar um destino que o remetente nao enxerga. Definer estreita, organizacao da GUC do servidor, devolve apenas booleano.';
revoke execute on function erp.empresa_da_organizacao_atual(uuid) from public;
grant execute on function erp.empresa_da_organizacao_atual(uuid) to erp_app;

-- A EXISTÊNCIA de um LOTE na empresa também não é pergunta de escopo.
--
-- Pelo mesmo motivo do destino: quem emite a transferência informa o lote de DESTINO, que está na empresa
-- que ele não enxerga. Perguntar isso pela política de leitura transformaria "não vejo" em "não existe" e
-- recusaria uma emissão legítima. Esta função responde só "este lote é desta organização, desta empresa, e
-- está ativo?" — booleano, tenant da GUC do servidor, nenhum atributo do lote devolvido.
create or replace function erp.lote_da_empresa_atual(p_lote uuid, p_empresa uuid) returns boolean
language sql stable security definer set search_path = erp, pg_catalog as $$
  select p_lote is not null and p_empresa is not null and erp.current_org_id() is not null and exists (
    select 1 from erp.batches b
     where b.id = p_lote and b.organization_id = erp.current_org_id()
       and b.empresa_id = p_empresa and b.status = 'active' and b.deleted_at is null)
$$;
comment on function erp.lote_da_empresa_atual(uuid, uuid) is
  'O lote e desta organizacao, desta empresa e esta ativo? (PRE-BASE2-03) Pergunta de TENANT/INTEGRIDADE, nao de escopo: usada na emissao de transferencia de rebanho para validar o lote de DESTINO, que o remetente nao enxerga. Definer estreita, organizacao da GUC do servidor, devolve apenas booleano.';
revoke execute on function erp.lote_da_empresa_atual(uuid, uuid) from public;
grant execute on function erp.lote_da_empresa_atual(uuid, uuid) to erp_app;

-- ---------- 2d) integridade da EMISSÃO da transferência de rebanho ----------
--
-- A emissão recebe do cliente uma LISTA DE UUIDs (`animal_ids`), um lote de origem e um lote de destino. E
-- as chaves estrangeiras que os recebem são GLOBAIS: `erp.animal_movement_items.animal_id` referencia
-- `erp.animals(id)` sem organização, `animal_movements.batch_id` referencia `erp.batches(id)` sem empresa.
--
-- O que a FK prova é "este UUID existe". O que ela NÃO prova é "este UUID é desta organização". A diferença
-- não é teórica: um UUID conhecido de outro tenant é um valor perfeitamente aceitável para a FK, e entrava
-- numa transferência desta organização sem que nada reclamasse. Pior, o mesmo caminho aceitava animal
-- VENDIDO, MORTO ou EXCLUÍDO como cabeça viva — e o aceite depois o movia de empresa.
--
-- A rota já valida em lote e fail-closed. Este guard é a SEGUNDA linha, e existe porque autorização e
-- integridade que só moram no TypeScript morrem junto com o primeiro `insert` escrito fora da rota.
--
-- Ele é ESTREITO de propósito: só olha movimento `farm_transfer`. Compra, venda, nascimento, morte,
-- evolução e transferência entre lotes seguem exatamente como antes — inclusive referenciando animal morto
-- (é o que o documento de morte FAZ) ou de outra empresa do mesmo tenant. Um guard genérico aqui quebraria
-- o domínio inteiro para resolver um problema de uma operação só.
create or replace function erp.validar_item_transferencia_pecuaria() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
declare
  v_org uuid; v_origem uuid; v_tipo text; v_qtd integer;
begin
  select m.organization_id, m.empresa_id, m.movement_type
    into v_org, v_origem, v_tipo
    from erp.animal_movements m where m.id = new.movement_id;
  if v_tipo is distinct from 'farm_transfer' then
    return new;   -- fora da transferência entre empresas o comportamento legado é preservado
  end if;

  if new.animal_id is not null then
    if not exists (select 1 from erp.animals a
                    where a.id = new.animal_id and a.organization_id = v_org
                      and a.empresa_id = v_origem and a.status = 'active' and a.deleted_at is null) then
      -- mensagem GENÉRICA: distinguir "de outro tenant" de "morto" de "inexistente" seria um oráculo
      raise exception 'VALIDATION_ERROR: animal nao elegivel para esta transferencia de rebanho' using errcode = 'P0001';
    end if;
    if exists (select 1 from erp.animal_movement_items i
                where i.movement_id = new.movement_id and i.animal_id = new.animal_id and i.id <> new.id) then
      raise exception 'VALIDATION_ERROR: animal repetido na mesma transferencia de rebanho' using errcode = 'P0001';
    end if;
  end if;

  if new.herd_lot_id is not null then
    select l.quantity into v_qtd from erp.herd_lots l
     where l.id = new.herd_lot_id and l.organization_id = v_org and l.empresa_id = v_origem;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'VALIDATION_ERROR: rebanho nao elegivel para esta transferencia' using errcode = 'P0001';
    end if;
    -- a quantidade do item é o SNAPSHOT do rebanho na emissão: é ela que o aceite confere contra o efetivo
    if new.quantity is distinct from v_qtd then
      raise exception 'VALIDATION_ERROR: quantidade do rebanho incoerente com o acervo na emissao' using errcode = 'P0001';
    end if;
    if exists (select 1 from erp.animal_movement_items i
                where i.movement_id = new.movement_id and i.herd_lot_id = new.herd_lot_id and i.id <> new.id) then
      raise exception 'VALIDATION_ERROR: rebanho repetido na mesma transferencia de rebanho' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function erp.validar_item_transferencia_pecuaria() is
  'Guard de INTEGRIDADE dos itens de farm_transfer (PRE-BASE2-03): o animal/rebanho vinculado tem de ser da organizacao e da empresa de ORIGEM do movimento, ativo, nao excluido, com quantidade coerente e sem repeticao. Nao toca nenhum outro movement_type. Erro generico de proposito: nao distingue tenant alheio, empresa errada, estado invalido ou UUID inexistente.';

-- E os LOTES do próprio documento: `batch_id` é da empresa de ORIGEM, `destination_batch_id` é da empresa
-- de DESTINO, os dois da organização do movimento. Sem isto, um lote de outro tenant ficaria persistido
-- dentro de uma transferência desta organização mesmo que nenhum animal se movesse.
create or replace function erp.validar_lotes_transferencia_pecuaria() returns trigger
language plpgsql security definer set search_path = erp, pg_catalog as $$
begin
  if new.movement_type is distinct from 'farm_transfer' then
    return new;
  end if;
  if new.batch_id is not null and not exists (
       select 1 from erp.batches b
        where b.id = new.batch_id and b.organization_id = new.organization_id
          and b.empresa_id = new.empresa_id and b.deleted_at is null) then
    raise exception 'VALIDATION_ERROR: lote de origem nao elegivel para esta transferencia' using errcode = 'P0001';
  end if;
  if new.destination_batch_id is not null and not exists (
       select 1 from erp.batches b
        where b.id = new.destination_batch_id and b.organization_id = new.organization_id
          and b.empresa_id = new.empresa_destino_id and b.deleted_at is null) then
    raise exception 'VALIDATION_ERROR: lote de destino nao elegivel para esta transferencia' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.validar_lotes_transferencia_pecuaria() is
  'Guard de INTEGRIDADE dos lotes de farm_transfer (PRE-BASE2-03): batch_id pertence a organizacao e a empresa de ORIGEM, destination_batch_id a organizacao e a empresa de DESTINO. Nao toca nenhum outro movement_type.';

-- PREFLIGHT: um guard que pode tornar dado existente inválido não se instala às cegas. Se o acervo atual
-- já violar o invariante, a migration PARA com diagnóstico — não normaliza, não move registro, não apaga
-- item, não troca empresa. Fail-closed: corrigir dado de produção é decisão de gente, não de migration.
do $$
declare
  v_itens integer; v_rebanhos integer; v_lotes integer; v_destinos integer; v_dup integer;
begin
  select count(*) into v_itens
    from erp.animal_movement_items i join erp.animal_movements m on m.id = i.movement_id
   where m.movement_type = 'farm_transfer' and i.animal_id is not null
     and not exists (select 1 from erp.animals a
                      where a.id = i.animal_id and a.organization_id = m.organization_id and a.empresa_id = m.empresa_id);
  select count(*) into v_rebanhos
    from erp.animal_movement_items i join erp.animal_movements m on m.id = i.movement_id
   where m.movement_type = 'farm_transfer' and i.herd_lot_id is not null
     and not exists (select 1 from erp.herd_lots l
                      where l.id = i.herd_lot_id and l.organization_id = m.organization_id and l.empresa_id = m.empresa_id);
  select count(*) into v_lotes from erp.animal_movements m
   where m.movement_type = 'farm_transfer' and m.batch_id is not null
     and not exists (select 1 from erp.batches b
                      where b.id = m.batch_id and b.organization_id = m.organization_id and b.empresa_id = m.empresa_id);
  select count(*) into v_destinos from erp.animal_movements m
   where m.movement_type = 'farm_transfer' and m.destination_batch_id is not null
     and not exists (select 1 from erp.batches b
                      where b.id = m.destination_batch_id and b.organization_id = m.organization_id and b.empresa_id = m.empresa_destino_id);
  select count(*) into v_dup from (
    select i.movement_id, i.animal_id, i.herd_lot_id from erp.animal_movement_items i
      join erp.animal_movements m on m.id = i.movement_id
     where m.movement_type = 'farm_transfer'
     group by 1, 2, 3 having count(*) > 1) d;

  if v_itens + v_rebanhos + v_lotes + v_destinos + v_dup > 0 then
    raise exception 'PREFLIGHT PRE-BASE2-03: acervo de farm_transfer viola o invariante de empresa/organizacao antes do guard. Itens de animal fora da origem: %. Itens de rebanho fora da origem: %. Lotes de origem incompativeis: %. Lotes de destino incompativeis: %. Referencias repetidas: %. Nada foi normalizado: corrija o dado e rode a migration de novo.',
      v_itens, v_rebanhos, v_lotes, v_destinos, v_dup;
  end if;
end $$;

-- Os gatilhos disparam DEPOIS dos de compatibilidade (`trg_sync_*`, ordem alfabética do nome), para que
-- `empresa_id` já esteja preenchido quando o cliente antigo escrever pela coluna legada. E só nas colunas
-- que participam do invariante: o `update ... set quantity` que a rota faz no fim da emissão, por exemplo,
-- não precisa reabrir a validação.
drop trigger if exists trg_validar_item_transferencia_pecuaria on erp.animal_movement_items;
create trigger trg_validar_item_transferencia_pecuaria
  before insert or update of movement_id, animal_id, herd_lot_id, quantity on erp.animal_movement_items
  for each row execute function erp.validar_item_transferencia_pecuaria();
drop trigger if exists trg_validar_lotes_transferencia_pecuaria on erp.animal_movements;
create trigger trg_validar_lotes_transferencia_pecuaria
  before insert or update of movement_type, organization_id, empresa_id, empresa_destino_id, batch_id, destination_batch_id
  on erp.animal_movements
  for each row execute function erp.validar_lotes_transferencia_pecuaria();

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
