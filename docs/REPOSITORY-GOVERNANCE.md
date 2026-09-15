# Governança do repositório

| Regra | Valor |
|---|---|
| Default branch (GitHub) | `main` (corrigida em UI-STAB-01; antes apontava para `claude/agro365-system-replication-ydu48v`) |
| Base de toda PR | `main` |
| Branches de trabalho | `claude/<slice>` (uma branch por missão/slice, criada a partir de `origin/main`) |
| Commits diretos em `main` | **Não** — só por PR |
| Merge | **Manual**, pelo responsável do repositório, após CI verde (os QUATRO checks abaixo) e revisão |
| Histórico | Sem force push, sem rebase de branch alheia, sem reescrita de `main` |
| Branch antiga `claude/agro365-system-replication-ydu48v` | Mantida por enquanto (histórico); remoção é decisão do responsável — não faz parte de nenhuma PR |

## Verificação
```
git fetch origin --prune
git ls-remote --symref origin HEAD        # ref: refs/heads/main
git remote set-head origin -a             # origin/HEAD -> origin/main
```
A alteração da default branch é uma configuração do GitHub (Settings → General → Default branch ou
`gh repo edit <owner>/<repo> --default-branch main`) e exige permissão de administrador; a sessão automatizada não a
possui (o proxy nega escritas em configurações do repositório), por isso é sempre uma ação humana.

## Os quatro checks do CI, com o nome LITERAL

Contrato de *required checks* precisa do nome exato: um separador errado cria um check que nunca
reporta e a PR fica presa em "Expected" para sempre. O separador é ` · ` (U+00B7 MIDDLE DOT, com
espaço dos dois lados) — não é `•` nem `×`. Fonte: `.github/workflows/ci.yml`, campo `name:` de cada job,
conferido contra os `check_runs` publicados pelo app `github-actions`.

| Job | Nome do check |
| --- | --- |
| `quality` | `Lint · Typecheck · Unit · Parity` |
| `integration` | `Migrations · RLS · API integration` |
| `e2e` | `Build · E2E (Playwright)` |
| `skew` | `Version skew · os dois sentidos entre a base e este HEAD` |

`e2e` e `skew` declaram `needs: [quality]`: se `quality` reprovar, os dois ficam *skipped*, e um required
check *skipped* NÃO conta como aprovado. O contrato é fail-closed por construção.

**Não exija como required** `Vercel`, `controle-de-estoque - web` nem `controle-de-estoque - api`: são
*commit statuses* de DEPLOY, publicados no commit de `main` DEPOIS do merge. Numa PR eles nunca aparecem,
e exigi-los trava a PR permanentemente.

## O que é convenção e o que é mecanismo

As linhas da tabela acima descrevem a REGRA. Medido em 2026-09-15, o GitHub **não a impõe**:

| Controle | Estado real | Evidência |
| --- | --- | --- |
| Proteção clássica de `main` | **ausente** | `branches/main` → `protected: false` (duas credenciais + HTML) |
| Rulesets | **nenhum** | `rulesets?includes_parents=true` → `[]`; `rules/branches/main` → `[]`; o repo é de usuário, não de organização |
| Required status checks | **desligados** | zero contexts |
| PR obrigatória / revisão / CODEOWNERS | **inexistentes** | `.github/` só contém `workflows/ci.yml` |
| Force push e deleção de `main` | **liberados** | sem regra `non_fast_forward` nem `deletion` |
| Auto-merge | **desabilitado** | `allow_auto_merge: false` — a única trava de servidor a favor do "merge é manual" |

A única barreira que existe hoje é `.claude/hooks/guard-dangerous-command.mjs`, que é **cliente**: vale
nesta sessão, não na UI do GitHub nem em outra máquina. Na prática o histórico ajuda — os 32 pushes em
`main` são todos merge ou squash de PR, sem um único push direto —, mas isso é disciplina, não mecanismo.

O que torna o risco concreto é o deploy: o Railway publica a partir de `main` com `checkSuites: false` e
dispara ~2,7 s depois do commit, com pre-deploy `node dist/migrate.js`. **Já aconteceu** de a API de
produção subir a partir de um commit de `main` cujo CI reprovou dois minutos depois (merge da PR #22).
Armadilha de auditoria: `GET /commits/<sha>/status` devolve `success` porque agrega apenas os três status
de deploy — não é o CI. Quem auditar por ali lê verde num commit vermelho.

### Contrato mínimo proposto — ação HUMANA, não aplicada por nenhuma sessão

1. Regra de proteção (ou ruleset) em `main`: exigir pull request antes do merge.
2. Required status checks: os QUATRO nomes literais da tabela acima, com *strict* (branch atualizada).
3. Bloquear force push e deleção da branch.
4. Manter `allow_auto_merge: false`; o merge continua manual, do Maike, depois de revisão.
5. Opcional, e mais forte que tudo acima para o caso desta fatia: fazer o deploy de produção esperar o CI.

Nada disso é bloqueador da PRE-BASE2-05C-1 — a purga entra por PR revisada e mesclada à mão. É bloqueador
da frase "CI verde protege produção", que hoje é falsa.

