"use client";
/**
 * TOP-CONFIG-05 — os campos fiscais do formato 3 (modelo, finalidade, natureza, CFOPs) + o aviso fixo de que a
 * emissão não existe. SÓ CONFIGURAÇÃO: nada aqui emite, calcula ou valida documento fiscal.
 *
 * Os componentes são os MESMOS das abas do editor (`Field`, `NativeSelect`, `Input`) e o componente devolve itens
 * de grade soltos (fragmento), para cair dentro da grade de 12 colunas da seção Fiscal sem layout novo.
 *
 * O sentido do CFOP (entrada/saída) vem da família da TOP pelo domínio (`sentidoCfopDaFamilia`); a tela só DIZ a
 * régua. Quem recusa é o domínio (`recusasFiscaisDaFamiliaTop`) e o servidor (422): as mensagens chegam por
 * `erros["fiscal.<campo>"]` e aparecem junto do campo.
 */
import * as React from "react";
import { Field, Input, NativeSelect } from "@/components/ui";
import {
  AVISO_FISCAL_SO_CONFIGURACAO, CAMPOS_CFOP, FINALIDADES_DOCUMENTO_FISCAL, MODELOS_DOCUMENTO_FISCAL,
  NATUREZA_OPERACAO_MAXIMO, sentidoCfopDaFamilia,
  type ConfiguracaoFiscalV3, type FinalidadeDocumentoFiscal, type ModeloDocumentoFiscal
} from "@agro/domain";

export interface PropsFiscalFormato3 {
  fiscal: ConfiguracaoFiscalV3;
  /** Família canônica da TOP (`vendas.pedido`…): decide o sentido imposto aos CFOPs. */
  familia: string;
  onChange: (f: ConfiguracaoFiscalV3) => void;
  desabilitado?: boolean;
  /** Erros por caminho (`fiscal.cfopDentroEstado` → mensagem), do domínio ou do 422 do servidor. */
  erros: Readonly<Record<string, string>>;
}

/**
 * Rótulos locais PT-BR: o registro de rótulos do domínio não tem estes enums e o editor de TOP traduz os seus
 * localmente (`ROTULOS_TOP`). Os VALORES vêm do domínio; aqui só a tradução, conferida por `satisfies`.
 * Exportados: o histórico de versões usa ESTES, para não haver uma segunda tradução.
 */
export const ROTULOS_MODELO_DOCUMENTO = {
  nenhum: "Nenhum",
  nfe: "NF-e",
  nfce: "NFC-e",
  nfse: "NFS-e"
} satisfies Record<ModeloDocumentoFiscal, string>;

export const ROTULOS_FINALIDADE_DOCUMENTO = {
  normal: "Normal",
  complementar: "Complementar",
  ajuste: "Ajuste",
  devolucao: "Devolução"
} satisfies Record<FinalidadeDocumentoFiscal, string>;

type CampoCfop = (typeof CAMPOS_CFOP)[number]["campo"];

const TESTID_CFOP: Record<CampoCfop, string> = {
  cfopDentroEstado: "top-fiscal-cfop-dentro",
  cfopForaEstado: "top-fiscal-cfop-fora",
  cfopExterior: "top-fiscal-cfop-exterior"
};

/** A régua do sentido dita em uma frase. Família sem sentido imposto → nenhuma frase (o domínio não impõe). */
function dicaDoSentido(familia: string): string | null {
  const sentido = sentidoCfopDaFamilia(familia);
  if (sentido === "saida") return "Esta operação é de saída: CFOP 5, 6 ou 7.";
  if (sentido === "entrada") return "Esta operação é de entrada: CFOP 1, 2 ou 3.";
  return null;
}

/**
 * Um `Field` com a mensagem de erro daquele caminho logo abaixo, com testid próprio (`top-erro-<caminho>`).
 * O invólucro ocupa a coluna da grade; o `Field` interno ocupa o invólucro inteiro. A mensagem usa as mesmas
 * classes da mensagem de erro do `Field`.
 */
function CampoFiscal({ rotulo, ajuda, caminho, erros, span = 4, children }: {
  rotulo: string; ajuda?: string; caminho: string; erros: Readonly<Record<string, string>>;
  span?: 4 | 6 | 12; children: React.ReactElement;
}) {
  const erro = erros[caminho];
  const coluna = span === 12 ? "md:col-span-12" : span === 6 ? "md:col-span-6" : "md:col-span-4";
  return <div className={`col-span-12 ${coluna}`}>
    <Field label={rotulo} help={ajuda} span={12}>{children}</Field>
    {erro && <p data-testid={`top-erro-${caminho}`} role="alert" className="mt-0.5 text-[11px] text-red-600">{erro}</p>}
  </div>;
}

export function FiscalFormato3({ fiscal, familia, onChange, desabilitado, erros }: PropsFiscalFormato3): React.ReactElement | null {
  // Fiscal desligado: o domínio zera estas chaves ao normalizar, então editar aqui seria editar o que não é gravado.
  // A mesma régua dos demais campos da aba (desabilitados com o fiscal desligado).
  const travado = !!desabilitado || !fiscal.habilitado;
  const mudar = (parcial: Partial<ConfiguracaoFiscalV3>) => onChange({ ...fiscal, ...parcial });
  const dica = dicaDoSentido(familia);

  return <>
    <CampoFiscal rotulo="Modelo do documento" caminho="fiscal.modeloDocumento" erros={erros}
      ajuda="Modelo da nota fiscal que esta operação usará quando a emissão existir.">
      <NativeSelect data-testid="top-fiscal-modelo" value={fiscal.modeloDocumento} disabled={travado}
        aria-invalid={erros["fiscal.modeloDocumento"] ? true : undefined}
        onChange={(e) => mudar({ modeloDocumento: e.target.value as ModeloDocumentoFiscal })}>
        {MODELOS_DOCUMENTO_FISCAL.map((m) => <option key={m} value={m}>{ROTULOS_MODELO_DOCUMENTO[m]}</option>)}
      </NativeSelect>
    </CampoFiscal>
    <CampoFiscal rotulo="Finalidade" caminho="fiscal.finalidade" erros={erros}
      ajuda="Finalidade da nota fiscal emitida por esta operação.">
      <NativeSelect data-testid="top-fiscal-finalidade" value={fiscal.finalidade} disabled={travado}
        aria-invalid={erros["fiscal.finalidade"] ? true : undefined}
        onChange={(e) => mudar({ finalidade: e.target.value as FinalidadeDocumentoFiscal })}>
        {FINALIDADES_DOCUMENTO_FISCAL.map((f) => <option key={f} value={f}>{ROTULOS_FINALIDADE_DOCUMENTO[f]}</option>)}
      </NativeSelect>
    </CampoFiscal>
    <CampoFiscal rotulo="Natureza da operação" caminho="fiscal.naturezaOperacao" erros={erros}
      ajuda={`Texto da natureza da operação na nota fiscal. Até ${NATUREZA_OPERACAO_MAXIMO} caracteres.`}>
      <Input data-testid="top-fiscal-natureza" value={fiscal.naturezaOperacao} disabled={travado}
        maxLength={NATUREZA_OPERACAO_MAXIMO} placeholder="Venda de produção do estabelecimento"
        aria-invalid={erros["fiscal.naturezaOperacao"] ? true : undefined}
        onChange={(e) => mudar({ naturezaOperacao: e.target.value })} />
    </CampoFiscal>
    {CAMPOS_CFOP.map((c) => {
      const caminho = `fiscal.${c.campo}`;
      return <CampoFiscal key={c.campo} rotulo={c.rotulo} caminho={caminho} erros={erros}
        ajuda="Quatro dígitos. Em branco quando esta operação não usa este CFOP.">
        <Input data-testid={TESTID_CFOP[c.campo]} value={fiscal[c.campo]} disabled={travado}
          inputMode="numeric" maxLength={4} placeholder={sentidoCfopDaFamilia(familia) === "entrada" ? `${c.entrada}000` : `${c.saida}000`}
          aria-invalid={erros[caminho] ? true : undefined}
          // Só dígitos, no máximo quatro: o que a FORMA do CFOP aceita. O sentido é conferido pelo domínio.
          onChange={(e) => mudar({ [c.campo]: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
      </CampoFiscal>;
    })}
    {dica && <p data-testid="top-fiscal-sentido-cfop" className="col-span-12 text-[11.5px] text-slate-500">{dica}</p>}
    <p data-testid="top-fiscal-aviso-emissao" className="col-span-12 text-[11.5px] text-slate-500">{AVISO_FISCAL_SO_CONFIGURACAO}</p>
  </>;
}
