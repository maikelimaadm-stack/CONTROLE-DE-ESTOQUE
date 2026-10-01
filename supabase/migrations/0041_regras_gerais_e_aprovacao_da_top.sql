-- =====================================================================
-- 0041 TOP-CONFIG-08 — REGRAS GERAIS E APROVAÇÃO DA TOP — decisão 277
--
-- 1) TRÊS tabelas de DECISÃO de aprovação, uma ao lado de cada documento: erp.aprovacoes_venda
--    (erp.sales_documents), erp.aprovacoes_compra (erp.documentos_compra) e erp.aprovacoes_estoque
--    (erp.documentos_estoque). Uma linha por DECISÃO ('aprovado' | 'reprovado'), SÓ INSERÇÃO: nenhuma decisão é
--    editada nem apagada (gatilho de imutabilidade, no molde da 0020, e sem UPDATE/DELETE/TRUNCATE para o erp_app).
--    Reprovar e depois aprovar é uma decisão NOVA; a história fica. A vigente é a ÚLTIMA (id desc):
--      · venda: a última decisão DA VERSÃO ATUAL do documento (sales_documents.version, 0039). A tabela é separada
--        justamente para que aprovar não mexa na versão; e qualquer UPDATE da venda soma 1 na versão (0039), então
--        alterar a venda depois de aprovada (ou de reprovada) a devolve a "pendente" sem ninguém lembrar disso;
--      · compra e estoque: a última decisão. Eles não têm edição; a fatia que criar edição deles terá de invalidar a
--        aprovação (está no contrato, TIPO-OPERACAO-CONTRACT §17).
--    O status 'approved' que já existe na venda (0005) não tem nada com isto: nada aqui o grava nem o lê como
--    aprovação (para o gatilho de inserção ele só é "aberto", como 'open').
-- 2) erp.top_exige_aprovacao(jsonb, numeric): a conta "este documento exige aprovação?", IMUTÁVEL e sem ler
--    tabela — verdadeira quando a configuração da versão congelada está no formato ≥ 4 e a política é 'sempre', ou
--    'por_valor' com o valor do documento nulo ou ≥ valorMinimo ("a partir de" inclui o igual). É a MESMA conta do
--    domínio (exigeAprovacao, packages/domain/src/tipo-operacao-regras-gerais.ts), e um teste prova a paridade numa
--    tabela de casos. Configuração nula/ausente, formato 1 a 3, política 'nenhuma' ou desconhecida → falso, nunca
--    erro. valorMinimo ilegível numa 'por_valor' → VERDADEIRO (fail-closed: o limite que não se lê não dispensa
--    ninguém; o domínio nem chega aqui, porque recusa a configuração ilegível). É a porta que a fila de
--    aprovações (API) usa em SQL: o erp_app executa.
-- 3) Gatilho de INSERÇÃO por tabela (BEFORE INSERT, SECURITY DEFINER, organização e usuário da GUC do servidor).
--    A organização é a de erp.current_org_id(), NUNCA o organization_id que veio no INSERT: o BEFORE INSERT definer
--    roda ANTES do with check da RLS, e ler pela organização da linha deixaria quem roda SQL como erp_app mandar a
--    organização e o documento de OUTRO tenant e descobrir, pela recusa que volta (NOT_FOUND × CONCURRENCY_CONFLICT
--    × CONFLICT × APROVACAO_NAO_EXIGIDA), a situação de um documento que a RLS esconde dele. Linha de organização
--    diferente da GUC — ou transação sem organização na GUC (superusuário, migração) — recebe a MESMA 'NOT_FOUND' de
--    inexistente, ANTES de ler qualquer documento. O mesmo vale para a EMPRESA: a da linha tem de estar no escopo
--    de escrita de quem decide, no módulo da transação — erp.empresa_escrita_permitida (0015), o MESMO predicado do
--    with check da política tenant_e_empresa (para empresa não nula, as duas formas dizem a mesma coisa), avaliado
--    com o usuário, a organização e o módulo da GUC de quem chama (a função lê as GUCs, não o dono). Sem isso, o
--    membro com escopo [A] que, como erp_app, pede um documento da empresa B da MESMA organização leria a situação
--    dele pela recusa (42501 do with check × APROVACAO_NAO_EXIGIDA × CONFLICT × NOT_FOUND): fora do escopo é a
--    MESMA 'NOT_FOUND', também antes de ler qualquer documento. Depois, lê o documento da organização da GUC com
--    FOR SHARE (a rota já o travou FOR UPDATE na mesma transação; um caminho que não travou espera a confirmação
--    concorrente terminar e lê a situação NOVA) e confere: existe, é da empresa da decisão, e está aberto.
--    Documento inexistente, de outra empresa, excluído ou de outra espécie responde a MESMA recusa 'NOT_FOUND'
--    (negar não revela existência). Na venda, versao_documento tem de ser a version atual. ATRIBUI do documento a
--    TOP, a versão congelada e o valor (venda: total; compra: valor_total) — não compara o que veio —, e
--    decidido_por := erp.current_user_id() (sem usuário, recusa), decidido_em := now(). Por fim, o documento tem de
--    EXIGIR aprovação pelo total ATUAL; senão, 'APROVACAO_NAO_EXIGIDA: …'.
--    A ordem das recusas é: usuário → organização → empresa no escopo → documento (404) → versão (409) → situação
--    (409) → exigência (409). As três primeiras vêm antes de ler qualquer documento: sem usuário na transação,
--    'PERMISSION_DENIED'; organização da linha fora da GUC, 'NOT_FOUND'; empresa da linha fora do escopo de escrita
--    do módulo, 'NOT_FOUND'. Dali em diante é a ordem da rota (TOP-CONFIG-08 §5).
--    Toda mensagem é de UMA linha com prefixo de código: é o que o fromPgError (apps/api/src/lib/errors.ts) traduz.
-- 4) Guardas de TRANSIÇÃO (BEFORE UPDATE da situação; SECURITY DEFINER; filtro explícito de organização), só na
--    ENTRADA no estado confirmado:
--      · trg_sales_documents_aprovacao: o MESMO WHEN da 0023 (NEW.status em confirmed/invoiced vindo de qualquer
--        outro, com versão congelada). Procura a decisão da versão OLD.version — NUNCA NEW.version: a guarda roda
--        ANTES da 0039 (o nome ordena antes de trg_sales_documents_versao), e um UPDATE pode gravar qualquer valor em
--        version junto com o status. O NEW pode mentir; o OLD não;
--      · trg_documentos_compra_aprovacao: aberto → confirmado;
--      · trg_documentos_estoque_aprovacao: aberto → confirmado.
--    Quando o documento exige aprovação e a vigente não é 'aprovado', levanta 'CONFLICT: …' (P0001), com mensagem
--    FIXA de uma linha — nada de motivo livre nela. CONFLICT é conhecido por todo binário: o anterior (reversão,
--    instância antiga no pool) responde 409, nunca 500. Na API nova quem explica é o passo da aprovação no
--    planejamento da confirmação (APROVACAO_PENDENTE / APROVACAO_REPROVADA, com details); a guarda é o fundo.
--    FAIL-CLOSED na conta: a guarda considera a versão congelada de ANTES e a de DEPOIS do UPDATE (na compra e no
--    estoque elas são imutáveis; na venda o PUT pode trocar a TOP de um documento aberto) e o MAIOR valor entre o de
--    antes e o de depois. Um UPDATE que confirmasse e, no mesmo comando, baixasse o total ou trocasse a TOP não
--    escaparia da exigência. Formato 1 a 3 nunca é barrado (a conta dá falso).
--    As guardas NÃO conferem a organização da GUC, de propósito: elas leem pela OLD.organization_id da própria linha
--    que o UPDATE já alcançou (para o erp_app, só alcança o que a RLS deixa), então não abrem nada de outro tenant; e
--    um UPDATE sem GUC (superusuário, migração) continua GUARDADO pela decisão da linha, em vez de recusado por falta
--    de contexto.
-- 5) Ordem dos BEFORE UPDATE da venda (por NOME, collation "C"; cada um vê o NEW dos anteriores): passam a ser
--    exatamente QUATRO — trg_sales_documents_aprovacao, trg_sales_documents_classificacao_financeira,
--    trg_sales_documents_execucao_configurada, trg_sales_documents_versao. A guarda da aprovação dispara PRIMEIRO
--    (ela não muda o NEW: só lê ou recusa) e a 0039 continua a ÚLTIMA. A pré-condição exige as três de hoje, por
--    nome e por função; a pós-condição, as quatro, nessa ordem.
-- 6) RLS: as três tabelas são categoria A da 0015 (empresa obrigatória), com a política tenant_e_empresa da 0040
--    (o MESMO gabarito inline); módulos vendas, compras e estoque em scripts/company-rls-modules.json. FK de
--    empresa COMPOSTA (organization_id, empresa_id) → erp.empresas (organization_id, id), nessa ordem de colunas.
--    erp.audit_row nas três (o id bigint funciona: a auditoria lê o id como texto). Privilégios do erp_app: SÓ
--    select e insert.
-- 7) Funções de gatilho: search_path = erp, pg_temp (pg_temp por último) e EXECUTE só do dono — a 0007 dá EXECUTE
--    de toda função nova ao erp_app, e o laço da 0040 o tira. A conta (erp.top_exige_aprovacao) é a exceção
--    declarada: PUBLIC não executa, o erp_app executa.
-- 8) Pré-condições nomeadas "TOP-CONFIG-08: …" ("já aplicada" primeiro) e pós-condições só de OBJETOS — nunca
--    contagem de tabela viva.
--
-- SEM BACKFILL: tabelas novas, vazias; nenhuma linha existente muda. As guardas só barram versão no formato 4, e
-- nenhuma existe antes desta fatia (o domínio anterior recusa o 4 na gravação): o acervo inteiro continua
-- confirmando exatamente como hoje. As TOPs de produção ficam no formato delas e nada passa a executar.
-- JANELA DE DEPLOY (pre-deploy, como a 0040; ordem banco → API → web): a API anterior não conhece as tabelas e
-- não as lê; as guardas não mudam nada para ela enquanto nenhuma versão estiver no formato 4. Depois que a API
-- nova gravar uma TOP no formato 4, uma instância anterior que tente confirmar um documento dela recebe 409: na
-- venda e na compra pela própria API ("configuração ilegível"), e no estoque pela guarda deste arquivo (CONFLICT).
-- Os gatilhos novos em sales_documents, documentos_compra e documentos_estoque e as FKs novas pedem locks curtos
-- nessas tabelas e nas referenciadas; o lock_timeout de 2s faz a migration desistir em vez de enfileirar as
-- gravações atrás dela.
-- VOLTA: API e web voltam por redeploy e convivem com a 0041. As tabelas de aprovação NUNCA se apagam (são dado
-- real, decisão 247). Desligar as guardas ou a conta só com uma migration nova, por decisão humana.
-- O runner (`packages/db/src/migrate.ts`) executa este arquivo inteiro dentro de UMA transação e registra o nome
-- no ledger. Por isso não há `begin`/`commit` explícito aqui.
-- =====================================================================

-- ---------- 1) trava de concorrência ----------
-- Chave própria desta fatia (a 0040 usou 74).
do $$
begin
  if not pg_try_advisory_xact_lock(2026, 75) then
    raise exception 'TOP-CONFIG-08: outra transacao ja detem a trava desta migration (2026,75). Nada foi aplicado.';
  end if;
end $$;

set local lock_timeout = '2s';

-- ---------- 2) pré-condições nomeadas ----------
do $$
declare
  v_antes text[];
begin
  -- "Já aplicada" ANTES das demais: na reaplicação, o motivo verdadeiro é este, não uma dependência.
  if to_regclass('erp.aprovacoes_venda') is not null or to_regclass('erp.aprovacoes_compra') is not null
     or to_regclass('erp.aprovacoes_estoque') is not null then
    raise exception 'TOP-CONFIG-08: erp.aprovacoes_venda/erp.aprovacoes_compra/erp.aprovacoes_estoque ja existe; a 0041 ja foi aplicada ou ha schema divergente.';
  end if;
  if to_regprocedure('erp.top_exige_aprovacao(jsonb,numeric)') is not null
     or to_regprocedure('erp.aprovacoes_venda_conferir()') is not null or to_regprocedure('erp.aprovacoes_compra_conferir()') is not null
     or to_regprocedure('erp.aprovacoes_estoque_conferir()') is not null or to_regprocedure('erp.aprovacoes_imutavel()') is not null
     or to_regprocedure('erp.venda_aprovacao_guarda()') is not null or to_regprocedure('erp.documentos_compra_aprovacao_guarda()') is not null
     or to_regprocedure('erp.documentos_estoque_aprovacao_guarda()') is not null then
    raise exception 'TOP-CONFIG-08: funcoes da aprovacao ja existem; a 0041 ja foi aplicada ou ha schema divergente.';
  end if;
  if exists (select 1 from pg_trigger t
              where not t.tgisinternal
                and t.tgname in ('trg_sales_documents_aprovacao', 'trg_documentos_compra_aprovacao', 'trg_documentos_estoque_aprovacao')) then
    raise exception 'TOP-CONFIG-08: guarda de transicao da aprovacao ja existe; a 0041 ja foi aplicada ou ha schema divergente.';
  end if;
  -- O papel da aplicação é o destinatário dos privilégios e da conta.
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    raise exception 'TOP-CONFIG-08: papel erp_app ausente (0007); os privilegios das tabelas novas nao teriam destinatario.';
  end if;
  -- Antes de ler qualquer tabela: um papel sem bypass de RLS pararia adiante num erro de permissão genérico, e as
  -- funções SECURITY DEFINER (cujo dono é quem aplica) veriam só o recorte de quem chama.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'TOP-CONFIG-08: o papel que aplica a migration (dono das funcoes SECURITY DEFINER) nao atravessa RLS; os gatilhos nao veriam o documento nem a decisao.';
  end if;
  -- As colunas que os gatilhos leem (o codigo_base mora em tipos_operacao; a conta só lê a configuração da versão).
  if (select count(*) from information_schema.columns
       where table_schema = 'erp'
         and ((table_name = 'sales_documents' and column_name in ('version', 'total', 'status', 'kind', 'empresa_id', 'deleted_at',
                                                                  'tipo_operacao_id', 'tipo_operacao_versao_id'))
           or (table_name = 'documentos_compra' and column_name in ('valor_total', 'situacao', 'especie', 'empresa_id',
                                                                    'tipo_operacao_id', 'tipo_operacao_versao_id'))
           or (table_name = 'documentos_estoque' and column_name in ('situacao', 'empresa_id', 'tipo_operacao_id', 'tipo_operacao_versao_id'))
           or (table_name = 'tipos_operacao_versoes' and column_name = 'configuracao'))) <> 19 then
    raise exception 'TOP-CONFIG-08: coluna lida pelos gatilhos ausente (sales_documents.version/total/status/kind/empresa_id/deleted_at/tipo_operacao_id/tipo_operacao_versao_id, documentos_compra.valor_total/situacao/especie/empresa_id/tipo_operacao_id/tipo_operacao_versao_id, documentos_estoque.situacao/empresa_id/tipo_operacao_id/tipo_operacao_versao_id, tipos_operacao_versoes.configuracao); a cadeia de migrations esta fora de ordem.';
  end if;
  -- As chaves que as FKs compostas referenciam.
  if not exists (select 1 from pg_constraint where conrelid = 'erp.tipos_operacao_versoes'::regclass and conname = 'uq_tipos_operacao_versoes_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.tipos_operacao'::regclass and conname = 'uq_tipos_operacao_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_compra'::regclass and conname = 'uq_documentos_compra_tenant' and contype = 'u')
     or not exists (select 1 from pg_constraint where conrelid = 'erp.documentos_estoque'::regclass and conname = 'uq_documentos_estoque_tenant' and contype = 'u') then
    raise exception 'TOP-CONFIG-08: chave alvo das FKs compostas ausente (uq_tipos_operacao_versoes_tenant da 0021, uq_tipos_operacao_tenant da 0020, uq_documentos_compra_tenant da 0036, uq_documentos_estoque_tenant da 0040).';
  end if;
  -- A FK de empresa é composta (organização, empresa): coluna única não prova tenant.
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'erp.empresas'::regclass and c.contype in ('u', 'p')
                    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                          where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'organization_id']) then
    raise exception 'TOP-CONFIG-08: chave (organization_id, id) de erp.empresas ausente; a FK composta da empresa nao teria alvo.';
  end if;
  -- As que os gatilhos de inserção chamam (organização e usuário da GUC; a empresa pelo predicado de escrita) entram
  -- aqui também: o plpgsql só resolve a chamada na execução, e a ausência viraria erro genérico na primeira decisão.
  if to_regprocedure('erp.audit_row()') is null or to_regprocedure('erp.tenant_visible(uuid)') is null
     or to_regprocedure('erp.escopo_empresa_total(text)') is null or to_regprocedure('erp.empresas_do_membro(text)') is null
     or to_regprocedure('erp.modulo_empresa_atual()') is null or to_regprocedure('erp.current_user_id()') is null
     or to_regprocedure('erp.current_org_id()') is null or to_regprocedure('erp.empresa_escrita_permitida(uuid)') is null then
    raise exception 'TOP-CONFIG-08: funcoes de auditoria/RLS/usuario (0001/0007/0015) ausentes.';
  end if;
  if (select count(*) from erp.modulos_escopo_empresa where chave in ('vendas', 'compras', 'estoque')) <> 3 then
    raise exception 'TOP-CONFIG-08: modulos de escopo empresarial vendas/compras/estoque ausentes (0011).';
  end if;
  -- O conjunto EXATO dos BEFORE UPDATE por linha da venda, por nome E por função: é sobre ele que o cabeçalho afirma
  -- "a guarda da aprovação dispara primeiro e a versão continua a última". Um gatilho a mais, a menos, ou o mesmo
  -- nome apontando para outra função invalida a afirmação, e a decisão volta para um humano.
  -- tgtype: 1 = ROW, 2 = BEFORE, 16 = UPDATE (valores das flags, não posições de bit).
  select array_agg(t.tgname || ' -> ' || n.nspname || '.' || p.proname order by t.tgname collate "C") into v_antes
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where t.tgrelid = 'erp.sales_documents'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_antes is distinct from array[
       'trg_sales_documents_classificacao_financeira -> erp.venda_classificacao_financeira_guarda',
       'trg_sales_documents_execucao_configurada -> erp.venda_execucao_configurada_guarda',
       'trg_sales_documents_versao -> erp.sales_documents_versao'] then
    raise exception 'TOP-CONFIG-08: gatilhos BEFORE UPDATE por linha de erp.sales_documents diferentes dos tres esperados (classificacao_financeira da 0024, execucao_configurada da 0023, versao da 0039): %', v_antes;
  end if;
end $$;

-- ---------- 3) as três tabelas ----------
create table erp.aprovacoes_venda (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  documento_id uuid not null,
  tipo_operacao_id uuid not null,
  tipo_operacao_versao_id uuid not null,
  versao_documento bigint not null,
  valor_documento numeric(18,2) not null,
  decisao text not null constraint chk_aprovacoes_venda_decisao check (decisao in ('aprovado','reprovado')),
  observacao text constraint chk_aprovacoes_venda_observacao check (observacao is null or length(observacao) <= 500),
  decidido_por uuid not null references erp.users(id),
  decidido_em timestamptz not null default now(),
  constraint chk_aprovacoes_venda_reprovacao check (decisao = 'aprovado' or (observacao is not null and btrim(observacao) <> '')),
  -- A venda não tem chave (id, organization_id), e esta fatia não cria uma: o gatilho de inserção confere a organização.
  constraint fk_aprovacoes_venda_documento foreign key (documento_id) references erp.sales_documents (id),
  constraint fk_aprovacoes_venda_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_aprovacoes_venda_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id),
  constraint fk_aprovacoes_venda_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id)
);
create index ix_aprovacoes_venda_documento on erp.aprovacoes_venda (organization_id, documento_id, id desc);

create table erp.aprovacoes_compra (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  documento_id uuid not null,
  tipo_operacao_id uuid not null,
  tipo_operacao_versao_id uuid not null,
  valor_documento numeric(18,2) not null,
  decisao text not null constraint chk_aprovacoes_compra_decisao check (decisao in ('aprovado','reprovado')),
  observacao text constraint chk_aprovacoes_compra_observacao check (observacao is null or length(observacao) <= 500),
  decidido_por uuid not null references erp.users(id),
  decidido_em timestamptz not null default now(),
  constraint chk_aprovacoes_compra_reprovacao check (decisao = 'aprovado' or (observacao is not null and btrim(observacao) <> '')),
  constraint fk_aprovacoes_compra_documento foreign key (documento_id, organization_id) references erp.documentos_compra (id, organization_id),
  constraint fk_aprovacoes_compra_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_aprovacoes_compra_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id),
  constraint fk_aprovacoes_compra_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id)
);
create index ix_aprovacoes_compra_documento on erp.aprovacoes_compra (organization_id, documento_id, id desc);

create table erp.aprovacoes_estoque (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id),
  empresa_id uuid not null,
  documento_id uuid not null,
  tipo_operacao_id uuid not null,
  tipo_operacao_versao_id uuid not null,
  decisao text not null constraint chk_aprovacoes_estoque_decisao check (decisao in ('aprovado','reprovado')),
  observacao text constraint chk_aprovacoes_estoque_observacao check (observacao is null or length(observacao) <= 500),
  decidido_por uuid not null references erp.users(id),
  decidido_em timestamptz not null default now(),
  constraint chk_aprovacoes_estoque_reprovacao check (decisao = 'aprovado' or (observacao is not null and btrim(observacao) <> '')),
  constraint fk_aprovacoes_estoque_documento foreign key (documento_id, organization_id) references erp.documentos_estoque (id, organization_id),
  constraint fk_aprovacoes_estoque_empresa foreign key (organization_id, empresa_id) references erp.empresas (organization_id, id),
  constraint fk_aprovacoes_estoque_tipo_operacao foreign key (tipo_operacao_id, organization_id) references erp.tipos_operacao (id, organization_id),
  constraint fk_aprovacoes_estoque_tipo_operacao_versao foreign key (tipo_operacao_versao_id, tipo_operacao_id, organization_id) references erp.tipos_operacao_versoes (id, tipo_operacao_id, organization_id)
);
create index ix_aprovacoes_estoque_documento on erp.aprovacoes_estoque (organization_id, documento_id, id desc);

comment on table erp.aprovacoes_venda is 'Decisões de aprovação da venda (TOP-CONFIG-08, decisão 277): uma linha por decisão, só inserção. A vigente é a última (id desc) da versão ATUAL do documento (sales_documents.version); alterar a venda sobe a versão e a devolve a pendente.';
comment on column erp.aprovacoes_venda.id is 'Identidade técnica da decisão (sequencial); a maior é a mais recente.';
comment on column erp.aprovacoes_venda.organization_id is 'Tenant (organização); a do documento (conferida pelo gatilho de inserção).';
comment on column erp.aprovacoes_venda.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo vendas.';
comment on column erp.aprovacoes_venda.documento_id is 'Documento de venda (kind sale) decidido.';
comment on column erp.aprovacoes_venda.tipo_operacao_id is 'TOP do documento na decisão (atribuída pelo gatilho, do documento).';
comment on column erp.aprovacoes_venda.tipo_operacao_versao_id is 'Versão congelada da TOP do documento na decisão (FK de três colunas; atribuída pelo gatilho).';
comment on column erp.aprovacoes_venda.versao_documento is 'Versão do documento (sales_documents.version) que a decisão aprova ou reprova; tem de ser a atual na inserção.';
comment on column erp.aprovacoes_venda.valor_documento is 'Total do documento no momento da decisão (atribuído pelo gatilho, do documento).';
comment on column erp.aprovacoes_venda.decisao is 'aprovado ou reprovado.';
comment on column erp.aprovacoes_venda.observacao is 'Observação da aprovação (opcional) ou motivo da reprovação (obrigatório, não vazio); até 500 caracteres.';
comment on column erp.aprovacoes_venda.decidido_por is 'Usuário que decidiu (atribuído pelo gatilho: o usuário da transação).';
comment on column erp.aprovacoes_venda.decidido_em is 'Momento da decisão (atribuído pelo gatilho).';

comment on table erp.aprovacoes_compra is 'Decisões de aprovação da compra (TOP-CONFIG-08, decisão 277): uma linha por decisão, só inserção. A vigente é a última (id desc), enquanto a compra estiver aberta.';
comment on column erp.aprovacoes_compra.id is 'Identidade técnica da decisão (sequencial); a maior é a mais recente.';
comment on column erp.aprovacoes_compra.organization_id is 'Tenant (organização); a do documento (FK composta).';
comment on column erp.aprovacoes_compra.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo compras.';
comment on column erp.aprovacoes_compra.documento_id is 'Documento de compra (espécie compra) decidido (FK composta com a organização).';
comment on column erp.aprovacoes_compra.tipo_operacao_id is 'TOP do documento na decisão (atribuída pelo gatilho, do documento).';
comment on column erp.aprovacoes_compra.tipo_operacao_versao_id is 'Versão congelada da TOP do documento na decisão (FK de três colunas; atribuída pelo gatilho).';
comment on column erp.aprovacoes_compra.valor_documento is 'Valor total do documento no momento da decisão (atribuído pelo gatilho, do documento).';
comment on column erp.aprovacoes_compra.decisao is 'aprovado ou reprovado.';
comment on column erp.aprovacoes_compra.observacao is 'Observação da aprovação (opcional) ou motivo da reprovação (obrigatório, não vazio); até 500 caracteres.';
comment on column erp.aprovacoes_compra.decidido_por is 'Usuário que decidiu (atribuído pelo gatilho: o usuário da transação).';
comment on column erp.aprovacoes_compra.decidido_em is 'Momento da decisão (atribuído pelo gatilho).';

comment on table erp.aprovacoes_estoque is 'Decisões de aprovação do documento de estoque (TOP-CONFIG-08, decisão 277): uma linha por decisão, só inserção. A vigente é a última (id desc), enquanto o documento estiver aberto.';
comment on column erp.aprovacoes_estoque.id is 'Identidade técnica da decisão (sequencial); a maior é a mais recente.';
comment on column erp.aprovacoes_estoque.organization_id is 'Tenant (organização); a do documento (FK composta).';
comment on column erp.aprovacoes_estoque.empresa_id is 'Empresa do documento (FK composta com a organização). Escopo de empresa do módulo estoque.';
comment on column erp.aprovacoes_estoque.documento_id is 'Documento de estoque decidido (FK composta com a organização).';
comment on column erp.aprovacoes_estoque.tipo_operacao_id is 'TOP do documento na decisão (atribuída pelo gatilho, do documento).';
comment on column erp.aprovacoes_estoque.tipo_operacao_versao_id is 'Versão congelada da TOP do documento na decisão (FK de três colunas; atribuída pelo gatilho).';
comment on column erp.aprovacoes_estoque.decisao is 'aprovado ou reprovado.';
comment on column erp.aprovacoes_estoque.observacao is 'Observação da aprovação (opcional) ou motivo da reprovação (obrigatório, não vazio); até 500 caracteres.';
comment on column erp.aprovacoes_estoque.decidido_por is 'Usuário que decidiu (atribuído pelo gatilho: o usuário da transação).';
comment on column erp.aprovacoes_estoque.decidido_em is 'Momento da decisão (atribuído pelo gatilho).';

-- ---------- 4) a conta: erp.top_exige_aprovacao ----------
-- plpgsql, e não SQL: cada passo é um IF, então nenhum cast roda antes de o tipo do valor ser conferido — nem na
-- execução, nem no dobramento de constantes do planejador (uma função SQL seria embutida na consulta, e um cast de
-- constante malformada falharia no plano). Imutável: só lê os argumentos.
create function erp.top_exige_aprovacao(p_configuracao jsonb, p_valor numeric) returns boolean
language plpgsql immutable set search_path = erp, pg_temp as $$
declare
  v_aprovacao jsonb;
  v_minimo text;
begin
  -- Nula, não objeto, ou sem versaoSchema numérico: nada a exigir (e nunca erro).
  if p_configuracao is null or jsonb_typeof(p_configuracao) <> 'object'
     or jsonb_typeof(p_configuracao -> 'versaoSchema') is distinct from 'number' then
    return false;
  end if;
  -- Formato 1 a 3: a versão foi gravada quando nada executava, e nunca passa a executar sozinha (o corte).
  if (p_configuracao -> 'versaoSchema')::numeric < 4 then
    return false;
  end if;
  v_aprovacao := p_configuracao -> 'aprovacao';
  if jsonb_typeof(v_aprovacao) is distinct from 'object' then
    return false;
  end if;
  if v_aprovacao ->> 'politica' = 'sempre' then
    return true;
  end if;
  if (v_aprovacao ->> 'politica') is distinct from 'por_valor' then
    return false;
  end if;
  -- A partir de um valor: sem valor do documento, exige (o mesmo que o domínio).
  if p_valor is null then
    return true;
  end if;
  if jsonb_typeof(v_aprovacao -> 'valorMinimo') in ('string', 'number') then
    v_minimo := v_aprovacao ->> 'valorMinimo';
  end if;
  -- Limite ilegível: exige (fail-closed). O formato é conferido antes do cast, e é limitado, para o cast nunca falhar.
  if v_minimo is null or v_minimo !~ '^[0-9]{1,18}(\.[0-9]{1,6})?$' then
    return true;
  end if;
  -- "A partir de" inclui o igual.
  return p_valor >= v_minimo::numeric;
end $$;
comment on function erp.top_exige_aprovacao(jsonb, numeric) is
  'TOP-CONFIG-08 (decisão 277): a configuração da versão congelada exige aprovação para este valor? Verdadeira quando versaoSchema >= 4 e a política é sempre, ou por_valor com valor nulo ou >= valorMinimo (limite ilegível exige). Nula, formato 1 a 3, nenhuma ou desconhecida: falsa. Imutável, não lê tabela; a mesma conta de exigeAprovacao do domínio.';

-- ---------- 5) gatilhos das tabelas de aprovação ----------
-- 5.1 Inserção conferida, uma por tabela. SECURITY DEFINER estreita: organização e usuário da GUC do servidor
-- (erp.current_org_id() e erp.current_user_id()), nunca da linha; lê o documento e a versão SÓ dessa organização,
-- devolve só a recusa ou os valores atribuídos, sem SQL dinâmico. O organization_id e o empresa_id que vieram no
-- INSERT são PEDIDOS: organização diferente da GUC (ou sem GUC), ou empresa fora do escopo de escrita de quem
-- decide no módulo da transação (erp.empresa_escrita_permitida: o predicado do with check da política), recebem a
-- NOT_FOUND de inexistente, antes de qualquer leitura — este gatilho roda ANTES do with check da RLS, e é por isso
-- que ele não pode confiar na linha (ver o cabeçalho, item 3). A conferência da empresa roda DENTRO da definer, mas
-- continua sendo a de quem chama: erp.empresa_escrita_permitida (sql, invoker) lê o usuário, a organização e o
-- módulo das GUCs da transação (app.user_id, app.org_id, app.modulo_empresa), que o SECURITY DEFINER não troca; e
-- as tabelas de escopo que ela lê são filtradas EXPLICITAMENTE por essa organização e esse usuário, então a RLS
-- delas (que o dono atravessa) não tiraria nada do que ela vê pelo papel da aplicação.
create function erp.aprovacoes_venda_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_usuario uuid := erp.current_user_id();
  v_org uuid := erp.current_org_id();
  v_doc record;
  v_configuracao jsonb;
begin
  -- Sem usuário na transação não há quem decida (e nada do documento é lido antes disso).
  if v_usuario is null then
    raise exception 'PERMISSION_DENIED: A decisão de aprovação precisa de um usuário identificado.' using errcode = 'P0001';
  end if;
  -- A organização da linha tem de ser a da GUC do servidor: senão (outro tenant, ou transação sem organização), a
  -- MESMA recusa de inexistente, sem ler nada — a resposta não pode variar com a situação de um documento alheio.
  if v_org is null or new.organization_id is distinct from v_org then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  -- A empresa da linha tem de estar no escopo de ESCRITA de quem decide, no módulo da transação — o MESMO predicado
  -- do with check da política, só que ANTES de ler o documento: fora do escopo (mesmo na própria organização), a
  -- MESMA recusa de inexistente, sem ler nada. Sem isto, o membro com escopo [A] pedindo um documento da empresa B
  -- leria a situação dele pela recusa.
  if not erp.empresa_escrita_permitida(new.empresa_id) then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  select d.empresa_id, d.kind, d.status, d.deleted_at, d.total, d.version, d.tipo_operacao_id, d.tipo_operacao_versao_id
    into v_doc
    from erp.sales_documents d
   where d.id = new.documento_id and d.organization_id = v_org
     for share;
  -- Inexistente na organização, outra empresa, excluído ou outra espécie: a MESMA recusa.
  if not found or v_doc.empresa_id is distinct from new.empresa_id or v_doc.deleted_at is not null or v_doc.kind <> 'sale' then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  if new.versao_documento is distinct from v_doc.version then
    raise exception 'CONCURRENCY_CONFLICT: Este documento mudou desde que você o abriu. Recarregue antes de salvar.' using errcode = 'P0001';
  end if;
  if v_doc.status not in ('open', 'approved') then
    raise exception 'CONFLICT: Só documento aberto passa por aprovação.' using errcode = 'P0001';
  end if;
  -- Do documento, sem comparar o que veio.
  new.tipo_operacao_id := v_doc.tipo_operacao_id;
  new.tipo_operacao_versao_id := v_doc.tipo_operacao_versao_id;
  new.valor_documento := v_doc.total;
  new.decidido_por := v_usuario;
  new.decidido_em := now();
  select v.configuracao into v_configuracao
    from erp.tipos_operacao_versoes v
   where v.id = v_doc.tipo_operacao_versao_id and v.organization_id = v_org;
  if not erp.top_exige_aprovacao(v_configuracao, v_doc.total) then
    raise exception 'APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.aprovacoes_venda_conferir() is
  'TOP-CONFIG-08: decisão de venda só com usuário e organização da GUC do servidor (linha de outra organização, ou sem GUC: NOT_FOUND antes de qualquer leitura) e com a empresa da linha no escopo de escrita de quem decide no módulo da transação (erp.empresa_escrita_permitida, o predicado do with check; fora dele: NOT_FOUND antes de qualquer leitura), para venda (kind sale) dessa organização e da empresa da linha, viva, na versão atual e aberta (open/approved), que exige aprovação pelo total atual; atribui TOP, versão congelada, valor, decidido_por e decidido_em do documento e da transação.';
create trigger trg_aprovacoes_venda_conferir
  before insert on erp.aprovacoes_venda
  for each row execute function erp.aprovacoes_venda_conferir();

create function erp.aprovacoes_compra_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_usuario uuid := erp.current_user_id();
  v_org uuid := erp.current_org_id();
  v_doc record;
  v_configuracao jsonb;
begin
  if v_usuario is null then
    raise exception 'PERMISSION_DENIED: A decisão de aprovação precisa de um usuário identificado.' using errcode = 'P0001';
  end if;
  -- A organização da GUC, nunca a da linha (o mesmo da venda): outra, ou nenhuma, é a NOT_FOUND sem ler nada.
  if v_org is null or new.organization_id is distinct from v_org then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  -- A empresa da linha no escopo de escrita de quem decide, no módulo da transação (o mesmo da venda): fora dele, a
  -- NOT_FOUND sem ler nada.
  if not erp.empresa_escrita_permitida(new.empresa_id) then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  select d.empresa_id, d.especie, d.situacao, d.valor_total, d.tipo_operacao_id, d.tipo_operacao_versao_id
    into v_doc
    from erp.documentos_compra d
   where d.id = new.documento_id and d.organization_id = v_org
     for share;
  -- Inexistente na organização, outra empresa ou pedido de compra: a MESMA recusa.
  if not found or v_doc.empresa_id is distinct from new.empresa_id or v_doc.especie <> 'compra' then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  if v_doc.situacao <> 'aberto' then
    raise exception 'CONFLICT: Só documento aberto passa por aprovação.' using errcode = 'P0001';
  end if;
  new.tipo_operacao_id := v_doc.tipo_operacao_id;
  new.tipo_operacao_versao_id := v_doc.tipo_operacao_versao_id;
  new.valor_documento := v_doc.valor_total;
  new.decidido_por := v_usuario;
  new.decidido_em := now();
  select v.configuracao into v_configuracao
    from erp.tipos_operacao_versoes v
   where v.id = v_doc.tipo_operacao_versao_id and v.organization_id = v_org;
  if not erp.top_exige_aprovacao(v_configuracao, v_doc.valor_total) then
    raise exception 'APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.aprovacoes_compra_conferir() is
  'TOP-CONFIG-08: decisão de compra só com usuário e organização da GUC do servidor (linha de outra organização, ou sem GUC: NOT_FOUND antes de qualquer leitura) e com a empresa da linha no escopo de escrita de quem decide no módulo da transação (erp.empresa_escrita_permitida, o predicado do with check; fora dele: NOT_FOUND antes de qualquer leitura), para documento de compra (espécie compra) dessa organização e da empresa da linha, aberto, que exige aprovação pelo valor total atual; atribui TOP, versão congelada, valor, decidido_por e decidido_em do documento e da transação.';
create trigger trg_aprovacoes_compra_conferir
  before insert on erp.aprovacoes_compra
  for each row execute function erp.aprovacoes_compra_conferir();

create function erp.aprovacoes_estoque_conferir() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_usuario uuid := erp.current_user_id();
  v_org uuid := erp.current_org_id();
  v_doc record;
  v_configuracao jsonb;
begin
  if v_usuario is null then
    raise exception 'PERMISSION_DENIED: A decisão de aprovação precisa de um usuário identificado.' using errcode = 'P0001';
  end if;
  -- A organização da GUC, nunca a da linha (o mesmo da venda): outra, ou nenhuma, é a NOT_FOUND sem ler nada.
  if v_org is null or new.organization_id is distinct from v_org then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  -- A empresa da linha no escopo de escrita de quem decide, no módulo da transação (o mesmo da venda): fora dele, a
  -- NOT_FOUND sem ler nada.
  if not erp.empresa_escrita_permitida(new.empresa_id) then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  select d.empresa_id, d.situacao, d.tipo_operacao_id, d.tipo_operacao_versao_id
    into v_doc
    from erp.documentos_estoque d
   where d.id = new.documento_id and d.organization_id = v_org
     for share;
  if not found or v_doc.empresa_id is distinct from new.empresa_id then
    raise exception 'NOT_FOUND: Documento não encontrado' using errcode = 'P0001';
  end if;
  if v_doc.situacao <> 'aberto' then
    raise exception 'CONFLICT: Só documento aberto passa por aprovação.' using errcode = 'P0001';
  end if;
  new.tipo_operacao_id := v_doc.tipo_operacao_id;
  new.tipo_operacao_versao_id := v_doc.tipo_operacao_versao_id;
  new.decidido_por := v_usuario;
  new.decidido_em := now();
  select v.configuracao into v_configuracao
    from erp.tipos_operacao_versoes v
   where v.id = v_doc.tipo_operacao_versao_id and v.organization_id = v_org;
  -- O valor do documento de estoque só é conhecido na confirmação: a conta recebe nulo.
  if not erp.top_exige_aprovacao(v_configuracao, null) then
    raise exception 'APROVACAO_NAO_EXIGIDA: Este documento não precisa de aprovação.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.aprovacoes_estoque_conferir() is
  'TOP-CONFIG-08: decisão de estoque só com usuário e organização da GUC do servidor (linha de outra organização, ou sem GUC: NOT_FOUND antes de qualquer leitura) e com a empresa da linha no escopo de escrita de quem decide no módulo da transação (erp.empresa_escrita_permitida, o predicado do with check; fora dele: NOT_FOUND antes de qualquer leitura), para documento de estoque dessa organização e da empresa da linha, aberto, que exige aprovação (sem valor); atribui TOP, versão congelada, decidido_por e decidido_em do documento e da transação.';
create trigger trg_aprovacoes_estoque_conferir
  before insert on erp.aprovacoes_estoque
  for each row execute function erp.aprovacoes_estoque_conferir();

-- 5.2 Decisão é histórico imutável (o molde da 0020): nem UPDATE nem DELETE, de ninguém. O erp_app já não tem os
-- privilégios (seção 7); o gatilho fecha o caminho do dono também. Uma função, um gatilho por tabela.
create function erp.aprovacoes_imutavel() returns trigger
language plpgsql set search_path = erp, pg_temp as $$
begin
  raise exception 'CONFLICT: A decisão de aprovação não aceita % (uma decisão nova registra a mudança).', tg_op
    using errcode = 'P0001';
end $$;
comment on function erp.aprovacoes_imutavel() is
  'TOP-CONFIG-08: decisão de aprovação é só inserção; recusa UPDATE e DELETE nas três tabelas de aprovação.';
create trigger trg_aprovacoes_venda_imutavel
  before update or delete on erp.aprovacoes_venda
  for each row execute function erp.aprovacoes_imutavel();
create trigger trg_aprovacoes_compra_imutavel
  before update or delete on erp.aprovacoes_compra
  for each row execute function erp.aprovacoes_imutavel();
create trigger trg_aprovacoes_estoque_imutavel
  before update or delete on erp.aprovacoes_estoque
  for each row execute function erp.aprovacoes_imutavel();

create trigger trg_aprovacoes_venda_audit
  after insert or update or delete on erp.aprovacoes_venda
  for each row execute function erp.audit_row();
create trigger trg_aprovacoes_compra_audit
  after insert or update or delete on erp.aprovacoes_compra
  for each row execute function erp.audit_row();
create trigger trg_aprovacoes_estoque_audit
  after insert or update or delete on erp.aprovacoes_estoque
  for each row execute function erp.audit_row();

-- ---------- 6) guardas de transição ----------
-- Só na ENTRADA no confirmado, e só com versão congelada. Não mudam o NEW: leem e deixam passar, ou recusam.
-- Fail-closed na conta (ver o cabeçalho, item 4): a versão de antes E a de depois, e o MAIOR valor entre os dois.
-- A organização é a OLD.organization_id da linha que o UPDATE já alcançou — não a da GUC, ao contrário da inserção
-- (5.1): aqui não há linha "pedida", e o UPDATE sem GUC (superusuário, migração) tem de continuar guardado.
create function erp.venda_aprovacao_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_decisao text;
begin
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = old.organization_id
                    and v.id in (old.tipo_operacao_versao_id, new.tipo_operacao_versao_id)
                    and erp.top_exige_aprovacao(v.configuracao, greatest(old.total, new.total))) then
    return new;
  end if;
  -- A decisão da versão de ANTES do UPDATE: o NEW.version pode ter sido gravado por quem faz o UPDATE.
  select a.decisao into v_decisao
    from erp.aprovacoes_venda a
   where a.organization_id = old.organization_id and a.documento_id = old.id and a.versao_documento = old.version
   order by a.id desc
   limit 1;
  if v_decisao is null then
    raise exception 'CONFLICT: Este documento precisa de aprovação antes de ser confirmado.' using errcode = 'P0001';
  end if;
  if v_decisao <> 'aprovado' then
    raise exception 'CONFLICT: Este documento foi reprovado e não pode ser confirmado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.venda_aprovacao_guarda() is
  'TOP-CONFIG-08: a venda que exige aprovação (versão congelada no formato 4) só entra em confirmed/invoiced com a última decisão da versão OLD.version aprovada; senão, CONFLICT com mensagem fixa.';
-- O MESMO WHEN da 0023 (trg_sales_documents_execucao_configurada): qualquer estado → confirmed ou invoiced, com
-- versão congelada. confirmed → invoiced não dispara (nenhum efeito de confirmação acontece ali).
create trigger trg_sales_documents_aprovacao
  before update of status on erp.sales_documents
  for each row
  when (NEW.status in ('confirmed', 'invoiced')
        and OLD.status is distinct from 'confirmed'
        and OLD.status is distinct from 'invoiced'
        and NEW.tipo_operacao_versao_id is not null)
  execute function erp.venda_aprovacao_guarda();

create function erp.documentos_compra_aprovacao_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_decisao text;
begin
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = old.organization_id
                    and v.id in (old.tipo_operacao_versao_id, new.tipo_operacao_versao_id)
                    and erp.top_exige_aprovacao(v.configuracao, greatest(old.valor_total, new.valor_total))) then
    return new;
  end if;
  select a.decisao into v_decisao
    from erp.aprovacoes_compra a
   where a.organization_id = old.organization_id and a.documento_id = old.id
   order by a.id desc
   limit 1;
  if v_decisao is null then
    raise exception 'CONFLICT: Este documento precisa de aprovação antes de ser confirmado.' using errcode = 'P0001';
  end if;
  if v_decisao <> 'aprovado' then
    raise exception 'CONFLICT: Este documento foi reprovado e não pode ser confirmado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_compra_aprovacao_guarda() is
  'TOP-CONFIG-08: a compra que exige aprovação (versão congelada no formato 4) só passa de aberto a confirmado com a última decisão aprovada; senão, CONFLICT com mensagem fixa.';
create trigger trg_documentos_compra_aprovacao
  before update of situacao on erp.documentos_compra
  for each row
  when (OLD.situacao = 'aberto' and NEW.situacao = 'confirmado')
  execute function erp.documentos_compra_aprovacao_guarda();

create function erp.documentos_estoque_aprovacao_guarda() returns trigger
language plpgsql security definer set search_path = erp, pg_temp as $$
declare
  v_decisao text;
begin
  -- Sem valor: o do documento de estoque só é conhecido na confirmação.
  if not exists (select 1 from erp.tipos_operacao_versoes v
                  where v.organization_id = old.organization_id
                    and v.id in (old.tipo_operacao_versao_id, new.tipo_operacao_versao_id)
                    and erp.top_exige_aprovacao(v.configuracao, null)) then
    return new;
  end if;
  select a.decisao into v_decisao
    from erp.aprovacoes_estoque a
   where a.organization_id = old.organization_id and a.documento_id = old.id
   order by a.id desc
   limit 1;
  if v_decisao is null then
    raise exception 'CONFLICT: Este documento precisa de aprovação antes de ser confirmado.' using errcode = 'P0001';
  end if;
  if v_decisao <> 'aprovado' then
    raise exception 'CONFLICT: Este documento foi reprovado e não pode ser confirmado.' using errcode = 'P0001';
  end if;
  return new;
end $$;
comment on function erp.documentos_estoque_aprovacao_guarda() is
  'TOP-CONFIG-08: o documento de estoque que exige aprovação (versão congelada no formato 4) só passa de aberto a confirmado com a última decisão aprovada; senão, CONFLICT com mensagem fixa.';
create trigger trg_documentos_estoque_aprovacao
  before update of situacao on erp.documentos_estoque
  for each row
  when (OLD.situacao = 'aberto' and NEW.situacao = 'confirmado')
  execute function erp.documentos_estoque_aprovacao_guarda();

-- ---------- 7) RLS e privilégios ----------
-- Categoria A da 0015 (empresa obrigatória) — o MESMO gabarito inline da 0040 (InitPlan + hashed SubPlan).
alter table erp.aprovacoes_venda enable row level security;
alter table erp.aprovacoes_venda force row level security;
create policy tenant_e_empresa on erp.aprovacoes_venda for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.aprovacoes_compra enable row level security;
alter table erp.aprovacoes_compra force row level security;
create policy tenant_e_empresa on erp.aprovacoes_compra for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

alter table erp.aprovacoes_estoque enable row level security;
alter table erp.aprovacoes_estoque force row level security;
create policy tenant_e_empresa on erp.aprovacoes_estoque for all to erp_app, authenticated
  using (erp.tenant_visible(organization_id)
         and (empresa_id is null or (select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual()))))
  with check (erp.tenant_visible(organization_id)
         and ((select erp.escopo_empresa_total(erp.modulo_empresa_atual()))
              or (empresa_id is not null and empresa_id in (select erp.empresas_do_membro(erp.modulo_empresa_atual())))));

-- Só inserção: a 0007 dá os quatro privilégios a toda tabela nova; o grant sozinho não tira nada, então o revoke é
-- EXPLÍCITO e vem depois (o mesmo cuidado da 0020 com a versão da TOP).
grant select, insert on erp.aprovacoes_venda, erp.aprovacoes_compra, erp.aprovacoes_estoque to erp_app;
revoke update, delete, truncate on erp.aprovacoes_venda, erp.aprovacoes_compra, erp.aprovacoes_estoque from erp_app;

-- As funções de gatilho não são porta de ninguém: a 0007 dá EXECUTE por padrão ao erp_app; tira-se de todos (o laço
-- da 0040; os nomes vêm do catálogo, nada de entrada de usuário).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn, a.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where n.nspname = 'erp'
       and p.proname in ('aprovacoes_venda_conferir', 'aprovacoes_compra_conferir', 'aprovacoes_estoque_conferir', 'aprovacoes_imutavel',
                         'venda_aprovacao_guarda', 'documentos_compra_aprovacao_guarda', 'documentos_estoque_aprovacao_guarda')
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
  loop
    if r.grantee = 0 then
      execute format('revoke execute on function %s from public', r.fn);
    else
      execute format('revoke execute on function %s from %s', r.fn, r.grantee::regrole::text);
    end if;
  end loop;
end $$;

-- A conta é a exceção declarada: a fila de aprovações da API a usa em SQL. PUBLIC não executa; o erp_app executa.
revoke execute on function erp.top_exige_aprovacao(jsonb, numeric) from public;
grant execute on function erp.top_exige_aprovacao(jsonb, numeric) to erp_app;

-- ---------- 8) pós-condições nomeadas (objetos, nunca contagem de tabela viva) ----------
do $$
declare
  v_depois text[];
  v_when text;
begin
  if to_regclass('erp.aprovacoes_venda') is null or to_regclass('erp.aprovacoes_compra') is null or to_regclass('erp.aprovacoes_estoque') is null then
    raise exception 'TOP-CONFIG-08: as tabelas de aprovacao nao foram criadas.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'erp' and c.relname in ('aprovacoes_venda', 'aprovacoes_compra', 'aprovacoes_estoque')
                and not (c.relrowsecurity and c.relforcerowsecurity)) then
    raise exception 'TOP-CONFIG-08: tabela de aprovacao sem RLS habilitada e forcada.';
  end if;
  if exists (select 1 from unnest(array['aprovacoes_venda', 'aprovacoes_compra', 'aprovacoes_estoque']) t(tabela)
              where (select array_agg(policyname::text order by policyname) from pg_policies where schemaname = 'erp' and tablename = t.tabela)
                    is distinct from array['tenant_e_empresa']) then
    raise exception 'TOP-CONFIG-08: politica das tabelas de aprovacao diferente de tenant_e_empresa (uma so).';
  end if;
  -- Quatro FKs nomeadas por tabela, sem cascata; a do documento da venda é a única de coluna só.
  if (select count(*) from pg_constraint where contype = 'f' and confdeltype = 'a' and confupdtype = 'a'
        and conname in ('fk_aprovacoes_venda_documento', 'fk_aprovacoes_venda_empresa', 'fk_aprovacoes_venda_tipo_operacao', 'fk_aprovacoes_venda_tipo_operacao_versao',
                        'fk_aprovacoes_compra_documento', 'fk_aprovacoes_compra_empresa', 'fk_aprovacoes_compra_tipo_operacao', 'fk_aprovacoes_compra_tipo_operacao_versao',
                        'fk_aprovacoes_estoque_documento', 'fk_aprovacoes_estoque_empresa', 'fk_aprovacoes_estoque_tipo_operacao', 'fk_aprovacoes_estoque_tipo_operacao_versao')
        and (conname = 'fk_aprovacoes_venda_documento' or array_length(conkey, 1) >= 2)) <> 12 then
    raise exception 'TOP-CONFIG-08: FKs das tabelas de aprovacao (documento, empresa, TOP, versao; sem cascata) incompletas (esperadas 12).';
  end if;
  -- A FK de empresa na ORDEM (organization_id, empresa_id) → (organization_id, id): é a que a matriz de RLS exige.
  if (select count(*) from pg_constraint c
       where c.contype = 'f' and c.confrelid = 'erp.empresas'::regclass
         and c.conname in ('fk_aprovacoes_venda_empresa', 'fk_aprovacoes_compra_empresa', 'fk_aprovacoes_estoque_empresa')
         and c.conkey = array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'organization_id'),
                              (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'empresa_id')]::int2[]
         and c.confkey = array[(select attnum from pg_attribute where attrelid = 'erp.empresas'::regclass and attname = 'organization_id'),
                               (select attnum from pg_attribute where attrelid = 'erp.empresas'::regclass and attname = 'id')]::int2[]) <> 3 then
    raise exception 'TOP-CONFIG-08: FK de empresa das tabelas de aprovacao fora da forma (organization_id, empresa_id) -> erp.empresas (organization_id, id).';
  end if;
  if (select count(*) from pg_constraint where contype = 'c'
        and conname in ('chk_aprovacoes_venda_decisao', 'chk_aprovacoes_venda_observacao', 'chk_aprovacoes_venda_reprovacao',
                        'chk_aprovacoes_compra_decisao', 'chk_aprovacoes_compra_observacao', 'chk_aprovacoes_compra_reprovacao',
                        'chk_aprovacoes_estoque_decisao', 'chk_aprovacoes_estoque_observacao', 'chk_aprovacoes_estoque_reprovacao')) <> 9 then
    raise exception 'TOP-CONFIG-08: CHECKs das tabelas de aprovacao (decisao, observacao ate 500, motivo da reprovacao) incompletos (esperados 9).';
  end if;
  if to_regclass('erp.ix_aprovacoes_venda_documento') is null or to_regclass('erp.ix_aprovacoes_compra_documento') is null
     or to_regclass('erp.ix_aprovacoes_estoque_documento') is null then
    raise exception 'TOP-CONFIG-08: indice (organization_id, documento_id, id desc) das tabelas de aprovacao ausente.';
  end if;
  -- A conta: plpgsql, imutável, sem SECURITY DEFINER, search_path fixo; o erp_app executa e PUBLIC não.
  if not exists (select 1 from pg_proc p
                  where p.oid = 'erp.top_exige_aprovacao(jsonb,numeric)'::regprocedure
                    and p.provolatile = 'i' and not p.prosecdef and p.prorettype = 'boolean'::regtype
                    and p.proconfig = array['search_path=erp, pg_temp'])
     or not has_function_privilege('erp_app', 'erp.top_exige_aprovacao(jsonb,numeric)', 'execute')
     or has_function_privilege('public', 'erp.top_exige_aprovacao(jsonb,numeric)', 'execute') then
    raise exception 'TOP-CONFIG-08: erp.top_exige_aprovacao fora da forma (imutavel, sem SECURITY DEFINER, search_path "erp, pg_temp", EXECUTE do erp_app e nao de PUBLIC).';
  end if;
  -- Funções de gatilho: SECURITY DEFINER nas seis que leem documento/decisão; a de imutabilidade não lê nada.
  if (select count(*) from pg_proc p
       where p.oid in ('erp.aprovacoes_venda_conferir()'::regprocedure, 'erp.aprovacoes_compra_conferir()'::regprocedure,
                       'erp.aprovacoes_estoque_conferir()'::regprocedure, 'erp.venda_aprovacao_guarda()'::regprocedure,
                       'erp.documentos_compra_aprovacao_guarda()'::regprocedure, 'erp.documentos_estoque_aprovacao_guarda()'::regprocedure)
         and p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) <> 6
     or not exists (select 1 from pg_proc p where p.oid = 'erp.aprovacoes_imutavel()'::regprocedure
                     and not p.prosecdef and p.proconfig = array['search_path=erp, pg_temp']) then
    raise exception 'TOP-CONFIG-08: funcoes de gatilho da aprovacao sem SECURITY DEFINER (conferencias e guardas), ou sem search_path "erp, pg_temp".';
  end if;
  if exists (select 1 from pg_proc p
               cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid in ('erp.aprovacoes_venda_conferir()'::regprocedure, 'erp.aprovacoes_compra_conferir()'::regprocedure,
                              'erp.aprovacoes_estoque_conferir()'::regprocedure, 'erp.aprovacoes_imutavel()'::regprocedure,
                              'erp.venda_aprovacao_guarda()'::regprocedure, 'erp.documentos_compra_aprovacao_guarda()'::regprocedure,
                              'erp.documentos_estoque_aprovacao_guarda()'::regprocedure)
                and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) then
    raise exception 'TOP-CONFIG-08: EXECUTE das funcoes de gatilho da aprovacao ainda concedido alem do dono.';
  end if;
  -- Gatilhos das tabelas de aprovação, por tabela: conferência (BEFORE INSERT), imutabilidade (BEFORE UPDATE OR
  -- DELETE) e auditoria (AFTER INSERT OR UPDATE OR DELETE). tgtype: 1 ROW, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE.
  if (select count(*)
        from (values ('erp.aprovacoes_venda'::regclass, 'trg_aprovacoes_venda_conferir', 1 | 2 | 4, 'erp.aprovacoes_venda_conferir()'::regprocedure),
                     ('erp.aprovacoes_compra'::regclass, 'trg_aprovacoes_compra_conferir', 1 | 2 | 4, 'erp.aprovacoes_compra_conferir()'::regprocedure),
                     ('erp.aprovacoes_estoque'::regclass, 'trg_aprovacoes_estoque_conferir', 1 | 2 | 4, 'erp.aprovacoes_estoque_conferir()'::regprocedure),
                     ('erp.aprovacoes_venda'::regclass, 'trg_aprovacoes_venda_imutavel', 1 | 2 | 8 | 16, 'erp.aprovacoes_imutavel()'::regprocedure),
                     ('erp.aprovacoes_compra'::regclass, 'trg_aprovacoes_compra_imutavel', 1 | 2 | 8 | 16, 'erp.aprovacoes_imutavel()'::regprocedure),
                     ('erp.aprovacoes_estoque'::regclass, 'trg_aprovacoes_estoque_imutavel', 1 | 2 | 8 | 16, 'erp.aprovacoes_imutavel()'::regprocedure),
                     ('erp.aprovacoes_venda'::regclass, 'trg_aprovacoes_venda_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure),
                     ('erp.aprovacoes_compra'::regclass, 'trg_aprovacoes_compra_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure),
                     ('erp.aprovacoes_estoque'::regclass, 'trg_aprovacoes_estoque_audit', 1 | 4 | 8 | 16, 'erp.audit_row()'::regprocedure))
             e(tabela, nome, tipo, funcao)
        join pg_trigger t on t.tgrelid = e.tabela and t.tgname = e.nome and t.tgtype = e.tipo and t.tgfoid = e.funcao
       where not t.tgisinternal and t.tgenabled = 'O' and cardinality(t.tgattr::int2[]) = 0 and t.tgqual is null) <> 9 then
    raise exception 'TOP-CONFIG-08: gatilhos das tabelas de aprovacao (conferencia, imutabilidade, auditoria) ausentes, desligados, de outro tipo ou na funcao errada (esperados 9).';
  end if;
  -- As três guardas: BEFORE UPDATE OF <situação> FOR EACH ROW, com WHEN, ligadas, na função certa.
  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = (1 | 2 | 16) and t.tgqual is not null
         and ((t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_aprovacao'
               and t.tgfoid = 'erp.venda_aprovacao_guarda()'::regprocedure
               and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.sales_documents'::regclass and attname = 'status')]::int2[])
           or (t.tgrelid = 'erp.documentos_compra'::regclass and t.tgname = 'trg_documentos_compra_aprovacao'
               and t.tgfoid = 'erp.documentos_compra_aprovacao_guarda()'::regprocedure
               and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_compra'::regclass and attname = 'situacao')]::int2[])
           or (t.tgrelid = 'erp.documentos_estoque'::regclass and t.tgname = 'trg_documentos_estoque_aprovacao'
               and t.tgfoid = 'erp.documentos_estoque_aprovacao_guarda()'::regprocedure
               and (select array_agg(x) from unnest(t.tgattr) x) = array[(select attnum from pg_attribute where attrelid = 'erp.documentos_estoque'::regclass and attname = 'situacao')]::int2[]))) <> 3 then
    raise exception 'TOP-CONFIG-08: guardas de transicao da aprovacao ausentes, desligadas, de outro tipo (BEFORE UPDATE OF situacao/status com WHEN) ou na funcao errada (esperadas 3).';
  end if;
  -- A guarda da venda tem o MESMO WHEN da 0023 (e um WHEN de fato: dois nulos não provariam nada).
  select substring(pg_get_triggerdef(t.oid) from ' WHEN \((.*)\) EXECUTE ') into v_when
    from pg_trigger t where t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_aprovacao';
  if v_when is null
     or v_when is distinct from (select substring(pg_get_triggerdef(t.oid) from ' WHEN \((.*)\) EXECUTE ') from pg_trigger t
                                  where t.tgrelid = 'erp.sales_documents'::regclass and t.tgname = 'trg_sales_documents_execucao_configurada') then
    raise exception 'TOP-CONFIG-08: o WHEN de trg_sales_documents_aprovacao nao e o mesmo de trg_sales_documents_execucao_configurada (0023).';
  end if;
  -- A ORDEM: os BEFORE UPDATE por linha da venda são exatamente quatro, a guarda da aprovação a PRIMEIRA e a versão
  -- (0039) a ÚLTIMA, por nome.
  select array_agg(t.tgname::text order by t.tgname collate "C") into v_depois
    from pg_trigger t
   where t.tgrelid = 'erp.sales_documents'::regclass and not t.tgisinternal
     and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16;
  if v_depois is distinct from array['trg_sales_documents_aprovacao', 'trg_sales_documents_classificacao_financeira',
                                     'trg_sales_documents_execucao_configurada', 'trg_sales_documents_versao'] then
    raise exception 'TOP-CONFIG-08: BEFORE UPDATE por linha de erp.sales_documents diferentes de aprovacao, classificacao_financeira, execucao_configurada e versao (nessa ordem): %', v_depois;
  end if;
  -- Privilégios do erp_app: só select e insert.
  if exists (select 1 from unnest(array['erp.aprovacoes_venda', 'erp.aprovacoes_compra', 'erp.aprovacoes_estoque']) t(tabela)
              where not has_table_privilege('erp_app', t.tabela, 'select') or not has_table_privilege('erp_app', t.tabela, 'insert')
                 or has_table_privilege('erp_app', t.tabela, 'update') or has_table_privilege('erp_app', t.tabela, 'delete')
                 or has_table_privilege('erp_app', t.tabela, 'truncate')) then
    raise exception 'TOP-CONFIG-08: privilegios do erp_app nas tabelas de aprovacao errados (esperado so select e insert).';
  end if;
end $$;
