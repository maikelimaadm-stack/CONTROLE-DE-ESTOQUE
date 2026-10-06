/**
 * ARMAZENAMENTO DO PNG CATEGÓRICO DA CONDIÇÃO DO PASTO — SAT-COND-01.
 * Mesmo molde de `armazenamento-raster.ts`, tabela dedicada (sem misturar com rasters de índice).
 */
import { createHash } from "node:crypto";
import type { Tx } from "@agro/db";
import { caminhoDoMapaCondicao } from "./raster-condicao-pasto.js";

export { caminhoDoMapaCondicao };

export interface ArmazenamentoMapaCondicao {
  readonly bucket: "db";
  gravar(tx: Tx, a: { orgId: string; empresaId: string; storagePath: string; png: Buffer; sha256: string }): Promise<void>;
  ler(tx: Tx, a: { orgId: string; storagePath: string; empresaId?: string }): Promise<Buffer | null>;
}

export const dbArmazenamentoMapaCondicao: ArmazenamentoMapaCondicao = {
  bucket: "db",
  async gravar(tx, a) {
    if (createHash("sha256").update(a.png).digest("hex") !== a.sha256) {
      throw new Error("armazenamento do mapa de condição: o hash não é do conteúdo");
    }
    const g = await tx.query(
      `insert into erp.satelite_mapas_condicao_arquivos (organization_id, empresa_id, storage_path, conteudo, sha256_arquivo, tamanho_bytes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [a.orgId, a.empresaId, a.storagePath, a.png, a.sha256, a.png.length]);
    if (g.rowCount === 1) return;
    if (g.rowCount !== 0) throw new Error("armazenamento do mapa de condição: a gravação devolveu mais de uma linha");
    const e = await tx.query(
      "select 1 from erp.satelite_mapas_condicao_arquivos f where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $3",
      [a.orgId, a.empresaId, a.storagePath]);
    if (e.rowCount !== 1) throw new Error("armazenamento do mapa de condição: o caminho já existe e o arquivo não é visível nesta empresa");
  },
  async ler(tx, a) {
    const params: unknown[] = [a.orgId, a.storagePath];
    let empresa = "";
    if (a.empresaId !== undefined) { params.push(a.empresaId); empresa = " and f.empresa_id = $3"; }
    const r = await tx.query<{ conteudo: Buffer }>(
      `select f.conteudo from erp.satelite_mapas_condicao_arquivos f where f.organization_id = $1 and f.storage_path = $2${empresa}`, params);
    return r.rows[0]?.conteudo ?? null;
  }
};

export const armazenamentoMapaCondicao: ArmazenamentoMapaCondicao = dbArmazenamentoMapaCondicao;
