"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { dateTimeBR } from "@/lib/utils";
import { COPY } from "@/lib/copy";
import { Badge, Button, Dialog, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { SECOES_CONFIGURACAO_TOP, type ConfiguracaoTipoOperacaoV1, type SecaoConfiguracaoTop } from "@agro/domain";
import { ROTULOS_SECAO_TOP, ROTULOS_TOP, lerConfiguracaoDoServidor, type ConfiguracaoDoServidor } from "./top-contrato";

/**
 * O HISTÓRICO DE VERSÕES — LEITURA, E SÓ LEITURA (TOP-CONFIG-03).
 *
 * ┌─ POR QUE NÃO HÁ "RESTAURAR" AQUI ──────────────────────────────────────────────────────────────────┐
 * │ Versão é registro do que vigorou, não rascunho guardado. Um botão de restaurar pareceria devolver a │
 * │ versão 3 ao ar, mas o que ele faria de verdade é CRIAR a versão 8 com o conteúdo da 3 — e essa      │
 * │ diferença é exatamente o que uma auditoria precisa enxergar. Enquanto a operação não existir com    │
 * │ esse nome e com esse efeito declarado, oferecer o botão seria mentir sobre o que ele faz.           │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CADA VERSÃO MOSTRA A CONFIGURAÇÃO DELA ───────────────────────────────────────────────────────────┐
 * │ Nunca a atual. Exibir a regra vigente ao lado de um nome antigo seria mentir com aparência de       │
 * │ registro. E quando o servidor declara que não sabe ler aquela versão (`suportada: false`), a tela    │
 * │ diz isso — não preenche a lacuna com o neutro, que seria indistinguível de uma configuração real    │
 * │ que alguém declarou.                                                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

interface DestinoDaVersao { tipoOperacaoId: string; ordem: number; codigo: string; nome: string; familiaRotulo: string }

interface VersaoTop {
  versao: number;
  nome: string;
  descricao: string | null;
  criadoEm: string;
  criadoPor: string | null;
  configuracao: ConfiguracaoDoServidor | null;
  /** `null` = não dá para comparar com a anterior (ausente ou ilegível). Diferente de `[]` ("nada mudou"). */
  secoesAlteradas: SecaoConfiguracaoTop[] | null;
  destinos: DestinoDaVersao[] | null;
  /**
   * ESTA VERSÃO CHEGOU A DECLARAR POLÍTICA DE PRÓXIMAS OPERAÇÕES?
   *
   * `true` declarou · `false` não declarou (vigorava a cadeia anterior) · `null` o servidor não informou.
   *
   * É a pergunta que o histórico existe para responder e que `destinos.length` não responde: uma versão
   * com zero destinos ou não tinha política nenhuma, ou tinha a política "esta operação não gera nada" —
   * e as duas explicam desfechos OPOSTOS para uma conversão daquela época.
   */
  destinosConfigurados: boolean | null;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const ehTexto = (v: unknown): v is string => typeof v === "string";

const ehDestinoDaVersao = (v: unknown): v is DestinoDaVersao =>
  ehObjeto(v) && ehTexto(v.tipoOperacaoId) && typeof v.ordem === "number"
  && ehTexto(v.codigo) && ehTexto(v.nome) && ehTexto(v.familiaRotulo);

/** Conferência campo a campo: o corpo do 200 é `unknown` até aqui, e o que não se reconhece vira `null`. */
function lerVersao(bruto: unknown): VersaoTop | null {
  if (!ehObjeto(bruto)) return null;
  if (typeof bruto.versao !== "number" || !ehTexto(bruto.nome) || !ehTexto(bruto.criadoEm)) return null;
  const secoes = bruto.secoesAlteradas;
  return {
    versao: bruto.versao,
    nome: bruto.nome,
    descricao: ehTexto(bruto.descricao) ? bruto.descricao : null,
    criadoEm: bruto.criadoEm,
    criadoPor: ehTexto(bruto.criadoPor) ? bruto.criadoPor : null,
    configuracao: bruto.configuracao === undefined ? null : lerConfiguracaoDoServidor(bruto.configuracao),
    secoesAlteradas: Array.isArray(secoes) && secoes.every((s): s is SecaoConfiguracaoTop =>
      (SECOES_CONFIGURACAO_TOP as readonly string[]).includes(s as string)) ? [...secoes] : null,
    destinos: Array.isArray(bruto.destinos) && bruto.destinos.every(ehDestinoDaVersao)
      ? [...(bruto.destinos as DestinoDaVersao[])].sort((a, b) => a.ordem - b.ordem)
      : null,
    // Cada campo do histórico degrada SOZINHO para `null` — a mesma régua de `destinos` e
    // `secoesAlteradas` acima. Aqui `null` vira uma frase que diz que não se sabe; nunca `false`, que
    // afirmaria "ninguém declarou" sobre uma versão que talvez tenha declarado.
    destinosConfigurados: typeof bruto.destinosConfigurados === "boolean" ? bruto.destinosConfigurados : null
  };
}

export function HistoricoDeVersoesTop({ id, codigo, onFechar }: { id: string; codigo: string; onFechar: () => void }) {
  const q = useQuery<unknown, ApiError>({
    queryKey: ["tipos-operacao", id, "versoes"],
    queryFn: () => api<unknown>(`/api/admin/tipos-operacao/${id}/versoes`),
    retry: false
  });

  const versoes = React.useMemo(() => {
    const d = q.data;
    if (!ehObjeto(d) || !Array.isArray(d.items)) return null;
    const lidas = d.items.map(lerVersao);
    // Item ilegível NÃO é filtrado: esconder uma versão do histórico é o pior resultado possível numa tela
    // cuja razão de existir é ser registro completo. A lista inteira NEGA e a tela diz por quê.
    return lidas.every((v): v is VersaoTop => v !== null) ? lidas : null;
  }, [q.data]);

  return <Dialog
    open
    onOpenChange={(o) => { if (!o) onFechar(); }}
    title={`Versões de ${codigo}`}
    description="Cada gravação criou uma versão. Nenhuma versão é editável, aqui ou em qualquer outro lugar."
    size="xl"
    testId="versoes-tipo-operacao"
  >
    {q.isPending ? <LoadingState />
      : q.isError ? <ErrorState error={q.error} />
      : versoes === null ? <ErrorState message="Este servidor respondeu o histórico em um formato que esta tela não reconhece. Nada é exibido, para não mostrar um registro parcial como se fosse completo." />
      : versoes.length === 0 ? <EmptyState title="Nenhuma versão registrada" />
      : <ul className="space-y-2" data-testid="top-versoes-lista">
          {versoes.map((v) => <LinhaDeVersao key={v.versao} versao={v} />)}
        </ul>}
  </Dialog>;
}

function LinhaDeVersao({ versao }: { versao: VersaoTop }) {
  const [aberto, setAberto] = React.useState(false);
  return <li data-testid="top-versao-linha" className="rounded border">
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Badge tone="blue">Versão {versao.versao}</Badge>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{versao.nome}</span>
      <span className="text-[11px] text-slate-500">{dateTimeBR(versao.criadoEm)}</span>
      <span className="text-[11px] text-slate-500">{versao.criadoPor ?? COPY.naoInformado}</span>
      <Button size="sm" variant="ghost" data-testid="top-versao-detalhe" onClick={() => setAberto((a) => !a)}>
        {aberto ? "Ocultar detalhe" : "Ver detalhe"}
      </Button>
    </div>
    <div className="border-t px-3 py-2 text-[12px] text-slate-600">
      <p><span className="text-slate-400">Descrição: </span>{versao.descricao ?? "—"}</p>
      <p className="mt-0.5">
        <span className="text-slate-400">Formato da configuração: </span>
        {versao.configuracao ? versao.configuracao.versaoSchema : COPY.naoInformado}
      </p>
      <p className="mt-0.5"><span className="text-slate-400">Seções alteradas: </span>{resumoDeSecoes(versao.secoesAlteradas)}</p>
    </div>
    {aberto && <div className="border-t bg-slate-50 px-3 py-2">
      <DetalheDaVersao versao={versao} />
    </div>}
  </li>;
}

/**
 * `null` e `[]` dizem coisas DIFERENTES e a tela não pode colapsá-las: `[]` é "comparei e nada mudou";
 * `null` é "não dá para comparar" (primeira versão, ou versão anterior em formato ilegível).
 */
function resumoDeSecoes(secoes: SecaoConfiguracaoTop[] | null): string {
  if (secoes === null) return "Não é possível comparar com a versão anterior.";
  if (secoes.length === 0) return "Nenhuma seção de configuração mudou nesta versão.";
  return secoes.map((s) => ROTULOS_SECAO_TOP[s]).join(", ");
}

function DetalheDaVersao({ versao }: { versao: VersaoTop }) {
  const c = versao.configuracao;
  return <div className="space-y-3">
    {c === null
      ? <p data-testid="top-versao-sem-configuracao" className="text-[12px] text-slate-600">
          Este servidor não informou configuração para esta versão. Ela foi gravada antes de a configuração
          operacional existir, ou esta API não a publica.
        </p>
      : !c.suportada
        ? <p data-testid="top-versao-ilegivel" className="text-[12px] text-amber-700">
            Esta versão foi gravada em um formato que esta versão do produto não sabe interpretar
            (formato {c.versaoSchema}). Os valores não são exibidos: mostrar campos que não foram lidos
            seria inventar a regra que vigorava.
          </p>
        : <SecoesSomenteLeitura valor={c.valor} />}

    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Próximas operações</p>
      <PoliticaDaVersao versao={versao} />
    </div>
  </div>;
}

/**
 * A POLÍTICA DE PRÓXIMAS OPERAÇÕES DAQUELA VERSÃO — o estado primeiro, a lista depois.
 *
 * O estado é LIDO do registro (`destinosConfigurados`), nunca inferido de `destinos.length`. Um histórico
 * que inferisse contaria a história errada exatamente onde ela importa: a versão que declarou "esta
 * operação não gera nada" apareceria como se nunca tivesse sido configurada, e quem fosse auditar a
 * conversão de um documento daquela data concluiria o oposto do que aconteceu.
 */
function PoliticaDaVersao({ versao }: { versao: VersaoTop }) {
  const lista = versao.destinos;
  return <>
    {versao.destinosConfigurados === null
      ? <p data-testid="top-versao-politica-desconhecida" className="text-[12px] text-slate-500">
          Este servidor não informou se esta versão declarou uma política de próximas operações.
        </p>
      : versao.destinosConfigurados
        ? (lista !== null && lista.length === 0) && <p data-testid="top-versao-politica-vazia" className="text-[12px] text-slate-600">
            Política declarada nesta versão: nenhuma próxima operação. Um documento criado sob ela não é
            encaminhado para outra operação.
          </p>
        : <p data-testid="top-versao-politica-nao-declarada" className="text-[12px] text-slate-600">
            Política não declarada nesta versão: a conversão seguia o caminho anterior do produto.
          </p>}

    {lista === null
      ? <p className="text-[12px] text-slate-500">Este servidor não informou as próximas operações desta versão.</p>
      : lista.length > 0 && <ul className="text-[12px]" data-testid="top-versao-destinos">
          {lista.map((d) => <li key={d.tipoOperacaoId}>
            <span className="tabular-nums text-slate-400">{d.ordem}. </span>
            {d.codigo} — {d.nome} <span className="text-[11px] text-slate-400">{d.familiaRotulo}</span>
          </li>)}
        </ul>}
  </>;
}

const simNao = (v: boolean) => (v ? "Sim" : "Não");

/** As mesmas seções do editor, sem nenhum controle: aqui não se altera nada. */
function SecoesSomenteLeitura({ valor }: { valor: ConfiguracaoTipoOperacaoV1 }) {
  const blocos: { chave: SecaoConfiguracaoTop; itens: [string, string][] }[] = [
    { chave: "geral", itens: [
      ["Confirmação", ROTULOS_TOP.confirmacao[valor.geral.confirmacao]],
      ["Alteração após confirmar", ROTULOS_TOP.alteracao[valor.geral.alteracaoAposConfirmacao]],
      ["Documento sem itens", ROTULOS_TOP.documentoSemItens[valor.geral.documentoSemItens]],
      ["Exigir parceiro", simNao(valor.geral.exigeParceiro)],
      ["Exigir centro de resultado", simNao(valor.geral.exigeCentroResultado)],
      ["Exigir observação", simNao(valor.geral.exigeObservacao)]
    ] },
    { chave: "estoque", itens: [
      ["Movimentação", ROTULOS_TOP.estoqueAtualizacao[valor.estoque.atualizacao]],
      ["Momento do efeito", ROTULOS_TOP.momentoEfeito[valor.estoque.momento]],
      ["Exigir armazém", simNao(valor.estoque.exigeArmazem)],
      ["Saldo negativo", ROTULOS_TOP.saldoNegativo[valor.estoque.saldoNegativo]]
    ] },
    { chave: "financeiro", itens: [
      ["Efeito financeiro", ROTULOS_TOP.financeiroAtualizacao[valor.financeiro.atualizacao]],
      ["Forma do lançamento", ROTULOS_TOP.financeiroModo[valor.financeiro.modo]],
      ["Momento do efeito", ROTULOS_TOP.momentoEfeito[valor.financeiro.momento]],
      ["Exigir forma de pagamento", simNao(valor.financeiro.exigeFormaPagamento)],
      ["Exigir vencimento", simNao(valor.financeiro.exigeVencimento)],
      ["Exigir centro de resultado", simNao(valor.financeiro.exigeCentroResultado)]
    ] },
    { chave: "fiscal", itens: [
      ["Relevante para o fiscal", simNao(valor.fiscal.habilitado)],
      ["Exigir documento fiscal", simNao(valor.fiscal.exigeDocumentoFiscal)],
      ["Exigir natureza da operação", simNao(valor.fiscal.exigeNaturezaOperacao)],
      ["Exigir regra tributária", simNao(valor.fiscal.exigeRegraTributaria)],
      ["Cálculo de tributos", ROTULOS_TOP.calculoTributario[valor.fiscal.calculoTributario]]
    ] },
    { chave: "aprovacao", itens: [
      ["Critério de aprovação", ROTULOS_TOP.aprovacaoPolitica[valor.aprovacao.politica]],
      ["Valor mínimo", valor.aprovacao.valorMinimo ?? "—"],
      ["Momento da aprovação", ROTULOS_TOP.momentoAprovacao[valor.aprovacao.momento]]
    ] }
  ];
  return <div className="grid gap-3 md:grid-cols-2" data-testid="top-versao-configuracao">
    {blocos.map((b) => <div key={b.chave} data-testid={`top-versao-secao-${b.chave}`}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ROTULOS_SECAO_TOP[b.chave]}</p>
      <dl className="text-[12px]">
        {b.itens.map(([rotulo, texto]) => <div key={rotulo} className="flex justify-between gap-2 border-b border-slate-100 py-0.5">
          <dt className="text-slate-500">{rotulo}</dt><dd className="text-slate-800">{texto}</dd>
        </div>)}
      </dl>
    </div>)}
  </div>;
}
