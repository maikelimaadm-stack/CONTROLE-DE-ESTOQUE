import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionRows } from "@agro/domain";
import { ATTACHMENT_PARENTS, attachableEntity } from "../../src/lib/attachment-parent.js";

/** Guardrail: toda rota de anexos passa pelo autorizador central e todo pai registrado tem classificação, permissão real e resolver. */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../../src/routes/attachments.ts"), "utf8");

describe("guardrail: anexos × registro-pai", () => {
  it("cada handler de /attachments chama authorizeAttachmentParent antes de qualquer efeito", () => {
    const starts = [...src.matchAll(/\n\s*app\.(get|post|put|patch|delete)\(/g)].map((m) => m.index!); starts.push(src.length);
    const chunks = starts.slice(0, -1).map((s, i) => src.slice(s, starts[i + 1]!));
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c, c.slice(0, 80)).toContain("authorizeAttachmentParent(");
      // a autorização vem antes de ler blob / inserir / excluir
      const auth = c.indexOf("authorizeAttachmentParent("); for (const effect of ["attachmentStorage.get(", "attachmentStorage.put(", "attachmentStorage.remove(", "insert into erp.attachments", "delete from erp.attachments"]) { const i = c.indexOf(effect); if (i >= 0) expect(i, `${effect} antes da autorização`).toBeGreaterThan(auth); }
    }
    expect(src).not.toMatch(/erp\.\$\{/); // nenhum nome de tabela dinâmico nas rotas
  });
  it("todo pai registrado tem classificação, resolver e permissão de visualização existente no catálogo", () => {
    const perms = new Set(permissionRows().map((p) => p.key));
    const entries = Object.entries(ATTACHMENT_PARENTS); expect(entries.length).toBeGreaterThan(40);
    for (const [entity, rule] of entries) {
      expect(["farm", "org", "child"], entity).toContain(rule.kind);
      expect(typeof rule.load, entity).toBe("function");
      const vp = rule.viewPerm;
      if (typeof vp === "string") expect(perms.has(vp), `${entity}: ${vp}`).toBe(true);
      else for (const p of ["nutrition", "sanitary", "purchase", "sale", "payable", "receivable"].map((k) => vp({ handling_type: k, movement_type: k, direction: k }))) expect(perms.has(p), `${entity}: ${p}`).toBe(true);
    }
    // entidades usadas pela UI (DocList/ResourceList) estão cobertas; tabelas internas não
    for (const e of ["service_orders", "purchase_requests", "animal_movements", "animal_handlings", "weighings", "financial_titles", "warehouses", "equipments", "people", "farms", "batches", "feedlot_corrals", "users"]) expect(attachableEntity(e), e).toBeTruthy();
    for (const e of ["attachment_blobs", "organization_members", "role_permissions", "audit_logs", "__proto__", "constructor"]) expect(attachableEntity(e), e).toBeUndefined();
  });
});
