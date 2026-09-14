---
name: pre-base2-checkpoint
description: Verificar a ordem do roteiro PRE-BASE2/BASE2 antes de começar uma fatia — o que já está em produção, o que está congelado e qual gate externo ainda bloqueia. Use quando a missão citar uma fase do roteiro ou parecer antecipar a seguinte.
when_to_use: A missão cita PRE-BASE2-05A/05B/05C, BASE2-01/02/03, TOP ou DATA-GOV; ou você está prestes a mexer em algo que pertence a uma fase futura.
---

# Checkpoint do roteiro

Documentos canônicos: `docs/PRE-BASE2-ROADMAP.md`, `docs/PRE-BASE2-FOUNDATION.md`,
`docs/PRE-BASE2-05-APOSENTADORIA.md`, `docs/DECISIONS.md`.
Leia-os — este arquivo diz COMO checar, não qual é o estado atual (que muda).

## A ordem é lei

`PRE-BASE2-05 (A → B → C)` → `BASE2-01 (moldura)` → `BASE2-02 (TOP)` →
`BASE2-03+ (módulos)` → `DATA-GOV`.

Cada fase só começa com a anterior **em produção e comprovada** — não "mesclada",
não "pronta na branch". Em produção.

## Antes de escrever código, responda

1. Qual fase esta missão implementa? Está escrito na missão?
2. A fase anterior está em produção? Qual evidência? (deploy, backfill concluído,
   verificação verde, smoke — não "a PR foi mesclada").
3. O que esta missão **não faz**, segundo a coluna "não faz" do roteiro?
4. Algum gate externo continua `PENDING`? Ele bloqueia esta fase?

Alguma resposta é "não sei": descubra antes de editar arquivo. Se a precondição não
estiver atendida, a missão está **bloqueada** — diga isso e pare. Não implemente parcial
para "aproveitar o tempo": meia fatia de uma fase bloqueada é dívida com aparência de progresso.

## Não antecipe

Nenhuma fatia implementa a seguinte "de graça porque o arquivo já estava aberto".
A fronteira existe porque cada fase precisa ser observável em produção sozinha — juntar
duas é o que torna o passo irreversível quando algo dá errado.

Em particular, DDL destrutiva de aposentadoria (drop de coluna legada, view de
compatibilidade, gatilho de espelho, função de sincronização) só roda na fatia própria,
com a anterior comprovada em produção — e constante de sequência persistida só muda no
MESMO deploy do `update` da linha correspondente, ou a numeração recomeça do zero.

## Lápide e redirecionamento

Recusa explícita de contrato antigo e redirecionamento de rota legada **não** são lixo a
limpar: são o que impede descarte silencioso e link quebrado. Só saem com tráfego real
observado, na fase que o roteiro determinar.
