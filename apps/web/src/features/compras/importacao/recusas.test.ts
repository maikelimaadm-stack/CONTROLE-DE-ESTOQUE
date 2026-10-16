import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { recusasNoCampo } from "./api";
import { abaDoCaminho } from "./estado";

describe("recusasNoCampo · exigências da TOP", () => {
  it("lê { exigencias: [{ caminho, mensagem }] } (TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA)", () => {
    const err = new ApiError(422, "TIPO_OPERACAO_EXIGENCIA_NAO_ATENDIDA", "A operação exige dados que o documento não tem.", {
      exigencias: [
        { caminho: "centro_custo_id", mensagem: "Centro de resultado é obrigatório nesta operação." },
        { caminho: "transportadora_id", mensagem: "Transportadora é obrigatória nesta operação." }
      ]
    });
    expect(recusasNoCampo(err)).toEqual([
      { path: "centro_custo_id", message: "Centro de resultado é obrigatório nesta operação." },
      { path: "transportadora_id", message: "Transportadora é obrigatória nesta operação." }
    ]);
  });

  it("continua lendo a lista { path, message } de sempre", () => {
    const err = new ApiError(422, "VALIDATION", "inválido", [{ path: "financeiro.forma_pagamento_id", message: "informe a forma" }]);
    expect(recusasNoCampo(err)).toEqual([{ path: "financeiro.forma_pagamento_id", message: "informe a forma" }]);
  });
});

describe("abaDoCaminho · campos da exigência da TOP", () => {
  it("leva centro, forma, condição e vencimento ao Financeiro", () => {
    expect(abaDoCaminho("centro_custo_id")).toBe("financeiro");
    expect(abaDoCaminho("categoria_financeira_id")).toBe("financeiro");
    expect(abaDoCaminho("forma_pagamento_id")).toBe("financeiro");
    expect(abaDoCaminho("condicao_pagamento_id")).toBe("financeiro");
    expect(abaDoCaminho("data_vencimento")).toBe("financeiro");
  });

  it("leva transportadora e observação ao Cabeçalho", () => {
    expect(abaDoCaminho("transportadora_id")).toBe("cabecalho");
    expect(abaDoCaminho("observacao")).toBe("cabecalho");
  });
});
