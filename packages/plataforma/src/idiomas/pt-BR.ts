/**
 * Catálogo pt-BR — idioma inicial obrigatório e referência de completude dos demais idiomas.
 *
 * Chave canônica (`acoes.salvar`) nunca muda com o idioma; o texto à direita é apresentação.
 * A terminologia segue docs/UI-STANDARD.md ("Idioma e terminologia"): Situação (nunca "Status"),
 * Painel (nunca "Dashboard"), sem abreviações. O guardrail de copy audita este arquivo.
 */
import type { Catalogo } from "../idioma.js";

export const ptBR: Catalogo = {
  idioma: "pt-BR",
  mensagens: {
    // Ações
    "acoes.salvar": "Salvar",
    "acoes.cancelar": "Cancelar",
    "acoes.confirmar": "Confirmar",
    "acoes.excluir": "Excluir",
    "acoes.remover": "Remover",
    "acoes.fechar": "Fechar",
    "acoes.voltar": "Voltar",
    "acoes.pesquisar": "Pesquisar",
    "acoes.buscar": "Buscar",
    "acoes.visualizar": "Visualizar",
    "acoes.novo": "Novo",
    "acoes.editar": "Editar",
    "acoes.tentar_novamente": "Tentar novamente",
    "acoes.mais_opcoes": "Mais opções",
    "acoes.ok": "OK",

    // Termos gerais
    "termos.situacao": "Situação",
    "termos.painel": "Painel",
    "termos.informacoes": "Informações",
    "termos.aviso": "Aviso",
    "termos.erro": "Erro",
    "termos.sucesso": "Sucesso",
    "termos.nao_informado": "Não informado",
    "termos.desconhecido": "Desconhecido",
    "termos.organizacao": "Organização",
    "termos.empresa": "Empresa",
    "termos.empresas": "Empresas",
    "termos.id_global": "ID Global",
    "termos.idioma": "Idioma",

    // Mensagens
    "mensagens.carregando": "Carregando…",
    "mensagens.nenhum_registro": "Nenhum registro encontrado.",
    "mensagens.nenhum_item": "Nenhum item",
    "mensagens.campos_obrigatorios": "Existem campos obrigatórios que precisam ser preenchidos.",
    "mensagens.alteracoes_nao_salvas": "Existem alterações não salvas.",
    "mensagens.fechar_aviso": "Fechar aviso",
    "mensagens.erro_generico": "Não foi possível concluir. Tente novamente.",

    // Escopo de empresa (contrato multiempresa)
    "empresa.todas": "Todas as empresas",
    "empresa.selecione": "Selecione a empresa",
    "empresa.obrigatoria": "Selecione a empresa do lançamento.",
    "empresa.sem_acesso": "Sem acesso à empresa selecionada.",
    "empresa.escopo_consulta": "\"Todas as empresas\" é um escopo de consulta e não pode ser gravado em um lançamento.",

    // Acesso por empresa e módulo (administração)
    "acesso_empresa.titulo": "Acesso por Empresa",
    "acesso_empresa.descricao": "Em quais empresas o usuário atua, módulo a módulo. O perfil define O QUE ele pode fazer; aqui define-se ONDE. É preciso ter as duas coisas.",
    "acesso_empresa.modulo": "Módulo",
    "acesso_empresa.modo": "Acesso",
    "acesso_empresa.modo_todas": "Todas as empresas",
    "acesso_empresa.modo_selecionadas": "Empresas selecionadas",
    "acesso_empresa.modo_nenhuma": "Nenhuma empresa",
    "acesso_empresa.sem_configuracao": "Sem configuração: nenhuma empresa neste módulo.",
    "acesso_empresa.sem_permissao": "O perfil não tem permissão neste módulo.",
    "acesso_empresa.selecione_empresas": "Selecione ao menos uma empresa.",
    "acesso_empresa.proprietario": "Proprietário da organização: acesso a todas as empresas em todos os módulos.",

    // ID Global
    "id_global.nao_encontrado": "Nenhum registro encontrado para este ID Global.",
    "id_global.buscar": "Buscar por ID Global (#)"
  }
};

export default ptBR;
