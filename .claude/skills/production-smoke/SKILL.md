---
name: production-smoke
description: Roteiro de verificação SOMENTE LEITURA em produção, com regras do que nunca fazer e do que nunca imprimir. Só o usuário invoca; nunca é carregada automaticamente.
when_to_use: Maike pede explicitamente um smoke de produção e forneceu acesso autenticado real.
disable-model-invocation: true
effort: high
---

# Smoke de produção (somente leitura)

**Esta skill não se invoca sozinha.** Ela existe porque tocar produção precisa ser um ato
deliberado do Maike, não uma consequência de o modelo achar que ajudaria.

## Porta de entrada

Você tem acesso **autenticado e real** a produção, fornecido agora pelo Maike?

- **Não** → o resultado é, literalmente:
  `CURRENT PROD SMOKE: PENDING (sem credencial autenticada)`.
  Não tente contornar. Não use mock, fixture, `localhost`, preview, ambiente de E2E,
  `curl` sem sessão, health endpoint nem "o deploy está verde". Nenhum deles responde à
  pergunta "o usuário real, logado, vê a coisa certa?" — e declarar PASS com qualquer um
  deles é relatar uma verificação que não aconteceu.
- **Sim** → siga abaixo.

## Somente leitura

Permitido: abrir tela, listar, filtrar, paginar, abrir registro, conferir rótulo e número.

**Nunca**: criar · editar · excluir · confirmar · cancelar · estornar · movimentar estoque ·
baixar título · alterar usuário · alterar permissão · alterar configuração · rodar backfill ·
redeploy · aplicar migration. Se o roteiro parece exigir uma escrita para provar algo,
o roteiro está errado: peça autorização explícita ao Maike para aquela ação específica.

## Nunca imprimir

Senha · token · cookie · JWT · cabeçalho `Authorization` · DSN com credencial · chave de
serviço · segredo de assinatura. Nem completo, nem truncado, nem "só para depurar".
Ao citar uma requisição, cite o caminho e o código de resposta — nunca os cabeçalhos.

Dado de cliente real (nome, documento, valor) sai do relatório sempre que a conclusão
puder ser escrita sem ele: "3 linhas, todas com número" prova o mesmo e não vaza nada.

## Registrar

Para cada item: tela, o que foi observado, resultado (PASS/FAIL/PENDING) e a evidência
(contagem, rótulo visto, código de resposta). FAIL em produção interrompe o roteiro e
vira comunicação imediata — não vira correção improvisada no ar.
