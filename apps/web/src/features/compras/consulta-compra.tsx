"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { brl, dateBR, dateTimeBR, num } from "@/lib/utils";
import { COPY, enumLabel } from "@/lib/copy";
import { Button, Card, CardBody, CardHeader, Dialog, LoadingState, StatusBadge } from "@/components/ui";
import { DetailShell, KV, LoadingOr, SimpleTable, useDoc, type Row } from "@/features/docs/shared";
import { DialogoEncerrarSaldo } from "@/features/sales/faturar-em-partes";
import { usePreviaDaConfirmacaoCompra, type PreviaDaConfirmacaoCompra } from "./previa-confirmacao-compra";
import { varianteDeCompra, type VarianteDeCompra } from "./variantes";
import { rotaDoDocumento } from "./documentos-compra-list";
import {
  TEXTO_SEM_PROXIMA_OPERACAO, comprasGeradasDoPedido, pedidoTemSaldo, rotaDeReceber, useProximosPassosDoPedido, type EstadoProximosPassosDoPedido
} from "./proximos-passos-pedido";
import { temRecebimentoDeclarado } from "./recebimento-linhas";

/**
 * A CONSULTA DO DOCUMENTO DE COMPRA — só leitura, com Confirmar (compra, depois da prévia) e Cancelar (COMPRAS-01).
 *
 * A Consulta de Vendas (`vendas/[kind]/[id]`) é presa à venda (conversão, faturar em partes, reserva, layout de
 * impressão); esta é PRÓPRIA, no formato `DetailShell` dos documentos de estoque. Os botões aparecem por
 * capacidade (`can()` só esconde): Confirmar pede `compras.edit`, Cancelar pede `<recurso>.delete`. Quem recusa é
 * o servidor — inclusive quando o botão estava à vista.
 *
 * ┌─ COMPRAS-02 (decisão 268): O PEDIDO GERA COMPRAS ──────────────────────────────────────────────────────┐
 * │ No PEDIDO aberto aparecem os Próximos passos — o leque que a TOP dele declara, no desenho de Vendas —  │
 * │ e cada passo abre a Central de Compras em modo RECEBER PEDIDO. Os itens ganham Recebido e Saldo, a     │
 * │ lista das compras geradas aparece, e "Encerrar saldo" vale quando já há compra e ainda há saldo. Na     │
 * │ COMPRA gerada, a origem (o pedido) aparece com link. Tudo isso só quando o SERVIDOR declara os campos: │
 * │ com a API anterior (skew), a consulta continua a de antes e os Próximos passos dizem que estão         │
 * │ indisponíveis nesta versão do servidor — nunca um leque vazio, que afirmaria o que ninguém disse.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
const rotuloClass = (i: { codigo: string; nome: string }) => [i.codigo, i.nome].filter(Boolean).join(" — ");
const codigoNome = (codigo: unknown, nome: unknown) => (nome ? [codigo, nome].filter(Boolean).join(" — ") : "—");
const t = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function ConsultaDeCompra({ variante, id }: { variante: VarianteDeCompra; id: string }) {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient(); const router = useRouter();
  const porta = `/api/compras/${variante.segmento}/${id}`;
  const q = useDoc<Row & { itens?: Row[]; titulos?: Row[]; movimentos?: Row[] }>(porta);
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState(false);
  const chaveConfirmar = React.useRef(newIdem());
  const chaveCancelar = React.useRef(newIdem());
  const chaveEncerrar = React.useRef(newIdem());
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["docone", porta] });
    void qc.invalidateQueries({ queryKey: ["compras-previa-confirmacao", id] });
    void qc.invalidateQueries({ queryKey: ["compras-proximos-passos", variante.segmento, id] });
  };

  const confirmar = useMutation({
    mutationFn: () => api(`/api/compras/compras/${id}/confirm`, { method: "POST", idempotencyKey: chaveConfirmar.current }),
    onSuccess: () => { toast.success("Compra confirmada"); setConfirmando(false); recarregar(); },
    onError: (e) => { chaveConfirmar.current = newIdem(); toast.error((e as Error).message); recarregar(); }
  });
  const cancelar = useMutation({
    mutationFn: () => api(`/api/compras/${variante.segmento}/${id}/cancel`, { method: "POST", idempotencyKey: chaveCancelar.current }),
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); recarregar(); },
    onError: (e) => { chaveCancelar.current = newIdem(); toast.error((e as Error).message); }
  });
  /** ENCERRAR SALDO (COMPRAS-02): com chave de idempotência, como as outras ações de estado. O motivo vai no corpo. */
  const encerrar = useMutation({
    mutationFn: (motivo: string) => api(`/api/compras/${variante.segmento}/${id}/encerrar-saldo`, { method: "POST", body: { motivo }, idempotencyKey: chaveEncerrar.current }),
    onSuccess: () => { toast.success("Saldo encerrado"); setEncerrando(false); recarregar(); },
    onError: (e) => { chaveEncerrar.current = newIdem(); toast.error((e as Error).message); }
  });

  const d = q.data;
  const situacao = d ? String(d["situacao"] ?? "") : "";
  const ehCompra = variante.variante === "compra";
  const ehPedido = variante.variante === "pedido";
  const itensDoDocumento = d?.itens ?? [];
  /** As compras geradas: `null` quando o servidor não as declarou (API anterior) — aí nada é inferido delas. */
  const comprasGeradas = ehPedido ? comprasGeradasDoPedido(d) : null;
  const comCompraViva = (comprasGeradas ?? []).some((c) => c.situacao !== "cancelado");
  /** Recebido e Saldo por item: só quando o servidor os declara (API da COMPRAS-02). */
  const recebimentoDeclarado = ehPedido && temRecebimentoDeclarado(itensDoDocumento);
  /**
   * RECEBER exige AS DUAS capacidades, como a API exige: editar o PEDIDO e criar a COMPRA. `can()` aqui é
   * apresentação — evita oferecer um passo que responderia 403; quem nega é o `/convert`.
   */
  const varianteDaCompra = varianteDeCompra("compra");
  const podeReceber = ehPedido && situacao === "aberto" && can(`${variante.perm}.edit`) && Boolean(varianteDaCompra) && can(`${varianteDaCompra?.perm ?? ""}.create`);
  const passos = useProximosPassosDoPedido(variante.segmento, id, podeReceber);
  /** Encerrar saldo vale com o pedido aberto, pelo menos uma compra não cancelada e saldo em algum item. */
  const podeEncerrarSaldo = ehPedido && situacao === "aberto" && recebimentoDeclarado && comCompraViva && pedidoTemSaldo(itensDoDocumento) && can(`${variante.perm}.edit`);
  const podeConfirmar = ehCompra && situacao === "aberto" && can("compras.edit");
  // Pedido com compra não cancelada não se cancela (a API responde 409 dizendo o que fazer): o botão não é oferecido.
  const podeCancelar = (situacao === "aberto" || situacao === "confirmado") && can(`${variante.perm}.delete`) && !(ehPedido && comCompraViva);
  const origemId = ehCompra && d && typeof d["origem_documento_id"] === "string" ? d["origem_documento_id"] : "";
  const rotuloDoPedido = enumLabel("especie_documento_compra", "pedido");
  const saldoEncerradoEm = ehPedido && d && typeof d["saldo_encerrado_em"] === "string" ? d["saldo_encerrado_em"] : "";
  const top = d?.["tipo_operacao"] as { codigo?: string; nome?: string; versao?: number } | null | undefined;
  const titulo = d ? `${tr(variante.chaveI18n)} ${t(d["codigo"])}` : tr(variante.chaveI18n);

  return <LoadingOr q={q}>{d && <DetailShell testId="compras-consulta" title={titulo} backHref="/compras?tab=documentos"
    status={<StatusBadge domain="situacao_documento_compra" value={situacao} />}
    actions={<>
      {podeConfirmar && <Button size="sm" data-testid="compras-confirmar" onClick={() => setConfirmando(true)}>Confirmar</Button>}
      {podeEncerrarSaldo && <Button size="sm" variant="outline" data-testid="compras-encerrar-saldo" onClick={() => setEncerrando(true)}>Encerrar saldo</Button>}
      {podeCancelar && <Button size="sm" variant="outline" data-testid="compras-cancelar" onClick={() => setCancelando(true)}>Cancelar documento</Button>}
    </>}>
    <div className="space-y-4" data-testid="compras-consulta-corpo" data-situacao={situacao} data-especie={variante.variante}>
      <Card><CardBody>
        {/* A ORIGEM da compra gerada: o pedido, com link para ele (o código é o do servidor). */}
        {origemId && <p data-testid="compras-origem" className="mb-2 text-[12.5px] text-slate-700">
          Origem: <Link className="text-brand-700 underline" href={rotaDoDocumento({ id: origemId, especie: "pedido" })}>{rotuloDoPedido}{d["origem_codigo"] ? ` ${String(d["origem_codigo"])}` : ""}</Link>
        </p>}
        <KV items={[
          ["Código", <span key="c" data-testid="compras-consulta-codigo">{t(d["codigo"])}</span>],
          ["Tipo de documento", enumLabel("especie_documento_compra", d["especie"])],
          ["Tipo de Operação", top ? `${t(top.codigo)} — ${t(top.nome)}${top.versao ? ` (versão ${top.versao})` : ""}` : "—"],
          ["Empresa", t(d["empresa_nome"])],
          ["Fornecedor", t(d["fornecedor_nome"])],
          ["Transportadora", t(d["transportadora_nome"])],
          ["Data do documento", dateBR(d["data_documento"] as string)],
          ...(ehCompra ? [["Data de entrada", d["data_entrada"] ? dateBR(d["data_entrada"] as string) : "—"] as [string, React.ReactNode]] : []),
          ["Vencimento", d["data_vencimento"] ? dateBR(d["data_vencimento"] as string) : "—"],
          ...(ehCompra ? [["Nota / série", d["numero_nota"] ? `${t(d["numero_nota"])} / ${t(d["serie_nota"] || "1")}` : "—"] as [string, React.ReactNode]] : []),
          ["Natureza de despesa", codigoNome(d["categoria_financeira_codigo"], d["categoria_financeira_nome"])],
          ["Centro de resultado", codigoNome(d["centro_custo_codigo"], d["centro_custo_nome"])],
          ["Condição de pagamento", codigoNome(d["condicao_pagamento_codigo"], d["condicao_pagamento_nome"])],
          ["Forma de pagamento", t(d["forma_pagamento_nome"])],
          ["Itens", brl(d["valor_itens"] as string)],
          ["Frete", brl(d["frete"] as string)],
          ["Outras despesas", brl(d["outras_despesas"] as string)],
          ["Desconto", brl(d["desconto"] as string)],
          ["Total", <span key="t" data-testid="compras-consulta-total">{brl(d["valor_total"] as string)}</span>],
          ["Observação", t(d["observacao"])]
        ]} />
      </CardBody></Card>
      {podeReceber && <CartaoProximosPassos estado={passos} aoEscolher={(rota) => router.push(rota)} pedidoId={id} />}
      <Card data-testid="compras-consulta-itens"><CardHeader title="Itens" /><CardBody>
        {saldoEncerradoEm && <p data-testid="compras-saldo-encerrado" className="mb-2 text-[12.5px] text-slate-700">
          Saldo encerrado em {dateTimeBR(saldoEncerradoEm)} por {t(d["saldo_encerrado_por_nome"])}: {t(d["saldo_encerrado_motivo"])}
        </p>}
        <SimpleTable rows={d.itens ?? []} cols={[
          { key: "produto_nome", label: "Produto", render: (r) => [r["produto_codigo"], r["produto_nome"]].filter(Boolean).join(" — ") || "—" },
          { key: "armazem_nome", label: "Armazém", render: (r) => t(r["armazem_nome"]) },
          ...(ehCompra ? [{ key: "lote", label: "Lote", render: (r: Row) => t(r["lote"]) }, { key: "validade", label: "Validade", render: (r: Row) => (r["validade"] ? dateBR(r["validade"] as string) : "—") }] : []),
          { key: "quantidade", label: "Quantidade", align: "right", render: (r) => `${num(r["quantidade"] as string, 4)}${r["unidade"] ? ` ${String(r["unidade"])}` : ""}` },
          // COMPRAS-02: o recebido (compras não canceladas) e o saldo de cada item — só quando o servidor os declara.
          ...(recebimentoDeclarado ? [
            { key: "recebido", label: "Recebido", align: "right" as const, render: (r: Row) => <span data-testid="compras-item-recebido">{num(r["recebido"] as string, 4)}</span> },
            { key: "saldo", label: "Saldo", align: "right" as const, render: (r: Row) => <span data-testid="compras-item-saldo">{num(r["saldo"] as string, 4)}</span> }
          ] : []),
          { key: "valor_unitario", label: "Valor unitário", align: "right", render: (r) => brl(r["valor_unitario"] as string) },
          { key: "desconto", label: "Desconto", align: "right", render: (r) => brl(r["desconto"] as string) },
          { key: "valor_total", label: "Total", align: "right", render: (r) => brl(r["valor_total"] as string) }
        ]} />
      </CardBody></Card>
      {comprasGeradas && <Card data-testid="compras-geradas"><CardHeader title="Compras geradas" /><CardBody>
        {comprasGeradas.length ? <SimpleTable rows={comprasGeradas as unknown as Row[]} cols={[
          { key: "codigo", label: "Código", render: (r) => <Link className="text-brand-700 underline" data-testid="compras-gerada" href={rotaDoDocumento({ id: r["id"], especie: "compra" })}>{t(r["codigo"])}</Link> },
          { key: "situacao", label: COPY.situacao, render: (r) => <StatusBadge domain="situacao_documento_compra" value={r["situacao"]} /> }
        ]} /> : <p className="text-[12.5px] text-slate-500">Nenhuma compra gerada deste pedido.</p>}
      </CardBody></Card>}
      {ehCompra && <Card data-testid="compras-consulta-movimentos"><CardHeader title="Entradas no estoque" /><CardBody>
        {(d.movimentos ?? []).length ? <SimpleTable rows={d.movimentos ?? []} cols={[
          { key: "movement_date", label: "Data", render: (r) => (r["movement_date"] ? dateBR(r["movement_date"] as string) : "—") },
          { key: "product_name", label: "Produto", render: (r) => t(r["product_name"] ?? r["produto_nome"] ?? r["product_id"]) },
          { key: "warehouse_name", label: "Armazém", render: (r) => t(r["warehouse_name"] ?? r["armazem_nome"]) },
          { key: "movement_type", label: "Movimento", render: (r) => enumLabel("stock_movement_type", r["movement_type"]) },
          { key: "quantity", label: "Quantidade", align: "right", render: (r) => num(r["quantity"] as string, 4) },
          { key: "unit_cost", label: "Custo unitário", align: "right", render: (r) => brl(r["unit_cost"] as string) },
          { key: "total_cost", label: "Custo total", align: "right", render: (r) => brl(r["total_cost"] as string) }
        ]} /> : <p className="text-[12.5px] text-slate-500">Nenhuma entrada no estoque gerada.</p>}
      </CardBody></Card>}
      {ehCompra && <Card data-testid="compras-consulta-titulos"><CardHeader title="Contas a pagar" /><CardBody>
        {(d.titulos ?? []).length ? <SimpleTable rows={d.titulos ?? []} cols={[
          { key: "number", label: "Número", render: (r) => t(r["number"] ?? r["code"]) },
          { key: "due_date", label: "Vencimento", render: (r) => (r["due_date"] ? dateBR(r["due_date"] as string) : "—") },
          { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) },
          { key: "status", label: "Situação", render: (r) => <StatusBadge domain="title_status" value={r["status"]} /> }
        ]} /> : <p className="text-[12.5px] text-slate-500">Nenhuma conta a pagar gerada.</p>}
      </CardBody></Card>}
    </div>

    {ehCompra && <DialogoConfirmar id={id} aberto={confirmando} onAberto={setConfirmando} ocupado={confirmar.isPending} onConfirmar={() => confirmar.mutate()} />}
    {ehPedido && <DialogoEncerrarSaldo open={encerrando} onOpenChange={setEncerrando} loading={encerrar.isPending} onConfirmar={(motivo) => encerrar.mutate(motivo)}
      descricao="O saldo que falta receber deixa de poder ser recebido, e o pedido passa a convertido. As compras já geradas não mudam." />}
    <Dialog open={cancelando} onOpenChange={setCancelando} size="sm" testId="compras-cancelar-dialogo" title="Cancelar documento"
      description={situacao === "confirmado"
        ? "A compra confirmada é estornada: a entrada sai do estoque e as contas a pagar são canceladas. Conta com baixa precisa ter a baixa cancelada antes."
        : "O documento passa a cancelado e não pode mais ser confirmado."}
      footer={<>
        <Button variant="outline" onClick={() => setCancelando(false)}>Voltar</Button>
        <Button variant="danger" data-testid="compras-cancelar-confirmar" loading={cancelar.isPending} disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>Cancelar documento</Button>
      </>}>
      <span />
    </Dialog>
  </DetailShell>}</LoadingOr>;
}

/**
 * OS PRÓXIMOS PASSOS DO PEDIDO — o leque da TOP dele, no desenho de Vendas: cada passo nomeia a operação de destino
 * (código e nome, os dois do servidor) e abre a Central de Compras em modo receber. Um passo por botão: aqui não há
 * diálogo de conversão, porque receber é preencher uma compra (nota, lote, armazém), e isso é a Central.
 */
function CartaoProximosPassos({ estado, pedidoId, aoEscolher }: { estado: EstadoProximosPassosDoPedido; pedidoId: string; aoEscolher: (rota: string) => void }) {
  return <Card data-testid="compras-proximos-passos" data-situacao={estado.situacao}><CardHeader title="Próximos passos" /><CardBody>
    {estado.situacao === "carregando" && <LoadingState variant="compact" />}
    {estado.situacao === "indisponivel" && <p data-testid="compras-proximos-passos-indisponivel" className="text-[12.5px] text-amber-700">
      A lista de próximos passos está indisponível nesta versão do servidor. O pedido continua disponível para consulta.
    </p>}
    {estado.situacao === "erro" && <p data-testid="compras-proximos-passos-erro" className="text-[12.5px] text-red-700">{estado.mensagem}</p>}
    {estado.situacao === "pronto" && estado.itens.length === 0 && <p data-testid="compras-proximos-passos-vazio" className="text-[12.5px] text-slate-500">{TEXTO_SEM_PROXIMA_OPERACAO}</p>}
    {estado.situacao === "pronto" && estado.itens.length > 0 && <div className="flex flex-wrap gap-2">
      {estado.itens.map((x) => {
        const rota = rotaDeReceber(x, pedidoId);
        return rota && <Button key={x.tipoOperacaoId} size="sm" data-testid={`compras-proximo-passo-${x.codigo}`} data-top-id={x.tipoOperacaoId} data-em-partes={String(x.emPartes)}
          title={x.emPartes ? "Em partes: a compra pode receber só alguns itens, até o saldo de cada um." : "Recebe o pedido inteiro: cada item com o saldo."}
          onClick={() => aoEscolher(rota)}>
          Receber em {x.codigo} — {x.nome}{x.emPartes ? " (em partes)" : ""}
        </Button>;
      })}
    </div>}
  </CardBody></Card>;
}

function DialogoConfirmar({ id, aberto, onAberto, ocupado, onConfirmar }: { id: string; aberto: boolean; onAberto: (v: boolean) => void; ocupado: boolean; onConfirmar: () => void }) {
  const estado = usePreviaDaConfirmacaoCompra(id, aberto);
  const bloqueado = estado.situacao === "carregando" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <Dialog open={aberto} onOpenChange={onAberto} size="lg" testId="compras-confirmar-dialogo" title="Confirmar compra"
    description="O que a confirmação vai fazer agora, segundo o servidor."
    footer={<>
      <Button variant="outline" onClick={() => onAberto(false)}>Voltar</Button>
      <Button data-testid="compras-confirmar-executar" loading={ocupado} disabled={bloqueado || ocupado} onClick={onConfirmar}>Confirmar</Button>
    </>}>
    <div data-testid="compras-previa" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="compras-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="compras-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} />}
    </div>
  </Dialog>;
}

function CorpoDaPrevia({ previa }: { previa: PreviaDaConfirmacaoCompra }) {
  const { estoque, financeiro } = previa;
  return <div className="space-y-3 text-[12.5px]">
    {previa.recusas.length > 0 && <ul data-testid="compras-previa-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={i}>{r.message}</li>)}
    </ul>}
    <section data-testid="compras-previa-estoque" data-efeito={estoque.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Estoque</h3>
      {estoque.efeito === "entrada"
        ? <>
          <p className="mb-1 text-slate-600">Entrada no estoque{estoque.dataEntrada ? ` em ${dateBR(estoque.dataEntrada)}` : ""}, com o custo de cada item (frete, outras despesas e desconto rateados).</p>
          <SimpleTable rows={estoque.itens as unknown as Row[]} cols={[
            { key: "produto", label: "Produto" },
            { key: "armazem", label: "Armazém", render: (r) => t(r["armazem"]) },
            { key: "lote", label: "Lote", render: (r) => t(r["lote"]) },
            { key: "quantidade", label: "Quantidade", align: "right", render: (r) => num(r["quantidade"] as string, 4) },
            { key: "valorEntrada", label: "Valor de entrada", align: "right", render: (r) => brl(r["valorEntrada"] as string) },
            { key: "custoUnitario", label: "Custo unitário", align: "right", render: (r) => brl(r["custoUnitario"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{estoque.efeito === "nenhum" ? "Não movimenta o estoque." : "O efeito no estoque não pôde ser previsto."}</p>}
      {(estoque.itensForaDaEntrada ?? 0) > 0 && <p className="mt-1 text-slate-600" data-testid="compras-previa-fora-da-entrada">
        {estoque.itensForaDaEntrada === 1 ? "1 item não entra no estoque" : `${estoque.itensForaDaEntrada} itens não entram no estoque`} (sem armazém ou produto sem controle de estoque).
      </p>}
    </section>
    <section data-testid="compras-previa-financeiro" data-efeito={financeiro.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Financeiro</h3>
      {financeiro.efeito === "pagar"
        ? <>
          <p className="mb-1 text-slate-600">Gera contas a pagar de {brl(financeiro.valor ?? "0")}{financeiro.numero ? `, número ${financeiro.numero}` : ""}.</p>
          {financeiro.classificacao && <p className="mb-1 text-slate-600" data-testid="compras-previa-classificacao">
            Natureza {rotuloClass(financeiro.classificacao.categoria)} · centro de resultado {rotuloClass(financeiro.classificacao.centro)}
          </p>}
          <SimpleTable rows={financeiro.parcelas as unknown as Row[]} cols={[
            { key: "numero", label: "Parcela", render: (r) => (r["entrada"] ? "Entrada" : String(r["numero"])) },
            { key: "vencimento", label: "Vencimento", render: (r) => dateBR(r["vencimento"] as string) },
            { key: "valor", label: "Valor", align: "right", render: (r) => brl(r["valor"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{financeiro.efeito === "nenhum" ? "Não gera contas a pagar." : "O efeito financeiro não pôde ser previsto."}</p>}
    </section>
  </div>;
}
