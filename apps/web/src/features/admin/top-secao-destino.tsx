"use client";
/**
 * OPERACOES-01 F5a (decisão 282) — a aba "Destino" do editor da TOP no formato 5 (seção `destino`).
 *
 * Uma escolha por dimensão do destino — centro de resultado, máquina/equipamento, ordem de serviço, lote de animais,
 * área/talhão e safra —, cada uma "Não usada", "Opcional" (o neutro desde a OPERACOES-01 F11, decisão 288: aceita o
 * destino como a baixa e a requisição antigas, nada é exigido) ou "Obrigatória". As
 * dimensões, os rótulos e as opções são do DOMÍNIO (`CAMPOS_DESTINO_ESTOQUE`, o dono da lista de dimensões;
 * `EXIGENCIAS_DESTINO_TOP` e `ROTULOS_EXIGENCIA_DESTINO_TOP`, os da seção): nenhuma lista nem rótulo é escrito aqui, e
 * a dimensão que o domínio acrescentar aparece sozinha (o tipo `SecaoDestinoTop` cobra a chave).
 *
 * O editor mostra esta aba quando o perfil do tipo a lista (`SECAO_DESTINO.usadaPor`: requisição, consumo e saída),
 * entrega o valor já lido, mostra a ajuda da definição e o erro da SEÇÃO inteira (`top-erro-destino`, a recusa do
 * tipo). Aqui ficam os erros de CAMPO (`destino.<dimensão>`), do domínio antes de enviar ou do 422 do servidor, logo
 * abaixo do campo (`top-erro-destino-<dimensão>`); um caminho `destino.<x>` que não é dimensão nenhuma (só com
 * servidor e domínio divergentes) aparece no fim, para a mensagem nunca sumir.
 */
import type * as React from "react";
import {
  CAMPOS_DESTINO_ESTOQUE, EXIGENCIAS_DESTINO_TOP, ROTULOS_EXIGENCIA_DESTINO_TOP,
  type DimensaoDestinoEstoque, type ExigenciaDestinoTop
} from "@agro/domain";
import { Field, NativeSelect } from "@/components/ui";
import type { PropsDaSecaoV5 } from "./top-secoes-formato5";

/** `centroCusto` → `centro-custo`: o pedaço do testid de cada dimensão (`top-campo-destino-centro-custo`). */
const emKebab = (chave: string): string => chave.replace(/[A-Z]/g, (letra) => `-${letra.toLowerCase()}`);

/** A opção escolhida, conferida contra a lista do domínio — valor fora dela (DOM adulterado) não muda nada. */
const exigenciaDaOpcao = (valor: string): ExigenciaDestinoTop | undefined => EXIGENCIAS_DESTINO_TOP.find((e) => e === valor);

export function AbaDestino({ valor, erros, onChange }: PropsDaSecaoV5<"destino">): React.ReactNode {
  const caminhos = new Set<string>(CAMPOS_DESTINO_ESTOQUE.map((c) => `destino.${c.chave}`));
  const outros = Object.entries(erros).filter(([caminho]) => caminho.startsWith("destino.") && !caminhos.has(caminho));
  const mudar = (chave: DimensaoDestinoEstoque, opcao: string) => {
    const exigencia = exigenciaDaOpcao(opcao);
    if (exigencia !== undefined) onChange({ ...valor, [chave]: exigencia });
  };
  return <div data-testid="top-secao-destino" className="grid grid-cols-12 gap-3">
    {CAMPOS_DESTINO_ESTOQUE.map((c) => {
      const kebab = emKebab(c.chave);
      const erro = erros[`destino.${c.chave}`];
      // O invólucro ocupa a coluna da grade e o `Field` o invólucro inteiro: o `Field` só liga o rótulo ao controle
      // quando o filho é único, e a mensagem de erro fica logo abaixo do campo (o molde de `CampoFiscal`).
      return <div key={c.chave} className="col-span-12 md:col-span-4">
        <Field label={c.rotulo} span={12}>
          <NativeSelect data-testid={`top-campo-destino-${kebab}`} value={valor[c.chave]} onChange={(e) => mudar(c.chave, e.target.value)}>
            {EXIGENCIAS_DESTINO_TOP.map((o) => <option key={o} value={o}>{ROTULOS_EXIGENCIA_DESTINO_TOP[o]}</option>)}
          </NativeSelect>
        </Field>
        {erro !== undefined && <p data-testid={`top-erro-destino-${kebab}`} role="alert" className="mt-0.5 text-[11.5px] text-red-700">{erro}</p>}
      </div>;
    })}
    {outros.map(([caminho, mensagem]) =>
      <p key={caminho} data-testid={`top-erro-${caminho}`} role="alert" className="col-span-12 text-[11.5px] text-red-700">{mensagem}</p>)}
  </div>;
}
