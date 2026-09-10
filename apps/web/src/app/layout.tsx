import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/query";
export const metadata: Metadata = { title: "Agro ERP", description: "Gestão agropecuária: estoque, suprimentos, financeiro, pecuária, frota e relatórios" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><Providers>{children}</Providers></body></html>;
}
