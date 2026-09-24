/**
 * TRANSFORMAÇÕES PURAS DAS REFERÊNCIAS OFICIAIS (CADASTROS Fase 3).
 *
 * O download (`baixar.mjs`) e a geração da carga da migration (`gerar-carga.mjs`) são bordas; a regra de
 * cada fonte mora AQUI, sem rede e sem disco, e é testada por
 * `apps/api/test/unit/referencias-carga.test.ts` com fixtures. Em runtime a API NUNCA chama essas fontes:
 * elas entram no banco pela migration.
 */
import { createHash } from "node:crypto";

export const FONTES = {
  estados: "https://servicodados.ibge.gov.br/api/v1/localidades/estados",
  municipios: "https://servicodados.ibge.gov.br/api/v1/localidades/municipios",
  bancos: "https://www.bcb.gov.br/content/estabilidadefinanceira/str1/ParticipantesSTR.csv",
  ncm: "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json",
  cbo: "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/cbo/servicos/downloads/cbo2002-ocupacao.csv"
};

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** UFs do IBGE: [sigla, nome, código IBGE]. */
export function linhasDeEstados(json) {
  const lista = JSON.parse(json);
  return lista.map((e) => [String(e.sigla), String(e.nome), Number(e.id)]).sort((a, b) => a[2] - b[2]);
}

/**
 * Municípios do IBGE: [código IBGE, nome, UF].
 *
 * A UF sai dos DOIS PRIMEIROS DÍGITOS do código IBGE, cruzados com a tabela de UFs — nunca de
 * `microrregiao.mesorregiao.UF`, que o IBGE devolve NULO para município recém-criado (na carga de
 * 2026-09-24, Boa Esperança do Norte - MT). Código sem UF correspondente PARA a geração (não inventa UF).
 */
export function linhasDeMunicipios(json, estados) {
  const porCodigo = new Map(estados.map(([sigla, , codigo]) => [String(codigo), sigla]));
  const lista = JSON.parse(json);
  return lista.map((m) => {
    const id = Number(m.id);
    const uf = porCodigo.get(String(id).slice(0, 2));
    if (!uf) throw new Error(`municipio ${id} (${m.nome}): prefixo IBGE sem UF`);
    return [id, String(m.nome), uf];
  }).sort((a, b) => a[0] - b[0]);
}

/** Parser CSV mínimo (aspas duplas, separador configurável). */
export function lerCsv(texto, sep = ",") {
  const linhas = []; let campo = ""; let linha = []; let aspas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; continue; }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; linha.push(campo); campo = ""; if (linha.some((x) => x !== "")) linhas.push(linha); linha = []; }
    else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); if (linha.some((x) => x !== "")) linhas.push(linha); }
  return linhas;
}

/**
 * Participantes do STR (BCB): [código COMPE (3 dígitos), ISPB (8 dígitos), nome extenso]. Participante sem
 * código COMPE ("n/a") ou com código fora do formato fica de fora: sem número não há banco para escolher.
 */
export function linhasDeBancos(texto) {
  const [cab, ...resto] = lerCsv(texto);
  const iIspb = cab.indexOf("ISPB"), iCod = cab.findIndex((c) => c.startsWith("N") && c.includes("digo")), iNome = cab.indexOf("Nome_Extenso");
  if (iIspb < 0 || iCod < 0 || iNome < 0) throw new Error("STR: cabecalho inesperado");
  const vistos = new Map();
  for (const l of resto) {
    const cod = (l[iCod] ?? "").trim(); const ispb = (l[iIspb] ?? "").trim(); const nome = (l[iNome] ?? "").trim();
    if (!/^\d{3}$/.test(cod) || !/^\d{8}$/.test(ispb) || !nome) continue;
    if (!vistos.has(cod)) vistos.set(cod, [cod, ispb, nome]);
  }
  return [...vistos.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const limparTexto = (s) => String(s)
  .replace(/<[^>]*>/g, "")
  .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENTIDADES[e.toLowerCase()] ?? m))
  .replace(/\s+/g, " ").trim();

const dataIso = (br) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? "").trim()); if (!m) throw new Error(`data invalida: ${br}`); return `${m[3]}-${m[2]}-${m[1]}`; };

/**
 * NCM (Siscomex): [código só dígitos, nível (quantidade de dígitos: 2,4,5,6,7,8), descrição, início, fim].
 * A descrição COMPLETA (juntando os níveis de cima) é montada na migration a partir destas linhas.
 */
export function linhasDeNcm(json) {
  const doc = JSON.parse(json);
  const lista = doc.Nomenclaturas ?? [];
  const out = lista.map((n) => {
    const codigo = String(n.Codigo).replace(/\D/g, "");
    if (![2, 4, 5, 6, 7, 8].includes(codigo.length)) throw new Error(`NCM com nivel inesperado: ${n.Codigo}`);
    return [codigo, codigo.length, limparTexto(n.Descricao), dataIso(n.Data_Inicio), dataIso(n.Data_Fim)];
  });
  return { linhas: out.sort((a, b) => a[0].localeCompare(b[0])), versao: [doc.Data_Ultima_Atualizacao_NCM, doc.Ato].filter(Boolean).join(" · ") };
}

/** CBO (MTE): arquivo oficial em ISO-8859-1 → [código 6 dígitos, título] em UTF-8. */
export function linhasDeCbo(buffer) {
  const texto = new TextDecoder("latin1").decode(buffer);
  const [cab, ...resto] = lerCsv(texto, ";");
  if (!/codigo/i.test(cab[0] ?? "") || !/titulo/i.test(cab[1] ?? "")) throw new Error("CBO: cabecalho inesperado");
  return resto.map((l) => [String(l[0]).trim(), limparTexto(l[1])]).filter(([c]) => /^\d{6}$/.test(c)).sort((a, b) => a[0].localeCompare(b[0]));
}

/** CSV de saída (vírgula, aspas quando precisa) com cabeçalho de procedência em linhas `#`. */
export function escreverCsv(meta, colunas, linhas) {
  const q = (v) => { const s = String(v); return /[",\n#]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cab = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  return [...cab, colunas.join(","), ...linhas.map((l) => l.map(q).join(","))].join("\n") + "\n";
}

export function lerCsvDeReferencia(texto) {
  const meta = {}; const corpo = [];
  for (const l of texto.split("\n")) { const m = /^# ([a-z0-9_]+): (.*)$/.exec(l); if (m) meta[m[1]] = m[2]; else corpo.push(l); }
  const [cab, ...linhas] = lerCsv(corpo.join("\n"));
  return { meta, colunas: cab, linhas };
}

/** Literal SQL seguro (texto entre aspas simples com escape; número validado). */
export const sqlTexto = (s) => `'${String(s).replace(/'/g, "''")}'`;
