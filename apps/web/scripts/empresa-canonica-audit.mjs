#!/usr/bin/env node
/**
 * CATRACA DO CLIENTE CANÔNICO (PRE-BASE2-05A).
 *
 * A PRE-BASE2-05A virou o web para o contrato canônico de Empresa: `X-Empresa-Id` no cabeçalho,
 * `empresa_id` no corpo e na query, recurso `empresas`, `empresaId` na sessão. O tradutor de fio
 * (`apps/web/src/lib/compat-empresa.ts`) foi apagado, e é isso que torna esta catraca necessária: sem o
 * adaptador, um `farm_id` que volte a aparecer no cliente NÃO quebra em teste — ele simplesmente viaja, e a
 * API bilíngue aceita. O erro some no sucesso, que é o pior lugar para um erro estar.
 *
 * O que esta catraca vigia é o CONTRATO do cliente com a API, e só ele:
 *
 *   · cabeçalho legado de empresa;
 *   · nome legado do campo de empresa em corpo, query, ordenação ou campo;
 *   · chave legada de sessão/estado;
 *   · chave legada do recurso de empresa.
 *
 * O que ela NÃO vigia, de propósito:
 *
 *   · vocabulário agronômico legítimo — "fazenda" como conceito de campo não é dívida de plataforma, e
 *     apagá-lo seria empobrecer o produto (docs/DOMAIN-NAMING-STANDARD.md);
 *   · nomes de PERMISSÃO e de enum do domínio (`farm_transfers.view`, `movement_type: "farm_transfer"`):
 *     são contrato do SERVIDOR. Renomeá-los é PRE-BASE2-05B/05C, e fazê-lo aqui quebraria a autorização.
 *
 * A allowlist é mínima por definição: um arquivo só, o efeito da promoção de sessão, com remoção marcada.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "src");

/**
 * ÚNICA exceção, e ela é o efeito — não a regra. `api.ts` cita o nome antigo em comentário para explicar por
 * que a sessão gravada por uma versão anterior é promovida; a REGRA vive em `@erp/plataforma`, declarada na
 * ponte (`scripts/lib/empresa-compat-surface.mjs`). Some em PRE-BASE2-05B.
 */
const PERMITIDOS = new Set(["src/lib/api.ts"]);

/** Cada padrão é uma forma de o contrato legado voltar ao cliente. O nome explica o que falhou. */
const PROIBIDOS = [
  { nome: "cabeçalho legado de empresa", re: /["'`]?[Xx]-[Ff]arm-[Ii]d["'`]?/ },
  { nome: "campo legado de empresa no contrato", re: /\b(farm_id|origin_farm_id|destination_farm_id|farm_ids)\b/ },
  { nome: "chave legada de sessão/estado", re: /\bfarmIds?\b/ },
  { nome: "chave legada do recurso de empresa", re: /resource:\s*["'`]farms["'`]|["'`]\/api\/resources\/farms/ }
];

const arquivos = [];
(function varrer(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) varrer(p);
    else if (/\.(ts|tsx)$/.test(p)) arquivos.push(p);
  }
})(SRC);

const achados = [];
for (const p of arquivos) {
  const rel = relative(RAIZ, p).replace(/\\/g, "/");
  if (PERMITIDOS.has(rel)) continue;
  const linhas = readFileSync(p, "utf8").split("\n");
  linhas.forEach((linha, i) => {
    for (const { nome, re } of PROIBIDOS) {
      if (re.test(linha)) achados.push(`${rel}:${i + 1}  ${nome}\n    ${linha.trim().slice(0, 160)}`);
    }
  });
}

if (achados.length) {
  console.error("empresa-canonica-audit: o cliente voltou a falar o contrato legado de empresa.\n");
  for (const a of achados) console.error(`  ${a}\n`);
  console.error("O web é CANÔNICO desde PRE-BASE2-05A: X-Empresa-Id, empresa_id, recurso `empresas`, empresaId na sessão.");
  console.error("A API continua aceitando o idioma antigo até PRE-BASE2-05B — por isso isto NÃO falharia em runtime, e por isso existe esta catraca.");
  process.exit(1);
}
console.log(`empresa-canonica-audit: OK (${arquivos.length} arquivos; ${PERMITIDOS.size} exceção declarada)`);
