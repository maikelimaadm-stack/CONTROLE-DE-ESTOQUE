import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * A DECISÃO DAS FICHAS DE CADASTRO DA BASE, LIDA DO ARTEFATO — nos DOIS sentidos do skew, por UMA porta.
 *
 * Quem mede é `scripts/skew-fichas-cadastro.mjs` (regra em `scripts/lib/fichas-cadastro.mjs`, a única lista de
 * fatias e assinaturas): ele lê as migrations do COMMIT da base e grava o insumo junto com a decisão. Aqui o
 * e2e RECALCULA a presença a partir desse insumo, confere que a decisão foi medida na base que está servindo
 * (`.api-anterior.base`, provada pelo caso IDENTIDADE de cada sentido) e usa a variável de ambiente só como
 * CONFERÊNCIA — divergência REPROVA em vez de escolher um ramo. Ausência do arquivo é FALHA, não "então é o
 * mundo legado": supor o ramo fácil é justamente como um gate se autoaprova.
 *
 * Mora aqui, e não em cada spec, porque os dois sentidos consultam a MESMA decisão: duas cópias envelheceriam
 * cada uma por conta própria.
 */
export type FatiaDeCadastro = "grupoArvore" | "fichaParceiro" | "rhFuncionarios" | "fichaProduto";

/**
 * CPF válido GERADO a cada chamada (os dois sentidos do RH no mundo atual). O banco do skew é o mesmo nos dois
 * sentidos e reaproveitado entre execuções locais: um CPF fixo viraria "já existe" (200, `criado: false`) na
 * segunda vez — outro caminho da rota, não o que o caso prova.
 */
export function cpfValido(): string {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (xs: number[]) => { const s = xs.reduce((a, x, i) => a + x * (xs.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(b);
  return [...b, d1, dv([...b, d1])].join("");
}

type Decisao = { baseSha: string; migrationsDaBase: string[]; fatias: Record<FatiaDeCadastro, { migration: string; presente: boolean }> };

const RAIZ = path.resolve(__dirname, "../../..");

export function baseTemFatiaDeCadastro(fatia: FatiaDeCadastro, caso: string): boolean {
  const arq = path.join(RAIZ, ".skew-fichas-cadastro.json");
  if (!fs.existsSync(arq)) {
    throw new Error(`decisão das fichas de cadastro ausente (${arq}): rode scripts/skew-fichas-cadastro.mjs antes do skew. `
      + "Sem ela não há como saber qual ramo provar, e escolher o mais fácil seria certificar o que não se mediu.");
  }
  const d = JSON.parse(fs.readFileSync(arq, "utf8")) as Decisao;
  const f = d.fatias[fatia];
  expect(f, `o artefato traz a fatia ${fatia}`).toBeTruthy();
  const presente = d.migrationsDaBase.includes(f.migration);
  expect(presente, "o artefato tem de ser coerente com a própria decisão que carrega").toBe(f.presente);
  // A decisão tem de ser a DESTA árvore: um arquivo sobrado de outra base decidiria sobre o binário errado.
  expect(d.baseSha, "a decisão foi medida na base que está servindo").toBe(fs.readFileSync(path.join(RAIZ, ".api-anterior.base"), "utf8").trim());
  const conferencia = (Object.keys(d.fatias) as FatiaDeCadastro[]).filter((k) => d.migrationsDaBase.includes(d.fatias[k].migration)).sort().join(",");
  expect(process.env.SKEW_BASE_FICHAS_CADASTRO ?? conferencia,
    "SKEW_BASE_FICHAS_CADASTRO não bate com a decisão recalculada — alguém fixou a variável por fora").toBe(conferencia);
  console.log(`[skew] ${caso} · base ${d.baseSha} ${presente ? "TEM" : "NÃO tem"} ${f.migration} (mundo ${presente ? "ATUAL" : "LEGADO"})`);
  return presente;
}
