---
name: implement-slice
description: Procedimento padrão para executar uma fatia (slice) do roteiro deste ERP, do fetch da base até a PR DRAFT. Use quando a missão for implementar uma fatia nova, com branch e PR próprias.
when_to_use: Missão de implementação com nome de fatia (PRE-BASE2-*, BASE2-*, DEVEX-*, UI-*) que pede branch nova, gates e PR. Não use para corrigir uma PR já aberta — isso é certify-pr seguido de correção na mesma branch.
effort: high
---

# Executar uma fatia

Ordem fixa. Pular etapa aqui é como o trabalho vira retrabalho de revisão.

## 1. Base e branch (antes de qualquer edição)

- `git fetch origin`; working tree limpo; anote o SHA exato de `origin/main`.
- Se a missão declara uma precondição (PR anterior mesclada, fase em produção),
  **verifique-a de fato** — estado no GitHub e presença do merge em `origin/main`.
  Precondição não atendida: pare e diga que está bloqueada. Não implemente "adiantado".
- Branch `claude/<fatia>` criada do `origin/main` atual.

## 2. Ler o contrato antes de escrever

Leia o SSOT do assunto, não a memória da sessão anterior. Conforme a área:
`docs/AUTHORIZATION.md`, `docs/MULTI-COMPANY-CONTRACT.md`, `docs/GLOBAL-ID-CONTRACT.md`,
`docs/DATABASE.md`, `docs/TESTING.md`, `docs/UI-STANDARD.md`, `docs/DECISIONS.md`.
Se a fatia toca contrato multiempresa ou ID Global, carregue a skill correspondente.

## 3. Implementar

- Menor mudança que resolve o problema declarado. O que cai fora da fronteira da fatia
  vira backlog escrito, não código "de graça porque o arquivo já estava aberto".
- Regra nova entra no SSOT do assunto; nenhum catálogo paralelo.
- Toda decisão não óbvia vira uma linha em `docs/DECISIONS.md` com o MOTIVO — o motivo é
  o que impede a próxima pessoa de desfazer a decisão por engano.

## 4. Provar

- Teste focado primeiro (o menor que falha sem a mudança), depois a suíte necessária.
- Gate novo nasce com **verificação reversa**: quebre, veja reprovar, restaure, veja passar.
  Registre as duas observações. Sabotagem nunca é commitada.
- Prova que exige produção autenticada e você não tem acesso: registre `PENDING`.
  Nunca substitua por mock, preview, `localhost`, E2E ou health check.

## 5. Gates

`pnpm lint` · `pnpm typecheck` · unitários · `pnpm test:integration` · `pnpm e2e` ·
`pnpm build` · `pnpm parity:check`. Rode de verdade e guarde os números.
Falhou: diagnostique. Nunca marque como flaky para seguir.

## 6. Revisar o próprio diff

`git diff origin/main...HEAD` inteiro, de forma adversarial: o que um revisor recusaria?
Arquivo fora de escopo? Comentário obsoleto? Teste que passa vazio? Corrija antes de subir.

## 7. Entregar

- Commit com mensagem que explica o PORQUÊ.
- `git push -u origin <branch>`.
- PR **DRAFT**. Corpo: problema, decisão, provas (tabela), fora de escopo.
- **Não mesclar. Não marcar ready.** Relatório final em um único bloco `text`.
