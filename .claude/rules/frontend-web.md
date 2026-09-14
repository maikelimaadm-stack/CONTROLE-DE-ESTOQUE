---
paths:
  - "apps/web/**"
---

# Web

Carregada ao trabalhar na interface. Documentos canônicos: `docs/UI-STANDARD.md`,
`docs/UX-ARCHITECTURE.md`, `docs/PERSONALIZACAO.md`.

## O servidor é a autoridade

- O cliente nunca decide acesso. `can()` esconde botão; quem nega é a rota.
- O cliente nunca gera identidade: nem UUID, nem código, nem `#N`. Número vem do servidor.
- O cliente nunca guarda um segundo catálogo. Quando a tela precisa saber "esta listagem
  tem número?", a RESPOSTA declara — uma lista paralela no front envelhece na primeira
  entidade nova e ninguém percebe, porque nada quebra.
- Armazenamento do navegador guarda metadados e preferências, nunca dados de registro,
  resposta de API ou permissão. A restauração revalida no servidor.

## Modelo Base1

- Listagem e consulta usam a grade única (`Base1List` / `DataTable` sobre `Base1Grid`).
  Comportamento novo se implementa no motor, nunca por tela.
- Coluna declara CAPACIDADE (`hideable`, `resizable`, `freezable`, `autoFit`,
  `filterable`, `pinned`). O componente genérico não conhece coluna de domínio: nada de
  `if (key === "...")` dentro da grade.
- Controle que aparece e não funciona é pior que controle ausente. "Não aplicável por
  capacidade" some; "aplicável, porém indisponível agora" fica desabilitado.
- `colSpan` de rodapé é DERIVADO da lista de colunas, nunca contado à mão — contado à
  mão ele desanda em silêncio a cada coluna nova.
- Primitives de `apps/web/src/components/ui` pelo barrel. Sem variante própria
  (`Button2`, `DialogV2`), sem overlay manual, sem largura própria em Dialog/Drawer.

## Texto e formato

- Todo texto visível é PT-BR; valor técnico nunca é traduzido.
- Rótulo de enum só por `enumLabel`. Valor cru na tela é defeito.
- Dinheiro, número, percentual e data só pelos formatadores de `apps/web/src/lib/utils.ts`.
- Vocabulário canônico: Situação (não "Status"), Painel (não "Dashboard").

## Navegação

`apps/web/nav.registry.mjs` é a fonte única. Link interno aponta para rota canônica —
nunca para rota antiga que só existe por redirect. Nenhuma lista de navegação paralela.

## Regressão

Mudança de UX não toca o motor: API, serviço, máquina de estado, ledger, auditoria,
idempotência, RLS, permissão e schema permanecem intactos. Alteração visível em
componente genérico precisa de E2E que prove que as OUTRAS telas não mudaram —
consertar um caso e mudar a aparência de todos os demais é regressão, não correção.
