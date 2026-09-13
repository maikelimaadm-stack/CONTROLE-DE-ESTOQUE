#!/usr/bin/env node
/**
 * GATE: `erp.member_farms` não é mais AUTORIDADE DE RUNTIME (PRE-BASE2-02, docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * A tabela continua existindo no banco — a remoção física é da PRE-BASE2-03 — mas nenhum código de execução
 * pode voltar a lê-la ou gravá-la para decidir acesso: a autoridade é `erp.membro_escopos_empresa` +
 * `erp.membro_empresas`, cruzadas com o módulo da permissão da rota. Este gate falha se qualquer arquivo de
 * runtime (código de apps e packages) mencionar a tabela fora de comentário.
 *
 * Migrations, testes, sementes e documentação continuam livres: é lá que a história da migração é contada.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const ALVOS = ["apps/api/src", "apps/web/src", "packages/domain/src", "packages/plataforma/src", "packages/db/src", "packages/shared/src", "packages/validation/src"];
const EXT = /\.(ts|tsx|mjs|js)$/;

function* arquivos(dir) {
  let entradas;
  try { entradas = readdirSync(dir); } catch { return; }
  for (const nome of entradas) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho);
    else if (EXT.test(nome)) yield caminho;
  }
}

/** Linha de comentário (// … ou dentro de bloco /** … *\/) não é uso: a migração precisa poder ser explicada. */
function ocorrenciasDeCodigo(texto) {
  const achados = [];
  let emBloco = false;
  texto.split("\n").forEach((linha, i) => {
    const semEspaco = linha.trim();
    const abriu = semEspaco.includes("/*");
    const fechou = semEspaco.includes("*/");
    const comentario = emBloco || semEspaco.startsWith("//") || semEspaco.startsWith("*") || (abriu && semEspaco.indexOf("/*") < semEspaco.indexOf("member_farms"));
    if (!comentario && linha.includes("member_farms")) achados.push({ linha: i + 1, texto: semEspaco.slice(0, 140) });
    if (abriu && !fechou) emBloco = true;
    if (fechou) emBloco = false;
  });
  return achados;
}

const problemas = [];
for (const alvo of ALVOS) {
  for (const caminho of arquivos(join(RAIZ, alvo))) {
    const texto = readFileSync(caminho, "utf8");
    if (!texto.includes("member_farms")) continue;
    for (const o of ocorrenciasDeCodigo(texto)) problemas.push(`${relative(RAIZ, caminho)}:${o.linha}: ${o.texto}`);
  }
}

if (problemas.length) {
  console.error("erp.member_farms voltou a ser usada em código de runtime (PRE-BASE2-02 §10):");
  for (const p of problemas) console.error("  " + p);
  console.error("\nUse o escopo canônico: erp.membro_escopos_empresa / erp.membro_empresas (apps/api/src/lib/context.ts).");
  process.exit(1);
}
console.log("member-farms-audit: nenhum uso de erp.member_farms em runtime.");
