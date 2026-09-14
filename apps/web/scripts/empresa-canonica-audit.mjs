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
 * A allowlist é VAZIA: nenhum arquivo do web produtivo escapa da varredura, `api.ts` inclusive. E a própria
 * catraca se autotesta a cada execução (ver `autoTeste`), injetando cada padrão proibido em `api.ts` na
 * leitura e exigindo que a auditoria acuse.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "src");

/**
 * ZERO exceções. `api.ts` — o arquivo mais crítico do contrato HTTP do cliente — é auditado INTEGRALMENTE.
 *
 * Ele já não precisa citar o símbolo antigo nem em comentário: a regra da sessão anterior mora em
 * `@erp/plataforma` (`lerSessaoArmazenada`), e o texto do comentário fala do "cabeçalho anterior" sem
 * escrevê-lo. Excluir o arquivo inteiro para poupar uma palavra de comentário desarmaria a catraca
 * exatamente onde ela mais importa.
 */
const PERMITIDOS = new Set([]);

/** Cada padrão é uma forma de o contrato legado voltar ao cliente. O nome explica o que falhou. */
const PROIBIDOS = [
  { nome: "cabeçalho legado de empresa", re: /["'`]?[Xx]-[Ff]arm-[Ii]d["'`]?/ },
  { nome: "campo legado de empresa no contrato", re: /\b(farm_id|origin_farm_id|destination_farm_id|farm_ids)\b/ },
  { nome: "chave legada de sessão/estado", re: /\bfarmIds?\b/ },
  { nome: "chave legada do recurso de empresa", re: /resource:\s*["'`]farms["'`]|["'`]\/api\/resources\/farms/ }
];

const listarArquivos = (dir, acc = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listarArquivos(p, acc);
    else if (/\.(ts|tsx)$/.test(p)) acc.push(p);
  }
  return acc;
};

/** A varredura, parametrizada na LEITURA — é isso que permite o autoteste sem tocar no repositório. */
function auditar(arquivos, ler) {
  const achados = [];
  for (const p of arquivos) {
    const rel = relative(RAIZ, p).replace(/\\/g, "/");
    if (PERMITIDOS.has(rel)) continue;
    ler(p).split("\n").forEach((linha, i) => {
      for (const { nome, re } of PROIBIDOS) {
        if (re.test(linha)) achados.push({ rel, linha: i + 1, nome, texto: linha.trim().slice(0, 160) });
      }
    });
  }
  return achados;
}

const lerDoDisco = (p) => readFileSync(p, "utf8");
const arquivos = listarArquivos(SRC);
const ALVO = join(SRC, "lib", "api.ts");

/**
 * AUTOTESTE: uma catraca que nunca foi vista falhando não é catraca, é decoração. Aqui cada padrão
 * proibido é injetado em `api.ts` — só na LEITURA, o disco não é tocado — e a auditoria TEM de acusar.
 * Sem isto, um erro de regex ou uma allowlist larga passariam despercebidos justamente no arquivo do fio.
 */
function autoTeste() {
  const base = lerDoDisco(ALVO);
  const casos = [
    ['headers["X-Farm-Id"] = s.empresaId;', "cabeçalho legado de empresa"],
    ["const body = { farm_id: empresaId };", "campo legado de empresa no contrato"],
    ["const farmId = s.empresaId;", "chave legada de sessão/estado"],
    ['api("/api/resources/farms");', "chave legada do recurso de empresa"]
  ];
  const falhas = [];
  for (const [injecao, esperado] of casos) {
    const achados = auditar([ALVO], (p) => (p === ALVO ? `${base}\n${injecao}\n` : lerDoDisco(p)));
    const pegou = achados.some((a) => a.rel === "src/lib/api.ts" && a.nome === esperado);
    falhas.push(...(pegou ? [] : [`  NÃO detectou em api.ts: ${injecao}  (esperado: ${esperado})`]));
  }
  // E o contrário: sem injeção, o arquivo real tem de passar — senão o autoteste acusaria sempre.
  if (auditar([ALVO], lerDoDisco).length) falhas.push("  api.ts real acusou achado — a catraca está com falso positivo");
  if (falhas.length) {
    console.error("empresa-canonica-audit: AUTOTESTE FALHOU — a catraca não detecta o que promete.\n");
    for (const f of falhas) console.error(f);
    process.exit(1);
  }
  console.log(`empresa-canonica-audit: autoteste OK (${casos.length} injeções em src/lib/api.ts, todas detectadas)`);
}

const achados = auditar(arquivos, lerDoDisco);
if (achados.length) {
  console.error("empresa-canonica-audit: o cliente voltou a falar o contrato legado de empresa.\n");
  for (const a of achados) console.error(`  ${a.rel}:${a.linha}  ${a.nome}\n    ${a.texto}\n`);
  console.error("O web é CANÔNICO desde PRE-BASE2-05A: X-Empresa-Id, empresa_id, recurso `empresas`, empresaId na sessão.");
  console.error("A API continua aceitando o idioma antigo até PRE-BASE2-05B — por isso isto NÃO falharia em runtime, e por isso existe esta catraca.");
  process.exit(1);
}
// O autoteste roda DEPOIS da varredura real: se o repositório já tem achado, quem o usuário precisa ver é
// o achado, não o diagnóstico da catraca.
autoTeste();
console.log(`empresa-canonica-audit: OK (${arquivos.length} arquivos; ${PERMITIDOS.size} exceções)`);
