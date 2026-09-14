# PRE-BASE2-05 — Aposentadoria da ponte Fazenda → Empresa

A ponte existe desde a PRE-BASE2-03 para tolerar *version skew*: o web (Vercel) e a API (Railway) não
trocam de versão no mesmo instante, e durante a janela de rollout as duas versões precisam se entender.
Ela cumpriu o papel. Este documento é o plano de removê-la **sem** abrir uma janela de indisponibilidade.

## Por que três fases, e não um deploy

Remover ao mesmo tempo o cabeçalho legado da API, a compatibilidade do servidor, a do cliente, as colunas
`farm_id` e a view `erp.farms` cria uma janela real em que *alguma* combinação implantada não fala com a
outra. Como o deploy não é atômico, essa janela não é hipótese — é a ordem natural dos eventos.

Então a remoção acontece em três movimentos, cada um seguro sozinho, e **cada um só começa depois de o
anterior estar em produção e comprovado**:

| Fase | O que sai | O que continua | Pré-requisito |
| --- | --- | --- | --- |
| **05A — Cliente canônico** | o tradutor de fio do web; `X-Farm-Id` do navegador; leitura de apelido legado na resposta | API bilíngue · banco bilíngue | PRE-BASE2-04 ativada em produção |
| **05B — Servidor canônico** | borda legada da API: cabeçalho, normalização de entrada, apelidos de saída, nomes legados de tabela, CORS | banco bilíngue | 05A em produção, sem cliente anterior no ar |
| **05C — Purga física do schema** | colunas legadas, view `erp.farms`, gatilhos de espelho, sequência `entity='farm'` | — | 05B em produção |

A ordem é obrigatória: o cliente deixa de falar o idioma antigo **antes** de o servidor deixar de entendê-lo,
e o banco só perde as colunas quando ninguém mais as lê.

---

## 05A — Cliente canônico (esta fase)

O web passa a falar o contrato canônico ponta a ponta:

- cabeçalho `X-Empresa-Id` (`cabecalhosDeContexto`, um lugar só — inclusive para o `fetch` direto da
  exportação de relatório);
- caminho, corpo e query canônicos, sem tradução;
- resposta consumida como veio: `ctx.empresas`, `empresa_id`, `empresa_*_label`;
- recurso `empresas`;
- sessão com `empresaId`.

**O que NÃO muda em 05A:** a API continua aceitando `X-Farm-Id`, `farm_id` no corpo e na query, e o recurso
`farms`; o banco continua com as colunas espelhadas e a view. Nenhuma migration destrutiva.

### Sessão do navegador — a única migração desta fase

A sessão no `localStorage` é o único estado do cliente que atravessa um deploy: ninguém a migra quando o
bundle novo sobe. A regra vive isolada em `packages/plataforma/src/sessao-empresa.ts` (pura, testada em
`packages/plataforma/test/sessao-empresa.test.ts`) e o efeito, em `apps/web/src/lib/api.ts`:

| Sessão encontrada | O que acontece |
| --- | --- |
| só `empresaId`, UUID ou `null` | segue como está, sem escrever no armazenamento |
| só a chave antiga | promove, **regrava** no formato canônico e apaga a chave antiga |
| as duas, mesmo valor | limpa a sobra e segue |
| as duas, valores **diferentes** | **fail-safe**: a sessão é apagada e o login é exigido |
| empresa gravada fora do contrato (número, objeto, `""`, `"abc"`, `"todas"`, UUID malformado) | **inválida**: a sessão é apagada e o login é exigido |
| nenhuma das duas chaves | **inválida** — ver abaixo |

O fail-safe não é excesso de zelo. Os dois clientes preservam a chave que não conhecem ao regravar a
sessão, então, quando os valores divergem, o armazenamento **não diz** qual foi escrito por último.
Escolher um seria decidir no escuro em qual empresa o usuário vai lançar — e empresa errada não é detalhe
de interface, é lançamento no lugar errado.

O valor também é contrato: `empresaId` é `null` ou UUID. `"todas"` nunca entra — "todas as empresas" é
**escopo de leitura**, resolvido no servidor a cada requisição, não empresa persistida. Sem essa validação,
um `localStorage` editado à mão viajaria em `X-Empresa-Id` e voltaria como 422 numa tela sem relação com a
causa; o backend continua sendo a autoridade, mas contrato que só o servidor faz cumprir não é contrato.

**Sessão sem nenhuma das duas chaves é inválida, não migrada para `null`.** A evidência: todo cliente que já
gravou sessão neste produto gravou a chave da empresa explicitamente — `empresaId: null` hoje e a chave
anterior com `null` antes da PRE-BASE2-03 (histórico de `apps/web/src/app/login/page.tsx`). Não há versão
legítima a acomodar, e inventar compatibilidade sem prova é como um fallback vira arquitetura.

Essa promoção é a única exceção declarada do cliente e **sai em 05B**, quando nenhum cliente anterior
puder mais gravar a chave antiga. A **validação** fica: ela é contrato canônico, não ponte.

### Catraca

`apps/web/scripts/empresa-canonica-audit.mjs` (no `pnpm lint` do web) impede que o contrato legado volte ao
web produtivo. Ela é necessária **porque** o tradutor saiu: sem adaptador, um `farm_id` que reapareça no
cliente não quebra nada — a API bilíngue aceita, e o erro some no sucesso.

A allowlist é **vazia**: nenhum arquivo do web produtivo escapa, `src/lib/api.ts` inclusive — excluir o
arquivo mais crítico do contrato HTTP para poupar uma palavra de comentário desarmaria a catraca justamente
onde ela mais importa. E a catraca **se autotesta a cada execução**: injeta cada padrão proibido em `api.ts`
na leitura (o disco não é tocado) e falha se a auditoria não acusar. Catraca que nunca foi vista falhando é
decoração.

Ela NÃO vigia vocabulário agronômico legítimo nem nomes de permissão/enum do servidor
(`farm_transfers.view`, `movement_type: "farm_transfer"`): renomeá-los é 05B/05C, e fazê-lo no cliente
quebraria a autorização.

---

## 05B — Inventário do que o servidor deverá remover

Levantado em PRE-BASE2-05A, **sem implementar**.

| Item | Onde | Observação |
| --- | --- | --- |
| Adaptador de borda inteiro | `apps/api/src/lib/compat-empresa.ts` | tradução de entrada, apelidos de saída, resolução de cabeçalho e nomes legados de tabela |
| `X-Farm-Id` no CORS | `apps/api/src/server.ts` (`allowedHeaders`) | sair **junto** com o resolvedor, nunca antes |
| Resolução do cabeçalho legado | `resolverEmpresaSelecionada` | mantém hoje o conflito 422 entre canônico e legado divergentes |
| Contrato legado `farm_ids` | `apps/api/src/lib/escopo-admin.ts` | borda de administração; lista vazia = todas (docs/MULTI-COMPANY-CONTRACT.md §6) |
| Chave de recurso legada | `packages/domain/src/resources/index.ts` (`CHAVES_LEGADAS`) | `farms` → `empresas` |
| Promoção de sessão do cliente | `packages/plataforma/src/sessao-empresa.ts` + o efeito em `apps/web/src/lib/api.ts` | só depois que nenhum cliente anterior puder gravar a chave antiga |
| Testes da ponte | `apps/api/test/integration/compat-empresa.test.ts` · `apps/api/test/unit/empresa-bridge.test.ts` | viram prova histórica: saem com o que provam |
| Suítes escritas no idioma anterior | `apps/api/test/integration/api.test.ts` · `farm-scope.test.ts` · `farm-scope-guard.test.ts` · `setup.ts` | reescrever no canônico, não apagar a cobertura |
| Provas de espelho no banco | `packages/db/test/empresa-compat.test.ts` · `backfill-empresas.test.ts` · `backfill-owner-restrito.test.ts` · `responsavel-tenant.test.ts` · `notificacao-legado.test.ts` | dependem das colunas e da view: saem com 05C |
| E2E do fio | `apps/web/e2e/empresa-canonica.spec.ts` (parte da sessão) · `apps/web/e2e/skew-api-producao.spec.ts` (asserção "segue bilíngue") | o resto do arquivo permanece |
| Redirecionamentos de navegação | `apps/web/nav.registry.mjs` (7 ocorrências) | **decisão: ficam** — ver abaixo |

### Dependência inesperada encontrada

`SEQUENCIA_EMPRESA = "farm"` no backend **não** é compatibilidade de fio: é a chave de uma sequência
persistida (`erp.code_sequences`, 1 linha em produção). Renomeá-la exige migration de dado e pertence a
**05C**, não a 05B. Trocar a constante sem migrar reiniciaria a numeração de empresas do zero.

### Decisão sobre os 7 redirecionamentos de rota

`/cadastros/farms` → `/cadastros/empresas` (e a variante com `:id`) **não são fio**: são links que usuários
guardaram em favoritos e que existem fora do nosso controle. Removê-los em 05A ou 05B quebraria um
bookmark sem ganho nenhum — eles não sustentam nenhuma compatibilidade de protocolo. **Ficam até 05C**,
onde saem junto com a última referência ao nome antigo, e o teste que os cobre vive em
`apps/web/e2e/empresa-canonica.spec.ts` sob "compatibilidade de NAVEGAÇÃO".

---

## 05C — Inventário dos objetos físicos

Levantado em PRE-BASE2-05A por leitura do banco de **produção**, **sem implementar**.

### Schema

| Objeto | Quantidade | Dependências | Migration | Rollback |
| --- | ---: | --- | --- | --- |
| Colunas legadas (`farm_id`, `origin_farm_id`, `destination_farm_id`) | **56** em **53** tabelas | FKs compostas, índices, RLS, gatilhos de espelho | `drop column` por tabela, depois dos gatilhos | recriar coluna + repopular a partir da canônica (o dado não se perde: é espelho) |
| View `erp.farms` | **1** | consultas legadas, testes de espelho | `drop view` | `create view` (definição versionada na 0014) |
| Gatilhos de sincronização (`erp.sincronizar_empresa*`) | **52** | as colunas acima | `drop trigger` + `drop function` **antes** das colunas | recriar a partir da 0014 |
| Sequência `erp.code_sequences` com `entity='farm'` | **1 linha** | numeração de Empresa em uso | `update ... set entity='empresa'` + troca de `SEQUENCIA_EMPRESA` no mesmo deploy | `update` inverso |

### Dados persistidos com nomes antigos — medição real

Esta era a pergunta aberta do plano, e a resposta é melhor do que se supunha:

| Conteúdo | Total | Com nome legado |
| --- | ---: | ---: |
| `erp.saved_reports.definition` | 0 | **0** |
| `erp.saved_reports.resource_key = 'farms'` | 0 | **0** |
| `erp.user_screen_preferences.preferences` | 14 | **0** |
| `erp.user_screen_preferences.screen` com `farms` | 14 | **0** |
| `erp.attachments.entity = 'farms'` | 2 | **0** |

**Conclusão: 05C não precisa de migration de normalização de dados.** É uma purga de DDL. Nenhum JSON
arbitrário de histórico/auditoria será tocado.

Essa medição vale para o estado atual de produção e deve ser **refeita imediatamente antes da 05C** — o web
canônico já não cria conteúdo com nome legado (a catraca garante), mas a API segue bilíngue até 05B, e um
cliente anterior ainda poderia gravar.

### Ordem segura de remoção em 05C

1. sequência: `entity='farm'` → `'empresa'` **junto** com a troca de `SEQUENCIA_EMPRESA` no código;
2. gatilhos de espelho e suas funções;
3. view `erp.farms`;
4. colunas legadas, tabela a tabela, com as FKs compostas e índices que dependem delas;
5. redirecionamentos de rota e o que restar de vocabulário técnico legado;
6. inventário final: **dívida = 0**.
