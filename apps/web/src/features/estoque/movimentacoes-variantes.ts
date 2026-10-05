"use client";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTradutor } from "@/lib/i18n";
import {
  ESPECIES_DOCUMENTO_ESTOQUE, RECURSO_DA_ESPECIE_ESTOQUE, SEGMENTO_DA_ESPECIE_ESTOQUE, TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE,
  chaveI18nDaFamiliaOperacional, entendeMovimentacaoInterna, entendeSaldoInicialEstoque, especieDoSegmentoEstoque,
  familiaOperacionalDeDocumentoEstoque, type EspecieEstoque
} from "@agro/domain";
import type { Row } from "@/features/docs/shared";
import { ehTopsDaVariante, estadoDeTops, podeLancar, type EstadoTop } from "@/features/sales/tipo-operacao-select";
import type { GrupoDeTops, VarianteDeVenda } from "@/features/sales/variantes";
import {
  CHAVES_PREENCHIMENTO_SALDO,
  parametrosDoPreenchimentoSaldo,
  preenchimentoDaUrlDeEstoque as preenchimentoDaUrlPuro,
  rotaDoAjusteAPartirDoSaldo as rotaDoAjustePura,
  type PreenchimentoSaldo
} from "./central/preenchimento-saldo";

/**
 * AS ESPÉCIES DO DOCUMENTO DE ESTOQUE QUE O PORTAL DE ESTOQUE SABE LANÇAR (ESTOQUE-01, decisão 274; OPERACOES-01 F5b,
 * decisão 282).
 *
 * Nenhuma lista de espécie, segmento, permissão ou família mora aqui. As SETE espécies (as quatro de antes e as três da
 * movimentação interna: requisição, consumo e devolução de consumo), o segmento da URL (`entradas`, `requisicoes`…) e
 * o recurso de permissão (`entradas_estoque`…) são do domínio (`estoque-documento.ts`); a FAMÍLIA é perguntada ao
 * registry de TOPs (`familiaOperacionalDeDocumentoEstoque`, a variante de `erp.documentos_estoque` pela coluna
 * `especie`). Espécie que o registry não declara não aparece (fail-closed): o portal não oferece o que não sabe
 * classificar.
 *
 * ┌─ RESOLVER × OFERECER (F5b) ───────────────────────────────────────────────────────────────────────────────────────┐
 * │ RESOLVER uma espécie (o valor gravado na linha, o segmento da rota) vale para as SETE, sempre: é o que liga o     │
 * │ link do ID Global, a rota do documento, a fila de Aprovações e as páginas `[especie]/new|[id]`. O documento que │
 * │ existe se abre; quem decide se o usuário pode vê-lo é o servidor.                                                │
 * │ OFERECER uma espécie (chip da lista, grupo do "+ Novo") depende da API: as três novas só quando ela declara      │
 * │ `capacidades.movimentacaoInterna` no `operation-types` (`entendeMovimentacaoInterna`, domínio). Sem a            │
 * │ declaração (a API de antes, no skew), as quatro de hoje, como hoje. Por isso `variantesDeEstoque` exige o       │
 * │ parâmetro: todo chamador decide, e nenhum esquece a capacidade por omissão.                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A forma é a MESMA de `VarianteDeVenda` (`variante` = a espécie), como em Compras, para o lançador
 * (`NovoDocumentoPorTop`) e o grupo de TOPs servirem aos três portais sem cópia.
 */
export type VarianteDeEstoque = VarianteDeVenda;

/** As SETE espécies que o registry declara, na ordem do domínio (`TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE`). */
export function todasAsVariantesDeEstoque(): VarianteDeEstoque[] {
  const out: VarianteDeEstoque[] = [];
  for (const especie of TODAS_AS_ESPECIES_DOCUMENTO_ESTOQUE) {
    const familia = familiaOperacionalDeDocumentoEstoque(especie);
    if (!familia) continue;
    out.push({
      variante: especie,
      segmento: SEGMENTO_DA_ESPECIE_ESTOQUE[especie],
      perm: RECURSO_DA_ESPECIE_ESTOQUE[especie],
      familia,
      chaveI18n: chaveI18nDaFamiliaOperacional(familia) ?? familia
    });
  }
  return out;
}

/** As quatro espécies de antes da movimentação interna (`ESPECIES_DOCUMENTO_ESTOQUE`, domínio). */
const ESPECIES_DE_ANTES: ReadonlySet<string> = new Set(ESPECIES_DOCUMENTO_ESTOQUE);

/**
 * As espécies que o portal OFERECE: as sete quando a API declara a movimentação interna, as quatro de antes quando não
 * declara. O parâmetro é obrigatório de propósito (ver o cabeçalho).
 */
export function variantesDeEstoque(comMovimentacaoInterna: boolean): VarianteDeEstoque[] {
  const todas = todasAsVariantesDeEstoque();
  return comMovimentacaoInterna ? todas : todas.filter((v) => ESPECIES_DE_ANTES.has(v.variante));
}

/** A espécie pelo valor persistido (`especie` da linha), procurada nas SETE. */
export const varianteDeEstoque = (especie: unknown): VarianteDeEstoque | undefined =>
  typeof especie === "string" ? todasAsVariantesDeEstoque().find((v) => v.variante === especie) : undefined;

/** A espécie de um segmento de rota (`entradas` → entrada, `requisicoes` → requisição); `undefined` para segmento que o produto não conhece. */
export const varianteDeEstoquePorSegmento = (segmento: string | null | undefined): VarianteDeEstoque | undefined => {
  const especie = typeof segmento === "string" ? especieDoSegmentoEstoque(segmento) : undefined;
  return especie ? todasAsVariantesDeEstoque().find((v) => v.variante === especie) : undefined;
};

// ─────────────── rotas ───────────────

/**
 * O PREENCHIMENTO da Central em modo criação, pela URL: a origem (`?origem=<id>`: o consumo de uma requisição, a
 * devolução de um consumo) e a empresa, o Local de estoque, o produto e o lote (o ajuste a partir do Saldo). É PEDIDO,
 * nunca autorização: a Central o confere contra o que o servidor devolve, e o servidor confere de novo ao gravar.
 * Esta é a lista das chaves; o lançador que as preserva e a Central que as lê usam a mesma.
 */
/** Mesma lista canônica do módulo puro (`preenchimento-saldo`) — um só SSOT. */
export const CHAVES_DO_PREENCHIMENTO_DE_ESTOQUE = CHAVES_PREENCHIMENTO_SALDO;
export type ChaveDoPreenchimentoDeEstoque = (typeof CHAVES_DO_PREENCHIMENTO_DE_ESTOQUE)[number];
export type PreenchimentoDoLancamentoDeEstoque = PreenchimentoSaldo;

/** Só os valores não vazios, na ordem das chaves: chave vazia não viaja (a URL não afirma o que ninguém pediu). */
const parametrosDoPreenchimento = parametrosDoPreenchimentoSaldo;

/** O preenchimento que a URL da Central traz (só as chaves conhecidas e não vazias). */
export const preenchimentoDaUrlDeEstoque = preenchimentoDaUrlPuro;

/**
 * A porta da Central em modo criação para uma TOP escolhida no `+ Novo` (ou no lançador da Central). Sem
 * preenchimento, a rota é a de sempre, byte a byte; com ele, as chaves não vazias vão depois da TOP.
 */
export function rotaDeLancamentoDeEstoque(linha: { segmento: string; id: string }, preenchimento?: PreenchimentoDoLancamentoDeEstoque): string {
  const extra = parametrosDoPreenchimento(preenchimento).toString();
  return `/estoque/movimentacoes/${linha.segmento}/new?tipo_operacao_id=${encodeURIComponent(linha.id)}${extra ? `&${extra}` : ""}`;
}

/** A espécie que o "Ajustar estoque" do Saldo lança na Central. */
const ESPECIE_DO_AJUSTE: EspecieEstoque = "ajuste";

/**
 * "AJUSTAR ESTOQUE" A PARTIR DO SALDO (F5b): a Central de ajuste em modo criação, sem TOP (o lançador da Central
 * pergunta qual), com a empresa, o Local de estoque, o produto e o lote DA LINHA DO SALDO (a linha já traz o
 * `empresa_id`, F5a). Só os não vazios: o saldo sem lote não pede lote.
 */
export function rotaDoAjusteAPartirDoSaldo(linha: Row): string {
  return rotaDoAjustePura(linha);
}

/**
 * `/estoque/movimentacoes/<segmento>/<id>` pela ESPÉCIE DA LINHA (o que o servidor classificou), nunca pelo
 * filtro ativo. Espécie desconhecida cai na aba: nada de rota inventada.
 */
export function rotaDoDocumentoEstoque(r: Row): string {
  const v = varianteDeEstoque(r["especie"]);
  return v ? `/estoque/movimentacoes/${v.segmento}/${encodeURIComponent(String(r["id"]))}` : "/estoque?tab=movimentacoes";
}

// ─────────────── TOPs e a capacidade ───────────────

/** A chave de cache das TOPs de uma espécie: a mesma no lançador, no filtro, no Saldo e na Central. */
const chaveTops = (segmento: string) => ["estoque-operation-types", segmento];
/** O corpo CRU (`unknown`): quem lê confere a forma; todas as perguntas da mesma chave guardam o mesmo formato. */
const perguntarTops = (segmento: string) => api<unknown>(`/api/estoque/${segmento}/operation-types`);

/** O bloco `capacidades` de uma resposta CRUA do `operation-types` (`undefined`: nada declarado). */
const capacidadesDaResposta = (dados: unknown): unknown =>
  typeof dados === "object" && dados !== null && !Array.isArray(dados) && "capacidades" in dados ? dados.capacidades : undefined;

/** A resposta declara a movimentação interna? (o leitor estrito do domínio: forma e versão exatas). */
const declaraMovimentacaoInterna = (dados: unknown) => entendeMovimentacaoInterna(capacidadesDaResposta(dados));

/** As TOPs de UMA espécie (Central de Estoque). Mesmo veredito de `estadoDeTops` que vendas e compras usam. */
export function useTopsDaEspecieEstoque(segmento: string, habilitado = true): EstadoTop {
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveTops(segmento),
    queryFn: () => perguntarTops(segmento),
    enabled: habilitado && Boolean(segmento),
    retry: false
  });
  return estadoDeTops({ habilitado: habilitado && Boolean(segmento), carregando: q.isPending, erro: q.error, dados: q.data });
}

/**
 * As perguntas ao `operation-types` das SETE espécies, uma por espécie que o usuário pode LANÇAR (a porta exige
 * `.create`; perguntar sem a capacidade seria um 403 por abertura, sem nada em troca). As três novas são perguntadas
 * também contra a API de antes: é a sonda. Ela responde 404, e o grupo não aparece.
 */
function usePerguntasDeTopsDeEstoque() {
  const { can } = useAuth();
  const variantes = todasAsVariantesDeEstoque();
  const lancaveis = variantes.map((v) => can(`${v.perm}.create`));
  const resultados = useQueries({
    queries: variantes.map((v) => ({
      queryKey: chaveTops(v.segmento),
      queryFn: () => perguntarTops(v.segmento),
      enabled: can(`${v.perm}.create`),
      retry: false
    }))
  });
  return { variantes, lancaveis, resultados };
}

/**
 * A capacidade a partir das respostas: `true` assim que UMA resposta 200 declara a movimentação interna; `false`
 * quando todas as perguntadas terminaram sem a declaração (inclusive com erro: um 404 de rota é a API de antes, não a
 * capacidade) ou quando o usuário não pode lançar nenhuma espécie; `"carregando"` enquanto falta resposta.
 */
function movimentacaoInternaDasRespostas(
  lancaveis: readonly boolean[],
  resultados: readonly { isPending: boolean; data: unknown }[]
): "carregando" | boolean {
  let alguma = false;
  let pendente = false;
  for (const [i, lancavel] of lancaveis.entries()) {
    if (!lancavel) continue;
    alguma = true;
    const r = resultados[i];
    if (r?.data !== undefined && declaraMovimentacaoInterna(r.data)) return true;
    if (!r || r.isPending) pendente = true;
  }
  if (!alguma) return false;
  return pendente ? "carregando" : false;
}

/**
 * A API declara a MOVIMENTAÇÃO INTERNA (F5a/F5b)? Pergunta pelas MESMAS chaves de cache do lançador e da Central
 * (`["estoque-operation-types", <segmento>]`), nas espécies que o usuário pode lançar. Quem só LÊ (não lança nenhuma
 * espécie) recebe `false`: vê as linhas das espécies novas em "Todas", sem o chip próprio; o servidor recorta igual
 * (escolha E1 do plano da F5b).
 */
export function useMovimentacaoInternaNoEstoque(): "carregando" | boolean {
  const { lancaveis, resultados } = usePerguntasDeTopsDeEstoque();
  return movimentacaoInternaDasRespostas(lancaveis, resultados);
}

/**
 * As TOPs das espécies OFERECIDAS, um grupo por espécie: as quatro de antes sempre; as três da movimentação interna
 * só quando a API a declara. Enquanto a capacidade não chega, elas ficam de fora: o portal não oferece o que o servidor
 * ainda não confirmou.
 */
export function useTopsDeEstoque(): GrupoDeTops[] {
  const tr = useTradutor();
  const { variantes, lancaveis, resultados } = usePerguntasDeTopsDeEstoque();
  const comMovimentacaoInterna = movimentacaoInternaDasRespostas(lancaveis, resultados) === true;
  const oferecidas = new Set(variantesDeEstoque(comMovimentacaoInterna).map((v) => v.variante));
  const grupos: GrupoDeTops[] = [];
  variantes.forEach((v, i) => {
    if (!oferecidas.has(v.variante)) return;
    const habilitado = lancaveis[i] === true;
    const r = resultados[i];
    grupos.push({
      variante: v, rotulo: tr(v.chaveI18n), habilitado,
      estado: estadoDeTops({ habilitado, carregando: r?.isPending ?? true, erro: (r?.error as ApiError | null | undefined) ?? null, dados: r?.data })
    });
  });
  return grupos;
}

/**
 * O "Ajustar estoque" do Saldo abre a CENTRAL de ajuste (F5b, escolha E10)? `true` só com `ajustes_estoque.create`,
 * a lista de TOPs de ajuste PRONTA (há TOP para lançar) e a declaração da movimentação interna (é ela que diz que a API
 * aceita o custo no ajuste). `"carregando"` enquanto a pergunta não volta: a ação não aparece, para não oferecer uma
 * porta e trocá-la logo depois. `false` em todo o resto (sem a permissão, API de antes, sem TOP de ajuste, erro): o
 * Saldo usa o diálogo de sempre, se o usuário puder corrigir estoque.
 */
export function useAjusteDoSaldoNaCentral(): "carregando" | boolean {
  const { can } = useAuth();
  const segmento = SEGMENTO_DA_ESPECIE_ESTOQUE[ESPECIE_DO_AJUSTE];
  const habilitado = can(`${RECURSO_DA_ESPECIE_ESTOQUE[ESPECIE_DO_AJUSTE]}.create`);
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveTops(segmento),
    queryFn: () => perguntarTops(segmento),
    enabled: habilitado,
    retry: false
  });
  if (!habilitado) return false;
  const estado = estadoDeTops({ habilitado, carregando: q.isPending, erro: q.error, dados: q.data });
  if (estado.situacao === "carregando") return "carregando";
  return podeLancar(estado) && declaraMovimentacaoInterna(q.data);
}

/** A espécie que lança o SALDO INICIAL pela Central (F11): a entrada. */
const ESPECIE_DO_SALDO_INICIAL: EspecieEstoque = "entrada";

/** Uma TOP de entrada que lança o saldo inicial, como a Implantação a oferece. */
export interface TopDeSaldoInicial { id: string; nome: string }

/** O que a Implantação decide (F11): a API declara o saldo inicial pela TOP? E quais TOPs o lançam. */
export interface SaldoInicialNaCentral { declarada: boolean; tops: TopDeSaldoInicial[] }

/** A resposta de antes (sem a declaração): a Implantação de hoje. */
const semSaldoInicialNaCentral = (): SaldoInicialNaCentral => ({ declarada: false, tops: [] });

/**
 * As TOPs de ENTRADA marcadas com "Lança o saldo inicial", tiradas de UMA resposta CRUA do `operation-types` da entrada.
 * Função pura (a Implantação e o teste chegam ao mesmo veredito): `declarada` só com o contrato das TOPs conferido
 * (`ehTopsDaVariante`) E a capacidade declarada na forma e versão exatas (`entendeSaldoInicialEstoque`); `tops` = os
 * itens com `saldoInicial === true` (booleano PRÓPRIO do item; qualquer outra forma = não marcado). Sem a declaração,
 * nenhuma TOP: a marca de um item não vale sem a capacidade que diz o que ela significa.
 */
export function saldoInicialDaResposta(dados: unknown): SaldoInicialNaCentral {
  if (!ehTopsDaVariante(dados) || !entendeSaldoInicialEstoque(capacidadesDaResposta(dados))) return semSaldoInicialNaCentral();
  const tops: TopDeSaldoInicial[] = [];
  for (const item of dados.items) {
    if (Object.getOwnPropertyDescriptor(item, "saldoInicial")?.value === true) tops.push({ id: item.id, nome: item.name });
  }
  return { declarada: true, tops };
}

/**
 * As TOPs de ENTRADA que lançam o saldo inicial, se a API declara `saldoInicial` (OPERACOES-01 F11, decisão 288). Mesma
 * chave de cache do lançador e da Central (`chaveTops("entradas")`): a Implantação não pergunta duas vezes o que o
 * portal já perguntou. Só pergunta com `entradas_estoque.create` (a porta exige; sem ela, a resposta é a de antes na
 * hora). `"carregando"` enquanto a pergunta não volta — a Implantação não oferece porta nenhuma, para não oferecer uma
 * e trocá-la logo depois. Erro (403, 404 da API anterior, 5xx) ou corpo que não é o contrato → `{ declarada: false }`:
 * a Implantação de hoje.
 */
export function useTopsDeSaldoInicial(): "carregando" | SaldoInicialNaCentral {
  const { can } = useAuth();
  const segmento = SEGMENTO_DA_ESPECIE_ESTOQUE[ESPECIE_DO_SALDO_INICIAL];
  const habilitado = can(`${RECURSO_DA_ESPECIE_ESTOQUE[ESPECIE_DO_SALDO_INICIAL]}.create`);
  const q = useQuery<unknown, ApiError>({
    queryKey: chaveTops(segmento),
    queryFn: () => perguntarTops(segmento),
    enabled: habilitado,
    retry: false
  });
  if (!habilitado) return semSaldoInicialNaCentral();
  if (q.isPending) return "carregando";
  if (q.error || q.data === undefined) return semSaldoInicialNaCentral();
  return saldoInicialDaResposta(q.data);
}

/**
 * Opções do filtro por TOP da lista única, a partir dos grupos já perguntados: a mesma decisão (e a mesma
 * pendência de UX) das listas de vendas e de compras. Só aparecem as TOPs das espécies que o usuário pode
 * LANÇAR, porque a porta de TOPs exige `.create`.
 */
export function opcoesDeTopDeEstoque(grupos: readonly GrupoDeTops[]): { value: string; label: string }[] {
  const vistos = new Set<string>();
  const opcoes: { value: string; label: string }[] = [];
  for (const g of grupos) {
    if (!g.habilitado || !podeLancar(g.estado)) continue;
    for (const top of g.estado.dados.items) {
      if (vistos.has(top.id)) continue;
      vistos.add(top.id);
      opcoes.push({ value: top.id, label: `${top.code} — ${top.name}` });
    }
  }
  return opcoes;
}
