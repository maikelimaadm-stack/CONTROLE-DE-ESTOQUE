# CONTROLE-DE-ESTOQUE — leis permanentes

ERP multiempresa (monorepo pnpm, Node >= 22). Este arquivo vale em TODA sessão.
Regra modular por caminho: `.claude/rules/`. Procedimento reutilizável: `.claude/skills/`.
Proibição determinística: `.claude/hooks/`. Critério de revisão: `REVIEW.md`.
Mapa do conjunto: `docs/CLAUDE-CODE-ENGINEERING-HARNESS.md`.

Documento não repete regra de outro: cada assunto tem UM dono. Se a regra está aqui,
a rule não a recopia — ela aprofunda.

## Fluxo

- Uma fatia ativa por vez. Branch `claude/<fatia>`, criada de `origin/main` atual.
- Corrigir uma PR é atualizar **a mesma branch e a mesma PR**. Nunca abra uma segunda.
- PR nova só depois que a anterior estiver mesclada ou fechada.
- **Você nunca faz merge.** Nunca marca PR como *ready*. O merge é manual, do Maike,
  depois de revisão e CI verde. Isso vale mesmo com tudo verde e a fatia perfeita.
- Sem commit direto em `main`, sem force push, sem reescrita de histórico.
- Toda fatia termina com testes executados, evidências e riscos declarados.
- Relatório próprio não aprova nada: evidência tem de ser verificável por terceiro.
- Gate externo pendente (acesso autenticado a produção, credencial que você não tem)
  se registra como PENDING. Nunca se contorna com mock, preview, local ou CI.

## Arquitetura

- **Organização** é o tenant (`organization_id`). **Empresa** é a entidade operacional
  (`empresa_id`). Nunca colapse os dois.
- Autorização é **CAPACIDADE × ESCOPO**, combinada com AND. Nunca OR.
- Fail-closed: módulo sem configuração = nenhuma empresa. "Lista vazia" nunca é "todas".
- O módulo ativo deriva da **permissão exigida pela rota** — nunca de URL, pathname,
  menu, cabeçalho, query ou corpo.
- Negar não revela existência: fora de escopo, de outro tenant, inexistente ou excluído
  respondem a MESMA 404. 403 fica para falta de capacidade e empresa explicitamente proibida.
- Empresa vinda do cliente é PEDIDO, nunca autorização; o cruzamento server-side só
  pode diminuir escopo.
- Backend e RLS são a autoridade. `can()` no cliente apenas esconde botão.
- Sem segundo SSOT: navegação em `apps/web/nav.registry.mjs`, cadastros em
  `packages/domain/src/resources/registries.ts`, entidades com número no catálogo do servidor.
- Tela unificada ≠ regra de negócio unificada. Unificar apresentação nunca funde
  serviço, permissão, endpoint ou efeito contábil.
- Contrato de entrada não canônico é RECUSADO (422). Nunca traduzido, nunca ignorado:
  descarte silencioso é ampliação de escopo.

## Dados

- UUID é a identidade técnica e o endereço. **ID Global é o localizador humano** —
  um número por organização que nunca vira URL e nunca autoriza. Código de entidade é uma
  terceira coisa, distinta das duas. Como o número é APRESENTADO (com ou sem prefixo, fixo
  ou não na listagem) é política de UX do contrato vigente, não invariante deste arquivo.
- Dinheiro é `numeric` no banco, `decimal.js` no código, string na API. Nunca ponto flutuante.
- Ledger é imutável: movimento confirmado e baixa não são editados nem apagados para
  "corrigir" histórico — a correção é cancelamento com estorno.
- Invariante crítica mora em trigger no banco; validação na aplicação é complemento.
- Escrita passa por `runService` (uma transação, GUC de RLS, permissão verificada).
- Idempotência e `version` otimista onde o contrato já os exige.
- Toda gravação sob RLS confere ROW COUNT: fora de escopo a RLS devolve zero linhas,
  e zero linha sem conferência vira sucesso sem efeito.
- Paginação, filtro, ordenação e busca são sempre server-side. Nunca crie N+1.

## Escopo

- A ordem do roteiro é lei: PRE-BASE2-05 → BASE2-01 → BASE2-02 (TOP) → BASE2-03+ → DATA-GOV.
  Cada fase só começa com a anterior em produção e comprovada.
- 05C, BASE2 e TOP não se antecipam por conveniência, nem "de graça" porque o arquivo
  já estava aberto. O que cai fora da fronteira da fatia vira outra PR.
- Migration só dentro de fatia que a autorize explicitamente.
- Cada missão respeita a coluna "não faz" do próprio roteiro.

## Qualidade

- Gates oficiais do `package.json` são a autoridade: `pnpm lint`, `pnpm typecheck`,
  testes unitários, `pnpm test:integration`, `pnpm e2e`, `pnpm build`, `pnpm parity:check`.
- Nunca silencie, pule, afrouxe ou marque como flaky um teste para ficar verde.
- Catraca e baseline (`scripts/*.baseline.json`, `apps/web/scripts/ui-audit.baseline.json`)
  só diminuem. Aumentar baseline para passar é violação.
- Nada de `any`, `@ts-expect-error` ou disable amplo de lint só para resolver CI.
- Gate novo nasce com verificação reversa: quebre a regra, veja o gate reprovar, restaure.
- Verde que não prova nada é REPROVAÇÃO (zero linhas, zero organizações, asserção vazia).
- Responsividade segue `docs/UI-SUPPORT-MATRIX.md`: cenário fora da matriz suportada não vira gate
  obrigatório sem mudança explícita do contrato, e dívida adiada continua versionada e executável.

## Segredos

- Nunca leia, commite ou imprima segredo: `.env`, `.env.*`, token, cookie, JWT,
  `Authorization`, DSN com senha, chave de serviço.
- Nunca ponha credencial em relatório, PR, comentário ou log — nem mascarada.
- `.claude/settings.json` nega a leitura desses caminhos; a negação é rede de segurança,
  não permissão para tentar.
- `.env.example` é público e permanece legível.

## Formato do relatório

Quando a missão pedir relatório, responda em **UM único bloco markdown `text`**.
Sem prosa fora dele, sem dividir em vários blocos.
