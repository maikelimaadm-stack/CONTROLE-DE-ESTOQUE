import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VERSAO_SCHEMA_CONFIGURACAO_TOP,
  VERSOES_SCHEMA_CONFIGURACAO_TOP,
  SECOES_CONFIGURACAO_TOP,
  configuracaoNeutraTop,
  configuracaoTopEhNeutra,
  configuracoesTopIguais,
  lerConfiguracaoTop,
  normalizarConfiguracaoTop,
  secoesAlteradasTop,
  type ConfiguracaoTipoOperacaoV1,
} from "../src/tipo-operacao-configuracao.js";

/**
 * O CONTRATO DECLARATIVO DA TOP — o que ele aceita, o que ele RECUSA, e o que ele considera igual.
 *
 * A pergunta que este arquivo responde não é "o tipo compila": é "o que acontece com um corpo que o
 * TypeScript nunca viu". Todo payload chega como `unknown` — do cliente e do banco —, e é aqui que se
 * prova que ele passa por uma porta em vez de por uma asserção de tipo.
 */

const clonar = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Trata a configuração como saco de chaves para poder SUJÁ-LA de propósito.
 *
 * O tipo existe para impedir que o produto escreva um campo inválido; o teste precisa justamente escrever
 * um, porque a pergunta é o que acontece com o payload que chega de fora do TypeScript. Passar por
 * `unknown` é o que torna essa intenção explícita em vez de acidental.
 */
const comoSaco = (c: ConfiguracaoTipoOperacaoV1): Record<string, Record<string, unknown>> =>
  c as unknown as Record<string, Record<string, unknown>>;
const comoRaiz = (c: ConfiguracaoTipoOperacaoV1): Record<string, unknown> =>
  c as unknown as Record<string, unknown>;

/** Um candidato válido e NÃO neutro, para os testes de igualdade e diferença terem o que comparar. */
function configuracaoRica(): ConfiguracaoTipoOperacaoV1 {
  const c = configuracaoNeutraTop();
  c.geral.exigeParceiro = true;
  c.geral.confirmacao = "automatica";
  c.estoque.atualizacao = "saida";
  c.estoque.exigeArmazem = true;
  c.financeiro.atualizacao = "receber";
  c.financeiro.exigeVencimento = true;
  c.fiscal.habilitado = true;
  c.fiscal.exigeDocumentoFiscal = true;
  c.aprovacao.politica = "por_valor";
  c.aprovacao.valorMinimo = "1000.00";
  return c;
}

describe("configuração da TOP — o neutro", () => {
  it("o neutro é válido pelo próprio parser (não é um literal que só o autor acredita)", () => {
    const r = lerConfiguracaoTop(configuracaoNeutraTop());
    expect(r.ok, r.ok ? "" : JSON.stringify(r.recusas)).toBe(true);
  });

  it("o neutro não declara efeito nenhum — é isso que o torna seguro para o acervo", () => {
    const n = configuracaoNeutraTop();
    expect(n.estoque.atualizacao).toBe("nenhuma");
    expect(n.financeiro.atualizacao).toBe("nenhuma");
    expect(n.fiscal.habilitado).toBe(false);
    expect(n.aprovacao.politica).toBe("nenhuma");
    expect(configuracaoTopEhNeutra(n)).toBe(true);
  });

  it("cada chamada devolve um objeto NOVO: mutar o resultado não contamina a próxima chamada", () => {
    const a = configuracaoNeutraTop();
    a.estoque.atualizacao = "entrada";
    expect(configuracaoNeutraTop().estoque.atualizacao).toBe("nenhuma");
  });

  it("o neutro é idempotente sob normalização", () => {
    const n = configuracaoNeutraTop();
    expect(normalizarConfiguracaoTop(n)).toEqual(n);
  });
});

describe("configuração da TOP — parse estrito", () => {
  it("recusa o que não é objeto", () => {
    for (const lixo of [null, undefined, 42, "config", [], true]) {
      expect(lerConfiguracaoTop(lixo).ok, `${JSON.stringify(lixo)} não pode ser aceito`).toBe(false);
    }
  });

  it("SCHEMA DESCONHECIDO É RECUSA, e a recusa vem antes de qualquer leitura de campo", () => {
    // O sentinela é "o maior formato conhecido + 1" — e não um número fixo. Até a TOP-CONFIG-04A o
    // sentinela era 2; o formato 2 passou a existir, e manter o 2 aqui testaria outra coisa (a recusa de
    // um v2 sem `execucao`, coberta em `tipo-operacao-execucao.test.ts`).
    const futuro = { ...clonar(configuracaoNeutraTop()), versaoSchema: Math.max(...VERSOES_SCHEMA_CONFIGURACAO_TOP) + 1 };
    const r = lerConfiguracaoTop(futuro);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // UMA recusa só: ler os campos de um payload cuja versão não se conhece seria interpretar bytes com
      // o dicionário errado, e a enxurrada de erros esconderia a causa real.
      expect(r.recusas).toEqual([{ motivo: "schema_nao_suportado", caminho: "versaoSchema" }]);
    }
  });

  it("campo desconhecido é RECUSA, nunca descarte silencioso", () => {
    const comLixo = comoRaiz(clonar(configuracaoNeutraTop()));
    comLixo.efeitoSecreto = true;
    const r = lerConfiguracaoTop(comLixo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "campo_desconhecido", caminho: "efeitoSecreto" });
  });

  it("campo desconhecido DENTRO de uma seção também é recusa — inclusive com erro de digitação", () => {
    const c = comoSaco(clonar(configuracaoNeutraTop()));
    c.estoque!.exigeArmazen = true;          // "n" no lugar de "m": o caso que um schema frouxo apagaria
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "campo_desconhecido", caminho: "estoque.exigeArmazen" });
  });

  it("tipo errado é recusa, com o caminho do campo", () => {
    const c = comoSaco(clonar(configuracaoNeutraTop()));
    c.geral!.exigeParceiro = "sim";
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "tipo_invalido", caminho: "geral.exigeParceiro" });
  });

  it("valor fora do enum NEGA — não cai no vizinho nem no padrão", () => {
    const c = comoSaco(clonar(configuracaoNeutraTop()));
    c.estoque!.atualizacao = "saída";        // com acento: parecido, e ainda assim desconhecido
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "valor_invalido", caminho: "estoque.atualizacao" });
  });

  it("seção ausente é recusa", () => {
    for (const secao of SECOES_CONFIGURACAO_TOP) {
      const c = comoRaiz(clonar(configuracaoNeutraTop()));
      delete c[secao];
      const r = lerConfiguracaoTop(c);
      expect(r.ok, `sem "${secao}" não pode ser aceito`).toBe(false);
    }
  });

  it("NÃO MUTA a entrada", () => {
    const entrada = clonar(configuracaoRica());
    const antes = JSON.stringify(entrada);
    lerConfiguracaoTop(entrada);
    expect(JSON.stringify(entrada)).toBe(antes);
  });
});

describe("configuração da TOP — aprovação por valor", () => {
  it('"por valor" sem valor é recusa: seria uma regra que nunca dispara', () => {
    const c = clonar(configuracaoNeutraTop());
    c.aprovacao.politica = "por_valor";
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "valor_invalido", caminho: "aprovacao.valorMinimo" });
  });

  it("valor não positivo, malformado ou exótico é recusa", () => {
    for (const v of ["0", "0.00", "-5", "abc", "1e3", " 10 ", "10.999", "Infinity", ""]) {
      const c = clonar(configuracaoNeutraTop());
      c.aprovacao.politica = "por_valor";
      c.aprovacao.valorMinimo = v;
      expect(lerConfiguracaoTop(c).ok, `"${v}" não pode ser aceito como limite`).toBe(false);
    }
  });

  it("valor decimal em string é aceito — dinheiro nunca é ponto flutuante", () => {
    const c = clonar(configuracaoNeutraTop());
    c.aprovacao.politica = "por_valor";
    c.aprovacao.valorMinimo = "1000.10";
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.aprovacao.valorMinimo).toBe("1000.10");
  });

  it("número (não string) é recusa: é por aí que 1000.10 vira 1000.0999999", () => {
    const c = comoSaco(clonar(configuracaoNeutraTop()));
    c.aprovacao!.politica = "por_valor";
    c.aprovacao!.valorMinimo = 1000.1;
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas).toContainEqual({ motivo: "tipo_invalido", caminho: "aprovacao.valorMinimo" });
  });
});

describe("configuração da TOP — normalização das dependências", () => {
  it("estoque em `nenhuma` zera os filhos", () => {
    const c = clonar(configuracaoNeutraTop());
    c.estoque.atualizacao = "nenhuma";
    c.estoque.exigeArmazem = true;
    c.estoque.saldoNegativo = "permitir";
    const n = normalizarConfiguracaoTop(c);
    expect(n.estoque).toEqual(configuracaoNeutraTop().estoque);
  });

  it("financeiro em `nenhuma` zera os filhos", () => {
    const c = clonar(configuracaoNeutraTop());
    c.financeiro.atualizacao = "nenhuma";
    c.financeiro.exigeVencimento = true;
    c.financeiro.modo = "provisionar";
    const n = normalizarConfiguracaoTop(c);
    expect(n.financeiro).toEqual(configuracaoNeutraTop().financeiro);
  });

  it("fiscal desabilitado zera os filhos", () => {
    const c = clonar(configuracaoNeutraTop());
    c.fiscal.habilitado = false;
    c.fiscal.exigeDocumentoFiscal = true;
    c.fiscal.calculoTributario = "preparado";
    const n = normalizarConfiguracaoTop(c);
    expect(n.fiscal).toEqual(configuracaoNeutraTop().fiscal);
  });

  it("aprovação diferente de `por_valor` zera o limite", () => {
    for (const politica of ["nenhuma", "sempre"] as const) {
      const c = clonar(configuracaoNeutraTop());
      c.aprovacao.politica = politica;
      c.aprovacao.valorMinimo = "500.00";
      expect(normalizarConfiguracaoTop(c).aprovacao.valorMinimo).toBeNull();
    }
  });

  it("ligado, os filhos são PRESERVADOS — a normalização zera o que não significa nada, não o que significa", () => {
    const c = clonar(configuracaoNeutraTop());
    c.estoque.atualizacao = "saida";
    c.estoque.exigeArmazem = true;
    c.estoque.saldoNegativo = "permitir";
    const n = normalizarConfiguracaoTop(c);
    expect(n.estoque.exigeArmazem).toBe(true);
    expect(n.estoque.saldoNegativo).toBe("permitir");
  });

  it("é IDEMPOTENTE: normalizar duas vezes dá o mesmo resultado", () => {
    const c = configuracaoRica();
    expect(normalizarConfiguracaoTop(normalizarConfiguracaoTop(c))).toEqual(normalizarConfiguracaoTop(c));
  });

  it("não muta a entrada", () => {
    const c = configuracaoRica();
    c.estoque.atualizacao = "nenhuma";
    c.estoque.exigeArmazem = true;
    const antes = JSON.stringify(c);
    normalizarConfiguracaoTop(c);
    expect(JSON.stringify(c)).toBe(antes);
  });

  it("o parser já devolve NORMALIZADO — a API não precisa lembrar de chamar", () => {
    const c = clonar(configuracaoNeutraTop());
    c.estoque.atualizacao = "nenhuma";
    c.estoque.exigeArmazem = true;
    const r = lerConfiguracaoTop(c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.estoque.exigeArmazem).toBe(false);
  });
});

describe("configuração da TOP — igualdade semântica", () => {
  it("A ORDEM DAS CHAVES NÃO CRIA VERSÃO FALSA", () => {
    const a = configuracaoRica();
    // Mesmo significado, chaves em ordem inversa — o que `JSON.stringify` puro faria parecer diferente.
    const invertido = JSON.parse(JSON.stringify(a), (_k, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse())
        : v) as ConfiguracaoTipoOperacaoV1;
    expect(JSON.stringify(invertido)).not.toBe(JSON.stringify(a));   // a premissa: os bytes DIFEREM
    expect(configuracoesTopIguais(a, invertido)).toBe(true);          // e ainda assim são a mesma coisa
  });

  it("campo pendurado numa seção desligada não conta como diferença", () => {
    const a = clonar(configuracaoNeutraTop());
    const b = clonar(configuracaoNeutraTop());
    b.estoque.exigeArmazem = true;   // com `atualizacao: "nenhuma"`, não significa nada
    expect(configuracoesTopIguais(a, b)).toBe(true);
  });

  it("diferença real é detectada", () => {
    const a = configuracaoNeutraTop();
    const b = clonar(a);
    b.estoque.atualizacao = "saida";
    expect(configuracoesTopIguais(a, b)).toBe(false);
  });
});

describe("configuração da TOP — seções alteradas (auditoria)", () => {
  it("lista só as seções que mudaram de significado", () => {
    const a = configuracaoNeutraTop();
    const b = clonar(a);
    b.estoque.atualizacao = "entrada";
    b.fiscal.habilitado = true;
    expect(secoesAlteradasTop(a, b)).toEqual(["estoque", "fiscal"]);
  });

  it("sem mudança, lista vazia — é isto que faz o no-op não gerar auditoria falsa", () => {
    expect(secoesAlteradasTop(configuracaoNeutraTop(), configuracaoNeutraTop())).toEqual([]);
  });

  it("mudança neutralizada pela normalização não aparece", () => {
    const a = configuracaoNeutraTop();
    const b = clonar(a);
    b.financeiro.exigeVencimento = true;   // com `atualizacao: "nenhuma"`, é ruído
    expect(secoesAlteradasTop(a, b)).toEqual([]);
  });

  it("segue a ordem canônica das seções, para o log ser comparável entre registros", () => {
    const a = configuracaoNeutraTop();
    const b = configuracaoRica();
    const mudadas = secoesAlteradasTop(a, b);
    expect(mudadas).toEqual(SECOES_CONFIGURACAO_TOP.filter((s) => mudadas.includes(s)));
  });
});

describe("configuração da TOP — a fronteira com o SQL", () => {
  /**
   * O NEUTRO TEM UM DONO, MAS A MIGRATION PRECISA DE UMA CÓPIA.
   *
   * SQL não importa TypeScript: o `DEFAULT` da 0022 é necessariamente um literal. Uma cópia sem gate
   * envelhece em silêncio — alguém acrescenta um campo ao contrato, esquece o SQL, e as versões criadas
   * pela API antiga passam a nascer com uma forma que o parser recusa. Este teste é o que transforma
   * essa cópia num espelho verificado.
   */
  it("o DEFAULT da migration 0022 é exatamente o neutro do domínio", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0022_tipo_operacao_configuracao_versionada.sql", import.meta.url)),
      "utf8",
    );
    const m = /add column if not exists configuracao jsonb not null default '([\s\S]*?)'::jsonb/.exec(sql);
    expect(m, "o DEFAULT da coluna `configuracao` precisa continuar legível para este gate").not.toBeNull();

    const doSql = JSON.parse(m![1]!) as unknown;
    const r = lerConfiguracaoTop(doSql);
    expect(r.ok, r.ok ? "" : `o literal do SQL não passa no parser: ${JSON.stringify(r.recusas)}`).toBe(true);
    if (r.ok) expect(r.valor).toEqual(configuracaoNeutraTop());
  });

  it("a versão de schema declarada no SQL é a mesma do domínio", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/0022_tipo_operacao_configuracao_versionada.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toContain(`add column if not exists configuracao_schema_version int not null default ${VERSAO_SCHEMA_CONFIGURACAO_TOP}`);
  });
});
