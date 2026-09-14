---
paths:
  - "apps/api/**"
  - "packages/domain/**"
  - "packages/plataforma/**"
  - "packages/shared/**"
  - "packages/validation/**"
---

# API e domínio

Carregada ao trabalhar no servidor. Complementa `security.md` (autorização) e
`architecture.md` (camadas) — não repete nenhuma das duas.

## Porta de escrita

Toda escrita passa por `runService(app, req, permission, fn)`: uma transação, GUC de
RLS aplicada, permissão verificada. Ou tudo é aplicado, ou nada. Não existe caminho
de escrita que não passe por ali.

Quando a permissão depende da linha (porta dinâmica), resolva a permissão ANTES de
qualquer efeito, e derive capacidade e escopo do módulo dessa permissão resolvida.

## Entrada

- Validação com zod na borda. Schema é contrato, não sugestão.
- `z.object` descarta chave desconhecida: por isso contrato legado conhecido é RECUSADO
  explicitamente (422), nunca apenas omitido do schema. Descarte silencioso de campo,
  filtro ou cabeçalho de empresa é ampliação de escopo, e aparece meses depois como
  lançamento na empresa errada.
- Erro segue o contrato existente (`DomainError`, códigos já usados). Não invente
  código de erro novo quando um existente descreve o caso.

## Concorrência

- `Idempotency-Key` nas escritas críticas: reenvio e duplo clique não duplicam.
- `version` otimista onde o contrato já a exige; transição de workflow sem a `version`
  atual do registro não é gravada.
- Lock onde duas requisições simultâneas disputariam a mesma linha.

## Consulta

- Paginação, filtro, ordenação e busca são server-side (`page/pageSize/sort/dir/search`).
- Autorização ANTES dos dados e sempre antes do `limit`. Recortar depois de paginar
  devolve páginas curtas e vaza a contagem real.
- Recurso com coluna de empresa responde pela PRÓPRIA coluna, em cada ocorrência da
  consulta — subconsulta, CTE e cláusula `on` inclusive.
- **Nunca N+1.** Enriquecimento de página é em lote: uma consulta por página, com
  `= any($n)`. Se a garantia importa, ela é CONTADA por teste, não prometida por
  comentário — um `await` dentro de um `map` vira 100 consultas sem quebrar asserção
  funcional nenhuma.
- Toda gravação sob RLS confere ROW COUNT.

## Compatibilidade

Não crie apelido legado novo. A ponte existente é declarada arquivo a arquivo e tem
data para sair; acrescentar um caso novo a ela precisa de motivo escrito no diff.
