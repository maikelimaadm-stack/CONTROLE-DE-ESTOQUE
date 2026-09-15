/**
 * O CONTRATO DO ESPELHO CANÔNICO ↔ LEGADO, POR PAR HISTÓRICO (PRE-BASE2-05C-0).
 *
 * Fonte única da regra, consumida pelo gate de linha de comando (`scripts/company-schema-sync.mjs`) e pelo
 * teste permanente (`apps/api/test/unit/espelho-empresa-fases.test.ts`). A função é PURA: recebe o schema já
 * lido e a fase declarada, devolve problemas. É isso que permite provar o contrato com migrations de mentira,
 * sem banco e sem depender do conteúdo de `supabase/migrations` — o que se prova é a REGRA.
 *
 * POR QUE POR PAR HISTÓRICO, E NÃO POR CONTAGEM
 * ---------------------------------------------
 * A versão anterior perguntava só "o que existe agora" e exigia `espelhados > 0`. Isso deixava passar o modo
 * de falha mais provável da fatia destrutiva: a PURGA PARCIAL. Some `farm_id` de UMA tabela por acidente;
 * sobram 51 espelhos; `espelhados > 0` continua verdadeiro; e a canônica órfã daquela tabela era contada
 * como "canônica de nascença" — porque, olhando só o presente, uma coluna que nunca teve espelho e uma
 * coluna que PERDEU o espelho são indistinguíveis. O gate ficava VERDE certificando perda de dado.
 *
 * A correção não é um limiar mais apertado (51 também é `> 0`): é mudar a pergunta. Cada par que EXISTIU na
 * ponte física da PRE-BASE2-03 é cobrado individualmente, e a história vem de `historico` em
 * `scripts/lib/schema.mjs` — isto é, das próprias migrations, que continuam sendo a única fonte.
 *
 * O QUE CADA FASE EXIGE
 * ---------------------
 * `dual`     — para CADA par histórico: canônica presente E legada presente, com a mesma obrigatoriedade.
 *              Faltar uma reprova. Faltar as duas reprova.
 * `canonica` — para CADA par histórico: canônica presente E legada AUSENTE.
 *              Faltar a canônica reprova (a 05C-1 remove só o legado; a canônica é o modelo final).
 *              Sobreviver a legada reprova.
 *
 * CANÔNICA DE NASCENÇA (`erp.notifications`, `erp.registros_globais`, `erp.membro_empresas`,
 * `erp.legado_escopo_empresa_v0`) nunca teve espelho: não entra na contagem de pares históricos e é legítima
 * sem legado nas DUAS fases. O que se cobra dela é apenas continuar existindo — some ela e o modelo final
 * perdeu uma coluna de empresa, que é a mesma perda por outro caminho.
 */

/** Cada canônica e o nome que ela teve na ponte física. Derivado da 0014; não é lista de tabelas. */
export const PARES_ESPELHO = [
  ["empresa_id", "farm_id"],
  ["empresa_origem_id", "origin_farm_id"],
  ["empresa_destino_id", "destination_farm_id"]
];

/** `dual`: as duas grafias convivem. `canonica`: o nome antigo não existe mais em lugar nenhum. */
export const FASES = ["dual", "canonica"];

/**
 * TABELA COM COLUNA DE EMPRESA QUE FOI REMOVIDA DE PROPÓSITO — com motivo, e só essas.
 *
 * Dropar a tabela inteira derruba o total de pares sem deixar rastro no presente, e um gate que só olhasse
 * a contagem continuaria satisfeito: é a purga parcial um degrau acima. Por isso toda remoção de tabela com
 * coluna de empresa REPROVA, exceto as declaradas aqui — fail-closed, com o arquivamento nomeado.
 *
 * Não é allowlist de conveniência: cada linha diz para ONDE o dado foi. A 05C-1 não acrescenta nenhuma —
 * ela remove colunas e views, nunca tabela.
 */
export const REMOCOES_DECLARADAS = {
  "erp.member_farms": "PRE-BASE2-03 (0014): o escopo herdado foi COPIADO para erp.legado_escopo_empresa_v0 (linhas 537-546 da migration) antes do `drop table` da linha 558. O dado não se perdeu — mudou de nome e virou arquivo morto."
};

const jaTeve = (t, c) => Boolean(t.historico?.has(c));

/**
 * Confere o schema contra a fase declarada.
 * @param {Map<string, {columns: Map<string, {notNull?: boolean}>, historico?: Set<string>}>} tables
 * @param {"dual"|"canonica"} fase
 * @returns {{ problemas: string[], paresHistoricos: number, tabelasHistoricas: number, canonicasDeNascenca: number, legadasVivas: number }}
 */
export function conferirEspelho(tables, fase) {
  const problemas = [];
  if (!FASES.includes(fase)) {
    return { problemas: [`fase inválida (${fase}); esperado: ${FASES.join(" | ")}`], paresHistoricos: 0, tabelasHistoricas: 0, canonicasDeNascenca: 0, legadasVivas: 0 };
  }

  let paresHistoricos = 0, canonicasDeNascenca = 0, legadasVivas = 0;
  const tabelasHistoricas = new Set();

  for (const [nome, t] of tables) {
    for (const [canonico, legado] of PARES_ESPELHO) {
      const teveC = jaTeve(t, canonico);
      const teveL = jaTeve(t, legado);
      if (!teveC && !teveL) continue;

      const c = t.columns.get(canonico);
      const l = t.columns.get(legado);

      // Legada que existiu sem canônica correspondente: a ponte da 0014 criou as duas juntas, então isso é
      // um par meio-construído — o runtime novo não encontraria a coluna.
      if (teveL && !teveC) {
        problemas.push(`${nome}.${legado} existiu sem a canônica ${canonico} — par meio-construído: o runtime novo não encontraria a coluna`);
        continue;
      }

      // CANÔNICA DE NASCENÇA: nunca houve espelho. Legítima sem legado nas duas fases — mas tem de existir.
      if (teveC && !teveL) {
        canonicasDeNascenca++;
        if (!c) problemas.push(`${nome}.${canonico} nasceu canônica e DESAPARECEU — a purga remove só o nome antigo, nunca a coluna canônica`);
        continue;
      }

      // PAR HISTÓRICO: as duas grafias existiram. É este que a purga muda, e é este que se cobra por par.
      paresHistoricos++;
      tabelasHistoricas.add(nome);
      if (l) legadasVivas++;

      if (!c) {
        problemas.push(`${nome}.${canonico} é canônica de um par histórico e DESAPARECEU — a 05C-1 remove o legado, nunca a canônica`);
        continue;
      }
      if (fase === "dual") {
        if (!l) {
          problemas.push(`${nome}.${legado} é espelho histórico e sumiu com a fase ainda em "dual" — PURGA PARCIAL: o cliente anterior lê a coluna vazia sem erro`);
          continue;
        }
        if (Boolean(c.notNull) !== Boolean(l.notNull)) {
          problemas.push(`${nome}: ${canonico} é ${c.notNull ? "NOT NULL" : "anulável"} mas ${legado} é ${l.notNull ? "NOT NULL" : "anulável"} — as duas grafias precisam aceitar exatamente o mesmo`);
        }
        continue;
      }
      // fase === "canonica"
      if (l) problemas.push(`${nome}.${legado} sobreviveu à purga: a fase declarada é "canonica" e o nome antigo não pode mais existir`);
    }
  }

  // A TABELA INTEIRA TAMBÉM PODE SUMIR — e some com a história dela.
  // Dropar uma tabela com par histórico derruba a contagem de 52 para 51 sem deixar rastro no presente. Um
  // gate que só olhasse o total continuaria satisfeito, que é o mesmo pecado da purga parcial num degrau
  // acima. A lápide que `readSchema` guarda é o que permite nomear a tabela que sumiu.
  for (const [nome, t] of tables.removidas ?? []) {
    if (Object.hasOwn(REMOCOES_DECLARADAS, nome)) continue;
    const pares = PARES_ESPELHO.filter(([c, l]) => jaTeve(t, c) || jaTeve(t, l)).map(([c]) => c);
    if (pares.length) {
      problemas.push(`${nome} tinha coluna de empresa (${pares.join(", ")}) e a tabela INTEIRA foi removida em ${t.removidaEm} — a purga tira o nome antigo, nunca a tabela. Se a remoção é consciente, declare-a em REMOCOES_DECLARADAS dizendo para onde o dado foi`);
    }
  }

  // A PREMISSA JUNTO COM A CONCLUSÃO. Sem par histórico nenhum, o laço acima não executa asserção alguma e
  // o gate imprimiria OK sem ter medido nada — o verde que não prova nada, no momento mais perigoso.
  if (paresHistoricos === 0) {
    problemas.push('nenhum par histórico encontrado no schema: ou o leitor de migrations parou de enxergar as colunas de empresa, ou a história se perdeu. Nos dois casos este gate deixou de medir o que diz medir.');
  }
  if (fase === "dual" && paresHistoricos > 0 && legadasVivas === 0) {
    problemas.push('a fase declarada é "dual", mas NENHUM espelho legado sobreviveu: a purga já rodou e FASE_ESPELHO não foi virada para "canonica".');
  }

  return { problemas, paresHistoricos, tabelasHistoricas: tabelasHistoricas.size, canonicasDeNascenca, legadasVivas };
}
