import { expect, type Locator, type Page } from "@playwright/test";
import {
  configuracaoNeutraTopV3, configuracaoNeutraTopV4, configuracaoNeutraTopV5,
  type CatalogoTop, type ConfiguracaoTipoOperacao, type ConfiguracaoTipoOperacaoV3, type ConfiguracaoTipoOperacaoV4,
  type ConfiguracaoTipoOperacaoV5, type ModoConfirmacao, type PoliticaAlteracao, type PoliticaAprovacao,
  type PoliticaDocumentoSemItens
} from "@agro/domain";
import { api, uniq } from "./helpers";

/**
 * AS PEÇAS COMUNS DOS E2E DA TOP-CONFIG-08 (decisão 277) — de quem é este arquivo e por quê.
 *
 * Três specs precisam das mesmas peças: o editor da TOP (`top-config-08-editor.spec.ts`), a tela de Aprovações e as
 * Centrais (`top-config-08-aprovacoes.spec.ts`, `top-config-08-centrais.spec.ts`). Duplicadas, cada uma envelheceria
 * por conta própria no dia em que o formato 4 mudar. Não mora em `helpers.ts` porque aquele arquivo é de outra PR
 * aberta: aqui só se IMPORTA dele.
 *
 * ┌─ A CONFIGURAÇÃO NASCE DO DOMÍNIO, NUNCA DE UM LITERAL DAQUI ────────────────────────────────────────┐
 * │ `cfg5`/`cfg4`/`cfg3` partem do NEUTRO do domínio (`configuracaoNeutraTopV5`/`V4`/`V3`, um dono só) e │
 * │ mexem SÓ nas quatro regras gerais. Um literal copiado aqui ficaria velho na primeira chave nova do   │
 * │ formato (o 5 cresce uma seção por fase), e o POST estrito recusaria (422) uma fixture que ninguém    │
 * │ lembraria de atualizar — ou, pior, aceitaria uma forma que a tela nunca grava.                       │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Tudo nasce pela API administrativa, no próprio teste: a produção não tem TOP no formato 4 (nenhuma), e o seed
 * também não — a conta nunca depende do que outro spec deixou no banco. A TOP que EXECUTA uma regra (Automática,
 * aprovação) é excluída no fim de quem a criou (`excluirTopE2E`, a exclusão lógica da própria API), para não sobrar
 * no lançador de quem vier depois uma operação que confirma sozinha ou retém documento.
 */

/** As quatro regras gerais que um teste quer fora do neutro. Ausente = o neutro do domínio. */
export interface RegrasGeraisE2E {
  confirmacao?: ModoConfirmacao;
  documentoSemItens?: PoliticaDocumentoSemItens;
  alteracaoAposConfirmacao?: PoliticaAlteracao;
  aprovacao?: PoliticaAprovacao;
  /** Só com `aprovacao: "por_valor"` — string decimal, como no contrato ("1500.00"). */
  valorMinimo?: string;
}

/** As regras gerais aplicadas sobre uma configuração com as chaves do formato 3 (o 3 sai 3, o 4 sai 4, o 5 sai 5). */
function comRegras<C extends ConfiguracaoTipoOperacaoV3 | ConfiguracaoTipoOperacaoV4 | ConfiguracaoTipoOperacaoV5>(c: C, r: RegrasGeraisE2E): C {
  const politica = r.aprovacao ?? c.aprovacao.politica;
  return {
    ...c,
    geral: {
      ...c.geral,
      confirmacao: r.confirmacao ?? c.geral.confirmacao,
      documentoSemItens: r.documentoSemItens ?? c.geral.documentoSemItens,
      alteracaoAposConfirmacao: r.alteracaoAposConfirmacao ?? c.geral.alteracaoAposConfirmacao
    },
    // O mesmo acoplamento do domínio: `valorMinimo` só existe na política por valor (o leitor estrito recusa o resto).
    aprovacao: { ...c.aprovacao, politica, valorMinimo: politica === "por_valor" ? (r.valorMinimo ?? null) : null }
  };
}

/**
 * Configuração no FORMATO 5 (OPERACOES-01 F4, decisão 281) — o formato 4 mais as seções de extensão das fases
 * seguintes, cada uma no neutro dela (nenhuma na F4). É o que o editor grava contra um servidor que declara o bloco
 * `formato5`. Mesmo molde de `cfg4`: o neutro do domínio, as quatro regras e o `ajustar` para o resto.
 */
export function cfg5(r: RegrasGeraisE2E = {}, ajustar?: (c: ConfiguracaoTipoOperacaoV5) => ConfiguracaoTipoOperacaoV5): ConfiguracaoTipoOperacaoV5 {
  const c = comRegras(configuracaoNeutraTopV5(), r);
  return ajustar ? ajustar(c) : c;
}

/**
 * Configuração no FORMATO 4 — o que executa as regras gerais. `ajustar` mexe no resto (exigências, execução…) a
 * partir do resultado, para o teste que precisa de mais que as quatro regras.
 */
export function cfg4(r: RegrasGeraisE2E = {}, ajustar?: (c: ConfiguracaoTipoOperacaoV4) => ConfiguracaoTipoOperacaoV4): ConfiguracaoTipoOperacaoV4 {
  const c = comRegras(configuracaoNeutraTopV4(), r);
  return ajustar ? ajustar(c) : c;
}

/**
 * Configuração no FORMATO 3 — as mesmas chaves, que SÓ DECLARAM as regras gerais (o corte da decisão 277). É a forma
 * da TOP de pedido de compra de produção: `cfg3({ confirmacao: "automatica", documentoSemItens: "permitido",
 * alteracaoAposConfirmacao: "permitida" })`.
 */
export function cfg3(r: RegrasGeraisE2E = {}, ajustar?: (c: ConfiguracaoTipoOperacaoV3) => ConfiguracaoTipoOperacaoV3): ConfiguracaoTipoOperacaoV3 {
  const c = comRegras(configuracaoNeutraTopV3(), r);
  return ajustar ? ajustar(c) : c;
}

/**
 * Código novo a cada chamada, único na organização (o banco de e2e é compartilhado e acumula TOPs). Prefixo "8g"
 * desta fatia: não colide com os prefixos só numéricos nem com os dos specs de skew. Até 20 caracteres
 * (`FORMA_CODIGO_TIPO_OPERACAO`), e longo o bastante para a busca da listagem recortar exatamente uma linha.
 */
export const codigoTopE2E = () => `8g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface TopE2E { id: string; codigo: string; nome: string; codigoBase: string }

/**
 * Uma TOP nova pela API administrativa. `configuracao` ausente = o servidor grava o neutro dele (a TOP "sem nada
 * declarado"); presente = vai como está, e o servidor confere a matriz da família no formato 4 (422 se ela recusar).
 */
export async function criarTopViaApi(
  page: Page,
  codigoBase: string,
  configuracao?: ConfiguracaoTipoOperacao,
  o: { rotulo?: string; padrao?: boolean } = {}
): Promise<TopE2E> {
  const codigo = codigoTopE2E();
  const nome = uniq(o.rotulo ?? `TC08 ${codigoBase}`);
  const criada = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo, codigoBase, nome,
    ...(configuracao ? { configuracao } : {}),
    ...(o.padrao !== undefined ? { padrao: o.padrao } : {})
  });
  expect(criada.id, `premissa: a TOP ${codigoBase} foi criada`).toBeTruthy();
  return { id: criada.id, codigo, nome, codigoBase };
}

/** O detalhe da TOP como o SERVIDOR o devolve — o árbitro de versão e de formato, nunca um texto da tela. */
export interface DetalheTopE2E {
  versao: number;
  revisao: number;
  configuracaoSchema: number;
  configuracao: { suportada: boolean; versaoSchema: number; valor?: ConfiguracaoTipoOperacao };
}

export const detalheTopNoServidor = (page: Page, id: string) => api<DetalheTopE2E>(page, "GET", `/api/admin/tipos-operacao/${id}`);

/** Limpeza: a exclusão lógica da própria API (exige a `revisao` corrente). Falha aqui é registrada, sem esconder o erro do teste. */
export async function excluirTopE2E(page: Page, id: string) {
  await detalheTopNoServidor(page, id)
    .then((d) => api(page, "DELETE", `/api/admin/tipos-operacao/${id}?revisao=${d.revisao}`, {}))
    .catch((e: unknown) => { console.warn(`[top-config-08] limpeza da TOP ${id} falhou: ${String(e)}`); });
}

/**
 * Os cabeçalhos da SESSÃO DO NAVEGADOR (organização, empresa e a credencial que o login deixou no `localStorage`) —
 * para quem chama a API pelo contexto de requisição do Playwright. Nunca são impressos: um `expect` com eles na
 * mensagem os poria no relatório.
 */
export async function cabecalhosDaSessao(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token?: string; orgId?: string | null; empresaId?: string | null };
    return {
      ...(s.token ? { authorization: `Bearer ${s.token}` } : {}),
      ...(s.orgId ? { "x-org-id": s.orgId } : {}),
      ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {})
    };
  });
}

/**
 * A API pela sessão do navegador SEM LANÇAR no erro: devolve o status e o corpo. É a porta de quem prova uma recusa
 * (409, 404, 422) — o `api` de `helpers.ts` lança em todo status que não é 2xx. `cabecalhos` vai junto (por exemplo,
 * `Idempotency-Key`).
 */
export async function chamarApi<T = Record<string, unknown>>(
  page: Page, method: string, path: string, body?: unknown, cabecalhos: Record<string, string> = {}
): Promise<{ status: number; corpo: T }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3333";
  return page.evaluate(async ({ method, path, body, base, cabecalhos }) => {
    const s = JSON.parse(localStorage.getItem("agro.session") ?? "{}") as { token: string; orgId: string | null; empresaId: string | null };
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json", authorization: `Bearer ${s.token}`,
        ...(s.orgId ? { "x-org-id": s.orgId } : {}), ...(s.empresaId ? { "x-empresa-id": s.empresaId } : {}), ...cabecalhos
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, corpo: (text ? JSON.parse(text) : {}) as T };
  }, { method, path, body, base, cabecalhos });
}

// ---------------------------------------------------------------------------------------------------
// A tela de Tipos de Operação
// ---------------------------------------------------------------------------------------------------

export const ROTA_TIPOS_OPERACAO = "/configuracoes?tab=operacoes&sub=tipos-operacao";

export async function abrirTelaDeTops(page: Page) {
  await page.goto(ROTA_TIPOS_OPERACAO);
  await expect(page.getByRole("heading", { name: "Tipos de Operação" })).toBeVisible();
}

/** A linha da TOP pela BUSCA server-side (o banco de e2e acumula TOPs; rolar a lista seria dependência de ordem). */
export async function linhaDaTopE2E(page: Page, codigo: string): Promise<Locator> {
  await page.getByLabel("Buscar tipo de operação").fill(codigo);
  const linha = page.getByRole("row").filter({ hasText: codigo });
  await expect(linha, "a busca precisa recortar para exatamente a TOP procurada").toHaveCount(1);
  return linha.first();
}

async function menuDaLinha(page: Page, codigo: string) {
  const linha = await linhaDaTopE2E(page, codigo);
  await linha.getByRole("button", { name: "Mais opções" }).click();
}

/** Abre o editor da TOP (a tela já aberta em `abrirTelaDeTops`) e devolve o diálogo. */
export async function abrirEditorDaTop(page: Page, codigo: string): Promise<Locator> {
  await menuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const forma = page.getByTestId("form-tipo-operacao");
  await expect(forma).toBeVisible();
  return forma;
}

/** Abre o histórico de versões da TOP e devolve o diálogo (as linhas são `top-versao-linha`, da mais nova para a mais velha). */
export async function abrirHistoricoDaTop(page: Page, codigo: string): Promise<Locator> {
  await menuDaLinha(page, codigo);
  await page.getByRole("menuitem", { name: "Ver versões" }).click();
  const versoes = page.getByTestId("versoes-tipo-operacao");
  await expect(versoes).toBeVisible();
  return versoes;
}

// ---------------------------------------------------------------------------------------------------
// O formato 5 e o assistente (OPERACOES-01 F4, decisão 281)
// ---------------------------------------------------------------------------------------------------

/** O bloco `formato5` das capacidades, só no que os E2E conferem. Ausente = servidor anterior à F4. */
export interface CapacidadesFormato5E2E {
  formato5?: { suportado: boolean; versaoSchema: number; secoes: string[]; leituraDoDetalhe: string; catalogo: CatalogoTop };
}

/**
 * O catálogo por tipo QUE O SERVIDOR PUBLICOU (`GET /api/admin/tipos-operacao/capabilities`, bloco `formato5`) — a
 * premissa de todo teste do editor do 5: sem o bloco, a tela é o editor do 4, e nada do que o teste afirmar sobre o
 * assistente ou sobre as abas do tipo valeria. Lido, nunca importado do domínio: é contra o publicado que a tela se mede.
 */
export async function catalogoPublicadoE2E(page: Page): Promise<CatalogoTop> {
  const c = await api<CapacidadesFormato5E2E>(page, "GET", "/api/admin/tipos-operacao/capabilities");
  expect(c.formato5?.suportado, "premissa: este servidor declara o formato 5").toBe(true);
  expect(c.formato5?.versaoSchema, "premissa: no formato 5").toBe(5);
  return c.formato5!.catalogo;
}

/** `vendas.venda` → `vendas\.venda`, para a família entrar numa expressão regular sem o ponto virar curinga. */
const literalNaRegex = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O PASSO 1 DA CRIAÇÃO (o assistente): escolhe o tipo de movimento da família `familia` e espera o passo 2.
 *
 * A criação pela tela começa pelo TIPO DE MOVIMENTO quando o servidor declara o formato 5: o diálogo só tem o
 * assistente (sem código, sem abas), e o tipo é escolhido pelo botão cujo `data-familia` é a família — o atributo que o
 * catálogo publicado dá a cada tipo, e não o texto do botão (dois tipos têm o rótulo "Pedido": o de venda e o de compra).
 * O botão tem de ser EXATAMENTE um: zero quer dizer que o tipo não tem tela no catálogo (ou a família está errada), e o
 * clique mediria outra coisa. Escolhido, o passo 2 abre na Identificação com o movimento mostrado, não escolhível.
 *
 * As capacidades chegam depois de o diálogo montar; até lá a criação mostra o editor de hoje. O `toBeVisible` do
 * assistente espera por elas — e é a premissa de que o editor é o do 5.
 */
export async function escolherTipoNoAssistente(forma: Locator, familia: string): Promise<void> {
  await expect(forma.getByTestId("top-assistente"), "a criação começa pelo passo 1 (o tipo de movimento)").toBeVisible();
  const tipo = forma.locator(`[data-testid^="top-assistente-tipo-"][data-familia="${familia}"]`);
  await expect(tipo, `o passo 1 oferece exatamente um tipo de movimento da família ${familia}`).toHaveCount(1);
  await tipo.click();
  await expect(forma.getByTestId("top-assistente"), "escolhido o tipo, o passo 1 sai de cena").toHaveCount(0);
  await expect(forma.getByTestId("top-campo-familia"), "e o passo 2 mostra o movimento escolhido")
    .toHaveValue(new RegExp(`\\(${literalNaRegex(familia)}\\)$`));
}
