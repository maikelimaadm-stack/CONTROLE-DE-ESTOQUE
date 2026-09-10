# Fluxos de trabalho

## Suprimentos (solicitação de compra)
```
Solicitação ─submit→ Aguardando Ciência ─acknowledge→ Cotação em Andamento ─send_to_approval→ Aguardando Aprovação
   │                       │ reject→ Não Aprovado            │ review→ Analisar Processo            │ approve→ Aguardando a Compra
   └ start_quotation / send_to_approval (fluxo simplificado)                                       │ reject→ Não Aprovado
Aguardando a Compra ─mark_purchased→ Compra Efetuada ─mark_received→ Compra Recebida ─finish→ Pedido Finalizado
Qualquer etapa não terminal ─cancel→ Pedido Cancelado; back_step volta uma etapa. Terminais: Finalizado, Cancelado.
```
Regras: justificativa obrigatória em reprovar/cancelar/analisar; produto exige cotação selecionada e mínimo de cotações do autorizador; autorizador ativo com valor máximo ≥ total; recebimento de produto exige documento fiscal lançado (vínculo `invoice_id`); finalizar tipos serviço/adiantamento/diária/contrato gera conta a pagar; cada transição grava evento com tempo na etapa (SLA por status) e exige `version` atual (conflito → recarregar). Transferência de responsável e comentários não mudam status. Pedido de compra (texto) enviado por WhatsApp/e-mail.

## Estoque
Documento (entrada, NF-e, requisição, baixa, devolução, correção, transferência, batida) → validação → postagem no ledger (custo médio) → saldo atualizado → título/movimento bancário quando aplicável. Cancelamento → status `cancelled` + movimentos `reversal` (nunca apaga). Saída acima do saldo é rejeitada pelo banco. Transferência entre fazendas = saída na origem + entrada no destino ao mesmo custo, na mesma transação.

## Financeiro
Título (manual, NF-e, venda, compra de animais, folha, adiantamento, solicitação) com rateio = 100% → parcelas (intervalo/dia fixo/entrada) ou recorrência → baixa (movimento bancário, encontro de contas, compensação de adiantamento; parcial ou total; juros/desconto/multa) → status `Á vencer/Vencida/Baixa Parcial/Baixada`. Cancelar baixa estorna o movimento e o saldo; cancelar título exige ausência de baixas confirmadas. Congelamento financeiro bloqueia datas dentro do período. Conciliação OFX vincula ou cria movimentos.

## Vendas
Orçamento → (converter) Pedido → (converter) Venda → confirmar: baixa de estoque dos itens com armazém + contas a receber (à vista ou parcelado) na categoria de receita padrão. Cancelar venda confirmada estorna estoque e títulos.

## Pecuária
Compra por contagem (herd lot) → Processamento (identificação individual) → lote → manejos (pesagem c/ GMD, nutrição/sanitário com baixa de estoque e carência, desmama/apartação com reclassificação) → transferências (animais↔lote, agrupar, lote→módulo/área/curral, entre fazendas com processamento no destino) → evolução automática de categoria por idade → venda/morte/perda (status do animal, título a receber na venda). Reprodução: estação aberta → cobertura por matriz (natural/IA/IATF/TE) → diagnóstico (prenha/vazia, parto previsto). Confinamento: batelada de dieta (consome ingredientes, custo/kg) → trato por curral/lote → leitura de cocho → mapa/dashboards.

## Frota / RH / OS
Manutenção (peças do estoque + serviço) e abastecimento (baixa de combustível) alimentam custo do equipamento; depreciação mensal linear idempotente; alertas preventivos por horímetro/km/dias. Folha: adiantamento → título; apuração mensal (salário + eventos fixos + bonificações − faltas − adiantamentos) → títulos a pagar por funcionário → fechamento. OS: aberta → em execução → finalizada (baixa insumos/EPI) → avaliada (nota 1–5); monitoramento de atrasadas.
