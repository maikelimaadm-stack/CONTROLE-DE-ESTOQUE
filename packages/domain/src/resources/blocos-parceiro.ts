/**
 * BLOCOS DO PARCEIRO (CADASTROS AJUSTES 02, 2.4) — ordem e rótulos ÚNICOS do endereço, da conta e do contato.
 * O bloco principal (seções da ficha) e cada cartão adicional (detalhes enderecos/contas/contatos) são desenhados
 * pelo MESMO componente a partir destas listas: o CORPO é igual; as diferenças são só as declaradas aqui (topo e fim
 * do adicional, `soPrincipal`). O teste de paridade confere estas listas contra o registry.
 *
 * `principal`/`adicional` = nome do campo no registry (null = a parte não existe daquele lado). `parteDe` = parte
 * derivada de uma referência oficial (Código IBGE e UF do `city_id`; Código do banco do `bank_code`): não é campo
 * gravado, é caixa só leitura ao lado da busca.
 */
export interface ParteDoBloco {
  chave: string;
  rotulo: string;
  principal: string | null;
  adicional: string | null;
  parteDe?: { campo: "city_id" | "bank_code"; parte: "codigo" | "extra" };
}
export interface BlocoDoParceiro {
  detalhe: "enderecos" | "contas" | "contatos";
  secao: string;
  topoAdicional: readonly ParteDoBloco[];
  corpo: readonly ParteDoBloco[];
  fimAdicional: readonly ParteDoBloco[];
  incluir: string;
  remover: string;
}

const p = (chave: string, rotulo: string, principal: string | null, adicional: string | null, parteDe?: ParteDoBloco["parteDe"]): ParteDoBloco => ({ chave, rotulo, principal, adicional, ...(parteDe ? { parteDe } : {}) });

export const BLOCO_ENDERECO: BlocoDoParceiro = {
  detalhe: "enderecos", secao: "Endereço", incluir: "Incluir endereço", remover: "Remover endereço",
  topoAdicional: [p("tipo", "Tipo", null, "tipo"), p("descricao", "Descrição", null, "descricao")],
  corpo: [
    p("cep", "CEP", "zip_code", "cep"), p("endereco", "Endereço", "address", "logradouro"), p("numero", "Número", "address_number", "numero"),
    p("complemento", "Complemento", "complemento", "complemento"), p("bairro", "Bairro", "district", "bairro"),
    p("cidade", "Cidade", "city_id", "city_id"), p("codigo_ibge", "Código IBGE", "city_id", "city_id", { campo: "city_id", parte: "codigo" }), p("uf", "UF", "city_id", "city_id", { campo: "city_id", parte: "extra" }),
    p("caixa_postal", "Caixa postal", "caixa_postal", null), p("latitude", "Latitude", "latitude", "latitude"), p("longitude", "Longitude", "longitude", "longitude")
  ],
  fimAdicional: [p("inscricao_estadual", "IE da propriedade", null, "inscricao_estadual"), p("ativo", "Ativo", null, "is_active")]
};

export const BLOCO_CONTA: BlocoDoParceiro = {
  detalhe: "contas", secao: "Conta", incluir: "Incluir conta", remover: "Remover conta",
  topoAdicional: [p("titular", "Titular", null, "titular")],
  corpo: [
    p("banco", "Banco", "bank_code", "bank_code"), p("codigo_banco", "Código do banco", "bank_code", "bank_code", { campo: "bank_code", parte: "codigo" }),
    p("tipo_conta", "Tipo de conta", "bank_account_type", "tipo"), p("agencia", "Agência", "bank_agency", "agencia"), p("conta", "Conta", "bank_account", "conta"),
    p("pix_tipo", "Tipo de chave Pix", "pix_type", "pix_tipo"), p("pix_chave", "Chave Pix", "pix_key", "pix_chave")
  ],
  fimAdicional: []
};

export const BLOCO_CONTATO: BlocoDoParceiro = {
  detalhe: "contatos", secao: "Contato", incluir: "Incluir contato", remover: "Remover contato",
  topoAdicional: [p("nome", "Nome", null, "nome"), p("funcao", "Função", null, "funcao")],
  corpo: [p("telefone", "Telefone", "phone", "telefone"), p("celular", "Celular", "cellphone", "celular"), p("email", "E-mail", "email", "email")],
  fimAdicional: [p("recebe_nfe", "Recebe NF-e por e-mail", null, "recebe_nfe_email")]
};

export const BLOCOS_DO_PARCEIRO: readonly BlocoDoParceiro[] = [BLOCO_ENDERECO, BLOCO_CONTA, BLOCO_CONTATO];
export function blocoDoDetalhe(detalhe: string): BlocoDoParceiro | undefined { return BLOCOS_DO_PARCEIRO.find((b) => b.detalhe === detalhe); }
/** Partes de um lado ("principal" = seção da ficha; "adicional" = cartão), na ordem de desenho. */
export function partesDoLado(b: BlocoDoParceiro, lado: "principal" | "adicional"): ParteDoBloco[] {
  return (lado === "principal" ? b.corpo : [...b.topoAdicional, ...b.corpo, ...b.fimAdicional]).filter((x) => x[lado] !== null);
}
