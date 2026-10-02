import { CATALOGO_VENDAS } from "@agro/domain";
import type { Row } from "@/features/docs/shared";
import type { WsTab } from "@/lib/workspace-tabs";
import type {
  AdaptadorDaCentral, ChaveColunaDoItem, ColunasDosItens, DocumentoAberto, FonteDoNovoDocumento, FonteDosDocumentosAbertos
} from "@/features/central/contrato";
import { chaveDaCopiaPadrao } from "@/features/central/duplicar-memoria";
import { chaveDepoisDeSalvar as chaveDepoisDeSalvarDoMotor } from "@/features/central/salvo";
import { useTopsDaVariante } from "./tipo-operacao-select";
import { linhasDoGrupo, linhasDoMenuRapido, rotaDeLancamento } from "./launcher-operacoes";
import { variantesDeVenda, type VarianteDeVenda } from "./variantes";

/**
 * O ADAPTADOR DA CENTRAL DE VENDAS (VISUAL-UX-04) — tudo o que o motor (`@/features/central`) precisa saber da venda e
 * não pode conhecer por nome. Os valores são EXATAMENTE os que estavam fixos no código da Central de Vendas: o prefixo
 * dos testids, as rotas e portas de `/api/sales`, os textos, o catálogo de itens de vendas, o `reason` do cancelamento
 * com "Cancelado pelo usuário", as chaves em memória do "Salvo" e da cópia. A venda continua idêntica.
 */

/** Prefixo de TODOS os testids da Central de Vendas. */
export const PREFIXO_CENTRAL_VENDAS = "central-vendas";

/** O motivo padrão do cancelamento — o texto que a tela sempre mandou quando ninguém escreveu outro. */
export const MOTIVO_PADRAO_DO_CANCELAMENTO = "Cancelado pelo usuário";

/* ── documentos abertos ── */

/** Segmentos de documento de venda (`/vendas/<segmento>/<id>`) — derivados das variantes do registry, não listados aqui. */
const segmentosDeVenda = () => new Set(variantesDeVenda().map((v) => v.segmento));

/** A aba é um documento de vendas? Criação (`/vendas/<seg>/new`) ou registro (`/vendas/<seg>/<id>`) de uma variante conhecida. */
function documentoDaAba(aba: WsTab): DocumentoAberto | null {
  if (aba.kind !== "new" && aba.kind !== "detail") return null;
  const m = /^\/vendas\/([^/]+)\/([^/]+)$/.exec(aba.key);
  if (!m || !segmentosDeVenda().has(m[1]!)) return null;
  if (aba.kind === "new") return { aba, porta: null, novo: true };
  return { aba, porta: `/api/sales/${m[1]}/${m[2]}`, novo: false };
}

/** A barra de abas vista como documentos de vendas; a contraparte é o cliente (`client_name`). */
export const fonteDosDocumentosDeVendas: FonteDosDocumentosAbertos = {
  documentoDaAba,
  campoDaContraparte: "client_name",
  sufixoTestidDaContraparte: "cliente"
};

/* ── itens ── */

/**
 * As colunas dos itens da venda. `doSistema`: o catálogo de VENDAS pelo nome (COMPRAS-03, decisão 269) — as colunas
 * do sistema não levam "*" na grade. `doCatalogo`: a chave do catálogo ↔ a coluna da Central, a de sempre.
 */
const DO_CATALOGO: Readonly<Record<string, ChaveColunaDoItem>> = {
  codigo: "codigo", product_id: "produto", warehouse_id: "armazem", estoque: "estoque", quantity: "quantidade",
  unit_price: "unitario", discount: "desconto", discount_percent: "descontoPercentual", total: "total"
};
export const colunasDosItensDeVendas: ColunasDosItens = {
  doSistema: new Set(CATALOGO_VENDAS.filter((c) => c.parte === "itens" && c.sistema).map((c) => c.chave)),
  doCatalogo: DO_CATALOGO,
  leitura: ["codigo", "produto", "armazem", "estoque", "quantidade", "unitario", "desconto", "descontoPercentual", "total"]
};

/* ── novo documento ── */

/**
 * O menu "Novo documento" da variante: as TOPs que o SERVIDOR lista (`/operation-types`, a mesma consulta e a mesma
 * chave de cache do lançador), no corte do menu rápido do portal. A rota é a do lançamento (`rotaDeLancamento`), que a
 * página de criação RECONFERE.
 */
export function fonteDoNovoDocumentoDeVenda(variante: VarianteDeVenda, rotulo: string): FonteDoNovoDocumento {
  return {
    useLinhas: () => {
      const estado = useTopsDaVariante(variante.segmento);
      const todas = linhasDoGrupo({ variante, rotulo, habilitado: true, estado });
      return { carregando: estado.situacao === "carregando", todas, doMenu: linhasDoMenuRapido(todas) };
    },
    rotulo,
    rotaDaTop: (linha) => rotaDeLancamento({ ...linha, segmento: variante.segmento, familia: variante.familia, rotuloDoTipo: rotulo }),
    rotaDoLancador: `/vendas/${variante.segmento}/new`
  };
}

/* ── o adaptador inteiro ── */

/** O adaptador da Central de Vendas para uma variante (o rótulo humano da variante vem do tradutor, na página). */
export function adaptadorDaCentralDeVendas(variante: VarianteDeVenda, rotulo: string): AdaptadorDaCentral {
  return {
    prefixoTestid: PREFIXO_CENTRAL_VENDAS,
    segmento: variante.segmento,
    rotas: {
      lista: `/vendas/${variante.segmento}`,
      nova: `/vendas/${variante.segmento}/new`,
      registro: (id) => `/vendas/${variante.segmento}/${id}`,
      porta: (id) => `/api/sales/${variante.segmento}/${id}`
    },
    textos: {
      tituloDaCriacao: `Nova ${rotulo}`,
      tituloDaLeituraPendente: "Documento de venda",
      confirmar: "Confirmar venda",
      especieMinuscula: rotulo.toLowerCase(),
      legendaDosTitulos: "Contas a receber do documento"
    },
    documentosAbertos: fonteDosDocumentosDeVendas,
    novoDocumento: fonteDoNovoDocumentoDeVenda(variante, rotulo),
    colunasDosItens: colunasDosItensDeVendas,
    entidadeDoHistorico: "sales_documents",
    linkDoTitulo: linkDoTituloDeVenda,
    linkDoDerivado: linkDoDerivadoDeVenda,
    chaveDoSalvo: chaveDepoisDeSalvarDeVenda,
    chaveDaCopia: chaveDaCopiaDeVenda,
    cancelamento: { chaveDoMotivo: "reason", motivoVazio: MOTIVO_PADRAO_DO_CANCELAMENTO }
  };
}

/** O título financeiro da venda é uma conta a receber. */
export const linkDoTituloDeVenda = (titulo: Row) => `/financeiro/contas-a-receber/${titulo["id"]}`;
/** O derivado (pedido, orçamento) abre na rota da variante DELE. */
export const linkDoDerivadoDeVenda = (derivado: Row) => `/vendas/${derivado["kind"]}s/${derivado["id"]}`;
/** `central-vendas:salvo:<id>` — a chave de sempre. */
export const chaveDepoisDeSalvarDeVenda = chaveDepoisDeSalvarDoMotor(PREFIXO_CENTRAL_VENDAS);
/** `central-vendas:copia:<segmento>` — a chave de sempre. */
export const chaveDaCopiaDeVenda = chaveDaCopiaPadrao(PREFIXO_CENTRAL_VENDAS);
