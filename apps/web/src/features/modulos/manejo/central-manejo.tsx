"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { EXIGENCIAS_GERAIS_DOS_MODULOS_TOP, quantidadeDoProdutoNoManejo, withdrawalUntil } from "@agro/domain";
import { D } from "@agro/shared";
import { api } from "@/lib/api";
import { enumLabel } from "@/lib/copy";
import { dateBR, num, todayISO } from "@/lib/utils";
import { Input, NativeSelect, Textarea } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { CampoDaCentral, CampoLeitura, ColunaDeCampos, DataDaCentral } from "@/features/central/campo";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { AnimalPicker, HerdLotSelect } from "@/features/livestock/shared";
import { CentralDoModulo, errosDoServidor, pendenciaDaExigencia, useSalvarDoModulo, type Pendencia } from "../central-do-modulo";
import { CampoTopDoModulo, camposExigidosDaTop, useEscolhaDaTopDoModulo, useTopDoModulo } from "../top-do-modulo";

/**
 * A CENTRAL DO MANEJO — NUTRIÇÃO E SANITÁRIO (OPERACOES-01 F10, decisão 287).
 *
 * O manejo que consome produto ganha a moldura do motor da Central, com a regra de sempre: o PRODUTO, o local de
 * estoque e a dose vão no CABEÇALHO, e os itens são ANIMAIS — cabeças, não produtos. Por isso a grade é a própria (o
 * seletor de animais e o rebanho por contagem de `features/livestock/shared`, só leitura), e não a do motor.
 *
 *   · O Local de estoque vem ANTES do Produto (decisão 280: é o local que decide o saldo), e só lista os locais da
 *     empresa do lançamento (trocar a empresa o limpa).
 *   · Cada animal identificado vai com `quantity: "1"` — a CABEÇA. O servidor multiplica pela dose
 *     (`quantidadeDoProdutoNoManejo`); a tela anterior mandava a dose no lugar da cabeça, e a baixa saía dose² ×
 *     animais. No rebanho por contagem, a quantidade é o número de cabeças informado.
 *   · O Resumo mostra as cabeças, a quantidade do produto pela MESMA conta do servidor (4 casas) e, no sanitário com
 *     produto, a carência pelo cadastro do produto (`withdrawalUntil`). Quem grava é o servidor.
 *   · A TOP do manejo (família pelo registry) só aparece e só viaja com a capacidade da API (`topNoModulo`); sem ela,
 *     o corpo é o de hoje, chave por chave. As exigências da TOP que o registro do manejo tem (a observação) viram
 *     pendência do Salvar com o MESMO texto da recusa do servidor.
 * Desmama, apartação e pastagem não consomem produto: continuam no formulário de hoje (a página decide).
 */

export type TipoDeManejoComProduto = "nutrition" | "sanitary";

const PREFIXO = "central-manejo";
const NOMES: Readonly<Record<TipoDeManejoComProduto, string>> = Object.freeze({ sanitary: "Novo manejo sanitário", nutrition: "Novo manejo de nutrição" });

interface Cabecalho {
  empresa_id: string;
  handling_date: string;
  batch_id: string;
  responsible: string;
  warehouse_id: string;
  product_id: string;
  provider_lot: string;
  dose: string;
  note: string;
}
type Modo = "animals" | "count";

/** O valor de cada caminho que uma exigência da TOP do manejo pode cobrar (o mapa do registro do manejo). */
const valorDoCaminho = (h: Cabecalho, caminho: string): string => (caminho === "note" ? h.note.trim() : "");

/** Os dias de carência do cadastro do produto, como o servidor os lê (inteiro); qualquer outra forma = sem carência. */
function diasDeCarencia(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) { const n = Number.parseInt(v, 10); return n > 0 ? n : null; }
  return null;
}

export function CentralManejo({ tipo }: { tipo: TipoDeManejoComProduto }) {
  const router = useRouter();
  const empresaPadrao = useEmpresaPadrao();
  const [h, setH] = React.useState<Cabecalho>({ empresa_id: "", handling_date: todayISO(), batch_id: "", responsible: "", warehouse_id: "", product_id: "", provider_lot: "", dose: "", note: "" });
  const [modo, setModo] = React.useState<Modo>("animals");
  const [animais, setAnimais] = React.useState<string[]>([]);
  const [rebanho, setRebanho] = React.useState("");
  const [cabecasDoRebanho, setCabecasDoRebanho] = React.useState("1");
  const [alterado, setAlterado] = React.useState(false);
  // a empresa padrão chega depois do contexto: preenche só o que ainda está vazio, sem contar como alteração
  React.useEffect(() => { setH((o) => (o.empresa_id || !empresaPadrao ? o : { ...o, empresa_id: empresaPadrao })); }, [empresaPadrao]);

  const top = useTopDoModulo("manejo");
  const escolha = useEscolhaDaTopDoModulo(top);
  const lista = `/pecuaria?tab=manejos&type=${tipo}`;
  const salvar = useSalvarDoModulo("/api/livestock/handlings", () => router.push(lista));
  const erros = errosDoServidor(salvar.error);

  const mudar = (p: Partial<Cabecalho>) => { setH((o) => ({ ...o, ...p })); setAlterado(true); };
  /** A empresa recorta os locais, os lotes, os animais e os rebanhos: trocá-la limpa o que dependia dela. */
  const mudarEmpresa = (empresa_id: string) => {
    mudar({ empresa_id, warehouse_id: "", batch_id: "" });
    setAnimais([]); setRebanho("");
  };
  /** O lote de animais recorta o seletor de animais: a seleção de outro lote não continua escondida no corpo. */
  const mudarLote = (batch_id: string) => { mudar({ batch_id }); setAnimais([]); };

  // o produto escolhido, pela MESMA leitura (e chave de cache) que a pesquisa e a grade do motor usam
  const produto = useQuery({
    queryKey: ["option-one", "products", h.product_id],
    queryFn: () => api<Record<string, unknown>>(`/api/resources/products/${h.product_id}`),
    enabled: Boolean(h.product_id),
    staleTime: 60_000
  });
  const unidade = typeof produto.data?.["measurement_id_label"] === "string" ? String(produto.data["measurement_id_label"]).trim() : "";

  // CABEÇAS: 1 por animal identificado; no rebanho por contagem, as cabeças informadas
  const cabecas: string[] = modo === "animals" ? animais.map(() => "1") : rebanho ? [cabecasDoRebanho.trim()] : [];
  const totalDeCabecas = quantidadeDoProdutoNoManejo(null, cabecas);
  // a soma do domínio é sempre um decimal canônico ("0.0000" sem cabeça): a comparação é em decimal, nunca em float
  const semCabecas = D(totalDeCabecas).lte(0);
  const quantidade = quantidadeDoProdutoNoManejo(h.dose, cabecas);
  const carencia = tipo === "sanitary" && h.product_id && produto.data
    ? withdrawalUntil(h.handling_date, diasDeCarencia(produto.data["withdrawal_period_days"]))
    : null;

  const exigidos = camposExigidosDaTop(top, escolha.valor);
  const exigencias = EXIGENCIAS_GERAIS_DOS_MODULOS_TOP.manejo.filter((e) => exigidos.includes(e.caminho));
  const exigido = (caminho: string) => exigencias.some((e) => e.caminho === caminho);

  const pendencias: Pendencia[] = [];
  if (!h.empresa_id) pendencias.push({ caminho: "empresa_id", rotulo: "Empresa", mensagem: "Informe a empresa." });
  if (!h.handling_date) pendencias.push({ caminho: "handling_date", rotulo: "Data", mensagem: "Informe a data." });
  if (semCabecas) pendencias.push({ caminho: "items", rotulo: "Animais", mensagem: "Inclua ao menos um animal." });
  for (const e of exigencias) if (!valorDoCaminho(h, e.caminho)) pendencias.push({ caminho: e.caminho, rotulo: e.rotulo, mensagem: pendenciaDaExigencia(e.rotulo) });

  const enviar = () => {
    const items = modo === "animals"
      ? animais.map((animal_id) => ({ animal_id, quantity: "1" }))
      : [{ herd_lot_id: rebanho, quantity: cabecasDoRebanho.trim() }];
    salvar.mutate({
      empresa_id: h.empresa_id, handling_type: tipo, handling_date: h.handling_date, batch_id: h.batch_id || null,
      product_id: h.product_id || null, warehouse_id: h.warehouse_id || null, provider_lot: h.provider_lot.trim() || null,
      dose: h.dose.trim() || null, responsible: h.responsible.trim() || null, note: h.note.trim() || null,
      // a TOP só viaja para a API que a declara (`topNoModulo`); sem ela, a chave nem existe no corpo
      ...(top.estado === "pronto" ? { tipo_operacao_id: escolha.idParaEnviar } : {}),
      items
    });
  };

  const dados = <ColunaDeCampos>
    <CampoLeitura rotulo="Manejo" valor={enumLabel("handling_type", tipo)} testId={`${PREFIXO}-tipo`} />
    <CampoDaCentral rotulo="Empresa" obrigatorio icone="pesquisa" preenchido={Boolean(h.empresa_id)} erro={erros["empresa_id"]} testId={`${PREFIXO}-campo-empresa`}>
      <RefSelect resource="empresas" value={h.empresa_id} onChange={(v) => mudarEmpresa(v ?? "")} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Data" obrigatorio icone="data" preenchido={Boolean(h.handling_date)} erro={erros["handling_date"]} testId={`${PREFIXO}-campo-data`}>
      <DataDaCentral rotulo="Data" value={h.handling_date} onChange={(v) => mudar({ handling_date: v })} />
    </CampoDaCentral>
    <CampoTopDoModulo prefixoTestid={PREFIXO} top={top} valor={escolha.valor} onChange={(id) => { escolha.escolher(id); setAlterado(true); }} />
    <CampoDaCentral rotulo="Lote de animais" icone="pesquisa" preenchido={Boolean(h.batch_id)} erro={erros["batch_id"]} testId={`${PREFIXO}-campo-lote`}
      estado={h.empresa_id ? "editavel" : "desabilitado"}>
      <RefSelect resource="batches" value={h.batch_id} filter={{ empresa_id: h.empresa_id }} disabled={!h.empresa_id || undefined} onChange={(v) => mudarLote(v ?? "")} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Responsável" preenchido={Boolean(h.responsible)} testId={`${PREFIXO}-campo-responsavel`}>
      <Input value={h.responsible} onChange={(e) => mudar({ responsible: e.target.value })} />
    </CampoDaCentral>
    {/* o Local ANTES do Produto: é ele que decide o saldo que a baixa consome */}
    <CampoDaCentral rotulo="Local de estoque" icone="pesquisa" preenchido={Boolean(h.warehouse_id)} erro={erros["warehouse_id"]} testId={`${PREFIXO}-campo-local`}
      estado={h.empresa_id ? "editavel" : "desabilitado"} dica="Com local de estoque, o produto sai do estoque pelo custo médio; sem local, o manejo é só registrado.">
      <RefSelect resource="warehouses" value={h.warehouse_id} filter={{ empresa_id: h.empresa_id }} disabled={!h.empresa_id || undefined} onChange={(v) => mudar({ warehouse_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Produto" icone="pesquisa" preenchido={Boolean(h.product_id)} erro={erros["product_id"]} testId={`${PREFIXO}-campo-produto`}>
      <RefSelect resource="products" value={h.product_id} onChange={(v) => mudar({ product_id: v ?? "" })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Lote do produto" preenchido={Boolean(h.provider_lot)} erro={erros["provider_lot"]} testId={`${PREFIXO}-campo-lote-produto`}
      dica="O lote do produto que controla lote; vazio, a baixa escolhe o de validade mais próxima.">
      <Input maxLength={60} value={h.provider_lot} onChange={(e) => mudar({ provider_lot: e.target.value })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Dose por cabeça" preenchido={Boolean(h.dose)} erro={erros["dose"]} testId={`${PREFIXO}-campo-dose`}>
      <Input type="number" step="0.0001" min="0" value={h.dose} onChange={(e) => mudar({ dose: e.target.value })} />
    </CampoDaCentral>
    <CampoDaCentral rotulo="Observação" obrigatorio={exigido("note")} multilinha preenchido={Boolean(h.note)} erro={erros["note"]} testId={`${PREFIXO}-campo-observacao`}>
      <Textarea value={h.note} onChange={(e) => mudar({ note: e.target.value })} />
    </CampoDaCentral>
  </ColunaDeCampos>;

  const errosDosItens = Object.entries(erros).filter(([c]) => c === "items" || c.startsWith("items."));
  const itens = <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3" data-testid={`${PREFIXO}-animais`}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-[12px] text-slate-600">
        Modo
        <NativeSelect className="w-56" data-testid={`${PREFIXO}-modo`} value={modo} onChange={(e) => { setModo(e.target.value === "count" ? "count" : "animals"); setAlterado(true); }}>
          <option value="animals">Animais identificados</option>
          <option value="count">Por contagem</option>
        </NativeSelect>
      </label>
      {modo === "count" && <>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-[12px] text-slate-600" data-testid={`${PREFIXO}-rebanho`}>
          Rebanho por contagem
          <HerdLotSelect value={rebanho} empresaId={h.empresa_id || undefined} onChange={(id) => { setRebanho(id); setAlterado(true); }} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-slate-600">
          Cabeças
          <Input className="w-28" type="number" min="1" step="1" data-testid={`${PREFIXO}-cabecas`} value={cabecasDoRebanho} onChange={(e) => { setCabecasDoRebanho(e.target.value); setAlterado(true); }} />
        </label>
      </>}
    </div>
    {modo === "animals" && <AnimalPicker selected={animais} onChange={(ids) => { setAnimais(ids); setAlterado(true); }} empresaId={h.empresa_id || undefined} batchId={h.batch_id || undefined} />}
    {errosDosItens.length > 0 && <div role="alert" className="text-[11px] text-red-600" data-testid={`${PREFIXO}-itens-erros`}>
      {errosDosItens.map(([c, m]) => <p key={c}>{m}</p>)}
    </div>}
  </div>;

  const resumo = <>
    <CampoLeitura rotulo="Cabeças" valor={num(totalDeCabecas, 0)} testId={`${PREFIXO}-resumo-cabecas`} />
    <CampoLeitura rotulo="Quantidade do produto" valor={h.product_id ? `${num(quantidade, 4)}${unidade ? ` ${unidade}` : ""}` : ""} testId={`${PREFIXO}-resumo-quantidade`} />
    {tipo === "sanitary" && <CampoLeitura rotulo="Carência até" valor={carencia ? dateBR(carencia) : ""} testId={`${PREFIXO}-resumo-carencia`} />}
  </>;

  return <CentralDoModulo prefixoTestid={PREFIXO} titulo={NOMES[tipo]} nome={NOMES[tipo]} alterado={alterado}
    pendencias={pendencias} salvando={salvar.isPending} podeSalvar={top.estado !== "carregando"} onSalvar={enviar}
    rotaDaLista={lista} dados={dados} itens={itens} resumo={resumo} />;
}
