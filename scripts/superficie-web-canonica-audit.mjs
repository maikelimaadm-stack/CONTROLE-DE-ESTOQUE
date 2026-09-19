#!/usr/bin/env node
/**
 * O REPOSITÓRIO NÃO PODE VOLTAR A DIZER DUAS COISAS SOBRE QUAL SUPERFÍCIE WEB É A DE PRODUÇÃO.
 *
 * POR QUE ESTE GATE EXISTE. Medido, não suposto: antes desta fatia o repositório afirmava as DUAS
 * coisas ao mesmo tempo, e uma delas duas vezes no MESMO arquivo — `docs/DEPLOYMENT.md` dizia
 * "Alternativa/backup na Railway" na seção de configuração e, 350 linhas abaixo, "o frontend servido
 * em produção continua sendo o da Railway; a Vercel é a segunda superfície". O `README.md` e o
 * `apps/web/Dockerfile` ficavam de um lado, a tabela de estado real do outro. Documentação
 * contraditória sobre topologia não envelhece com barulho: ela envelhece em silêncio, e quem chega
 * depois escolhe a metade que leu primeiro — inclusive na hora de um incidente.
 *
 * AS TRÊS METADES, porque nenhuma basta sozinha:
 *   1. EXISTE UM DONO. `docs/DEPLOYMENT.md` tem de conter a âncora com o contrato declarado. Sem
 *      dono, "alinhar os documentos" vira opinião sobre qual deles está certo.
 *   2. NINGUÉM MAIS DECIDE. Nos arquivos declarados abaixo — e no PRÓPRIO dono, fora da seção da
 *      âncora — nenhuma linha pode DECLARAR o papel vigente: nem atribuir posição a um provedor
 *      nomeado (canônica, principal, oficial, suportada, secundária, backup, alternativa…), nem
 *      declarar a CARDINALIDADE da topologia ("duas superfícies suportadas"). O papel de cada uma
 *      se lê no dono, e só nele; os demais apenas REFERENCIAM.
 *   3. O CONTRATO É MENSURÁVEL. As duas superfícies que provam o commit servido têm de existir:
 *      `GET /api/build` no web e o campo `build` no `/health` da API. Esta metade nasceu de uma
 *      verificação reversa que FALHOU: apagar a rota do web não reprovava nada — `tsc` não reclama
 *      de um route handler que ninguém importa, e o contrato voltaria a ser prosa em silêncio. Um
 *      contrato que obriga as duas superfícies a "provar o mesmo commit" sem que exista a porta da
 *      prova é exatamente o defeito que esta fatia veio fechar.
 *
 * O QUE ELE NÃO FAZ. Não decide QUAL é o contrato — isso é decisão humana, escrita na âncora. Não
 * proíbe a palavra "Vercel" nem "Railway" (elas são necessárias em quase todo documento de deploy).
 * Não bane MENÇÃO HISTÓRICA: uma linha que descreve o que já foi verdade continua legítima, desde
 * que marcada como história no próprio texto. E não é um parser: normaliza linha a linha e procura
 * rótulo de papel perto de nome de provedor, nada além disso.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** O arquivo DONO e a âncora que marca a declaração. */
export const DONO = "docs/DEPLOYMENT.md";
const ANCORA = "<!-- SUPERFICIE-WEB-CANONICA -->";
/** Contratos aceitos. Valor fora desta lista é REPROVAÇÃO, não "contrato novo". */
const CONTRATOS = ["duas-suportadas", "railway-canonica", "vercel-canonica"];

/**
 * ARQUIVOS AUDITADOS — lista FECHADA, cada um com o motivo de estar aqui.
 *
 * Acrescentar um arquivo é afirmar que ele fala da topologia web. Tirar um exige motivo escrito, pelo
 * mesmo princípio das outras declarações deste repositório: allowlist que ninguém revisa vira
 * carimbo.
 */
export const ARQUIVOS = {
  "docs/DEPLOYMENT.md": "o dono do contrato — e onde as duas afirmações contraditórias conviviam",
  "README.md": "a porta de entrada do repositório; dizia que o web é implantado na Vercel",
  "apps/web/Dockerfile": "descrevia a Railway como alternativa/backup à Vercel",
  ".env.example": "descrevia o CORS como a URL do frontend na Vercel",
  "docs/PRE-BASE2-05-APOSENTADORIA.md": "descreve a janela de skew em termos de web × API"
};

/**
 * O QUE CONTA COMO "DECLARAR O PAPEL VIGENTE" — e por que a primeira versão desta regra era frouxa.
 *
 * Ela proibia só três rótulos (`backup`, `alternativa`, `segunda superfície`) e deixava passar a forma
 * que os próprios arquivos passaram a usar: "duas superfícies web suportadas". O resultado era um SSOT
 * de fachada — mudar a âncora do dono para `railway-canonica` deixaria README, Dockerfile e
 * `.env.example` afirmando "duas suportadas", e o gate continuaria VERDE. SSOT não é ter uma âncora:
 * é o consumidor não poder continuar declarando em silêncio o valor anterior.
 *
 * Agora o gate proíbe a CLASSE do enunciado, em duas formas:
 *   PAPEL: um provedor NOMEADO junto de uma palavra que lhe atribui posição
 *          (canônica, principal, oficial, suportada, secundária, backup, alternativa…).
 *   CARDINALIDADE: quantas superfícies existem ("duas superfícies…", "ambas… suportadas"),
 *          que declara a topologia mesmo sem nomear provedor.
 */
const PAPEL = /\b(canonic[ao]|principal|oficial|suportad[ao]s?|secundari[ao]s?|backup|alternativa|segunda superficie|unica superficie)\b/;
const PROVEDOR = /\b(vercel|railway)\b/;
const CARDINALIDADE = /\b(duas|ambas|as duas)\b[^.;\n]{0,60}\bsuperficies?\b|\bsuperficies?\b[^.;\n]{0,40}\b(suportad|canonic|principal|oficial)/;

/**
 * MARCA DE HISTÓRIA. Uma linha que declara estar descrevendo o passado continua legítima — proibir
 * isso apagaria história verdadeira, que é o erro oposto e igualmente caro.
 */
const MARCA_HISTORICA = /\b(historic|ate \d|antes d|na epoca|foi |era |deixou de|ja foi|obsolet)/;

/**
 * AS PORTAS DA PROVA — arquivo e o que ele precisa conter para que a prova exista de verdade.
 * Cada entrada diz POR QUE ela é cobrada; apagar uma exige tirar a linha daqui, com o motivo.
 */
export const PROVAS = {
  "apps/web/src/app/api/build/route.ts": {
    exige: /identidadeDeBuild/,
    motivo: "é a única forma de saber, por HTTP anônimo, qual commit a superfície web está servindo"
  },
  "apps/api/src/routes/health.ts": {
    exige: /identidadeDeBuild/,
    motivo: "o `/health` da API responde no MESMO formato do web — formatos diferentes não se comparam"
  }
};

/** Normaliza para comparar sem depender de acento, caixa, marcador de lista ou prefixo de comentário. */
export function normalizar(linha) {
  return linha
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*(#+|\/\/|<!--|--|\*|-|\||>)+\s*/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lê o contrato declarado no dono. Devolve `{ contrato }` ou `{ erro }` — ausência é reprovação. */
export function contratoDeclarado(texto) {
  const partes = texto.split(ANCORA);
  if (partes.length === 1) return { erro: `a âncora \`${ANCORA}\` não existe em ${DONO} — sem dono, o contrato não tem onde morar` };
  if (partes.length > 2) return { erro: `a âncora \`${ANCORA}\` aparece ${partes.length - 1} vezes em ${DONO} — duas declarações são dois donos` };
  const m = /CONTRATO_SUPERFICIE_WEB:\s*([a-z-]+)/.exec(partes[1]);
  if (!m) return { erro: `a âncora existe mas não declara \`CONTRATO_SUPERFICIE_WEB\` logo abaixo` };
  if (!CONTRATOS.includes(m[1])) return { erro: `contrato \`${m[1]}\` não está na lista fechada (${CONTRATOS.join(", ")})` };
  return { contrato: m[1] };
}

/**
 * Classifica UMA linha já normalizada. Devolve o motivo da recusa, ou `null` quando ela é legítima.
 *
 * Referenciar o dono é sempre legítimo: "o papel está em docs/DEPLOYMENT.md § Superfície web" cita
 * provedor e superfície sem declarar nada — é o que os não-donos DEVEM fazer.
 */
export function declaracaoDePapel(n) {
  if (MARCA_HISTORICA.test(n)) return null; // fato histórico declarado como tal: legítimo
  if (PROVEDOR.test(n) && PAPEL.test(n)) return "atribui posição a um provedor";
  if (CARDINALIDADE.test(n)) return "declara quantas superfícies web existem";
  return null;
}

/**
 * A SEÇÃO DONA, delimitada mecanicamente: da âncora até o próximo cabeçalho `##`.
 *
 * O recorte existe para impedir o defeito por dentro: uma declaração correta na seção oficial e outra,
 * contraditória, 300 linhas abaixo no MESMO arquivo — que foi exatamente como este repositório estava.
 * Liberar o arquivo dono inteiro recriaria dois donos dentro de um dono. Não é parser de Markdown: é
 * fronteira por linha de cabeçalho, e isso basta para ser testável.
 */
export function faixaDoDono(linhas) {
  const inicio = linhas.findIndex((l) => l.includes(ANCORA));
  if (inicio < 0) return null;
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) if (/^##\s/.test(linhas[i])) { fim = i; break; }
  return { inicio, fim };
}

/**
 * Problemas de UM arquivo. Pura — é o que o autoteste exercita.
 * `ehDono` libera SOMENTE a faixa da âncora; fora dela o dono obedece à mesma regra dos outros.
 */
export function problemasDoArquivo(texto, ehDono = false) {
  const p = [];
  if (texto.length < 40) return [`${texto.length} bytes — leitura suspeita, não aprovo por ausência`];
  const linhas = texto.split(/\r?\n/);
  const faixa = ehDono ? faixaDoDono(linhas) : null;
  linhas.forEach((linha, i) => {
    if (faixa && i >= faixa.inicio && i < faixa.fim) return; // dentro da seção oficial: é o papel dela
    const motivo = declaracaoDePapel(normalizar(linha));
    if (!motivo) return;
    p.push(`linha ${i + 1}: ${motivo} — quem declara o papel vigente é ${DONO}, na seção da âncora; aqui só se REFERENCIA: ${linha.trim().slice(0, 120)}`);
  });
  return p;
}

/** Problemas de UMA porta da prova. `texto === null` significa arquivo ausente — que é REPROVAÇÃO. */
export function problemasDaProva(texto, exige) {
  if (texto === null) return ["o arquivo não existe — sem ele o contrato obriga a provar o commit por uma porta que não existe"];
  if (!exige.test(texto)) return ["existe, mas não resolve a identidade do build — a porta responde sem provar nada"];
  return [];
}

// ---------- autoteste: as duas direções, antes de auditar o repositório ----------
const BOA = "O web é publicado na Vercel e na Railway; o papel de cada superfície está em docs/DEPLOYMENT.md § Superfície web.\nAmbas implantam de main.";
const RUIM_BACKUP = "Web (Next.js) — imagem para Railway (alternativa/backup à Vercel).\nBuild a partir da raiz.";
const RUIM_SEGUNDA = "O frontend de produção é o da Railway; a Vercel é a segunda superfície do produto.\nOutra linha.";
const HISTORICA = "Até 15/09/2026 a Railway era a alternativa à Vercel; hoje as duas são suportadas.\nOutra linha.";
const SEM_PROVEDOR = "Este documento fala de backup de banco e de alternativa de índice, sem citar provedor de web.\nOutra linha.";

const ANCORA_BOA = `texto antes\n${ANCORA}\nCONTRATO_SUPERFICIE_WEB: duas-suportadas\ntexto depois`;
/** Só para passar do piso de não-vacuidade (40 bytes) sem influenciar o que se mede. */
const ENCHIMENTO = "Documento de exemplo do autoteste, com corpo suficiente para não cair no piso.";
const AMOSTRAS = [
  ["texto que REFERENCIA o dono passa", 0, () => problemasDoArquivo(BOA)],
  ["rótulo `alternativa/backup` junto de provedor REPROVA", 1, () => problemasDoArquivo(RUIM_BACKUP)],
  ["rótulo `segunda superfície` junto de provedor REPROVA", 1, () => problemasDoArquivo(RUIM_SEGUNDA)],
  ["menção HISTÓRICA declarada NÃO reprova — o gate não apaga história verdadeira", 0, () => problemasDoArquivo(HISTORICA)],
  ["as mesmas palavras SEM provedor de web não reprovam", 0, () => problemasDoArquivo(SEM_PROVEDOR)],
  ["arquivo vazio/truncado REPROVA — não se aprova por ausência", 1, () => problemasDoArquivo("curto")],
  ["o DONO pode falar do assunto na própria seção", 0, () => problemasDoArquivo(`${ANCORA}\nesta secao declara o papel de cada superficie web`, true)],
  ["âncora ausente REPROVA", 1, () => (contratoDeclarado("sem ancora").erro ? ["erro"] : [])],
  ["âncora DUPLICADA REPROVA — dois donos não é um dono", 1, () => (contratoDeclarado(`${ANCORA}\nCONTRATO_SUPERFICIE_WEB: duas-suportadas\n${ANCORA}`).erro ? ["erro"] : [])],
  ["contrato fora da lista fechada REPROVA", 1, () => (contratoDeclarado(`${ANCORA}\nCONTRATO_SUPERFICIE_WEB: talvez`).erro ? ["erro"] : [])],
  ["âncora com contrato válido PASSA", 0, () => (contratoDeclarado(ANCORA_BOA).erro ? ["erro"] : [])],
  ["porta da prova presente PASSA", 0, () => problemasDaProva("export async function GET() { return Response.json({ build: identidadeDeBuild(process.env) }); }", PROVAS["apps/web/src/app/api/build/route.ts"].exige)],
  ["porta da prova sem a identidade REPROVA", 1, () => problemasDaProva("export async function GET() { return Response.json({ ok: true }); }", PROVAS["apps/web/src/app/api/build/route.ts"].exige)],
  ["porta da prova APAGADA REPROVA — foi a reversa R1 que expôs esta metade", 1, () => problemasDaProva(null, PROVAS["apps/web/src/app/api/build/route.ts"].exige)],
  // ---- R1 do checkpoint: DECLARAR PAPEL FORA DO DONO, em qualquer forma ----
  // A primeira versão barrava só `backup`/`alternativa`/`segunda superfície` e deixava passar
  // "duas superfícies suportadas" — a forma que os próprios arquivos passaram a usar. Trocar a âncora
  // para `railway-canonica` teria deixado os consumidores obsoletos e o gate VERDE.
  ["T15 não-dono: 'duas superfícies web suportadas: Railway e Vercel' REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\nO web tem duas superfícies web suportadas: Railway e Vercel.`)],
  ["T16 não-dono: 'Railway é a superfície canônica' REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\nA Railway é a superfície canônica do frontend.`)],
  ["T17 não-dono: 'Vercel é o frontend principal' REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\nA Vercel é o frontend principal em produção.`)],
  ["T18 não-dono: 'Railway e Vercel são ambas suportadas' REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\nRailway e Vercel são ambas suportadas hoje.`)],
  ["T19 não-dono que apenas REFERENCIA o dono PASSA", 0,
    () => problemasDoArquivo(`${ENCHIMENTO}\nA imagem é construída para Railway; o papel operacional está em docs/DEPLOYMENT.md § Superfície web.`)],
  ["T20 DONO: declara papel DENTRO da seção da âncora PASSA", 0,
    () => problemasDoArquivo(`${ENCHIMENTO}\n## Superfície web\n${ANCORA}\nCONTRATO_SUPERFICIE_WEB: railway-canonica\nRailway = canônica · Vercel = secundária\n\n## Outra seção\ntexto neutro`, true)],
  ["T21 DONO: a MESMA declaração FORA da seção da âncora REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\n## Superfície web\n${ANCORA}\nCONTRATO_SUPERFICIE_WEB: railway-canonica\n\n## Estado real\nRailway = canônica · Vercel = secundária`, true)],
  // T22 é o caso que prova o blocker desta R1: o dono mudou e o consumidor ficou para trás.
  ["T22 REGRESSÃO: dono em railway-canonica + não-dono dizendo 'duas suportadas' REPROVA", 1,
    () => problemasDoArquivo(`${ENCHIMENTO}\nHoje são duas superfícies suportadas.`)]
];
for (const [nome, esperado, executa] of AMOSTRAS) {
  const n = executa().length;
  const ok = esperado === 0 ? n === 0 : n >= 1;
  if (!ok) {
    console.error(`superficie-web-canonica-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado === 0 ? "0" : "≥1"}, obteve ${n}.`);
    process.exit(1);
  }
}

// ---------- auditoria do repositório ----------
const erros = [];
const dono = path.join(RAIZ, DONO);
if (!fs.existsSync(dono)) erros.push(`${DONO}: o arquivo DONO do contrato não existe`);
let contrato = "?";
if (fs.existsSync(dono)) {
  const r = contratoDeclarado(fs.readFileSync(dono, "utf8"));
  if (r.erro) erros.push(`${DONO}: ${r.erro}`);
  else contrato = r.contrato;
}
for (const [rel, motivo] of Object.entries(ARQUIVOS)) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) { erros.push(`${rel}: declarado na auditoria e não existe (${motivo})`); continue; }
  for (const p of problemasDoArquivo(fs.readFileSync(abs, "utf8"), rel === DONO)) erros.push(`${rel} (${motivo}): ${p}`);
}

for (const [rel, { exige, motivo }] of Object.entries(PROVAS)) {
  const abs = path.join(RAIZ, rel);
  const texto = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  for (const p of problemasDaProva(texto, exige)) erros.push(`${rel} (${motivo}): ${p}`);
}

if (erros.length) {
  console.error("superficie-web-canonica-audit: o repositório voltou a decidir a topologia web fora do dono\n");
  for (const e of erros) console.error("  - " + e);
  console.error(`\nQuem declara o papel de cada superfície web é ${DONO}, na seção "Superfície web".`);
  console.error("Os outros arquivos REFERENCIAM essa seção; nenhum deles atribui papel.");
  console.error("Se a declaração deixou de valer, mude a ÂNCORA — e só ela —, com o motivo escrito.");
  process.exit(1);
}

console.log(`superficie-web-canonica-audit: OK (autoteste ${AMOSTRAS.length}/${AMOSTRAS.length}; contrato "${contrato}" declarado em ${DONO}; ${Object.keys(ARQUIVOS).length} arquivo(s) auditado(s), ${Object.keys(PROVAS).length} porta(s) de prova)`);
