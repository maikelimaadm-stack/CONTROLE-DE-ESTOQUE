"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as TabsP from "@radix-ui/react-tabs";
import { useQueryClient } from "@tanstack/react-query";
import { formatarChaveDeAcesso, type ConferenciaDaImportacaoNfe } from "@agro/domain";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { enumLabel } from "@/lib/copy";
import { brl, dateBR } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { empresaDestinoDoRegistro } from "@/lib/empresa-ativa";
import { entendeLayoutDocumento } from "@/features/sales/tipo-operacao-select";
import { Button, ConfirmDialog, DetailShell, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { useTopsDaEspecie, varianteDeCompra } from "../variantes";
import { invalidarLeiturasDeCompras, useChaveDeIdempotencia } from "../pedido-e-orcamento";
import { useImportacaoXml } from "./capacidade";
import { descartarImportacao, gerarCompraDaImportacao, lerConferencia, recusasNoCampo, useConferencia } from "./api";
import { ABAS_DA_CONFERENCIA, abaDoCaminho, useEstadoDaConferencia, type AbaDaConferencia } from "./estado";
import { AbaCabecalho } from "./aba-cabecalho";
import { AbaItens } from "./aba-itens";
import { AbaPedido } from "./aba-pedido";
import { AbaFinanceiro } from "./aba-financeiro";
import { AbaDivergencias } from "./aba-divergencias";

/**
 * A CONFERÊNCIA DA NF-e IMPORTADA (OPERACOES-01 F7, decisão 284) — `/compras/importacoes/<id>`.
 *
 * O servidor leu o XML, guardou o original e montou a conferência (parceiro, vínculos dos itens, pedidos, parcelas,
 * divergências). Aqui a pessoa DECIDE, em abas — Cabeçalho, Itens/vínculos/lotes, Pedido, Financeiro e Divergências —
 * e termina em "Gerar compra": uma COMPRA ABERTA, que nunca se confirma sozinha (a confirmação, com o estoque e o
 * financeiro, é feita depois, na consulta da compra, com a prévia). "Descartar importação" registra a decisão (a
 * importação não se apaga). Importação decidida (gerada ou descartada) é somente leitura.
 *
 * Sem a capacidade `importacaoXml` (a API anterior) a página não pergunta nada: diz que a importação não está
 * disponível nesta versão do servidor. A recusa do servidor (422) volta para o campo e para a aba do `path`.
 *
 * XML-04 (decisão 318): o estado recebe a espécie compra (segmento e família) e se a porta das TOPs entende o layout
 * do documento — para ler, como a Central, o que a TOP escolhida diz da forma de pagamento. Enquanto essa leitura chega,
 * o "Gerar compra" espera (a forma resolvida pode mudar), como espera a releitura da conferência.
 */

const NOME_DA_ABA: Record<AbaDaConferencia, string> = {
  cabecalho: "Cabeçalho", itens: "Itens", pedido: "Pedido", financeiro: "Financeiro", divergencias: "Divergências"
};
const DICA_DO_GERAR = "Gera uma compra ABERTA para revisão. A confirmação (estoque e financeiro) NÃO ocorre aqui — só depois, na consulta da compra, com ação explícita.";
const ROTULO_GERAR = "Gerar compra para revisão";

export function ConferenciaDaImportacao({ id, solicitacaoId }: { id: string; solicitacaoId: string | null }) {
  const capacidade = useImportacaoXml();
  if (capacidade === "carregando") return <LoadingState />;
  if (capacidade === "nao") {
    return <EmptyState title="A importação de XML não está disponível" description="Esta versão do servidor não declara a entrada de nota por XML na Central de Compras." />;
  }
  return <ConferenciaComCapacidade id={id} solicitacaoId={solicitacaoId} />;
}

function ConferenciaComCapacidade({ id, solicitacaoId }: { id: string; solicitacaoId: string | null }) {
  const [fornecedorId, setFornecedorId] = React.useState<string | null>(null);
  const q = useConferencia(id, fornecedorId);
  const conf = React.useMemo(() => (q.data === undefined ? null : lerConferencia(q.data)), [q.data]);
  if (q.isPending) return <LoadingState />;
  if (q.error && !conf) {
    if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="Importação não encontrada" />;
    return <ErrorState error={q.error} variant="block" onRetry={() => void q.refetch()} />;
  }
  if (!conf) return <ErrorState message="A resposta do servidor não é a conferência que esta tela sabe ler." variant="block" />;
  // A releitura que falhou (ex.: o fornecedor escolhido não é um dos candidatos): a conferência anterior fica, com o aviso.
  const erroDaReleitura = q.error ? (q.error instanceof Error ? q.error.message : String(q.error)) : null;
  return <ConferenciaCarregada key={conf.id} conf={conf} solicitacaoId={solicitacaoId} relendo={q.isFetching} erroDaReleitura={erroDaReleitura}
    onEscolherFornecedor={(f) => { setFornecedorId(f); }} />;
}

/** A importação DECIDIDA (gerada ou descartada): só o que a nota diz — as decisões estão na compra gerada. */
function ResumoDaNota({ conf }: { conf: ConferenciaDaImportacaoNfe }) {
  const t = conf.nota.totais;
  return <section data-testid="importacao-resumo" className="flex flex-col gap-3">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3 lg:grid-cols-6">
      <div><dt className="text-slate-500">Emissão</dt><dd className="font-medium text-slate-800">{dateBR(conf.nota.dataEmissao)}</dd></div>
      <div><dt className="text-slate-500">Produtos</dt><dd className="font-medium text-slate-800">{brl(t.produtos)}</dd></div>
      <div><dt className="text-slate-500">Frete</dt><dd className="font-medium text-slate-800">{brl(t.frete)}</dd></div>
      <div><dt className="text-slate-500">IPI</dt><dd className="font-medium text-slate-800">{brl(t.ipi)}</dd></div>
      <div><dt className="text-slate-500">ICMS-ST</dt><dd className="font-medium text-slate-800">{brl(t.icmsSt)}</dd></div>
      <div><dt className="text-slate-500">Total da nota</dt><dd className="font-semibold text-slate-900">{brl(t.nota)}</dd></div>
    </dl>
    <div className="overflow-x-auto rounded border">
      <table className="table-dense w-full text-[12.5px]">
        <caption className="sr-only">Itens da NF-e</caption>
        <thead><tr><th className="w-12">Item</th><th>Código</th><th>Descrição</th><th className="w-20 text-right">Qtd</th><th className="w-16">Un</th><th className="w-28 text-right">Valor</th></tr></thead>
        <tbody>
          {conf.nota.itens.map((i) => <tr key={i.nItem}>
            <td>{i.nItem}</td><td className="font-mono text-[11px]">{i.codigo}</td><td>{i.descricao}</td>
            <td className="num text-right">{i.quantidade}</td><td>{i.unidade}</td><td className="num text-right">{brl(i.valorProdutos)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

function ConferenciaCarregada({ conf, solicitacaoId, relendo, erroDaReleitura, onEscolherFornecedor }: {
  conf: ConferenciaDaImportacaoNfe; solicitacaoId: string | null; relendo: boolean; erroDaReleitura: string | null; onEscolherFornecedor: (id: string) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, session } = useAuth();
  const varianteDaCompra = varianteDeCompra("compra");
  const tops = useTopsDaEspecie(varianteDaCompra?.segmento ?? "");
  const [solicitacao, setSolicitacao] = React.useState(solicitacaoId);
  const e = useEstadoDaConferencia(conf, {
    topPadrao: tops.situacao === "pronto" ? tops.dados.defaultId : null,
    podeReceberPedido: can("pedidos_compra.edit"),
    solicitacaoId: solicitacao,
    compra: varianteDaCompra ? { segmento: varianteDaCompra.segmento, familia: varianteDaCompra.familia } : null,
    entendeLayout: entendeLayoutDocumento(tops)
  });
  const [aba, setAba] = React.useState<AbaDaConferencia>("cabecalho");
  const [descartando, setDescartando] = React.useState(false);
  const [gerando, setGerando] = React.useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = React.useState(false);
  const chaveGerar = useChaveDeIdempotencia();
  const chaveDescartar = useChaveDeIdempotencia();
  const nota = conf.nota;

  const reler = () => qc.invalidateQueries({ queryKey: ["compras-importacao", conf.id] });

  const gerar = async () => {
    const corpo = e.corpo();
    if (!corpo || gerando) return;
    setGerando(true);
    try {
      const compra = await gerarCompraDaImportacao(conf.id, corpo, chaveGerar.doEnvio(corpo));
      e.setRecusas([]);
      /* Nunca confirmar aqui — compra ABERTA; o operador revisa na consulta e confirma com prévia. */
      toast.success(`Compra ${compra.codigo} gerada — pendente de confirmação. Revise antes de confirmar.`);
      void invalidarLeiturasDeCompras(qc);
      void reler();
      const rota = `/compras/${varianteDaCompra?.segmento ?? "compras"}/${compra.id}`;
      // A compra é da empresa da importação: com outra empresa selecionada, a troca passa pela porta única do shell.
      const destino = empresaDestinoDoRegistro(session?.empresaId ?? null, conf.empresa.id);
      if (destino) window.dispatchEvent(new CustomEvent("agro:empresa-request", { detail: { empresaId: destino, rota } }));
      else router.push(rota);
    } catch (err) {
      const mensagem = chaveGerar.depoisDoErro(err);
      const recusas = recusasNoCampo(err);
      e.setRecusas(recusas.length ? recusas : [{ path: "", message: mensagem }]);
      setAba(recusas.length ? abaDoCaminho(recusas[0]!.path) : "divergencias");
      toast.error(mensagem);
    } finally {
      setGerando(false);
    }
  };

  const descartar = async () => {
    if (descartando) return;
    setDescartando(true);
    try {
      await descartarImportacao(conf.id, chaveDescartar.doEnvio({}));
      toast.success("Importação descartada.");
      setConfirmandoDescarte(false);
      await reler();
    } catch (err) {
      toast.error(chaveDescartar.depoisDoErro(err));
      void reler();
    } finally {
      setDescartando(false);
    }
  };

  const bloqueado = e.bloqueios.length > 0 || !e.corpo();
  /** Contador da aba: só o que BLOQUEIA nela + as recusas do último Gerar que apontam para ela (mesma regra em todas). */
  const contador = (a: AbaDaConferencia) =>
    e.divergencias.filter((d) => d.bloqueia && d.aba === a).length + e.recusasPorAba(a);
  const subtitulo = <>
    <span>{nota.emitente.nome} ({nota.emitente.documento})</span> · <span data-testid="importacao-empresa-da-compra">{conf.empresa.nome}</span> · <span className="font-mono text-[11px]" data-testid="importacao-chave">{formatarChaveDeAcesso(nota.chave)}</span>
  </>;

  const conteudo: Record<AbaDaConferencia, React.ReactNode> = {
    cabecalho: <AbaCabecalho e={e} tops={tops} onEscolherFornecedor={onEscolherFornecedor} solicitacaoId={solicitacao} onDesvincularSolicitacao={() => setSolicitacao(null)} />,
    itens: <AbaItens e={e} />,
    pedido: <AbaPedido e={e} />,
    financeiro: <AbaFinanceiro e={e} />,
    divergencias: <AbaDivergencias e={e} irPara={setAba} />
  };

  const titulo = `Conferência da NF-e ${nota.numero}/${nota.serie}`;
  return <div data-testid="importacao-conferencia" data-situacao={conf.situacao} data-relendo={relendo ? "sim" : "nao"}>
    <DetailShell
      title={titulo}
      subtitle={subtitulo}
      backHref="/compras?tab=documentos"
      breadcrumbs={[
        { label: "Compras", href: "/compras" },
        { label: "Documentos", href: "/compras?tab=documentos" },
        { label: `NF-e ${nota.numero}/${nota.serie}` }
      ]}
      status={conf.situacao}
      statusDomain="situacao_importacao_nfe"
      actions={e.pendente ? <>
        <Button variant="outline" size="sm" data-testid="importacao-descartar" disabled={gerando || descartando} onClick={() => setConfirmandoDescarte(true)}>Descartar importação</Button>
        <span title={DICA_DO_GERAR}>
          <Button size="sm" data-testid="importacao-gerar-compra" loading={gerando} disabled={bloqueado || relendo || descartando || e.lendoATop} aria-describedby="importacao-dica-gerar" onClick={() => void gerar()}>{ROTULO_GERAR}</Button>
        </span>
      </> : undefined}
    >
      {e.pendente && <p id="importacao-dica-gerar" className="text-[12px] text-slate-500">{DICA_DO_GERAR}{e.bloqueios.length > 0 ? ` Antes, resolva ${e.bloqueios.length === 1 ? "1 pendência" : `${e.bloqueios.length} pendências`} (aba Divergências).` : ""}</p>}
      {erroDaReleitura && <p data-testid="importacao-erro-releitura" role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">A conferência não pôde ser lida de novo: {erroDaReleitura}</p>}
      {conf.situacao === "gerada" && <div data-testid="importacao-compra-gerada" className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
        <p className="font-semibold" data-testid="importacao-pendente-confirmacao">Pendente de confirmação</p>
        <p>
          Compra gerada (aberta): {conf.documentoCompra
            ? <Link className="font-medium text-brand-700 underline" href={`/compras/${varianteDaCompra?.segmento ?? "compras"}/${conf.documentoCompra.id}`}>{conf.documentoCompra.codigo}</Link>
            : "—"}
          {conf.documentoCompra ? ` · ${enumLabel("situacao_documento_compra", conf.documentoCompra.situacao)}` : ""}.
          Estoque e títulos só nascem após confirmar na consulta da compra.
        </p>
        {conf.documentoCompra && <p>
          <Link className="inline-flex font-semibold text-brand-700 underline" data-testid="importacao-revisar-compra"
            href={`/compras/${varianteDaCompra?.segmento ?? "compras"}/${conf.documentoCompra.id}`}>
            Revisar compra
          </Link>
        </p>}
      </div>}
      {conf.situacao === "descartada" && <p data-testid="importacao-descartada" className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700">Importação descartada.</p>}

      {e.pendente ? <TabsP.Root value={aba} onValueChange={(v) => setAba(ABAS_DA_CONFERENCIA.find((x) => x === v) ?? "cabecalho")}>
        <TabsP.List className="flex flex-wrap gap-0.5 border-b border-slate-200" aria-label="Conferência da nota">
          {ABAS_DA_CONFERENCIA.map((a) => {
            const n = contador(a);
            return <TabsP.Trigger key={a} value={a} data-testid={`importacao-aba-${a}-rotulo`}
              className="border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 data-[state=active]:border-brand-600 data-[state=active]:text-brand-700">
              {NOME_DA_ABA[a]}{n > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white" data-testid={`importacao-aba-${a}-contador`}>{n}</span>}
            </TabsP.Trigger>;
          })}
        </TabsP.List>
        {ABAS_DA_CONFERENCIA.map((a) => <TabsP.Content key={a} value={a} className="pt-3">{conteudo[a]}</TabsP.Content>)}
      </TabsP.Root> : <ResumoDaNota conf={conf} />}

      <ConfirmDialog open={confirmandoDescarte} onOpenChange={(o) => { if (!descartando) setConfirmandoDescarte(o); }} title="Descartar esta importação?"
        description="A importação fica registrada como descartada (o XML original continua guardado). Nada é lançado. Para lançar esta nota depois, importe o XML de novo."
        confirmLabel="Descartar importação" danger loading={descartando} onConfirm={() => void descartar()} />
    </DetailShell>
  </div>;
}
