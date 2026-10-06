/**
 * CLIENTE DO COPERNICUS DATA SPACE ECOSYSTEM (Sentinel Hub) — SAT-01, decisão 293.
 *
 * É a ÚNICA camada que fala com o provedor. Nenhuma rota chama `fetch` para ele: a rota entrega o corpo da
 * Statistical API e recebe o corpo da resposta, ou uma `FalhaCopernicus` com um tipo estável.
 *
 * AUTENTICAÇÃO: OAuth2 Client Credentials. O token é REUTILIZADO enquanto vale (o provedor limita a emissão de
 * tokens) e renovado com `MARGEM_RENOVACAO_TOKEN_S` de folga antes do fim; duas requisições que precisam de token
 * ao mesmo tempo esperam o MESMO pedido. 401 da API invalida o token e tenta UMA vez com um novo.
 *
 * SEGREDO: o client secret e o access token existem só aqui dentro. Nenhuma mensagem de erro, registro de chamada
 * ou objeto devolvido carrega um dos dois (nem o corpo enviado ao provedor, nem o cabeçalho Authorization). O que
 * sai para o log é `RegistroChamada`: endpoint lógico, status, duração, tentativa, tipo de falha e, em 4xx,
 * um recorte SANITIZADO do erro do provedor (código, mensagem curta, parâmetro) — nunca o JSON bruto, geometria
 * ou corpo do pedido.
 *
 * RESILIÊNCIA: tempo máximo explícito por chamada; no máximo `TENTATIVAS_MAXIMAS` tentativas; 429 respeita o
 * `Retry-After` só quando ele cabe em `ESPERA_MAXIMA_RETRY_AFTER_S` (senão devolve o limite a quem pediu, com o
 * tempo de espera); 5xx, tempo esgotado e falha de rede repetem uma vez após `ESPERA_ENTRE_TENTATIVAS_MS`;
 * 400/403/404 e os demais 4xx NUNCA repetem (repetir não muda a resposta, só gasta a cota). Sem laço aberto.
 *
 * PROCESS API (SAT-06, decisão 297): `processoComConsumo` pede a imagem de valores do NDVI. É a MESMA política da
 * Statistical API — o mesmo token, as mesmas tentativas, o mesmo Retry-After, os mesmos tipos de falha — porque as
 * duas passam pelo MESMO laço (`chamarComTentativas`); só o leitor do corpo muda (binário em vez de JSON).
 */
import type { BuscarFn } from "../consultas/http.js";
import { enviarPost, lerCorpoJson, leitorCorpoBinario, type LeitorCorpo } from "./http.js";
import { temAssinaturaPng } from "./png.js";

/** Endereços OFICIAIS e públicos (não são configuração: são o contrato do provedor). */
export const ENDERECOS_COPERNICUS = {
  token: { host: "identity.dataspace.copernicus.eu", caminho: "/auth/realms/CDSE/protocol/openid-connect/token" },
  estatistica: { host: "sh.dataspace.copernicus.eu", caminho: "/statistics/v1" },
  processo: { host: "sh.dataspace.copernicus.eu", caminho: "/api/v1/process" }
} as const;

export const TEMPO_MAXIMO_TOKEN_MS = 10_000;
export const TEMPO_MAXIMO_ESTATISTICA_MS = 30_000;
/** A Process API rasteriza até 2500 × 2500 px: mais folga que a estatística, o mesmo número de tentativas. */
export const TEMPO_MAXIMO_PROCESSO_MS = 60_000;
/** Teto do corpo da imagem: o mesmo do arquivo no banco (CHECK da 0055, 16 MiB). Acima disso não é a imagem pedida. */
export const TAMANHO_MAXIMO_PNG_PROCESSO_BYTES = 16 * 1024 * 1024;
export const MARGEM_RENOVACAO_TOKEN_S = 60;
export const TENTATIVAS_MAXIMAS = 2;
export const ESPERA_ENTRE_TENTATIVAS_MS = 500;
export const ESPERA_MAXIMA_RETRY_AFTER_S = 3;

export type TipoFalhaCopernicus =
  | "configuracao"        // integração ligada sem credenciais
  | "autenticacao"        // credenciais recusadas pelo provedor (token 400/401, ou 401 persistente)
  | "acesso_negado"       // 403: a conta não tem acesso/cota para o recurso
  | "limite"              // 429 do provedor
  | "indisponivel"        // 5xx persistente
  | "tempo"               // tempo máximo esgotado
  | "rede"                // falha de conexão
  | "requisicao_recusada" // 400/404/outros 4xx: o corpo enviado não foi aceito
  | "resposta_malformada"  // 2xx com corpo fora do contrato
  | "processamento_parcial"; // 2xx com dia(s) em erro que decidiriam a escolha (ndvi.ts): nada é gravado

/** Teto do texto sanitizado que sai para log interno (mensagem/código/parâmetro do provedor). */
export const LIMITE_TEXTO_ERRO_PROVEDOR = 500;

/**
 * Recorte SEGURO do erro 4xx do Copernicus para log interno. Nunca carrega Authorization, token, secret,
 * geometry, coordinates nem o corpo completo do pedido/resposta.
 */
export interface ErroProvedorSanitizado {
  status: number | null;
  code: string | null;
  message: string | null;
  parameter: string | null;
}

/**
 * `puCabecalho` (SAT-03, decisão 296) existe SÓ na falha que veio DEPOIS de uma resposta 2xx da Statistical API (corpo
 * ilegível, ou a leitura do método recusou o corpo): a chamada foi cobrada, e quem a abriu grava o consumo. O valor é o
 * cabeçalho `x-processingunits-spent` bruto, ou null se ele não veio. Ausente (undefined) = o provedor não cobrou nada.
 *
 * `erroProvedor` (HOTFIX-SAT-RUNTIME-01) existe só em `requisicao_recusada` (4xx): recorte sanitizado para log
 * interno. Nunca vai para a resposta HTTP ao cliente (`details.motivo` continua só o `tipo`).
 */
export class FalhaCopernicus extends Error {
  constructor(readonly tipo: TipoFalhaCopernicus, readonly status: number | null = null, readonly tentarAposSegundos: number | null = null,
    readonly puCabecalho?: string | null, readonly erroProvedor?: ErroProvedorSanitizado | null) {
    super(`falha do provedor Copernicus: ${tipo}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "FalhaCopernicus";
  }
}

/** O que pode ir para o log de uma chamada — nada além disto. */
export interface RegistroChamada {
  endpoint: "token" | "estatistica" | "processo";
  status: number | null;
  duracaoMs: number;
  tentativa: number;
  tipoFalha: TipoFalhaCopernicus | null;
  /** Presente só em 4xx da Statistical/Process: recorte sanitizado do corpo de erro do provedor. */
  erroProvedor?: ErroProvedorSanitizado | null;
}

/** Campos de log estruturado a partir do recorte sanitizado (nomes estáveis para Railway). */
export function camposLogErroProvedor(e: ErroProvedorSanitizado | null | undefined): Record<string, string | number | null> {
  if (!e) return {};
  return {
    provider_status: e.status,
    provider_error_code: e.code,
    provider_error_message_sanitized: e.message,
    provider_parameter: e.parameter
  };
}

function cortarTextoErro(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= LIMITE_TEXTO_ERRO_PROVEDOR ? t : `${t.slice(0, LIMITE_TEXTO_ERRO_PROVEDOR)}…`;
}

/** True se o texto parece carregar credencial, Authorization, geometria ou corpo de pedido. */
function textoProibidoNoErro(s: string): boolean {
  if (/authorization\s*:/i.test(s)) return true;
  if (/bearer\s+[A-Za-z0-9._\-+=/]{8,}/i.test(s)) return true;
  if (/client_secret|access_token|refresh_token/i.test(s)) return true;
  if (/"coordinates"\s*:/.test(s)) return true;
  if (/"type"\s*:\s*"(?:Polygon|MultiPolygon|Feature)"/i.test(s)) return true;
  if (/"evalscript"\s*:/i.test(s)) return true;
  if (/"input"\s*:\s*\{/i.test(s) && /"bounds"\s*:/i.test(s)) return true;
  return false;
}

function textoSeguroErro(v: unknown, proibidos: readonly string[]): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let t = cortarTextoErro(v);
  for (const p of proibidos) {
    if (p.length >= 4 && t.includes(p)) t = t.split(p).join("[redacted]");
  }
  if (textoProibidoNoErro(t)) return "[redacted]";
  return t;
}

function objetoDoCorpoErro(corpo: unknown): Record<string, unknown> | null {
  if (corpo == null) return null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) {
    const t = corpo.toString("utf8").trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return null;
    try {
      const p: unknown = JSON.parse(t);
      return p !== null && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : null;
    } catch { return null; }
  }
  if (typeof corpo === "object" && !Array.isArray(corpo)) return corpo as Record<string, unknown>;
  return null;
}

function primeiroParametro(lista: unknown, proibidos: readonly string[]): string | null {
  if (!Array.isArray(lista)) return null;
  for (const item of lista) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const p = textoSeguroErro(o.parameter ?? o.path ?? o.field ?? o.pointer ?? o.param ?? null, proibidos);
    if (p) return p;
  }
  return null;
}

/**
 * Lê o corpo de erro 4xx do Copernicus e devolve só campos seguros para log. `proibidos` = valores conhecidos
 * (client id, secret, token) que NUNCA podem aparecer no recorte, mesmo que o provedor os ecoe.
 */
export function sanitizarErroProvedor(status: number | null, corpo: unknown, proibidos: readonly string[] = []): ErroProvedorSanitizado {
  const vazio: ErroProvedorSanitizado = { status, code: null, message: null, parameter: null };
  const o = objetoDoCorpoErro(corpo);
  if (!o) return vazio;
  const errObj = o.error !== null && typeof o.error === "object" && !Array.isArray(o.error)
    ? o.error as Record<string, unknown>
    : null;
  const code = textoSeguroErro(errObj?.code ?? errObj?.reason ?? o.code ?? o.reason ?? null, proibidos);
  const message = textoSeguroErro(errObj?.message ?? o.message ?? null, proibidos);
  const parameter = primeiroParametro(errObj?.errors ?? o.errors, proibidos)
    ?? textoSeguroErro(errObj?.parameter ?? errObj?.path ?? o.parameter ?? o.path ?? null, proibidos);
  return { status, code, message, parameter };
}

export interface Credenciais { clienteId: string; segredo: string }

export interface OpcoesCliente {
  buscar: BuscarFn;
  credenciais: Credenciais | null;
  agora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const esperarPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ClienteCopernicus {
  private token: { valor: string; expiraEmMs: number } | null = null;
  private emitindo: Promise<string> | null = null;
  private readonly agora: () => number;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(private readonly opcoes: OpcoesCliente) {
    this.agora = opcoes.agora ?? Date.now;
    this.esperar = opcoes.esperar ?? esperarPadrao;
  }

  get configurado(): boolean { return this.opcoes.credenciais !== null; }

  /** Valores que o sanitizador de erro 4xx nunca pode ecoar (credencial + token em uso). */
  private textosProibidos(): string[] {
    const out: string[] = [];
    if (this.opcoes.credenciais) {
      out.push(this.opcoes.credenciais.segredo, this.opcoes.credenciais.clienteId);
    }
    if (this.token?.valor) out.push(this.token.valor);
    return out.filter((s) => s.length >= 4);
  }

  /**
   * POST na Statistical API. Devolve o corpo JSON da resposta 2xx, tal como veio (quem interpreta é o método:
   * `ndvi.ts`). Lança `FalhaCopernicus` em qualquer outro desfecho.
   */
  async estatistica(corpo: unknown, registrar: (r: RegistroChamada) => void = () => {}): Promise<unknown> {
    return (await this.estatisticaComConsumo(corpo, registrar)).corpo;
  }

  /**
   * A mesma chamada de `estatistica` (mesmas tentativas, mesmo token), devolvendo também o cabeçalho
   * `x-processingunits-spent` da resposta 2xx QUE VALEU (SAT-03, decisão 296): bruto, ou null se não veio. Nada mais
   * da resposta sai daqui; quem lê o PU é `consumo.ts`.
   */
  async estatisticaComConsumo(corpo: unknown, registrar: (r: RegistroChamada) => void = () => {}): Promise<{ corpo: unknown; puCabecalho: string | null }> {
    const r = await this.chamarComTentativas("estatistica", ENDERECOS_COPERNICUS.estatistica, JSON.stringify(corpo), {}, TEMPO_MAXIMO_ESTATISTICA_MS, lerCorpoJson, registrar);
    return { corpo: r.corpo, puCabecalho: r.puCabecalho };
  }

  /**
   * POST na Process API (SAT-06, decisão 297): devolve a IMAGEM (PNG) da resposta 2xx que valeu e o cabeçalho
   * `x-processingunits-spent` dela (bruto, ou null). Mesmas tentativas e mesmo token de `estatistica`. 2xx com corpo
   * vazio, ilegível, acima do teto ou que não começa com a assinatura PNG → `resposta_malformada` COM `puCabecalho`
   * definido: a chamada foi cobrada e quem a abriu grava o consumo. Quem confere a imagem por inteiro (cabeçalho,
   * dimensões, dados) é `lerPngCinza8`, no chamador.
   */
  async processoComConsumo(corpo: unknown, registrar: (r: RegistroChamada) => void = () => {}): Promise<{ png: Buffer; puCabecalho: string | null }> {
    const r = await this.chamarComTentativas("processo", ENDERECOS_COPERNICUS.processo, JSON.stringify(corpo), { accept: "image/png" },
      TEMPO_MAXIMO_PROCESSO_MS, leitorCorpoBinario(TAMANHO_MAXIMO_PNG_PROCESSO_BYTES), registrar);
    if (!Buffer.isBuffer(r.corpo) || !temAssinaturaPng(r.corpo)) throw new FalhaCopernicus("resposta_malformada", r.status, null, r.puCabecalho);
    return { png: r.corpo, puCabecalho: r.puCabecalho };
  }

  /**
   * O laço ÚNICO de chamada à API do provedor (Statistical e Process): token, tentativas, 401 com renovação, 429 com
   * Retry-After, 5xx/tempo/rede repetidos uma vez, 4xx nunca. `ler` decide como o corpo é lido (JSON ou binário).
   */
  private async chamarComTentativas(endpoint: "estatistica" | "processo", destino: { host: string; caminho: string }, texto: string,
    cabecalhos: Record<string, string>, tempoMs: number, ler: LeitorCorpo, registrar: (r: RegistroChamada) => void): Promise<{ corpo: unknown; puCabecalho: string | null; status: number }> {
    let renovouPor401 = false;
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS; tentativa++) {
      const token = await this.obterToken(registrar);
      const inicio = this.agora();
      const r = await enviarPost(this.opcoes.buscar, destino.host, destino.caminho, texto,
        { ...cabecalhos, authorization: `Bearer ${token}`, "content-type": "application/json" }, tempoMs, this.agora, ler);
      const ultima = tentativa === TENTATIVAS_MAXIMAS;
      const anotar = (status: number | null, tipoFalha: TipoFalhaCopernicus | null) =>
        registrar({ endpoint, status, duracaoMs: this.agora() - inicio, tentativa, tipoFalha });

      if (r.tipo === "falha") {
        const tipo: TipoFalhaCopernicus = r.motivo === "tempo" ? "tempo" : r.motivo === "rede" ? "rede" : "resposta_malformada";
        anotar(r.status ?? null, tipo);
        if ((tipo === "tempo" || tipo === "rede") && !ultima) { await this.esperar(ESPERA_ENTRE_TENTATIVAS_MS); continue; }
        // 2xx com corpo ilegível: cobrada (o PU, se veio, vai junto); qualquer outra falha de envio não cobrou.
        throw new FalhaCopernicus(tipo, r.status ?? null, null, r.motivo === "corpo" ? r.processingUnits ?? null : undefined);
      }
      const s = r.status;
      if (s >= 200 && s < 300) { anotar(s, null); return { corpo: r.corpo, puCabecalho: r.processingUnits ?? null, status: s }; }
      if (s === 401) {
        anotar(s, "autenticacao");
        this.token = null; // o token caiu antes do previsto: o próximo pedido emite outro
        if (!renovouPor401 && !ultima) { renovouPor401 = true; continue; }
        throw new FalhaCopernicus("autenticacao", s);
      }
      if (s === 403) { anotar(s, "acesso_negado"); throw new FalhaCopernicus("acesso_negado", s); }
      if (s === 429) {
        anotar(s, "limite");
        const espera = r.tentarAposSegundos;
        if (espera !== null && espera <= ESPERA_MAXIMA_RETRY_AFTER_S && !ultima) { await this.esperar(espera * 1000); continue; }
        throw new FalhaCopernicus("limite", s, espera);
      }
      if (s >= 500) {
        anotar(s, "indisponivel");
        if (!ultima) { await this.esperar(ESPERA_ENTRE_TENTATIVAS_MS); continue; }
        throw new FalhaCopernicus("indisponivel", s);
      }
      // 4xx (exceto 401/403/429 já tratados): o corpo do provedor é lido SÓ para log sanitizado — nunca repassado ao cliente.
      const erroProvedor = sanitizarErroProvedor(s, r.corpo, this.textosProibidos());
      registrar({ endpoint, status: s, duracaoMs: this.agora() - inicio, tentativa, tipoFalha: "requisicao_recusada", erroProvedor });
      throw new FalhaCopernicus("requisicao_recusada", s, null, undefined, erroProvedor);
    }
    // Inalcançável: toda volta do laço termina em `return`, `continue` ou `throw`, e a última nunca continua.
    throw new FalhaCopernicus("indisponivel");
  }

  /** Token válido (reaproveitado) ou um novo. Pedidos simultâneos compartilham a mesma emissão. */
  private async obterToken(registrar: (r: RegistroChamada) => void): Promise<string> {
    if (!this.opcoes.credenciais) throw new FalhaCopernicus("configuracao");
    if (this.token && this.agora() < this.token.expiraEmMs - MARGEM_RENOVACAO_TOKEN_S * 1000) return this.token.valor;
    if (!this.emitindo) this.emitindo = this.emitirToken(this.opcoes.credenciais, registrar).finally(() => { this.emitindo = null; });
    return this.emitindo;
  }

  private async emitirToken(cred: Credenciais, registrar: (r: RegistroChamada) => void): Promise<string> {
    const corpo = new URLSearchParams({ grant_type: "client_credentials", client_id: cred.clienteId, client_secret: cred.segredo }).toString();
    const inicio = this.agora();
    const r = await enviarPost(this.opcoes.buscar, ENDERECOS_COPERNICUS.token.host, ENDERECOS_COPERNICUS.token.caminho, corpo,
      { "content-type": "application/x-www-form-urlencoded" }, TEMPO_MAXIMO_TOKEN_MS, this.agora);
    const anotar = (status: number | null, tipoFalha: TipoFalhaCopernicus | null) =>
      registrar({ endpoint: "token", status, duracaoMs: this.agora() - inicio, tentativa: 1, tipoFalha });
    if (r.tipo === "falha") {
      const tipo: TipoFalhaCopernicus = r.motivo === "tempo" ? "tempo" : r.motivo === "rede" ? "rede" : "resposta_malformada";
      anotar(r.status ?? null, tipo);
      throw new FalhaCopernicus(tipo, r.status ?? null);
    }
    const s = r.status;
    if (s === 400 || s === 401) { anotar(s, "autenticacao"); throw new FalhaCopernicus("autenticacao", s); }
    if (s === 403) { anotar(s, "acesso_negado"); throw new FalhaCopernicus("acesso_negado", s); }
    if (s === 429) { anotar(s, "limite"); throw new FalhaCopernicus("limite", s, r.tentarAposSegundos); }
    if (s >= 500) { anotar(s, "indisponivel"); throw new FalhaCopernicus("indisponivel", s); }
    if (s < 200 || s >= 300) { anotar(s, "requisicao_recusada"); throw new FalhaCopernicus("requisicao_recusada", s); }
    const o = r.corpo && typeof r.corpo === "object" && !Array.isArray(r.corpo) ? (r.corpo as Record<string, unknown>) : {};
    const valor = o["access_token"];
    const expiraEm = o["expires_in"];
    if (typeof valor !== "string" || !valor || typeof expiraEm !== "number" || !Number.isFinite(expiraEm) || expiraEm <= 0) {
      anotar(s, "resposta_malformada");
      throw new FalhaCopernicus("resposta_malformada", s);
    }
    anotar(s, null);
    this.token = { valor, expiraEmMs: this.agora() + expiraEm * 1000 };
    return valor;
  }
}
