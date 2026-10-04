/**
 * ARMAZENAMENTO DO ARQUIVO DO RASTER (SAT-06, decisão 297) — o PNG de valores do NDVI por pixel.
 *
 * Mesmo molde dos anexos (`lib/attachment-storage.ts`): uma INTERFACE, e hoje uma implementação NO BANCO
 * (`erp.satelite_raster_arquivos`, bytea; `bucket = "db"`) — o repositório não usa Supabase Storage (decisão do Maike).
 * Trocar por object storage é outra implementação desta interface; a rota não muda: o metadado
 * (`erp.satelite_rasters`) guarda o `storage_path`, que identifica onde o conteúdo está.
 *
 * ORDEM ("upload" ANTES da linha): a rota grava o ARQUIVO numa transação PRÓPRIA e curta, e só depois — noutra
 * transação — a linha do raster. A FK (organization_id, empresa_id, storage_path) da 0055 PROÍBE no banco a linha
 * apontando para arquivo inexistente; o contrário (arquivo sem linha, quando a segunda transação falha) é aceitável e
 * o arquivo NUNCA é apagado (imutável: nem o dono apaga). Gravar de novo o mesmo caminho (nova tentativa depois de uma
 * falha) não duplica nem troca o conteúdo: o primeiro arquivo fica, e a linha do raster copia o hash DELE.
 *
 * SOB RLS: a transação de `gravar` leva a GUC da organização, do usuário e do módulo da permissão de PEDIR a análise
 * (pecuária, o da área) — a política `tenant_e_empresa` da 0055 recusa a empresa fora do escopo dele. `ler` roda na
 * transação de quem chama (que já tem a GUC posta).
 */
import { createHash } from "node:crypto";
import { withTx, type Db, type Tx } from "@agro/db";
import { moduloDaPermissao } from "@agro/domain";

declare module "fastify" {
  interface FastifyInstance {
    /** Onde o arquivo do raster é guardado (banco hoje); os testes injetam outro para simular falha de "upload". */
    armazenamentoRaster: ArmazenamentoRaster;
  }
}

export interface ArmazenamentoRaster {
  readonly bucket: "db";
  /** Transação PRÓPRIA, curta, sob RLS (organização + usuário + módulo pecuária). Lança se não gravou nem achou o arquivo. */
  gravar(db: Db, ctx: { orgId: string; userId: string; empresaId: string }, a: { storagePath: string; png: Buffer; sha256: string }): Promise<void>;
  /**
   * O conteúdo, na transação de quem chama (sob a RLS dela) — ou `null`. `empresaId` (opcional) recorta também pela
   * empresa do raster já autorizado: o escopo entra em CADA ocorrência de tabela, não só na do metadado.
   */
  ler(tx: Tx, a: { orgId: string; storagePath: string; empresaId?: string }): Promise<Buffer | null>;
}

/** A permissão cujo módulo vai na GUC da gravação: a de PEDIR a análise (o módulo da área, pecuária). */
const PERMISSAO_GRAVAR_RASTER = "analises_satelitais.create";
const MODULO_GRAVACAO = moduloDaPermissao(PERMISSAO_GRAVAR_RASTER);

/** Formas aceitas antes do banco (o CHECK da 0055 confere de novo). */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORMA_DIA = /^\d{4}-\d{2}-\d{2}$/;
const FORMA_HEX64 = /^[0-9a-f]{64}$/;
const FORMA_INDICE = /^[a-z0-9_]{1,32}$/;

/** `{organization_id}/{area_id}/{indice}/{AAAA-MM-DD}/{chave_cache}.png` — a forma do CHECK da 0055. */
export function caminhoDoRaster(p: { orgId: string; areaId: string; indice: string; dataImagem: string; chaveCache: string }): string {
  if (!FORMA_UUID.test(p.orgId) || !FORMA_UUID.test(p.areaId) || !FORMA_INDICE.test(p.indice) || !FORMA_DIA.test(p.dataImagem) || !FORMA_HEX64.test(p.chaveCache)) {
    throw new Error("armazenamento do raster: componente do caminho fora da forma");
  }
  return `${p.orgId}/${p.areaId}/${p.indice}/${p.dataImagem}/${p.chaveCache}.png`;
}

export const dbArmazenamentoRaster: ArmazenamentoRaster = {
  bucket: "db",
  async gravar(db, ctx, a) {
    if (createHash("sha256").update(a.png).digest("hex") !== a.sha256) throw new Error("armazenamento do raster: o hash não é do conteúdo");
    await withTx(db, { orgId: ctx.orgId, userId: ctx.userId, modulo: MODULO_GRAVACAO }, async (tx) => {
      const g = await tx.query(
        `insert into erp.satelite_raster_arquivos (organization_id, empresa_id, storage_path, conteudo, sha256_arquivo, tamanho_bytes)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (organization_id, storage_path) do nothing`,
        [ctx.orgId, ctx.empresaId, a.storagePath, a.png, a.sha256, a.png.length]);
      if (g.rowCount === 1) return;
      if (g.rowCount !== 0) throw new Error("armazenamento do raster: a gravação devolveu mais de uma linha");
      // O caminho já existia (nova tentativa depois de uma falha, ou corrida entre réplicas): o arquivo precisa estar
      // VISÍVEL sob a RLS e ser da MESMA empresa — senão a linha do raster não teria para onde apontar.
      const e = await tx.query("select 1 from erp.satelite_raster_arquivos f where f.organization_id = $1 and f.empresa_id = $2 and f.storage_path = $3",
        [ctx.orgId, ctx.empresaId, a.storagePath]);
      if (e.rowCount !== 1) throw new Error("armazenamento do raster: o caminho já existe e o arquivo não é visível nesta empresa");
    });
  },
  async ler(tx, a) {
    const params: unknown[] = [a.orgId, a.storagePath];
    let empresa = "";
    if (a.empresaId !== undefined) { params.push(a.empresaId); empresa = " and f.empresa_id = $3"; }
    const r = await tx.query<{ conteudo: Buffer }>(
      `select f.conteudo from erp.satelite_raster_arquivos f where f.organization_id = $1 and f.storage_path = $2${empresa}`, params);
    return r.rows[0]?.conteudo ?? null;
  }
};

/** Implementação ativa (única hoje). */
export const armazenamentoRaster: ArmazenamentoRaster = dbArmazenamentoRaster;
