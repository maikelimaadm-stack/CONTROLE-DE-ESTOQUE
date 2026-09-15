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
  C: "ORIGEM + DESTINO (três contratos por domínio)",
  D: "TABELA EMPRESAS",
  E: "PORTA DINÂMICA / ESPECIAL",
  F: "ORGANIZAÇÃO — SEM RLS EMPRESARIAL"
};

/**
 * EXCEÇÕES CONSCIENTES. Cada uma diz por que a RLS empresarial genérica não se aplica — e o que protege a
 * tabela no lugar dela. Nenhuma linha aqui significa "sem proteção": significa "protegida por outra regra".
 *
 * `protecao` É O CONTRATO EXECUTÁVEL (PRE-BASE2-05C-0), e existe porque `protegidaPor` não era um.
 * ------------------------------------------------------------------------------------------------
 * `protegidaPor` é prosa: descreve a intenção para quem lê a matriz. Enquanto foi só isso, o guarda de
 * integração tinha um buraco de forma exata: para as categorias E e F `politicasEsperadas` devolve `null`,
 * e o teste, ao não achar política nenhuma, PULAVA a tabela justamente porque ela estava declarada aqui.
 * `erp.empresa_cost_centers` podia ficar com `row security forced` e ZERO políticas — negando tudo para a
 * aplicação — e o CI ficava verde.
 *
 * O QUE A PRIMEIRA VERSÃO DE `protecao` AINDA DEIXAVA PASSAR
 * ----------------------------------------------------------
 * Declarar nome, comando, permissividade e "cita tenant em algum lugar" não era suficiente. Quatro formas
 * perigosas continuavam verdes, e todas são alcançáveis por acidente:
 *
 *   1. `USING (true)` com `WITH CHECK` protegido — os dois textos eram CONCATENADOS antes da busca, então
 *      bastava um dos lados citar o tenant. Numa política `ALL` isso abre SELECT e DELETE;
 *   2. o inverso, `WITH CHECK (true)`, abre INSERT e o lado novo do UPDATE;
 *   3. papéis eram conferidos como SUBCONJUNTO: ganhar `public` ou `authenticated` por acidente não
 *      reprovava, porque `erp_app` continuava lá. Isso é ampliação de superfície;
 *   4. uma política PERMISSIVE EXTRA convivendo com a correta não era vista — e o PostgreSQL combina
 *      PERMISSIVE com OR, então a mais frouxa vence. É o mesmo vazamento que a matriz já proíbe nas
 *      categorias normais.
 *
 * E havia um quinto, específico do `api_child`: citar `tenant_visible` NÃO prova o vínculo pai→filho. A
 * proteção dessas quatro tabelas de vínculo é a junção com o cadastro pai, e o tenant é aplicado AO PAI.
 * Uma política que citasse o tenant sem a correlação certa deixaria o filho visível entre registros.
 *
 * O PAI NÃO É SEMPRE `erp.empresas` — E É POR ISSO QUE SÓ UMA DELAS QUEBRA NA 05C-1
 * ---------------------------------------------------------------------------------
 * Medido no banco: `authorizer_empresas` junta com `erp.authorizers` por `authorizer_id`,
 * `bank_account_empresas` com `erp.bank_accounts` por `bank_account_id`, `proprietary_empresas` com
 * `erp.people` por `person_id` — nenhum deles cita coluna legada. Só `empresa_cost_centers` junta com
 * `erp.empresas` por `farm_id`, e é exatamente essa a política que um `drop column ... cascade` apagaria.
 * Por isso a coluna de vínculo é DECLARADA por tabela: na 05C-1 ela vira `empresa_id` em uma linha só, e o
 * guarda exige que a política e a declaração mudem JUNTAS — mudar uma sem a outra reprova.
 *
 * O que `protecao` NÃO é: uma cópia do texto da política. Exigir o predicado inteiro engessaria a reescrita
 * legítima da 05C-1 e quebraria por espaço em branco ou apelido. O que se exige é a FORMA mínima sem a qual
 * a proteção deixa de existir.
 */
const tenantDireto = (papeis) => ({ politica: "tenant_isolation", familia: "tenant_direct", cmd: "ALL", permissiva: true, papeis, exigeUsing: true, exigeCheck: true });
const filhoDe = (pai, colunaVinculo) => ({ politica: "api_child", familia: "api_child", cmd: "ALL", permissiva: true, papeis: ["erp_app"], pai, colunaVinculo, exigeUsing: true, exigeCheck: true });
const TENANT_PADRAO = ["authenticated", "erp_app"];

export const EXCECOES_RLS_EMPRESA = {
  notifications: {
    categoria: "E",
    protecao: tenantDireto(TENANT_PADRAO),
    motivo: "Porta DINÂMICA: a autorização de cada aviso vem da FONTE dele (tipo × capacidade × escopo × empresa gravados na própria linha, erp.tipos_notificacao), não do módulo ativo da rota. Uma política pelo módulo da rota recortaria o aviso de compras quando lido pela tela de estoque.",
    protegidaPor: "visibilidadeNotificacaoSql + erp.tipos_notificacao (PRE-BASE2-02), com matriz própria em docs/NOTIFICATION-SCOPE-MATRIX.md"
  },
  registros_globais: {
    categoria: "E",
    protecao: tenantDireto(TENANT_PADRAO),
    motivo: "`empresa_id` aqui é DICA denormalizada, não autoridade: a resolução de #N carrega o registro FONTE vivo e tira dele a empresa atual. Recortar pela dica faria o ID Global de um registro transferido de empresa sumir para quem hoje o enxerga.",
    protegidaPor: "resolução pela entidade fonte (docs/GLOBAL-ID-CONTRACT.md); PRE-BASE2-04 cuida da alocação"
  },
  membro_empresas: {
    categoria: "E",
    protecao: tenantDireto(TENANT_PADRAO),
    motivo: "É a própria CONFIGURAÇÃO de autorização por empresa. Recortá-la pelo escopo que ela define seria circular: o administrador deixaria de enxergar as empresas que acabou de conceder.",
    protegidaPor: "tenant_isolation + capacidade users.edit na borda de administração"
  },
  legado_escopo_empresa_v0: {
    categoria: "F",
    protecao: tenantDireto(TENANT_PADRAO),
    motivo: "Arquivo morto de erp.member_farms (PRE-BASE2-03). Não é autoridade de nada, não tem tela e não é lido por runtime algum; existe para que a migração seja reversível sem backup externo.",
    protegidaPor: "tenant_isolation, sem grant de escrita"
  },
  authorizer_empresas: {
    categoria: "E",
    protecao: filhoDe("erp.authorizers", "authorizer_id"),
    motivo: "Vínculo de CONFIGURAÇÃO (cadastro × empresas de abrangência), sem organization_id próprio. Recortá-lo pelo módulo ativo esconderia do administrador empresas já vinculadas — e salvar a tela devolveria uma lista incompleta, apagando vínculos que ele nunca viu.",
    protegidaPor: "política api_child (junção com o cadastro pai, que é da organização) + capacidade do cadastro"
  },
  bank_account_empresas: { categoria: "E", protecao: filhoDe("erp.bank_accounts", "bank_account_id"), motivo: "Mesmo caso de authorizer_empresas: vínculo de abrangência de um cadastro de organização.", protegidaPor: "política api_child + bank_accounts.edit" },
  // A ÚNICA cujo vínculo é uma coluna LEGADA: a 05C-1 troca `farm_id` por `empresa_id` aqui e nesta linha,
  // no mesmo commit. Mudar só um dos dois reprova — é esse o ponto de declarar a coluna.
  empresa_cost_centers: { categoria: "E", protecao: filhoDe("erp.empresas", "farm_id"), motivo: "Mesmo caso: diz em quais empresas o centro de custo se aplica.", protegidaPor: "política api_child + cost_centers.edit" },
  proprietary_empresas: { categoria: "E", protecao: filhoDe("erp.people", "person_id"), motivo: "Mesmo caso: abrangência do proprietário.", protegidaPor: "política api_child + proprietaries.edit" }
};

/** Tabelas com DUAS pontas de empresa (transferência). Derivado do schema, listado aqui só para leitura. */
export const PARES_ORIGEM_DESTINO = ["animal_movements", "equipment_transfers", "warehouse_transfers"];

/**
 * SUBCATEGORIAS DA C — três domínios, três contratos.
 *
 * As três tabelas têm a mesma FORMA (duas colunas de empresa) e semânticas diferentes. Uma categoria só fez
 * a regra mais permissiva das três virar a regra de todas: o UPDATE em envelope existia para o aceite
 * pecuário e para o cancelamento de estoque, e acabou dando ao destinatário de QUALQUER transferência
 * autoridade para reescrever a linha inteira — inclusive numa tabela (`equipment_transfers`) que não tem
 * aceite nenhum. A exceção de domínio tem de ser tão estreita quanto a ação de domínio.
 *
 * VISIBILIDADE BILATERAL NÃO É AUTORIDADE DE MUTAÇÃO BILATERAL.
 */
export const SUBCATEGORIAS_TRANSFERENCIA = {
  animal_movements: {
    id: "C1",
    rotulo: "aceite pelo destino (operação privilegiada)",
    leitura: "qualquer ponta no escopo",
    escrita: "criar, alterar e apagar respondem pela ORIGEM",
    privilegiada: "erp.processar_transferencia_pecuaria_destino(uuid, uuid)",
    porque: "O aceite move animais que ainda são da ORIGEM — é ele que os traz para o escopo do destinatário. Não cabe no UPDATE normal (seria autoridade sobre todo o rebanho da origem) e não pode ser um UPDATE que a RLS zera em silêncio: vira uma função estreita que confere capacidade, escopo do destino, itens vinculados e row counts, e só então confirma.",
    prova: "apps/api/test/integration/transferencia-multiempresa.test.ts (fluxo real) + rls-empresa.test.ts (UPDATE do destino afeta zero linhas)"
  },
  warehouse_transfers: {
    id: "C2",
    rotulo: "efeito imediato nas duas pontas",
    leitura: "qualquer ponta no escopo",
    escrita: "criar, alterar e apagar exigem AS DUAS pontas",
    privilegiada: null,
    porque: "A criação já lança no ledger das duas empresas (e pode gerar título nos dois lados), e a rota exige `assertFarm` nas duas. O cancelamento precisa ESTORNAR os dois lados, e `reverseStock` lê `erp.stock_movements` pela RLS normal: quem enxerga uma ponta só reverteria metade do ledger e ainda marcaria a transferência como cancelada. O banco não certifica um contrato mais largo que a operação.",
    prova: "apps/api/test/integration/transferencia-multiempresa.test.ts (saldos e estornos dos dois lados)"
  },
  equipment_transfers: {
    id: "C3",
    rotulo: "sem aceite posterior",
    leitura: "qualquer ponta no escopo",
    escrita: "criar exige AS DUAS pontas; alterar e apagar respondem pela ORIGEM",
    privilegiada: null,
    porque: "A criação move o bem na hora e exige origem visível e destino permitido. Não existe rota de aceite depois — logo não existe ato do destinatário para justificar UPDATE. Ver a transferência não é poder editá-la.",
    prova: "apps/api/test/integration/transferencia-multiempresa.test.ts + rls-empresa.test.ts"
  }
};

/** Subcategoria (C1/C2/C3) de uma tabela de transferência; `null` para as demais. */
export const subcategoriaTransferencia = (tabela) => SUBCATEGORIAS_TRANSFERENCIA[tabela] ?? null;

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
export function politicasEsperadas(categoria, tabela) {
  if (categoria === "A") return { tenant_e_empresa: { cmd: "ALL", using: "leitura", check: "escrita" } };
  if (categoria === "B") {
    return {
      tenant_e_empresa_select: { cmd: "SELECT", using: "leitura", check: null },
      tenant_e_empresa_insert: { cmd: "INSERT", using: null, check: "escrita" },
      tenant_e_empresa_update: { cmd: "UPDATE", using: "escrita", check: "escrita" },
      tenant_e_empresa_delete: { cmd: "DELETE", using: "escrita", check: null }
    };
  }
  // C — transferência: a forma depende do DOMÍNIO, não do formato da tabela (SUBCATEGORIAS_TRANSFERENCIA).
  // A leitura é sempre o envelope (o destinatário precisa ver o que está chegando). A escrita não:
  //   C1 `animal_movements`   — origem; o aceite do destino é a função privilegiada, não um UPDATE.
  //   C2 `warehouse_transfers`— AS DUAS pontas: a operação lança nas duas e o estorno desfaz as duas.
  //   C3 `equipment_transfers`— criar exige as duas; alterar/apagar são da origem (não há aceite).
  // `trg_travar_pontas` continua em todas como defesa em profundidade das invariantes de ponta.
  if (categoria === "C") {
    // `envelope` = origem OU destino no escopo de LEITURA. `escrita` = a origem responde.
    // `escrita+escrita` = as DUAS pontas respondem (a operação toca as duas).
    const criar = tabela === "animal_movements" ? "escrita" : "escrita+escrita";
    const mudar = tabela === "warehouse_transfers" ? "escrita+escrita" : "escrita";
    return {
      tenant_e_empresa_select: { cmd: "SELECT", using: "envelope", check: null },
      tenant_e_empresa_insert: { cmd: "INSERT", using: null, check: criar },
      tenant_e_empresa_update: { cmd: "UPDATE", using: mudar, check: mudar, gatilho: "trg_travar_pontas" },
      tenant_e_empresa_delete: { cmd: "DELETE", using: mudar, check: null }
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

/**
 * A proteção declarada de uma tabela de exceção, em forma executável — ou `null` se a tabela não é exceção.
 *
 * Quem consome isto é o guarda de integração: para toda exceção ele exige que a política nomeada exista no
 * banco com essa forma. Uma exceção SEM `protecao` é recusada pelo próprio guarda: declarar que a tabela é
 * especial sem dizer o que a protege é exatamente o buraco que esta estrutura fecha.
 */
export const protecaoDaExcecao = (tabela) => EXCECOES_RLS_EMPRESA[tabela]?.protecao ?? null;

/** Toda tabela declarada como exceção, para o guarda percorrer sem depender do schema. */
export const TABELAS_DE_EXCECAO = Object.keys(EXCECOES_RLS_EMPRESA);

const escapar = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** O texto de `pg_policies` vem com quebras de linha e parênteses próprios; a forma não depende disso. */
const normalizar = (e) => String(e ?? "").replace(/\s+/g, " ").trim();
/** `true`, `(true)`, vazio — tudo que NÃO recorta nada. */
const naoRecorta = (e) => { const n = normalizar(e).replace(/^\(+|\)+$/g, "").toLowerCase(); return n === "" || n === "true"; };

/**
 * A FORMA MÍNIMA DO PREDICADO, POR FAMÍLIA — e por que é a forma, não a letra.
 *
 * Exigir o texto inteiro da política engessaria a reescrita legítima que a PRE-BASE2-05C-1 fará e quebraria
 * por espaço em branco ou apelido do PostgreSQL. Exigir "cita tenant_visible" não prova nada: uma política
 * pode citar o tenant e ainda assim não correlacionar o filho com o pai. O que se cobra é o esqueleto sem o
 * qual a proteção deixa de existir.
 */
function conferirPredicado(protecao, expressao, lado, tabela) {
  const problemas = [];
  const e = normalizar(expressao);
  if (naoRecorta(e)) {
    problemas.push(`${tabela}.${protecao.politica}: ${lado} não recorta nada (${e || "vazio"}) — numa política ${protecao.cmd} isso abre ${lado === "USING" ? "leitura e exclusão" : "inclusão e o lado novo do UPDATE"}`);
    return problemas;
  }
  // DISJUNÇÃO ANULA O RECORTE. `(<junção correta>) OR true` satisfaz qualquer busca por forma e abre a
  // tabela inteira — o predicado certo continua lá, e é justamente isso que engana quem lê. As oito
  // políticas de exceção são conjuntivas; um `OR` aqui é sempre uma decisão nova, e uma decisão nova sobre
  // autorização não entra por acidente.
  if (/\bor\b/i.test(e)) {
    problemas.push(`${tabela}.${protecao.politica}: ${lado} contém OR — disjunção num predicado de proteção anula o recorte (o ramo mais frouxo vence) — ${e}`);
  }
  // O tenant tem de ser O NOSSO. `tenant_visible` sem qualificação casaria com uma função homônima de outro
  // schema no `search_path` do papel da aplicação, e o gate estaria conferindo outra função.
  const TENANT = "\\berp\\.tenant_visible\\s*\\(";
  if (protecao.familia === "tenant_direct") {
    if (!new RegExp(`${TENANT}\\s*organization_id\\s*\\)`, "i").test(e)) {
      problemas.push(`${tabela}.${protecao.politica}: ${lado} não aplica erp.tenant_visible(organization_id) diretamente — ${e}`);
    }
    return problemas;
  }
  // api_child: a proteção É a junção com o cadastro pai, com o tenant aplicado AO PAI.
  const pai = escapar(protecao.pai);
  const paiNu = escapar(protecao.pai.replace(/^[a-z_]+\./i, ""));
  // A captura do apelido NÃO pode engolir palavra-chave: `FROM erp.empresas WHERE …` é uma política legítima
  // sem apelido, e capturar `where` como apelido a reprovaria — falso positivo que inviabilizaria a reescrita
  // da 05C-1 caso ela seja escrita sem apelido.
  const PALAVRAS = "where|and|or|group|order|limit|having|union|join|on|as|left|right|inner|cross|full";
  const achouFrom = new RegExp(`\\bfrom\\s+${pai}(?:\\s+(?:as\\s+)?(?!(?:${PALAVRAS})\\b)([a-z_][a-z0-9_]*))?`, "i").exec(e);
  if (!/\bexists\b/i.test(e) || !achouFrom) {
    problemas.push(`${tabela}.${protecao.politica}: ${lado} não junta com o cadastro pai declarado (${protecao.pai}) — ${e}`);
    return problemas;
  }
  // Sem apelido, quem qualifica as colunas do pai é o próprio nome da tabela, com ou sem schema.
  const qualificadores = achouFrom[1] ? [escapar(achouFrom[1])] : [pai, paiNu];
  const col = escapar(protecao.colunaVinculo);
  const filho = `(?:${escapar(`erp.${tabela}`)}|${escapar(tabela)})`;
  const alguem = (montar) => qualificadores.some((q) => new RegExp(montar(q), "i").test(e));

  if (!alguem((q) => `${q}\\.id\\s*=\\s*${filho}\\.${col}\\b|${filho}\\.${col}\\s*=\\s*${q}\\.id\\b`)) {
    problemas.push(`${tabela}.${protecao.politica}: ${lado} não correlaciona o filho com o pai pela coluna declarada (${protecao.colunaVinculo}) — ${e}`);
  }
  if (!alguem((q) => `${TENANT}\\s*${q}\\.organization_id\\s*\\)`)) {
    problemas.push(`${tabela}.${protecao.politica}: ${lado} não aplica erp.tenant_visible ao ORGANIZATION_ID DO PAI — ${e}`);
  }
  return problemas;
}

/**
 * VALIDAÇÃO PURA DA PROTEÇÃO DECLARADA — sem banco, para poder ser adversarialmente testada.
 *
 * `politicas` são as linhas REAIS de `pg_policies` daquela tabela, já normalizadas em
 * `{ policyname, cmd, permissive, papeis, qual, with_check }`. A comparação nunca é da lista contra ela
 * mesma: quem chama traz o banco. Devolve a lista de problemas; vazia = íntegro.
 */
export function validarProtecaoDaExcecao(tabela, protecao, politicas) {
  if (!protecao) return [`${tabela}: declarada como exceção sem \`protecao\` — dizer que a tabela é especial não diz o que a protege`];
  const problemas = [];
  const achada = (politicas ?? []).find((x) => x.policyname === protecao.politica);
  if (!achada) {
    const existem = (politicas ?? []).map((x) => x.policyname).join(", ") || "NENHUMA";
    return [`${tabela}: falta a política ${protecao.politica} que a exceção declara (existem: ${existem})`];
  }

  if (achada.cmd !== protecao.cmd) problemas.push(`${tabela}.${protecao.politica}: comando ${achada.cmd}, declarado ${protecao.cmd}`);
  const permissiva = String(achada.permissive).toUpperCase() === "PERMISSIVE";
  if (permissiva !== protecao.permissiva) problemas.push(`${tabela}.${protecao.politica}: ${achada.permissive}, declarada ${protecao.permissiva ? "PERMISSIVE" : "RESTRICTIVE"}`);

  // PAPÉIS SÃO CONJUNTO EXATO, não subconjunto: ganhar `public` por acidente é ampliação de superfície, e
  // um teste que só exigisse os esperados não veria o papel a mais.
  const reais = [...new Set(achada.papeis ?? [])].sort();
  const declarados = [...new Set(protecao.papeis)].sort();
  if (reais.join(",") !== declarados.join(",")) {
    problemas.push(`${tabela}.${protecao.politica}: alcança [${reais.join(", ") || "ninguém"}], declarado [${declarados.join(", ")}]`);
  }

  // USING e WITH CHECK SEPARADAMENTE. Numa política `ALL` eles respondem por comandos diferentes, e juntar
  // os dois textos antes de procurar deixava um lado aberto satisfazer pelo outro.
  if (protecao.exigeUsing) problemas.push(...conferirPredicado(protecao, achada.qual, "USING", tabela));
  if (protecao.exigeCheck) problemas.push(...conferirPredicado(protecao, achada.with_check, "WITH CHECK", tabela));

  // Duas PERMISSIVE se somam com OR: a mais frouxa vence. Numa tabela de exceção, onde `politicasEsperadas`
  // devolve null, ninguém mais faria esta pergunta.
  const extras = (politicas ?? []).filter((x) => x.policyname !== protecao.politica && String(x.permissive).toUpperCase() === "PERMISSIVE");
  if (extras.length) {
    problemas.push(`${tabela}: política PERMISSIVE extra ${extras.map((x) => `${x.policyname}/${x.cmd}`).join(", ")} — PERMISSIVE combinam com OR e a mais frouxa vence`);
  }
  return problemas;
}

/** Nome-base da política esperada por categoria (compatibilidade com chamadas antigas). */
export function politicaEsperada(categoria) {
  return ["A", "B", "C", "D"].includes(categoria) ? "tenant_e_empresa" : "tenant_isolation";
}
