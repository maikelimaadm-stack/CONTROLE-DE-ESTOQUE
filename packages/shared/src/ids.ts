export type UUID = string;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUUID = (s: unknown): s is UUID => typeof s === "string" && UUID_RE.test(s);
/** Códigos sequenciais por organização são formatados com 4+ dígitos (ex.: 0001), como no sistema de referência. */
export const formatCode = (n: number, width = 4) => String(n).padStart(width, "0");
