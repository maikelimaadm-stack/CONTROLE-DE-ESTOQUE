/**
 * REGISTRY ÚNICO DOS TIPOS DE NOTIFICAÇÃO (PRE-BASE2-02).
 *
 * A caixa de notificações é uma PORTA DINÂMICA, como os anexos e o ID Global: a autorização não vem da
 * caixa, vem da FONTE de cada linha. Por isso cada tipo declara aqui, num lugar só, a capacidade que
 * exige e como o escopo dele é decidido — em vez de a verdade ficar espalhada por `switch` de geração,
 * de leitura e de contagem, que envelhecem em ritmos diferentes.
 *
 * Os três tipos de escopo:
 *
 *  - `organizacao`   a informação não depende de empresa nenhuma (aniversário de colaborador). Sem módulo,
 *                    sem empresa; ainda pode exigir capacidade.
 *  - `empresa`       a informação é de UMA empresa concreta (a solicitação de compra nasceu nela). Exige
 *                    capacidade E acesso àquela empresa NAQUELE módulo.
 *  - `modulo_todas`  a informação é um agregado REAL da organização inteira dentro de um módulo e não se
 *                    decompõe por empresa sem mudar de significado. Só enxerga quem enxerga TODAS as
 *                    empresas daquele módulo — proprietário ou modo `todas`. Quem tem `selecionadas`
 *                    NÃO vê, mesmo que hoje a seleção dele cubra todas as empresas existentes: empresa
 *                    criada amanhã entraria no agregado sem entrar na autorização dele.
 */
export type EscopoNotificacao = "organizacao" | "empresa" | "modulo_todas";

export interface TipoNotificacao {
  /** valor gravado em `erp.notifications.kind` */
  kind: string;
  rotulo: string;
  /**
   * Capacidade exigida para VER a linha. OBRIGATÓRIA: "sem capacidade declarada" não pode significar
   * "qualquer membro vê" — ausência de valor como permissão é o mesmo defeito que o escopo faltando.
   */
  permissionKey: string;
  escopo: EscopoNotificacao;
  /** módulo de negócio; obrigatório em `empresa` e `modulo_todas`, proibido em `organizacao` */
  modulo: string | null;
  /**
   * Só para tipo `empresa`: o registro de origem pode legitimamente NÃO ter empresa, e então a linha é da
   * organização. É a ÚNICA autorização para `escopoOverride` rebaixar o escopo — sem esta declaração, um
   * aviso empresarial não vira aviso de organização nem por engano de chamada (o banco também recusa:
   * a combinação não está em erp.tipos_notificacao).
   */
  empresaOpcional?: boolean;
  /** de onde a linha nasce e de onde sai a empresa dela (documentação executável do contrato) */
  origem: string;
}

export const TIPOS_NOTIFICACAO: readonly TipoNotificacao[] = [
  {
    kind: "purchase_pending", rotulo: "Solicitação de compra pendente",
    permissionKey: "purchase_requests.view", escopo: "empresa", modulo: "compras",
    origem: "erp.purchase_requests — a empresa é a da própria solicitação (farm_id)."
  },
  {
    kind: "processing_pending", rotulo: "Processamento de animais pendente",
    permissionKey: "processings.view", escopo: "empresa", modulo: "pecuaria",
    origem: "erp.processings — a empresa é a do processamento (farm_id)."
  },
  {
    kind: "batch_transfer", rotulo: "Transferência de lote a processar",
    permissionKey: "batches.view", escopo: "empresa", modulo: "pecuaria",
    origem: "erp.animal_movements (transferência entre empresas) — a empresa é o DESTINO, que é quem precisa processar."
  },
  {
    kind: "document_expiring", rotulo: "Documento vencendo",
    // documento tem empresa ANULÁVEL: com empresa é `empresa`, sem empresa é `organizacao`. O escopo
    // declarado aqui é o do caso com empresa; o helper decide por registro e o gate confere os dois.
    permissionKey: "documents.view", escopo: "empresa", modulo: "documentos", empresaOpcional: true,
    origem: "erp.documents — empresa do documento; documento sem empresa vira notificação de organização."
  },
  {
    kind: "birthday", rotulo: "Aniversário de colaborador",
    permissionKey: "employees.view", escopo: "organizacao", modulo: null,
    origem: "erp.employee_profiles + erp.people — cadastro da organização, sem dimensão de empresa."
  },
  {
    kind: "stock_min", rotulo: "Estoque mínimo atingido",
    // `products.min_stock` é cadastro da ORGANIZAÇÃO e a consulta soma o saldo de todos os armazéns:
    // o número é um agregado organizacional do módulo Estoque. Inventar um mínimo por empresa para poder
    // recortar seria fabricar semântica que o cadastro não tem (ver docs/DECISIONS.md).
    permissionKey: "stocks.view", escopo: "modulo_todas", modulo: "estoque",
    origem: "erp.products.min_stock (organização) × soma de erp.stock_balances (todos os armazéns)."
  },
  {
    kind: "title_due", rotulo: "Títulos a pagar vencendo",
    // CONTAS A PAGAR por empresa. `financial_titles.farm_id` é obrigatório: a contagem se decompõe sem
    // mudar de significado, então não há agregado a proteger — e agregar assim mesmo tiraria o aviso de
    // quem tem `selecionadas`, sobre títulos que ele vê na própria tela. (A rota leva para Contas a Pagar
    // e a consulta filtra direction='payable'; antes contava receber e pagar sob permissão de pagar.)
    permissionKey: "payables.view", escopo: "empresa", modulo: "financeiro",
    origem: "erp.financial_titles com direction='payable' vencendo em até 3 dias, contados por empresa."
  }
];

const PORKIND = new Map(TIPOS_NOTIFICACAO.map((t) => [t.kind, t]));
export const tipoNotificacao = (kind: string): TipoNotificacao | undefined => PORKIND.get(kind);
export const KINDS_NOTIFICACAO: readonly string[] = TIPOS_NOTIFICACAO.map((t) => t.kind);
