"use client";
import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Map as IconeMapa, Upload } from "lucide-react";
import { api, newIdem } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { canonicalHref, entryById } from "@/lib/nav";
import { Button, Card, Dialog } from "@/components/ui";
import { PillBtn } from "@/features/base1/ui";
import { useEmpresaPadrao } from "@/features/docs/shared";
import { ResourceList } from "@/features/resources/resource-list";
import { parseImportacaoMapa, rotuloFormato } from "@/features/mapa-de-manejo/importacao";

/**
 * ÁREAS / PIQUETES: o ÚNICO lugar do cadastro de área. A lista é a de sempre; a ficha traz o mapa com o editor de
 * contorno; e a importação de contornos (KML / GeoJSON) que antes ficava no Mapa de Manejo mora aqui — o mapa só mostra.
 */
export function ListaDeAreas() {
  const { can } = useAuth();
  const [importar, setImportar] = React.useState(false);
  const podeImportar = can("batch_area.create");
  const mapa = entryById("mapa");
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <Card className="ws-filters no-print flex flex-wrap items-center gap-2">
      {mapa && <Link href={canonicalHref(mapa)} data-testid="areas-ver-no-mapa"><PillBtn tone="gray"><IconeMapa className="h-3.5 w-3.5" /> Ver no Mapa de Manejo</PillBtn></Link>}
      {podeImportar && <PillBtn tone="gray" className="ml-auto" data-testid="areas-importar-contornos" onClick={() => setImportar(true)}><Upload className="h-3.5 w-3.5" /> Importar contornos (KML / GeoJSON)</PillBtn>}
    </Card>
    <ResourceList resourceKey="areas" />
    {podeImportar && <ImportacaoDeContornos open={importar} onOpenChange={setImportar} />}
  </div>;
}

/**
 * Cada polígono do arquivo vira uma área pela MESMA rota do cadastro (`POST /api/resources/areas`, com chave de
 * idempotência): nome do arquivo, cor branca, uso Pastagem, situação Ativa, posse Própria. O servidor confere tudo
 * como em qualquer cadastro; o que ele recusa aparece no aviso, com o nome do polígono.
 */
function ImportacaoDeContornos({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  // Empresa das áreas novas: a da sessão, ou a primeira do contexto (mesma regra das telas de lançamento). É PEDIDO —
  // o servidor confere o escopo.
  const empresaId = useEmpresaPadrao();
  const [importando, setImportando] = React.useState(false);
  const [progresso, setProgresso] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement | null>(null);

  async function importarArquivo(arquivo: File) {
    if (!empresaId) { setErro("Nenhuma empresa disponível para importar áreas."); return; }
    setErro(null);
    setProgresso(null);
    setImportando(true);
    try {
      const resultado = parseImportacaoMapa(arquivo.name, await arquivo.text());
      const total = resultado.areas.length;
      setProgresso(`Importando ${total} área(s) (${rotuloFormato(resultado.formato)})…`);
      let ok = 0;
      const falhas: string[] = [];
      for (const a of resultado.areas) {
        try {
          await api("/api/resources/areas", {
            method: "POST",
            idempotencyKey: newIdem(),
            body: { empresa_id: empresaId, name: a.nome, color: a.cor, area_ha: a.tamanho_ha, usable_area_ha: a.tamanho_ha, land_use: "pastagem", status: "ativa", tenure: "propria", geometria: a.geometria }
          });
          ok += 1;
          if (ok % 10 === 0 || ok === total) setProgresso(`Importadas ${ok}/${total}…`);
        } catch (e: unknown) {
          falhas.push(`${a.nome}: ${e instanceof Error ? e.message : "falha"}`);
        }
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ["res", "areas"] }), qc.invalidateQueries({ queryKey: ["b1", "areas"] })]);
      const avisos = [...resultado.avisos, ...falhas.slice(0, 8)];
      if (ok === 0) {
        setErro(`Nenhuma área importada.${falhas[0] ? ` ${falhas[0]}` : ""}`);
        setProgresso(null);
      } else {
        setProgresso(`Importação concluída: ${ok}/${total} área(s) em branco. Nomes do arquivo; cor padrão branca.`);
        if (avisos.length) setErro(`Avisos: ${avisos.slice(0, 5).join(" · ")}${avisos.length > 5 ? "…" : ""}`);
      }
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar o arquivo.");
      setProgresso(null);
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setProgresso(null); setErro(null); } onOpenChange(o); }} preventClose={importando} title="Importar contornos" size="md"
      description="KML, GeoJSON ou JSON. Cada polígono vira uma área com o nome do arquivo, cor branca, uso Pastagem, situação Ativa e posse Própria. Depois, ajuste cada área na ficha."
      footer={<Button type="button" variant="outline" disabled={importando} onClick={() => onOpenChange(false)}>Fechar</Button>}>
      <div className="flex flex-col gap-2">
        <input
          ref={arquivoRef}
          type="file"
          accept=".kml,.json,.geojson,application/vnd.google-earth.kml+xml,application/geo+json,application/json,text/xml"
          disabled={importando}
          data-testid="areas-importacao-arquivo"
          className="text-sm"
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void importarArquivo(f); }}
        />
        {progresso && <p className="text-sm text-slate-700" data-testid="areas-importacao-progresso">{progresso}</p>}
        {erro && <p className="text-sm text-red-600" data-testid="areas-importacao-erro">{erro}</p>}
      </div>
    </Dialog>
  );
}
