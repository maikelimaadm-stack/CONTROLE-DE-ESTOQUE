"use client";
import * as React from "react";
import { Field } from "@/components/ui";
import { RefSelect, type Option } from "@/components/ui/ref-select";
import { perfilDosPadroesFinanceiros, type CampoPadraoFinanceiro, type PerfilDosPadroesFinanceiros } from "@agro/domain";
import { CHAVE_DO_PADRAO_NO_CORPO, type CampoDosPadroesEmEdicao, type PadroesFinanceirosEmEdicao } from "./top-contrato";

/**
 * OS PADRÕES DO LANÇAMENTO FINANCEIRO DA TOP (OPERACOES-01 F9, decisão 286) — natureza, centro de resultado, tipo de
 * título, forma de pagamento e conta, que moram na TABELA da versão (`erp.tipos_operacao_versao_financeiro`, 0045) e
 * não no JSON da configuração. O editor os põe embaixo da aba "Padrões financeiros", só com o editor do formato 5 e a
 * capacidade `padroesFinanceiros` declarada pelo servidor.
 *
 * SÓ OS CAMPOS QUE A FAMÍLIA USA (o perfil do domínio, `perfilDosPadroesFinanceiros`): o título avulso não tem forma de
 * pagamento; o movimento bancário não tem tipo de título nem forma. O seletor é o de sempre (`RefSelect`, busca no
 * servidor), recortado aos analíticos onde o lançamento os exige — é apresentação: quem recusa a natureza do tipo
 * errado, inativa, sintética ou de outra organização é o servidor, com a mensagem do campo, que aparece embaixo dele.
 */

interface DefinicaoDoCampo {
  recurso: string;
  rotulo: string;
  testId: string;
  /** O recorte da lista (o `/options` filtra por igualdade): só analíticos onde o lançamento exige. */
  filtro?: Record<string, string>;
}

const DEFINICOES: Readonly<Record<CampoPadraoFinanceiro, DefinicaoDoCampo>> = {
  natureza: { recurso: "financial_categories", rotulo: "Natureza padrão", testId: "top-campo-padrao-natureza", filtro: { kind: "analytic" } },
  centro: { recurso: "cost_centers", rotulo: "Centro de resultado padrão", testId: "top-campo-padrao-centro", filtro: { kind: "analytic" } },
  tipoTitulo: { recurso: "title_types", rotulo: "Tipo de título padrão", testId: "top-campo-padrao-tipo-titulo" },
  formaPagamento: { recurso: "payment_methods", rotulo: "Forma de pagamento padrão", testId: "top-campo-padrao-forma" },
  conta: { recurso: "bank_accounts", rotulo: "Conta padrão", testId: "top-campo-padrao-conta" }
};

const TITULO = "Padrões do lançamento";
const AJUDA = "Vazio: o documento decide.";
/**
 * A forma de pagamento padrão ainda NÃO é preenchida no documento (nem pelo servidor nem pela Central de Vendas): ela
 * só CONFERE — com a troca desligada, o documento com outra forma é recusado. A ajuda diz isso no campo, para ninguém
 * esperar um preenchimento que não acontece.
 */
const AJUDA_DA_FORMA = "Ainda não é preenchida no documento: só confere. Com “O documento pode trocar os padrões” desmarcado, o documento com outra forma é recusado.";

/** A ajuda da natureza pelo tipo que a família aceita (a receita na venda, a despesa na conta a pagar…). */
function ajudaDaNatureza(perfil: PerfilDosPadroesFinanceiros): string {
  const aceita = new Set(perfil.naturezas);
  if (aceita.has("income") && aceita.has("expense")) return "Uma natureza analítica e ativa.";
  if (aceita.has("income")) return "Uma natureza analítica e ativa de receita (ou de receita e despesa).";
  return "Uma natureza analítica e ativa de despesa (ou de receita e despesa).";
}

export function PadroesFinanceirosDaTop({ familia, valor, onChange, erros, desabilitado = false }: {
  /** A família da TOP (`codigoBase`): decide os campos. Nunca autoriza nada. */
  familia: string;
  valor: PadroesFinanceirosEmEdicao;
  /** Os padrões NOVOS inteiros (o campo mexido trocado). */
  onChange: (v: PadroesFinanceirosEmEdicao) => void;
  /** Os erros de campo (caminho → mensagem): os daqui são `padroesFinanceiros` e `padroesFinanceiros.<chave>`. */
  erros: Readonly<Record<string, string>>;
  desabilitado?: boolean;
}): React.ReactNode {
  const perfil = perfilDosPadroesFinanceiros(familia);
  if (!perfil) return null;
  const caminho = (campo: CampoDosPadroesEmEdicao) => `padroesFinanceiros.${CHAVE_DO_PADRAO_NO_CORPO[campo]}`;
  const mostrados = new Set<string>(perfil.campos);
  // Um padrão gravado num campo que a família não usa (só com servidor e tela divergentes) continua visível para poder
  // ser LIMPO — escondê-lo o mandaria de volta no corpo sem ninguém ver, e o servidor recusaria (422 no campo).
  const campos = (Object.keys(CHAVE_DO_PADRAO_NO_CORPO) as CampoDosPadroesEmEdicao[])
    .filter((c) => mostrados.has(c) || valor[c] !== null);
  const geral = erros["padroesFinanceiros"];

  return <div data-testid="top-padroes-financeiros" className="col-span-12 border-t border-slate-200 pt-3">
    <p className="text-[12.5px] font-medium text-slate-700">{TITULO}</p>
    <p className="mb-2 text-[11.5px] leading-relaxed text-slate-500">{AJUDA}</p>
    <div className="grid grid-cols-12 gap-3">
      {campos.map((campo) => <CampoDoPadrao
        key={campo}
        definicao={DEFINICOES[campo]}
        ajuda={campo === "natureza" ? ajudaDaNatureza(perfil) : campo === "formaPagamento" ? AJUDA_DA_FORMA : undefined}
        valor={valor[campo]}
        erro={erros[caminho(campo)]}
        desabilitado={desabilitado}
        onChange={(novo) => onChange({ ...valor, [campo]: novo })}
      />)}
    </div>
    {geral !== undefined && <p data-testid="top-erro-padroesFinanceiros" className="mt-2 text-[11.5px] text-red-700">{geral}</p>}
  </div>;
}

function CampoDoPadrao({ definicao, ajuda, valor, erro, desabilitado, onChange }: {
  definicao: DefinicaoDoCampo;
  ajuda?: string;
  valor: PadroesFinanceirosEmEdicao[CampoDosPadroesEmEdicao];
  erro: string | undefined;
  desabilitado: boolean;
  onChange: (v: PadroesFinanceirosEmEdicao[CampoDosPadroesEmEdicao]) => void;
}) {
  return <div data-testid={definicao.testId} className="col-span-12 md:col-span-6">
    <Field label={definicao.rotulo} help={ajuda} error={erro} span={12}>
      <RefSelect
        resource={definicao.recurso}
        value={valor?.id ?? null}
        labelHint={valor?.rotulo ?? null}
        filter={definicao.filtro}
        disabled={desabilitado}
        placeholder="Sem padrão"
        onChange={(id: string | null, opcao?: Option) => onChange(id ? { id, rotulo: opcao?.label ?? valor?.rotulo ?? "" } : null)}
      />
    </Field>
  </div>;
}
