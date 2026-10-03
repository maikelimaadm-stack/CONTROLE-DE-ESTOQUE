import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import {
  SEGMENTO_DO_MODULO_COM_TOP,
  configuracaoNeutraTopV5,
  familiaDoModuloComTop,
  type ConfiguracaoTipoOperacaoV5,
  type ModuloComTop
} from "@agro/domain";
import { api, uniq } from "./helpers";
import { chamarApi, excluirTopE2E, type TopE2E } from "./top-config-08-comum";

/**
 * AS PEÇAS COMUNS DOS E2E DA OPERACOES-01 F10 (decisão 287) — as Centrais dos módulos com produto.
 *
 * Os specs da frota (abastecimento, manutenção, OS) e da pecuária/ração (manejo, batelada, produção de ração) — e os
 * de skew dos dois lados — precisam das mesmas peças: a TOP da família do módulo, a capacidade do módulo, o saldo
 * inicial que a saída consome, a leitura do banco para a testemunha e o corpo do POST que a tela enviou. Aqui não há
 * `test(...)`: só ajudantes.
 *
 * A FAMÍLIA VEM DO DOMÍNIO, NUNCA DE UM LITERAL DAQUI: `familiaDoModuloComTop(modulo)` pergunta ao registry pela tabela
 * do módulo — se o registry deixar de declarar a tabela, a TOP não nasce e o teste falha alto na premissa. A
 * configuração parte do NEUTRO do formato 5 do domínio (`configuracaoNeutraTopV5`), como `cfg5` da TOP-CONFIG-08.
 */

/** Código novo a cada chamada, único na organização (o banco de e2e acumula TOPs). Prefixo "f10"; até 20 caracteres. */
export const codigoTopDoModulo = () => `f10${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** As exigências gerais que um teste liga numa TOP de módulo (as que os registros dos módulos têm). */
export type ExigenciaDoModuloE2E = "exigeCentroResultado" | "exigeObservacao";

/** O ajuste que liga as exigências pedidas sobre a configuração (o resto continua no neutro). */
export const exigir = (...chaves: ExigenciaDoModuloE2E[]) => (c: ConfiguracaoTipoOperacaoV5): ConfiguracaoTipoOperacaoV5 => {
  const geral = { ...c.geral };
  for (const k of chaves) geral[k] = true;
  return { ...c, geral };
};

/**
 * Uma TOP da família do módulo, no FORMATO 5, pela API administrativa. `ajuste` mexe na configuração a partir do
 * neutro (ex.: `exigir("exigeCentroResultado")`); `padrao` marca a TOP padrão da família (a que a Central já traz
 * escolhida). Quem cria uma TOP padrão a exclui no fim (`excluirTopDoModulo`): a próxima Central não pode herdá-la.
 */
export async function criarTopDoModulo(
  page: Page,
  modulo: ModuloComTop,
  ajuste?: (c: ConfiguracaoTipoOperacaoV5) => ConfiguracaoTipoOperacaoV5,
  o: { nome?: string; padrao?: boolean } = {}
): Promise<TopE2E> {
  const codigoBase = familiaDoModuloComTop(modulo);
  expect(codigoBase, `premissa: o registry declara a família do módulo ${modulo}`).toBeTruthy();
  const codigo = codigoTopDoModulo();
  const nome = uniq(o.nome ?? `F10 ${modulo}`);
  const configuracao = ajuste ? ajuste(configuracaoNeutraTopV5()) : configuracaoNeutraTopV5();
  const criada = await api<{ id: string }>(page, "POST", "/api/admin/tipos-operacao", {
    codigo, codigoBase, nome, configuracao, ...(o.padrao !== undefined ? { padrao: o.padrao } : {})
  });
  expect(criada.id, `premissa: a TOP de ${modulo} foi criada`).toBeTruthy();
  return { id: criada.id, codigo, nome, codigoBase: codigoBase! };
}

/** Limpeza: a exclusão lógica da própria API (a mesma da TOP-CONFIG-08). */
export const excluirTopDoModulo = (page: Page, id: string) => excluirTopE2E(page, id);

/** Uma TOP como `GET /api/modulos/<segmento>/operation-types` a devolve. */
export interface TipoDoModuloE2E { id: string; code: string; name: string; version: number; isDefault: boolean; camposExigidos: string[] }
/** O corpo da capacidade do módulo. */
export interface TiposDoModuloE2E {
  contractVersion: number;
  capacidades: Record<string, unknown>;
  family: { code: string; label: string } | null;
  defaultId: string | null;
  items: TipoDoModuloE2E[];
}

/** A porta da capacidade do módulo (`/api/modulos/<segmento>/operation-types`). */
export const portaDaCapacidadeDoModulo = (modulo: ModuloComTop) => `/api/modulos/${SEGMENTO_DO_MODULO_COM_TOP[modulo]}/operation-types`;

/**
 * A capacidade do módulo, perguntada à API no ar pela sessão do navegador — SEM lançar no erro: o status e o corpo
 * (a API anterior responde 404 de rota; quem não pode lançar, 403).
 */
export const tiposDoModulo = (page: Page, modulo: ModuloComTop) => chamarApi<TiposDoModuloE2E>(page, "GET", portaDaCapacidadeDoModulo(modulo));

/** O saldo que a saída do módulo consome: estoque inicial confirmado (um por produto × local × lote). */
export async function saldoInicial(page: Page, c: { empresa: string; local: string; produto: string; quantidade: string; custo: string }): Promise<{ id: string }> {
  return api<{ id: string }>(page, "POST", "/api/stock/opening-balances", {
    empresa_id: c.empresa, warehouse_id: c.local, product_id: c.produto, quantity: c.quantidade, unit_value: c.custo
  });
}

/**
 * O banco de e2e, para a TESTEMUNHA (o que o servidor gravou), pelo mesmo `psql` dos specs que já leem o banco
 * (`aj02-comum.ts`, `cadastros-ajustes-01.spec.ts`). Só leitura de prova: o teste nunca prepara dado por aqui o que a
 * API sabe preparar.
 */
const BANCO = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL?.replace(/\/[^/]+$/, "/agro_erp_e2e") ?? "postgresql://postgres@127.0.0.1:5433/agro_erp_e2e";
export const sqlE2e = (c: string) => execFileSync("psql", [BANCO, "-v", "ON_ERROR_STOP=1", "-Atc", c], { encoding: "utf8" }).trim();

/** Uma escrita que a tela fez: o corpo enviado, o status e o corpo da resposta. */
export interface EscritaInterceptada { corpo: Record<string, unknown>; status: number; resposta: Record<string, unknown> }

/**
 * O corpo da PRÓXIMA escrita da tela para este caminho EXATO (`/api/fleet/fuel-supplies`), lido da resposta que
 * voltou. Chame ANTES do clique e espere depois:
 *   const escrita = corpoDoPost(page, "/api/fleet/fuel-supplies"); await salvar.click(); const { corpo } = await escrita;
 * `metodo` padrão POST (a edição da OS usa PUT).
 */
export async function corpoDoPost(page: Page, caminho: string, metodo = "POST"): Promise<EscritaInterceptada> {
  const r = await page.waitForResponse((x) => x.request().method() === metodo && new URL(x.url()).pathname === caminho);
  const corpo = (r.request().postDataJSON() ?? {}) as Record<string, unknown>;
  const texto = await r.text();
  return { corpo, status: r.status(), resposta: (texto ? JSON.parse(texto) : {}) as Record<string, unknown> };
}

/**
 * Conta as escritas da tela para o caminho EXATO desde agora — a prova de "NENHUM POST" (a pendência do cliente
 * segura o Salvar). `total()` lê a contagem no instante.
 */
export function contarEscritas(page: Page, caminho: string, metodo = "POST"): { total: () => number } {
  let n = 0;
  page.on("request", (r) => { if (r.method() === metodo && new URL(r.url()).pathname === caminho) n += 1; });
  return { total: () => n };
}
