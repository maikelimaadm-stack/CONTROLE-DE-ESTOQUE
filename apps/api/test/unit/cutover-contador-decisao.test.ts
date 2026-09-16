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
    // O que continua verdade, e o teste não pode apagar: o gate segue BLOCKED — por falta de confirmação
    // ACCOUNT-SPECIFIC, não por falta de primitiva.
    const rb = fs.readFileSync(path.join(RAIZ, "docs/PRE-BASE2-05C-2-CUTOVER.md"), "utf8");
    expect(rb, "a primitiva documentada é nomeada").toMatch(/Remove/);
    expect(rb, "e tratada como mecanismo preferencial candidato").toMatch(/MECANISMO PREFERENCIAL CANDIDATO/);
    expect(rb, "o runbook continua BLOCKED").toMatch(/Estado deste runbook: `BLOCKED`/);
    expect(rb, "e diz que falta confirmação account-specific").toMatch(/ACCOUNT-SPECIFIC/);
    // A frase antiga, categórica, não pode voltar.
    expect(rb, "não afirma mais ausência de mecanismo").not.toMatch(/Não existe hoje, neste produto, mecanismo comprovável/);
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
});
