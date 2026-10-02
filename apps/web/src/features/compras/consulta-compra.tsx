"use client";
import * as React from "react";
import { StatusBadge, statusTone } from "@/components/ui";
import { useTabTitle } from "@/lib/workspace-tabs";
import { useTradutor } from "@/lib/i18n";
import { LoadingOr } from "@/features/docs/shared";
import { CentralDeDocumento } from "@/features/central/moldura";
import { TEMPO_DO_SALVO_MS } from "@/features/central/salvo";
import type { PosicaoDoRotuloValor } from "@/features/central/barra";
import type { VarianteDeCompra } from "./variantes";
import { PREFIXO_CENTRAL_COMPRAS } from "./central/adaptador";
import { useEstadoDaConsulta } from "./central/estado";
import { useBarraDaConsulta } from "./central/consulta-barra";
import { DadosDaConsulta, ItensDaConsulta, abasDaConsulta } from "./central/consulta-corpo";
import { DialogoConfirmarCompra } from "./central/dialogos-compra";

/**
 * CONSULTA DO DOCUMENTO DE COMPRA (COMPRAS-01..02; sobre o motor na VISUAL-UX-04, decisão 276): `/compras/<seg>/<id>`.
 * Só COMPOSIÇÃO: confirmar, cancelar (motivo opcional), encerrar saldo, Próximos passos e o "Salvo" vindo da criação
 * moram em `central/estado.ts`; barra, corpo e diálogos são as peças de `central/`.
 */
export function ConsultaDeCompra({ variante, id }: { variante: VarianteDeCompra; id: string }) {
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
        abas={abasDaConsulta(e)}
      />
    </div>
    {barra.dialogos}
    {e.ehCompra && <DialogoConfirmarCompra id={id} aberto={e.confirmando} onFechar={() => e.setConfirmando(false)} codigo={codigo}
      carregando={e.confirmarOcupado} onConfirmar={e.confirmar} />}
  </div>;
}
