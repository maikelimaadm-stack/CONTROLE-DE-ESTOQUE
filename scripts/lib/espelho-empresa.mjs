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

/**
 * A INVARIANTE DE TRANSFERÊNCIA — a única regra de NEGÓCIO que a purga derruba em silêncio (05C-G1).
 *
 * `erp.equipment_transfers` nasceu com `check (origin_farm_id <> destination_farm_id)`
 * (supabase/migrations/0005_sales_fleet_hr.sql:142), INLINE e SEM NOME — o PostgreSQL a chamou de
 * `equipment_transfers_check`. Ela é a única garantia, no banco, de que um equipamento não é transferido
 * para a empresa onde já está.
 *
 * O PROBLEMA QUE ESTE CONTRATO FECHA: medido em banco descartável, `alter table ... drop column
 * origin_farm_id` derruba esse CHECK JUNTO, sem erro, sem aviso e sem `cascade` — é o que o PostgreSQL faz
 * com toda constraint que depende da coluna removida. A migration termina com sucesso, a suíte fica verde,
 * e a invariante simplesmente deixou de existir. Nenhum gate deste repositório reprovava isso.
 *
 * Por isso a invariante é cobrada POR FASE, do mesmo jeito que o espelho:
 *   `dual`     — o CHECK vive sobre as colunas LEGADAS. É o estado de hoje.
 *   `canonica` — o CHECK vive sobre as colunas CANÔNICAS. A 05C-1 só pode declarar essa fase se tiver
 *                criado o substituto.
 *
 * O QUE ESTE CONTRATO PROVA, E O QUE NÃO PROVA: ele afirma que, ao FIM de todas as migrations, existe um
 * CHECK validado na forma da fase. Não afirma em que arquivo ele nasceu — o catálogo não guarda isso, e
 * uma purga dividida em dois arquivos produziria o mesmo verde. Que o substituto nasça no MESMO arquivo
 * do drop é decisão de execução (decisão 118), não algo medido aqui. O que está garantido é o essencial:
 * nenhuma 05C-1 consegue derrubar a invariante e ficar verde.
 *
 * O que se cobra é a FORMA (as duas colunas certas, em desigualdade, validada), nunca o texto: exigir a
 * letra faria o gate quebrar por espaço em branco ou por como o `pg_get_constraintdef` normaliza.
 */
export const INVARIANTE_TRANSFERENCIA = {
  tabela: "equipment_transfers",
  origem: "supabase/migrations/0005_sales_fleet_hr.sql:142",
  colunasPorFase: { dual: ["origin_farm_id", "destination_farm_id"], canonica: ["empresa_origem_id", "empresa_destino_id"] }
};

/** As duas colunas que a fase exige na desigualdade. Fase desconhecida NEGA — não cai em vizinha. */
export const colunasDaInvarianteDeTransferencia = (fase) => INVARIANTE_TRANSFERENCIA.colunasPorFase[fase] ?? null;

/**
 * As formas ACEITAS da invariante, por igualdade — nunca por conter.
 *
 * A primeira versão deste guarda testava SUBSTRING: qualquer predicado que CONTIVESSE `a <> b`
 * passava. A revisão adversarial mostrou o custo: `NOT (a <> b)` — que afirma o CONTRÁRIO da
 * invariante — era aprovado, e `(a <> b) OR (note IS NOT NULL)` também. É a mesma família de falha
 * que a decisão 116 fechou para políticas de RLS: o predicado certo continua visível e não vale mais
 * nada. Aqui ela é pior, porque o guarda existe exatamente para impedir que a 05C-1 enfraqueça a
 * regra sem ninguém ver.
 *
 * Exigir IGUALDADE com um conjunto pequeno de formas é legítimo neste caso: quem escreve este CHECK
 * é este repositório, num arquivo, uma vez. E as três formas aceitas são as três maneiras corretas
 * de dizer a mesma coisa em PostgreSQL — `IS DISTINCT FROM` inclusive, que é ESTRITAMENTE MAIS FORTE
 * (também recusa a igualdade entre nulos) e que a versão anterior reprovava.
 */
const FORMAS_ACEITAS = (a, b) => [`${a}<>${b}`, `${b}<>${a}`, `not${a}=${b}`, `not${b}=${a}`, `${a}isdistinctfrom${b}`, `${b}isdistinctfrom${a}`];

/** `CHECK ((x <> y))` e `check(("x")<>("y"))` são o MESMO predicado: o que varia é a tipografia. */
const normalizar = (def) => String(def).toLowerCase().replace(/^\s*check\s*/, "").replace(/[()"\s]/g, "").replace(/::[a-z_]+/g, "").replace(/!=/g, "<>");

/**
 * Confere a invariante contra os CHECKs que o banco realmente tem.
 * @param {"dual"|"canonica"} fase
 * @param {{ nome: string, definicao: string, validado?: boolean }[]} checks CHECKs vivos de erp.equipment_transfers
 * @returns {string[]} problemas
 */
export function conferirInvarianteDeTransferencia(fase, checks) {
  const alvo = colunasDaInvarianteDeTransferencia(fase);
  if (!alvo) return [`fase inválida (${fase}); esperado: ${FASES.join(" | ")}`];
  const [a, b] = alvo;
  const lista = Array.isArray(checks) ? checks : [];
  const aceitas = new Set(FORMAS_ACEITAS(a, b));
  const casa = lista.filter((c) => aceitas.has(normalizar(c.definicao)));
  // `validado !== true` e não `=== false`: ausente, nulo ou "f" de driver em modo texto NÃO contam
  // como validado. Fail-closed — "existir não é o mesmo que valer" precisa valer para o default também.
  const valem = casa.filter((c) => c.validado === true);
  const problemas = [];
  if (!valem.length) {
    const quase = casa.length ? ` (${casa.length} CHECK(s) com a forma certa, nenhum validado)` : "";
    problemas.push(`erp.${INVARIANTE_TRANSFERENCIA.tabela}: a fase "${fase}" exige um CHECK VALIDADO negando a igualdade entre ${a} e ${b}, e nenhum dos ${lista.length} CHECK(s) da tabela faz isso${quase}. Na 05C-1 o \`drop column\` derruba o CHECK legado EM SILÊNCIO: o substituto canônico precisa existir antes do drop. Origem do original: ${INVARIANTE_TRANSFERENCIA.origem}`);
  }
  // A grafia da OUTRA fase sobrevivendo é o sintoma de purga pela metade: as duas gerações vivas ao
  // mesmo tempo significam que alguém criou o substituto e não removeu o original, ou o contrário.
  const outra = colunasDaInvarianteDeTransferencia(fase === "dual" ? "canonica" : "dual");
  if (fase === "canonica" && outra) {
    const antigas = new Set(FORMAS_ACEITAS(outra[0], outra[1]));
    if (lista.some((c) => antigas.has(normalizar(c.definicao)))) {
      problemas.push(`erp.${INVARIANTE_TRANSFERENCIA.tabela}: a fase é "canonica" mas ainda existe CHECK sobre ${outra.join(" / ")} — a coluna legada deveria ter saído e levado o CHECK junto.`);
    }
  }
  return problemas;
}
