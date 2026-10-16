"use client";
import * as React from "react";
import { enumLabel } from "@/lib/copy";
import { useAuth } from "@/lib/auth";
import { brl, dateBR } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { Button, Dialog, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect } from "@/components/ui/ref-select";
import { opcoesDeNaturezaDeDespesa } from "../central/estado";
import { DialogoDeCadastroRapido } from "./aba-cabecalho";
import { criarProdutosDaImportacao, recusasNoCampo } from "./api";
import { decimalDigitado, type EstadoDaConferencia } from "./estado";
import { fatorNaTela } from "./fator-do-item";
import {
  cadastravelPelaNota, corpoDoLote, declaraCriarProdutosDaNota, fornecedorResolvidoParaOLote, itensSemLocalGravado, mensagensDaRecusaDoLote, planoDoLote,
  presetDoProdutoDoItem, quantidadeDeProdutos, rotuloDoLote, type PlanoDoLote
} from "./produtos-da-nota";
import { conferenciaDoPalpite, rotuloDoVinculo, sugeridoPorPalpite } from "./vinculo-do-item";

/**
 * A ABA "ITENS" DA CONFERÊNCIA — grade no modelo visual da Central (tabela densa): produto, fator, local e totais
 * da nota por linha. Avisos, vínculos e decisões rápidas (gera estoque, imobilizado, lembrar) ficam na linha de
 * apoio sempre visível; lotes e rateio por item ficam em "Mais".
 */

const Checkbox = ({ testId, rotulo, marcado, onMudar, desabilitado }: { testId: string; rotulo: string; marcado: boolean; onMudar: (v: boolean) => void; desabilitado?: boolean }) =>
  <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" data-testid={testId} checked={marcado} disabled={desabilitado} onChange={(ev) => onMudar(ev.target.checked)} />{rotulo}</label>;

export function AbaItens({ e }: { e: EstadoDaConferencia }) {
  const { can } = useAuth();
  const [criandoPara, setCriandoPara] = React.useState<number | null>(null);
  const { conf } = e;
  const leitura = !e.pendente;
  const itemDoCadastro = criandoPara === null ? null : conf.itens.find((i) => i.nItem === criandoPara) ?? null;
  const presetDoProduto = (): Record<string, string> => presetDoProdutoDoItem(itemDoCadastro?.vinculo, conf.nota.itens.find((i) => i.nItem === criandoPara));
  const podeLote = e.pendente && can("products.create") && declaraCriarProdutosDaNota(conf);
  const plano = podeLote ? planoDoLote(conf, e.itens) : null;
  const produtosDoLote = plano ? quantidadeDeProdutos(plano.lista) : 0;
  const fornecedorDoLote = fornecedorResolvidoParaOLote(conf);
  const [aberturasDoLote, setAberturasDoLote] = React.useState(0);
  const [loteAberto, setLoteAberto] = React.useState(false);

  return <div data-testid="importacao-aba-itens" className="flex flex-col gap-3">
    {plano && produtosDoLote > 0 && <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" data-testid="importacao-criar-produtos" data-quantidade={produtosDoLote} disabled={!fornecedorDoLote}
        onClick={() => { setAberturasDoLote((k) => k + 1); setLoteAberto(true); }}>{rotuloDoLote(produtosDoLote)}</Button>
      {!fornecedorDoLote && <span className="text-[12px] text-amber-800" data-testid="importacao-criar-produtos-sem-fornecedor">Escolha o fornecedor na aba Cabeçalho para criar os produtos de uma vez: os vínculos do item dependem dele.</span>}
    </div>}

    <div className="overflow-x-auto rounded border">
      <table className="table-dense w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="w-10">#</th>
            <th>Produto da nota</th>
            <th className="text-right">Qtd × unitário</th>
            <th>Produto</th>
            <th className="w-20">Fator</th>
            <th className="w-28">Conversão</th>
            <th className="text-right">Qtd interna</th>
            <th className="text-right">Unit. interno</th>
            <th>Local</th>
          </tr>
        </thead>
        <tbody>
          {conf.nota.itens.map((item) => {
            const n = item.nItem;
            const d = e.itens.find((x) => x.nItem === n)!;
            const v = conf.itens.find((x) => x.nItem === n)!.vinculo;
            const conta = e.contas.get(n)!;
            const produto = d.produtoId ? e.produtos[d.produtoId] : undefined;
            const pede = `importacao-item-${n}`;
            const comEntrada = d.geraEstoque && (produto?.controlaEstoque ?? true);
            const pedeLote = item.rastro.length === 0 && comEntrada && produto && produto.controleLote !== "nenhum";
            const rotuloDoProduto = v.situacao === "lembrado" || v.situacao === "sugerido" ? `${v.produto.codigo} — ${v.produto.descricao}` : null;
            const palpite = conferenciaDoPalpite(v);
            const fator = fatorNaTela(v, d);
            return <React.Fragment key={n}>
              <tr data-testid={pede} data-vinculo={v.situacao}>
                <td className="font-medium">{n}</td>
                <td>
                  <div className="font-mono text-[11px] text-slate-500">{item.codigo}</div>
                  <div>{item.descricao}</div>
                  <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600" data-testid={`${pede}-vinculo`}>{rotuloDoVinculo(v)}</span>
                </td>
                <td className="text-right whitespace-nowrap" data-testid={`${pede}-quantidade-nota`}>
                  {item.quantidade} {item.unidade}<br />× {brl(item.valorUnitario)} = {brl(item.valorProdutos)}
                </td>
                <td>
                  <div data-testid={`${pede}-produto`} className="min-w-[12rem]">
                    <RefSelect resource="products" value={d.produtoId} disabled={leitura} labelHint={d.produtoId && produto ? `${produto.codigo} — ${produto.descricao}` : rotuloDoProduto}
                      onChange={(id) => e.mudarItem(n, { produtoId: id ?? "", produtoManual: true })} />
                  </div>
                  {e.erroDoItem(n, "produto_id") && <p className="mt-0.5 text-[11px] text-red-600">{e.erroDoItem(n, "produto_id")}</p>}
                  {!leitura && can("products.create") && (cadastravelPelaNota(v) || sugeridoPorPalpite(v) || v.situacao === "ambiguo") && (
                    <Button size="sm" variant="outline" className="mt-1" data-testid={`${pede}-criar-produto`} onClick={() => setCriandoPara(n)}>Criar produto</Button>
                  )}
                </td>
                <td>
                  <Input data-testid={`${pede}-fator`} inputMode="decimal" value={d.fator} disabled={leitura} onChange={(ev) => e.mudarItem(n, { fator: decimalDigitado(ev.target.value) })} />
                  {e.erroDoItem(n, "fator") && <p className="mt-0.5 text-[11px] text-red-600">{e.erroDoItem(n, "fator")}</p>}
                </td>
                <td>
                  <NativeSelect data-testid={`${pede}-tipo-fator`} value={d.tipoFator} disabled={leitura} onChange={(ev) => e.mudarItem(n, { tipoFator: ev.target.value === "divide" ? "divide" : "multiply" })}>
                    <option value="multiply">{enumLabel("tipo_fator_conversao", "multiply")}</option>
                    <option value="divide">{enumLabel("tipo_fator_conversao", "divide")}</option>
                  </NativeSelect>
                </td>
                <td className="text-right font-medium" data-testid={`${pede}-quantidade-interna`}>{conta.situacao === "pronta" ? conta.quantidadeInterna : "—"}</td>
                <td className="text-right font-medium" data-testid={`${pede}-unitario-interno`}>{conta.situacao === "pronta" ? conta.unitarioInterno : "—"}</td>
                <td>
                  {d.geraEstoque ? <div data-testid={`${pede}-local`} className="min-w-[9rem]">
                    <RefSelect resource="warehouses" value={d.armazemId} filter={{ empresa_id: conf.empresa.id }} disabled={leitura} onChange={(id) => e.mudarItem(n, { armazemId: id ?? "" })} />
                    {e.erroDoItem(n, "armazem_id") && <p className="mt-0.5 text-[11px] text-red-600">{e.erroDoItem(n, "armazem_id")}</p>}
                  </div> : <span className="text-slate-400">—</span>}
                </td>
              </tr>
              <tr data-testid={`${pede}-apoio`} className="border-b border-slate-100 bg-slate-50/50">
                <td colSpan={9} className="px-3 py-1.5">
                  <div className="flex flex-col gap-1.5">
                    {fator?.texto && <p className="text-[12px] text-slate-600" data-testid={`${pede}-fator-origem`} data-origem={fator.origem}>{fator.texto}</p>}
                    {fator?.pergunta && <p className="text-[12px] text-amber-800" data-testid={`${pede}-fator-pergunta`}>{fator.pergunta}</p>}
                    {fator?.aviso && <p className="text-[12px] text-amber-800" data-testid={`${pede}-fator-aviso`}>{fator.aviso}</p>}
                    {palpite && !leitura && v.situacao === "sugerido" && d.produtoId === v.produto.id && <p className="text-[12px] text-amber-800" data-testid={`${pede}-${palpite.sufixoDoTestid}`}>{palpite.texto}</p>}
                    {v.situacao === "ambiguo" && !leitura && <div className="flex flex-wrap items-center gap-1.5" data-testid={`${pede}-candidatos`}>
                      <span className="text-[12px] text-amber-800">Mais de um produto corresponde:</span>
                      {v.candidatos.map((c) => <Button key={c.id} size="sm" variant={d.produtoId === c.id ? "default" : "outline"} data-testid={`${pede}-candidato-${c.id}`}
                        onClick={() => e.mudarItem(n, { produtoId: c.id, produtoManual: true })}>{c.codigo} — {c.descricao}</Button>)}
                    </div>}
                    <div className="flex flex-wrap items-center gap-4">
                      <Checkbox testId={`${pede}-gera-estoque`} rotulo="Gera estoque" marcado={d.geraEstoque} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { geraEstoque: x })} />
                      <Checkbox testId={`${pede}-imobilizado`} rotulo="Imobilizado (cria o bem na confirmação)" marcado={d.imobilizado} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { imobilizado: x })} />
                      <Checkbox testId={`${pede}-lembrar`} rotulo="Lembrar este vínculo para as próximas notas" marcado={d.lembrar} desabilitado={leitura} onMudar={(x) => e.mudarItem(n, { lembrar: x })} />
                    </div>
                    {item.rastro.length > 0 && <div data-testid={`${pede}-rastro`}>
                      <span className="text-[12px] text-slate-600">Lotes do rastro da nota:</span>
                      <ul className="ml-4 list-disc text-[12px]">
                        {item.rastro.map((r, k) => <li key={k} data-testid={`${pede}-rastro-lote`}>{r.lote} — {r.quantidade} {item.unidade}{r.validade ? ` — validade ${dateBR(r.validade)}` : ""}</li>)}
                      </ul>
                    </div>}
                    {pedeLote && <div className="grid max-w-xl grid-cols-12 gap-3">
                      <Field label="Lote" span={6} required error={e.erroDoItem(n, "lote")}>
                        <Input data-testid={`${pede}-lote`} maxLength={60} value={d.lote} disabled={leitura} onChange={(ev) => e.mudarItem(n, { lote: ev.target.value })} />
                      </Field>
                      {produto?.controleLote === "lote_validade" && <Field label="Validade" span={6} required error={e.erroDoItem(n, "validade")}>
                        <Input data-testid={`${pede}-validade`} type="date" value={d.validade} disabled={leitura} onChange={(ev) => e.mudarItem(n, { validade: ev.target.value })} />
                      </Field>}
                    </div>}
                    {e.fin.rateioTipo === "por_produto" && <div className="grid max-w-3xl grid-cols-12 gap-3">
                      <Field label="Natureza de despesa do item" span={6} required error={e.erroDoItem(n, "categoria_financeira_id")}>
                        <div data-testid={`${pede}-natureza`}>
                          <RefSelect resource="financial_categories" value={d.categoriaId} buscarOpcoes={opcoesDeNaturezaDeDespesa} disabled={leitura} onChange={(id) => e.mudarItem(n, { categoriaId: id ?? "" })} />
                        </div>
                      </Field>
                      <Field label="Centro de resultado do item" span={6} required error={e.erroDoItem(n, "centro_custo_id")}>
                        <div data-testid={`${pede}-centro`}>
                          <RefSelect resource="cost_centers" value={d.centroId} filter={{ kind: "analytic" }} disabled={leitura} onChange={(id) => e.mudarItem(n, { centroId: id ?? "" })} />
                        </div>
                      </Field>
                    </div>}
                    {e.erroDoItem(n, "n_item") && <p className="text-[11px] text-red-600">{e.erroDoItem(n, "n_item")}</p>}
                  </div>
                </td>
              </tr>
            </React.Fragment>;
          })}
        </tbody>
      </table>
    </div>
    {e.erroEm("itens") && <p className="text-[12px] text-red-600" data-testid="importacao-itens-erro">{e.erroEm("itens")}</p>}
    <DialogoDeCadastroRapido recurso="products" titulo="Criar produto pelo item da nota" aberto={criandoPara !== null} onFechar={() => setCriandoPara(null)}
      preset={presetDoProduto()} onCriado={(row) => {
        if (criandoPara === null) return;
        e.conhecerProduto(row);
        e.mudarItem(criandoPara, { produtoId: String(row["id"]), produtoManual: true, fator: "1", tipoFator: "multiply" });
      }} />
    {plano && <DialogoDeProdutosDaNota key={aberturasDoLote} e={e} plano={plano} aberto={loteAberto} onFechar={() => setLoteAberto(false)} />}
  </div>;
}

function DialogoDeProdutosDaNota({ e, plano, aberto, onFechar }: { e: EstadoDaConferencia; plano: PlanoDoLote; aberto: boolean; onFechar: () => void }) {
  const { conf } = e;
  const [desmarcados, setDesmarcados] = React.useState<ReadonlySet<number>>(() => new Set());
  const [grupoId, setGrupoId] = React.useState("");
  const [naturezaId, setNaturezaId] = React.useState("");
  const [erros, setErros] = React.useState<string[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const marcados = new Set(plano.lista.map((i) => i.nItem).filter((n) => !desmarcados.has(n)));
  const corpo = corpoDoLote(conf, plano.lista, e.itens, marcados, grupoId, naturezaId);
  const quantidade = quantidadeDeProdutos(plano.lista, marcados);
  const marcar = (nItem: number, marcado: boolean) => setDesmarcados((d) => {
    const n = new Set(d);
    if (marcado) n.delete(nItem); else n.add(nItem);
    return n;
  });

  const confirmar = async () => {
    if (!corpo || enviando) return;
    setEnviando(true);
    setErros([]);
    try {
      const r = await criarProdutosDaImportacao(conf.id, corpo, e.chaveDoLote.doEnvio(corpo));
      e.renovarChaveDoLote();
      e.conhecerProdutosDoVinculo(r.itens.map((i) => i.produto));
      for (const i of r.itens) e.mudarItem(i.nItem, { produtoId: i.produto.id, produtoManual: true, fator: "1", tipoFator: "multiply" });
      const semLocal = itensSemLocalGravado(corpo, r);
      const criados = `${r.produtos.length === 1 ? "1 produto criado" : `${r.produtos.length} produtos criados`} pela nota.`;
      if (semLocal.length) toast.warning(`${criados} O Local de estoque não foi gravado no produto ${semLocal.length === 1 ? "do item" : "dos itens"} ${semLocal.join(", ")}.`);
      else toast.success(criados);
      onFechar();
    } catch (err) {
      const mensagem = e.chaveDoLote.depoisDoErro(err);
      const recusas = recusasNoCampo(err);
      setErros(recusas.length ? mensagensDaRecusaDoLote(recusas, corpo) : [mensagem]);
    } finally {
      setEnviando(false);
    }
  };

  return <Dialog open={aberto} onOpenChange={(o) => { if (!o && !enviando) onFechar(); }} title="Criar produtos pela nota" size="md" testId="importacao-criar-produtos-dialogo" preventClose={enviando}
    footer={<>
      <Button variant="outline" onClick={onFechar} disabled={enviando}>Fechar</Button>
      <Button data-testid="importacao-criar-produtos-confirmar" loading={enviando} disabled={!corpo} onClick={() => void confirmar()}>{rotuloDoLote(quantidade)}</Button>
    </>}>
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-600">Cada produto nasce com a descrição, a NCM, o código de barras e a unidade da nota, e com o Local de estoque escolhido no item. O Grupo e a Natureza de custo valem para todos. Itens com o mesmo código do fornecedor e a mesma unidade viram um produto só.</p>
      <ul className="flex flex-col gap-2">
        {plano.lista.map((i) => <li key={i.nItem} data-testid={`importacao-criar-produtos-item-${i.nItem}`}>
          <Checkbox testId={`importacao-criar-produtos-item-${i.nItem}-marcado`} rotulo={`Item ${i.nItem} — ${i.descricao} — ${i.unidade}`} marcado={!desmarcados.has(i.nItem)}
            desabilitado={enviando} onMudar={(x) => marcar(i.nItem, x)} />
        </li>)}
      </ul>
      {plano.fora.length > 0 && <div className="flex flex-col gap-2">
        <span className="text-[12px] text-amber-800">Ficam de fora (a unidade da nota não corresponde a uma unidade do cadastro — crie pelo item):</span>
        <ul className="ml-4 list-disc text-[12px]">
          {plano.fora.map((i) => <li key={i.nItem} data-testid={`importacao-criar-produtos-fora-${i.nItem}`}>Item {i.nItem} — {i.descricao} — {i.unidade}</li>)}
        </ul>
      </div>}
      <div className="grid grid-cols-12 gap-3">
        <Field label="Grupo" span={6} required>
          <div data-testid="importacao-criar-produtos-grupo">
            <RefSelect resource="product_groups" value={grupoId} filter={{ kind: "analytic" }} disabled={enviando} onChange={(id) => setGrupoId(id ?? "")} />
          </div>
        </Field>
        <Field label="Natureza de custo" span={6} required>
          <div data-testid="importacao-criar-produtos-natureza">
            <RefSelect resource="financial_categories" value={naturezaId} filter={{ kind: "analytic" }} disabled={enviando} onChange={(id) => setNaturezaId(id ?? "")} />
          </div>
        </Field>
      </div>
      {erros.length > 0 && <ul data-testid="importacao-criar-produtos-erro" className="list-disc rounded border border-red-200 bg-red-50 py-2 pl-6 pr-3 text-[12.5px] text-red-800">
        {erros.map((m, k) => <li key={k}>{m}</li>)}
      </ul>}
    </div>
  </Dialog>;
}
