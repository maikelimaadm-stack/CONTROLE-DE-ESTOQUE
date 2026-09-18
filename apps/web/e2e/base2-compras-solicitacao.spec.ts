import { test, expect, type Page } from "@playwright/test";
import { login, api, empresaAtiva, primeiroId } from "./helpers";
import { ptBR } from "@erp/plataforma";
import { PURCHASE_STATUS_LABELS, ENUM_LABELS } from "@agro/domain";

/**
 * BASE2-03A — SOLICITAÇÃO DE COMPRA NO MODELO BASE 2.
 *
 * Primeira entidade de MÓDULO migrada para a moldura (o piloto da BASE2-01 era estoque). O que estes
 * testes existem para separar é a promessa central da fatia: **tela unificada ≠ regra unificada**. Metade
 * deles prova que a composição virou Base 2; a outra metade prova que o PROCESSO de compra continua
 * inteiro — cotação, aprovação, pedido, comentário, linha do tempo, permissão e a máquina de estados.
 *
 * As fixtures nascem pela API REAL, com a mesma porta que o usuário usa. Nenhum teste aqui passa com a
 * tela vazia: todos exigem uma solicitação criada no próprio teste.
 */

/** Rótulo da TOP lido do CATÁLOGO, nunca copiado: renomear a copy move tela e teste juntos. */
const rotuloTop = (codigo: string) => {
  const r = ptBR.mensagens[`top.${codigo}`];
  if (!r) throw new Error(`catálogo sem rótulo para top.${codigo}`);
  return r;
};
const CAMPO_TOP = `[data-testid="base2-field"][data-campo="${ptBR.mensagens["termos.tipo_operacao"]}"]`;
const campo = (label: string) => `[data-testid="base2-field"][data-campo="${label}"]`;

interface Solicitacao { id: string; code: string; descricao: string }

/**
 * Cria uma solicitação de compra com DOIS itens, pela API oficial.
 *
 * Dois, e não um: a contagem da seção precisa poder estar errada para o teste significar alguma coisa.
 * Com um item só, "1" passaria tanto lendo `items.length` quanto qualquer engano que devolvesse o
 * primeiro elemento.
 */
async function criarSolicitacao(page: Page): Promise<Solicitacao> {
  const empresaId = await empresaAtiva(page);
  const produto = await primeiroId(page, "/api/resources/products?pageSize=1");
  const descricao = `Solicitação BASE2-03A ${Date.now().toString(36)}`;
  const r = await api<{ id: string }>(page, "POST", "/api/supply/requests", {
    empresa_id: empresaId, request_date: "2026-09-18", priority: "high", request_type: "product",
    description: descricao, justification: "Prova automatizada da BASE2-03A", observation: "Observação da prova",
    items: [
      { product_id: produto, description: "Item um da prova", quantity: "3", reference_value: "10.00" },
      { description: "Item dois da prova", quantity: "2", reference_value: "25.00" }
    ]
  });
  const doc = await api<{ code: string }>(page, "GET", `/api/supply/requests/${r.id}`);
  return { id: r.id, code: doc.code, descricao };
}

/** Abre o detalhe e espera a moldura. Falha aqui = a tela não está no Base 2. */
async function abrir(page: Page, s: Solicitacao) {
  await page.goto(`/suprimentos/view/${s.id}`);
  await expect(page.getByTestId("base2-shell"), "o detalhe precisa estar no Base2Shell").toBeVisible();
}

test("BASE2-03A: identidade, TOP, dados principais e itens no Modelo Base 2", async ({ page }) => {
  await login(page);
  const s = await criarSolicitacao(page);
  await abrir(page, s);

  // (1) (2) identidade: nome do lançamento + CÓDIGO REAL do registro no título
  await expect(page.getByRole("heading", { name: `Solicitação de compra ${s.code}` })).toBeVisible();

  // (3) empresa DO REGISTRO no cabeçalho — não a empresa selecionada no contexto
  const empresa = page.getByTestId("base2-empresa");
  await expect(empresa).toBeVisible();
  const empresaDoRegistro = await api<{ empresa_name: string }>(page, "GET", `/api/supply/requests/${s.id}`);
  await expect(empresa).toContainText(empresaDoRegistro.empresa_name);

  // (4) a situação aparece como SELO, com o rótulo do catálogo — nunca valor cru.
  //
  // LIMITE DESTA ASSERÇÃO, MEDIDO: ela NÃO distingue o domínio. Em `request` os dois catálogos dizem a
  // mesma coisa ("Solicitação"), porque o domínio genérico duplica as etapas de compra de propósito
  // (packages/domain/src/labels.ts). Trocar `situacaoDominio` para "status" mantinha este teste VERDE —
  // foi a verificação reversa que expôs isso. Quem separa os dois domínios é o teste do fim do arquivo.
  const selo = page.getByTestId("base2-shell").locator("[data-status]").first();
  await expect(selo).toBeVisible();
  await expect(selo, "a situação precisa sair como rótulo, não como valor cru").toHaveText(PURCHASE_STATUS_LABELS.request);

  // (5) TIPO DE OPERAÇÃO, com o texto do catálogo
  await expect(page.locator(CAMPO_TOP), "sem o campo de Tipo de operação").toBeVisible();
  await expect(page.locator(CAMPO_TOP)).toContainText(rotuloTop("compras.solicitacao"));

  // (6) dados principais continuam visíveis, e são os do REGISTRO
  await expect(page.getByTestId("base2-fields")).toBeVisible();
  for (const label of ["Código", "Data", "Tipo", "Prioridade", "Solicitante", "Responsável atual",
    "Valor estimado", "Valor aprovado", "Versão", "Classificação", "Descrição", "Justificativa"]) {
    await expect(page.locator(campo(label)), `campo ausente: ${label}`).toBeVisible();
  }
  await expect(page.locator(campo("Código"))).toContainText(s.code);
  await expect(page.locator(campo("Descrição"))).toContainText(s.descricao);
  // dinheiro pelo formatador oficial, e o número é o do servidor (3×10 + 2×25 = 80,00)
  await expect(page.locator(campo("Valor estimado"))).toContainText("80,00");

  // (7) (8) itens em seção Base 2, com a contagem certa
  const itens = page.locator('[data-testid="base2-section"][data-secao="Itens"]');
  await expect(itens).toBeVisible();
  await expect(itens.getByTestId("base2-section-contagem")).toHaveText("2");
  await expect(itens.getByTestId("base2-items")).toBeVisible();
  await expect(itens.getByTestId("base2-items-linha")).toHaveCount(2);
  await expect(itens.getByTestId("base2-items")).toContainText("Item um da prova");
  // sem rodapé de total: o valor do documento é campo do cabeçalho (contrato § Totais)
  await expect(itens.getByTestId("base2-items").locator("tfoot")).toHaveCount(0);

  // (20) voltar leva a Compras / Processos
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/compras\?tab=processos/);
});

test("BASE2-03A: o processo de compra continua inteiro ao lado da moldura", async ({ page }) => {
  await login(page);
  const s = await criarSolicitacao(page);
  await abrir(page, s);

  // (9) (10) (11) (12) (13) cada superfície do processo continua acessível, pelo nome que o usuário vê
  for (const aba of ["Cotações", "Aprovações", "Pedido de compra", "Comentários", "Histórico do processo"]) {
    await expect(page.getByRole("tab", { name: new RegExp(aba) }), `aba ausente: ${aba}`).toBeVisible();
  }

  // (13) o HISTÓRICO DO PROCESSO é o da linha do tempo de Compras, e mostra o evento de criação
  await page.getByRole("tab", { name: /Histórico do processo/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Criação");

  // e NÃO se confunde com a auditoria: não existe aba chamada só "Histórico"
  await expect(page.getByRole("tab", { name: "Histórico", exact: true }),
    "aba e botão com o mesmo nome e conteúdos diferentes é ambiguidade").toHaveCount(0);

  // cotações: a porta de criação continua no módulo
  await page.getByRole("tab", { name: /Cotações/ }).click();
  await expect(page.getByRole("button", { name: "Adicionar cotação" })).toBeVisible();

  // pedido de compra: quem tem permissão vê o texto do pedido, não um aviso de bloqueio
  await page.getByRole("tab", { name: /Pedido de compra/ }).click();
  await expect(page.getByRole("tabpanel")).not.toContainText("Sem permissão");

  // comentários: a caixa do módulo continua ali
  await page.getByRole("tab", { name: /Comentários/ }).click();
  await expect(page.getByPlaceholder(/comentário para o histórico do processo/i)).toBeVisible();

  // (17) a aba redundante de anexos saiu — a porta agora é uma só, a oficial
  await expect(page.getByRole("tab", { name: /Anexos/ }),
    "a aba de anexos era somente leitura e mandava usar outra tela; a porta oficial a substitui").toHaveCount(0);
});

test("BASE2-03A: histórico oficial e anexos pelas portas do Base 2", async ({ page }) => {
  await login(page);
  const s = await criarSolicitacao(page);
  await abrir(page, s);

  // (14) o botão oficial abre a AUDITORIA do registro — e ela tem conteúdo, porque criar a solicitação
  // já gravou em `erp.audit_logs`. Um diálogo que abrisse vazio não distinguiria "sem evento" de
  // "consultando a entidade errada".
  await page.getByTestId("base2-historico").click();
  const historico = page.getByRole("dialog");
  await expect(historico).toBeVisible();
  await expect(historico).toContainText("Histórico");
  // criar a solicitação grava `audit(..., "purchase_requests", id, "create")` no servidor, então a lista
  // TEM de ter conteúdo. Sem esta asserção, um diálogo consultando a entidade errada abriria vazio e
  // passaria: "nenhum evento" e "perguntei pela entidade errada" são indistinguíveis na tela.
  await expect(historico, "a auditoria de purchase_requests não pode vir vazia").not.toContainText("Nenhum evento registrado");
  await expect(historico.locator("ol > li").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(historico).toBeHidden();

  // (15) (16) anexos: `purchase_requests` está em ATTACHMENT_PARENTS, então o botão existe e o diálogo
  // fala com o servidor. Abrir não prova nada sozinho — com o pai fora da whitelist o GET devolve 422 e
  // a lista fica vazia sem erro visível. O fato que distingue é um anexo que SOBE e VOLTA na listagem.
  await page.getByTestId("base2-anexos").click();
  const anexos = page.getByRole("dialog");
  await expect(anexos).toBeVisible();
  await expect(anexos).toContainText("Anexos");
  await anexos.getByLabel("Nome do anexo").fill("Orçamento do fornecedor");
  await anexos.locator('input[aria-label="Selecionar arquivos"]').setInputFiles({
    name: "orcamento.txt", mimeType: "text/plain", buffer: Buffer.from("orcamento da solicitacao de compra")
  });
  const linha = anexos.getByTestId("b1-attachment");
  await expect(linha, "sem purchase_requests aceito pelo servidor o envio falha e a lista fica vazia").toHaveCount(1);
  await expect(linha).toContainText("orcamento.txt");
});

test("BASE2-03A: o workflow real continua funcionando, e a permissão continua escondendo", async ({ page }) => {
  await login(page);
  const s = await criarSolicitacao(page);
  await abrir(page, s);

  // (18) UMA ação real do workflow, pela porta real: a situação muda e a linha do tempo registra.
  // A regra não foi tocada — quem decide a transição continua sendo `supply-workflow` no servidor.
  await page.getByRole("button", { name: "Enviar para ciência", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const selo = page.getByTestId("base2-shell").locator("[data-status]").first();
  await expect(selo, "a situação precisa avançar pelo servidor").toHaveText(PURCHASE_STATUS_LABELS.awaiting_awareness);
  await page.getByRole("tab", { name: /Histórico do processo/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Enviar para ciência");

  // (19) o mesmo registro, por um usuário SEM as permissões do fluxo: a moldura aparece igual e as
  // ações somem. O operador do seed tem `purchase_requests.view` e `attachments.view`, mas não tem
  // `purchase_requests.edit`, `purchase_buy.view` nem `audit_logs.view`.
  await page.getByLabel("Usuário").click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, { email: "operador@demo.local", password: "Demo@12345" });
  await page.goto(`/suprimentos/view/${s.id}`);
  await expect(page.getByTestId("base2-shell"), "quem só pode ver continua vendo a tela").toBeVisible();
  await expect(page.locator(CAMPO_TOP), "e continua vendo a identidade da operação").toBeVisible();

  await expect(page.getByRole("button", { name: "Dar ciência", exact: true }),
    "sem a permissão do fluxo, a ação não aparece").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transferir responsável" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Financeiro" })).toHaveCount(0);
  // o botão de histórico depende de `audit_logs.view`; o de anexos, de `attachments.view`. O operador
  // tem o segundo e não tem o primeiro — é o par que prova que a moldura respeita CADA permissão, em vez
  // de mostrar ou esconder os dois juntos.
  await expect(page.getByTestId("base2-historico"), "sem audit_logs.view não há botão de histórico").toHaveCount(0);
  await expect(page.getByTestId("base2-anexos"), "com attachments.view o botão de anexos continua").toBeVisible();
  // e a aba do pedido, sem `purchase_buy.view`, diz que falta permissão em vez de mostrar o pedido
  await page.getByRole("tab", { name: /Pedido de compra/ }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Sem permissão");
});

/**
 * O DOMÍNIO DA SITUAÇÃO É O DE COMPRAS — e este é o único teste que consegue prová-lo.
 *
 * O catálogo genérico (`ENUM_LABELS.status`) repete as etapas do processo de compra com rótulo CURTO, de
 * propósito, para listagens de outros módulos. Nos estados iniciais os dois textos coincidem, então
 * qualquer asserção feita ali passa com o domínio errado. Onde eles divergem é no fim do fluxo:
 * `cancelled` é "Pedido cancelado" em compras e "Cancelado" no genérico.
 *
 * O teste começa PROVANDO que os dois rótulos ainda diferem. Se um dia alguém unificar os catálogos,
 * ele falha dizendo que perdeu o poder de discriminar — em vez de continuar verde sem provar nada.
 */
test("BASE2-03A: a situação usa o domínio de COMPRAS, não o genérico", async ({ page }) => {
  await login(page);
  const s = await criarSolicitacao(page);

  const daCompra = PURCHASE_STATUS_LABELS.cancelled;
  const doGenerico = ENUM_LABELS.status["cancelled"];
  expect(daCompra, "os catálogos convergiram: este teste deixou de discriminar o domínio").not.toBe(doGenerico);

  // cancelar pela porta real — é a transição que leva ao estado onde os catálogos divergem
  const antes = await api<{ version: number }>(page, "GET", `/api/supply/requests/${s.id}`);
  await api(page, "POST", `/api/supply/requests/${s.id}/actions/cancel`, {
    justification: "Cancelamento da prova BASE2-03A", version: antes.version
  });

  await abrir(page, s);
  const selo = page.getByTestId("base2-shell").locator("[data-status]").first();
  await expect(selo, `com situacaoDominio="status" o selo diria "${doGenerico}"`).toHaveText(daCompra);
});
