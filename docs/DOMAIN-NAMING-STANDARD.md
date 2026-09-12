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
5. **Taxonomia própria.** Códigos canônicos são nossos (`AGR-<MÓDULO>-<ENTIDADE>`). Não reproduzimos códigos,
   siglas nem numeração do sistema de referência.

## 2. Tabela de destino

| Conceito funcional | Nome canônico (pt-BR) | Nome técnico atual | Nome técnico futuro | Compatibilidade |
| --- | --- | --- | --- | --- |
| Tenant/cliente do ERP | Organização | `organization_id`, `erp.organizations`, `X-Org-Id` | mantido por ora | Renomear organização é DATA-GOV; não há ganho funcional antes disso. |
| Entidade operacional/jurídica | **Empresa** | `erp.farms`, `farm_id`, `origin_farm_id`, `destination_farm_id` | `erp.empresas`, `empresa_id` | PRE-BASE2-03: coluna nova + cópia + gatilho/visão de leitura + troca dos consumidores + remoção. |
| Empresas permitidas ao usuário | Empresas permitidas | `erp.member_farms`, `membership.farmIds` | `member_empresas`, `empresasPermitidas` | PRE-BASE2-02. Semântica preservada: **lista vazia = todas**. |
| Empresa selecionada | Empresa selecionada | `ctx.farmId`, `X-Farm-Id` | `empresaSelecionada`, `X-Empresa-Id` | PRE-BASE2-03 aceitando os dois cabeçalhos na transição. |
| Escopo de empresa em SQL | Escopo de empresa | `farmScope`, `farmScopeSql`, `allowedFarms`, `farmAllowed` | `escopoEmpresa`, `companyScope` (`@agro/platform`) | Ponte já existe: `apps/api/src/lib/company.ts`. |
| Rota de cadastro | Empresas | `/cadastros/farms` | `/cadastros/empresas` | PRE-BASE2-03 com redirecionamento da rota antiga. |
| Rótulo na interface | Empresa | texto "Fazenda" | chave `termos.empresa` | Resolvido por i18n, sem tocar em dado. |

**Estruturas novas já nascem no destino.** Exemplo: `erp.global_records.empresa_id` (migration 0010) —
a chave estrangeira aponta para `erp.farms` porque é a tabela que hoje materializa Empresa, mas o nome da
coluna já é o definitivo e não precisará mudar.

## 3. Proibidos e depreciados

| Item | Situação | Regra |
| --- | --- | --- |
| `agro365`, `wagro`, `makgestao`, `projetomg` e domínios associados | **Proibido** em runtime e código de produto | `scripts/naming-audit.mjs` falha o build. |
| Prefixo `mg-` (iniciais do sistema de referência) em classes/tokens | **Depreciado** | Catraca: a dívida (`scripts/naming-audit.baseline.json`) não pode crescer. Código novo usa token neutro. |
| Novo símbolo com `farm`/`fazenda` no núcleo | **Depreciado** | Catraca do inventário: superfícies de produto não podem crescer. |
| Código canônico copiado do sistema de referência | **Proibido** | Dicionário só aceita `AGR-…`. |

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
- **Código do dicionário:** `AGR-<MÓDULO>-<ENTIDADE>`.
- **Nome funcional:** sempre em português, sem abreviação (`docs/UI-STANDARD.md`).

## 6. Como propor uma renomeação

1. Acrescente a linha na tabela de destino (§2) com o plano de compatibilidade.
2. Meça a superfície: `node scripts/farm-inventory.mjs` (ou o equivalente para o símbolo em questão).
3. Faça a migração em missão própria: coluna/rota nova → consumidores → remoção, com teste de
   compatibilidade em cada passo.
4. Atualize o baseline da catraca no mesmo commit, para que a redução fique registrada.
