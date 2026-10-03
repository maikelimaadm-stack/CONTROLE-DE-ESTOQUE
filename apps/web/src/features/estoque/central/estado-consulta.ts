"use client";
import * as React from "react";
import { useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { RECURSO_DA_ESPECIE_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, type EspecieEstoque } from "@agro/domain";
import { D } from "@agro/shared";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { useTradutor } from "@/lib/i18n";
import { useDoc, type Row } from "@/features/docs/shared";
import type { AdaptadorDaCentral } from "@/features/central/contrato";
import { abreConfirmarNaChegada, confirmarPodeAbrir, consumirSalvo, descartarSalvo } from "@/features/central/salvo";
import type { VarianteDeEstoque } from "../movimentacoes-variantes";
import { errosDoServidor } from "../central-estoque-campos";
import { chaveDaPreviaEstoque } from "../previa-confirmacao-estoque";
import { adaptadorDaCentralDeEstoque, chaveDepoisDeSalvarDeEstoque, corpoDoCancelamento } from "./adaptador";
import type { DocumentoDeOrigem } from "./origem";

/**
 * O ESTADO DA CONSULTA NA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — sem JSX. O documento salvo, só leitura
 * (editar o documento aberto continua fora, como na ESTOQUE-01): as ações por botão — Confirmar (pela PRÉVIA), Cancelar
 * (motivo opcional), Encerrar saldo (a requisição atendida em parte), Atender requisição, Devolver itens, Duplicar — e o
 * "Salvo" vindo da criação. As peças (`consulta-barra.tsx`, `consulta-corpo.tsx`, `dialogos-estoque.tsx`) só desenham.
 *
 * `can()` só esconde: quem recusa é o servidor (confirmar, cancelar e encerrar pedem `<recurso>.edit`; atender e devolver
 * abrem a criação da outra espécie, que pede o `.create` dela).
 */

/** Um movimento do razão produzido pelo documento (o GET o devolve; estornos inclusive). */
export type MovimentoDoDocumento = Row;

/** Um documento citado (a origem; um vinculado — os consumos da requisição, as devoluções do consumo). */
export interface DocumentoCitado { id: string; codigo: string; especie: string; situacao: string; data_documento?: string }

/** O documento como `GET /api/estoque/<segmento>/:id` o devolve (números e datas como TEXTO). */
export type DocumentoDeEstoque = Omit<DocumentoDeOrigem, "itens"> & {
  observacao: string | null;
  armazem_destino_id: string | null;
  armazem_destino_nome: string | null;
  criado_por_nome: string | null;
  confirmado_em: string | null;
  confirmado_por_nome: string | null;
  cancelado_em: string | null;
  cancelado_por_nome: string | null;
  motivo_cancelamento: string | null;
  origem_documento_id: string | null;
  origem: DocumentoCitado | null;
  vinculados: DocumentoCitado[];
  motivo_saida: string | null;
  justificativa: string | null;
  saldo_encerrado_em: string | null;
  saldo_encerrado_por_nome: string | null;
  saldo_encerrado_motivo: string | null;
  tipo_operacao: { id: string; codigo: string; codigo_base: string | null; nome: string; versao: number | null } | null;
  itens: Row[];
  movimentos: MovimentoDoDocumento[];
};

export interface EstadoDaConsultaDeEstoque {
  variante: VarianteDeEstoque;
  adaptador: AdaptadorDaCentral;
  especie: EspecieEstoque;
  rotuloDaEspecie: string;
  id: string;
  porta: string;
  q: UseQueryResult<DocumentoDeEstoque>;
  documento: DocumentoDeEstoque | undefined;
  situacao: string;
  titulo: string;
  tipoOperacaoId: string;

  /* ações (can() só esconde; quem recusa é o servidor) */
  /** A pílula Confirmar aparece (quem pode confirmar a espécie). */
  mostrarConfirmar: boolean;
  /** O diálogo de Confirmar abre: documento aberto e quem pode confirmar (a regra única do motor). */
  podeConfirmar: boolean;
  podeCancelar: boolean;
  podeEncerrarSaldo: boolean;
  /** "Atender requisição": a rota da criação do consumo com a origem; `null` = a ação não aparece. */
  rotaDeAtender: string | null;
  /** "Devolver itens": a rota da criação da devolução de consumo com a origem; `null` = a ação não aparece. */
  rotaDeDevolver: string | null;
  podeVerHistorico: boolean;
  podeCriar: boolean;
  /** Duplicar: null = habilitado; texto = a dica do desabilitado. */
  dicaDuplicarDesabilitado: string | null;
  podeDuplicar: boolean;

  /* diálogos */
  confirmando: boolean; setConfirmando: (v: boolean) => void;
  cancelando: boolean; setCancelando: (v: boolean) => void;
  encerrando: boolean; setEncerrando: (v: boolean) => void;
  confirmar: () => void; confirmarOcupado: boolean;
  cancelar: (motivo: string) => void; cancelarOcupado: boolean;
  encerrar: (motivo: string) => void; encerrarOcupado: boolean;
  textoDoCancelamento: string;
  /** O 422 da última ação (confirmar ou cancelar), por caminho. */
  errosDaAcao: Readonly<Record<string, string>>;

  /* "Salvo ✓" entregue pela criação */
  salvoAgora: boolean;
}

export const DICA_DUPLICAR_COM_ORIGEM = "Documento que atende ou devolve outro não se duplica: lance de novo a partir da origem.";
export const DICA_DUPLICAR_SEM_TOP = "Documento sem Tipo de Operação não se duplica.";

/** Os atendimentos da requisição que ainda pedem consumo, e o que ainda pode ser encerrado. */
const ATENDIMENTOS_A_ATENDER: ReadonlySet<string> = new Set(["pendente", "parcial"]);

/** Um texto decimal do servidor, ou zero. */
const decimal = (v: unknown) => D(typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? v : "0");

/** A rota da criação de uma espécie com a origem (`?origem=<id>`): o lançador da espécie pergunta a TOP. */
const rotaDaCriacaoComOrigem = (especie: EspecieEstoque, origemId: string) =>
  `/estoque/movimentacoes/${SEGMENTO_DA_ESPECIE_ESTOQUE[especie]}/new?origem=${encodeURIComponent(origemId)}`;

export function useEstadoDaConsultaDeEstoque({ variante, id }: { variante: VarianteDeEstoque; id: string }): EstadoDaConsultaDeEstoque {
  const { can } = useAuth(); const tr = useTradutor(); const qc = useQueryClient();
  const especie = variante.variante as EspecieEstoque;
  const rotulo = tr(variante.chaveI18n);
  const adaptador = React.useMemo(() => adaptadorDaCentralDeEstoque(variante, rotulo), [variante, rotulo]);
  const porta = adaptador.rotas.porta(id);
  const q = useDoc<DocumentoDeEstoque>(porta);

  /* O "Salvo" e o pedido de Confirmar vindos da criação: lidos uma vez, da memória. O diálogo NÃO nasce aberto: o pedido
     só é atendido depois do documento carregado (efeito abaixo), com a mesma conferência da pílula. */
  const [salvo] = React.useState(() => consumirSalvo(chaveDepoisDeSalvarDeEstoque, id));
  React.useEffect(() => { if (salvo) descartarSalvo(chaveDepoisDeSalvarDeEstoque, id); }, [salvo, id]);
  const [confirmando, setConfirmando] = React.useState(false);
  const [cancelando, setCancelando] = React.useState(false);
  const [encerrando, setEncerrando] = React.useState(false);
  const [errosDaAcao, setErrosDaAcao] = React.useState<Record<string, string>>({});
  const chaveConfirmar = React.useRef(newIdem());
  const chaveCancelar = React.useRef(newIdem());
  const chaveEncerrar = React.useRef(newIdem());
  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["docone", porta] });
    void qc.invalidateQueries({ queryKey: chaveDaPreviaEstoque(variante.segmento, id) });
  };

  const confirmarM = useMutation({
    mutationFn: () => api(`${porta}/confirmar`, { method: "POST", idempotencyKey: chaveConfirmar.current }),
    // O saldo mudou: tudo o que o mostra (lista, saldo, razão) é perguntado de novo.
    onSuccess: () => { toast.success("Documento confirmado"); setConfirmando(false); setErrosDaAcao({}); void qc.invalidateQueries(); },
    onError: (e) => { chaveConfirmar.current = newIdem(); setConfirmando(false); setErrosDaAcao(errosDoServidor(e)); toast.error((e as Error).message); recarregar(); }
  });
  const cancelarM = useMutation({
    // Motivo vazio não viaja: o servidor grava o motivo padrão.
    mutationFn: (motivo: string) => api(`${porta}/cancelar`, { method: "POST", body: corpoDoCancelamento(motivo), idempotencyKey: chaveCancelar.current }),
    onSuccess: () => { toast.success("Documento cancelado"); setCancelando(false); setErrosDaAcao({}); void qc.invalidateQueries(); },
    onError: (e) => { chaveCancelar.current = newIdem(); setCancelando(false); setErrosDaAcao(errosDoServidor(e)); toast.error((e as Error).message); recarregar(); }
  });
  const encerrarM = useMutation({
    mutationFn: (motivo: string) => api(`${porta}/encerrar-saldo`, { method: "POST", body: { motivo }, idempotencyKey: chaveEncerrar.current }),
    onSuccess: () => { toast.success("Saldo encerrado"); setEncerrando(false); void qc.invalidateQueries(); },
    // 409 (não pendente, já encerrado, nunca atendida, sem saldo): a mensagem do servidor; o diálogo fica.
    onError: (e) => { chaveEncerrar.current = newIdem(); toast.error((e as Error).message); recarregar(); }
  });

  const d = q.data;
  const situacao = d?.situacao ?? "";
  const podeEditar = can(`${variante.perm}.edit`);
  /* O DIÁLOGO DE CONFIRMAR só abre em documento ABERTO e para quem pode confirmar — a regra ÚNICA do motor
     (`confirmarPodeAbrir`), para a pílula e para a chegada da criação. */
  const documentoAberto = situacao === "aberto";
  const podeConfirmar = confirmarPodeAbrir(documentoAberto, podeEditar);
  const pedidoDeConfirmarTratado = React.useRef(false);
  React.useEffect(() => {
    if (!d || pedidoDeConfirmarTratado.current) return;
    pedidoDeConfirmarTratado.current = true;
    if (abreConfirmarNaChegada(salvo, documentoAberto, podeEditar)) setConfirmando(true);
  }, [d, salvo, documentoAberto, podeEditar]);

  const confirmado = situacao === "confirmado";
  const atendimento = d?.atendimento ?? null;
  const ehRequisicao = especie === "requisicao";
  const ehConsumo = especie === "consumo";
  const rotaDeAtender = ehRequisicao && confirmado && atendimento !== null && ATENDIMENTOS_A_ATENDER.has(atendimento)
    && can(`${RECURSO_DA_ESPECIE_ESTOQUE.consumo}.create`) ? rotaDaCriacaoComOrigem("consumo", id) : null;
  const temADevolver = (d?.itens ?? []).some((it) => decimal(it["quantidade_devolvida"]).lt(decimal(it["quantidade"])));
  const rotaDeDevolver = ehConsumo && confirmado && temADevolver && can(`${RECURSO_DA_ESPECIE_ESTOQUE.devolucao_consumo}.create`)
    ? rotaDaCriacaoComOrigem("devolucao_consumo", id) : null;
  const podeEncerrarSaldo = ehRequisicao && confirmado && atendimento === "parcial" && podeEditar;

  const tipoOperacaoId = d?.tipo_operacao?.id ?? "";
  const comOrigem = Boolean(d?.origem_documento_id) || especie === "devolucao_consumo";
  const dicaDuplicarDesabilitado = comOrigem ? DICA_DUPLICAR_COM_ORIGEM : d && !tipoOperacaoId ? DICA_DUPLICAR_SEM_TOP : null;
  const podeCriar = can(`${variante.perm}.create`);

  return {
    variante, adaptador, especie, rotuloDaEspecie: rotulo, id, porta, q, documento: d, situacao,
    titulo: d ? `${rotulo} ${d.codigo || "—"}` : rotulo,
    tipoOperacaoId,
    mostrarConfirmar: podeEditar, podeConfirmar,
    podeCancelar: (documentoAberto || confirmado) && podeEditar,
    podeEncerrarSaldo, rotaDeAtender, rotaDeDevolver,
    podeVerHistorico: can("audit_logs.view"),
    podeCriar,
    dicaDuplicarDesabilitado,
    podeDuplicar: Boolean(d) && dicaDuplicarDesabilitado === null && podeCriar,
    confirmando, setConfirmando, cancelando, setCancelando, encerrando, setEncerrando,
    confirmar: () => confirmarM.mutate(), confirmarOcupado: confirmarM.isPending,
    cancelar: (motivo) => cancelarM.mutate(motivo), cancelarOcupado: cancelarM.isPending,
    encerrar: (motivo) => encerrarM.mutate(motivo), encerrarOcupado: encerrarM.isPending,
    textoDoCancelamento: confirmado
      ? "Os movimentos do documento são estornados e o saldo volta ao que era antes da confirmação. Se o que entrou já foi consumido, o cancelamento é recusado."
      : "O documento passa a cancelado e não pode mais ser confirmado. O saldo não muda.",
    errosDaAcao,
    salvoAgora: salvo !== null
  };
}
