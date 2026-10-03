"use client";
import * as React from "react";
import { CAMPOS_DESTINO_ESTOQUE, LIMITE_JUSTIFICATIVA_SAIDA, MOTIVOS_SAIDA_ESTOQUE } from "@agro/domain";
import { enumLabel } from "@/lib/copy";
import { NativeSelect, Textarea } from "@/components/ui";
import { CampoDaCentral } from "@/features/central/campo";
import { PainelColuna, PainelLargo } from "@/features/central/painel";
import type { AbaDoPainel } from "@/features/central/contrato";
import { AbaDoDestino } from "./destino";
import type { EstadoDaCriacaoDeEstoque } from "./estado-criacao";

/**
 * CENTRAL DE ESTOQUE — O PAINEL INFERIOR DA CRIAÇÃO (OPERACOES-01 F5b, decisão 282). A moldura do motor desenha a faixa
 * das abas; daqui sai só a lista (`AbaDoPainel[]`), nesta ordem:
 *   1. Destino (`destino`) — só com a capacidade da movimentação interna, as regras da TOP lidas, a espécie cujo destino
 *      se informa e ao menos uma dimensão usada (ou herdada da requisição de origem);
 *   2. Motivo da saída (`motivo`) — só na saída com a capacidade: o motivo (os 13 do domínio, na ordem dele) e a
 *      justificativa, os dois com "*";
 *   3. Observações (`observacoes`) — a observação, com "*" quando a TOP a exige.
 * Nada aqui decide valor, obrigatoriedade, erro ou corpo: tudo vem de `useEstadoDaCriacaoDeEstoque`.
 */

const COLUNAS_DO_DESTINO: ReadonlySet<string> = new Set(CAMPOS_DESTINO_ESTOQUE.map((c) => c.coluna));
const CAMPOS_DO_MOTIVO: ReadonlySet<string> = new Set(["motivo_saida", "justificativa"]);

/** O valor da aba do painel em que o campo mora (para a pendência levar ao campo). `null` = não está no painel. */
export function abaDoCampoNoPainel(e: EstadoDaCriacaoDeEstoque, campo: string): string | null {
  if (COLUNAS_DO_DESTINO.has(campo) && e.dimensoesDoDestino.length > 0) return "destino";
  if (CAMPOS_DO_MOTIVO.has(campo) && e.forma.motivoDaSaida) return "motivo";
  if (campo === "observacao") return "observacoes";
  return null;
}

export function abasDoPainelDaCriacao(e: EstadoDaCriacaoDeEstoque): AbaDoPainel[] {
  const h = e.cabecalho;
  const abas: AbaDoPainel[] = [];
  if (e.dimensoesDoDestino.length > 0) {
    abas.push({
      value: "destino", label: "Destino", erro: e.dimensoesDoDestino.some((d) => Boolean(e.erro(d.campo.coluna))),
      content: <AbaDoDestino segmento={e.variante.segmento} empresaId={h.empresa_id} dimensoes={e.dimensoesDoDestino} erro={e.erro} onEscolher={e.escolherDestino} />
    });
  }
  if (e.forma.motivoDaSaida) {
    abas.push({
      value: "motivo", label: "Motivo da saída", erro: Boolean(e.erro("motivo_saida") || e.erro("justificativa")),
      content: <div data-testid="estoque-central-motivo-saida"><PainelColuna>
        <CampoDaCentral rotulo="Motivo" obrigatorio={e.obrigatorio("motivo_saida")} erro={e.erro("motivo_saida")} icone="selecao" preenchido={Boolean(h.motivo_saida)} data-campo="motivo_saida">
          <NativeSelect data-testid="estoque-central-motivo-saida-campo" value={h.motivo_saida} onChange={(ev) => e.mudar({ motivo_saida: ev.target.value })}>
            <option value="">Selecione</option>
            {MOTIVOS_SAIDA_ESTOQUE.map((m) => <option key={m} value={m}>{enumLabel("writeoff_reason", m)}</option>)}
          </NativeSelect>
        </CampoDaCentral>
        <CampoDaCentral rotulo="Justificativa" obrigatorio={e.obrigatorio("justificativa")} erro={e.erro("justificativa")} preenchido={Boolean(h.justificativa)} multilinha data-campo="justificativa">
          <Textarea data-testid="estoque-central-justificativa" maxLength={LIMITE_JUSTIFICATIVA_SAIDA} value={h.justificativa} onChange={(ev) => e.mudar({ justificativa: ev.target.value })} />
        </CampoDaCentral>
      </PainelColuna></div>
    });
  }
  const observacao = <CampoDaCentral rotulo={e.rotuloDoCampo("observacao")} obrigatorio={e.obrigatorio("observacao")} erro={e.erro("observacao")} preenchido={Boolean(h.observacao)} multilinha
    data-campo="observacao">
    <Textarea data-testid="estoque-central-observacao" value={h.observacao} onChange={(ev) => e.mudar({ observacao: ev.target.value })} />
  </CampoDaCentral>;
  abas.push({
    value: "observacoes", label: "Observações", erro: Boolean(e.erro("observacao")),
    content: <PainelLargo>
      {/* não editável no layout, com o valor padrão dele: travado, mostrando o valor */}
      {e.travadoPeloLayout("observacao") ? <fieldset disabled data-editavel="false" style={{ display: "contents" }}>{observacao}</fieldset> : observacao}
    </PainelLargo>
  });
  return abas;
}
