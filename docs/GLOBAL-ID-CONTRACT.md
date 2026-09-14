# Contrato do ID Global

> Contrato de plataforma (PRE-BASE2-01). Implementação: `packages/plataforma/src/id-global.ts` (MECANISMO
> neutro), `packages/domain/src/id-global.ts` (CATÁLOGO deste produto), `packages/domain/src/rebanho.ts`
> (fonte única das variantes de rebanho), `packages/domain/src/id-global-rota.ts` (rota aberta → registro),
> `apps/api/src/lib/id-global.ts` (serviço), `apps/api/src/cli/id-global-backfill.ts` (backfill operacional),
> `scripts/id-global-audit.mjs` (gate), `supabase/migrations/0010_platform_foundation.sql` e
> `supabase/migrations/0016_global_id_activation.sql` (ativação, PRE-BASE2-04).

## 1. Três identificadores, três papéis

| Identificador | Para que serve | Quem gera |
| --- | --- | --- |
| **UUID** | Chave técnica, integridade referencial, URL de detalhe. | Banco (`gen_random_uuid()`). |
| **Código/número da entidade** | Identidade dentro da entidade (`0001` de entradas, `0001` de requisições). | `erp.next_code(org, entidade)`. |
| **ID Global** (`#55`) | Identidade única do registro **dentro da organização**, atravessando módulos e empresas. | `erp.proximo_id_global(org)`. |

O ID Global é o que o usuário digita na busca para chegar a qualquer registro sem saber de que módulo ele é.

## 2. Escopo da sequência

- **Única por organização.** Todas as empresas da organização compartilham a mesma sequência:

  ```
  #54  Empresa A · Estoque
  #55  Empresa C · Financeiro
  #56  Empresa B · Pecuária
  #57  Empresa A · Compras
  ```

- **Independente entre organizações.** Nunca existe numeração única entre tenants: o `#55` de um cliente
  não tem relação com o `#55` de outro.

### Garantias (e o que não é garantido)

| Garantia | Vale? |
| --- | --- |
| Unicidade dentro da organização | **Sim** — chave primária `(organization_id, id_global)`. |
| Um registro nunca recebe dois ID Globais | **Sim** — unicidade `(organization_id, tipo_entidade, id_entidade)` e alocação idempotente. |
| Alocação correta sob concorrência | **Sim** — `erp.proximo_id_global` é atômico (mesmo padrão das sequências de código); testado com alocações simultâneas. |
| Crescimento monotônico | **Sim**. |
| Ausência de lacunas | **Não.** Uma transação que aloca e depois falha consome o número. Lacuna é esperada e não é defeito. |
| Ordem temporal perfeita | **Não.** Números próximos foram criados próximos, mas empate de `created_at` (especialmente no backfill) não garante ordenação exata. |

## 3. Quem recebe ID Global

Recebe quem tem **identidade própria e ciclo de vida próprio** para o usuário — aquilo que ele abre, procura
e comenta como "um registro".

**Recebem:** produto · pessoa · entrada de estoque · documento fiscal · requisição · saída direta ·
devolução · transferência · produção de ração · solicitação de compra · título financeiro · movimento
bancário · importação OFX · documento de venda · animal · movimentação de rebanho · manejo · pesagem ·
equipamento · abastecimento · manutenção · ordem de serviço · perfil de acesso.

**Não recebem:** movimentação interna de rebanho (evolução, transferência, inventário, processamento —
efeito de outra operação, consultada na tela que a originou) · item de documento · linha de rateio · baixa de título · vínculo (`member_farms`,
`role_permissions`, `organization_members`) · qualquer linha auxiliar sem identidade própria · infraestrutura
(`code_sequences`, `idempotency_keys`, `audit_logs`, `stock_movements`).

A elegibilidade é **declarada em um catálogo central** (`ENTIDADES_ID_GLOBAL`, em `@agro/domain`), nunca por
`if` espalhado na rota. O mecanismo (tipos, resolução, validação) fica em `@erp/plataforma`, que não conhece
tabela, módulo nem permissão deste produto — é o que mantém o núcleo neutro de segmento. `validarRegistroIdGlobal()` recusa entrada que aponte para tabela técnica, rota sem `:id` ou permissão
inválida, e o dicionário de dados é cruzado com o registry por teste.

## 4. Permissão é do REGISTRO, não da tabela

Há tabelas em que uma linha representa coisas com **permissões diferentes**:

| Tabela | Coluna que decide | Variantes → permissão |
| --- | --- | --- |
| `erp.financial_titles` | `direction` | `payable` → `payables.view` · `receivable` → `receivables.view` |
| `erp.sales_documents` | `kind` | `budget` → `budgets.view` · `order` → `orders.view` · `sale` → `sales.view` |
| `erp.animal_handlings` | `handling_type` | nutrição, sanitário, desmama, apartação, pastagem e localização, cada um com a sua |
| `erp.animal_movements` | `movement_type` | compra, venda, nascimento, morte e perda, cada um com a sua |

Uma permissão fixa por tabela produziria dois defeitos, e o segundo é grave:

1. **falso negativo** — quem tem `receivables.view` não conseguiria abrir um recebível;
2. **vazamento de autorização** — quem tem só `payables.view` abriria um recebível.

Por isso o registry usa uma **união discriminada**: numa entidade com variantes é impossível, pelo tipo, ler
uma permissão fixa. `resolverRegistroGlobal` devolve **rota e permissão juntas**, sempre da mesma coluna do
mesmo registro.

Regras que não podem ser violadas:

- a permissão nunca é deduzida da URL — a rota é consequência do registro, não o contrário;
- valor de discriminador fora do mapa **nega** (fail-closed): nada de cair numa permissão mais ampla;
- nunca usar `payables.view OR receivables.view` (ou equivalente) para "resolver" o problema: isso é
  exatamente o vazamento que a variante existe para impedir;
- a resolução lê o discriminador do **registro vivo**, não de um valor copiado no índice — assim rota e
  permissão não envelhecem se o registro mudar de tipo.

### Uma fonte só para as variantes de rebanho

A matriz de manejo e movimentação vive em **um lugar** — `packages/domain/src/rebanho.ts` — e é consumida
pelos três lados que precisam dela: catálogo de ID Global, autorização de anexos
(`apps/api/src/lib/attachment-parent.ts`) e rotas operacionais (`apps/api/src/routes/livestock.ts`).
`apps/api/test/unit/id-global-registry.test.ts` prova que os três não divergem e que a fonte cobre exatamente
os valores aceitos pelo `check` da coluna no banco.

Nenhuma porta usa permissão vizinha como padrão: os antigos `?? "animal_sales.view"` e `?? "nutritions.view"`
foram removidos. Tipo desconhecido ou interno resolve `null` e o chamador **nega com 404**.

Cobertura: `apps/api/test/integration/plataforma.test.ts` prova, nos dois sentidos, que quem tem a permissão
de uma tela resolve só a sua, que o registro que muda de empresa passa a responder pela empresa nova e que
registro excluído deixa de ser navegável; `apps/api/test/integration/rebanho-autorizacao.test.ts` cobre as
matrizes de detalhe, listagem, criação e anexos por tipo de movimentação; `apps/api/test/unit/id-global-registry.test.ts` prova que toda permissão
declarada existe no catálogo real.

## 5. Registro global (resolução)

`erp.registros_globais` é o índice que resolve `#N` sem varrer tabelas:

| Coluna | Papel |
| --- | --- |
| `organization_id` + `id_global` | Chave: o número é único no tenant. |
| `tipo_entidade` + `id_entidade` | Tipo canônico + UUID do registro (único por organização). |
| `empresa_id` | **Índice denormalizado** da empresa no momento da criação. Serve para navegação e diagnóstico e **NUNCA é autoridade de segurança** (ver §5.1). |
| `modulo`, `rota_canonica` | Rota de detalhe resolvida na criação. |
| `criado_por`, `criado_em` | Trilha. |

`GET /api/registros-globais/:idGlobal` aceita `55` e `#55`. Responde **404** quando o número não existe,
quando o registro sumiu, quando o usuário está fora do escopo de empresa e quando lhe falta **a permissão
daquele registro** (não a de uma tela vizinha) — a mesma convenção do resto da API: nunca revelar existência,
nunca 403.

### 5.1 O REGISTRO FONTE É A AUTORIDADE

`empresa_id` no índice pode envelhecer: um animal transferido de empresa mantém no índice a empresa antiga.
Autorizar por ele deixaria quem só tem acesso à empresa antiga abrindo o registro, e daria 404 a quem tem a
empresa nova. Por isso a resolução de `#N` segue esta ordem, sem atalho:

1. localizar o índice global dentro da organização;
2. identificar a entidade no catálogo;
3. carregar o **registro fonte vivo** — tabela literal do catálogo, id parametrizado, `organization_id`, e
   `deleted_at is null` quando a entidade tem exclusão lógica;
4. obter **do registro fonte**: empresa atual, discriminador e existência/visibilidade;
5. autorizar a empresa usando **a empresa atual do registro** — nunca a empresa SELECIONADA na tela (§5.2);
6. resolver rota + permissão a partir do registro atual;
7. verificar a permissão;
8. só então responder.

Nenhum dado da entidade sai antes do passo 8, e toda negativa é a mesma 404.

### 5.2 A EMPRESA SELECIONADA NÃO DECIDE (correção de certificação)

O ID Global é um **localizador da ORGANIZAÇÃO**. A empresa selecionada no cabeçalho (`ctx.empresaId`) é
**contexto de trabalho** — um filtro de tela — e não entra na autorização desta porta.

O caso normal deixa isso evidente: um usuário com **Estoque só na empresa A** e **Financeiro só na B**
precisa localizar `#N` de um título da B enquanto trabalha no Estoque de A. Usar a seleção produzia dois
defeitos ao mesmo tempo:

* **falso negativo** — o registro autorizado não abria por causa de um filtro de tela;
* **oráculo de enumeração** — `validarEmpresaSelecionada` responde **403**, e um 403 no meio de uma superfície
  inteiramente 404 já conta "este número existe, só o seu contexto não bate".

Ignorar a seleção **não afrouxa nada**: o escopo REAL continua decidindo — empresa ATUAL da fonte dentro do
módulo da permissão DAQUELE registro —, e registro fora dele continua 404.

A separação é explícita no código: `publicarModuloEmpresa` publica o módulo resolvido na transação (técnico:
RLS e JS precisam falar do mesmo módulo na mesma consulta) e `validarEmpresaSelecionada` valida a seleção
(regra da **rota operacional**). `comPermissaoResolvida` faz as duas; o localizador global faz só a primeira.
A rota comum continua recusando com **403** uma seleção explícita inválida no módulo — provado no mesmo
arquivo de teste (`apps/api/test/integration/id-global-escopo-selecao.test.ts`).

**UUID malformado é a mesma negativa.** No caminho inverso (`/registros-globais/entidade/:tipo/:id`) o `:id`
é validado como UUID **antes** de qualquer consulta: sem isso o texto livre chegava ao PostgreSQL e voltava
como 500 com `invalid input syntax for type uuid` — erro de servidor onde deveria haver negativa, e um
oráculo que distinguia "malformado" de "inexistente". As duas coisas respondem 404, com a mesma mensagem.

**Navegação cross-empresa (interface).** Localizar não basta: se a busca apenas abrisse a rota, a tela de
destino pediria dados com a empresa ANTIGA no cabeçalho e receberia 403. Quando o registro é de outra
empresa e a sessão está numa empresa específica, a busca **pede a troca e navega depois**, pela mesma porta
do seletor do cabeçalho (`agro:empresa-request`) — que é onde mora a confirmação de abas com alterações não
salvas. Contexto em "todas as empresas" é preservado; registro da organização não escolhe empresa nenhuma.
A regra pura fica em `@erp/plataforma` (`contexto-empresa.ts`), testada sem navegador.

**Cache do cliente.** A chave continua sendo `["id-global", organização, #N]`: dentro de uma organização o
número aponta para o mesmo registro, qualquer que seja a empresa selecionada. Pôr a seleção na chave sugeriria
que ela faz parte da identidade do resultado — e ela não faz.

**Existência funcional — a regra vale nos DOIS sentidos.** O resolvedor enxerga o que a rota canônica
enxerga, e a rota canônica enxerga o que o resolvedor enxerga: num registro com exclusão lógica marcada,
lista, detalhe, portas de escrita (cancelar, confirmar), anexos e ID Global respondem 404 juntos. O contrário
— sumir da lista e do ID Global mas continuar abrindo por URL direta — é o "registro fantasma" que esta
regra existe para impedir. `exclusaoLogica` é declarado por entidade e conferido contra o schema real das
migrations por teste (`apps/api/test/unit/id-global-registry.test.ts`), e a concordância das portas é testada
em `apps/api/test/integration/existencia-funcional.test.ts` e `rebanho-autorizacao.test.ts`.

**Cancelado não é excluído**: um lançamento cancelado (`status='cancelled'`, `deleted_at` nulo) continua
existindo, continua na lista e continua navegável — a tela é que mostra a situação.

**A alocação não confia no chamador.** `atribuirIdGlobal(ctx, tipoEntidade, idEntidade)` lê o registro na
mesma transação; UUID inexistente (ou já excluído) nunca vira ponte global.

**A URL deriva do registro, nunca o contrário.** A rota canônica é calculada na criação e, em entidade com
variantes, **reresolvida na leitura** a partir do registro vivo.

**Cadastro abre em consulta.** O ID Global é uma localização de registro, não um atalho para edição: as rotas
dos cadastros genéricos (Modelo Base1) usam o modo de visualização (`?view=1`). Telas de detalhe próprias
(ordem de serviço, perfil de acesso, lançamentos) não precisam do parâmetro.

## 6. Alocação automática (PRE-BASE2-04)

Todo registro elegível criado a partir desta rodada recebe o número **na mesma transação de negócio**:

```
INSERT do root  →  atribuirIdGlobal(...)  →  demais efeitos e auditoria  →  COMMIT
```

O estado "registro elegível existe e não tem ID Global" é proibido para registros novos: se a alocação
falhar, a transação inteira volta atrás. Não há fila, não há job posterior, não há "depois a gente numera" —
qualquer um dos três produziria exatamente o estado que o contrato proíbe.

**Duas portas, uma regra.** As rotas especializadas chamam `atribuirIdGlobal` (falhar é erro); a criação
genérica de recursos e as tabelas com variantes internas chamam `atribuirIdGlobalSeAplicavel`, que devolve
`null` em dois casos — tabela fora do catálogo e **variante interna declarada** — e ERRA em variante
desconhecida. Tratar "não achei a variante" como "é interna" transformaria o esquecimento de declarar uma
variante nova num registro sem número que ninguém descobre.

**Efeito colateral também é registro.** Um documento que gera títulos financeiros faz os TÍTULOS receberem
número, não só o documento; a transferência bancária interna numera também o movimento-par da conta de
destino. A regra é do ROOT, não da porta HTTP.

**Onde isso é provado:** `apps/api/test/integration/id-global-runtime.test.ts` cria um registro de cada tipo
elegível pela ROTA REAL e confere o índice imediatamente — **sem rodar o backfill antes**, de propósito: o
backfill numeraria o que a rota esqueceu e esconderia o defeito. O gate `scripts/id-global-audit.mjs`
completa por estrutura: todo `insert into` numa tabela elegível precisa alocar logo em seguida.

## 7. Backfill dos registros existentes (PRE-BASE2-04)

O acervo anterior é numerado por um comando **operacional**, nunca por migration: percorrer 23 tabelas com
milhões de linhas dentro de uma transação de DDL seria horas de lock e perda total se falhasse no fim.

```
pnpm id-global:backfill -- --batch-size 500 [--org <uuid>] [--dry-run] [--verify-only]
pnpm id-global:verify                          # só as invariantes, sem gravar
```

| Propriedade | Como |
| --- | --- |
| **Fonte única** | Consome `ENTIDADES_ID_GLOBAL` — tabela, coluna de empresa, exclusão lógica, discriminador, variantes, módulo e rota. Não existe segunda lista. |
| **Ordem determinística** | Organizações por `created_at, id`; entidades por `tipo_entidade` ASC; dentro de cada entidade `created_at ASC, id ASC` (o `id` desempata). |
| **Lotes curtos** | Uma transação por lote. `--batch-size` padrão 500. |
| **Reserva de faixa** | `erp.reservar_ids_globais(org, n)` faz UM update atômico de `+n` e devolve a faixa contínua. `erp.proximo_id_global(org)` passou a ser literalmente `reservar_ids_globais(org, 1)`: uma autoridade só. |
| **Nunca `max()+1`** | Ler o passado para adivinhar o próximo número duplica sob concorrência: dois leitores enxergam o mesmo máximo. O contador é a autoridade e só sobe. |
| **Retomável** | O lote seguinte é sempre "o que ainda não tem índice". Interromper e continuar não muda nada do que já foi dado. |
| **Reexecutável** | `on conflict do nothing` + anti-join: rodar de novo atribui zero e o mapa (tipo + UUID → #N) é idêntico. |
| **Sem carregar tudo em memória** | Lê `--batch-size` linhas por vez; medido com 300 mil registros sob limite de heap de 512 MB. |

**O que NÃO recebe número:** registro excluído (o resolvedor não o enxerga, então o número apontaria para
lugar nenhum) e variante interna declarada. Variante **desconhecida** não é pulada em silêncio: o lote falha
com diagnóstico, porque valor fora do catálogo é dado corrompido ou variante nova não declarada.

**`criado_em` e `criado_por` do histórico:** `criado_em` recebe o `created_at` do registro fonte;
`criado_por` fica **NULL**, porque não houve usuário. Inventar um autor seria pior do que não ter um.

**A honestidade da ordem histórica.** Os números do acervo anterior foram ATRIBUÍDOS por migração. A ordem é
determinística e reproduzível, mas ela **não prova** que `#100` foi criado antes de `#101` no mundo real:
entre módulos, e em empates de `created_at`, a ordenação é uma convenção estável, não um fato histórico.

**Lacunas são permitidas; duplicidades não.** Uma corrida entre o backfill e uma criação pela API pode
consumir números reservados que não chegam a ser usados.

## 8. Invariantes verificáveis (`--verify-only`)

- zero registro elegível sem ID Global;
- zero duplicidade de `(organization_id, id_global)` e de `(organization_id, tipo_entidade, id_entidade)`;
- zero índice apontando para registro inexistente, e zero tipo fora do catálogo;
- zero variante interna com número;
- `sequencias_id_global.ultimo_valor >= max(id_global)` em toda organização.

## 9. Busca `#N` e exibição na tela

**Parser** (`interpretarIdGlobal`): aceita `55`, `#55`, `ID 55`, `id 55` e espaços em volta. Recusa `#0`,
`0`, `-1`, `abc`, `#abc`, `55abc`, `ID` sozinho, `1.5` — texto comum segue para a busca de telas. `ID55` sem
espaço **não** é ID Global: exigir o espaço evita transformar um código de produto em navegação.

**A busca não consulta o índice direto.** O cliente chama `GET /api/registros-globais/:idGlobal`, e é o
backend que decide — organização, registro fonte vivo, empresa ATUAL, permissão daquele registro. A resposta
traz metadata segura (`idGlobal`, `tipoEntidade`, `rotulo`, `modulo`, `rota`, `idEntidade`), nunca o conteúdo
do registro.

**`#N` NUNCA é URL.** Não existe `/registro/55`. O fluxo é `#55 → resolve → UUID → rota canônica existente`,
e a URL final continua sendo a do registro. Uma rota por número seria uma segunda identidade permanente —
e uma que resolve sem passar pela autorização daquele registro.

**Cache com organização na chave.** `["id-global", <organização>, 55]`. Sem a organização, o resultado do
tenant anterior continuaria navegável depois da troca.

**Exibição:** `GET /api/registros-globais/entidade/:tipo/:id` é o caminho inverso, com a MESMA autorização
(duas portas com dois critérios acabam sempre na mais frouxa). A UI monta o badge UMA vez, ao lado da trilha
(`IdGlobalDaRotaAtual`), e descobre sozinha — pela rota aberta, derivada do catálogo — qual entidade está na
tela. É o que dá cobertura de 100% do registry sem editar 23 páginas: entidade nova no catálogo passa a
exibir o `#N` sem que ninguém toque na UI. Registro ainda sem número (durante o backfill) não renderiza
nada: 404 é estado normal, não erro.

## 10. Auditoria

`audit_logs.id` é um **bigint próprio da auditoria** e NÃO é ID Global — nunca deve ser exibido como `#123`.
A leitura da auditoria traz o ID Global do registro auditado por LEFT JOIN no índice central, no momento da
leitura. Copiá-lo para dentro do log envelheceria (o número é do registro, não do evento) e obrigaria a
reescrever milhões de linhas no backfill. Evento técnico, ou de entidade fora do catálogo, simplesmente não
tem ID Global.

## 11. Desempenho

| Caminho | Medido |
| --- | --- |
| Resolver `#N` com 300 mil registros indexados | `Index Scan using registros_globais_pkey`, 0,045 ms de execução (nunca varre as 23 tabelas). |
| Backfill de 300 038 registros, lote 5 000 | 14 s, heap limitado a 512 MB, 3 consultas por lote. |

## 12. Reversão

Depois que um número foi exposto ao usuário ele **não é renumerado**. Voltar a versão da aplicação pode
deixar `registros_globais` e `sequencias_id_global` intactos: nada quebra, e os números continuam válidos.
Não apagar números para "voltar", não compactar lacunas. `ultimo_valor` nunca diminui — inclusive quando um
registro é apagado fisicamente, para que `#55` jamais seja reassociado a outro registro.

## 13. O que ainda não existe

| Item | Missão |
| --- | --- |
| Cabeçalho de lançamento do Base2 (a moldura definitiva onde o `#N` mora) | BASE2-01. |
| Tipo de Operação (TOP) | BASE2-02. |
| Remoção da ponte `farm`/`empresa` | PRE-BASE2-05. |

### Divergência de contrato registrada (PRE-BASE2-04)

`animal_handlings` declara a variante **`locate`** (Localização de Animal, `/pecuaria/manejo/locate/:id`,
`locate_animals.view`), mas o produto **não tem porta de criação** para esse tipo: `/livestock/locate` é uma
consulta, e o schema de manejo aceita apenas `nutrition`, `sanitary`, `weaning`, `separation` e `pasture`.
A variante foi mantida como está — removê-la seria redesenhar um contrato aprovado — e fica registrada aqui
para decisão: ou o produto ganha a porta, ou a variante sai do catálogo numa rodada de governança.
