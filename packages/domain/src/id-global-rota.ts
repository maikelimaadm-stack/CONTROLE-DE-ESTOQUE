import { ENTIDADES_ID_GLOBAL } from "./id-global.js";

/**
 * DA ROTA ABERTA PARA O REGISTRO — sem editar 23 telas.
 *
 * Cada entidade elegível declara, no catálogo, a rota canônica do seu detalhe (`/os/:id`,
 * `/financeiro/contas-a-pagar/:id`, `/cadastros/products/:id?view=1`...). Isso é suficiente para o caminho
 * inverso: dada a URL aberta, descobrir QUAL entidade e QUAL registro estão na tela.
 *
 * A alternativa seria passar `tipo` e `id` à mão em cada página de detalhe — 23 edições hoje e uma edição
 * esquecida a cada tela nova. Derivar do MESMO catálogo que o servidor usa dá cobertura de 100% do registry
 * de graça: entidade acrescentada ao catálogo passa a exibir o `#N` sem que ninguém toque na UI.
 *
 * Mora no DOMÍNIO, e não na UI, porque a pergunta é do catálogo ("que entidade esta rota representa?"), não
 * de React — e assim ela tem teste unitário junto com o resto do contrato.
 *
 * O segmento `:id` casa só com UUID: `/os/nova` e `/cadastros/products/novo` não são registros, e tratá-los
 * como tal dispararia uma consulta por tecla digitada numa tela de criação.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Padrao { tipo: string; segmentos: string[] }

const PADROES: Padrao[] = ENTIDADES_ID_GLOBAL.flatMap((e) => {
  const rotas = e.resolucao.tipo === "fixa" ? [e.resolucao.rota] : Object.values(e.resolucao.variantes).map((v) => v.rota);
  // a consulta (`?view=1`) faz parte da rota canônica do cadastro, mas não do pathname
  return rotas.map((r) => ({ tipo: e.tipoEntidade, segmentos: r.split("?")[0]!.split("/").filter(Boolean) }));
});

/** Entidade e registro da rota aberta, ou `null` quando a tela não é o detalhe de um registro elegível. */
export function entidadeDaRota(pathname: string): { tipo: string; id: string } | null {
  const partes = pathname.split("?")[0]!.split("/").filter(Boolean);
  for (const p of PADROES) {
    if (p.segmentos.length !== partes.length) continue;
    let id: string | null = null;
    let casa = true;
    for (let i = 0; i < p.segmentos.length; i++) {
      const esperado = p.segmentos[i]!;
      const atual = partes[i]!;
      if (esperado === ":id") { if (!UUID.test(atual)) { casa = false; break; } id = atual; }
      else if (esperado !== atual) { casa = false; break; }
    }
    if (casa && id) return { tipo: p.tipo, id };
  }
  return null;
}

/** Todas as rotas canônicas declaradas (sem a consulta), para o gate de cobertura visual. */
export const ROTAS_CANONICAS_ID_GLOBAL: readonly string[] = PADROES.map((p) => "/" + p.segmentos.join("/"));
