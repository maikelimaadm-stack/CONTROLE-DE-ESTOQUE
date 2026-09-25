import { describe, it, expect } from "vitest";
import { formatarMascara, normalizarMascara, formatarCep, formatarTelefone, mascaraDoTipoDePessoa, mascaraDoDocumento, recusaDoDigitoDoDocumento, semRotuloDeDocumento, textoEhCep, tipoPessoaPeloDocumento, validarCnpj } from "../src/documento.js";

/** B-3 / B-4 — máscaras de entrada: mostra formatado, grava normalizado, colar com pontuação funciona. */
describe("B-3 máscaras: formato completo", () => {
  it("CPF 000.000.000-00", () => { expect(formatarMascara("cpf", "52998224725")).toBe("529.982.247-25"); });
  it("CNPJ numérico 00.000.000/0000-00", () => { expect(formatarMascara("cnpj", "11222333000181")).toBe("11.222.333/0001-81"); });
  it("CNPJ alfanumérico em maiúsculas, DV numérico", () => {
    expect(formatarMascara("cnpj", "12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(validarCnpj(normalizarMascara("cnpj", "12.abc.345/01de-35"))).toBe(true);
  });
  it("CEP 00000-000", () => { expect(formatarCep("78250000")).toBe("78250-000"); });
  it("telefone fixo e celular", () => {
    expect(formatarTelefone("6532221234")).toBe("(65) 3222-1234");
    expect(formatarTelefone("65999887766")).toBe("(65) 99988-7766");
  });
});

describe("B-3 máscaras: progressivo, colar e normalizar", () => {
  it("formata parcial sem pontuação sobrando", () => {
    expect(formatarMascara("cpf", "529")).toBe("529");
    expect(formatarMascara("cpf", "5299")).toBe("529.9");
    expect(formatarMascara("cnpj", "11222")).toBe("11.222");
    expect(formatarMascara("cep", "78250")).toBe("78250");
    expect(formatarMascara("telefone", "65")).toBe("(65");
    expect(formatarMascara("telefone", "653")).toBe("(65) 3");
    expect(formatarMascara("cpf", "")).toBe("");
  });
  it("colar com pontuação grava normalizado e corta no tamanho", () => {
    expect(normalizarMascara("cpf", "529.982.247-25")).toBe("52998224725");
    expect(normalizarMascara("cpf", "529.982.247-2599")).toBe("52998224725");
    expect(normalizarMascara("cnpj", "11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarMascara("cep", "78.250-000")).toBe("78250000");
    expect(normalizarMascara("telefone", "+(65) 99988-7766")).toBe("65999887766");
  });
  it("CNPJ: letra nas posições do DV é descartada; caractere fora de [0-9A-Z] some", () => {
    expect(normalizarMascara("cnpj", "12ABC34501DEA35")).toBe("12ABC34501DE35");
    expect(normalizarMascara("cnpj", "12*ABC")).toBe("12ABC");
  });
});

describe("B-4 documento pelo tipo de pessoa e DV ao sair", () => {
  it("máscara segue o tipo; Estrangeira e desconhecido ficam sem máscara", () => {
    expect(mascaraDoTipoDePessoa("natural")).toBe("cpf");
    expect(mascaraDoTipoDePessoa("legal")).toBe("cnpj");
    expect(mascaraDoTipoDePessoa("foreign")).toBeNull();
    expect(mascaraDoTipoDePessoa("xyz")).toBeNull();
  });
  it("em Física o documento NUNCA é cortado: colar/digitar um CNPJ passa a máscara para CNPJ", () => {
    // defeito achado pelo E2E UI-5/UI-6: a máscara de CPF cortava o CNPJ colado em 11 dígitos ("320.071.880-00")
    expect(mascaraDoDocumento("natural", "32007188000196")).toBe("cnpj");
    expect(formatarMascara(mascaraDoDocumento("natural", "32.007.188/0001-96")!, normalizarMascara("cnpj", "32.007.188/0001-96"))).toBe("32.007.188/0001-96");
    expect(mascaraDoDocumento("natural", "529982247250")).toBe("cnpj"); // o 12º dígito já é CNPJ
    expect(mascaraDoDocumento("natural", "12ABC")).toBe("cnpj"); // letra só existe em CNPJ
    expect(mascaraDoDocumento("natural", "52998224725")).toBe("cpf");
    expect(mascaraDoDocumento("legal", "5299")).toBe("cnpj");
    expect(mascaraDoDocumento("legal", "32007188000196")).toBe("cnpj");
    expect(mascaraDoDocumento("foreign", "32007188000196")).toBeNull();
    expect(mascaraDoDocumento(null, "52998224725")).toBe("cpf");
    expect(mascaraDoDocumento(null, "32007188000196")).toBe("cnpj");
  });
  it("DV: válido → null; errado → mensagem; vazio → null", () => {
    expect(recusaDoDigitoDoDocumento("cpf", "529.982.247-25")).toBeNull();
    expect(recusaDoDigitoDoDocumento("cpf", "529.982.247-26")).toBe("CPF inválido");
    expect(recusaDoDigitoDoDocumento("cnpj", "11.222.333/0001-81")).toBeNull();
    expect(recusaDoDigitoDoDocumento("cnpj", "11.222.333/0001-82")).toBe("CNPJ inválido");
    expect(recusaDoDigitoDoDocumento("cnpj", "")).toBeNull();
  });
  it("texto é CEP: 8 dígitos com ou sem hífen", () => {
    expect(textoEhCep("78250-000")).toBe(true);
    expect(textoEhCep("78250000")).toBe(true);
    expect(textoEhCep("5106752")).toBe(false);
    expect(textoEhCep("pontes")).toBe(false);
  });
});

/** R1 (W-6) — telefone NUNCA corta dígito calado: +55 sai quando passa de 11; o que ainda passar fica como digitado. */
describe("R1 W-6 telefone sem corte", () => {
  const digitos = (v: string) => v.replace(/\D/g, "");
  it("+55 (65) 99999-8888 grava 65999998888 e mostra (65) 99999-8888", () => {
    expect(normalizarMascara("telefone", "+55 (65) 99999-8888")).toBe("65999998888");
    expect(formatarTelefone("+55 (65) 99999-8888")).toBe("(65) 99999-8888");
    expect(normalizarMascara("telefone", "+55 65 3266-1234")).toBe("6532661234");
    expect(formatarTelefone("556532661234")).toBe("(65) 3266-1234");
  });
  it("legado com ramal não é cortado nem remascarado: fica como digitado", () => {
    const legado = "(65) 3266-1234 r.22";
    expect(normalizarMascara("telefone", legado)).toBe(legado);
    expect(formatarTelefone(legado)).toBe(legado);
    expect(formatarTelefone(legado)).not.toBe("(65) 32661-2342"); // o defeito da revisão
  });
  it("mais de 11 dígitos sem o 55 do início: nenhum dígito some", () => {
    expect(normalizarMascara("telefone", "653266123422")).toBe("653266123422");
    expect(formatarTelefone("653266123422")).toBe("653266123422");
    expect(normalizarMascara("telefone", "(65) 3266-1234 / 3266-5678")).toBe("(65) 3266-1234 / 3266-5678");
  });
  it("DDD 55 com 11 dígitos não perde o DDD (o 55 só sai quando passa de 11)", () => {
    expect(normalizarMascara("telefone", "(55) 99999-8888")).toBe("55999998888");
    expect(formatarTelefone("55999998888")).toBe("(55) 99999-8888");
  });
  it("propriedade: todo dígito digitado sobrevive (tirando só o 55 que leva a 11 ou menos)", () => {
    const casos = ["65999998888", "6532661234", "+55 (65) 99999-8888", "0800 123 4567", "(65) 3266-1234 ramal 22", "+1 (555) 123-4567 x89", "5565999998888123"];
    for (const c of casos) {
      const n = normalizarMascara("telefone", c); const d = digitos(c); const dn = digitos(n);
      expect(dn === d || (d.startsWith("55") && dn === d.slice(2) && dn.length <= 11), `${c} → ${n}`).toBe(true);
      expect(digitos(formatarMascara("telefone", n)), `formatado de ${c}`).toBe(dn);
    }
  });
  it("digitação progressiva com +55 termina no celular de 11 dígitos", () => {
    let valor = "";
    for (const c of "+5565999998888") valor = normalizarMascara("telefone", formatarMascara("telefone", valor) + c);
    expect(valor).toBe("65999998888");
    expect(formatarTelefone(valor)).toBe("(65) 99999-8888");
  });
});

/** R1 (W-8) — colar "CNPJ: 12.345…" ou "CPF 123…" tira o rótulo antes de normalizar. */
describe("R1 W-8 rótulo colado no documento", () => {
  it("CNPJ e CPF com rótulo", () => {
    expect(normalizarMascara("cnpj", "CNPJ: 11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarMascara("cnpj", "cnpj 11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarMascara("cnpj", "CPF 529.982.247-25")).toBe("52998224725");
    expect(normalizarMascara("cpf", "CPF: 529.982.247-25")).toBe("52998224725");
    expect(normalizarMascara("cnpj", "CPF/CNPJ nº 11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizarMascara("cnpj", "CNPJ - 12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
  });
  it("sem separador depois do rótulo nada é tirado (CNPJ alfanumérico que começa por letras continua inteiro)", () => {
    expect(semRotuloDeDocumento("CPF123450001")).toBe("CPF123450001");
    expect(normalizarMascara("cnpj", "CPFA12345000")).toBe("CPFA12345000");
  });
});

/** R1 (W-4/W-8) — o tipo de pessoa pelo documento: Jurídica a partir de 12 posições; Física só ao sair com 11. */
describe("R1 W-4 tipo de pessoa pelo documento e máscara durante a digitação", () => {
  it("Jurídica a partir de 12 posições, já ao digitar; Física só ao sair com 11 dígitos", () => {
    expect(tipoPessoaPeloDocumento("11222333000", "digitando")).toBeNull();
    expect(tipoPessoaPeloDocumento("112223330001", "digitando")).toBe("legal");
    expect(tipoPessoaPeloDocumento("11222333000181", "digitando")).toBe("legal");
    expect(tipoPessoaPeloDocumento("52998224725", "digitando")).toBeNull();
    expect(tipoPessoaPeloDocumento("52998224725", "saindo")).toBe("natural");
    expect(tipoPessoaPeloDocumento("529.982.247-25", "saindo")).toBe("natural");
    expect(tipoPessoaPeloDocumento("5299822472", "saindo")).toBeNull();
    expect(tipoPessoaPeloDocumento("12ABC34501DE35", "digitando")).toBe("legal");
    expect(tipoPessoaPeloDocumento("", "saindo")).toBeNull();
  });
  it("digitar um CNPJ tecla a tecla em Jurídica nunca passa por Física nem por máscara de CPF", () => {
    const cnpj = "11222333000181";
    for (let i = 1; i <= cnpj.length; i++) {
      const parcial = cnpj.slice(0, i);
      expect(tipoPessoaPeloDocumento(parcial, "digitando"), parcial).not.toBe("natural");
      expect(mascaraDoDocumento("legal", parcial, true), parcial).toBe("cnpj");
      // a máscara nunca corta: todo dígito digitado continua lá
      expect(formatarMascara("cnpj", normalizarMascara("cnpj", formatarMascara("cnpj", parcial))).replace(/\D/g, "")).toBe(parcial);
    }
  });
  it("em Física, o 12º dígito passa a máscara para CNPJ sem cortar (até 14)", () => {
    const cnpj = "11222333000181";
    let texto = "";
    for (const c of cnpj) { const n = normalizarMascara("cnpj", texto + c); texto = formatarMascara(mascaraDoDocumento("natural", n, true)!, n); }
    expect(texto).toBe("11.222.333/0001-81");
  });
  it("Jurídica com CPF, fora do campo, aparece como CPF — sem 'CNPJ inválido' falso", () => {
    expect(mascaraDoDocumento("legal", "52998224725")).toBe("cpf");
    expect(mascaraDoDocumento("legal", "52998224725", true)).toBe("cnpj");
    expect(formatarMascara(mascaraDoDocumento("legal", "52998224725")!, "52998224725")).toBe("529.982.247-25");
    expect(recusaDoDigitoDoDocumento(mascaraDoDocumento("legal", "52998224725")!, "52998224725")).toBeNull();
    expect(mascaraDoDocumento("legal", "5299822472")).toBe("cnpj");
  });
});
