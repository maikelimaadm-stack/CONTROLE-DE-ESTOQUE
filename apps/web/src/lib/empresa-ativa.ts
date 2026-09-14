/**
 * PEDIDO DE EMPRESA ATIVA no cliente.
 *
 * A regra é MECANISMO e mora no pacote neutro (`@erp/plataforma`): o que é "pedir para trocar de empresa" e
 * quando a troca é necessária não tem nada de específico deste segmento de negócio — e, morando lá, é
 * testável sem navegador. Aqui fica só a reexportação, para que a interface importe de um lugar só.
 */
export { lerPedidoEmpresa, empresaDestinoDoRegistro, type PedidoEmpresa } from "@erp/plataforma";
