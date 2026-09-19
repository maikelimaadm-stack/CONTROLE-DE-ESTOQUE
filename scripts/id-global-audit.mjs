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
 *      o número aparecer na tela sem editar 23 páginas.
 *   5. APRESENTAÇÃO vigente — número puro e coluna solta (PRE-BASE2-05B.2): o formatador é executado de
 *      verdade, e nenhuma tela remonta o prefixo ou repina a identidade por fora dele.
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
const { formatarIdGlobal } = await import(path.join(RAIZ, "packages/plataforma/dist/id-global.js"));

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

// ---------- 4c. LISTAGEM: toda entidade elegível mostra o #N na lista ----------
// O #N só é um localizador se houver onde LER o número antes de digitá-lo. Enquanto ele existia apenas na
// tela de detalhe, servia a quem já o conhecesse — o contrário de um localizador. Aqui se prova que cada
// entidade do catálogo tem uma listagem que anexa o número, e que os dois caminhos GENÉRICOS (Resource
// Registry e documentos de estoque) continuam derivando o tipo da TABELA, e não de um `switch` à mão.
const stockSrc = fs.readFileSync(path.join(RAIZ, "apps/api/src/routes/stock.ts"), "utf8");
if (!/tipoEntidadeDaTabela\(table\)/.test(stockSrc)) aviso("listagem: o helper de documentos de estoque não deriva o tipo da tabela — cada documento novo nasceria sem ID Global na lista");
if (!/tipoEntidadeDaTabela\(def\.table\)/.test(generica)) aviso("listagem: a listagem genérica de recursos não deriva o tipo da tabela do recurso");

const { RESOURCES } = await import(path.join(RAIZ, "packages/domain/dist/index.js"));
const listadas = new Set();
const declaradasPorEngano = new Set();
for (const arquivo of fontes) {
  for (const linha of fs.readFileSync(arquivo, "utf8").split("\n")) {
    // chamada explícita (rotas especializadas)
    for (const m of linha.matchAll(/paginaComIdGlobal\(ctx,\s*"([a-z_]+)"/g)) { listadas.add(m[1]); declaradasPorEngano.add(m[1]); }
    // tipo passado como último argumento dos paginadores locais de pecuária e frota
    for (const m of linha.matchAll(/\b(?:paged|list)\(ctx,[^\n]*,\s*"([a-z_]+)"\s*\)/g)) listadas.add(m[1]);
    // documentos de estoque: o tipo É a tabela que o helper recebe
    for (const m of linha.matchAll(/listDocs\(ctx,\s*"([a-z_]+)"/g)) listadas.add(m[1]);
  }
}
// a listagem genérica cobre os cadastros do Resource Registry cuja tabela está no catálogo
for (const def of RESOURCES) { const e = ENTIDADES_ID_GLOBAL.find((x) => x.tabela.replace(/^erp\./, "") === String(def.table).replace(/^erp\./, "")); if (e) listadas.add(e.tipoEntidade); }

for (const e of ENTIDADES_ID_GLOBAL) {
  if (!listadas.has(e.tipoEntidade)) aviso(`listagem sem ID Global: ${e.tipoEntidade} está no catálogo mas nenhuma listagem anexa o número — o usuário nunca veria o #N desses registros`);
}
for (const t of declaradasPorEngano) {
  if (!tipos.includes(t)) aviso(`listagem: "${t}" é enriquecido como entidade de ID Global mas não existe no catálogo — o runtime recusaria a listagem inteira`);
}

// ---------- 4d. SUPERFÍCIES DO CLIENTE QUE NÃO PASSAM PELO MODELO BASE1 ----------
//
// O Base1List recebe a coluna de identidade de graça: ela é montada uma vez, a partir da declaração que o
// servidor manda na resposta. Algumas telas, porém, montam a grade por conta própria com `DataTable` — e
// nelas a coluna só existe porque alguém a escreveu. Apagá-la de uma delas não acende nenhuma luz: catálogo,
// enriquecimento da API, matriz das 23 entidades e o teste de N+1 continuam verdes, e o número simplesmente
// some da tela.
//
// ESTA LISTA NÃO É UM SEGUNDO CATÁLOGO. O catálogo de entidades continua sendo um só
// (`ENTIDADES_ID_GLOBAL`, no domínio) e o runtime do cliente não conhece nenhuma lista de entidades: ele
// obedece à declaração do servidor. O que está aqui embaixo são ARQUIVOS DE INTERFACE e o motivo escrito de
// cada um não exibir o número — a mesma mecânica de `ESCRITAS_DECLARADAS` acima. Uma tela nova com `DataTable`
// que liste uma entidade elegível não estará aqui, não usará a coluna, e o gate cobra.
const LISTAGENS_CUSTOM_SEM_ID_GLOBAL = {
  "apps/web/src/app/(app)/relatorios/[key]/page.tsx": "relatório parametrizado: linhas agregadas, não registros de uma entidade",
  "apps/web/src/features/admin/audit.tsx": "eventos de auditoria (audit_logs) — infraestrutura, fora do catálogo por contrato",
  "apps/web/src/features/admin/users.tsx": "membros da organização: entidade sem ID Global",
  // A TOP configurada JÁ NASCE com um localizador humano escolhido pelo próprio usuário — o `codigo`
  // ("2103"), que é a razão de ser do cadastro. Dar-lhe também um ID Global poria DOIS números humanos na
  // mesma linha, e o usuário teria de aprender qual dos dois usar para falar do mesmo registro. É
  // configuração da organização, não lançamento navegável por número.
  "apps/web/src/features/admin/tipos-operacao.tsx": "tipo de operação configurado: o `codigo` do próprio cadastro já é o localizador humano; um segundo número competiria com ele",
  "apps/web/src/features/fleet/depreciations.tsx": "cálculo de depreciação por equipamento, não uma entidade própria",
  "apps/web/src/features/hr/advances.tsx": "adiantamentos salariais: entidade fora do catálogo",
  "apps/web/src/features/livestock/matings.tsx": "coberturas: entidade fora do catálogo",
  "apps/web/src/features/stock/balances.tsx": "saldo por produto/armazém: agregação, não registro",
  "apps/web/src/features/stock/corrections.tsx": "ajustes de inventário: entidade fora do catálogo",
  "apps/web/src/features/stock/dfe-approvals.tsx": "fila fiscal de aprovação: documento ainda não importado",
  "apps/web/src/features/stock/dfe-queue.tsx": "fila de DF-e recebidos: documento ainda não importado",
  "apps/web/src/features/stock/feed-formulas.tsx": "formulações de ração: entidade fora do catálogo",
  "apps/web/src/features/stock/movements.tsx": "movimentos de estoque: efeito de documentos, sem identidade própria",
  "apps/web/src/features/stock/opening-balances.tsx": "saldos de abertura: carga inicial, não registro navegável"
};

const telasComGradePropria = [];
(function varrerWeb(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) varrerWeb(p);
    else if (f.name.endsWith(".tsx") && fs.readFileSync(p, "utf8").includes("<DataTable")) telasComGradePropria.push(path.relative(RAIZ, p));
  }
})(path.join(RAIZ, "apps/web/src"));

let telasComIdGlobal = 0;
for (const rel of telasComGradePropria) {
  const usa = fs.readFileSync(path.join(RAIZ, rel), "utf8").includes("colunaIdGlobalTabela");
  const declarada = LISTAGENS_CUSTOM_SEM_ID_GLOBAL[rel];
  if (usa) { telasComIdGlobal++; if (declarada) aviso(`listagem custom: ${rel} exibe o ID Global mas está declarada como sem ID Global — remova a declaração`); continue; }
  if (!declarada) aviso(`listagem custom sem ID Global: ${rel} monta a grade por conta própria e não usa colunaIdGlobalTabela — acrescente a coluna ou declare em LISTAGENS_CUSTOM_SEM_ID_GLOBAL o motivo de a entidade não ser elegível`);
}
for (const rel of Object.keys(LISTAGENS_CUSTOM_SEM_ID_GLOBAL)) {
  if (!telasComGradePropria.includes(rel)) aviso(`listagem custom: ${rel} está declarada mas não existe mais (ou deixou de usar DataTable) — a declaração precisa sair junto`);
}
// e a prova de navegador de cada uma das que EXIBEM: sem isso, a última milha volta a ficar sem rede
const e2eListagem = fs.readFileSync(path.join(RAIZ, "apps/web/e2e/id-global-listagem.spec.ts"), "utf8");
for (const rota of ["/financeiro/contas-a-pagar", "/pecuaria/animais", "/financeiro/ofx", "/admin/perfis"]) {
  if (!e2eListagem.includes(rota)) aviso(`listagem custom: a rota ${rota} não é aberta por nenhum caso de apps/web/e2e/id-global-listagem.spec.ts`);
}

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

// ---------- 6. APRESENTAÇÃO: número puro, coluna solta (PRE-BASE2-05B.2) ----------
/**
 * Duas decisões de interface viraram contrato de código nesta fatia, e nenhuma delas se defende sozinha por
 * teste de unidade: o formatador é fácil de provar, mas nada impede uma TELA NOVA de escrever o prefixo à mão
 * ou de repinar a identidade. É esse o buraco que esta seção fecha.
 *
 * O primeiro caso é EXECUTADO, não lido: `formatarIdGlobal` roda aqui com um número de verdade. Um gate que
 * apenas procurasse a string "#" no fonte do pacote passaria tranquilo por uma implementação que remontasse o
 * prefixo de outro jeito (`String.fromCharCode(35)`, uma constante importada, uma interpolação).
 *
 * Os outros dois são estruturais e varrem o código de aplicação com os COMENTÁRIOS REMOVIDOS. Sem isso, a
 * própria explicação de "por que não há mais `pinned` aqui" reprovaria o arquivo que ela documenta — e o
 * caminho de saída de um gate assim é apagar a explicação, que é o contrário do que se quer.
 */
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const amostra = formatarIdGlobal(54);
if (!/^\d+$/.test(amostra)) aviso(`apresentação: formatarIdGlobal(54) devolveu ${JSON.stringify(amostra)} — o ID Global é exibido como número puro desde a PRE-BASE2-05B.2`);
if (formatarIdGlobal("#54") !== "54") aviso(`apresentação: formatarIdGlobal("#54") devolveu ${JSON.stringify(formatarIdGlobal("#54"))} — valor já grafado à moda antiga precisa sair sem prefixo, nunca "##54"`);

const COLUNA_IDENTIDADE = "apps/web/src/features/listing/id-global-coluna.tsx";
if (/\bpinned\b/.test(semComentarios(fs.readFileSync(path.join(RAIZ, COLUNA_IDENTIDADE), "utf8")))) {
  aviso(`apresentação: ${COLUNA_IDENTIDADE} voltou a declarar pinagem estrutural — a coluna de ID Global rola com as demais (PRE-BASE2-05B.2). A capacidade genérica \`Base1Column.pinned\` continua existindo para outra coluna que precise dela`);
}

// `#` colado num valor de ID Global em código de aplicação: o número vira texto SÓ por `formatarIdGlobal`.
const PREFIXO_REMONTADO = [
  /#\$\{[^}]*\b(?:idGlobal|id_global|ID_GLOBAL)\b/,
  /["'`]#["'`]\s*\+\s*[^;)\n]*\b(?:idGlobal|id_global|ID_GLOBAL)\b/,
  /\b(?:idGlobal|id_global|ID_GLOBAL)\b[^;)\n]*\+\s*["'`]#["'`]/
];
for (const base of ["apps/web/src", "apps/api/src"]) {
  (function varrerApresentacao(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { varrerApresentacao(p); continue; }
      if (!/\.(ts|tsx)$/.test(f.name)) continue;
      const rel = path.relative(RAIZ, p);
      const codigo = semComentarios(fs.readFileSync(p, "utf8"));
      codigo.split("\n").forEach((linha, i) => {
        if (PREFIXO_REMONTADO.some((r) => r.test(linha))) {
          aviso(`apresentação: ${rel}:${i + 1} remonta o prefixo "#" no ID Global — a exibição é número puro e sai de formatarIdGlobal, o único ponto onde o número vira texto`);
        }
      });
    }
  })(path.join(RAIZ, base));
}

if (erros.length) {
  console.error("id-global-audit: FALHOU");
  for (const e of erros) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`id-global-audit: OK (${ENTIDADES_ID_GLOBAL.length} entidades, ${portas} porta(s) de escrita direta + porta genérica, ${listadas.size} listagem(ns) de API com ID Global, ${telasComIdGlobal} tela(s) de grade própria com a coluna + ${Object.keys(LISTAGENS_CUSTOM_SEM_ID_GLOBAL).length} declarada(s) sem ID Global, exibição central derivada do catálogo, apresentação em número puro e coluna solta)`);
