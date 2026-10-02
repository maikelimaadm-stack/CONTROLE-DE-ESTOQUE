"use client";
/**
 * OPERACOES-01 F5a (decisão 282) — a aba "Fluxo" do editor da TOP no formato 5 (seção `fluxo`), só do CONSUMO.
 *
 * Dois campos:
 *   · "Exigir requisição" — Não (o neutro: o consumo pode ser lançado direto, como hoje), Em algum item ou Em todos os
 *     itens. As opções e os rótulos são do domínio (`EXIGENCIAS_REQUISICAO_TOP`, `ROTULOS_EXIGENCIA_REQUISICAO_TOP`);
 *   · "Atender requisição em parte" — Sim (o neutro) ou Não.
 * Os dois rótulos de campo são os mesmos das `linhas` da definição (`SECAO_FLUXO`), as do histórico.
 *
 * O editor mostra esta aba quando o perfil do tipo a lista (`SECAO_FLUXO.usadaPor`: só o consumo), entrega o valor já
 * lido, mostra a ajuda da definição e o erro da SEÇÃO inteira (`top-erro-fluxo`, a recusa do tipo). Aqui ficam os
 * erros de CAMPO (`fluxo.<campo>`) logo abaixo do campo (`top-erro-fluxo-exige-requisicao`,
 * `top-erro-fluxo-permite-parcial`); um caminho `fluxo.<x>` que não é campo nenhum aparece no fim, para a mensagem
 * nunca sumir.
 */
import type * as React from "react";
import { EXIGENCIAS_REQUISICAO_TOP, ROTULOS_EXIGENCIA_REQUISICAO_TOP, type SecaoFluxoTop } from "@agro/domain";
import { Field, NativeSelect } from "@/components/ui";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/** Cada campo da seção: a chave (o caminho do erro é `fluxo.<chave>`) e o pedaço do testid. */
const CAMPO_EXIGE = { chave: "exigeRequisicao", testid: "exige-requisicao" } as const satisfies { chave: keyof SecaoFluxoTop; testid: string };
const CAMPO_PARCIAL = { chave: "permiteParcial", testid: "permite-parcial" } as const satisfies { chave: keyof SecaoFluxoTop; testid: string };

/** O campo com a mensagem de erro do caminho logo abaixo (o molde de `CampoFiscal`). */
function CampoDoFluxo({ rotulo, testid, erro, children }: { rotulo: string; testid: string; erro: string | undefined; children: React.ReactElement }) {
  return <div className="col-span-12 md:col-span-6">
    <Field label={rotulo} span={12}>{children}</Field>
    {erro !== undefined && <p data-testid={`top-erro-fluxo-${testid}`} role="alert" className="mt-0.5 text-[11.5px] text-red-700">{erro}</p>}
  </div>;
}

export function AbaFluxo({ valor, erros, onChange }: PropsDaSecaoV5<"fluxo">): React.ReactNode {
  const caminhos = new Set<string>([`fluxo.${CAMPO_EXIGE.chave}`, `fluxo.${CAMPO_PARCIAL.chave}`]);
  const outros = Object.entries(erros).filter(([caminho]) => caminho.startsWith("fluxo.") && !caminhos.has(caminho));
  const mudarExigencia = (opcao: string) => {
    // Conferida contra a lista do domínio: um valor fora dela (DOM adulterado) não muda nada.
    const exigeRequisicao = EXIGENCIAS_REQUISICAO_TOP.find((e) => e === opcao);
    if (exigeRequisicao !== undefined) onChange({ ...valor, exigeRequisicao });
  };
  return <div data-testid="top-secao-fluxo" className="grid grid-cols-12 gap-3">
    <CampoDoFluxo rotulo="Exigir requisição" testid={CAMPO_EXIGE.testid} erro={erros[`fluxo.${CAMPO_EXIGE.chave}`]}>
      <NativeSelect data-testid={`top-campo-fluxo-${CAMPO_EXIGE.testid}`} value={valor.exigeRequisicao} onChange={(e) => mudarExigencia(e.target.value)}>
        {EXIGENCIAS_REQUISICAO_TOP.map((o) => <option key={o} value={o}>{ROTULOS_EXIGENCIA_REQUISICAO_TOP[o]}</option>)}
      </NativeSelect>
    </CampoDoFluxo>
    <CampoDoFluxo rotulo="Atender requisição em parte" testid={CAMPO_PARCIAL.testid} erro={erros[`fluxo.${CAMPO_PARCIAL.chave}`]}>
      <NativeSelect data-testid={`top-campo-fluxo-${CAMPO_PARCIAL.testid}`} value={valor.permiteParcial ? "true" : "false"}
        onChange={(e) => onChange({ ...valor, permiteParcial: e.target.value === "true" })}>
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </NativeSelect>
    </CampoDoFluxo>
    {outros.map(([caminho, mensagem]) =>
      <p key={caminho} data-testid={`top-erro-${caminho}`} role="alert" className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
  </div>;
}
