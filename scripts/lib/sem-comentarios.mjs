/**
 * CÓDIGO SEM COMENTÁRIO — o dono único desta operação.
 *
 * Todo auditor que casa TEXTO contra uma lista de padrões precisa disto, e pela mesma razão: este
 * repositório documenta em prosa exatamente aquilo que os auditores proíbem. `ui-support-matrix-audit`
 * lista `force: true` no próprio cabeçalho; `fonte-remota-audit` cita `next/font/google` para explicar
 * o que procura; o teste do diagnóstico do skew confere que `api-anterior.mjs` não tem `|| true`, num
 * arquivo cujo comentário promete não ter `|| true`. Nos três casos a primeira versão reprovou a
 * própria documentação — e um auditor que acusa a documentação ensina a apagar a documentação.
 *
 * Mora sozinho porque a alternativa era importá-lo de um auditor, e importar um auditor EXECUTA aquele
 * auditor: o gate novo passaria a depender do resultado do gate velho, e dois `process.exit` teriam de
 * disputar o mesmo processo.
 *
 * NÃO É O ÚNICO DESTA FAMÍLIA, e a exceção é deliberada. `scripts/farm-compat-allowlist.mjs` tem uma
 * versão própria que substitui cada caractere do comentário por um ESPAÇO, preservando a numeração
 * das linhas — ele reporta ofensa com `arquivo:linha`, e esta implementação aqui colapsaria os blocos
 * e faria o número apontar para a linha errada. Contratos diferentes, donos diferentes. Unificar os
 * dois "porque são parecidos" quebraria os relatórios daquele gate em silêncio.
 *
 * LIMITE CONHECIDO, declarado para ninguém confundir cobertura com garantia: isto é uma substituição
 * por expressão regular, não um analisador léxico. Uma string que CONTENHA `/*` ou `//` é tratada como
 * comentário. Para o uso real — varrer auditores e harness em busca de padrão proibido — a troca é
 * boa: o falso negativo exige alguém escrever o padrão proibido dentro de uma string que simula
 * comentário, enquanto o falso positivo (documentar o que se proíbe) acontecia toda semana.
 */
export function semComentarios(texto) {
  return String(texto ?? "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}
