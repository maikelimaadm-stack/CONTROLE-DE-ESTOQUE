---
name: migration-safety
description: Checklist de segurança para criar ou revisar migration de schema, RLS e ordem de deploy neste ERP multiempresa. Use antes de escrever SQL em supabase/migrations ou de auditar uma migration existente.
when_to_use: A fatia cria, altera ou remove tabela, coluna, índice, política de RLS, view, trigger ou função; ou a revisão precisa julgar uma migration. Não use para consulta comum nem para seed.
effort: xhigh
---

# Segurança de migration

Migration é o único artefato desta base que **não tem desfazer**. Código volta por
redeploy; schema volta pelo caminho inverso inteiro, e só se alguém o tiver escrito antes.

Leia antes: `docs/DATABASE.md`, `docs/DEPLOYMENT.md`, `.claude/rules/database-migrations.md`.
Escopo de empresa e RLS: carregue também a skill `multi-company-contract`.

## 0. Autorização

A fatia autoriza migration explicitamente? Se não, **o diff de migrations é zero** e é isso
que vai no relatório. Migration "aproveitando a viagem" é o jeito mais rápido de tornar
uma fatia irreversível.

## 1. Preflight

Antes de alterar, MEÇA o acervo: quantas linhas violam a invariante que a migration vai
passar a exigir? Linha cross-tenant, tipo desconhecido, órfã, nula onde vai virar NOT NULL.
Sem essa contagem, você está apostando que produção parece com o banco de teste.

## 2. Fail closed

Acervo inconsistente **para** a migration, com diagnóstico e ids, e a decisão é humana.
Nunca `DELETE`, `UPDATE ... WHERE` corretivo silencioso ou `ON CONFLICT DO NOTHING` para
a migration passar: isso transforma dado do cliente em dano invisível.

## 3. Forma

- Arquivo NOVO numerado em `supabase/migrations/000N_*.sql`. Nunca edite migration aplicada.
- EXPAND-only: canônica nasce ao lado da legada, sincronizada; purga é fase separada.
- Chave estrangeira de empresa é COMPOSTA — coluna única não prova tenant.
- Tabela de negócio nasce com `organization_id`, PK `uuid`, `timestamptz` e exclusão lógica.
- Suspender trigger de integridade só dentro da transação da própria migration, em volta
  do próprio UPDATE, com precondição verificada e reabilitação provada por teste.

## 4. RLS

Estreitar escopo é **substituir** a política, não somar uma ao lado (PERMISSIVE combinam
com OR e o vazamento permanece). Uma política por comando; `for all` só quando ler e
escrever são a mesma pergunta. View em `erp` é `security_invoker = true`.
Depois de mudar política, `scripts/company-rls-matrix.mjs --check` tem de continuar verde —
o documento é gerado, nunca editado à mão.

## 5. Dependências e ordem

Liste o que depende do que vai mudar: política de RLS que cita a coluna, trigger de
espelho, view, função, índice, código da API. Dropar coluna antes de reescrever a política
que a cita produz falha de AUTORIZAÇÃO, não erro de migration — e falha de autorização
não aparece no log, aparece no dado errado.

Ordem de implantação: **BANCO → API → WEB**, uma fase por vez, cada uma comprovada.
Se a inversão for possível na prática, exija version skew nos dois sentidos.

## 6. Volta

Escreva o caminho de volta ANTES de subir. Se for forward-only (destrutiva), diga isso
explicitamente e o que se perde. Identidade já exibida ao usuário nunca regride.

## 7. Produção

Nunca aplique migration, `db push`, reset ou DDL direto contra projeto remoto. O caminho é
o pipeline. Comando operacional roda com o papel de migração, nunca pela conexão da API —
pela conexão da API o preflight recusa, e um verde ali seria falso.
