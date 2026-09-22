/**
 * O aviso que separa "rodou" de "certificou".
 *
 * `pnpm e2e:mobile` executa uma suíte que o produto declarou DEFERRED: ela PODE e DEVE ficar vermelha
 * enquanto a dívida existir. Sem este aviso, um vermelho no terminal parece defeito de quem rodou, e
 * um verde parece aprovação — as duas leituras erradas pela mesma razão: falta dizer o que a suíte é.
 */
const L = "─".repeat(78);
console.log(`\n${L}
SUÍTE MOBILE — DEFERRED · NÃO CERTIFICA NADA · NÃO É GATE DE ENTREGA

  Mobile está fora do contrato de suporte vigente (docs/UI-SUPPORT-MATRIX.md).
  VERMELHO aqui é o resultado ESPERADO: é a dívida conhecida se reproduzindo.
  VERDE aqui também não libera nada — quem libera entrega é \`pnpm e2e\`.

  Fechar a dívida é trabalho de MOBILE-01, e se faz consertando o defeito —
  nunca tirando o teste da suíte.
${L}\n`);
