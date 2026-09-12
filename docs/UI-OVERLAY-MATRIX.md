# Matriz de overlays (UI-STAB-01)

Perfis dimensionais do `Dialog` (`apps/web/src/components/ui/overlays.tsx`, tokens em `globals.css`): **compact** (altura
pelo conteúdo, máx. 70 dvh) · **content** (pelo conteúdo até `--mg-dialog-max-h`) · **standard** (frame fixo 560 px) ·
**large** (frame fixo 720 px) · **workspace** (viewport − 32 px). Padrão por largura: sm → compact, md → content,
lg → large, xl → workspace; `profile` explícito sobrescreve. Header e footer são fixos; só o corpo rola; LoadingState /
ErrorState / EmptyState ocupam o corpo sem alterar o frame. Drawer: altura total da viewport desde a abertura.

| Tela | Overlay | Primitive | Profile | Assíncrono? | Altura estável? | Scroll interno? | Header/footer? | Teste |
|---|---|---|---|---|---|---|---|---|
| Cadastros (qualquer recurso via RefSelect) | Novo {recurso} (formulário embutido) | Dialog xl | workspace | sim (layout do formulário) | sim (frame fixo) | sim (corpo) | header + ações do formulário | modelo-registro.spec (fluxo) |
| Pessoas e RH › Pessoas | Eventos fixos do funcionário | Dialog xl | workspace | não | sim | sim | header + footer | — |
| Relatórios › Personalizado | Salvar relatório | Dialog sm | compact | não | sim (conteúdo estático) | n/a | header + footer | — |
| Compras › Processo | Nova cotação | Dialog lg | large | não | sim (frame fixo) | sim | header + footer | suprimentos.spec |
| Compras › Processo | confirmações (autorizar/rejeitar) | ConfirmDialog | compact | não | sim | n/a | header + footer | suprimentos.spec |
| Frota › Equipamentos | Transferir máquina entre fazendas | Dialog xl | workspace | não | sim | sim | header + footer | — |
| Financeiro › OFX detalhe | Conciliar transação | Dialog lg | **content** (explícito: formulário curto) | não | sim | sim | header + footer | — |
| Listagens Base1 | Salvar filtro (filtros avançados) | Dialog sm | compact | não | sim | n/a | header + footer | — |
| Configurações › Usuários | Novo/Editar usuário | Dialog md | content | não | sim | sim | header + footer | — |
| Configurações › Auditoria | Detalhe do evento | Drawer lg | drawer (viewport) | sim (linha já carregada) | sim | sim (corpo) | header fixo | overlay-stability.spec · ui-primitives.spec |
| Pessoas e RH › Folha | Novo adiantamento | Dialog md | content | não | sim | sim | header + footer | — |
| Financeiro › Conciliação | Importar arquivo OFX | Dialog md | content | não | sim | sim | header + footer | — |
| Financeiro › Contas | Baixar título / ações do título (ActionDialogRaw) | Dialog lg | **content** (explícito) | não | sim | sim | header + footer | financeiro.spec |
| Financeiro › Contas | confirmações (cancelar, estornar) | ConfirmDialog | compact | não | sim | n/a | header + footer | financeiro.spec |
| Listagens Base1 | Anexos — {registro} | Dialog lg/xl (prévia) | large / workspace | sim (lista + prévia) | sim (frame fixo) | sim | header + footer | — |
| Listagens Base1 | Histórico — {registro} | Dialog lg | large | sim (auditoria) → LoadingState/EmptyState | sim (verificado: Δ ≤ 2 px) | sim | header fixo | overlay-stability.spec |
| Listagens DocList | Salvar filtro | Dialog sm | compact | não | sim | n/a | header + footer | — |
| Ações de documento (ActionDialog) | motivo/campos da ação | Dialog md | content | não | sim | sim | header + footer | financeiro.spec |
| Estoque › Saldo | Ajustar estoque | Dialog md | content | não | sim | sim | header + footer | navegacao.spec |
| Estoque › Implantação | Novo estoque inicial | Dialog md | content | não | sim | sim | header + footer | — |
| Estoque › DFe | Registrar DFe recebida | Dialog md | content | não | sim | sim | header + footer | — |
| Estoque › DFe | Manifestar documento | Dialog sm | compact | não | sim | n/a | header + footer | — |
| Estoque › Fábrica | Nova/Editar formulação (itens) | Dialog lg | large | não | sim (frame fixo) | sim | header + footer | — |
| Pecuária › Animais | Localizar animal | Dialog xl | workspace | sim (busca) | sim (frame fixo) | sim | header | overlay-stability.spec (1024×768) · compactacao.spec |
| Pecuária › Animais | Processamento de animais comprados | Dialog xl | workspace | sim | sim | sim | header + footer | — |
| Pecuária › Processamentos | Processar compra | Dialog xl | workspace | sim | sim | sim | header + footer | — |
| Pecuária › Rebanho › Transferências | ações de rebanho | Dialog xl | workspace | sim | sim | sim | header + footer | compactacao.spec |
| Pecuária › Reprodução | Nova cobertura | Dialog xl | workspace | sim | sim | sim | header + footer | — |
| Todas as telas de detalhe | Cancelar/Excluir/Estornar | ConfirmDialog (20 usos) | compact | loading após confirmar (frame não muda) | sim (verificado < 320 px) | n/a | header + footer | overlay-stability.spec · ui-primitives.spec |
| Shell | Fechar aba / trocar fazenda / sair com alterações | ConfirmDialog | compact | não | sim | n/a | header + footer | workspace-tabs.spec |
| Listagens Base1 | Configuração de colunas | Radix direto (`columns-dialog.tsx`, dívida no baseline do ui-audit) | próprio (max-h 90 vh) | não | sim | sim | header + rodapé | personalizacao.spec |
| Controles | MgSelect / MgDatePicker / B1Popover | popovers (não modais) | — | — | — | — | — | fora do escopo de overlay modal |

Validação em 1920×1080, 1440×900, 1366×768 e 1024×768: dialogs não ultrapassam a viewport (`--mg-dialog-max-h` =
100 dvh − 48 px; workspace = 100 dvh − 32 px); rodapé sempre acessível (fixo).
