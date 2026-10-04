/**
 * CHAVE DE IDEMPOTÊNCIA DO ITEM DA CONSULTA EM LOTE — SAT-02, decisão 295.
 *
 * A ORIGEM da chave (organização, área, hash da geometria, índice, slot e versão do método) é montada no domínio
 * (`origemChaveIdempotencia`, em @agro/domain), que é isomórfico e roda também na web. O hash fica aqui, na API,
 * porque só ela grava a chave e só ela tem `node:crypto` — o domínio não ganha dependência de Node por causa disso.
 *
 * sha256 em hex minúsculo (64 caracteres): o formato que o CHECK da 0053 exige em `chave_idempotencia`, e o que o
 * índice único parcial compara. A origem legível é gravada ao lado, para depurar uma colisão sem inverter o hash.
 */
import { createHash } from "node:crypto";

/** sha256 hex (64) da origem, lida como UTF-8. Determinística: a mesma origem dá sempre a mesma chave. */
export function chaveIdempotencia(origem: string): string {
  return createHash("sha256").update(origem, "utf8").digest("hex");
}
