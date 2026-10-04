/**
 * URL ASSINADA DO ARQUIVO DO RASTER (SAT-06, decisão 297) — o MapLibre busca a imagem direto, SEM cabeçalho de
 * autenticação; o acesso vem de um token curto na própria URL (`?t=`).
 *
 * O TOKEN é OPACO para o cliente: `base64url(payload ‖ HMAC-SHA256(chave, payload))`, com payload binário de tamanho
 * FIXO — versão (1 byte), raster_id, organization_id e user_id (16 bytes cada, o UUID cru) e `expira` (epoch em
 * segundos, 8 bytes). Ele não é segredo do usuário (os ids não autorizam nada sozinhos), é PROVA: só o servidor sabe
 * produzir o HMAC.
 *
 * A CHAVE é DERIVADA (HKDF-SHA256, info `erp:satelite-raster-url:v1`) do segredo de autenticação que a API JÁ tem
 * (`SUPABASE_JWT_SECRET` com AUTH_MODE=supabase, senão `LOCAL_AUTH_SECRET` — o mesmo que assina a sessão local). Nenhuma
 * variável nova; a derivação com rótulo próprio separa os usos: um HMAC desta URL nunca vale como assinatura de JWT, e
 * trocar o segredo de autenticação invalida as URLs junto com as sessões.
 *
 * O TOKEN DELEGA o acesso do PRÓPRIO usuário por no máximo `VALIDADE_URL_RASTER_S`: a rota do arquivo abre a transação
 * com a GUC dele (organização + usuário + módulo da permissão de ver) e lê SOB A RLS — se ele perdeu o vínculo, a
 * capacidade ou o escopo da empresa nesse meio-tempo, a resposta é a mesma 404 de um token inválido.
 *
 * VERIFICAÇÃO: tamanho exato, versão, HMAC comparado em TEMPO CONSTANTE (`timingSafeEqual`, sempre sobre 32 bytes), e só
 * então o vencimento e o raster da rota. Qualquer falha → `null` (quem chama responde a MESMA 404, sem dizer qual
 * conferência falhou). NUNCA vai para log: o token, a chave e o segredo — este módulo não registra nada.
 */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { Config } from "../../config.js";

/** Validade da URL assinada, em segundos (contrato: 5 a 15 minutos). */
export const VALIDADE_URL_RASTER_S = 600;
/** Rótulo da derivação: muda a versão → todas as URLs anteriores deixam de valer. */
export const INFO_HKDF_URL_RASTER = "erp:satelite-raster-url:v1";

const VERSAO_TOKEN = 1;
const TAMANHO_PAYLOAD = 1 + 16 * 3 + 8;
const TAMANHO_MAC = 32;
/** base64url de 89 bytes, sem preenchimento. */
const FORMA_TOKEN = /^[A-Za-z0-9_-]{119}$/;
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ConteudoUrlRaster { rasterId: string; organizationId: string; userId: string; /** epoch em segundos */ expira: number }

export interface AssinadorUrlRaster {
  /** O token para (raster, organização, usuário), vencendo em `agoraS + VALIDADE_URL_RASTER_S`. */
  assinar(p: { rasterId: string; organizationId: string; userId: string }, agoraS?: number): { token: string; expira: number };
  /** O conteúdo do token válido, não vencido e DESTE raster — ou `null`. */
  verificar(token: unknown, rasterId: string, agoraS?: number): ConteudoUrlRaster | null;
}

const agoraEmSegundos = () => Math.floor(Date.now() / 1000);

export const MARCADOR_TOKEN_OMITIDO = "t=[omitido]";

/**
 * A URL para LOG: em QUALQUER caminho sob `/rasters/` (a rota do arquivo e suas variações erradas — barra a mais, outro
 * prefixo —, que também chegam ao log como "rota não encontrada"), a query inteira, onde mora o token, vira um marcador;
 * qualquer outra URL passa como está. Usada pelo serializador de requisição do servidor (server.ts).
 */
export function redigirUrlAssinada(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const caminho = url.slice(0, q);
  return /\/rasters\//i.test(caminho) ? `${caminho}?${MARCADOR_TOKEN_OMITIDO}` : url;
}

/** O segredo de autenticação em vigor — o mesmo que o plugin de autenticação usa para verificar a sessão. */
function segredoDeAutenticacao(config: Pick<Config, "AUTH_MODE" | "SUPABASE_JWT_SECRET" | "LOCAL_AUTH_SECRET">): string {
  const segredo = config.AUTH_MODE === "supabase" ? config.SUPABASE_JWT_SECRET : config.LOCAL_AUTH_SECRET;
  // `loadConfig` já recusa AUTH_MODE=supabase sem segredo; aqui fecha o caminho de quem monta um `Config` à mão.
  if (!segredo) throw new Error("URL assinada do raster: segredo de autenticação ausente");
  return segredo;
}

const uuidParaBytes = (u: string): Buffer => Buffer.from(u.replace(/-/g, ""), "hex");
function bytesParaUuid(b: Buffer): string {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function criarAssinadorUrlRaster(config: Pick<Config, "AUTH_MODE" | "SUPABASE_JWT_SECRET" | "LOCAL_AUTH_SECRET">): AssinadorUrlRaster {
  // A chave existe só nesta closure: nunca é exportada, devolvida nem registrada.
  const chave = Buffer.from(hkdfSync("sha256", Buffer.from(segredoDeAutenticacao(config), "utf8"), Buffer.alloc(0), Buffer.from(INFO_HKDF_URL_RASTER, "utf8"), 32));
  const mac = (payload: Buffer) => createHmac("sha256", chave).update(payload).digest();

  return {
    assinar(p, agoraS = agoraEmSegundos()) {
      for (const id of [p.rasterId, p.organizationId, p.userId]) {
        if (!FORMA_UUID.test(id)) throw new Error("URL assinada do raster: identificador fora da forma de UUID");
      }
      const expira = agoraS + VALIDADE_URL_RASTER_S;
      const payload = Buffer.alloc(TAMANHO_PAYLOAD);
      payload.writeUInt8(VERSAO_TOKEN, 0);
      uuidParaBytes(p.rasterId).copy(payload, 1);
      uuidParaBytes(p.organizationId).copy(payload, 17);
      uuidParaBytes(p.userId).copy(payload, 33);
      payload.writeBigUInt64BE(BigInt(expira), 49);
      return { token: Buffer.concat([payload, mac(payload)]).toString("base64url"), expira };
    },

    verificar(token, rasterId, agoraS = agoraEmSegundos()) {
      if (typeof token !== "string" || !FORMA_TOKEN.test(token)) return null;
      const bruto = Buffer.from(token, "base64url");
      // Só a forma CANÔNICA: o último caractere tem bits sobrando, e outra grafia do mesmo token não é aceita.
      if (bruto.length !== TAMANHO_PAYLOAD + TAMANHO_MAC || bruto.toString("base64url") !== token) return null;
      const payload = bruto.subarray(0, TAMANHO_PAYLOAD);
      const recebido = bruto.subarray(TAMANHO_PAYLOAD);
      // O HMAC primeiro, em tempo constante: nada do conteúdo é interpretado antes de provado.
      if (!timingSafeEqual(recebido, mac(payload))) return null;
      if (payload.readUInt8(0) !== VERSAO_TOKEN) return null;
      const expira = Number(payload.readBigUInt64BE(49));
      if (!Number.isSafeInteger(expira) || expira <= agoraS) return null;
      const conteudo: ConteudoUrlRaster = {
        rasterId: bytesParaUuid(payload.subarray(1, 17)), organizationId: bytesParaUuid(payload.subarray(17, 33)),
        userId: bytesParaUuid(payload.subarray(33, 49)), expira
      };
      if (conteudo.rasterId !== rasterId.toLowerCase()) return null;
      return conteudo;
    }
  };
}
