# Padrão de nomenclatura do domínio

> Padrão normativo (PRE-BASE2-01). Mede-se em `docs/FARM-DEPENDENCY-INVENTORY.md` (gerado) e aplica-se por
> `scripts/naming-audit.mjs` (gate). **Nada aqui autoriza renomeação em massa**: este documento define o
> destino; a execução é por missão, com migration, compatibilidade, testes e plano de volta.

## 1. Princípios

1. **Conceito próprio, nome em português.** O que é nosso domínio (empresa, lançamento, situação, rateio)
   caminha para nomenclatura em português, coerente entre banco, API e interface.
2. **Palavra reservada não se traduz.** `React`, `useState`, `GET`, `POST`, `JSON`, `TypeScript`, `Fastify`,
   `uuid`, `jsonb` e afins permanecem como são. Traduzir framework seria ruído, não clareza.
3. **Núcleo neutro de nicho.** Autenticação, usuários, permissões, estoque, financeiro, auditoria, anexos,
   busca, cadastros e plataforma não podem depender semanticamente do agro. Pecuária, Confinamento e
   Reprodução continuam sendo módulos do nicho — e tudo bem.
4. **Compatibilidade antes de beleza.** Nome errado com contrato estável é melhor do que nome certo com API
   quebrada. A ordem é sempre: contrato novo → camada de compatibilidade → migração → remoção do antigo.
5. **Taxonomia própria e neutra.** Códigos canônicos são nossos: `ERP-<MÓDULO>-<ENTIDADE>`. Não reproduzimos
   códigos, siglas nem numeração do sistema de referência — e o prefixo **global** não pode nomear um
   segmento de negócio (o módulo pode: `ERP-PECUARIA-ANIMAL` é correto; um prefixo de nicho para toda a
   plataforma seria dívida arquitetural).
6. **Fundação nova nasce no destino.** Superfície criada agora (pacote de plataforma, tabelas, colunas,
   funções, exports, códigos canônicos) nasce com o nome final, em português. Dívida é o que já existe;
   criar dívida nova é escolha, não herança.

## 2. Tabela de destino

| Conceito funcional | Nome canônico (pt-BR) | Nome técnico atual | Nome técnico futuro | Compatibilidade |
| --- | --- | --- | --- | --- |
| Tenant/cliente do ERP | Organização | `organization_id`, `erp.organizations`, `X-Org-Id` | mantido por ora | Renomear organização é DATA-GOV; não há ganho funcional antes disso. |
| Entidade operacional/jurídica | **Empresa** | **`erp.empresas`, `empresa_id`, `empresa_origem_id`, `empresa_destino_id`** ✅ | — | Feito na PRE-BASE2-03 (0014). `erp.farms` sobrevive como VIEW `security_invoker` e `farm_id` como coluna espelhada por gatilho; removidos em PRE-BASE2-05. |
| Empresas permitidas ao usuário | Empresas permitidas | **`erp.membro_empresas`, `erp.membro_escopos_empresa`** ✅ | — | PRE-BASE2-02 (autoridade) + PRE-BASE2-03 (`erp.member_farms` arquivada em `erp.legado_escopo_empresa_v0` e removida). O contrato canônico é explícito (`modo: todas \| selecionadas`); a sentinela "lista vazia = todas" ficou confinada à borda de administração. |
| Empresa selecionada | Empresa selecionada | **`ctx.empresaId`, `X-Empresa-Id`** ✅ | — | PRE-BASE2-03. Desde **PRE-BASE2-05A** o cliente só envia o canônico e, desde **PRE-BASE2-05B**, ele é o ÚNICO que a API entende: o cabeçalho anterior saiu do CORS e é recusado no servidor com 422 (ignorá-lo abriria a leitura para todas as empresas do módulo). |
| Escopo de empresa em SQL | Escopo de empresa | **`empresaScopeSql`, `empresaPermitida`, `exigirEmpresaVisivel`** ✅ | — | PRE-BASE2-03: os apelidos depreciados (`farmScope`, `allowedFarms`, `farmAllowed`, `assertFarmVisible`) foram removidos do runtime. |
| Rota de cadastro | Empresas | **`/cadastros/empresas`** ✅ | — | PRE-BASE2-03, com redirecionamento de `/cadastros/farms`, `/cadastros/farms/:id` e `/cadastros/fazendas`. |
| Rótulo na interface | Empresa | texto "Fazenda" | chave `termos.empresa` | Resolvido por i18n, sem tocar em dado. |

**Estruturas novas já nascem no destino.** A migration 0010 ainda não foi mesclada, então este era o momento
barato de acertar: `erp.sequencias_id_global`, `erp.proximo_id_global()`, `erp.registros_globais`
(`id_global`, `tipo_entidade`, `id_entidade`, `empresa_id`, `modulo`, `rota_canonica`, `criado_por`,
`criado_em`), `erp.organizations.idioma_padrao` e `erp.users.idioma`. As chaves estrangeiras apontam para as
tabelas legadas onde for o caso, mas nenhum desses nomes precisará mudar depois.

### Identificadores novos que permanecem em inglês (exceções registradas)

Nenhuma exceção é aceita por inércia ("o código antigo usa inglês"): cada uma tem motivo, contrato que a
obriga, destino e a missão que a remove.

| Identificador | Onde | Motivo / contrato que obriga | Destino | Removido em |
| --- | --- | --- | --- | --- |
| `organization_id` | `erp.sequencias_id_global`, `erp.registros_globais` | Convenção transversal das 176 tabelas e das políticas de RLS (`erp.tenant_visible(organization_id)`); divergir em duas tabelas criaria uma segunda convenção de tenant. | `organizacao_id` | DATA-GOV (com todas as tabelas de uma vez) |
| `farm_id`, `origin_farm_id`, `erp.farms` | schema físico, dicionário de dados e a LÁPIDE da API | A coluna espelho e a view existem NO BANCO até a 05C: o dicionário documenta o schema real. No runtime da API o nome antigo sobrevive só em `lib/contrato-legado.ts`, que o nomeia para RECUSÁ-LO — não há mais tradução. Os arquivos autorizados estão declarados um a um em `scripts/lib/empresa-compat-surface.mjs`. | removidos | PRE-BASE2-05C |
| `farm_transfer`, `transfer_kind='farm'`, `farms.view`, `farm_transfers.*` | valores de domínio e chaves de permissão | São DADO — linhas de `erp.role_permissions`, `movement_type` de documentos históricos, valores gravados em milhões de linhas. Renomear é migração de dados com reescrita de histórico, não nomenclatura de código. | governança de dados | DATA-GOV |
| nomes de tabela/coluna das entidades no registry (`erp.input_entries`, `direction`, `kind`, …) | registry de ID Global e dicionário | São o schema atual; o registry é um mapa para ele. | acompanham a tabela | DATA-GOV |
| `Locale`, `UUID`, `JSON`, `BCP 47` | tipos e documentação | Termos técnicos padronizados, não conceitos do nosso domínio. | permanecem | — |

## 3. Proibidos e depreciados

| Item | Situação | Regra |
| --- | --- | --- |
| `agro365`, `wagro`, `makgestao`, `projetomg` e domínios associados | **Proibido** em runtime e código de produto | `scripts/naming-audit.mjs` falha o build. |
| Pacote de plataforma com nome de nicho (`@agro/platform`) | **Proibido** | O núcleo neutro é `@erp/plataforma`; o auditor falha se o nome antigo voltar. |
| Prefixo de taxonomia com nicho (`AGR-…`) | **Proibido** | Códigos canônicos usam `ERP-…`; o auditor e o gate do dicionário recusam. |
| Nome legado de Empresa dentro do núcleo neutro | **Depreciado** | Catraca `nucleo-neutro-nicho`: **zerada** — o catálogo de entidades saiu da plataforma para `@agro/domain`, e o núcleo não cita mais tabela nem coluna de nicho. |
| Prefixo `mg-` (iniciais do sistema de referência) em classes/tokens | **Depreciado** | Catraca: a dívida (`scripts/naming-audit.baseline.json`) não pode crescer. Código novo usa token neutro. |
| Novo símbolo com `farm`/`fazenda` no núcleo | **Proibido fora da ponte declarada** | Dois gates: `farm-compat-allowlist` (nenhum nome legado no runtime fora dos arquivos declarados em `scripts/lib/empresa-compat-surface.mjs`) e `farm-inventory --check` (a DÍVIDA DE PRODUTO — balde 3 do inventário — só pode diminuir; arquivo não declarado cai nesse balde por definição). |
| Código canônico copiado do sistema de referência | **Proibido** | Dicionário só aceita `ERP-…`. |

## 4. Classificação das referências herdadas (independência)

| Categoria | O que é | Destino |
| --- | --- | --- |
| **A. Runtime/produto** | Nome/domínio externo visível ao usuário ou embutido no app. | Deve desaparecer — gate falha. |
| **B. Código próprio** | Comentário, identificador ou constante citando o sistema externo sem razão técnica. | Deve desaparecer — gate falha. Reescrito em PRE-BASE2-01 (`globals.css`, `mg-controls.tsx`). |
| **C. Documentação histórica** | `docs/reference/**` — material de auditoria de como a referência funcionava. | **Preservado**, marcado como referência externa e explicitamente **não SSOT**. |
| **D. Licença/atribuição legal** | Obrigação legal de citar origem. | Preservado com justificativa no `ALLOW` do auditor. |

Nenhuma evidência histórica é apagada: `docs/reference/` continua sendo o registro do que foi observado.
O que não pode é o **produto** carregar a marca de outro sistema.

## 5. Convenções que já valem

- **Banco:** `snake_case`, PK `uuid`, timestamps `timestamptz`, exclusão lógica por `deleted_at`,
  `organization_id` em toda tabela de negócio.
- **Valores de domínio:** canônicos, minúsculos, estáveis (`pending`, `payable`, `budget`) — nunca
  traduzidos no banco (`docs/I18N-CONTRACT.md`).
- **Permissões:** `<recurso>.<ação>`.
- **Chaves de tradução:** `<contexto>.<termo>` em minúsculas (`acoes.salvar`, `empresa.selecione`).
- **Código do dicionário:** `ERP-<MÓDULO>-<ENTIDADE>`.
- **Nome funcional:** sempre em português, sem abreviação (`docs/UI-STANDARD.md`).

## 6. Como propor uma renomeação

1. Acrescente a linha na tabela de destino (§2) com o plano de compatibilidade.
2. Meça a superfície: `node scripts/farm-inventory.mjs` (ou o equivalente para o símbolo em questão).
3. Faça a migração em missão própria: coluna/rota nova → consumidores → remoção, com teste de
   compatibilidade em cada passo.
4. Atualize o baseline da catraca no mesmo commit, para que a redução fique registrada.
