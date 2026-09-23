import { test, expect } from "@playwright/test";
import {
  filtrarLinhas, linhaAtivaDoRecorte, linhasDeLancamento, linhasDoGrupo, linhasDoMenuRapido, moverAtivo,
  normalizarTexto, padraoDeLancamento, rotaDeLancamento, textoDeContagem, LIMITE_DO_MENU_RAPIDO,
  type LinhaDeLancamento
} from "../src/features/sales/launcher-operacoes";
import { CONTRATO_TOPS, type TopOperacional } from "../src/features/sales/tipo-operacao-select";
import type { GrupoDeTops } from "../src/features/sales/variantes";

/**
 * AS DECISÕES DA JANELA DE LANÇAMENTO, MEDIDAS SEM A JANELA (PORTAL-VENDAS-UX-01).
 *
 * ┌─ POR QUE ESTES CASOS NÃO SÃO E2E ──────────────────────────────────────────────────────────────┐
 * │ O que está sob teste aqui é REGRA, não pintura: "um item não é padrão", "dois padrões não        │
 * │ pré-selecionam nenhum", "escolha fora do recorte não recai no padrão", "o filtro não muta a       │
 * │ entrada". Cada uma delas precisaria, pelo E2E, de um estado de servidor fabricado, um clique e   │
 * │ uma leitura de atributo — caro, lento e indireto. Aqui elas são chamadas de função: quando        │
 * │ falham, o nome da função já é o endereço do defeito.                                             │
 * │                                                                                                  │
 * │ Três delas (U2, U4, U5) foram BLOQUEADORES de revisão em PRs anteriores — "cardinalidade não     │
 * │ declara padrão" e "padrão não se infere por ordem". Elas existem aqui para que a próxima         │
 * │ reescrita da janela não as reintroduza em silêncio.                                              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUE ESTE ARQUIVO RODA NO PLAYWRIGHT, E NÃO NO VITEST ─────────────────────────────────────┐
 * │ `apps/web` não tem runner de teste unitário: os vitest do repositório são de `packages/*` e de   │
 * │ `apps/api`. Pôr estes casos num deles obrigaria um pacote de domínio (ou de plataforma) a        │
 * │ importar código do APLICATIVO WEB — a dependência ao contrário da declarada em                    │
 * │ `.claude/rules/architecture.md` — e ainda exigiria ensinar o vitest daquele pacote a resolver o   │
 * │ alias `@/` e o JSX do web. O runner que o web JÁ TEM é o Playwright, e ele executa um teste sem  │
 * │ `page` como teste comum de Node: nenhum navegador é aberto por este arquivo.                      │
 * │                                                                                                  │
 * │ Consequência declarada: eles rodam dentro de `pnpm e2e`, junto da suíte. São instantâneos e não  │
 * │ tocam servidor nem banco. Se um dia o web ganhar um runner de unidade próprio, este arquivo se    │
 * │ muda inteiro — ele não depende de nada do Playwright além de `test`/`expect`.                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * FIXTURES — a forma que o registry e o servidor produzem, montada à mão
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const top = (id: string, code: string, name: string, isDefault = false): TopOperacional =>
  ({ id, code, name, version: 1, isDefault });

/**
 * Um grupo PRONTO. `segmento`, `perm` e `chaveI18n` seguem a regra do registry (o plural da variante),
 * porque é dela que as linhas copiam a porta de destino — nunca de um mapa escrito em algum lugar.
 */
function grupoPronto(
  familia: string, variante: string, rotulo: string, items: TopOperacional[], defaultId: string | null = null
): GrupoDeTops {
  const plural = `${variante}s`;
  return {
    variante: { variante, segmento: plural, perm: plural, familia, chaveI18n: `top.${familia}` },
    rotulo, habilitado: true,
    estado: { situacao: "pronto", dados: { contractVersion: CONTRATO_TOPS, family: { code: familia, label: rotulo }, defaultId, items } }
  };
}

/** O mesmo grupo, mas num estado que NÃO autoriza lançamento. */
const grupoNoEstado = (base: GrupoDeTops, estado: GrupoDeTops["estado"]): GrupoDeTops => ({ ...base, estado });

const ORC1 = top("id-orc-1", "60101", "Proposta Balcão Imediata");
const ORC2 = top("id-orc-2", "60102", "Proposta Safra Antecipada");
const PED1 = top("id-ped-1", "60201", "Encomenda Mensal Regular");
const VEN1 = top("id-ven-1", "60301", "Faturamento Direto Imediato");

const ORCAMENTOS = grupoPronto("vendas.orcamento", "budget", "Orçamento de venda", [ORC1, ORC2]);
const PEDIDOS = grupoPronto("vendas.pedido", "order", "Pedido de venda", [PED1]);
const VENDAS = grupoPronto("vendas.venda", "sale", "Venda", [VEN1]);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U1 — ACHATAR: a linha carrega a porta e o rótulo HUMANO, copiados do grupo
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U1 — cada linha copia segmento, família e rótulo humano do grupo, e as famílias saem contíguas", () => {
  const linhas = linhasDeLancamento([ORCAMENTOS, PEDIDOS, VENDAS]);
  expect(linhas.map((l) => l.id), "as quatro operações, na ordem dos grupos").toEqual([ORC1.id, ORC2.id, PED1.id, VEN1.id]);
  // O AGRUPAMENTO VISUAL É A ORDEM: as duas do orçamento saem juntas, e é isso que dispensa cabeçalho de grupo.
  expect(linhas.slice(0, 2).map((l) => l.familia), "linhas da mesma família saem contíguas")
    .toEqual(["vendas.orcamento", "vendas.orcamento"]);
  expect(linhas[0], "a linha carrega o que decide a escolha e para onde ela vai").toMatchObject({
    id: ORC1.id, code: ORC1.code, name: ORC1.name,
    segmento: "budgets", familia: "vendas.orcamento", rotuloDoTipo: "Orçamento de venda", ehPadrao: false
  });
  // O RÓTULO É HUMANO, NUNCA O CÓDIGO CANÔNICO — o código canônico é atributo de teste.
  expect(linhas.map((l) => l.rotuloDoTipo), "nenhuma linha mostra o código da família ao usuário")
    .not.toContain("vendas.orcamento");
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U2 / U3 / U4 / U5 — O PADRÃO: só `defaultId` o declara, e só quando é UM
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U2 — operação ÚNICA e sem `defaultId` NÃO é padrão, não pré-seleciona e não fica ativa", () => {
  // Uma família, um item, nenhum `defaultId`. É o cenário exato do bloqueador de revisão anterior.
  const uma = grupoPronto("vendas.orcamento", "budget", "Orçamento de venda", [ORC1]);
  const linhas = linhasDeLancamento([uma]);
  expect(linhas, "premissa: existe UMA linha — senão não haveria cardinalidade a interpretar").toHaveLength(1);
  expect(linhas[0]!.ehPadrao, "cardinalidade NÃO declara padrão").toBe(false);
  expect(padraoDeLancamento(linhas), "e sem padrão declarado não há pré-seleção").toBeNull();
  expect(linhaAtivaDoRecorte({ visiveis: linhas, escolhido: null, padrao: null }),
    "nem linha ativa: `Lançar` nasce desabilitado até o usuário escolher").toBeNull();
});

test("U3 — `defaultId` declarado e presente na lista pré-seleciona AQUELA linha", () => {
  const comPadrao = grupoPronto("vendas.orcamento", "budget", "Orçamento de venda", [ORC1, ORC2], ORC2.id);
  const linhas = linhasDeLancamento([comPadrao, PEDIDOS]);
  expect(linhas.filter((l) => l.ehPadrao).map((l) => l.id), "só a linha apontada por `defaultId` é padrão").toEqual([ORC2.id]);
  expect(padraoDeLancamento(linhas), "e ela é a pré-seleção").toBe(ORC2.id);
  expect(linhaAtivaDoRecorte({ visiveis: linhas, escolhido: null, padrao: padraoDeLancamento(linhas) }),
    "sem escolha do usuário, a linha ativa é o padrão").toBe(ORC2.id);
  // E NÃO A PRIMEIRA: se a pré-seleção viesse da posição, este teste passaria com `ORC1`.
  expect(padraoDeLancamento(linhas), "o padrão não é a primeira linha").not.toBe(ORC1.id);
});

test("U4 — `defaultId` ausente não seleciona nada, por mais itens que a lista tenha", () => {
  const linhas = linhasDeLancamento([ORCAMENTOS, PEDIDOS, VENDAS]);
  expect(linhas.length, "premissa: a lista é longa — 'nada selecionado' não é efeito de lista vazia").toBeGreaterThan(1);
  expect(linhas.some((l) => l.ehPadrao), "nenhuma linha se diz padrão").toBe(false);
  expect(padraoDeLancamento(linhas)).toBeNull();
  expect(linhaAtivaDoRecorte({ visiveis: linhas, escolhido: null, padrao: null })).toBeNull();
});

test("U5 — DOIS padrões (um por família) não pré-selecionam nenhum dos dois", () => {
  /**
   * `defaultId` é declarado POR FAMÍLIA e esta janela mistura as famílias: dois padrões ao mesmo tempo
   * é cenário normal. Escolher "o primeiro" seria decidir a operação do usuário pela ORDEM do registry
   * — uma preferência que ninguém cadastrou, com a mesma cara de uma que foi cadastrada.
   */
  const orcamentos = grupoPronto("vendas.orcamento", "budget", "Orçamento de venda", [ORC1, ORC2], ORC2.id);
  const pedidos = grupoPronto("vendas.pedido", "order", "Pedido de venda", [PED1], PED1.id);
  const linhas = linhasDeLancamento([orcamentos, pedidos]);
  expect(linhas.filter((l) => l.ehPadrao).map((l) => l.id), "premissa: são DOIS padrões declarados").toEqual([ORC2.id, PED1.id]);
  expect(padraoDeLancamento(linhas), "com dois, nenhum vence — a janela não escolhe por ordem").toBeNull();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U6 — FAIL-CLOSED: grupo sem capacidade ou sem lista confirmada não contribui com NENHUMA linha
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U6 — grupo sem capacidade ou com lista não confirmada não vira linha nenhuma", () => {
  expect(linhasDoGrupo(ORCAMENTOS), "premissa: habilitado e pronto, o grupo rende linhas").toHaveLength(2);

  expect(linhasDoGrupo({ ...ORCAMENTOS, habilitado: false }), "sem a capacidade de criar, nenhuma linha").toHaveLength(0);
  for (const estado of [
    { situacao: "carregando" },
    { situacao: "nao-confirmado", status: 500 },
    { situacao: "sem-top", familia: "Orçamento de venda" },
    { situacao: "erro", mensagem: "sem permissão" }
  ] as GrupoDeTops["estado"][]) {
    expect(linhasDoGrupo(grupoNoEstado(ORCAMENTOS, estado)),
      `estado "${estado.situacao}" não autoriza lançamento`).toHaveLength(0);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U7 / U8 / U9 — A PESQUISA
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

const TODAS = linhasDeLancamento([ORCAMENTOS, PEDIDOS, VENDAS]);

test("U7 — a pesquisa por CÓDIGO recorta para a operação daquele código", () => {
  expect(TODAS.length, "premissa: há mais de uma linha para recortar").toBeGreaterThan(1);
  expect(filtrarLinhas(TODAS, PED1.code).map((l) => l.id), "o código encontra a operação dele").toEqual([PED1.id]);
  expect(filtrarLinhas(TODAS, "601").map((l) => l.id), "fragmento de código também recorta").toEqual([ORC1.id, ORC2.id]);
  expect(filtrarLinhas(TODAS, "99999"), "código que não existe devolve recorte vazio, não a lista inteira").toHaveLength(0);
});

test("U8 — a pesquisa por NOME ignora acento e caixa, e vários termos ESTREITAM (E, não OU)", () => {
  // "balcao" contra "Proposta Balcão Imediata": minúscula e sem acento dos dois lados da comparação.
  expect(normalizarTexto("Proposta Balcão Imediata"), "a chave de comparação é minúscula e sem acento")
    .toBe("proposta balcao imediata");
  expect(filtrarLinhas(TODAS, "balcao").map((l) => l.id), "fragmento sem acento encontra o nome acentuado").toEqual([ORC1.id]);
  expect(filtrarLinhas(TODAS, "PROPOSTA").map((l) => l.id), "e a caixa não importa").toEqual([ORC1.id, ORC2.id]);
  // DOIS TERMOS COMBINAM COM E: com OU, digitar a segunda palavra AUMENTARIA o resultado.
  expect(filtrarLinhas(TODAS, "proposta safra").map((l) => l.id), "dois termos estreitam").toEqual([ORC2.id]);
  expect(filtrarLinhas(TODAS, "proposta safra").length, "e o E devolve MENOS que o primeiro termo sozinho")
    .toBeLessThan(filtrarLinhas(TODAS, "proposta").length);
  // O RÓTULO DO TIPO TAMBÉM É PESQUISÁVEL: é uma das três colunas que a linha mostra.
  expect(filtrarLinhas(TODAS, "pedido de venda").map((l) => l.id), "o tipo de documento entra na busca").toEqual([PED1.id]);
});

test("U9 — filtrar NÃO muta a entrada, e devolve sempre um array novo", () => {
  /**
   * A lista de grupos vem de uma consulta EM CACHE, COMPARTILHADA com o filtro de TOP da listagem.
   * Ordenar ou filtrar "no lugar" corromperia a outra tela sem deixar rastro — e não haveria erro
   * nenhum para investigar, só uma lista que um dia veio diferente.
   */
  const antes = JSON.parse(JSON.stringify(TODAS)) as LinhaDeLancamento[];
  const recorte = filtrarLinhas(TODAS, "proposta");
  expect(recorte.length, "premissa: o filtro de fato recortou — senão 'não mutou' seria trivial").toBeLessThan(TODAS.length);
  expect(TODAS, "a lista de entrada continua idêntica").toEqual(antes);

  const semBusca = filtrarLinhas(TODAS, "");
  expect(semBusca, "sem busca o conteúdo é o mesmo").toEqual(TODAS);
  expect(semBusca, "mas o array é OUTRO — ninguém recebe a referência de dentro do cache").not.toBe(TODAS);
  semBusca.length = 0;
  expect(TODAS, "e mexer no devolvido não alcança a entrada").toEqual(antes);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U10 / U11 — A LINHA ATIVA E O CURSOR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U10 — a escolha explícita vence o padrão; fora do recorte, ela NÃO recai no padrão", () => {
  const padrao = ORC2.id;
  expect(linhaAtivaDoRecorte({ visiveis: TODAS, escolhido: PED1.id, padrao }),
    "a escolha do usuário vence a pré-seleção enquanto existir no recorte").toBe(PED1.id);

  const recorte = filtrarLinhas(TODAS, "proposta");
  expect(recorte.some((l) => l.id === PED1.id), "premissa: a escolha saiu do recorte").toBe(false);
  expect(recorte.some((l) => l.id === padrao), "premissa: e o padrão continua VISÍVEL no recorte").toBe(true);
  /**
   * Ressuscitar o padrão porque a escolha do usuário está apenas escondida lançaria justamente o que
   * ele trocou. Sem linha ativa, `Lançar` fica desabilitado e Enter é no-op — nada acontece por engano.
   */
  expect(linhaAtivaDoRecorte({ visiveis: recorte, escolhido: PED1.id, padrao }),
    "escolha fora do recorte não recai no padrão").toBeNull();
});

test("U11 — o cursor entra pela ponta, anda de um em um e PARA nas extremidades (sem wrap)", () => {
  const ids = TODAS.map((l) => l.id);
  expect(ids.length, "premissa: há pelo menos três linhas para andar").toBeGreaterThan(2);

  expect(moverAtivo(TODAS, null, "proximo"), "com nada ativo, ↓ entra pela primeira").toBe(ids[0]);
  expect(moverAtivo(TODAS, null, "anterior"), "e ↑ entra pela última").toBe(ids[ids.length - 1]);
  expect(moverAtivo(TODAS, ids[0]!, "proximo"), "↓ anda uma linha").toBe(ids[1]);
  expect(moverAtivo(TODAS, ids[1]!, "anterior"), "↑ volta uma linha").toBe(ids[0]);
  // SEM WRAP: dar a volta faria a tela saltar do topo para o fim e o usuário perderia o lugar.
  expect(moverAtivo(TODAS, ids[0]!, "anterior"), "↑ na primeira PARA").toBe(ids[0]);
  expect(moverAtivo(TODAS, ids[ids.length - 1]!, "proximo"), "↓ na última PARA").toBe(ids[ids.length - 1]);
  expect(moverAtivo(TODAS, null, "primeiro"), "Home vai ao começo").toBe(ids[0]);
  expect(moverAtivo(TODAS, null, "ultimo"), "End vai ao fim").toBe(ids[ids.length - 1]);
  expect(moverAtivo([], ids[0]!, "proximo"), "recorte vazio não tem para onde ir").toBeNull();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U12 — A PORTA E O ANÚNCIO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U12 — a rota sai do segmento da própria linha, e a contagem anuncia o recorte", () => {
  const [orcamento] = linhasDeLancamento([ORCAMENTOS]);
  const [pedido] = linhasDeLancamento([PEDIDOS]);
  expect(rotaDeLancamento(orcamento!), "a porta é a da família da operação").toBe(`/vendas/budgets/new?tipo_operacao_id=${ORC1.id}`);
  expect(rotaDeLancamento(pedido!), "e muda com a família, não com quem chamou").toBe(`/vendas/orders/new?tipo_operacao_id=${PED1.id}`);

  // A REGIÃO VIVA É O QUE SOBRA para quem não vê a lista mudar: ela precisa dizer o NÚMERO.
  expect(textoDeContagem(0), "o vazio é dito, não silenciado").toBe("Nenhuma operação encontrada");
  expect(textoDeContagem(1), "singular").toBe("1 operação encontrada");
  expect(textoDeContagem(7), "plural com o número").toBe("7 operações encontradas");
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * U13 — O MENU RÁPIDO DA SETA DO `Novo` (VISUAL-UX-01 R3)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("U13 — o menu rápido mostra tudo até o limite; acima dele, SÓ o que o servidor marcou como padrão", () => {
  const poucas = linhasDeLancamento([ORCAMENTOS, PEDIDOS, VENDAS]);
  expect(poucas.length, "premissa: abaixo do limite").toBeLessThanOrEqual(LIMITE_DO_MENU_RAPIDO);
  expect(linhasDoMenuRapido(poucas).map((l) => l.id), "até o limite, todas, na ordem de apresentação").toEqual(poucas.map((l) => l.id));
  expect(linhasDoMenuRapido(poucas), "e devolve array NOVO: a lista vem de cache compartilhado").not.toBe(poucas);

  // NOVE operações de uma família, UMA padrão — no MEIO, para que "as primeiras" não passe por acaso.
  const nove = Array.from({ length: LIMITE_DO_MENU_RAPIDO + 1 }, (_, i) => top(`id-lote-${i}`, `609${i}`, `Faturamento Lote ${i}`, i === 5));
  const muitas = linhasDeLancamento([grupoPronto("vendas.venda", "sale", "Venda", nove, "id-lote-5")]);
  expect(muitas.length, "premissa: acima do limite").toBeGreaterThan(LIMITE_DO_MENU_RAPIDO);
  expect(linhasDoMenuRapido(muitas).map((l) => l.id), "acima do limite, só a padrão — nunca 'as primeiras'").toEqual(["id-lote-5"]);

  // Sem padrão declarado, acima do limite o menu fica VAZIO (e o pé "Escolher operação…" é o caminho).
  const semPadrao = linhasDeLancamento([grupoPronto("vendas.venda", "sale", "Venda", nove.map((t) => ({ ...t, isDefault: false })))]);
  expect(linhasDoMenuRapido(semPadrao), "cardinalidade não inventa padrão").toEqual([]);
});
