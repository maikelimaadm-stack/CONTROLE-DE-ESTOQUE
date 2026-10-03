import { test, expect, type Response } from "@playwright/test";
import { login, api } from "./helpers";
import { cfg4, chamarApi, criarTopViaApi, excluirTopE2E } from "./top-config-08-comum";
import { cadastroDeEstoque, hojeISO } from "./estoque-01-comum";
import { MSG_ROTA_NAO_ENCONTRADA, vigiar, type Mundo } from "./operacoes-01-f2-skew-comum";

/**
 * OPERACOES-01 · F12 · K-1, SENTIDO 1 — O WEB DESTE HEAD CONTRA A API DA BASE (decisão 282, parte F12; a janela "web
 * antes da API" da DEPLOYMENT): A APROVAÇÃO NA CONSULTA DO DOCUMENTO DE ESTOQUE.
 *
 * O nome termina em `skew-api-producao.spec.ts`: roda SÓ em `playwright.skew.config.ts` (o `testMatch` dele) e o
 * `playwright.config.ts` comum o ignora — lá a API seria a deste HEAD e o caso ficaria verde por vacuidade. Arquivo
 * próprio da fase, como os das outras fases desta PR.
 *
 * O QUE SE MEDE. A consulta da Central de Estoque deste HEAD pergunta `GET /api/aprovacoes/estoque/<segmento>/<id>` (a
 * rota nova da F12) para desenhar o bloco "Aprovação". A base não tem a rota: responde a 404 de ROTA, e a consulta tem de
 * ficar como a de hoje — o documento lido, a pílula Confirmar, SEM o bloco, sem nenhuma requisição morta no navegador.
 * Não há capacidade nova: o 404 de rota do prefixo próprio `/api/aprovacoes` é a declaração (o precedente da 279).
 *
 * O MUNDO É PERGUNTADO À BASE NA HORA, pelo GET da situação deste documento: a 404 de rota → legado (a base de hoje);
 * 200 → novo (a base já com a F12, depois do merge). Qualquer outra resposta é defeito. Os dois ramos cobram prova
 * POSITIVA: no legado, o pedido da tela SAIU e voltou 404 de rota (a ausência do bloco só vale depois disso, com a
 * consulta montada); no novo, o bloco pendente aparece.
 */

const caminho = (r: Response) => new URL(r.url()).pathname;

test("F12K-1 — web deste HEAD × API da base: a consulta da entrada com 'Sempre' abre; legado = sem o bloco de aprovação (404 de rota), novo = o bloco pendente", async ({ page }) => {
  const vigia = vigiar(page);
  await login(page);
  const top = await criarTopViaApi(page, "estoque.entrada", cfg4({ confirmacao: "manual", aprovacao: "sempre" }), { rotulo: "F12K entrada" });
  try {
    const c = await cadastroDeEstoque(page);
    const doc = await api<{ id: string; codigo: string; situacao: string }>(page, "POST", "/api/estoque/entradas", {
      empresa_id: c.empresa, tipo_operacao_id: top.id, armazem_id: c.armazem, data_documento: hojeISO(),
      itens: [{ produto_id: c.produto, quantidade: "2", custo_unitario: "3" }]
    });
    expect(doc.situacao, "premissa: a base lançou a entrada, aberta").toBe("aberto");
    const porta = `/api/aprovacoes/estoque/entradas/${doc.id}`;

    // O MUNDO, perguntado à base.
    const sonda = await chamarApi<{ situacao?: string; error?: { code?: string; message?: string } }>(page, "GET", porta);
    let mundo: Mundo;
    if (sonda.status === 404) {
      expect([sonda.corpo.error?.code, sonda.corpo.error?.message], "a 404 da base é a de ROTA (outra 404 é defeito)").toEqual(["NOT_FOUND", MSG_ROTA_NAO_ENCONTRADA]);
      mundo = "legado";
    } else {
      expect([sonda.status, sonda.corpo.situacao], "a base com a F12 responde a situação pendente").toEqual([200, "pendente"]);
      mundo = "novo";
    }
    console.log(`[skew] OPERACOES-01 F12 · K-1 · a base responde ${sonda.status} a GET ${porta.replace(doc.id, "<id>")} → mundo ${mundo}`);

    // A CONSULTA deste HEAD: o pedido da situação SAI (e é ele que decide o bloco).
    const pedido = page.waitForResponse((r) => r.request().method() === "GET" && caminho(r) === porta);
    await page.goto(`/estoque/movimentacoes/entradas/${doc.id}`);
    const resposta = await pedido;
    const central = page.getByTestId("estoque-central");
    await expect(central, "a consulta abre contra a base").toHaveAttribute("data-modo", "consulta");
    await expect(central).toHaveAttribute("data-situacao", "aberto");
    await expect(page.getByTestId("estoque-central-codigo")).toHaveText(doc.codigo);
    await expect(page.getByTestId("estoque-confirmar"), "a pílula Confirmar de hoje continua").toBeVisible();
    if (mundo === "legado") {
      expect(resposta.status(), "a tela perguntou, e a base respondeu a 404 de rota").toBe(404);
      await expect(page.getByTestId("central-estoque-aprovacao"), "sem a rota, o bloco não aparece (a consulta de hoje)").toHaveCount(0);
    } else {
      expect(resposta.status()).toBe(200);
      await expect(page.getByTestId("central-estoque-aprovacao")).toHaveAttribute("data-situacao", "pendente");
    }
    vigia.semBloqueio();

    // Limpeza: a base aprova e confirma (rotas dela) — o documento sai da fila de Aprovações das próximas execuções.
    const aprovou = await chamarApi(page, "POST", `/api/aprovacoes/estoque/entradas/${doc.id}/aprovar`, {});
    expect(aprovou.status, "a base aprova pela rota da fila").toBe(200);
    expect((await api<{ situacao: string }>(page, "POST", `/api/estoque/entradas/${doc.id}/confirmar`, {})).situacao).toBe("confirmado");
  } finally {
    await excluirTopE2E(page, top.id);
  }
});
