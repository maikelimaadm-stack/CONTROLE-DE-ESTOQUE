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
  "apps/web/src/features/docs/stock-detail.tsx": "BASE2-01 — sete documentos de estoque",
  "apps/web/src/app/(app)/suprimentos/view/[id]/page.tsx": "BASE2-03A — solicitação de compra"
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

/** Analisa um texto de tela e devolve os problemas encontrados. Pura — é o que o autoteste exercita. */
export function problemasDaTela(texto) {
  const p = [];
  if (!/from\s+["']@\/features\/base2["']/.test(texto)) {
    p.push("não importa a moldura de `@/features/base2`");
  }
  for (const nome of EXIGIDOS) if (!renderiza(texto, nome)) p.push(`não renderiza <${nome}>`);
  for (const { nome, por, motivo } of PROIBIDOS) if (renderiza(texto, nome)) p.push(`voltou a renderizar <${nome}> (${motivo}) — o lugar dele é ${por}`);
  return p;
}

// ---------- autoteste: as duas direções, antes de auditar o repositório ----------
const BOA = `
import { Base2Shell, Base2Section, Base2Fields, Base2Items } from "@/features/base2";
import { SimpleTable } from "@/features/docs/shared";
export default function P() { return <Base2Shell titulo="x"><Base2Fields campos={[]} /><Base2Items colunas={[]} linhas={[]} /><SimpleTable rows={[]} cols={[]} /></Base2Shell>; }
`;
const AMOSTRAS = [
  ["tela migrada, com SimpleTable legítimo ao lado, PASSA", 0, BOA],
  ["shell anterior de volta REPROVA", 1, BOA.replace("<Base2Shell titulo=\"x\">", "<DetailShell title=\"x\">")],
  ["KV de volta como dados principais REPROVA", 1, BOA.replace("<Base2Fields campos={[]} />", "<KV items={[]} />")],
  ["tabela principal fora do Base2 REPROVA", 1, BOA.replace("<Base2Items colunas={[]} linhas={[]} />", "")],
  ["sem importar a moldura REPROVA", 1, BOA.replace('from "@/features/base2"', 'from "@/features/base2-copia"')]
];
for (const [nome, esperado, amostra] of AMOSTRAS) {
  const n = problemasDaTela(amostra).length;
  // o caso bom exige ZERO; os ruins exigem AO MENOS um (trocar o shell também tira `Base2Shell` do texto)
  const ok = esperado === 0 ? n === 0 : n >= 1;
  if (!ok) {
    console.error(`base2-consumidor-audit: AUTOTESTE FALHOU — "${nome}": esperava ${esperado === 0 ? "0" : "≥1"}, obteve ${n}.`);
    process.exit(1);
  }
}

// ---------- auditoria do repositório ----------
const erros = [];
for (const [rel, fatia] of Object.entries(TELAS)) {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) { erros.push(`${rel}: declarada como Base 2 e não existe (${fatia})`); continue; }
  const texto = fs.readFileSync(abs, "utf8");
  // NÃO-VACUIDADE: arquivo vazio ou truncado passaria em qualquer "não contém X".
  if (texto.length < 500) { erros.push(`${rel}: ${texto.length} bytes — leitura suspeita, não aprovo por ausência`); continue; }
  for (const p of problemasDaTela(texto)) erros.push(`${rel} (${fatia}): ${p}`);
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
