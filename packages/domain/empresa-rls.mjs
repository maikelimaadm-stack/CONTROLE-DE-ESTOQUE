/**
 * CLASSIFICAÇÃO DE RLS EMPRESARIAL — FONTE ÚNICA (PRE-BASE2-03).
 *
 * A matriz `docs/COMPANY-RLS-MATRIX.md` é GERADA daqui cruzado com o schema real, e dois guardas leem o
 * mesmo arquivo: `scripts/company-rls-matrix.mjs --check` (o documento está em dia?) e
 * `apps/api/test/integration/rls-matriz.test.ts` (a política existe MESMO no banco?). Uma lista digitada em
 * três lugares divergiria no primeiro esquecimento — e o lugar que ninguém lê seria justamente a matriz.
 *
 * A regra é de DERIVAÇÃO, não de digitação: a categoria sai do schema (a coluna é anulável? são duas
 * pontas? é a própria tabela de empresas?). O que se digita aqui é a EXCEÇÃO — e toda exceção tem motivo
 * escrito, porque "não auditada" não é uma classificação.
 */

/** Categorias da matriz. */
export const CATEGORIAS = {
  A: "EMPRESA ÚNICA OBRIGATÓRIA",
  B: "EMPRESA ÚNICA ANULÁVEL",
  C: "ORIGEM + DESTINO",
  D: "TABELA EMPRESAS",
  E: "PORTA DINÂMICA / ESPECIAL",
  F: "ORGANIZAÇÃO — SEM RLS EMPRESARIAL"
};

/**
 * EXCEÇÕES CONSCIENTES. Cada uma diz por que a RLS empresarial genérica não se aplica — e o que protege a
 * tabela no lugar dela. Nenhuma linha aqui significa "sem proteção": significa "protegida por outra regra".
 */
export const EXCECOES_RLS_EMPRESA = {
  notifications: {
    categoria: "E",
    motivo: "Porta DINÂMICA: a autorização de cada aviso vem da FONTE dele (tipo × capacidade × escopo × empresa gravados na própria linha, erp.tipos_notificacao), não do módulo ativo da rota. Uma política pelo módulo da rota recortaria o aviso de compras quando lido pela tela de estoque.",
    protegidaPor: "visibilidadeNotificacaoSql + erp.tipos_notificacao (PRE-BASE2-02), com matriz própria em docs/NOTIFICATION-SCOPE-MATRIX.md"
  },
  registros_globais: {
    categoria: "E",
    motivo: "`empresa_id` aqui é DICA denormalizada, não autoridade: a resolução de #N carrega o registro FONTE vivo e tira dele a empresa atual. Recortar pela dica faria o ID Global de um registro transferido de empresa sumir para quem hoje o enxerga.",
    protegidaPor: "resolução pela entidade fonte (docs/GLOBAL-ID-CONTRACT.md); PRE-BASE2-04 cuida da alocação"
  },
  membro_empresas: {
    categoria: "E",
    motivo: "É a própria CONFIGURAÇÃO de autorização por empresa. Recortá-la pelo escopo que ela define seria circular: o administrador deixaria de enxergar as empresas que acabou de conceder.",
    protegidaPor: "tenant_isolation + capacidade users.edit na borda de administração"
  },
  legado_escopo_empresa_v0: {
    categoria: "F",
    motivo: "Arquivo morto de erp.member_farms (PRE-BASE2-03). Não é autoridade de nada, não tem tela e não é lido por runtime algum; existe para que a migração seja reversível sem backup externo.",
    protegidaPor: "tenant_isolation, sem grant de escrita"
  },
  authorizer_empresas: {
    categoria: "E",
    motivo: "Vínculo de CONFIGURAÇÃO (cadastro × empresas de abrangência), sem organization_id próprio. Recortá-lo pelo módulo ativo esconderia do administrador empresas já vinculadas — e salvar a tela devolveria uma lista incompleta, apagando vínculos que ele nunca viu.",
    protegidaPor: "política api_child (junção com o cadastro pai, que é da organização) + capacidade do cadastro"
  },
  bank_account_empresas: { categoria: "E", motivo: "Mesmo caso de authorizer_empresas: vínculo de abrangência de um cadastro de organização.", protegidaPor: "política api_child + bank_accounts.edit" },
  empresa_cost_centers: { categoria: "E", motivo: "Mesmo caso: diz em quais empresas o centro de custo se aplica.", protegidaPor: "política api_child + cost_centers.edit" },
  proprietary_empresas: { categoria: "E", motivo: "Mesmo caso: abrangência do proprietário.", protegidaPor: "política api_child + proprietaries.edit" }
};

/** Tabelas com DUAS pontas de empresa (transferência). Derivado do schema, listado aqui só para leitura. */
export const PARES_ORIGEM_DESTINO = ["animal_movements", "equipment_transfers", "warehouse_transfers"];

/**
 * Categoria de uma tabela, a partir do schema. `colunas` são as colunas canônicas de empresa presentes e
 * `anulavel` diz se a coluna única aceita nulo.
 */
export function classificarTabela(tabela, colunas, anulavel) {
  const excecao = EXCECOES_RLS_EMPRESA[tabela];
  if (excecao) return excecao.categoria;
  if (tabela === "empresas") return "D";
  if (colunas.length > 1 || colunas.includes("empresa_origem_id")) return "C";
  if (!colunas.length) return "F";
  return anulavel ? "B" : "A";
}

/**
 * POLÍTICAS ESPERADAS POR CATEGORIA — por COMANDO, não por tabela.
 *
 * O PostgreSQL aplica `using` no SELECT, no UPDATE da linha ANTIGA e no DELETE; e `with check` no INSERT e
 * no UPDATE da linha NOVA. Enquanto leitura e escrita são a MESMA regra (categoria A: empresa obrigatória),
 * uma política `for all` diz a coisa certa. Quando divergem — B (nulo = da organização, legível por quem vê
 * parte, gravável só por quem vê tudo) e C (transferência: lê por qualquer ponta, escreve pela origem) —
 * `for all` passa a dizer que PODER LER É PODER APAGAR. Por isso a matriz declara o que se espera de cada
 * comando, e o gate confere comando a comando em vez de perguntar "existe política?".
 *
 * `leitura` = o predicado permissivo (empresa no escopo, nulo visível, qualquer ponta).
 * `escrita` = o predicado restritivo (nulo exige escopo total; transferência responde pela origem).
 */
export function politicasEsperadas(categoria) {
  if (categoria === "A") return { tenant_e_empresa: { cmd: "ALL", using: "leitura", check: "escrita" } };
  if (categoria === "B") {
    return {
      tenant_e_empresa_select: { cmd: "SELECT", using: "leitura", check: null },
      tenant_e_empresa_insert: { cmd: "INSERT", using: null, check: "escrita" },
      tenant_e_empresa_update: { cmd: "UPDATE", using: "escrita", check: "escrita" },
      tenant_e_empresa_delete: { cmd: "DELETE", using: "escrita", check: null }
    };
  }
  // C — transferência. O UPDATE usa o ENVELOPE (qualquer ponta), não a origem: o destinatário ACEITA a
  // transferência de lote e CANCELA a de armazém, e os dois são UPDATE de `status`. Restringir o `using`
  // à origem não recusaria esses fluxos — os transformaria em UPDATE de zero linhas, que as rotas não
  // percebem. O que o destinatário não pode é REDIRECIONAR o envio, e isso é comparação entre OLD e NEW:
  // fica no gatilho `trg_travar_pontas`, porque `with check` só enxerga a linha nova.
  if (categoria === "C") {
    return {
      tenant_e_empresa_select: { cmd: "SELECT", using: "leitura", check: null },
      tenant_e_empresa_insert: { cmd: "INSERT", using: null, check: "escrita" },
      tenant_e_empresa_update: { cmd: "UPDATE", using: "leitura", check: "leitura", gatilho: "trg_travar_pontas" },
      tenant_e_empresa_delete: { cmd: "DELETE", using: "escrita", check: null }
    };
  }
  // D — a própria tabela de Empresas. O que se ENXERGA é a união dos módulos; o que se CRIA é ato de
  // organização, e a empresa nova não está no escopo de ninguém: exigir escopo no `with check` seria
  // circular. Quem pode criar é decidido na API (`exigirEscopoTotalDaOrganizacao`), que faz a MESMA
  // pergunta do `using` — sem isso o INSERT passa e a leitura de volta não acha a própria linha.
  if (categoria === "D") {
    return {
      tenant_e_empresa_select: { cmd: "SELECT", using: "leitura", check: null },
      tenant_e_empresa_insert: { cmd: "INSERT", using: null, check: "tenant" },
      tenant_e_empresa_update: { cmd: "UPDATE", using: "leitura", check: "tenant" },
      tenant_e_empresa_delete: { cmd: "DELETE", using: "leitura", check: null }
    };
  }
  return null;   // E/F: a proteção é outra (porta dinâmica, tenant puro, arquivo morto)
}

/** Nome-base da política esperada por categoria (compatibilidade com chamadas antigas). */
export function politicaEsperada(categoria) {
  return ["A", "B", "C", "D"].includes(categoria) ? "tenant_e_empresa" : "tenant_isolation";
}
