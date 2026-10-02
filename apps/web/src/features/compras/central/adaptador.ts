import { catalogoDaFamilia } from "@agro/domain";
import type { Row } from "@/features/docs/shared";
import type { WsTab } from "@/lib/workspace-tabs";
import { useAuth } from "@/lib/auth";
import type {
  AdaptadorDaCentral, ChaveColunaDoItem, ColunasDosItens, DocumentoAberto, FonteDoNovoDocumento, FonteDosDocumentosAbertos
} from "@/features/central/contrato";
import { LIMITE_DO_MOTIVO } from "@/features/central/contrato";
import { chaveDaCopiaPadrao } from "@/features/central/duplicar-memoria";
import { chaveDepoisDeSalvar } from "@/features/central/salvo";
import { linhasDoGrupo, linhasDoMenuRapido } from "@/features/sales/launcher-operacoes";
import { rotaDoDocumento } from "../documentos-compra-list";
import { useTopsDaEspecie, variantesDeCompra, type VarianteDeCompra } from "../variantes";

/**
 * O ADAPTADOR DA CENTRAL DE COMPRAS (VISUAL-UX-04, decisão 276) — tudo o que o motor (`@/features/central`) precisa
 * saber da compra e não pode conhecer por nome. Só apresentação: rotas e portas são as de sempre
 * (`/compras/<segmento>/…`, `/api/compras/<segmento>/…`); nenhuma porta nova.
 */

/** Prefixo dos testids do MOTOR na Central de Compras (os `compras-*` de hoje continuam nos elementos equivalentes). */
export const PREFIXO_CENTRAL_COMPRAS = "central-compras";

/** Entidade auditada do histórico (HistoryDialog, `audit_logs.view`). */
export const ENTIDADE_DO_HISTORICO_DE_COMPRA = "documentos_compra";

/** Cancelamento da compra: motivo opcional; vazio → corpo SEM motivo. */
export const MOTIVO_VAZIO_DA_COMPRA = "";

/** O corpo do `/cancel`: `{ motivo }` aparado (1–500); vazio → `{}` (a chave não viaja). */
export function corpoDoCancelamento(motivo: string): { motivo?: string } {
  const m = motivo.trim();
  if (!m) return {};
  return { motivo: m.slice(0, LIMITE_DO_MOTIVO) };
}

/* ── documentos abertos ── */

const segmentosDeCompra = () => new Set(variantesDeCompra().map((v) => v.segmento));

/** A aba é um documento de compras? `/compras/<seg>/new` (criação) ou `/compras/<seg>/<id>` (registro). */
function documentoDaAba(aba: WsTab): DocumentoAberto | null {
  if (aba.kind !== "new" && aba.kind !== "detail") return null;
  const m = /^\/compras\/([^/]+)\/([^/]+)$/.exec(aba.key);
  if (!m || !segmentosDeCompra().has(m[1]!)) return null;
  if (aba.kind === "new") return { aba, porta: null, novo: true };
  return { aba, porta: `/api/compras/${m[1]}/${m[2]}`, novo: false };
}

/** A barra de abas vista como documentos de compras; a contraparte é o fornecedor (`fornecedor_nome`). */
export const fonteDosDocumentosDeCompras: FonteDosDocumentosAbertos = {
  documentoDaAba,
  campoDaContraparte: "fornecedor_nome",
  sufixoTestidDaContraparte: "fornecedor"
};

/* ── itens ── */

/** Chave do catálogo de compras ↔ coluna do motor. */
const DO_CATALOGO: Readonly<Record<string, ChaveColunaDoItem>> = {
  codigo: "codigo", produto_id: "produto", armazem_id: "armazem", quantidade: "quantidade", valor_unitario: "unitario",
  desconto: "desconto", desconto_percentual: "descontoPercentual", lote: "lote", validade: "validade", total: "total"
};

/** Colunas dos itens da espécie: `doSistema` pelo catálogo da família (COMPRAS-03). */
export function colunasDosItensDeCompras(variante: VarianteDeCompra): ColunasDosItens {
  return {
    doSistema: new Set(catalogoDaFamilia(variante.familia).filter((c) => c.parte === "itens" && c.sistema).map((c) => c.chave)),
    doCatalogo: DO_CATALOGO,
    leitura: ["codigo", "produto", "armazem", "quantidade", "unitario", "desconto", "descontoPercentual", "total"]
  };
}

/* ── novo documento por TOP ── */

/** Rota do novo documento com a TOP (a página RECONFERE a TOP contra a lista da espécie). */
export const rotaDaNovaCompra = (segmento: string, tipoOperacaoId: string) =>
  `/compras/${segmento}/new?tipo_operacao_id=${encodeURIComponent(tipoOperacaoId)}`;

export function fonteDoNovoDocumentoDeCompra(variante: VarianteDeCompra, rotulo: string): FonteDoNovoDocumento {
  return {
    useLinhas: () => {
      const { can } = useAuth();
      const habilitado = can(`${variante.perm}.create`);
      const estado = useTopsDaEspecie(variante.segmento, habilitado);
      const todas = linhasDoGrupo({ variante, rotulo, habilitado, estado });
      return { carregando: habilitado && estado.situacao === "carregando", todas, doMenu: linhasDoMenuRapido(todas) };
    },
    rotulo,
    rotaDaTop: (linha) => rotaDaNovaCompra(variante.segmento, linha.id),
    rotaDoLancador: `/compras/${variante.segmento}/new`
  };
}

/* ── chaves e links ── */

export const linkDoTituloDeCompra = (titulo: Row) => `/financeiro/contas-a-pagar/${String(titulo["id"] ?? "")}`;
/** `central-compras:salvo:<id>`. */
export const chaveDepoisDeSalvarDeCompra = chaveDepoisDeSalvar(PREFIXO_CENTRAL_COMPRAS);
/** `central-compras:copia:<segmento>`. */
export const chaveDaCopiaDeCompra = chaveDaCopiaPadrao(PREFIXO_CENTRAL_COMPRAS);

/* ── o adaptador inteiro ── */

export function adaptadorDaCentralDeCompras(variante: VarianteDeCompra, rotulo: string): AdaptadorDaCentral {
  const seg = variante.segmento;
  return {
    prefixoTestid: PREFIXO_CENTRAL_COMPRAS,
    segmento: seg,
    rotas: {
      lista: "/compras?tab=documentos",
      nova: `/compras/${seg}/new`,
      registro: (id) => `/compras/${seg}/${id}`,
      porta: (id) => `/api/compras/${seg}/${id}`
    },
    textos: {
      tituloDaCriacao: `Novo documento · ${rotulo}`,
      tituloDaLeituraPendente: "Documento de compra",
      confirmar: "Confirmar compra",
      especieMinuscula: rotulo.toLowerCase(),
      legendaDosTitulos: "Contas a pagar do documento"
    },
    documentosAbertos: fonteDosDocumentosDeCompras,
    novoDocumento: fonteDoNovoDocumentoDeCompra(variante, rotulo),
    colunasDosItens: colunasDosItensDeCompras(variante),
    entidadeDoHistorico: ENTIDADE_DO_HISTORICO_DE_COMPRA,
    linkDoTitulo: linkDoTituloDeCompra,
    linkDoDerivado: (d) => rotaDoDocumento({ id: d["id"], especie: "compra" }),
    chaveDoSalvo: chaveDepoisDeSalvarDeCompra,
    chaveDaCopia: chaveDaCopiaDeCompra
  };
}
