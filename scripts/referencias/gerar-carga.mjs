#!/usr/bin/env node
/**
 * EMBUTE OS ARQUIVOS DE REFERÊNCIA NA MIGRATION DE CARGA (CADASTROS Fase 3).
 *
 *   node scripts/referencias/gerar-carga.mjs            reescreve a seção entre os marcadores da 0026
 *   node scripts/referencias/gerar-carga.mjs --check    falha se a seção não for exatamente o conteúdo dos CSVs
 *
 * O runner de migrations executa um arquivo SQL por vez, sem `\copy` nem include; por isso os dados
 * entram na própria migration, como tabelas temporárias. A fonte de verdade continua sendo o CSV
 * versionado (supabase/referencias/), com a procedência no cabeçalho.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerCsvDeReferencia, sqlTexto } from "./lib.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(RAIZ, "supabase", "referencias");
export const MIGRATION = path.join(RAIZ, "supabase", "migrations", "0026_referencias_oficiais.sql");
const INICIO = "-- >>> CARGA GERADA"; const FIM = "-- <<< CARGA GERADA";

const int = (v) => { if (!/^\d+$/.test(v)) throw new Error(`inteiro invalido: ${v}`); return v; };
const data = (v) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`data invalida: ${v}`); return `'${v}'`; };
const txt = sqlTexto;

const CARGAS = [
  { arquivo: "estados", tabela: "_ref_estados", ddl: "sigla text not null, nome text not null, codigo_ibge int not null", valor: ([s, n, c]) => `(${txt(s)},${txt(n)},${int(c)})` },
  { arquivo: "municipios", tabela: "_ref_municipios", ddl: "codigo_ibge int primary key, nome text not null, uf text not null", valor: ([c, n, u]) => `(${int(c)},${txt(n)},${txt(u)})` },
  { arquivo: "bancos", tabela: "_ref_bancos", ddl: "codigo text primary key, ispb text not null, nome text not null", valor: ([c, i, n]) => `(${txt(c)},${txt(i)},${txt(n)})` },
  { arquivo: "ncm", tabela: "_ref_ncm", ddl: "codigo text primary key, nivel smallint not null, descricao text not null, inicio date not null, fim date not null", valor: ([c, nv, d, i, f]) => `(${txt(c)},${int(nv)},${txt(d)},${data(i)},${data(f)})` },
  { arquivo: "cbo", tabela: "_ref_cbo", ddl: "codigo text primary key, titulo text not null", valor: ([c, t]) => `(${txt(c)},${txt(t)})` }
];

export function gerarSecao() {
  const partes = [INICIO];
  for (const c of CARGAS) {
    const { meta, linhas } = lerCsvDeReferencia(fs.readFileSync(path.join(DIR, `${c.arquivo}.csv`), "utf8"));
    if (Number(meta.linhas) !== linhas.length) throw new Error(`${c.arquivo}.csv: cabecalho diz ${meta.linhas} linhas, arquivo tem ${linhas.length}`);
    partes.push(`-- ${c.arquivo}: ${meta.fonte} · baixado em ${meta.baixado_em} · ${linhas.length} linhas · sha256 do bruto ${meta.sha256_bruto}${meta.versao ? ` · ${meta.versao}` : ""}`);
    partes.push(`create temp table ${c.tabela} (${c.ddl}) on commit drop;`);
    partes.push(`insert into ${c.tabela} values\n${linhas.map(c.valor).join(",\n")};`);
  }
  partes.push(FIM);
  return partes.join("\n");
}

const atual = fs.readFileSync(MIGRATION, "utf8");
const i = atual.indexOf(INICIO); const f = atual.indexOf(FIM);
if (i < 0 || f < i) { console.error("gerar-carga: marcadores da carga nao encontrados na 0026"); process.exit(1); }
const novo = atual.slice(0, i) + gerarSecao() + atual.slice(f + FIM.length);
if (process.argv.includes("--check")) {
  if (novo !== atual) { console.error("gerar-carga: a carga embutida na 0026 difere de supabase/referencias/*.csv — rode `node scripts/referencias/gerar-carga.mjs`."); process.exit(1); }
  console.log("gerar-carga: OK (0026 = supabase/referencias/*.csv)");
} else {
  fs.writeFileSync(MIGRATION, novo);
  console.log(`gerar-carga: 0026 atualizada (${(novo.length / 1024).toFixed(0)} KiB)`);
}
