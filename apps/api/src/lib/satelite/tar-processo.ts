/**
 * PARSER FAIL-CLOSED DE RESPOSTA TAR DA PROCESS API — SAT-BUNDLE-01C.
 *
 * Contrato (CDSE / Sentinel Hub Process API):
 *   Accept: application/tar | application/x-tar
 *   Membros = um arquivo por `output.responses[].identifier` (tipicamente `{id}.png`).
 *
 * Docs: https://docs.sentinel-hub.com/api/latest/evalscript/v3/
 * Spec: https://docs.planet.com/redocusaurus/sh-prod-process-api-spec.yaml
 */
import { PassThrough } from "node:stream";
import { extract as tarExtract } from "tar-stream";
import { ehIdOutputBundle, type IdOutputBundleEspacial } from "./evalscript-bundle-espacial.js";
import { temAssinaturaPng } from "./png.js";

/** Teto global do TAR (7 PNGs × 16 MiB com folga). */
export const TAMANHO_MAXIMO_TAR_PROCESSO_BYTES = 48 * 1024 * 1024;
/** Teto por membro (igual ao PNG unitário). */
export const TAMANHO_MAXIMO_MEMBRO_TAR_BYTES = 16 * 1024 * 1024;
/** Máximo de entries no arquivo (produtos + folga). */
export const MAX_ENTRIES_TAR_PROCESSO = 16;

export type MotivoTarMalformado =
  | "tar_malformado"
  | "membro_ausente"
  | "membro_duplicado"
  | "membro_inesperado"
  | "path_traversal"
  | "tamanho_excedido"
  | "png_invalido"
  | "entries_demais";

export class FalhaTarProcesso extends Error {
  constructor(readonly motivo: MotivoTarMalformado, message: string) {
    super(message);
    this.name = "FalhaTarProcesso";
  }
}

export interface MembroTarPng {
  id: IdOutputBundleEspacial;
  nome: string;
  png: Buffer;
}

/**
 * Normaliza o nome do membro TAR → identifier canônico.
 * Aceita: `ndvi`, `ndvi.png`, `./ndvi.png`. Rejeita path absoluto, `..`, symlink-like.
 */
export function identifierDoMembroTar(nomeBruto: string): IdOutputBundleEspacial | null {
  if (typeof nomeBruto !== "string" || !nomeBruto) return null;
  let nome = nomeBruto.replace(/\\/g, "/");
  if (nome.startsWith("/") || nome.includes("\0")) return null;
  if (nome.startsWith("./")) nome = nome.slice(2);
  if (nome.includes("..") || nome.includes("/")) return null;
  const base = nome.toLowerCase().replace(/\.png$/i, "");
  if (!ehIdOutputBundle(base)) return null;
  return base;
}

/**
 * Extrai PNGs nomeados do TAR. Fail-closed:
 * - path traversal / absoluto / `..` → rejeita
 * - symlink/hardlink/dir → rejeita
 * - duplicata de identifier → rejeita
 * - membro com nome não permitido → ignora se irrelevante; se solicitado e ausente → falha
 * - tamanho global/individual → rejeita
 * - cada id solicitado deve existir com PNG válido
 */
export async function extrairPngsDoTarProcesso(
  tar: Buffer,
  solicitados: readonly IdOutputBundleEspacial[]
): Promise<Map<IdOutputBundleEspacial, MembroTarPng>> {
  if (!Buffer.isBuffer(tar) || tar.length === 0) {
    throw new FalhaTarProcesso("tar_malformado", "TAR vazio");
  }
  if (tar.length > TAMANHO_MAXIMO_TAR_PROCESSO_BYTES) {
    throw new FalhaTarProcesso("tamanho_excedido", "TAR acima do teto global");
  }
  const precisos = new Set(solicitados);
  if (precisos.size === 0) throw new FalhaTarProcesso("membro_ausente", "nenhum output solicitado");

  // tar-stream v3 tipa `extract()` sem opções; formato estranho cai em "error"/"tar_malformado".
  const extract = tarExtract();
  const achados = new Map<IdOutputBundleEspacial, MembroTarPng>();
  let entries = 0;

  const pronto = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      void (async () => {
        try {
          entries += 1;
          if (entries > MAX_ENTRIES_TAR_PROCESSO) {
            stream.resume();
            throw new FalhaTarProcesso("entries_demais", "TAR com entradas demais");
          }
          const tipo = header.type ?? "file";
          if (tipo !== "file") {
            stream.resume();
            throw new FalhaTarProcesso("tar_malformado", `tipo de membro proibido: ${String(tipo)}`);
          }
          const nome = header.name ?? "";
          if (nome.includes("..") || nome.startsWith("/") || nome.includes("\0")) {
            stream.resume();
            throw new FalhaTarProcesso("path_traversal", `path inválido: ${nome}`);
          }
          const id = identifierDoMembroTar(nome);
          if (!id) {
            // Membro inesperado (ex.: userdata) — descarta sem confundir identifiers.
            stream.resume();
            next();
            return;
          }
          if (!precisos.has(id)) {
            stream.resume();
            next();
            return;
          }
          if (achados.has(id)) {
            stream.resume();
            throw new FalhaTarProcesso("membro_duplicado", `identifier duplicado: ${id}`);
          }
          if (typeof header.size === "number" && header.size > TAMANHO_MAXIMO_MEMBRO_TAR_BYTES) {
            stream.resume();
            throw new FalhaTarProcesso("tamanho_excedido", `membro ${id} acima do teto`);
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of stream) {
            let b: Buffer;
            if (Buffer.isBuffer(chunk)) b = chunk;
            else if (chunk instanceof Uint8Array) b = Buffer.from(chunk);
            else if (typeof chunk === "string") b = Buffer.from(chunk);
            else throw new FalhaTarProcesso("tar_malformado", "chunk de membro inválido");
            total += b.length;
            if (total > TAMANHO_MAXIMO_MEMBRO_TAR_BYTES) {
              throw new FalhaTarProcesso("tamanho_excedido", `membro ${id} acima do teto`);
            }
            chunks.push(b);
          }
          const png = Buffer.concat(chunks, total);
          if (!temAssinaturaPng(png)) {
            throw new FalhaTarProcesso("png_invalido", `membro ${id} não é PNG`);
          }
          achados.set(id, { id, nome, png });
          next();
        } catch (e) {
          reject(e);
        }
      })();
    });
    extract.on("finish", () => resolve());
    extract.on("error", (e: unknown) => reject(new FalhaTarProcesso("tar_malformado", e instanceof Error ? e.message : "tar")));
  });

  const inlet = new PassThrough();
  inlet.end(tar);
  inlet.pipe(extract);
  await pronto;

  for (const id of precisos) {
    if (!achados.has(id)) {
      throw new FalhaTarProcesso("membro_ausente", `output ausente no TAR: ${id}`);
    }
  }
  return achados;
}
