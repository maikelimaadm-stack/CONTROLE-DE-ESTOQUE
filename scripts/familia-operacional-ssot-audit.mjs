#!/usr/bin/env node
/**
 * A LISTA DAS FAMÍLIAS OPERACIONAIS CANÔNICAS TEM UM DONO SÓ.
 *
 * POR QUE ESTE GATE EXISTE. `docs/TIPO-OPERACAO-CONTRACT.md` §10 já nomeava o anti-padrão — "segunda lista
 * de TOPs (no web, na API, num `.mjs` paralelo): a segunda lista não fica desatualizada com barulho, ela
 * envelhece em silêncio" — mas isso era PROSA. Nenhum script conferia, e prosa não reprova ninguém.
 *
 * A TOP-CONFIG-01 tornou a dívida barata de contrair: agora existe uma tela que precisa oferecer as famílias
 * num seletor, e a maneira mais rápida de fazer isso é digitar as dezessete no `.tsx`. Funcionaria hoje e
 * mentiria na primeira família nova: o registry ganharia `vendas.devolucao`, o seletor continuaria com
 * dezessete opções, e NADA quebraria — nem tipo, nem teste, nem tela. O defeito seria uma opção que não
 * aparece, descoberta meses depois por um usuário.
 *
 * O QUE ELE PROÍBE: um arquivo de RUNTIME DE PRODUTO, fora do dono, conter DOIS OU MAIS códigos canônicos
 * literais EM CÓDIGO. Três recortes, cada um por um motivo medido:
 *
 *   DOIS, E NÃO UM     uma menção isolada é legítima e comum (uma regra que trata de UMA família). O que
 *                      caracteriza a segunda lista é a ENUMERAÇÃO.
 *   EM CÓDIGO          comentário e documentação são ignorados. Ao rodar a primeira versão desta regra, os
 *                      únicos achados em `src/` eram DOIS COMENTÁRIOS explicando as variantes de
 *                      transferência — prosa correta, que envelhece com revisão humana e não vira catálogo.
 *                      Reprová-los ensinaria a apagar explicação, que é o oposto do que este repositório quer.
 *   RUNTIME DE PRODUTO teste e E2E enumeram famílias o tempo todo, e devem: um teste que lista as variantes
 *                      de venda está conferindo comportamento. Se ele ficar para trás, ele FALHA — alto e
 *                      claro. O perigo desta regra é o silêncio, e teste desatualizado não é silencioso.
 *
 * O QUE ELE NÃO FAZ. Não proíbe consumir a lista (é para isso que `familiasOperacionaisDisponiveis` existe),
 * não proíbe citar uma família, e não lê semântica: conta ocorrências literais de códigos declarados, e isso
 * basta para a regressão que ele veio impedir.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/schema.mjs";
import { semComentarios } from "./lib/sem-comentarios.mjs";

/** O DONO — o único lugar onde a enumeração é legítima. */
const DONO = "packages/domain/src/tipo-operacao.ts";

/**
 * EXCEÇÕES, cada uma com o motivo de estar aqui. Allowlist que ninguém revisa vira carimbo, então cada
 * entrada declara por que aquele arquivo pode enumerar.
 */
const EXCECOES = {
  "packages/domain/src/tipo-operacao.ts": "é o dono da lista",
  "packages/plataforma/src/idiomas/pt-BR.ts": "o catálogo de rótulos tem uma chave `top.<codigo>` por família — é o par declarado do registry, não uma segunda lista de famílias",
  "scripts/familia-operacional-ssot-audit.mjs": "é este gate"
};

/** Onde procurar: o runtime de produto. Teste, E2E e documentação ficam de fora pelo motivo do cabeçalho. */
const RAIZES = ["apps/web/src", "apps/api/src", "packages/domain/src", "packages/plataforma/src", "packages/shared/src", "packages/db/src"];
const EXTENSOES = new Set([".ts", ".tsx", ".mjs", ".js"]);
const IGNORAR = new Set(["node_modules", "dist", ".next", "build", "coverage", "reference"]);

/**
 * Códigos canônicos lidos do DONO — nunca copiados para cá, senão este gate seria a segunda lista.
 * A forma real do registry é `T("<codigo>", "<modulo>", origem(...))`; ler qualquer literal com a forma de
 * código pegaria também os nomes de tabela (`erp.invoices`), então a leitura é ancorada no construtor.
 */
export function codigosDoDono(texto) {
  return [...texto.matchAll(/\bT\(\s*"([a-z][a-z_]*\.[a-z][a-z_]*)"/g)].map((m) => m[1]);
}

/** Quantos códigos DISTINTOS este texto enumera. */
export function codigosEnumerados(texto, codigos) {
  return codigos.filter((c) => texto.includes(`"${c}"`) || texto.includes(`'${c}'`) || texto.includes(`\`${c}\``));
}

function* arquivos(raiz) {
  const abs = path.join(REPO_ROOT, raiz);
  if (!fs.existsSync(abs)) return;
  const pilha = [abs];
  while (pilha.length) {
    const atual = pilha.pop();
    for (const e of fs.readdirSync(atual, { withFileTypes: true })) {
      if (IGNORAR.has(e.name)) continue;
      const p = path.join(atual, e.name);
      if (e.isDirectory()) pilha.push(p);
      else if (EXTENSOES.has(path.extname(e.name))) yield path.relative(REPO_ROOT, p);
    }
  }
}

// ---------- autoteste: as duas direções, antes de auditar o repositório ----------
const CODIGOS_FICTICIOS = ["vendas.venda", "estoque.baixa", "compras.solicitacao"];
const AMOSTRAS = [
  ["o dono é lido do próprio arquivo, não copiado para cá", 3,
    () => codigosDoDono(`T("vendas.venda", "vendas", variante(...)),\nT("estoque.baixa", "estoque", entidade(...)),\nT("compras.solicitacao", "compras", entidade(...)),`).length],
  ["nome de TABELA não é confundido com código de família", 0,
    () => codigosDoDono(`entidade("erp.invoices"), entidade("erp.requisitions")`).length],
  ["uma menção isolada NÃO é enumeração", 1,
    () => codigosEnumerados(`const exemplo = "vendas.venda";`, CODIGOS_FICTICIOS).length],
  ["duas menções SÃO enumeração", 2,
    () => codigosEnumerados(`const familias = ["vendas.venda", "estoque.baixa"];`, CODIGOS_FICTICIOS).length],
  ["aspas simples e crase contam igual", 2,
    () => codigosEnumerados("const a = 'vendas.venda'; const b = `estoque.baixa`;", CODIGOS_FICTICIOS).length],
  ["consumir a lista pelo domínio NÃO enumera", 0,
    () => codigosEnumerados(`familiasOperacionaisDisponiveis().map((c) => rotulo(c))`, CODIGOS_FICTICIOS).length],
  ["código parecido mas não declarado não conta", 0,
    () => codigosEnumerados(`const x = "vendas.devolucao"; const y = "estoque.entrada";`, CODIGOS_FICTICIOS).length],
  ["enumeração em COMENTÁRIO de bloco não reprova", 0,
    () => codigosEnumerados(semComentarios(`/* trata de "vendas.venda" e "estoque.baixa" */`), CODIGOS_FICTICIOS).length],
  ["enumeração em COMENTÁRIO de linha não reprova", 0,
    () => codigosEnumerados(semComentarios(`// as duas: "vendas.venda" e "estoque.baixa"`), CODIGOS_FICTICIOS).length],
  ["a MESMA enumeração em código continua reprovando", 2,
    () => codigosEnumerados(semComentarios(`const f = ["vendas.venda", "estoque.baixa"]; // catálogo`), CODIGOS_FICTICIOS).length]
];
for (const [nome, esperado, executa] of AMOSTRAS) {
  const obtido = executa();
  if (obtido !== esperado) {
    console.error(`familia-operacional-ssot-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado}, obteve ${obtido}.`);
    process.exit(1);
  }
}

// ---------- auditoria do repositório ----------
const donoAbs = path.join(REPO_ROOT, DONO);
if (!fs.existsSync(donoAbs)) {
  console.error(`familia-operacional-ssot-audit: o dono ${DONO} não existe — sem dono não há o que proteger.`);
  process.exit(1);
}
const CODIGOS = codigosDoDono(fs.readFileSync(donoAbs, "utf8"));
if (CODIGOS.length < 2) {
  console.error(`familia-operacional-ssot-audit: li ${CODIGOS.length} código(s) canônico(s) em ${DONO} — leitura suspeita, não aprovo por ausência.`);
  process.exit(1);
}

const erros = [];
const vistos = new Set();
for (const raiz of RAIZES) {
  for (const rel of arquivos(raiz)) {
    if (vistos.has(rel)) continue;
    vistos.add(rel);
    if (EXCECOES[rel]) continue;
    const achados = codigosEnumerados(semComentarios(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")), CODIGOS);
    if (achados.length >= 2) {
      erros.push(`${rel}: enumera ${achados.length} famílias canônicas (${achados.slice(0, 4).join(", ")}${achados.length > 4 ? ", …" : ""})`);
    }
  }
}

if (erros.length) {
  console.error("familia-operacional-ssot-audit: segunda lista das famílias operacionais canônicas\n");
  for (const e of erros) console.error("  - " + e);
  console.error(`\nQuem declara as famílias é ${DONO}. Para consumi-las, use \`familiasOperacionaisDisponiveis()\``);
  console.error("(no servidor) ou peça ao servidor (`GET /api/admin/tipos-operacao/familias`) — no cliente não há catálogo.");
  console.error("Se o arquivo PRECISA enumerar, acrescente-o a EXCECOES com o motivo escrito.");
  process.exit(1);
}

console.log(`familia-operacional-ssot-audit: OK (autoteste ${AMOSTRAS.length}/${AMOSTRAS.length}; ${CODIGOS.length} famílias declaradas em ${DONO}; ${vistos.size} arquivo(s) varrido(s), ${Object.keys(EXCECOES).length} exceção(ões) declarada(s))`);
