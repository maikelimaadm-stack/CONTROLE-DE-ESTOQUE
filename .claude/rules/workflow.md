# Fluxo de trabalho

Aprofunda a seção "Fluxo" do `CLAUDE.md`. Carregada sempre.

## Branch e PR

- Antes de qualquer edição: `git fetch origin`, working tree limpo, branch criada do
  `origin/main` ATUAL. Base velha produz conflito e revisão sobre código que não existe mais.
- Uma fatia = uma branch = uma PR. A PR nasce e permanece **DRAFT**.
- Correção de PR revisada atualiza a MESMA branch e a MESMA PR. Abrir uma segunda PR
  para o mesmo assunto fragmenta a revisão e perde o histórico do que já foi respondido.
- PR nova exige a anterior mesclada ou fechada. Se a sua já foi mesclada, o trabalho
  seguinte recomeça da `main` pós-merge — nunca empilhe sobre histórico já mesclado.

## O que você nunca faz

- `merge` de PR, habilitar auto-merge, marcar *ready for review*.
- `git push --force`, `--force-with-lease`, `git reset --hard`, `git clean -fd`,
  rebase de branch alheia, reescrita de `main`.
- Alterar configuração do repositório no GitHub (default branch, exclusão de branch):
  é ação humana e a sessão automatizada não tem essa permissão.

`.claude/hooks/guard-dangerous-command.mjs` bloqueia isso de forma determinística.
O hook é a rede; a regra é a intenção. Não procure a variante que escapa do hook.

## Encerramento de fatia

Toda fatia termina com: gates executados de verdade (com números), diff revisado por
você mesmo de forma adversarial, riscos remanescentes escritos, e o que NÃO foi feito
declarado explicitamente. Escopo reduzido é decisão do Maike, não sua — entregue o
resto por inteiro e diga o que ficou de fora e por quê.

## Gate externo pendente

Quando a prova exige acesso que você não tem (produção autenticada, credencial real),
o resultado é `PENDING`, escrito como tal. Nunca substitua por mock, fixture, preview,
`localhost`, E2E, `curl` sem sessão, health check ou "deploy verde". Um gate que se
autoaprova não é gate.
