"use client";
/**
 * CONFIGURAÇÃO DE LAYOUT — INSPETOR (decisão 275).
 *
 * As propriedades do campo, num <aside> à direita do documento (só na edição). Não é diálogo: não prende o foco,
 * não cobre a tela e convive com o documento. Mostra só o que o FormLayout de hoje grava — rótulo, Obrigatório,
 * Visível, Somente leitura e o valor padrão fixo. Dica para quem preenche, valor padrão variável, Comportamento e
 * Validação ficam para quando o contrato os tiver.
 *
 * O componente não decide regra: cada mudança vai para uma prop (o rascunho faz a operação e a pilha), e as travas
 * vêm da DEFINIÇÃO do cadastro (`doSistema`, `soLeituraNaDefinicao`). O único estado local é o do segmentado do valor
 * padrão: "Fixo" com a caixa vazia não grava nada, então só vive enquanto o inspetor está aberto.
 */
import * as React from "react";
import { RotateCcw, X } from "lucide-react";
import type { FieldType } from "@agro/domain";
import type { PropsInspetor } from "./tipos";
import estilos from "./inspetor.module.css";

/** O tipo do campo na pílula do cabeçalho. `Record` exaustivo: tipo novo na definição obriga a escolher o nome aqui. */
const NOME_DO_TIPO: Record<FieldType, string> = {
  text: "Texto",
  textarea: "Texto",
  email: "Texto",
  json: "Texto",
  number: "Número",
  integer: "Número",
  quantity: "Número",
  percent: "Número",
  money: "Valor",
  date: "Data",
  select: "Lista",
  tags: "Lista",
  ref: "Busca",
  boolean: "Sim ou não"
};

/** O contrato corta o rótulo em 60 caracteres ao salvar (normalizeFormLayout): a caixa não deixa passar disso. */
const LIMITE_DO_ROTULO = 60;

/**
 * Quantos inspetores estão montados. O W1 troca de campo pela `key`, o que remonta o componente; o desenho troca o
 * conteúdo sem fechar o painel, e por isso o "entraLado" só toca quando o inspetor ABRE — não quando ele troca de
 * campo (nessa hora o inspetor anterior ainda está montado durante a renderização do novo).
 */
let inspetoresMontados = 0;

interface PropsChave {
  titulo: string;
  descricao: string;
  ligada: boolean;
  travada: boolean;
  aoMudar: (ligada: boolean) => void;
}

function Chave({ titulo, descricao, ligada, travada, aoMudar }: PropsChave) {
  const idDescricao = React.useId();
  return (
    <div className={estilos.linhaChave}>
      <span className={estilos.textoChave}>
        <span className={estilos.tituloChave}>{titulo}</span>
        <span id={idDescricao} className={estilos.descricaoChave}>{descricao}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        aria-label={titulo}
        aria-describedby={idDescricao}
        disabled={travada}
        className={estilos.chave}
        onClick={() => aoMudar(!ligada)}
      >
        <span className={estilos.bolinha} />
      </button>
    </div>
  );
}

export function Inspetor(props: PropsInspetor) {
  const { campo, rotulo, valorPadrao, doSistema, soLeituraNaDefinicao } = props;
  const idRotulo = React.useId();
  const idValorPadrao = React.useId();
  const refRotulo = React.useRef<HTMLInputElement>(null);

  const [entra] = React.useState(() => inspetoresMontados <= 0);
  React.useEffect(() => {
    inspetoresMontados += 1;
    return () => { inspetoresMontados = Math.max(0, inspetoresMontados - 1); };
  }, []);

  /* Valor padrão: com valor gravado é sempre "Fixo" (também depois de um Desfazer/Refazer); sem valor, vale a escolha
     local — "Fixo" com a caixa vazia até o inspetor fechar. */
  const temValor = valorPadrao !== undefined && valorPadrao !== "";
  const [escolha, setEscolha] = React.useState<"nenhum" | "fixo">(temValor ? "fixo" : "nenhum");
  const fixo = temValor || escolha === "fixo";

  const nome = rotulo || campo.label;
  const fecharNoEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); props.aoFecharDigitacao(); }
  };

  const voltarAoNomeDoSistema = (e: React.MouseEvent<HTMLButtonElement>) => {
    props.aoRotulo("");
    props.aoFecharDigitacao();
    /* o botão fica desabilitado e perderia o foco: pelo teclado (detail 0), o foco volta para a caixa */
    if (e.detail === 0) refRotulo.current?.focus();
  };

  /* o clique na sobra da caixa (fora do texto e do botão) leva o foco para o texto, como o <label> do desenho */
  const focarRotulo = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    refRotulo.current?.focus();
  };

  const escolherNenhum = () => {
    setEscolha("nenhum");
    if (valorPadrao !== undefined) { props.aoValorPadrao(undefined); props.aoFecharDigitacao(); }
  };

  return (
    <aside
      aria-label="Propriedades do campo"
      data-parte="inspetor"
      data-fid={campo.id}
      data-entra={entra ? "true" : undefined}
      className={estilos.inspetor}
    >
      <div className={estilos.cabeca}>
        <span className={estilos.nome}>{nome}</span>
        <span className={estilos.tipo}>{NOME_DO_TIPO[campo.tipo] ?? "Texto"}</span>
        <span className={estilos.espaco} />
        <button type="button" className={estilos.fechar} aria-label="Fechar propriedades" data-dica="Fechar" onClick={() => props.aoFechar()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className={estilos.corpo}>
        <div className={`${estilos.grupo} ${estilos.grupoDoRotulo}`}>
          <label htmlFor={idRotulo} className={estilos.rotuloGrupo}>Rótulo no formulário</label>
          <span className={estilos.caixa} onMouseDown={focarRotulo}>
            <input
              id={idRotulo}
              ref={refRotulo}
              value={rotulo ?? ""}
              placeholder={campo.label}
              aria-label="Rótulo do campo"
              maxLength={LIMITE_DO_ROTULO}
              onChange={(e) => props.aoRotulo(e.target.value)}
              onKeyDown={fecharNoEnter}
              onBlur={() => props.aoFecharDigitacao()}
            />
            <button
              type="button"
              className={estilos.restaurar}
              aria-label="Voltar ao nome do sistema"
              data-dica="Voltar ao nome do sistema"
              disabled={!rotulo}
              onClick={voltarAoNomeDoSistema}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </span>
        </div>

        <Chave
          titulo="Obrigatório"
          descricao="Não deixa gravar em branco"
          ligada={doSistema || props.obrigatorio}
          travada={doSistema || (soLeituraNaDefinicao && !props.obrigatorio)}
          aoMudar={props.aoObrigatorio}
        />
        <Chave
          titulo="Visível"
          descricao="Some do formulário sem sair do layout"
          ligada={doSistema || props.visivel}
          travada={doSistema}
          aoMudar={props.aoVisivel}
        />
        <Chave
          titulo="Somente leitura"
          descricao="Mostra o valor mas não deixa editar"
          ligada={soLeituraNaDefinicao || props.somenteLeitura}
          travada={soLeituraNaDefinicao}
          aoMudar={props.aoSomenteLeitura}
        />

        <div className={estilos.grupo}>
          <span id={idValorPadrao} className={estilos.rotuloGrupo}>Valor padrão</span>
          <span className={estilos.segmentado} role="group" aria-labelledby={idValorPadrao}>
            <button type="button" aria-pressed={!fixo} onClick={escolherNenhum}>Nenhum</button>
            <button type="button" aria-pressed={fixo} onClick={() => setEscolha("fixo")}>Fixo</button>
          </span>
        </div>
        {fixo && (
          <span className={estilos.caixa}>
            <input
              value={valorPadrao ?? ""}
              placeholder="valor que já vem preenchido"
              aria-label="Valor padrão fixo"
              onChange={(e) => { setEscolha("fixo"); props.aoValorPadrao(e.target.value || undefined); }}
              onKeyDown={fecharNoEnter}
              onBlur={() => props.aoFecharDigitacao()}
            />
          </span>
        )}
      </div>
    </aside>
  );
}
