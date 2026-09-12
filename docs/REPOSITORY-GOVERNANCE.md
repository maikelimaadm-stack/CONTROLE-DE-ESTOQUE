# Governança do repositório

| Regra | Valor |
|---|---|
| Default branch (GitHub) | `main` (corrigida em UI-STAB-01; antes apontava para `claude/agro365-system-replication-ydu48v`) |
| Base de toda PR | `main` |
| Branches de trabalho | `claude/<slice>` (uma branch por missão/slice, criada a partir de `origin/main`) |
| Commits diretos em `main` | **Não** — só por PR |
| Merge | **Manual**, pelo responsável do repositório, após CI verde (Lint · Typecheck · Unit · Parity; Migrations · RLS · API integration; Build · E2E) e revisão |
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
