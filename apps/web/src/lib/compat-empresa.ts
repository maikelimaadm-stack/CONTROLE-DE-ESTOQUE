/**
 * PONTE DE COMPATIBILIDADE DO CLIENTE — FAZENDA → EMPRESA (PRE-BASE2-03).
 *
 * O web fala EMPRESA por dentro: `empresaId`, `empresa_id`, `empresas`, `/cadastros/empresas`, o recurso
 * `empresas`. Nenhuma tela conhece o nome antigo. O que este arquivo faz é traduzir o FIO — o que sai pela
 * rede e o que volta dela — enquanto a API anterior ainda puder estar no ar.
 *
 * POR QUE O FIO FALA O IDIOMA ANTIGO, E NÃO O CANÔNICO
 *
 * O web (Vercel) e a API (Railway) não sobem juntos. Na janela de rollout existem dois cenários, e eles NÃO
 * são simétricos:
 *
 *   A) API nova + web antigo — a API nova aceita o idioma antigo e responde nos dois. Já resolvido no servidor.
 *   B) API anterior + web novo — aqui quem tem de ceder é o CLIENTE, porque o servidor antigo não muda.
 *
 * E o cenário B tem uma barreira que não está no Fastify: o CORS. A API do commit 6c734a2e declara
 *
 *     allowedHeaders: ["Authorization", "Content-Type", "X-Org-Id", "X-Farm-Id", "Idempotency-Key"]
 *
 * Mandar `X-Empresa-Id` de um navegador contra ela faz o PREFLIGHT falhar: a requisição morre no browser,
 * antes de existir rota, antes de existir adaptador de entrada. Não há nada que o servidor antigo possa
 * fazer, e não há erro de aplicação para tratar — a tela simplesmente não carrega.
 *
 * Por isso, durante a ponte, o FIO é legado: `X-Farm-Id`, `farm_id`, `/api/resources/farms`. Funciona nas
 * duas pontas porque a API ANTIGA só entende isso e a API NOVA entende os dois. Assim o cliente não precisa
 * descobrir a versão do servidor a cada requisição — não existe negociação, existe um idioma que ambos falam.
 *
 * O canônico `X-Empresa-Id` continua sendo o contrato oficial da API nova, suportado e testado
 * (`apps/api/test/integration/compat-empresa.test.ts`). O que muda aqui é só o TRANSPORTE do navegador.
 * Quando a ponte cair (PRE-BASE2-05), este arquivo é apagado e o fio passa a ser o canônico — sem tocar em
 * componente nenhum, porque nenhum componente conhece o nome antigo.
 */

/**
 * Pares canônico → legado. A lista É o contrato: nada fora dela é traduzido.
 *
 * `forma` existe pelo mesmo motivo do adaptador da API: impede que um campo homônimo que não é nosso seja
 * reescrito. Um texto livre chamado `empresa_name` dentro de um objeto do usuário não vira `farm_name`.
 */
const PARES: ReadonlyArray<{ canonico: string; legado: string; forma: "id" | "texto" | "lista" }> = [
  { canonico: "empresa_id", legado: "farm_id", forma: "id" },
  { canonico: "empresa_origem_id", legado: "origin_farm_id", forma: "id" },
  { canonico: "empresa_destino_id", legado: "destination_farm_id", forma: "id" },
  { canonico: "empresa_name", legado: "farm_name", forma: "texto" },
  { canonico: "empresa_origem_name", legado: "origin_farm_name", forma: "texto" },
  { canonico: "empresa_destino_name", legado: "destination_farm_name", forma: "texto" },
  { canonico: "empresa_ids", legado: "farm_ids", forma: "lista" }
];

/** Chaves de RECURSO que mudaram de nome: o componente diz `empresas`, o fio diz `farms`. */
const RECURSOS: Readonly<Record<string, string>> = { empresas: "farms" };

/**
 * Coleções cujo conteúdo é OPACO — configuração de tela, filtro salvo, foto de auditoria, geometria, regras.
 * O que existe lá dentro é do usuário, não do nosso contrato. Sem esta lista, um filtro salvo que por acaso
 * tivesse `farm_id` ganharia um irmão `empresa_id` ao voltar da API, e "não mexemos em JSON arbitrário"
 * seria só uma intenção. A lista é a mesma do adaptador da API (apps/api/src/lib/compat-empresa.ts).
 */
const VALORES_OPACOS = new Set([
  "after", "before", "config", "definition", "depreciation", "extra", "grain_quality", "installment_plan",
  "kml_geometry", "metadata", "parameters", "params", "preferences", "proposed", "raw", "reform",
  "response_body", "request_body", "rules", "steps", "target", "taxes", "values", "vehicle"
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const temAForma = (forma: "id" | "texto" | "lista", v: unknown): boolean =>
  v === null ? true
  : forma === "id" ? typeof v === "string" && UUID.test(v)
  : forma === "texto" ? typeof v === "string"
  : Array.isArray(v) || typeof v === "string";

/** Nome de campo que viaja como VALOR (`field=`, `sort=`, `resource_key`). */
const legadoDoCampo = (valor: string): string | null => PARES.find((p) => p.canonico === valor)?.legado ?? null;

/**
 * CAMINHO + QUERY no fio.
 *
 * A query é montada dentro do caminho por `qs()`, então as duas coisas se resolvem aqui. Três traduções:
 *
 *  1. a CHAVE do recurso no caminho (`/api/resources/empresas/...` → `/api/resources/farms/...`);
 *  2. a CHAVE do parâmetro, inclusive na forma `coluna__operador` (`empresa_id__in` → `farm_id__in`);
 *  3. o VALOR de parâmetros que carregam nome de campo (`field=empresa_id`, `sort=empresa_id`) — sem isso a
 *     API anterior recebe um nome de coluna que ela não conhece e responde 422.
 */
export function caminhoNoWire(caminho: string): string {
  const [base, query] = caminho.split("?");
  let saida = base ?? "";
  for (const [canonico, legado] of Object.entries(RECURSOS)) {
    saida = saida.replace(new RegExp(`(^|/)api/resources/${canonico}(?=/|$)`), `$1api/resources/${legado}`);
  }
  if (!query) return saida;
  const p = new URLSearchParams(query);
  const fora = new URLSearchParams();
  for (const [chave, valor] of p.entries()) {
    const [coluna, operador] = chave.split("__");
    const par = PARES.find((x) => x.canonico === coluna);
    const chaveFinal = par ? (operador ? `${par.legado}__${operador}` : par.legado) : chave;
    const valorFinal = (chave === "field" || chave === "sort") ? legadoDoCampo(valor) ?? valor : valor;
    fora.append(chaveFinal, valorFinal);
  }
  const s = fora.toString();
  return s ? `${saida}?${s}` : saida;
}

/**
 * CORPO no fio: só o nível de cima, como no adaptador da API.
 *
 * O contrato de empresa é sempre do topo do corpo. Um `empresa_id` dentro de `extra` é dado do usuário, não
 * pedido de empresa — descer nele seria o cliente decidindo o conteúdo de um campo livre.
 *
 * A chave canônica é SUBSTITUÍDA pela legada (não duplicada): a API anterior ignoraria a canônica, e a nova
 * traduz a legada de volta na borda. Mandar as duas só criaria um caminho a mais para elas divergirem.
 */
export function corpoNoWire<T>(corpo: T): T {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return corpo;
  const obj = corpo as Record<string, unknown>;
  let saida: Record<string, unknown> | null = null;
  for (const { canonico, legado, forma } of PARES) {
    if (!(canonico in obj) || legado in obj) continue;
    if (!temAForma(forma, obj[canonico])) continue;
    saida ??= { ...obj };
    saida[legado] = saida[canonico];
    delete saida[canonico];
  }
  // `resource_key` carrega o nome do RECURSO como valor (relatório personalizado).
  const recurso = obj["resource_key"];
  if (typeof recurso === "string" && RECURSOS[recurso]) {
    saida ??= { ...obj };
    saida["resource_key"] = RECURSOS[recurso];
  }
  return (saida ?? obj) as T;
}

/**
 * RESPOSTA de volta ao canônico.
 *
 * A API anterior devolve `farm_id`/`farm_name`/`farms`; a nova devolve os dois. Depois desta função o
 * componente vê `empresa_*` nas duas, e nunca precisa saber qual versão respondeu.
 *
 * Três regras que a tornam segura:
 *  - NÃO SOBRESCREVE: se o canônico já veio (API nova), ele manda. A função é idempotente.
 *  - NÃO APAGA o legado: nada depende disso, e apagar é a operação que não tem volta.
 *  - NÃO DESCE em valor opaco: o conteúdo de `definition`, `extra`, `before`/`after` é do usuário.
 */
export function respostaCanonica<T>(dado: T): T {
  return normalizar(dado) as T;
}

function normalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (!valor || typeof valor !== "object") return valor;
  const obj = valor as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(obj)) {
    saida[chave] = VALORES_OPACOS.has(chave) ? v : normalizar(v);
  }
  for (const { canonico, legado, forma } of PARES) {
    if (legado in obj && saida[canonico] === undefined && temAForma(forma, obj[legado])) saida[canonico] = saida[legado];
    // O rótulo da referência acompanha o campo: a listagem genérica desenha `<campo>_label`, e a API
    // anterior o emite com o nome antigo. Sem isto a coluna Empresa vem vazia contra a versão anterior.
    const rotuloLegado = `${legado}_label`, rotuloCanonico = `${canonico}_label`;
    if (forma === "id" && rotuloLegado in obj && saida[rotuloCanonico] === undefined) saida[rotuloCanonico] = saida[rotuloLegado];
  }
  // `farms` do /auth/context é a lista de empresas: o campo canônico é `empresas`.
  if (Array.isArray(obj["farms"]) && saida["empresas"] === undefined) saida["empresas"] = saida["farms"];
  return saida;
}
