/**
 * CONTRATO CANÔNICO DE EMPRESA E ESCOPO (docs/MULTI-COMPANY-CONTRACT.md).
 *
 * Hierarquia: ORGANIZAÇÃO (tenant/cliente do ERP) › EMPRESA (entidade operacional/jurídica dos registros).
 * Os dois conceitos NUNCA se colapsam: isolamento de tenant é organização; escopo de trabalho é empresa.
 *
 * Módulo puro (sem banco, sem HTTP) e neutro de nicho: é a autoridade de REGRA; a autoridade de DADOS
 * continua no backend (API/RLS). A ponte com a infraestrutura legada que hoje materializa Empresa fica
 * fora deste pacote, em apps/api/src/lib/empresa.ts (docs/DOMAIN-NAMING-STANDARD.md).
 */
import { DomainError } from "@agro/shared";

export type IdEmpresa = string;

/** Empresa como o usuário a vê (identidade + código próprio). */
export interface Empresa {
  id: IdEmpresa;
  /** Código curto e estável dentro da organização (exibido ao usuário). */
  codigo: string | number;
  nome: string;
  ativa?: boolean;
}

/**
 * ESCOPO DE VISUALIZAÇÃO. "Todas as empresas" é um escopo, nunca uma empresa:
 * jamais é persistido em um lançamento (ver `exigirEmpresaPersistivel`).
 */
export type EscopoEmpresa =
  | { tipo: "todas" }
  | { tipo: "uma"; empresaId: IdEmpresa }
  | { tipo: "conjunto"; empresaIds: IdEmpresa[] };

/** Valor reservado usado em filtros/URL para o escopo "todas as empresas autorizadas". */
export const TODAS_EMPRESAS = "todas" as const;
export type TodasEmpresas = typeof TODAS_EMPRESAS;

export const ESCOPO_TODAS_EMPRESAS: EscopoEmpresa = { tipo: "todas" };

/**
 * Autorização do usuário na organização — EXPLÍCITA POR CONTRATO.
 *
 * Não existe sentinela implícita: "todas", "nenhuma" e "um subconjunto" são estados distintos e
 * indistinguíveis por engano. Uma lista vazia significa NENHUMA empresa, nunca "todas" — a convenção
 * inversa do mecanismo legado fica confinada à camada de compatibilidade (apps/api/src/lib/empresa.ts),
 * que traduz antes de entrar aqui. Num sistema multiempresa com autorização estrita, confundir
 * "autorizado a tudo" com "autorizado a nada" é a diferença entre um painel vazio e um vazamento.
 */
export type AutorizacaoEmpresas =
  | { modo: "todas" }
  | { modo: "selecionadas"; empresaIds: readonly IdEmpresa[] };

/** Autorizado a todas as empresas da organização. */
export const TODAS_AS_EMPRESAS: AutorizacaoEmpresas = { modo: "todas" };
/** Autorizado exatamente a estas empresas — lista vazia = nenhuma. */
export const empresasSelecionadas = (empresaIds: readonly IdEmpresa[]): AutorizacaoEmpresas => ({ modo: "selecionadas", empresaIds: [...empresaIds] });

/** Pedido de escopo vindo da borda (query string, cabeçalho, seleção de contexto) — sempre não confiável. */
export interface PedidoEscopoEmpresa {
  /** Empresas pedidas explicitamente. `TODAS_EMPRESAS` = todas as autorizadas. */
  pedidas?: readonly IdEmpresa[] | IdEmpresa | TodasEmpresas | null;
  /** Empresa selecionada no contexto de trabalho (seleção, nunca autorização). */
  selecionada?: IdEmpresa | null;
}

/**
 * Resolução de escopo para LEITURA (listas, buscas, painéis, relatórios).
 * `empresaIds === null` significa "sem restrição por empresa" — só acontece quando o usuário está autorizado
 * a todas as empresas da organização E não pediu recorte algum. O isolamento por organização é sempre
 * aplicado por fora (RLS + organização) e não é responsabilidade deste contrato.
 *
 * Pedido fora da autorização NUNCA amplia o escopo: resulta em lista vazia (nenhuma linha), e as empresas
 * recusadas voltam em `recusadas` para que a camada de API possa auditar/erro 403 quando for seleção explícita.
 */
export interface EscopoEmpresaResolvido {
  empresaIds: IdEmpresa[] | null;
  recusadas: IdEmpresa[];
  /** true quando o escopo efetivo é "todas as empresas autorizadas" (sem recorte adicional). */
  todas: boolean;
}

const comoLista = (v: PedidoEscopoEmpresa["pedidas"]): IdEmpresa[] => {
  if (v == null) return [];
  const bruto = Array.isArray(v) ? [...v] : typeof v === "string" ? v.split(",") : [];
  return bruto.map((s) => String(s).trim()).filter((s) => s.length > 0 && s !== TODAS_EMPRESAS);
};

export function resolverEscopoEmpresa(auth: AutorizacaoEmpresas, pedido: PedidoEscopoEmpresa = {}): EscopoEmpresaResolvido {
  const pedidas = comoLista(pedido.pedidas);
  const pediuTodas = pedido.pedidas === TODAS_EMPRESAS || (Array.isArray(pedido.pedidas) && pedido.pedidas.includes(TODAS_EMPRESAS as IdEmpresa));
  // "todas" pedido explicitamente ignora a seleção de trabalho; sem pedido, a seleção vale como recorte.
  const alvo = pedidas.length ? pedidas : pediuTodas ? [] : pedido.selecionada ? [pedido.selecionada] : [];
  if (auth.modo === "todas") {
    if (!alvo.length) return { empresaIds: null, recusadas: [], todas: true };
    return { empresaIds: [...new Set(alvo)], recusadas: [], todas: false };
  }
  const autorizadas = auth.empresaIds;
  if (!alvo.length) return { empresaIds: [...autorizadas], recusadas: [], todas: true };
  const permitidas = alvo.filter((c) => autorizadas.includes(c));
  const recusadas = alvo.filter((c) => !autorizadas.includes(c));
  return { empresaIds: [...new Set(permitidas)], recusadas, todas: false };
}

/**
 * O usuário pode operar nesta empresa?
 * `empresaId` nulo = registro da organização inteira (cadastro compartilhado), visível a qualquer membro.
 */
export function empresaAutorizada(auth: AutorizacaoEmpresas, empresaId: IdEmpresa | null | undefined): boolean {
  if (!empresaId) return true;
  return auth.modo === "todas" || auth.empresaIds.includes(empresaId);
}

/** Mesma convenção das leituras: empresa fora do escopo não existe para o usuário (nunca expõe existência). */
export function exigirEmpresaVisivel(auth: AutorizacaoEmpresas, empresaId: IdEmpresa | null | undefined, oQue = "Registro"): void {
  if (!empresaAutorizada(auth, empresaId)) throw new DomainError("NOT_FOUND", `${oQue} não encontrado`);
}

/**
 * Seleção de empresa para LANÇAMENTO (documento operacional). Um lançamento pertence sempre a UMA empresa:
 *  - uma única empresa efetiva  → `automatica` (a interface preenche sem perguntar);
 *  - várias empresas efetivas   → `obrigatoria` (seleção explícita, sem padrão implícito);
 *  - empresa pedida fora da autorização → `recusada`.
 * `disponiveis` são as empresas ativas da organização; só é consultada quando a autorização é "todas".
 */
export type SelecaoEmpresa =
  | { situacao: "escolhida"; empresaId: IdEmpresa }
  | { situacao: "automatica"; empresaId: IdEmpresa }
  | { situacao: "obrigatoria"; opcoes: IdEmpresa[] }
  | { situacao: "recusada"; empresaId: IdEmpresa };

export function selecionarEmpresaDoLancamento(
  auth: AutorizacaoEmpresas,
  opts: { disponiveis?: readonly IdEmpresa[]; pedida?: IdEmpresa | null } = {}
): SelecaoEmpresa {
  const efetivas = auth.modo === "todas" ? [...(opts.disponiveis ?? [])] : [...auth.empresaIds];
  const pedida = opts.pedida?.trim() ? opts.pedida.trim() : null;
  if (pedida) {
    if (pedida === TODAS_EMPRESAS) throw new DomainError("VALIDATION_ERROR", "Um lançamento pertence a uma empresa: \"todas as empresas\" é um escopo de consulta");
    if (!empresaAutorizada(auth, pedida)) return { situacao: "recusada", empresaId: pedida };
    if (efetivas.length && !efetivas.includes(pedida)) return { situacao: "recusada", empresaId: pedida };
    return { situacao: "escolhida", empresaId: pedida };
  }
  if (efetivas.length === 1) return { situacao: "automatica", empresaId: efetivas[0]! };
  return { situacao: "obrigatoria", opcoes: efetivas };
}

/** Guarda de persistência: o valor que vai para a coluna de empresa precisa ser uma empresa concreta. */
export function exigirEmpresaPersistivel(valor: unknown, oQue = "Empresa"): IdEmpresa {
  if (typeof valor !== "string" || !valor.trim() || valor === TODAS_EMPRESAS) {
    throw new DomainError("VALIDATION_ERROR", `${oQue} obrigatória: selecione uma empresa (o escopo \"todas as empresas\" não pode ser gravado)`);
  }
  return valor;
}

/** Descrição do escopo resolvido para exibição/auditoria (não é rótulo traduzido — ver idioma.ts). */
export function descreverEscopoEmpresa(escopo: EscopoEmpresaResolvido): EscopoEmpresa {
  if (escopo.empresaIds === null) return { tipo: "todas" };
  if (escopo.empresaIds.length === 1) return { tipo: "uma", empresaId: escopo.empresaIds[0]! };
  return { tipo: "conjunto", empresaIds: escopo.empresaIds };
}
