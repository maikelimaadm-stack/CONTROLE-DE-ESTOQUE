/**
 * OPERACOES-01 F10 (decisão 287) — AS CENTRAIS DOS MÓDULOS COM PRODUTO.
 *
 * ┌─ O QUE ESTE ARQUIVO É ──────────────────────────────────────────────────────────────────────────────┐
 * │ O dono do que a API, a tela e os testes perguntam sobre os SEIS módulos que lançam produto fora do  │
 * │ documento comercial — abastecimento, manutenção, ordem de serviço, manejo (nutrição e sanitário),   │
 * │ batelada e produção de ração — agora que cada um passa a citar a TOP no PRÓPRIO registro:           │
 * │                                                                                                     │
 * │ 1. QUEM SÃO: a lista dos módulos, a tabela de cada um, o segmento da rota `/api/modulos/<segmento>` │
 * │    e a família da TOP — PERGUNTADA ao registry pela tabela (nenhum código de família escrito aqui,  │
 * │    `familia-operacional-ssot-audit`); registry sem a tabela = módulo sem TOP (fail-closed).         │
 * │ 2. O QUE A TOP COBRA: as exigências gerais que o REGISTRO do módulo tem (centro de resultado e      │
 * │    observação/descrição, só onde há o campo). O perfil do editor e a recusa do formato 5 leem este  │
 * │    mapa por `exigenciasGeraisDaFamiliaTop` — uma lista só.                                          │
 * │ 3. A CAPACIDADE: `topNoModulo: 1`, declarada pelas rotas `/api/modulos/<segmento>/operation-types`, │
 * │    e o leitor estrito dela.                                                                         │
 * │ 4. AS CONTAS que a tela mostra e o servidor grava (contador do bem, dose × cabeças, itens da        │
 * │    batelada e da ração, custo por unidade) — a MESMA conta nas duas pontas, em decimal.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * CLASSIFICAR ≠ EXECUTAR: a TOP no módulo é a classificação, a versão congelada e as exigências gerais. Ela não
 * muda o efeito de estoque de nenhum módulo (cada rota continua dona da sua regra), não gera título e não liga a
 * seção Destino. Sem TOP, o lançamento é o de hoje.
 *
 * TOTAIS: nenhuma função daqui lança com texto vazio ou inválido — a entrada que não tem forma decimal conta como
 * ausente (ou zero, onde está dito), e a divisão por zero devolve `null`.
 *
 * O import de `ExigenciaGeralTop` é SÓ de tipo: `tipo-operacao-restricoes.ts` importa este arquivo como valor (o mapa
 * das exigências), e um import de valor no sentido contrário criaria o ciclo.
 */
import { D } from "@agro/shared";
import { resolverTipoOperacao } from "./tipo-operacao.js";
import type { ExigenciaGeralTop } from "./tipo-operacao-restricoes.js";

// ---------------------------------------------------------------------------------------------------
// 1. OS MÓDULOS
// ---------------------------------------------------------------------------------------------------

/** Os seis módulos com produto que citam a TOP no próprio registro, na ordem do catálogo (grupo Módulos). */
export const MODULOS_COM_TOP = ["abastecimento", "manutencao", "ordem_servico", "manejo", "batelada", "producao_racao"] as const;
export type ModuloComTop = (typeof MODULOS_COM_TOP)[number];

/** A tabela do registro de cada módulo (a que ganha `tipo_operacao_id` + `tipo_operacao_versao_id`). */
export const TABELA_DO_MODULO_COM_TOP: Readonly<Record<ModuloComTop, string>> = Object.freeze({
  abastecimento: "erp.fuel_supplies",
  manutencao: "erp.maintenances",
  ordem_servico: "erp.service_orders",
  manejo: "erp.animal_handlings",
  batelada: "erp.diet_batches",
  producao_racao: "erp.feed_batches",
});

/** O segmento da rota `/api/modulos/<segmento>/…` (português, kebab). */
export const SEGMENTO_DO_MODULO_COM_TOP: Readonly<Record<ModuloComTop, string>> = Object.freeze({
  abastecimento: "abastecimento",
  manutencao: "manutencao",
  ordem_servico: "ordem-servico",
  manejo: "manejo",
  batelada: "batelada",
  producao_racao: "producao-racao",
});

/** A família da TOP do módulo, PERGUNTADA ao registry pela tabela; `undefined` = o registry não declara (fail-closed). */
export const familiaDoModuloComTop = (m: ModuloComTop): string | undefined => resolverTipoOperacao(TABELA_DO_MODULO_COM_TOP[m])?.codigo;

/** O módulo desta família; `undefined` quando a família não é de módulo (quem chama nunca escolhe um vizinho). */
export const moduloComTopDaFamilia = (familia: string): ModuloComTop | undefined =>
  MODULOS_COM_TOP.find((m) => familiaDoModuloComTop(m) === familia);

// ---------------------------------------------------------------------------------------------------
// 2. AS EXIGÊNCIAS GERAIS QUE O REGISTRO DE CADA MÓDULO TEM
// ---------------------------------------------------------------------------------------------------

/** Uma exigência congelada: quem lê o mapa nunca altera o que outro consumidor vê. */
const exigencia = (chave: ExigenciaGeralTop["chave"], caminho: string, rotulo: string): ExigenciaGeralTop =>
  Object.freeze({ chave, caminho, rotulo });

/**
 * As exigências gerais da TOP que o REGISTRO do módulo tem — o mapa "exigência → coluna do registro → rótulo", no
 * molde dos mapas do documento comercial (`tipo-operacao-restricoes.ts`). Só entra o que o registro guarda: nenhum
 * módulo tem parceiro nem transportadora; o centro de resultado só no abastecimento e na OS; a observação onde há a
 * coluna (a OS a chama de "Descrição"). Batelada e produção de ração não têm nenhuma das quatro.
 */
export const EXIGENCIAS_GERAIS_DOS_MODULOS_TOP: Readonly<Record<ModuloComTop, readonly ExigenciaGeralTop[]>> = Object.freeze({
  abastecimento: Object.freeze([
    exigencia("exigeCentroResultado", "cost_center_id", "Centro de resultado"),
    exigencia("exigeObservacao", "note", "Observação"),
  ]),
  manutencao: Object.freeze([exigencia("exigeObservacao", "note", "Observação")]),
  ordem_servico: Object.freeze([
    exigencia("exigeCentroResultado", "cost_center_id", "Centro de resultado"),
    exigencia("exigeObservacao", "description", "Descrição"),
  ]),
  manejo: Object.freeze([exigencia("exigeObservacao", "note", "Observação")]),
  batelada: Object.freeze([]),
  producao_racao: Object.freeze([]),
});

/** O mapa do módulo desta família; `undefined` quando a família não é de módulo (o chamador usa o seu padrão). */
export const exigenciasGeraisDoModuloTop = (familia: string): readonly ExigenciaGeralTop[] | undefined => {
  const m = moduloComTopDaFamilia(familia);
  return m ? EXIGENCIAS_GERAIS_DOS_MODULOS_TOP[m] : undefined;
};

// ---------------------------------------------------------------------------------------------------
// 3. A CAPACIDADE
// ---------------------------------------------------------------------------------------------------

/**
 * A capacidade que `GET /api/modulos/<segmento>/operation-types` declara (`capacidades.topNoModulo`). Ela diz: a rota
 * existe e lista as TOPs da família; o POST do módulo aceita `tipo_operacao_id`; o detalhe devolve o nome da TOP; na
 * manutenção, o campo `note`; na batelada, a rota dos ingredientes da dieta.
 */
export const CAPACIDADE_TOP_NO_MODULO = 1 as const;

/**
 * Só `capacidades.topNoModulo === 1`, em propriedade PRÓPRIA de um objeto (não lista, não nulo); qualquer outra forma
 * — outro número, texto "1", ausente, herdada — é "não declarada": o servidor anterior, e a tela de hoje.
 */
export function entendeTopNoModulo(capacidades: unknown): boolean {
  if (typeof capacidades !== "object" || capacidades === null || Array.isArray(capacidades)) return false;
  return Object.hasOwn(capacidades, "topNoModulo") && (capacidades as Record<string, unknown>).topNoModulo === CAPACIDADE_TOP_NO_MODULO;
}

// ---------------------------------------------------------------------------------------------------
// 4. AS CONTAS (a mesma na tela e no servidor)
// ---------------------------------------------------------------------------------------------------

/** A forma decimal aceita: sinal opcional, dígitos, fração opcional com ponto. */
const FORMA_DECIMAL = /^-?\d+(\.\d+)?$/;

/** O texto aparado, quando tem forma decimal; senão `null` (vazio, nulo, inválido). Nunca lança. */
function decimalOuNulo(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return FORMA_DECIMAL.test(t) ? t : null;
}

/**
 * A leitura que sobe o contador "Horímetro/Km" do bem: o horímetro; sem ele, o km; sem os dois, `null`. Texto vazio
 * (ou sem forma decimal) = ausente. Devolve o texto aparado, sem reescrevê-lo — quem grava é o servidor
 * (`greatest(coalesce(hour_meter,0), <leitura>)`: o contador nunca desce).
 */
export function leituraDoContadorDoBem(horimetro: string | null | undefined, km: string | null | undefined): string | null {
  return decimalOuNulo(horimetro) ?? decimalOuNulo(km);
}

/**
 * A quantidade do PRODUTO no manejo: Σ (dose × cabeças) com dose; sem dose (vazia/nula), Σ cabeças. 4 casas. As
 * cabeças sem forma decimal contam 0; a dose sem forma decimal (mas informada) também conta 0 — nunca vira "sem dose".
 * É a conta da API (cada item `dose × quantidade`, o total somado sem arredondar antes) com os itens em CABEÇAS.
 */
export function quantidadeDoProdutoNoManejo(dose: string | null | undefined, cabecas: readonly string[]): string {
  const total = cabecas.reduce((acc, c) => acc.plus(D(decimalOuNulo(c) ?? "0")), D(0));
  const semDose = dose === null || dose === undefined || dose.trim() === "";
  if (semDose) return total.toFixed(4);
  return D(decimalOuNulo(dose) ?? "0").mul(total).toFixed(4);
}

/**
 * Os itens da batelada: `kg × % / 100`, 4 casas, na ordem dos ingredientes — a conta da API da batelada, a mesma da
 * tela. Quilos ou percentual sem forma decimal contam 0.
 */
export function itensDaBatelada(kg: string, ingredientes: readonly { product_id: string; percentage: string }[]): { product_id: string; quantidade: string }[] {
  const quilos = D(decimalOuNulo(kg) ?? "0");
  return ingredientes.map((i) => ({ product_id: i.product_id, quantidade: quilos.mul(D(decimalOuNulo(i.percentage) ?? "0")).div(100).toFixed(4) }));
}

/**
 * Os itens da produção de ração: a quantidade da fórmula × o multiplicador, 4 casas — a conta da API da produção de
 * ração. Multiplicador vazio ou sem forma decimal = "1" (o padrão da API); quantidade sem forma decimal conta 0.
 */
export function itensDaProducaoDeRacao(multiplicador: string, itens: readonly { product_id: string; quantity: string }[]): { product_id: string; quantidade: string }[] {
  const vezes = D(decimalOuNulo(multiplicador) ?? "1");
  return itens.map((i) => ({ product_id: i.product_id, quantidade: D(decimalOuNulo(i.quantity) ?? "0").mul(vezes).toFixed(4) }));
}

/**
 * `total / quantidade`, 6 casas (o custo por kg da batelada, o custo unitário do produto acabado). Quantidade 0,
 * vazia ou sem forma decimal → `null` (nunca divide por zero); total sem forma decimal → `null` (não há o que dividir).
 */
export function custoPorUnidade(total: string, quantidade: string): string | null {
  const t = decimalOuNulo(total);
  const q = decimalOuNulo(quantidade);
  if (t === null || q === null || D(q).isZero()) return null;
  return D(t).div(D(q)).toFixed(6);
}

/** A recusa (422 no caminho `tipo_operacao_id`) do PUT da OS que traz a TOP: ela não muda depois do lançamento. */
export const MENSAGEM_TOP_DA_OS_NAO_MUDA = "O tipo de operação da OS não muda depois do lançamento.";
