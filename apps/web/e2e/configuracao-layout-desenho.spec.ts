import { test, expect, type Page, type Locator, type Request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { getResource } from "@agro/domain";
import type { FormLayout, LayoutRow } from "@agro/shared";
import { login, api } from "./helpers";

/**
 * CONFIGURAÇÃO DE LAYOUT IGUAL AO DESENHO (VISUAL-UX-03, docs/DECISIONS.md 275) — desktop, cadastro `equipments`
 * (Inventário de Bens: o exemplo do desenho, "Bens e equipamentos").
 *
 * ┌─ O QUE SÓ ESTE ARQUIVO PROVA ──────────────────────────────────────────────────────────────────┐
 * │ `personalizacao.spec.ts` continua provando o caminho curto (tirar, renomear, restaurar) no      │
 * │ cadastro de armazéns. Aqui: as medidas-chave do desenho (CL-1), os dois modos (CL-2), o arrastar │
 * │ por ponteiro com vão, troca, eco e soltar na coluna (CL-3…CL-5), reordenar e a identidade da    │
 * │ linha (CL-6), painéis, cards e linhas (CL-7), o inspetor (CL-8), a pilha (CL-9), o CONTRATO do  │
 * │ documento salvo e o formulário que ele governa (CL-10), Descartar / Restaurar / padrão da       │
 * │ organização pela rede (CL-11), a evidência por cena (CL-12) e o movimento reduzido (CL-13).     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ COMO A TELA É ACHADA ──────────────────────────────────────────────────────────────────────┐
 * │ Pelos nomes acessíveis do pedido (seção 4) e pelos atributos `data-parte` / `data-*` do        │
 * │ contrato em `src/features/resources/configuracao-layout/tipos.ts`. Campo e linha são achados    │
 * │ por `data-fid` e `data-linha` (posição), nunca por `row.id`: o normalizador renomeia e pode     │
 * │ repetir ids de linha.                                                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ VERDE QUE NÃO PROVA NADA É REPROVAÇÃO ───────────────────────────────────────────────────────┐
 * │ Cada teste parte de um layout CONHECIDO gravado pela API (o servidor confere que ele não ganhou │
 * │ "Outros campos" — a premissa de que todo campo da definição está numa linha ou fora dela). Toda │
 * │ ausência vem depois de uma presença; toda escrita é ESPERADA na rede (PUT/DELETE e o escopo) ou │
 * │ CONTADA (zero escrita é um número). Preferências user e org de equipments/form são apagadas     │
 * │ antes e depois de cada caso.                                                                   │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */

test.use({ viewport: { width: 1440, height: 900 } });

const RECURSO = "equipments";
const TELA = `/cadastros/${RECURSO}/configuracao-layout`;
const FORMULARIO = `/cadastros/${RECURSO}/new`;
const PREFS = `/api/preferences/${RECURSO}/form`;

const DEFINICAO = getResource(RECURSO);
/** O nome do campo na DEFINIÇÃO (o "nome do sistema" que a coluna mostra e o rótulo padrão do campo). */
function rotulo(fid: string): string {
  const f = DEFINICAO?.fields.find((x) => x.name === fid);
  if (!f) throw new Error(`premissa: o campo ${fid} não existe na definição de ${RECURSO}`);
  return f.label;
}
/** fieldSizes do padrão (os `span` da definição): o valor salvo atravessa intacto (o editor sai, seção 6). */
const TAMANHOS: Record<string, number> = Object.fromEntries((DEFINICAO?.fields ?? []).filter((f) => f.span).map((f) => [f.name, f.span as number]));

/** Campos FORA do formulário no layout de partida (o que a aba Disponíveis lista), na ordem da definição. */
const FORA_DO_FORMULARIO = ["patrimony", "color", "vehicle", "residual_percent", "life_years", "depreciation_percent", "use_fiscal", "features", "specification"];
/** Campos do sistema (obrigatórios na definição) — premissa conferida no CL-2. */
const DO_SISTEMA = ["description", "empresa_id", "family_id", "hour_value", "year_model", "acquisition_value"];
/** Só leitura na definição. */
const SO_LEITURA = ["code", "residual_value", "depreciable_value", "depreciated_value"];

const linha = (id: string, ...fieldIds: string[]): LayoutRow => ({ id, fieldIds });
/**
 * O LAYOUT DE PARTIDA — Principal (Dados inteiro: 3/7, 6/7 com uma vaga e 2/7; Veículo MEIO: 4/4 cheia com o campo do
 * sistema Ano/modelo, e 2/4), Depreciação e Outros; nove campos fora do formulário (Disponíveis). Os três estados do
 * contador (comum, uma vaga, cheia) e a linha cheia meio do desenho moram no mesmo painel.
 */
function layoutBase(): FormLayout {
  return {
    version: 1,
    panels: [{ id: "principal", label: "Principal", order: 1 }, { id: "p_depreciacao", label: "Depreciação", order: 2 }, { id: "p_outros", label: "Outros", order: 3 }],
    cards: [
      { id: "geral", panelId: "principal", label: "Dados", order: 1, colSpan: 12, rows: [linha("r1", "code", "description", "empresa_id"), linha("r2", "family_id", "equipment_type", "proprietary_id", "status", "hour_value", "hour_meter"), linha("r3", "brand", "model")] },
      { id: "veiculo", panelId: "principal", label: "Veículo", order: 2, colSpan: 6, rows: [linha("r1", "chassis", "renavam", "year_model", "plate"), linha("r2", "serial_number", "plate_state")] },
      { id: "depreciacao", panelId: "p_depreciacao", label: "Depreciação", order: 3, colSpan: 12, rows: [linha("r1", "has_depreciation", "acquisition_value", "acquisition_date", "depreciation_type"), linha("r2", "residual_value", "depreciable_value", "depreciated_value")] },
      { id: "outros", panelId: "p_outros", label: "Outros", order: 4, colSpan: 12, rows: [linha("r1", "provider_id", "product_id")] }
    ],
    hiddenFieldIds: [...FORA_DO_FORMULARIO],
    lockedFieldIds: [],
    requiredFieldIds: [],
    fieldSizes: { ...TAMANHOS },
    fieldLabels: {},
    fieldDefaultValues: {}
  };
}
const LINHA_2_DADOS = ["family_id", "equipment_type", "proprietary_id", "status", "hour_value", "hour_meter"];
/** As chaves do FormLayout de hoje — o documento do Salvar não ganha nenhuma (4.7). `meta` é a de `useScreenPrefs`. */
const CHAVES_DO_DOCUMENTO = ["cards", "fieldDefaultValues", "fieldLabels", "fieldSizes", "hiddenFieldIds", "lockedFieldIds", "meta", "panels", "requiredFieldIds", "version"];

/* ═════════════════════════════════════════════ medidas do desenho ═════════════════════════════════════════════ */

const BRANCO = "rgb(255, 255, 255)";
const TRANSPARENTE = "rgba(0, 0, 0, 0)";
const VERDE = "rgb(64, 222, 99)"; // #40de63
const VERDE_TEXTO = "rgb(21, 128, 61)"; // #15803d
const SOMBRA_CARTAO = "rgba(15, 23, 42, 0.03) 0px 1px 2px 0px, rgba(15, 23, 42, 0.02) 0px 2px 6px 0px";

/**
 * AS MEDIDAS-CHAVE (seção 2 do pedido), em valores do DESENHO — estilo calculado no Chromium. Tolerância 0 px em
 * tamanho, raio e espaço (1 px só em posição contra a área da página); cor exata. Caixa = borda incluída: a faixa de
 * cards é 34 + 1 de borda = 35; o cabeçalho da linha (border-box) é 32 com a borda.
 */
const MEDIDAS = {
  pagina: { barraAteDocumento: 8, embaixo: 12 },
  barra: { interior: 44, padding: "8px", raio: "12px", fundo: BRANCO, borda: "rgb(231, 234, 238)", bordaLargura: "1px", sombra: SOMBRA_CARTAO, noGrupo: 6 },
  botao: { lado: 25, raio: "999px", fundo: "rgb(241, 243, 244)", icone: "rgb(71, 85, 105)", iconeLado: 16, sombra: "rgba(34, 197, 94, 0.3) 0px 2px 6px 0px", opacidadeDesabilitado: "0.42" },
  divisor: { cor: "rgb(228, 232, 236)", margem: ["3px", "3px"], deVoltar: 9 },
  documento: { raio: "14px", fundo: BRANCO, borda: "rgba(15, 23, 42, 0.06)", sombra: SOMBRA_CARTAO },
  faixaPaineis: { altura: 38, fundo: "rgb(251, 252, 253)", padding: ["8px", "10px"], bordaBaixo: "0px" },
  aba: { fonte: "12.5px", peso: "500", cor: "rgb(100, 116, 139)", padding: "12px", gap: "6px", ativaPeso: "600", ativaCor: VERDE_TEXTO, traco: "2px", tracoCor: "rgb(34, 168, 92)" },
  grupoDireita: { borda: "rgb(238, 241, 244)", padding: "8px", margem: "8px" },
  maisVerde: { lado: 25, fundo: VERDE, icone: BRANCO },
  lixeira: { lado: 22, raio: "6px", cor: "rgb(148, 163, 184)" },
  faixaCards: { caixa: 35, borda: "rgb(241, 244, 246)", padding: ["16px", "10px"], gap: "6px" },
  pilula: { altura: 23, padding: "11px", fundo: "rgb(244, 246, 247)", fonte: "11.5px", peso: "500", cor: "rgb(107, 114, 128)", ativaBorda: "rgba(64, 222, 99, 0.38)", ativaFundo: "rgba(64, 222, 99, 0.12)", ativaCor: VERDE_TEXTO, ativaPeso: "600" },
  areaLinhas: { padding: ["12px", "16px", "14px", "16px"] },
  linha: { borda: "rgb(231, 234, 238)", raio: "12px", sombra: "rgba(15, 23, 42, 0.03) 0px 1px 2px 0px", entreLinhas: 10 },
  cabeca: { altura: 32, padding: ["11px", "6px"], bordaBaixo: "rgb(244, 246, 248)", titulo: { fonte: "11px", peso: "700", caixa: "uppercase", espaco: "0.55px", cor: "rgb(132, 146, 163)" } },
  contador: { fonte: "10.5px", peso: "700", linha: "15px", padding: ["1px", "8px"], raio: "999px", comum: ["rgb(241, 245, 249)", "rgb(100, 116, 139)"], umaVaga: ["rgb(254, 243, 199)", "rgb(146, 64, 14)"], cheia: ["rgb(220, 252, 231)", "rgb(22, 101, 52)"] },
  corpo: { padding: ["9px", "10px"], primeiro: 18, entreCampos: 8 },
  campo: { altura: 30, raio: "8px", borda: "rgb(231, 235, 239)", fundo: "rgb(244, 246, 247)", padding: ["9px", "4px"], rotulo: ["12px", "500", "rgb(30, 41, 59)"], obrigatorioPadding: "13px", vermelho: "rgb(220, 38, 38)", barra: ["3px", "4px", "4px"], asterisco: ["16px", "700"], soLeituraCor: "rgb(91, 104, 117)" },
  maisCampo: { altura: 30, minimo: "74px", borda: "rgb(215, 222, 230)", estilo: "dashed", raio: "8px", fundo: "rgb(251, 252, 253)", fonte: "10.5px", peso: "600", cor: "rgb(154, 167, 180)", alemDaColuna: 14 },
  adicionarLinha: { altura: 28, padding: "14px", raio: "999px", fundo: VERDE, cor: BRANCO, fonte: "12px", peso: "600" },
  coluna: { largura: 250, borda: "rgb(238, 241, 244)", fundo: TRANSPARENTE },
  abasDaColuna: { altura: 38, bordaBaixo: "0px", fonte: "12.5px", cor: "rgb(100, 116, 139)", peso: "500", ativaCor: VERDE_TEXTO, ativaPeso: "600" },
  contadorDaColuna: { raio: "999px", padding: ["2px", "9px"], fonte: "11px", peso: "600", ativo: ["rgb(220, 252, 231)", "rgb(22, 101, 52)"], inativo: ["rgb(241, 245, 249)", "rgb(51, 65, 85)"] },
  busca: { altura: 30, raio: "8px", fundo: "rgb(246, 248, 250)", recuo: 10, fonte: "12.5px", peso: "500", placeholder: ["rgb(139, 147, 158)", "400"] },
  lista: { padding: ["8px", "0px", "10px"] },
  item: { altura: 30, margem: ["0px", "10px", "6px", "10px"], raio: "8px", borda: "rgb(231, 235, 239)", fundo: "rgb(244, 246, 247)", padding: ["9px", "4px"], fonte: "12px", peso: "500", cor: "rgb(30, 41, 59)", cursor: "grab" },
  trilho: { largura: 38, fundo: "rgb(251, 252, 253)", borda: "rgb(238, 241, 244)", botao: 28, entreBotoes: 10 },
  inspetor: {
    largura: 292, borda: "rgb(238, 241, 244)", fundo: BRANCO, cabeca: 38, cabecaPadding: ["14px", "10px"], cabecaBorda: "rgb(241, 244, 246)",
    nome: ["12.5px", "600", "rgb(15, 23, 42)"], corpoPadding: ["12px", "14px", "16px"], corpoGap: "11px",
    grupo: ["10.5px", "600", "uppercase", "0.315px", "rgb(139, 149, 163)"], caixa: 30, caixaRaio: "8px", caixaFundo: "rgb(246, 248, 250)",
    chave: [34, 20], chaveDesligada: "rgb(223, 228, 234)", chaveLigada: VERDE, bolinha: 14, segmentado: 22, segmentadoBotao: 18, segmentadoFonte: ["10.5px", "600"]
  },
  campoComInspetor: { borda: VERDE, engrenagem: ["rgb(234, 252, 240)", VERDE_TEXTO] },
  dica: { fonte: "11.5px", peso: "500", linha: "16px", cor: "rgb(248, 250, 252)", fundo: "rgb(30, 41, 59)", raio: "6px", padding: ["4px", "8px"] }
} as const;

/* ═════════════════════════════════════════════ localizadores ═════════════════════════════════════════════ */

const raiz = (page: Page) => page.getByTestId("layout-config");
const barra = (page: Page) => page.getByRole("toolbar", { name: "Ações da configuração de layout" });
const botao = (page: Page, nome: string) => barra(page).getByRole("button", { name: nome, exact: true });
const coluna = (page: Page) => page.locator('[data-parte="coluna"]');
const itemDaColuna = (page: Page, fid: string) => coluna(page).locator(`[data-parte="item-campo"][data-fid="${fid}"]`);
const abaDaColuna = (page: Page, nome: "Disponíveis" | "Em uso") => coluna(page).getByRole("tab", { name: new RegExp(`^${nome}`) });
const caixaDeSoltar = (page: Page) => coluna(page).locator('[data-parte="caixa-soltar"]');
const trilho = (page: Page) => page.locator('[data-parte="trilho"]');
const campo = (page: Page, fid: string) => page.locator(`[data-parte="area-linhas"] [data-parte="campo"][data-fid="${fid}"]`);
const linhaDoCard = (page: Page, i: number) => page.locator(`[data-parte="linha"][data-linha="${i}"]`);
const cabecaDaLinha = (page: Page, i: number) => linhaDoCard(page, i).locator('[data-parte="cabeca-linha"]');
const contador = (page: Page, i: number) => linhaDoCard(page, i).locator('[data-parte="contador-linha"]');
const abaPainel = (page: Page, id: string) => page.locator(`[data-parte="aba-painel"][data-id="${id}"]`);
const pilula = (page: Page, id: string) => page.locator(`[data-parte="pilula-card"][data-id="${id}"]`);
const inspetor = (page: Page) => page.locator('[data-parte="inspetor"]');
const chave = (page: Page, nome: "Obrigatório" | "Visível" | "Somente leitura") => inspetor(page).getByRole("switch", { name: nome });
const fantasma = (page: Page) => page.locator('[data-parte="fantasma"]');
/** A marca do campo (olho cortado, cadeado, raio) pelo texto do desenho, como `title` ou `aria-label`. */
const marca = (c: Locator, texto: "Oculto no formulário" | "Somente leitura" | "Tem valor padrão") => c.locator(`[title="${texto}"], [aria-label="${texto}"]`);
/** A aba ATIVA do workspace (o ponto de alteração mora nela: `data-dirty`). */
const abaDoWorkspace = (page: Page) => page.getByTestId("workspace-tab").filter({ has: page.locator('[role="tab"][aria-selected="true"]') });

const fidsDaLinha = (page: Page, i: number) => linhaDoCard(page, i).locator('[data-parte="campo"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-fid")));
const fidsDasLinhas = (page: Page) => page.locator('[data-parte="linha"]').evaluateAll((ls) => ls.map((l) => [...l.querySelectorAll('[data-parte="campo"]')].map((c) => c.getAttribute("data-fid"))));
const fidsDisponiveis = (page: Page) => coluna(page).locator('[data-parte="item-campo"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-fid")));
const idsDasAbas = (page: Page) => page.locator('[data-parte="aba-painel"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
const idsDasPilulas = (page: Page) => page.locator('[data-parte="pilula-card"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));

/* ═════════════════════════════════════════════ preparo e passos ═════════════════════════════════════════════ */

async function limparCacheLocal(page: Page) {
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("agro:prefs:")) localStorage.removeItem(k); });
}

/** Apaga as preferências user e org de equipments/form (a org só com a permissão; 404 é tolerado). */
async function limparPreferencias(page: Page) {
  const apagar = async (caminho: string) => {
    // corpo `{}`: o helper manda content-type JSON sempre, e a API recusa corpo vazio com esse cabeçalho (400)
    try { await api(page, "DELETE", caminho, {}); } catch (e) { if (!/^Error: 404 /.test(String(e))) throw e; }
  };
  const estado = await api<{ canEditOrg: boolean }>(page, "GET", PREFS);
  await apagar(`${PREFS}?scope=user`);
  if (estado.canEditOrg) await apagar(`${PREFS}?scope=org`);
  await limparCacheLocal(page);
}

/** Grava um layout pela API (a mesma porta do Salvar) e confere a premissa: o servidor não anexou "Outros campos". */
async function gravarLayout(page: Page, layout: FormLayout, escopo: "user" | "org" = "user") {
  const r = await api<{ preferences: FormLayout }>(page, "PUT", `${PREFS}?scope=${escopo}`, { preferences: layout });
  expect(r.preferences.cards.map((c) => c.label), "premissa: o layout de partida cobre todo campo da definição (sem card \"Outros campos\")").toEqual(layout.cards.map((c) => c.label));
  await limparCacheLocal(page);
}

async function abrirTela(page: Page) {
  await page.goto(TELA);
  await expect(raiz(page)).toBeVisible();
  await expect(raiz(page), "a tela abre na consulta").toHaveAttribute("data-modo", "consulta");
  await expect(botao(page, "Editar layout"), "as preferências carregaram (p.loaded)").toBeEnabled();
}

async function editar(page: Page) {
  await botao(page, "Editar layout").click();
  await expect(raiz(page)).toHaveAttribute("data-modo", "edicao");
}

/** Volta ao salvo sem escrita (Descartar) e abre a edição de novo. */
async function recomecar(page: Page) {
  await botao(page, "Descartar alterações").click();
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  await editar(page);
}

async function mostrarDisponiveis(page: Page) {
  const aba = abaDaColuna(page, "Disponíveis");
  if ((await aba.getAttribute("aria-selected")) !== "true") await aba.click();
  await expect(aba).toHaveAttribute("aria-selected", "true");
}

/** "+" do item de Disponíveis (aparece no hover). */
async function adicionarPeloMais(page: Page, fid: string) {
  const item = itemDaColuna(page, fid);
  await item.hover();
  await item.getByRole("button", { name: `Adicionar ${rotulo(fid)}`, exact: true }).click();
  await expect(item, `${fid} saiu de Disponíveis`).toHaveCount(0);
}

/** × do campo na linha (aparece no hover). */
async function tirarPeloX(page: Page, fid: string) {
  const c = campo(page, fid);
  await c.hover();
  await c.getByRole("button", { name: /^Tirar .+ do formulário$/ }).click();
  await expect(c, `${fid} saiu das linhas`).toHaveCount(0);
}

/** ⚙ do campo (aparece no hover) → o inspetor abre nele. */
async function abrirInspetor(page: Page, fid: string) {
  const c = campo(page, fid);
  await c.hover();
  await c.getByRole("button", { name: /^Propriedades de / }).click();
  await expect(inspetor(page)).toBeVisible();
  await expect(c).toHaveAttribute("data-inspetor", "true");
}

async function salvar(page: Page) {
  const pedido = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes(PREFS) && r.url().includes("scope=user"));
  const resposta = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(PREFS) && r.url().includes("scope=user"));
  await botao(page, "Salvar layout").click();
  const corpo = (await pedido).postDataJSON() as { preferences: FormLayout & Record<string, unknown> };
  expect((await resposta).ok(), "o PUT do Salvar foi aceito").toBe(true);
  await expect(raiz(page), "Salvar volta à consulta").toHaveAttribute("data-modo", "consulta");
  return corpo;
}

const respostaDe = (page: Page, metodo: "PUT" | "DELETE", escopo: "user" | "org") =>
  page.waitForResponse((r) => r.request().method() === metodo && r.url().includes(PREFS) && r.url().includes(`scope=${escopo}`));

/** Registra toda escrita (não-GET) em /api/preferences/ a partir de agora. */
function registrarEscritas(page: Page) {
  const lista: string[] = [];
  const ouvir = (r: Request) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/preferences/") || r.method() === "GET" || r.method() === "OPTIONS") return;
    lista.push(`${r.method()} ${u.pathname}${u.search}`);
  };
  page.on("request", ouvir);
  return { lista, parar: () => page.off("request", ouvir) };
}

/* ─────────── arrastar por ponteiro (4.5): limiar de 4 px, alvo pelo elemento sob o ponteiro ─────────── */

const r = Math.round;
/** O texto exato como expressão regular (rótulos têm "/", "(" e "%"). */
const exato = (t: string) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
async function caixa(l: Locator) {
  const b = await l.boundingBox();
  expect(b, "o elemento está na tela").not.toBeNull();
  return b!;
}

/** Pega `origem` (botão principal), confere que ABAIXO de 4 px nada começa e que, passado o limiar, o fantasma aparece. */
async function pegar(page: Page, origem: Locator) {
  await origem.hover();
  const b = await caixa(origem);
  const x = b.x + Math.min(20, b.width / 3);
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y + 1);
  await page.evaluate(() => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok()))));
  expect(await fantasma(page).count(), "abaixo de 4 px o arraste não começa").toBe(0);
  await page.mouse.move(x + 8, y + 6, { steps: 3 });
  await expect(fantasma(page), "passado o limiar, o fantasma aparece").toBeVisible();
}

/** Leva o ponteiro até o centro de `alvo`, recentrando: o vão que abre empurra o alvo para o lado. NÃO solta. */
async function levar(page: Page, alvo: Locator) {
  for (let i = 0; i < 3; i++) {
    const b = await caixa(alvo);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: i === 0 ? 12 : 4 });
  }
}

async function soltar(page: Page) {
  await page.mouse.up();
  await expect(fantasma(page), "soltou: o fantasma some").toHaveCount(0);
}

/** Esc no meio do arraste: cancela (nada muda); o botão é solto depois. */
async function cancelarArraste(page: Page) {
  await page.keyboard.press("Escape");
  await expect(fantasma(page), "Esc cancela o arraste").toHaveCount(0);
  await page.mouse.up();
}

/* ─────────── medição ─────────── */

const css = (l: Locator, props: string[], pseudo: string | null = null) =>
  l.evaluate((el, a) => { const cs = getComputedStyle(el, a.pseudo); return a.props.map((p) => cs.getPropertyValue(p)); }, { props, pseudo });
const geo = (l: Locator) => l.evaluate((el) => { const q = el.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height, direita: q.right, baixo: q.bottom }; });
/** O elemento-folha dentro de `l` cujo texto casa com `re` — o rótulo do campo, o "LINHA 1", o rótulo de grupo. */
const folha = (l: Locator, re: RegExp, props: string[]) =>
  l.evaluate((el, a) => {
    const alvo = [el, ...el.querySelectorAll("*")].find((e) => e.children.length === 0 && new RegExp(a.fonte, a.flags).test((e.textContent ?? "").trim()));
    if (!alvo) return null;
    const cs = getComputedStyle(alvo);
    return a.props.map((p) => cs.getPropertyValue(p));
  }, { fonte: re.source, flags: re.flags, props });
const medir = (nome: string, real: unknown, esperado: unknown) => expect.soft(real, nome).toEqual(esperado);
const suave = expect.configure({ soft: true });
/** Tira o ponteiro de cima de tudo (o hover muda borda, fundo e sombra). */
const ponteiroFora = (page: Page) => page.mouse.move(4, (page.viewportSize()?.height ?? 900) - 4);

/** Rótulos VISÍVEIS do formulário, na ordem do DOM (sem o " *" do obrigatório). */
const rotulosDoFormulario = (page: Page) => page.getByTestId("b1-form").locator("label").evaluateAll((els) =>
  els.filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; }).map((e) => (e.textContent ?? "").replace(/\s*\*\s*$/, "").trim()));

/* ═════════════════════════════════════════════ ciclo de cada caso ═════════════════════════════════════════════ */

test.beforeEach(async ({ page }) => {
  // recarregar com a tela suja dispara o beforeunload REAL do shell (`workspace-tabs`); aceitar aqui só deixa a
  // navegação seguir — a guarda tem o próprio spec (workspace-tabs.spec.ts)
  page.on("dialog", (d) => { void d.accept(); });
  await login(page);
  await limparPreferencias(page);
});

test.afterEach(async ({ page }) => {
  await limparPreferencias(page);
});

/* ═════════════════════════════════════════════ CL-1 medidas-chave ═════════════════════════════════════════════ */

/* CL-1 usa expect.soft: uma divergência não esconde as seguintes; o caso reprova do mesmo jeito. */
test("CL-1 — medidas-chave do desenho na consulta e na edição (1440×900): barra, documento, faixas, linhas, campos, coluna, trilho, inspetor e dica", async ({ page }) => {
  const M = MEDIDAS;
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await ponteiroFora(page);

  // ── BARRA: cartão branco (borda, raio 12, sombra) e interior de 44 com padding 0 8
  const cartao = page.locator('[data-parte="barra"]');
  medir("barra: cartão (fundo, borda, largura, raio, sombra)", await css(cartao, ["background-color", "border-top-color", "border-top-width", "border-top-left-radius", "box-shadow"]),
    [M.barra.fundo, M.barra.borda, M.barra.bordaLargura, M.barra.raio, M.barra.sombra]);
  const interior = await barra(page).evaluate((el) => [el.clientHeight, getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]);
  medir("barra: interior de 44 com padding 0 8", interior, [M.barra.interior, M.barra.padding, M.barra.padding]);

  // ── BOTÕES REDONDOS (consulta: Voltar e Editar layout)
  const voltar = barra(page).getByLabel("Voltar", { exact: true });
  for (const [nome, b] of [["Voltar", voltar], ["Editar layout", botao(page, "Editar layout")]] as const) {
    const g = await geo(b);
    medir(`${nome}: 25×25`, [r(g.w), r(g.h)], [M.botao.lado, M.botao.lado]);
    medir(`${nome}: fundo, raio e sombra`, await css(b, ["background-color", "border-top-left-radius", "box-shadow"]), [M.botao.fundo, M.botao.raio, M.botao.sombra]);
    const icone = b.locator("svg").first();
    const gi = await geo(icone);
    medir(`${nome}: ícone de 16 px`, [r(gi.w), r(gi.h)], [M.botao.iconeLado, M.botao.iconeLado]);
    medir(`${nome}: cor do ícone`, await css(icone, ["color"]), [M.botao.icone]);
  }
  await expect(botao(page, "Restaurar padrão"), "Restaurar fica desabilitado na consulta").toBeDisabled();
  medir("desabilitado: opacidade .42", await css(botao(page, "Restaurar padrão"), ["opacity"]), [M.botao.opacidadeDesabilitado]);

  // ── DIVISOR 1×18 (#e4e8ec, margem 0 3) e o espaço do grupo (6)
  const divisores = await barra(page).evaluate((el) => [...el.querySelectorAll("*")]
    .filter((e) => { const q = e.getBoundingClientRect(); return Math.round(q.width) === 1 && Math.round(q.height) === 18; })
    .map((e) => { const cs = getComputedStyle(e); return { fundo: cs.backgroundColor, margem: [cs.marginLeft, cs.marginRight], x: e.getBoundingClientRect().left }; }));
  medir("há divisor 1×18 na barra", divisores.length > 0, true);
  medir("divisor: cor e margem 0 3", [divisores[0]?.fundo, divisores[0]?.margem], [M.divisor.cor, M.divisor.margem]);
  medir("Voltar → divisor: 6 do grupo + 3 de margem", r((divisores[0]?.x ?? 0) - (await geo(voltar)).direita), M.divisor.deVoltar);
  medir("no grupo: 6 px entre Pré-visualizar e Restaurar", r((await geo(botao(page, "Restaurar padrão"))).x - (await geo(botao(page, "Pré-visualizar formulário"))).direita), M.barra.noGrupo);

  // ── DOCUMENTO: cartão de raio 14; 8 px abaixo da barra; 12 px embaixo; a página não rola
  const documento = page.locator('[data-parte="documento"]');
  medir("documento: fundo, borda, raio e sombra", await css(documento, ["background-color", "border-top-color", "border-top-left-radius", "box-shadow"]),
    [M.documento.fundo, M.documento.borda, M.documento.raio, M.documento.sombra]);
  const gCartao = await geo(cartao); const gDoc = await geo(documento);
  medir("8 px entre a barra e o documento", r(gDoc.y - gCartao.baixo), M.pagina.barraAteDocumento);
  medir("barra e documento com as mesmas laterais", [r(gDoc.x), r(gDoc.direita)], [r(gCartao.x), r(gCartao.direita)]);
  const fundoDaArea = await documento.evaluate((el) => { const m = el.closest("main"); return m ? m.getBoundingClientRect().bottom : window.innerHeight; });
  medir("12 px embaixo (posição: ±1)", Math.abs(r(fundoDaArea - gDoc.baixo) - M.pagina.embaixo) <= 1, true);
  const rolagem = await page.evaluate(() => { const s = document.scrollingElement ?? document.documentElement; const m = document.querySelector("main"); return [s.scrollHeight - s.clientHeight, m ? m.scrollHeight - m.clientHeight : 0]; });
  medir("a página não rola (rolam por dentro a coluna, as linhas e o inspetor)", rolagem.every((v) => v <= 1), true);

  // ── FAIXA DE PAINÉIS: 38, #fbfcfd, padding 0 10 0 8, sem traço; aba 12,5/500 #64748b; ativa #15803d/600 com traço 2 #22a85c
  const faixaPaineis = page.locator('[data-parte="faixa-paineis"]');
  medir("faixa de painéis: 38 px", r((await geo(faixaPaineis)).h), M.faixaPaineis.altura);
  medir("faixa de painéis: fundo, padding e sem traço embaixo", await css(faixaPaineis, ["background-color", "padding-left", "padding-right", "border-bottom-width"]),
    [M.faixaPaineis.fundo, ...M.faixaPaineis.padding, M.faixaPaineis.bordaBaixo]);
  medir("aba ativa: 12,5 · 600 · #15803d · padding 12 · gap 6 · traço 2 #22a85c", await css(abaPainel(page, "principal"), ["font-size", "font-weight", "color", "padding-left", "column-gap", "border-bottom-width", "border-bottom-color"]),
    [M.aba.fonte, M.aba.ativaPeso, M.aba.ativaCor, M.aba.padding, M.aba.gap, M.aba.traco, M.aba.tracoCor]);
  medir("aba: 12,5 · 500 · #64748b", await css(abaPainel(page, "p_depreciacao"), ["font-size", "font-weight", "color"]), [M.aba.fonte, M.aba.peso, M.aba.cor]);

  // ── FAIXA DE CARDS: 34 + 1 de borda #f1f4f6, padding 0 10 0 16, gap 6; pílula 23 (#f4f6f7, 11,5/500 #6b7280); ativa verde
  const faixaCards = page.locator('[data-parte="faixa-cards"]');
  medir("faixa de cards: 34 + 1 de borda", r((await geo(faixaCards)).h), M.faixaCards.caixa);
  medir("faixa de cards: borda, padding e gap", await css(faixaCards, ["border-bottom-width", "border-bottom-color", "padding-left", "padding-right", "column-gap"]),
    ["1px", M.faixaCards.borda, ...M.faixaCards.padding, M.faixaCards.gap]);
  medir("pílula: 23 px", r((await geo(pilula(page, "geral"))).h), M.pilula.altura);
  medir("pílula ativa: padding 11 · borda · fundo · #15803d · 600 · 11,5", await css(pilula(page, "geral"), ["padding-left", "border-top-color", "background-color", "color", "font-weight", "font-size"]),
    [M.pilula.padding, M.pilula.ativaBorda, M.pilula.ativaFundo, M.pilula.ativaCor, M.pilula.ativaPeso, M.pilula.fonte]);
  medir("pílula: fundo · cor · 500", await css(pilula(page, "veiculo"), ["background-color", "color", "font-weight"]), [M.pilula.fundo, M.pilula.cor, M.pilula.peso]);

  // ── ÁREA DAS LINHAS e LINHA
  medir("área das linhas: padding 12 16 14", await css(page.locator('[data-parte="area-linhas"]'), ["padding-top", "padding-right", "padding-bottom", "padding-left"]), [...M.areaLinhas.padding]);
  medir("linha: borda 1 #e7eaee, raio 12, sombra", await css(linhaDoCard(page, 0), ["border-top-width", "border-top-color", "border-top-left-radius", "box-shadow"]), ["1px", M.linha.borda, M.linha.raio, M.linha.sombra]);
  medir("10 px entre linhas", r((await geo(linhaDoCard(page, 1))).y - (await geo(linhaDoCard(page, 0))).baixo), M.linha.entreLinhas);
  medir("cabeçalho: 32 px", r((await geo(cabecaDaLinha(page, 0))).h), M.cabeca.altura);
  medir("cabeçalho: padding 0 6 0 11 e borda #f4f6f8", await css(cabecaDaLinha(page, 0), ["padding-left", "padding-right", "border-bottom-width", "border-bottom-color"]), [...M.cabeca.padding, "1px", M.cabeca.bordaBaixo]);
  medir("\"LINHA 1\": 11 · 700 · maiúsculas · .05em · #8492a3", await folha(cabecaDaLinha(page, 0), /^linha\s+1$/i, ["font-size", "font-weight", "text-transform", "letter-spacing", "color"]),
    [M.cabeca.titulo.fonte, M.cabeca.titulo.peso, M.cabeca.titulo.caixa, M.cabeca.titulo.espaco, M.cabeca.titulo.cor]);
  await expect(contador(page, 0)).toHaveText("3/7");
  await expect(contador(page, 1)).toHaveText("6/7");
  medir("x/y: 10,5 · 700 · linha 15 · padding 1 8 · raio 999", await css(contador(page, 0), ["font-size", "font-weight", "line-height", "padding-top", "padding-left", "border-top-left-radius"]),
    [M.contador.fonte, M.contador.peso, M.contador.linha, ...M.contador.padding, M.contador.raio]);
  medir("x/y comum: #f1f5f9 / #64748b", await css(contador(page, 0), ["background-color", "color"]), [...M.contador.comum]);
  medir("x/y com 1 vaga: #fef3c7 / #92400e", await css(contador(page, 1), ["background-color", "color"]), [...M.contador.umaVaga]);

  // ── CORPO e CAMPOS: padding 9 10; 1º campo a 18 px; 8 entre campos; campo 30, raio 8, #e7ebef/#f4f6f7, padding 0 4 0 9
  const corpo = linhaDoCard(page, 0).locator('[data-parte="corpo-linha"]');
  medir("corpo: padding 9 10", await css(corpo, ["padding-top", "padding-left"]), [...M.corpo.padding]);
  const gCorpo = await geo(corpo); const gCodigo = await geo(campo(page, "code")); const gDescricao = await geo(campo(page, "description"));
  medir("o 1º campo fica a 18 px da borda interna", r(gCodigo.x - gCorpo.x), M.corpo.primeiro);
  medir("8 px entre campos", r(gDescricao.x - gCodigo.direita), M.corpo.entreCampos);
  const tipo = campo(page, "equipment_type");
  medir("campo: 30 px", r((await geo(tipo)).h), M.campo.altura);
  medir("campo: raio, borda, fundo e padding 0 4 0 9", await css(tipo, ["border-top-left-radius", "border-top-width", "border-top-color", "background-color", "padding-left", "padding-right"]),
    [M.campo.raio, "1px", M.campo.borda, M.campo.fundo, ...M.campo.padding]);
  medir("rótulo do campo: 12 · 500 · #1e293b", await folha(tipo, exato(rotulo("equipment_type")), ["font-size", "font-weight", "color"]), [...M.campo.rotulo]);
  const descricao = campo(page, "description");
  medir("obrigatório: padding esquerdo 13", await css(descricao, ["padding-left"]), [M.campo.obrigatorioPadding]);
  medir("obrigatório: barra vermelha de 3 px, 4 px do topo e da base (::before)", await css(descricao, ["background-color", "width", "top", "bottom"], "::before"), [M.campo.vermelho, ...M.campo.barra]);
  const asterisco = descricao.locator('[title="Obrigatório"]');
  await expect(asterisco, "o \"*\" do obrigatório").toHaveText("*");
  medir("\"*\": #dc2626 · 16 · 700", await css(asterisco, ["color", "font-size", "font-weight"]), [M.campo.vermelho, ...M.campo.asterisco]);
  medir("somente leitura (Código, só leitura na definição): rótulo #5b6875", await folha(campo(page, "code"), exato(rotulo("code")), ["color"]), [M.campo.soLeituraCor]);
  const larguras = await page.locator('[data-parte="area-linhas"] [data-parte="campo"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  medir("régua 1/limite: com 3, 6 ou 2 campos na linha, todo campo do card inteiro tem a mesma largura", Math.max(...larguras) - Math.min(...larguras) <= 1, true);

  // ── LINHA CHEIA (card meio Veículo, 4/4): #dcfce7 / #166534
  await pilula(page, "veiculo").click();
  await expect(contador(page, 0)).toHaveText("4/4");
  await ponteiroFora(page);
  medir("x/y cheia: #dcfce7 / #166534", await css(contador(page, 0), ["background-color", "color"]), [...M.contador.cheia]);
  await pilula(page, "geral").click();

  // ── DICA: 11,5 · 500 · linha 16 · #f8fafc sobre #1e293b · raio 6 · padding 4 8
  const preVisualizar = botao(page, "Pré-visualizar formulário");
  await preVisualizar.hover();
  const pseudoDaDica = () => preVisualizar.evaluate((el) => (["::after", "::before"] as const).find((p) => getComputedStyle(el, p).content.includes("Pré-visualizar")) ?? null);
  await suave.poll(pseudoDaDica, { message: "a dica é um pseudo-elemento de [data-dica] com o texto" }).not.toBeNull();
  const qual = await pseudoDaDica();
  if (qual) medir("dica: 11,5 · 500 · 16 · #f8fafc · #1e293b · raio 6 · padding 4 8", await css(preVisualizar, ["font-size", "font-weight", "line-height", "color", "background-color", "border-top-left-radius", "padding-top", "padding-left"], qual),
    [M.dica.fonte, M.dica.peso, M.dica.linha, M.dica.cor, M.dica.fundo, M.dica.raio, ...M.dica.padding]);

  // ══ EDIÇÃO ══
  await editar(page);
  await mostrarDisponiveis(page);
  await ponteiroFora(page);

  // ── COLUNA: 250, borda direita #eef1f4, fundo transparente; abas numa faixa de 38 sem traço; contadores
  const gColuna = await geo(coluna(page));
  medir("coluna: 250 px", r(gColuna.w), M.coluna.largura);
  medir("coluna: borda direita e fundo transparente", await css(coluna(page), ["border-right-width", "border-right-color", "background-color"]), ["1px", M.coluna.borda, M.coluna.fundo]);
  const listaDeAbas = coluna(page).getByRole("tablist", { name: "Lista de campos" });
  medir("abas da coluna: 38 px sem traço embaixo", [r((await geo(listaDeAbas)).h), (await css(listaDeAbas, ["border-bottom-width"]))[0]], [M.abasDaColuna.altura, M.abasDaColuna.bordaBaixo]);
  medir("Disponíveis (ativa): 12,5 · 600 · #15803d", await css(abaDaColuna(page, "Disponíveis"), ["font-size", "font-weight", "color"]), [M.abasDaColuna.fonte, M.abasDaColuna.ativaPeso, M.abasDaColuna.ativaCor]);
  medir("Em uso: 12,5 · 500 · #64748b", await css(abaDaColuna(page, "Em uso"), ["font-size", "font-weight", "color"]), [M.abasDaColuna.fonte, M.abasDaColuna.peso, M.abasDaColuna.cor]);
  const estiloContador = ["border-top-left-radius", "padding-top", "padding-left", "font-size", "font-weight", "background-color", "color"];
  const C = M.contadorDaColuna;
  medir("contador ativo: pílula 999 · 2 9 · 11 · 600 · #dcfce7 / #166534", await folha(abaDaColuna(page, "Disponíveis"), /^\d+$/, estiloContador), [C.raio, ...C.padding, C.fonte, C.peso, ...C.ativo]);
  medir("contador inativo: #f1f5f9 / #334155", await folha(abaDaColuna(page, "Em uso"), /^\d+$/, estiloContador), [C.raio, ...C.padding, C.fonte, C.peso, ...C.inativo]);

  // ── BUSCA: caixa 30, raio 8, #f6f8fa, 10 px da lateral; texto 12,5/500; placeholder #8b939e/400
  const busca = coluna(page).locator('[data-parte="busca"]');
  const gBusca = await geo(busca);
  medir("busca: 30 px e 10 px da lateral", [r(gBusca.h), r(gBusca.x - gColuna.x)], [M.busca.altura, M.busca.recuo]);
  medir("busca: raio e fundo", await css(busca, ["border-top-left-radius", "background-color"]), [M.busca.raio, M.busca.fundo]);
  const entrada = coluna(page).getByLabel("Procurar campo");
  medir("busca: texto 12,5 · 500", await css(entrada, ["font-size", "font-weight"]), [M.busca.fonte, M.busca.peso]);
  medir("busca: placeholder #8b939e · 400", await css(entrada, ["color", "font-weight"], "::placeholder"), [...M.busca.placeholder]);

  // ── LISTA e ITEM: padding 8 0 10; item 30, margem 0 10 6, raio 8, #e7ebef/#f4f6f7, padding 0 4 0 9, 12/500 #1e293b, grab
  medir("lista: padding 8 0 10", await css(coluna(page).locator('[data-parte="lista-campos"]'), ["padding-top", "padding-left", "padding-bottom"]), [...M.lista.padding]);
  const item = itemDaColuna(page, "patrimony");
  medir("item: 30 px", r((await geo(item)).h), M.item.altura);
  medir("item: margem, raio, borda, fundo, padding, fonte e cursor", await css(item, ["margin-top", "margin-right", "margin-bottom", "margin-left", "border-top-left-radius", "border-top-color", "background-color", "padding-left", "padding-right", "font-size", "font-weight", "color", "cursor"]),
    [...M.item.margem, M.item.raio, M.item.borda, M.item.fundo, ...M.item.padding, M.item.fonte, M.item.peso, M.item.cor, M.item.cursor]);

  // ── TRILHO: 38, #fbfcfd, borda direita #eef1f4; dois botões de 28 com 10 entre eles
  const gTrilho = await geo(trilho(page));
  medir("trilho: 38 px", r(gTrilho.w), M.trilho.largura);
  medir("trilho: fundo e borda direita", await css(trilho(page), ["background-color", "border-right-width", "border-right-color"]), [M.trilho.fundo, "1px", M.trilho.borda]);
  const botoesDoTrilho = trilho(page).getByRole("button");
  await expect(botoesDoTrilho).toHaveCount(2);
  const gb0 = await geo(botoesDoTrilho.nth(0)); const gb1 = await geo(botoesDoTrilho.nth(1));
  medir("trilho: botões 28×28 e 10 entre eles", [r(gb0.w), r(gb0.h), r(gb1.w), r(gb1.h), r(gb1.y - gb0.baixo)], [28, 28, 28, 28, M.trilho.entreBotoes]);

  // ── "+ CAMPO": 30, mínimo 74, tracejada #d7dee6, raio 8, #fbfcfd, 10,5/600 #9aa7b4; uma coluna + 14
  const maisCampo = linhaDoCard(page, 0).getByRole("button", { name: "Adicionar campo em Linha 1" });
  await expect(maisCampo).toHaveAttribute("data-parte", "mais-campo");
  medir("+ Campo: 30 px", r((await geo(maisCampo)).h), M.maisCampo.altura);
  medir("+ Campo: mínimo, borda, raio, fundo e texto", await css(maisCampo, ["min-width", "border-top-style", "border-top-color", "border-top-left-radius", "background-color", "font-size", "font-weight", "color"]),
    [M.maisCampo.minimo, M.maisCampo.estilo, M.maisCampo.borda, M.maisCampo.raio, M.maisCampo.fundo, M.maisCampo.fonte, M.maisCampo.peso, M.maisCampo.cor]);
  // a COLUNA da régua é o envoltório do campo (o vão de 8 px + o campo, `.chw` no desenho), não só o campo
  const coluna1 = await geo(campo(page, "code").locator(".."));
  medir("+ Campo mede uma coluna + 14 px (o padding de botão do navegador), como no desenho", Math.abs(r((await geo(maisCampo)).w) - (r(coluna1.w) + M.maisCampo.alemDaColuna)) <= 1, true);

  // ── ADICIONAR LINHA: 28, padding 0 14, pílula verde, 12/600 branco
  const adicionarLinha = page.getByRole("button", { name: "Adicionar linha", exact: true });
  medir("Adicionar linha: 28 px", r((await geo(adicionarLinha)).h), M.adicionarLinha.altura);
  medir("Adicionar linha: padding, raio, fundo e texto", await css(adicionarLinha, ["padding-left", "border-top-left-radius", "background-color", "color", "font-size", "font-weight"]),
    [M.adicionarLinha.padding, M.adicionarLinha.raio, M.adicionarLinha.fundo, M.adicionarLinha.cor, M.adicionarLinha.fonte, M.adicionarLinha.peso]);

  // ── PAINÉIS NA EDIÇÃO: + verde 25 (#40de63, ícone branco); lixeira 22 (raio 6, #94a3b8); grupo com borda esquerda
  const adicionarPainel = page.getByRole("button", { name: "Adicionar painel", exact: true });
  const gMais = await geo(adicionarPainel);
  medir("+ verde: 25×25", [r(gMais.w), r(gMais.h)], [M.maisVerde.lado, M.maisVerde.lado]);
  medir("+ verde: fundo e ícone", [(await css(adicionarPainel, ["background-color"]))[0], (await css(adicionarPainel.locator("svg").first(), ["color"]))[0]], [M.maisVerde.fundo, M.maisVerde.icone]);
  const excluirPainel = page.getByRole("button", { name: "Excluir painel", exact: true });
  const gLixeira = await geo(excluirPainel);
  medir("lixeira: 22×22, raio 6, #94a3b8", [r(gLixeira.w), r(gLixeira.h), ...(await css(excluirPainel, ["border-top-left-radius", "color"]))], [M.lixeira.lado, M.lixeira.lado, M.lixeira.raio, M.lixeira.cor]);
  medir("grupo da direita: borda esquerda #eef1f4, padding 8, margem 8", await css(adicionarPainel.locator(".."), ["border-left-width", "border-left-color", "padding-left", "margin-left"]),
    ["1px", M.grupoDireita.borda, M.grupoDireita.padding, M.grupoDireita.margem]);

  // ── INSPETOR: 292, borda esquerda; cabeçalho 38 (padding 0 10 0 14, borda #f1f4f6); corpo 12 14 16, gap 11
  await abrirInspetor(page, "equipment_type");
  await ponteiroFora(page);
  const I = M.inspetor;
  const insp = inspetor(page);
  medir("inspetor: 292 px", r((await geo(insp)).w), I.largura);
  medir("inspetor: borda esquerda e fundo", await css(insp, ["border-left-width", "border-left-color", "background-color"]), ["1px", I.borda, I.fundo]);
  const cabecaDoInspetor = insp.locator(":scope > *").first();
  medir("inspetor: cabeçalho de 38", r((await geo(cabecaDoInspetor)).h), I.cabeca);
  medir("inspetor: cabeçalho padding 0 10 0 14 e borda", await css(cabecaDoInspetor, ["padding-left", "padding-right", "border-bottom-width", "border-bottom-color"]), [...I.cabecaPadding, "1px", I.cabecaBorda]);
  medir("inspetor: nome 12,5 · 600 · #0f172a", await folha(cabecaDoInspetor, exato(rotulo("equipment_type")), ["font-size", "font-weight", "color"]), [...I.nome]);
  medir("inspetor: corpo padding 12 14 16 e gap 11", await css(insp.locator(":scope > *").nth(1), ["padding-top", "padding-left", "padding-bottom", "row-gap"]), [...I.corpoPadding, I.corpoGap]);
  medir("rótulo de grupo: 10,5 · 600 · maiúsculas · .03em · #8b95a3", await folha(insp, /^rótulo no formulário$/i, ["font-size", "font-weight", "text-transform", "letter-spacing", "color"]), [...I.grupo]);
  const caixaDoRotulo = await insp.getByLabel("Rótulo do campo").evaluate((el) => {
    for (let n: HTMLElement | null = el as HTMLElement, i = 0; n && i < 3; n = n.parentElement, i++) { const cs = getComputedStyle(n); if (cs.backgroundColor === "rgb(246, 248, 250)") return [Math.round(n.getBoundingClientRect().height), cs.borderTopLeftRadius]; }
    return null;
  });
  medir("caixa do inspetor: 30 px, raio 8, #f6f8fa", caixaDoRotulo, [I.caixa, I.caixaRaio]);
  const obrig = chave(page, "Obrigatório"); const visivel = chave(page, "Visível");
  const gChave = await geo(obrig);
  medir("chave: 34×20", [r(gChave.w), r(gChave.h)], [...I.chave]);
  medir("chave desligada #dfe4ea · ligada #40de63", [(await css(obrig, ["background-color"]))[0], (await css(visivel, ["background-color"]))[0]], [I.chaveDesligada, I.chaveLigada]);
  const bolinha = await obrig.evaluate((el) => { const k = [...el.querySelectorAll("*")].find((e) => Math.round(e.getBoundingClientRect().width) === Math.round(e.getBoundingClientRect().height) && e.getBoundingClientRect().width > 0); return k ? Math.round(k.getBoundingClientRect().width) : null; });
  medir("chave: bolinha de 14", bolinha, I.bolinha);
  const nenhum = insp.getByRole("button", { name: "Nenhum", exact: true });
  medir("segmentado 22 com botões de 18 (10,5 · 600)", [r((await geo(nenhum.locator(".."))).h), r((await geo(nenhum)).h), ...(await css(nenhum, ["font-size", "font-weight"]))], [I.segmentado, I.segmentadoBotao, ...I.segmentadoFonte]);
  const tipoComInspetor = campo(page, "equipment_type");
  medir("campo com o inspetor: borda #40de63", (await css(tipoComInspetor, ["border-top-color"]))[0], M.campoComInspetor.borda);
  medir("campo com o inspetor: ⚙ visível e verde", await css(tipoComInspetor.getByRole("button", { name: /^Propriedades de / }), ["background-color", "color"]), [...M.campoComInspetor.engrenagem]);
});

/* ═════════════════════════════════════════════ CL-2 modos ═════════════════════════════════════════════ */

test("CL-2 — modos: consulta sem ferramentas de edição; edição com tudo; Salvar sem alteração desabilitado; Publicar não existe; Padrão da organização e Restaurar por modo", async ({ page }) => {
  // premissas da definição (o que é "campo do sistema" e "só leitura" no equipments)
  expect(DEFINICAO?.fields.filter((f) => f.required).map((f) => f.name).sort(), "premissa: campos do sistema do equipments").toEqual([...DO_SISTEMA].sort());
  expect(DEFINICAO?.fields.filter((f) => f.readOnly).map((f) => f.name).sort(), "premissa: só leitura na definição").toEqual([...SO_LEITURA].sort());
  const permissao = await api<{ canEditOrg: boolean }>(page, "GET", PREFS);
  expect(permissao.canEditOrg, "PARAR: o admin do E2E precisa de canEditOrg (screen_layouts.edit) para o Padrão da organização").toBe(true);

  // ── SEM PERSONALIZAÇÃO — consulta
  await abrirTela(page);
  const publicar = page.getByRole("button", { name: /Publicar/ });
  await expect(botao(page, "Pré-visualizar formulário")).toBeVisible();
  await expect(publicar, "o Publicar do desenho é F1: não existe").toHaveCount(0);
  await expect(botao(page, "Salvar layout"), "a consulta não tem Salvar").toHaveCount(0);
  await expect(coluna(page), "consulta: sem coluna").toHaveCount(0);
  await expect(trilho(page), "consulta: sem trilho").toHaveCount(0);
  await expect(page.locator('[data-parte="mais-campo"]'), "consulta: sem \"+ Campo\"").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Adicionar linha" }), "consulta: sem Adicionar linha").toHaveCount(0);
  for (const nome of ["Adicionar painel", "Excluir painel", "Adicionar card", "Excluir card"]) await expect(page.getByRole("button", { name: nome, exact: true }), `consulta: sem ${nome}`).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remover Linha / }), "consulta: sem lixeira de linha").toHaveCount(0);
  await campo(page, "description").hover();
  await expect(campo(page, "description"), "o campo aparece na consulta").toBeVisible();
  await expect(page.getByRole("button", { name: /^Propriedades de / }), "consulta: sem ⚙").toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Tirar .+ do formulário$/ }), "consulta: sem ×").toHaveCount(0);
  await expect(botao(page, "Restaurar padrão"), "Restaurar desabilitado na consulta").toBeDisabled();
  // Padrão da organização: sem padrão gravado, só "Usar"
  const org = botao(page, "Padrão da organização");
  await expect(org).toBeEnabled();
  await org.click();
  await expect(page.getByRole("menuitem", { name: "Usar este layout como padrão da organização" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remover o padrão da organização" }), "sem padrão da organização não há o que remover").toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);

  // ── SEM PERSONALIZAÇÃO — edição
  await editar(page);
  await expect(coluna(page), "edição: coluna").toBeVisible();
  await expect(trilho(page), "edição: trilho").toBeVisible();
  await expect(page.locator('[data-parte="mais-campo"]').first(), "edição: \"+ Campo\" na linha com vaga").toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar linha", exact: true })).toBeVisible();
  for (const nome of ["Adicionar painel", "Excluir painel", "Adicionar card", "Excluir card"]) await expect(page.getByRole("button", { name: nome, exact: true }), `edição: ${nome}`).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover Linha 1", exact: true })).toBeVisible();
  await campo(page, "description").hover();
  await expect(campo(page, "description").getByRole("button", { name: `Propriedades de ${rotulo("description")}`, exact: true }), "edição: ⚙ no hover").toBeVisible();
  await expect(campo(page, "description").getByRole("button", { name: `Tirar ${rotulo("description")} do formulário`, exact: true }), "edição: × no hover").toBeVisible();
  await expect(botao(page, "Editar layout"), "a edição não tem Editar").toHaveCount(0);
  const salvarB = botao(page, "Salvar layout");
  await expect(salvarB, "sem alteração, Salvar desabilitado").toBeDisabled();
  await expect(salvarB).toHaveAttribute("data-dica", "Nada mudou ainda");
  await expect(botao(page, "Desfazer")).toBeDisabled();
  await expect(botao(page, "Refazer")).toBeDisabled();
  await expect(publicar, "Publicar não existe na edição").toHaveCount(0);
  await expect(org, "Padrão da organização desabilitado na edição").toBeDisabled();
  await expect(org).toHaveAttribute("data-dica", "Salve antes de mexer no padrão da organização");
  await expect(botao(page, "Restaurar padrão"), "sem personalização do usuário, Restaurar desabilitado").toBeDisabled();
  await expect(botao(page, "Restaurar padrão")).toHaveAttribute("data-dica", "Já está no padrão");
  await botao(page, "Descartar alterações").click();

  // ── COM PERSONALIZAÇÃO E PADRÃO DA ORGANIZAÇÃO — as marcas aparecem na consulta; Restaurar só na edição
  const comMarcas = layoutBase();
  comMarcas.hiddenFieldIds.push("model");
  comMarcas.lockedFieldIds.push("brand");
  comMarcas.fieldDefaultValues["hour_meter"] = "10";
  await gravarLayout(page, layoutBase(), "org");
  await gravarLayout(page, comMarcas);
  await abrirTela(page);
  await expect(marca(campo(page, "model"), "Oculto no formulário"), "consulta: olho cortado no oculto").toHaveCount(1);
  await expect(marca(campo(page, "brand"), "Somente leitura"), "consulta: cadeado no somente leitura").toHaveCount(1);
  await expect(marca(campo(page, "hour_meter"), "Tem valor padrão"), "consulta: raio no valor padrão").toHaveCount(1);
  await expect(marca(campo(page, "status"), "Tem valor padrão"), "campo sem valor padrão não tem o raio").toHaveCount(0);
  await expect(botao(page, "Restaurar padrão"), "na consulta, Restaurar continua desabilitado").toBeDisabled();
  await org.click();
  await expect(page.getByRole("menuitem", { name: "Usar este layout como padrão da organização" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Remover o padrão da organização" }), "com padrão da organização, o menu oferece remover").toBeVisible();
  await page.keyboard.press("Escape");
  await editar(page);
  await expect(botao(page, "Restaurar padrão"), "com personalização do usuário, Restaurar habilitado na edição").toBeEnabled();
  await expect(botao(page, "Restaurar padrão")).toHaveAttribute("data-dica", "Restaurar padrão");
});

/* ═════════════════════════════════════════════ CL-3 arrastar para uma linha ═════════════════════════════════════════════ */

test("CL-3 — arrastar de Disponíveis para uma linha com vaga: limiar, fantasma, vão com o nome, posição, x/y, ponto na aba e Salvar verde; Esc e soltar fora não mudam nada", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  await mostrarDisponiveis(page);
  await expect(contador(page, 0)).toHaveText("3/7");
  await expect(abaDaColuna(page, "Disponíveis")).toHaveAccessibleName(/^Disponíveis\s*9$/);
  await expect.poll(() => fidsDisponiveis(page), "premissa: Disponíveis lista os nove campos fora do formulário, na ordem da definição").toEqual(FORA_DO_FORMULARIO);
  await expect(abaDoWorkspace(page), "premissa: sem alteração, a aba do workspace não tem ponto").toHaveAttribute("data-dirty", "false");

  await pegar(page, itemDaColuna(page, "patrimony"));
  await expect(fantasma(page)).toHaveAttribute("data-tipo", "disponivel");
  await expect(fantasma(page), "o fantasma é uma cópia do item").toContainText(rotulo("patrimony"));
  await expect(itemDaColuna(page, "patrimony"), "o item sai da lista na hora").toBeHidden();
  await levar(page, campo(page, "description"));
  const vao = linhaDoCard(page, 0).locator('[data-parte="vao"]', { hasText: rotulo("patrimony") });
  await expect(vao, "o vão abre na linha, com o nome do campo").toBeVisible();
  const xVao = (await caixa(vao)).x;
  expect(xVao, "o vão abre ANTES de Descrição").toBeLessThan((await caixa(campo(page, "description"))).x);
  expect((await caixa(campo(page, "code"))).x, "e depois de Código").toBeLessThan(xVao);
  await expect(linhaDoCard(page, 0).locator('[data-parte="mais-campo"]'), "com o ponteiro num alvo da linha, o \"+ Campo\" some").toHaveCount(0);
  await soltar(page);

  await expect.poll(() => fidsDaLinha(page, 0), "o campo entra na posição apontada").toEqual(["code", "patrimony", "description", "empresa_id"]);
  await expect(contador(page, 0), "o x/y sobe").toHaveText("4/7");
  await expect(itemDaColuna(page, "patrimony")).toHaveCount(0);
  await expect(abaDaColuna(page, "Disponíveis")).toHaveAccessibleName(/^Disponíveis\s*8$/);
  await expect(abaDoWorkspace(page), "alteração: o ponto aparece na aba do workspace").toHaveAttribute("data-dirty", "true");
  const salvarB = botao(page, "Salvar layout");
  await expect(salvarB).toBeEnabled();
  await expect(salvarB).toHaveAttribute("data-dica", "Salvar layout");
  await ponteiroFora(page);
  await expect.poll(() => css(salvarB, ["background-color"]), { message: "Salvar com alteração: verde #40de63" }).toEqual([VERDE]);
  await expect.poll(() => css(salvarB.locator("svg").first(), ["color"]), { message: "ícone branco" }).toEqual([BRANCO]);

  // Esc cancela (item j): o vão aberto fecha e nada muda
  await pegar(page, itemDaColuna(page, "color"));
  await levar(page, campo(page, "model"));
  await expect(linhaDoCard(page, 2).locator('[data-parte="vao"]', { hasText: rotulo("color") })).toBeVisible();
  await cancelarArraste(page);
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["brand", "model"]);
  await expect(itemDaColuna(page, "color"), "Esc: o item volta para Disponíveis").toBeVisible();

  // soltar fora de qualquer alvo (a barra) não muda nada — no desenho valeria o último alvo mirado
  await pegar(page, itemDaColuna(page, "color"));
  await levar(page, campo(page, "brand"));
  await expect(linhaDoCard(page, 2).locator('[data-parte="vao"]', { hasText: rotulo("color") })).toBeVisible();
  const gBarra = await caixa(barra(page));
  await page.mouse.move(gBarra.x + gBarra.width / 2, gBarra.y + gBarra.height / 2, { steps: 8 });
  await expect(linhaDoCard(page, 2).locator('[data-parte="vao"]', { hasText: rotulo("color") }), "fora de alvo, o vão fecha").toHaveCount(0);
  await soltar(page);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["code", "patrimony", "description", "empresa_id"], LINHA_2_DADOS, ["brand", "model"]]);
  await expect(itemDaColuna(page, "color")).toBeVisible();
});

/* ═════════════════════════════════════════════ CL-4 linha cheia ═════════════════════════════════════════════ */

test("CL-4 — linha cheia: da coluna troca (o de lá vai para Disponíveis); sobre campo do sistema recusa; entre linhas troca com o eco, também com campo do sistema", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  await mostrarDisponiveis(page);
  await pilula(page, "veiculo").click();
  await expect(contador(page, 0), "premissa: card meio com a linha cheia").toHaveText("4/4");
  await expect(linhaDoCard(page, 0)).toHaveAttribute("data-cheia", "true");
  await expect(linhaDoCard(page, 0).locator('[data-parte="mais-campo"]'), "linha cheia não tem \"+ Campo\"").toHaveCount(0);

  // (a) da coluna sobre um campo comum: TROCA — o novo entra no lugar, o de lá vai para Disponíveis
  await pegar(page, itemDaColuna(page, "patrimony"));
  await levar(page, campo(page, "renavam"));
  await expect(campo(page, "renavam"), "linha cheia: o campo vira alvo de troca").toHaveAttribute("data-troca", "ok");
  await expect(campo(page, "renavam")).toHaveAttribute("title", `Trocar de lugar com ${rotulo("patrimony")}`);
  await expect(linhaDoCard(page, 0).locator('[data-parte="vao"]', { hasText: rotulo("patrimony") }), "linha cheia não abre vão").toHaveCount(0);
  // com o ponteiro EM CIMA do alvo, o hover do campo vence a borda da troca — calculado do desenho (#c6d0da, fundo branco)
  await suave.poll(() => css(campo(page, "renavam"), ["border-top-color", "background-color"]), { message: "troca sob o ponteiro: borda #c6d0da, fundo branco" }).toEqual(["rgb(198, 208, 218)", BRANCO]);
  await soltar(page);
  await expect.poll(() => fidsDaLinha(page, 0)).toEqual(["chassis", "patrimony", "year_model", "plate"]);
  await expect(itemDaColuna(page, "renavam"), "o campo de lá vai para Disponíveis").toBeVisible();
  await expect(itemDaColuna(page, "patrimony")).toHaveCount(0);

  // (b) da coluna sobre o campo do sistema: RECUSA (vermelho, ✕) e nada muda
  await pegar(page, itemDaColuna(page, "color"));
  await levar(page, campo(page, "year_model"));
  await expect(campo(page, "year_model")).toHaveAttribute("data-troca", "recusa");
  await expect(campo(page, "year_model")).toHaveAttribute("title", "Campo do sistema — não sai do formulário");
  await suave.poll(() => css(campo(page, "year_model"), ["border-top-color", "background-color"]), { message: "recusa: borda #dc2626, fundo #fdf5f5 (vence o hover)" }).toEqual(["rgb(220, 38, 38)", "rgb(253, 245, 245)"]);
  await soltar(page);
  await expect.poll(() => fidsDaLinha(page, 0), "recusa: nada muda").toEqual(["chassis", "patrimony", "year_model", "plate"]);
  await expect(itemDaColuna(page, "color")).toBeVisible();

  // (c) entre linhas: os dois trocam de lugar, e o lugar de origem mostra o eco "↔ <campo da linha cheia>"
  await pegar(page, campo(page, "serial_number"));
  await expect(fantasma(page)).toHaveAttribute("data-tipo", "campo");
  await levar(page, campo(page, "chassis"));
  await expect(campo(page, "chassis")).toHaveAttribute("data-troca", "ok");
  const eco = linhaDoCard(page, 1).locator('[data-parte="eco"]');
  await expect(eco, "o eco no lugar de origem").toBeVisible();
  await expect(eco).toContainText(`↔ ${rotulo("chassis")}`);
  await expect(eco).toHaveAttribute("title", `${rotulo("chassis")} vem para cá`);
  await soltar(page);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["serial_number", "patrimony", "year_model", "plate"], ["chassis", "plate_state"]]);

  // (d) entre linhas também com o campo do sistema (ele não sai do formulário, só muda de lugar)
  await pegar(page, campo(page, "plate_state"));
  await levar(page, campo(page, "year_model"));
  await expect(campo(page, "year_model"), "entre linhas, o campo do sistema também troca").toHaveAttribute("data-troca", "ok");
  await expect(linhaDoCard(page, 1).locator('[data-parte="eco"]')).toContainText(`↔ ${rotulo("year_model")}`);
  await soltar(page);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["serial_number", "patrimony", "plate_state", "plate"], ["chassis", "year_model"]]);
  await expect(itemDaColuna(page, "year_model"), "o campo do sistema continua no formulário").toHaveCount(0);
});

/* ═════════════════════════════════════════════ CL-5 coluna, "+", ×, trilho e "+ Campo" ═════════════════════════════════════════════ */

test("CL-5 — soltar na coluna tira o campo; o do sistema recusa; × do sistema desabilitado; \"+\" e × sem arrastar; Usar todos e Tirar todos; \"+ Campo\" marca a linha", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  await mostrarDisponiveis(page);

  // ── "+ Campo": marca a linha, abre Disponíveis com o foco na busca; o próximo "+" vai para ela até ela encher
  await abaDaColuna(page, "Em uso").click();
  await linhaDoCard(page, 0).getByRole("button", { name: "Adicionar campo em Linha 1", exact: true }).click();
  await expect(linhaDoCard(page, 0), "a linha fica marcada como destino").toHaveAttribute("data-marcada", "true");
  await expect(abaDaColuna(page, "Disponíveis"), "o clique abre a aba Disponíveis").toHaveAttribute("aria-selected", "true");
  await expect(coluna(page).getByLabel("Procurar campo"), "e põe o foco na busca").toBeFocused();
  for (const fid of ["patrimony", "color", "residual_percent"]) await adicionarPeloMais(page, fid);
  await expect.poll(() => fidsDaLinha(page, 0), "o \"+\" vai para a linha marcada").toEqual(["code", "description", "empresa_id", "patrimony", "color", "residual_percent"]);
  await expect(linhaDoCard(page, 0)).toHaveAttribute("data-marcada", "true");
  await adicionarPeloMais(page, "life_years");
  await expect(contador(page, 0)).toHaveText("7/7");
  await expect(linhaDoCard(page, 0), "a marca acaba quando a linha enche").not.toHaveAttribute("data-marcada", "true");
  await adicionarPeloMais(page, "depreciation_percent");
  await expect.poll(() => fidsDaLinha(page, 2), "sem marca, o \"+\" volta a empurrar: a última linha do card").toEqual(["brand", "model", "depreciation_percent"]);

  // ── SOLTAR NA COLUNA: o campo sai do formulário
  await recomecar(page);
  await mostrarDisponiveis(page);
  await pegar(page, campo(page, "brand"));
  await levar(page, coluna(page));
  await expect(coluna(page)).toHaveAttribute("data-soltar", "ok");
  await expect(caixaDeSoltar(page)).toHaveText("Solte para tirar do formulário");
  await soltar(page);
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["model"]);
  await expect(itemDaColuna(page, "brand"), "o campo tirado aparece em Disponíveis").toBeVisible();

  // campo do sistema: caixa vermelha e nada muda
  await pegar(page, campo(page, "description"));
  await levar(page, coluna(page));
  await expect(coluna(page)).toHaveAttribute("data-soltar", "sistema");
  await expect(caixaDeSoltar(page)).toHaveText("Campo do sistema não sai do formulário");
  await soltar(page);
  await expect.poll(() => fidsDaLinha(page, 0), "o campo do sistema fica onde estava").toEqual(["code", "description", "empresa_id"]);
  await expect(itemDaColuna(page, "description")).toHaveCount(0);

  // item que veio da própria coluna: "Este campo já está aqui"
  await pegar(page, itemDaColuna(page, "patrimony"));
  await levar(page, coluna(page).locator('[data-parte="lista-campos"]'));
  await expect(coluna(page)).toHaveAttribute("data-soltar", "ja-esta");
  await expect(caixaDeSoltar(page)).toHaveText("Este campo já está aqui");
  await soltar(page);
  await expect(itemDaColuna(page, "patrimony")).toBeVisible();

  // ── × DO CAMPO DO SISTEMA: desabilitado no campo e em Em uso
  await campo(page, "description").hover();
  const xNoCampo = campo(page, "description").getByRole("button", { name: `Tirar ${rotulo("description")} do formulário`, exact: true });
  await expect(xNoCampo, "× do campo do sistema desabilitado").toBeDisabled();
  await expect(xNoCampo).toHaveAttribute("data-dica", "Campo do sistema — não sai do formulário");
  await abaDaColuna(page, "Em uso").click();
  const xEmUso = itemDaColuna(page, "description").getByRole("button", { name: `Tirar ${rotulo("description")} do formulário`, exact: true });
  await expect(xEmUso, "× de Em uso do campo do sistema desabilitado").toBeDisabled();
  await expect(xEmUso).toHaveAttribute("data-dica", "Campo do sistema — não sai");
  await expect(itemDaColuna(page, "description"), "Em uso: dica do item").toHaveAttribute("title", "Já está no formulário");

  // ── "+" e × SEM ARRASTAR
  const xModelo = itemDaColuna(page, "model").getByRole("button", { name: `Tirar ${rotulo("model")} do formulário`, exact: true });
  await expect(xModelo).toHaveAttribute("data-dica", "Tirar do formulário");
  await xModelo.click();
  await expect(campo(page, "model"), "× de Em uso tira o campo do formulário").toHaveCount(0);
  await mostrarDisponiveis(page);
  await expect(itemDaColuna(page, "patrimony"), "Disponíveis: dica do item").toHaveAttribute("title", "Segure e arraste para uma linha");
  await adicionarPeloMais(page, "patrimony");
  await expect.poll(() => fidsDaLinha(page, 2), "\"+\": vai para a última linha do card aberto").toEqual(["patrimony"]);
  await tirarPeloX(page, "patrimony");
  await expect(itemDaColuna(page, "patrimony"), "× do campo devolve para Disponíveis").toBeVisible();

  // ── USAR TODOS e TIRAR TODOS (trilho)
  await recomecar(page);
  await mostrarDisponiveis(page);
  const usarTodos = trilho(page).getByRole("button", { name: "Usar todos · 9 campos", exact: true });
  await expect(usarTodos).toHaveAttribute("data-dica", "Usar todos · 9 campos");
  await usarTodos.click();
  await expect(coluna(page).locator('[data-parte="vazio-coluna"]')).toContainText("Todos os campos estão no formulário.");
  await expect(coluna(page).locator('[data-parte="vazio-coluna"]')).toContainText("Para liberar um campo, tire-o de uma linha.");
  await expect.poll(() => fidsDasLinhas(page), "Usar todos empurra: completa a última linha e abre linhas novas, na ordem da definição").toEqual([
    ["code", "description", "empresa_id"], LINHA_2_DADOS,
    ["brand", "model", "patrimony", "color", "vehicle", "residual_percent", "life_years"],
    ["depreciation_percent", "use_fiscal", "features", "specification"]
  ]);
  await expect(trilho(page).getByRole("button", { name: "Nada disponível para usar", exact: true })).toBeDisabled();
  const tirarTodos = trilho(page).getByRole("button", { name: "Tirar todos · 16 campos", exact: true });
  await tirarTodos.click();
  await expect.poll(async () => (await fidsDasLinhas(page)).flat().sort(), "Tirar todos deixa só os campos do sistema do card").toEqual(["description", "empresa_id", "family_id", "hour_value"]);
  await expect(trilho(page).getByRole("button", { name: "Nada para tirar deste card", exact: true })).toBeDisabled();
  await expect(abaDaColuna(page, "Disponíveis")).toHaveAccessibleName(/^Disponíveis\s*16$/);
});

/* ═════════════════════════════════════════════ CL-6 reordenar e identidade da linha ═════════════════════════════════════════════ */

test("CL-6 — reordenar linha, painel e card; salvar e recarregar sem o cache local (order renumerado) e chegar ao formulário; identidade da linha", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);

  // LINHA: a Linha 3 (Marca, Modelo) vai para o topo — traço verde acima da linha de destino
  await pegar(page, cabecaDaLinha(page, 2));
  await expect(fantasma(page)).toHaveAttribute("data-tipo", "linha");
  await levar(page, cabecaDaLinha(page, 0));
  const traco = page.locator('[data-parte="traco-linha"]');
  await expect(traco, "o traço verde aparece").toBeVisible();
  expect((await caixa(traco)).y, "o traço fica acima da Linha 1").toBeLessThan((await caixa(linhaDoCard(page, 0))).y + 4);
  await soltar(page);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["brand", "model"], ["code", "description", "empresa_id"], LINHA_2_DADOS]);

  // PAINEL: Outros vai para antes de Principal — vão verde com o nome
  await pegar(page, abaPainel(page, "p_outros"));
  await expect(fantasma(page)).toHaveAttribute("data-tipo", "painel");
  await levar(page, abaPainel(page, "principal"));
  await expect(page.locator('[data-parte="faixa-paineis"] [data-parte="vao-faixa"]', { hasText: "Outros" }), "o vão da aba com o nome").toBeVisible();
  await soltar(page);
  await expect.poll(() => idsDasAbas(page)).toEqual(["p_outros", "principal", "p_depreciacao"]);

  // CARD: Veículo vai para antes de Dados
  await abaPainel(page, "principal").click();
  await pegar(page, pilula(page, "veiculo"));
  await expect(fantasma(page)).toHaveAttribute("data-tipo", "card");
  await levar(page, pilula(page, "geral"));
  await expect(page.locator('[data-parte="faixa-cards"] [data-parte="vao-faixa"]', { hasText: "Veículo" }), "o vão da pílula com o nome").toBeVisible();
  await soltar(page);
  await expect.poll(() => idsDasPilulas(page)).toEqual(["veiculo", "geral"]);

  // SALVAR: o documento leva a ordem nova com `order` renumerado (painéis 1..n; cards 1..n no array inteiro) e linhas r1..rN
  const { preferences: doc } = await salvar(page);
  expect(doc.panels.map((p) => [p.id, p.order]), "painéis na ordem nova, order 1..n").toEqual([["p_outros", 1], ["principal", 2], ["p_depreciacao", 3]]);
  expect(doc.cards.map((c) => c.order), "cards: order 1..n na ordem do array").toEqual(doc.cards.map((_, i) => i + 1));
  const ordemDosCards = doc.cards.map((c) => c.id);
  expect(ordemDosCards.indexOf("veiculo"), "Veículo antes de Dados").toBeLessThan(ordemDosCards.indexOf("geral"));
  const geral = doc.cards.find((c) => c.id === "geral");
  expect(geral?.rows.map((x) => x.id), "linhas renumeradas r1..rN").toEqual(["r1", "r2", "r3"]);
  expect(geral?.rows.map((x) => x.fieldIds)).toEqual([["brand", "model"], ["code", "description", "empresa_id"], LINHA_2_DADOS]);

  // RECARREGAR SEM O CACHE LOCAL: a ordem vem do servidor
  await limparCacheLocal(page);
  await page.reload();
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  const servidor = await api<{ user: { preferences: FormLayout } | null }>(page, "GET", PREFS);
  expect(servidor.user?.preferences.panels.map((p) => p.id), "o servidor guardou a ordem dos painéis").toEqual(["p_outros", "principal", "p_depreciacao"]);
  expect(servidor.user?.preferences.cards.map((c) => c.label), "sem card \"Outros campos\"").not.toContain("Outros campos");
  await expect.poll(() => idsDasAbas(page)).toEqual(["p_outros", "principal", "p_depreciacao"]);
  await abaPainel(page, "principal").click();
  await expect.poll(() => idsDasPilulas(page)).toEqual(["veiculo", "geral"]);
  await pilula(page, "geral").click();
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["brand", "model"], ["code", "description", "empresa_id"], LINHA_2_DADOS]);

  // O FORMULÁRIO SEGUE A ORDEM SALVA
  await page.goto(FORMULARIO);
  const form = page.getByTestId("b1-form");
  await expect(form).toBeVisible();
  await expect(form.getByRole("tab"), "painéis na ordem salva").toHaveText(["Outros", "Principal", "Depreciação"]);
  await form.getByRole("tab", { name: "Principal" }).click();
  await expect(form.getByLabel(/^Chassi/)).toBeVisible();
  const ordem = await rotulosDoFormulario(page);
  const pos = (t: string) => { const i = ordem.indexOf(t); expect(i, `o formulário mostra ${t}`).toBeGreaterThanOrEqual(0); return i; };
  expect(pos(rotulo("chassis")), "o card Veículo vem antes de Dados").toBeLessThan(pos(rotulo("brand")));
  expect(pos(rotulo("brand")), "a linha de Marca foi para o topo de Dados").toBeLessThan(pos(rotulo("description")));
  expect(pos(rotulo("description"))).toBeLessThan(pos(rotulo("family_id")));

  // IDENTIDADE DA LINHA: Linha 2 para o topo → Salvar → Editar → Remover a Linha 2 → só ela sai
  await page.goto(TELA);
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  await editar(page);
  await abaPainel(page, "principal").click();
  await pilula(page, "geral").click();
  await pegar(page, cabecaDaLinha(page, 1));
  await levar(page, cabecaDaLinha(page, 0));
  await soltar(page);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["code", "description", "empresa_id"], ["brand", "model"], LINHA_2_DADOS]);
  const { preferences: doc2 } = await salvar(page);
  expect(doc2.cards.find((c) => c.id === "geral")?.rows.map((x) => x.id), "ids de linha únicos, pela posição").toEqual(["r1", "r2", "r3"]);
  await editar(page);
  await abaPainel(page, "principal").click();
  await pilula(page, "geral").click();
  await page.getByRole("button", { name: "Remover Linha 2", exact: true }).click();
  await expect.poll(() => fidsDasLinhas(page), "só a Linha 2 sai").toEqual([["code", "description", "empresa_id"], LINHA_2_DADOS]);
  await mostrarDisponiveis(page);
  await expect(itemDaColuna(page, "brand"), "os campos da linha voltam para Disponíveis").toBeVisible();
  await expect(itemDaColuna(page, "model")).toBeVisible();
});

/* ═════════════════════════════════════════════ CL-7 painéis, cards e linhas ═════════════════════════════════════════════ */

test("CL-7 — painéis, cards e linhas: adicionar (Enter grava, Esc cancela), excluir com os campos voltando, desabilitados com um só e com campo do sistema, setas quando a faixa não cabe, largura meio divide a linha", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  await mostrarDisponiveis(page);
  const excluirPainel = page.getByRole("button", { name: "Excluir painel", exact: true });
  const excluirCard = page.getByRole("button", { name: "Excluir card", exact: true });

  // ── LARGURA: inteiro → meio divide a linha de 6 campos (4 + 2), com o empacotamento do normalizador, só neste card
  await page.getByRole("button", { name: "Card inteiro — clique para meio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Card meio — clique para inteiro", exact: true })).toBeVisible();
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["code", "description", "empresa_id"], ["family_id", "equipment_type", "proprietary_id", "status"], ["hour_value", "hour_meter"], ["brand", "model"]]);
  await expect(contador(page, 1), "o limite do card meio é 4").toHaveText("4/4");
  await expect(contador(page, 2)).toHaveText("2/4");

  // ── LINHAS: com campo do sistema não sai; sem ele, sai e os campos voltam
  await recomecar(page);
  await mostrarDisponiveis(page);
  const removerL1 = page.getByRole("button", { name: "Remover Linha 1", exact: true });
  await expect(removerL1).toBeDisabled();
  await expect(removerL1).toHaveAttribute("data-dica", "Esta linha tem campo do sistema, que não sai do formulário");
  await page.getByRole("button", { name: "Remover Linha 3", exact: true }).click();
  await expect(linhaDoCard(page, 2)).toHaveCount(0);
  await expect(itemDaColuna(page, "brand"), "Remover linha: os campos voltam para Disponíveis").toBeVisible();
  await expect(itemDaColuna(page, "model")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar linha", exact: true }).click();
  await expect(contador(page, 2), "Adicionar linha: linha vazia no fim do card").toHaveText("0/7");

  // ── PAINEL NOVO: "Painel 4" já em renomear; Enter grava; vem com um card "Dados" inteiro e a Linha 1 vazia
  await recomecar(page);
  await mostrarDisponiveis(page);
  await page.getByRole("button", { name: "Adicionar painel", exact: true }).click();
  const renomearPainel = page.getByRole("textbox", { name: "Renomear painel" });
  await expect(renomearPainel).toBeFocused();
  await expect(renomearPainel, "Painel N, N = quantos painéis passam a existir").toHaveValue("Painel 4");
  await renomearPainel.fill("Manutenção");
  await renomearPainel.press("Enter");
  await expect(renomearPainel).toHaveCount(0);
  const novoPainel = page.locator('[data-parte="aba-painel"]').last();
  await expect(novoPainel).toContainText("Manutenção");
  await expect(novoPainel).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-parte="pilula-card"]')).toHaveCount(1);
  await expect(page.locator('[data-parte="pilula-card"]').first()).toContainText("Dados");
  await expect(contador(page, 0), "card do painel novo: inteiro, com a Linha 1 vazia").toHaveText("0/7");
  await expect(excluirCard, "um card só não se exclui").toBeDisabled();
  await expect(excluirCard).toHaveAttribute("data-dica", "O painel precisa de ao menos um card");
  await expect(removerL1, "uma linha só não se remove").toBeDisabled();
  await expect(removerL1).toHaveAttribute("data-dica", "O card precisa de ao menos uma linha");

  // ── CARD NOVO: "Card 2" já em renomear; Esc cancela o nome
  await page.getByRole("button", { name: "Adicionar card", exact: true }).click();
  const renomearCard = page.getByRole("textbox", { name: "Renomear card" });
  await expect(renomearCard, "Card N, N = quantos cards o painel passa a ter").toHaveValue("Card 2");
  await renomearCard.fill("Descartado");
  await renomearCard.press("Escape");
  await expect(renomearCard).toHaveCount(0);
  const cardNovo = page.locator('[data-parte="pilula-card"]').last();
  await expect(cardNovo, "Esc cancela: o nome fica o de antes").toContainText("Card 2");
  await expect(cardNovo).not.toContainText("Descartado");
  await cardNovo.click();
  await expect(contador(page, 0), "card novo nasce inteiro").toHaveText("0/7");

  // ── EXCLUIR CARD com campo: o campo volta para Disponíveis
  await adicionarPeloMais(page, "color");
  await expect.poll(() => fidsDaLinha(page, 0)).toEqual(["color"]);
  await expect(excluirCard).toBeEnabled();
  await expect(excluirCard).toHaveAttribute("data-dica", "Excluir este card");
  await excluirCard.click();
  await expect(page.locator('[data-parte="pilula-card"]')).toHaveCount(1);
  await expect(itemDaColuna(page, "color"), "Excluir card: o campo volta").toBeVisible();

  // ── EXCLUIR PAINEL com campo: o campo volta para Disponíveis
  await page.locator('[data-parte="pilula-card"]').first().click();
  await adicionarPeloMais(page, "color");
  await expect(excluirPainel).toBeEnabled();
  await expect(excluirPainel).toHaveAttribute("data-dica", "Excluir este painel");
  await excluirPainel.click();
  await expect(page.locator('[data-parte="aba-painel"]')).toHaveCount(3);
  await expect(itemDaColuna(page, "color"), "Excluir painel: o campo volta").toBeVisible();

  // ── COM CAMPO DO SISTEMA, painel e card não se excluem
  await abaPainel(page, "principal").click();
  await expect(excluirPainel).toBeDisabled();
  await expect(excluirPainel).toHaveAttribute("data-dica", "Este painel tem campo do sistema, que não sai do formulário");
  await pilula(page, "veiculo").click();
  await expect(excluirCard).toBeDisabled();
  await expect(excluirCard).toHaveAttribute("data-dica", "Este card tem campo do sistema, que não sai do formulário");

  // ── SETAS: cria painéis até a faixa não caber; a aba ativa fica à vista; o + e a lixeira não saem; uma aba por clique
  await recomecar(page);
  const anteriores = page.getByRole("button", { name: "Painéis anteriores", exact: true });
  const proximos = page.getByRole("button", { name: "Próximos painéis", exact: true });
  await expect(anteriores, "premissa: com 3 painéis a faixa cabe e não há setas").toHaveCount(0);
  let criados = 0;
  while ((await anteriores.count()) === 0 && criados < 20) {
    await page.getByRole("button", { name: "Adicionar painel", exact: true }).click();
    await page.getByRole("textbox", { name: "Renomear painel" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "Renomear painel" })).toHaveCount(0);
    criados++;
  }
  expect(criados, "a faixa deixa de caber antes de 20 painéis novos").toBeLessThan(20);
  await expect(anteriores).toBeVisible();
  await expect(proximos).toBeVisible();
  const ultima = page.locator('[data-parte="aba-painel"]').last();
  await expect(ultima).toHaveAttribute("aria-selected", "true");
  const aVista = () => page.locator('[data-parte="aba-painel"]').evaluateAll((els) => els.map((e) => {
    const q = e.getBoundingClientRect(); if (!q.width) return false;
    const alvo = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return !!alvo && (alvo === e || e.contains(alvo));
  }));
  await expect.poll(async () => (await aVista()).at(-1), { message: "a aba ativa fica à vista" }).toBe(true);
  expect((await aVista())[0], "a primeira aba saiu da janela").toBe(false);
  await expect(page.getByRole("button", { name: "Adicionar painel", exact: true }), "a faixa não empurra o +").toBeInViewport();
  await expect(excluirPainel, "nem a lixeira").toBeInViewport();
  const primeiraAntes = (await aVista()).indexOf(true);
  await anteriores.click();
  await expect.poll(async () => (await aVista()).indexOf(true), { message: "uma aba por clique" }).toBe(primeiraAntes - 1);
  for (let i = 0; i < 25 && (await anteriores.isEnabled()); i++) await anteriores.click();
  await expect.poll(async () => (await aVista())[0], { message: "as setas levam de volta à primeira aba" }).toBe(true);

  // ── UM PAINEL SÓ: a lixeira do painel fica desabilitada
  await botao(page, "Descartar alterações").click();
  const umPainel = layoutBase();
  umPainel.panels = [umPainel.panels[0]!];
  umPainel.cards = umPainel.cards.map((c) => ({ ...c, panelId: "principal" }));
  await gravarLayout(page, umPainel);
  await abrirTela(page);
  await editar(page);
  await expect(page.locator('[data-parte="aba-painel"]')).toHaveCount(1);
  await expect(excluirPainel, "um painel só não se exclui").toBeDisabled();
  await expect(excluirPainel, "o motivo na dica (o painel único tem também os campos do sistema)").toHaveAttribute("data-dica", /^(O formulário precisa de ao menos um painel|Este painel tem campo do sistema, que não sai do formulário)$/);
});

/* ═════════════════════════════════════════════ CL-8 inspetor ═════════════════════════════════════════════ */

test("CL-8 — inspetor: rótulo e Voltar ao nome do sistema; Obrigatório liga Visível e desliga Somente leitura num passo; travas do sistema e do só leitura; Valor padrão Fixo; marcas; Pré-visualizar; tipos", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  // não abre na consulta
  await campo(page, "brand").focus();
  await page.keyboard.press("Enter");
  await expect(campo(page, "brand")).toBeVisible();
  await expect(inspetor(page), "o inspetor não abre na consulta").toHaveCount(0);
  await editar(page);
  const insp = inspetor(page);

  // ⚙ abre o inspetor: o rótulo e o tipo em pílula
  await abrirInspetor(page, "brand");
  await expect(insp).toHaveAttribute("aria-label", "Propriedades do campo");
  await expect(insp).toContainText(rotulo("brand"));
  await expect(insp.getByText("Texto", { exact: true }), "tipo do campo: Texto").toBeVisible();

  // ── VALOR PADRÃO: Fixo com a caixa vazia não grava; com texto, o raio aparece; Nenhum apaga a chave
  const nenhum = insp.getByRole("button", { name: "Nenhum", exact: true });
  const fixo = insp.getByRole("button", { name: "Fixo", exact: true });
  await expect(nenhum).toHaveAttribute("aria-pressed", "true");
  await fixo.click();
  const caixaFixo = insp.getByLabel("Valor padrão fixo");
  await expect(caixaFixo).toBeVisible();
  await expect(caixaFixo).toHaveAttribute("placeholder", "valor que já vem preenchido");
  await expect(botao(page, "Salvar layout"), "Fixo com a caixa vazia não grava \"\": nada mudou").toBeDisabled();
  await expect(marca(campo(page, "brand"), "Tem valor padrão")).toHaveCount(0);
  await caixaFixo.fill("Volvo");
  await expect(marca(campo(page, "brand"), "Tem valor padrão"), "valor padrão: o raio aparece no campo").toHaveCount(1);
  await expect(botao(page, "Salvar layout")).toBeEnabled();
  await nenhum.click();
  await expect(caixaFixo).toHaveCount(0);
  await expect(marca(campo(page, "brand"), "Tem valor padrão")).toHaveCount(0);
  await expect(botao(page, "Salvar layout"), "Nenhum apaga a chave: o rascunho volta ao salvo").toBeDisabled();

  // ── RÓTULO: o nome do sistema é o placeholder; "Voltar ao nome do sistema" só com rótulo próprio
  const caixaRotulo = insp.getByLabel("Rótulo do campo");
  const voltarNome = insp.getByRole("button", { name: "Voltar ao nome do sistema", exact: true });
  await expect(caixaRotulo).toHaveAttribute("placeholder", rotulo("brand"));
  await expect(caixaRotulo).toHaveValue("");
  await expect(voltarNome).toBeDisabled();
  await caixaRotulo.fill("Marca do bem");
  await expect(campo(page, "brand"), "o campo mostra o rótulo do layout").toHaveAccessibleName("Marca do bem");
  await expect(voltarNome).toBeEnabled();
  await voltarNome.click();
  await expect(caixaRotulo).toHaveValue("");
  await expect(campo(page, "brand")).toHaveAccessibleName(rotulo("brand"));
  await expect(voltarNome).toBeDisabled();

  // ── OBRIGATÓRIO liga Visível e desliga Somente leitura, num passo só da pilha
  await abrirInspetor(page, "model");
  await expect(insp).toContainText(rotulo("model"));
  await expect(chave(page, "Obrigatório")).toHaveAttribute("aria-checked", "false");
  await expect(chave(page, "Visível")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Somente leitura")).toHaveAttribute("aria-checked", "false");
  await chave(page, "Visível").click();
  await expect(campo(page, "model"), "Visível desligado: o campo continua na linha, oculto").toHaveAttribute("data-oculto", "true");
  await expect(marca(campo(page, "model"), "Oculto no formulário")).toHaveCount(1);
  await chave(page, "Somente leitura").click();
  await expect(marca(campo(page, "model"), "Somente leitura")).toHaveCount(1);
  await chave(page, "Obrigatório").click();
  await expect(chave(page, "Obrigatório")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Visível"), "ligar Obrigatório liga Visível").toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Somente leitura"), "e desliga Somente leitura").toHaveAttribute("aria-checked", "false");
  await expect(campo(page, "model")).toHaveAttribute("data-obrigatorio", "true");
  await expect(campo(page, "model").locator('[title="Obrigatório"]'), "o \"*\" aparece").toHaveText("*");
  await botao(page, "Desfazer").click();
  await expect(chave(page, "Obrigatório"), "um Desfazer devolve os três (um passo só)").toHaveAttribute("aria-checked", "false");
  await expect(chave(page, "Visível")).toHaveAttribute("aria-checked", "false");
  await expect(chave(page, "Somente leitura")).toHaveAttribute("aria-checked", "true");

  // ── PRÉ-VISUALIZAR esconde o oculto; a linha fica sem ele e o x/y continua contando
  const preVisualizar = botao(page, "Pré-visualizar formulário");
  await preVisualizar.click();
  await expect(preVisualizar).toHaveAttribute("aria-pressed", "true");
  await expect(campo(page, "brand")).toBeVisible();
  await expect(campo(page, "model"), "Pré-visualizar esconde o campo com Visível desligado").toBeHidden();
  await expect(contador(page, 2), "o x/y continua contando o oculto").toHaveText("2/7");
  await preVisualizar.click();
  await expect(preVisualizar).toHaveAttribute("aria-pressed", "false");
  await expect(campo(page, "model")).toBeVisible();

  // "só nesse sentido": com Obrigatório ligado, ligar Somente leitura não mexe no Obrigatório
  await botao(page, "Refazer").click();
  await expect(chave(page, "Obrigatório")).toHaveAttribute("aria-checked", "true");
  await chave(page, "Somente leitura").click();
  await expect(chave(page, "Somente leitura")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Obrigatório"), "ligar Somente leitura não desliga Obrigatório").toHaveAttribute("aria-checked", "true");

  // ── TRAVAS: campo do sistema (Obrigatório e Visível ligados e travados); só leitura na definição (Somente leitura travada; Obrigatório não liga)
  await abrirInspetor(page, "description");
  await expect(chave(page, "Obrigatório")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Obrigatório"), "campo do sistema: Obrigatório travado").toBeDisabled();
  await expect(chave(page, "Visível")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Visível"), "campo do sistema: Visível travado").toBeDisabled();
  await abrirInspetor(page, "code");
  await expect(chave(page, "Somente leitura")).toHaveAttribute("aria-checked", "true");
  await expect(chave(page, "Somente leitura"), "só leitura na definição: travada").toBeDisabled();
  if (await chave(page, "Obrigatório").isEnabled()) await chave(page, "Obrigatório").click();
  await expect(chave(page, "Obrigatório"), "só leitura na definição: Obrigatório não liga").toHaveAttribute("aria-checked", "false");

  // ── FECHA pelo × e quando o campo sai do formulário
  await insp.getByRole("button", { name: "Fechar propriedades", exact: true }).click();
  await expect(inspetor(page)).toHaveCount(0);
  await abrirInspetor(page, "brand");
  await tirarPeloX(page, "brand");
  await expect(inspetor(page), "o campo saiu do formulário: o inspetor fecha").toHaveCount(0);

  // ── ENTER e ESPAÇO no campo focado abrem / trocam o inspetor; o tipo vem da definição
  await campo(page, "status").focus();
  await page.keyboard.press("Enter");
  await expect(insp).toContainText(rotulo("status"));
  await expect(insp.getByText("Lista", { exact: true }), "select → Lista").toBeVisible();
  await campo(page, "hour_value").focus();
  await page.keyboard.press(" ");
  await expect(insp).toContainText(rotulo("hour_value"));
  await expect(insp.getByText("Valor", { exact: true }), "money → Valor").toBeVisible();
  for (const [fid, tipo] of [["hour_meter", "Número"], ["proprietary_id", "Busca"]] as const) {
    await abrirInspetor(page, fid);
    await expect(insp.getByText(tipo, { exact: true }), `${fid} → ${tipo}`).toBeVisible();
  }
  await abaPainel(page, "p_depreciacao").click();
  for (const [fid, tipo] of [["has_depreciation", "Sim ou não"], ["acquisition_date", "Data"]] as const) {
    await abrirInspetor(page, fid);
    await expect(insp.getByText(tipo, { exact: true }), `${fid} → ${tipo}`).toBeVisible();
  }
});

/* ═════════════════════════════════════════════ CL-9 desfazer / refazer ═════════════════════════════════════════════ */

test("CL-9 — Desfazer e Refazer: três mudanças, desfazer até o começo apaga o ponto e desabilita o Salvar, refazer, mudança nova corta o refazer, digitar um rótulo é UMA entrada", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  await mostrarDisponiveis(page);
  const desfazer = botao(page, "Desfazer");
  const refazer = botao(page, "Refazer");
  const salvarB = botao(page, "Salvar layout");
  await expect(desfazer).toBeDisabled();
  await expect(refazer).toBeDisabled();

  await tirarPeloX(page, "brand");
  await tirarPeloX(page, "model");
  await adicionarPeloMais(page, "patrimony");
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["patrimony"]);
  await expect(abaDoWorkspace(page)).toHaveAttribute("data-dirty", "true");

  await desfazer.click();
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual([]);
  await desfazer.click();
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["model"]);
  await desfazer.click();
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["brand", "model"]);
  await expect(desfazer, "na ponta, Desfazer desabilita").toBeDisabled();
  await expect(salvarB, "desfazer até o começo desabilita o Salvar").toBeDisabled();
  await expect(abaDoWorkspace(page), "e apaga o ponto da aba").toHaveAttribute("data-dirty", "false");

  await expect(refazer).toBeEnabled();
  await refazer.click();
  await expect.poll(() => fidsDaLinha(page, 2)).toEqual(["model"]);
  await expect(salvarB).toBeEnabled();
  await expect(abaDoWorkspace(page)).toHaveAttribute("data-dirty", "true");
  await expect(refazer, "ainda há o que refazer").toBeEnabled();

  await tirarPeloX(page, "hour_meter");
  await expect(refazer, "mudança nova corta o refazer").toBeDisabled();

  // digitar um rótulo, tecla a tecla, é UMA entrada na pilha (fecha no Enter)
  await abrirInspetor(page, "status");
  const caixaRotulo = inspetor(page).getByLabel("Rótulo do campo");
  await caixaRotulo.pressSequentially("Situação do bem");
  await expect(campo(page, "status")).toHaveAccessibleName("Situação do bem");
  await caixaRotulo.press("Enter");
  await desfazer.click();
  await expect(campo(page, "status"), "um Desfazer apaga a digitação inteira").toHaveAccessibleName(rotulo("status"));
  await expect.poll(() => fidsDaLinha(page, 1), "e só ela: Horímetro continua fora").toEqual(["family_id", "equipment_type", "proprietary_id", "status", "hour_value"]);
  await desfazer.click();
  await expect.poll(() => fidsDaLinha(page, 1), "o Desfazer seguinte devolve Horímetro").toEqual(LINHA_2_DADOS);
});

/* ═════════════════════════════════════════════ CL-10 contrato ═════════════════════════════════════════════ */

test("CL-10 — contrato: o PUT leva só as chaves do FormLayout; recarregar sem o cache traz o mesmo layout, sem \"Outros campos\"; o formulário segue rótulo, oculto, obrigatório, somente leitura, valor padrão e ordem", async ({ page }) => {
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await editar(page);
  const insp = inspetor(page);

  // rótulo próprio (Marca → "Marca do bem")
  await abrirInspetor(page, "brand");
  await insp.getByLabel("Rótulo do campo").fill("Marca do bem");
  // oculto e MOVIDO (Modelo: Visível desligado, depois arrastado para o fim da Linha 1) — continua oculto
  await abrirInspetor(page, "model");
  await chave(page, "Visível").click();
  await expect(campo(page, "model")).toHaveAttribute("data-oculto", "true");
  await insp.getByRole("button", { name: "Fechar propriedades", exact: true }).click();
  await pegar(page, campo(page, "model"));
  await levar(page, cabecaDaLinha(page, 0));
  await expect(linhaDoCard(page, 0).locator('[data-parte="vao"]', { hasText: rotulo("model") }), "sobre o cabeçalho, o vão abre no fim").toBeVisible();
  await soltar(page);
  await expect.poll(() => fidsDaLinha(page, 0)).toEqual(["code", "description", "empresa_id", "model"]);
  await expect(campo(page, "model"), "mover não mexe no Visível").toHaveAttribute("data-oculto", "true");
  // obrigatório pelo layout (Horímetro/Km)
  await abrirInspetor(page, "hour_meter");
  await chave(page, "Obrigatório").click();
  await expect(chave(page, "Obrigatório")).toHaveAttribute("aria-checked", "true");
  // tirado do formulário (Tipo)
  await tirarPeloX(page, "equipment_type");
  // Veículo: somente leitura (Chassi) e valor padrão fixo (Série)
  await pilula(page, "veiculo").click();
  await abrirInspetor(page, "chassis");
  await chave(page, "Somente leitura").click();
  await abrirInspetor(page, "serial_number");
  await insp.getByRole("button", { name: "Fixo", exact: true }).click();
  await insp.getByLabel("Valor padrão fixo").fill("SERIE-01");

  const { preferences: doc } = await salvar(page);
  await expect(page.getByText("Layout salvo"), "o aviso de hoje").toBeVisible();
  expect(Object.keys(doc).sort(), "o documento salvo é o FormLayout de hoje, sem chave nova").toEqual(CHAVES_DO_DOCUMENTO);
  for (const p of doc.panels) expect(Object.keys(p).filter((k) => !["id", "label", "order", "hidden"].includes(k)), `painel ${p.id}: sem chave nova`).toEqual([]);
  for (const c of doc.cards) {
    expect(Object.keys(c).filter((k) => !["id", "panelId", "label", "order", "colSpan", "collapsible", "rows"].includes(k)), `card ${c.id}: sem chave nova`).toEqual([]);
    for (const x of c.rows) expect(Object.keys(x).sort(), `card ${c.id}: linha só com id e fieldIds`).toEqual(["fieldIds", "id"]);
    expect(c.rows.every((x) => x.fieldIds.length > 0), `card ${c.id}: linha vazia não é guardada`).toBe(true);
    expect(c.rows.map((x) => x.id), `card ${c.id}: linhas r1..rN`).toEqual(c.rows.map((_, i) => `r${i + 1}`));
  }
  expect(doc.version).toBe(1);
  expect(doc.fieldLabels, "rótulo → fieldLabels").toEqual({ brand: "Marca do bem" });
  expect([...doc.hiddenFieldIds].sort(), "o que sai das linhas e o oculto na linha → hiddenFieldIds").toEqual([...FORA_DO_FORMULARIO, "model", "equipment_type"].sort());
  expect(doc.requiredFieldIds, "obrigatório → requiredFieldIds").toEqual(["hour_meter"]);
  expect(doc.lockedFieldIds, "somente leitura → lockedFieldIds").toEqual(["chassis"]);
  expect(doc.fieldDefaultValues, "valor padrão → fieldDefaultValues, como texto").toEqual({ serial_number: "SERIE-01" });
  expect(doc.fieldSizes, "fieldSizes perde o editor; o valor salvo atravessa intacto").toEqual(layoutBase().fieldSizes);
  expect(doc.cards.find((c) => c.id === "geral")?.rows.map((x) => x.fieldIds)).toEqual([["code", "description", "empresa_id", "model"], ["family_id", "proprietary_id", "status", "hour_value", "hour_meter"], ["brand"]]);

  // RECARREGAR SEM O CACHE LOCAL: o mesmo layout, sem "Outros campos"
  await limparCacheLocal(page);
  await page.reload();
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  const servidor = await api<{ user: { preferences: FormLayout } | null }>(page, "GET", PREFS);
  expect(servidor.user?.preferences.cards.map((c) => c.label), "sem card \"Outros campos\"").toEqual(["Dados", "Veículo", "Depreciação", "Outros"]);
  await expect.poll(() => fidsDasLinhas(page)).toEqual([["code", "description", "empresa_id", "model"], ["family_id", "proprietary_id", "status", "hour_value", "hour_meter"], ["brand"]]);
  await expect(campo(page, "model"), "o oculto que foi movido continua oculto").toHaveAttribute("data-oculto", "true");
  await expect(page.locator('[data-parte="pilula-card"]', { hasText: "Outros campos" })).toHaveCount(0);
  await editar(page);
  await mostrarDisponiveis(page);
  await expect(itemDaColuna(page, "equipment_type"), "o campo tirado continua em Disponíveis").toBeVisible();
  await botao(page, "Descartar alterações").click();

  // O FORMULÁRIO: rótulo novo, sem o oculto e sem o tirado, "*" no obrigatório, travado, valor padrão e a ordem salva
  await page.goto(FORMULARIO);
  const form = page.getByTestId("b1-form");
  await expect(form).toBeVisible();
  await expect(form.getByRole("tab"), "painéis na ordem salva").toHaveText(["Principal", "Depreciação", "Outros"]);
  await expect(form.getByLabel(/^Marca do bem/), "rótulo novo").toBeVisible();
  await expect(form.getByLabel(rotulo("brand"), { exact: true }), "o rótulo antigo não aparece").toHaveCount(0);
  await expect(form.getByLabel(/^Modelo/), "o oculto não aparece").toHaveCount(0);
  await expect(form.getByLabel(/^Tipo( \*)?$/), "o campo tirado não aparece").toHaveCount(0);
  await expect(form.getByLabel(/^Horímetro\/Km\s*\*/), "o obrigatório pelo layout ganha o \"*\"").toBeVisible();
  await expect(form.getByLabel(/^Chassi/)).toBeVisible();
  await expect(form.getByLabel(/^Chassi/), "somente leitura: travado").not.toBeEditable();
  await expect(form.getByLabel(/^Série/), "valor padrão preenchido").toHaveValue("SERIE-01");
  const ordem = await rotulosDoFormulario(page);
  const pos = (t: string) => { const i = ordem.indexOf(t); expect(i, `o formulário mostra ${t}`).toBeGreaterThanOrEqual(0); return i; };
  const sequencia = [rotulo("description"), rotulo("family_id"), rotulo("hour_meter"), "Marca do bem", rotulo("chassis"), rotulo("serial_number")].map(pos);
  expect(sequencia, "o formulário segue a ordem salva (linhas e cards)").toEqual([...sequencia].sort((a, b) => a - b));
});

/* ═════════════════════════════════════════════ CL-11 descartar, restaurar, padrão da organização ═════════════════════════════════════════════ */

test("CL-11 — Descartar sem escrita; Restaurar com confirmação e DELETE ?scope=user (volta a seguir o padrão da organização); Padrão da organização por PUT e DELETE ?scope=org", async ({ page }) => {
  const permissao = await api<{ canEditOrg: boolean }>(page, "GET", PREFS);
  expect(permissao.canEditOrg, "PARAR: o admin do E2E precisa de canEditOrg (screen_layouts.edit) — sem isso o CL-11 não prova o padrão da organização").toBe(true);
  await gravarLayout(page, layoutBase());
  const antes = await api<{ user: { revision: number } | null }>(page, "GET", PREFS);
  await abrirTela(page);
  await editar(page);

  // ── DESCARTAR: zero escrita, volta ao salvo, sem perguntar
  const escritas = registrarEscritas(page);
  await tirarPeloX(page, "brand");
  await expect(botao(page, "Salvar layout")).toBeEnabled();
  await botao(page, "Descartar alterações").click();
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  await expect(page.getByTestId("confirm-dialog"), "Descartar não pergunta").toHaveCount(0);
  await expect.poll(() => fidsDaLinha(page, 2), "volta ao salvo").toEqual(["brand", "model"]);
  await page.waitForTimeout(600); // o envio de preferências tem debounce de 400 ms: passado ele, nenhuma escrita pode surgir
  expect(escritas.lista, "Descartar: ZERO escrita").toEqual([]);
  escritas.parar();
  const depois = await api<{ user: { revision: number } | null }>(page, "GET", PREFS);
  expect(depois.user?.revision, "a revisão no servidor não mudou").toBe(antes.user?.revision);

  // ── RESTAURAR: confirmação oficial; Voltar não apaga; confirmar = DELETE ?scope=user e volta à consulta no padrão
  await editar(page);
  const restaurar = botao(page, "Restaurar padrão");
  await expect(restaurar).toBeEnabled();
  await restaurar.click();
  const dlg = page.getByTestId("confirm-dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("heading", { name: "Restaurar padrão?" })).toBeVisible();
  await expect(dlg).toContainText("Apaga a sua personalização deste formulário e descarta o que não foi salvo. Você volta ao padrão da organização ou, sem ele, ao do sistema.");
  await expect(page.getByTestId("confirm-dialog-confirm")).toHaveText("Restaurar padrão");
  const escritas2 = registrarEscritas(page);
  await dlg.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  await expect(raiz(page), "Voltar mantém a edição").toHaveAttribute("data-modo", "edicao");
  await restaurar.click();
  const apagou = respostaDe(page, "DELETE", "user");
  await page.getByTestId("confirm-dialog-confirm").click();
  expect((await apagou).ok(), "Restaurar = DELETE ?scope=user").toBe(true);
  await expect(raiz(page)).toHaveAttribute("data-modo", "consulta");
  expect(escritas2.lista, "uma escrita só: o DELETE do confirmar").toEqual([`DELETE ${PREFS}?scope=user`]);
  escritas2.parar();
  await expect.poll(() => fidsDaLinha(page, 2), "volta ao padrão do sistema (a 3ª linha do card Dados do padrão)").toEqual(["hour_value", "hour_meter", "year_model", "brand", "model", "patrimony"]);
  expect((await api<{ user: unknown }>(page, "GET", PREFS)).user, "a personalização do usuário foi apagada").toBeNull();

  // ── PADRÃO DA ORGANIZAÇÃO: usar (PUT ?scope=org) e remover (DELETE ?scope=org)
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  const org = botao(page, "Padrão da organização");
  await org.click();
  await expect(page.getByRole("menuitem", { name: "Remover o padrão da organização" })).toHaveCount(0);
  const gravouOrg = respostaDe(page, "PUT", "org");
  await page.getByRole("menuitem", { name: "Usar este layout como padrão da organização" }).click();
  expect((await gravouOrg).ok(), "Usar como padrão = PUT ?scope=org").toBe(true);
  const comOrg = await api<{ org: { preferences: FormLayout } | null }>(page, "GET", PREFS);
  expect(comOrg.org?.preferences.cards.map((c) => c.rows.map((x) => x.fieldIds)), "o padrão da organização é o layout salvo").toEqual(layoutBase().cards.map((c) => c.rows.map((x) => x.fieldIds)));
  await org.click();
  const tirou = respostaDe(page, "DELETE", "org");
  await page.getByRole("menuitem", { name: "Remover o padrão da organização" }).click();
  expect((await tirou).ok(), "Remover = DELETE ?scope=org").toBe(true);
  expect((await api<{ org: unknown }>(page, "GET", PREFS)).org, "o padrão da organização foi apagado").toBeNull();

  // ── QUEM RESTAURA VOLTA A SEGUIR O PADRÃO DA ORGANIZAÇÃO
  await gravarLayout(page, layoutBase(), "org");
  const meu = layoutBase();
  meu.cards[0]!.rows[2] = linha("r3", "brand");
  meu.hiddenFieldIds.push("model");
  await gravarLayout(page, meu);
  await abrirTela(page);
  await expect.poll(() => fidsDaLinha(page, 2), "premissa: vale a personalização do usuário").toEqual(["brand"]);
  await editar(page);
  await botao(page, "Restaurar padrão").click();
  const apagou2 = respostaDe(page, "DELETE", "user");
  await page.getByTestId("confirm-dialog-confirm").click();
  expect((await apagou2).ok()).toBe(true);
  await expect.poll(() => fidsDaLinha(page, 2), "depois de restaurar, vale o padrão da organização").toEqual(["brand", "model"]);
  await editar(page);
  await expect(botao(page, "Restaurar padrão"), "seguindo o padrão da organização, Restaurar desabilita").toBeDisabled();
  await expect(botao(page, "Restaurar padrão")).toHaveAttribute("data-dica", "Já está no padrão");
  await botao(page, "Descartar alterações").click();
  // limpa no fim pela própria tela
  await org.click();
  const tirou2 = respostaDe(page, "DELETE", "org");
  await page.getByRole("menuitem", { name: "Remover o padrão da organização" }).click();
  expect((await tirou2).ok()).toBe(true);
});

/* ═════════════════════════════════════════════ CL-12 evidência ═════════════════════════════════════════════ */

/**
 * FOTOS DO PRODUTO por cena da seção 1 do pedido (as que o produto tem), em EVIDENCIA_DIR (padrão
 * test-results/visual-ux-03 — fora do commit). Os pares com o desenho e a tabela de medidas são do V1. Cada foto
 * confere antes que a página não tem rolagem horizontal.
 */
async function evidencia(page: Page, w: number, h: number) {
  const pasta = process.env.EVIDENCIA_DIR ?? path.join("test-results", "visual-ux-03");
  fs.mkdirSync(pasta, { recursive: true });
  await page.setViewportSize({ width: w, height: h });
  const foto = async (cena: string, arrastando = false) => {
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra, `${cena}: sem rolagem horizontal em ${w}×${h}`).toBeLessThanOrEqual(0);
    if (!arrastando) await ponteiroFora(page);
    await page.waitForTimeout(350); // assenta a transição mais longa da tela (--mo-set 340 ms)
    await page.screenshot({ path: path.join(pasta, `${cena}__produto__${w}x${h}.png`) });
  };
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  await foto("visualizando");
  await editar(page);
  await mostrarDisponiveis(page);
  await foto("editando");

  await pegar(page, itemDaColuna(page, "patrimony"));
  await levar(page, campo(page, "description"));
  await foto("arrastando", true);
  await cancelarArraste(page);
  await pegar(page, campo(page, "brand"));
  await levar(page, campo(page, "description"));
  await foto("arrastando-linha", true);
  await cancelarArraste(page);
  await pegar(page, campo(page, "brand"));
  await levar(page, coluna(page));
  await foto("arrastando-para-fora", true);
  await cancelarArraste(page);
  await pegar(page, cabecaDaLinha(page, 2));
  await levar(page, cabecaDaLinha(page, 0));
  await foto("movendo-linha", true);
  await cancelarArraste(page);
  await pegar(page, abaPainel(page, "p_outros"));
  await levar(page, abaPainel(page, "principal"));
  await foto("movendo-painel", true);
  await cancelarArraste(page);
  await pegar(page, pilula(page, "veiculo"));
  await levar(page, pilula(page, "geral"));
  await foto("movendo-card", true);
  await cancelarArraste(page);

  await pilula(page, "veiculo").click();
  await foto("linha-cheia");
  await pilula(page, "geral").click();
  await abaPainel(page, "p_depreciacao").click();
  await foto("depreciacao");
  await abaPainel(page, "principal").click();
  await abaDaColuna(page, "Em uso").click();
  await foto("em-uso");
  await mostrarDisponiveis(page);
  await coluna(page).getByLabel("Procurar campo").fill("val");
  await foto("buscando");
  await coluna(page).getByLabel("Procurar campo").fill("");
  await abaPainel(page, "principal").dblclick();
  await expect(page.getByRole("textbox", { name: "Renomear painel" })).toBeVisible();
  await foto("renomeando");
  await page.getByRole("textbox", { name: "Renomear painel" }).press("Escape");
  await pilula(page, "geral").dblclick();
  await expect(page.getByRole("textbox", { name: "Renomear card" })).toBeVisible();
  await foto("renomeando-card");
  await page.getByRole("textbox", { name: "Renomear card" }).press("Escape");
  await abrirInspetor(page, "status");
  await foto("inspetor");
  await inspetor(page).getByRole("button", { name: "Fechar propriedades", exact: true }).click();
  await tirarPeloX(page, "brand");
  await foto("alterado");
  await trilho(page).getByRole("button", { name: /^Usar todos/ }).click();
  await expect(coluna(page).locator('[data-parte="vazio-coluna"]')).toBeVisible();
  await foto("banco-vazio");

  await recomecar(page);
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Adicionar painel", exact: true }).click();
    await page.getByRole("textbox", { name: "Renomear painel" }).press("Enter");
  }
  await expect(page.locator('[data-parte="aba-painel"]')).toHaveCount(9);
  await foto("muitos-paineis");

  // Descartar volta ao salvo, e o painel aberto (o 9º, que não existe no salvo) cede o lugar ao último que existe
  await recomecar(page);
  await abaPainel(page, "principal").click();
  await pilula(page, "geral").click();
  await tirarPeloX(page, "brand");
  await salvar(page);
  await foto("salvo");
}

test("CL-12 — evidência do produto por cena em 1440×900, sem rolagem horizontal", async ({ page }) => {
  await evidencia(page, 1440, 900);
});

test("CL-12 — evidência do produto por cena em 1280×720 (a viewport do gate), sem rolagem horizontal", async ({ page }) => {
  await evidencia(page, 1280, 720);
});

/* ═════════════════════════════════════════════ CL-13 movimento reduzido ═════════════════════════════════════════════ */

/** Toda transição ou animação FINITA acima de 1 ms, e toda animação infinita ligada, na tela e no fantasma (com ::before/::after). */
const movimentoAcimaDe1ms = (page: Page) => page.evaluate(() => {
  const ms = (v: string) => v.split(",").map((s) => s.trim()).map((s) => (s.endsWith("ms") ? parseFloat(s) : parseFloat(s) * 1000));
  const quem = (el: Element, pseudo: string | null) => `${el.tagName.toLowerCase()}${el.getAttribute("data-parte") ? `[data-parte="${el.getAttribute("data-parte")}"]` : ""}${el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]` : ""}${pseudo ?? ""}`;
  const ofensas = new Set<string>();
  for (const raizDaTela of document.querySelectorAll('[data-testid="layout-config"], [data-parte="fantasma"]')) {
    for (const el of [raizDaTela, ...raizDaTela.querySelectorAll("*")]) {
      for (const pseudo of [null, "::before", "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
        if (cs.transitionProperty !== "none" && ms(cs.transitionDuration).some((d) => d > 1.0001)) ofensas.add(`${quem(el, pseudo)}: transição ${cs.transitionDuration} (${cs.transitionProperty})`);
        const nomes = cs.animationName.split(",").map((s) => s.trim());
        const duracoes = ms(cs.animationDuration);
        const vezes = cs.animationIterationCount.split(",").map((s) => s.trim());
        nomes.forEach((n, i) => {
          if (n === "none") return;
          if ((vezes[i] ?? vezes[0]) === "infinite") ofensas.add(`${quem(el, pseudo)}: animação infinita ${n}`);
          else if ((duracoes[i] ?? duracoes[0] ?? 0) > 1.0001) ofensas.add(`${quem(el, pseudo)}: animação ${n} ${cs.animationDuration}`);
        });
      }
    }
  }
  return [...ofensas];
});

test("CL-13 — prefers-reduced-motion: nenhuma transição ou animação finita da tela passa de 1 ms; respira e trocaPulso param", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gravarLayout(page, layoutBase());
  await abrirTela(page);
  expect(await movimentoAcimaDe1ms(page), "consulta").toEqual([]);
  await editar(page);
  await mostrarDisponiveis(page);
  await campo(page, "brand").hover();
  expect(await movimentoAcimaDe1ms(page), "edição, com o ⚙ e o × à vista").toEqual([]);
  await botao(page, "Pré-visualizar formulário").hover();
  expect(await movimentoAcimaDe1ms(page), "dica").toEqual([]);

  // arraste da coluna: o vão aberto ("respira") e o fantasma
  await pegar(page, itemDaColuna(page, "patrimony"));
  await levar(page, campo(page, "description"));
  await expect(linhaDoCard(page, 0).locator('[data-parte="vao"]', { hasText: rotulo("patrimony") })).toBeVisible();
  expect(await movimentoAcimaDe1ms(page), "arraste com o vão aberto e o fantasma").toEqual([]);
  await soltar(page);
  expect(await movimentoAcimaDe1ms(page), "o pouso").toEqual([]);

  // troca na linha cheia ("trocaPulso")
  await pilula(page, "veiculo").click();
  await pegar(page, itemDaColuna(page, "color"));
  await levar(page, campo(page, "renavam"));
  await expect(campo(page, "renavam")).toHaveAttribute("data-troca", "ok");
  expect(await movimentoAcimaDe1ms(page), "troca na linha cheia").toEqual([]);
  await cancelarArraste(page);

  // inspetor ("entraLado")
  await abrirInspetor(page, "renavam");
  expect(await movimentoAcimaDe1ms(page), "inspetor").toEqual([]);

  // anti-vacuidade: sem a preferência, a MESMA tela tem movimento
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect((await movimentoAcimaDe1ms(page)).length, "sem reduced-motion há transição acima de 1 ms — senão o caso acima seria vazio").toBeGreaterThan(0);
});
