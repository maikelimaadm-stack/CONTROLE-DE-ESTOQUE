import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarioDoSistema, painelDoCalendarioPadrao } from "./calendario-do-sistema";

const desenhar = (props: Partial<React.ComponentProps<typeof CalendarioDoSistema>> = {}) => renderToStaticMarkup(React.createElement(CalendarioDoSistema, { valor: "2026-10-18", escolher: () => {}, ...props }));

describe("calendário compartilhado da Central", () => {
  it("preserva seis semanas, o dia escolhido e as ações da Central", () => {
    const html = desenhar();
    expect(html).toContain("outubro de 2026");
    expect(html.match(/aria-pressed=/g)).toHaveLength(42);
    expect(html).toMatch(/aria-label="18\/10\/2026" aria-pressed="true"/);
    expect(html).toContain(">Hoje</button>");
    expect(html).toContain(">Limpar</button>");
    expect(html).toContain('aria-label="Anterior"');
    expect(html).toContain('aria-label="Próximo"');
  });
  it("permite iniciar o outro lado do período no próximo mês sem escolher uma data", () => {
    const html = desenhar({ valor: "", inicial: new Date(2026, 10, 1) });
    expect(html).toContain("novembro de 2026");
    expect(html).not.toContain('aria-pressed="true"');
  });
  it("destaca o período somente quando seus dois extremos estão preenchidos", () => {
    expect(desenhar({ intervalo: { inicio: "2026-10-18", fim: "2026-10-20" } }).match(/data-intervalo=""/g)).toHaveLength(3);
    expect(desenhar({ intervalo: { inicio: "2026-10-18", fim: "" } })).not.toContain("data-intervalo");
    expect(desenhar({ intervalo: { inicio: "2026-10-20", fim: "2026-10-18" } }).match(/data-intervalo=""/g)).toHaveLength(3);
  });
  it("o painel padrão renderiza exatamente o mesmo calendário", () => {
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null, painelDoCalendarioPadrao.desenhar({ valor: "2026-10-18", escolher: () => {}, fechar: () => {} })))).toBe(desenhar());
  });
});
