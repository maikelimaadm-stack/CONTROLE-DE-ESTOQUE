#!/usr/bin/env node
/**
 * BAIXA AS REFERÊNCIAS OFICIAIS E GERA OS ARQUIVOS DE DADOS VERSIONADOS (CADASTROS Fase 3).
 *
 *   node scripts/referencias/baixar.mjs                 baixa todas as fontes (curl: respeita HTTPS_PROXY)
 *   node scripts/referencias/baixar.mjs --fonte ncm     só uma fonte (estados|municipios|bancos|ncm|cbo)
 *   node scripts/referencias/baixar.mjs --bruto <dir>   usa arquivos brutos já baixados (<fonte>.json|csv)
 *
 * Saída: supabase/referencias/<fonte>.csv, com URL, data, quantidade e sha256 do arquivo BRUTO no
 * cabeçalho. O bruto não é versionado. Depois rode `node scripts/referencias/gerar-carga.mjs` para
 * embutir os dados na migration de carga. Fonte que não responder NÃO gera arquivo (nada inventado):
 * o arquivo anterior continua valendo.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FONTES, sha256, linhasDeEstados, linhasDeMunicipios, linhasDeBancos, linhasDeNcm, linhasDeCbo, escreverCsv, lerCsvDeReferencia } from "./lib.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIR_DADOS = path.join(RAIZ, "supabase", "referencias");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const so = arg("--fonte"); const bruto = arg("--bruto");
const EXT = { estados: "json", municipios: "json", bancos: "csv", ncm: "json", cbo: "csv" };

function obter(fonte) {
  if (bruto) return fs.readFileSync(path.join(bruto, `${fonte}.${EXT[fonte]}`));
  const tmp = path.join(os.tmpdir(), `ref-${fonte}-${process.pid}`);
  try {
    execFileSync("curl", ["-sSfL", "--max-time", "120", "-o", tmp, FONTES[fonte]], { stdio: ["ignore", "ignore", "inherit"] });
    return fs.readFileSync(tmp);
  } finally { fs.rmSync(tmp, { force: true }); }
}

const hoje = new Date().toISOString().slice(0, 10);
fs.mkdirSync(DIR_DADOS, { recursive: true });
const gravar = (fonte, raw, colunas, linhas, extra = {}) => {
  const meta = { fonte: FONTES[fonte], baixado_em: hoje, linhas: linhas.length, sha256_bruto: sha256(raw), ...extra };
  fs.writeFileSync(path.join(DIR_DADOS, `${fonte}.csv`), escreverCsv(meta, colunas, linhas));
  console.log(`${fonte}: ${linhas.length} linhas (sha256 bruto ${meta.sha256_bruto})`);
};
const falhas = [];
const tentar = (fonte, fn) => { if (so && so !== fonte) return; try { fn(); } catch (e) { falhas.push(fonte); console.error(`${fonte}: FONTE INDISPONIVEL OU INVALIDA — ${e.message}. Arquivo anterior mantido.`); } };

let estados = null;
tentar("estados", () => { const raw = obter("estados"); estados = linhasDeEstados(raw.toString("utf8")); gravar("estados", raw, ["sigla", "nome", "codigo_ibge"], estados); });
tentar("municipios", () => {
  if (!estados) { const f = path.join(DIR_DADOS, "estados.csv"); estados = lerCsvDeReferencia(fs.readFileSync(f, "utf8")).linhas.map(([s, n, c]) => [s, n, Number(c)]); }
  const raw = obter("municipios"); gravar("municipios", raw, ["codigo_ibge", "nome", "uf"], linhasDeMunicipios(raw.toString("utf8"), estados));
});
tentar("bancos", () => { const raw = obter("bancos"); gravar("bancos", raw, ["codigo", "ispb", "nome"], linhasDeBancos(raw.toString("utf8"))); });
tentar("ncm", () => { const raw = obter("ncm"); const { linhas, versao } = linhasDeNcm(raw.toString("utf8")); gravar("ncm", raw, ["codigo", "nivel", "descricao", "inicio", "fim"], linhas, { versao }); });
tentar("cbo", () => { const raw = obter("cbo"); gravar("cbo", raw, ["codigo", "titulo"], linhasDeCbo(raw), { codificacao_original: "ISO-8859-1 convertido para UTF-8" }); });
if (falhas.length) { console.error(`PENDING: ${falhas.join(", ")}`); process.exit(1); }
