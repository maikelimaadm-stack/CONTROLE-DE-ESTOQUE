import { DomainError } from "@agro/shared";
import { CABECALHO_LEGADO_EMPRESA } from "./contrato-legado.js";

/**
 * EMPRESA SELECIONADA no contexto de trabalho, lida do cabeçalho — CANÔNICA (PRE-BASE2-05B).
 *
 * `X-Empresa-Id` é o único cabeçalho de empresa que a API entende. O anterior saiu com o adaptador de borda
 * (`lib/compat-empresa.ts`, apagado nesta fase): o web canônico está em produção desde PRE-BASE2-05A e
 * nenhum cliente vivo fala o idioma antigo.
 *
 * Identificador malformado é recusado AQUI, com 422. Sem isso ele seguia até o PostgreSQL e voltava como
 * "invalid input syntax for uuid" dentro de um 500 — erro de servidor para o que é erro do cliente, com uma
 * mensagem interna no corpo. Essa correção é contrato canônico e PERMANECE.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ler = (headers: Record<string, unknown>, nome: string): string | null => {
  const v = headers[nome];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() !== "" ? s.trim() : null;
};

export function resolverEmpresaSelecionada(headers: Record<string, unknown>): string | null {
  /**
   * O cabeçalho anterior não é ignorado: é RECUSADO.
   *
   * Ignorar seria o pior dos três caminhos. Um cliente não-browser que ainda o enviasse veria a requisição
   * ser aceita COM OUTRO ESCOPO — "nenhuma empresa selecionada" abre a leitura para todas as empresas
   * permitidas no módulo, ou seja, silenciosamente mais amplo do que ele pediu. Ler um pedido de recorte
   * como ausência de recorte é ampliar acesso sem ninguém perceber.
   *
   * No navegador o CORS já barra o cabeçalho antes da requisição sair. Esta guarda existe para quem não
   * passa por CORS: script, integração, curl.
   */
  if (ler(headers, CABECALHO_LEGADO_EMPRESA) !== null) {
    throw new DomainError("VALIDATION_ERROR",
      `${CABECALHO_LEGADO_EMPRESA} não é mais aceito: use X-Empresa-Id (o contrato de empresa é canônico desde PRE-BASE2-05B)`);
  }
  const escolhido = ler(headers, "x-empresa-id");
  if (escolhido === null) return null;
  if (!UUID.test(escolhido)) throw new DomainError("VALIDATION_ERROR", "X-Empresa-Id: identificador de empresa inválido");
  return escolhido;
}
