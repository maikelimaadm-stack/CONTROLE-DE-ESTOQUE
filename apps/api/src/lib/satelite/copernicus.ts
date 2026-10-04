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
 * sai para o log é `RegistroChamada`: endpoint lógico, status, duração, tentativa e tipo de falha.
 *
 * RESILIÊNCIA: tempo máximo explícito por chamada; no máximo `TENTATIVAS_MAXIMAS` tentativas; 429 respeita o
 * `Retry-After` só quando ele cabe em `ESPERA_MAXIMA_RETRY_AFTER_S` (senão devolve o limite a quem pediu, com o
 * tempo de espera); 5xx, tempo esgotado e falha de rede repetem uma vez após `ESPERA_ENTRE_TENTATIVAS_MS`;
 * 400/403/404 e os demais 4xx NUNCA repetem (repetir não muda a resposta, só gasta a cota). Sem laço aberto.
 */
import type { BuscarFn } from "../consultas/http.js";
import { enviarPost } from "./http.js";

/** Endereços OFICIAIS e públicos (não são configuração: são o contrato do provedor). */
export const ENDERECOS_COPERNICUS = {
  token: { host: "identity.dataspace.copernicus.eu", caminho: "/auth/realms/CDSE/protocol/openid-connect/token" },
  estatistica: { host: "sh.dataspace.copernicus.eu", caminho: "/statistics/v1" }
} as const;

export const TEMPO_MAXIMO_TOKEN_MS = 10_000;
export const TEMPO_MAXIMO_ESTATISTICA_MS = 30_000;
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

/**
 * `puCabecalho` (SAT-03, decisão 296) existe SÓ na falha que veio DEPOIS de uma resposta 2xx da Statistical API (corpo
 * ilegível, ou a leitura do método recusou o corpo): a chamada foi cobrada, e quem a abriu grava o consumo. O valor é o
 * cabeçalho `x-processingunits-spent` bruto, ou null se ele não veio. Ausente (undefined) = o provedor não cobrou nada.
 */
export class FalhaCopernicus extends Error {
  constructor(readonly tipo: TipoFalhaCopernicus, readonly status: number | null = null, readonly tentarAposSegundos: number | null = null,
    readonly puCabecalho?: string | null) {
    super(`falha do provedor Copernicus: ${tipo}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "FalhaCopernicus";
  }
}

/** O que pode ir para o log de uma chamada — nada além disto. */
export interface RegistroChamada {
  endpoint: "token" | "estatistica";
  status: number | null;
  duracaoMs: number;
  tentativa: number;
  tipoFalha: TipoFalhaCopernicus | null;
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
    const texto = JSON.stringify(corpo);
    let renovouPor401 = false;
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS; tentativa++) {
      const token = await this.obterToken(registrar);
      const inicio = this.agora();
      const r = await enviarPost(this.opcoes.buscar, ENDERECOS_COPERNICUS.estatistica.host, ENDERECOS_COPERNICUS.estatistica.caminho, texto,
        { authorization: `Bearer ${token}`, "content-type": "application/json" }, TEMPO_MAXIMO_ESTATISTICA_MS, this.agora);
      const ultima = tentativa === TENTATIVAS_MAXIMAS;
      const anotar = (status: number | null, tipoFalha: TipoFalhaCopernicus | null) =>
        registrar({ endpoint: "estatistica", status, duracaoMs: this.agora() - inicio, tentativa, tipoFalha });

      if (r.tipo === "falha") {
        const tipo: TipoFalhaCopernicus = r.motivo === "tempo" ? "tempo" : r.motivo === "rede" ? "rede" : "resposta_malformada";
        anotar(r.status ?? null, tipo);
        if ((tipo === "tempo" || tipo === "rede") && !ultima) { await this.esperar(ESPERA_ENTRE_TENTATIVAS_MS); continue; }
        // 2xx com corpo ilegível: cobrada (o PU, se veio, vai junto); qualquer outra falha de envio não cobrou.
        throw new FalhaCopernicus(tipo, r.status ?? null, null, r.motivo === "corpo" ? r.processingUnits ?? null : undefined);
      }
      const s = r.status;
      if (s >= 200 && s < 300) { anotar(s, null); return { corpo: r.corpo, puCabecalho: r.processingUnits ?? null }; }
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
      anotar(s, "requisicao_recusada");
      throw new FalhaCopernicus("requisicao_recusada", s);
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
