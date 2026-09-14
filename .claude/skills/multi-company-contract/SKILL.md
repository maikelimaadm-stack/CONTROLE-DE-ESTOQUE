---
name: multi-company-contract
description: Contrato Organização × Empresa deste ERP — escopo, capacidade, fail-closed, 404 vs 403 e onde a autoridade mora. Use ao mexer em autorização, escopo de empresa, RLS ou qualquer consulta que recorte por empresa.
when_to_use: A tarefa toca permissão, escopo de empresa, RLS, listagem que recorta por empresa, transferência entre empresas, ou a pergunta é "quem pode ver isso?".
---

# Contrato Organização × Empresa

Resumo operacional. O documento canônico é `docs/MULTI-COMPANY-CONTRACT.md`; a matriz
gerada é `docs/COMPANY-RLS-MATRIX.md`; a autorização é `docs/AUTHORIZATION.md`.
Em caso de divergência, o documento vence este resumo.

## Os dois conceitos

- **Organização** = tenant. Isolamento, RLS de base, licenciamento, sequência do ID Global.
  Coluna `organization_id`. Nunca é escopo de empresa.
- **Empresa** = entidade operacional e legal dentro do tenant. Coluna `empresa_id`.
  É escopo de trabalho, filtro e autorização fina.

Colapsar os dois é o erro que abre o dado de um cliente para outro.

## Autorização = CAPACIDADE × ESCOPO

Combinados com **AND**, sempre:

- **Capacidade**: a permissão funcional da rota (`payables.view`). Existe UMA por função —
  nunca `empresa_a.payables.view`.
- **Escopo**: o conjunto de empresas daquele MÓDULO para aquele usuário.
- O **módulo ativo** deriva da permissão exigida pela rota. Nunca de URL, pathname, menu,
  cabeçalho, query ou corpo.

Nunca combine permissões com OR, e nunca caia em permissão vizinha quando o discriminador
é desconhecido — discriminador fora do mapa NEGA.

## Fail closed

| Situação | Resultado |
|---|---|
| Módulo sem configuração | NENHUMA empresa |
| Módulo indefinido | União das empresas visíveis |
| `{ modo: "selecionadas", empresaIds: [] }` | NENHUMA empresa |
| `{ modo: "todas" }` | escopo de LEITURA, resolvido no servidor a cada requisição |

"Lista vazia" **nunca** é "todas" — esse sentinela foi extinto e o formato antigo é
recusado na borda. E `"todas"` nunca é persistido como empresa de um lançamento: a empresa
gravada é a interseção `autorização ∩ empresas disponíveis`, carregada pelo servidor.

## Quem é autoridade

O **registro fonte vivo**, lido dentro do módulo da permissão dele. Não são autoridade:
a empresa selecionada no cabeçalho (é pedido), o `empresa_id` de índice denormalizado
(é dica), o menu, a URL. Empresa vinda do cliente só pode DIMINUIR o escopo.

## 404 vs 403

- **404**: inexistente · de outro tenant · fora de escopo · excluído (`deleted_at`) ·
  id malformado. Indistinguíveis de fora — mesma mensagem, sem diferença de latência.
- **403**: falta da capacidade funcional; seleção explícita de uma empresa proibida.

Responder 403 onde a resposta confirmaria existência é vazamento por enumeração.

## Na consulta

Recurso com coluna de empresa responde pela PRÓPRIA coluna, em CADA ocorrência —
subconsulta, CTE e cláusula `on` inclusive. Herdar recorte de junção só vale para tabela
sem coluna de empresa. Autorização antes dos dados, sempre antes do `limit`.
Toda gravação sob RLS confere ROW COUNT: fora de escopo a RLS devolve zero linhas, e zero
linha sem conferência vira sucesso sem efeito.
