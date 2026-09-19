#!/usr/bin/env node
/**
 * TELA DECLARADA COMO MODELO BASE 2 NÃO VOLTA À COMPOSIÇÃO ANTERIOR.
 *
 * POR QUE ESTE GATE EXISTE. Migrar uma tela para a moldura (docs/MODELO-BASE2-CONTRACT.md) é barato de
 * desfazer sem querer: basta alguém "consertar" um detalhe trocando `Base2Fields` por `KV` de novo, ou
 * embrulhar a tela num `DetailShell` direto para ganhar uma prop. A tela continua abrindo, os testes
 * funcionais continuam passando, e a moldura perde um consumidor em silêncio — que é como o padrão
 * anterior voltou a crescer todas as vezes em que ninguém o travou.
 *
 * O E2E cobre o efeito (a tela mostra identidade, campos e itens do Base 2). Este auditor cobre a CAUSA,
 * e é estático de propósito: ele reprova no `pnpm lint`, antes de subir um navegador.
 *
 * O QUE ELE NÃO FAZ. Não decide QUAIS telas devem migrar — a lista abaixo é uma DECLARAÇÃO, e a migração
 * é progressiva por fatia (BASE2-03+). Tela fora da lista não é cobrada. Também não proíbe os
 * componentes antigos na tela inteira: `SimpleTable` continua legítimo nas superfícies de PROCESSO
 * (cotações, aprovações), porque converter tudo para `Base2Items` transformaria a moldura numa máquina
 * de processo. O que se proíbe é a composição PRINCIPAL regredir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * REGRAS DA TELA DE VENDAS — declaradas UMA vez, usadas em DOIS lugares.
 *
 * A constante existe para que o autoteste exercite EXATAMENTE o contrato que o repositório cobra. Uma
 * cópia das regexes dentro do autoteste provaria que a cópia funciona, e não que a regra aplicada à tela
 * funciona — as duas divergiriam na primeira vez que alguém ajustasse só um lado, e o gate continuaria
 * "verde com autoteste" sem cobrir nada.
 *
 * Elas são deliberadamente tolerantes a ESPAÇO e a ASPA SIMPLES OU DUPLA, porque a formatação é
 * incidental: um gate que depende de como o arquivo foi formatado é contornado sem intenção nenhuma, no
 * primeiro `prettier` que rodar diferente. O que elas NÃO tentam é entender JavaScript — não há parser
 * aqui, e reconhecer toda forma possível de escrever a mesma regressão não é o objetivo.
 */
const REGRAS_VENDAS = [
  { procura: "tipoOperacaoDoRegistro\\([^)]*,\\s*d\\s*\\)", deve: true, motivo: "a TOP tem de ser resolvida a partir do REGISTRO (`d`), nunca da rota" },
  { procura: "tipoOperacaoDoRegistro\\([^)]*\\bsegmentoDaRota\\b", deve: false, motivo: "a TOP não pode sair do segmento da URL — ele é porta de navegação, não autoridade" },
  // ANCORADA NA ATRIBUIÇÃO da identidade, não numa ocorrência qualquer de `d["kind"]`: é a linha que
  // decide o que a tela diz que o registro É.
  { procura: "const\\s+variante\\s*=\\s*d\\s*\\?\\s*String\\(\\s*d\\[\\s*[\"']kind[\"']\\s*\\]\\s*\\)", deve: true, motivo: "a variante apresentada sai do REGISTRO (`d[\"kind\"]`), não de `params.kind`" },
  // VÍNCULO POSITIVO. Exigir que a variável `variante` EXISTA não é o mesmo que exigir que ela seja
  // USADA: a atribuição de `k` é a linha que decide o título, a família de permissão, as ações, o
  // próximo documento e a rota funcional. Sem esta regra, `const variante = d["kind"]` podia continuar
  // no arquivo, intacta e inútil, enquanto `k` voltava a ser escolhido pela URL — e o gate diria OK.
  { procura: "const\\s+k\\s*=\\s*DO_REGISTRO\\s*\\[\\s*variante\\s*\\]", deve: true, motivo: "a configuração funcional (`k`) tem de ser indexada pela variante DO REGISTRO — é ela que decide título, permissão, ações e próximo documento" },
  // O ÍNDICE INTEIRO, não só o identificador solto. A forma anterior casava apenas com
  // `DO_REGISTRO[segmentoDaRota]` e deixava passar `DO_REGISTRO[segmentoDaRota.replace(/s$/, "")]`,
  // `DO_REGISTRO[String(segmentoDaRota)]` e afins — a mesma classificação pela rota, escrita com uma
  // transformação no meio. `[^\]\n]*` limita a busca ao conteúdo de UM colchete numa linha: é o
  // suficiente para ver a rota dentro do índice sem virar parser de JavaScript.
  { procura: "DO_REGISTRO\\s*\\[[^\\]\\n]*\\bsegmentoDaRota\\b[^\\]\\n]*\\]", deve: false, motivo: "indexar o mapa pelo segmento da URL é classificar pela porta por onde o registro foi pedido" },
  // O FALLBACK PARA VENDA é o defeito nomeado desta fatia. Ele não pode voltar em forma nenhuma — nem
  // indexado por rota, nem por registro, e nem com a chave no singular ou no plural.
  { procura: "\\?\\?\\s*(K|DO_REGISTRO)\\s*\\[\\s*[\"']sale", deve: false, motivo: "variante desconhecida NÃO herda a semântica de venda — o fallback silencioso é o defeito que esta fatia fechou" },
  { procura: "[\"']Documento de venda[\"']", deve: true, motivo: "variante desconhecida precisa de rótulo NEUTRO e fail-closed" }
];

/**
 * AS TELAS DECLARADAS NO MODELO BASE 2.
 *
 * Acrescentar uma linha aqui é afirmar que aquele arquivo é o detalhe de um lançamento e que a
 * composição principal dele é a moldura oficial. A fatia que migra a tela acrescenta a linha.
 */
const TELAS = {
  "apps/web/src/features/docs/stock-detail.tsx": { fatia: "BASE2-01 — sete documentos de estoque" },
  "apps/web/src/app/(app)/suprimentos/view/[id]/page.tsx": { fatia: "BASE2-03A — solicitação de compra" },
  // `escopo` recorta a auditoria a UMA função do arquivo. Aqui isso não é conveniência: `titles.tsx`
  // hospeda `TitleList` e `TitleForm`, que NÃO são detalhe de lançamento e por isso não devem nada à
  // moldura. Sem o recorte, o dia em que o formulário ganhasse um `DetailShell` legítimo o gate
  // acusaria o inocente — e gate que acusa o inocente é desligado na semana seguinte.
  "apps/web/src/features/financial/titles.tsx": {
    fatia: "BASE2-03B — títulos financeiros", escopo: "TitleDetail",
    // POR QUE ESTA REGRA É ESTÁTICA, e não um E2E. `financial_titles` tem duas variantes e DUAS ROTAS, e
    // cada rota SÓ SERVE a sua variante — `direction` entra no `where` de toda porta de título
    // (apps/api/src/routes/financial.ts), e variante errada responde 404. Isso é INVARIANTE DE
    // AUTORIZAÇÃO, provada pela matriz de integração de wrong-route, e não uma coincidência conveniente:
    // foi justamente o que a auditoria externa da R1 encontrou ABERTO e esta PR fechou.
    //
    // O efeito colateral dessa invariante é que, na tela, `dir` (a rota) e `d.direction` (o registro)
    // coincidem SEMPRE — e por isso trocar um pelo outro não muda pixel nenhum. É indistinguível por
    // comportamento, exatamente como a numeração por variante da decisão 171. Daí o gate estático: o
    // teste de segurança do backend prova que a rota errada não serve o registro; esta regra prova que a
    // tela CLASSIFICA pelo registro. Um não substitui o outro, e nenhum dos dois cobre o que o outro
    // cobre — no dia em que uma porta servir as duas variantes (busca global, link de parcela, tela
    // unificada), derivar da rota passa a classificar errado, em silêncio.
    regras: [
      { procura: "tipoOperacaoDoRegistro\\([^)]*,\\s*d\\s*\\)", deve: true, motivo: "a TOP tem de ser resolvida a partir do REGISTRO (`d`), nunca da rota" },
      { procura: "tipoOperacaoDoRegistro\\([^)]*\\bdir\\b", deve: false, motivo: "a TOP não pode ser resolvida a partir de `dir` — `dir` é porta de navegação, não autoridade" },
      // ANCORADA NA ATRIBUIÇÃO. A primeira versão procurava `d["direction"]` em qualquer lugar do corpo
      // e passava com o título derivado de `dir`, porque a legenda do rateio já usava o registro — a
      // regra era satisfeita por uma ocorrência que não era a que ela existe para travar.
      { procura: "const titulo = d\\[\"direction\"\\]", deve: true, motivo: "o título funcional sai do REGISTRO, não da rota" },
      // FALLBACK FAIL-CLOSED (R1 §14). `c` é a configuração DA ROTA: serve para endpoint, permissão e
      // voltarHref, jamais para dizer o que o registro É. `c.title`/`c.person` no fallback classificavam
      // pela porta por onde o registro foi pedido — que é a definição do defeito que esta PR fechou.
      { procura: "c\\.(title|person)\\b", deve: false, motivo: "a identidade apresentada não pode sair da ROTA (`c.title`/`c.person`): variante desconhecida usa rótulo NEUTRO" },
      { procura: "\"Título financeiro\"", deve: true, motivo: "variante desconhecida precisa de rótulo neutro e fail-closed, nunca o da rota" }
    ]
  },
  // TRÊS variantes na MESMA tabela e na MESMA tela, com TRÊS famílias de capacidade. O mesmo motivo da
  // BASE2-03B, elevado: aqui a tela já classificava pela ROTA (`K[kind]`) e, pior, um segmento
  // desconhecido CAÍA em `K["sales"]` — herdava o rótulo, a família de permissão e as ações de VENDA
  // sobre um registro que ninguém classificou. A API passou a recusar a rota errada (404), o que torna
  // rota e registro coincidentes nas portas existentes — e portanto a regressão volta a ser
  // indistinguível por comportamento (decisão 171). Por isso o gate é ESTÁTICO: o E2E cobre o efeito, e
  // isto cobre a causa.
  "apps/web/src/app/(app)/vendas/[kind]/[id]/page.tsx": {
    fatia: "BASE2-03C — vendas / sales_documents",
    regras: REGRAS_VENDAS
  }
};

/** O que a composição principal PRECISA ter. */
const EXIGIDOS = ["Base2Shell", "Base2Fields", "Base2Items"];

/**
 * O que a composição principal NÃO pode ter de volta.
 *
 * `DetailShell` é o shell anterior: o `Base2Shell` o compõe por dentro, então usá-lo DIRETO aqui é
 * pular a moldura. `KV` é a lista de dados principais anterior, substituída por `Base2Fields`.
 */
const PROIBIDOS = [
  { nome: "DetailShell", por: "Base2Shell", motivo: "o shell anterior — a moldura já o compõe por dentro" },
  { nome: "KV", por: "Base2Fields", motivo: "a lista de dados principais anterior" }
];

/**
 * O teste é o USO EM JSX (`<Componente`), não a presença do identificador.
 *
 * A primeira versão media o identificador e era frouxa dos dois lados: uma tela que parasse de RENDERIZAR
 * `Base2Items` mas mantivesse o import continuaria "aprovada", e `<Base2Shell` casaria com uma busca solta
 * por "DetailShell" se a regex fosse por substring. Composição é o que a tela DESENHA.
 */
const renderiza = (texto, nome) => new RegExp(`<${nome}[\\s/>]`).test(texto);

/**
 * RECORTE POR FUNÇÃO — o corpo de UMA função de topo do arquivo.
 *
 * Não é um parser: é um recorte por FRONTEIRA DE DECLARAÇÃO. Uma função de topo neste repositório
 * começa na coluna zero (`export function X(` ou `function X(`), então o corpo de X é tudo até a
 * próxima declaração de topo — ou o fim do arquivo. Isso basta para separar `TitleDetail` de
 * `TitleList` sem contar chaves, sem entender JSX e sem uma máquina de estados que envelheceria mal.
 *
 * Devolve `null` quando a função declarada não existe. Isso é REPROVAÇÃO, não "nada a auditar":
 * renomear a função sem atualizar a declaração faria o gate auditar o vazio e aprovar por ausência.
 */
export function recorteDaFuncao(texto, nome) {
  const inicio = new RegExp(`^(?:export\\s+)?function\\s+${nome}\\s*[(<]`, "m").exec(texto);
  if (!inicio) return null;
  const resto = texto.slice(inicio.index + inicio[0].length);
  const proxima = /^(?:export\s+)?(?:function|const|class)\s+\w/m.exec(resto);
  return resto.slice(0, proxima ? proxima.index : undefined);
}

/**
 * Analisa um texto de tela e devolve os problemas encontrados. Pura — é o que o autoteste exercita.
 *
 * `escopo` recorta a auditoria de COMPOSIÇÃO a uma função. O import da moldura continua sendo
 * verificado no ARQUIVO, porque import é de arquivo — não existe import dentro de função.
 */
export function problemasDaTela(texto, escopo, regras = []) {
  const p = [];
  if (!/from\s+["']@\/features\/base2["']/.test(texto)) {
    p.push("não importa a moldura de `@/features/base2`");
  }
  let alvo = texto;
  if (escopo) {
    alvo = recorteDaFuncao(texto, escopo);
    if (alvo === null) return [...p, `a função declarada \`${escopo}\` não existe no arquivo — renomeou sem atualizar a declaração?`];
  }
  for (const nome of EXIGIDOS) if (!renderiza(alvo, nome)) p.push(`não renderiza <${nome}>${escopo ? ` em \`${escopo}\`` : ""}`);
  for (const { nome, por, motivo } of PROIBIDOS) if (renderiza(alvo, nome)) p.push(`voltou a renderizar <${nome}>${escopo ? ` em \`${escopo}\`` : ""} (${motivo}) — o lugar dele é ${por}`);
  // Regras declaradas por tela: o que ESTA tela precisa (ou não pode) conter no corpo auditado.
  for (const { procura, deve, motivo } of regras) {
    if (new RegExp(procura).test(alvo) !== deve) p.push(`${deve ? "perdeu" : "voltou a ter"} \`${procura}\` — ${motivo}`);
  }
  return p;
}

// ---------- autoteste: as duas direções, antes de auditar o repositório ----------
const BOA = `
import { Base2Shell, Base2Section, Base2Fields, Base2Items } from "@/features/base2";
import { SimpleTable } from "@/features/docs/shared";
export default function P() { return <Base2Shell titulo="x"><Base2Fields campos={[]} /><Base2Items colunas={[]} linhas={[]} /><SimpleTable rows={[]} cols={[]} /></Base2Shell>; }
`;
/**
 * Arquivo com DUAS funções de topo: o detalhe (migrado) e um vizinho legítimo que não deve nada à
 * moldura — é a forma exata de `titles.tsx`, onde `TitleList`/`TitleForm` convivem com `TitleDetail`.
 */
const COM_VIZINHO = `
import { Base2Shell, Base2Fields, Base2Items } from "@/features/base2";
import { DetailShell, KV } from "@/features/docs/shared";
export function Detalhe() { return <Base2Shell titulo="x"><Base2Fields campos={[]} /><Base2Items colunas={[]} linhas={[]} /></Base2Shell>; }
export function Vizinho() { return <DetailShell title="lista"><KV items={[]} /></DetailShell>; }
`;

/** Amostra com a resolução de TOP — exercita as `regras` declaradas por tela. */
const COM_VIZINHO_E_TOP = COM_VIZINHO.replace(
  'export function Detalhe() { return <Base2Shell',
  'export function Detalhe() { const top = tipoOperacaoDoRegistro(`erp.x`, d); return <Base2Shell'
);
const REGRAS_TOP = [
  { procura: "tipoOperacaoDoRegistro\\([^)]*,\\s*d\\s*\\)", deve: true, motivo: "resolve pelo registro" },
  { procura: "tipoOperacaoDoRegistro\\([^)]*\\bdir\\b", deve: false, motivo: "não resolve pela rota" }
];

/**
 * A TELA DE VENDAS NA FORMA CORRETA, em miniatura.
 *
 * Contém tudo que `REGRAS_VENDAS` cobra e nada do que ela proíbe: a moldura, a variante saindo de
 * `d["kind"]`, o mapa indexado pela VARIANTE, a TOP resolvida pelo registro, o rótulo neutro e o
 * `segmentoDaRota` no papel legítimo dele — localizar a porta (endpoint e navegação), jamais classificar.
 * É a presença do `segmentoDaRota` aqui que dá valor aos casos ruins: sem ele, proibir "TOP pela rota"
 * seria proibir um identificador que a amostra nem teria.
 */
const VENDAS_BOA = `
import { Base2Shell, Base2Section, Base2Fields, Base2Items } from "@/features/base2";
import { tipoOperacaoDoRegistro } from "@agro/domain";
const DO_REGISTRO = { budget: { titulo: "Orçamento" }, order: { titulo: "Pedido de venda" }, sale: { titulo: "Venda" } };
export default function Page({ params }) {
  const { kind: segmentoDaRota, id } = use(params);
  const q = useDoc(\`/api/sales/\${segmentoDaRota}/\${id}\`);
  const d = q.data;
  const variante = d ? String(d["kind"]) : "";
  const k = DO_REGISTRO[variante];
  const titulo = k?.titulo ?? "Documento de venda";
  const top = tipoOperacaoDoRegistro(\`erp.sales_documents\`, d);
  return <Base2Shell titulo={titulo} voltarHref={\`/vendas/\${k?.segmento ?? segmentoDaRota}\`}><Base2Fields campos={[]} /><Base2Items colunas={[]} linhas={[]} /></Base2Shell>;
}
`;

const AMOSTRAS = [
  ["tela migrada, com SimpleTable legítimo ao lado, PASSA", 0, BOA, undefined],
  ["shell anterior de volta REPROVA", 1, BOA.replace("<Base2Shell titulo=\"x\">", "<DetailShell title=\"x\">"), undefined],
  ["KV de volta como dados principais REPROVA", 1, BOA.replace("<Base2Fields campos={[]} />", "<KV items={[]} />"), undefined],
  ["tabela principal fora do Base2 REPROVA", 1, BOA.replace("<Base2Items colunas={[]} linhas={[]} />", ""), undefined],
  ["sem importar a moldura REPROVA", 1, BOA.replace('from "@/features/base2"', 'from "@/features/base2-copia"'), undefined],
  // O recorte por função, nas DUAS direções — sem isso ele seria indistinguível de um recorte quebrado.
  ["com escopo: vizinho legítimo usando DetailShell/KV NÃO acusa o detalhe", 0, COM_VIZINHO, "Detalhe"],
  ["com escopo: o DETALHE usando DetailShell REPROVA, mesmo com o vizinho limpo", 1,
    COM_VIZINHO.replace("<Base2Shell titulo=\"x\">", "<DetailShell title=\"x\">"), "Detalhe"],
  ["com escopo: função declarada que não existe REPROVA (não aprova por ausência)", 1, COM_VIZINHO, "DetalheRenomeado"],
  // E sem o recorte o MESMO arquivo reprovaria pelo vizinho: é essa diferença que o `escopo` existe para criar.
  ["sem escopo: o vizinho legítimo contamina o arquivo inteiro", 1, COM_VIZINHO, undefined],
  // Regras por tela — a forma como a BASE2-03B trava a classificação pelo REGISTRO.
  ["regra `deve: true` satisfeita PASSA", 0, COM_VIZINHO_E_TOP, "Detalhe", REGRAS_TOP],
  ["regra `deve: true` perdida REPROVA", 1, COM_VIZINHO_E_TOP.replace(", d)", ", { ...d, direction: dir })"), "Detalhe", REGRAS_TOP],
  ["regra `deve: false` violada REPROVA", 1, COM_VIZINHO_E_TOP.replace(", d)", ", dir)"), "Detalhe", REGRAS_TOP],
  // ---- BASE2-03C · as regras DE VENDAS, com as MESMAS `REGRAS_VENDAS` que a tela real é cobrada ----
  // Cada caso ruim é a regressão que a regra correspondente existe para bloquear, escrita como alguém a
  // escreveria de verdade — não uma string sintética que só casa com a regex.
  ["vendas: a forma correta PASSA", 0, VENDAS_BOA, undefined, REGRAS_VENDAS],
  // `aponta` é um trecho do MOTIVO da regra visada, não do código: é o que distingue "reprovou" de
  // "reprovou pelo motivo certo". A primeira versão apontava para o nome da função e o caso B passava
  // satisfeito pela regra VIZINHA — medido, não suposto (reversa G1).
  ["vendas B1: TOP resolvida fora do REGISTRO REPROVA", 1,
    VENDAS_BOA.replace("tipoOperacaoDoRegistro(`erp.sales_documents`, d)", "tipoOperacaoDoRegistro(`erp.sales_documents`, registroDaRota)"),
    undefined, REGRAS_VENDAS, "nunca da rota"],
  ["vendas B2: TOP resolvida pelo SEGMENTO DA ROTA REPROVA", 1,
    VENDAS_BOA.replace("tipoOperacaoDoRegistro(`erp.sales_documents`, d)", "tipoOperacaoDoRegistro(`erp.sales_documents`, { ...d, kind: segmentoDaRota })"),
    undefined, REGRAS_VENDAS, "porta de navegação"],
  // C0 isola a regra POSITIVA: o índice deixa de ser `variante` sem que a rota apareça, então a regra
  // negativa não dispara e só a positiva pode acusar. Sem este caso, a regra positiva estaria coberta
  // apenas por amostras que também violam a negativa — e uma regra que nunca acusa sozinha é
  // indistinguível de uma regra quebrada.
  ["vendas C0: `k` deixa de ser indexado pela VARIANTE REPROVA", 1,
    VENDAS_BOA.replace("const k = DO_REGISTRO[variante];", "const k = DO_REGISTRO[chaveExterna];"),
    undefined, REGRAS_VENDAS, "indexada pela variante DO REGISTRO"],
  ["vendas C: mapa indexado pelo SEGMENTO DA ROTA REPROVA", 1,
    VENDAS_BOA.replace("DO_REGISTRO[variante]", "DO_REGISTRO[segmentoDaRota]"), undefined, REGRAS_VENDAS, "classificar pela porta"],
  // C2 é a forma que a regex estreita deixava passar: a rota TRANSFORMADA dentro do índice. Ela também
  // perde o vínculo positivo, e por isso o `aponta` fixa a regra NEGATIVA — é ela que este caso existe
  // para exercitar.
  ["vendas C2: rota TRANSFORMADA dentro do índice REPROVA", 1,
    VENDAS_BOA.replace("DO_REGISTRO[variante]", 'DO_REGISTRO[segmentoDaRota.replace(/s$/, "")]'),
    undefined, REGRAS_VENDAS, "classificar pela porta"],
  ["vendas D: fallback de variante desconhecida para VENDA REPROVA", 1,
    VENDAS_BOA.replace("const k = DO_REGISTRO[variante];", 'const k = DO_REGISTRO[variante] ?? DO_REGISTRO["sale"];'), undefined, REGRAS_VENDAS, "semântica de venda"],
  // A mesma regressão com aspa simples e espaços — a forma que a regex ANTERIOR, presa a `["sale`, deixava
  // passar. Sem este caso o endurecimento da regex seria afirmação, não medida.
  ["vendas D2: o mesmo fallback com aspa simples e espaços REPROVA", 1,
    VENDAS_BOA.replace("const k = DO_REGISTRO[variante];", "const k = DO_REGISTRO[variante] ??  DO_REGISTRO[ 'sale' ];"), undefined, REGRAS_VENDAS, "semântica de venda"],
  ["vendas E: identidade deixa de sair do REGISTRO REPROVA", 1,
    VENDAS_BOA.replace('const variante = d ? String(d["kind"]) : "";', "const variante = segmentoDaRota.replace(/s$/, \"\");"), undefined, REGRAS_VENDAS, "params.kind"],
  // O rótulo neutro some sem reintroduzir o fallback, para que o caso meça a regra DELE: um substituto
  // que também violasse a regra do fallback reprovaria pelo motivo do vizinho.
  ["vendas F: perda do rótulo NEUTRO REPROVA", 1,
    VENDAS_BOA.replace('?? "Documento de venda"', '?? "Venda"'), undefined, REGRAS_VENDAS, "rótulo NEUTRO"]
];
for (const [nome, esperado, amostra, escopo, regras, aponta] of AMOSTRAS) {
  const problemas = problemasDaTela(amostra, escopo, regras);
  const n = problemas.length;
  // o caso bom exige ZERO; os ruins exigem AO MENOS um (trocar o shell também tira `Base2Shell` do texto)
  let ok = esperado === 0 ? n === 0 : n >= 1;
  // CONTAGEM NÃO BASTA. Quando o caso declara `aponta`, a reprovação tem de vir da regra que ele existe
  // para exercitar: sem isso, uma amostra que reprovasse por um motivo vizinho — um `Base2Items` que
  // faltou, a regra do fallback disparando no lugar da do rótulo — contaria como prova da regra errada,
  // e a regra visada poderia estar quebrada sem ninguém perceber.
  if (ok && aponta && !problemas.some((p) => p.includes(aponta))) {
    console.error(`base2-consumidor-audit: AUTOTESTE FALHOU — "${nome}": reprovou, mas por outro motivo. Nenhum problema menciona "${aponta}":\n  ${problemas.join("\n  ")}`);
    process.exit(1);
  }
  if (!ok) {
    console.error(`base2-consumidor-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado === 0 ? "0" : "≥1"}, obteve ${n}.`);
    process.exit(1);
  }
}

// ---------- auditoria do repositório ----------
const erros = [];
for (const [rel, { fatia, escopo, regras = [] }] of Object.entries(TELAS)) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) { erros.push(`${rel}: declarada como Base 2 e não existe (${fatia})`); continue; }
  const texto = fs.readFileSync(abs, "utf8");
  // NÃO-VACUIDADE: arquivo vazio ou truncado passaria em qualquer "não contém X".
  if (texto.length < 500) { erros.push(`${rel}: ${texto.length} bytes — leitura suspeita, não aprovo por ausência`); continue; }
  for (const p of problemasDaTela(texto, escopo, regras)) erros.push(`${rel} (${fatia}): ${p}`);
}

if (erros.length) {
  console.error("base2-consumidor-audit: tela declarada no Modelo Base 2 saiu da moldura\n");
  for (const e of erros) console.error("  - " + e);
  console.error("\nA composição principal do detalhe é Base2Shell + Base2Fields + Base2Items");
  console.error("(docs/MODELO-BASE2-CONTRACT.md). Componente do módulo continua livre nas superfícies de");
  console.error("PROCESSO — o que não volta é o cabeçalho, os dados principais e a tabela de itens.");
  console.error("Se a tela deixou de ser um detalhe de lançamento, remova a linha de TELAS com o motivo.");
  process.exit(1);
}

console.log(`base2-consumidor-audit: OK (autoteste ${AMOSTRAS.length}/${AMOSTRAS.length}; ${Object.keys(TELAS).length} tela(s) declarada(s) no Modelo Base 2)`);
