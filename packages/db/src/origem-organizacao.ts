/**
 * Origem de uma organização criada por mecanismo de semeadura (GO-LIVE-01).
 *
 * A marca mora em `erp.organizations.parameters` sob a chave `origem_seed`, sem migration: é o único lugar
 * da linha que aceita um atributo novo sem mudar o schema. A API recusa gravar essa chave pela tela de
 * parâmetros (`PUT /admin/parameters`), senão qualquer dono poderia "virar demo" a organização real e abrir
 * caminho para o seed demo escrever nela.
 */
export const CHAVE_ORIGEM_SEED = "origem_seed";
export type OrigemSeed = "demo" | "organizacao_limpa";

/**
 * A organização que o seedDemo ANTIGO criou não tem marca. O que a identifica são dois valores que ele
 * gravava FIXOS, qualquer que fosse o ORG_NAME: a razão social e o documento abaixo. O nome não serve (vinha
 * de ORG_NAME) e o slug não serve (vinha de ORG_SLUG).
 *
 * Fail-closed: exige os DOIS, e exige ausência de marca. Se alguém editou razão social ou documento, ou se a
 * linha tem outra marca, a organização deixa de ser reconhecida como demo e o seed recusa. Na dúvida, recusa.
 */
export const DEMO_LEGADO_RAZAO_SOCIAL = "[DEMO] Fazendas Modelo Ltda";
export const DEMO_LEGADO_DOCUMENTO = "00000000000191";

export interface LinhaOrganizacao { parameters: unknown; legal_name: string | null; document: string | null }

export function origemDaOrganizacao(o: LinhaOrganizacao): OrigemSeed | "legado_demo" | null {
  const p = o.parameters && typeof o.parameters === "object" ? (o.parameters as Record<string, unknown>) : {};
  if (CHAVE_ORIGEM_SEED in p) {
    const v = p[CHAVE_ORIGEM_SEED];
    return v === "demo" || v === "organizacao_limpa" ? v : null;
  }
  return o.legal_name === DEMO_LEGADO_RAZAO_SOCIAL && o.document === DEMO_LEGADO_DOCUMENTO ? "legado_demo" : null;
}

export function ehOrganizacaoDemo(o: LinhaOrganizacao): boolean {
  const origem = origemDaOrganizacao(o);
  return origem === "demo" || origem === "legado_demo";
}

/** O mesmo critério em SQL, para `o` = alias de `erp.organizations`. Espelhado em `docs/sql/inventario-go-live.sql`. */
export const SQL_ORGANIZACAO_DEMO = `(o.parameters->>'${CHAVE_ORIGEM_SEED}' = 'demo' or (not (o.parameters ? '${CHAVE_ORIGEM_SEED}') and o.legal_name = '${DEMO_LEGADO_RAZAO_SOCIAL}' and o.document = '${DEMO_LEGADO_DOCUMENTO}'))`;
