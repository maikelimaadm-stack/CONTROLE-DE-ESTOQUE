"use client";
import * as React from "react";
import { ConfirmDialog, StatusBadge, statusTone } from "@/components/ui";
import { useTabTitle } from "@/lib/workspace-tabs";
import { LoadingOr } from "@/features/docs/shared";
import { CentralDeDocumento, type ControleDaCentral } from "@/features/central/moldura";
import { TEMPO_DO_SALVO_MS } from "@/features/central/salvo";
import type { Pendencia, PosicaoDoRotuloValor } from "@/features/central/barra";
import { LancadorDeTipoOperacao, pedidoImpossivel } from "@/features/sales/lancador-tipo-operacao";
import type { VarianteDeEstoque } from "./movimentacoes-variantes";
import { PREFIXO_CENTRAL_ESTOQUE } from "./central/adaptador";
import { useEntradaDaCentralDeEstoque, useEstadoDaCriacaoDeEstoque, type PropsDoEstadoDaCriacao } from "./central/estado-criacao";
import { useEstadoDaConsultaDeEstoque } from "./central/estado-consulta";
import { irParaPendenciaDoEstoque, useBarraDaCriacao } from "./central/criacao-barra";
import { AvisosDaCriacao, DadosDaCriacao, identidadeDaCriacao } from "./central/criacao-dados";
import { ItensDaCriacaoDeEstoque } from "./central/criacao-itens";
import { abaDoCampoNoPainel, abasDoPainelDaCriacao } from "./central/criacao-painel";
import { useBarraDaConsulta } from "./central/consulta-barra";
import { DadosDaConsulta, ItensDaConsulta, abasDaConsulta } from "./central/consulta-corpo";
import { DialogoDaPrevia } from "./central/dialogos-estoque";

/**
 * A CENTRAL DE ESTOQUE — lançar, consultar, confirmar e cancelar o DOCUMENTO DE ESTOQUE (ESTOQUE-01, decisão 274), no
 * MOTOR da Central desde a OPERACOES-01 F5b (decisão 282), com o desenho das Centrais de Vendas e de Compras: barra,
 * leque, pílulas, painel com abas e documentos abertos; Novo documento por TOP, Duplicar, Histórico e Imprimir; os itens
 * em Grade, Formulário e Ambos; Configurar colunas e layout por TOP.
 *
 * Só COMPOSIÇÃO. A lógica mora em `central/estado-criacao.ts` (a TOP da URL como pedido, a trava da sessão, o layout, as
 * regras, a origem, o destino, o corpo do POST, as pendências, o "alterado") e em `central/estado-consulta.ts` (as
 * ações do documento salvo); as peças de `central/` só desenham.
 *
 * As SETE espécies quando a API declara `movimentacaoInterna` (as quatro de antes sem ela — a API de antes, no skew
 * sentido 1, recebe o corpo de antes). O invólucro leva o contrato dos testes de antes: `estoque-central` com
 * `data-especie`, `data-modo` ("criacao" | "consulta") e, na consulta, `data-situacao`.
 */
export function CentralEstoque({ variante, id }: { variante: VarianteDeEstoque; id?: string }) {
  return id ? <ConsultaDeEstoque variante={variante} id={id} /> : <CriacaoDeEstoque variante={variante} />;
}

/* ═══════════════════════════════ CRIAÇÃO ═══════════════════════════════ */

/** Sem TOP efetiva, o lançador (tela normal, com a trilha); com ela, a moldura do motor. */
function CriacaoDeEstoque({ variante }: { variante: VarianteDeEstoque }) {
  const entrada = useEntradaDaCentralDeEstoque(variante);
  if (entrada.formulario) return <FormularioDeEstoque key={entrada.formulario.chave} {...entrada.formulario.props} />;
  return <LancadorDeTipoOperacao
    estado={entrada.estado}
    titulo={`Novo documento · ${entrada.rotuloDaEspecie}`}
    indisponivel={pedidoImpossivel(entrada.estado, entrada.pedidaNaUrl)}
    onCancelar={entrada.voltarALista}
    onContinuar={entrada.escolherTop}
  />;
}

function FormularioDeEstoque(props: PropsDoEstadoDaCriacao) {
  const e = useEstadoDaCriacaoDeEstoque(props);
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const controle = React.useRef<ControleDaCentral | null>(null);
  /** Pendência no painel: abre a aba primeiro, depois leva ao campo. */
  const irPara = (p: Pendencia) => {
    const aba = abaDoCampoNoPainel(e, p.caminho);
    if (aba && controle.current) { controle.current.abrirAba(aba); window.setTimeout(() => irParaPendenciaDoEstoque(p), 0); return; }
    irParaPendenciaDoEstoque(p);
  };
  const barra = useBarraDaCriacao({ e, densidade, onDensidade: setDensidade, onIr: irPara });

  return <div data-testid="estoque-central" data-especie={e.especie} data-modo="criacao" className="contents">
    <CentralDeDocumento
      prefixoTestid={PREFIXO_CENTRAL_ESTOQUE}
      titulo={e.titulo}
      identidade={identidadeDaCriacao(e)}
      densidade={densidade}
      controle={controle}
      acoes={barra.acoes}
      acoesDireita={barra.direita}
      aviso={<AvisosDaCriacao e={e} />}
      dados={<DadosDaCriacao e={e} />}
      itens={<ItensDaCriacaoDeEstoque e={e} />}
      abas={abasDoPainelDaCriacao(e)}
    />
    {barra.dialogos}
    {/* Trocar a operação descarta o que foi digitado — então pergunta antes. */}
    <ConfirmDialog open={e.confirmarTroca} onOpenChange={e.setConfirmarTroca} title="Alterar o Tipo de Operação?"
      description="Os dados já preenchidos neste lançamento serão descartados." danger
      onConfirm={() => { e.setConfirmarTroca(false); e.voltarAoLancador(); }} />
  </div>;
}

/* ═══════════════════════════════ CONSULTA ═══════════════════════════════ */

function ConsultaDeEstoque({ variante, id }: { variante: VarianteDeEstoque; id: string }) {
  const e = useEstadoDaConsultaDeEstoque({ variante, id });
  const [densidade, setDensidade] = React.useState<PosicaoDoRotuloValor>("rotulo-a-frente");
  const [salvoVisivel, setSalvoVisivel] = React.useState(e.salvoAgora);
  React.useEffect(() => {
    if (!salvoVisivel) return;
    const t = window.setTimeout(() => setSalvoVisivel(false), TEMPO_DO_SALVO_MS);
    return () => window.clearTimeout(t);
  }, [salvoVisivel]);
  const barra = useBarraDaConsulta({ e, densidade, onDensidade: setDensidade, salvoVisivel });
  const d = e.documento;
  useTabTitle(d ? e.titulo : null);

  if (!d) {
    if (e.q.isLoading) {
      return <CentralDeDocumento prefixoTestid={PREFIXO_CENTRAL_ESTOQUE} carregando titulo={e.adaptador.textos.tituloDaLeituraPendente}
        identidade={{ nome: "Carregando documento", alterado: false }} acoes={null} dados={null} itens={null} abas={abasDaConsulta(e)} />;
    }
    return <LoadingOr q={e.q}>{null}</LoadingOr>;
  }
  // A raiz leva o contrato do teste e CONTÉM dados, itens e painel (os diálogos são portais, fora dela).
  return <div data-testid="estoque-central" data-especie={e.especie} data-modo="consulta" data-situacao={e.situacao} className="contents">
    <CentralDeDocumento
      prefixoTestid={PREFIXO_CENTRAL_ESTOQUE}
      titulo={e.titulo}
      identidade={{ nome: d.codigo || e.rotuloDaEspecie, codigo: Boolean(d.codigo), alterado: false, tom: statusTone(e.situacao, "situacao_documento_estoque"),
        dica: e.rotuloDaEspecie, situacao: <StatusBadge domain="situacao_documento_estoque" value={e.situacao} /> }}
      densidade={densidade}
      acoes={barra.acoes}
      acoesDireita={barra.direita}
      dados={<DadosDaConsulta e={e} />}
      itens={<ItensDaConsulta e={e} />}
      abas={abasDaConsulta(e)}
    />
    {barra.dialogos}
    <DialogoDaPrevia segmento={variante.segmento} id={id} especie={e.especie} aberto={e.confirmando} onAberto={e.setConfirmando}
      ocupado={e.confirmarOcupado} onConfirmar={e.confirmar} />
  </div>;
}
