import { describe, it, expect } from "vitest";
import {
  ENTIDADES_ID_GLOBAL, EXCECOES_ESCOPO, RESOURCES, allPermissionKeys,
  escopoDaPermissao, escopoDoRecurso, moduloDaPermissao, moduloEmpresaValido
} from "@agro/domain";
// @ts-expect-error — parser de migrations em JS puro, compartilhado com os gates de documentação
import { companyColumnsOf, readSchema } from "../../../../scripts/lib/schema.mjs";

/**
 * GATE DE CLASSIFICAÇÃO × SCHEMA REAL (docs/MULTI-COMPANY-CONTRACT.md §7).
 *
 * A classificação de escopo vive no domínio (configuração de produto) e o schema vive nas migrations. O
 * cruzamento acontece aqui, na API — a única camada que já depende dos dois. O que este gate impede:
 * um recurso cuja TABELA tem coluna de empresa ser classificado como "organização" sem justificativa —
 * isto é, um lançamento de empresa acessível em toda a organização só com a permissão funcional.
 */
const schema = readSchema();
const temColunaDeEmpresa = (tabela: string): boolean => {
  const t = schema.get(tabela.startsWith("erp.") ? tabela : `erp.${tabela}`);
  return Boolean(t && companyColumnsOf(t).length);
};

/**
 * recurso de permissão → tabelas que ele governa. É um-para-MUITOS de propósito: vários cadastros
 * compartilham a mesma permissão (espécie, categoria, raça e tipo de identificação usam `animals`), e um
 * mapa um-para-um perderia tabelas silenciosamente.
 */
const TABELAS_DO_RECURSO: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  const add = (recurso: string, tabela: string) => {
    const atual = m.get(recurso) ?? new Set<string>();
    atual.add(tabela); m.set(recurso, atual);
  };
  for (const e of ENTIDADES_ID_GLOBAL) {
    const permissoes = e.resolucao.tipo === "fixa"
      ? [e.resolucao.permissao]
      : Object.values(e.resolucao.variantes).map((v) => v.permissao);
    for (const p of permissoes) add(p.slice(0, p.lastIndexOf(".")), e.tabela);
  }
  for (const def of RESOURCES) add(def.permission, `erp.${def.table}`);
  return m;
})();

describe("classificação de escopo × schema real", () => {
  it("toda permission key real tem escopo declarado", () => {
    const semEscopo = allPermissionKeys().filter((k) => !escopoDaPermissao(k));
    expect(semEscopo).toEqual([]);
  });

  it("recurso com tabela company-scoped NÃO é de organização sem justificativa registrada", () => {
    const suspeitos: string[] = [];
    for (const [recurso, tabelas] of TABELAS_DO_RECURSO) {
      const escopo = escopoDoRecurso(recurso);
      if (!escopo || escopo.tipo !== "organizacao" || EXCECOES_ESCOPO[recurso]) continue;
      for (const tabela of tabelas) {
        if (temColunaDeEmpresa(tabela)) suspeitos.push(`${recurso} (${tabela}) é company-scoped mas está classificado como organização`);
      }
    }
    expect(suspeitos).toEqual([]);
  });

  it("recurso classificado como empresa tem módulo canônico e (quando mapeável) tabela com coluna de empresa", () => {
    const problemas: string[] = [];
    for (const [recurso] of TABELAS_DO_RECURSO) {
      const escopo = escopoDoRecurso(recurso);
      if (!escopo || escopo.tipo !== "empresa") continue;
      if (!moduloEmpresaValido(escopo.modulo)) problemas.push(`${recurso}: módulo inválido ${escopo.modulo}`);
    }
    expect(problemas).toEqual([]);
  });

  it("as entidades com ID Global resolvem módulo empresarial a partir da permissão do registro", () => {
    const semModulo: string[] = [];
    for (const e of ENTIDADES_ID_GLOBAL) {
      const permissoes = e.resolucao.tipo === "fixa"
        ? [e.resolucao.permissao]
        : Object.values(e.resolucao.variantes).map((v) => v.permissao);
      for (const p of permissoes) {
        const modulo = moduloDaPermissao(p);
        const entidadeTemEmpresa = Boolean(e.colunaEmpresa);
        // entidade com coluna de empresa PRECISA de módulo; cadastro da organização, não
        if (entidadeTemEmpresa && modulo === null) semModulo.push(`${e.tipoEntidade} (${p}) tem empresa mas permissão é de organização`);
      }
    }
    expect(semModulo).toEqual([]);
  });

  it("toda tabela de negócio com coluna de empresa é governada por um recurso de EMPRESA", () => {
    // tabelas de infraestrutura, vínculo e índice não são recursos de negócio e não têm módulo próprio
    const NAO_NEGOCIO = new Set([
      "member_farms", "registros_globais", "stock_movements", "herd_lots", "dfe_documents",
      "farm_cost_centers", "proprietary_farms", "authorizer_farms", "bank_account_farms",
      "membro_empresas", "membro_escopos_empresa"
    ]);
    const cobertas = new Set<string>();
    for (const [recurso, tabelas] of TABELAS_DO_RECURSO) {
      if (escopoDoRecurso(recurso)?.tipo !== "empresa") continue;
      for (const t of tabelas) cobertas.add(t.replace(/^erp\./, ""));
    }
    const semModulo: string[] = [];
    for (const [nome, t] of schema) {
      const tabela = nome.replace(/^erp\./, "");
      if (NAO_NEGOCIO.has(tabela) || !companyColumnsOf(t).length) continue;
      if (cobertas.has(tabela)) continue;
      // exceção CONSCIENTE e registrada (EXCECOES_ESCOPO) vale aqui também: senão haveria dois lugares
      // para declarar a mesma decisão, e o segundo (um Set no meio do teste) não é lido por ninguém.
      if (EXCECOES_ESCOPO[tabela]) continue;
      // não mapeada pelos dois registries: então precisa existir um recurso homônimo classificado como empresa
      const escopo = escopoDoRecurso(tabela);
      if (escopo?.tipo !== "empresa") semModulo.push(`${tabela}: tabela com coluna de empresa sem recurso de empresa correspondente`);
    }
    expect(semModulo).toEqual([]);
  });
});
