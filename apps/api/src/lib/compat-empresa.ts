import { DomainError } from "@agro/shared";

/**
 * ADAPTADOR DE COMPATIBILIDADE FAZENDA → EMPRESA (PRE-BASE2-03).
 *
 * Este é o ÚNICO lugar do runtime onde os nomes legados podem aparecer. Dentro da aplicação existe uma
 * verdade só — `empresa_id`, `empresa_origem_id`, `empresa_destino_id`, `ctx.empresaId`, `X-Empresa-Id` —
 * e a tradução acontece na BORDA: entra pelo normalizador, sai pelo aliasador.
 *
 * A razão de existir não é estética, é de implantação: banco, API (Railway) e web (Vercel) sobem em
 * momentos diferentes, e durante a janela de rollout precisam conviver
 *   A) API nova  + web antigo  → a resposta carrega os nomes legados;
 *   B) API anterior + web novo → a requisição carrega os nomes legados.
 * Espalhar `x ?? y` pelas rotas resolveria os dois casos e criaria uma terceira verdade, que envelheceria
 * em ritmo próprio e só apareceria no dia em que as duas discordassem. A ponte fica aqui, com prazo.
 *
 * REGRA DE CONFLITO, IGUAL NOS TRÊS PONTOS (cabeçalho, corpo, query): só canônico passa; só legado passa;
 * os dois com o MESMO valor passam; os dois com valores DIFERENTES são recusados (422). Escolher um em
 * silêncio gravaria a empresa que o cliente NÃO pediu — e o erro apareceria meses depois, num relatório.
 */

/**
 * Pares canônico → legado. Nada fora desta tabela é traduzido — a lista É o contrato de compatibilidade.
 *
 * `forma` diz o que aquele campo pode ser. Ela não está aqui por tipagem: é o que impede o aliasador de
 * inventar um irmão legado para um campo homônimo que não é nosso (um texto livre chamado `empresa_name`
 * dentro de um objeto do usuário não vira `farm_name`).
 */
export const ALIASES_EMPRESA: ReadonlyArray<{ canonico: string; legado: string; forma: "id" | "texto" | "lista" }> = [
  { canonico: "empresa_id", legado: "farm_id", forma: "id" },
  { canonico: "empresa_origem_id", legado: "origin_farm_id", forma: "id" },
  { canonico: "empresa_destino_id", legado: "destination_farm_id", forma: "id" },
  { canonico: "empresa_name", legado: "farm_name", forma: "texto" },
  { canonico: "empresa_origem_name", legado: "origin_farm_name", forma: "texto" },
  { canonico: "empresa_destino_name", legado: "destination_farm_name", forma: "texto" },
  { canonico: "empresa_ids", legado: "farm_ids", forma: "lista" }
];

/**
 * Colunas `jsonb` cujo conteúdo é OPACO: configuração de tela, filtros salvos, fotos de auditoria, corpo de
 * requisição idempotente, geometria, regras. O que existe lá dentro é do usuário, não do nosso contrato —
 * o aliasador não desce nelas. Sem esta lista, um filtro salvo que por acaso tivesse `empresa_id` ganharia
 * um irmão `farm_id` na resposta, e a ideia de "não mexemos em JSON arbitrário" seria só uma intenção.
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

/** Igualdade de PEDIDO: listas iguais em conteúdo são o mesmo pedido, ainda que sejam arrays distintos. */
const mesmoPedido = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;

const conflito = (canonico: string, legado: string) =>
  new DomainError("VALIDATION_ERROR",
    `${canonico} e ${legado} foram enviados com valores diferentes: informe apenas um, ou os dois com o mesmo valor`);

/**
 * ENTRADA: corpo e query chegam podendo falar os dois idiomas; a rota enxerga só o canônico.
 *
 * Não é recursivo de propósito. O contrato de empresa é sempre do nível de cima do corpo ou da query —
 * um `empresa_id` dentro de `extra` é dado do usuário, não pedido de empresa, e reescrevê-lo seria a API
 * decidindo o conteúdo de um campo livre.
 */
export function normalizarEntradaEmpresa<T>(valor: T): T {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return valor;
  const obj = valor as Record<string, unknown>;
  let saida: Record<string, unknown> | null = null;
  for (const { canonico, legado } of ALIASES_EMPRESA) {
    if (!(legado in obj)) continue;
    const vLegado = obj[legado];
    if (canonico in obj && obj[canonico] !== undefined) {
      // `null` e `undefined` são pedidos diferentes: "sem empresa" contra "não informei".
      if (!mesmoPedido(obj[canonico], vLegado)) throw conflito(canonico, legado);
    } else if (vLegado !== undefined) {
      saida = saida ?? { ...obj };
      saida[canonico] = vLegado;
    }
  }
  return (saida ?? obj) as T;
}

/**
 * SAÍDA: a resposta canônica ganha os apelidos legados para que o web da versão anterior continue lendo.
 *
 * Percorre objetos e arrays, e só acrescenta `farm_id` quando (a) a chave é exatamente uma das três
 * canônicas, (b) o valor tem a FORMA declarada para aquele par e (c) o apelido ainda não existe.
 * Nunca renomeia, nunca remove, nunca entra em valor opaco. É acréscimo — o cliente novo ignora o que não
 * conhece, e o antigo encontra o que procura.
 */
export function aliasesLegadosDeResposta(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 12 || !valor || typeof valor !== "object") return valor;
  if (Array.isArray(valor)) {
    for (const item of valor) aliasesLegadosDeResposta(item, profundidade + 1);
    return valor;
  }
  const obj = valor as Record<string, unknown>;
  for (const { canonico, legado, forma } of ALIASES_EMPRESA) {
    if (canonico in obj && !(legado in obj) && temAForma(forma, obj[canonico])) obj[legado] = obj[canonico];
  }
  for (const [chave, v] of Object.entries(obj)) {
    if (VALORES_OPACOS.has(chave)) continue;
    if (v && typeof v === "object") aliasesLegadosDeResposta(v, profundidade + 1);
  }
  return valor;
}

/**
 * EMPRESA SELECIONADA no contexto de trabalho, vinda do cabeçalho.
 *
 * `X-Empresa-Id` é o canônico; `X-Farm-Id` continua aceito durante a transição. Identificador malformado é
 * recusado AQUI, com 422: antes ele seguia até o PostgreSQL e voltava como "invalid input syntax for uuid"
 * dentro de um 500 — erro de servidor para o que é erro do cliente, e uma mensagem interna no corpo.
 */
export function resolverEmpresaSelecionada(headers: Record<string, unknown>): string | null {
  const ler = (nome: string): string | null => {
    const v = headers[nome];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
  };
  const canonico = ler("x-empresa-id");
  const legado = ler("x-farm-id");
  if (canonico && legado && canonico !== legado) throw conflito("X-Empresa-Id", "X-Farm-Id");
  const escolhido = canonico ?? legado;
  if (escolhido === null) return null;
  if (!UUID.test(escolhido)) {
    throw new DomainError("VALIDATION_ERROR", `${canonico ? "X-Empresa-Id" : "X-Farm-Id"}: identificador de empresa inválido`);
  }
  return escolhido;
}

/**
 * NOME DE COLUNA que chega como DADO, não como chave.
 *
 * Três contratos passam o nome da coluna dentro de um valor, e nenhum deles é alcançado pela tradução de
 * chaves acima:
 *   • `/resources/:key/distinct?field=farm_id` — o campo pedido;
 *   • `sort=farm_id` — a ordenação;
 *   • `farm_id__eq=<uuid>` — o protocolo de filtro por coluna, em que o nome faz parte da CHAVE.
 * E dois guardam esse nome PERSISTIDO: `erp.saved_reports.definition` (colunas e filtros escolhidos pelo
 * usuário) e `erp.user_screen_preferences` (layout da listagem).
 *
 * Por isso a tradução é de LEITURA, não de dado: reescrever o jsonb de relatórios salvos e preferências
 * migraria o usuário para o nome novo e o deixaria sem coluna nenhuma se a versão anterior voltasse ao ar.
 * Resolvendo o apelido na hora de usar, as duas grafias funcionam e nada é reescrito.
 */
export function campoCanonico(nome: string): string {
  for (const { canonico, legado } of ALIASES_EMPRESA) if (nome === legado) return canonico;
  return nome;
}

/** Normalização da QUERY: chaves simples, chaves de filtro `coluna__operador` e valores que nomeiam coluna. */
export function normalizarQueryEmpresa<T>(valor: T): T {
  const base = normalizarEntradaEmpresa(valor);
  if (!base || typeof base !== "object" || Array.isArray(base)) return base;
  const obj = base as Record<string, unknown>;
  let saida: Record<string, unknown> | null = null;
  const escrever = (k: string, v: unknown) => { saida = saida ?? { ...obj }; saida[k] = v; };

  for (const [chave, v] of Object.entries(obj)) {
    const corte = chave.indexOf("__");
    if (corte <= 0) continue;
    const campo = chave.slice(0, corte);
    const canonico = campoCanonico(campo);
    if (canonico === campo) continue;
    const chaveCanonica = canonico + chave.slice(corte);
    if (chaveCanonica in obj && obj[chaveCanonica] !== v) throw conflito(chaveCanonica, chave);
    escrever(chaveCanonica, v);
  }
  for (const nomeDoParametro of ["field", "sort"]) {
    const v = obj[nomeDoParametro];
    if (typeof v === "string" && campoCanonico(v) !== v) escrever(nomeDoParametro, campoCanonico(v));
  }
  return (saida ?? obj) as T;
}

/**
 * NOMES LEGADOS DE TABELA/ENTIDADE (PRE-BASE2-03).
 *
 * A tabela renomeada também é um CONTRATO: `entity` de anexo, `resource_key` de relatório salvo e chave de
 * recurso viajam com o nome da tabela. Um anexo enviado para `entity: "farms"` por um cliente da versão
 * anterior — ou por um link salvo — tem de continuar chegando ao mesmo registro.
 */
export const TABELAS_LEGADAS: Readonly<Record<string, string>> = {
  farms: "empresas",
  authorizer_farms: "authorizer_empresas",
  bank_account_farms: "bank_account_empresas",
  farm_cost_centers: "empresa_cost_centers",
  proprietary_farms: "proprietary_empresas"
};
export const tabelaCanonica = (nome: string): string => TABELAS_LEGADAS[nome] ?? nome;
