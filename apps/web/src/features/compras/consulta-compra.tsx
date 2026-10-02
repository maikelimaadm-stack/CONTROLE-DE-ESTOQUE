"use client";
import * as React from "react";
import { StatusBadge, statusTone } from "@/components/ui";
import { useTabTitle } from "@/lib/workspace-tabs";
import { useTradutor } from "@/lib/i18n";
import { LoadingOr } from "@/features/docs/shared";
import { CentralDeDocumento } from "@/features/central/moldura";
import { TEMPO_DO_SALVO_MS } from "@/features/central/salvo";
import type { PosicaoDoRotuloValor } from "@/features/central/barra";
import type { AbaDoPainel } from "@/features/central/contrato";
import type { VarianteDeCompra } from "./variantes";
import { PREFIXO_CENTRAL_COMPRAS } from "./central/adaptador";
import { useEstadoDaConsulta } from "./central/estado";
import { useBarraDaConsulta } from "./central/consulta-barra";
import { DadosDaConsulta, ItensDaConsulta, abasDaConsulta } from "./central/consulta-corpo";
import { DialogoConfirmarCompra } from "./central/dialogos-compra";
import { ConsultaDeOrcamento } from "./orcamento/consulta-orcamento";
import { abaDosOrcamentos } from "./orcamento/aba-orcamentos";

/**
 * CONSULTA DO DOCUMENTO DE COMPRA (COMPRAS-01..02; sobre o motor na VISUAL-UX-04, decisão 276): `/compras/<seg>/<id>`.
 * Só COMPOSIÇÃO: confirmar, cancelar (motivo opcional), encerrar saldo, Próximos passos e o "Salvo" vindo da criação
 * moram em `central/estado.ts`; barra, corpo e diálogos são as peças de `central/`.
 *
 * OPERACOES-01 F6b (decisão 283): um DESPACHANTE, sem hook — o orçamento de compra tem a consulta própria
 * (`orcamento/consulta-orcamento.tsx`); o pedido e a compra, a de hoje. No PEDIDO, a aba "Orçamentos"
 * (`orcamento/aba-orcamentos.tsx`) entra antes de "Observações" — só com a capacidade da API e o pedido que usa cotação.
 */
export function ConsultaDeCompra({ variante, id }: { variante: VarianteDeCompra; id: string }) {
  if (variante.variante === "orcamento") return <ConsultaDeOrcamento variante={variante} id={id} />;
  return <ConsultaDoPedidoEDaCompra variante={variante} id={id} />;
}

/** As abas da consulta com a dos Orçamentos ANTES de "Observações" (sem ela, a lista de hoje, idêntica). */
function comAbaDosOrcamentos(abas: AbaDoPainel[], aba: AbaDoPainel | null): AbaDoPainel[] {
  if (!aba) return abas;
  const i = abas.findIndex((a) => a.value === "observacoes");
  return i < 0 ? [...abas, aba] : [...abas.slice(0, i), aba, ...abas.slice(i)];
}

/** A consulta do pedido e da compra (o corpo de antes da F6b, com a aba dos Orçamentos no pedido). */
function ConsultaDoPedidoEDaCompra({ variante, id }: { variante: VarianteDeCompra; id: string }) {
  const tr = useTradutor();
  const e = useEstadoDaConsulta({ variante, id });
  const rotulo = tr(variante.chaveI18n);
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const [salvoVisivel, setSalvoVisivel] = React.useState(e.salvoAgora);
  React.useEffect(() => {
    if (!salvoVisivel) return;
    const t = window.setTimeout(() => setSalvoVisivel(false), TEMPO_DO_SALVO_MS);
    return () => window.clearTimeout(t);
  }, [salvoVisivel]);
  const barra = useBarraDaConsulta({ e, rotulo, densidade, onDensidade: setDensidade, salvoVisivel });
  const d = e.documento;
  useTabTitle(d ? e.titulo : null);

  if (!d) {
    if (e.q.isLoading) {
      return <CentralDeDocumento prefixoTestid={PREFIXO_CENTRAL_COMPRAS} carregando titulo={e.adaptador.textos.tituloDaLeituraPendente}
        identidade={{ nome: "Carregando documento", alterado: false }} acoes={null} dados={null} itens={null} abas={abasDaConsulta(e)} />;
    }
    return <LoadingOr q={e.q}>{null}</LoadingOr>;
  }
  const codigo = d["codigo"] ? String(d["codigo"]) : "";
  return <div data-testid="compras-consulta" className="contents">
    <div data-testid="compras-consulta-corpo" data-situacao={e.situacao} data-especie={variante.variante} className="contents">
      <CentralDeDocumento
        prefixoTestid={PREFIXO_CENTRAL_COMPRAS}
        titulo={e.titulo}
        identidade={{ nome: codigo || rotulo, codigo: Boolean(codigo), alterado: false, tom: statusTone(e.situacao, "situacao_documento_compra"), dica: rotulo,
          situacao: <StatusBadge domain="situacao_documento_compra" value={e.situacao} /> }}
        densidade={densidade}
        acoes={barra.acoes}
        acoesDireita={barra.direita}
        dados={<DadosDaConsulta e={e} />}
        itens={<ItensDaConsulta e={e} />}
        abas={comAbaDosOrcamentos(abasDaConsulta(e), abaDosOrcamentos(e, e.capacidade))}
      />
    </div>
    {barra.dialogos}
    {e.ehCompra && <DialogoConfirmarCompra id={id} aberto={e.confirmando} onFechar={() => e.setConfirmando(false)} codigo={codigo}
      carregando={e.confirmarOcupado} onConfirmar={e.confirmar} />}
  </div>;
}
