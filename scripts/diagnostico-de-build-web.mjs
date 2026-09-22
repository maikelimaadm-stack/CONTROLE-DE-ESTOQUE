/**
 * O QUE O VERMELHO ESTÁ DIZENDO — quando `next build` morre por algo que não é o código desta árvore.
 *
 * Este módulo NÃO conserta build nenhum, NÃO reexecuta nada e NÃO muda o resultado de coisa alguma.
 * Ele faz uma coisa só: ler a saída de um build que JÁ falhou e, quando a falha tem uma assinatura
 * conhecida e externa, dizer em voz alta qual é. O processo continua morrendo, com o mesmo código de
 * saída, e o gate continua vermelho.
 *
 * POR QUE ISSO É CONSERTO E NÃO ENFEITE
 *
 * O job de version skew roda `next build` DUAS vezes: o HEAD e a base. Quando o segundo morre, o que o
 * CI exibe é "Version skew · os dois sentidos entre a base e este HEAD — FAILURE". Essa linha afirma
 * que a prova de compatibilidade REPROVOU. Em 22/09/2026 ela afirmou isso enquanto o que de fato
 * acontecera foi outra coisa: o Google Fonts devolveu um corpo que o Turbopack não sabe analisar, e o
 * binário da base nunca chegou a ser comparado com nada. Custou uma tarde para descobrir que o
 * instrumento estava descrevendo um cenário que não tinha acontecido.
 *
 * `api-anterior.mjs` já carrega essa lei no próprio cabeçalho: "Um instrumento que descreve o cenário
 * errado é o defeito que a PRE-BASE2-05C-0 existe para eliminar". Um vermelho que diz a coisa errada é
 * exatamente isso, e vale para a mensagem tanto quanto para a asserção.
 *
 * A REGRA DE OURO DESTE ARQUIVO
 *
 * Diagnóstico NUNCA vira decisão. Nada aqui pode ser consultado para escolher entre falhar e passar,
 * entre reexecutar e desistir, entre seguir e parar. No dia em que alguém usar `diagnosticar()` num
 * `if` que decide o destino do build, este arquivo terá virado o oposto do que foi escrito para ser —
 * e a primeira falha real com assinatura parecida passará despercebida.
 */

/**
 * As assinaturas conhecidas. Cada entrada exige TODAS as suas marcas, e não uma qualquer.
 *
 * Marca única seria frágil nos dois sentidos: `Module not found` sozinho aparece em build quebrado de
 * verdade (import errado nesta árvore), e nomear a causa externa ali seria absolver um defeito nosso.
 * Duas marcas que só coexistem no caminho específico eliminam isso — e, se mesmo assim coincidirem, o
 * pior resultado possível é um parágrafo a mais embaixo de um build que continua vermelho.
 */
export const ASSINATURAS = [
  {
    id: "fonte-google-url-com-e-comercial",
    marcas: [
      "next/font/google queries have exactly one entry",
      "@vercel/turbopack-next/internal/font/google/font"
    ],
    titulo: "o Google Fonts respondeu num formato que o Turbopack não consegue analisar",
    // O texto é longo de propósito: quem lê isto está olhando um CI vermelho e precisa decidir em um
    // minuto se mexe no código ou não. Mandar a pessoa "ver a documentação" seria devolver o problema.
    texto: [
      "ISTO NÃO É UMA FALHA DE COMPATIBILIDADE ENTRE AS VERSÕES.",
      "O build morreu ANTES de qualquer comparação: nenhum dos dois sentidos do skew chegou a rodar.",
      "",
      "MECANISMO (medido, não suposto)",
      "  1. `next/font/google` busca a folha de estilo em fonts.googleapis.com em TEMPO DE BUILD.",
      "  2. O Google responde, para a MESMA requisição, ora com URLs estáticas",
      "     (`fonts.gstatic.com/s/<familia>/<v>/<arquivo>.woff2`), ora com a forma dinâmica",
      "     (`fonts.gstatic.com/l/font?kit=…&skey=…&v=…`). Medição de 2026-09-22, FORA do runner:",
      "     6 respostas em 200 vieram na forma dinâmica (e 21 em 860 somando três amostras), nunca",
      "     misturadas — ou todos os blocos, ou nenhum. A taxa DENTRO do GitHub Actions não foi medida",
      "     e o histórico do CI sugere que lá ela é bem menor; não use esta taxa para decidir.",
      "  3. O Turbopack reembala cada URL de fonte numa QUERY STRING para si mesmo",
      "     (`update_google_stylesheet`, crates/next-core/src/next_font/google/mod.rs).",
      "  4. `&` é o separador de pares de uma query string. A URL dinâmica tem dois. Ao reabrir a",
      "     query, `font_file_options_from_query_map` encontra 3 pares onde exige exatamente 1, e aborta.",
      "",
      "O QUE ISSO SIGNIFICA PARA ESTA EXECUÇÃO",
      "  Nada foi provado e nada foi desprovado sobre a compatibilidade entre a base e este HEAD.",
      "  O código desta árvore não está implicado: a mesma árvore constrói normalmente quando a",
      "  resposta vem na forma estática.",
      "",
      "O QUE NÃO FAZER",
      "  Não mexa na fonte, na tipografia nem no `layout.tsx` por causa desta mensagem — o defeito",
      "  não está lá. Não marque o job como flaky: 3% por build não é ruído, é dívida conhecida.",
      "",
      "A DÍVIDA E A SAÍDA DELA",
      "  `docs/BUILD-DEPENDENCIA-REMOTA.md` é o dono do assunto: lista todos os pontos de build",
      "  expostos, a medição e a condição de encerramento. Enquanto a dívida existir, esta falha pode",
      "  reaparecer em QUALQUER `next build` — inclusive nos de implantação (Vercel e Docker)."
    ].join("\n")
  }
];

/**
 * A saída de um build que JÁ falhou → a assinatura conhecida, ou `null`.
 *
 * Pura de propósito: é ela que carrega a regra "duas marcas, não uma", e uma regra que só pudesse ser
 * exercitada derrubando o Google Fonts de verdade não teria como ser provada por teste nenhum.
 *
 * @param {string} saida stdout + stderr do build
 * @returns {{ id: string, titulo: string, texto: string } | null}
 */
export function diagnosticar(saida) {
  const s = String(saida ?? "");
  if (!s) return null;
  const a = ASSINATURAS.find((x) => x.marcas.every((m) => s.includes(m)));
  return a ? { id: a.id, titulo: a.titulo, texto: a.texto } : null;
}

/** O bloco como ele aparece no log do job. Separado para o teste poder conferir o texto sem capturar stderr. */
export function blocoDeDiagnostico(assinatura, contexto) {
  const L = "━".repeat(96);
  return `\n${L}\nDIAGNÓSTICO — ${contexto}: ${assinatura.titulo}\n[${assinatura.id}]\n${L}\n${assinatura.texto}\n${L}\n`;
}
