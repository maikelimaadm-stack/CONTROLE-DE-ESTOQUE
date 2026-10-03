/**
 * OPERACOES-01 F7 (decisão 284) — O XML DA NOTA NO SERVIDOR: o texto, o destinatário, o original guardado e a CHAVE.
 *
 * Um lugar só para o que a importação na Central de Compras (`routes/compras-importacao.ts`), a fila de DF-e
 * (`routes/stock.ts`), a compra (`routes/compras.ts`) e a nota antiga precisam fazer IGUAL:
 *
 *   · `textoDoXml` — os bytes do arquivo viram texto: ISO-8859-1 quando a declaração diz, senão UTF-8 (sem BOM),
 *     recusando byte que não é UTF-8 (nunca um "�" calado no XML guardado);
 *   · `resolverDestinatario` — a empresa DESTINATÁRIA da nota, pelo documento normalizado (+ IE), dentro do escopo
 *     de ESCRITA do módulo da rota. A empresa do corpo é PEDIDO, conferido contra os candidatos; zero candidatos e
 *     empresa fora do escopo dão a MESMA recusa; mais de um sem pedido é pendência com os candidatos — nunca "a primeira";
 *   · `guardarXmlDaNota` — o ORIGINAL em `erp.notas_fiscais_xml` (imutável): o mesmo conteúdo é a mesma linha;
 *   · `travarChaveDeAcesso` e `conferirChaveDeAcessoLivre` — a nota repetida pela CHAVE. A trava é a MESMA dos gatilhos
 *     da 0047 (`hashtextextended('nfe-chave:' || org || ':' || chave, 284)`): a API e o banco serializam a mesma chave.
 *     A conferência diz ONDE a nota está quando a pessoa a enxerga (409 com `onde` e `codigo`); quando não enxerga
 *     (outra empresa), o banco recusa sem dizer onde ("Esta nota já foi lançada nesta organização.").
 */
import { createHash } from "node:crypto";
import { formatarChaveDeAcesso, type NotaFiscalLida } from "@agro/domain";
import { err } from "./errors.js";
import { empresaPermitida, moduloAtivo, type ServiceCtx } from "./context.js";

/** O tamanho máximo do XML guardado, em bytes UTF-8 (o CHECK de `notas_fiscais_xml.tamanho_bytes`). */
export const LIMITE_XML_GUARDADO_BYTES = 2_097_152;

const recusa = (path: string, message: string, extra: Record<string, unknown> = {}) => err("VALIDATION_ERROR", message, [{ path, message, ...extra }]);

/** Documento (CPF/CNPJ) como o índice dos cadastros o guarda: só [0-9A-Z], em maiúsculas (mantém o CNPJ alfanumérico). */
export const documentoNormalizado = (v: string | null | undefined): string => String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
/** A expressão SQL do mesmo documento normalizado (a de `ux_people_documento_normalizado`, 0027). */
export const SQL_DOCUMENTO_NORMALIZADO = (coluna: string) => `upper(regexp_replace(${coluna}, '[^0-9A-Za-z]', '', 'g'))`;

// ─────────────── o texto do arquivo ───────────────

const ENCODINGS_LATIN1 = new Set(["iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1"]);

/**
 * Os bytes do arquivo como TEXTO. A declaração `<?xml … encoding="ISO-8859-1"?>` (lida em ASCII) decide latin1; sem
 * ela, ou com outra, UTF-8 — o BOM é tirado e byte que não é UTF-8 é RECUSADO (422 no `campo`), em vez de virar "�"
 * dentro do original guardado.
 */
export function textoDoXml(buf: Buffer, campo = "arquivo"): string {
  const temBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const bytes = temBom ? buf.subarray(3) : buf;
  const prologo = bytes.subarray(0, 200).toString("latin1");
  const enc = /^\s*<\?xml[^>]*?\bencoding\s*=\s*["']([^"']+)["']/i.exec(prologo)?.[1]?.trim().toLowerCase() ?? null;
  if (!temBom && enc && ENCODINGS_LATIN1.has(enc)) return bytes.toString("latin1");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw recusa(campo, "O arquivo não está em UTF-8 nem declara ISO-8859-1: envie o XML como foi emitido.");
  }
}

// ─────────────── o destinatário ───────────────

export interface EmpresaDestinataria { id: string; nome: string }

/**
 * A EMPRESA DESTINATÁRIA da nota. Candidatas: as empresas VIVAS da organização com o documento normalizado igual ao
 * do destinatário (`nota.destinatario.documento`, já normalizado pelo leitor). Com a IE do destinatário e mais de uma
 * candidata, ficam as que casam a IE (só dígitos; `ISENTO` literal) — quando isso deixa ao menos uma. Depois, só as do
 * escopo de ESCRITA do módulo (`empresaPermitida`, a mesma régua de `exigirEmpresaDeLancamento`).
 *
 * `empresaIdPedida` (do corpo) é PEDIDO: tem de estar entre essas. Zero candidatas, empresa pedida fora delas e empresa
 * fora do escopo dão a MESMA 422 em `empresa_id` (sem oráculo de existência). Mais de uma sem pedido → 422 com os
 * candidatos (só os do escopo) no detalhe. Nunca "a primeira". As candidatas são as empresas de UM documento: poucas, e
 * a conferência de escopo de cada uma é a da casa.
 */
export async function resolverDestinatario(ctx: ServiceCtx, nota: Pick<NotaFiscalLida, "destinatario">, empresaIdPedida: string | null | undefined,
  modulo: string | null = moduloAtivo(ctx), o: { oQue?: string } = {}): Promise<EmpresaDestinataria> {
  const documento = documentoNormalizado(nota.destinatario.documento);
  const fora = `O destinatário desta nota não é uma empresa em que você pode ${o.oQue ?? "lançar compras"}.`;
  if (!documento) throw recusa("empresa_id", fora);
  const r = await ctx.tx.query<{ id: string; nome: string; ie: string | null }>(
    `select e.id::text as id, e.name as nome, e.state_registration as ie
       from erp.empresas e
      where e.organization_id = $1 and e.deleted_at is null and ${SQL_DOCUMENTO_NORMALIZADO("e.document")} = $2
      order by e.code, e.id`, [ctx.orgId, documento]);
  let candidatas = r.rows;
  const ieNota = normalizarIe(nota.destinatario.ie);
  if (ieNota && candidatas.length > 1) {
    const casam = candidatas.filter((e) => normalizarIe(e.ie) === ieNota);
    if (casam.length >= 1) candidatas = casam;
  }
  const permitidas: { id: string; nome: string }[] = [];
  for (const e of candidatas) if (await empresaPermitida(ctx, e.id, modulo)) permitidas.push({ id: e.id, nome: e.nome });
  if (empresaIdPedida) {
    const pedida = permitidas.find((e) => e.id === empresaIdPedida.toLowerCase());
    if (!pedida) throw recusa("empresa_id", fora);
    return pedida;
  }
  if (permitidas.length === 0) throw recusa("empresa_id", fora);
  if (permitidas.length > 1) {
    throw recusa("empresa_id", "O destinatário corresponde a mais de uma empresa: escolha a empresa da compra.", { candidatos: permitidas });
  }
  return permitidas[0]!;
}

/** IE só com dígitos; "ISENTO" (qualquer caixa) fica literal; vazio = sem IE. */
function normalizarIe(ie: string | null | undefined): string | null {
  const t = String(ie ?? "").trim();
  if (!t) return null;
  if (t.toUpperCase() === "ISENTO") return "ISENTO";
  const d = t.replace(/\D/g, "");
  return d || null;
}

// ─────────────── o original guardado ───────────────

/**
 * GUARDA O ORIGINAL em `erp.notas_fiscais_xml` (imutável). O mesmo conteúdo (organização + chave + SHA-256 dos bytes
 * UTF-8) é a MESMA linha: `on conflict do nothing` e a releitura. A linha que já existe com OUTRA empresa (ou que o
 * escopo de quem grava não enxerga) não é reaproveitada: 409 — o XML de uma nota é de um destinatário só.
 */
export async function guardarXmlDaNota(ctx: ServiceCtx, x: { empresaId: string; chave: string; texto: string; nomeArquivo: string | null; campo?: string }): Promise<{ id: string }> {
  const campo = x.campo ?? "arquivo";
  if (x.texto.includes("\u0000")) throw recusa(campo, "O XML traz um caractere nulo e não pode ser guardado.");
  const bytes = Buffer.from(x.texto, "utf8");
  if (bytes.length === 0 || bytes.length > LIMITE_XML_GUARDADO_BYTES) throw recusa(campo, "O XML passa do tamanho aceito (2 MB).");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const nome = x.nomeArquivo?.trim() ? x.nomeArquivo.trim().slice(0, 255) : null;
  const ins = await ctx.tx.query<{ id: string }>(
    `insert into erp.notas_fiscais_xml (organization_id, empresa_id, chave_acesso, xml_original, xml_sha256, tamanho_bytes, nome_arquivo, recebido_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (organization_id, chave_acesso, xml_sha256) do nothing
     returning id::text as id`,
    [ctx.orgId, x.empresaId, x.chave, x.texto, sha, bytes.length, nome, ctx.user.id]);
  if (ins.rows[0]) return { id: ins.rows[0].id };
  const ja = await ctx.tx.query<{ id: string; empresa_id: string }>(
    "select id::text as id, empresa_id::text as empresa_id from erp.notas_fiscais_xml where organization_id = $1 and chave_acesso = $2 and xml_sha256 = $3",
    [ctx.orgId, x.chave, sha]);
  const linha = ja.rows[0];
  if (!linha || linha.empresa_id !== x.empresaId.toLowerCase()) throw err("CONFLICT", "Este XML já está guardado para outra empresa.");
  return { id: linha.id };
}

// ─────────────── a chave de acesso ───────────────

/**
 * A TRAVA DA CHAVE, até o fim da transação: a MESMA dos gatilhos da 0047 (`documentos_compra_nota_guarda` e
 * `invoices_chave_nota_guarda`), montada no SQL com o mesmo texto (`org::text`), para a API e o banco nunca usarem
 * duas chaves de trava diferentes para a mesma nota.
 */
export async function travarChaveDeAcesso(ctx: ServiceCtx, chave: string): Promise<void> {
  await ctx.tx.query("select pg_advisory_xact_lock(hashtextextended('nfe-chave:' || $1::uuid::text || ':' || $2::text, 284))", [ctx.orgId, chave]);
}

/**
 * A NOTA (CHAVE DE ACESSO) JÁ LANÇADA? Trava a chave e procura, pela RLS de quem lança: a COMPRA não cancelada com a
 * chave (409 DUPLICATE_DOCUMENT `{ onde: "compra", codigo }`) e, com `notaAntiga` (padrão), o Documento fiscal de
 * Estoque não cancelado e não excluído (`{ onde: "documento_fiscal_estoque", codigo }`). O que a pessoa não enxerga
 * (outra empresa) não é dito aqui: o índice e os gatilhos da 0047 recusam no INSERT, sem dizer onde.
 */
export async function conferirChaveDeAcessoLivre(ctx: ServiceCtx, chave: string, o: { excluirDocumentoId?: string | null; notaAntiga?: boolean } = {}): Promise<void> {
  await travarChaveDeAcesso(ctx, chave);
  const exibida = formatarChaveDeAcesso(chave);
  const compra = await ctx.tx.query<{ codigo: string }>(
    `select codigo from erp.documentos_compra
      where organization_id = $1 and especie = 'compra' and situacao <> 'cancelado' and chave_acesso = $2 and ($3::uuid is null or id <> $3::uuid)
      order by created_at, id limit 1`, [ctx.orgId, chave, o.excluirDocumentoId ?? null]);
  const codigo = compra.rows[0]?.codigo;
  if (codigo) throw err("DUPLICATE_DOCUMENT", `A nota de chave ${exibida} já está na Compra ${codigo}.`, { onde: "compra", codigo });
  if (o.notaAntiga === false) return;
  const nf = await ctx.tx.query<{ code: string }>(
    `select code from erp.invoices
      where organization_id = $1 and access_key = $2 and status <> 'cancelled' and deleted_at is null
      order by created_at, id limit 1`, [ctx.orgId, chave]);
  const code = nf.rows[0]?.code;
  if (code) throw err("DUPLICATE_DOCUMENT", `A nota de chave ${exibida} já está no Documento fiscal de Estoque ${code}.`, { onde: "documento_fiscal_estoque", codigo: code });
}
