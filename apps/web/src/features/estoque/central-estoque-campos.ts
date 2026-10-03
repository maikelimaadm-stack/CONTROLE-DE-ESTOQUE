import { CAMPOS_DESTINO_ESTOQUE, ERRO_EXIGENCIA_NAO_ATENDIDA, conferirNumeroEstoque, type ResultadoNumeroEstoque } from "@agro/domain";
import { ApiError } from "@/lib/api";

/**
 * OS CAMPOS DA CENTRAL DE ESTOQUE QUE NÃO SÃO DESENHO — o número digitado virando o texto do contrato, e o 422 do
 * servidor virando erro no campo (ESTOQUE-01, decisão 274; a Central no motor desde a OPERACOES-01 F5b, decisão 282).
 *
 * NÚMERO: a API só aceita TEXTO CANÔNICO (`conferirNumeroEstoque`, do domínio): sem sinal, sem expoente, sem
 * vírgula, sem espaço, sem zero à esquerda, no máximo as casas da coluna. A tela aceita o que a pessoa digita no
 * jeito brasileiro ("1,5") e só NORMALIZA a forma — vírgula vira ponto, espaço sai, zero à esquerda sai. Nunca
 * arredonda, nunca passa por `Number`: um "1,23456" continua com cinco casas e é RECUSADO pela MESMA função que a
 * API usa, com a MESMA mensagem, no próprio campo. Separador de milhar não é adivinhado ("1.000,5" vira
 * "1.000.5", que a conferência recusa): adivinhar é o jeito mais barato de gravar mil vezes o que se digitou.
 */
export function textoCanonico(digitado: string): string {
  let v = digitado.replace(/\s+/g, "").replace(/,/g, ".");
  if (/^\.\d+$/.test(v)) v = `0${v}`;
  if (/^\d+\.?\d*$/.test(v)) v = v.replace(/\.$/, "").replace(/^0+(?=\d)/, "");
  return v;
}

/** O número de um campo, normalizado e conferido pelo domínio. Vazio é "falta", com a mensagem do campo. */
export function numeroDoCampo(
  digitado: string,
  limite: { casas: 4 | 6; inteiros: number },
  minimo: "positivo" | "naoNegativo",
  faltando: string
): ResultadoNumeroEstoque {
  const v = textoCanonico(digitado);
  if (v === "") return { ok: false, mensagem: faltando };
  return conferirNumeroEstoque(v, { ...limite, minimo });
}

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Os erros de campo que o servidor devolveu, por caminho: `details: [{ path, message }]` (validação — `itens.<i>.<campo>`
 * inclusive) e `details.exigencias: [{ caminho, mensagem }]` (exigência da operação, como a observação obrigatória).
 * O caminho do zod sai com ponto (`itens.0.lote`); o colchete (`itens[0].lote`) é aceito e reescrito para a mesma chave.
 */
export function errosDoServidor(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  const por = (caminho: string, mensagem: string) => { out[caminho.replace(/\[(\d+)\]/g, ".$1")] = mensagem; };
  if (e.code === ERRO_EXIGENCIA_NAO_ATENDIDA && ehObj(e.details) && Array.isArray(e.details.exigencias)) {
    for (const x of e.details.exigencias as unknown[]) if (ehObj(x) && typeof x.caminho === "string" && typeof x.mensagem === "string") por(x.caminho, x.mensagem);
    return out;
  }
  if (!Array.isArray(e.details)) return out;
  for (const d of e.details as unknown[]) if (ehObj(d) && typeof d.path === "string" && typeof d.message === "string") por(d.path, d.message);
  return out;
}

const ROTULO_DO_CAMPO_DO_ITEM: Record<string, string> = {
  produto_id: "produto", quantidade: "quantidade", quantidade_contada: "quantidade contada", custo_unitario: "custo unitário",
  lote: "lote", validade: "validade", observacao: "observação", origem_item_id: "item de origem"
};

/** `itens.0.lote` (ou `itens[0].lote`) → "Item 1 · lote"; `itens` → "Itens". Para o erro que não tem um campo à vista onde cair. */
export function descreverCaminhoDeItem(caminho: string): string {
  const m = /^itens(?:\.(\d+)|\[(\d+)\])(?:\.([a-z_]+))?$/.exec(caminho);
  if (!m) return "Itens";
  const n = Number(m[1] ?? m[2]) + 1;
  return m[3] ? `Item ${n} · ${ROTULO_DO_CAMPO_DO_ITEM[m[3]] ?? m[3]}` : `Item ${n}`;
}

/**
 * O rótulo de cada campo do CABEÇALHO para o erro que cai numa lista (nunca a chave técnica na tela). O destino vem do
 * dono das dimensões (`CAMPOS_DESTINO_ESTOQUE`); o resto é o rótulo da tela.
 */
const ROTULO_DO_CAMPO_DO_CABECALHO: Readonly<Record<string, string>> = Object.freeze({
  empresa_id: "Empresa", tipo_operacao_id: "Tipo de Operação", data_documento: "Data do documento", armazem_id: "Local de estoque",
  armazem_destino_id: "Local de estoque de destino", observacao: "Observação", origem_documento_id: "Documento de origem",
  motivo_saida: "Motivo", justificativa: "Justificativa",
  ...Object.fromEntries(CAMPOS_DESTINO_ESTOQUE.map((c) => [c.coluna, c.rotulo]))
});

/** O rótulo de um caminho de erro: o do item ("Item 1 · lote") ou o do campo do cabeçalho; desconhecido → "Documento". */
export const rotuloDoErro = (caminho: string): string =>
  (caminho.startsWith("itens") ? descreverCaminhoDeItem(caminho) : ROTULO_DO_CAMPO_DO_CABECALHO[caminho] ?? "Documento");
