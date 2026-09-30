"use client";
import * as React from "react";
import { COPY } from "@/lib/copy";
import { Button, Dialog, Field, Input, NativeSelect } from "@/components/ui";
import { RefSelect, type Option } from "@/components/ui/ref-select";
import { AVISO_PADRAO_REGISTRO_MORTO, colunasComPadraoRegistro, type CampoDoCatalogo, type ValorPadraoLayout } from "@agro/domain";
import {
  TEXTOS, campoDaChave, ehChaveDeColuna, useConfigurador,
  type CampoDoLayout, type ColunaDoLayout, type EstruturaLayout, type RegistroConhecido
} from "./contrato";
import { substituirCampo } from "./operacoes";

/**
 * "CONFIGURAR CAMPO" do configurador visual (VENDAS-A3-1c). É o diálogo da A3-1b (mesmos testids `layout-configurar-campo`
 * e `layout-cfg-*`, mesma validação local: Aplicar desligado sem registro no modo "Registro do cadastro") + "Restaurar
 * nome do sistema" (`layout-cfg-restaurar-nome`), que limpa o rótulo próprio — volta a valer o do catálogo.
 * A mudança entra no rascunho por `substituirCampo` + `ctx.aplicar` (desfazível; recusa → aviso da página).
 *
 * VENDAS-A3-1d (decisão 262): rodapé [Fechar] (`layout-cfg-fechar`) [Aplicar]. Fechar por qualquer caminho (Fechar, X,
 * Esc, clique fora) COM mudança pendente no formulário pergunta antes (`TEXTOS.descartarCampo`): "Descartar"
 * (`layout-cfg-descartar`) fecha sem tocar no campo; "Voltar ao campo" (`layout-cfg-voltar`, Esc ou clique fora da
 * pergunta) volta ao diálogo com o que foi digitado. Sem mudança, fecha direto. Sem permissão o diálogo não abre.
 */
type ModoPadrao = "nenhum" | "literal" | "variavel" | "registro";

/** Acha o campo (documento: cabeçalho ou qualquer aba) ou a coluna ("itens.<c>") na estrutura. */
function acharNaEstrutura(e: EstruturaLayout, chave: string): CampoDoLayout | ColunaDoLayout | undefined {
  const campo = campoDaChave(chave);
  if (ehChaveDeColuna(chave)) return e.itens.find((x) => x.campo === campo);
  return e.cabecalho.find((x) => x.campo === campo) ?? e.rodape.flatMap((a) => a.campos).find((x) => x.campo === campo);
}

export function ConfigurarCampoDialogo({ chave, onFechar, idMorto: idMortoProp, onRegistroEscolhido }: {
  /** documento: a chave; coluna: "itens.<campo>" */
  chave: string;
  onFechar: () => void;
  /** id GRAVADO que o servidor declarou morto; omitido = o id atual do rascunho, se a chave estiver em `padroesInvalidos` */
  idMorto?: string;
  /** a página pode guardar o rótulo do registro escolhido nesta edição (para a prévia) */
  onRegistroEscolhido?: (chave: string, registro: RegistroConhecido) => void;
}) {
  const ctx = useConfigurador();
  const valor = acharNaEstrutura(ctx.estrutura, chave);
  // `can` só apresenta (quem nega é a rota): sem permissão não há rascunho para configurar
  if (!valor || !ctx.podeEditar) return null;
  const ehItem = ehChaveDeColuna(chave);
  const catalogo = ctx.catalogo.find((c) => c.chave === valor.campo && (ehItem ? c.parte === "itens" : c.parte !== "itens"));
  const vpAtual = (valor as Partial<CampoDoLayout>).valorPadrao;
  const idMorto = idMortoProp ?? (ctx.padroesInvalidos.has(chave) && vpAtual?.tipo === "registro" ? vpAtual.id : undefined);
  const rotuloDe = (id: string) => { const r = ctx.padroesDeCadastro.get(chave); return r && r.id === id && r.rotulo ? r.rotulo : undefined; };
  // COMPRAS-03 (decisão 269): a coluna que aceita padrão de cadastro é a do corpo da FAMÍLIA (warehouse_id em vendas,
  // armazem_id em compras) — o mesmo dono que a validação do domínio usa na gravação.
  return <Corpo key={chave} ehItem={ehItem} valor={valor} catalogo={catalogo} idMorto={idMorto} rotuloDe={rotuloDe}
    colunasComPadrao={colunasComPadraoRegistro(ctx.familia)}
    onFechar={onFechar}
    onAplicar={(novo, registro) => {
      const r = substituirCampo(ctx.estrutura, chave, { ...novo });
      ctx.aplicar(r);
      if (!r.ok) return;
      if (registro?.rotulo) onRegistroEscolhido?.(chave, registro);
      onFechar();
    }} />;
}

function Corpo({ ehItem, valor, catalogo, idMorto, rotuloDe, colunasComPadrao, onFechar, onAplicar }: {
  ehItem: boolean; valor: CampoDoLayout | ColunaDoLayout; catalogo?: CampoDoCatalogo;
  idMorto?: string; rotuloDe: (id: string) => string | undefined;
  /** as colunas de item que aceitam padrão registro NA FAMÍLIA (`colunasComPadraoRegistro`) */
  colunasComPadrao: readonly string[];
  onFechar: () => void; onAplicar: (v: CampoDoLayout | ColunaDoLayout, registro?: RegistroConhecido) => void;
}) {
  const base = valor as Partial<CampoDoLayout>;
  const tipo = catalogo?.tipo ?? "texto";
  const [rotulo, setRotulo] = React.useState(valor.rotulo ?? "");
  const [obrigatorio, setObrigatorio] = React.useState(valor.obrigatorio);
  const [editavel, setEditavel] = React.useState(base.editavel ?? true);
  const tipoInicial = base.valorPadrao?.tipo;
  const [modo, setModo] = React.useState<ModoPadrao>(tipoInicial === "literal" ? "literal" : tipoInicial === "variavel" ? "variavel" : tipoInicial === "registro" ? "registro" : "nenhum");
  const [literal, setLiteral] = React.useState<string>(base.valorPadrao?.tipo === "literal" ? String(base.valorPadrao.valor) : "");
  const aceitaLiteral = ["data", "texto", "texto_longo", "numero", "booleano"].includes(tipo);
  const variavel = tipo === "data" ? "data_atual" as const : tipo === "empresa" ? "empresa_selecionada" as const : null;
  const somenteLeitura = Boolean(catalogo?.somenteLeitura);
  /** R1: o corpo sempre leva valor — o domínio recusa "obrigatório" nele. */
  const sempreTemValor = Boolean(catalogo?.sempreTemValor);
  /** A3-1b: "Registro do cadastro" — campo com `referencia`; nos itens, só as colunas que a família aceita (COMPRAS-03). */
  const referencia = catalogo?.referencia;
  const aceitaRegistro = Boolean(referencia) && (!ehItem || colunasComPadrao.includes(valor.campo));
  const [registroId, setRegistroId] = React.useState<string | null>(base.valorPadrao?.tipo === "registro" ? base.valorPadrao.id : null);
  const [registroRotulo, setRegistroRotulo] = React.useState("");
  const morto = modo === "registro" && Boolean(idMorto) && registroId === idMorto;
  const labelHint = registroId ? (rotuloDe(registroId) ?? (registroId === idMorto ? "Registro indisponível" : undefined)) : undefined;
  const faltaRegistro = aceitaRegistro && modo === "registro" && !registroId;
  // `grupo` (cabeçalho) é da POSIÇÃO, não da configuração: preservado
  const grupo = !ehItem && base.grupo ? { grupo: base.grupo } : {};

  /** A3-1d: o estado do formulário ao abrir (o 1º render); qualquer diferença é mudança pendente. */
  const [inicial] = React.useState({ rotulo, obrigatorio, editavel, modo, literal, registroId });
  const pendente = rotulo !== inicial.rotulo || obrigatorio !== inicial.obrigatorio || editavel !== inicial.editavel
    || modo !== inicial.modo || literal !== inicial.literal || registroId !== inicial.registroId;
  const [perguntando, setPerguntando] = React.useState(false);
  /** Fechar, X, Esc e clique fora passam por aqui: com mudança pendente, pergunta antes de descartar. */
  const pedirFechar = () => { if (pendente) setPerguntando(true); else onFechar(); };

  const aplicar = () => {
    const r = rotulo.trim() ? { rotulo: rotulo.trim() } : {};
    const registro = aceitaRegistro && modo === "registro" && registroId ? { id: registroId, rotulo: registroRotulo || (rotuloDe(registroId) ?? "") } : undefined;
    const vpRegistro: ValorPadraoLayout | undefined = registro ? { tipo: "registro", id: registro.id } : undefined;
    if (ehItem) { onAplicar({ campo: valor.campo, ...r, obrigatorio, ...(vpRegistro ? { valorPadrao: vpRegistro } : {}) }, registro); return; }
    let vp: ValorPadraoLayout | undefined = vpRegistro;
    if (modo === "variavel" && variavel) vp = { tipo: "variavel", variavel };
    if (modo === "literal") vp = { tipo: "literal", valor: tipo === "numero" ? Number(literal) : tipo === "booleano" ? literal === "true" : literal };
    onAplicar({ campo: valor.campo, ...r, obrigatorio, editavel, ...grupo, ...(vp ? { valorPadrao: vp } : {}) }, registro);
  };

  return <><Dialog open onOpenChange={(o) => { if (!o) pedirFechar(); }} title={`Configurar campo — ${catalogo?.rotulo ?? valor.campo}`} size="sm" testId="layout-configurar-campo"
    footer={<><Button variant="outline" data-testid="layout-cfg-fechar" onClick={pedirFechar}>{COPY.fechar}</Button><Button data-testid="layout-configurar-aplicar" disabled={faltaRegistro} onClick={aplicar}>Aplicar</Button></>}>
    <div className="grid grid-cols-12 gap-3">
      <Field label="Rótulo" span={12} help={catalogo ? `Vazio = "${catalogo.rotulo}".` : undefined}>
        <div className="flex items-center gap-2">
          <Input data-testid="layout-cfg-rotulo" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
          <Button variant="ghost" size="sm" data-testid="layout-cfg-restaurar-nome" disabled={!rotulo} onClick={() => setRotulo("")}>Restaurar nome do sistema</Button>
        </div>
      </Field>
      <Field label="Obrigatório" span={6} help={sempreTemValor ? "Sempre tem valor" : undefined}>
        <NativeSelect data-testid="layout-cfg-obrigatorio" value={obrigatorio ? "true" : "false"} disabled={somenteLeitura || sempreTemValor} onChange={(e) => setObrigatorio(e.target.value === "true")}>
          <option value="false">Não</option><option value="true">Sim</option>
        </NativeSelect>
      </Field>
      {!ehItem && <Field label="Editável" span={6}>
        <NativeSelect data-testid="layout-cfg-editavel" value={editavel ? "true" : "false"} disabled={somenteLeitura} onChange={(e) => setEditavel(e.target.value === "true")}>
          <option value="true">Sim</option><option value="false">Não</option>
        </NativeSelect>
      </Field>}
      {(!ehItem || aceitaRegistro) && <Field label="Valor padrão" span={12}>
        <NativeSelect data-testid="layout-cfg-padrao-modo" value={modo} onChange={(e) => setModo(e.target.value as ModoPadrao)}>
          <option value="nenhum">Nenhum</option>
          {!ehItem && aceitaLiteral && <option value="literal">Valor fixo</option>}
          {!ehItem && variavel && <option value="variavel">{variavel === "data_atual" ? "Variável: data de hoje" : "Variável: empresa selecionada"}</option>}
          {aceitaRegistro && <option value="registro">Registro do cadastro</option>}
        </NativeSelect>
      </Field>}
      {aceitaRegistro && referencia && modo === "registro" && <div data-testid="layout-cfg-padrao-registro" className="col-span-12 space-y-1">
        <Field label="Registro padrão" span={12} required>
          <RefSelect resource={referencia.recurso} filter={referencia.filtro} value={registroId} labelHint={labelHint}
            onChange={(v: string | null, opt?: Option) => { setRegistroId(v); setRegistroRotulo(v && opt ? (opt.caminho || opt.label) : ""); }} />
        </Field>
        {morto && <p data-testid="layout-cfg-padrao-invalido" role="alert" className="text-[11.5px] text-amber-700">{AVISO_PADRAO_REGISTRO_MORTO}</p>}
      </div>}
      {!ehItem && modo === "literal" && <Field label="Valor fixo" span={12}>
        {tipo === "booleano"
          ? <NativeSelect data-testid="layout-cfg-padrao-valor" value={literal} onChange={(e) => setLiteral(e.target.value)}><option value="">—</option><option value="true">Sim</option><option value="false">Não</option></NativeSelect>
          : <Input data-testid="layout-cfg-padrao-valor" type={tipo === "data" ? "date" : tipo === "numero" ? "number" : "text"} value={literal} onChange={(e) => setLiteral(e.target.value)} />}
      </Field>}
    </div>
  </Dialog>

  {/* A3-1d: a pergunta antes de descartar. Não é o ConfirmDialog porque ele não leva testid nos botões; mesmo visual
      (sm, texto em slate, [dispensar] [confirmar perigo]). Fica num portal próprio, por cima do diálogo do campo:
      Esc e clique fora dela só fecham a pergunta (= Voltar ao campo). */}
  <Dialog open={perguntando} onOpenChange={(o) => { if (!o) setPerguntando(false); }} title="Descartar alterações" size="sm" testId="layout-cfg-descartar-dialogo"
    footer={<><Button variant="outline" data-testid="layout-cfg-voltar" onClick={() => setPerguntando(false)}>Voltar ao campo</Button><Button variant="danger" data-testid="layout-cfg-descartar" onClick={onFechar}>Descartar</Button></>}>
    <p className="text-sm text-slate-600">{TEXTOS.descartarCampo}</p>
  </Dialog></>;
}
