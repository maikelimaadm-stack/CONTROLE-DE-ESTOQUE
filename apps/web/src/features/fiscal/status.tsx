"use client";
import Link from "next/link";
import { Badge, Card, CardHeader, CardBody } from "@/components/ui";
const ITEMS = [
  { t: "Documentos fiscais de entrada (NF-e XML)", s: "IMPLEMENTADO", d: "Importação do XML da NF-e com itens, fornecedor e entrada no estoque/financeiro.", h: "/fiscal?tab=documentos" },
  { t: "Consulta DFe / manifestação", s: "PARCIAL", d: "Fila de DFe recebidas e aprovação de notas implementadas no sistema; a consulta automática à SEFAZ (certificado A1) não está integrada.", h: "/estoque?tab=recebimentos&sub=dfe" },
  { t: "Emissão de NF-e / NFC-e", s: "NÃO INICIADO", d: "Exige certificado digital, homologação SEFAZ e provedor de emissão. Fora do escopo desta entrega (gap documentado).", h: null },
  { t: "MDF-e / CT-e", s: "NÃO INICIADO", d: "Dependem de emissão fiscal; documentados no GAP-ANALYSIS.", h: null },
  { t: "SPED / LCDPR (livro caixa digital)", s: "PARCIAL", d: "Dados-base (livro caixa, dedutibilidade, tributos) capturados; geração do arquivo não implementada.", h: "/fiscal?tab=livro-caixa" },
  { t: "Partida dobrada (plano de contas)", s: "IMPLEMENTADO", d: "Conta contábil por rateio de título; visão de débito/crédito por conta no relatório Razão.", h: "/fiscal?tab=partida-dobrada" }
];
export function FiscalStatusPanel() {
  return <Card><CardHeader title="Fiscal" subtitle="Status de cada capacidade fiscal nesta reimplementação (honesto: o que existe, o que é parcial e o que ficou fora de escopo)." /><CardBody><ul className="divide-y">{ITEMS.map((i) => <li key={i.t} className="flex items-start gap-3 py-2 text-sm"><Badge tone={i.s === "IMPLEMENTADO" ? "green" : i.s === "PARCIAL" ? "amber" : "slate"}>{i.s}</Badge><div><div className="font-medium">{i.h ? <Link className="hover:underline" href={i.h}>{i.t}</Link> : i.t}</div><div className="text-xs text-slate-500">{i.d}</div></div></li>)}</ul></CardBody></Card>;
}
