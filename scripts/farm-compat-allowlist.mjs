#!/usr/bin/env node
/**
 * CATRACA DA COMPATIBILIDADE (PRE-BASE2-03).
 *
 * A migração fazenda → empresa deixou uma ponte: `farm_id`, `X-Farm-Id`, `erp.farms`, `/cadastros/farms`.
 * Ponte tem prazo. Sem um guarda, ela vira arquitetura: alguém copia uma linha de um arquivo antigo, o
 * nome legado reaparece numa rota nova e, no dia de remover a compatibilidade, ela não é mais removível.
 *
 * A regra é simples e dura: nome legado SÓ nos arquivos de compatibilidade declarados abaixo, cada um com
 * motivo. Em qualquer outro lugar do runtime, o gate falha dizendo arquivo, linha e símbolo.
 *
 * Migrations e documentação ficam de fora: lá o nome legado é HISTÓRIA (a 0003 criou `farm_id`; a 0014 o
 * renomeou), e reescrever história não é compatibilidade.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/schema.mjs";
import { PONTE_RUNTIME } from "./lib/empresa-compat-surface.mjs";

/**
 * Arquivo → por que ele pode falar o idioma antigo. A lista vive em `scripts/lib/empresa-compat-surface.mjs`
 * porque o inventário (`scripts/farm-inventory.mjs`) precisa da MESMA lista para separar compatibilidade
 * declarada de dívida de produto — duas cópias divergindo devolveriam a ponte à sombra.
 */
const PERMITIDOS = PONTE_RUNTIME;

/** Símbolos legados que não podem vazar do adaptador. */
const SIMBOLOS = [
  { re: /\bfarm_id\b/, nome: "farm_id" },
  { re: /\borigin_farm_id\b/, nome: "origin_farm_id" },
  { re: /\bdestination_farm_id\b/, nome: "destination_farm_id" },
  { re: /\bfarm_name\b/, nome: "farm_name" },
  { re: /\bfarm_ids\b/, nome: "farm_ids" },
  { re: /\bfarmId\b/, nome: "farmId" },
  { re: /X-Farm-Id|x-farm-id/i, nome: "X-Farm-Id" },
  { re: /erp\.farms\b/, nome: "erp.farms" },
  { re: /erp\.member_farms\b/, nome: "erp.member_farms" },
  { re: /\/cadastros\/farms/, nome: "/cadastros/farms" },
  { re: /(?<!erp)\.farms\b/, nome: ".farms (campo legado de resposta)" }
];

/** Identificadores que NÃO são o nome legado da empresa: chave de permissão e valor de domínio. */
const NAO_E_LEGADO = [
  /\bfarms\.(view|create|edit|delete|import_kml)\b/,        // chave de permissão (dado em erp.role_permissions)
  /\bfarm_transfers?\.(view|create|edit|delete)\b/,
  /\b(batch|animal)_farm_transfer\.(view|create|process)\b/,
  /\bfarm_transfer(_in|_out)?\b/,                            // valor de domínio (movement_type / stock_movement_type)
  /WAREHOUSE_FARM_MISMATCH/
];

const DIRS = ["apps/api/src", "apps/web/src", "packages/domain/src", "packages/plataforma/src", "packages/db/src"];
const EXTRA = ["apps/web/nav.registry.mjs", "apps/web/redirects.mjs"];

const arquivos = [];
const varrer = (dir) => {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) varrer(rel);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) arquivos.push(rel);
  }
};
DIRS.forEach(varrer);
for (const f of EXTRA) if (fs.existsSync(path.join(REPO_ROOT, f))) arquivos.push(f);

/**
 * Comentário não é dependência. Uma linha que EXPLICA "X-Farm-Id continua aceito durante a transição" é
 * documentação do próprio plano de migração — proibi-la empurraria a explicação para fora do código, que é
 * o lugar onde ela faz falta. O gate mede o que o programa FAZ.
 */
function semComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))  // bloco: preserva a numeração das linhas
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
}

const infratores = [];
for (const rel of arquivos) {
  if (PERMITIDOS[rel]) continue;
  const linhas = semComentarios(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")).split("\n");
  linhas.forEach((linha, i) => {
    let texto = linha;
    for (const excecao of NAO_E_LEGADO) texto = texto.replace(new RegExp(excecao.source, "g"), "");
    for (const s of SIMBOLOS) if (s.re.test(texto)) infratores.push(`${rel}:${i + 1}  ${s.nome}`);
  });
}

if (infratores.length) {
  console.error("farm-compat-allowlist: nome legado de empresa fora da camada de compatibilidade:");
  for (const x of infratores) console.error(`  - ${x}`);
  console.error("\nO runtime fala `empresa_id`, `empresa_origem_id`, `empresa_destino_id`, `ctx.empresaId` e");
  console.error("`X-Empresa-Id`. A tradução acontece na BORDA (apps/api/src/lib/compat-empresa.ts). Se este");
  console.error("arquivo precisa MESMO falar o idioma antigo, declare-o em PERMITIDOS com o motivo — a lista");
  console.error("é o que torna possível remover a ponte um dia.");
  process.exit(1);
}
console.log(`farm-compat-allowlist: OK (${arquivos.length} arquivos; ponte confinada a ${Object.keys(PERMITIDOS).length} arquivos declarados)`);
