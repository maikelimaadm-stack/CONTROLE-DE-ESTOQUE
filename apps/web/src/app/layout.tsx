import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-dm-sans", display: "swap" });
import { Providers } from "@/lib/query";
export const metadata: Metadata = { title: "Agro ERP", description: "Gestão agropecuária: estoque, suprimentos, financeiro, pecuária, frota e relatórios" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" className={dmSans.variable}><body className="font-sans"><Providers>{children}</Providers></body></html>;
}
