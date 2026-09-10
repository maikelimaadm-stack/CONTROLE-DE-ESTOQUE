/** Utilitários mínimos e seguros para montar SQL parametrizado. */
export class SqlBuilder {
  private parts: string[] = [];
  readonly params: unknown[] = [];
  push(text: string, ...values: unknown[]) {
    let i = 0;
    this.parts.push(text.replace(/\?/g, () => { this.params.push(values[i++]); return `$${this.params.length}`; }));
    return this;
  }
  add(value: unknown): string { this.params.push(value); return `$${this.params.length}`; }
  get text() { return this.parts.join(" "); }
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
export function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`identificador inválido: ${name}`);
  return `"${name}"`;
}
