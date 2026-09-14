# Critérios de Code Review

Para a revisão automatizada e humana das PRs deste repositório.
As leis do projeto estão no `CLAUDE.md` e em `.claude/rules/`; aqui fica só o que o
REVISOR procura, na ordem em que procura.

## Antes de tudo

**Leia o diff real.** A descrição da PR diz o que o autor quis fazer; o diff diz o que ele
fez. Aprovar pela descrição é aprovar a intenção, não a mudança.

## Ordem de busca

1. **Segurança, autorização, RLS, isolamento de tenant.** Capacidade verificada antes do
   dado; escopo de empresa aplicado em cada ocorrência da consulta; AND, nunca OR;
   fail-closed; 404 onde a existência não pode vazar; política de RLS substituída e não
   somada; `SECURITY DEFINER` estreito; sem segredo no diff.
2. **Perda ou corrupção de dados.** Ledger editado; identidade já exibida renumerada;
   correção silenciosa de acervo; exclusão física onde o contrato pede lógica.
3. **Migrations e ordem de deploy.** Arquivo novo numerado; migration aplicada intocada;
   dependências (política, trigger, view, função) reescritas antes do drop;
   BANCO → API → WEB; caminho de volta escrito.
4. **Contrato e compatibilidade.** Formato de resposta e payload; o cliente publicado
   continua funcionando contra esta API, e esta web contra a API publicada (version skew
   nos dois sentidos quando a inversão for possível); entrada não canônica recusada, nunca
   ignorada.
5. **Escopo indevido.** Arquivo que a fatia não precisava tocar; fase futura antecipada;
   limpeza ampla misturada. É bloqueador mesmo quando o código está bom.
6. **Concorrência.** Idempotência; `version` otimista; lock; ROW COUNT conferido.
7. **N+1 e desempenho.** `await` dentro de laço; consulta por linha; porta de detalhe usada
   em listagem; autorização depois do `limit`; chave de cache sem organização/empresa.
8. **Testes e gates.** O que a mudança quebraria sem nenhum teste pegar? Asserção
   enfraquecida, baseline aumentado, teste pulado, verde com zero linhas. Gate novo sem
   verificação reversa.
9. **Regressão de interface.** Componente genérico alterado muda telas não citadas;
   controle que aparece e não funciona; enum cru; primitive duplicada.
10. **Documentação e SSOT.** Decisão sem motivo escrito; documento divergente do código;
    segunda lista com a mesma informação.

## Como escrever o achado

- Arquivo e **linha**. Sem localização não é achado, é impressão.
- **Cenário concreto**: quem faz o quê e vê o quê de errado. Se você não consegue
  descrevê-lo, provavelmente não é um defeito — diga isso.
- **Classificação**: `BLOCKER` · `HIGH` · `MEDIUM` · `LOW`.
- Correção sugerida em uma frase.

## O que não fazer

- Não elogie genericamente ("boa refatoração!"): ocupa espaço e não informa.
- Não deixe `nit` bloquear merge; marque como `LOW` e siga.
- Não invente achado para a lista não ficar vazia. **Nenhum achado é um resultado válido.**
- Não aprove por plausibilidade: prova alegada e não verificada se reporta como
  *não verificada*.
- **Não mande mesclar.** O merge é do responsável humano pelo repositório.
