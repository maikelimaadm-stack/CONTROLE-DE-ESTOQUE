/**
 * "A BASE JÁ TEM A ESTRUTURA E AS FICHAS DE CADASTRO?" — decisão única do version skew dos cadastros (#62).
 *
 * Gêmeo de `lib/previa-confirmacao.mjs` (e de `lib/capacidade-top.mjs`), de propósito: mesma forma de medir,
 * mesmo artefato, mesma falha fechada. Quem entende um entende os outros.
 *
 * O QUE ESTÁ EM JOGO. A #62 (CADASTROS-ESTRUTURA e as Fases 4, 5 e 6) mudou, na mesma PR, o SCHEMA e o CONTRATO
 * de escrita de quatro cadastros: o Grupo de Produtos virou árvore e o produto perdeu a obrigação de categoria e
 * classe (0025); o Parceiro ganhou a ficha com grades e perfis (0027); o RH ganhou Funcionários e o "novo pelo
 * CPF" (0028); o Produto ganhou a ficha com controle de lote, colunas e unidades (0029). Os casos de skew desses
 * cadastros foram escritos quando a base ERA ANTERIOR à #62 e afirmavam, no sentido 1, "a base RECUSA o corpo
 * da web nova" e, no sentido 2, "o web da base manda o corpo antigo". Com a #62 na `main`, a base de toda PR
 * nova JÁ TEM as quatro fatias, e as duas afirmações ficaram falsas por decurso de prazo — sem nenhuma linha de
 * código quebrar. O job ficou vermelho para qualquer PR, inclusive uma de diff vazio.
 *
 * O MUNDO SE MEDE NA ÁRVORE DA BASE, não num SHA digitado nem numa variável que alguém liga. A assinatura de
 * cada fatia é a SUA migration, pelo NOME exato: o schema e o contrato de escrita da API entraram juntos, e o
 * runner aplica e registra a migration pelo nome. Um binário da base que tem a migration tem a fatia.
 *
 *   base sem a migration → mundo LEGADO → o sentido 1 prova que a base RECUSA o corpo novo (422, nada gravado),
 *                                         e o sentido 2 prova que a API nova aceita o corpo ANTIGO;
 *   base com a migration → mundo ATUAL  → o sentido 1 prova que a base ACEITA o corpo novo e grava os valores
 *                                         certos (conferidos no banco), e o sentido 2 prova que a API nova
 *                                         aceita o corpo que o web da base (já com a fatia) manda.
 *
 * Nos dois mundos o gate COBRA alguma coisa do binário real. Não existe ramo que apenas passe.
 *
 * AJUSTES 01 (0030, decisão 257). A PR que trouxe a 0030 mudou também o CONTRATO — a máscara de uma árvore com
 * registros passou a ser recusada (D-4) e o Parceiro ganhou os campos da 0030, que a web só mostra e envia com a
 * capacidade `consultaCnpjJanela`. Os casos do sentido 1 que falavam disso (CE-K4, AJ-K3) foram escritos quando a
 * base ERA ANTERIOR a ela, e afirmariam para sempre o mundo legado depois do merge. A fatia entra nesta MESMA lista,
 * com DUAS assinaturas que entraram juntas: a migration e a CAPACIDADE declarada em `/auth/context`
 * (`ARQUIVO_CAPACIDADES`). As duas têm de concordar na base; uma sem a outra é estado que ninguém publicou: REPROVA.
 *
 * FALHA FECHADO, E O ESTADO AMBÍGUO REPROVA. Presente ou ausente são respostas. Mas se a assinatura não existe
 * neste HEAD, ou se o NÚMERO da migration existe na base com OUTRO nome, o detector deixou de identificar o que
 * promete (arquivo renomeado, numeração reaproveitada) — escolher um ramo aí é decidir às cegas: REPROVA. Base
 * sem nenhuma migration também reprova: é leitura quebrada, não uma base "anterior a tudo". Fatia com capacidade:
 * a capacidade tem de existir UMA vez neste HEAD, no máximo uma vez na base, e na base junto com a migration.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Onde as migrations moram, relativo à raiz do repositório. */
export const DIR_MIGRATIONS = "supabase/migrations";

/**
 * AS FATIAS E AS SUAS ASSINATURAS — a ÚNICA lista. O CLI grava a migration de cada chave no artefato, e os
 * testes consultam só a CHAVE: ninguém repete nome de arquivo fora daqui.
 */
export const FATIAS = Object.freeze({
  grupoArvore: Object.freeze({ migration: "0025_grupo_de_produtos_arvore.sql", oQue: "Grupo de Produtos em árvore; produto sem categoria e classe" }),
  fichaParceiro: Object.freeze({ migration: "0027_parceiros_ficha_em_abas.sql", oQue: "ficha do Parceiro com grades e perfis" }),
  rhFuncionarios: Object.freeze({ migration: "0028_rh_funcionarios.sql", oQue: "RH: Funcionários e o novo pelo CPF" }),
  fichaProduto: Object.freeze({ migration: "0029_produtos_ficha_em_abas.sql", oQue: "ficha do Produto: controle de lote, colunas e unidades" }),
  cadastrosAjustes01: Object.freeze({ migration: "0030_cadastros_ajustes_01.sql", capacidade: "consultaCnpjJanela", oQue: "AJUSTES 01: campos do Parceiro (0030) e janela Consultar CNPJ; máscara travada com registros (D-4)" }),
});

/**
 * Onde a API declara as capacidades (`GET /auth/context` → `capacidades`), relativo à raiz. A assinatura de uma
 * capacidade é a chave `<nome>:` no objeto — a mesma leitura do caso AJ-K2 do sentido 1.
 */
export const ARQUIVO_CAPACIDADES = "apps/api/src/routes/auth.ts";

/** Quantas vezes a capacidade é declarada numa fonte de `ARQUIVO_CAPACIDADES` (`<nome>:`). */
export function declaracoesDaCapacidade(fonte, nome) {
  if (typeof fonte !== "string") return null;
  return fonte.split(`${nome}:`).length - 1;
}

/** Onde a decisão é gravada. `skew-fichas-cadastro.mjs` escreve; os dois specs de skew leem e RECALCULAM. */
export const ARQUIVO_DECISAO = ".skew-fichas-cadastro.json";

/** O nome da variável de CONFERÊNCIA: as chaves presentes na base, em ordem alfabética, separadas por vírgula. */
export const VARIAVEL = "SKEW_BASE_FICHAS_CADASTRO";

/** As migrations (só o nome do arquivo) de uma árvore de arquivos — o checkout atual, ou a worktree da base. */
export function migrationsNaArvore(raiz) {
  const dir = join(raiz, DIR_MIGRATIONS);
  if (!existsSync(dir)) throw new Error(`não achei ${dir}`);
  return readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
}

/** O checkout do CI é raso: busca o SHA exato com profundidade 1. Silencioso quando o objeto já existe. */
function garantirCommit(sha, cwd) {
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd, stdio: "ignore" }); return; }
  catch { /* clone raso: o objeto falta e é isso que o fetch abaixo resolve */ }
  execFileSync("git", ["fetch", "--depth=1", "origin", sha], { cwd, stdio: "ignore" });
}

/**
 * As migrations como estão num COMMIT — nunca na worktree montada, que pode ter sobrado de outra execução.
 * Falha fechado: commit inexistente e impossível de buscar LANÇA, e quem chama aborta.
 */
export function migrationsNoCommit(sha, cwd = process.cwd()) {
  garantirCommit(sha, cwd);
  const saida = execFileSync("git", ["ls-tree", "--name-only", sha, `${DIR_MIGRATIONS}/`], { cwd, encoding: "utf8" });
  return saida.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".sql")).map((l) => l.slice(l.lastIndexOf("/") + 1)).sort();
}

/** O valor que a variável de conferência TEM de ter para um conjunto de decisões. */
export function valorDaVariavel(fatias) {
  return Object.keys(fatias).filter((k) => fatias[k]).sort().join(",");
}

/**
 * A decisão, pura: recebe as listas já lidas — a da BASE e a deste HEAD — e, para as fatias com capacidade, a fonte
 * de `ARQUIVO_CAPACIDADES` nos dois commits; é testável sem git nem disco. Fonte ausente com fatia que a exige
 * REPROVA (não se decide só pela metade da assinatura). `motivo` é para o log do CI: um job que decide sozinho tem
 * de dizer em voz alta o que decidiu.
 *
 * @param {{ daBase: string[], doHead: string[], capacidadesDaBase?: string | null, capacidadesDoHead?: string | null }} entrada
 * @returns {{ fatias: Record<string, boolean>, motivo: string }}
 */
export function decidir({ daBase, doHead, capacidadesDaBase, capacidadesDoHead }) {
  if (!Array.isArray(daBase) || daBase.length === 0) {
    throw new Error(`a base não tem nenhuma migration em ${DIR_MIGRATIONS}: isso é leitura quebrada, não uma base anterior `
      + "a tudo. Sem a lista não dá para medir, e supor um dos dois mundos certificaria um cenário que pode não ser o desta execução.");
  }
  const fatias = {};
  const linhas = [];
  for (const [chave, { migration, capacidade }] of Object.entries(FATIAS)) {
    if (!doHead.includes(migration)) {
      throw new Error(`a assinatura ${migration} (${chave}) não existe neste HEAD: o detector deixou de identificar o que promete `
        + "(migration renomeada ou movida). Escolher um ramo aqui seria decidir às cegas, então o gate REPROVA.");
    }
    const numero = migration.slice(0, migration.indexOf("_") + 1);
    const mesmoNumero = daBase.filter((n) => n.startsWith(numero));
    const presente = daBase.includes(migration);
    if (mesmoNumero.length > (presente ? 1 : 0)) {
      throw new Error(`a base tem ${mesmoNumero.join(", ")} com o número de ${migration} (${chave}): a numeração foi reaproveitada ou o `
        + "arquivo foi renomeado, e a presença do nome deixou de responder à pergunta. O gate REPROVA e alguém revisa a assinatura.");
    }
    if (capacidade) {
      const noHead = declaracoesDaCapacidade(capacidadesDoHead, capacidade);
      const naBase = declaracoesDaCapacidade(capacidadesDaBase, capacidade);
      if (noHead === null || naBase === null) {
        throw new Error(`a fatia ${chave} se mede também pela capacidade ${capacidade} (${ARQUIVO_CAPACIDADES}), e a fonte `
          + `${noHead === null ? "deste HEAD" : "da base"} não foi lida. Decidir só pela migration seria decidir pela metade da assinatura: REPROVA.`);
      }
      if (noHead !== 1) {
        throw new Error(`a capacidade ${capacidade} (${chave}) aparece ${noHead} vez(es) em ${ARQUIVO_CAPACIDADES} deste HEAD, e não 1: o detector `
          + "deixou de identificar o que promete (capacidade renomeada ou duplicada). O gate REPROVA.");
      }
      if (naBase > 1) {
        throw new Error(`a capacidade ${capacidade} (${chave}) aparece ${naBase} vezes em ${ARQUIVO_CAPACIDADES} da base: contagem ambígua não decide ramo nenhum.`);
      }
      if ((naBase === 1) !== presente) {
        throw new Error(`a base ${presente ? "tem" : "NÃO tem"} ${migration} mas ${naBase === 1 ? "declara" : "NÃO declara"} ${capacidade} (${chave}): `
          + "as duas assinaturas entraram juntas, e uma sem a outra é um estado que ninguém publicou. O gate REPROVA e alguém revisa a assinatura.");
      }
    }
    fatias[chave] = presente;
    linhas.push(`${chave}=${presente ? "ATUAL" : "LEGADO"}`);
  }
  return {
    fatias,
    motivo: `${linhas.join(" · ")}. Mundo LEGADO: o sentido 1 prova que a base RECUSA o corpo novo e o sentido 2 que a API nova `
      + "aceita o corpo antigo. Mundo ATUAL: o sentido 1 prova que a base ACEITA e grava o corpo novo, e o sentido 2 que a API nova "
      + "aceita o corpo que o web da base manda.",
  };
}
