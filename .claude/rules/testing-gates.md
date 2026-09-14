---
paths:
  - "apps/api/test/**"
  - "apps/web/e2e/**"
  - "packages/db/test/**"
  - "scripts/**"
  - ".github/workflows/**"
---

# Testes e gates

Carregada ao mexer em teste, script de auditoria ou CI.

## Gates oficiais

O `package.json` é a autoridade; o CI executa os mesmos comandos em quatro jobs
(`quality`, `integration`, `e2e`, `skew`). `pnpm lint` encadeia os auditores estáticos
do repositório — acrescentar um gate significa acrescentá-lo ali.

## Nunca enfraqueça

- Não pule, não marque como skip, não afrouxe asserção, não reduza cobertura e não
  adicione exceção a allowlist só para conseguir verde.
- Baseline e catraca só diminuem. Aumentar o número para passar transforma o gate em
  carimbo.
- "Flaky" não é causa raiz. Investigue; reexecute isolado no máximo uma vez; se falhar
  de novo, é real.

## Verde que não prova nada é reprovação

Teste que passa com zero linhas, zero registros ou nenhuma asserção executada é falso
positivo. Prove a premissa junto com a conclusão: conte as linhas, conte as células,
conte as consultas. Se a tela pode estar vazia, o teste tem de semear o dado.

## Verificação reversa

Gate novo nasce com prova de que reprova: quebre a regra na working tree, rode o gate,
confirme a falha, restaure, rode de novo, confirme o verde. A sabotagem nunca é
commitada. Sem isso, um gate que sempre passa é indistinguível de um gate quebrado.

## Ambientes

Local, CI, preview e produção são coisas diferentes e não se substituem. Prova que
exige produção autenticada não se satisfaz com nenhuma das outras três. Teste de
version skew usa binário e bundle reais, nunca mock.
