import { test, expect, type Page, type Locator } from "@playwright/test";
import { ptBR } from "@erp/plataforma";
import { login, logout, api, uniq } from "./helpers";
import { textoDeContagem } from "../src/features/sales/launcher-operacoes";

/**
 * A JANELA DE LANÇAMENTO DO PORTAL DE VENDAS — UX1 a UX15 (PORTAL-VENDAS-UX-01).
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PODE PROVAR ────────────────────────────────────────────────────────────┐
 * │ `portal-vendas-unificado.spec.ts` (E15) já prova a ESTRUTURA: grupo por família, TOP dentro do  │
 * │ grupo dela, e a porta certa para o orçamento. `portal-vendas-tipo-operacao.spec.ts` (E1) já     │
 * │ prova a CADEIA: do portal até o UUID no corpo do POST. Nenhum dos dois toca no que esta fatia   │
 * │ acrescentou, que é INTERAÇÃO: pesquisa, cursor de teclado, pré-seleção, botão primário          │
 * │ desabilitado, devolução de foco e o comportamento em tela estreita.                             │
 * │                                                                                                  │
 * │ E há três propriedades que o inventário de regressão marcou como SEM COBERTURA e de risco alto  │
 * │ (E-recon §4-h/§4-i): o fail-closed de capability não confirmada NO PORTAL (todas as asserções   │
 * │ existentes rodam sobre `/vendas/<variante>/new`), a ausência de família que o usuário não pode   │
 * │ criar, e a proibição de auto-seleção por cardinalidade. UX10, UX11 e UX12 fecham exatamente     │
 * │ esses três buracos — apagar qualquer um deles passaria por todos os outros gates hoje.          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ QUANDO O SERVIDOR É REAL E QUANDO ELE É FABRICADO ────────────────────────────────────────────┐
 * │ REAL (UX1, UX2, UX5, UX6, UX7, UX12, UX14, UX15): tudo o que depende da cadeia inteira — a      │
 * │ TOP cadastrada pela API administrativa, oferecida pela porta OPERACIONAL, e RECONFERIDA pela    │
 * │ rota de destino. Aqui o pedido da URL vira documento porque o servidor concordou.               │
 * │                                                                                                  │
 * │ FABRICADO (UX3, UX4, UX8, UX9, UX10, UX11, UX13): tudo o que depende de um ESTADO EXATO da      │
 * │ resposta — quantas TOPs, qual é o padrão, quantos padrões, qual status de erro. O banco de e2e  │
 * │ é COMPARTILHADO e acumula TOPs de toda a suíte: "exatamente uma linha padrão na janela" não é   │
 * │ afirmável sobre ele. O precedente e o motivo são os mesmos de                                   │
 * │ `portal-vendas-tipo-operacao.spec.ts` ("o servidor continua como está; o que se mede é a        │
 * │ decisão da TELA"). A interceptação vale também para a rota `/new`, então o destino continua      │
 * │ reconferindo a escolha — contra a MESMA lista fabricada, que é o ponto.                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ A REGRA ANTI-VACUIDADE DESTE ARQUIVO ─────────────────────────────────────────────────────────┐
 * │ `toHaveCount(0)` logo depois de abrir uma tela passa DE GRAÇA durante o carregamento: a         │
 * │ pergunta ao servidor ainda não voltou, e a tela ainda não tem nada para mostrar. Então nenhuma  │
 * │ asserção de ausência aqui é escrita sozinha: antes dela vem sempre um sinal que SÓ EXISTE NO    │
 * │ ESTADO FINAL — uma linha de TOP renderizada, a mensagem de bloqueio da família, ou a contagem   │
 * │ anunciada pela região viva (que nasce vazia e só recebe texto 250 ms depois do último render).  │
 * │ Nenhum desses é renderizado incondicionalmente, que é justamente o que desqualifica uma         │
 * │ salvaguarda: `lancador-unificado` e `lancador-busca`, por exemplo, aparecem com a janela aberta │
 * │ independentemente de qualquer resposta, e por isso NUNCA são usados como âncora de ausência.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

const PORTAL = "/vendas";

/** Rótulo humano da família lido do CATÁLOGO, nunca copiado: renomear a copy move tela e teste juntos. */
const rotuloDaFamilia = (familia: string) => {
  const r = ptBR.mensagens[`top.${familia}`];
  if (!r) throw new Error(`família ${familia} sem rótulo no catálogo pt-BR`);
  return r;
};

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * FIXTURE REAL
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */

interface Top { id: string; codigo: string; nome: string; familia: string }

let sequencia = 0;
/**
 * Prefixo 6 para não colidir com o 7 e o 8 que os specs vizinhos já usam no mesmo banco — e sufixo
 * ALEATÓRIO porque o banco de e2e local não é recriado entre execuções. Um sufixo derivado só do
 * relógio repete a cada 100 segundos, e duas rodadas na mesma janela estouram o índice único
 * `ux_tipos_operacao_codigo`. Falha barulhenta, mas atribuída ao teste errado — e é assim que um
 * caso sólido acaba rotulado de instável.
 */
const proximoCodigo = () => `6${Math.floor(Math.random() * 90000 + 10000) + (sequencia++ % 10)}`;

/**
 * Cadastra uma TOP pela API administrativa — o E2E do editor de TOP é `top-configuracao-editor.spec.ts`.
 * Semear por API mantém cada caso medindo UMA coisa: quando a janela erra, a causa é a janela.
 */
async function cadastrarTop(page: Page, familia: string, rotulo: string): Promise<Top> {
  const codigo = proximoCodigo();
  const nome = uniq(rotulo);
  const criado = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", { codigo, codigoBase: familia, nome });
  return { id: criado.id, codigo, nome, familia };
}

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * FIXTURE FABRICADA — o contrato 1, exatamente como o servidor o publica
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */

interface ItemTop { id: string; code: string; name: string; version: number; isDefault: boolean }

/**
 * `isDefault` do item acompanha `defaultId` de propósito: é assim que o servidor responde, e um corpo
 * incoerente mediria a tolerância da tela a lixo — que é assunto de outro spec, já coberto lá.
 */
const item = (id: string, code: string, name: string, ehPadrao = false): ItemTop =>
  ({ id, code, name, version: 1, isDefault: ehPadrao });

const corpoDeTops = (familia: string, itens: ItemTop[], defaultId: string | null = null) =>
  ({ contractVersion: 1, family: { code: familia, label: rotuloDaFamilia(familia) }, defaultId, items: itens });

/** Os três segmentos que o portal pergunta. Enumerar famílias em E2E é legítimo e declarado no gate. */
const SEGMENTOS = ["budgets", "orders", "sales"] as const;
const FAMILIA_DO_SEGMENTO: Record<string, string> = {
  budgets: "vendas.orcamento", orders: "vendas.pedido", sales: "vendas.venda"
};

const rota = (segmento: string) => `**/api/sales/${segmento}/operation-types`;

/** Responde os três `/operation-types` com o corpo dado — inclusive para a rota `/new` do destino. */
async function servirTops(page: Page, porSegmento: Record<string, unknown>) {
  for (const [segmento, corpo] of Object.entries(porSegmento))
    await page.route(rota(segmento), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) }));
}

/** Os três respondem ERRO — o modo em que a lista NÃO é confirmada (API anterior ou servidor quebrado). */
async function recusarTops(page: Page, status: number) {
  for (const segmento of SEGMENTOS)
    await page.route(rota(segmento), (r) => r.fulfill({
      status, contentType: "application/json",
      body: JSON.stringify({ error: { code: status >= 500 ? "INTERNAL_ERROR" : "NOT_FOUND", message: "x" } })
    }));
}

/**
 * O CATÁLOGO FABRICADO, compartilhado pelos casos que precisam de estado exato.
 *
 * Os nomes são escolhidos, não sorteados: "Safra" aparece em UMA operação de CADA família (para o
 * cursor de teclado atravessar famílias), "Balcão" em UMA só (com acento e maiúscula, para a busca
 * provar normalização), e nenhum deles contém a palavra do rótulo da família — senão a busca por
 * nome casaria também pela coluna "Tipo de documento" e o recorte medido seria outro.
 *
 * A palavra "Padrão" também não aparece em nome nenhum: ela é o SELO, e um nome que a contivesse
 * tornaria ambígua qualquer asserção sobre o selo.
 */
const ID = {
  orc1: "11111111-1111-4111-8111-000000000001", orc2: "11111111-1111-4111-8111-000000000002",
  ped1: "22222222-2222-4222-8222-000000000001", ped2: "22222222-2222-4222-8222-000000000002",
  ven1: "33333333-3333-4333-8333-000000000001", ven2: "33333333-3333-4333-8333-000000000002"
};
const ORC1 = item(ID.orc1, "60101", "Proposta Balcão Imediata");
const ORC2 = item(ID.orc2, "60102", "Proposta Safra Antecipada");
const PED1 = item(ID.ped1, "60201", "Encomenda Mensal Regular");
const PED2 = item(ID.ped2, "60202", "Encomenda Safra Antecipada");
const VEN1 = item(ID.ven1, "60301", "Faturamento Direto Imediato");
const VEN2 = item(ID.ven2, "60302", "Faturamento Safra Antecipada");

/** As seis operações, sem nenhum padrão declarado. */
const SEIS_SEM_PADRAO = {
  budgets: corpoDeTops(FAMILIA_DO_SEGMENTO.budgets!, [ORC1, ORC2]),
  orders: corpoDeTops(FAMILIA_DO_SEGMENTO.orders!, [PED1, PED2]),
  sales: corpoDeTops(FAMILIA_DO_SEGMENTO.sales!, [VEN1, VEN2])
};

/* ───────────────────────────────────────────────────────────────────────────────────────────────────
 * LOCALIZADORES E ASSERÇÕES REUTILIZADAS
 * ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const linhaDaTop = (lancador: Locator, id: string) =>
  lancador.locator(`[data-testid="lancador-top"][data-top-id="${id}"]`);
const grupoDaFamilia = (lancador: Locator, familia: string) =>
  lancador.locator(`[data-testid="lancador-grupo"][data-familia="${familia}"]`);
const linhas = (lancador: Locator) => lancador.getByTestId("lancador-top");
const linhaAtiva = (lancador: Locator) => lancador.locator('[data-testid="lancador-top"][data-ativa="true"]');

/** Abre o portal e a janela. Só devolve quando a janela está na tela. */
async function abrirLancador(page: Page): Promise<Locator> {
  await page.goto(PORTAL);
  await expect(page.getByRole("heading", { name: "Vendas" }), "premissa: o portal montou").toBeVisible();
  await page.getByTestId("vendas-novo").click();
  const lancador = page.getByTestId("lancador-unificado");
  await expect(lancador, "o `+ Novo` abre a janela de lançamento").toBeVisible();
  return lancador;
}

/**
 * A CONTAGEM ANUNCIADA — e por que ela serve de âncora de estado assentado.
 *
 * A região viva nasce VAZIA e só recebe texto 250 ms depois do último render. Afirmar o texto dela é,
 * portanto, afirmar que a tela parou de mudar — o oposto de um elemento renderizado
 * incondicionalmente. O texto vem do DONO (`textoDeContagem`) em vez de copiado, mas a PREMISSA do
 * próprio texto é conferida antes: um `textoDeContagem` que passasse a devolver "" transformaria a
 * asserção seguinte em `toHaveText("")`, que qualquer elemento vazio satisfaz.
 */
async function esperarContagem(page: Page, total: number) {
  const esperado = textoDeContagem(total);
  if (total > 0) expect(esperado, "premissa: a contagem CITA o número — sem isso a asserção seria vazia").toContain(String(total));
  else expect(esperado.length, "premissa: o vazio também é anunciado com texto").toBeGreaterThan(0);
  await expect(page.getByTestId("lancador-contagem"), `a região viva anuncia o recorte de ${total}`).toHaveText(esperado);
}

/**
 * O formulário de documento NÃO está na árvore — não "está desabilitado".
 *
 * `top-contexto` e o botão Salvar são os dois sinais que SÓ existem depois da navegação para
 * `/vendas/<seg>/new`. Não se afirma aqui a ausência de `select-tipo-operacao`: esse campo vive
 * apenas na tela de DETALHE de documento, então a contagem seria 0 no portal, 0 no lançador e 0 no
 * formulário de criação — verdadeira sob qualquer regressão, e portanto prova de nada.
 */
async function semFormularioDeDocumento(page: Page) {
  await expect(page.getByTestId("top-contexto"), "o formulário de documento NÃO pode ter montado").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar" }), "não existe Salvar fora do formulário").toHaveCount(0);
}

/** ZERO POST é o que mede a perda silenciosa; a mensagem na tela é consequência, não prova. */
const vigiarNavegacoes = (page: Page) => {
  const idas: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) idas.push(f.url()); });
  return idas;
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX1 — ABRIR: a janela aparece, o formulário NÃO, e o foco já está onde se digita
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX1 — `+ Novo` abre a janela com o foco na pesquisa, e o formulário de documento não está na árvore", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.venda", "Faturamento UX1");

  const lancador = await abrirLancador(page);
  await expect(page.getByTestId("vendas-novo"), "o gatilho declara que abriu").toHaveAttribute("aria-expanded", "true");

  /**
   * A ÂNCORA. A linha da TOP semeada só existe depois de `/operation-types` responder e a resposta
   * passar pela conferência de contrato. Enquanto ela não aparece, TUDO está ausente — inclusive o
   * formulário —, e as três asserções de ausência abaixo passariam sem provar nada.
   */
  await expect(linhaDaTop(lancador, top.id), "premissa: a janela já recebeu a lista do servidor").toHaveCount(1);
  await semFormularioDeDocumento(page);

  // O FOCO INICIAL É O CAMPO, sempre — digitar é a ação mais provável, e o padrão custa uma tecla.
  await expect(page.getByTestId("lancador-busca"), "quem abre a janela já pode digitar").toBeFocused();
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX2 — LISTA MISTA: as três famílias na mesma janela, cada linha dizendo o que decide
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX2 — duas operações de cada família aparecem com código, nome e tipo — e nenhum UUID como rótulo", async ({ page }) => {
  await login(page);
  // O nome carrega um índice próprio: duas TOPs criadas no MESMO milissegundo receberiam o mesmo
  // sufixo de `uniq`, e um nome repetido tornaria ambígua a asserção de "esta linha é a minha".
  const tops: Top[] = [];
  for (const familia of ["vendas.orcamento", "vendas.pedido", "vendas.venda"])
    for (const n of [1, 2]) tops.push(await cadastrarTop(page, familia, `Operação UX2 ${tops.length + 1} (${n})`));

  const lancador = await abrirLancador(page);

  for (const top of tops) {
    // A LINHA MORA NO GRUPO DA FAMÍLIA DELA (contrato de ancestralidade do E15, preservado).
    const linha = grupoDaFamilia(lancador, top.familia).locator(`[data-testid="lancador-top"][data-top-id="${top.id}"]`);
    await expect(linha, `a operação ${top.codigo} está no grupo de ${top.familia}`).toHaveCount(1);
    // AS TRÊS COLUNAS QUE DECIDEM A ESCOLHA, na MESMA linha — e não num cabeçalho que rola para fora.
    await expect(linha, "a linha traz o código").toContainText(top.codigo);
    await expect(linha, "a linha traz o nome da operação").toContainText(top.nome);
    await expect(linha, "e o tipo de documento em que ela cai, com o rótulo HUMANO")
      .toContainText(rotuloDaFamilia(top.familia));
  }

  // O CABEÇALHO DE COLUNAS existe em tela larga — é o par do teste de tela estreita (UX15).
  await expect(lancador.getByText("Código", { exact: true }), "a grade é nomeada em tela larga").toBeVisible();

  /**
   * NENHUM UUID VISÍVEL. O UUID é endereço técnico; o localizador humano é o CÓDIGO (`CLAUDE.md` ›
   * Dados). A premissa vem antes da conclusão: uma janela vazia não tem UUID nenhum e satisfaria a
   * asserção de graça, então primeiro se afirma que os seis códigos estão escritos ali.
   */
  const texto = await lancador.innerText();
  for (const top of tops) expect(texto, `o código ${top.codigo} está escrito na janela`).toContain(top.codigo);
  expect(texto, "nenhum UUID vaza como rótulo de tela")
    .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX3 / UX4 — A PESQUISA: por código e por nome, e o que ela NÃO pode esconder
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX3 — a pesquisa por CÓDIGO recorta a janela para exatamente a operação daquele código", async ({ page }) => {
  await login(page);
  await servirTops(page, SEIS_SEM_PADRAO);
  const lancador = await abrirLancador(page);

  // PREMISSA: a janela está CHEIA. Sem isto, "sobrou uma linha" seria indistinguível de "só havia uma".
  await expect(linhas(lancador), "premissa: as seis operações estão na janela").toHaveCount(6);
  await esperarContagem(page, 6);

  await page.getByTestId("lancador-busca").fill(VEN2.code);

  await expect(linhas(lancador), "o recorte é exato: uma linha").toHaveCount(1);
  await expect(linhaDaTop(lancador, VEN2.id), "e é a operação daquele código").toHaveCount(1);
  await esperarContagem(page, 1);
});

test("UX4 — a pesquisa por NOME aceita fragmento sem acento e sem caixa, e NÃO esconde o bloqueio da família", async ({ page }) => {
  await login(page);
  /**
   * A família de VENDA responde lista vazia: o contrato 1 com `items: []` é o servidor CERTO dizendo
   * que ninguém cadastrou TOP. Ela entra aqui porque o aviso de fail-closed dela é o que o teste
   * precisa ver SOBREVIVER à pesquisa — um aviso que some porque o usuário digitou três letras vira
   * "sumiu a família" em vez de "a família está bloqueada".
   */
  await servirTops(page, {
    budgets: corpoDeTops(FAMILIA_DO_SEGMENTO.budgets!, [ORC1, ORC2]),
    orders: corpoDeTops(FAMILIA_DO_SEGMENTO.orders!, [PED1, PED2]),
    sales: corpoDeTops(FAMILIA_DO_SEGMENTO.sales!, [])
  });
  const lancador = await abrirLancador(page);

  await expect(linhas(lancador), "premissa: quatro operações lançáveis").toHaveCount(4);
  await expect(lancador.getByTestId("top-ausente"), "premissa: a família sem TOP publica o bloqueio dela").toHaveCount(1);

  // "balcao": minúscula e SEM acento, contra um nome que tem "Balcão". É a normalização que está sob teste.
  await page.getByTestId("lancador-busca").fill("balcao");

  await expect(linhas(lancador), "o fragmento recorta para uma linha").toHaveCount(1);
  await expect(linhaDaTop(lancador, ORC1.id), "e é a operação cujo nome contém o fragmento").toHaveCount(1);
  await esperarContagem(page, 1);
  await expect(lancador.getByTestId("top-ausente"), "o bloqueio da família continua dito, mesmo com pesquisa ativa").toHaveCount(1);

  // E O RECORTE É REVERSÍVEL pelo botão que a janela oferece.
  await lancador.getByTestId("lancador-limpar-busca").click();
  await expect(linhas(lancador), "limpar a pesquisa devolve a lista inteira").toHaveCount(4);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX5 / UX6 / UX7 — A ESCOLHA DECIDE A PORTA, e a porta é a da família da operação
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * O E15 já prova este caminho para o ORÇAMENTO. O que falta — e é onde o defeito se esconderia — são
 * as outras duas portas e a confirmação do DESTINO: a rota `/new` reconfere o id contra a lista que o
 * servidor devolve para AQUELA variante, então abrir a porta errada com a operação certa daria
 * "operação indisponível" a um operador que não fez nada de errado.
 *
 * Em cada caso são semeadas DUAS operações da família e escolhida a SEGUNDA: com uma só, uma janela
 * que ignorasse a escolha e lançasse sempre a primeira linha do grupo passaria no teste.
 */
for (const caso of [
  { nome: "UX5", familia: "vendas.orcamento", segmento: "budgets" },
  { nome: "UX6", familia: "vendas.pedido", segmento: "orders" },
  { nome: "UX7", familia: "vendas.venda", segmento: "sales" }
]) {
  test(`${caso.nome} — escolher uma operação de ${caso.familia} abre /vendas/${caso.segmento}/new com a operação escolhida`, async ({ page }) => {
    await login(page);
    const primeira = await cadastrarTop(page, caso.familia, `Operação ${caso.nome} A`);
    const escolhida = await cadastrarTop(page, caso.familia, `Operação ${caso.nome} B`);

    const lancador = await abrirLancador(page);
    await expect(linhaDaTop(lancador, primeira.id), "premissa: as duas da família estão na janela").toHaveCount(1);
    await linhaDaTop(lancador, escolhida.id).click();

    // A URL É O PEDIDO: porta da família da operação, parâmetro `tipo_operacao_id`, UUID da escolhida.
    await expect(page, "a porta é a da família da operação escolhida")
      .toHaveURL(new RegExp(`/vendas/${caso.segmento}/new\\?tipo_operacao_id=${escolhida.id}`));
    // E O CONTEXTO É A RESPOSTA: o formulário só monta porque o SERVIDOR reconfirmou aquele id.
    await expect(page.getByTestId("top-contexto"), "o formulário abre contextualizado na operação escolhida")
      .toContainText(escolhida.nome);
    await expect(page.getByTestId("top-contexto"), "e não na outra operação da mesma família")
      .not.toContainText(primeira.nome);
    // A JANELA FECHOU: o usuário não volta à pergunta que acabou de responder.
    // O PORTAL SAIU DE CENA — e é só isso que esta linha mede. A janela some porque a ROTA trocou e
    // a página do portal desmontou junto com ela, não porque alguém chamou `setAberto(false)`.
    // Afirmar "fechou antes de navegar" aqui seria descrever uma ordem temporal que, de fora e sem
    // segurar a navegação, é inobservável.
    await expect(page.getByTestId("lancador-unificado"), "o portal saiu de cena com a navegação").toHaveCount(0);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX8 / UX9 / UX10 — O PADRÃO: quando ele adianta, quando ele não existe, e o que cardinalidade NÃO faz
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX8 — com UM padrão declarado a linha nasce selecionada, NÃO navega sozinha, e só lança quando o usuário confirma", async ({ page }) => {
  await login(page);
  /**
   * UM padrão na janela inteira, e só um. `defaultId` é declarado POR FAMÍLIA e esta janela mistura as
   * três, então a pré-seleção só acontece quando existe exatamente UM padrão no total — as outras duas
   * famílias entram aqui com operações SEM padrão, que é o cenário em que a regra é verificável.
   */
  await servirTops(page, {
    budgets: corpoDeTops(FAMILIA_DO_SEGMENTO.budgets!, [ORC1, item(ORC2.id, ORC2.code, ORC2.name, true)], ORC2.id),
    orders: corpoDeTops(FAMILIA_DO_SEGMENTO.orders!, [PED1, PED2]),
    sales: corpoDeTops(FAMILIA_DO_SEGMENTO.sales!, [VEN1, VEN2])
  });
  const lancador = await abrirLancador(page);

  await expect(linhas(lancador), "premissa: as seis operações estão na janela").toHaveCount(6);
  await expect(linhaDaTop(lancador, ORC2.id), "a operação padrão nasce ATIVA").toHaveAttribute("data-ativa", "true");
  await expect(linhaDaTop(lancador, ORC2.id), "e anunciada como selecionada").toHaveAttribute("aria-selected", "true");
  await expect(linhaAtiva(lancador), "exatamente UMA linha ativa — pré-seleção não é seleção múltipla").toHaveCount(1);
  // O SELO DESCREVE O CADASTRO: ele está na linha que o servidor marcou.
  await expect(linhaDaTop(lancador, ORC2.id), "o selo de padrão acompanha o cadastro").toContainText("Padrão");
  await expect(page.getByTestId("lancador-lancar"), "com linha ativa, a ação primária está habilitada").toBeEnabled();

  /**
   * PRÉ-SELECIONAR NÃO É AVANÇAR. A âncora desta ausência é a contagem anunciada: ela só recebe texto
   * 250 ms depois do último render, então quando ela fala já houve tempo de sobra para uma navegação
   * automática acontecer — e a janela continua aberta, na mesma URL, sem formulário.
   */
  await esperarContagem(page, 6);
  await expect(page, "a janela não navegou sozinha").toHaveURL(/\/vendas(\?|$)/);
  await expect(lancador, "e continua aberta, esperando a confirmação").toBeVisible();
  await semFormularioDeDocumento(page);

  // SÓ AGORA, e pelo caminho explícito do rodapé.
  await page.getByTestId("lancador-lancar").click();
  await expect(page).toHaveURL(new RegExp(`/vendas/budgets/new\\?tipo_operacao_id=${ORC2.id}`));
  await expect(page.getByTestId("top-contexto"), "e o documento abre na operação padrão").toContainText(ORC2.name);
});

test("UX9 — sem padrão declarado NENHUMA linha nasce ativa, `Lançar` fica desabilitado e Enter é no-op", async ({ page }) => {
  await login(page);
  await servirTops(page, SEIS_SEM_PADRAO);
  const lancador = await abrirLancador(page);

  await expect(linhas(lancador), "premissa: seis operações, todas sem padrão declarado").toHaveCount(6);
  await esperarContagem(page, 6);

  /**
   * NENHUMA LINHA ATIVA — e, em particular, NÃO a primeira. Cair na primeira linha seria atribuir por
   * POSIÇÃO uma preferência que ninguém cadastrou, e deixaria o lançamento a uma tecla de distância.
   */
  await expect(linhaAtiva(lancador), "nada é escolhido pelo usuário, nada fica ativo").toHaveCount(0);
  await expect(lancador.locator('[data-testid="lancador-top"][data-padrao="true"]'), "e nenhuma linha se diz padrão").toHaveCount(0);
  await expect(page.getByTestId("lancador-lancar"), "a ação primária fica visivelmente desabilitada").toBeDisabled();

  // ENTER SEM LINHA ATIVA É NO-OP DECLARADO: não fecha, não lança, não "tenta a primeira".
  await page.getByTestId("lancador-busca").press("Enter");
  await expect(lancador, "a janela continua aberta").toBeVisible();
  await expect(page, "e nenhuma navegação aconteceu").toHaveURL(/\/vendas(\?|$)/);
  await semFormularioDeDocumento(page);
});

test("UX10 — operação ÚNICA e sem padrão: não se auto-seleciona, não se auto-lança, e só o clique lança", async ({ page }) => {
  await login(page);
  /**
   * UMA operação na janela inteira — o cenário exato do bloqueador de PR anterior: `items.length === 1`
   * NÃO é padrão e cardinalidade não decide pelo usuário. As outras duas famílias respondem lista vazia
   * (contrato 1 legítimo), e é por isso que sobra uma linha só.
   */
  await servirTops(page, {
    budgets: corpoDeTops(FAMILIA_DO_SEGMENTO.budgets!, [ORC1]),
    orders: corpoDeTops(FAMILIA_DO_SEGMENTO.orders!, []),
    sales: corpoDeTops(FAMILIA_DO_SEGMENTO.sales!, [])
  });
  const lancador = await abrirLancador(page);

  await expect(linhas(lancador), "premissa: existe UMA operação lançável").toHaveCount(1);
  await expect(lancador.getByTestId("top-ausente"), "premissa: as outras duas famílias já responderam, e não têm TOP").toHaveCount(2);
  await esperarContagem(page, 1);

  await expect(linhaDaTop(lancador, ORC1.id), "a única operação NÃO fica ativa por ser a única").toHaveAttribute("data-ativa", "false");
  await expect(linhaDaTop(lancador, ORC1.id), "e não é padrão, porque o servidor não declarou padrão").toHaveAttribute("data-padrao", "false");
  await expect(page.getByTestId("lancador-lancar"), "`Lançar` fica desabilitado até o usuário escolher").toBeDisabled();
  await expect(page, "e nada foi lançado sozinho").toHaveURL(/\/vendas(\?|$)/);
  await semFormularioDeDocumento(page);

  // O CLIQUE — ato explícito — é o que lança.
  await linhaDaTop(lancador, ORC1.id).click();
  await expect(page).toHaveURL(new RegExp(`/vendas/budgets/new\\?tipo_operacao_id=${ORC1.id}`));
  await expect(page.getByTestId("top-contexto")).toContainText(ORC1.name);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX11 — CAPABILITY NÃO CONFIRMADA: a janela bloqueia, e não vira atalho para o formulário
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX11 — com a lista NÃO confirmada pelo servidor, a janela não oferece operação nenhuma e nada é escrito", async ({ page }) => {
  await login(page);
  /**
   * 500 é o que a API ANTERIOR devolve nesta rota (medido em `skew-api-producao.spec.ts`: sem rota
   * estática, o caminho cai no nó `:id` e o Postgres recusa a string na coluna `uuid`). Aqui o servidor
   * é fabricado, então o que se mede é a decisão da TELA — a prova contra binário real continua lá.
   *
   * ESTE É O BURACO QUE O INVENTÁRIO APONTOU: todas as asserções de bloqueio existentes rodam sobre
   * `/vendas/<variante>/new`. No PORTAL, trocar `podeLancar` por "tem items?" não reprovaria gate nenhum.
   */
  await recusarTops(page, 500);
  const idas = vigiarNavegacoes(page);
  const lancador = await abrirLancador(page);

  /**
   * A ÂNCORA. A mensagem de bloqueio só existe DEPOIS de a resposta chegar e ser julgada: enquanto a
   * consulta está em voo, a família mostra carregamento e não há mensagem nenhuma. É ela que separa
   * "a janela bloqueou" de "a janela ainda não recebeu resposta" — e é por isso que nenhuma das
   * ausências abaixo é medida antes dela.
   */
  await expect(lancador.getByTestId("top-nao-confirmado"), "as três famílias publicam o bloqueio único").toHaveCount(3);
  // E A MENSAGEM NÃO MANDA CADASTRAR: o problema é o servidor, e cadastrar TOP não resolveria.
  await expect(lancador.getByTestId("top-ausente"), "não pedir configuração quando o problema é o servidor").toHaveCount(0);

  await expect(linhas(lancador), "NENHUMA operação é oferecida — fail-closed").toHaveCount(0);
  await expect(page.getByTestId("lancador-lancar"), "e a ação primária não tem o que lançar").toBeDisabled();

  // ENTER também não é uma porta dos fundos.
  await page.getByTestId("lancador-busca").press("Enter");
  /**
   * O SINAL POSITIVO ANTES DAS AUSÊNCIAS. `toHaveURL` e `toHaveCount(0)` passam no PRIMEIRO poll
   * bem-sucedido: um `router.push` disparado pelo Enter mudaria a URL alguns milissegundos depois, e
   * as asserções já teriam passado — ausência satisfeita por ATRASO, não por regra. Exigir que o
   * campo ainda esteja vivo e com foco, e que uma tecla seguinte ainda seja processada pela janela,
   * força um ciclo de renderização e prova que a janela continua no comando.
   */
  await expect(page.getByTestId("lancador-busca"), "a janela continua viva e com o foco").toBeFocused();
  await page.getByTestId("lancador-busca").press("ArrowDown");
  await expect(linhas(lancador), "e seguir navegando não materializa operação nenhuma").toHaveCount(0);

  await expect(page, "zero navegação").toHaveURL(/\/vendas(\?|$)/);
  await semFormularioDeDocumento(page);
  // ZERO NAVEGAÇÃO, e não "zero POST": a regressão que este caso mira (Enter virar porta dos fundos)
  // produziria uma IDA para `/vendas/<seg>/new`, que é GET. Vigiar POST daria `[]` sob a regressão e
  // sob o comportamento correto — asserção sem estado em que falhe. Quem prova que não se grava
  // documento sem TOP é o servidor, e isso vive nos specs de TOP-CONFIG-02.
  expect(idas.filter((u) => /\/vendas\/[^/]+\/new/.test(u)),
    "nenhuma ida ao formulário de criação").toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX12 — PERMISSÃO PARCIAL: a família que o usuário não pode criar não aparece — nem é perguntada
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX12 — sem `orders.create`, nenhuma operação de PEDIDO aparece, e a família nem chega a ser perguntada", async ({ page }) => {
  await login(page);
  // AS TRÊS EXISTEM NO CADASTRO. É isso que torna a ausência do pedido uma decisão de PERMISSÃO, e não
  // falta de dado — sem esta linha, o teste passaria num banco que simplesmente não tem TOP de pedido.
  const orcamento = await cadastrarTop(page, "vendas.orcamento", "Proposta UX12");
  const pedido = await cadastrarTop(page, "vendas.pedido", "Encomenda UX12");
  const venda = await cadastrarTop(page, "vendas.venda", "Faturamento UX12");

  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", {
    name: uniq("Vendedor sem pedido UX12"),
    // `orders.view` SEM `orders.create` — e esta é a linha que dá poder ao teste.
    // Sem ela, o papel não teria NENHUMA permissão de pedido, e a regressão mais plausível
    // (trocar `can(`${perm}.create`)` por `can(`${perm}.view`)`, que é a expressão usada logo ao
    // lado nos chips do filtro) manteria este caso VERDE: a família continuaria ausente pelo
    // motivo errado. Com a leitura permitida e a criação proibida, o lançador só fica vazio de
    // pedidos se ele de fato gatilhar em `.create`.
    permissions: ["budgets.view", "budgets.create", "sales.view", "sales.create", "orders.view", "people.view", "products.view", "warehouses.view"]
  });
  const vendedor = { email: `e2e-ux12-${Date.now()}@demo.local`, password: "Vendedor@12345" };
  await api(page, "POST", "/api/admin/members", {
    name: "Vendedor UX12", email: vendedor.email, password: vendedor.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "vendas", modo: "todas", empresas: [] }]
  });

  await logout(page);
  await login(page, vendedor);

  const perguntas: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/operation-types")) perguntas.push(r.url()); });

  const lancador = await abrirLancador(page);

  // PREMISSA: o que ele PODE criar está lá, com as operações que o servidor devolveu.
  await expect(linhaDaTop(lancador, orcamento.id), "premissa: a família que ele pode criar responde").toHaveCount(1);
  await expect(linhaDaTop(lancador, venda.id), "premissa: e a outra também").toHaveCount(1);

  // CONCLUSÃO: a família proibida não tem grupo, não tem linha, e não foi nem perguntada.
  await expect(grupoDaFamilia(lancador, "vendas.pedido"), "a família que ele não pode criar não tem grupo").toHaveCount(0);
  await expect(linhaDaTop(lancador, pedido.id), "e a operação de pedido que EXISTE não é oferecida").toHaveCount(0);
  expect(perguntas.some((u) => u.includes("/api/sales/budgets/operation-types")),
    "premissa: a tela perguntou pelas famílias que ele pode criar — senão 'não perguntou por pedidos' seria vazio").toBe(true);
  expect(perguntas.filter((u) => u.includes("/api/sales/orders/operation-types")),
    "sem a capacidade, a porta operacional nem é chamada").toEqual([]);
  // E A SEPARAÇÃO ENTRE LER E CRIAR, MEDIDA NA MESMA TELA: ele VÊ pedidos (o chip do filtro está
  // lá, porque depende de `orders.view`) e NÃO os lança (o grupo do lançador não está, porque
  // depende de `orders.create`). Uma única tela provando que as duas capacidades são distintas.
  await expect(page.getByTestId("vendas-tipo"), "premissa viva: ele PODE LER pedidos — o chip do filtro existe")
    .toContainText("Pedido");
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX13 — TECLADO: digitar, mover o cursor e lançar sem tirar a mão do teclado
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX13 — pesquisa, setas e Enter lançam a operação ATIVA (a segunda do recorte, não a primeira)", async ({ page }) => {
  await login(page);
  await servirTops(page, SEIS_SEM_PADRAO);
  const lancador = await abrirLancador(page);
  await expect(linhas(lancador), "premissa: seis operações").toHaveCount(6);

  /**
   * "Safra" está em UMA operação de CADA família, e o recorte sai na ordem do registry — orçamento,
   * pedido, venda. Então a SEGUNDA linha do recorte é de outra família que a primeira: a asserção
   * final mede, de uma vez, que o Enter lança a linha ATIVA e que a porta sai da família DELA.
   */
  await page.getByTestId("lancador-busca").fill("safra");
  await expect(linhas(lancador), "o recorte tem três linhas, uma de cada família").toHaveCount(3);
  await esperarContagem(page, 3);
  await expect(linhaAtiva(lancador), "sem padrão declarado, o recorte começa sem linha ativa").toHaveCount(0);

  // O FOCO NUNCA SAI DO CAMPO: quem anda é o cursor virtual, e as setas são lidas pelo próprio campo.
  const campo = page.getByTestId("lancador-busca");
  await campo.press("ArrowDown");
  await expect(linhaDaTop(lancador, ORC2.id), "a primeira seta entra pela primeira linha do recorte").toHaveAttribute("data-ativa", "true");
  await campo.press("ArrowDown");
  await expect(campo, "o foco do DOM continua no campo — a lista é UM tabstop").toBeFocused();
  await expect(linhaDaTop(lancador, PED2.id), "a segunda seta avança para a segunda linha").toHaveAttribute("data-ativa", "true");
  await expect(linhaDaTop(lancador, ORC2.id), "e a primeira deixa de estar ativa").toHaveAttribute("data-ativa", "false");
  // O PONTEIRO PRECISA APONTAR A LINHA CERTA. `/.+/` seria satisfeito por um ponteiro para a
  // linha ERRADA — exatamente o defeito que este caso escolheu a SEGUNDA linha para pegar, e a
  // única asserção do arquivo sobre o que o leitor de tela anuncia.
  await expect(campo, "e o leitor de tela acompanha o cursor virtual")
    .toHaveAttribute("aria-activedescendant", new RegExp(`${PED2.id}$`));

  /**
   * ESCOLHE-SE A SEGUNDA, de propósito. Com a primeira, uma janela que ignorasse o cursor e lançasse
   * sempre o primeiro item do recorte passaria — e o defeito só apareceria em produção.
   */
  await campo.press("Enter");
  await expect(page, "o Enter lança a linha ATIVA, na porta da família dela")
    .toHaveURL(new RegExp(`/vendas/orders/new\\?tipo_operacao_id=${PED2.id}`));
  await expect(page.getByTestId("top-contexto"), "e o formulário abre naquela operação").toContainText(PED2.name);
  await expect(page.getByTestId("lancador-unificado"), "o portal saiu de cena com a navegação").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX14 — ESC fecha e DEVOLVE O FOCO ao `+ Novo`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("UX14 — ESC fecha a janela mesmo com pesquisa digitada, e o foco volta para o `+ Novo`", async ({ page }) => {
  await login(page);
  const top = await cadastrarTop(page, "vendas.orcamento", "Proposta UX14");

  const lancador = await abrirLancador(page);
  await expect(linhaDaTop(lancador, top.id), "premissa: a janela recebeu a lista e está em uso").toHaveCount(1);
  await expect(page.getByTestId("lancador-busca"), "premissa: o foco está DENTRO da janela").toBeFocused();

  /**
   * COM TEXTO DIGITADO. "Primeiro ESC limpa, segundo fecha" seria uma exceção local numa convenção que
   * vale no produto inteiro — e o campo já tem um botão Limpar. Este é o caso difícil: o campo tem
   * conteúdo, e mesmo assim quem responde ao ESC é o overlay.
   */
  await page.getByTestId("lancador-busca").fill("proposta");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("lancador-unificado"), "a janela fechou ao primeiro ESC").toHaveCount(0);
  await expect(page.getByTestId("vendas-novo"), "e o foco voltou para quem abriu — não para o corpo da página").toBeFocused();
  await expect(page.getByTestId("vendas-novo"), "o gatilho declara que fechou").toHaveAttribute("aria-expanded", "false");
  await expect(page, "fechar não navega").toHaveURL(/\/vendas(\?|$)/);

  // E REABRIR COMEÇA LIMPO: a pesquisa da vez anterior não sobrevive.
  await page.getByTestId("vendas-novo").click();
  await expect(page.getByTestId("lancador-busca"), "a janela reabre com a pesquisa vazia").toHaveValue("");
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * UX15 — TELA ESTREITA: a janela continua utilizável, e a grade vira pilha
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ETIQUETA `@mobile` — DÍVIDA DECLARADA, NÃO TESTE DESLIGADO.
 *
 * Mobile está DEFERRED em `docs/UI-SUPPORT-MATRIX.md`: o produto decidiu não entregar este formato
 * nesta fase. Por isso a suíte obrigatória (`pnpm e2e`) exclui esta etiqueta e `pnpm e2e:mobile` a
 * executa sozinha, podendo ficar VERMELHA.
 *
 * O que NÃO foi feito, de propósito: nada de `.skip`, nada de `.fixme`, nenhuma asserção afrouxada,
 * nenhum `force: true`, nenhum timeout inflado. O teste continua reproduzindo o defeito de verdade —
 * é ele a evidência viva de que a dívida existe, e `scripts/ui-support-matrix-audit.mjs` reprova quem
 * o apagar, pular ou afrouxar. Teste apagado deixa de ser dívida e vira esquecimento.
 */
test.describe("UX15 — celular", { tag: "@mobile" }, () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("UX15 — em tela estreita a janela cabe, sem rolagem horizontal, e lança até o fim", async ({ page }) => {
    await login(page);
    const top = await cadastrarTop(page, "vendas.venda", "Faturamento UX15");

    const lancador = await abrirLancador(page);
    await expect(linhaDaTop(lancador, top.id), "premissa: a janela recebeu a lista").toHaveCount(1);

    /**
     * A GRADE VIRA PILHA. Afirmar a presença do cabeçalho E a invisibilidade dele é o que prova que o
     * caminho estreito foi REALMENTE percorrido: `toBeHidden()` sozinho é satisfeito por um elemento
     * que não existe, e passaria também se o cabeçalho tivesse sido apagado de toda a janela.
     */
    const cabecalho = lancador.getByText("Código", { exact: true });
    await expect(cabecalho, "o cabeçalho de colunas existe na árvore").toHaveCount(1);
    await expect(cabecalho, "mas não é desenhado em tela estreita — não há colunas para nomear").toBeHidden();

    // OS TRÊS CONTROLES QUE O FLUXO EXIGE continuam alcançáveis: pesquisar, ver a operação, lançar.
    await expect(page.getByTestId("lancador-busca")).toBeVisible();
    await expect(linhaDaTop(lancador, top.id)).toBeVisible();
    await expect(page.getByTestId("lancador-lancar"), "o rodapé é fixo: a ação primária não fica fora de alcance").toBeVisible();

    /**
     * SEM ROLAGEM HORIZONTAL — medida onde ela de fato aconteceria.
     *
     * Medir só a janela não serviria: o corpo do diálogo tem `overflow: auto`, então um conteúdo largo
     * demais rolaria DENTRO dele sem alterar em nada o tamanho da janela. Então a varredura é pelos
     * elementos que PODEM rolar (`overflow-x` auto ou scroll) mais a própria janela. Elementos com
     * `overflow: hidden` ficam de fora de propósito: é assim que a reticência de texto funciona, e
     * incluí-los acusaria truncamento — que é o comportamento desejado — como transbordo.
     */
    const transbordo = await lancador.evaluate((raiz) => {
      let pior = 0;
      for (const el of [raiz, ...raiz.querySelectorAll<HTMLElement>("*")]) {
        const ox = getComputedStyle(el).overflowX;
        if (el !== raiz && ox !== "auto" && ox !== "scroll") continue;
        pior = Math.max(pior, el.scrollWidth - el.clientWidth);
      }
      return pior;
    });
    expect(transbordo, "nada dentro da janela rola para o lado no celular").toBeLessThanOrEqual(1);

    // E A JANELA CABE NA TELA: nenhuma borda dela fica fora da viewport de 390px.
    const caixa = await lancador.boundingBox();
    expect(caixa, "premissa: a janela está desenhada e tem caixa medível").not.toBeNull();
    expect(caixa!.x, "a janela não começa fora da tela").toBeGreaterThanOrEqual(0);
    expect(caixa!.x + caixa!.width, "e não termina fora dela").toBeLessThanOrEqual(391);

    // E O FLUXO FECHA: no celular também se lança.
    await linhaDaTop(lancador, top.id).click();
    await expect(page).toHaveURL(new RegExp(`/vendas/sales/new\\?tipo_operacao_id=${top.id}`));
    await expect(page.getByTestId("top-contexto")).toContainText(top.nome);
  });
});
