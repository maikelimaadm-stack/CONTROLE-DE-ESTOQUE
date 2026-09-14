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
| **05A — Cliente canônico** ✅ | o tradutor de fio do web; `X-Farm-Id` do navegador; leitura de apelido legado na resposta | API bilíngue · banco bilíngue | PRE-BASE2-04 ativada em produção |
| **05B — Servidor canônico** ⬅ esta fase | borda legada da API: cabeçalho, normalização de entrada, apelidos de saída, nomes legados de tabela, CORS, formato administrativo achatado, promoção de sessão | banco bilíngue | 05A em produção |
| **05C — Purga física do schema** | colunas legadas, view `erp.farms`, gatilhos de espelho, sequência `entity='farm'` | — | 05B em produção |

**05A foi mesclada e publicada** (`main` em `76e669d`). **05B é a fase atual.**

A ordem é obrigatória: o cliente deixa de falar o idioma antigo **antes** de o servidor deixar de entendê-lo,
e o banco só perde as colunas quando ninguém mais as lê.

---

## 05A — Cliente canônico (concluída, em produção)

O web passa a falar o contrato canônico ponta a ponta:

- cabeçalho `X-Empresa-Id` (`cabecalhosDeContexto`, um lugar só — inclusive para o `fetch` direto da
  exportação de relatório);
- caminho, corpo e query canônicos, sem tradução;
- resposta consumida como veio: `ctx.empresas`, `empresa_id`, `empresa_*_label`;
- recurso `empresas`;
- sessão com `empresaId`.

**O que NÃO muda em 05A:** a API continua aceitando `X-Farm-Id`, `farm_id` no corpo e na query, e o recurso
`farms`; o banco continua com as colunas espelhadas e a view. Nenhuma migration destrutiva.

### Sessão do navegador

A sessão no `localStorage` é o único estado do cliente que atravessa um deploy. A regra vive isolada em
`packages/plataforma/src/sessao-empresa.ts` (pura, testada) e o efeito, em `apps/web/src/lib/api.ts`.

Na 05A ela PROMOVIA a chave anterior. Em **05B a promoção saiu** — o rollout que a justificava terminou, e
nenhuma versão viva do cliente grava a chave antiga. O que ficou é o contrato de valor:

| Sessão encontrada | O que acontece |
| --- | --- |
| `empresaId` UUID ou `null` | segue como está, sem escrever no armazenamento |
| `empresaId` fora do contrato (número, objeto, `""`, `"abc"`, `"todas"`, UUID malformado) | **inválida**: sessão apagada, login exigido |
| sem a chave canônica (inclusive sessão dormante da versão anterior) | **inválida**: sessão apagada, login exigido |

`"todas"` nunca entra: "todas as empresas" é **escopo de leitura**, resolvido no servidor a cada requisição,
não empresa persistida. E a validação não é zelo excessivo — `localStorage` é editável e sobrevive a
qualquer versão do cliente; contrato que só o servidor faz cumprir não é contrato.

O custo de ter removido a promoção é um login a mais para quem está dormante há muito tempo. O custo de
mantê-la seria uma ponte que ninguém mais atravessa pedindo manutenção a cada mudança.

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

## 05B — Servidor canônico (esta fase)

A API passa a ter **uma** língua. Não é "parar de traduzir e ignorar o resto": entrada antiga conhecida é
**recusada**, nunca promovida e nunca descartada em silêncio.

| O que saiu | Onde estava | Virou |
| --- | --- | --- |
| Adaptador de borda inteiro | `apps/api/src/lib/compat-empresa.ts` | **arquivo apagado** |
| `X-Farm-Id` no CORS e no resolvedor | `server.ts` · `resolverEmpresaSelecionada` | `lib/empresa-header.ts`, que só aceita `X-Empresa-Id` |
| Normalização de corpo e query | hook `preValidation` | recusa em `lib/contrato-legado.ts` |
| Apelidos de resposta | hook `preSerialization` | nada — a resposta é canônica |
| `farms` no `/auth/context` | `routes/auth.ts` | só `empresas` |
| Nomes legados de tabela | `TABELAS_LEGADAS` / `tabelaCanonica` | `entity` canônico em anexos |
| Chave de recurso legada | `CHAVES_LEGADAS` em `@agro/domain` | só `empresas` resolve |
| Contrato admin achatado | `deFarmIdsLegado` / `paraFarmIdsLegado` | só `escopos_empresas`; `empresa_ids` **recusado** |
| Alias de coluna em relatório salvo | `campoCanonico` | nada (produção tinha **zero** definições legadas) |
| Promoção de sessão | `sessao-empresa.ts` | só validação canônica |

### Por que RECUSAR e não ignorar

Os schemas de entrada são `z.object`, que **descarta chave desconhecida**. Tirar `farm_id` do schema não
seria "remover o suporte" — seria trocar tradução por descarte silencioso:

- corpo: `farm_id: <empresa B>` sumiria e o lançamento iria para a empresa do **contexto**. O cliente pediu
  B, o servidor grava em A, e nada aparece até o relatório;
- query: `farm_id__eq` descartado devolve a lista **sem** o recorte — mais linhas do que foram pedidas;
- cabeçalho: sem empresa selecionada a leitura abre para **todas** as empresas permitidas no módulo.

Nos três casos o efeito é ampliação silenciosa de escopo. Por isso existe `lib/contrato-legado.ts`: uma
**lápide**, não um tradutor. Ela nomeia o contrato anterior só para recusá-lo, olha apenas o nível de cima
do corpo e da query (jsonb do usuário continua intocado) e não vigia vocabulário de domínio
(`farm_transfer`, `farms.view`) — esses são contratos do servidor, com vida própria.

`empresa_ids` é o único nome que exigiu recusa **local**: ele continua canônico e legítimo como filtro de
empresas dos painéis; o que morreu foi o seu uso como configuração de acesso de um membro.

### O que a 05B NÃO removeu

`SEQUENCIA_EMPRESA = "farm"` — agora sozinha em `apps/api/src/lib/sequencia-empresa.ts`. **Não é nome de
fio**: é a chave de uma sequência persistida (`erp.code_sequences`, 1 linha em produção). Trocá-la sem
migrar o dado reiniciaria a numeração do cadastro de Empresa, dando a uma empresa nova um código que já
existe. A troca é atômica com o `update`, na 05C. Há teste provando que a numeração **continua** de onde
estava.

Os redirecionamentos de rota (`/cadastros/farms` → `/cadastros/empresas`) também ficam: são favoritos de
usuário, fora do nosso controle, e navegação não é protocolo. Saem na 05C.

### Version skew: agora os dois sentidos

Na 05A só um sentido era real. Na 05B quem vira é o servidor, e ele pode subir antes ou depois do web:

| Sentido | O que prova | Onde |
| --- | --- | --- |
| web 05B × API 05A (base) | o web desta PR funciona sobre a API no ar | `playwright.skew.config.ts` |
| **web 05A (base) × API 05B** | **o bundle em produção não depende de nenhum resquício legado** | `playwright.skew-web-anterior.config.ts` |

O segundo é o que esta fase realmente arrisca, e nos dois casos o outro lado é montado do próprio
repositório por `scripts/api-anterior.mjs` — binário e bundle reais, não mock.

## 05C — Inventário dos objetos físicos

Remedido em PRE-BASE2-05B **contra o schema real** (banco de integração, que roda as mesmas migrations de
produção), **sem implementar**. A contagem de tabelas caiu de 53 para 49 em relação ao levantamento da 05A:
aquele número vinha de estimativa, este vem de consulta.

### Schema

| Objeto | Quantidade | Dependências | Migration | Rollback |
| --- | ---: | --- | --- | --- |
| Colunas legadas (`farm_id`, `origin_farm_id`, `destination_farm_id`) | **56** em **49** tabelas | FKs compostas, índices, RLS, gatilhos de espelho | `drop column` por tabela, depois dos gatilhos | recriar coluna + repopular a partir da canônica (o dado não se perde: é espelho) |
| View `erp.farms` | **1** | consultas legadas, testes de espelho | `drop view` | `create view` (definição versionada na 0014) |
| Gatilhos de sincronização `trg_sync_*` | **52** | as colunas acima | `drop trigger` **antes** das colunas | recriar a partir da 0014 |
| Funções `erp.sincronizar_empresa*` | **3** | os gatilhos acima | `drop function` depois dos gatilhos | recriar a partir da 0014 |
| Chaves estrangeiras que incluem coluna legada | **52** | integridade composta (organização + empresa) | cair junto com a coluna | recriar a partir da 0014 |
| Índices que incluem coluna legada | **8** | desempenho das consultas legadas | cair junto com a coluna | recriar se a leitura legada voltar (não deve) |
| Política de RLS citando coluna legada | **1** (`erp.empresa_cost_centers` → `api_child`) | leitura do filho pelo pai | reescrever no canônico **antes** de dropar a coluna | versão anterior da política |
| Sequência `erp.code_sequences` com `entity='farm'` | **1 linha** (última medição de produção) | numeração de Empresa em uso | `update ... set entity='empresa'` + troca de `SEQUENCIA_EMPRESA` no MESMO deploy | `update` inverso |

A política de RLS é a dependência que o levantamento da 05A não tinha visto, e é a mais perigosa da lista:
dropar a coluna antes de reescrevê-la quebraria a leitura do filho, não o schema — falha de autorização,
não erro de migration.

### Dados persistidos com nomes antigos — medição real

Esta era a pergunta aberta do plano, e a resposta é melhor do que se supunha. Os números abaixo são a
**última medição conhecida de produção** (feita na PRE-BASE2-04, com credencial disponível); a 05B não teve
acesso ao banco de produção e não os remediu. Devem ser refeitos imediatamente antes da 05C:

| Conteúdo | Total | Com nome legado |
| --- | ---: | ---: |
| `erp.saved_reports.definition` | 0 | **0** |
| `erp.saved_reports.resource_key = 'farms'` | 0 | **0** |
| `erp.user_screen_preferences.preferences` | 14 | **0** |
| `erp.user_screen_preferences.screen` com `farms` | 14 | **0** |
| `erp.attachments.entity = 'farms'` | 2 | **0** |

**Conclusão: 05C não precisa de migration de normalização de dados.** É uma purga de DDL. Nenhum JSON
arbitrário de histórico/auditoria será tocado.

Desde a 05B nenhuma porta escreve conteúdo com nome legado: o cliente é canônico desde a 05A e a API recusa
o contrato anterior. Ainda assim a medição deve ser **refeita imediatamente antes da 05C** — o que se mede
aqui é o passado, e o passado só se conhece olhando.

### Ordem segura de remoção em 05C

1. sequência: `entity='farm'` → `'empresa'` **junto** com a troca de `SEQUENCIA_EMPRESA` no código (atômico:
   separar os dois reinicia a numeração do cadastro);
2. **política de RLS** que cita coluna legada, reescrita no canônico — antes de qualquer `drop`;
3. gatilhos de espelho e, depois deles, suas funções;
4. view `erp.farms`;
5. colunas legadas, tabela a tabela, com as FKs compostas e os índices que dependem delas;
6. redirecionamentos de rota e o que restar de vocabulário técnico legado;
7. a lápide `apps/api/src/lib/contrato-legado.ts` — e só com tráfego real observado, não por suposição de
   que ninguém mais fala o idioma antigo;
8. inventário final: **dívida = 0**.
