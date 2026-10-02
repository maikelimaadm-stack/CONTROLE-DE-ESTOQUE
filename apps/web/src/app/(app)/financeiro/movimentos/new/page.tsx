"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/utils";
import { Button, Card, CardHeader, CardBody, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ApportionmentEditor, toAppLines, useCreate, useEmpresaPadrao, type AppLine } from "@/features/docs/shared";
import { useFinanceiroPelaTop, useLcdpr } from "@/features/financial/central/capacidade";
import { SeletorDeTopFinanceira, linhasComATrava, primeiraLinhaComOsPadroes, textoDoRateioTravado, travaDaTop, type TopFinanceira } from "@/features/financial/central/top-financeira";
import { CampoImovelRural } from "@/features/financial/central/imovel-rural";

/**
 * NOVO MOVIMENTO BANCÁRIO. OPERACOES-01 F9 (decisão 286), tudo ADITIVO e só com as capacidades da API:
 *   · `financeiroPelaTop` — a TOP da família do movimento PRIMEIRO, preenchendo a conta e a natureza e o centro da 1ª
 *     linha do rateio (com a troca desligada, eles travam); o corpo leva `tipo_operacao_id`;
 *   · `capacidades.lcdpr` — na entrada e na saída de uma empresa, o imóvel rural do livro caixa (o padrão da empresa já
 *     escolhido); o corpo leva `imovel_rural_id` (o id, ou `null` = "Sem imóvel"). Transferência fica fora do LCDPR.
 * Sem as capacidades (a API anterior): a tela e o corpo de HOJE, idênticos, e nenhum pedido às rotas novas.
 */
export default function Page() {
  const router = useRouter(); const empresa = useEmpresaPadrao();
  const pelaTop = useFinanceiroPelaTop(); const lcdpr = useLcdpr();
  const [h, setH] = React.useState({ empresa_id: "", bank_account_id: "", movement_date: todayISO(), type: "out", category_type: "out", destination_account_id: "", amount: "", interest: "0", document: "", generates_obligation: false, is_deductible: false, note: "", proprietary_id: "", person_id: "", harvest_id: "" });
  const [lines, setLines] = React.useState<AppLine[]>([{ financial_category_id: "", cost_center_id: "", percentage: "100" }]);
  const [top, setTop] = React.useState<TopFinanceira | null>(null);
  /** `undefined` = ainda não decidido (a chave não vai; o servidor aplica o padrão da empresa). */
  const [imovel, setImovel] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresa })); }, [empresa]);
  const create = useCreate("/api/financial/bank-movements", () => router.push("/financeiro?tab=caixa&sub=extrato"));
  const transfer = h.category_type === "internal_transfer";
  const trava = React.useMemo(() => travaDaTop(pelaTop ? top : null), [pelaTop, top]);
  const mudarLinhas = React.useCallback((ls: AppLine[]) => setLines(linhasComATrava(ls, trava)), [trava]);
  const escolherTop = (t: TopFinanceira | null) => {
    setTop(t);
    if (!t) return;
    setH((o) => ({ ...o, bank_account_id: t.padroes.conta?.id ?? o.bank_account_id }));
    setLines((ls) => linhasComATrava(primeiraLinhaComOsPadroes(ls, t), travaDaTop(t)));
  };
  /** O imóvel só na entrada e na saída de uma EMPRESA (o CHECK da 0045 o recusa sem empresa e fora do livro). */
  const comImovel = lcdpr && Boolean(h.empresa_id) && (h.category_type === "in" || h.category_type === "out");
  const daF9 = () => ({ ...(pelaTop && top ? { tipo_operacao_id: top.id } : {}), ...(comImovel && imovel !== undefined ? { imovel_rural_id: imovel } : {}) });
  const submit = () => create.mutate({ ...h, empresa_id: h.empresa_id || null, destination_account_id: transfer ? h.destination_account_id : null, document: h.document || null, note: h.note || null, proprietary_id: h.proprietary_id || null, person_id: h.person_id || null, harvest_id: h.harvest_id || null, apportionment: transfer ? undefined : toAppLines(lines), ...daF9() });
  return <Card><CardHeader title="Novo movimento bancário" subtitle="Transferência interna gera saída na origem e entrada no destino em uma única transação." actions={<><Button variant="outline" size="sm" onClick={() => router.back()}>Voltar</Button><Button size="sm" loading={create.isPending} disabled={!h.bank_account_id || Number(h.amount) <= 0 || (transfer && !h.destination_account_id)} onClick={submit}>Salvar</Button></>} /><CardBody className="space-y-4">
    {pelaTop && <div className="grid grid-cols-12 gap-3" data-testid="fin-movimento-operacao">
      <SeletorDeTopFinanceira direcao="movimento" valor={top?.id ?? null} onChange={escolherTop} testId="fin-movimento-top" />
    </div>}
    <div className="grid grid-cols-12 gap-3">
      <Field label="Empresa" span={3}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => { setH({ ...h, empresa_id: v ?? "" }); setImovel(undefined); }} /></Field>
      <Field label="Conta bancária" required span={4} help={trava.conta ? "Padrão da operação: não muda neste movimento" : undefined}><RefSelect resource="bank_accounts" value={h.bank_account_id} disabled={Boolean(trava.conta)} onChange={(v) => setH({ ...h, bank_account_id: v ?? "" })} /></Field>
      <Field label="Data" required span={2}><Input type="date" value={h.movement_date} onChange={(e) => setH({ ...h, movement_date: e.target.value })} /></Field>
      <Field label="Categoria do movimento" span={3}><NativeSelect value={h.category_type} onChange={(e) => { const ct = e.target.value; setH({ ...h, category_type: ct, type: ct === "in" || ct === "check_return" || ct === "financing" ? "in" : "out" }); }}><option value="in">Entrada</option><option value="out">Saída</option><option value="internal_transfer">Transferência interna</option><option value="financing">Financiamento</option><option value="check_return">Devolução de cheque</option></NativeSelect></Field>
      {transfer && <Field label="Conta destino" required span={4}><RefSelect resource="bank_accounts" value={h.destination_account_id} onChange={(v) => setH({ ...h, destination_account_id: v ?? "" })} /></Field>}
      {comImovel && <CampoImovelRural empresaId={h.empresa_id} valor={imovel} onChange={setImovel} testId="fin-movimento-imovel" span={4} />}
      <Field label="Valor" required span={2}><Input type="number" step="0.01" min="0.01" value={h.amount} onChange={(e) => setH({ ...h, amount: e.target.value })} /></Field>
      <Field label="Juros" span={2}><Input type="number" step="0.01" value={h.interest} onChange={(e) => setH({ ...h, interest: e.target.value })} /></Field>
      <Field label="Documento" span={2}><Input value={h.document} onChange={(e) => setH({ ...h, document: e.target.value })} /></Field>
      <Field label="Pessoa" span={3}><RefSelect resource="people" value={h.person_id} onChange={(v) => setH({ ...h, person_id: v ?? "" })} /></Field>
      <Field label="Proprietário" span={3}><RefSelect resource="people" value={h.proprietary_id} onChange={(v) => setH({ ...h, proprietary_id: v ?? "" })} filter={{ is_proprietary: "true" }} /></Field>
      <Field label="Safra" span={2}><RefSelect resource="harvests" value={h.harvest_id} onChange={(v) => setH({ ...h, harvest_id: v ?? "" })} /></Field>
      <Field label="Gera obrigação" span={2}><NativeSelect value={h.generates_obligation ? "1" : "0"} onChange={(e) => setH({ ...h, generates_obligation: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Dedutível" span={2}><NativeSelect value={h.is_deductible ? "1" : "0"} onChange={(e) => setH({ ...h, is_deductible: e.target.value === "1" })}><option value="0">Não</option><option value="1">Sim</option></NativeSelect></Field>
      <Field label="Observação" span={12}><Textarea value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} /></Field>
    </div>
    {!transfer && <><h3 className="text-xs font-semibold uppercase text-brand-700">Rateio</h3>{textoDoRateioTravado(trava) && <p className="text-[12px] text-amber-800" data-testid="fin-rateio-travado">{textoDoRateioTravado(trava)}</p>}<ApportionmentEditor lines={lines} onChange={mudarLinhas} total={Number(h.amount || 0)} /></>}
  </CardBody></Card>;
}
