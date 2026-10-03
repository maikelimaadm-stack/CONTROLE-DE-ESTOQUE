"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP, custoPorUnidade, itensDaProducaoDeRacao } from "@agro/domain";
import { api } from "@/lib/api";
import { brl, todayISO } from "@/lib/utils";
import { Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { useLoteNaEntrada } from "@/features/stock/capacidade-lote";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useSalvarDoModulo, type Pendencia } from "../central-do-modulo";
import { ItensDoModulo } from "../itens-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo } from "../top-do-modulo";
import { ITENS_DERIVADOS, quantidadePositiva, subtotalDaPrevia, useItensDerivados } from "../itens-derivados";

/**
 * A CENTRAL DA PRODUÇÃO DE RAÇÃO (OPERACOES-01 F10, decisão 287) — `/estoque/batidas/new`.
 *
 * A produção consome as matérias-primas da FORMULAÇÃO (quantidade da fórmula × multiplicador, 4 casas) do local de
 * estoque das matérias-primas e dá entrada no produto acabado no outro local, pelo custo das partes consumidas. Os
 * itens são DERIVADOS da fórmula — o modo "da origem" do motor (quantidade travada, a coluna "Pela fórmula") — e o
 * custo é PRÉVIA (o custo médio do local); o final é o do servidor.
 *
 * Os rótulos e controles do cabeçalho são OS DE HOJE, um por um ("Formulação" num seletor nativo, os dois "Local de
 * estoque…" na pesquisa de referência, "Quantidade produzida", "Validade do produto acabado" no campo de data de
 * sempre): o sentido 1 do skew (LT-K1) os escolhe pelo rótulo. A validade só aparece e só viaja com a capacidade
 * `loteNaEntrada` (a API anterior a descartaria); a TOP só com `topNoModulo`. Sem as duas, o corpo é o de hoje.
 */

const PREFIXO = "central-racao";
const NOME = "Nova produção de ração";
const LISTA = "/estoque?tab=fabrica&sub=producoes";

interface Cabecalho {
  empresa_id: string; batch_date: string; formula_id: string; multiplier: string;
  origin_warehouse_id: string; destination_warehouse_id: string; quantity_produced: string; validade: string;
}
/** Uma formulação como `GET /api/stock/feed-formulas` a lista (os itens vêm do `json_agg`: a quantidade é número JSON). */
interface Formulacao { id: string; name: string; product_name: string | null; items: { product_id: string; quantity: string }[] }

/** O leitor das formulações: as que não têm a forma esperada ficam de fora (nunca viram um item inventado). */
function lerFormulacoes(bruto: unknown): Formulacao[] {
  const lista = typeof bruto === "object" && bruto !== null ? (bruto as { items?: unknown }).items : undefined;
  if (!Array.isArray(lista)) return [];
  const out: Formulacao[] = [];
  for (const f of lista) {
    if (typeof f !== "object" || f === null) continue;
    const { id, name, product_name, items } = f as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string") continue;
    const itens = (Array.isArray(items) ? items : []).flatMap((i) => {
      const { product_id, quantity } = (typeof i === "object" && i !== null ? i : {}) as { product_id?: unknown; quantity?: unknown };
      // a quantidade é TEXTO para a conta do domínio (decimal): o número JSON vira o texto que ele é, sem conta
      const texto = typeof quantity === "string" ? quantity : typeof quantity === "number" ? String(quantity) : "";
      return typeof product_id === "string" && product_id ? [{ product_id, quantity: texto }] : [];
    });
    out.push({ id, name, product_name: typeof product_name === "string" ? product_name : null, items: itens });
  }
  return out;
}

export function CentralRacao() {
  const router = useRouter();
  const empresaPadrao = useEmpresaPadrao();
  // a validade do produto acabado só com a API que a entende (`capacidades.loteNaEntrada`): a anterior a descartaria
  const loteNaEntrada = useLoteNaEntrada();
  const [h, setH] = React.useState<Cabecalho>({ empresa_id: "", batch_date: todayISO(), formula_id: "", multiplier: "1", origin_warehouse_id: "", destination_warehouse_id: "", quantity_produced: "", validade: "" });
  const [alterado, setAlterado] = React.useState(false);
  React.useEffect(() => { setH((o) => (o.empresa_id || !empresaPadrao ? o : { ...o, empresa_id: empresaPadrao })); }, [empresaPadrao]);

  const top = useTopDoModulo("producao_racao");
  const escolha = useEscolhaDaTopDoModulo(top);
  const comCapacidade = top.estado === "pronto";
  const salvar = useSalvarDoModulo("/api/stock/feed-batches", () => router.push(LISTA));
  const erros = errosDoServidor(salvar.error);
  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };

  const formulacoes = useQuery({ queryKey: ["formulas"], queryFn: () => api<unknown>("/api/stock/feed-formulas") });
  const lista = React.useMemo(() => lerFormulacoes(formulacoes.data), [formulacoes.data]);
  const formula = lista.find((f) => f.id === h.formula_id) ?? null;
  const derivados = React.useMemo(() => (formula ? itensDaProducaoDeRacao(h.multiplier, formula.items) : []), [formula, h.multiplier]);
  const { itens, onChange: mudarItens } = useItensDerivados(derivados, h.origin_warehouse_id);

  const exigidos = camposExigidosDaTop(top, escolha.valor);
  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.batch_date) pendencias.push({ caminho: "batch_date", rotulo: "Data", mensagem: "Informe a data." });
  if (!h.formula_id) pendencias.push({ caminho: "formula_id", rotulo: "Formulação", mensagem: "Informe a formulação." });
  if (!h.origin_warehouse_id) pendencias.push({ caminho: "origin_warehouse_id", rotulo: "Local de estoque das matérias-primas", mensagem: "Informe o local de estoque das matérias-primas." });
  if (!h.destination_warehouse_id) pendencias.push({ caminho: "destination_warehouse_id", rotulo: "Local de estoque do produto acabado", mensagem: "Informe o local de estoque do produto acabado." });
  if (!quantidadePositiva(h.quantity_produced)) pendencias.push({ caminho: "quantity_produced", rotulo: "Quantidade produzida", mensagem: "Informe a quantidade produzida." });
  // o registro da produção não tem exigência geral (o mapa do domínio é vazio): o laço segue o mapa, nunca um literal
  for (const e of EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.producao_racao) if (exigidos.includes(e.caminho)) pendencias.push({ caminho: e.caminho, rotulo: e.rotulo, mensagem: pendenciaDaExigencia(e.rotulo) });

  const enviar = () => {
    const { validade, multiplier, ...resto } = h;
    salvar.mutate({
      ...resto,
      // multiplicador vazio = o padrão da API ("1"), o mesmo que a prévia usou; a chave fica de fora, não vai vazia
      ...(multiplier.trim() ? { multiplier: multiplier.trim() } : {}),
      ...(loteNaEntrada ? { validade: validade || null } : {}),
      ...(comCapacidade ? { tipo_operacao_id: escolha.idParaEnviar } : {})
    });
  };

  const dados = <ColunaDeCampos>
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} erro={erros["empresa_id"]} testId={`${PREFIXO}-campo-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudar({ empresa_id: v ?? "", origin_warehouse_id: "", destination_warehouse_id: "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.batch_date)} erro={erros["batch_date"]} testId={`${PREFIXO}-campo-data`}>
      <DataDaCentral rotulo="Data" value={h.batch_date} onChange={(v) => mudar({ batch_date: v })} />
    </CampoDaCentral>
    <CampoTopDoModulo prefixoTestid={PREFIXO} top={top} valor={escolha.valor} onChange={(id) => { escolha.escolher(id); setAlterado(true); }} />
    <CampoDaCentral rotulo="Formulação" obrigatorio icone="selecao" preenchido={Boolean(h.formula_id)} erro={erros["formula_id"]} testId={`${PREFIXO}-campo-formulacao`}>
      <NativeSelect value={h.formula_id} onChange={(e) => mudar({ formula_id: e.target.value })}>
        <option value="">Selecione</option>
        {lista.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </NativeSelect>
    </CampoDaCentral>
    <CampoDaCentral rotulo="Multiplicador da receita" preenchido={Boolean(h.multiplier)} erro={erros["multiplier"]} testId={`${PREFIXO}-campo-multiplicador`}
      dica="Ex.: 2 = duas vezes as quantidades da formulação">
      <Input type="number" step="0.0001" min="0" value={h.multiplier} onChange={(e) => mudar({ multiplier: e.target.value })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Local de estoque das matérias-primas" obrigatorio icone="pesquisa" preenchido={Boolean(h.origin_warehouse_id)} erro={erros["origin_warehouse_id"]}
      estado={h.empresa_id ? "editavel" : "desabilitado"} testId={`${PREFIXO}-campo-origem`}>
      <RefSelect resource="warehouses" value={h.origin_warehouse_id} filter={{ empresa_id: h.empresa_id }} disabled={!h.empresa_id || undefined} onChange={(v) => mudar({ origin_warehouse_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Local de estoque do produto acabado" obrigatorio icone="pesquisa" preenchido={Boolean(h.destination_warehouse_id)} erro={erros["destination_warehouse_id"]}
      estado={h.empresa_id ? "editavel" : "desabilitado"} testId={`${PREFIXO}-campo-destino`}>
      <RefSelect resource="warehouses" value={h.destination_warehouse_id} filter={{ empresa_id: h.empresa_id }} disabled={!h.empresa_id || undefined} onChange={(v) => mudar({ destination_warehouse_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Quantidade produzida" obrigatorio preenchido={Boolean(h.quantity_produced)} erro={erros["quantity_produced"]} testId={`${PREFIXO}-campo-quantidade`}>
      <Input type="number" step="0.0001" min="0" value={h.quantity_produced} onChange={(e) => mudar({ quantity_produced: e.target.value })} />
    </CampoDaCentral>
    {loteNaEntrada && <CampoDaCentral rotulo="Validade do produto acabado" preenchido={Boolean(h.validade)} erro={erros["validade"]} testId={`${PREFIXO}-campo-validade`}
      dica="Exigida quando o produto controla lote e validade; o lote do produto acabado é o código da produção">
      <Input type="date" value={h.validade} onChange={(e) => mudar({ validade: e.target.value })} />
    </CampoDaCentral>}
    <CampoLeitura rotulo="Produto acabado" valor={formula ? formula.product_name ?? "(vincule na formulação)" : ""} testId={`${PREFIXO}-produto-acabado`} />
  </ColunaDeCampos>;

  const itensDaGrade = <>
    {!formula && <p className="px-3 pt-2 text-[12px] text-slate-500" data-testid={`${PREFIXO}-itens-da-formula`}>Escolha a formulação: cada matéria-prima sai com a quantidade da fórmula × o multiplicador.</p>}
    <ItensDoModulo prefixoTestid={PREFIXO} items={itens} onChange={mudarItens} armazemPorItem={false} daOrigem={ITENS_DERIVADOS} rotuloDaOrigem="Pela fórmula" />
  </>;

  const subtotal = subtotalDaPrevia(itens);
  const comPrevia = itens.length > 0;
  const resumo = <>
    <CampoLeitura rotulo="Custo da produção (prévia)" valor={comPrevia ? brl(subtotal) : ""} testId={`${PREFIXO}-resumo-custo`} />
    <CampoLeitura rotulo="Custo unitário do produto acabado (prévia)" valor={comPrevia ? brl(custoPorUnidade(subtotal, h.quantity_produced.trim())) : ""} testId={`${PREFIXO}-resumo-custo-unitario`} />
    <p className="text-[12px] text-slate-500">O custo final é o do estoque na hora de salvar.</p>
  </>;

  return <CentralDoModulo prefixoTestid={PREFIXO} titulo={NOME} nome={NOME} alterado={alterado}
    pendencias={pendencias} salvando={salvar.isPending} podeSalvar={top.estado !== "carregando"} onSalvar={enviar}
    rotaDaLista={LISTA} dados={dados} itens={itensDaGrade} resumo={resumo} />;
}
