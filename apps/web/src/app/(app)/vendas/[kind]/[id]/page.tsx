"use client";
import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { brl, num, dateBR, pct } from "@/lib/utils";
import { Button, Confirm, Dialog } from "@/components/ui";
import { useDoc, LoadingOr, type Row } from "@/features/docs/shared";
import { useAction } from "@/features/docs/actions";
import { Base2Shell, Base2Section, Base2Fields, Base2Items, type Base2Field, type Base2ItemColumn } from "@/features/base2";
import { tipoOperacaoDoRegistro } from "@agro/domain";
import { useTradutor } from "@/lib/i18n";
import { COPY, enumLabel, statusLabel } from "@/lib/copy";
import { CampoTipoOperacao, useTopsDaVariante, usePadraoTop } from "@/features/sales/tipo-operacao-select";
import { destinoDeCompatibilidade, useProximosPassos, type ProximoPasso } from "@/features/sales/proximos-passos";
import { varianteDeVenda } from "@/features/sales/variantes";

/** O snapshot da TOP como o servidor o devolve: nome e versão CONGELADOS no instante do lançamento. */
interface TopSnapshot { id: string; codigo: string; nome: string; versao: number; codigoBase: string; familiaRotulo: string | null }

/** Nome da tabela como o servidor a grava em `erp.audit_logs.entity`. */
const ENTIDADE = "sales_documents";

/**
 * O QUE O REGISTRO É — indexado por `kind`, o valor que o SERVIDOR classificou.
 *
 * Não é um mapa de rota. A rota (`params.kind`, o segmento plural) serve para LOCALIZAR a porta:
 * endpoint e navegação. Ela não diz o que o registro é. Antes desta fatia a tela fazia
 * um mapa indexado pelo segmento com QUEDA para a entrada de venda: além de classificar pela porta, um
 * segmento desconhecido HERDAVA a semântica de VENDA — o rótulo, a família de permissão e as ações de
 * venda, sobre um registro que ninguém sabia o que era. (A forma exata está na regra do gate, em
 * `scripts/base2-consumidor-audit.mjs`; escrevê-la aqui faria o próprio gate acusar o comentário.) A API agora recusa a rota errada (404), e a tela também não transforma URL em verdade.
 *
 * O CAMPO `proximo` SAIU DAQUI (TOP-CONFIG-03). Ele dizia, por escrito, que orçamento vira pedido e
 * pedido vira venda — política de negócio morando no cliente, igual para toda organização. Agora a
 * política vem da VERSÃO da TOP que o documento cita (`/proximos-passos`). O que sobra neste mapa é o
 * que continua sendo da ROTA e da VARIANTE: título, família de capacidade e segmento da porta.
 */
const DO_REGISTRO: Record<string, { titulo: string; perm: string; segmento: string }> = {
  budget: { titulo: "Orçamento", perm: "budgets", segmento: "budgets" },
  order: { titulo: "Pedido de venda", perm: "orders", segmento: "orders" },
  sale: { titulo: "Venda", perm: "sales", segmento: "sales" }
};

const COLUNAS_ITENS: Base2ItemColumn<Row>[] = [
  { key: "product_code", label: "Código" },
  { key: "product_name", label: "Produto" },
  { key: "warehouse_name", label: "Armazém" },
  { key: "quantity", label: "Quantidade", align: "right", render: (r) => `${num(r["quantity"] as string, 4)} ${r["unit"] ?? ""}` },
  { key: "unit_price", label: "Valor unitário", align: "right", render: (r) => brl(r["unit_price"] as string) },
  { key: "discount", label: "Desconto", align: "right", render: (r) => `${brl(r["discount"] as string)} / ${pct(r["discount_percent"] as string)}` },
  { key: "total", label: "Total", align: "right", render: (r) => brl(r["total"] as string) }
];

const COLUNAS_TITULOS: Base2ItemColumn<Row>[] = [
  { key: "number", label: "Título", render: (r) => <Link className="text-brand-700 underline" href={`/financeiro/contas-a-receber/${r["id"]}`}>{String(r["number"])}</Link> },
  { key: "due_date", label: "Vencimento", render: (r) => dateBR(r["due_date"] as string) },
  { key: "amount", label: "Valor", align: "right", render: (r) => brl(r["amount"] as string) },
  { key: "balance", label: "Saldo", align: "right", render: (r) => brl(r["balance"] as string) },
  { key: "status", label: COPY.situacao, render: (r) => enumLabel("title_status", r["status"]) }
];

const COLUNAS_DERIVADOS: Base2ItemColumn<Row>[] = [
  { key: "kind", label: "Tipo", render: (r) => enumLabel("sales_kind", r["kind"]) },
  { key: "code", label: "Código", render: (r) => <Link className="text-brand-700 underline" href={`/vendas/${r["kind"]}s/${r["id"]}`}>{String(r["code"])}</Link> },
  { key: "status", label: COPY.situacao, render: (r) => statusLabel(r["status"]) }
];

/**
 * DETALHE DO DOCUMENTO DE VENDA NO MODELO BASE 2 (BASE2-03C, docs/MODELO-BASE2-CONTRACT.md).
 *
 * A moldura passou a desenhar identidade (título + código), empresa, situação, ações, dados principais,
 * itens e histórico. O que ela NÃO passou a decidir: conversão, confirmação, cancelamento, estoque,
 * geração de títulos, idempotência, permissão, escopo de empresa, transação e cálculo. Tela unificada ≠
 * regra de negócio unificada — quem nega é a API.
 *
 * DINHEIRO NÃO É RECALCULADO AQUI. `total` é o número do servidor e inclui frete, ICMS de frete e outros
 * valores, que não estão em linha de item nenhuma: somar a coluna de itens daria outro número, e a
 * tabela não fecharia com o cabeçalho. `Base2Items` nem oferece rodapé de total, de propósito.
 *
 * ANEXOS NÃO SÃO LIGADOS. `sales_documents` não está em `ATTACHMENT_PARENTS`
 * (apps/api/src/lib/attachment-parent.ts): o botão apareceria e responderia 422. Botão que aparece e
 * não funciona é pior que botão nenhum — abrir a superfície é outra fatia, com backend.
 */
export default function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind: segmentoDaRota, id } = use(params);
  const { can } = useAuth(); const router = useRouter(); const tr = useTradutor();
  const q = useDoc<Row & { items: Row[]; titles: Row[]; derived: Row[] }>(`/api/sales/${segmentoDaRota}/${id}`);
  const [confirmar, setConfirmar] = React.useState<"confirm" | "cancel" | "convert" | null>(null);
  const d = q.data;
  const variante = d ? String(d["kind"]) : "";
  const k = DO_REGISTRO[variante];
  /**
   * O SEGMENTO DO DESTINO, guardado em `ref` e não lido do fecho: o destino só é conhecido no CLIQUE
   * (ele depende do próximo passo escolhido), e o retorno chega depois. Ler uma variável de render aqui
   * daria o valor do render em que o `useAction` foi criado.
   */
  const destinoDaConversao = React.useRef("");
  const act = useAction<{ id?: string }>((r) => { setConfirmar(null); if (confirmar === "convert" && r?.id && destinoDaConversao.current) router.push(`/vendas/${destinoDaConversao.current}/${r.id}`); });

  /**
   * OS PRÓXIMOS PASSOS — a política do documento, não a cadeia fixa da tela.
   *
   * Perguntado pela porta da VARIANTE DO REGISTRO (`k.segmento`), que é a mesma que serviu o detalhe.
   * Variante desconhecida não pergunta nada: não há porta para perguntar, e chutar uma seria classificar
   * o registro pela rota.
   */
  const passos = useProximosPassos(k?.segmento ?? "", id, Boolean(k));
  /** `can()` aqui é APRESENTAÇÃO: a API cobra a capacidade do destino na conversão. Isto só evita
   *  oferecer um botão que responderia 403. */
  const podeCriarVariante = (variante: string) => { const v = varianteDeVenda(variante); return Boolean(v) && can(`${v!.perm}.create`); };
  const itens: ProximoPasso[] = passos.situacao === "pronto" ? passos.itens.filter((x) => podeCriarVariante(x.variante)) : [];

  /**
   * CAPABILITY / ROLLING DEPLOY — EXPLÍCITO: quando `/proximos-passos` responde 404, 5xx ou um corpo que
   * não é o contrato 1 (servidor ANTERIOR a esta fatia, ou com defeito), a tela NÃO esconde a conversão:
   * ela cai no comportamento anterior — a cadeia de compatibilidade de `proximos-passos.ts`, com a TOP do
   * destino escolhida no mesmo diálogo de sempre. Lista vazia CONFIRMADA é o caso oposto: aí o documento
   * realmente não gera nada, e nenhuma conversão é oferecida.
   */
  const legado = passos.situacao === "nao-confirmado" ? destinoDeCompatibilidade(variante) : undefined;
  const legadoPermitido = Boolean(legado) && can(`${legado!.perm}.create`);
  // A TOP do DESTINO da conversão — carregada da variante de destino, nunca da fonte. O hook roda sempre
  // (regra dos hooks), mas a REQUISIÇÃO é condicional: sem destino de compatibilidade não há o que
  // perguntar, e perguntar assim mesmo faria toda abertura de documento chamar
  // `/api/sales/sales/operation-types` — resposta que ninguém usa e que, para quem tem `.view` sem
  // `.create`, é um 403 registrado em log a cada abertura.
  const [topLegado, setTopLegado] = React.useState("");
  const estadoTopLegado = useTopsDaVariante(legado?.segmento ?? segmentoDaRota, Boolean(legado) && legadoPermitido);
  usePadraoTop(estadoTopLegado, topLegado, setTopLegado);

  /** Escolha entre 2+ próximos passos. Com UM item não há escolha a fazer — e com zero não há diálogo. */
  const [passoEscolhido, setPassoEscolhido] = React.useState("");
  if (!d) return <LoadingOr q={q}>{null}</LoadingOr>;

  const passoSelecionado = itens.length === 1 ? itens[0]! : itens.find((x) => x.tipoOperacaoId === passoEscolhido) ?? null;
  const topDaConversao = passoSelecionado ? passoSelecionado.tipoOperacaoId : legado ? topLegado : "";
  const segmentoDoDestino = passoSelecionado ? varianteDeVenda(passoSelecionado.variante)?.segmento ?? "" : legado?.segmento ?? "";
  const ofereceConversao = itens.length > 0 || legadoPermitido;
  /**
   * O RÓTULO NUNCA É UM UUID. Com um destino só, o botão nomeia a TOP (código e nome, os dois do
   * servidor); com vários, ele apenas convida ao diálogo, onde a escolha aparece inteira; na
   * compatibilidade, nomeia a FAMÍLIA do destino, que é tudo o que se sabe antes de perguntar as TOPs.
   */
  const rotuloDaConversao = itens.length === 1 ? `Converter em ${itens[0]!.codigo} — ${itens[0]!.nome}`
    : itens.length > 1 ? "Converter"
      : legado ? `Converter em ${tr(legado.chaveI18n)}` : "";
  /** Agrupa por família só quando há mais de uma: um cabeçalho único sobre a lista inteira é ruído. */
  const familias = [...new Set(itens.map((x) => x.familiaRotulo))];

  // Variante que o catálogo não conhece: rótulo NEUTRO, nenhuma ação de variante, nenhuma herança da
  // rota. Não saber o que o registro é não autoriza chutar que ele é uma venda.
  const titulo = k?.titulo ?? "Documento de venda";
  const situacao = String(d["status"]);
  const editavel = ["open", "approved"].includes(situacao);
  // DUAS COISAS DIFERENTES, E AS DUAS APARECEM.
  //
  //   FAMÍLIA CANÔNICA  o que o PRODUTO sabe executar. Sai do REGISTRO (`kind`), em memória, sem rede —
  //                     é a classificação que existe desde a BASE2-02 e vale para TODO documento.
  //   TOP CONFIGURADA   o que a ORGANIZAÇÃO cadastrou e o usuário escolheu ("2103 — Venda de Gado a
  //                     Prazo"), com a VERSÃO congelada. Só existe a partir da TOP-CONFIG-02.
  //
  // Exibir a família no lugar da TOP faria a tela AFIRMAR uma configuração que o documento não tem —
  // por isso o registro legado diz "não configurada", e não "Venda".
  const top = tipoOperacaoDoRegistro(`erp.${ENTIDADE}`, d);
  const topConfigurada = d["tipo_operacao"] as TopSnapshot | null;
  // O endereço das ações é o da variante DO REGISTRO — a mesma que a API serve nesta porta.
  const rota = k?.segmento ?? segmentoDaRota;

  const campos: Base2Field[] = [
    { label: "Código", valor: String(d["code"]) },
    { label: tr("termos.tipo_operacao"), valor: topConfigurada ? `${topConfigurada.codigo} — ${topConfigurada.nome}` : "Não configurada (registro legado)", span: 4 },
    { label: "Família operacional", valor: top ? tr(top.chaveI18n) : "—", span: 2 },
    // A versão só faz sentido quando há TOP: num legado ela seria um número sem referente.
    { label: "Versão", valor: topConfigurada ? String(topConfigurada.versao) : "", ocultarSeVazio: true, span: 2 },
    { label: "Data", valor: dateBR(d["document_date"] as string), span: 2 },
    { label: "Saída", valor: d["shipping_date"] ? dateBR(d["shipping_date"] as string) : "—", span: 2 },
    { label: "Vencimento", valor: d["due_date"] ? dateBR(d["due_date"] as string) : "—", span: 2 },
    { label: "Cliente", valor: `${d["client_name"]} ${d["client_document"] ?? ""}`.trim(), span: 4 },
    { label: "Transportadora", valor: String(d["transporter_name"] ?? "—") },
    { label: "Motorista", valor: String(d["driver_name"] ?? "—"), ocultarSeVazio: true },
    { label: "Forma de pagamento", valor: String(d["payment_method_name"] ?? "—") },
    { label: "Responsável", valor: String(d["responsible_name"] ?? "") },
    { label: "Subtotal", valor: brl(d["subtotal"] as string), span: 2 },
    { label: "Frete", valor: brl(d["freight"] as string), span: 2 },
    { label: "ICMS frete", valor: brl(d["freight_icms"] as string), span: 2 },
    { label: "Outros", valor: brl(d["other_values"] as string), span: 2 },
    { label: "Desconto", valor: brl(d["discount"] as string), span: 2 },
    { label: "Total", valor: <b>{brl(d["total"] as string)}</b>, span: 2 },
    { label: "Origem", valor: d["origin_document_id"] ? "Convertido" : "Manual" },
    { label: "Observação", valor: String(d["note"] ?? ""), span: 12, ocultarSeVazio: true }
  ];

  return <Base2Shell
    titulo={titulo}
    codigo={String(d["code"])}
    situacao={situacao}
    empresa={String(d["empresa_name"])}
    voltarHref={`/vendas/${rota}`}
    historico={{ entidade: ENTIDADE, id }}
    acoes={<>
      {variante === "sale" && editavel && can("sales.edit") && <Button size="sm" onClick={() => setConfirmar("confirm")}>Confirmar venda</Button>}
      {/* CONVERTER exige AS DUAS capacidades, como a API passou a exigir: editar a FONTE e criar o
          DESTINO. Mostrar o botão só com a do destino ofereceria uma ação que a API recusa com 403. */}
      {k && ofereceConversao && editavel && can(`${k.perm}.edit`) && <Button size="sm" data-testid="acao-conversao" onClick={() => setConfirmar("convert")}>{rotuloDaConversao}</Button>}
      {k && !["cancelled", "confirmed", "invoiced"].includes(situacao) && can(`${k.perm}.delete`) && <Button size="sm" variant="danger" onClick={() => setConfirmar("cancel")}>Cancelar {k.titulo.toLowerCase()}</Button>}
      <Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir</Button>
    </>}
  >
    <Base2Fields campos={campos} />

    <Base2Section titulo="Itens" contagem={d.items.length}>
      <Base2Items legenda={`Itens d${variante === "sale" ? "a venda" : variante === "order" ? "o pedido de venda" : variante === "budget" ? "o orçamento" : "o documento"} ${String(d["code"] ?? "")}`} colunas={COLUNAS_ITENS} linhas={d.items} />
    </Base2Section>

    {/* RELACIONAMENTO, não processo: as duas seções abaixo são leitura com link, sem ação destrutiva
        embutida — por isso cabem na moldura sem custo de comportamento. Nenhuma soma é introduzida. */}
    {d.titles.length > 0 && <Base2Section titulo="Contas a receber geradas" contagem={d.titles.length}>
      <Base2Items legenda={`Contas a receber geradas pelo documento ${String(d["code"] ?? "")}`} colunas={COLUNAS_TITULOS} linhas={d.titles} />
    </Base2Section>}

    {d.derived.length > 0 && <Base2Section titulo="Documentos derivados" contagem={d.derived.length}>
      <Base2Items legenda={`Documentos derivados do documento ${String(d["code"] ?? "")}`} colunas={COLUNAS_DERIVADOS} linhas={d.derived} />
    </Base2Section>}

    <Confirm open={confirmar === "confirm"} onOpenChange={() => setConfirmar(null)} title="Confirmar venda" text="Baixa o estoque dos itens com armazém e gera as contas a receber. Operação atômica e idempotente." loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/sales/sales/${id}/confirm`, idem: true })} />
    {/* CONVERSÃO NÃO É MAIS UM "TEM CERTEZA?". O documento de destino é de OUTRA família, então precisa
        da TOP dele — a da fonte não serve e não é herdada. Sem TOP alvo escolhível, o botão não converte. */}
    <Dialog open={confirmar === "convert"} onOpenChange={() => setConfirmar(null)} title={rotuloDaConversao} size="sm" testId="dialog-conversao"
      footer={<><Button variant="outline" onClick={() => setConfirmar(null)}>Voltar</Button>
        <Button loading={act.isPending} disabled={!topDaConversao || !segmentoDoDestino}
          onClick={() => { destinoDaConversao.current = segmentoDoDestino; act.mutate({ path: `/api/sales/${rota}/${id}/convert`, idem: true, body: { tipo_operacao_id: topDaConversao } }); }}>Converter</Button></>}>
      <div className="space-y-3" data-testid="proximos-passos">
        {/* UM destino: nada a escolher, mas a operação de destino fica À VISTA — converter sem ver em que
            operação o documento novo nasce é o efeito colateral que esta fatia veio desfazer. */}
        {passos.situacao === "pronto" && itens.length === 1 && <p data-testid="proximo-passo-unico" data-top-id={itens[0]!.tipoOperacaoId} className="text-sm text-slate-700">
          <span className="font-mono font-semibold">{itens[0]!.codigo}</span> — {itens[0]!.nome}
          <span className="mt-0.5 block text-xs text-slate-500">{itens[0]!.familiaRotulo}</span>
        </p>}

        {/* DOIS OU MAIS: a escolha é do usuário, agrupada por família quando houver mais de uma. Rádio
            nativo pelo mesmo motivo do lançador: teclado, leitor de tela e rótulo associado de graça. */}
        {itens.length > 1 && familias.map((familia) => <fieldset key={familia} className="space-y-1.5">
          {familias.length > 1 && <legend className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{familia}</legend>}
          {itens.filter((x) => x.familiaRotulo === familia).map((x) => <label key={x.tipoOperacaoId} data-testid="proximo-passo-opcao" data-top-id={x.tipoOperacaoId}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${x.tipoOperacaoId === passoEscolhido ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 hover:border-slate-300"}`}>
            <input type="radio" name="proximo-passo" className="peer sr-only" value={x.tipoOperacaoId} checked={x.tipoOperacaoId === passoEscolhido} onChange={() => setPassoEscolhido(x.tipoOperacaoId)} />
            <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 ${x.tipoOperacaoId === passoEscolhido ? "border-brand-600" : "border-slate-400"}`}>
              {x.tipoOperacaoId === passoEscolhido && <span className="h-2 w-2 rounded-full bg-brand-600" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-mono text-sm font-semibold text-slate-900">{x.codigo}</span> <span className="text-sm text-slate-700">{x.nome}</span>
            </span>
          </label>)}
        </fieldset>)}

        {/* COMPATIBILIDADE: o servidor não confirmou a política. O diálogo volta a ser o de antes —
            escolher a TOP do destino da cadeia anterior —, e `MensagemTop` continua bloqueando quando
            nem essa lista vier. */}
        {legado && <div className="grid grid-cols-12 gap-3">
          <CampoTipoOperacao estado={estadoTopLegado} valor={topLegado} onChange={setTopLegado} span={12} />
        </div>}
      </div>
    </Dialog>
    {/* `idem: true` como na confirmação e na conversão: cancelar venda confirmada ESTORNA estoque e
        cancela títulos, e um reenvio do MESMO pedido não pode virar um segundo estorno. Era a única das
        três ações desta tela que mandava o pedido sem chave. */}
    <Confirm open={confirmar === "cancel"} onOpenChange={() => setConfirmar(null)} title="Cancelar documento" text="Vendas confirmadas têm estoque e títulos estornados." danger loading={act.isPending} onConfirm={() => act.mutate({ path: `/api/sales/${rota}/${id}/cancel`, idem: true, body: { reason: "Cancelado pelo usuário" } })} />
  </Base2Shell>;
}
