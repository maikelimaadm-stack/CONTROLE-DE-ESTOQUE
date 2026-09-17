/**
 * "ESTA EXECUÇÃO ATRAVESSA O HOTFIX DA NUMERAÇÃO DE TRANSFERÊNCIAS?" — decisão única, HOTFIX PRÉ-BASE2-03.
 *
 * O hotfix unifica a numeração de `erp.warehouse_transfers` num contador só (`warehouse_transfer`) e
 * transforma `farm_transfer` em ALIAS dentro de `erp.next_code`. O runtime muda junto: a rota deixa de
 * escolher a chave pelo `kind` e passa a pedir sempre a canônica.
 *
 * POR QUE A DECISÃO NÃO É A MESMA DA 05C-2
 * ----------------------------------------
 * Na 05C-2 os dois lados eram INCOMPATÍVEIS por construção: a chave mudava de nome e não havia como o
 * banco servir os dois binários, então a exceção INVERTIA o skew, passando a exigir a prova da recusa.
 *
 * Aqui é o contrário, e é essa diferença que a fatia compra: o alias faz o binário BASE — que pede
 * `farm_transfer` — receber número do contador CANÔNICO, sem criar linha legada. BASE e HEAD servem ao
 * mesmo banco pós-0019 ao mesmo tempo. O skew normal continua valendo integralmente, e o gate próprio
 * existe para PROVAR essa compatibilidade em vez de supô-la — mais o quadrante que continua proibido, que
 * é o inverso da ordem de deploy (API nova antes da migration).
 *
 * COMO A DECISÃO É TOMADA
 * -----------------------
 * Comparando a FORMA DA ALOCAÇÃO na rota de transferências, lida do texto de `stock.ts` na base e neste
 * HEAD. "Por variante" (um ternário sobre `kind`) contra "canônica" (uma chave só). Se as duas pontas já
 * forem canônicas, esta execução não atravessa o hotfix e o gate se declara inativo — o que acontece em
 * toda PR nova depois que o hotfix estiver em `main`. Não há nada para lembrar de remover.
 *
 * Ler o TEXTO, e não importar o módulo, é o mesmo motivo da 05C-2: a base vem de um commit que não está
 * montado como pacote, e importar exigiria build.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A rota que aloca o código da transferência. */
export const CAMINHO_ROTA = "apps/api/src/routes/stock.ts";

/** A constante canônica introduzida pelo hotfix. */
export const CAMINHO_CONSTANTE = "apps/api/src/lib/sequencia-warehouse-transfer.ts";

/** A migration do hotfix. */
export const MIGRATION_HOTFIX = "0019_warehouse_transfer_code_sequence.sql";

/** A chave canônica e a legada, como o banco as conhece. */
export const CANONICA = "warehouse_transfer";
export const LEGADA = "farm_transfer";
/**
 * A chave canônica do contador de TRANSFERÊNCIA DE REBANHO.
 *
 * `LEGADA` era SOBRECARREGADA: `erp.animal_movements` (namespace
 * `unique (organization_id, movement_type, code)`) numerava com ela, igual a `erp.warehouse_transfers`
 * (namespace `unique (organization_id, code)`). Um alias não sabe quem chamou, então a 0019 divide o
 * histórico antes de apagar a linha legada. A matriz do gate mede essa divisão.
 */
export const CANONICA_REBANHO = "animal_farm_transfer";

/**
 * Extrai o 3º argumento de cada `nextCode(...)` de um texto, contando parênteses.
 *
 * Mesma mecânica de `scripts/sequencia-namespace-audit.mjs` — e a duplicação é deliberada e mínima: aquele
 * auditor roda no `pnpm lint` sobre a árvore atual e não sabe ler commit nenhum; este módulo precisa da
 * MESMA leitura aplicada ao TEXTO de um commit arbitrário. Fundir os dois obrigaria o auditor a carregar
 * git, e um gate de lint que depende de rede é um gate que fica vermelho por motivo errado.
 */
function argumentosDeNextCode(texto) {
  const achados = [];
  const re = /\bnextCode\s*\(/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    let i = m.index + m[0].length, prof = 1, atual = "";
    const args = [];
    while (i < texto.length && prof > 0) {
      const c = texto[i];
      if (c === "(" || c === "[" || c === "{") prof++;
      else if (c === ")" || c === "]" || c === "}") { prof--; if (prof === 0) break; }
      if (c === "," && prof === 1) { args.push(atual); atual = ""; i++; continue; }
      atual += c;
      i++;
    }
    args.push(atual);
    if (args.length >= 3) achados.push(args[2].trim());
  }
  return achados;
}

/**
 * A FORMA DA ALOCAÇÃO na rota de transferências, lida do texto do módulo.
 *
 * Devolve `{ modo, argumento }` com `modo` em `"por-variante" | "canonico"`.
 *
 * FALHA FECHADO: se não houver exatamente UMA chamada de `nextCode` ligada a transferências, isto LANÇA.
 * Zero chamadas significa que a rota mudou de forma e a leitura está medindo outra coisa; duas ou mais
 * significa que a numeração se espalhou, e aí "qual delas?" é uma pergunta que um gate não pode responder
 * por conta própria. Nos dois casos, um valor de mentira levaria a matriz inteira a decidir sobre o
 * commit errado — e continuaria verde.
 */
export function formaNoTexto(texto) {
  const candidatos = argumentosDeNextCode(texto)
    .filter((a) => a.includes(CANONICA) || a.includes(LEGADA) || a.includes("SEQUENCIA_WAREHOUSE_TRANSFER"));

  if (candidatos.length !== 1) {
    throw new Error(
      `esperava exatamente UMA alocação de código de transferência em ${CAMINHO_ROTA}, encontrei `
      + `${candidatos.length}${candidatos.length ? `: [${candidatos.join(" | ")}]` : ""}. `
      + "Sem isso a matriz decidiria sobre uma leitura que não corresponde à rota.");
  }

  const arg = candidatos[0];
  // Ternário sobre a variante: foi assim que a rota numerava antes do hotfix.
  if (arg.includes(LEGADA)) return { modo: "por-variante", argumento: arg };
  return { modo: "canonico", argumento: arg };
}

/** A forma como ela está numa árvore de arquivos (o checkout atual). */
export function formaNaArvore(raiz) {
  const caminho = join(raiz, CAMINHO_ROTA);
  if (!existsSync(caminho)) throw new Error(`não achei ${caminho}`);
  return formaNoTexto(readFileSync(caminho, "utf8"));
}

/**
 * GARANTE QUE O OBJETO DO COMMIT ESTÁ AQUI — o checkout do CI é RASO.
 * Mesma convenção de `scripts/lib/cutover-contador.mjs`: buscar o SHA exato com profundidade 1, em vez de
 * pedir `fetch-depth: 0` no workflow. Silencioso quando o objeto já está presente.
 */
function garantirCommit(sha, cwd) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" }); return; }
  catch { /* clone raso: o objeto falta e é isso que o fetch abaixo resolve */ }
  execFileSync("git", ["fetch", "--depth=1", "origin", sha], { cwd, stdio: "ignore" });
}

/** A forma como ela está num COMMIT. Lança quando o commit não é alcançável — fail-closed. */
export function formaNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  return formaNoTexto(execFileSync("git", ["show", `${sha}:${CAMINHO_ROTA}`], { cwd, encoding: "utf8" }));
}

/** A migration do hotfix já existe no COMMIT dado? É o que separa "banco da base" de "banco deste HEAD". */
export function temMigrationNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}:supabase/migrations/${MIGRATION_HOTFIX}`], { cwd, stdio: "ignore" });
    return true;
  } catch { return false; }
}

/**
 * A decisão. Recebe as duas formas já lidas — função pura, testável sem git nem disco.
 *
 * `motivo` é para o log: um gate que decide sozinho tem de dizer em voz alta o que decidiu.
 */
export function decidir({ base, head }) {
  if (base === head) {
    return {
      atravessa: false, base, head,
      motivo: `a alocação é '${head}' nos dois lados: esta execução não atravessa o hotfix, e o version `
        + "skew normal vale integralmente.",
    };
  }
  if (base === "por-variante" && head === "canonico") {
    return {
      atravessa: true, base, head,
      motivo: "a rota deixa de numerar POR VARIANTE e passa a pedir a chave canônica. O alias da 0019 "
        + "mantém o binário BASE correto contra o banco novo, e é isso que a matriz prova — junto com o "
        + "quadrante que continua proibido (API nova antes da migration).",
    };
  }
  return {
    atravessa: true, base, head,
    motivo: `a alocação vai de '${base}' para '${head}' — sentido INVERTIDO do hotfix. Reintroduzir a `
      + "numeração por variante é reintroduzir o defeito, e a matriz recusa antes de simular.",
  };
}
