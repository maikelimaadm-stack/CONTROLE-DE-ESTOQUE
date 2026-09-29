"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, todayISO } from "@/lib/utils";
import { Button, Card, CardBody, CardHeader, Field, Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { ItemsEditor, PlanEditor, defaultPlan, totalDaLinhaExibido, useEmpresaPadrao, type ItemRow, type Plan } from "@/features/docs/shared";
import { CampoTipoOperacao, podeLancar } from "@/features/sales/tipo-operacao-select";
import { useTopsDaEspecie, type VarianteDeCompra } from "./variantes";

/**
 * A CENTRAL DE COMPRAS — o lançamento de um Pedido de compra ou de uma Compra (COMPRAS-01, decisão 267).
 *
 * ┌─ O QUE FOI COPIADO E O QUE FOI REUSADO ────────────────────────────────────────────────────────┐
 * │ A Central de Vendas (`app/(app)/vendas/[kind]/new`) é presa à venda em cada campo (cliente,      │
 * │ `/api/sales`, layout do documento, cliente em atraso, reserva). Parametrizá-la mudaria vendas;   │
 * │ por isso esta Central é PRÓPRIA, no formato simples dos documentos de estoque, e reusa só as     │
 * │ peças genéricas que não mudam: o editor de itens e o de parcelas (`features/docs/shared`), o    │
 * │ campo e a descoberta de TOP (`features/sales/tipo-operacao-select`, que não conhece a porta).    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A TOP da URL é PEDIDO: vale só se estiver na lista que o servidor devolve para AQUELA espécie. Totais,
 * código e número são do servidor; o total aqui é apresentação. O contrato do POST é estrito (chave
 * desconhecida → 422): o corpo leva só as chaves do contrato, e campo vazio não viaja.
 */
type Cabecalho = {
  empresa_id: string; fornecedor_id: string; transportadora_id: string; data_documento: string; data_entrada: string;
  data_vencimento: string; numero_nota: string; serie_nota: string; categoria_financeira_id: string; centro_custo_id: string;
  condicao_pagamento_id: string; forma_pagamento_id: string; frete: string; outras_despesas: string; desconto: string; observacao: string;
};

const vazio = (v: string) => v.trim() === "";
const opcional = (v: string) => (vazio(v) ? undefined : v.trim());

/** Os erros de campo que o servidor devolveu (`details: [{ path, message }]`), por caminho. */
function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as unknown[]) {
    if (typeof d === "object" && d !== null && typeof (d as { path?: unknown }).path === "string" && typeof (d as { message?: unknown }).message === "string") {
      out[(d as { path: string }).path] = (d as { message: string }).message;
    }
  }
  return out;
}

export function CentralDeCompras({ variante }: { variante: VarianteDeCompra }) {
  const router = useRouter(); const sp = useSearchParams(); const tr = useTradutor(); const qc = useQueryClient();
  const { can } = useAuth();
  const ehCompra = variante.variante === "compra";
  const empresaPadrao = useEmpresaPadrao();
  const estado = useTopsDaEspecie(variante.segmento, can(`${variante.perm}.create`));
  const pedidaNaUrl = sp.get("tipo_operacao_id") ?? "";
  const [top, setTop] = React.useState("");
  // A TOP da URL só é aceita se o servidor a listou para esta espécie; sem ela, o padrão do cadastro (se houver).
  React.useEffect(() => {
    if (!podeLancar(estado) || top) return;
    const naLista = estado.dados.items.some((i) => i.id === pedidaNaUrl);
    const escolha = naLista ? pedidaNaUrl : estado.dados.defaultId;
    if (escolha) setTop(escolha);
  }, [estado, top, pedidaNaUrl]);
  const topRecusada = podeLancar(estado) && !!pedidaNaUrl && !estado.dados.items.some((i) => i.id === pedidaNaUrl);

  const [h, setH] = React.useState<Cabecalho>({
    empresa_id: "", fornecedor_id: "", transportadora_id: "", data_documento: todayISO(), data_entrada: "", data_vencimento: "",
    numero_nota: "", serie_nota: "", categoria_financeira_id: "", centro_custo_id: "", condicao_pagamento_id: "", forma_pagamento_id: "",
    frete: "0", outras_despesas: "0", desconto: "0", observacao: ""
  });
  React.useEffect(() => { setH((o) => ({ ...o, empresa_id: o.empresa_id || empresaPadrao })); }, [empresaPadrao]);
  const mudar = (p: Partial<Cabecalho>) => setH((o) => ({ ...o, ...p }));
  const [itens, setItens] = React.useState<ItemRow[]>([]);
  const [ajustarParcelas, setAjustarParcelas] = React.useState(false);
  const [plano, setPlano] = React.useState<Plan>(defaultPlan());
  const [erros, setErros] = React.useState<Record<string, string>>({});

  const totalItens = itens.reduce((a, it) => a + totalDaLinhaExibido(it), 0);
  const totalExibido = totalItens + Number(h.frete || 0) + Number(h.outras_despesas || 0) - Number(h.desconto || 0);

  const corpo = () => ({
    empresa_id: h.empresa_id,
    tipo_operacao_id: top,
    fornecedor_id: h.fornecedor_id,
    transportadora_id: opcional(h.transportadora_id),
    data_documento: h.data_documento,
    data_vencimento: opcional(h.data_vencimento),
    ...(ehCompra ? { data_entrada: opcional(h.data_entrada), numero_nota: opcional(h.numero_nota), serie_nota: opcional(h.serie_nota) } : {}),
    categoria_financeira_id: opcional(h.categoria_financeira_id),
    centro_custo_id: opcional(h.centro_custo_id),
    condicao_pagamento_id: opcional(h.condicao_pagamento_id),
    ...(ajustarParcelas ? { plano_parcelas: plano, parcelas_ajustadas: !vazio(h.condicao_pagamento_id) } : {}),
    forma_pagamento_id: opcional(h.forma_pagamento_id),
    frete: opcional(h.frete),
    outras_despesas: opcional(h.outras_despesas),
    desconto: opcional(h.desconto),
    observacao: opcional(h.observacao),
    itens: itens.map((i) => ({
      produto_id: i.product_id,
      armazem_id: opcional(i.warehouse_id ?? ""),
      quantidade: i.quantity,
      valor_unitario: i.unit_value || "0",
      desconto: opcional(i.discount ?? ""),
      desconto_percentual: opcional(i.discount_percent ?? ""),
      ...(ehCompra ? { lote: opcional(i.provider_lot ?? ""), validade: opcional(i.expiration_date ?? "") } : {})
    }))
  });

  // Uma chave de idempotência por TENTATIVA de lançamento; renovada só depois de uma recusa.
  const chave = React.useRef(newIdem());
  const salvar = useMutation({
    mutationFn: () => api<{ id: string }>(`/api/compras/${variante.segmento}`, { method: "POST", body: corpo(), idempotencyKey: chave.current }),
    onSuccess: (r) => { toast.success("Salvo com sucesso"); void qc.invalidateQueries(); router.push(`/compras/${variante.segmento}/${r.id}`); },
    onError: (e) => { chave.current = newIdem(); setErros(errosDoServidor(e)); toast.error((e as Error).message); }
  });

  const erro = (c: string) => erros[c];
  const errosDeItens = Object.entries(erros).filter(([c]) => c.startsWith("itens"));
  const pronto = podeLancar(estado) && !!top && !topRecusada;
  const titulo = `Novo documento · ${tr(variante.chaveI18n)}`;

  return <Card data-testid="compras-central" data-especie={variante.variante}>
    <CardHeader title={titulo} actions={<>
      <Button variant="outline" size="sm" onClick={() => router.push("/compras?tab=documentos")}>Voltar</Button>
      <Button size="sm" data-testid="compras-salvar" loading={salvar.isPending} disabled={!pronto || !itens.length || salvar.isPending} onClick={() => { setErros({}); salvar.mutate(); }}>Salvar</Button>
    </>} />
    <CardBody className="space-y-4">
      {topRecusada && <p data-testid="compras-top-recusada" className="text-sm text-amber-700">O Tipo de Operação pedido não está disponível para {tr(variante.chaveI18n)}. Escolha outro.</p>}
      <div className="grid grid-cols-12 gap-3">
        <CampoTipoOperacao estado={estado} valor={top} onChange={setTop} span={4} />
        <Field label="Empresa" required span={4} error={erro("empresa_id")}><RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "" })} /></Field>
        <Field label="Fornecedor" required span={4} error={erro("fornecedor_id")}><RefSelect resource="people" value={h.fornecedor_id} onChange={(v) => mudar({ fornecedor_id: v ?? "" })} filter={{ is_provider: "true" }} /></Field>
        <Field label="Data do documento" required span={2} error={erro("data_documento")}><Input data-testid="compras-data-documento" type="date" value={h.data_documento} onChange={(e) => mudar({ data_documento: e.target.value })} /></Field>
        {ehCompra && <Field label="Data de entrada" span={2} error={erro("data_entrada")}><Input data-testid="compras-data-entrada" type="date" value={h.data_entrada} onChange={(e) => mudar({ data_entrada: e.target.value })} /></Field>}
        <Field label="Vencimento" span={2} error={erro("data_vencimento")}><Input data-testid="compras-data-vencimento" type="date" value={h.data_vencimento} onChange={(e) => mudar({ data_vencimento: e.target.value })} /></Field>
        {ehCompra && <Field label="Número da nota" span={2} error={erro("numero_nota")}><Input data-testid="compras-numero-nota" value={h.numero_nota} onChange={(e) => mudar({ numero_nota: e.target.value })} /></Field>}
        {ehCompra && <Field label="Série" span={1} error={erro("serie_nota")}><Input data-testid="compras-serie-nota" value={h.serie_nota} onChange={(e) => mudar({ serie_nota: e.target.value })} /></Field>}
        <Field label="Transportadora" span={3} error={erro("transportadora_id")}><RefSelect resource="people" value={h.transportadora_id} onChange={(v) => mudar({ transportadora_id: v ?? "" })} filter={{ is_transporter: "true" }} /></Field>
        <Field label="Natureza de despesa" span={3} error={erro("categoria_financeira_id")}><RefSelect resource="financial_categories" value={h.categoria_financeira_id} onChange={(v) => mudar({ categoria_financeira_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
        <Field label="Centro de resultado" span={3} error={erro("centro_custo_id")}><RefSelect resource="cost_centers" value={h.centro_custo_id} onChange={(v) => mudar({ centro_custo_id: v ?? "" })} filter={{ kind: "analytic" }} /></Field>
        <Field label="Condição de pagamento" span={3} error={erro("condicao_pagamento_id")}><RefSelect resource="condicoes_pagamento" value={h.condicao_pagamento_id} onChange={(v) => mudar({ condicao_pagamento_id: v ?? "" })} /></Field>
        <Field label="Forma de pagamento" span={3} error={erro("forma_pagamento_id")}><RefSelect resource="payment_methods" value={h.forma_pagamento_id} onChange={(v) => mudar({ forma_pagamento_id: v ?? "" })} /></Field>
        <Field label="Frete" span={2} error={erro("frete")}><Input data-testid="compras-frete" type="number" step="0.01" min="0" value={h.frete} onChange={(e) => mudar({ frete: e.target.value })} /></Field>
        <Field label="Outras despesas" span={2} error={erro("outras_despesas")}><Input data-testid="compras-outras-despesas" type="number" step="0.01" min="0" value={h.outras_despesas} onChange={(e) => mudar({ outras_despesas: e.target.value })} /></Field>
        <Field label="Desconto" span={2} error={erro("desconto")}><Input data-testid="compras-desconto" type="number" step="0.01" min="0" value={h.desconto} onChange={(e) => mudar({ desconto: e.target.value })} /></Field>
        <Field label="Parcelas" span={3} error={erro("plano_parcelas")}>
          <NativeSelect data-testid="compras-parcelas" value={ajustarParcelas ? "ajustar" : "padrao"} onChange={(e) => setAjustarParcelas(e.target.value === "ajustar")}>
            <option value="padrao">Pela condição (ou à vista)</option>
            <option value="ajustar">Ajustar parcelas</option>
          </NativeSelect>
        </Field>
        <Field label="Observação" span={12} error={erro("observacao")}><Textarea data-testid="compras-observacao" value={h.observacao} onChange={(e) => mudar({ observacao: e.target.value })} /></Field>
      </div>
      {ajustarParcelas && <div data-testid="compras-plano"><PlanEditor plan={plano} onChange={setPlano} /></div>}
      <div data-testid="compras-itens">
        <ItemsEditor items={itens} onChange={setItens}
          fields={ehCompra ? ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent", "lot", "expiration"] : ["warehouse", "product", "quantity", "unit_value", "discount", "discount_percent"]} />
        {errosDeItens.length > 0 && <ul data-testid="compras-erros-itens" className="mt-2 space-y-0.5 text-[12px] text-red-700">
          {errosDeItens.map(([c, m]) => <li key={c}>{descreverCaminhoDeItem(c)}: {m}</li>)}
        </ul>}
      </div>
      <div className="text-right text-sm font-semibold" data-testid="compras-total">Total do documento: {brl(totalExibido)}</div>
    </CardBody>
  </Card>;
}

const ROTULO_DO_CAMPO_DO_ITEM: Record<string, string> = {
  produto_id: "produto", armazem_id: "armazém", quantidade: "quantidade", valor_unitario: "valor unitário",
  desconto: "desconto", desconto_percentual: "desconto %", lote: "lote", validade: "validade"
};

/** `itens.0.lote` / `itens[0].lote` → "Item 1 · lote". */
function descreverCaminhoDeItem(caminho: string): string {
  const m = /^itens(?:\.|\[)(\d+)\]?(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1]) + 1;
  return m[2] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[2]] ?? m[2]}` : `Item ${n}`;
}
