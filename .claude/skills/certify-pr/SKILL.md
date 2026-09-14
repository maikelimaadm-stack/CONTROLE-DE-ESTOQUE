---
name: certify-pr
description: Certificar uma PR deste repositório antes da revisão humana — escopo, segurança, migrations, contrato, testes e CI, comparando base...HEAD no diff real. Use para auditar uma PR (própria ou não) e produzir veredito com bloqueadores.
when_to_use: Pedidos como "certifique a PR", "audite a PR #N", "isso está pronto para revisão?", ou antes de declarar uma fatia concluída. Também ao receber correção de certificação apontando bloqueadores.
effort: xhigh
---

# Certificar uma PR

Você está aqui para DESCONFIAR. O relatório do executor não é evidência — é a
afirmação que você veio testar. Certificação que só confirma o relatório não certifica nada.

## Regra de ouro

Leia o **diff real** (`git diff <base>...HEAD`, `pull_request_read` com `get_diff`),
nunca a descrição da PR. Descrição diz o que o autor quis fazer; diff diz o que fez.

## Ordem de auditoria

1. **Segurança e autorização.** Alguma porta nova sem capacidade verificada? Escopo de
   empresa aplicado em cada ocorrência? 404 onde a existência não pode vazar? RLS
   estreitada por substituição e não por política ao lado? Entrada não canônica recusada?
2. **Perda ou corrupção de dados.** Ledger editado? Identidade já exibida renumerada?
   Migration que corrige acervo em silêncio?
3. **Migrations e ordem de deploy.** Arquivo novo numerado? Editou migration já aplicada?
   A ordem BANCO → API → WEB continua válida? Precisa de version skew nos dois sentidos?
4. **Contrato e compatibilidade.** Resposta ou payload mudou de forma? Cliente publicado
   continua funcionando contra esta API, e esta web contra a API publicada?
5. **Escopo indevido.** Arquivo que a fatia não precisava tocar. Fatia futura antecipada.
   Limpeza ampla misturada. Cada um é bloqueador de escopo, mesmo se o código for bom.
6. **Concorrência.** Idempotência, `version`, lock, ROW COUNT conferido.
7. **Desempenho.** N+1 (procure `await` dentro de laço e consulta por linha), consulta
   sem índice, autorização depois do `limit`.
8. **Testes e gates.** O que a mudança quebraria que NENHUM teste pega? Asserção
   enfraquecida? Baseline aumentado? Teste que passa com zero linhas?
9. **Regressão de interface.** Componente genérico alterado: as outras telas mudaram junto?
10. **Documentação e SSOT.** Decisão sem motivo escrito; documento divergente do código.

## Verificar o que foi afirmado

Para cada prova que a PR alega: rode. "Gate reprova se removerem a coluna" só vale se
você remover a coluna e ver reprovar. Alegação não verificada entra no veredito como
**não verificada**, não como aprovada.

## Veredito

Classifique cada achado: **BLOCKER · HIGH · MEDIUM · LOW**, com arquivo, linha e a
consequência concreta ("quem lista X na empresa Y vê linha de Z"). Sem elogio genérico,
sem nit que trava merge.

Termine com um dos dois:
- `READY FOR CODE REVIEW` (com gates pendentes listados), ou
- `NOT READY` + lista numerada de bloqueadores.

**Você não mescla e não marca ready.** Certificar é dizer o que encontrou, não liberar.
