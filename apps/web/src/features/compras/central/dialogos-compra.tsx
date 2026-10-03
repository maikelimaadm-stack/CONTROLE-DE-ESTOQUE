"use client";
import { D } from "@agro/shared";
import { brl, dateBR, num } from "@/lib/utils";
import { LoadingState } from "@/components/ui";
import { SimpleTable, type Row } from "@/features/docs/shared";
import { DialogoConfirmar } from "@/features/central/dialogos";
import { percentualDaTela } from "./dados-fiscais";
import { usePreviaDaConfirmacaoCompra, type DivergenciaComOPedido, type ItemDaDivergencia, type LinhaDoRateioPrevista, type PreviaDaConfirmacaoCompra } from "../previa-confirmacao-compra";

/**
 * O DIÁLOGO DE CONFIRMAR COMPRA (VISUAL-UX-04, decisão 276).
 *
 * A casca é a do motor (`DialogoConfirmar` de `@/features/central/dialogos`, sobre o `Dialog` oficial). Aqui moram o
 * texto da compra e a prévia da confirmação de hoje (recusas, entrada no estoque, parcelas a pagar). A escrita
 * (POST /api/compras/compras/<id>/confirm, corpo vazio, Idempotency-Key) e quando o diálogo abre moram no estado
 * (`useEstadoDaConsulta`); Cancelar e Encerrar saldo são os diálogos do motor e o de hoje, montados na barra da consulta.
 *
 * OPERACOES-01 F6b (decisão 283): quando o servidor declara a DIVERGÊNCIA da compra com o pedido de origem (a seção da
 * TOP em "Avisar" ou "Bloquear"), a prévia a mostra entre as recusas e o Estoque. Quem decide é o servidor: o bloqueio
 * chega como a recusa `DIVERGENCIA_COM_O_PEDIDO` em `recusas`, e o botão segue `podeConfirmar`.
 *
 * OPERACOES-01 F7 (decisão 284): a compra com RATEIO (por valor ou por produto) mostra as linhas das contas a pagar
 * (`compras-previa-rateio`) no lugar da natureza e centro do documento — quando o servidor as manda.
 */

/** CONFIRMAR COMPRA <código>? — a prévia do servidor; carregando ou com recusa prevista, o botão trava. */
export function DialogoConfirmarCompra({ id, aberto, onFechar, codigo, carregando, onConfirmar }: {
  id: string; aberto: boolean; onFechar: () => void; codigo: string; carregando: boolean; onConfirmar: () => void;
}) {
  const estado = usePreviaDaConfirmacaoCompra(id, aberto);
  const bloqueado = estado.situacao === "carregando" || (estado.situacao === "pronta" && !estado.previa.podeConfirmar);
  return <DialogoConfirmar aberto={aberto} onFechar={onFechar} rotulo="Confirmar compra" codigo={codigo} carregando={carregando}
    confirmarDesabilitado={bloqueado} onConfirmar={onConfirmar}>
    <div data-testid="compras-previa" data-situacao={estado.situacao}>
      {estado.situacao === "carregando" && <LoadingState label="Calculando a prévia…" />}
      {estado.situacao === "indisponivel" && <p className="text-[12.5px] text-amber-700" data-testid="compras-previa-indisponivel">A prévia não está disponível neste servidor. A confirmação continua conferida pelo servidor.</p>}
      {estado.situacao === "erro" && <p className="text-[12.5px] text-red-700" data-testid="compras-previa-erro">{estado.mensagem}</p>}
      {estado.situacao === "pronta" && <CorpoDaPrevia previa={estado.previa} />}
    </div>
  </DialogoConfirmar>;
}

const t = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const rotuloClass = (i: { codigo: string; nome: string }) => [i.codigo, i.nome].filter(Boolean).join(" — ");

function CorpoDaPrevia({ previa }: { previa: PreviaDaConfirmacaoCompra }) {
  const { estoque, financeiro } = previa;
  return <div className="space-y-3 text-[12.5px]">
    {previa.recusas.length > 0 && <ul data-testid="compras-previa-recusas" className="space-y-0.5 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
      {previa.recusas.map((r, i) => <li key={i}>{r.message}</li>)}
    </ul>}
    {previa.divergencia && <DivergenciaDaPrevia divergencia={previa.divergencia} />}
    <section data-testid="compras-previa-estoque" data-efeito={estoque.efeito ?? ""}>
      <h3 className="mb-1 font-semibold">Estoque</h3>
      {estoque.efeito === "entrada"
        ? <>
          <p className="mb-1 text-slate-600">Entrada no estoque{estoque.dataEntrada ? ` em ${dateBR(estoque.dataEntrada)}` : ""}, com o custo de cada item (frete, outras despesas e desconto rateados).</p>
          <SimpleTable rows={estoque.itens as unknown as Row[]} cols={[
            // o Local de estoque antes do Produto (OPERACOES-01 F3b, decisão 280)
            { key: "armazem", label: "Local de estoque", render: (r) => t(r["armazem"]) },
            { key: "produto", label: "Produto" },
            { key: "lote", label: "Lote", render: (r) => t(r["lote"]) },
            { key: "quantidade", label: "Quantidade", align: "right", render: (r) => num(r["quantidade"] as string, 4) },
            { key: "valorEntrada", label: "Valor de entrada", align: "right", render: (r) => brl(r["valorEntrada"] as string) },
            { key: "custoUnitario", label: "Custo unitário", align: "right", render: (r) => brl(r["custoUnitario"] as string) }
          ]} />
        </>
        : <p className="text-slate-600">{estoque.efeito === "nenhum" ? "Não movimenta o estoque." : "O efeito no estoque não pôde ser previsto."}</p>}
      {(estoque.itensForaDaEntrada ?? 0) > 0 && <p className="mt-1 text-slate-600" data-testid="compras-previa-fora-da-entrada">
        {estoque.itensForaDaEntrada === 1 ? "1 item não entra no estoque" : `${estoque.itensForaDaEntrada} itens não entram no estoque`} (sem local de estoque, produto sem controle de estoque ou item que não gera estoque).
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
          {financeiro.rateio && <RateioDaPrevia linhas={financeiro.rateio} />}
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

/** O rateio das contas a pagar: uma linha por natureza e centro, com conta, safra, percentual e valor do servidor. */
function RateioDaPrevia({ linhas }: { linhas: readonly LinhaDoRateioPrevista[] }) {
  return <div className="mb-1" data-testid="compras-previa-rateio">
    <p className="mb-0.5 text-slate-600">Rateio das contas a pagar:</p>
    <ul className="space-y-0.5 text-slate-700">
      {linhas.map((l, i) => <li key={i} data-testid="compras-previa-rateio-linha">
        {rotuloClass(l.categoria)} · {rotuloClass(l.centro)}
        {l.conta ? ` · conta ${rotuloClass(l.conta)}` : ""}{l.safra ? ` · safra ${l.safra.nome}` : ""}
        {" — "}{percentualDaTela(l.percentual)} · {brl(l.valor)}
      </li>)}
    </ul>
  </div>;
}

/** O percentual que o servidor manda ("5", "2.50") com a vírgula decimal da tela; o número não é refeito. */
const percentualDoServidor = (v: string) => v.replace(".", ",");

/** A diferença com sinal: "+20,00%", "-12,50%"; sem base (o pedido sem preço), "—". */
const diferencaComSinal = (v: string | null) => (v === null ? "—" : `${D(v).gt(0) ? "+" : ""}${num(v, 2)}%`);

/** O valor de cada lado: o preço com o MESMO formatador do Valor unitário dos itens salvos; a quantidade em 4 casas. */
const valorDoLado = (campo: ItemDaDivergencia["campo"], v: string) => (campo === "preco" ? brl(v) : num(v, 4));

/** A frase da seção, pelo que o servidor declarou (o modo e se bloqueia). */
function fraseDaDivergencia(d: DivergenciaComOPedido): string {
  if (d.itens.length === 0) return "A compra não difere do pedido de origem.";
  if (d.modo === "avisa") return "A compra difere do pedido de origem. Esta operação só avisa: a confirmação continua possível.";
  return d.bloqueia ? "A compra difere do pedido além da tolerância desta operação: a confirmação é recusada."
    : "A compra difere do pedido dentro da tolerância desta operação.";
}

const COLUNAS_DA_DIVERGENCIA = ["Produto", "O que difere", "No pedido", "Na compra", "Diferença", "Acima da tolerância"] as const;

/**
 * DIVERGÊNCIA COM O PEDIDO — a frase, as tolerâncias da operação e uma linha por item que difere. A tabela tem a MESMA
 * marcação do `SimpleTable` (que não aceita atributo por linha): cada linha leva o campo e se está acima da tolerância.
 */
function DivergenciaDaPrevia({ divergencia: d }: { divergencia: DivergenciaComOPedido }) {
  return <section data-testid="compras-previa-divergencia" data-modo={d.modo} data-bloqueia={String(d.bloqueia)}>
    <h3 className="mb-1 font-semibold">Divergência com o pedido</h3>
    <p className="mb-1 text-slate-600">{fraseDaDivergencia(d)}</p>
    <p className="mb-1 text-slate-600" data-testid="compras-previa-divergencia-tolerancia">
      Tolerância: preço {percentualDoServidor(d.toleranciaPrecoPercentual)}% · quantidade {percentualDoServidor(d.toleranciaQuantidadePercentual)}%.
    </p>
    {d.itens.length > 0 && <div className="overflow-x-auto rounded border"><table className="table-dense w-full text-[12.5px]">
      <thead><tr>{COLUNAS_DA_DIVERGENCIA.map((c, i) => <th key={c} className={i >= 2 && i <= 4 ? "text-right" : ""}>{c}</th>)}</tr></thead>
      <tbody>{d.itens.map((it, i) => <tr key={`${it.campo}:${it.itemIds.join(",")}:${i}`} data-testid="compras-previa-divergencia-item" data-campo={it.campo} data-acima={String(it.acimaDaTolerancia)}>
        <td>{it.produto}</td>
        <td>{it.campo === "preco" ? "Preço" : "Quantidade"}</td>
        <td className="num">{valorDoLado(it.campo, it.valorPedido)}</td>
        <td className="num">{valorDoLado(it.campo, it.valorCompra)}</td>
        <td className="num" title={it.diferencaPercentual === null ? "o pedido não tem preço" : undefined}>{diferencaComSinal(it.diferencaPercentual)}</td>
        <td>{it.acimaDaTolerancia ? "Sim" : "Não"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
