---
paths:
  - "supabase/**"
  - "packages/db/**"
---

# Banco e migrations

Carregada ao tocar schema. Documentos canônicos: `docs/DATABASE.md`,
`docs/DEPLOYMENT.md`, `docs/COMPANY-RLS-MATRIX.md` (gerado).

Migration só dentro de fatia que a autorize explicitamente. Sem autorização, o diff de
migrations é ZERO — e isso se declara no relatório.

## Forma

- Toda mudança de schema é um NOVO arquivo numerado em `supabase/migrations/000N_*.sql`,
  aplicado em ordem e registrado por NOME.
- Migration já mesclada e aplicada é história intocável: corrija com uma migration nova.
  Editar a existente faz o banco de quem já aplicou divergir para sempre do repositório.
- Virada de modelo é EXPAND-only: a coluna canônica nasce ao lado da legada, sincronizada;
  a purga física é fase separada, depois da anterior estar em produção e comprovada.

## Fail closed

Acervo inconsistente PARA a migration com diagnóstico e ids. A decisão é humana.
Nunca corrija, anule ou apague dado em silêncio para a migration passar.

## RLS

RLS habilitada e forçada em toda tabela de tenant. Estreitar escopo é SUBSTITUIR a
política, mantendo UMA por comando. Detalhes e proibições: `security.md`.

## Ordem de deploy

BANCO → API → WEB, uma fase por vez, cada uma comprovada antes da seguinte. Qualquer
inversão possível na prática (web subindo antes da API) só é aceitável com os DOIS
sentidos do version skew verdes.

## Rollback

API e WEB voltam por redeploy da versão anterior, sem tocar no banco. Banco volta pelo
caminho inverso inteiro — não existe reversão parcial de uma tabela. DDL destrutiva é
forward-only: exige missão própria, precondição verificada e plano escrito.

## Irreversível

Identidade já exibida ao usuário não volta atrás: contador de ID Global não diminui e
registro de identidade não é apagado. Lacuna é normal; renumerar não.

## Mutação direta de banco é bloqueada na sessão

`db:migrate`, `db:seed` e `db:reset` (em qualquer grafia: script do repositório, `--filter`
do pacote de banco ou chamada direta ao seu cli) são **recusados pelo hook**. O motivo não é
desconfiança do comando, é da CONEXÃO: o cli usa a URL herdada do ambiente, então o mesmo
comando que recria um banco descartável recria um remoto se a variável estiver apontando
para lá — e o guarda não tem como saber qual é o caso.

O que continua liberado é o fluxo de teste controlado: `pnpm test:integration`, `pnpm e2e`,
`pnpm db:seed:e2e`, além de lint, typecheck, build e parity. O CI monta o próprio banco
efêmero e não passa por este hook.

Se um dia for preciso migrar localmente fora dos testes, o caminho é um wrapper
explicitamente local, com verificação forte da conexão — não uma exceção no guarda.

## Produção

Nunca aplique migration, reset ou DDL direto em banco remoto. O caminho é o pipeline.
