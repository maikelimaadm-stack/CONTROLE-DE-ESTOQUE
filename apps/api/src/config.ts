import { z } from "zod";
import { sufixosDePreview } from "./lib/cors-origem.js";

/**
 * Inteiro OPCIONAL de variável de ambiente, na forma canônica (só dígitos, sem zero à esquerda) e dentro da faixa.
 * AUSENTE (ou vazio) = `undefined` (quem usa aplica o padrão). Qualquer outra coisa (`1e2`, `0x2`, ` 3`, `-1`, `10.0`,
 * fora da faixa) DERRUBA O STARTUP, e a mensagem não repete o valor recebido.
 */
const inteiroDeAmbiente = (minimo: number, maximo: number) => z.string().optional().transform((valor, ctx) => {
  if (valor === undefined || valor === "") return undefined;
  const n = /^[1-9]\d{0,8}$/.test(valor) ? Number(valor) : NaN;
  if (!(n >= minimo && n <= maximo)) {
    ctx.addIssue({ code: "custom", message: `use um inteiro de ${minimo} a ${maximo}, só dígitos, ou deixe ausente` });
    return z.NEVER;
  }
  return n;
});

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3333),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  API_LOG_LEVEL: z.string().default("info"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /**
   * Sufixos de host que identificam os previews DESTE projeto (ex.: `-minhaconta.vercel.app`).
   * Lista separada por vírgula. AUSENTE = nenhum preview aceito: a falta de configuração nunca vira
   * permissão.
   *
   * O VALOR É VERIFICADO AQUI, e um valor fora do formato canônico DERRUBA O STARTUP. Sufixo genérico
   * de provedor (`.vercel.app` cru) é o caso que motivou a verificação: com `credentials` ligado ele
   * entrega a API autenticada a qualquer conta daquele provedor, e antes da R1 a proibição existia só
   * como aviso em comentário — texto que nunca é lido por quem preenche a variável no painel da
   * plataforma. O contrato do formato mora em `lib/cors-origem.ts`, e é o mesmo que o servidor aplica.
   */
  WEB_ORIGIN_PREVIEW_SUFFIX: z.string().optional().superRefine((valor, ctx) => {
    try {
      sufixosDePreview(valor);
    } catch (erro) {
      ctx.addIssue({ code: "custom", message: erro instanceof Error ? erro.message : String(erro) });
    }
  }),
  AUTH_MODE: z.enum(["local", "supabase"]).default("local"),
  LOCAL_AUTH_SECRET: z.string().min(8).default("dev-only-secret-change-me"),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  /**
   * GATE OPERACIONAL DA EXECUÇÃO CONFIGURADA DA TOP (TOP-CONFIG-04A). `1` liga; `0` ou AUSENTE desliga.
   *
   * DESLIGADO é o padrão, e não é "voltar ao legado": com ele desligado o administrador não consegue
   * ativar execução configurada, e uma venda cuja versão congelada JÁ declara execução configurada é
   * RECUSADA na confirmação — nunca confirmada pelo comportamento antigo. Ligar é a FASE 2 da implantação,
   * e só com as pré-condições da fase 2 cumpridas (`docs/DEPLOYMENT.md` § TOP-CONFIG-04A): nenhuma instância
   * anterior atendendo tráfego é uma delas, não a única.
   *
   * O VALOR É FECHADO E VERIFICADO AQUI: qualquer coisa fora de `0`/`1` DERRUBA O STARTUP. Uma coerção
   * booleana ("false" é string não vazia, logo verdadeira) ligaria o gate por um erro de digitação — e um
   * gate que liga por engano é pior do que nenhum. A mensagem não repete o valor recebido.
   */
  TOP_EFFECTS_RUNTIME_V1_ENABLED: z.string().optional().superRefine((valor, ctx) => {
    if (valor !== undefined && valor !== "0" && valor !== "1") {
      ctx.addIssue({ code: "custom", message: "use 1 para ligar ou 0 (ou ausente) para desligar" });
    }
  }).transform((valor) => valor === "1"),
  /**
   * FONTES DA CONSULTA DE CNPJ (CADASTROS Fase 3), em ordem de tentativa. Só fontes GRATUITAS e sem chave:
   * `brasilapi`, `cnpja` (CNPJá aberta), `cnpjws` (CNPJ.ws pública). Padrão: as três, nessa ordem.
   * `desligado` desliga a consulta (503). Nome desconhecido, repetido ou lista vazia DERRUBA O STARTUP:
   * uma fonte digitada errado sumiria da lista em silêncio. Não existe credencial de consulta.
   */
  CONSULTA_CNPJ_FONTES: z.string().default("brasilapi,cnpja,cnpjws").transform((valor, ctx) => {
    const v = valor.trim();
    if (v === "desligado") return [] as ("brasilapi" | "cnpja" | "cnpjws")[];
    const lista = v.split(",").map((s) => s.trim());
    const conhecidas = ["brasilapi", "cnpja", "cnpjws"];
    if (!lista.length || lista.some((f) => !conhecidas.includes(f)) || new Set(lista).size !== lista.length) {
      ctx.addIssue({ code: "custom", message: "use `desligado` ou uma lista sem repetição de: brasilapi, cnpja, cnpjws" });
      return z.NEVER;
    }
    return lista as ("brasilapi" | "cnpja" | "cnpjws")[];
  }),
  /**
   * ANÁLISE POR SATÉLITE (SAT-01, decisão 293): Copernicus Data Space Ecosystem / Sentinel-2 L2A. `1` liga; `0` ou
   * AUSENTE desliga — DESLIGADO é o padrão (efeito novo nasce desligado, decisão 240). Desligada, a API sobe igual,
   * o histórico continua legível e pedir análise nova responde 503. Mesmo contrato fechado do gate da TOP: valor fora
   * de `0`/`1` DERRUBA O STARTUP, e a mensagem não repete o valor recebido.
   */
  COPERNICUS_ENABLED: z.string().optional().superRefine((valor, ctx) => {
    if (valor !== undefined && valor !== "0" && valor !== "1") {
      ctx.addIssue({ code: "custom", message: "use 1 para ligar ou 0 (ou ausente) para desligar" });
    }
  }).transform((valor) => valor === "1"),
  /**
   * Credencial OAuth (client credentials) do Copernicus. SÓ no servidor: nunca no build da web, nunca em log, nunca
   * na resposta. AUSENTE não derruba o startup — com a integração ligada e sem as duas, o pedido de análise responde
   * 503 (`configuracao`). Vazio vale como ausente. Os ENDEREÇOS do provedor não são configuração: são constantes
   * oficiais no adaptador (`lib/satelite/copernicus.ts`), para a URL nunca vir de fora (SSRF, credencial desviada).
   */
  COPERNICUS_CLIENT_ID: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  COPERNICUS_CLIENT_SECRET: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /**
   * EXECUTOR DA FILA SATELITAL (SAT-03, decisão 296): consome `erp.satelite_consulta_itens` dentro do processo da API.
   * `1` liga; `0` ou AUSENTE desliga — DESLIGADO é o padrão (efeito novo nasce desligado, decisão 240). Desligado, a API
   * sobe igual e as consultas ficam na fila, sem gasto. Mesmo contrato fechado do COPERNICUS_ENABLED: valor fora de
   * `0`/`1` DERRUBA O STARTUP. Ligado sem COPERNICUS_ENABLED=1 ou sem credencial, o executor não reserva nada.
   */
  SATELITE_WORKER_ENABLED: z.string().optional().superRefine((valor, ctx) => {
    if (valor !== undefined && valor !== "0" && valor !== "1") {
      ctx.addIssue({ code: "custom", message: "use 1 para ligar ou 0 (ou ausente) para desligar" });
    }
  }).transform((valor) => valor === "1"),
  /** Segundos entre as rodadas do executor (1–3600). AUSENTE = o padrão de `lib/satelite/limites.ts`. Fora disso derruba o startup. */
  SATELITE_WORKER_INTERVALO_S: inteiroDeAmbiente(1, 3600),
  /**
   * Limites GLOBAIS de chamada ao Copernicus (todas as réplicas), números em `lib/satelite/limites.ts`. AUSENTE = o
   * padrão de lá; definido, troca o padrão. Inteiro canônico ≥ 1 — fora disso DERRUBA O STARTUP (um limite digitado
   * errado não pode virar "sem limite"). Os valores certos dependem da conta: confirmar no painel do Copernicus.
   */
  SATELITE_LIMITE_SIMULTANEAS: inteiroDeAmbiente(1, 1000),
  SATELITE_LIMITE_MINUTO_CONTA: inteiroDeAmbiente(1, 100_000),
  SATELITE_LIMITE_MINUTO_ORG: inteiroDeAmbiente(1, 100_000),
  /** tentativas de login por IP por minuto (proteção contra força bruta) */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10)
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) throw new Error("Configuração inválida: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (r.data.AUTH_MODE === "supabase" && !r.data.SUPABASE_JWT_SECRET) throw new Error("SUPABASE_JWT_SECRET é obrigatório com AUTH_MODE=supabase");
  return r.data;
}
