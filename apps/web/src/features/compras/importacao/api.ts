"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CONTRATO_CONFERENCIA_IMPORTACAO_NFE, type CompraGeradaDaNota, type ConferenciaDaImportacaoNfe, type GerarCompraDaNota } from "@agro/domain";
import { api, ApiError } from "@/lib/api";

/**
 * AS PORTAS DA IMPORTAÇÃO DO XML DA NF-e (OPERACOES-01 F7, decisão 284) — e a leitura ESTRITA do que elas respondem.
 *
 *   POST /api/compras/importacoes                  o arquivo (XML, ou ZIP com um único XML) em base64 → 201 conferência
 *   POST /api/compras/importacoes/da-dfe/:dfeId    o XML que a fila de DF-e guardou → 201 conferência
 *   GET  /api/compras/importacoes/:id              a conferência (`?fornecedor_id=` escolhe entre os candidatos)
 *   POST /api/compras/importacoes/:id/gerar-compra a COMPRA ABERTA (201) — nunca confirmada aqui
 *   POST /api/compras/importacoes/:id/descartar    a importação descartada (200)
 *
 * Nenhuma destas portas é perguntada sem a capacidade `importacaoXml` "sim" (`./capacidade`): a tela que chama é que
 * só aparece com ela. A conferência só vira tela depois de CONFERIDA a forma (`lerConferencia`): um corpo fora do
 * contrato 1 é "indisponível", nunca uma tela meio desenhada. Tudo aqui é APRESENTAÇÃO: quem decide é o servidor.
 */

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";
const propria = (o: Record<string, unknown>, chave: string): unknown => (Object.hasOwn(o, chave) ? o[chave] : undefined);

/** A rota da conferência de uma importação (a `solicitacao_id` da solicitação antiga vai junto, quando houver). */
export function rotaDaConferencia(id: string, solicitacaoId?: string | null): string {
  return `/compras/importacoes/${encodeURIComponent(id)}${solicitacaoId ? `?${new URLSearchParams({ solicitacao_id: solicitacaoId }).toString()}` : ""}`;
}

/** O "Importar XML" dos Documentos de Compras (o diálogo abre por `?importar=xml`). */
export const ROTA_DO_IMPORTAR_XML = "/compras?tab=documentos&importar=xml";
/** A partir da solicitação de compra antiga (etapa de recebimento): o diálogo leva a solicitação até a conferência. */
export const rotaDoImportarXmlDaSolicitacao = (solicitacaoId: string) =>
  `${ROTA_DO_IMPORTAR_XML}&${new URLSearchParams({ solicitacao_id: solicitacaoId }).toString()}`;

/**
 * A CONFERÊNCIA conferida antes de virar tela: o contrato 1 e as partes que a tela lê (o resto é tipo do domínio, o
 * mesmo que a API responde). Fora da forma → `null` (a tela diz "indisponível", sem inventar nada em nome do servidor).
 */
export function lerConferencia(corpo: unknown): ConferenciaDaImportacaoNfe | null {
  if (!ehObjeto(corpo) || propria(corpo, "contractVersion") !== CONTRATO_CONFERENCIA_IMPORTACAO_NFE) return null;
  const situacao = propria(corpo, "situacao");
  if (!ehTexto(propria(corpo, "id")) || !(situacao === "pendente" || situacao === "gerada" || situacao === "descartada")) return null;
  const nota = propria(corpo, "nota"); const parceiro = propria(corpo, "parceiro"); const empresa = propria(corpo, "empresa");
  const pedidos = propria(corpo, "pedidos"); const financeiro = propria(corpo, "financeiro");
  if (!ehObjeto(nota) || !Array.isArray(nota.itens) || !ehObjeto(nota.totais) || !ehObjeto(nota.emitente)) return null;
  if (!ehObjeto(parceiro) || !ehTexto(parceiro.situacao) || !ehObjeto(empresa) || !ehTexto(empresa.id)) return null;
  if (!Array.isArray(propria(corpo, "itens")) || !Array.isArray(propria(corpo, "divergencias"))) return null;
  if (!ehObjeto(pedidos) || !Array.isArray(pedidos.referenciados) || !Array.isArray(pedidos.candidatos)) return null;
  if (!ehObjeto(financeiro) || !ehObjeto(financeiro.parcelas) || !ehTexto(financeiro.parcelas.situacao)) return null;
  const itens = propria(corpo, "itens") as unknown[];
  if (itens.length !== nota.itens.length || !itens.every((i) => ehObjeto(i) && typeof i.nItem === "number" && ehObjeto(i.vinculo) && ehTexto(i.vinculo.situacao))) return null;
  return corpo as unknown as ConferenciaDaImportacaoNfe;
}

/** A chave do React Query da conferência (a tela relê depois de escolher/cadastrar o fornecedor). */
export const chaveDaConferencia = (id: string, fornecedorId: string | null) => ["compras-importacao", id, fornecedorId ?? ""] as const;

/** A conferência de UMA importação; `fornecedorId` é PEDIDO (o servidor confere contra os candidatos do emitente). */
export function useConferencia(id: string, fornecedorId: string | null) {
  return useQuery<unknown, ApiError>({
    queryKey: chaveDaConferencia(id, fornecedorId),
    queryFn: () => api<unknown>(`/api/compras/importacoes/${encodeURIComponent(id)}${fornecedorId ? `?${new URLSearchParams({ fornecedor_id: fornecedorId }).toString()}` : ""}`),
    retry: false,
    // Trocar o fornecedor não desmonta a conferência: a resposta anterior vale até a nova chegar (as decisões ficam).
    placeholderData: keepPreviousData,
    // A conferência é o retrato do servidor: a tela não a pergunta de novo sozinha enquanto a pessoa decide.
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
}

/** Corpo do `POST /api/compras/importacoes`. */
export interface CorpoDaImportacao { nome_arquivo: string; arquivo_base64: string; empresa_id?: string }

export const importarArquivo = (corpo: CorpoDaImportacao, chave: string) =>
  api<unknown>("/api/compras/importacoes", { method: "POST", body: corpo, idempotencyKey: chave });

export const importarDaDfe = (dfeId: string, chave: string) =>
  api<unknown>(`/api/compras/importacoes/da-dfe/${encodeURIComponent(dfeId)}`, { method: "POST", body: {}, idempotencyKey: chave });

export const gerarCompraDaImportacao = (id: string, corpo: GerarCompraDaNota, chave: string) =>
  api<CompraGeradaDaNota>(`/api/compras/importacoes/${encodeURIComponent(id)}/gerar-compra`, { method: "POST", body: corpo, idempotencyKey: chave });

export const descartarImportacao = (id: string, chave: string) =>
  api<{ id: string; situacao: "descartada" }>(`/api/compras/importacoes/${encodeURIComponent(id)}/descartar`, { method: "POST", body: {}, idempotencyKey: chave });

/* ═════════════════════════════════════ a leitura das recusas ═════════════════════════════════════ */

/** Um detalhe de recusa por campo (422): `path` diz o campo (e a aba), `message` o porquê. */
export interface RecusaNoCampo { path: string; message: string; motivo?: string }

/** Os detalhes de uma recusa 422 (lista de `{ path, message }`); outra forma → []. */
export function recusasNoCampo(e: unknown): RecusaNoCampo[] {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return [];
  const out: RecusaNoCampo[] = [];
  for (const d of e.details as unknown[]) {
    if (!ehObjeto(d) || !ehTexto(d.path) || !ehTexto(d.message)) continue;
    out.push({ path: d.path, message: d.message, ...(ehTexto(d.motivo) ? { motivo: d.motivo } : {}) });
  }
  return out;
}

/** O destinatário ambíguo (422 `empresa_id` com `candidatos`): as empresas do escopo entre as quais a pessoa escolhe. */
export function candidatasDoDestinatario(e: unknown): { id: string; nome: string }[] | null {
  if (!(e instanceof ApiError) || e.status !== 422 || !Array.isArray(e.details)) return null;
  for (const d of e.details as unknown[]) {
    if (!ehObjeto(d) || d.path !== "empresa_id" || !Array.isArray(d.candidatos)) continue;
    const candidatas = (d.candidatos as unknown[]).filter((c): c is { id: string; nome: string } => ehObjeto(c) && ehTexto(c.id) && ehTexto(c.nome));
    return candidatas.length ? candidatas.map((c) => ({ id: c.id, nome: c.nome })) : null;
  }
  return null;
}

/** A nota já tem importação PENDENTE (409 `{ onde: "importacao", id }`): o id para abrir a pendente; senão null. */
export function importacaoPendenteDoConflito(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !ehObjeto(e.details)) return null;
  return e.details.onde === "importacao" && ehTexto(e.details.id) ? e.details.id : null;
}

/** A nota já lançada e VISÍVEL (409 `{ onde: "compra" | "documento_fiscal_estoque", codigo }`); senão null. */
export function notaJaLancadaDoConflito(e: unknown): { onde: "compra" | "documento_fiscal_estoque"; codigo: string } | null {
  if (!(e instanceof ApiError) || e.status !== 409 || !ehObjeto(e.details)) return null;
  const { onde, codigo } = e.details;
  return (onde === "compra" || onde === "documento_fiscal_estoque") && ehTexto(codigo) ? { onde, codigo } : null;
}

/**
 * O id da COMPRA pelo código (a recusa da nota repetida diz o código, não o id): a busca da lista da espécie, no
 * servidor, e só a linha com o código EXATO. Nenhuma ou mais de uma → null (a tela não inventa o destino).
 */
export async function idDaCompraPeloCodigo(codigo: string): Promise<string | null> {
  const r = await api<{ items?: unknown[] }>(`/api/compras/compras?${new URLSearchParams({ search: codigo, pageSize: "20" }).toString()}`);
  const exatas = (r.items ?? []).filter((x): x is { id: string; codigo: string } => ehObjeto(x) && ehTexto(x.id) && x.codigo === codigo);
  return exatas.length === 1 ? exatas[0]!.id : null;
}

/* ═════════════════════════════════════ o arquivo ═════════════════════════════════════ */

/** O maior arquivo que o servidor aceita (o mesmo limite da porta; ele confere de novo). */
export const ARQUIVO_MAXIMO_BYTES = 3 * 1024 * 1024;

/** O arquivo em base64, pelo `FileReader` (os bytes como vieram: o servidor decide a codificação do XML). */
export function arquivoEmBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error ?? new Error("Não foi possível ler o arquivo."));
    leitor.onload = () => {
      const url = typeof leitor.result === "string" ? leitor.result : "";
      const virgula = url.indexOf(",");
      if (!url.startsWith("data:") || virgula < 0) { reject(new Error("Não foi possível ler o arquivo.")); return; }
      resolve(url.slice(virgula + 1));
    };
    leitor.readAsDataURL(arquivo);
  });
}
