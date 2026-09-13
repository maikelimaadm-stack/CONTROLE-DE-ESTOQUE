/**
 * PEDIDO DE EMPRESA ATIVA — mecanismo neutro do contexto de trabalho.
 *
 * A empresa ativa é SELEÇÃO (um filtro de tela), nunca autorização. Quem pede a troca — o seletor do
 * cabeçalho, um localizador global — não troca nada por conta própria: descreve o pedido, e a camada que
 * guarda o estado decide (inclusive pedir confirmação quando há trabalho não salvo). Existe UM caminho, e
 * não um por chamador: um atalho paralelo passaria por fora da proteção e descartaria alterações em silêncio.
 *
 * Aqui não há nome de tela, de rota nem de módulo deste produto: é só a forma do pedido e a regra de quando
 * a troca é necessária.
 */
export interface PedidoEmpresa {
  /** Empresa pedida; `null` = "todas as empresas". */
  empresaId: string | null;
  /** Destino opcional: navegar SÓ DEPOIS que o contexto tiver mudado. */
  rota?: string;
}

/**
 * Normaliza o pedido nos dois formatos aceitos: o canônico (objeto) e o legado (só o identificador, ou
 * `null`). O legado continua valendo porque, numa janela de implantação, o cabeçalho servido pode ser mais
 * antigo que a camada que o escuta.
 */
export function lerPedidoEmpresa(detalhe: unknown): PedidoEmpresa {
  if (detalhe && typeof detalhe === "object") {
    const d = detalhe as { empresaId?: unknown; rota?: unknown };
    return {
      empresaId: typeof d.empresaId === "string" && d.empresaId ? d.empresaId : null,
      ...(typeof d.rota === "string" && d.rota ? { rota: d.rota } : {})
    };
  }
  return { empresaId: typeof detalhe === "string" && detalhe ? detalhe : null };
}

/**
 * A empresa ativa precisa mudar para abrir este registro? Devolve a empresa de destino, ou `null` quando
 * não há troca a fazer.
 *
 * Só há troca quando o contexto está numa empresa ESPECÍFICA e o registro é de OUTRA:
 *   • contexto em "todas" (`null`) é PRESERVADO — a tela abre sem seleção, e estreitar o contexto do usuário
 *     sem necessidade é mudar o que ele estava fazendo;
 *   • registro sem empresa (cadastro da organização inteira) não escolhe empresa nenhuma — inventar uma
 *     transformaria o localizador num seletor arbitrário de contexto.
 */
export function empresaDestinoDoRegistro(atual: string | null, doRegistro: string | null): string | null {
  if (!doRegistro || !atual || atual === doRegistro) return null;
  return doRegistro;
}
