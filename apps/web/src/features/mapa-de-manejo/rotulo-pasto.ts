/** Texto do rótulo no pasto: código (numeração) quando existir; senão o nome. */
export function rotuloPasto(a: { code?: string | null; name: string }): string {
  const codigo = a.code?.trim();
  return codigo && codigo.length > 0 ? codigo : a.name;
}
