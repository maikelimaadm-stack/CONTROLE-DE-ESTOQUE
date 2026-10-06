/**
 * Cache em memória dos rasters das áreas à vista — regra pura (sem React e sem `@/`, para ser testada).
 *
 * A IDENTIDADE de um raster é índice × data × área × `geometria_sha256`. Imagem calculada sobre o contorno antigo de
 * uma área nunca serve ao contorno novo: quando o hash muda (a listagem devolveu outro hash, ou o contorno da área
 * mudou na lista de áreas), a entrada da área é solta — e a ObjectURL, revogada pelo `liberar` injetado.
 */

export interface EntradaComIdentidade {
  dto: {
    indice: string;
    data_imagem: string;
    area_id: string;
    geometria_sha256?: string | null;
  };
}

export const SEM_HASH = "sem-hash";

export function identidadeDoRaster(p: { indice: string; data: string; areaId: string; geometriaSha256: string | null | undefined }): string {
  return [p.indice, p.data, p.areaId, p.geometriaSha256 || SEM_HASH].join("|");
}

/**
 * Assinatura LOCAL do contorno (só para detectar que a lista de áreas trouxe outro desenho). Não é o hash do servidor
 * e nunca é enviada: o servidor calcula o dele sobre o contorno que guardou.
 */
export function assinaturaDaGeometria(geometria: unknown): string {
  if (!geometria) return "";
  const texto = JSON.stringify(geometria);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${texto.length}:${h1.toString(16)}${h2.toString(16)}`;
}

export class CacheRasters<E extends EntradaComIdentidade> {
  private readonly porIdentidade = new Map<string, E>();
  private readonly identidadeDaArea = new Map<string, string>();
  private readonly assinaturas = new Map<string, string>();
  private contexto: string | null = null;

  constructor(private readonly liberar: (entrada: E) => void) {}

  /** Contexto = índice × data ativos. Trocar solta tudo. Devolve `true` se mudou. */
  trocarContexto(chave: string): boolean {
    if (this.contexto === chave) return false;
    const havia = this.contexto !== null;
    this.contexto = chave;
    if (havia) this.limpar();
    return havia;
  }

  /**
   * Troca o contexto esvaziando o índice interno SEM liberar entradas (SWR).
   * Devolve as entradas órfãs para o chamador liberar só após o commit do novo snapshot.
   */
  trocarContextoPreservando(chave: string): { mudou: boolean; orfas: E[] } {
    if (this.contexto === chave) return { mudou: false, orfas: [] };
    const havia = this.contexto !== null;
    this.contexto = chave;
    if (!havia) return { mudou: false, orfas: [] };
    const orfas = [...this.porIdentidade.values()];
    this.porIdentidade.clear();
    this.identidadeDaArea.clear();
    return { mudou: true, orfas };
  }

  get tamanho(): number { return this.identidadeDaArea.size; }
  has(areaId: string): boolean { return this.identidadeDaArea.has(areaId); }
  keys(): string[] { return [...this.identidadeDaArea.keys()]; }
  identidade(areaId: string): string | null { return this.identidadeDaArea.get(areaId) ?? null; }

  get(areaId: string): E | undefined {
    const id = this.identidadeDaArea.get(areaId);
    return id === undefined ? undefined : this.porIdentidade.get(id);
  }

  /** Guarda a entrada da área; a anterior (de qualquer hash) é solta. */
  guardar(areaId: string, entrada: E): void {
    const nova = identidadeDoRaster({
      indice: entrada.dto.indice,
      data: entrada.dto.data_imagem,
      areaId,
      geometriaSha256: entrada.dto.geometria_sha256
    });
    this.remover(areaId);
    this.porIdentidade.set(nova, entrada);
    this.identidadeDaArea.set(areaId, nova);
  }

  remover(areaId: string): void {
    const id = this.identidadeDaArea.get(areaId);
    if (id === undefined) return;
    const entrada = this.porIdentidade.get(id);
    this.porIdentidade.delete(id);
    this.identidadeDaArea.delete(areaId);
    if (entrada) this.liberar(entrada);
  }

  /** Solta o que NÃO está em `manter` (área saiu da vista). */
  manter(manter: ReadonlySet<string>): void {
    for (const areaId of this.keys()) if (!manter.has(areaId)) this.remover(areaId);
  }

  limpar(): void {
    for (const areaId of this.keys()) this.remover(areaId);
  }

  /**
   * A listagem trouxe um hash para a área: se a entrada guardada é de OUTRO hash, ela é solta (e a ObjectURL, revogada).
   * Devolve `true` se soltou.
   */
  invalidarSeHashDiferente(areaId: string, geometriaSha256: string | null | undefined): boolean {
    const atual = this.get(areaId);
    if (!atual) return false;
    if ((atual.dto.geometria_sha256 || SEM_HASH) === (geometriaSha256 || SEM_HASH)) return false;
    this.remover(areaId);
    return true;
  }

  /**
   * Confere o contorno de cada área contra a última assinatura vista; contorno diferente solta a entrada da área.
   * Devolve os ids soltos (o chamador também esquece que a área "não tinha imagem").
   */
  sincronizarGeometrias(atuais: ReadonlyMap<string, string>): string[] {
    const soltas: string[] = [];
    for (const [areaId, assinatura] of atuais) {
      const anterior = this.assinaturas.get(areaId);
      if (anterior !== undefined && anterior !== assinatura) {
        soltas.push(areaId);
        this.remover(areaId);
      }
      this.assinaturas.set(areaId, assinatura);
    }
    return soltas;
  }

  snapshot(): ReadonlyMap<string, E> {
    return new Map(this.keys().map((id) => [id, this.get(id)!] as const));
  }
}
