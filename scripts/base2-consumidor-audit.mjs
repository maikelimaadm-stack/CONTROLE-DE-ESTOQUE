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
    // POR QUE ESTA REGRA É ESTÁTICA, e não um E2E. `financial_titles` tem duas variantes e DUAS ROTAS,
    // e cada rota filtra por `direction` no servidor: a rota de contas a receber nunca devolve um título
    // a pagar. Logo `dir` (a rota) e `d.direction` (o registro) são SEMPRE iguais na tela, e trocar um
    // pelo outro não muda pixel nenhum — é indistinguível por comportamento, exatamente como a
    // numeração por variante da decisão 171. O que sobra é o texto: a classificação tem de LER O
    // REGISTRO, porque no dia em que uma rota servir as duas variantes (uma busca global, um link de
    // parcela, uma tela unificada) derivar da rota passa a classificar errado — e em silêncio.
    regras: [
      { procura: "tipoOperacaoDoRegistro\\([^)]*,\\s*d\\s*\\)", deve: true, motivo: "a TOP tem de ser resolvida a partir do REGISTRO (`d`), nunca da rota" },
      { procura: "tipoOperacaoDoRegistro\\([^)]*\\bdir\\b", deve: false, motivo: "a TOP não pode ser resolvida a partir de `dir` — `dir` é porta de navegação, não autoridade" },
      // ANCORADA NA ATRIBUIÇÃO. A primeira versão procurava `d["direction"]` em qualquer lugar do corpo
      // e passava com o título derivado de `dir`, porque a legenda do rateio já usava o registro — a
      // regra era satisfeita por uma ocorrência que não era a que ela existe para travar.
      { procura: "const titulo = d\\[\"direction\"\\]", deve: true, motivo: "o título funcional sai do REGISTRO, não da rota" }
    ]
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
  ["regra `deve: false` violada REPROVA", 1, COM_VIZINHO_E_TOP.replace(", d)", ", dir)"), "Detalhe", REGRAS_TOP]
];
for (const [nome, esperado, amostra, escopo, regras] of AMOSTRAS) {
  const n = problemasDaTela(amostra, escopo, regras).length;
  // o caso bom exige ZERO; os ruins exigem AO MENOS um (trocar o shell também tira `Base2Shell` do texto)
  const ok = esperado === 0 ? n === 0 : n >= 1;
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
