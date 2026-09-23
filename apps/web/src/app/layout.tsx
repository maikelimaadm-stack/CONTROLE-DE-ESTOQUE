import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
/**
 * DM SANS, SERVIDA DO PRÓPRIO PROJETO (FONTE-LOCAL-01).
 *
 * Era `DM_Sans` de `next/font/google`, e aquilo fazia o `next build` BUSCAR a folha de estilo em
 * fonts.googleapis.com em tempo de compilação. Um build que depende de terceiro não é determinístico:
 * em 22/09/2026 o Google respondeu com URLs na forma dinâmica (`/l/font?kit=…&skey=…&v=…`), os dois
 * `&` quebraram o round-trip de query do Turbopack e o build morreu com "next/font/google queries
 * have exactly one entry" — derrubando o version skew num lugar que não tinha nada a ver com a causa.
 * E ficar SEM rede também reprova: em `next build` a falha de fetch é erro, não aviso.
 *
 * O arquivo vem de `@fontsource-variable/dm-sans`, dependência congelada no lockfile — não é binário
 * baixado de URL avulsa nem cópia sem procedência. Licença OFL-1.1, no LICENSE do pacote.
 *
 * MESMA FONTE, MESMA APARÊNCIA. O eixo `wght` do arquivo variável vai de 100 a 1000, então os quatro
 * pesos usados (400, 500, 600, 700) continuam disponíveis — agora num arquivo só, em vez de quatro.
 * O subconjunto é `latin`, o mesmo que `subsets: ["latin"]` pedia. `display: "swap"` e a variável
 * `--font-dm-sans` não mudam, e por isso `globals.css` não precisou ser tocado.
 */
const dmSans = localFont({
  src: "../../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2",
  weight: "100 1000",
  style: "normal",
  variable: "--font-dm-sans",
  display: "swap"
});
import { Providers } from "@/lib/query";
export const metadata: Metadata = { title: "Agro ERP", description: "Gestão agropecuária: estoque, suprimentos, financeiro, pecuária, frota e relatórios" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={dmSans.variable}><body className="font-sans"><Providers>{children}</Providers></body></html>;
}
