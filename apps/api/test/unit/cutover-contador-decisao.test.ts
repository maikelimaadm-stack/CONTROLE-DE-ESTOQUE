import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { RESOURCES } from "@agro/domain";
import path from "node:path";
// @ts-expect-error — harness de rollout em JS puro, fora do grafo de tipos da API
import { BASE_DE_ORIGEM, CAMINHO_CONSTANTE, MIGRATION_CUTOVER, constanteNoTexto, constanteNaArvore, decidir } from "../../../../scripts/lib/cutover-contador.mjs";

/**
 * A EXCEÇÃO DE VERSION SKEW DA 05C-2 TEM DE EXPIRAR SOZINHA (PRE-BASE2-05C-2).
 *
 * A 05C-2 é um corte single-version: BASE e HEAD NÃO podem servir ao mesmo tempo, e o sentido 1 do job de
 * skew — que existe para provar o contrário — passa a provar a incompatibilidade. Uma exceção assim é útil
 * exatamente uma vez, e perigosa para sempre depois disso: se ficar ligada, a PR seguinte deixa de ser
 * medida no cenário que o job existe para cobrir, e ninguém percebe, porque o CI continua verde.
 *
 * Por isso o gatilho não é um SHA digitado nem uma variável de ambiente: é a COMPARAÇÃO entre a constante
 * do contador na base e no HEAD. Este arquivo cobra as duas metades disso:
 *
 *   (1) a exceção ATIVA quando, e somente quando, a constante muda entre os dois commits;
 *   (2) ela NÃO ativa para uma base que já contenha o cutover — que é toda PR futura.
 *
 * O caso (2) é o que importa, e é o que um teste preguiçoso esqueceria: provar que a exceção funciona é
 * fácil; provar que ela se desliga é o que impede a próxima fatia de herdar um bypass silencioso.
 */
const RAIZ = path.resolve(__dirname, "../../../..");

describe("decisão da exceção de skew do cutover do contador", () => {
  it("NÃO ativa quando os dois lados já têm a mesma chave — o caso de toda PR futura", () => {
    const d = decidir({ base: "empresa", head: "empresa" });
    expect(d.atravessa, "base pós-05C-2 + head pós-05C-2 = skew normal, obrigatório").toBe(false);
    expect(d.motivo).toMatch(/não atravessa|version skew normal/i);
  });

  it("ATIVA somente na troca farm → empresa, que é esta fatia", () => {
    const d = decidir({ base: "farm", head: "empresa" });
    expect(d.atravessa).toBe(true);
    expect(d.motivo, "e diz em voz alta o que decidiu, para o log do CI").toMatch(/NÃO podem servir ao mesmo tempo/);
  });

  it("NÃO ativa para a base histórica anterior ao cutover comparada com ela mesma", () => {
    // Uma PR aberta ANTES desta fatia (base 'farm', head 'farm') não tem nada a ver com o cutover: o skew
    // normal continua sendo a autoridade. A exceção não pode vazar para trás.
    expect(decidir({ base: "farm", head: "farm" }).atravessa).toBe(false);
  });

  it("ativa também no sentido inverso — um revert é igualmente single-version", () => {
    // Desfazer o cutover é tão incompatível quanto fazê-lo: a exceção não é "a favor" de uma direção.
    const d = decidir({ base: "empresa", head: "farm" });
    expect(d.atravessa).toBe(true);
  });

  it("o MÓDULO INTEIRO da decisão não tem interruptor de ambiente — não só a função `decidir`", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "scripts/lib/cutover-contador.mjs"), "utf8");

    // POR QUE O MÓDULO INTEIRO, E NÃO SÓ `decidir`. A versão anterior deste caso lia apenas o corpo de
    // `decidir`, e essa janela estreita é burlável de um jeito óbvio: basta plantar o atalho UMA CAMADA
    // ACIMA. Um `if (process.env.X === "1") return "empresa";` dentro de `constanteNoTexto` faz base e
    // head saírem iguais, `decidir` devolve `atravessa: false` sem nunca ler ambiente nenhum, e a
    // exceção de skew se desliga — com este teste passando, porque o atalho não está onde ele olhava.
    //
    // Então o que se cobra é a propriedade real: NENHUMA função deste módulo lê `process.env`. As duas
    // entradas legítimas são argumento (`decidir({base, head})`) e git (`constanteNoCommit`). Quem lê
    // ambiente são os CHAMADORES — `gate-cutover-05c2.mjs` e `skew-cutover-contador.mjs` leem
    // `SKEW_BASE_COMMIT` —, e é lá que isso é auditável como entrada da execução, não como gatilho
    // escondido da decisão.
    expect(fonte, "nenhuma função do módulo da decisão lê variável de ambiente").not.toMatch(/process\.env/);

    const corpoDecidir = fonte.slice(fonte.indexOf("export function decidir"));
    expect(corpoDecidir, "e `decidir` também não consulta o disco").not.toMatch(/readFileSync|existsSync/);
  });

  it("a proveniência é registro, não gatilho: o SHA de origem não participa da decisão", () => {
    expect(BASE_DE_ORIGEM, "a base em que a fatia nasceu está registrada para auditoria")
      .toBe("602cda3acdaf3f92227341181bf2bf83ab37e96f");
    const fonte = fs.readFileSync(path.join(RAIZ, "scripts/lib/cutover-contador.mjs"), "utf8");
    const corpoDecidir = fonte.slice(fonte.indexOf("export function decidir"));
    expect(corpoDecidir, "e NÃO é comparada dentro de decidir — um rebase legítimo não pode ligar nem desligar a exceção")
      .not.toMatch(/BASE_DE_ORIGEM/);
  });

  it("lê a constante REAL do repositório — o HEAD desta fatia já é o canônico", () => {
    expect(constanteNaArvore(RAIZ)).toBe("empresa");
    // E o parser é estrito: ele lê a declaração, não qualquer menção da palavra no arquivo.
    expect(constanteNoTexto(`export const SEQUENCIA_EMPRESA = "farm";`)).toBe("farm");
    expect(() => constanteNoTexto("// SEQUENCIA_EMPRESA fala sobre 'empresa' mas não declara nada"))
      .toThrow(/não encontrada/);
  });

  it("o cutover que a exceção descreve existe de fato: migration e constante estão no lugar declarado", () => {
    expect(fs.existsSync(path.join(RAIZ, "supabase/migrations", MIGRATION_CUTOVER)),
      "a migration do cutover está versionada").toBe(true);
    expect(fs.existsSync(path.join(RAIZ, CAMINHO_CONSTANTE)),
      "e o caminho da constante aponta para um arquivo real").toBe(true);
  });

  it("T5 · o gate modela o cadastro como UMA TRANSAÇÃO — não pode regredir para autocommit", () => {
    // POR QUE ESTE CASO EXISTE. A primeira versão do gate mandava `next_code` e o `insert` como duas
    // queries autocommit separadas, e isso não é o que a API faz: `createOne` passa o MESMO `ctx.tx` para
    // os dois, dentro do `withTx` (`begin` → serviço → `commit`, `rollback` em erro). A diferença não é
    // estética — ela MUDA O RESULTADO: em autocommit a linha que `next_code` cria fica gravada mesmo
    // quando o `insert` falha, e foi daí que saiu a afirmação (falsa) de que o binário antigo
    // "ressuscitava" a chave legada em toda tentativa. Numa transação real ela é DESFEITA junto.
    //
    // Sem esta trava, a regressão é silenciosa e convincente: o gate continuaria verde, contando uma
    // história errada sobre o que sobra no banco — e é o que sobra que decide se o cutover é seguro.
    const gate = fs.readFileSync(path.join(RAIZ, "scripts/gate-cutover-05c2.mjs"), "utf8");
    const corpo = gate.slice(gate.indexOf("async function cadastrarEmpresa"), gate.indexOf("async function estado"));
    expect(corpo, "o cadastro abre transação").toMatch(/query\(\s*["']begin["']\s*\)/);
    expect(corpo, "e a fecha com commit no caminho feliz").toMatch(/query\(\s*["']commit["']\s*\)/);
    expect(corpo, "e desfaz com rollback quando o insert falha").toMatch(/query\(\s*["']rollback["']\s*\)/);
    // A ordem importa: `next_code` tem de estar DENTRO da transação, não antes dela.
    expect(corpo.indexOf("begin"), "o begin vem antes do next_code").toBeLessThan(corpo.indexOf("next_code"));
    expect(corpo.indexOf("next_code"), "e o next_code antes do insert").toBeLessThan(corpo.indexOf("insert into erp.empresas"));

    // E os quadrantes sem acervo existem — são eles que provam o dano PERSISTENTE.
    expect(gate, "Q3b (BASE + pós-0018, organização sem Empresa) é exercitado").toMatch(/Q3b/);
    expect(gate, "Q4b (HEAD + pré-0018, organização sem Empresa) é exercitado").toMatch(/Q4b/);
  });

  it("T6 · o contrato multiempresa descreve o SSOT canônico, não o schema legado", () => {
    // `docs/MULTI-COMPANY-CONTRACT.md` se declara CONTRATO ATUAL de plataforma. Enquanto ele dizia que a
    // Empresa "é materializada pela tabela `erp.farms` e pelo vínculo `erp.member_farms`", estava
    // descrevendo um schema que a 0014 renomeou e a 0017 purgou — e um contrato que descreve o passado
    // manda quem o lê implementar o passado.
    //
    // Os nomes NÃO são digitados aqui por gosto: `erp.empresas` vem da 0014, e `membro_empresas` /
    // `membro_escopos_empresa` são as tabelas que de fato existem (a auditoria externa supôs
    // `member_empresas`, que não existe — por isso se deriva do repo, não da expectativa).
    const c = fs.readFileSync(path.join(RAIZ, "docs/MULTI-COMPANY-CONTRACT.md"), "utf8");
    const estadoAtual = c.slice(c.indexOf("> **Estado atual:**"), c.indexOf("## 2."));
    expect(estadoAtual, "a tabela canônica").toMatch(/erp\.empresas/);
    expect(estadoAtual, "o vínculo canônico").toMatch(/membro_empresas/);
    expect(estadoAtual, "a coluna canônica").toMatch(/empresa_id/);
    expect(estadoAtual, "o cabeçalho canônico").toMatch(/X-Empresa-Id/);
    expect(estadoAtual, "e NÃO apresenta o nome legado como a materialização de hoje")
      .not.toMatch(/é materializada pela tabela `erp\.farms`/);

    // As flags do registry citadas no contrato têm de ser as REAIS (`empresaScoped`), senão o contrato
    // manda procurar um campo que não existe.
    expect(c, "flag de escopo real").toMatch(/`empresaScoped: true`/);
    expect(c, "flag de escopo anulável real").toMatch(/`empresaScopedNulo: true`/);
    expect(c, "as flags legadas não voltam").not.toMatch(/`farmScoped(Nulo)?: true`/);

    // `docs/TESTING.md` descreve o MESMO gate e dizia `farmScoped` — dois SSOT discordando sobre o mesmo
    // campo. Quem declarasse `farmScoped: true` num recurso novo não receberia erro do registry: receberia
    // a reprovação de `report-scope` dizendo que "não declara empresaScoped", sem entender por quê.
    const t = fs.readFileSync(path.join(RAIZ, "docs/TESTING.md"), "utf8");
    expect(t, "TESTING.md nomeia a flag real").toMatch(/empresaScoped/);
    expect(t, "e não a que nunca existiu").not.toMatch(/farmScoped/);
  });

  it("T6b · os comentários de runtime não mandam o leitor a um tradutor que foi apagado", () => {
    // O contrato foi corrigido; o código que ele aponta pelo nome (`apps/api/src/lib/empresa.ts`, §4 do
    // contrato) não estava. Os comentários diziam que o cabeçalho anterior é TRADUZIDO na borda, por
    // `lib/compat-empresa.ts` — arquivo apagado na 05B. O código faz o OPOSTO: recusa com 422
    // (`lib/empresa-header.ts`). Um implementador que seguisse o comentário poderia "restaurar" a
    // tradução, reabrindo exatamente a ampliação silenciosa de escopo que a recusa existe para fechar.
    //
    // Este caso existe porque o T6 lê só o `.md`: nada no harness olhava comentário de runtime, e isso
    // dava impressão de cobertura que não havia.
    for (const rel of ["apps/api/src/lib/context.ts", "apps/api/src/lib/empresa.ts"]) {
      const src = fs.readFileSync(path.join(RAIZ, rel), "utf8");
      expect(src, `${rel} não apresenta o cabeçalho legado como o do sistema`).not.toMatch(/X-Farm-Id/i);
      expect(src, `${rel} não aponta para o tradutor apagado`).not.toMatch(/compat-empresa/);
    }
    // E a recusa continua sendo recusa, não tradução — a premissa do que está escrito acima.
    const borda = fs.readFileSync(path.join(RAIZ, "apps/api/src/lib/empresa-header.ts"), "utf8");
    expect(borda, "o cabeçalho anterior é RECUSADO na borda").toMatch(/não é mais aceito/);
  });

  it("T8 · o cadastro de Empresa aloca o código pelo caminho de SEQUENCIA_EMPRESA, e não pelo genérico", () => {
    // `createOne` tem DOIS ramos que podem alocar `code`: o genérico `def.codeEntity` e o específico de
    // `empresas`, que é o único que usa `SEQUENCIA_EMPRESA`. Hoje o registro de `empresas` não declara
    // `codeEntity`, então só o específico dispara — e é isso que torna fiel tudo o que esta fatia mede.
    //
    // Mas o acoplamento é implícito: declarar `codeEntity` em `empresas` faria o ramo genérico VENCER (ele
    // vem antes e já teria empilhado `code`), `SEQUENCIA_EMPRESA` viraria letra morta em silêncio, e o
    // `gate:05c2` continuaria VERDE — porque ele lê a CONSTANTE, nunca qual ramo a API executa. Este caso
    // existe para que essa mudança pare aqui, nomeada, em vez de aparecer como numeração errada em produção.
    const empresas = RESOURCES.find((r) => r.table === "empresas");
    expect(empresas, "o registro de Empresa existe").toBeTruthy();
    expect(empresas!.codeEntity,
      "declarar codeEntity em `empresas` desvia a alocação para o ramo genérico e desliga SEQUENCIA_EMPRESA")
      .toBeUndefined();

    // E a premissa do outro lado: o ramo específico continua existindo e continua sendo o que usa a constante.
    const src = fs.readFileSync(path.join(RAIZ, "apps/api/src/routes/resources.ts"), "utf8");
    expect(src, "o ramo específico de `empresas` usa SEQUENCIA_EMPRESA")
      .toMatch(/def\.table === "empresas" && !cols\.includes\("code"\)[\s\S]{0,120}SEQUENCIA_EMPRESA/);
  });

  it("T7 · o runbook NÃO afirma que a plataforma não tem mecanismo de quiesce", () => {
    // A auditoria externa mostrou que o Railway documenta `Remove`, que PARA o deployment que está
    // servindo. Afirmar "não existe mecanismo" era impreciso, e a imprecisão é perigosa nos dois sentidos:
    // some com uma saída real e faz o runbook parecer mais fechado do que é.
    //
    // O que continua verdade, e o teste não pode apagar: a primitiva é nomeada, e o gate de quiesce
    // EXISTIU e foi resolvido por confirmação ACCOUNT-SPECIFIC — não por ele nunca ter importado.
    // O cutover foi executado em 16/09/2026; o runbook é hoje CLOSED e registra a execução.
    const rb = fs.readFileSync(path.join(RAIZ, "docs/PRE-BASE2-05C-2-CUTOVER.md"), "utf8");
    expect(rb, "a primitiva documentada é nomeada").toMatch(/Remove/);
    expect(rb, "e continua sendo o mecanismo preferencial").toMatch(/MECANISMO PREFERENCIAL/);
    // E não volta a ser CANDIDATO: ele foi USADO. Sem esta trava, um revert parcial do §B4 mantendo o
    // banner CLOSED passa verde, e o documento volta a se contradizer — o defeito recorrente desta fatia.
    expect(rb, "o `Remove` não volta a ser CANDIDATO: foi usado em 16/09/2026")
      .not.toMatch(/MECANISMO PREFERENCIAL CANDIDATO/);
    expect(rb, "o runbook está CLOSED/COMPLETED, não mais BLOCKED")
      .toMatch(/Estado deste runbook: `COMPLETED` \/ `CLOSED` EM PRODUÇÃO/);
    expect(rb, "e o estado atual não afirma mais BLOCKED").not.toMatch(/Estado deste runbook: `BLOCKED`/);
    expect(rb, "a exigência de confirmação account-specific continua registrada").toMatch(/ACCOUNT-SPECIFIC/);
    // A frase antiga, categórica, não pode voltar.
    expect(rb, "não afirma mais ausência de mecanismo").not.toMatch(/Não existe hoje, neste produto, mecanismo comprovável/);
  });

  it("T9 · o runbook descreve o modelo VIGENTE do cutover, e as frases já refutadas não voltam", () => {
    // POR QUE ESTE CASO EXISTE. Esta fatia publicou TRÊS modelos antes de acertar, e as duas primeiras
    // correções foram achadas por auditoria externa, não pelos gates. O padrão de falha foi sempre o
    // mesmo: o modelo é corrigido num lugar e sobrevive em outro, porque nada mecânico lia a prosa. Um
    // documento operacional que se contradiz é pior que um desatualizado — às 3h da manhã o operador lê
    // a frase que encontrar primeiro.
    //
    // As asserções são SEMÂNTICAS de propósito: casam com o conceito (M, 1..M-1, Q3c/Q3d) e não com
    // pontuação, para não quebrarem numa reescrita legítima do texto.
    const rb = fs.readFileSync(path.join(RAIZ, "docs/PRE-BASE2-05C-2-CUTOVER.md"), "utf8");

    // 1. Os quadrantes que a expansão trouxe estão nomeados.
    expect(rb, "Q3c (menor código positivo M > 1) é descrito").toMatch(/Q3c/);
    expect(rb, "Q3d (a prova NEGATIVA da lacuna interna) é descrito").toMatch(/Q3d/);

    // 2. O modelo vigente: a janela vai de 1 até M-1.
    expect(rb, "o runbook fala do menor código ocupado M, e de M > 1").toMatch(/M *> *1/);
    expect(rb, "e do intervalo silencioso 1..M-1").toMatch(/1\.\.M-1|M *- *1/);

    // 3. A prova negativa, com o acervo concreto e a janela zero.
    const lacunaInterna = /\[1, ?3, ?5\]/;
    expect(rb, "o acervo de lacuna interna é citado").toMatch(lacunaInterna);
    expect(rb, "e dito que ele NÃO abre janela").toMatch(/lacuna *(?:interna|INTERNA)[^.]*?não *abre|não *abre *janela/i);

    // 4. As frases do modelo REFUTADO não voltam como afirmação vigente.
    expect(rb, "nenhum quadrante sozinho 'obriga' a janela").not.toMatch(/A linha que obriga a janela/);
    expect(rb, "o desfecho não depende mais de 'haver acervo'").not.toMatch(/depende de haver acervo/);
    expect(rb, "a lista de quadrantes do gate não volta a ser a antiga").not.toMatch(/\(Q3, Q3b, Q4, Q4b\)/);

    // 5. O A13 mede o menor código POSITIVO. `count(*) <> max(code)` pode ser CITADO como o que não
    //    serve, mas não pode voltar a ser CRITÉRIO — então a proibição vale dentro dos blocos SQL.
    const blocosSql = [...rb.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
    expect(blocosSql.length, "o runbook tem blocos SQL executáveis").toBeGreaterThan(0);
    const sqlDoA13 = blocosSql.filter((b) => /cadastros_silenciosos|min\(e?\.?code\)/.test(b));
    expect(sqlDoA13.length, "o A13 tem consulta própria").toBeGreaterThan(0);
    expect(sqlDoA13.join("\n"), "o A13 filtra pelo menor código POSITIVO").toMatch(/filter *\( *where[^)]*code *>= *1 *\)/i);
    for (const b of blocosSql) {
      expect(b, "nenhum SQL do runbook usa count(*) <> max(code) como critério")
        .not.toMatch(/count\(\*\) *<> *max\(code\)/);
    }

    // 6. §B6 continua com OITO confirmações — a contagem já saiu errada uma vez.
    const b6 = rb.slice(rb.indexOf("### B6."), rb.indexOf("### Ideias que parecem quiesce"));
    const itens = [...b6.matchAll(/^\d+\. /gm)].length;
    expect(itens, `§B6 lista OITO confirmações account-specific (achei ${itens})`).toBe(8);
    expect(rb, "e o texto não volta a dizer 'sete'").not.toMatch(/sete pontos de §B6/i);

    // 7. O ESTADO OPERACIONAL é o de hoje: cutover CONCLUÍDO, com a execução registrada. O que este item
    //    impede é o inverso do que impedia antes — que alguém volte a publicar "BLOCKED"/"não executado"
    //    como estado ATUAL, ou que declare CLOSED sem a evidência da janela.
    expect(rb, "o runbook está CLOSED/COMPLETED em produção")
      .toMatch(/Estado deste runbook: `COMPLETED` \/ `CLOSED` EM PRODUÇÃO/);
    expect(rb, "com a seção de encerramento real").toMatch(/Encerramento real — 16\/09\/2026/);
    expect(rb, "e o merge da janela nomeado").toMatch(/935f9dca645f120b6b1747dab8ae95abc143d4a5/);
    // Sem alternativa de escape: a prova da SUBSTITUIÇÃO (e não da cópia) é a linha da tabela de
    // validação com farm em ZERO. Uma alternativa frouxa aqui só serviria para absorver, no futuro, um
    // texto mais fraco do que esta asserção existe para exigir.
    expect(rb, "a substituição de chave é comprovada, não a cópia").toMatch(/`entity='farm'` *\| *\*\*0\*\*/);
    expect(rb, "e a chave canônica aparece com exatamente uma linha").toMatch(/`entity='empresa'` *\| *\*\*1\*\*/);

    // 8. O QUE O ENCERRAMENTO NÃO AFROUXA. O cutover estar feito não torna o version skew seguro: a
    //    janela single-version era obrigatória, e o motivo pelo qual era obrigatória continua de pé.
    expect(rb, "o runbook continua dizendo que a janela single-version era obrigatória")
      .toMatch(/janela single-version é obrigatória|janela single-version era obrigatória/);
    expect(rb, "e que o cutover concluído não torna o skew seguro")
      .toMatch(/não[\s\S]{0,40}torna o version skew[\s\S]{0,60}seguro/i);
    expect(rb, "a política forward-only permanece escrita").toMatch(/forward-only/i);
  });

  it("T9b · nenhum artefato elege UM quadrante como o que obriga a janela — nem o runbook, nem o gate, nem a 0018", () => {
    // ESTE CASO EXISTE PORQUE O T9 NÃO BASTOU. Red team independente achou, DEPOIS de o runbook estar
    // correto, que a SAÍDA do `gate:05c2` ainda encerrava dizendo que "o que obriga a janela é o ATRASO da
    // colisão" — as duas últimas linhas que o operador e o CI leem numa rodada verde. O atraso só existe em
    // Q3c: em Q3b e Q4b não há colisão, logo não há atraso; em Q3, Q3d e Q4 a colisão é imediata, logo o
    // atraso é zero. A frase excluía cinco dos seis quadrantes incompatíveis e contradizia o runbook que
    // ela mesma citava. O cabeçalho da 0018 tinha a variante "os dois últimos casos obrigam a janela".
    //
    // A lição é a do defeito recorrente desta fatia: corrigir o modelo num arquivo e deixá-lo sobreviver
    // noutro. Por isso a trava passa a valer para TODO artefato que descreve o modelo, e não só a prosa
    // do runbook. E o perigo é concreto, não estético: num parque onde toda organização começa em 1 o A13
    // reporta janela ZERO, e "sem atraso" leria como "sem necessidade de janela".
    const artefatos = {
      "docs/PRE-BASE2-05C-2-CUTOVER.md": fs.readFileSync(path.join(RAIZ, "docs/PRE-BASE2-05C-2-CUTOVER.md"), "utf8"),
      "docs/TESTING.md": fs.readFileSync(path.join(RAIZ, "docs/TESTING.md"), "utf8"),
      "scripts/gate-cutover-05c2.mjs": fs.readFileSync(path.join(RAIZ, "scripts/gate-cutover-05c2.mjs"), "utf8"),
      "supabase/migrations/0018_empresa_code_sequence.sql":
        fs.readFileSync(path.join(RAIZ, "supabase/migrations/0018_empresa_code_sequence.sql"), "utf8"),
    };

    // Atribuições EXCLUSIVAS proibidas: elegem um mecanismo ou um subconjunto como a causa da janela.
    const eleicoes: Array<[RegExp, string]> = [
      [/(?:O que|o que) obriga a janela[^.\n]*é o ATRASO/, "elege o ATRASO da colisão (só existe em Q3c)"],
      [/[Ss]ão os dois últimos casos que obrigam a janela/, "elege só a metade silenciosa"],
      [/A linha que obriga a janela/, "elege um único quadrante"],
      [/É o segundo caso que obriga a janela/, "elege um único caso"],
      [/é a forma silenciosa que obriga a janela/i, "elege só a forma silenciosa"],
    ];
    for (const [nome, texto] of Object.entries(artefatos)) {
      for (const [re, porque] of eleicoes) {
        expect(texto.replace(/^\s*(?:\/\/|--).*$/gm, ""), `${nome}: ${porque}`).not.toMatch(re);
      }
    }

    // E os três que AFIRMAM o modelo dizem, positivamente, que é o conjunto.
    for (const [nome, texto] of Object.entries(artefatos)) {
      expect(texto, `${nome} atribui a janela ao CONJUNTO de incompatibilidades`)
        .toMatch(/[Nn]enhum quadrante sozinho|NENHUM quadrante sozinho|NENHUM desses casos sozinho/);
    }

    // O gate encerra reafirmando a proibição — é a última linha que o CI imprime numa rodada verde.
    expect(artefatos["scripts/gate-cutover-05c2.mjs"], "a saída do gate termina reafirmando a proibição")
      .toMatch(/ROLLOUT NORMAL CONTINUA PROIBIDO/);
  });

  it("o gate resolve a base DE VERDADE e ABORTA sem ela — nunca cai no SHA de proveniência", () => {
    // O fail-OPEN que este caso tranca: a versão anterior de `baseDaExecucao()` terminava em
    // `catch { return BASE_DE_ORIGEM }`. Como 602cda3 tem `SEQUENCIA_EMPRESA = 'farm'` para sempre, no CI
    // (clone raso, sem `origin/main`) TODA execução comparava a PR com o passado congelado. E, no dia em
    // que alguém revertesse a constante para `'farm'`, base e head ficariam iguais e o gate imprimiria
    // "APROVADO (inativo)" exatamente na PR que reintroduz o defeito. Um gate ancorado em literal mede o
    // passado, não a execução.
    const gate = fs.readFileSync(path.join(RAIZ, "scripts/gate-cutover-05c2.mjs"), "utf8");
    const importado = gate.slice(0, gate.indexOf("const RAIZ"));
    expect(importado, "o gate não importa mais a constante de proveniência — ela não é base de nada")
      .not.toMatch(/BASE_DE_ORIGEM/);

    // E o caminho que sobra é resolver ou ABORTAR — nunca devolver um literal.
    const corpo = gate.slice(gate.indexOf("function baseDaExecucao"), gate.indexOf("const migrations ="));
    expect(corpo, "o degrau final é `throw`, não um valor de reserva").toMatch(/throw new Error/);
    expect(corpo, "e a resolução real passa por shaDoRef").toMatch(/shaDoRef\(/);

    // Este caso é OFFLINE de propósito: o comportamento de `shaDoRef` contra o remoto depende de rede e de
    // quanto histórico o clone tem, e uma asserção dessas num teste unitário é verde na máquina e vermelha
    // no CI — o erro que esta própria fatia já cometeu duas vezes. Quem exercita a resolução DE VERDADE é
    // `pnpm gate:05c2`, no job de integração: ele resolve a base ou sai 1, então o job passar já é a prova.
  });

  it("o SHA de proveniência é um SHA completo — e quem o VALIDA contra o repositório é o gate, não este teste", () => {
    // Por que a forma, e não a ancestralidade: o checkout do CI é RASO (`fetch-depth: 1`), então
    // `merge-base --is-ancestor` não tem grafo para responder e reprova por falta de histórico, não por
    // proveniência errada. Uma asserção que só passa em clone completo é verde na máquina e vermelha no
    // CI pelo mesmo código — o modo de falhar que `api-anterior.mjs` já documentou neste repositório.
    //
    // O que sobra aqui é o defeito REAL de um literal digitado à mão: SHA truncado, com espaço ou fora do
    // alfabeto. E o que se perdeu não ficou sem dono: `pnpm gate:05c2` LÊ este commit
    // (`constanteNoCommit`, que busca o objeto quando o clone é raso) e REPROVA se não conseguir ler —
    // "sem a base não há matriz". É dessa leitura que sai a constante da BASE na matriz, então um SHA
    // inalcançável reprova o gate em vez de virar compatibilidade suposta.
    //
    // Isto não enfraquece nada porque `BASE_DE_ORIGEM` não decide coisa alguma: o caso acima prova que
    // `decidir` nem o menciona. Um SHA errado aqui engana um auditor humano; não liga nem desliga exceção.
    expect(BASE_DE_ORIGEM, "SHA completo de 40 hex, minúsculo").toMatch(/^[0-9a-f]{40}$/);
  });

  it("T10 · os OUTROS artefatos de estado também dizem que o cutover ocorreu — não só o runbook", () => {
    // POR QUE ESTE CASO EXISTE. A trava de prosa lia UM arquivo (o runbook), e os outros quatro que
    // declaram o mesmo estado ficavam sem gate nenhum. Red team independente mostrou o custo disso na
    // própria rodada de encerramento: dois documentos ficaram para trás dizendo `BLOCKED`/"ainda não
    // existe", e o CI verde teria certificado a contradição. O que nenhum gate lê envelhece em silêncio.
    const ler = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

    const deploy = ler("docs/DEPLOYMENT.md");
    expect(deploy, "DEPLOYMENT.md registra o go-live da 05C-2 como EXECUTADO").toMatch(/Go-live da 05C-2[^\n]*EXECUTADO/);
    expect(deploy, "e não volta a dizer que o cutover não está autorizado").not.toMatch(/cutover NÃO autorizado/);

    const aposentadoria = ler("docs/PRE-BASE2-05-APOSENTADORIA.md");
    expect(aposentadoria, "a 05C não é mais 'fase atual'").not.toMatch(/fase atual/i);
    expect(aposentadoria, "e a 05C-2 não é mais 'fatia ATIVA'").not.toMatch(/fatia ATIVA/i);

    const roteiro = ler("docs/PRE-BASE2-ROADMAP.md");
    expect(roteiro, "PRE-BASE2-05 está concluída em produção").toMatch(/\*\*PRE-BASE2-05\*\*[\s\S]{0,400}?CONCLUÍDA EM PRODUÇÃO/);
    expect(roteiro, "e não volta a dizer que a fase não conta como encerrada").not.toMatch(/não conta como encerrada/);
    // A outra metade da verdade: cada fase declara o SEU estado, e a asserção é ANCORADA no nome da fase.
    // Uma versão anterior desta trava tentou ser genérica ("existe alguma fase em PR"), e afrouxou duas
    // vezes: um roteiro que dissesse, na MESMA linha da BASE2-01, "implantada em produção" e "em PR"
    // passaria — e é exatamente a contradição que esta trava existe para impedir.
    //
    // Consequência aceita: quando uma fase muda de estado, estas linhas reprovam. Isso é o desenho, não
    // um defeito — a fatia que muda o estado do roteiro atualiza a trava junto, como já se fez aqui três
    // vezes. Uma trava de estado que sobrevive à mudança de estado não está travando nada.
    //
    // QUARTA MOVIMENTAÇÃO (BASE2-03A): o HOTFIX da numeração foi mesclado (`ca74c56`, PR #40) e
    // CERTIFICADO no ambiente real — CI do merge 4/4, os dois deployments da Railway no commit do merge,
    // `0019` no ledger exatamente uma vez (2026-09-18T02:08:56Z) e as invariantes de contador conferidas.
    // Com isso a BASE2-03+ deixou de estar congelada, e esta trava vira o inverso do que era: em vez de
    // exigir o congelamento, ela passa a RECUSAR a volta do congelamento.
    //
    // Por que não simplesmente apagar as duas asserções antigas: o estado obsoleto não some sozinho. Um
    // documento que volte a dizer "hotfix em PR / BASE2-03 congelada" — por reversão, por conflito mal
    // resolvido ou por cópia de uma versão velha — congelaria no papel uma fase que já está em execução,
    // e o CI certificaria a contradição. Trava de estado se MOVE com o estado; não se remove com ele.
    const linhaDaFase = (nome: string) => roteiro.split("\n").find((l) => l.includes(`**${nome}**`)) ?? "";
    expect(roteiro, "BASE2-01 está concluída e implantada em produção").toMatch(/\*\*BASE2-01\*\*[\s\S]{0,800}?IMPLANTADA EM PRODUÇÃO/);
    expect(roteiro, "BASE2-02 está concluída e implantada em produção").toMatch(/\*\*BASE2-02\*\*[\s\S]{0,800}?IMPLANTADA EM PRODUÇÃO/);
    expect(roteiro, "a BASE2-03+ está LIBERADA").toMatch(/\*\*BASE2-03\+\*\*[\s\S]{0,600}?LIBERADA/);
    expect(linhaDaFase("BASE2-03+"), "e não volta a se declarar congelada").not.toMatch(/CONGELADA/);

    // O HOTFIX de numeração: fechado e implantado, com o commit do merge nomeado. Sem o SHA, "implantado"
    // seria uma afirmação sem endereço — e é justamente o endereço que um terceiro confere.
    expect(roteiro, "o HOTFIX de numeração está fechado e implantado em produção")
      .toMatch(/HOTFIX obrigatório antes da BASE2-03[\s\S]{0,200}?IMPLANTADO EM PRODUÇÃO/);
    // `EM PR\b`, com a fronteira de palavra, e isso NÃO é preciosismo: "EM PR" é prefixo de
    // "EM PRODUÇÃO". A asserção ANTERIOR — positiva, sem fronteira — teria passado com o roteiro dizendo
    // "IMPLANTADO EM PRODUÇÃO", ou seja, ela não distinguia os dois estados que existia para distinguir.
    // O defeito só apareceu quando a trava foi invertida, porque o negativo é quem exercita a diferença.
    expect(roteiro, "o roteiro não volta a dizer que o hotfix está em PR")
      .not.toMatch(/HOTFIX obrigatório antes da BASE2-03[\s\S]{0,200}?EM PR\b/);
    expect(roteiro, "o encerramento do hotfix cita o commit do merge").toMatch(/ca74c56/);
    expect(roteiro, "a primeira fatia da BASE2-03+ está nomeada").toMatch(/BASE2-03A/);
    // E nenhuma fase afirma dois estados ao mesmo tempo. A verificação é POR LINHA porque o roteiro é uma
    // tabela markdown: uma fase é uma linha, e é dentro dela que a contradição apareceria.
    for (const fase of ["BASE2-01", "BASE2-02", "BASE2-03+"]) {
      const linha = linhaDaFase(fase);
      expect(linha, `${fase}: fase ausente do roteiro`).not.toBe("");
      const estados = ["IMPLANTADA EM PRODUÇÃO", "implementação em PR", "CONGELADA", "LIBERADA"].filter((e) => linha.includes(e));
      expect(estados, `${fase} declara mais de um estado na mesma linha: ${estados.join(" + ")}`).toHaveLength(1);
    }

    const contrato = ler("docs/MULTI-COMPANY-CONTRACT.md");
    expect(contrato, "o cutover da chave saiu de 'o que ainda não existe'")
      .toMatch(/~~Cutover da CHAVE do contador[\s\S]{0,200}?CONCLUÍDO/);

    const runtime = ler("apps/api/src/lib/sequencia-empresa.ts");
    expect(runtime, "o comentário do runtime não diz mais que a janela não foi realizada")
      .not.toMatch(/ainda não foi realizada/);
    expect(runtime, "e continua tratando o binário anterior como estado PROIBIDO").toMatch(/PROIBIDO/);
  });

  it("T11 · o contrato do Modelo Base 2 e o roteiro declaram O MESMO estado da BASE2-03+", () => {
    // POR QUE ESTE CASO EXISTE. O caso T10 cobria o ROTEIRO, e o roteiro passou a dizer LIBERADA. O
    // contrato do Modelo Base 2 — que é o dono do assunto "moldura" — continuou dizendo, na seção de
    // estado, que a BASE2-03+ "segue congelada". Dois documentos canônicos com estados opostos para a
    // MESMA fase: quem lesse o contrato concluiria que esta migração não podia estar acontecendo, e quem
    // lesse o roteiro concluiria o contrário. Nenhum gate lia o contrato, então a contradição podia durar
    // indefinidamente com o CI verde — que é exatamente o modo como documento canônico envelhece.
    //
    // A trava é SEMÂNTICA e roda sobre o texto NORMALIZADO (sem `*`, `_`, backtick, e com espaços
    // colapsados), para não reprovar por uma quebra de linha diferente nem por alguém tirar um negrito.
    const bruto = fs.readFileSync(path.join(RAIZ, "docs/MODELO-BASE2-CONTRACT.md"), "utf8");
    const contrato = bruto.replace(/[*_`~]/g, "").replace(/\s+/g, " ");

    // NÃO-VACUIDADE primeiro: um arquivo vazio ou truncado passaria em TODA asserção negativa abaixo, e
    // o verde não significaria nada. Prova-se a premissa antes da conclusão.
    expect(contrato.length, "leitura suspeita do contrato — não aprovo por ausência de texto")
      .toBeGreaterThan(4000);
    expect(contrato, "o arquivo lido é mesmo o contrato do Modelo Base 2").toMatch(/Modelo Base 2/);

    // (a) O estado obsoleto não volta: a contradição é BASE2-03 e "congelada" na MESMA frase. O recorte é
    // por frase (nada de ponto final nem quebra entre os dois) de propósito — uma linha HISTÓRICA que
    // narre, em outra frase, que a fase JÁ ESTEVE congelada continua permitida, e é informação legítima.
    expect(contrato, "o contrato não volta a declarar a BASE2-03+ congelada")
      .not.toMatch(/BASE2-03[^.]{0,120}?congelad/i);
    expect(contrato, "nem na ordem inversa da frase")
      .not.toMatch(/congelad[^.]{0,120}?BASE2-03/i);
    expect(contrato, "e não a declara bloqueada, que é a mesma afirmação com outra palavra")
      .not.toMatch(/BASE2-03[^.]{0,120}?bloquead/i);

    // (b) O estado vigente está AFIRMADO — não basta ter apagado a frase velha. Um contrato que ficasse
    // calado sobre a fase passaria em (a) e continuaria sem dizer ao leitor o que vale hoje.
    expect(contrato, "o contrato afirma que a BASE2-03+ está LIBERADA")
      .toMatch(/BASE2-03\+[^.]{0,80}?LIBERADA/);
    expect(contrato, "e que a migração é progressiva, por entidade — não um corte único")
      .toMatch(/progressiv[ao][^.]{0,160}?entidade/i);
    expect(contrato, "a primeira entidade da sequência está nomeada").toMatch(/BASE2-03A/);

    // (c) A invariante que a liberação NÃO revoga. Migrar apresentação nunca fundiu regra de negócio, e é
    // justamente ao abrir a fase de migração ampla que essa linha corre risco de ser perdida na reescrita.
    expect(contrato, "o contrato preserva: tela unificada ≠ regra de negócio unificada")
      .toMatch(/tela unificada ≠ regra de negócio unificada/i);

    // (d) COERÊNCIA ENTRE OS DOIS DONOS. É este o defeito que o caso existe para impedir: cada documento
    // sozinho pode estar bem escrito e ainda assim contradizer o outro. Aqui os dois são lidos na mesma
    // asserção, contra a mesma fase.
    const roteiro = fs.readFileSync(path.join(RAIZ, "docs/PRE-BASE2-ROADMAP.md"), "utf8");
    const linhaDaFase = roteiro.split("\n").find((l) => l.includes("**BASE2-03+**")) ?? "";
    expect(linhaDaFase, "a fase BASE2-03+ precisa existir no roteiro").not.toBe("");
    expect(linhaDaFase, "o roteiro declara a BASE2-03+ LIBERADA").toMatch(/LIBERADA/);
    expect(linhaDaFase, "e o roteiro não a declara congelada").not.toMatch(/CONGELADA/);
  });

  it("T12 · o roteiro de recuperação do DEPLOYMENT não congela o ledger num número de migration", () => {
    // POR QUE ESTE CASO EXISTE. A varredura desta fatia achou o procedimento VIGENTE de recuperação
    // mandando aplicar "as migrations em ordem, `0001` a `0017`" e conferir "esperado: 17 /
    // 0017_purge_farm_legacy.sql". Escrito quando a `0017` era a última, envelheceu em silêncio na `0018`
    // e de novo na `0019` — e o custo não é cosmético: seguir aquele passo reconstrói o ambiente SEM o
    // cutover do contador e SEM o hotfix da numeração, que é exatamente o estado que as duas migrations
    // existem para tornar impossível. Um número decorado num roteiro de recuperação não é documentação
    // desatualizada: é uma instrução errada, que só é lida no pior dia.
    //
    // A trava não exige uma redação: exige que nenhum literal de ledger no documento CONTRADIGA o
    // diretório. Quem escrever um número volta a reprovar; quem apontar para o repositório passa para
    // sempre, sem manutenção — que é o que diferencia um gate de um carimbo com data.
    const migrations = fs.readdirSync(path.join(RAIZ, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const ultima = migrations[migrations.length - 1] ?? "";
    expect(migrations.length, "leitura suspeita de supabase/migrations — não aprovo por ausência").toBeGreaterThanOrEqual(19);
    expect(ultima, "o diretório de migrations precisa ter uma última").toMatch(/^\d{4}_.+\.sql$/);

    const deploy = fs.readFileSync(path.join(RAIZ, "docs/DEPLOYMENT.md"), "utf8");
    expect(deploy, "o roteiro de recuperação continua no documento").toMatch(/RECOVERY = REBUILD FROM ZERO/);

    // (a) Nenhum "esperado: N / 0NNN_arquivo.sql" que discorde do diretório.
    for (const m of deploy.matchAll(/esperado:\s*(\d+)\s*\/\s*(\d{4}_[a-z0-9_]+\.sql)/g)) {
      expect(Number(m[1]), `DEPLOYMENT.md espera ${m[1]} migrations; o diretório tem ${migrations.length}`)
        .toBe(migrations.length);
      expect(m[2], `DEPLOYMENT.md diz que a última é ${m[2]}; no diretório é ${ultima}`).toBe(ultima);
    }

    // (b) Nenhum "`0001` a `00NN`" que pare antes da última. O intervalo com teto literal é a outra
    // forma do mesmo defeito, e foi a que de fato apareceu.
    for (const m of deploy.matchAll(/`0001`\s*(?:a|à|até|-|–)\s*`(\d{4})[^`]*`/g)) {
      expect(`${m[1]}`, `DEPLOYMENT.md manda aplicar só até ${m[1]}; a última do diretório é ${ultima}`)
        .toBe(ultima.slice(0, 4));
    }
  });

  it("T13 · nenhuma fixture de migration se apresenta como 'o estado que produção tem hoje'", () => {
    // POR QUE ESTE CASO EXISTE. As suítes de UPGRADE montam um banco parado na migration ANTERIOR à que
    // está sendo provada — e descreviam esse ponto de partida como "o estado que produção tem hoje".
    // Enquanto a migration em prova era a última implantada, a frase era verdadeira por coincidência. Ela
    // ficou falsa na 0018 e de novo na 0019, e a segunda vez foi encontrada por varredura, não por um
    // gate: o texto continuava verde porque texto não roda. Uma dessas frases é a mensagem de uma
    // asserção — o que o operador lê quando o teste reprova —, então o custo não é estético.
    //
    // A regra é a mesma das outras duas travas de estado: proibir o literal que envelhece, não a ideia.
    // A fixture continua livre para dizer "o estado ANTERIOR ao hotfix"; o que não pode é datar-se no
    // presente ou amarrar "produção" a um número de migration que não é o último do diretório.
    const dir = path.join(RAIZ, "packages/db/test");
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(arquivos.length, "leitura suspeita de packages/db/test — não aprovo por ausência").toBeGreaterThanOrEqual(5);
    for (const nome of arquivos) {
      const texto = fs.readFileSync(path.join(dir, nome), "utf8").replace(/\s+/g, " ");
      expect(texto, `${nome}: "produção tem hoje" data a frase no momento da LEITURA — e já esteve errada duas vezes`)
        .not.toMatch(/produção tem hoje/i);
      // O rótulo inteiro é proibido nestas fixtures, inclusive numa negação: a fixture diz em QUE
      // MIGRATION ela para ("parado na 0018", "ANTERIOR ao hotfix"), que é verdade para sempre. Assim a
      // regra não depende de ler a intenção da frase, e a próxima migration não a torna falsa.
      expect(texto, `${nome}: fixture de migration não se rotula "estado de produção" — diga em que migration ela para`)
        .not.toMatch(/estado de produção/i);
    }
  });

});
