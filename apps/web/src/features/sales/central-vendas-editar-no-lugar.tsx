"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "@/components/ui";
import type { Row } from "@/features/docs/shared";
import { DialogoConfirmar } from "@/features/central/dialogos";
import { ROTULO_SALVAR_E_CONFIRMAR } from "@/features/central/regras-gerais";
import { CentralVendasWorkspace, type AbaDoPainel } from "./central-vendas-workspace";
import { FormularioDaCentralDeVendas, useAberturaDaEdicaoDeVenda, type EstadoDaEdicaoDeVenda } from "./central-vendas-formulario";
import { portaDaEdicaoDeVenda } from "./central-vendas-edicao-api";
import { acaoEditarDaVenda, confirmarDoAvisoDesabilitado, type AcaoEditarDaVenda, type LeituraDaEdicaoNaConsulta } from "./central-vendas-editar";
import { PreviaNoDialogo } from "./central-vendas-dialogos";
import type { PosicaoDoRotuloValor } from "./central-vendas-barra";

/**
 * EDITAR-03 (decisão 315) — A EDIÇÃO DO DOCUMENTO DE VENDA A PARTIR DA CONSULTA, NO LUGAR (o molde da 313 em compras:
 * `consulta-compra.tsx` + `central-compras.tsx`). Sem rota nova e sem nada no `nav.registry`: a consulta
 * (`app/(app)/vendas/[kind]/[id]/page.tsx`) troca o próprio conteúdo pela MESMA Central de Vendas em modo edição — o
 * formulário da criação com `edicao` (`central-vendas-formulario.tsx`, o RAMO) — e volta a ser a consulta ao fechar.
 *
 *   a pílula     `useEditarNaConsultaDeVenda`: some sem `<variante>.edit`/`.view`; com as duas, a consulta PERGUNTA o
 *                `GET <base>/:id/edicao` e a pílula só habilita com `podeEditar: true` — o motivo de estar desabilitada é
 *                o do servidor (`acaoEditarDaVenda`, contas puras em `central-vendas-editar.ts`).
 *   a abertura   `EdicaoDaVendaNoLugar`: `GET :id` + `/edicao` com a guarda de versão (`useAberturaDaEdicaoDeVenda`, do
 *                estado); recusa ou leitura indisponível ⇒ volta à consulta com a pílula desabilitada pelo motivo.
 *   os diálogos  o conflito de versão (409: "Recarregar o documento" / "Continuar editando", nunca sobrescreve) e o AVISO
 *                do Salvar que confirma (o `DialogoConfirmar` da Central, rótulo "Salvar e confirmar", corpo = a prévia
 *                do servidor) — o render prop `renderDialogosDaEdicao` do formulário. Só o botão do aviso manda a PATCH.
 */

/**
 * LEITURA PENDENTE: as abas que TODA variante tem, sem conteúdo — estrutura da tela, não dado do documento. Os valores
 * são os das abas da consulta, para a aba escolhida continuar a mesma quando a leitura chega; "Documentos derivados" só
 * entra com o registro, porque depende da variante que só ele diz. (Movido da consulta: a abertura da edição mostra o
 * MESMO esqueleto enquanto lê.)
 */
export const ABAS_DA_LEITURA_PENDENTE: AbaDoPainel[] = [
  { value: "totais", label: "Totais", content: null },
  { value: "financeiro", label: "Financeiro", content: null },
  { value: "frete", label: "Frete e transporte", content: null },
  { value: "fiscal", label: "Fiscal", content: null },
  { value: "observacoes", label: "Observações", content: null }
];

/** A chave da pergunta da CONSULTA ao `/edicao` (a versão lida entra: documento relido com outra versão ⇒ pergunta nova). */
export const chaveDaEdicaoNaConsultaDeVenda = (segmento: string, id: string, versao: string) => ["sales-edicao-consulta", segmento, id, versao] as const;

/** Por que a abertura voltou à consulta: o `/edicao` recusou, ou uma das leituras não pôde abrir o formulário. */
export type RecusaDaAberturaDeVenda = "recusada" | "indisponivel";

export interface EditarNaConsultaDeVenda extends AcaoEditarDaVenda {
  /** O formulário de edição está aberto, no lugar da consulta. */
  editando: boolean;
  /** Abre a edição — só com a ação habilitada (a MESMA regra do `disabled`, conferida no handler). */
  abrir: () => void;
  /** Volta à consulta; `salvou` = a PATCH gravou (a consulta acende o "Salvo"). */
  fechar: (salvou: boolean) => void;
  /** A abertura não abriu: volta à consulta, e a pílula fica desabilitada com o motivo até a consulta perguntar de novo. */
  recusada: (motivo: string, tipo: RecusaDaAberturaDeVenda) => void;
}

/**
 * A AÇÃO "Editar" DA CONSULTA DE VENDA. `perm` e `segmento` são os da VARIANTE DO REGISTRO (o `DO_REGISTRO` da consulta);
 * sem eles (variante desconhecida) não há ação nem pergunta. A pergunta ao `/edicao` só sai com `.edit` E `.view` — sem
 * elas a pílula some e nenhum 403 é provocado. `onReler` relê o documento da consulta quando a abertura volta recusada.
 */
export function useEditarNaConsultaDeVenda({ id, documento, perm, segmento, onSalvou, onReler }: {
  id: string; documento: Row | null | undefined; perm: string | null; segmento: string | null;
  onSalvou: () => void; onReler: () => void;
}): EditarNaConsultaDeVenda {
  const { can } = useAuth(); const qc = useQueryClient();
  const [editando, setEditando] = React.useState(false);
  /* A recusa que a ABERTURA ouviu vale para a leitura do `/edicao` em que a pílula estava habilitada: relida a pergunta
     (o `invalidate` abaixo, outra ação, o documento relido), a resposta nova decide. */
  const [recusa, setRecusa] = React.useState<{ motivo: string; leitura: number } | null>(null);
  const capaz = Boolean(documento) && Boolean(perm) && Boolean(segmento) && can(`${perm}.edit`) && can(`${perm}.view`);
  const versao = documento ? String(documento["version"] ?? "") : "";
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveDaEdicaoNaConsultaDeVenda(segmento ?? "", id, versao),
    queryFn: () => api<unknown>(portaDaEdicaoDeVenda(segmento ?? "", id)),
    // 404 de rota é RESPOSTA (a API anterior), não falha transitória; com a edição aberta, a consulta não pergunta
    enabled: capaz && !editando, retry: false, staleTime: 0
  });
  const leitura: LeituraDaEdicaoNaConsulta = q.isError ? { situacao: "erro", erro: q.error }
    : q.data === undefined ? { situacao: "carregando" } : { situacao: "lida", corpo: q.data };
  const recusaVigente = recusa && recusa.leitura === q.dataUpdatedAt ? recusa.motivo : null;
  const acao = acaoEditarDaVenda({ can, perm, carregado: Boolean(documento), leitura, recusaDaAbertura: recusaVigente });
  return {
    ...acao, editando,
    abrir: () => { if (acao.visivel && acao.dicaDesabilitada === null) setEditando(true); },
    fechar: (salvou) => { setEditando(false); if (salvou) onSalvou(); },
    recusada: (motivo, tipo) => {
      if (tipo === "recusada") toast.warning(motivo); else toast.error(motivo);
      setRecusa({ motivo, leitura: q.dataUpdatedAt });
      setEditando(false);
      void qc.invalidateQueries({ queryKey: ["sales-edicao-consulta", segmento ?? "", id] });
      onReler();
    }
  };
}

/**
 * O conflito de versão e o aviso do Salvar que confirma, desenhados por cima do formulário em edição.
 *
 * CONFLITO (409 `CONCURRENCY_CONFLICT`): a mensagem do servidor e a OFERTA de recarregar — o rascunho só sai se a pessoa
 * aceitar; "Continuar editando" o mantém (a PATCH seguinte leva a mesma versão e volta a 409). Nada é sobrescrito.
 *
 * AVISO (A0, "avisar_antes"): a versão congelada desta venda confirma ao salvar. O diálogo de confirmação que a Central JÁ
 * tem (`DialogoConfirmar`: "Salvar e confirmar <código>?", Voltar / Salvar e confirmar) com o corpo da prévia do servidor
 * (`PreviaNoDialogo` com `naEdicao`). "Voltar" não manda nada; só o botão do diálogo manda a PATCH (`confirmarAviso`).
 */
function DialogosDaEdicaoDeVenda({ e }: { e: EstadoDaEdicaoDeVenda }) {
  const aviso = e.aviso;
  return <>
    <ConfirmDialog open={e.conflito !== null} onOpenChange={(aberto) => { if (!aberto) e.continuarEditando(); }} title="O documento mudou"
      confirmLabel="Recarregar o documento" dismissLabel="Continuar editando" onConfirm={e.recarregar}>
      <p data-testid="vendas-edicao-conflito" className="text-sm text-slate-600">{e.conflito}</p>
    </ConfirmDialog>
    <DialogoConfirmar aberto={aviso !== null} onFechar={e.cancelarAviso} rotulo={aviso?.rotulo ?? ROTULO_SALVAR_E_CONFIRMAR} codigo={aviso?.codigo ?? e.codigo}
      carregando={e.salvando} confirmarDesabilitado={aviso === null || confirmarDoAvisoDesabilitado(aviso.previa)} onConfirmar={e.confirmarAviso}>
      {aviso && <PreviaNoDialogo estado={aviso.previa} naEdicao={{ numerosDaPreviaValem: aviso.numerosDaPreviaValem }} />}
    </DialogoConfirmar>
  </>;
}

/**
 * A EDIÇÃO NO LUGAR DA CONSULTA: enquanto a abertura lê (`GET :id` + `/edicao`, mesma versão), o esqueleto da Central; pronta,
 * o formulário da Central de Vendas em modo edição, com a posição do rótulo da consulta e os diálogos da edição. Recusa ou
 * leitura indisponível ⇒ `onRecusada` (uma vez), e a consulta volta.
 */
export function EdicaoDaVendaNoLugar({ segmento, id, densidade, onDensidade, onFechar, onRecusada }: {
  segmento: string; id: string; densidade: PosicaoDoRotuloValor; onDensidade: (v: PosicaoDoRotuloValor) => void;
  onFechar: (salvou: boolean) => void; onRecusada: (motivo: string, tipo: RecusaDaAberturaDeVenda) => void;
}) {
  const abertura = useAberturaDaEdicaoDeVenda(segmento, id, onFechar);
  const motivo = abertura.situacao === "recusada" ? abertura.motivo : abertura.situacao === "indisponivel" ? abertura.mensagem : null;
  const tipo: RecusaDaAberturaDeVenda | null = abertura.situacao === "recusada" ? "recusada" : abertura.situacao === "indisponivel" ? "indisponivel" : null;
  const aoRecusar = React.useRef(onRecusada);
  React.useEffect(() => { aoRecusar.current = onRecusada; }, [onRecusada]);
  const tratada = React.useRef(false);
  React.useEffect(() => {
    if (motivo === null || tipo === null || tratada.current) return;
    tratada.current = true;
    aoRecusar.current(motivo, tipo);
  }, [motivo, tipo]);
  if (abertura.situacao !== "pronta") {
    return <CentralVendasWorkspace carregando titulo="Documento de venda" identidade={{ nome: "Carregando documento", alterado: false }} acoes={null} dados={null} itens={null} abas={ABAS_DA_LEITURA_PENDENTE} />;
  }
  return <FormularioDaCentralDeVendas key={abertura.chave} {...abertura.props} densidade={densidade} onDensidade={onDensidade}
    renderDialogosDaEdicao={(e) => <DialogosDaEdicaoDeVenda e={e} />} />;
}
