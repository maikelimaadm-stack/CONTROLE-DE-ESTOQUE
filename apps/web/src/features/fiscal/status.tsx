"use client";
import Link from "next/link";
import { Badge, Card, CardHeader, CardBody } from "@/components/ui";
/**
 * Capacidades fiscais e sua situação nesta versão do produto (Configurações › Fiscal).
 * Linguagem de produto: "Disponível" / "Parcial" / "Indisponível" — o detalhamento técnico de cada lacuna fica em docs/.
 */
type Availability = "available" | "partial" | "unavailable";
const AVAILABILITY: Record<Availability, { label: string; tone: "green" | "amber" | "slate" }> = { available: { label: "Disponível", tone: "green" }, partial: { label: "Parcial", tone: "amber" }, unavailable: { label: "Indisponível", tone: "slate" } };
const ITEMS: { t: string; s: Availability; d: string; h: string | null }[] = [
  { t: "Documentos fiscais de entrada (NF-e XML)", s: "available", d: "Importação do XML da NF-e com itens, fornecedor e entrada no estoque/financeiro.", h: "/fiscal?tab=documentos" },
  { t: "Consulta DFe / manifestação", s: "partial", d: "Fila de DFe recebidas e aprovação de notas disponíveis; a consulta automática à SEFAZ (certificado A1) ainda não está integrada.", h: "/estoque?tab=recebimentos&sub=dfe" },
  { t: "Emissão de NF-e / NFC-e", s: "unavailable", d: "Depende de certificado digital, homologação na SEFAZ e provedor de emissão.", h: null },
  { t: "MDF-e / CT-e", s: "unavailable", d: "Dependem da emissão fiscal.", h: null },
  { t: "SPED / LCDPR (livro caixa digital)", s: "partial", d: "Dados-base (livro caixa, dedutibilidade, tributos) registrados; a geração do arquivo ainda não está disponível.", h: "/fiscal?tab=livro-caixa" },
  { t: "Partida dobrada (plano de contas)", s: "available", d: "Conta contábil por rateio de título; visão de débito/crédito por conta no relatório Razão.", h: "/fiscal?tab=partida-dobrada" }
];
export function FiscalStatusPanel() {
  return <Card><CardHeader title="Fiscal" subtitle="Situação de cada capacidade fiscal nesta versão." /><CardBody><ul className="divide-y">{ITEMS.map((i) => { const a = AVAILABILITY[i.s]; return <li key={i.t} className="flex items-start gap-3 py-2 text-sm"><Badge tone={a.tone}>{a.label}</Badge><div><div className="font-medium">{i.h ? <Link className="hover:underline" href={i.h}>{i.t}</Link> : i.t}</div><div className="text-xs text-slate-500">{i.d}</div></div></li>; })}</ul></CardBody></Card>;
}
