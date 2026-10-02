"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SEGMENTO_DO_MODULO_COM_TOP, entendeTopNoModulo, type ModuloComTop } from "@agro/domain";
import { api } from "@/lib/api";
import { NativeSelect } from "@/components/ui";
import { CampoDaCentral } from "@/features/central/campo";

/**
 * A TOP NAS CENTRAIS DOS MÓDULOS (OPERACOES-01 F10, decisão 287) — o campo "Tipo de operação" e o que ele exige.
 *
 * Cada Central de módulo pergunta à API, uma vez, as TOPs da família do módulo (`GET /api/modulos/<segmento>/
 * operation-types`). Só a resposta 200 com a capacidade EXATA (`capacidades.topNoModulo === 1`, `entendeTopNoModulo`)
 * e a forma exata liga o campo; QUALQUER outra coisa — o 404 de rota da API anterior, 403 (sem a permissão de lançar),
 * 5xx, rede, corpo fora da forma — é "ausente": a Central de hoje, sem o campo e sem `tipo_operacao_id` no corpo, sem
 * aviso e sem nova tentativa. Quem decide a TOP é o servidor: o campo só PEDE (a versão é congelada no POST e as
 * exigências são reconferidas lá).
 */

/** A porta da capacidade do módulo. */
export const portaDosTiposDoModulo = (m: ModuloComTop): string => `/api/modulos/${SEGMENTO_DO_MODULO_COM_TOP[m]}/operation-types`;

/** Uma TOP do módulo, como a tela a leu (objeto novo: nada aponta para o que veio da rede). */
export interface TipoDoModuloLido {
  id: string;
  code: string;
  name: string;
  version: number;
  isDefault: boolean;
  /** As colunas do registro que a versão corrente exige (`cost_center_id`, `note`, `description`). */
  camposExigidos: readonly string[];
}

/** O que a Central sabe da TOP do módulo: "carregando" (a pergunta no ar), "ausente" (sem a capacidade) ou "pronto". */
export interface TopDoModulo {
  estado: "carregando" | "ausente" | "pronto";
  itens: readonly TipoDoModuloLido[];
  /** A TOP padrão da família (só se ela está entre os itens). */
  padraoId: string | null;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Exatamente estas chaves, todas próprias — nem a mais, nem a menos. */
const temExatamente = (o: Record<string, unknown>, chaves: readonly string[]): boolean =>
  Object.keys(o).length === chaves.length && chaves.every((k) => Object.hasOwn(o, k));
const texto = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const CHAVES_RAIZ = ["contractVersion", "capacidades", "family", "defaultId", "items"] as const;
const CHAVES_FAMILIA = ["code", "label"] as const;
const CHAVES_ITEM = ["id", "code", "name", "version", "isDefault", "camposExigidos"] as const;

function lerItem(bruto: unknown): TipoDoModuloLido | null {
  if (!ehObjeto(bruto) || !temExatamente(bruto, CHAVES_ITEM)) return null;
  const { id, code, name, version, isDefault, camposExigidos } = bruto;
  if (!texto(id) || !texto(code) || !texto(name) || typeof isDefault !== "boolean") return null;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  if (!Array.isArray(camposExigidos) || !camposExigidos.every(texto)) return null;
  return { id, code, name, version, isDefault, camposExigidos: [...camposExigidos] };
}

/**
 * O leitor ESTRITO da resposta: `contractVersion` 1, a capacidade exata, `family` nula ou `{ code, label }`,
 * `defaultId` texto ou nulo, e cada item com exatamente `{ id, code, name, version, isDefault, camposExigidos }`, sem
 * id repetido. Qualquer desvio → `null` (a tela trata como "ausente"). `padraoId` só quando o padrão está na lista.
 */
export function lerTiposDoModulo(bruto: unknown): { itens: TipoDoModuloLido[]; padraoId: string | null } | null {
  if (!ehObjeto(bruto) || !temExatamente(bruto, CHAVES_RAIZ)) return null;
  if (bruto.contractVersion !== 1 || !ehObjeto(bruto.capacidades) || !entendeTopNoModulo(bruto.capacidades)) return null;
  const familia = bruto.family;
  if (familia !== null && (!ehObjeto(familia) || !temExatamente(familia, CHAVES_FAMILIA) || !texto(familia.code) || !texto(familia.label))) return null;
  if (bruto.defaultId !== null && !texto(bruto.defaultId)) return null;
  if (!Array.isArray(bruto.items)) return null;
  const itens: TipoDoModuloLido[] = [];
  for (const b of bruto.items) {
    const item = lerItem(b);
    if (!item || itens.some((x) => x.id === item.id)) return null;
    itens.push(item);
  }
  const padraoId = typeof bruto.defaultId === "string" && itens.some((x) => x.id === bruto.defaultId) ? bruto.defaultId : null;
  return { itens, padraoId };
}

/**
 * As TOPs do módulo (react-query, chave `["modulo-top", modulo]`, `retry: false`, `staleTime: 60_000`). Nenhuma
 * resposta fora do contrato lança, avisa ou é repetida: vira "ausente".
 */
export function useTopDoModulo(modulo: ModuloComTop): TopDoModulo {
  const q = useQuery({
    queryKey: ["modulo-top", modulo],
    queryFn: () => api<unknown>(portaDosTiposDoModulo(modulo)),
    retry: false,
    staleTime: 60_000,
  });
  const lido = React.useMemo(() => (q.isSuccess ? lerTiposDoModulo(q.data) : null), [q.isSuccess, q.data]);
  if (q.isPending) return { estado: "carregando", itens: [], padraoId: null };
  if (!lido) return { estado: "ausente", itens: [], padraoId: null };
  return { estado: "pronto", itens: lido.itens, padraoId: lido.padraoId };
}

/**
 * A ESCOLHA da TOP na tela: começa na TOP padrão da família (quando há) e segue a do usuário; `""` = "Sem tipo de
 * operação". `idParaEnviar` é o que vai no corpo: só com a capacidade ("pronto") e só um id que está na lista lida —
 * sem a capacidade, nunca sai `tipo_operacao_id`. `descartar` volta ao padrão.
 */
export function useEscolhaDaTopDoModulo(top: TopDoModulo): { valor: string; escolher: (id: string) => void; idParaEnviar: string | null; descartar: () => void } {
  const [escolha, setEscolha] = React.useState<string | null>(null);
  const valor = top.estado === "pronto" ? (escolha ?? top.padraoId ?? "") : "";
  const idParaEnviar = valor && top.itens.some((t) => t.id === valor) ? valor : null;
  const escolher = React.useCallback((id: string) => setEscolha(id), []);
  const descartar = React.useCallback(() => setEscolha(null), []);
  return { valor, escolher, idParaEnviar, descartar };
}

/**
 * O campo "Tipo de operação" (o `<select>` tem o testid `<prefixo>-top`): "Sem tipo de operação" (valor `""`) e
 * `<código> · <nome>` de cada TOP. Só existe com a capacidade ("pronto"); sem ela, nada é desenhado.
 */
export function CampoTopDoModulo({ prefixoTestid, top, valor, onChange }: { prefixoTestid: string; top: TopDoModulo; valor: string; onChange: (id: string) => void }) {
  if (top.estado !== "pronto") return null;
  return <CampoDaCentral rotulo="Tipo de operação" icone="selecao" preenchido={Boolean(valor)} testId={`${prefixoTestid}-campo-top`}
    dica="A TOP classifica o lançamento e pode exigir campos. Sem ela, o lançamento é o de sempre.">
    <NativeSelect value={valor} onChange={(e) => onChange(e.target.value)} data-testid={`${prefixoTestid}-top`}>
      <option value="">Sem tipo de operação</option>
      {top.itens.map((t) => <option key={t.id} value={t.id}>{`${t.code} · ${t.name}`}</option>)}
    </NativeSelect>
  </CampoDaCentral>;
}

/** Os campos que a TOP escolhida exige (o `camposExigidos` dela); sem a capacidade, sem TOP ou id fora da lista → nenhum. */
export function camposExigidosDaTop(top: TopDoModulo, id: string): readonly string[] {
  if (top.estado !== "pronto" || !id) return [];
  return top.itens.find((t) => t.id === id)?.camposExigidos ?? [];
}
