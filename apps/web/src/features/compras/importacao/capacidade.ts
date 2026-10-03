"use client";
import { useQuery } from "@tanstack/react-query";
import { CAPACIDADE_IMPORTACAO_XML_COMPRA } from "@agro/domain";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { varianteDeCompra } from "../variantes";
import type { EstadoDaCapacidade } from "../pedido-e-orcamento";

/**
 * A CAPACIDADE DA ENTRADA DE NOTA POR XML (OPERACOES-01 F7, decisão 284) — `capacidades.importacaoXml` da porta
 * `GET /api/compras/<segmento da compra>/operation-types`.
 *
 * Sem a declaração (a API anterior, skew sentido 1) a web fica EXATAMENTE como hoje: sem "Importar XML", sem o bloco
 * "Dados fiscais" na Central de Compras manual (o corpo do POST é o de hoje, byte a byte), sem a ação da solicitação, e
 * o "Lançar" da DF-e é o link de hoje. Nenhum pedido a `/api/compras/importacoes*` sai sem "sim".
 *
 * A pergunta é a MESMA da Central e do lançador (`useTopsDaEspecie` em `variantes.ts`): a mesma chave do React Query
 * (`["compras-operation-types", <segmento>]`) e a mesma porta — quem já carregou as TOPs da compra não pergunta de novo.
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * O corpo de `/operation-types` declara `capacidades.importacaoXml === CAPACIDADE_IMPORTACAO_XML_COMPRA`? Propriedade
 * PRÓPRIA (nunca herdada do protótipo) e o envelope do contrato (`contractVersion` 1): um corpo que não a declara não a tem.
 */
export function declaraImportacaoXml(corpo: unknown): boolean {
  if (!ehObjeto(corpo) || !Object.hasOwn(corpo, "contractVersion") || corpo.contractVersion !== 1) return false;
  const capacidades = Object.hasOwn(corpo, "capacidades") ? corpo.capacidades : undefined;
  return ehObjeto(capacidades) && Object.hasOwn(capacidades, "importacaoXml")
    && capacidades.importacaoXml === CAPACIDADE_IMPORTACAO_XML_COMPRA;
}

/**
 * "sim" | "nao" | "carregando". A porta exige `compras.create` (lançar compra): sem a permissão, "nao" SEM perguntar
 * nada; com as permissões ainda carregando, "carregando" (nada novo aparece e nada some depois). `habilitado` falso:
 * "nao", sem pergunta (a tela que não usa a capacidade). Resposta de erro ou fora do contrato: "nao" (o de hoje).
 */
export function useImportacaoXml(habilitado = true): EstadoDaCapacidade {
  const { can, loading } = useAuth();
  const variante = varianteDeCompra("compra");
  const segmento = variante?.segmento ?? "";
  const pode = habilitado && Boolean(variante) && !loading && can(`${variante?.perm ?? ""}.create`);
  const q = useQuery<unknown, ApiError>({
    // A MESMA chave (e a mesma porta) de `useTopsDaEspecie` — cache compartilhado.
    queryKey: ["compras-operation-types", segmento],
    queryFn: () => api<unknown>(`/api/compras/${segmento}/operation-types`),
    enabled: pode && Boolean(segmento),
    retry: false
  });
  if (!habilitado || !variante) return "nao";
  if (loading) return "carregando";
  if (!pode) return "nao";
  if (q.isSuccess) return declaraImportacaoXml(q.data) ? "sim" : "nao";
  return q.isPending ? "carregando" : "nao";
}
