#!/usr/bin/env node
/**
 * GATE DO ID GLOBAL (PRE-BASE2-04).
 *
 * Um contrato que depende de alguém lembrar não é um contrato. Este gate existe para o dia — daqui a seis
 * meses — em que alguém escrever `insert into erp.financial_titles(...)` numa rota nova e não souber que
 * aquela tabela tem identidade global. O `insert` funcionaria, o título nasceria sem número, e ninguém
 * descobriria até um usuário perguntar por que o #N dele não existe.
 *
 * São quatro provas ESTRUTURAIS (sem banco, no job de qualidade):
 *   1. CATÁLOGO íntegro — rota com `:id`, permissão no formato do produto, variantes com permissões
 *      distintas, tabela não técnica (a mesma validação que o runtime usa).
 *   2. DICIONÁRIO concorda — toda entidade elegível existe no dicionário de dados versionado.
 *   3. ESCRITA coberta — todo `insert into` numa tabela elegível, em qualquer lugar de `apps/api/src`, tem a
 *      alocação do ID Global logo em seguida (ou está declarado aqui, com motivo escrito).
 *   4. EXIBIÇÃO coberta — toda rota canônica do catálogo é reconhecida pelo detector da UI, que é o que faz
 *      o `#N` aparecer na tela sem editar 23 páginas.
 *
 * O que este gate NÃO prova é que a alocação REALMENTE roda: isso é a suíte de integração
 * `id-global-runtime.test.ts`, que cria pela porta real e confere o índice. Estrutura e comportamento são
 * duas perguntas, e grep sozinho nunca respondeu a segunda.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ENTIDADES_ID_GLOBAL, validarRegistroIdGlobal, variantesInternasDeclaradas } = await import(path.join(RAIZ, "packages/domain/dist/index.js"));
const { DICIONARIO_DE_DADOS } = await import(path.join(RAIZ, "packages/domain/dicionario-dados.mjs"));

const erros = [];
const aviso = (m) => erros.push(m);

/**
 * PORTAS DE ESCRITA DECLARADAS sem alocação adjacente. Cada linha é uma decisão registrada, não uma exceção
 * silenciosa: o gate obriga a escrever o MOTIVO, e um arquivo que some daqui volta a ser cobrado.
 */
const ESCRITAS_DECLARADAS = {
  // (vazio: hoje toda porta de escrita de entidade elegível aloca o ID Global na sequência)
};

// ---------- 1. catálogo ----------
for (const p of validarRegistroIdGlobal()) aviso(`catálogo: ${p}`);
const tipos = ENTIDADES_ID_GLOBAL.map((e) => e.tipoEntidade);
if (new Set(tipos).size !== tipos.length) aviso("catálogo: tipo de entidade repetido");

// ---------- 2. dicionário de dados ----------
// O dicionário versionado declara, por entidade, se ela tem ID Global. As duas fontes precisam dizer a
// MESMA coisa nos DOIS sentidos: catálogo sem dicionário é entidade não documentada; dicionário marcando
// `idGlobal: true` para tabela fora do catálogo é promessa que o runtime não cumpre.
const porTabela = new Map(DICIONARIO_DE_DADOS.map((d) => [d.tabela, d]));
const comIdGlobalNoDicionario = new Set(DICIONARIO_DE_DADOS.filter((d) => d.idGlobal).map((d) => d.tabela));
for (const e of ENTIDADES_ID_GLOBAL) {
  const d = porTabela.get(e.tabela);
  if (!d) { aviso(`dicionário: ${e.tipoEntidade} (${e.tabela}) é elegível a ID Global mas não está no dicionário de dados`); continue; }
  if (!d.idGlobal) aviso(`dicionário: ${e.tabela} está no catálogo de ID Global mas o dicionário diz idGlobal: false`);
}
const noCatalogo = new Set(ENTIDADES_ID_GLOBAL.map((e) => e.tabela));
for (const t of comIdGlobalNoDicionario) {
  if (!noCatalogo.has(t)) aviso(`dicionário: ${t} está marcada com idGlobal: true mas não existe no catálogo — o runtime nunca daria número a ela`);
}

// ---------- 3. escrita ----------
const fontes = [];
(function varrer(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) varrer(p);
    else if (f.name.endsWith(".ts")) fontes.push(p);
  }
})(path.join(RAIZ, "apps/api/src"));

const PORTAS_POR_TIPO = Object.fromEntries(tipos.map((t) => [t, []]));
let portas = 0;
for (const arquivo of fontes) {
  const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
  const rel = path.relative(RAIZ, arquivo);
  for (let i = 0; i < linhas.length; i++) {
    const m = /insert into erp\.(\w+)\s*\(/.exec(linhas[i]);
    if (!m) continue;
    const tabela = m[1];
    const entidade = ENTIDADES_ID_GLOBAL.find((e) => e.tabela === `erp.${tabela}`);
    if (!entidade) continue;
    portas++;
    PORTAS_POR_TIPO[entidade.tipoEntidade].push(`${rel}:${i + 1}`);
    // a alocação tem de estar PERTO do insert (mesma transação, antes dos efeitos), não em outro arquivo
    const janela = linhas.slice(i, i + 8).join("\n");
    const temAlocacao = /atribuirIdGlobal(SeAplicavel)?\(/.test(janela);
    const declarada = ESCRITAS_DECLARADAS[`${rel}:${i + 1}`];
    if (!temAlocacao && !declarada) {
      aviso(`escrita sem ID Global: ${rel}:${i + 1} grava em erp.${tabela} (entidade elegível "${entidade.tipoEntidade}") e não aloca o ID Global nas 8 linhas seguintes`);
    }
  }
}
// a porta GENÉRICA do Resource Registry cobre os cadastros que não têm rota própria
const generica = fs.readFileSync(path.join(RAIZ, "apps/api/src/routes/resources.ts"), "utf8");
const temGenerica = /atribuirIdGlobalSeAplicavel\(ctx, def\.table/.test(generica);
if (!temGenerica) aviso("escrita sem ID Global: a criação genérica de recursos (routes/resources.ts) não aloca o ID Global");
for (const [tipo, lista] of Object.entries(PORTAS_POR_TIPO)) {
  if (!lista.length && !temGenerica) aviso(`${tipo}: nenhuma porta de criação encontrada e a porta genérica não cobre`);
}

// ---------- 4. exibição ----------
// O detector vive no DOMÍNIO (deriva do catálogo); a UI só o reexporta. Aqui se prova que ele continua
// derivando de `ENTIDADES_ID_GLOBAL`, e não de uma segunda lista de rotas escrita à mão — que envelheceria
// em silêncio na primeira entidade nova.
const detector = fs.readFileSync(path.join(RAIZ, "packages/domain/src/id-global-rota.ts"), "utf8");
if (!/ENTIDADES_ID_GLOBAL/.test(detector)) {
  aviso("exibição: o detector de rota não deriva do catálogo — uma segunda lista de rotas envelheceria em silêncio");
}
const reexport = fs.readFileSync(path.join(RAIZ, "apps/web/src/lib/id-global-rota.ts"), "utf8");
if (!/entidadeDaRota/.test(reexport)) aviso("exibição: a UI não expõe o detector de rota");
// e que TODA rota canônica do catálogo é reconhecida por ele (cobertura visual de 100% do registry)
const { entidadeDaRota } = await import(path.join(RAIZ, "packages/domain/dist/index.js"));
const UUID_TESTE = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
for (const e of ENTIDADES_ID_GLOBAL) {
  const rotas = e.resolucao.tipo === "fixa" ? [e.resolucao.rota] : Object.values(e.resolucao.variantes).map((v) => v.rota);
  for (const rota of rotas) {
    const achado = entidadeDaRota(rota.replace(":id", UUID_TESTE).split("?")[0]);
    if (!achado || achado.tipo !== e.tipoEntidade) aviso(`exibição: a rota ${rota} de ${e.tipoEntidade} não é reconhecida — aquela tela nunca mostraria o #N`);
  }
}
const shell = fs.readFileSync(path.join(RAIZ, "apps/web/src/components/layout/shell.tsx"), "utf8");
if (!/IdGlobalDaRotaAtual/.test(shell)) aviso("exibição: a shell não monta a identidade do registro (#N)");

// ---------- 4b. CACHE do cliente carrega a ORGANIZAÇÃO ----------
// `#55` existe em quase toda organização e aponta para coisas diferentes em cada uma. Uma chave
// `["id-global", 55]` deixaria o resultado da organização anterior navegável depois da troca. Cada
// `queryKey` do ID Global precisa ter a organização entre a etiqueta e o identificador.
const hooks = fs.readFileSync(path.join(RAIZ, "apps/web/src/lib/id-global.ts"), "utf8");
const chaves = [...hooks.matchAll(/queryKey:\s*\[([^\]]*)\]/g)].map((m) => m[1]);
if (!chaves.length) aviso("cache: nenhuma queryKey encontrada no cliente de ID Global");
for (const k of chaves) {
  if (!/\borg\(\)/.test(k)) aviso(`cache: queryKey [${k.trim()}] não inclui a organização — resultado de outro tenant continuaria navegável depois da troca`);
}

// ---------- 5. variantes internas ----------
for (const e of ENTIDADES_ID_GLOBAL) {
  const internas = variantesInternasDeclaradas(e.tipoEntidade);
  if (!internas.length) continue;
  if (e.resolucao.tipo !== "variante") { aviso(`${e.tipoEntidade}: declara variantes internas mas não tem coluna discriminadora`); continue; }
  const declaradas = new Set(Object.keys(e.resolucao.variantes));
  for (const i of internas) if (declaradas.has(i)) aviso(`${e.tipoEntidade}: "${i}" está ao mesmo tempo como variante navegável e como interna`);
}

if (erros.length) {
  console.error("id-global-audit: FALHOU");
  for (const e of erros) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`id-global-audit: OK (${ENTIDADES_ID_GLOBAL.length} entidades, ${portas} porta(s) de escrita direta + porta genérica, exibição central derivada do catálogo)`);
