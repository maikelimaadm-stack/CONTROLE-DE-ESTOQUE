# Contrato multiempresa — Organização × Empresa

> Contrato de plataforma (PRE-BASE2-01). Implementação de referência: `packages/plataforma/src/empresa.ts`
> (puro e testado) + `apps/api/src/lib/empresa.ts` (ponte com o contexto atual).

## 1. Os dois conceitos nunca se colapsam

```
ORGANIZAÇÃO  (tenant/cliente do ERP)
  ├── EMPRESA A   (entidade operacional/jurídica)
  ├── EMPRESA B
  └── EMPRESA C
```

| Conceito | O que é | Onde aparece |
| --- | --- | --- |
| **Organização** | O cliente contratante. Unidade de isolamento de dados, de licenciamento, de permissões e da sequência de ID Global. | `organization_id` em toda tabela de negócio; RLS; `X-Org-Id`. |
| **Empresa** | A entidade operacional/jurídica dona do registro. Unidade de escopo de trabalho, filtro, relatório e autorização fina. | Coluna de empresa nos lançamentos; seleção de contexto; filtros e painéis. |

Uma organização com uma única empresa continua funcionando: a empresa é preenchida automaticamente
(ver §4). O que **não** pode acontecer é tratar organização e empresa como a mesma coisa — isso quebraria
o isolamento de tenant no dia em que um cliente tiver duas empresas.

> **Estado atual:** a Empresa é materializada pela tabela `erp.farms` e pelo vínculo `erp.member_farms`,
> nomes herdados do nicho agro. A troca de nomes é progressiva e tem plano próprio
> (`docs/DOMAIN-NAMING-STANDARD.md`, `docs/FARM-DEPENDENCY-INVENTORY.md`, PRE-BASE2-02/03).
> Este contrato existe justamente para que a regra não dependa do nome.

## 2. Autorização é do backend, sempre

A interface esconder o que o usuário não pode ver é **conveniência**. A autoridade é a API, o serviço e o RLS.

Para um usuário autorizado apenas na Empresa A, todas as portas abaixo respondem como se B e C não
existissem:

| Porta | Comportamento exigido |
| --- | --- |
| Listagem, busca, painel, relatório | Nenhuma linha de B/C. |
| Deep link / URL direta de registro de B/C | 404 (nunca 403: 403 confirmaria a existência). |
| ID Global de registro de B/C | 404. |
| Anexo, auditoria, histórico de registro de B/C | 404. |
| `empresa_id` de B/C enviado no corpo de um lançamento | Recusado. |
| Cabeçalho/parâmetro de empresa apontando para B/C | Recusado (403 quando é seleção explícita de contexto). |

**Regra de ouro:** empresa vinda do cliente é sempre pedido, nunca autorização. O servidor cruza o pedido
com a autorização do vínculo e o resultado só pode diminuir o escopo, jamais aumentá-lo.

### A autorização é EXPLÍCITA (sem sentinela)

O contrato canônico não tem lista vazia ambígua. `AutorizacaoEmpresas` é uma união discriminada:

| Valor | Significado |
| --- | --- |
| `{ modo: "todas" }` | Autorizado a todas as empresas da organização. |
| `{ modo: "selecionadas", empresaIds: [A, B] }` | Autorizado exatamente a A e B. |
| `{ modo: "selecionadas", empresaIds: [] }` | Autorizado a **NENHUMA** empresa. |

Num sistema multiempresa com autorização estrita, "autorizado a tudo" e "autorizado a nada" não podem ser o
mesmo valor: a diferença entre os dois é a diferença entre um painel vazio e um vazamento.

No runtime (§7) os mesmos três estados aparecem POR MÓDULO: `todas`, `selecionadas` (com ou sem empresas) e
"módulo sem configuração" — que é o mesmo que nenhuma empresa.

**Compatibilidade com o mecanismo legado.** A convenção herdada — lista vazia de fazendas significando
"todas" — não existe mais no runtime. Ela sobrevive apenas na BORDA de administração, onde o formato
`farm_ids` continua sendo aceito e traduzido para o modelo canônico
(`apps/api/src/lib/escopo-admin.ts`, testado em `apps/api/test/unit/empresa-bridge.test.ts`).

## 3. "Todas as empresas" é escopo, não empresa

`TODAS_EMPRESAS` (`"todas"`) é um **escopo de visualização**. Pode ser usado em consulta, listagem, painel,
relatório, indicador e busca. Nunca é persistido: não existe `empresa_id = "todas"` em lançamento algum
(`exigirEmpresaPersistivel` é a guarda).

Escopos possíveis na leitura:

| Escopo | Significado |
| --- | --- |
| `{ tipo: "todas" }` | Todas as empresas **autorizadas** (não necessariamente todas as da organização). |
| `{ tipo: "uma", empresaId }` | Uma empresa. |
| `{ tipo: "conjunto", empresaIds }` | Conjunto autorizado (consolidação parcial). |

`resolverEscopoEmpresa` devolve `empresaIds: null` quando não há recorte algum a aplicar (usuário autorizado
a tudo e sem filtro); qualquer outro caso devolve a lista explícita. Pedido fora da autorização resulta em
lista **vazia** (nenhuma linha) — nunca em "todas" —, e as empresas recusadas voltam em `recusadas` para
auditoria e para 403 quando a seleção foi explícita.

## 4. Empresa no lançamento

Um lançamento pertence **sempre a uma empresa concreta**, e a decisão nunca é tomada só com a autorização:
`selecionarEmpresaDoLancamento` exige a lista **server-side** das empresas realmente disponíveis na
organização e resolve pela **interseção `autorização ∩ disponíveis`**.

Por que a lista é obrigatória: `modo: "todas"` significa *todas as empresas da organização*, e **não**
"qualquer identificador que o cliente mandar". Sem o cruzamento, um id de outra organização — ou de empresa
excluída/inativa — passaria pela autorização "todas". Isso é exatamente a regra de ouro do §2 invertida.

| Situação | Resultado |
| --- | --- |
| Nenhuma empresa efetiva | `indisponivel` — estado explícito; não se inventa empresa padrão. |
| Uma única empresa efetiva | `automatica` — a interface preenche sem perguntar. |
| Mais de uma empresa efetiva | `obrigatoria` — seleção explícita, sem padrão implícito. |
| Empresa pedida dentro da interseção | `escolhida`. |
| Empresa pedida fora da interseção | `recusada` — **inclusive no modo "todas"**. |
| Pedido com `"todas"` | Erro de validação (escopo não é empresa). |

Exemplos da interseção (`disponiveis` = `[A, B, C]` salvo indicação):

| Autorização | Disponíveis | Efetivas |
| --- | --- | --- |
| `{ modo: "todas" }` | `[A, B, C]` | `[A, B, C]` |
| `{ modo: "selecionadas", [A, B] }` | `[A, B, C]` | `[A, B]` |
| `{ modo: "selecionadas", [A, B] }` | `[A]` | `[A]` |
| `{ modo: "selecionadas", [A, B] }` | `[C]` | `[]` → `indisponivel` |
| `{ modo: "selecionadas", [] }` | `[A, B]` | `[]` → `indisponivel` |

**O que entra em `disponiveis`:** empresas da organização atual, não excluídas (`deleted_at is null`) e
ativas quando a operação exige empresa ativa — carregadas pelo servidor
(`empresasDisponiveis`, em `apps/api/src/lib/empresa.ts`). A consulta ao banco fica na API: o núcleo
`@erp/plataforma` continua puro, sem banco, e não conhece a materialização atual (`erp.farms`).

## 5. Como usar

```ts
// LEITURA (lista, painel, relatório): o escopo é uma CLÁUSULA SQL do módulo ativo, nunca uma lista em memória
const params: unknown[] = [ctx.orgId];
const where = ["t.organization_id=$1", ...empresaScope(ctx, "t", params)];   // apps/api/src/lib/context.ts

// SQL já pronto: marcadores resolvidos na hora da consulta
const r = await consultaEscopada(ctx, "select … from erp.financial_titles t where t.organization_id=$1 and {{escopo:t.farm_id}}", [ctx.orgId]);

// ESCRITA (lançamento): a empresa do corpo é PEDIDO, nunca autorização
await exigirEmpresaDeLancamento(ctx, body.farm_id);      // fora do escopo do módulo → VALIDATION_ERROR
await exigirEmpresaVisivel(ctx, registro.farm_id);       // registro carregado fora do escopo → NOT_FOUND
```

Quando a porta não tem permissão fixa (a permissão depende do registro: tipo de movimentação, direção do
título, entidade do ID Global), o módulo é resolvido a partir da permissão REAL, e só então o escopo é
aplicado:

```ts
const permissao = permissaoMovimentacao(linha.movement_type, "view");
if (!permissao) throw notFound();
await comPermissaoResolvida(ctx, permissao);                                  // valida a empresa SELECIONADA
await exigirEmpresaVisivel(ctx, linha.farm_id, "Movimentação", moduloDaPermissao(permissao));
if (!hasPermission(ctx, permissao)) throw notFound();
```

## 6. Compatibilidade e migração

1. `erp.member_farms` **foi removida** na PRE-BASE2-03. O conteúdo dela está arquivado em
   `erp.legado_escopo_empresa_v0` (sem tela, sem runtime, sem autoridade) para que a migração seja reversível
   sem backup externo; o gate `scripts/member-farms-audit.mjs` impede que o nome volte ao código.
2. O backfill traduziu o estado legado sem que ninguém ganhasse ou perdesse acesso — vínculo vazio virou
   `todas`, vínculo preenchido virou `selecionadas` com exatamente as mesmas empresas, em todos os módulos.
   A equivalência é provada em `packages/db/test/backfill-empresas.test.ts` (matriz completa membro × empresa
   × módulo, comparando a autoridade nova com a regra antiga).
3. A API de administração continua aceitando `farm_ids`; a tradução acontece na borda
   (`apps/api/src/lib/escopo-admin.ts`), nunca no runtime de autorização.
4. `X-Empresa-Id` é o cabeçalho canônico de SELEÇÃO de contexto de trabalho; `X-Farm-Id` continua aceito
   durante a janela de rollout. A validação dele é POR MÓDULO, na porta: seleção explícita que o usuário não
   pode usar naquele módulo é 403. **O navegador, enquanto a ponte existir, envia só `X-Farm-Id`** — o CORS
   da API anterior não declara o canônico e o preflight morreria (§8.4).
5. Empresa criada pela tela recebe o código do contador `erp.code_sequences`, cuja chave de entidade é
   `SEQUENCIA_EMPRESA` (`"farm"`) — a MESMA de antes da renomeação. Trocar a chave criaria um segundo
   contador começando em zero e, com ele, códigos duplicados num acervo que já existe.

## 7. Acesso por empresa E módulo (autoridade de runtime)

O acesso efetivo é a **interseção** de duas dimensões independentes:

| Dimensão | Pergunta | Fonte |
| --- | --- | --- |
| CAPACIDADE | o *quê* o usuário pode fazer | perfil (`erp.role_permissions`) |
| ESCOPO | *onde* ele pode fazer | `erp.membro_escopos_empresa` + `erp.membro_empresas`, por MÓDULO |

Nunca `OU`. Permissão sem escopo não vê nada; escopo sem permissão não abre porta alguma.

### Granularidade

A granularidade é o **módulo de negócio**, não a tela e não a ação. O catálogo é
`MODULOS_ESCOPO_EMPRESA` (`packages/domain/src/escopo-permissao.ts`), semeado em
`erp.modulos_escopo_empresa`. Início, Relatórios e Configurações **não** são escopos: um relatório financeiro
respeita o escopo de FINANCEIRO, um painel de rebanho respeita PECUÁRIA, e um painel que combina áreas aplica,
bloco a bloco, o módulo da fonte de cada informação.

Não existe permissão por empresa (`empresa_a.payables.view` multiplicaria o catálogo por número de empresas).
O que existe é UMA permissão funcional e, ao lado, o conjunto de empresas daquele módulo.

### Modos e fail-closed

| Configuração do módulo | Empresas |
| --- | --- |
| ausente | **nenhuma** (fail-closed — módulo novo não vira acesso automático) |
| `todas` | todas as empresas REAIS da organização (não "qualquer UUID") |
| `selecionadas` com lista | exatamente aquelas |
| `selecionadas` com lista vazia | nenhuma |
| proprietário | todas, em todos os módulos, inclusive os criados depois |

### Como o módulo ativo é decidido

`runService` deriva o módulo da PERMISSÃO exigida pela rota (`moduloDaPermissao`), o expõe em
`ctx.moduloEmpresa` e o publica na transação (`app.modulo_empresa`). Nunca vem da URL, do pathname, do menu
nem do cliente. Recurso de organização não tem módulo: a capacidade basta, e não há empresa a cruzar.

### Onde o conjunto de empresas vive

No banco. `RequestContext` carrega apenas os MODOS por módulo — uma organização pode ter centenas de empresas,
e trafegá-las a cada requisição não escala. No modo `selecionadas`, o recorte é um semi-join
(`exists (… erp.membro_empresas …)`) sobre a chave primária da tabela, verificado com `EXPLAIN`.

Para verificação PONTUAL (uma linha) e para a RLS empresarial da PRE-BASE2-03 existem as funções SQL
`erp.tem_acesso_empresa(org, usuário, módulo, empresa)` e `erp.empresa_no_escopo(empresa[, módulo])`. Elas não
são usadas nas listagens: o PostgreSQL não embute função cujo corpo contém sublink, e toda regra de escopo
depende de `exists` — embutida seria uma chamada por linha em vez de um semi-join.

### Respostas

| Situação | Resposta |
| --- | --- |
| registro fora do escopo (id na URL) | **404** — não se revela existência |
| empresa proibida escolhida explicitamente (X-Farm-Id ou corpo) | **403** / `VALIDATION_ERROR` — o id veio do cliente |
| sem a permissão funcional | **403** |

### Migração do estado legado (o que a 0011 faz e o que ela recusa)

| Situação no modelo antigo | O que a migration faz |
| --- | --- |
| membro ATIVO, sem vínculo de fazenda | `todas`, em todos os módulos |
| membro ATIVO, com vínculos | `selecionadas` com exatamente aquelas empresas |
| membro **INATIVO** | migrado igual aos demais: `is_active` decide se ele USA o ERP, não se a configuração dele sobrevive. Sem isso, reativar um usuário o devolveria fail-closed, sem empresa nenhuma — perda silenciosa de acesso |
| **proprietário com vínculo restritivo** | a migration **PARA**. No modelo antigo `is_owner` dava todas as capacidades, mas o escopo de fazenda ainda podia estar restrito; migrar em silêncio ampliaria a autorização dele para todas as empresas. Exige normalização deliberada: remover a restrição ou retirar `is_owner` |
| vínculo inconsistente (empresa de outra organização, membro/empresa inexistente) | a migration PARA: integridade inválida não é mascarada |

"Proprietário enxerga todas as empresas" é regra de DESTINO do modelo novo — não licença para ampliar
autorização já existente. As duas coisas convivem: quem nasce proprietário no modelo novo é total; quem era
proprietário restrito no modelo antigo exige decisão humana antes de migrar.

### Atribuir empresa a um membro (borda de administração)

| Empresa pedida | Resultado |
| --- | --- |
| ativa, da organização | aceita |
| **inativa**, da organização | **aceita** — histórico continua consultável |
| **excluída** (`deleted_at`) | recusada (`VALIDATION_ERROR`) |
| de outra organização | recusada, sem revelar nada sobre o outro tenant |
| identificador inexistente | recusada |
| repetida no mesmo módulo | recusada — payload incorreto não é normalizado em silêncio |

A validação é do SERVIDOR e acontece antes de gravar: a chave estrangeira sozinha deixaria passar empresa
excluída, e um erro de integridade viraria 500 em vez de erro de negócio.

### Auditoria

Mudança de acesso por empresa é evento de SEGURANÇA: cada gravação registra em `erp.audit_logs`
(`entity = member_company_scopes`) o ator, o membro, o **antes**, o **depois** e os **módulos alterados** —
as duas fotos lidas do BANCO, não do payload. Alterar só o perfil não inventa evento de escopo. Nenhum
segredo (senha, hash, token, cabeçalho) entra nos metadados.

### Saldo bancário (decisão explícita)

`erp.bank_accounts` é cadastro da ORGANIZAÇÃO e o `opening_balance` dela **não tem empresa**;
`erp.bank_movements` tem. Logo:

| Número | Natureza | Contrato |
| --- | --- | --- |
| saldo da conta, extrato com saldo corrente, fluxo de caixa por conta | **organização** (parte do saldo inicial, que não é decomponível) | exige capacidade de ORGANIZAÇÃO (`bank_accounts.view`) além da permissão financeira; o Extrato Bancário é classificado como recurso de organização, com justificativa registrada |
| agregados de MOVIMENTOS (razão, fluxo por categoria, conciliação, financiamentos) | **empresa** | recorte por `farm_id` com semântica nullable (movimento sem empresa é da organização) |

Como `erp.bank_movements` TEM empresa, ele é company-scoped na RLS — corretamente. Mas as três portas de
CONTA abrem a transação SEM módulo, e sem módulo o recorte vale a UNIÃO das empresas do membro: o saldo
passaria a somar o `opening_balance` da organização com os movimentos de PARTE das empresas. O resultado não
seria um erro, seria pior — um extrato que fecha em 130 quando a conta tem 130, exibido como 110. Saldo
negado alguém investiga; saldo ERRADO ninguém questiona até a conciliação.

A porta organizacional é uma função estreita, `erp.movimentos_conta_organizacao(contas, de, até)`:
`security definer` com `search_path` fixo, organização lida da GUC do servidor (nunca de parâmetro do
cliente), `bank_accounts.view` **e** `bank_movements.view` reconferidas dentro dela, predicado de tenant
explícito nas duas tabelas, sem SQL dinâmico e com `execute` revogado de `public`. Ela devolve movimento da
ORGANIZAÇÃO — e só dela. A listagem normal de movimentos (`/financial/bank-movements`) continua recortada por
empresa: o que mudou é o AGREGADO DE CONTA, não a leitura de lançamento.

Não existe rateio inventado do saldo inicial: seria trocar um vazamento por um número financeiramente falso.
No painel financeiro, quem não tem a capacidade de organização recebe o bloco de bancos vazio e sinalizado
(`banks_escopo: "restrito"`) — nunca um total que soma empresas que a pessoa não enxerga.

### Relatórios e painéis

Todo relatório company-scoped respeita o módulo da própria permissão, em TODAS as suas fontes — inclusive
subconsultas, cláusulas `on` de `left join` e CTEs.

**Quem tem coluna de empresa responde pela própria coluna.** Esta é a regra, e ela não admite atalho: uma
tabela com `farm_id` só está recortada quando o predicado canônico cita o `farm_id` DELA. Herdar o recorte de
uma junção é sólido em apenas dois casos, e o gate estrutural
(`apps/api/test/unit/report-scope.test.ts`) só aceita esses dois:

| Caso | Por que é sólido |
| --- | --- |
| a tabela **não tem** coluna de empresa (`erp.title_apportionments`, `erp.weighing_items`) | as linhas dela só existem em função do pai já recortado: o recorte do pai é o único que existe |
| a igualdade é entre as **próprias colunas de empresa** (`a.farm_id = b.farm_id`) | a igualdade transporta o recorte de uma para a outra |

Juntar duas tabelas que TÊM `farm_id` por qualquer outra chave **não recorta nada**. Nada no banco impede que
o abastecimento da empresa B aponte para o equipamento da empresa A (`s.equipment_id = e.id`), que o título da
empresa B seja rateado para a área da empresa A (`ta.area_id = ar.id`) ou que o trato da empresa A seja
lançado no lote da empresa B (`fd.batch_id = b.id`) — não existe chave estrangeira composta que ligue o
`batch_id` ao `farm_id`. Quem confia nessa junção soma dinheiro e conta cabeça de empresa que o usuário não
enxerga. A prova está em `apps/api/test/integration/relatorio-escopo.test.ts`, que monta exatamente esse
estado no banco e exige que o usuário autorizado só na empresa B continue vendo o lote e **não** some o
trato nem conte o animal da empresa A.

A declaração `escopo.derivado` existe só para o primeiro caso — tabela SEM coluna de empresa — e sempre com
justificativa escrita. Declará-la para uma tabela que tem `farm_id` é erro de gate, não escolha de projeto.

**O recorte é por OCORRÊNCIA, não por tabela.** Ler a mesma tabela duas vezes na mesma consulta com o MESMO
alias — uma leitura recortada e outra não — é indistinguível, para quem olha por alias, de uma leitura só bem
recortada. Foi assim que o `exists` do HAVING do painel de rebanho leu `erp.herd_lots h` sem predicado: a
subconsulta escalar acima, com o mesmo alias, já carregava o marcador. Existência de linha também é
informação da outra empresa — a categoria aparecia zerada, mas só existia porque a empresa não autorizada
tinha rebanho nela, e isso é a composição do rebanho dela exposta como catálogo em uso. O gate passou a
contar ocorrências contra predicados.

### Recursos genéricos (cadastros, exportação, seletores, anexos)

`/api/cadastros/:key`, `/api/exports/:key`, `/api/saved-reports/run`, os seletores de referência, o `distinct`
das faixas de filtro, os anexos e a própria CRIAÇÃO decidem o recorte por UMA declaração do `ResourceDef`:

| Declaração | Quando | Leitura | Escrita |
| --- | --- | --- | --- |
| `farmScoped: true` | a tabela tem `farm_id` NOT NULL | predicado canônico na coluna própria | empresa do corpo é PEDIDO e passa por `exigirEmpresaDeLancamento` |
| `farmScopedNulo: true` | a tabela tem `farm_id` ANULÁVEL (nulo = da organização) | mesmo predicado com semântica nullable: o registro sem empresa continua visível | criar SEM empresa alcança todas elas, então exige o módulo em `todas` (ou proprietário) |
| nenhuma | a tabela não tem coluna de empresa | recurso de organização | — |

Se a declaração faltar, **nenhum** predicado é emitido em nenhum desses caminhos — não há recorte parcial, é
tudo ou nada. Por isso o gate cruza a declaração com o SCHEMA REAL: tabela com coluna de empresa e sem
declaração falha, declaração sem coluna falha, e a nulabilidade declarada tem de bater com a do banco (tratar
como NOT NULL uma coluna anulável não vaza, mas ESCONDE os registros da organização de quem tem escopo).

As matrizes versionadas estão em `docs/REPORT-SCOPE-MATRIX.md` (gerada e conferida pelo gate, uma linha por
relatório do catálogo) e `docs/DASHBOARD-SCOPE-MATRIX.md` (painéis, bloco a bloco).

### Notificações derivadas (a exceção que deixou de existir)

Até a migration 0011, `erp.notifications` **não tinha dimensão de empresa** — só `organization_id` e um
`user_id` opcional. O `refresh` gerava avisos a partir de registros que TÊM empresa
(`erp.purchase_requests`, `erp.documents`, `erp.financial_titles`) e o texto carregava dado do registro: o
código da solicitação, o título do documento, a contagem de títulos a vencer somando todas as empresas. Quem
não enxergava aquela empresa recebia o aviso assim mesmo. Abrir o link dava 404 — e isso não corrigia nada,
porque o TÍTULO já tinha revelado existência e identificação.

A **0012** fecha isso dando à notificação um contrato de escopo explícito, em vez de um predicado a mais:

| Escopo | Significado | Quem enxerga |
| --- | --- | --- |
| `organizacao` | não depende de empresa nenhuma (aniversário) | quem tem a CAPACIDADE da fonte |
| `empresa` | pertence a UMA empresa concreta | capacidade **e** acesso àquela empresa NAQUELE módulo |
| `modulo_todas` | agregado real da organização dentro de um módulo | só proprietário ou modo `todas` — `selecionadas` nunca |

Quatro decisões sustentam isso:

1. **A autorização é da FONTE, não da caixa.** Cada tipo declara sua capacidade e seu módulo num registry
   único (`packages/domain/src/notificacoes.ts`); a caixa de notificações é porta dinâmica, como os anexos e
   o ID Global. `permission_key` é obrigatória: ausência de capacidade declarada nunca significa "todo mundo".
2. **O estado inválido é impossível no banco.** `erp.tipos_notificacao` enumera as combinações
   (tipo × escopo × módulo × capacidade) que podem existir, e `notifications_tipo_fk` recusa o resto — por
   rota, por migration futura ou por `psql`. Sem isso, `organizacao/null/null` satisfaria os checks de
   coerência para QUALQUER tipo, e um aviso de compra voltaria a alcançar a organização inteira.
3. **O legado é fail-closed.** Nenhuma linha antiga virou "da organização" por omissão: onde a empresa não é
   recuperável de forma determinística, a linha virou `modulo_todas` do módulo correspondente — perde-se
   alcance, não se ganha exposição. Tipo desconhecido **interrompe a migração** em vez de ser classificado
   no chute, e o título humano nunca é parseado para reconstruir autorização.
4. **A leitura é do usuário.** `erp.notificacao_leituras` guarda um recibo por usuário, com a RLS amarrando
   o recibo ao usuário da sessão; `erp.notifications.read_at` fica como legado. Antes, um usuário marcar um
   aviso compartilhado como lido apagava o "não lida" de todo mundo.

Lista, contador de não lidas, "marcar como lida" e "marcar todas" usam a MESMA regra
(`visibilidadeNotificacaoSql`), e a autorização entra no `where`, antes do `limit` — o contrário devolveria
"as 50 mais recentes da organização, menos as proibidas". Marcar como lida uma notificação invisível
responde **404**, não 403: não há existência a confirmar.

A matriz por tipo, gerada e conferida por gate, está em `docs/NOTIFICATION-SCOPE-MATRIX.md`.

## 8. Migração física (PRE-BASE2-03): schema canônico, espelho legado e RLS empresarial

A renomeação não pôde ser um `rename column` de sexta-feira à tarde: o nome antigo está em cinquenta tabelas,
num cabeçalho HTTP, em payloads que clientes já instalados enviam e em cada política de RLS. O que a 0014 e a
0015 fazem é uma migração em **EXPAND → MIGRAR CONSUMIDORES → COMPATIBILIDADE**, em que nenhuma coluna legada é
removida nesta rodada e o binário imediatamente anterior continua servido.

### 8.1 Autoridade e espelho

| | Canônico (autoridade) | Legado (espelho) |
| --- | --- | --- |
| Tabela | `erp.empresas` | view `erp.farms` (`security_invoker = true`) |
| Coluna | `empresa_id`, `empresa_origem_id`, `empresa_destino_id` | `farm_id`, `origin_farm_id`, `destination_farm_id` |
| Vínculo membro × empresa | `erp.membro_empresas` + `erp.membro_escopos_empresa` | `erp.legado_escopo_empresa_v0` (arquivo morto) |
| Cabeçalho | `X-Empresa-Id` | `X-Farm-Id` |
| Campo de resposta | `empresa_id`, `empresa_name`, `empresas` | `farm_id`, `farm_name`, `farms` |

`erp.farms` é **view com `security_invoker = true`**, e isso não é detalhe de estilo: sem essa opção a view
roda com os direitos do DONO (o papel de migração, que tem `bypassrls`) e devolve as linhas de **todas as
organizações** para quem consultá-la — uma view de compatibilidade viraria a maior falha de isolamento do
sistema. O comportamento foi medido no banco antes de decidir: sob o papel da aplicação, a tabela devolve 1
linha, a view `security_invoker` devolve 1 e a view definer devolve 2. A mesma correção foi aplicada a
`erp.v_bank_account_balances`, que já era definer e já vazava.

### 8.2 As duas colunas andam juntas — ou a escrita falha

Cada tabela de escopo ganhou a coluna canônica ao lado da legada, e um gatilho (`trg_sync_<coluna>`) mantém as
duas iguais em toda escrita:

- **INSERT** — um lado preenchido preenche o outro. Os dois preenchidos com valores **diferentes**:
  `VALIDATION_ERROR` (422), nunca escolha silenciosa.
- **UPDATE** — o lado que MUDOU manda. Os dois mudando para valores diferentes na mesma instrução:
  `VALIDATION_ERROR` (422).

Escolher um dos dois em silêncio é o erro caro: o cliente antigo mandaria `farm_id`, o novo `empresa_id`, e uma
regra de precedência faria uma das duas escritas ir para a empresa errada sem erro e sem rastro.

PK, unicidade e chave estrangeira migraram para a coluna canônica, e a FK é **composta** —
`(organization_id, empresa_id) → erp.empresas(organization_id, id)`. Uma FK de coluna única prova que o UUID é
uma empresa; só a composta prova que é uma empresa **desta organização**.

### 8.3 RLS empresarial

Antes, a RLS isolava organização; empresa era assunto da aplicação. Agora a política das tabelas de escopo
recorta por empresa, com `using` = tenant + escopo de LEITURA e `with check` = tenant + escopo de ESCRITA.

**Uma política `for all` só serve onde leitura e escrita são a MESMA pergunta.** No PostgreSQL, `using` vale
para SELECT, para o OLD do UPDATE e para o DELETE; `with check` vale para o INSERT e para o NEW do UPDATE —
o DELETE **não tem** `with check`. Onde a regra de escrita é mais estreita que a de leitura, uma política
única não tem onde escrever a diferença: o DELETE fica com a regra de LEITURA e o UPDATE fica livre para
mover a linha para fora do que a escrita permitia. Por isso a forma depende da categoria:

| Categoria | Leitura × escrita | Política |
| --- | --- | --- |
| A — `empresa_id` NOT NULL | iguais | uma política `tenant_e_empresa` (`for all`) |
| B — `empresa_id` anulável (nulo = da organização) | **diferentes**: ler o registro sem empresa é de quem tem qualquer escopo; criar/alterar/apagar um registro sem empresa exige alcance de organização | quatro políticas: `tenant_e_empresa_select`, `_insert`, `_update`, `_delete` |
| C — transferências | **diferentes**: lê por qualquer das duas pontas, escreve pela ORIGEM | quatro políticas + gatilho `trg_travar_pontas` |
| D — `erp.empresas` | **diferentes**: a lista é recortada pelo escopo; administrar é ato de organização | quatro políticas (`insert`/`update` conferem só o tenant) |

**VISIBILIDADE BILATERAL NÃO É AUTORIDADE DE MUTAÇÃO BILATERAL.** As três tabelas de transferência têm a
mesma FORMA (duas colunas de empresa) e semânticas diferentes; tratá-las como uma categoria só fez a regra
mais permissiva das três virar a regra de todas. O UPDATE em envelope existia para dois fluxos específicos e
acabou dando ao destinatário de QUALQUER transferência autoridade para reescrever a linha inteira — inclusive
em `equipment_transfers`, que não tem aceite nenhum. A exceção de domínio tem de ser tão estreita quanto a
ação de domínio, e é por isso que a categoria C tem três contratos (C1/C2/C3), declarados em
`packages/domain/empresa-rls.mjs` e gerados na matriz.

O aceite pecuário é a única mutação legítima do destinatário, e ele não é um UPDATE: é
`erp.processar_transferencia_pecuaria_destino(movimento, lote_destino)` — `security definer` estreita, com
`search_path` fixo, organização e usuário vindos da GUC do servidor, `batch_farm_transfer.process` e o acesso
à empresa de DESTINO no módulo `pecuaria` reconferidos dentro, sem SQL dinâmico, `execute` revogado de
`public`. Ela move SOMENTE os itens vinculados àquela transferência que ainda estão na empresa de ORIGEM,
confere os row counts contra o esperado e só então grava `status='confirmed'`; qualquer divergência derruba a
transação inteira. Antes disso, a rota fazia o `update` normal, a RLS devolvia ZERO linhas e o status virava
confirmado assim mesmo — transferência aceita com o rebanho parado na origem.

### Integridade da EMISSÃO: a FK prova existência, não tenant

A emissão de `farm_transfer` recebe do cliente uma lista de UUIDs (`animal_ids`), um lote de origem e um lote
de destino, e as chaves estrangeiras que os recebem são GLOBAIS: `animal_movement_items.animal_id` referencia
`erp.animals(id)` sem organização, `animal_movements.batch_id` referencia `erp.batches(id)` sem empresa. A FK
prova que o UUID EXISTE; não prova que ele é DESTA organização. Medido antes da correção: um animal ativo de
outra organização, passado em `animal_ids`, produzia `201` com o item vinculado.

O invariante da emissão, verificado ANTES de o documento existir:

| Referência | Tem de ser |
| --- | --- |
| `animal_ids` (explícitos) | da organização atual, da empresa de ORIGEM, `status='active'`, `deleted_at is null`, sem repetição no payload e — quando `batch_id` foi informado — do próprio lote |
| fallback por `batch_id` | mesmo predicado: organização, empresa de origem, ativo, não excluído (estar no lote NÃO implica ser da mesma empresa) |
| `herd_lots` do lote | organização atual, empresa de origem, `quantity > 0`; a quantidade do item congela o acervo da emissão |
| `batch_id` | organização atual, empresa de ORIGEM, ativo, não excluído |
| `destination_batch_id` | organização atual, empresa de DESTINO, ativo, não excluído |

A validação é em LOTE (conta pedidos × elegíveis) e a recusa é `VALIDATION_ERROR` 422 com mensagem GENÉRICA:
UUID inexistente, UUID de outro tenant, UUID da empresa errada e UUID em estado inelegível têm a MESMA
superfície pública. Diferenciá-los transformaria a emissão num oráculo de existência do acervo alheio.

Os lotes são pergunta de TENANT, não de escopo — o de destino está na empresa que o remetente legitimamente
não enxerga —, então quem responde é `erp.lote_da_empresa_atual(lote, empresa)`: definer estreita, booleano,
organização da GUC do servidor, nenhum atributo do lote devolvido.

A mesma regra vive no BANCO, em dois gatilhos estreitos a `farm_transfer`
(`erp.validar_item_transferencia_pecuaria` e `erp.validar_lotes_transferencia_pecuaria`): integridade que só
mora no TypeScript morre junto com o primeiro `insert` escrito fora da rota. Compra, venda, nascimento,
morte, evolução e transferência entre lotes seguem exatamente como antes — inclusive referenciando animal
morto, que é o que um documento de morte FAZ. A migration audita o acervo existente antes de instalar os
gatilhos e PARA com diagnóstico se ele já violar o invariante: nada é normalizado, movido ou apagado.

E o aceite reconfere `status='active' and deleted_at is null`: entre emitir e aceitar o animal pode ter sido
vendido, morto, perdido ou excluído, e mover de empresa um animal que não existe mais operacionalmente — por
dentro de um `security definer`, sem RLS no caminho — seria pior que negar. Quem cai fora do predicado não
entra na contagem, e o confronto esperado × efetivo derruba a transação inteira: o documento continua
`pending` e NENHUM outro item se move.

O gatilho `erp.travar_pontas_transferencia_origem()` continua nas três tabelas, agora como defesa em
profundidade: "as pontas não mudaram" é uma comparação entre OLD e NEW, que `with check` não enxerga. Ele não
é mais a justificativa para abrir as outras colunas ao destinatário — uma invariante de ponta não deve
depender de a política de UPDATE continuar estreita.

`docs/COMPANY-RLS-MATRIX.md` lista, por tabela, a política de CADA comando com o predicado que ela usa, e
`apps/api/test/integration/rls-matriz.test.ts` compara essa matriz com `pg_policy` no banco real: comando,
`qual`, `with_check`, presença do gatilho, ausência de política permissiva sobrando e ausência de DUAS
políticas permissivas no mesmo comando (que voltariam a somar com `OR`).

A política antiga foi **substituída**, não acompanhada: políticas `PERMISSIVE` do PostgreSQL se combinam com
**OR**, então adicionar uma política de empresa ao lado da de tenant manteria o vazamento intacto — o `OR`
deixaria passar tudo o que a antiga já deixava. "A policy existe" não é prova de nada; a prova está em
`apps/api/test/integration/rls-empresa.test.ts`, que lê pelo papel da aplicação e conta linhas.

O módulo ativo chega ao banco pela GUC `app.modulo_empresa`, publicada pelo `runService` a partir da PERMISSÃO
da rota — nunca do cabeçalho, da query string, do corpo, do pathname ou do frontend. **Módulo indefinido é a
UNIÃO** das empresas visíveis em qualquer módulo: nem "todas" (vazaria) nem "nenhuma" (quebraria leitura
legítima fora de rota de módulo).

Quatro tabelas fogem da forma padrão, cada uma com motivo registrado em `packages/domain/empresa-rls.mjs` e
matriz gerada em `docs/COMPANY-RLS-MATRIX.md`:

| Tabela | Política | Por quê |
| --- | --- | --- |
| `animal_movements` (C1) | SELECT por qualquer ponta; INSERT/UPDATE/DELETE pela ORIGEM; o aceite do destino é a operação privilegiada `erp.processar_transferencia_pecuaria_destino` | O destinatário ainda não possui os animais — é o aceite que os traz para o escopo dele. Isso não cabe no UPDATE normal (seria autoridade sobre todo o rebanho da origem) nem pode ser um UPDATE que a RLS zera em silêncio. |
| `warehouse_transfers` (C2) | SELECT por qualquer ponta; INSERT/UPDATE/DELETE exigem AS DUAS | A criação já lança no ledger das duas empresas; o cancelamento tem de estornar as duas, e `reverseStock` lê pela RLS normal. Com uma ponta só, metade do ledger ficava sem estorno e a transferência era marcada como cancelada assim mesmo. |
| `equipment_transfers` (C3) | SELECT por qualquer ponta; INSERT exige AS DUAS; UPDATE/DELETE pela ORIGEM | A criação move o bem na hora e já exige as duas pontas. Não existe rota de aceite depois — logo não existe ato do destinatário que justifique UPDATE. |
| `erp.empresas` | SELECT/UPDATE/DELETE com `using` = a própria empresa no escopo (união entre módulos); `with check` de INSERT/UPDATE = só tenant | Administrar empresas é ato de organização; a LISTA que o membro enxerga continua recortada pelo escopo. Criar empresa pela API exige, além disso, alcance de ORGANIZAÇÃO na aplicação (`exigirEscopoTotalDaOrganizacao`), senão a linha nasce invisível para quem a criou. |
| `notifications` | mantém a política dinâmica de PRE-BASE2-02 (`escopo_tipo` × módulo × empresa) | O escopo do aviso é do TIPO dele, não da coluna. Trocá-la pela forma padrão desfaria a correção de segurança anterior. |
| `registros_globais` | tenant; `empresa_id` é PISTA, não autoridade | O ID Global é da organização. A autoridade continua sendo o registro fonte. |

### 8.4 O que o cliente vê

Entrada: o adaptador (`apps/api/src/lib/compat-empresa.ts`) traduz corpo e query string de legado para
canônico antes da validação. Os dois nomes com valores **diferentes** → 422.

Saída: a resposta carrega os DOIS nomes (`empresa_id` **e** `farm_id`), para que o navegador antigo continue
funcionando durante o rollout.

Isso cobre as duas janelas de version skew que um deploy real produz, e elas **não são simétricas**:

- **API nova + WEB antigo** — quem cede é o SERVIDOR: ele aceita o idioma antigo e responde nos dois.
- **API anterior + WEB novo** — quem cede é o CLIENTE, porque o servidor antigo não muda. E a barreira aqui
  não está no Fastify: está no CORS. A API do commit base declara `allowedHeaders` **sem** `X-Empresa-Id`;
  um navegador que o envia tem o PREFLIGHT recusado, a requisição morre antes de existir rota, e a tela
  simplesmente não carrega — sem erro de aplicação para tratar.

Por isso, durante a ponte, o **FIO é legado** nos cinco lugares em que a migração o tocaria: cabeçalho
(`X-Farm-Id`), caminho de recurso (`/api/resources/farms`), corpo (`farm_id`), query (`farm_id__eq`) e
leitura da resposta. Funciona nas duas pontas porque a API ANTIGA só entende isso e a API NOVA entende os
dois — o cliente não precisa descobrir a versão do servidor a cada requisição. A tradução vive inteira em
`apps/web/src/lib/compat-empresa.ts`; **nenhuma tela conhece o nome antigo**, e quando a ponte cair
(PRE-BASE2-05) esse arquivo é apagado sem tocar em componente nenhum.

`X-Empresa-Id` continua sendo o contrato oficial da API nova, suportado e testado
(`apps/api/test/integration/compat-empresa.test.ts`). O que é legado é o TRANSPORTE do navegador.

A prova não é um mock: `apps/web/e2e/skew-api-anterior.spec.ts` roda o navegador contra a API EXATA do commit
base — montada por `scripts/api-anterior.mjs` a partir do próprio repositório — servindo o mesmo banco já
migrado pelo HEAD novo. O primeiro teste do arquivo verifica que as cinco quebras do fio realmente existem
naquele binário, porque contra a API nova todas as outras asserções passariam e o arquivo teria certificado
o cenário errado.

A ponte é uma dívida com prazo e com endereço: os arquivos autorizados a falar o idioma antigo estão
declarados, um a um e com motivo, em `scripts/lib/empresa-compat-surface.mjs`; dois gates (`farm-compat-allowlist`
e `farm-inventory`) recusam qualquer nome legado fora dessa lista.

## 9. O que ainda não existe (e por quê)

| Item | Missão |
| --- | --- |
| Remoção das colunas legadas (`farm_id` e irmãs), da view `erp.farms` e de `X-Farm-Id` | PRE-BASE2-05 (a compatibilidade tem prazo; a lista de arquivos a apagar está em `scripts/lib/empresa-compat-surface.mjs`). |
| Renomear os VALORES de domínio (`farm_transfer`, `transfer_kind='farm'`) e as chaves de permissão (`farms.view`, `farm_transfers.*`) | Fora de PRE-BASE2-03: são DADO em linhas de `erp.role_permissions` e em documentos históricos, não nomenclatura de código. Governança de dados própria. |
| Seletor multiempresa e consolidação na interface | PRE-BASE2-05. |
