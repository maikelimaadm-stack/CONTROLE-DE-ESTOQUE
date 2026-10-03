import { catalogoDaFamilia, type ColunaDoLayout, type EspecieEstoque } from "@agro/domain";
import type { WsTab } from "@/lib/workspace-tabs";
import { useAuth } from "@/lib/auth";
import type {
  AdaptadorDaCentral, ChaveColunaDoItem, ColunasDosItens, DocumentoAberto, FonteDoNovoDocumento, FonteDosDocumentosAbertos, PesquisaDeProdutoDosItens
} from "@/features/central/contrato";
import { LIMITE_DO_MOTIVO } from "@/features/central/contrato";
import { chaveDaCopiaPadrao } from "@/features/central/duplicar-memoria";
import { chaveDepoisDeSalvar } from "@/features/central/salvo";
import { linhasDoGrupo, linhasDoMenuRapido } from "@/features/sales/launcher-operacoes";
import { rotaDeLancamentoDeEstoque, todasAsVariantesDeEstoque, useTopsDaEspecieEstoque, type VarianteDeEstoque } from "../movimentacoes-variantes";
import type { FormaDaEspecieNaCentral } from "./forma";

/**
 * O ADAPTADOR DA CENTRAL DE ESTOQUE (OPERACOES-01 F5b, decisão 282) — tudo o que o motor (`@/features/central`)
 * precisa saber do documento de estoque e não pode conhecer por nome. Só apresentação: as rotas e as portas são as da
 * ESTOQUE-01 e da F5a (`/estoque/movimentacoes/<segmento>/…`, `/api/estoque/<segmento>/…`); nenhuma porta nova aqui.
 * O molde é o adaptador da Central de Compras (`features/compras/central/adaptador.ts`).
 */

/** Prefixo dos testids do MOTOR na Central de Estoque (os `estoque-*` de antes continuam nos elementos equivalentes). */
export const PREFIXO_CENTRAL_ESTOQUE = "central-estoque";

/** Entidade auditada do histórico (HistoryDialog, `audit_logs.view`). */
export const ENTIDADE_DO_HISTORICO_DE_ESTOQUE = "documentos_estoque";

/** Cancelamento do documento de estoque: motivo opcional; vazio → corpo SEM motivo (o servidor grava o padrão). */
export const MOTIVO_VAZIO_DO_ESTOQUE = "";

/** O corpo do `/cancelar`: `{ motivo }` aparado (1–500); vazio → `{}` (a chave não viaja — o contrato é estrito). */
export function corpoDoCancelamento(motivo: string): { motivo?: string } {
  const m = motivo.trim();
  if (!m) return {};
  return { motivo: m.slice(0, LIMITE_DO_MOTIVO) };
}

/** A lista de onde a Central de Estoque sai (Cancelar do lançador, Voltar). */
export const LISTA_DO_ESTOQUE = "/estoque?tab=movimentacoes";

/* ── documentos abertos ── */

const segmentosDeEstoque = () => new Set(todasAsVariantesDeEstoque().map((v) => v.segmento));

/** A aba é um documento de estoque? `/estoque/movimentacoes/<seg>/new` (criação) ou `/estoque/movimentacoes/<seg>/<id>`. */
function documentoDaAba(aba: WsTab): DocumentoAberto | null {
  if (aba.kind !== "new" && aba.kind !== "detail") return null;
  const m = /^\/estoque\/movimentacoes\/([^/]+)\/([^/]+)$/.exec(aba.key);
  if (!m || !segmentosDeEstoque().has(m[1]!)) return null;
  if (aba.kind === "new") return { aba, porta: null, novo: true };
  return { aba, porta: `/api/estoque/${m[1]}/${m[2]}`, novo: false };
}

/**
 * A barra de abas vista como documentos de estoque, das SETE espécies (o documento que existe se abre; quem decide se o
 * usuário o vê é o servidor). A contraparte é o Local de estoque (`armazem_nome`): o documento de estoque não tem
 * parceiro.
 */
export const fonteDosDocumentosDeEstoque: FonteDosDocumentosAbertos = {
  documentoDaAba,
  campoDaContraparte: "armazem_nome",
  sufixoTestidDaContraparte: "local"
};

/* ── itens ── */

/** A coluna do motor de cada chave do catálogo do estoque (a quantidade é a da espécie: a contada, no ajuste). */
function doCatalogoDaEspecie(especie: EspecieEstoque): Readonly<Record<string, ChaveColunaDoItem>> {
  return Object.freeze({
    codigo: "codigo", produto_id: "produto", estoque: "estoque",
    [especie === "ajuste" ? "quantidade_contada" : "quantidade"]: "quantidade",
    custo_unitario: "unitario", lote: "lote", validade: "validade"
  });
}

/**
 * Colunas dos itens da espécie: `doSistema` pelo catálogo da família (domínio, F5b), `doCatalogo` POR ESPÉCIE (o ajuste
 * mapeia a quantidade CONTADA) e a ordem da consulta (`leitura`). A requisição não tem custo: sem a coluna do unitário.
 * Desconto, desconto % e total nunca aparecem — o documento de estoque não tem valor.
 */
export function colunasDosItensDeEstoque(variante: VarianteDeEstoque): ColunasDosItens {
  const especie = variante.variante as EspecieEstoque;
  return {
    doSistema: new Set(catalogoDaFamilia(variante.familia).filter((c) => c.parte === "itens" && c.sistema).map((c) => c.chave)),
    doCatalogo: doCatalogoDaEspecie(especie),
    leitura: especie === "requisicao" ? ["codigo", "produto", "estoque", "quantidade"] : ["codigo", "produto", "estoque", "quantidade", "unitario"]
  };
}

/** A posição de cada coluna no layout do sistema da família (a régua para pôr de volta uma coluna forçada). */
const posicaoNoSistema = (sistema: readonly ColunaDoLayout[], campo: string) => sistema.findIndex((c) => c.campo === campo);

/**
 * AS COLUNAS QUE O MOTOR DESENHA — sempre um layout (decisão D3 do plano): o da TOP (com a capacidade e a resposta
 * conferida) ou o do sistema da família (domínio). Cada coluna leva o rótulo do layout OU o do catálogo — é assim que
 * aparecem "Custo unitário", "Quantidade contada" e "Disponível". O que a FORMA da espécie não aceita sai (o custo do
 * ajuste sem a capacidade da movimentação interna, por exemplo). Lote e validade que o produto exige e o layout
 * esconde voltam na posição do sistema (`forcadas`): esconder um campo que o servidor vai cobrar faria o Salvar
 * recusar algo invisível. O custo obrigatório (a entrada sem a capacidade) leva o "*".
 */
export function colunasDoLayoutDoEstoque(familia: string, forma: FormaDaEspecieNaCentral, itensDoLayout: readonly ColunaDoLayout[], forcadas: readonly ("lote" | "validade")[]): ColunaDoLayout[] {
  const catalogo = new Map(catalogoDaFamilia(familia).filter((c) => c.parte === "itens").map((c) => [c.chave, c]));
  const aceita = (campo: string) => {
    if (!catalogo.has(campo)) return false;
    if (campo === "custo_unitario") return forma.custo !== "nenhum";
    if (campo === "lote") return forma.lote;
    if (campo === "validade") return forma.validade;
    return true;
  };
  const lista: ColunaDoLayout[] = itensDoLayout.filter((c) => aceita(c.campo)).map((c) => ({ ...c }));
  const sistema = catalogoDaFamilia(familia).filter((c) => c.parte === "itens").map((c): ColunaDoLayout => ({ campo: c.chave, obrigatorio: Boolean(c.sistema) }));
  for (const campo of forcadas) {
    if (!aceita(campo) || lista.some((c) => c.campo === campo)) continue;
    const minha = posicaoNoSistema(sistema, campo);
    let pos = 0;
    lista.forEach((c, i) => { if (posicaoNoSistema(sistema, c.campo) < minha) pos = i + 1; });
    lista.splice(pos, 0, { campo, obrigatorio: false });
  }
  return lista.map((c) => ({
    campo: c.campo,
    obrigatorio: c.obrigatorio || (c.campo === "custo_unitario" && forma.custo === "obrigatorio"),
    rotulo: c.rotulo || catalogo.get(c.campo)?.rotulo
  }));
}

/* ── pesquisa de produto (pedido M7 da F3b) ── */

/** Entrada, ajuste e devolução de consumo: aparece tudo, com o saldo do local; só produto que controla estoque. */
export const PESQUISA_DE_PRODUTO_DA_ENTRADA_DE_ESTOQUE: PesquisaDeProdutoDosItens = Object.freeze({ sentido: "entrada", soControlaEstoque: true });
/** Saída, transferência, requisição e consumo: "Só com saldo neste local" ligado; só produto que controla estoque. */
export const PESQUISA_DE_PRODUTO_DA_SAIDA_DE_ESTOQUE: PesquisaDeProdutoDosItens = Object.freeze({ sentido: "saida", soControlaEstoque: true });

/** A coluna Estoque da requisição mostra o DISPONÍVEL (a régua da confirmação dela); nenhum campo de item obrigatório a mais. */
export const RESERVA_DA_REQUISICAO: { obrigatorias: readonly string[] } = Object.freeze({ obrigatorias: Object.freeze([]) });

/* ── novo documento por TOP ── */

export function fonteDoNovoDocumentoDeEstoque(variante: VarianteDeEstoque, rotulo: string): FonteDoNovoDocumento {
  return {
    useLinhas: () => {
      const { can } = useAuth();
      const habilitado = can(`${variante.perm}.create`);
      const estado = useTopsDaEspecieEstoque(variante.segmento, habilitado);
      const todas = linhasDoGrupo({ variante, rotulo, habilitado, estado });
      return { carregando: habilitado && estado.situacao === "carregando", todas, doMenu: linhasDoMenuRapido(todas) };
    },
    rotulo,
    rotaDaTop: (linha) => rotaDeLancamentoDeEstoque({ segmento: variante.segmento, id: linha.id }),
    rotaDoLancador: `/estoque/movimentacoes/${variante.segmento}/new`
  };
}

/* ── chaves e links ── */

/** `central-estoque:salvo:<id>`. */
export const chaveDepoisDeSalvarDeEstoque = chaveDepoisDeSalvar(PREFIXO_CENTRAL_ESTOQUE);
/** `central-estoque:copia:<segmento>`. */
export const chaveDaCopiaDeEstoque = chaveDaCopiaPadrao(PREFIXO_CENTRAL_ESTOQUE);

/* ── o adaptador inteiro ── */

export function adaptadorDaCentralDeEstoque(variante: VarianteDeEstoque, rotulo: string): AdaptadorDaCentral {
  const seg = variante.segmento;
  return {
    prefixoTestid: PREFIXO_CENTRAL_ESTOQUE,
    segmento: seg,
    rotas: {
      lista: LISTA_DO_ESTOQUE,
      nova: `/estoque/movimentacoes/${seg}/new`,
      registro: (id) => `/estoque/movimentacoes/${seg}/${encodeURIComponent(id)}`,
      porta: (id) => `/api/estoque/${seg}/${encodeURIComponent(id)}`
    },
    textos: {
      tituloDaCriacao: `Novo documento · ${rotulo}`,
      tituloDaLeituraPendente: "Documento de estoque",
      confirmar: `Confirmar ${rotulo.toLowerCase()}`,
      especieMinuscula: rotulo.toLowerCase(),
      legendaDosTitulos: ""
    },
    documentosAbertos: fonteDosDocumentosDeEstoque,
    novoDocumento: fonteDoNovoDocumentoDeEstoque(variante, rotulo),
    colunasDosItens: colunasDosItensDeEstoque(variante),
    entidadeDoHistorico: ENTIDADE_DO_HISTORICO_DE_ESTOQUE,
    // o documento de estoque não gera título financeiro
    linkDoTitulo: () => "",
    chaveDoSalvo: chaveDepoisDeSalvarDeEstoque,
    chaveDaCopia: chaveDaCopiaDeEstoque
  };
}
