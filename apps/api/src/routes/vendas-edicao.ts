import type { FastifyInstance } from "fastify";
import { DomainError } from "@agro/shared";
import { FORMA_UUID_PADRAO, familiaOperacionalDeDocumentoVenda, type SalesKind, type SituacaoClienteResposta } from "@agro/domain";
import type { ServiceCtx } from "../lib/context.js";
import { runService } from "../lib/service.js";
import { notFound } from "../lib/errors.js";
import { respostaDoLayoutEfetivo, type LayoutEfetivoDaCentral } from "../lib/layout-documento.js";
import { recusaDaEdicao, limitesDaEdicao, type LimitesDaEdicao } from "./vendas-edicao-regras.js";
import { regrasDaVersaoCongelada, respostaDasRegrasDaOperacao, type RegrasDaOperacaoDaVenda, type RegrasDaVersaoTop } from "./vendas-regras-operacao.js";
import { respostaDaSituacaoCliente } from "./vendas-atraso-cliente.js";

/** Dependências que moram em `sales.ts` e chegam por parâmetro: sem import circular entre as rotas. */
export interface DependenciasDaEdicao {
  getDoc: (ctx: ServiceCtx, id: string, expectedKind: SalesKind, opts?: { lock?: boolean }) => Promise<Record<string, unknown>>;
}

/** O que esta rota lê do documento carregado pelo GET (`d.*` + `reserva_estoque` da versão congelada + itens). */
type DocumentoDaEdicao = {
  id: string; status: string; client_id: string;
  tipo_operacao_id: string | null; tipo_operacao_versao_id: string | null; origin_document_id: string | null;
  /** bigint (0039): sai do pool como STRING, exatamente como o `GET <base>/:id` a devolve. */
  version: string;
  reserva_estoque: boolean;
  items: { id: string; origem_item_id: string | null; product_control_stock: boolean | null }[];
};

/**
 * A resposta de `GET <base>/:id/edicao`.
 *  - `podeEditar`/`motivo`  → `recusaDaEdicao(..., { exigirTop: true })`: a MESMA pergunta, na MESMA ordem, da PATCH.
 *  - `limites`              → `limitesDaEdicao`: o que uma edição permitida pode tocar (parte gerada, armazém travado).
 *  - `version`              → a do documento, para a PATCH mandar de volta (concorrência otimista).
 *  - `regras`               → o MESMO contrato de `/regras-da-operacao`, pela versão CONGELADA.
 *  - `condicoesPermitidas`  → o MESMO valor de `regras.condicoesPermitidas` (mesma referência; null = todas).
 *  - `layout`               → o MESMO contrato de `/layout-efetivo`, pela TOP do documento (o que a PATCH cobra).
 *  - `situacaoCliente`      → o MESMO contrato de `/situacao-cliente`, para o cliente GRAVADO, pela versão CONGELADA.
 */
export interface EdicaoDoDocumentoDeVenda {
  podeEditar: boolean;
  motivo: string | null;
  limites: LimitesDaEdicao;
  version: string;
  regras: RegrasDaOperacaoDaVenda;
  condicoesPermitidas: string[] | null;
  layout: LayoutEfetivoDaCentral;
  situacaoCliente: SituacaoClienteResposta;
}

/** Documento sem TOP (legado, anterior às operações): nada a ler de versão — a resposta NEUTRA das duas montagens. */
const SEM_VERSAO: { formato: number; regras: RegrasDaVersaoTop | null } = { formato: 0, regras: null };

/**
 * EDITAR-01 (decisão 272, item 1.3) — `GET <base>/:id/edicao`: o que a tela precisa para abrir a edição de um documento
 * JÁ SALVO, numa ida só.
 *
 * POR QUE UMA ROTA PRÓPRIA, e não `/regras-da-operacao` + `/layout-efetivo` + `/situacao-cliente`:
 *  1. PERMISSÃO. As três portas do lançamento pedem `<perm>.create` — quem só EDITA (tem `.edit` sem `.create`) levaria
 *     403 nelas e a tela de edição ficaria sem regra nenhuma. Esta porta pede SÓ `<perm>.edit`, a MESMA da PATCH: quem
 *     pode salvar a edição pode perguntar o que a edição vai cobrar, e nada além disso.
 *  2. VERSÃO. As portas do lançamento respondem pela versão ATUAL da TOP escolhida; a PATCH cobra pela versão
 *     CONGELADA do documento (`tipo_operacao_versao_id`), a versão em que ele nasceu. Se a tela conferisse pela atual,
 *     uma TOP reconfigurada depois do documento faria a tela exigir o que a PATCH não cobra (ou esconder o que cobra).
 *     Tudo aqui sai da versão congelada — regras, condições, reserva e a política do cliente em atraso. O LAYOUT é a
 *     exceção declarada, e pelo mesmo motivo: a PATCH cobra `layoutEfetivo(familia, tipo_operacao_id)` (o layout
 *     ligado HOJE à TOP do documento), e a tela tem de conferir exatamente isso.
 *  3. O MESMO "PODE EDITAR?" DA PATCH. `recusaDaEdicao` e `limitesDaEdicao` são as funções que a PATCH chama: a tela não
 *     oferece edição que a PATCH recusa, nem esconde edição que ela aceita.
 *
 * FORMA: `regras` e `situacaoCliente` são montados pelas MESMAS funções das portas do lançamento
 * (`respostaDasRegrasDaOperacao`, `respostaDaSituacaoCliente`), e `layout` por `respostaDoLayoutEfetivo` — a tela lê os
 * blocos com os mesmos leitores, e o formato não diverge entre as portas.
 *
 * EXISTÊNCIA: quem carrega é o `getDoc` do GET — inexistente, de outro tenant, fora do escopo de empresa, excluído e
 * de outra variante caem na MESMA 404 do `GET <base>/:id` (mesmo código, mesma mensagem). Id MALFORMADO também: a
 * forma é conferida aqui ANTES do SQL, porque o `getDoc` o passa direto a uma coluna `uuid` e o Postgres responde
 * 22P02, que vira 500 — malformado ficaria distinguível de inexistente. Sem `<perm>.edit` → 403 do `runService`, antes
 * de qualquer leitura (não revela existência).
 *
 * LEITURA PURA, SEM LOCK: nada aqui grava, e travar a linha só para responder seria disputar com a PATCH. O número de
 * consultas é fixo (o GET + partes + reserva da origem + versão + layout + atraso) — nenhuma por item.
 */
export function registrarEdicaoDeVenda(app: FastifyInstance, kind: SalesKind, base: string, perm: string, deps: DependenciasDaEdicao): void {
  app.get(`${base}/:id/edicao`, async (req) => runService(app, req, `${perm}.edit`, async (ctx): Promise<EdicaoDoDocumentoDeVenda> => {
    // Fail-closed como a criação (`familiaDaVariante` em sales.ts): variante sem família declarada não responde layout.
    const familia = familiaOperacionalDeDocumentoVenda(kind);
    if (!familia) throw new DomainError("TIPO_OPERACAO_INDISPONIVEL", "Tipo de operação indisponível para este lançamento", { kind });
    const id = (req.params as { id: string }).id;
    if (!FORMA_UUID_PADRAO.test(id)) throw notFound("Documento"); // a MESMA 404 que o `getDoc` lança
    const doc = (await deps.getDoc(ctx, id, kind)) as Record<string, unknown> & DocumentoDaEdicao;
    const motivo = await recusaDaEdicao(ctx, doc, { exigirTop: true });
    const limites = await limitesDaEdicao(ctx, kind, doc);
    // A versão CONGELADA (0021: `tipo_operacao_id` e `tipo_operacao_versao_id` são nulos juntos ou preenchidos juntos).
    const congelada = doc.tipo_operacao_versao_id ? await regrasDaVersaoCongelada(ctx, doc.tipo_operacao_versao_id) : SEM_VERSAO;
    // `reserva_estoque` do GET já é o da versão CONGELADA (e só pedido pode ser true) — a mesma regra de `/regras-da-operacao`.
    const regras = respostaDasRegrasDaOperacao(congelada, kind === "order" && doc.reserva_estoque === true);
    // Sem TOP → `null` → layout do SISTEMA (o mesmo que a PATCH usaria; ela recusa antes, mas a tela mostra o documento).
    const layout = await respostaDoLayoutEfetivo(ctx, familia, doc.tipo_operacao_id);
    // O cliente GRAVADO, pela política da versão congelada. Sem regras do formato 3 → `nao_valida`, sem consultar o atraso.
    const situacaoCliente = await respostaDaSituacaoCliente(ctx, congelada.regras, doc.client_id);
    return { podeEditar: motivo === null, motivo, limites, version: doc.version, regras, condicoesPermitidas: regras.condicoesPermitidas, layout, situacaoCliente };
  }));
}
