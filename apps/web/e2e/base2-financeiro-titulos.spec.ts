import { test, expect, type Page } from "@playwright/test";
import { login, logout, api, empresaAtiva } from "./helpers";
import { ptBR } from "@erp/plataforma";
import { TITLE_STATUS_LABELS, displayTitleStatus } from "@agro/domain";

/**
 * BASE2-03B — TÍTULO FINANCEIRO NO MODELO BASE 2.
 *
 * Segunda entidade de módulo migrada, e a primeira com DUAS VARIANTES da mesma entidade: conta a pagar
 * e conta a receber são o mesmo `erp.financial_titles`, o mesmo componente e as mesmas regras — muda a
 * `direction` do REGISTRO. Por isso metade destes testes existe para provar que as duas variantes não
 * se cruzam, e que a identidade apresentada sai do registro, não da rota.
 *
 * A outra metade protege o que a migração NÃO podia perder: a situação dinâmica do Financeiro
 * (`status_label`, calculado pelo servidor a partir de status + vencimento + forma de pagamento), as
 * baixas, as parcelas e as ações. Nenhuma regra financeira é exercitada por atalho: as fixtures nascem
 * pela API REAL e a baixa é feita pela porta real.
 */

/** Rótulo da TOP lido do CATÁLOGO, nunca copiado: renomear a copy move tela e teste juntos. */
const rotuloTop = (codigo: string) => {
  const r = ptBR.mensagens[`top.${codigo}`];
  if (!r) throw new Error(`TOP ${codigo} sem rótulo no catálogo pt-BR`);
  return r;
};

const TOP_PAGAR = rotuloTop("financeiro.conta_a_pagar");
const TOP_RECEBER = rotuloTop("financeiro.conta_a_receber");

type Variante = "payable" | "receivable";
interface Titulo { id: string; code: string; numero: string; rota: string; variante: Variante }

const ROTA: Record<Variante, string> = {
  payable: "/financeiro/contas-a-pagar",
  receivable: "/financeiro/contas-a-receber"
};

/** Primeiro id de um cadastro pela listagem oficial, com a premissa provada antes do uso. */
async function umId(page: Page, path: string, oQue: string): Promise<string> {
  const r = await api<{ items: { id: string }[] }>(page, "GET", path);
  const id = r.items?.[0]?.id;
  expect(id, `o seed precisa ter ${oQue} para esta fixture existir`).toBeTruthy();
  return id!;
}

/**
 * Cria um título pela API REAL, na variante pedida.
 *
 * `vencimento` é parâmetro porque é ele que decide o `status_label`: um título `open` com vencimento no
 * passado vira "Vencida" no servidor — e é essa diferença que o caso discriminante mede.
 */
async function criarTitulo(page: Page, variante: Variante, opts: { vencimento: string; valor?: string }): Promise<Titulo> {
  const empresa = await empresaAtiva(page);
  const pessoa = await umId(page, `/api/resources/people?${variante === "payable" ? "is_provider" : "is_client"}=true&pageSize=1`, variante === "payable" ? "um fornecedor" : "um cliente");
  const categoria = await umId(page, `/api/resources/financial_categories?kind=analytic&nature=${variante === "payable" ? "expense" : "income"}&pageSize=1`, "uma categoria financeira analítica");
  const centro = await umId(page, "/api/resources/cost_centers?kind=analytic&pageSize=1", "um centro de custo analítico");
  const numero = `B203B-${variante === "payable" ? "P" : "R"}-${Date.now().toString(36)}`;

  const criado = await api<{ id: string }>(page, "POST", `/api/financial/${variante}s`, {
    empresa_id: empresa, number: numero, person_id: pessoa, amount: opts.valor ?? "250.00",
    emission_date: "2026-01-10", due_date: opts.vencimento, note: `Fixture BASE2-03B ${variante}`,
    apportionment: [{ financial_category_id: categoria, cost_center_id: centro, percentage: "100" }]
  });
  expect(criado.id, "a API precisa devolver o id do título criado").toBeTruthy();

  const lido = await api<{ code: string }>(page, "GET", `/api/financial/${variante}s/${criado.id}`);
  return { id: criado.id, code: lido.code, numero, rota: ROTA[variante], variante };
}

async function abrir(page: Page, t: Titulo): Promise<void> {
  await page.goto(`${t.rota}/${t.id}`);
  await expect(page.getByTestId("base2-shell")).toBeVisible();
}

const campo = (page: Page, rotulo: string) => page.locator(`[data-testid="base2-field"][data-campo="${rotulo}"]`);

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · IDENTIDADE, TOP E DADOS PRINCIPAIS — nas DUAS variantes
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

for (const [variante, topEsperada, topVizinha] of [
  ["payable", TOP_PAGAR, TOP_RECEBER],
  ["receivable", TOP_RECEBER, TOP_PAGAR]
] as [Variante, string, string][]) {
  test(`BASE2-03B: ${variante} abre no Modelo Base 2 com identidade, TOP e dados principais do REGISTRO`, async ({ page }) => {
    await login(page);
    const t = await criarTitulo(page, variante, { vencimento: "2031-12-20" });
    await abrir(page, t);

    // identidade: o título funcional + o CÓDIGO do registro (nunca o número do documento)
    await expect(page.getByRole("heading", { name: new RegExp(`${variante === "payable" ? "Conta a pagar" : "Conta a receber"}\\s+${t.code}`) })).toBeVisible();
    await expect(campo(page, "Código")).toContainText(t.code);

    // o número do documento continua existindo — como DADO, não como identidade
    await expect(campo(page, "Nº do documento"), "o número do documento não pode sumir na migração").toContainText(t.numero);
    expect(t.numero, "premissa do caso: código e número são valores diferentes").not.toBe(t.code);

    // empresa do REGISTRO, no cabeçalho
    await expect(page.getByTestId("base2-empresa")).toBeVisible();
    await expect(page.getByTestId("base2-empresa")).not.toHaveText(/Empresa:\s*$/);

    // TOP da variante — e NUNCA a da variante vizinha
    const tipo = campo(page, ptBR.mensagens["termos.tipo_operacao"]!);
    await expect(tipo).toContainText(topEsperada);
    await expect(tipo, `${variante} não pode exibir a TOP da variante vizinha`).not.toContainText(topVizinha);

    // dados principais existem de verdade, com os campos do Financeiro
    await expect(page.getByTestId("base2-fields")).toBeVisible();
    for (const rotulo of ["Vencimento", "Valor", "Valor líquido", "Saldo", "Forma de pagamento", "Parcela"]) {
      await expect(campo(page, rotulo), `campo "${rotulo}" sumiu dos dados principais`).toBeVisible();
    }

    // Voltar leva à listagem DESTA variante. A URL final é a canônica com abas (o shell canonicaliza
    // `/financeiro/contas-a-pagar`), e é ela que este teste fixa — o que não pode acontecer é voltar
    // para a listagem da variante vizinha.
    await page.getByRole("button", { name: "Voltar" }).click();
    const sub = variante === "payable" ? "pagar" : "receber";
    await expect(page).toHaveURL(new RegExp(`(${t.rota}(\\?|$)|/financeiro\\?tab=contas&sub=${sub})`));
  });
}

/** Status CRU de uma porta da API — o helper `api` lança em erro, e aqui o erro é o que se mede. */
async function statusDaApi(page: Page, path: string): Promise<number> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ path, base }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}) } });
    return res.status;
  }, { path, base });
}

test("BASE2-03B: a rota da outra variante NÃO serve o registro — 404 nas duas direções", async ({ page }) => {
  await login(page);
  const pagar = await criarTitulo(page, "payable", { vencimento: "2031-11-05" });
  const receber = await criarTitulo(page, "receivable", { vencimento: "2031-11-06" });

  // CONTRATO DURO (R1). `direction` faz parte da AUTORIZAÇÃO, não é filtro de conveniência: a rota de
  // recebíveis não serve um pagável nem para quem tem `receivables.view`. Antes da R1 esta asserção
  // aceitava "200 OU 404" — e um 200 aqui era exatamente o defeito passando por cima do gate. Aceitar as
  // duas respostas é aceitar a que não devia existir.
  expect(await statusDaApi(page, `/api/financial/receivables/${pagar.id}`), "rota de recebíveis servindo um PAGÁVEL").toBe(404);
  expect(await statusDaApi(page, `/api/financial/payables/${receber.id}`), "rota de pagáveis servindo um RECEBÍVEL").toBe(404);

  // E a tela pela rota errada não monta o registro: nada do título sai antes da autorização completa.
  await page.goto(`${ROTA.receivable}/${pagar.id}`);
  await expect(page.getByTestId("base2-shell")).toHaveCount(0);
  await expect(page.getByText(pagar.numero, { exact: false })).toHaveCount(0);

  // Pelas rotas certas, cada um abre com a TOP do REGISTRO.
  await abrir(page, pagar);
  await expect(campo(page, ptBR.mensagens["termos.tipo_operacao"]!)).toContainText(TOP_PAGAR);
  await abrir(page, receber);
  await expect(campo(page, ptBR.mensagens["termos.tipo_operacao"]!)).toContainText(TOP_RECEBER);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · SITUAÇÃO DINÂMICA — o que a migração NÃO podia achatar
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03B: a situação é o `status_label` do servidor, não a tradução do enum cru", async ({ page }) => {
  await login(page);

  // PREMISSA PROVADA ANTES DA CONCLUSÃO: para um título `open` vencido, o servidor diz "Vencida" e o
  // enum cru diria "A vencer". Se algum dia os dois convergirem, este teste deixa de discriminar — e
  // falha aqui, avisando, em vez de seguir verde sem medir nada.
  const doServidor = displayTitleStatus({ status: "open", dueDate: "2020-01-01", paymentType: "single" }, "2031-01-01");
  const doEnumCru = TITLE_STATUS_LABELS.open;
  expect(doServidor, "o rótulo dinâmico do servidor").toBe("Vencida");
  expect(doServidor, "os catálogos convergiram: este caso deixou de discriminar a situação dinâmica").not.toBe(doEnumCru);

  const t = await criarTitulo(page, "payable", { vencimento: "2020-01-01" });
  const lido = await api<{ status: string; status_label: string }>(page, "GET", `/api/financial/payables/${t.id}`);
  expect(lido.status, "o título persiste `open` — é o vencimento que muda o rótulo").toBe("open");
  expect(lido.status_label, "o servidor é a autoridade do rótulo").toBe(doServidor);

  await abrir(page, t);
  const selo = page.getByTestId("base2-shell").locator("[data-status]").first();
  await expect(selo, `com o enum cru o selo diria "${doEnumCru}"`).toHaveText(doServidor);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · RATEIO É A LINHA DO LANÇAMENTO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03B: o Rateio é seção permanente em Base2Items, com contagem e sem total no cliente", async ({ page }) => {
  await login(page);
  const t = await criarTitulo(page, "payable", { vencimento: "2031-10-01", valor: "400.00" });
  await abrir(page, t);

  const secao = page.locator('[data-testid="base2-section"][data-secao="Rateio"]');
  await expect(secao, "o rateio não pode voltar para dentro de uma aba").toBeVisible();

  const tabela = secao.getByTestId("base2-items");
  await expect(tabela).toBeVisible();

  // a contagem da seção bate com o que a API devolveu — não é um número decorativo
  const doServidor = await api<{ apportionments: unknown[] }>(page, "GET", `/api/financial/payables/${t.id}`);
  expect(doServidor.apportionments.length, "a fixture precisa ter rateio, senão o teste passa vazio").toBeGreaterThan(0);
  await expect(secao.getByTestId("base2-section-contagem")).toHaveText(String(doServidor.apportionments.length));
  await expect(tabela.getByTestId("base2-items-linha")).toHaveCount(doServidor.apportionments.length);

  // colunas do rateio, e NENHUM rodapé de total: o total do título é campo do cabeçalho
  for (const coluna of ["Categoria", "Centro de Custo", "%", "Valor"]) {
    await expect(tabela.locator("thead th", { hasText: coluna }).first()).toBeVisible();
  }
  await expect(tabela.locator("tfoot"), "o Base2Items não totaliza — total de documento é campo").toHaveCount(0);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 4 · PROCESSO, HISTÓRICO E ANEXOS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03B: Baixas e Parcelas continuam acessíveis; o histórico oficial abre e NÃO vem vazio", async ({ page }) => {
  await login(page);
  const t = await criarTitulo(page, "receivable", { vencimento: "2031-09-15" });
  await abrir(page, t);

  // as superfícies de processo continuam em abas, com as suas colunas
  for (const aba of ["Baixas", "Parcelas"]) {
    await page.getByRole("tab", { name: new RegExp(aba) }).click();
    await expect(page.getByRole("tabpanel"), `a aba ${aba} perdeu o conteúdo`).toBeVisible();
  }

  // a aba redundante de anexos saiu — quem responde por anexo agora é a porta oficial
  await expect(page.getByRole("tab", { name: "Anexos" }), "a aba redundante de Anexos precisa ter saído").toHaveCount(0);

  // histórico OFICIAL, com conteúdo real: criar o título grava `audit(..., "financial_titles", ...)`,
  // então a lista TEM de ter evento. "Nenhum evento" e "perguntei pela entidade errada" são
  // indistinguíveis na tela — por isso a asserção é sobre o conteúdo, não sobre o diálogo abrir.
  await page.getByTestId("base2-historico").click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Histórico");
  await expect(dialogo, "a auditoria de financial_titles não pode vir vazia").not.toContainText("Nenhum evento registrado");
  await expect(dialogo.locator("ol > li").first(), "histórico vazio não prova nada").toBeVisible();
});

test("BASE2-03B: anexos pela porta OFICIAL (`financial_titles`), com upload real", async ({ page }) => {
  await login(page);
  const t = await criarTitulo(page, "payable", { vencimento: "2031-08-20" });
  await abrir(page, t);

  await page.getByTestId("base2-anexos").click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText("Anexos");

  await dialogo.getByLabel("Nome do anexo").fill("Comprovante do título");
  await dialogo.locator('input[aria-label="Selecionar arquivos"]').setInputFiles({
    name: "comprovante-b203b.txt", mimeType: "text/plain", buffer: Buffer.from("prova de anexo BASE2-03B")
  });
  // `b1-attachment` só existe para anexo PERSISTIDO. O nome do arquivo aparecer não provaria nada: o
  // próprio input de arquivo o exibe depois da seleção, mesmo que o envio falhe.
  const linha = dialogo.getByTestId("b1-attachment");
  await expect(linha, "sem `financial_titles` aceito pelo servidor o envio falha e a lista fica vazia").toHaveCount(1);
  // o servidor higieniza o nome do arquivo ao guardar; o que o teste fixa é a IDENTIDADE do anexo
  await expect(linha).toContainText("Comprovante do título");
  await expect(linha).toContainText(/comprovante.b203b\.txt/);

  // e o servidor guardou sob a entidade PLURAL, que é a que `ATTACHMENT_PARENTS` autoriza
  const anexos = await api<{ items: { file_name: string; entity: string }[] }>(page, "GET", `/api/attachments?entity=financial_titles&entity_id=${t.id}`);
  expect(anexos.items.length, "o anexo tem de estar sob a entidade PLURAL `financial_titles`").toBe(1);
  expect(anexos.items[0]!.entity, "a chave gravada é a plural, que é a que ATTACHMENT_PARENTS autoriza").toBe("financial_titles");
  expect(anexos.items[0]!.file_name, "e é o arquivo que subiu").toMatch(/comprovante.b203b\.txt/);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * 5 · AÇÕES FINANCEIRAS — regra preservada, exercitada pela porta real
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

test("BASE2-03B: a baixa continua funcionando pela porta real e muda saldo e situação", async ({ page }) => {
  await login(page);
  const t = await criarTitulo(page, "payable", { vencimento: "2031-07-10", valor: "300.00" });
  await abrir(page, t);

  // a ação existe para quem tem a permissão — e está na moldura, não numa barra paralela
  await expect(page.getByRole("button", { name: "Baixar", exact: true })).toBeVisible();

  const conta = await umId(page, "/api/resources/bank_accounts?pageSize=1", "uma conta bancária");
  const antes = await api<{ balance: string; status: string }>(page, "GET", `/api/financial/payables/${t.id}`);
  expect(antes.status, "o título nasce em aberto").toBe("open");

  await api(page, "POST", `/api/financial/payables/${t.id}/settle`, {
    settlement_date: "2031-07-10", settlement_kind: "bank_movement", bank_account_id: conta,
    amount: antes.balance, movement_mode: "separate"
  });

  const depois = await api<{ balance: string; status: string; status_label: string }>(page, "GET", `/api/financial/payables/${t.id}`);
  expect(depois.status, "a baixa total leva o título a `paid` — regra do servidor, não da tela").toBe("paid");
  expect(Number(depois.balance), "o saldo é zerado pelo servidor").toBe(0);

  // a tela reflete o que o servidor decidiu, com o rótulo dinâmico
  await abrir(page, t);
  await expect(page.getByTestId("base2-shell").locator("[data-status]").first()).toHaveText(depois.status_label);
  await page.getByRole("tab", { name: /Baixas/ }).click();
  await expect(page.getByRole("tabpanel").locator("tbody tr").first(), "a baixa precisa aparecer na aba de Baixas").toBeVisible();
  await expect(page.getByRole("button", { name: "Cancelar baixa" }).first(), "a porta de cancelar baixa continua existindo").toBeVisible();
});

test("BASE2-03B: sem a capacidade de baixar, a ação não é desenhada — e a tela continua abrindo", async ({ page }) => {
  await login(page);
  const t = await criarTitulo(page, "payable", { vencimento: "2031-06-01" });

  // Um usuário REAL que enxerga o título e NÃO pode baixá-lo. É a única forma de separar as duas
  // coisas: com um usuário sem `payables.view` a rota nega antes, e o teste provaria o 403 — não a
  // ausência da ação. Aqui a tela abre inteira e só o botão falta.
  const marca = Date.now().toString(36);
  const credencial = { email: `leitor.financeiro.${marca}@e2e.local`, password: "Demo@12345" };
  const papel = await api<{ id: string }>(page, "POST", "/api/admin/roles", {
    name: `Leitor financeiro E2E ${marca}`,
    permissions: ["payables.view", "audit_logs.view", "attachments.view"]
  });
  // O escopo de empresa é EXPLÍCITO de propósito: sem `escopos_empresas` o servidor é fail-closed e o
  // membro não enxerga empresa nenhuma no Financeiro — o teste provaria a ausência de ACESSO, não a
  // ausência da CAPACIDADE, que é o que ele existe para separar.
  await api(page, "POST", "/api/admin/members", {
    name: "Leitor Financeiro E2E", email: credencial.email, password: credencial.password, role_id: papel.id,
    escopos_empresas: [{ modulo: "financeiro", modo: "todas", empresas: [] }]
  });

  await logout(page);
  await login(page, credencial);
  await abrir(page, t);

  // a tela abriu — o que prova que a ausência do botão é CAPACIDADE, não falta de acesso ao registro
  await expect(page.getByTestId("base2-fields"), "o leitor precisa enxergar o título inteiro").toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar", exact: true }), "`can()` é apresentação: sem a capacidade, o botão não é desenhado").toHaveCount(0);

  // e a autoridade real continua no SERVIDOR: a porta recusa mesmo sem passar pelo botão
  const recusa = await page.evaluate(async ({ id }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null };
    const r = await fetch(`${window.location.origin.replace(/:\d+$/, ":3333")}/api/financial/payables/${id}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.token}`, ...(s.orgId ? { "x-org-id": s.orgId } : {}) },
      body: JSON.stringify({ settlement_date: "2031-06-01", settlement_kind: "bank_movement", amount: "1.00" })
    });
    return r.status;
  }, { id: t.id });
  expect(recusa, "quem nega a baixa é a rota, não o botão escondido").toBe(403);
});
