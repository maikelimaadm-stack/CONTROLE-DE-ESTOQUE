-- =====================================================================================================
-- PRE-BASE2-02 — INTEGRIDADE DE TENANT DO RESPONSÁVEL DA SOLICITAÇÃO DE COMPRA
--
-- `erp.purchase_requests.current_responsible_user_id` referenciava `erp.users(id)` — a tabela GLOBAL de
-- identidades, compartilhada por todas as organizações. A referência provava que o UUID É UM USUÁRIO;
-- não provava que é um usuário DESTA organização. Com isso o banco aceitava, sem reclamar, uma
-- solicitação da organização A com responsável da organização B — e a leitura da solicitação devolve
-- `current_responsible_name` num `left join erp.users` que também não filtra organização, então o nome
-- do usuário do outro tenant voltava no corpo da resposta.
--
-- O runtime passou a exigir a invariante completa (membro ativo + `purchase_requests.view` + acesso ao
-- módulo `compras` na empresa da solicitação). Esta migration desce ao banco a parte da invariante que é
-- ESTRUTURAL e não muda com configuração: o responsável tem de ser membro da MESMA organização. Capacidade
-- e escopo de empresa continuam sendo regra de runtime porque mudam a toda hora (trocar o perfil de alguém
-- não pode invalidar retroativamente solicitações históricas já atribuídas a ele).
--
-- ADITIVA: nada é renomeado, nada é apagado, a referência antiga a `erp.users` permanece.
-- =====================================================================================================

-- ---------- 1) auditoria do acervo, ANTES de restringir ----------
-- Uma constraint que "corrige" dados em silêncio é a pior das duas opções: ou apaga o responsável de um
-- processo em andamento (`set null`), ou apaga a própria solicitação (`cascade`). As duas destroem
-- histórico para que a migration não precise falhar. Se existir linha inconsistente, ela é um INCIDENTE —
-- alguém atribuiu (ou o defeito acima permitiu atribuir) um responsável de outro tenant — e incidente se
-- investiga, não se limpa. A migration para, nomeia o problema e entrega a consulta de diagnóstico.
do $$
declare n bigint; exemplo text;
begin
  select count(*), min(r.code) into n, exemplo
    from erp.purchase_requests r
   where r.current_responsible_user_id is not null
     and not exists (
       select 1 from erp.organization_members m
        where m.organization_id = r.organization_id
          and m.user_id = r.current_responsible_user_id);
  if n > 0 then
    raise exception
      'PRE-BASE2-02: % solicitacao(oes) de compra tem current_responsible_user_id que NAO e membro da propria organizacao (ex.: codigo %). Nenhuma correcao automatica foi aplicada: apagar ou trocar o responsavel destruiria historico de um processo em andamento. Liste os casos com: select r.id, r.organization_id, r.code, r.current_responsible_user_id from erp.purchase_requests r where r.current_responsible_user_id is not null and not exists (select 1 from erp.organization_members m where m.organization_id=r.organization_id and m.user_id=r.current_responsible_user_id); decida caso a caso (reatribuir a um membro valido ou anular) e reaplique esta migration.',
      n, coalesce(exemplo, '(sem codigo)');
  end if;
end $$;

-- ---------- 2) a referência passa a provar a organização ----------
-- O par (organization_id, user_id) é a chave natural do vínculo e já é ÚNICO em `erp.organization_members`,
-- então serve de destino de chave estrangeira. Como `organization_id` já é a coluna de tenant da própria
-- solicitação, o banco passa a comparar as duas pontas: responsável de outro tenant vira erro de
-- integridade, não uma linha aceita.
--
-- DELETE: `restrict`. Não existe cascade não-destrutivo aqui — `cascade` apagaria a SOLICITAÇÃO junto com o
-- vínculo do membro, e `set null` apagaria o responsável de processos em andamento sem deixar rastro. O
-- sistema desativa membro (`is_active = false`), que não remove linha nenhuma e não colide com esta
-- restrição; remover fisicamente um membro que ainda responde por solicitações é justamente o caso que
-- precisa ser recusado e resolvido à mão.
-- UPDATE: `cascade`, porque o par é identificador, não dado — se o par mudar, as referências devem segui-lo.
alter table erp.purchase_requests
  add constraint purchase_requests_responsible_membro_fkey
  foreign key (organization_id, current_responsible_user_id)
  references erp.organization_members (organization_id, user_id)
  on update cascade on delete restrict;

comment on constraint purchase_requests_responsible_membro_fkey on erp.purchase_requests is
  'PRE-BASE2-02: responsavel tem de ser membro da MESMA organizacao. A referencia a erp.users prova identidade; esta prova tenant. Capacidade (purchase_requests.view) e escopo de empresa (modulo compras) continuam no runtime, porque mudam com configuracao e nao podem invalidar historico.';

-- índice do lado referenciante: a FK composta é verificada a cada delete em organization_members
create index if not exists purchase_requests_responsible_membro_idx
  on erp.purchase_requests (organization_id, current_responsible_user_id);
