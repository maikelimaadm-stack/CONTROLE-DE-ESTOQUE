"use client";
import * as React from "react";
import { CampoPrevia } from "./campo-previa";
import { MIME_ARRASTE, useConfigurador } from "./contrato";
import { adicionarAba, deslocarAba, moverCampo, removerAba, renomearAba } from "./operacoes";
import { useZonaDeSoltura } from "./zona";

/** Tipo MIME do arraste de ABA (reordenar) — distinto do arraste de campo. */
const MIME_ABA = "text/layout-aba";

/** Rodapé na prévia: abas (tabs), "+ Aba", renomear (duplo clique), reordenar (arrastar ou ←/→), remover só vazia. */
export function PreviaRodape() {
  const ctx = useConfigurador();
  const { estrutura, editando, abaAtiva, setAbaAtiva, aplicar, familia } = ctx;
  const abas = estrutura.rodape;
  const ativa = abas.length ? Math.min(Math.max(abaAtiva, 0), abas.length - 1) : -1;
  const [renomeando, setRenomeando] = React.useState<number | null>(null);
  const [nome, setNome] = React.useState("");
  const [sobre, setSobre] = React.useState<number | null>(null);

  const deslocar = (i: number, delta: -1 | 1) => {
    const alvo = i + delta;
    if (alvo < 0 || alvo >= abas.length) return;
    const r = deslocarAba(estrutura, i, delta);
    aplicar(r);
    if (!r.ok) return;
    if (ativa === i) setAbaAtiva(alvo);
    else if (ativa === alvo) setAbaAtiva(i);
  };

  const confirmarNome = (i: number) => {
    setRenomeando(null);
    const n = nome.trim();
    if (n && n !== abas[i]?.aba) aplicar(renomearAba(estrutura, i, n));
  };

  const soltarNaTab = (e: React.DragEvent, i: number) => {
    setSobre(null);
    if (!editando) return;
    const origemAba = e.dataTransfer.getData(MIME_ABA);
    if (origemAba !== "") {
      e.preventDefault();
      let de = Number(origemAba);
      if (!Number.isInteger(de) || de === i) return;
      // reordena passo a passo pelas MESMAS operações dos botões ←/→
      let est = estrutura;
      const passo: -1 | 1 = i > de ? 1 : -1;
      while (de !== i) {
        const r = deslocarAba(est, de, passo);
        if (!r.ok) { aplicar(r); return; }
        est = r.estrutura;
        de += passo;
      }
      aplicar({ ok: true, estrutura: est });
      setAbaAtiva(i);
      return;
    }
    const chave = e.dataTransfer.getData(MIME_ARRASTE) || ctx.arrastando;
    if (chave) {
      e.preventDefault();
      const r = moverCampo(familia, estrutura, chave, { tipo: "aba", indice: i });
      aplicar(r);
      if (r.ok) setAbaAtiva(i);
      ctx.setArrastando(null);
    }
  };

  const remover = (i: number) => {
    const r = removerAba(estrutura, i);
    aplicar(r);
    if (r.ok && ativa >= i && ativa > 0) setAbaAtiva(ativa - 1);
  };

  const nova = () => {
    const r = adicionarAba(estrutura);
    aplicar(r);
    if (r.ok) setAbaAtiva(r.estrutura.rodape.length - 1);
  };

  return (
    <section className="emp-layout-config-footer" aria-label="Abas do rodapé">
      <div className="emp-layout-config-card-tabs" role="tablist">
        {abas.map((a, i) => (
          <span key={`${i}-${a.aba}`} className="inline-flex items-center gap-1">
            {renomeando === i ? (
              <input
                data-testid={`config-aba-nome-${i}`}
                aria-label="Nome da aba"
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); confirmarNome(i); }
                  else if (e.key === "Escape") { e.preventDefault(); setRenomeando(null); }
                }}
                onBlur={() => setRenomeando(null)}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={i === ativa}
                data-testid={`config-aba-${i}`}
                className={`emp-layout-config-footer-btn${i === ativa ? " emp-layout-config-footer-btn--active" : ""}${sobre === i ? " emp-layout-config-drop-target" : ""}`}
                onClick={() => setAbaAtiva(i)}
                onDoubleClick={() => { if (editando) { setNome(a.aba); setRenomeando(i); } }}
                draggable={editando}
                onDragStart={(e) => { e.dataTransfer.setData(MIME_ABA, String(i)); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (editando) { e.preventDefault(); setSobre(i); } }}
                onDragLeave={() => setSobre(null)}
                onDrop={(e) => soltarNaTab(e, i)}
              >
                {a.aba}
              </button>
            )}
            {editando && (
              <>
                <button type="button" data-testid={`config-aba-esquerda-${i}`} aria-label={`Mover a aba ${a.aba} para a esquerda`} disabled={i === 0} onClick={() => deslocar(i, -1)}>←</button>
                <button type="button" data-testid={`config-aba-direita-${i}`} aria-label={`Mover a aba ${a.aba} para a direita`} disabled={i === abas.length - 1} onClick={() => deslocar(i, 1)}>→</button>
                {a.campos.length === 0 && (
                  <button type="button" data-testid={`config-aba-remover-${i}`} aria-label={`Remover a aba ${a.aba}`} onClick={() => remover(i)}>×</button>
                )}
              </>
            )}
          </span>
        ))}
        {editando && (
          <button type="button" data-testid="config-aba-nova" className="emp-layout-config-footer-btn" onClick={nova}>
            + Aba
          </button>
        )}
      </div>
      {ativa >= 0 && <ZonaDaAba indice={ativa} />}
    </section>
  );
}

function ZonaDaAba({ indice }: { indice: number }) {
  const { estrutura, editando } = useConfigurador();
  const zona = useZonaDeSoltura({ tipo: "aba", indice });
  const aba = estrutura.rodape[indice];
  if (!aba) return null;
  return (
    <div data-testid={`config-zona-aba-${indice}`} role="tabpanel" className="emp-layout-config-panel-fields" {...(editando ? zona : {})}>
      {aba.campos.length === 0 ? (
        <p className="emp-layout-config-help">Aba vazia. Arraste campos para cá.</p>
      ) : (
        aba.campos.map((c) => <CampoPrevia key={c.campo} chave={c.campo} />)
      )}
    </div>
  );
}
