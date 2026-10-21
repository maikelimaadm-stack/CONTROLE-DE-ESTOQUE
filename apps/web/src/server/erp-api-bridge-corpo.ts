/**
 * Corpo aceito pelo `Response` do Fetch: 204/205/304 exigem `null`.
 * `Uint8Array(0)` ainda é corpo e estoura "Invalid response status code 204".
 */
export function corpoParaFetch(status: number, rawPayload: Uint8Array | Buffer): Uint8Array | null {
  if (status === 204 || status === 205 || status === 304) return null;
  // Buffer é Uint8Array no Node — copiar evita devolver Buffer cru ao Response.
  return new Uint8Array(rawPayload);
}
