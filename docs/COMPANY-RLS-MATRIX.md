<!-- GERADO por scripts/company-rls-matrix.mjs — não edite à mão. -->
# Matriz de RLS empresarial

> Documento **gerado**: `node scripts/company-rls-matrix.mjs`. Conferido no `lint` (`--check`) contra o
> schema real, e conferido contra o BANCO por `apps/api/test/integration/rls-matriz.test.ts`.

Desde a PRE-BASE2-03 a autoridade efetiva de um registro é **TENANT (RLS) ∧ ESCOPO DE EMPRESA (RLS) ∧
CAPACIDADE (API)**. A capacidade continua na aplicação de propósito: ela é por ROTA, e o banco não sabe qual
rota está rodando.

**O erro que a migration evita.** Políticas `PERMISSIVE` do PostgreSQL combinam com **OR**. Acrescentar uma
política de empresa ao lado da `tenant_isolation` existente não restringiria nada — a antiga sozinha
continuaria liberando a organização inteira. Por isso cada política tenant-only foi **substituída**, nunca
somada, e há um teste que reintroduz a política antiga de propósito e exige que o vazamento reapareça.

**Módulo indefinido.** Rota de organização e porta de permissão dinâmica abrem a transação sem módulo. Nesse
caso o predicado vale a **união** das empresas visíveis em algum módulo — nunca "todas", nunca "nada".

**Uma política POR COMANDO onde leitura ≠ escrita.** O PostgreSQL aplica `using` no SELECT, no UPDATE da
linha ANTIGA e no DELETE; e `with check` no INSERT e no UPDATE da linha NOVA. Uma política `for all`
tem um `using` só — então, quando a regra de escrita é mais restrita que a de leitura, ela passa a dizer
que **poder ler é poder apagar**, e que uma linha legível pode ser TRANSFORMADA em qualquer linha que passe
no `with check`. Isso vale para dois casos desta matriz:

- **B (empresa anulável)** — nulo é "da ORGANIZAÇÃO". Quem enxerga uma empresa lê a linha global, mas não
  pode apagá-la nem convertê-la numa linha da empresa dele.
- **C (transferência)** — lê-se por qualquer ponta; APAGAR e ALTERAR respondem pela ORIGEM. Receber não é
  poder desfazer o envio.

Onde leitura = escrita (**A**, empresa obrigatória), a política `for all` continua: dividir ali repetiria
a mesma expressão quatro vezes. A coluna "Semântica POR COMANDO" diz qual predicado cada comando usa, e
`apps/api/test/integration/rls-matriz.test.ts` confere isso contra `pg_policies` (cmd, qual, with_check
e nenhuma segunda política PERMISSIVE no mesmo comando).

**Forma do predicado (e por que ela importa).** O predicado de leitura é escrito INLINE na política:

```sql
(empresa_id is null
 or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))          -- InitPlan: 1×
 or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))  -- hashed SubPlan: 1×
```

Chamar `erp.empresa_no_escopo(empresa_id)` diria a mesma coisa, mas é um predicado POR LINHA: o executor
o chama uma vez para cada linha lida, e cada chamada roda dois `exists`. Medido em base com volume
(200 mil movimentações, 100 mil títulos, 30 empresas, membro com 10 delas no escopo), pelo papel da
aplicação, com `EXPLAIN (analyze)`:

| Caminho | Predicado por linha | Predicado resolvido 1× | Ganho |
| --- | ---: | ---: | ---: |
| Financeiro — títulos em aberto (janela de 50) | 34 393 ms | **55 ms** | 625× |
| Financeiro — painel, agregado por direção | 30 039 ms | **58 ms** | 518× |
| Relatório — movimentações × armazém (junção de duas tabelas de empresa) | 20 623 ms | **107 ms** | 193× |
| Estoque — listagem de movimentações (janela de 50) | 4 081 ms | **13 ms** | 314× |
| Estoque — contagem em janela (1 000) | 1 017 ms | **2 ms** | 509× |
| Estoque — listagem com empresa selecionada | 28 ms | **10 ms** | 2,8× |
| Seletor de empresa (módulo indefinido = união) | 10 ms | **1 ms** | 10× |

O recorte é idêntico nas duas formas (10 de 30 empresas: 66 669 de 200 000 movimentações, 33 339 de 100 000
títulos, 10 empresas no seletor) — muda o PLANO, não a autorização. Só a leitura precisa dessa forma:
`with check` roda por linha escrita, onde uma chamada é uma chamada.

## Categorias

- **A** — EMPRESA ÚNICA OBRIGATÓRIA (36 tabelas)
- **B** — EMPRESA ÚNICA ANULÁVEL (6 tabelas)
- **C** — ORIGEM + DESTINO (3 tabelas)
- **D** — TABELA EMPRESAS (1 tabela)
- **E** — PORTA DINÂMICA / ESPECIAL (7 tabelas)
- **F** — ORGANIZAÇÃO — SEM RLS EMPRESARIAL (1 tabela)

## Tabelas (54)

| Tabela | Coluna(s) canônica(s) | Módulo | Cat. | Nulo? | Leitura | Escrita | Semântica POR COMANDO |
| --- | --- | --- | :---: | :---: | --- | --- | --- |
| `erp.animal_handlings` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.animal_movements` | `empresa_id` + `empresa_destino_id` | pecuaria | C | não | qualquer ponta no escopo | criar e APAGAR respondem pela ORIGEM; alterar vale por qualquer ponta (o destinatário aceita/cancela), e mudar as PONTAS exige a origem — gatilho `trg_travar_pontas` | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=leitura · check=leitura<br>DELETE: using=**escrita** |
| `erp.animal_retroactive_costs` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.animals` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.areas` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.authorizer_empresas` | `empresa_id` | — | E | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.bank_account_empresas` | `empresa_id` | — | E | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.bank_movements` | `empresa_id` | financeiro | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.batches` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.breeding_seasons` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.budget_plannings` | `empresa_id` | financeiro | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.contracts` | `empresa_id` | financeiro | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.devolutions` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.dfe_documents` | `empresa_id` | fiscal | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.diet_batches` | `empresa_id` | confinamento | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.documents` | `empresa_id` | documentos | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.earnings` | `empresa_id` | pessoas_rh | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.empresa_cost_centers` | `empresa_id` | — | E | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.empresas` | `id` | (seletor: união dos módulos) | D | não | empresa visível em ALGUM módulo (união) | tenant (criar empresa é ato de organização) | SELECT: using=leitura<br>INSERT: check=tenant<br>UPDATE: using=leitura · check=tenant<br>DELETE: using=leitura |
| `erp.equipment_transfers` | `empresa_origem_id` + `empresa_destino_id` | frota_ativos | C | não | qualquer ponta no escopo | criar e APAGAR respondem pela ORIGEM; alterar vale por qualquer ponta (o destinatário aceita/cancela), e mudar as PONTAS exige a origem — gatilho `trg_travar_pontas` | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=leitura · check=leitura<br>DELETE: using=**escrita** |
| `erp.equipments` | `empresa_id` | frota_ativos | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.feed_batches` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.feed_deliveries` | `empresa_id` | confinamento | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.feedlot_yards` | `empresa_id` | confinamento | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.financial_freezes` | `empresa_id` | financeiro | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.financial_titles` | `empresa_id` | financeiro | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.fuel_supplies` | `empresa_id` | frota_ativos | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.grazing_modules` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.herd_lots` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.input_entries` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.invoices` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.journal_entries` | `empresa_id` | fiscal | B | sim | empresa no escopo do módulo; registro SEM empresa continua visível | empresa no escopo; SEM empresa exige escopo total do módulo | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=**escrita** · check=**escrita**<br>DELETE: using=**escrita** |
| `erp.legado_escopo_empresa_v0` | `empresa_id` | — | F | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.livestock_plannings` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.maintenances` | `empresa_id` | frota_ativos | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.membro_empresas` | `empresa_id` | — | E | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.notifications` | `empresa_id` | — | E | sim | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.opening_balances` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.processings` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.proprietary_empresas` | `empresa_id` | — | E | não | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.purchase_requests` | `empresa_id` | compras | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.rainfalls` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.registros_globais` | `empresa_id` | — | E | sim | regra própria (ver justificativa) | regra própria (ver justificativa) | — (a proteção é outra; ver justificativa) |
| `erp.requisitions` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.salary_advances` | `empresa_id` | pessoas_rh | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.sales_documents` | `empresa_id` | vendas | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.service_orders` | `empresa_id` | ordens_servico | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.stock_corrections` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.stock_movements` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.stock_writeoffs` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.trough_readings` | `empresa_id` | confinamento | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.warehouse_transfers` | `empresa_origem_id` + `empresa_destino_id` | estoque | C | não | qualquer ponta no escopo | criar e APAGAR respondem pela ORIGEM; alterar vale por qualquer ponta (o destinatário aceita/cancela), e mudar as PONTAS exige a origem — gatilho `trg_travar_pontas` | SELECT: using=leitura<br>INSERT: check=**escrita**<br>UPDATE: using=leitura · check=leitura<br>DELETE: using=**escrita** |
| `erp.warehouses` | `empresa_id` | estoque | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |
| `erp.weighings` | `empresa_id` | pecuaria | A | não | empresa no escopo do módulo | empresa no escopo do módulo | ALL: using=leitura · check=**escrita** |

## Exceções — por que a RLS empresarial genérica não se aplica

Nenhuma linha aqui significa "sem proteção": significa "protegida por outra regra", e a regra está nomeada.

| Tabela | Cat. | Justificativa |
| --- | :---: | --- |
| `erp.authorizer_empresas` | E | Vínculo de CONFIGURAÇÃO (cadastro × empresas de abrangência), sem organization_id próprio. Recortá-lo pelo módulo ativo esconderia do administrador empresas já vinculadas — e salvar a tela devolveria uma lista incompleta, apagando vínculos que ele nunca viu. Protegida por: política api_child (junção com o cadastro pai, que é da organização) + capacidade do cadastro |
| `erp.bank_account_empresas` | E | Mesmo caso de authorizer_empresas: vínculo de abrangência de um cadastro de organização. Protegida por: política api_child + bank_accounts.edit |
| `erp.empresa_cost_centers` | E | Mesmo caso: diz em quais empresas o centro de custo se aplica. Protegida por: política api_child + cost_centers.edit |
| `erp.legado_escopo_empresa_v0` | F | Arquivo morto de erp.member_farms (PRE-BASE2-03). Não é autoridade de nada, não tem tela e não é lido por runtime algum; existe para que a migração seja reversível sem backup externo. Protegida por: tenant_isolation, sem grant de escrita |
| `erp.membro_empresas` | E | É a própria CONFIGURAÇÃO de autorização por empresa. Recortá-la pelo escopo que ela define seria circular: o administrador deixaria de enxergar as empresas que acabou de conceder. Protegida por: tenant_isolation + capacidade users.edit na borda de administração |
| `erp.notifications` | E | Porta DINÂMICA: a autorização de cada aviso vem da FONTE dele (tipo × capacidade × escopo × empresa gravados na própria linha, erp.tipos_notificacao), não do módulo ativo da rota. Uma política pelo módulo da rota recortaria o aviso de compras quando lido pela tela de estoque. Protegida por: visibilidadeNotificacaoSql + erp.tipos_notificacao (PRE-BASE2-02), com matriz própria em docs/NOTIFICATION-SCOPE-MATRIX.md |
| `erp.proprietary_empresas` | E | Mesmo caso: abrangência do proprietário. Protegida por: política api_child + proprietaries.edit |
| `erp.registros_globais` | E | `empresa_id` aqui é DICA denormalizada, não autoridade: a resolução de #N carrega o registro FONTE vivo e tira dele a empresa atual. Recortar pela dica faria o ID Global de um registro transferido de empresa sumir para quem hoje o enxerga. Protegida por: resolução pela entidade fonte (docs/GLOBAL-ID-CONTRACT.md); PRE-BASE2-04 cuida da alocação |
